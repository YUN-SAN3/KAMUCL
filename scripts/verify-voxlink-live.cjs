// Explicit network acceptance. Creates one private disposable room, never submits a ticket.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto'),{once}=require('events');
if(!process.argv.includes('--live'))throw Error('Pass --live to run the actual service check');
require('esbuild').buildSync({stdin:{contents:"export {ApiClient} from './src/main/core/voxlink/api';export {StdTurnSession,fetchTurnCredential} from './src/main/core/voxlink/stdTurn';export {TurnSession} from './src/main/core/voxlink/turn';export {RudpConn} from './src/main/core/voxlink/rudp';export {derivePunchKey} from './src/main/core/voxlink/punchAuth'",resolveDir:process.cwd()},outfile:'out/vox-protocol-verification.cjs',bundle:true,platform:'node',format:'cjs'});
const {ApiClient,StdTurnSession,fetchTurnCredential,TurnSession,RudpConn,derivePunchKey}=require(path.resolve('out/vox-protocol-verification.cjs'));
const api=new ApiClient({timeoutMs:5000}),base='https://p2p.wuhui.icu',proof={at:new Date().toISOString(),roomCreated:false,roomJoined:false,standard:false,legacy:false,cleanup:[]},owned=[],transports=[];
let host,guest,allocation;
const caps=['relay','ice_restart','continuous_retry','punchAuthV1','overlayAuthV1','modSyncV1','stdTurnV1'];
async function dataCheck(a,b){
 const x=new RudpConn(a.socket,a.target,{codec:a.codec,authKey:derivePunchKey(host.code,guest.clientId),ownsSocket:false,allowTurnAuthDowngrade:true}),y=new RudpConn(b.socket,b.target,{codec:b.codec,authKey:derivePunchKey(host.code,guest.clientId),ownsSocket:false,allowTurnAuthDowngrade:true});transports.push(x,y);x.start();y.start();const payload=crypto.randomBytes(5000),buffer=Buffer.alloc(6000);let size=0;
 await x.write(payload);await Promise.race([(async()=>{while(size<payload.length){const n=await y.read(buffer.subarray(size));if(!n)throw Error('RUDP closed before data arrived');size+=n}})(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('RUDP live data timeout')),6000);timer.unref()})]);assert.deepEqual(buffer.subarray(0,size),payload);x.close();y.close();return {bytes:size,sha256:crypto.createHash('sha256').update(buffer.subarray(0,size)).digest('hex')};
}
(async()=>{
 try{
  host=await api.post(base,'/room/create',{name:'KAMUCL 协议验收',visible:false,category:'',hostPort:25565,maxPlayers:20,natType:'unknown',loader:'fabric',gameVersion:'1.20.1',clientType:'app',clientTag:'kamucl',clientProtocolVersion:7,clientCapabilities:caps,idempotencyKey:crypto.randomUUID()});assert(host.code&&host.hostToken);proof.roomCreated=true;
  guest=await api.post(base,'/room/join',{code:host.code,loader:'fabric',gameVersion:'1.20.1',clientType:'app',clientTag:'kamucl',clientProtocolVersion:7,clientCapabilities:caps,idempotencyKey:crypto.randomUUID()});assert(guest.clientToken&&guest.clientId);proof.roomJoined=true;
  const {nodes}=await api.get(base,'/relay/list',{}),node=nodes.find(n=>n.stdTurnPort>0);assert(node);const signal=AbortSignal.timeout(30000);
  const hc=await fetchTurnCredential(api,base,{code:host.code,clientId:'',token:host.hostToken},String(node.id),signal),gc=await fetchTurnCredential(api,base,{code:host.code,clientId:guest.clientId,token:guest.clientToken},String(node.id),signal);
  const h=await StdTurnSession.allocate(hc,signal);owned.push(h);const g=await StdTurnSession.allocate(gc,signal);owned.push(g);await h.bind(g.relay,signal);await g.bind(h.relay,signal);h.startKeepalive();g.startKeepalive();proof.standard=await dataCheck(h,g);h.close();g.close();
  allocation=await api.post(base,'/relay/allocate',{roomCode:host.code,clientId:guest.clientId,token:guest.clientToken,nodeId:String(node.id)});
  const lh=await TurnSession.bind({...allocation,ticket:allocation.hostTicket},1,signal);owned.push(lh);const lg=await TurnSession.bind({...allocation,ticket:allocation.guestTicket},2,signal);owned.push(lg);proof.legacy=await dataCheck(lh,lg);
 }catch(error){proof.error=error.message;process.exitCode=1}
 finally{
  for(const rc of transports)rc.close();for(const session of owned)session.close();
  if(allocation)try{await api.post(base,'/relay/release',{roomCode:host.code,clientId:guest.clientId,token:guest.clientToken,sessionId:allocation.sessionId});proof.cleanup.push('legacy allocation released')}catch{proof.cleanup.push('allocation release failed; server TTL fallback')}
  for(const entry of [{value:guest,token:guest?.clientToken,isHost:false},{value:host,token:host?.hostToken,isHost:true}])if(entry.token)try{await api.post(base,'/room/leave',{code:host.code,token:entry.token,isHost:entry.isHost});proof.cleanup.push(entry.isHost?'host left':'guest left')}catch{proof.cleanup.push((entry.isHost?'host':'guest')+' leave failed; server TTL fallback')}
  fs.writeFileSync('out/voxlink-live-116.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
 }
})().catch(error=>{console.error(error.message);process.exitCode=1});
