// SPDX-License-Identifier: LGPL-3.0-only
// UdpHolePuncher.java, VoxLink 924845e. Node UDP events replace Java NIO selectors.
import dgram from 'node:dgram'
import net from 'node:net'
import { randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { signPunchFrame, verifyPunchFrame } from './punchAuth'
import { DEFAULT, type PunchProfile } from './punchProfiles'
import { fromProfile, type PunchParams, type PunchResult } from './punchPolicy'
export type Address = { address: string; port: number }
export function punchBuildControl(type: number, nonce: number): Buffer {
  const b = Buffer.from([86,76,type,0,0]) // UdpHolePuncher.java: MAGIC, CONTROL_PLAIN_LEN
  b.writeUInt16BE(nonce & 65535,3); return b
}
export function punchParseControl(b: Buffer): { type: number; nonce: number } | null {
  return b.length >= 5 && b[0] === 86 && b[1] === 76 && (b[2] === 1 || b[2] === 2) ? {type:b[2],nonce:b.readUInt16BE(3)} : null
}
export const punchRandomNonce = () => randomBytes(2).readUInt16BE() // UdpHolePuncher.java: sessionNonce
export function punchAcceptSource(expected: {address:string}|null, actual: {address:string}|null, authenticated=false): boolean {
  if (!expected || !actual) return false
  if (expected.address === actual.address) return true
  // UdpHolePuncher.java: acceptAddress /16 CGNAT drift only for unauthenticated control.
  return !authenticated && net.isIPv4(expected.address) && net.isIPv4(actual.address) && expected.address.split('.').slice(0,2).join('.') === actual.address.split('.').slice(0,2).join('.')
}
export async function udpSendTo(socket:dgram.Socket|null, data:Buffer, remote:Address|null):Promise<void> {
  if(socket && remote) await new Promise<void>((resolve,reject)=>{try{socket.send(data,remote.port,remote.address,error=>error?reject(error):resolve())}catch(error){reject(error)}})
}
async function sendPkt(socket:dgram.Socket, packet:Buffer, remote:Address):Promise<void> {
  for(let attempt=0;attempt<3;attempt++){ // UdpHolePuncher.java: sendPkt ICMP/WSAECONNRESET retries
    try{await udpSendTo(socket,packet,remote);return}catch{/* retry clears Windows ICMP latch */}
  }
}
export class PpsLimiter {
  private start:number;private sent=0
  constructor(readonly maxPps:number,private now=()=>performance.now()){this.start=now()}
  beforeSendDelay():number {
    // UdpHolePuncher.java: PpsLimiter.beforeSend cumulative monotonic budget.
    this.sent++
    const allowed=Math.floor((this.now()-this.start)*Math.max(1,this.maxPps)/1000)
    return this.sent>allowed?(this.sent-allowed)*1000/Math.max(1,this.maxPps):0
  }
}
const shuffle=(values:number[],random:()=>number)=>{
  for(let i=values.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[values[i],values[j]]=[values[j],values[i]]}return values
}
export function controlPorts(center:number,range:number,window:number,random=Math.random):number[] {
  // UdpHolePuncher.java: sendControlMultiPort. Retain the source's duplicate center
  // in the random branch; sample the full range (fixes the old upstream endless loop).
  const ports=[center]
  if(range>20){ // UdpHolePuncher.java: useRandomScan threshold
    const lo=Math.max(1,center-range),hi=Math.min(65535,center+range),max=Math.min(window,hi-lo),chosen=new Set([center])
    while(chosen.size<max+1)chosen.add(lo+Math.floor(random()*(hi-lo+1)))
    ports.push(...shuffle([...chosen],random))
  }else for(let offset=1;offset<=range;offset++){if(center-offset>0)ports.push(center-offset);if(center+offset<=65535)ports.push(center+offset)}
  return ports
}
export interface PuncherOptions {
  conn:dgram.Socket;timeoutMs?:number;authKey?:Buffer|null;profile?:PunchProfile;params?:PunchParams
  sockets?:dgram.Socket[];mode?:'prediction'|'ports'|'group';range?:number;fixedRange?:boolean
  skipFirewall?:boolean;sweepSpread?:number;random?:()=>number
}
export class PunchFailure extends Error {constructor(readonly result:PunchResult){super(result.firewallDetected?'本轮未收到 UDP 回包':'本轮打洞未命中');this.name='PunchFailure'}}
export class Puncher {
  conn:dgram.Socket
  readonly nonce=punchRandomNonce()
  readonly profile:PunchProfile;readonly params:PunchParams;readonly stats:PunchResult
  timeoutMs:number
  private remote:Address|null=null;private ports:number[]=[];private timeout?:NodeJS.Timeout
  private controller=new AbortController();private active=false;private settled=false;private startedAt=0
  private notify?:(address:Address)=>void;private resolve!:(address:Address)=>void;private reject!:(error:Error)=>void
  private result:Promise<Address>;private receivers=new Map<dgram.Socket,(b:Buffer,from:dgram.RemoteInfo)=>void>()
  private sprayTable?:number[];private sprayCursor=0
  constructor(private options:PuncherOptions){
    this.conn=options.conn;this.profile=options.profile??DEFAULT;this.params={...(options.params??fromProfile(this.profile))}
    this.timeoutMs=options.timeoutMs??this.params.timeoutMs
    // UdpHolePuncher.java: prediction path and punchEasySymDual wrapper mark failed
    // results; generic punchMultiSocket and punchMultiPort do not mark prediction.
    this.stats={socketsTried:options.sockets?.length||1,socketsReceivedPunch:0,socketsReceivedAck:0,predictionDelta:0,elapsedMs:0,firewallDetected:false,portPredictionActive:options.mode==='group'?this.params.easySymBomb:options.mode!=='ports'&&(options.range??0)>0,success:false}
    this.result=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject});void this.result.catch(()=>{})
  }
  get sockets():dgram.Socket[]{return this.options.sockets?.length?this.options.sockets:[this.options.conn]}
  setOnPeer(callback:(address:Address)=>void):void{this.notify=callback}
  setTarget(address:Address|null):void{this.remote=address}
  setPredictedPorts(ports:number[]):void{this.ports=[...new Set(ports)].filter(p=>Number.isInteger(p)&&p>0&&p<=65535)}
  private message(socket:dgram.Socket,packet:Buffer,from:dgram.RemoteInfo):void {
    if(!this.active||this.settled)return
    const verified=verifyPunchFrame(packet,this.options.authKey),frame=verified&&punchParseControl(verified)
    if(!frame||!punchAcceptSource(this.remote,from,!!this.options.authKey))return
    if(frame.type===1)this.stats.socketsReceivedPunch++;else this.stats.socketsReceivedAck++
    const actual={address:from.address,port:from.port};this.remote=actual
    // UdpHolePuncher.java: sendControlTo(TYPE_ACK) uses OUR nonce for PUNCH and ACK.
    void sendPkt(socket,signPunchFrame(punchBuildControl(2,this.nonce),this.options.authKey),actual)
    this.stats.success=true;this.stats.elapsedMs=performance.now()-this.startedAt
    this.conn=socket;this.settled=true;this.cleanup();this.notify?.(actual);this.resolve(actual)
  }
  private async sleep(ms:number):Promise<void>{await delay(ms,undefined,{signal:this.controller.signal})}
  private async send(socket:dgram.Socket,port:number,limiter?:PpsLimiter):Promise<void>{
    if(!this.active||!this.remote||port<1||port>65535)return
    if(limiter){const ms=limiter.beforeSendDelay();if(ms>0)await this.sleep(ms)}
    if(!this.active||!this.remote)return
    await sendPkt(socket,signPunchFrame(punchBuildControl(1,this.nonce),this.options.authKey),{address:this.remote.address,port})
  }
  private fail(firewall=false):void{
    if(this.settled)return
    this.stats.elapsedMs=performance.now()-this.startedAt;this.stats.firewallDetected=firewall
    this.settled=true;this.cleanup();this.reject(new PunchFailure({...this.stats}))
  }
  private async spray(round:number,limiter:PpsLimiter):Promise<void>{
    const p=this.params,random=this.options.random??Math.random
    // UdpHolePuncher.java: sprayRound Fisher-Yates over all ports, persistent cursor.
    this.sprayTable??=shuffle(Array.from({length:65535},(_,i)=>i+1),random)
    for(let r=0;r<p.sprayPacketsPerPort&&this.active;r++)await this.send(this.options.conn,this.remote!.port,limiter)
    const base=p.sprayPortCountMin+Math.floor(random()*Math.max(1,p.sprayPortCountMax-p.sprayPortCountMin+1))
    const count=round>2?Math.max(Math.trunc(base*p.sprayDecayNumerator/round),p.sprayDecayFloor):base // UdpHolePuncher.java: sprayRound decay starts after round 2
    for(let i=0;i<count&&this.active;i++){
      const port=this.sprayTable[this.sprayCursor++%this.sprayTable.length],socket=this.sockets[i%this.sockets.length]
      for(let r=0;r<p.sprayPacketsPerPort&&this.active;r++)await this.send(socket,port,limiter)
      await this.sleep(Math.max(0,p.sprayPortIntervalMs))
    }
  }
  private async sendLoop():Promise<void>{
    const p=this.params,s=this.profile.send,group=this.options.mode==='group'
    const interval=group&&p.easySymBomb?Math.min(p.sendInterval,Math.max(1,p.bombRoundIntervalMs)):p.sendInterval
    const maxCycles=Math.trunc(this.timeoutMs/interval),limiter=new PpsLimiter(this.profile.sym.maxPps)
    for(let cycle=0;cycle<maxCycles&&this.active;cycle++){
      if(!this.remote){await this.sleep(interval);continue}
      if(group){
        if(this.sockets.length>1&&!this.options.skipFirewall&&cycle>=this.profile.firewallDetectCycles&&!this.stats.socketsReceivedPunch){this.fail(true);return}
        if(p.hardSymSpray){await this.spray(cycle+1,limiter);continue}
        if(p.easySymBomb){
          for(const socket of this.sockets)for(let off=-p.bombWindow;off<=p.bombWindow&&this.active;off++)await this.send(socket,Math.max(1,Math.min(65535,this.remote.port+off)),limiter)
        }else{
          const spread=this.options.sweepSpread??0
          for(let i=0;i<this.sockets.length&&this.active;i++){
            const port=this.remote.port+(spread>0?i%(spread*2+1)-spread:0)
            for(let r=0;r<3&&this.active;r++)await this.send(this.sockets[i],port) // UdpHolePuncher.java: classic group 3 packets/socket
          }
        }
        await this.sleep(p.easySymBomb&&performance.now()-this.startedAt<p.bombDurationMs?p.bombRoundIntervalMs:p.sendInterval)
      }else if(this.options.mode==='ports'){
        for(const port of this.ports){if(!this.active)break;await this.send(this.conn,port)}await this.sleep(p.sendInterval)
      }else{
        const range=this.options.range??0
        if(range>0){
          const progressive=this.profile.progressiveRanges[Math.min(Math.trunc(cycle/this.profile.cyclesPerRange),this.profile.progressiveRanges.length-1)]
          const currentRange=this.options.fixedRange?range:Math.min(range||p.portRange,progressive)
          const ports=controlPorts(this.remote.port,currentRange,s.sweepWindowSize,this.options.random)
          for(let pass=0;pass<(p.sendMinRounds||s.minRounds)&&this.active;pass++){
            for(let i=0;i<ports.length&&this.active;i++){
              for(let r=0;r<(p.sendMinPass||s.minPass)&&this.active;r++)await this.send(this.conn,ports[i])
              if(i<ports.length-1)await this.sleep(s.sleepShortMs)
            }
            if(pass<2)await this.sleep(s.sleepLongMs) // UdpHolePuncher.java: roundPass < 2
          }
        }else await this.send(this.conn,this.remote.port)
        await this.sleep(p.sendInterval)
      }
    }
    this.fail()
  }
  start():void{
    if(this.active||this.settled)return
    this.active=true;this.startedAt=performance.now()
    for(const socket of this.sockets){const receiver=(b:Buffer,from:dgram.RemoteInfo)=>this.message(socket,b,from);this.receivers.set(socket,receiver);socket.on('message',receiver)}
    // UdpHolePuncher.java: per-attempt guard, NOT a session deadline.
    this.timeout=setTimeout(()=>this.fail(),this.timeoutMs+(this.options.mode==='ports'?this.profile.send.extraWaitLongMs:this.profile.send.extraWaitMs))
    void this.sendLoop().catch(error=>{if(!this.controller.signal.aborted){this.settled=true;this.cleanup();this.reject(error)}})
  }
  wait():Promise<Address>{return this.result}
  private cleanup():void{this.active=false;clearTimeout(this.timeout);this.controller.abort();for(const[socket,receiver]of this.receivers)socket.off('message',receiver);this.receivers.clear()}
  stop():void{this.cleanup();if(!this.settled){this.settled=true;this.reject(new Error('打洞已取消'))}}
}
export async function punchListen(preferredPort:number):Promise<dgram.Socket>{
  async function bind(port:number):Promise<dgram.Socket>{
    const socket=dgram.createSocket('udp4')
    try{await new Promise<void>((resolve,reject)=>{socket.once('error',reject);socket.bind(port,()=>{socket.off('error',reject);resolve()})});socket.on('error',()=>{});return socket}
    catch(e){try{socket.close()}catch{}throw e}
  }
  if(Number.isInteger(preferredPort)&&preferredPort>0&&preferredPort<=65535)try{return await bind(preferredPort)}catch{}
  return bind(0)
}
