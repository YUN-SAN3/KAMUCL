// SPDX-License-Identifier: LGPL-3.0-only
// ConnectionManager.java TURN host/guest lifecycle, VoxLink c475faa98cca16d4a2eeef4422c862c36091e1fc.
import { ApiClient } from './api'
import { TurnSession, probeTurnNodes, validTurnEndpoint, type TurnAllocation, type TurnNode } from './turn'
import { derivePunchKey } from './punchAuth'
import { RudpConn } from './rudp'
import { TcpBridge, startHostLazyBridge } from './bridge'
import { StdTurnSession, fetchTurnCredential } from './stdTurn'
import { TurnBackground } from './turnBackground'
import type { RudpTarget } from './rudp'
import type { PunchProfile } from './punchProfiles'
import type { PunchParams } from './punchPolicy'

interface RoomRef { code:string; token:string; clientId:string; isHost:boolean; hostPort:number; hostAuth:boolean; hostStdTurn?:boolean }
interface RelayLink { auth?:Buffer|null;controller:AbortController; session?:TurnSession; std?:StdTurnSession; rudp?:RudpConn; bridge?:TcpBridge; ready?:(data:Record<string,unknown>)=>void; nack?:(reason:string)=>void; allocation?:TurnAllocation; room:RoomRef; resend?:NodeJS.Timeout; deadline?:NodeJS.Timeout; timedOut?:boolean; readyData?:Record<string,unknown>; background?:TurnBackground; address?:string }
export interface TurnRelayDeps {
  api:ApiClient; baseURL:()=>string; room:()=>RoomRef|null
  directConnected:(peer?:string)=>boolean
  connected:(peer:string, address:string,mode?:'p2p'|'prelay')=>void
  disconnected?:(peer:string)=>void
  stage:(status:'active'|'ok'|'fail', detail:string)=>void
  state:(status:'trying'|'success'|'failed', address:string, detail:string)=>void
  signal:(type:string,data:Record<string,unknown>,to:string)=>Promise<void>
  log:(level:'info'|'warn'|'error',text:string)=>void
  mapping?:(peer:string)=>{local:RudpTarget;remote:RudpTarget}|undefined
  template?:(peer:string)=>{profile:PunchProfile;params?:PunchParams}
}
/** Captures room credentials per operation; late HTTP/UDP replies cannot revive a departed room. */
export class TurnRelay {
  private guest:RelayLink|null=null
  private hosts=new Map<string,RelayLink>()
  constructor(private deps:TurnRelayDeps) {}
  busy():boolean{return !!this.guest}
  hasPeer(peer:string):boolean{return this.hosts.has(peer)}
  peerAuth(peer:string):boolean{return !!this.hosts.get(peer)?.auth}
  private current(link:RelayLink):boolean { const room=this.deps.room(); return !link.controller.signal.aborted && !!room && room.code===link.room.code && room.token===link.room.token }
  private valid(link:RelayLink) { if(!this.current(link))throw new Error('房间已退出') }
  private release(link:RelayLink) {
    if(!link.allocation)return
    const sessionId=link.allocation.sessionId;link.allocation=undefined
    void this.deps.api.post(this.deps.baseURL(),'/relay/release',{roomCode:link.room.code,clientId:link.room.clientId,token:link.room.token,sessionId},null).catch(()=>{})
  }
  private close(link:RelayLink) {
    // Remove ownership before callbacks, preventing recursive teardown.
    if(this.guest===link){this.guest=null;this.deps.disconnected?.('host')}
    for(const [peer,owned] of this.hosts)if(owned===link){this.hosts.delete(peer);this.deps.disconnected?.(peer)}
    const bridge=link.bridge, rudp=link.rudp, session=link.session, std=link.std
    link.bridge=undefined;link.rudp=undefined;link.session=undefined
    link.background?.stop();link.background=undefined;clearTimeout(link.deadline);clearTimeout(link.resend);link.std=undefined;std?.close();session?.close();link.controller.abort();bridge?.stop();rudp?.close();this.release(link)
  }
  stop() { if(this.guest)this.close(this.guest);for(const link of [...this.hosts.values()])this.close(link) }
  peerLeft(peer:string) { const link=peer==='host'?this.guest:this.hosts.get(peer);if(link)this.close(link) }
  async startGuest():Promise<void> {
    const room=this.deps.room()
    if(!room || room.isHost)throw new Error('请先加入房间后使用 TURN 中继')
    if(this.guest || this.deps.directConnected())return
    const link:RelayLink={controller:new AbortController(),room};this.guest=link
    link.deadline=setTimeout(()=>{link.timedOut=true;link.controller.abort()},35000)
    const signal=link.controller.signal
    this.deps.stage('active','TURN：正在获取节点并测试延迟…');this.deps.state('trying','','正在建立 TURN 中继')
    try {
      const status=await this.deps.api.get(this.deps.baseURL(),'/relay/status',{}, {},signal) as {enabled?:boolean}
      this.valid(link);if(status.enabled===false)throw new Error('服务器暂未启用 TURN 中继')
      const raw=await this.deps.api.get(this.deps.baseURL(),'/relay/list',{}, {},signal) as {nodes?:TurnNode[]}
      this.valid(link)
      const nodes=(raw.nodes||[]).filter(n=>n.id!=null&&validTurnEndpoint(n.host,n.port)).map(n=>({...n,id:String(n.id)}))
      if(!nodes.length)throw new Error('当前没有可用的 TURN 节点')
      const sorted=await probeTurnNodes(nodes,signal);this.valid(link)
      if(this.deps.directConnected()){this.close(link);return}
      const node=sorted[0];let allocationData:Record<string,unknown>
      if(Number(node.stdTurnPort)>0&&room.hostStdTurn){
        const cred=await fetchTurnCredential(this.deps.api,this.deps.baseURL(),room,node.id,signal);this.valid(link)
        if(this.deps.directConnected()){this.close(link);return}
        link.std=await StdTurnSession.allocate(cred,signal);this.valid(link);link.std.startKeepalive()
        allocationData={stdTurn:true,nodeId:node.id,nodeHost:node.host,stdTurnPort:node.stdTurnPort,relayHost:link.std.relay.address,relayPort:link.std.relay.port,clientId:room.clientId,punchAuth:room.hostAuth}
      }else{
        const allocation=await this.deps.api.post(this.deps.baseURL(),'/relay/allocate',{roomCode:room.code,clientId:room.clientId,token:room.token,nodeId:node.id},{},signal) as TurnAllocation
        link.allocation=allocation;this.valid(link)
        if(this.deps.directConnected()){this.close(link);return}
        this.deps.stage('active','TURN：节点已分配，正在绑定中继通路…')
        link.session=await TurnSession.bind({...allocation,ticket:allocation.guestTicket},2,signal);this.valid(link)
        allocationData={sessionId:allocation.sessionId,host:allocation.host,port:allocation.port,ticket:allocation.hostTicket,expire:allocation.expire,clientId:room.clientId,punchAuth:room.hostAuth}
      }
      const ready=new Promise<Record<string,unknown>>((resolve,reject)=>{
        const timer=setTimeout(()=>{cleanup();reject(new Error('房主 20 秒内未确认 TURN，请确认对方使用支持中继的版本'))},20_000)
        const abort=()=>{cleanup();reject(new Error('房间已退出'))}
        const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);link.ready=undefined;link.nack=undefined}
        link.ready=data=>{cleanup();resolve(data)};link.nack=reason=>{cleanup();reject(new Error('房主拒绝 TURN：'+reason))};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()
      })
      // Install the ready listener before sending; HTTP and pushed signals may arrive in either order.
      const [readyData]=await Promise.all([ready,this.deps.signal('turn_alloc',allocationData,'host').then(()=>clearTimeout(link.deadline))])
      this.valid(link)
      if(this.deps.directConnected()){this.close(link);return}
      if(link.std){if(readyData.stdTurn!==true)throw Error('房主返回了不匹配的 TURN 协议');await link.std.bind({address:String(readyData.relayHost??''),port:Number(readyData.relayPort)},signal);this.valid(link)}
      const transport=link.std??link.session!
      link.auth=room.hostAuth?derivePunchKey(room.code,room.clientId):null
      const rc=new RudpConn(transport.socket,transport.target,{codec:transport.codec,authKey:link.auth,ownsSocket:false,allowTurnAuthDowngrade:true});link.rudp=rc
      rc.start()
      const {addr,bridge}=await TcpBridge.startGuest(rc,()=>this.lost(link));link.bridge=bridge;link.address=addr
      this.valid(link)
      if(this.deps.directConnected()){this.close(link);return}
      rc.once('closed',()=>this.lost(link))
      this.deps.connected('host',addr)
      this.background(link,'host')
      this.deps.stage('ok','TURN 中继已建立');this.deps.state('success',addr,'通过 TURN 中继连接，本地地址 '+addr)
    } catch(e) {
      const roomNow=this.deps.room(),active=this.current(link)||(link.timedOut&&this.guest===link&&roomNow?.code===link.room.code&&roomNow?.token===link.room.token);this.close(link)
      if(active) {const message=link.timedOut?'TURN 分配超过 35 秒，请重试':(e as Error).message;this.deps.stage('fail',message);this.deps.state('failed','',message);throw new Error(message)}
    }
  }
  private lost(link:RelayLink) {
    if(!this.current(link))return
    const standby=link.background?.takeStandby()
    this.close(link);this.deps.stage('fail','TURN 中继已断开，可重新连接');this.deps.state('failed','','TURN 中继已断开')
    if(standby&&!link.room.isHost){void(async()=>{try{
      const next:RelayLink={controller:new AbortController(),room:link.room,rudp:standby};this.guest=next
      const {addr,bridge}=await TcpBridge.startGuest(standby,()=>this.close(next));next.bridge=bridge;this.valid(next)
      this.deps.connected('host',addr,'prelay')
    }catch{standby.close()}})()}
  }
  private background(link:RelayLink,peer:string){
    if(!link.rudp||!this.deps.mapping||!this.deps.template)return
    link.background=new TurnBackground({valid:()=>this.current(link),host:link.room.isHost,peer,transport:link.rudp,
      mapping:()=>this.deps.mapping!(peer),template:()=>this.deps.template!(peer),auth:link.auth??null,
      signal:this.deps.signal,promoted:()=>{this.deps.connected(peer,link.address??'','p2p')},
      release:()=>{link.std?.close();link.std=undefined;link.session?.close();link.session=undefined;this.release(link)},log:message=>this.deps.log('info',message)})
  }
  async onSignal(type:string,from:string,data:Record<string,unknown>) {
    if(type==='turn_bg_punch'){const link=from==='host'?this.guest:this.hosts.get(from);if(link?.background&&validTurnEndpoint(data.ip,Number(data.port)))await link.background.direct({address:String(data.ip),port:Number(data.port)});return}
    if(type==='relay_notify'){if(from==='host'&&this.guest?.background&&validTurnEndpoint(data.relayIp,Number(data.relayPort)))await this.guest.background.establishStandby({address:String(data.relayIp),port:Number(data.relayPort)});return}
    if(type==='turn_ready') { if(from==='host'&&this.guest&&this.current(this.guest))this.guest.ready?.(data);return }
    if(type==='turn_nack'){if(from==='host'&&this.guest&&this.current(this.guest)&&!this.guest.rudp?.isConnected())this.guest.nack?.(String(data.reason??'unknown'));return}
    if(type!=='turn_alloc')return
    const room=this.deps.room()
    if(!room?.isHost || !from || from==='host')return
    if(this.deps.directConnected(from)){await this.deps.signal('turn_nack',{reason:'direct_won'},from).catch(()=>{});return}
    if(this.hosts.has(from)) {
      const existing=this.hosts.get(from)!
      if(existing.rudp&&existing.readyData)await this.deps.signal('turn_ready',existing.readyData,from).catch(()=>{})
      return
    }
    const link:RelayLink={controller:new AbortController(),room};this.hosts.set(from,link)
    try {
      // Validate against the server's published nodes before a peer-provided endpoint receives a ticket.
      const raw=await this.deps.api.get(this.deps.baseURL(),'/relay/list',{}, {},link.controller.signal) as {nodes?:TurnNode[]};this.valid(link)
      if(data.stdTurn===true){
        if(!raw.nodes?.some(n=>String(n.id)===data.nodeId&&n.host===data.nodeHost&&Number(n.stdTurnPort)>0&&n.stdTurnPort===data.stdTurnPort))throw new Error('bad_alloc')
        let cred;try{cred=await fetchTurnCredential(this.deps.api,this.deps.baseURL(),room,String(data.nodeId),link.controller.signal)}catch{throw Error('std_cred_failed')}
        this.valid(link);try{link.std=await StdTurnSession.allocate(cred,link.controller.signal)}catch{throw Error('std_alloc_failed')}
        this.valid(link);try{await link.std.bind({address:String(data.relayHost??''),port:Number(data.relayPort)},link.controller.signal)}catch{throw Error('std_bind_failed')}
        this.valid(link);link.std.startKeepalive()
        link.readyData={stdTurn:true,relayHost:link.std.relay.address,relayPort:link.std.relay.port,clientId:room.clientId}
      }else{
        if(!raw.nodes?.some(n=>n.host===data.host && n.port===data.port))throw new Error('bad_alloc')
        link.session=await TurnSession.bind(data as unknown as {sessionId:string;host:string;port:number;ticket:string},1,link.controller.signal);this.valid(link)
        link.readyData={sessionId:data.sessionId,clientId:room.clientId}
      }
      if(this.deps.directConnected(from)){this.close(link);return}
      // Upstream sends the current authoritative clientId explicitly after reconnects.
      const auth=data.punchAuth===true?derivePunchKey(room.code,typeof data.clientId==='string'?data.clientId:from):null
      const transport=link.std??link.session!
      link.auth=auth
      const rc=new RudpConn(transport.socket,transport.target,{codec:transport.codec,authKey:auth,ownsSocket:false,allowTurnAuthDowngrade:true});link.rudp=rc;rc.start()
      rc.once('closed',()=>this.close(link))
      this.deps.connected(from,'')
      this.background(link,from)
      void startHostLazyBridge(rc,room.hostPort,this.deps.log)
      await this.deps.signal('turn_ready',link.readyData!,from).catch(()=>{});this.valid(link)
      link.resend=setTimeout(()=>{if(this.current(link)&&this.hosts.get(from)===link)void this.deps.signal('turn_ready',link.readyData!,from).catch(()=>{})},4000)
      this.deps.stage('ok','房客 TURN 通路已建立，等待游戏连接')
    } catch(e) {const active=this.current(link);this.close(link);if(active){const reason=(e as Error).message;await this.deps.signal('turn_nack',{reason:['bad_alloc','std_cred_failed','std_alloc_failed','std_bind_failed'].includes(reason)?reason:'bind_failed'},from).catch(()=>{});this.deps.log('warn','房客 TURN 建立失败：'+reason)}}
  }
}
