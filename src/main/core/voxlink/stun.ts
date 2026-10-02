// SPDX-License-Identifier: LGPL-3.0-only
// RFC 5389 client with StunProbe.java sequential sampling/resend policy, VoxLink 924845e.
import dgram from 'node:dgram'
import { randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { setTimeout as delay } from 'node:timers/promises'
export const STUN_MAGIC_COOKIE = 0x2112a442, STUN_REQ_TYPE = 1, STUN_RESP_TYPE = 0x101, STUN_HEADER_LEN = 20
export const STUN_SERVERS = ['stun.qq.com:3478','stun.miwifi.com:3478','stun.cloudflare.com:3478','stun.l.google.com:19302']
export interface StunMappedAddr { ip: string; port: number }
export const validMappedAddr = (value: StunMappedAddr | null | undefined): boolean => !!value && !!value.ip && Number.isInteger(value.port) && value.port > 0 && value.port <= 65535
export function stunBuildRequest(): Buffer { const request = Buffer.alloc(20); request.writeUInt16BE(1); request.writeUInt32BE(STUN_MAGIC_COOKIE,4); randomBytes(12).copy(request,8); return request }
const preferred = new Set<string>()
export async function stunQuery(socket: dgram.Socket, server: string, attempts: number, timeoutMs: number, signal?:AbortSignal, resends=0): Promise<StunMappedAddr | null> {
  let remote: { address: string; port: number }
  try { const uri = new URL(`udp://${server}`); remote = { address: (await lookup(uri.hostname,{family:4})).address, port: Number(uri.port || 3478) } } catch { return null }
  for (let attempt = 0; attempt < attempts; attempt++) {
    if(signal?.aborted)return null
    const request = stunBuildRequest()
    const answer = await new Promise<StunMappedAddr | null>(resolve => {
      let resendTimer:ReturnType<typeof setTimeout>|undefined,finished=false
      const finish = (value: StunMappedAddr | null) => {if(finished)return;finished=true;clearTimeout(timer);clearTimeout(resendTimer);signal?.removeEventListener('abort',failed); socket.off('message',message); socket.off('error',failed); socket.off('close',failed); resolve(value) }
      const failed = () => finish(null)
      const message = (packet: Buffer, from: dgram.RemoteInfo) => {
        if (from.address !== remote.address || from.port !== remote.port || packet.length < 20 || packet.readUInt16BE() !== STUN_RESP_TYPE || !packet.subarray(4,20).equals(request.subarray(4))) return
        const end = 20 + packet.readUInt16BE(2); if (end > packet.length) return
        for (let cursor = 20; cursor + 4 <= end;) {
          const type = packet.readUInt16BE(cursor), size = packet.readUInt16BE(cursor+2), start = cursor+4
          if (start + size > end) return
          if ((type === 1 || type === 0x20 || type === 0x8020) && size >= 8 && packet[start+1] === 1) {
            const mask = type === 1 ? 0 : STUN_MAGIC_COOKIE; const ip = (packet.readUInt32BE(start+4) ^ mask) >>> 0
            const value = { ip: [ip>>>24,(ip>>>16)&255,(ip>>>8)&255,ip&255].join('.'), port: packet.readUInt16BE(start+2) ^ (mask>>>16) }
            if (validMappedAddr(value)) finish(value); return
          }
          cursor = start + ((size + 3) & ~3)
        }
      }
      const timer = setTimeout(failed,timeoutMs)
      socket.on('message',message); socket.once('error',failed); socket.once('close',failed)
      signal?.addEventListener('abort',failed,{once:true})
      try { socket.send(request,remote.port,remote.address,error => { if (error) failed() }) } catch { failed() }
      const resend=(n:number)=>{if(finished||n>resends)return;resendTimer=setTimeout(()=>{if(finished)return;try{socket.send(request,remote.port,remote.address,()=>{})}catch{}resend(n+1)},stunResendDelay(n))}
      resend(1)
    })
    if (answer) return answer
  }
  return null
}
export async function stunSampleSeries(socket: dgram.Socket, servers: string[], count: number, tries: number, timeoutMs: number, signal?:AbortSignal): Promise<StunMappedAddr[]> {
  const samples: StunMappedAddr[] = []
  for (const server of [...servers].sort((a,b) => Number(preferred.has(b))-Number(preferred.has(a)))) { if (samples.length >= count||signal?.aborted) break; const result = await stunQuery(socket,server,tries,timeoutMs,signal); if (result) { preferred.add(server); samples.push(result) } else preferred.delete(server) }
  return samples
}
export const stunDeltaFromSamples = (samples: StunMappedAddr[]) => samples.length > 1 ? samples[samples.length-1].port - samples[0].port : 0
export function stunResendDelay(retransmissions:number,random=Math.random):number {
  const rto=Math.min(200<<retransmissions,800),jitter=Math.trunc(rto*0.2) // StunProbe.java: resendDelay 200, 800, 0.2
  return rto-jitter+Math.floor(random()*(2*jitter+1))
}
/** StunProbe.java: samplePortsSequential; race servers, then reuse the selected destination. */
export async function samplePortsSequential(socket:dgram.Socket,servers:string[],count:number,intervalMs:number,signal:AbortSignal):Promise<StunMappedAddr[]> {
  if(!servers.length||count<=0)return[]
  const race=new AbortController(),abort=()=>race.abort();signal.addEventListener('abort',abort,{once:true})
  let selected:{server:string;result:StunMappedAddr}
  try{selected=await Promise.any(servers.map(async server=>{const result=await stunQuery(socket,server,1,800,race.signal,1);if(!result)throw new Error('STUN timeout');return{server,result}}))}catch{return[]}finally{race.abort();signal.removeEventListener('abort',abort)}
  const samples=[selected.result]
  for(let i=1;i<count;i++){
    signal.throwIfAborted()
    const result=await stunQuery(socket,selected.server,1,800,signal,2) // StunProbe.java: sample deadline 800ms, resend count 2
    if(result)samples.push(result)
    if(i<count-1)await delay(intervalMs,undefined,{signal})
  }
  return samples
}
export async function quickNatType(): Promise<string> { const socket = dgram.createSocket('udp4'); try { const samples = await stunSampleSeries(socket,STUN_SERVERS,2,1,1200); return samples.length < 2 ? 'unknown' : stunDeltaFromSamples(samples) ? 'symmetric' : 'cone' } finally { try { socket.close() } catch {} } }
