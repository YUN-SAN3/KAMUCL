// SPDX-License-Identifier: LGPL-3.0-only
// Original authors: AUGUHDAR / VoxLink contributors. TypeScript modifications: KAMUCL contributors.
// See THIRD_PARTY_NOTICES.md and licenses/LGPL-3.0.txt; root MIT does not apply to this adaptation.
/** VoxLink's TURN relay wire protocol v1 (not RFC TURN).
 * Ported from TurnRelayClient.java, upstream 6b11d93 / 1.1.5, LGPL-3.0.
 * Tickets are only sent to the allocation's node. Never log tickets or room tokens.
 */
import dgram from 'node:dgram'
import { setTimeout as delay } from 'node:timers/promises'
import { openTurnTcp } from './turnTcp'
import dns from 'node:dns/promises'
import crypto from 'node:crypto'
import type { RudpCodec, RudpTarget } from './rudp'

const header = (type: number) => Buffer.from([0x56, 0x4c, 1, type])
function isPacket(p: Buffer, type: number, length: number): boolean {
  return p.length >= length && p[0] === 0x56 && p[1] === 0x4c && p[2] === 1 && p[3] === type
}
export interface TurnNode { id: string; name?: string; host: string; port: number; stdTurnPort?: number }
export interface TurnAllocation { sessionId: string; host: string; port: number; hostTicket: string; guestTicket: string; expire: number }
export function validTurnEndpoint(host: unknown, port: unknown): boolean {
  return typeof host === 'string' && !!host && host.length <= 253 && typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65535
}
function closeSocket(s: dgram.Socket) { try { s.close() } catch { /* already closed */ } }
async function socketFor(host: string, port: number, signal: AbortSignal): Promise<{ socket: dgram.Socket; target: RudpTarget; detachAbort:()=>void }> {
  const ip = await dns.lookup(host)
  signal.throwIfAborted()
  const socket = dgram.createSocket(ip.family === 6 ? 'udp6' : 'udp4')
  socket.on('error', () => {}) // UDP unreachable is retried by the transaction.
  const abort = () => closeSocket(socket)
  signal.addEventListener('abort', abort, {once:true})
  socket.once('close', () => signal.removeEventListener('abort', abort))
  await new Promise<void>((resolve,reject) => {
    const closed=()=>{socket.off('error',failed);reject(new Error('中继连接已取消'))}
    const failed=(e:Error)=>{socket.off('close',closed);reject(e)}
    socket.once('close',closed);socket.once('error',failed)
    socket.bind(0,()=>{socket.off('close',closed);socket.off('error',failed);resolve()})
  })
  if (signal.aborted) { closeSocket(socket); signal.throwIfAborted() }
  return {socket, target:{address:ip.address,port},detachAbort:()=>signal.removeEventListener('abort',abort)}
}
function exchange(socket: dgram.Socket, target: RudpTarget, packet: Buffer, accept: (p: Buffer) => boolean, timeout: number, signal: AbortSignal, repeat = 0): Promise<Buffer> {
  return new Promise((resolve,reject) => {
    const finish = (e?: Error, result?: Buffer) => {
      clearTimeout(timer); if (retry) clearInterval(retry)
      socket.off('message', onMessage); socket.off('close', onClose); signal.removeEventListener('abort', onAbort)
      e ? reject(e) : resolve(result!)
    }
    const onMessage = (p: Buffer, info: dgram.RemoteInfo) => { if (info.address === target.address && info.port === target.port && accept(p)) finish(undefined,p) }
    const onClose = () => finish(new Error('中继连接已关闭'))
    const onAbort = () => finish(new Error('中继连接已取消'))
    let sent = 0
    const send = () => { if (repeat && sent++ >= 5) return; try { socket.send(packet,target.port,target.address,()=>{}) } catch { finish(new Error('中继连接已关闭')) } }
    const timer = setTimeout(() => finish(new Error('中继节点响应超时')), timeout)
    const retry = repeat ? setInterval(send,repeat) : undefined
    socket.on('message',onMessage); socket.once('close',onClose); signal.addEventListener('abort',onAbort,{once:true})
    if (signal.aborted) onAbort(); else send()
  })
}
export async function probeTurnNodes(nodes: TurnNode[], signal: AbortSignal): Promise<Array<TurnNode & {rtt:number}>> {
  const results = await Promise.all(nodes.slice(0,32).map(async node => {
    let rtt = -1, socket: dgram.Socket | undefined
    try {
      const opened = await socketFor(node.host,node.port,signal); socket = opened.socket
      const deadline = Date.now()+4000
      for (let i=0;i<6 && Date.now()<deadline;i++) {
        const packet=Buffer.alloc(20); header(1).copy(packet); crypto.randomBytes(4).copy(packet,4); packet.writeBigInt64BE(BigInt(Date.now()),8)
        const start=Date.now()
        try { await exchange(socket,opened.target,packet,p=>isPacket(p,2,24)&&p.subarray(4,8).equals(packet.subarray(4,8)),Math.min(800,deadline-Date.now()),signal); rtt=rtt<0?Date.now()-start:Math.min(rtt,Date.now()-start) }
        catch { signal.throwIfAborted() }
      }
    } catch { signal.throwIfAborted() }
    finally { if(socket)closeSocket(socket) }
    return {...node,rtt}
  }))
  signal.throwIfAborted()
  return results.sort((a,b)=>(a.rtt<0?Infinity:a.rtt)-(b.rtt<0?Infinity:b.rtt))
}

export class TurnCodec implements RudpCodec {
  readonly session: Buffer
  constructor(sessionId: string, readonly role: 1|2) {
    if (!/^[a-f\d]{32}$/i.test(sessionId)) throw new Error('中继会话标识无效')
    this.session=Buffer.from(sessionId,'hex')
  }
  encode(frame: Buffer): Buffer {
    const out=Buffer.alloc(24+frame.length); header(5).copy(out); this.session.copy(out,4)
    out[20]=this.role;out[21]=3-this.role;out.writeUInt16BE(frame.length,22);frame.copy(out,24);return out
  }
  decode(packet: Buffer): Buffer | null {
    if (!isPacket(packet,5,24) || !packet.subarray(4,20).equals(this.session) || packet[20]!==3-this.role || packet[21]!==this.role || packet.readUInt16BE(22)!==packet.length-24) return null
    return packet.subarray(24)
  }
}
export class TurnSession {
  readonly codec: TurnCodec
  private keepalive?: NodeJS.Timeout
  private closed=false
  private bound=false
  private detachAbort=()=>{}
  private closeTransport=()=>{}
  private constructor(public socket: dgram.Socket, public target: RudpTarget, readonly sessionId: string, readonly role: 1|2) { this.codec=new TurnCodec(sessionId,role) }
  static async bind(data: {sessionId:string;host:string;port:number;ticket:string}, role:1|2, signal:AbortSignal): Promise<TurnSession> {
    if (!validTurnEndpoint(data.host,data.port) || !/^[a-f\d]{32}$/i.test(data.sessionId) || typeof data.ticket!=='string' || !data.ticket || data.ticket.length>4096) throw new Error('中继凭据无效')
    const {socket,target,detachAbort}=await socketFor(data.host,data.port,signal)
    const session=new TurnSession(socket,target,data.sessionId,role)
    session.detachAbort=detachAbort
    const ticket=Buffer.from(data.ticket,'ascii'), packet=Buffer.alloc(23+ticket.length)
    header(3).copy(packet);session.codec.session.copy(packet,4);packet[20]=role;packet.writeUInt16BE(ticket.length,21);ticket.copy(packet,23)
    try {
      const bindRound = async () => {
        try {
          const result = await exchange(session.socket,session.target,packet,p=>isPacket(p,4,22)&&p.subarray(4,20).equals(session.codec.session)&&p[20]===role,4600,signal,900)
          // Upstream treats ROLE_CONFLICT as an accepted bind whose first reply was lost.
          // The response has already been checked against this endpoint, session and role.
          return result[21] === 4 ? 0 : result[21]
        } catch { signal.throwIfAborted(); return 5 }
      }
      let code = 5
      for (let round=0;round<3;round++) {
        code=await bindRound()
        if(code===0)break
        if(code!==5 && code!==4)throw new Error(['','中继凭据无效','中继凭据过期','中继会话已满'][code]||'中继绑定失败')
        if(round<2)await delay(1000,undefined,{signal})
      }
      if(code===5) {
        detachAbort();closeSocket(socket)
        const channel=await openTurnTcp(data.host,data.port,signal)
        session.socket=channel.socket;session.target=channel.target;session.closeTransport=channel.close
        for(let round=0;round<2;round++) {code=await bindRound();if(code===0)break;if(code!==4&&code!==5)break;if(round===0)await delay(1000,undefined,{signal})}
      }
      // Binding alone does not report success: the engine still waits for the peer/data path.
      if(code!==0)throw new Error(code===4?'中继角色暂被占用，请稍后重试':'中继绑定失败（UDP 与 TCP 均不可用）')
      session.bound=true; session.keepalive=setInterval(()=>session.control(6),15_000)
      session.socket.once('close',()=>{if(session.keepalive)clearInterval(session.keepalive)})
      return session
    } catch(e) { session.close();throw e }
  }
  private control(type:number, callback?:()=>void) {
    const p=Buffer.alloc(21);header(type).copy(p);this.codec.session.copy(p,4);p[20]=this.role
    try {this.socket.send(p,this.target.port,this.target.address,()=>callback?.())} catch {callback?.()}
  }
  close() {
    if(this.closed)return;this.closed=true
    this.detachAbort()
    if(this.keepalive)clearInterval(this.keepalive)
    if(this.bound)this.control(8,()=>{closeSocket(this.socket);this.closeTransport()});else {closeSocket(this.socket);this.closeTransport()}
  }
}
