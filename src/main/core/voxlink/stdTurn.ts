// SPDX-License-Identifier: LGPL-3.0-only
// Adapted from StdTurnClient.java, AUGUHDAR/VoxLink c475faa98cca16d4a2eeef4422c862c36091e1fc.
import dgram from 'node:dgram'
import dns from 'node:dns/promises'
import net from 'node:net'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import type { ApiClient } from './api'
import { validTurnEndpoint } from './turn'
import type { RudpCodec, RudpTarget } from './rudp'

export const TURN_COOKIE=0x2112a442, TURN_CHANNEL=0x4000, TURN_LIFETIME=600
export const TURN_TX_ROUNDS=4, TURN_TX_RTO=500, TURN_KEEPALIVE_MS=240000
export interface TurnCredential { host:string; port:number; username:string; password:string; expire:number }
export const TURN_ATTR={username:6,integrity:8,error:9,channel:12,lifetime:13,peer:18,realm:20,nonce:21,relay:22,transport:25,software:0x8022,fingerprint:0x8028} as const
const u32=(value:number)=>{const b=Buffer.alloc(4);b.writeUInt32BE(value>>>0);return b}
function crc32(bytes:Buffer):number {let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(crc^0xffffffff)>>>0}
function header(type:number,length:number,id:Buffer):Buffer {const b=Buffer.alloc(20);b.writeUInt16BE(type);b.writeUInt16BE(length,2);b.writeUInt32BE(TURN_COOKIE,4);id.copy(b,8);return b}
export class TurnMessage {
  readonly id:Buffer
  private attrs:Buffer[]=[]
  constructor(readonly type:number,id=randomBytes(12)){if(id.length!==12)throw Error('STUN transaction id');this.id=id}
  put(type:number,value:Buffer|string):this {const data=typeof value==='string'?Buffer.from(value):value;const b=Buffer.alloc(4+((data.length+3)&~3));b.writeUInt16BE(type);b.writeUInt16BE(data.length,2);data.copy(b,4);this.attrs.push(b);return this}
  number(type:number,value:number):this{return this.put(type,u32(value))}
  address(type:number,target:RudpTarget):this{return this.put(type,encodeXorAddress(target,this.id))}
  build(key?:Buffer):Buffer {
    const attrs=Buffer.concat(this.attrs)
    if(!key)return Buffer.concat([header(this.type,attrs.length,this.id),attrs])
    const mi=createHmac('sha1',key).update(header(this.type,attrs.length+24,this.id)).update(attrs).digest()
    const integrity=Buffer.alloc(24);integrity.writeUInt16BE(8);integrity.writeUInt16BE(20,2);mi.copy(integrity,4)
    const prefix=Buffer.concat([header(this.type,attrs.length+32,this.id),attrs,integrity])
    const fp=Buffer.alloc(8);fp.writeUInt16BE(0x8028);fp.writeUInt16BE(4,2);fp.writeUInt32BE((crc32(prefix)^0x5354554e)>>>0,4)
    return Buffer.concat([prefix,fp])
  }
}
export interface ParsedTurnMessage {type:number;id:Buffer;attrs:Map<number,Buffer>;errorCode:number}
export function parseTurnMessage(b:Buffer):ParsedTurnMessage|null {
  if(b.length<20||(b[0]&0xc0)!==0||b.readUInt32BE(4)!==TURN_COOKIE)return null
  const end=20+b.readUInt16BE(2);if(end>b.length || (end-20)%4)return null
  const attrs=new Map<number,Buffer>();let off=20,count=0
  while(off<end){if(off+4>end||++count>64)return null;const type=b.readUInt16BE(off),length=b.readUInt16BE(off+2);off+=4;if(off+length>end)return null;attrs.set(type,b.subarray(off,off+length));off+=(length+3)&~3}
  const error=attrs.get(9)
  return {type:b.readUInt16BE(0),id:b.subarray(8,20),attrs,errorCode:error&&error.length>=4?(error[2]&7)*100+error[3]:0}
}
function ipBytes(address:string):Buffer {
  if(net.isIPv4(address))return Buffer.from(address.split('.').map(Number))
  if(!net.isIPv6(address))throw Error('无效的 TURN 地址')
  let value=address.split('%')[0]
  if(value.includes('.')){const last=value.slice(value.lastIndexOf(':')+1),b=ipBytes(last);value=value.slice(0,value.lastIndexOf(':')+1)+b.readUInt16BE(0).toString(16)+':'+b.readUInt16BE(2).toString(16)}
  const [left,right]=value.split('::'),a=left?left.split(':'):[],z=right?right.split(':'):[]
  const parts=right!==undefined?[...a,...Array(8-a.length-z.length).fill('0'),...z]:a
  const b=Buffer.alloc(16);parts.forEach((p,i)=>b.writeUInt16BE(parseInt(p,16),i*2));return b
}
export function encodeXorAddress(target:RudpTarget,id:Buffer):Buffer {
  const ip=ipBytes(target.address),b=Buffer.alloc(4+ip.length),mask=Buffer.concat([u32(TURN_COOKIE),id]);b[1]=ip.length===4?1:2;b.writeUInt16BE(target.port^(TURN_COOKIE>>>16),2)
  for(let i=0;i<ip.length;i++)b[4+i]=ip[i]^mask[i];return b
}
export function decodeXorAddress(b:Buffer|undefined,id:Buffer):RudpTarget|null {
  if(!b||b[0]!==0||!((b[1]===1&&b.length>=8)||(b[1]===2&&b.length>=20)))return null
  const bytes=Buffer.alloc(b[1]===1?4:16),mask=Buffer.concat([u32(TURN_COOKIE),id]);for(let i=0;i<bytes.length;i++)bytes[i]=b[4+i]^mask[i]
  return {address:bytes.length===4?[...bytes].join('.'):Array.from({length:8},(_,i)=>bytes.readUInt16BE(i*2).toString(16)).join(':'),port:b.readUInt16BE(2)^(TURN_COOKIE>>>16)}
}
export const turnLongTermKey=(username:string,realm:string,password:string)=>createHash('md5').update(`${username}:${realm}:${password}`).digest()
export class StdTurnCodec implements RudpCodec {
  constructor(readonly channel=TURN_CHANNEL){}
  encode(frame:Buffer):Buffer{const out=Buffer.alloc(4+frame.length);out.writeUInt16BE(this.channel);out.writeUInt16BE(frame.length,2);frame.copy(out,4);return out}
  decode(packet:Buffer):Buffer|null{if(packet.length<4||packet.readUInt16BE(0)!==this.channel||this.channel<0x4000||this.channel>0x7fff)return null;const length=packet.readUInt16BE(2);return length+4<=packet.length?packet.subarray(4,4+length):null}
}
export async function fetchTurnCredential(api:ApiClient,base:string,room:{code:string;clientId:string;token:string},nodeId:string,signal:AbortSignal):Promise<TurnCredential>{
  const data=await api.do(base,'POST','/relay/stdturn/cred',{}, {roomCode:room.code,clientId:room.clientId,token:room.token,nodeId},AbortSignal.any([signal,AbortSignal.timeout(5000)])) as TurnCredential
  signal.throwIfAborted()
  if(!data||!validTurnEndpoint(data.host,data.port)||typeof data.username!=='string'||!data.username||typeof data.password!=='string'||!data.password)throw Error('标准 TURN 凭证不完整')
  return data
}
/** The transaction listener is detached before handing the socket to RUDP. */
export class StdTurnSession {
  readonly codec=new StdTurnCodec()
  private key?:Buffer;private realm='';private nonce='';private ended=false
  private peer?:RudpTarget;private keepalive?:NodeJS.Timeout
  relay!:RudpTarget;lifetime=TURN_LIFETIME
  private constructor(readonly socket:dgram.Socket,readonly target:RudpTarget,private username:string){}
  private auth(type:number):TurnMessage{return new TurnMessage(type).put(6,this.username).put(20,this.realm).put(21,this.nonce)}
  private transact(req:TurnMessage,budget:number,signal:AbortSignal):Promise<ParsedTurnMessage> {
    const packet=req.build(this.key),deadline=Date.now()+budget
    return new Promise((resolve,reject)=>{
      let timer:NodeJS.Timeout,round=0,settled=false,rto=TURN_TX_RTO
      const done=(error?:Error,result?:ParsedTurnMessage)=>{if(settled)return;settled=true;clearTimeout(timer);this.socket.off('message',receive);this.socket.off('close',closed);signal.removeEventListener('abort',abort);error?reject(error):resolve(result!)}
      const abort=()=>done(Error('标准 TURN 操作已取消')),closed=()=>done(Error('标准 TURN 连接已关闭'))
      const receive=(b:Buffer,from:dgram.RemoteInfo)=>{if(from.address!==this.target.address||from.port!==this.target.port)return;const m=parseTurnMessage(b);if(m?.id.equals(req.id))done(undefined,m)}
      const send=()=>{
        if(this.ended||signal.aborted){abort();return}
        if(round++>=TURN_TX_ROUNDS||Date.now()>=deadline){done(Error('标准 TURN 节点响应超时'));return}
        try{this.socket.send(packet,this.target.port,this.target.address,error=>{if(error)done(Error('标准 TURN 发送失败'))})}catch{closed();return}
        // Java's socket receive timeout is 200ms; it exits that receive round on silence.
        timer=setTimeout(send,Math.min(rto,200,Math.max(1,deadline-Date.now())));rto*=3
      }
      this.socket.on('message',receive);this.socket.once('close',closed);signal.addEventListener('abort',abort,{once:true});send()
    })
  }
  static async allocate(cred:TurnCredential,signal:AbortSignal,timeout=8000):Promise<StdTurnSession>{
    const ip=await dns.lookup(cred.host);signal.throwIfAborted()
    const socket=dgram.createSocket(ip.family===6?'udp6':'udp4');socket.on('error',()=>{})
    const session=new StdTurnSession(socket,{address:ip.address,port:cred.port},cred.username)
    const abort=()=>session.close();signal.addEventListener('abort',abort,{once:true});socket.once('close',()=>signal.removeEventListener('abort',abort))
    try{
      await new Promise<void>((resolve,reject)=>{socket.once('close',()=>reject(Error('标准 TURN 已取消')));socket.bind(0,resolve)});signal.throwIfAborted()
      let challenge:ParsedTurnMessage|undefined
      for(let i=0;i<3&&!challenge;i++)try{challenge=await session.transact(new TurnMessage(3).number(25,17<<24).put(0x8022,'voxlink'),Math.min(timeout,3000),signal)}catch{signal.throwIfAborted()}
      if(!challenge||challenge.type!==0x113||challenge.errorCode!==401||!challenge.attrs.has(20)||!challenge.attrs.has(21))throw Error('标准 TURN 未返回有效鉴权挑战')
      session.realm=challenge.attrs.get(20)!.toString();session.nonce=challenge.attrs.get(21)!.toString();session.key=turnLongTermKey(cred.username,session.realm,cred.password)
      const reply=await session.transact(new TurnMessage(3).number(25,17<<24).put(6,cred.username).put(20,session.realm).put(21,session.nonce).put(0x8022,'voxlink'),timeout,signal)
      const relay=decodeXorAddress(reply.attrs.get(22),reply.id)
      if(reply.type!==0x103||!relay||!relay.port)throw Error('标准 TURN 分配失败'+(reply.errorCode?` (${reply.errorCode})`:''))
      session.relay=relay;const life=reply.attrs.get(13);if(life?.length===4)session.lifetime=life.readUInt32BE(0)
      signal.throwIfAborted();return session
    }catch(error){session.close();throw error}
  }
  async bind(peer:RudpTarget,signal:AbortSignal,timeout=8000):Promise<void>{
    if(!net.isIP(peer.address)||!validTurnEndpoint(peer.address,peer.port))throw Error('对端 TURN 地址无效')
    const permission=await this.transact(this.auth(8).address(18,{...peer,port:0}),timeout,signal)
    if(permission.type!==0x108)throw Error('标准 TURN 权限建立失败')
    const reply=await this.transact(this.auth(9).put(12,Buffer.from([0x40,0,0,0])).address(18,peer),timeout,signal)
    if(reply.type!==0x109)throw Error('标准 TURN ChannelBind 失败')
    signal.throwIfAborted();this.peer=peer
  }
  private quiet(req:TurnMessage,closing=false):void {if(this.ended&&!closing)return;try{this.socket.send(req.build(this.key),this.target.port,this.target.address,()=>{})}catch{}}
  startKeepalive():void{if(this.keepalive||this.ended)return;this.keepalive=setInterval(()=>{this.quiet(this.auth(4).number(13,TURN_LIFETIME));if(this.peer)this.quiet(this.auth(9).put(12,Buffer.from([0x40,0,0,0])).address(18,this.peer))},TURN_KEEPALIVE_MS)}
  close():void{
    if(this.ended)return;this.ended=true;clearInterval(this.keepalive)
    const close=()=>{try{this.socket.close()}catch{}}
    if(this.key){const packet=this.auth(4).number(13,0).build(this.key),timer=setTimeout(close,250);timer.unref();try{this.socket.send(packet,this.target.port,this.target.address,()=>{clearTimeout(timer);close()})}catch{clearTimeout(timer);close()}}
    else close()
    this.key=undefined
  }
}
