// SPDX-License-Identifier: LGPL-3.0-only
// Protocol source: SignalingWsTransport.java / RoomManager.java, VoxLink c475faa9.
import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import { ApiClient, APIError } from './api'
export interface SessionOptions { code: string; token: string; isHost: boolean }
export interface SignalMsg { id?: unknown; from: string; type: string; data: Record<string,unknown>; timestamp: number; to?: string }
export interface SessionState extends SessionOptions { state: 'idle' | 'hosting' | 'in_room' | 'closed'; room: Record<string,unknown> | null }
export type LogFn = (level: 'info'|'warn'|'error', message: string) => void
export type EmitFn = (event: string, data: unknown) => void
export interface WsFrame { id: number; success: boolean; data?: unknown; error?: string; message?: string }
export class VoxlinkSession extends EventEmitter {
  readonly code: string; readonly token: string; readonly isHost: boolean
  private finished = false
  private running = false
  private degraded = false
  private finish!: () => void
  private done = new Promise<void>(resolve => { this.finish = resolve })
  private since = Date.now()
  private socket?: WebSocket
  private reconnectAt = 0
  private nextId = 1
  private connecting?: Promise<void>
  private backoff = 0
  private lastFrame = Date.now()
  private retryTimer?: NodeJS.Timeout
  private pingTimer?: NodeJS.Timeout
  private watchdog?: NodeJS.Timeout
  private controller = new AbortController()
  private seen = new Set<string>()
  private pending = new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>()
  constructor(readonly app: { api: ApiClient; baseURL: () => string; emit: EmitFn; netLog: LogFn }, options: SessionOptions, private createSocket: (url: URL) => WebSocket = url => new WebSocket(url, { handshakeTimeout: 3000, maxPayload: 4 << 20 })) { super(); this.code=options.code;this.token=options.token;this.isHost=options.isHost }
  isDone(): boolean { return this.finished }
  getDone(): Promise<void> { return this.done }
  snapshotRoom(): Record<string,unknown> | null { return null }
  stop(): void { if(this.finished)return; this.finished=true; this.controller.abort(); clearTimeout(this.retryTimer); clearInterval(this.pingTimer); clearInterval(this.watchdog); this.socket?.terminate(); for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('会话已取消'))}this.pending.clear();this.finish() }
  fatal(message: string): void { if(this.finished)return;this.stop();this.app.emit('session:state',{state:'closed',message});this.emit('closed',message) }
  private payload(extra: Record<string,unknown>) { return {code:this.code,token:this.token,isHost:this.isHost,...extra} }
  private signals(value: unknown): void {
    if(this.finished || !value || typeof value!=='object')return
    const data=value as {s?:SignalMsg[];ts?:number}
    for(const signal of Array.isArray(data.s) ? data.s : []) {
      if(typeof signal?.type!=='string' || !signal.data || typeof signal.data!=='object') continue
      const key=signal.id != null ? String(signal.id) : `${signal.from}|${signal.type}|${signal.timestamp}|${JSON.stringify(signal.data)}`
      if(this.seen.has(key))continue
      this.seen.add(key);if(this.seen.size>2048)this.seen.delete(this.seen.values().next().value!)
      this.emit('engineSignal',signal)
    }
    if(Number.isFinite(data.ts))this.since=Math.max(this.since,data.ts!)
  }
  private async connect(): Promise<void> {
    if(this.finished || this.socket?.readyState===WebSocket.OPEN || Date.now()<this.reconnectAt)return
    if(this.connecting)return this.connecting
    this.connecting=new Promise<void>(resolve=>{
      const url=new URL(this.app.baseURL());url.protocol=url.protocol==='https:'?'wss:':'ws:';url.pathname='/ws';url.search=''
      const socket=this.socket=this.createSocket(url)
      let opened=false,ended=false
      const finish=()=>{clearTimeout(timer);resolve()}
      const disconnected=(unavailable=!opened)=>{
        if(ended)return;ended=true;finish()
        if(this.socket!==socket)return
        this.socket=undefined
        clearInterval(this.pingTimer); clearInterval(this.watchdog)
        for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('信令连接已断开'))}this.pending.clear()
        if(this.finished)return
        const wait=unavailable?[10000,30000,60000][Math.min(this.backoff++,2)]:0
        this.reconnectAt=Date.now()+wait
        clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>{void this.connect()},wait)
      }
      const timer=setTimeout(()=>{disconnected(true);socket.terminate()},3000)
      socket.on('open',()=>{
        if(this.finished || ended){socket.terminate();return}
        opened=true;this.lastFrame=Date.now();this.backoff=0;this.reconnectAt=0;finish()
        this.pingTimer=setInterval(()=>{if(this.socket===socket && socket.readyState===WebSocket.OPEN){try{socket.ping(undefined,undefined,error=>{if(error){disconnected(true);socket.terminate()}})}catch{disconnected(true);socket.terminate()}}},15000)
        this.watchdog=setInterval(()=>{if(this.socket===socket && Date.now()-this.lastFrame>35000){disconnected();socket.terminate()}},10000)
        // A fresh poll re-registers host/client identity and retrieves signals missed while offline.
        void this.request('/signal/poll',{since:this.since}).then(value=>this.signals(value)).catch(()=>{})
      })
      socket.on('error',()=>{disconnected(true);socket.terminate()})
      socket.on('close',()=>disconnected())
      const received=()=>{if(this.socket===socket)this.lastFrame=Date.now()}
      socket.on('ping',received);socket.on('pong',received)
      socket.on('message',data=>{
        if(this.finished || this.socket!==socket)return
        this.lastFrame=Date.now()
        try{if(Buffer.byteLength(String(data))>4*1024*1024){socket.terminate();return}
          const frame=JSON.parse(String(data)) as WsFrame
          if(frame.id===0){this.signals(frame.data);return}
          const item=this.pending.get(frame.id);if(!item)return
          this.pending.delete(frame.id);clearTimeout(item.timer)
          if(frame.success)item.resolve(frame.data);else item.reject(new APIError(frame.error??'SIGNAL',frame.message??'请求失败'))
        }catch{}
      })
    }).finally(()=>{this.connecting=undefined})
    return this.connecting
  }
  async request(route: string, extra: Record<string,unknown>): Promise<unknown> {
    if(this.finished)throw new Error('会话已取消')
    if(this.socket?.readyState===WebSocket.OPEN && Date.now()-this.lastFrame>35000)this.socket.terminate()
    await this.connect();if(this.finished)throw new Error('会话已取消');const body=this.payload(extra)
    if(this.socket?.readyState===WebSocket.OPEN) {
      try{return await new Promise<unknown>((resolve,reject)=>{const id=this.nextId++;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('信令响应超时'))},6000);this.pending.set(id,{resolve,reject,timer});this.socket!.send(JSON.stringify({id,route,method:'POST',body}))})}
      catch(error){if(this.finished)throw error;if(error instanceof APIError)throw error;this.socket?.emit('error',error);this.socket?.terminate()}
    }
    return this.app.api.do(this.app.baseURL(),'POST',route,{},body,this.controller.signal)
  }
  private async wait(ms: number): Promise<void> { let timer:NodeJS.Timeout|undefined;await Promise.race([this.done,new Promise<void>(resolve=>{timer=setTimeout(resolve,ms)})]);clearTimeout(timer) }
  private async loop(heartbeat:boolean):Promise<void> {
    let failures=0,sequence=0,delay=heartbeat?5000:1000
    while(!this.finished){if(!heartbeat&&this.degraded){await this.wait(1000);continue}try{const result=await this.request(heartbeat?'/room/heartbeat':'/signal/poll',heartbeat?{seq:++sequence,currentInterval:delay/1000,natType:'unknown',load:0,peerLatency:{}}:{since:this.since});if(this.finished)return;failures=0;if(heartbeat){if(this.degraded){this.degraded=false;this.app.emit('signaling:recovered',{})}const info=result as {heartbeatInterval?:number};delay=info?.heartbeatInterval?Math.min(30000,Math.max(1000,info.heartbeatInterval*1000)):5000;this.emit('roomInfo',result)}else this.signals(result)}catch(error){if(this.finished)return;const e=error as APIError;this.app.netLog('warn',e.message);if(['ROOM_NOT_FOUND','ROOM_EXPIRED','ROOM_CLOSED','ROOM_EVICTED','INVALID_TOKEN'].includes(e.code)||e.status===410){this.fatal(e.message);return}if(heartbeat&&++failures>=8){delay=30000;if(!this.degraded){this.degraded=true;this.app.emit('signaling:degraded',{message:'信令暂时不可用，已降低心跳频率；游戏通路保持运行'})}}}await this.wait(delay)}
  }
  async run():Promise<void>{if(this.running)return this.done;this.running=true;await Promise.all([this.loop(true),this.loop(false)])}
}
