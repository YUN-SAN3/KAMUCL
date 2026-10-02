// SPDX-License-Identifier: LGPL-3.0-only
// ConnectionManager.java c475faa9: TURN background monitor / smooth switching / hot standby.
import type { Socket } from 'node:dgram'
import { Puncher, punchListen } from './punch'
import type { PunchProfile, SendParams } from './punchProfiles'
import type { PunchParams } from './punchPolicy'
import { RudpConn, type RudpTarget } from './rudp'
import { STUN_SERVERS, stunQuery } from './stun'
export interface BackgroundDeps {
  valid:()=>boolean;host:boolean;peer:string;transport:RudpConn
  mapping:()=>{local:RudpTarget;remote:RudpTarget}|undefined
  template:()=>{profile:PunchProfile;params?:PunchParams};auth:Buffer|null
  signal:(type:string,data:Record<string,unknown>,to:string)=>Promise<void>
  probe?:(socket:Socket,signal:AbortSignal)=>Promise<{ip:string;port:number}|null>
  promoted:()=>void;release:()=>void;log:(message:string)=>void
}
export class TurnBackground {
  private monitor?:NodeJS.Timeout;private observe?:NodeJS.Timeout;private grace?:NodeJS.Timeout
  private deadline=Date.now()+300000;private tick=0;private stopped=false;private won=false;private busy=false;private streak=0
  private punchers=new Set<Puncher>();private sockets=new Set<Socket>()
  private standby?:RudpConn;private currentPunch?:Puncher;private controller=new AbortController()
  private standbyPending?:{socket:Socket;punch?:Puncher;timer?:NodeJS.Timeout}
  constructor(private deps:BackgroundDeps){this.monitor=setInterval(()=>void this.run().catch(()=>deps.log('本次后台直连探测未命中')),30000)}
  private active(){return !this.stopped&&this.deps.valid()&&this.deps.transport.isConnected()}
  private async run(){
    if(!this.active()||Date.now()>this.deadline){clearInterval(this.monitor);return}
    if(this.standby&&!this.standby.isConnected()){this.standby.close();this.standby=undefined}
    if(++this.tick%2===1&&!this.deps.host&&!this.standby)void this.requestStandby().catch(()=>{})
    if(this.deps.host||this.won||this.busy)return
    const mapping=this.deps.mapping();if(!mapping)return
    await this.direct(mapping.remote)
  }
  async direct(target:RudpTarget){
    if(!this.active()||this.won||Date.now()>this.deadline)return
    if(this.busy){this.currentPunch?.setTarget(target);return}
    this.busy=true
    try{
      const hit=await this.punch(target,5000,this.deps.auth,true)
      if(!hit)return
      if(!this.active()||this.won){hit.socket.close();return}
      this.won=true
      if(!this.deps.transport.addSecondaryPath(hit.socket,hit.target))return
      this.sockets.delete(hit.socket)
      this.deps.log('后台直连已命中，正在观察 20 秒稳定性')
      this.observe=setInterval(()=>{
        if(!this.active()){clearInterval(this.observe);return}
        const health=this.deps.transport.secondaryHealth()
        if(health?.lastRx&&Date.now()-health.lastRx<2000)this.streak++;else this.streak=0
        if(this.streak>=20){clearInterval(this.observe);clearInterval(this.monitor);this.deps.transport.promoteSecondaryPath();this.deps.promoted();this.grace=setTimeout(()=>{if(this.active()){this.deps.transport.dropSecondaryPath();this.deps.release();this.standby?.close();this.standby=undefined}},11000)}
      },1000)
    }finally{this.busy=false}
  }
  private async punch(target:RudpTarget,timeout:number,auth:Buffer|null,coordinate=false){
    const socket=await punchListen(0);this.sockets.add(socket)
    if(!this.active()){socket.close();this.sockets.delete(socket);return null}
    const template=this.deps.template(),punch=new Puncher({conn:socket,authKey:auth,profile:template.profile,params:template.params,timeoutMs:timeout});this.punchers.add(punch);punch.setTarget(target)
    if(coordinate){
      this.currentPunch=punch
      // The initial ICE sockets have been retired. Advertise this socket's actual mapping,
      // never a stale mapping belonging to the old failed direct attempt.
      const mapped=await this.probe(socket)
      if(!this.active()){punch.stop();this.punchers.delete(punch);this.currentPunch=undefined;try{socket.close()}catch{};this.sockets.delete(socket);return null}
      if(mapped)void this.deps.signal('turn_bg_punch',{ip:mapped.ip,port:mapped.port},this.deps.host?this.deps.peer:'host').catch(()=>{})
    }
    punch.start()
    try{const target=await punch.wait();this.sockets.delete(socket);return{socket,target}}
    catch{try{socket.close()}catch{};return null}
    finally{punch.stop();if(this.currentPunch===punch)this.currentPunch=undefined;this.punchers.delete(punch);this.sockets.delete(socket)}
  }
  private probe(socket:Socket){return this.deps.probe?this.deps.probe(socket,this.controller.signal):Promise.any(STUN_SERVERS.map(async server=>{const result=await stunQuery(socket,server,1,800,this.controller.signal);if(!result)throw Error('STUN timeout');return result})).catch(()=>null)}
  private clearStandbyPending(close=true){const pending=this.standbyPending;this.standbyPending=undefined;if(!pending)return;clearTimeout(pending.timer);pending.punch?.stop();if(pending.punch)this.punchers.delete(pending.punch);this.sockets.delete(pending.socket);if(close)try{pending.socket.close()}catch{}}
  private async requestStandby(){
    if(!this.active()||this.deps.host||this.standbyPending||this.standby)return
    const socket=await punchListen(0);this.sockets.add(socket)
    if(!this.active()){socket.close();this.sockets.delete(socket);return}
    const pending=this.standbyPending={socket} as {socket:Socket;punch?:Puncher;timer?:NodeJS.Timeout}
    pending.timer=setTimeout(()=>{if(this.standbyPending===pending)this.clearStandbyPending()},10000)
    const mapped=await this.probe(socket)
    if(!this.active()||this.standbyPending!==pending)return
    await this.deps.signal('relay_request',mapped?{mappedIp:mapped.ip,mappedPort:mapped.port}:{},'host')
  }
  async establishStandby(target:RudpTarget){
    if(!this.active()||this.deps.host||this.standby)return
    const pending=this.standbyPending
    if(pending?.punch){pending.punch.setTarget(target);return}
    let hit:{socket:Socket;target:RudpTarget}|null
    if(pending){const template=this.deps.template(),punch=pending.punch=new Puncher({conn:pending.socket,authKey:this.deps.auth,profile:template.profile,params:template.params,timeoutMs:10000});this.punchers.add(punch);punch.setTarget(target);punch.start();try{hit={socket:pending.socket,target:await punch.wait()};this.clearStandbyPending(false)}catch{this.clearStandbyPending();return}}
    else hit=await this.punch(target,10000,this.deps.auth)
    if(!hit)return
    if(!this.active()||this.standby){hit.socket.close();return}
    this.standby=new RudpConn(hit.socket,hit.target);this.standby.start()
    void this.deps.signal('turn_stby',{},'host').catch(()=>{});this.deps.log('玩家中继热备已就绪')
  }
  takeStandby():RudpConn|undefined{const standby=this.standby;this.standby=undefined;return standby?.isConnected()?standby:(standby?.close(),undefined)}
  stop(){if(this.stopped)return;this.stopped=true;this.controller.abort();this.clearStandbyPending();clearInterval(this.monitor);clearInterval(this.observe);clearTimeout(this.grace);for(const punch of this.punchers)punch.stop();for(const socket of this.sockets)try{socket.close()}catch{};this.punchers.clear();this.sockets.clear();this.standby?.close();this.standby=undefined}
}
