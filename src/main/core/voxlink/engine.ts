// SPDX-License-Identifier: LGPL-3.0-only
// New KAMUCL orchestration using VoxLink Java signaling fields (ConnectionManager / SignalingClient,
// AUGUHDAR/VoxLink baseline 924845e897d8fb36dca2474ade30e675278559d0; updated contract c475faa98cca16d4a2eeef4422c862c36091e1fc).
import dgram from 'node:dgram'
import { setTimeout as delay } from 'node:timers/promises'
import net from 'node:net'
import { networkInterfaces } from 'node:os'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { ApiClient, APIError, APP_VERSION, CLIENT_TAG, DEFAULT_SERVER_URL, validateRoomCode, validateServerURL } from './api'
import { normalizeVoxlinkRoomName } from '../../../shared/voxlinkRoom'
import { NAT_RAW_LABELS,natLabel } from '../../../shared/voxlinkNat'
import { STUN_SERVERS, stunSampleSeries, samplePortsSequential, stunDeltaFromSamples, type StunMappedAddr } from './stun'
import { chooseTcpPunchPort, tcpSimOpen, bridgePunchedSocket } from './tcpPunch'
import { Puncher, PunchFailure, punchListen, type PuncherOptions } from './punch'
import { PROFILES } from './punchProfiles'
import { fromProfile, predict, deltaPredict, selectStrategy, symmetric, type NatClass } from './punchPolicy'
import { PunchRounds } from './punchRounds'
import { RudpConn } from './rudp'
import { TcpBridge, startHostLazyBridge, pumpRelay } from './bridge'
import { TurnRelay } from './turnRelay'
import { derivePunchKey } from './punchAuth'
import { VoxlinkSession } from './session'
import { detectMcPorts, probeHostPort } from './mc_ports'
import { defaultSettingsPath, loadSettings, saveSettings, type VoxlinkSettings } from './settings'
export const PHASE_P2P='p2p',PHASE_DIRECT='direct',PHASE_PRELAY='prelay',STATUS_TRYING='trying',STATUS_FAILED='failed',STATUS_SUCCESS='success'
export interface ConnState { phase:string;status:string;address:string;detail:string }
export interface RoomInfo { code:string;name:string;hostIp:string;hostPort:number;maxPlayers:number;currentPlayers:number;hasPassword:boolean;category:string;gameVersion:string;loader:string;clientType:string;clientTag?:string;expiresIn:number;isHost:boolean;hostCapabilities?:string[];natType?:string }
export interface LobbyRoom {code:string;name:string;hostIp?:string;hostPort?:number;currentPlayers?:number;maxPlayers?:number;hasPassword?:boolean;category?:string;gameVersion?:string;loader?:string;clientType?:string;clientTag?:string;natType?:string}
export interface AppState {state:'idle'|'hosting'|'in_room'|'closed';code:string;token:string;isHost:boolean;room:RoomInfo|null}
export interface CreateRoomParams {name:string;password?:string;category?:string;visible:boolean;hostPort:number;loader?:string;gameVersion?:string}
export interface JoinRoomParams {code:string;password?:string;loader?:string;gameVersion?:string}
export const VOXLINK_CAPABILITIES=['relay','ice_restart','continuous_retry','punchAuthV1','overlayAuthV1','modSyncV1','stdTurnV1'] as const
export const JOIN_RETRY_BACKOFF_MS=[1500,3000] as const // ConnectionManager.java: JOIN_RETRY_BACKOFF_MS.
export interface CreateRoomResult {code:string;hostToken:string;name:string;hostIp:string;hostPort:number;expiresIn:number}
export interface JoinRoomResult {clientToken:string;clientId:string;room:RoomInfo}
export type LogLevel='info'|'warn'|'error'
export type NetLogFn=(level:LogLevel,message:string)=>void
export type EmitFn=(event:string,data:unknown)=>void
export interface EngineDeps {api:ApiClient;baseURL:()=>string;emit:EmitFn;netLog:NetLogFn;allowRelay?:()=>boolean;rejoin?:()=>Promise<void>}
export interface RelayCandidate {clientId:string;roomCode:string;natType:string;mappedIp:string;mappedPort:number}
interface Link { socket:dgram.Socket;punch:Puncher;mapped:StunMappedAddr;delta:number;auth:Buffer|null;rudp?:RudpConn;bridge?:TcpBridge;remote?:StunMappedAddr;started?:boolean;timer?:NodeJS.Timeout; sockets:dgram.Socket[];punchers:Puncher[];samples:StunMappedAddr[];nat:NatClass;peer:string;reverse:boolean;ports:number[];controller:AbortController }
type Data=Record<string,unknown>
const endpoint=(data:Data,prefix:string):StunMappedAddr|null=>{const ip=String(data[`${prefix}Ip`]??''),port=Number(data[`${prefix}Port`]);return net.isIP(ip)&&Number.isInteger(port)&&port>0&&port<=65535?{ip,port}:null}
export class ConnEngine extends EventEmitter {
  code='';token='';isHost=false;hostPort=0;hostIp='';clientID='';session:VoxlinkSession|null=null;room:RoomInfo|null=null
  joinedAt=0;lastConnection:ConnState|null=null;stages:Record<string,{key:string;status:string;detail:string;ts:number}>={}
  readonly turn:TurnRelay
  private generation=0
  private links=new Map<string,Link>()
  private creating=new Set<string>()
  private timers=new Set<NodeJS.Timeout>()
  private relays=new Set<()=>void>()
  private relayPending=false
  private relayAssignments=new Map<string,{candidate:string;at:number}>()
  private rounds=new Map<string,PunchRounds>()
  private tcp=new Map<string,{controller:AbortController;stop?:()=>void}>()
  private tcpPeerIp=''
  private reconnectPending=false
  private mode:'p2p'|'turn'|'prelay'|'direct'='p2p'
  private winner=new Map<string,string>()
  private turnChoices=new Set<string>()
  private iceRestarts=new Map<string,{count:number;at:number}>()
  private knownPeers=new Set<string>()
  private lastMappings=new Map<string,{local:{address:string;port:number};remote:{address:string;port:number}}>()
  private natNotes=new Set<string>()
  private reportNat(local:NatClass,remote:NatClass,peer:string){
    const raw=String(this.room?.natType??'unknown').trim().toLowerCase()
    if(!Object.hasOwn(NAT_RAW_LABELS,raw)&&!this.natNotes.has(raw)){this.natNotes.add(raw);this.deps.netLog('warn','未收录的 NAT 类型，显示为未知：'+raw.slice(0,80))}
    this.deps.emit('nat:state',{local:natLabel(local,undefined),remote:natLabel(remote,raw),localClass:local,remoteClass:remote,profile:this.policy(peer).profile.name})
    const expected=raw.includes('cone')?'CONE':raw.startsWith('symmetric_easy')?'EASY_SYM':raw==='symmetric'?'HARD_SYM':undefined,key=raw+':'+remote
    if(expected&&remote!=='UNKNOWN'&&expected!==remote&&!this.natNotes.has(key)){this.natNotes.add(key);this.deps.netLog('info',`NAT 文案与协商分类不同 (${raw} / ${remote})，打洞使用协商分类`)}
  }
  constructor(readonly deps:EngineDeps){
    super()
    this.turn=new TurnRelay({api:deps.api,baseURL:deps.baseURL,
      room:()=>this.session?{code:this.code,token:this.token,isHost:this.isHost,clientId:this.clientID,hostPort:this.hostPort,hostAuth:this.isHost||!!this.room?.hostCapabilities?.includes('punchAuthV1'),hostStdTurn:!!this.room?.hostCapabilities?.includes('stdTurnV1')}:null,
      directConnected:peer=>!!this.winner.get(peer||'host')&&this.winner.get(peer||'host')!=='turn',
      connected:(peer,address,mode)=>{this.winner.set(peer,mode??'turn');if(mode)this.mode=mode;this.stopPeerPunching(peer);if(!this.isHost)this.state(mode??'turn','success',address,mode==='p2p'?'已平滑升级为直连':mode==='prelay'?'TURN 已断开，热备玩家中继接替；若游戏已断线，请重新连接此地址':'TURN 中继已连接')},
      disconnected:peer=>{if(['turn','p2p','prelay'].includes(this.winner.get(peer)??''))this.winner.delete(peer)},
      stage:(status,detail)=>this.stage('turn',status,detail),
      state:(status,address,detail)=>{if(!this.isHost)this.state('turn',status,address,detail)},
      signal:(type,data,to)=>this.sendSignal(type,data,to),log:deps.netLog,
      mapping:peer=>this.lastMappings.get(peer),template:peer=>({profile:this.policy(peer).profile,params:this.policy(peer).params})})
  }
  private policy(peer:string):PunchRounds {let p=this.rounds.get(peer);if(!p){p=new PunchRounds(message=>this.deps.netLog('info',message));this.rounds.set(peer,p)}return p}
  private stopPeerPunching(peer:string,keep?:Link,keepTcp?:string):void {
    for(const key of this.tcp.keys())if((key===peer||key.startsWith(peer+':direct:'))&&key!==keepTcp)this.cancelTcp(key)
    for(const[id,link]of this.links)if(link.peer===peer&&link!==keep)this.drop(id)
  }
  private cancelTcp(id:string):void { const old=this.tcp.get(id);this.tcp.delete(id);old?.controller.abort();old?.stop?.() }
  private async runDirect(ip:string,port:number):Promise<void>{
    if(this.isHost||this.mode!=='p2p'||this.winner.has('host')||!net.isIP(ip)||!Number.isInteger(port)||port<1||port>65535)return
    const id=`host:direct:${ip}:${port}`;if(this.tcp.has(id))return
    const controller=new AbortController(),operation:{controller:AbortController;stop?:()=>void}={controller},epoch=this.generation
    this.tcp.set(id,operation)
    const socket=new net.Socket(),abort=()=>socket.destroy();controller.signal.addEventListener('abort',abort,{once:true})
    const valid=()=>epoch===this.generation&&this.tcp.get(id)===operation&&this.mode==='p2p'&&!this.winner.has('host')
    try{
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>{socket.destroy();reject(new Error('直连未命中'))},5000) // ConnectionManager.java: TCP_CONNECT_TIMEOUT_MS.
        socket.once('error',reject);socket.once('close',()=>{clearTimeout(timer);reject(new Error('直连已关闭'))})
        socket.connect(port,ip,()=>{clearTimeout(timer);resolve()})
      })
      if(!valid()){socket.destroy();return}
      const bridge=await bridgePunchedSocket(socket,null,()=>{
        if(this.tcp.get(id)!==operation)return
        this.tcp.delete(id);controller.abort()
        if(this.winner.get('host')===id){this.winner.delete('host');this.state('p2p','failed','','游戏通路已关闭');this.reconnect()}
      })
      if(!valid()){bridge.stop();return}
      operation.stop=bridge.stop;this.winner.set('host',id);this.stopPeerPunching('host',undefined,id)
      this.state('p2p','success',bridge.address,'连接成功，请在游戏中输入下方地址');this.stage('punch','ok','直连游戏地址已就绪')
    }catch{socket.destroy()}finally{if(!operation.stop&&this.tcp.get(id)===operation){this.tcp.delete(id);controller.abort();this.reconnect()}}
  }
  private reconnect(firewall=false):void {
    if(this.isHost||!this.session||this.reconnectPending||this.mode!=='p2p'||this.winner.has('host'))return
    if([...this.links.values()].some(l=>l.peer==='host'&&l.started))return
    if([...this.tcp.entries()].some(([key,value])=>(key==='host'||key.startsWith('host:direct:'))&&!value.stop))return
    const policy=this.policy('host'),wait=policy.advance(firewall)
    if(policy.terminal){this.state('p2p','failed','','未收到对方的网络回应。可手动使用 TURN 中继，或退出后重新加入');void this.sendSignal('cancel_connection',{},'host').catch(()=>{});return}
    this.reconnectPending=true
    this.state('p2p','trying','',`正在重新协商连接 · 第 ${policy.round+1} 轮`)
    this.later(()=>{
      this.reconnectPending=false
      if(this.mode!=='p2p'||this.winner.has('host'))return
      // launcher-integration.md §7.5: server injects join_request on /room/join.
      // Never invent a client join_request timer. Rejoin also refreshes credentials/auth.
      void this.deps.rejoin?.().catch(error=>{this.deps.netLog('warn',error.message);this.reconnect()})
    },wait)
  }
  private async runTcp(id:string,ip:string,port:number):Promise<void> {
    if(this.tcp.has(id)||this.winner.has(id)||this.turn.hasPeer(id)||!this.isHost&&this.mode!=='p2p')return
    const controller=new AbortController(), operation:{controller:AbortController;stop?:()=>void}={controller};this.tcp.set(id,operation)
    const epoch=this.generation
    try {
      const socket=await tcpSimOpen(ip,port,this.isHost,controller.signal)
      controller.signal.addEventListener('abort',()=>socket.destroy(),{once:true})
      if(epoch!==this.generation||this.tcp.get(id)!==operation||this.winner.has(id)||this.turn.hasPeer(id)||!this.isHost&&this.mode!=='p2p'){socket.destroy();return}
      const bridge=await bridgePunchedSocket(socket,this.isHost?this.hostPort:null,()=>{
        if(this.tcp.get(id)!==operation)return
        this.tcp.delete(id);this.winner.delete(id);controller.abort()
        if(!this.isHost){this.state('p2p','failed','','TCP 游戏通路已关闭');this.reconnect()}
      })
      if(epoch!==this.generation||this.tcp.get(id)!==operation||this.winner.has(id)||this.turn.hasPeer(id)||!this.isHost&&this.mode!=='p2p'){bridge.stop();return}
      operation.stop=bridge.stop;this.winner.set(id,'tcp');for(const[key,link]of this.links)if(link.peer===id)this.drop(key)
      this.stage(this.isHost?'host_punch':'punch','ok','TCP 同时打开通路已建立')
      if(!this.isHost){this.turn.stop();this.state('p2p','success',bridge.address,'TCP 打洞已连接')}
    }catch(error){if(!controller.signal.aborted&&epoch===this.generation)this.deps.netLog('info',`TCP 辅助打洞未命中：${(error as Error).message}`)}
    finally{if(!operation.stop&&this.tcp.get(id)===operation){this.tcp.delete(id);controller.abort();if(!this.isHost)this.reconnect()}}
  }
  baseURL():string{return this.deps.baseURL()}
  canRetry():boolean{return this.mode==='p2p'&&!this.winner.has('host')&&!!this.session}
  snapshotRoom():RoomInfo|null{return this.room}
  currentHostPort():number{return this.hostPort}
  setState(_state:AppState['state'],code:string,token:string,isHost:boolean,room:RoomInfo|null,session:VoxlinkSession|null):void{this.code=code;this.token=token;this.isHost=isHost;this.room=room;this.session=session;this.hostPort=room?.hostPort??0;this.hostIp=room?.hostIp??''}
  private later(callback:()=>void,ms:number):void{const epoch=this.generation;const timer=setTimeout(()=>{this.timers.delete(timer);if(epoch===this.generation&&this.session)callback()},ms);this.timers.add(timer)}
  private state(phase:string,status:string,address:string,detail:string):void{if(!this.session)return;if(this.lastConnection?.phase!==phase||status==='trying'&&this.lastConnection.status!=='trying')this.stages={};this.lastConnection={phase,status,address:status==='success'?address:'',detail};this.deps.emit('conn:state',this.lastConnection)}
  private stage(key:string,status:string,detail:string):void{if(!this.session)return;const item={key,status,detail,ts:Date.now()};this.stages[key]=item;this.deps.emit('stage',item)}
  beginFallbackTimer():void{if(!this.joinedAt)this.joinedAt=Date.now();if(this.isHost)return;this.state('p2p','trying','','正在与房主交换连接信息');this.later(()=>{if(this.mode==='p2p'&&!this.winner.has('host'))this.stage('turn','degraded','现在可由你选择使用 TURN 中继')},Math.max(0,20000-(Date.now()-this.joinedAt)))} // ConnectionManager.java: getPunchUiStartMs; UI TURN threshold 20s
  async sendSignal(type:string,data:Data,to:string):Promise<void>{if(!this.session||this.session.isDone())throw new Error('房间已退出');await this.session.request('/signal/send',{type,data,...(to?{to}:{})})}
  private drop(id:string):void {
    const link=this.links.get(id);if(!link)return
    this.links.delete(id);link.controller.abort();clearTimeout(link.timer)
    link.punch.stop();for(const punch of link.punchers)punch.stop()
    link.bridge?.stop();link.rudp?.close();for(const socket of link.sockets)try{socket.close()}catch{}
  }
  private alive(id:string,link:Link):boolean {
    return this.links.get(id)===link&&!link.controller.signal.aborted&&!!this.session&&!this.winner.has(link.peer)&&!this.turnChoices.has(link.peer)&&!this.turn.hasPeer(link.peer)&&(this.isHost||this.mode==='p2p'||link.peer==='relay')
  }
  private async prepare(id:string,auth:Buffer|null,peer=id,reverse=false,probe=true):Promise<Link>{
    const epoch=this.generation,socket=await punchListen(this.isHost&&!reverse?this.hostPort:0)
    if(epoch!==this.generation||!this.session){socket.close();throw new Error('房间已退出')}
    const punch=new Puncher({conn:socket,authKey:auth})
    const link:Link={socket,punch,mapped:{ip:'',port:0},delta:0,auth,sockets:[socket],punchers:[],samples:[],nat:'UNKNOWN',peer,reverse,ports:[],controller:new AbortController()}
    this.drop(id);this.links.set(id,link)
    if(!probe)return link // ConnectionManager.java: joiner_extra creates a socket without STUN.
    try{
      const samples=await stunSampleSeries(socket,STUN_SERVERS,2,1,1000,link.controller.signal) // ConnectionManager.java: dual STUN, PROBE_SOCKET_TIMEOUT_MS
      if(!this.alive(id,link))throw new Error('连接已取消')
      if(!samples.length)throw new Error('暂未探测到公网映射，将继续尝试；也可手动使用中继')
      link.samples=samples;link.mapped=samples[samples.length-1];link.delta=stunDeltaFromSamples(samples)
      link.nat=samples.length<2?'UNKNOWN':link.delta===0?'CONE':Math.abs(link.delta)<=100?'EASY_SYM':'HARD_SYM' // ConnectionManager.java: hostEasySym <=100
      if(symmetric(link.nat)){
        // ConnectionManager.java: handleJoinRequest P-PRE sampling 10 ×100ms.
        const extra=await samplePortsSequential(socket,STUN_SERVERS,10,100,link.controller.signal)
        if(extra.length>=5){link.delta=Math.max(1,deltaPredict(extra.map(a=>a.port))-extra[extra.length-1].port);link.samples=extra} // ConnectionManager.java: P-PRE / calculatePortDelta (trimmed EMA, minimum 1); does not shift the STUN endpoint.
      }
      if(!this.alive(id,link))throw new Error('连接已取消')
      return link
    }catch(error){if(this.links.get(id)===link)this.drop(id);throw error}
  }
  private async addSockets(id:string,link:Link,count:number,stun:boolean):Promise<StunMappedAddr[]>{
    const profile=this.policy(link.peer).profile,queries:Promise<StunMappedAddr|null>[]=[]
    for(let i=link.sockets.length;i<count&&this.alive(id,link);i++){
      try{
        const socket=await punchListen(0)
        if(!this.alive(id,link)){socket.close();break}
        link.sockets.push(socket)
        if(stun)queries.push(stunSampleSeries(socket,STUN_SERVERS,profile.socketStunCount,1,1000,link.controller.signal).then(samples=>{
          const delta=stunDeltaFromSamples(samples)
          if(samples.length>=2&&delta!==0){link.nat=Math.abs(delta)<=100?'EASY_SYM':'HARD_SYM';link.delta=delta} // ConnectionManager.java: multi-socket dual STUN upgrade, threshold 100.
          return samples[0]??null
        }))
      }catch{/* ConnectionManager.java: tolerate individual socket allocation failures */}
      if(stun&&profile.socketCreateIntervalMs)await delay(profile.socketCreateIntervalMs,undefined,{signal:link.controller.signal})
    }
    return [link.mapped,...(await Promise.all(queries)).filter((a):a is StunMappedAddr=>!!a)]
  }
  private async connect(id:string,link:Link,remote:StunMappedAddr,data:Data={},relay=false):Promise<void>{
    if(!this.alive(id,link))return
    link.remote=remote;for(const punch of link.punchers)punch.setTarget({address:remote.ip,port:remote.port})
    this.lastMappings.set(link.peer,{local:{address:link.mapped.ip,port:link.mapped.port},remote:{address:remote.ip,port:remote.port}})
    if(link.started)return
    link.started=true;clearTimeout(link.timer)
    const policy=this.policy(link.peer),prefix=this.isHost?'joiner':'host'
    const remoteNat:NatClass=data[`${prefix}Symmetric`]===true?(data[`${prefix}EasySym`]===true?'EASY_SYM':'HARD_SYM'):'CONE'
    policy.classify(link.nat,remoteNat,link.samples.length)
    this.reportNat(link.nat,remoteNat,link.peer)
    let profile=policy.profile,params={...(policy.params??fromProfile(profile))}
    const epoch=this.generation
    let both=symmetric(link.nat)&&symmetric(remoteNat)
    let count=1,range=profile.defaultPortRange,mode:PuncherOptions['mode']='prediction',fixedRange=false,ports:number[]=[]
    if(data.mappedExtra===true){range=profile.joinerMultiPortRange}
    else if(link.reverse){
      fixedRange=true
      if(!this.isHost&&symmetric(link.nat)){
        // ConnectionManager.java: startReversePunch -> startBirthdayPunch.
        count=link.nat==='EASY_SYM'?profile.birthdaySocketCount:profile.hardSymSocketCount
        range=link.nat==='EASY_SYM'?profile.easySymPortRange:symmetric(remoteNat)?profile.defaultPortRange:profile.minPortRange
      }else if(this.isHost){
        const advertised=Array.isArray(data.joinerMappedPorts)?data.joinerMappedPorts.map(Number).filter(p=>Number.isInteger(p)&&p>0&&p<=65535):[]
        range=both?0:symmetric(remoteNat)?profile.widePortRange:profile.defaultPortRange
        if(symmetric(link.nat)&&Math.abs(link.delta)>range)range=Math.min(Math.abs(link.delta)*2,profile.maxPortRange) // ConnectionManager.java: host reverse drift window
        params.timeoutMs=Math.max(params.timeoutMs,12000) // ConnectionManager.java: hostRevParams
        if(advertised.length>1){const expanded=new Set<number>();for(const p of advertised)for(let n=-profile.defaultPortRange;n<=profile.defaultPortRange;n++)if(p+n>0&&p+n<=65535)expanded.add(p+n);ports=[...expanded];mode='ports'}
      }else{range=profile.portPredictionMaxRange;params.timeoutMs=Math.max(params.timeoutMs,15000)} // ConnectionManager.java: simpleRevParams
    }else if(this.isHost){
      count=symmetric(link.nat)?profile.hardSymSocketCount:profile.hostMultiSocketCount
      range=symmetric(remoteNat)?profile.joinerMultiPortRange:0
      params.timeoutMs=Math.min(params.timeoutMs,profile.hostRoundTimeoutMs)
      if(range>0){params.sendMinRounds=1;params.sendMinPass=1} // ConnectionManager.java: host roundParams
    }else if(link.nat==='EASY_SYM'&&remoteNat==='EASY_SYM'){
      count=policy.round>0?profile.easySymMutualRetrySocketCount:profile.easySymMutualSocketCount;mode='group';params.easySymBomb=true
    }else{
      if(symmetric(link.nat)){count=symmetric(remoteNat)?profile.hardSymSocketCount:profile.joinerSymSocketCount;mode='group'}
      range=symmetric(link.nat)&&remoteNat==='CONE'?0:symmetric(remoteNat)?Math.max(Number(data.hostMappedPortRange)||profile.widePortRange,profile.maxPortRange):policy.cycle===0?profile.defaultPortRange:policy.cycle===1?profile.widePortRange:profile.maxPortRange
    }
    this.stage(this.isHost?'host_punch':relay?'relay':'punch','active',`正在建立${link.reverse?'反向':'直连'}通路 · 第 ${policy.round+1} 轮`)
    try{
      const mappings=await this.addSockets(id,link,count,this.isHost||link.reverse)
      if(this.isHost&&!link.reverse&&symmetric(link.nat)){
        // ConnectionManager.java: extend host group to HARDSYM.hardSymSocketCount after dual-STUN upgrade.
        await this.addSockets(id,link,profile.hardSymSocketCount,false)
        policy.classify(link.nat,remoteNat,link.samples.length);profile=policy.profile;params=fromProfile(profile)
        params.timeoutMs=Math.min(params.timeoutMs,profile.hostRoundTimeoutMs);if(range>0){params.sendMinRounds=1;params.sendMinPass=1}
        both=symmetric(remoteNat)
      }
      if(!this.alive(id,link))return
      if(link.reverse&&!this.isHost){await this.sendSignal('reverse_holepunch_offer',{...this.mapping(link,'joiner'),joinerMappedPorts:mappings.map(a=>a.port)},'host')}
      if(this.isHost)await this.sendSignal(link.reverse?'reverse_punch_info':'holepunch_mapped',{...this.mapping(link,'host'),hostMappedPorts:mappings.map(a=>a.port)},link.peer)
      if(!this.alive(id,link))return
      // Host uses independent prediction punchers; guest symmetric uses one group with shared PPS budget.
      const groups=mode==='group'?[link.sockets]:link.sockets.map(socket=>[socket])
      link.punchers=groups.map(sockets=>{
        const punch=new Puncher({conn:sockets[0],sockets,authKey:link.auth,profile,params,mode,range,fixedRange,skipFirewall:both||symmetric(link.nat)||symmetric(remoteNat),sweepSpread:both?profile.joinerMultiPortRange:0})
        punch.setTarget({address:remote.ip,port:remote.port});if(ports.length)punch.setPredictedPorts(ports)
        punch.setOnPeer(addr=>{policy.receivedEver=true;void this.sendSignal('peer_port',{peer_ip:addr.address,peer_port:addr.port},link.peer).catch(()=>{})})
        punch.start();return punch
      })
      const hostDeadline=Date.now()+120000 // ConnectionManager.java: punchGroupDeadline, per host group (not session deadline).
      let won:{punch:Puncher;target:{address:string;port:number}}
      while(true){
        try{won=await Promise.any(link.punchers.map(async punch=>({punch,target:await punch.wait()})));break}
        catch(error){
          if(!this.isHost||link.reverse||!this.alive(id,link)||Date.now()>=hostDeadline)throw error
          for(const failure of error instanceof AggregateError?error.errors:[error])if(failure instanceof PunchFailure)policy.record(failure.result)
          if(policy.terminal)throw error
          await delay(300,undefined,{signal:link.controller.signal}) // ConnectionManager.java: host round sleep 300ms.
          if(symmetric(link.nat))void this.sendSignal('holepunch_mapped',{...this.mapping(link,'host'),hostMappedPorts:mappings.map(a=>a.port)},link.peer).catch(()=>{})
          link.punchers=groups.map(sockets=>{
            const punch=new Puncher({conn:sockets[0],sockets,authKey:link.auth,profile,params,mode,range,fixedRange,skipFirewall:both||symmetric(link.nat)||symmetric(remoteNat)})
            const current=link.remote??remote;punch.setTarget({address:current.ip,port:current.port})
            punch.setOnPeer(()=>{policy.receivedEver=true});punch.start();return punch
          })
        }
      }
      if(epoch!==this.generation||!this.alive(id,link))return
      this.winner.set(link.peer,id);this.stopPeerPunching(link.peer,link)
      for(const punch of link.punchers)punch.stop()
      link.punch=won.punch;link.socket=won.punch.conn
      for(const socket of link.sockets)if(socket!==link.socket)try{socket.close()}catch{}
      link.sockets=[link.socket]
      const rc=link.rudp=new RudpConn(link.socket,won.target,{authKey:link.auth});rc.start()
      if(this.isHost){rc.once('closed',()=>{if(this.links.get(id)===link){this.winner.delete(link.peer);this.drop(id)}});void startHostLazyBridge(rc,this.hostPort,this.deps.netLog).catch(error=>this.deps.netLog('warn',error.message));this.stage('host_punch','ok','玩家通路已建立，等待游戏连接')}
      else{
        const result=await TcpBridge.startGuest(rc,()=>{if(this.links.get(id)===link){this.winner.delete(link.peer);this.drop(id);this.state(relay?'prelay':'p2p','failed','','游戏通路已关闭');this.reconnect()}})
        if(epoch!==this.generation||this.links.get(id)!==link){result.bridge.stop();return}
        link.bridge=result.bridge;this.turn.stop();this.relayPending=false
        this.state(relay?'prelay':'p2p','success',result.addr,relay?'玩家中继已连接':'连接成功，请在游戏中输入下方地址')
        this.stage(relay?'relay':'punch','ok','游戏地址已就绪');void this.sendSignal('connected',{},'host').catch(error=>this.deps.netLog('warn',error.message))
      }
    }catch(error){
      if(epoch!==this.generation||this.links.get(id)!==link)return
      const failures=error instanceof AggregateError?error.errors:[error]
      for(const failure of failures)if(failure instanceof PunchFailure)policy.record(failure.result)
      this.winner.delete(link.peer);this.drop(id)
      this.stage(this.isHost?'host_punch':relay?'relay':'punch','retry',policy.terminal?'未收到对方回应，可手动选择中继':'本轮未连通，继续尝试')
      if(!this.isHost&&!relay){
        // ConnectionManager.java: Wave 2 follows a UDP failure; direct TCP never selects TURN.
        const direct=this.runDirect(this.hostIp,this.hostPort)
        if(link.remote)void this.runDirect(link.remote.ip,this.hostPort||link.remote.port)
        if(!this.tcp.has('host')){const port=await chooseTcpPunchPort();if(this.canRetry())void this.sendSignal('tcp_punch_info',{tcpPunchIp:link.mapped.ip,tcpPunchPort:port},'host').catch(()=>{})}
        await direct
        if(epoch===this.generation)this.reconnect(failures.some(e=>e instanceof PunchFailure&&e.result.firewallDetected))
      }
    }
  }
  private mapping(link:Link,prefix:string):Data{
    // ConnectionManager.java: handleJoinRequest symOrUnknown. A single STUN
    // observation must not advertise a confirmed cone host to the joining peer.
    return{[`${prefix}MappedIp`]:link.mapped.ip,[`${prefix}MappedPort`]:link.mapped.port,[`${prefix}MappedPortDelta`]:link.delta,[`${prefix}MappedPortRange`]:predict(link.samples.map(a=>a.port)).range,[`${prefix}Symmetric`]:symmetric(link.nat)||prefix==='host'&&link.nat==='UNKNOWN',[`${prefix}EasySym`]:link.nat==='EASY_SYM'}
  }
  private async hostOffer(from:string,data:Data={}):Promise<void>{
    if(this.creating.has(from)||this.links.get(from)?.started||this.winner.has(from)||this.turnChoices.has(from)||this.turn.hasPeer(from))return
    this.creating.add(from)
    try{
      this.stage('host_stun','active','正在探测网络')
      const caps=Array.isArray(data.clientCapabilities)?data.clientCapabilities:Array.isArray(data.capabilities)?data.capabilities:[]
      const link=await this.prepare(from,caps.includes('punchAuthV1')||data.punchAuthV1===true?derivePunchKey(this.code,from):null)
      if(!this.alive(from,link))return
      const addresses=Object.values(networkInterfaces()).flat().filter(a=>a&&!a.internal)
      await this.sendSignal('holepunch_offer',{hostIp:this.hostIp,hostPort:this.hostPort,hostLocalIp:addresses.find(a=>a?.family==='IPv4')?.address,hostIpv6:addresses.find(a=>a?.family==='IPv6'&&!a.address.startsWith('fe80:'))?.address,...this.mapping(link,'host'),punchAuthV1:!!link.auth,punchSyncTimeMs:Date.now()+3000,punchSyncSentAtMs:Date.now()},from) // ConnectionManager.java: offer RTT sync 3000ms
      this.stage('host_stun','ok','网络探测完成，等待玩家回应')
    }finally{this.creating.delete(from)}
  }
  private async guestOffer(data:Data):Promise<void>{
    if(this.creating.has('host')||this.links.get('host')?.started||this.winner.has('host')||this.mode!=='p2p')return
    this.creating.add('host');this.stage('stun','active','正在探测网络')
    try{
      const auth=this.room?.hostCapabilities?.includes('punchAuthV1')?derivePunchKey(this.code,this.clientID):null
      const link=await this.prepare('host',auth),policy=this.policy('host')
      const remoteNat:NatClass=data.hostSymmetric===true?(data.hostEasySym===true?'EASY_SYM':'HARD_SYM'):'CONE'
      policy.classify(link.nat,remoteNat,link.samples.length)
      this.stage('stun','ok','网络探测完成')
      const strategy=selectStrategy(link.nat,remoteNat,policy.cycle,false),target=endpoint(data,'hostMapped')
      if(!target)throw new Error('房主网络地址尚未就绪')
      this.tcpPeerIp=target.ip
      // ConnectionManager.java: Wave 1 LAN/CGNAT and IPv6 race alongside UDP.
      const localIp=String(data.hostLocalIp??''),ipv6=String(data.hostIpv6??'')
      const sameLan=net.isIPv4(localIp)&&Object.values(networkInterfaces()).flat().some(a=>a?.family==='IPv4'&&a.address.split('.').slice(0,3).join('.')===localIp.split('.').slice(0,3).join('.')) // StunDetector.java: isSameLan /24.
      if(sameLan||link.mapped.ip===target.ip)void this.runDirect(localIp,this.hostPort)
      if(net.isIPv6(ipv6)&&Object.values(networkInterfaces()).flat().some(a=>a?.family==='IPv6'&&!a.internal&&!a.address.startsWith('fe80:')))void this.runDirect(ipv6,this.hostPort)
      // ConnectionManager.java: Wave 1 strategy dispatch, separate reverse sockets.
      const reverse=policy.params?.skipDirectPunch||strategy==='REVERSE_ONLY'||strategy==='REVERSE_THEN_FORWARD'||strategy==='PARALLEL_FROM_START'||strategy==='REVERSE_FIRST'&&policy.cycle===0||strategy==='DIRECT_ONLY'&&policy.cycle===0||strategy==='DIRECT_WITH_REVERSE_PARALLEL'&&policy.cycle>=1||strategy==='RELAY_FALLBACK_FAST'&&policy.cycle>=1
      if(reverse)void(async()=>{const r=await this.prepare('host:reverse',auth,'host',true);await this.connect('host:reverse',r,target,data)})().catch(e=>{if(this.mode==='p2p'){this.deps.netLog('warn',e.message);this.reconnect()}})
      if(strategy!=='REVERSE_ONLY'&&!policy.params?.skipDirectPunch){
        await this.sendSignal('punch_info',{...this.mapping(link,'joiner'),joinerOfferRecvMs:Date.now()},'host')
        void this.connect('host',link,target,data)
      }else this.drop('host')
      if(policy.cycle>=1){const port=await chooseTcpPunchPort();if(this.mode==='p2p'&&!this.winner.has('host'))await this.sendSignal('tcp_punch_info',{tcpPunchIp:link.mapped.ip,tcpPunchPort:port},'host')}
    }catch(error){this.deps.netLog('warn',(error as Error).message);this.reconnect()}
    finally{this.creating.delete('host')}
  }
  onSignal(type:string,from:string,data:Data):void{
    if(!this.session||this.session.isDone())return
    if(!this.acceptSignal(type,from))return
    const run=async()=>{
      if(type==='cancel_connection'||type==='disconnect'){
        this.winner.delete(from);this.turnChoices.delete(from);this.stopPeerPunching(from);this.turn.peerLeft(from)
        if(!this.isHost&&from==='host'){this.mode='direct';this.state('p2p','failed','','对方已结束连接，请退出后重新加入')}
        return
      }
      if(type.startsWith('turn_')){
        if(type==='turn_alloc'&&this.isHost&&!this.winner.has(from)){this.turnChoices.add(from);this.stopPeerPunching(from)}
        if(this.isHost||this.mode==='turn')await this.turn.onSignal(type,from,data)
        return
      }
      if(!this.isHost&&this.mode==='turn'&&type==='relay_notify'){await this.turn.onSignal(type,from,data);return}
      if(this.isHost&&type==='relay_accept'&&typeof data.forClientId==='string'){
        const assignment=this.relayAssignments.get(data.forClientId)
        if(!assignment||assignment.candidate!==from||Date.now()-assignment.at>20000)return
        const relay=endpoint(data,'relay');if(!relay&&data.connected===false)return;await this.sendSignal('relay_notify',relay?{relayIp:relay.ip,relayPort:relay.port,connected:data.connected===true}:{connected:true},data.forClientId);return
      }
      if(!this.isHost&&this.mode!=='p2p'&&!['relay_notify','relay_declined','relay_setup'].includes(type))return
      if(this.isHost&&this.turnChoices.has(from)&&type!=='relay_request')return
      if(this.winner.has(from)&&type!=='relay_setup'&&type!=='relay_request')return
      if(type==='ice_restart'){
        if(!this.isHost&&from!=='host')return
        const previous=this.iceRestarts.get(from)||{count:0,at:0}
        if(previous.count>=3||Date.now()-previous.at<5000)return
        this.iceRestarts.set(from,{count:previous.count+1,at:Date.now()})
        this.cancelTcp(from);this.drop(from);this.turn.peerLeft(from)
        if(this.isHost)await this.hostOffer(from);else{this.state('p2p','trying','','对端请求重新建立连接');this.reconnect()}
        return
      }
      if(type==='peer_port')return // Observed peer address is diagnostic, never our remote target.
      if(this.isHost){
        if(type==='tcp_punch_info'){
          const target=endpoint(data,'tcpPunch')
          if(target && target.port>=1024 && !this.tcp.has(from) && !this.links.get(from)?.rudp?.isConnected() && !this.turn.hasPeer(from)) {
            const work=this.runTcp(from,target.ip,target.port)
            await this.sendSignal('tcp_punch_go',{tcpPunchPort:target.port},from);void work
          }
        }
        if(type==='join_request')await this.hostOffer(from,data)
        if(type==='punch_info'||type==='reverse_holepunch_offer'){
          const reverse=type==='reverse_holepunch_offer',id=reverse?from+':reverse':from,remote=endpoint(data,'joinerMapped')
          if(remote&&!this.turn.hasPeer(from)&&!this.winner.has(from)){
            let link=this.links.get(id)
            if(!link&&reverse)link=await this.prepare(id,this.links.get(from)?.auth??null,from,true)
            if(link)void this.connect(id,link,remote,data)
          }
        }
        if(type==='relay_request')await this.dispatchRelay(from,data)
      }else if(from==='host'){
        if(type==='tcp_punch_go' && this.tcpPeerIp && this.lastConnection?.status!=='success')void this.runTcp('host',this.tcpPeerIp,Number(data.tcpPunchPort))
        if(type==='holepunch_offer')await this.guestOffer(data)
        if(type==='holepunch_mapped'||type==='reverse_punch_info'){
          const id=type==='reverse_punch_info'?'host:reverse':'host',link=this.links.get(id),remote=endpoint(data,'hostMapped')
          if(link&&remote){
            void this.connect(id,link,remote,data)
            if(type==='holepunch_mapped'&&Array.isArray(data.hostMappedPorts)){
              const ports=data.hostMappedPorts.map(Number).filter(p=>Number.isInteger(p)&&p>0&&p<=65535)
              if(JSON.stringify(link.ports)!==JSON.stringify(ports)){
                link.ports=ports
                for(const key of [...this.links.keys()])if(key.startsWith('host:extra:'))this.drop(key)
                const cap=link.mapped.ip===remote.ip?12:6 // ConnectionManager.java: handleHolepunchMapped maxExtraCap, same CGNAT 12, otherwise 6.
                for(let i=1;i<Math.min(ports.length,cap);i++)void(async()=>{
                  const key=`host:extra:${i}`,extra=await this.prepare(key,link.auth,'host',false,false)
                  extra.nat=link.nat;extra.samples=link.samples
                  if(this.alive(key,extra))await this.connect(key,extra,{ip:remote.ip,port:ports[i]},{...data,mappedExtra:true})
                })().catch(()=>{})
              }
            }
          }
        }
        if(type==='relay_declined'){this.relayPending=false;this.state('prelay','failed','','当前没有可用的玩家中继')}
        if(type==='relay_notify'&&!data.connected&&this.mode==='prelay'){const remote=endpoint(data,'relay');if(remote){const link=await this.prepare('relay',null);void this.connect('relay',link,remote,{},true)}}
        if(type==='relay_setup')await this.serveRelay(data)
      }
    };void run().catch(error=>{if(this.session)this.deps.netLog('warn',(error as Error).message)})
  }
  private async dispatchRelay(requester:string,data:Data={}):Promise<void>{
    const recorded=this.lastMappings.get(requester)?.remote,target=endpoint(data,'mapped')??this.links.get(requester)?.remote??(recorded?{ip:recorded.address,port:recorded.port}:undefined)
    const candidates=[...this.links.entries()].filter(([id,link])=>id!==requester&&link.remote&&link.rudp?.isConnected())
    if(!target||!candidates.length){await this.sendSignal('relay_declined',{},requester);return}
    const [id,relay]=candidates[0];this.relayAssignments.set(requester,{candidate:id,at:Date.now()});await this.sendSignal('relay_setup',{targetClientId:requester,targetIp:target.ip,targetPort:target.port,punchAuth:!!this.links.get(requester)?.auth||this.turn.peerAuth(requester)},id);await this.sendSignal('relay_notify',{relayIp:relay.remote!.ip,relayPort:relay.remote!.port},requester)
  }
  private async serveRelay(data:Data):Promise<void>{
    const remote=endpoint(data,'target'),host=this.links.get('host');if(this.deps.allowRelay?.()===false||!remote||!host?.rudp?.isConnected()){await this.sendSignal('relay_declined',{},'host');return}
    const targetId=String(data.targetClientId??'');if(!targetId||targetId.length>128)return
    const id=`relay:${targetId}`;if(this.links.has(id)||this.creating.has(id))return
    const auth=data.punchAuth===true?derivePunchKey(this.code,targetId):null,link=await this.prepare(id,auth),epoch=this.generation,policy=this.policy('host')
    try{
      await this.sendSignal('relay_accept',{forClientId:targetId,relayIp:link.mapped.ip,relayPort:link.mapped.port,connected:false},'host')
      for(let i=1;i<policy.profile.relaySocketCount;i++){const socket=await punchListen(0);if(epoch!==this.generation||link.controller.signal.aborted){socket.close();return}link.sockets.push(socket)}
      link.punch=new Puncher({conn:link.socket,sockets:link.sockets,authKey:auth,profile:policy.profile,params:policy.params,range:policy.profile.coneBackupPortRange,timeoutMs:15000});link.punch.setTarget({address:remote.ip,port:remote.port});link.started=true;link.punch.start()
      const target=await link.punch.wait();if(epoch!==this.generation||link.controller.signal.aborted)return
      link.socket=link.punch.conn;for(const socket of link.sockets)if(socket!==link.socket)try{socket.close()}catch{};link.sockets=[link.socket]
      const rc=link.rudp=new RudpConn(link.socket,target);rc.start();const stop=pumpRelay(host.rudp,rc);this.relays.add(stop);await this.sendSignal('relay_accept',{forClientId:targetId,connected:true},'host')
    }catch(error){if(epoch===this.generation){this.drop(id);await this.sendSignal('relay_declined',{forClientId:targetId},'host').catch(()=>{});this.deps.netLog('info','玩家中继探测未命中：'+(error as Error).message)}}
  }
  usePlayerRelay():{ok:boolean;err?:string}{if(!this.session||this.isHost)return{ok:false,err:'请先加入房间'};if(this.relayPending)return{ok:false,err:'正在请求玩家中继'};this.mode='prelay';this.stopPeerPunching('host');this.relayPending=true;this.state('prelay','trying','','正在寻找玩家中继');void this.sendSignal('relay_request',{},'host').catch(error=>{this.relayPending=false;this.state('prelay','failed','',error.message)});this.later(()=>{if(this.relayPending){this.relayPending=false;this.state('prelay','failed','','玩家中继请求超时，可尝试 TURN')}},20000);return{ok:true}}
  async useTurnRelay():Promise<void>{
    if(!this.session||this.isHost)throw new Error('请先加入房间')
    if(this.winner.has('host')||this.turn.busy())return
    if(!this.joinedAt||Date.now()-this.joinedAt<20000)throw new Error('连接尝试 20 秒后可选择 TURN 中继') // ConnectionManager.java: getPunchUiStartMs
    this.mode='turn';this.reconnectPending=false;this.stopPeerPunching('host');this.state('turn','trying','','正在建立你选择的 TURN 中继')
    await this.turn.startGuest()
  }
  acceptSignal(type:string,from:string):boolean{
    if(typeof from!=='string'||!from||from.length>128)return false
    if(from==='server'||from==='host')return true
    if(this.isHost&&type==='join_request'){this.knownPeers.add(from);return true}
    return this.knownPeers.has(from)
  }
  tryDirect():{ok:boolean;err?:string}{if(!this.session||this.isHost||!net.isIP(this.hostIp)||!this.hostPort)return{ok:false,err:'当前房间没有有效直连地址'};const epoch=this.generation;const socket=net.createConnection({host:this.hostIp,port:this.hostPort});this.state('direct','trying','','正在测试直连');let finished=false;const finish=(ok:boolean)=>{if(finished)return;finished=true;clearTimeout(timer);socket.destroy();if(epoch===this.generation)this.state('direct',ok?'success':'failed',ok?`${net.isIP(this.hostIp)===6?'['+this.hostIp+']':this.hostIp}:${this.hostPort}`:'',ok?'直连可用':'直连不可用')};const timer=setTimeout(()=>finish(false),3000);socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));return{ok:true}}
  relayRelease():void{this.turn.stop()}
  teardown(retry=false):void{this.generation++;for(const timer of this.timers)clearTimeout(timer);this.timers.clear();if(!retry){this.rounds.clear();this.knownPeers.clear();this.natNotes.clear()}this.lastMappings.clear();this.relayAssignments.clear();this.iceRestarts.clear();this.winner.clear();this.turnChoices.clear();this.reconnectPending=false;this.tcpPeerIp='';for(const id of [...this.tcp.keys()])this.cancelTcp(id);this.turn.stop();for(const id of [...this.links.keys()])this.drop(id);for(const stop of this.relays)stop();this.relays.clear();this.creating.clear();this.relayPending=false;if(!retry)this.joinedAt=0;this.mode='p2p';this.lastConnection=null;this.stages={}}
}
export interface AppOptions {settings?:VoxlinkSettings;settingsPath?:string;api?:ApiClient;serverURL?:string}
export class VoxlinkApp {
  readonly api:ApiClient;readonly engine:ConnEngine;settings:VoxlinkSettings;settingsPath:string;state:AppState['state']='idle';room:RoomInfo|null=null
  private operation=0;private pending=false;private joinPassword='';private rejoining=false
  private operationController=new AbortController();private joinEnvironment:{loader?:string;gameVersion?:string}={}
  private async requestJoin(code:string,password:string|undefined,signal:AbortSignal):Promise<JoinRoomResult>{
    const body={code,password,...this.joinEnvironment,clientType:'app',clientTag:CLIENT_TAG,clientProtocolVersion:7,clientCapabilities:VOXLINK_CAPABILITIES,idempotencyKey:randomUUID()}
    for(let attempt=0;;attempt++){
      signal.throwIfAborted()
      try{return await this.api.post(this.baseURL(),'/room/join',body,undefined,signal) as JoinRoomResult}
      catch(error){signal.throwIfAborted();if(!(error instanceof APIError)||!['NETWORK','NETWORK_ERROR','CDN_ERROR','RATE_LIMITED'].includes(error.code)||attempt>=JOIN_RETRY_BACKOFF_MS.length)throw error;this.netLog('warn',`加入暂时失败 (${error.code})，将进行第 ${attempt+2}/3 次尝试`);await delay(JOIN_RETRY_BACKOFF_MS[attempt],undefined,{signal})}
    }
  }
  constructor(private options:AppOptions={}){this.settingsPath=options.settingsPath??defaultSettingsPath();this.settings=options.settings??loadSettings(this.settingsPath);this.api=options.api??new ApiClient();this.engine=new ConnEngine({api:this.api,baseURL:()=>this.baseURL(),allowRelay:()=>this.settings.allowRelay,rejoin:()=>this.rejoin(),emit:(event,data)=>this.emit(event,data),netLog:(level,message)=>this.netLog(level,message)})}
  private async rejoin():Promise<void>{
    if(this.rejoining||!this.engine.canRetry()||this.engine.isHost)return
    this.rejoining=true
    const epoch=this.operation,code=this.engine.code,old=this.engine.session,oldToken=this.engine.token
    try{
      const result=await this.requestJoin(code,this.joinPassword,this.operationController.signal)
      if(epoch!==this.operation||this.engine.session!==old||!this.engine.canRetry()){
        void this.api.post(this.baseURL(),'/room/leave',{code,token:result.clientToken,isHost:false}).catch(()=>{});return
      }
      this.engine.session=null;old?.stop();this.engine.teardown(true)
      result.room={...result.room,code,isHost:false}
      await this.accept(epoch,code,result.clientToken,false,result.room,result.clientId)
      if(oldToken!==result.clientToken)void this.api.post(this.baseURL(),'/room/leave',{code,token:oldToken,isHost:false}).catch(()=>{})
    }finally{this.rejoining=false}
  }
  emit(_event:string,_data:unknown):void{}
  netLog(_level:LogLevel,_message:string):void{}
  baseURL():string{return this.options.serverURL??DEFAULT_SERVER_URL}
  getSettingsJSON(){return{serverUrl:this.baseURL(),theme:this.settings.theme,version:APP_VERSION}}
  saveSettingsJSON(value:{theme?:string}){if(value.theme)this.settings.theme=value.theme;saveSettings(this.settings,this.settingsPath);return this.getSettingsJSON()}
  setAllowRelay(value:boolean):VoxlinkSettings{this.settings.allowRelay=value;saveSettings(this.settings,this.settingsPath);return this.settings}
  async getCategories():Promise<Record<string,string>>{return await this.api.get(this.baseURL(),'/categories',{}) as Record<string,string>}
  async listRooms(query:{page?:number;size?:number;category?:string;loader?:string;search?:string}):Promise<{rooms:LobbyRoom[];total:number;page:number;size:number}>{const page=Math.max(1,query.page??1),size=Math.min(100,Math.max(1,query.size??20));return await this.api.get(this.baseURL(),'/room/list',{...query,page,size}) as {rooms:LobbyRoom[];total:number;page:number;size:number}}
  async roomInfo(code:string):Promise<Data>{return await this.api.get(this.baseURL(),'/room/info',{code}) as Data}
  private begin():number{if(this.pending||this.engine.session)throw new APIError('SESSION_ACTIVE','请先退出当前房间');this.operationController.abort();this.operationController=new AbortController();this.pending=true;return ++this.operation}
  private async accept(epoch:number,code:string,token:string,isHost:boolean,room:RoomInfo,clientId=''):Promise<void>{
    if(epoch!==this.operation){void this.api.post(this.baseURL(),'/room/leave',{code,token,isHost}).catch(()=>{});throw new Error('操作已取消')}
    this.room=room;this.state=isHost?'hosting':'in_room';const session=new VoxlinkSession({api:this.api,baseURL:()=>this.baseURL(),emit:(e,d)=>this.emit(e,d),netLog:(l,m)=>this.netLog(l,m)},{code,token,isHost});this.engine.clientID=clientId;this.engine.setState(this.state,code,token,isHost,room,session)
    session.on('engineSignal',signal=>{if(this.engine.session!==session||!this.engine.acceptSignal(signal.type,signal.from))return;if (isHost && signal.type==='mods_request') this.emit('mods:request',signal.data); else this.engine.onSignal(signal.type,signal.from,signal.data)});session.on('roomInfo',info=>{if(this.engine.session===session&&this.room){if(Number.isFinite(info?.currentPlayers))this.room.currentPlayers=info.currentPlayers;if(info?.name)this.room.name=info.name;this.emit('session:state',{state:this.state,room:this.room})}})
    this.engine.beginFallbackTimer();this.emit('session:state',{state:this.state,room});void session.run().finally(()=>{if(this.engine.session===session){this.engine.teardown();this.engine.session=null;this.state='closed';this.room=null;this.emit('session:state',{state:'closed'})}})
    // Server injects join_request after room/join; no client-originated duplicate.
  }
  async createRoom(req:CreateRoomParams):Promise<CreateRoomResult>{const epoch=this.begin();try{const name=normalizeVoxlinkRoomName(req.name);await probeHostPort(req.hostPort);if(epoch!==this.operation)throw new Error('操作已取消');const result=await this.api.post(this.baseURL(),'/room/create',{...req,name,maxPlayers:20,natType:'unknown',clientType:'app',clientTag:CLIENT_TAG,client_tag:CLIENT_TAG,clientProtocolVersion:7,clientCapabilities:VOXLINK_CAPABILITIES,idempotencyKey:randomUUID()},undefined,this.operationController.signal) as CreateRoomResult;const room:RoomInfo={...result,maxPlayers:20,currentPlayers:1,hasPassword:!!req.password,category:req.category??'',gameVersion:req.gameVersion??'',loader:req.loader??'',clientType:'app',clientTag:CLIENT_TAG,isHost:true};await this.accept(epoch,result.code,result.hostToken,true,room);return result}finally{if(epoch===this.operation)this.pending=false}}
  async joinRoom(req:JoinRoomParams):Promise<JoinRoomResult>{const epoch=this.begin();this.joinPassword=req.password??'';this.joinEnvironment={loader:req.loader,gameVersion:req.gameVersion};try{const code=req.code.trim().toUpperCase();if(!validateRoomCode(code))throw new APIError('INVALID_PARAMS','请输入有效的六位房间码');const result=await this.requestJoin(code,req.password,this.operationController.signal);result.room={...result.room,code,isHost:false};await this.accept(epoch,code,result.clientToken,false,result.room,result.clientId);return result}finally{if(epoch===this.operation)this.pending=false}}
  async leaveRoom(reason='用户退出房间'):Promise<{left:boolean}>{this.netLog('info','退出房间：'+reason.slice(0,100));this.operation++;this.operationController.abort();this.pending=false;const session=this.engine.session,credentials={code:this.engine.code,token:this.engine.token,isHost:this.engine.isHost};this.engine.session=null;session?.stop();this.engine.teardown();this.engine.setState('idle','','',false,null,null);this.state='idle';this.room=null;this.emit('session:state',{state:'idle'});if(session)void this.api.post(this.baseURL(),'/room/leave',credentials).catch(()=>{});return{left:!!session}}
  getSessionStateJSON():AppState{return{state:this.state,room:this.room,code:this.engine.code,token:this.engine.token,isHost:this.engine.isHost}}
  async sendRoomUpdate(value:{name?:string;category?:string;visible?:boolean;password?:string}):Promise<void>{if(!this.engine.session||!this.engine.isHost)throw new Error('只有房主可以修改房间');await this.api.post(this.baseURL(),'/room/update',{...value,code:this.engine.code,token:this.engine.token,isHost:true})}
  async getRoomMods(code:string):Promise<Data>{return await this.api.post(this.baseURL(),'/room/mods',{code}) as Data}
  async relayStatus():Promise<Data>{return await this.api.get(this.baseURL(),'/relay/status',{}) as Data}
  async relayList():Promise<Data>{return await this.api.get(this.baseURL(),'/relay/list',{}) as Data}
  async getStun():Promise<Data>{return await this.api.get(this.baseURL(),'/stun',{}) as Data}
  async openInBrowser(url:string):Promise<void>{if(!validateServerURL(url))throw new Error('链接无效');const {shell}=await import('electron');await shell.openExternal(url)}
  async detectMcPortsJSON(){return{ports:await detectMcPorts()}}
  tryDirect(){return this.engine.tryDirect()}
  usePlayerRelay(){return this.engine.usePlayerRelay()}
}
