import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import dgram from 'node:dgram'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import * as profiles from '../src/main/core/voxlink/punchProfiles'
import { TUNER, predict, nextParams, fromProfile, recommendProfile, selectStrategy, type NatClass, type PunchResult } from '../src/main/core/voxlink/punchPolicy'
import { PunchRounds } from '../src/main/core/voxlink/punchRounds'
import { PpsLimiter, controlPorts, Puncher, punchListen, punchBuildControl } from '../src/main/core/voxlink/punch'
import { probeHostPort } from '../src/main/core/voxlink/mc_ports'
import { stunResendDelay } from '../src/main/core/voxlink/stun'

test('VoxLink upstream fixture: every profile field, 55 send fields, 11 symmetric fields and 9 tuner constants agree',()=>{
  const source=fs.readFileSync('tests/fixtures/voxlink-c475faa9/PunchProfile.java','utf8')
  const fields=(name:string)=>source.match(new RegExp(`(?:private|public) ${name}\\(([^)]*)\\)`))![1].split(',').map(s=>s.trim().split(/\s+/).at(-1)!)
  const check=(name:string,type:string,input:string)=>{
    const tokens=input.match(/new int\[\]\{[^}]*\}|"[^"]*"|\w+/g)!
    const values=tokens.map(v=>v.startsWith('new int')?JSON.parse(v.replace('new int[]{','[').replace('}',']')):v.startsWith('"')?JSON.parse(v):/^\d+$/.test(v)?Number(v):(profiles as any)[v])
    const names=fields(type);assert.equal(names.length,values.length,name)
    names.forEach((key,i)=>assert.deepEqual((profiles as any)[name][key],values[i],`${name}.${key}`))
  }
  let send=0,profile=0
  for(const m of source.matchAll(/SendParams (SEND_\w+) = new (?:PunchProfile\.)?SendParams\(([^)]*)\)/g)){check(m[1],'SendParams',m[2]);send++}
  check('RECIPE','SymParams',source.match(/RECIPE = new SymParams\(([^)]*)\)/)![1])
  for(const m of source.matchAll(/public static final PunchProfile (\w+) = new PunchProfile\(([^;]*)\);/g)){check(m[1],'PunchProfile',m[2]);profile++}
  assert.equal(send,5);assert.equal(profile,8);assert.equal(fields('SendParams').length,11);assert.equal(fields('SymParams').length,11)
  const tuner=fs.readFileSync('tests/fixtures/voxlink-c475faa9/PunchTuner.java','utf8')
  const constants=Object.fromEntries([...tuner.matchAll(/private static final int (\w+) = (\d+);/g)].map(m=>[m[1],Number(m[2])]))
  assert.equal(Object.keys(constants).length,9);assert.deepEqual(TUNER,constants)
})

test('NAT matrix and predictor preserve source strategy, fusion and confidence',()=>{
  const names:NatClass[]=['UNKNOWN','CONE','EASY_SYM','HARD_SYM']
  const matrix=[['AGGRESSIVE','AGGRESSIVE','AGGRESSIVE','AGGRESSIVE'],['AGGRESSIVE','FAST_LANE','V100','AGGRESSIVE'],['AGGRESSIVE','V100','EASY_SYM_DUAL','HARDSYM'],['AGGRESSIVE','AGGRESSIVE','HARDSYM','HARDSYM']]
  for(let a=0;a<4;a++)for(let b=0;b<4;b++)assert.equal(recommendProfile(names[a],names[b]).name,matrix[a][b])
  assert.equal(selectStrategy('HARD_SYM','CONE',0,false),'REVERSE_ONLY')
  assert.equal(selectStrategy('HARD_SYM','CONE',1,false),'REVERSE_THEN_FORWARD')
  assert.equal(selectStrategy('HARD_SYM','CONE',0,true),'DIRECT_ONLY')
  for(const[n,range]of [[2,200],[3,100],[5,64],[10,32]]){const result=predict(Array.from({length:n},(_,i)=>30000+i*10));assert.equal(result.predictedPort,30000+n*10);assert.equal(result.range,range)}
  assert.equal(predict([65530,65533,65536]).predictedPort,65535)
  assert.equal(predict([100,101,102]).predictedPort,1024)
})

const noResponse:PunchResult={socketsTried:1,socketsReceivedPunch:0,socketsReceivedAck:0,predictionDelta:0,elapsedMs:12000,firewallDetected:false,portPredictionActive:false,success:false}
test('Tuner adapts failures; persistent rounds exceed old 50/8 limits and only zero-receive evidence terminates',()=>{
  assert.equal(nextParams(profiles.DEFAULT,0,8,'NO_RESPONSE',noResponse).timeoutMs,24000)
  assert.equal(nextParams(profiles.DEFAULT,0,8,'PREDICTION_OFF',noResponse).hardSymSpray,true)
  assert.equal(nextParams(profiles.DEFAULT,0,8,'FIREWALL_DETECTED',noResponse).skipDirectPunch,true)
  assert.equal(nextParams(profiles.DEFAULT,0,8,'ACK_TIMEOUT',noResponse).ackRetries,3)
  const alive=new PunchRounds();alive.receivedEver=true
  for(let i=0;i<1500;i++){alive.record(noResponse);alive.advance();assert.equal(alive.terminal,false)}
  assert(alive.round>50)
  const empty=new PunchRounds();empty.round=19;assert.equal(empty.terminal,false);empty.round=20;assert.equal(empty.terminal,true)
  const prediction=new PunchRounds();for(let i=0;i<49;i++)prediction.record({...noResponse,portPredictionActive:true});assert.equal(prediction.terminal,false);prediction.record({...noResponse,portPredictionActive:true});assert.equal(prediction.terminal,true)
  prediction.receivedEver=true;assert.equal(prediction.terminal,false)
})

test('PPS budget, random complete range, STUN jitter and group socket ownership',async t=>{
  let now=0;const limiter=new PpsLimiter(3000,()=>now)
  assert(Math.abs(limiter.beforeSendDelay()-1/3)<1e-8);now=1000;for(let i=0;i<2999;i++)assert.equal(limiter.beforeSendDelay(),0);assert(limiter.beforeSendDelay()>0)
  const ports=controlPorts(30000,100,800);assert.equal(new Set(ports).size,201);assert.equal(ports.length,202)
  assert.deepEqual(controlPorts(1,3,800),[1,2,3,4]);assert.equal(stunResendDelay(1,()=>0),320);assert.equal(stunResendDelay(4,()=>0),640)
  const sockets=await Promise.all([punchListen(0),punchListen(0)]),peer=await punchListen(0)
  t.after(()=>{for(const s of [...sockets,peer])s.close()})
  const p=new Puncher({conn:sockets[0],sockets,mode:'group',profile:profiles.DEFAULT,params:fromProfile(profiles.DEFAULT)})
  assert.equal(p.stats.portPredictionActive,false,'multi-socket failures must not consume the prediction-only cap')
  t.after(()=>p.stop());p.setTarget({address:'127.0.0.1',port:peer.address().port});p.start()
  peer.send(punchBuildControl(1,5),sockets[1].address().port,'127.0.0.1')
  await p.wait();assert.equal(p.conn,sockets[1]);for(const s of sockets)assert.equal(s.listenerCount('message'),0)
  await assert.rejects(probeHostPort(0),/^Error: 请先启动游戏并对局域网开放世界$/)
})

test('TURN is manual after 20s; failure never re-punches and stale signals cannot resurrect direct work',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'voxlink-policy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const built=await build({entryPoints:['src/main/core/voxlink/engine.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'})
  const require=createRequire(path.resolve('package.json')),module={exports:{} as any}
  new Function('require','module','exports',built.outputFiles[0].text)((id:string)=>id==='electron'?{app:{getPath:()=>root}}:require(id),module,module.exports)
  let relayCalls=0,rejoins=0;const events:any[]=[]
  const engine=new module.exports.ConnEngine({api:{async get(){relayCalls++;return{enabled:false}}},baseURL:()=>'',emit:(type:string,data:any)=>events.push({type,data}),netLog:()=>{},rejoin:async()=>{rejoins++}})
  assert.equal(engine.mapping({mapped:{ip:'127.0.0.1',port:12345},delta:0,samples:[{ip:'127.0.0.1',port:12345}],nat:'UNKNOWN'},'host').hostSymmetric,true,'upstream symOrUnknown must not become a confirmed cone')
  engine.setState('in_room','ABCDEF','token',false,{hostPort:12345},{isDone:()=>false,request:async()=>({})})
  t.after(()=>engine.teardown())
  engine.beginFallbackTimer();await assert.rejects(engine.useTurnRelay(),/20 秒/);assert.equal(relayCalls,0)
  engine.joinedAt=Date.now()-61000;engine.beginFallbackTimer();await new Promise(r=>setTimeout(r,20));assert.equal(relayCalls,0)
  engine.state('p2p','success','127.0.0.1:12345','old');engine.stage('punch','ok','old')
  await assert.rejects(engine.useTurnRelay(),/暂未启用/)
  assert.equal(engine.lastConnection.phase,'turn');assert.equal(engine.lastConnection.status,'failed');assert.equal(engine.lastConnection.address,'');assert.equal(engine.stages.punch,undefined)
  engine.onSignal('holepunch_offer','host',{hostMappedIp:'127.0.0.1',hostMappedPort:12345})
  engine.onSignal('ice_restart','host',{});await new Promise(r=>setTimeout(r,30))
  assert.equal(engine.links.size,0);assert.equal(rejoins,0)
  await assert.rejects(engine.useTurnRelay(),/暂未启用/);assert.equal(relayCalls,2)
  engine.teardown();engine.setState('hosting','ABCDEF','host-token',true,{hostPort:12345},{isDone:()=>false,request:async()=>({})})
  engine.acceptSignal('join_request','guest')
  engine.onSignal('turn_alloc','guest',{sessionId:'invalid-test-node'})
  await new Promise(r=>setTimeout(r,20))
  engine.onSignal('join_request','guest',{});engine.onSignal('punch_info','guest',{joinerMappedIp:'127.0.0.1',joinerMappedPort:12345})
  await new Promise(r=>setTimeout(r,20));assert.equal(engine.links.size,0,'failed TURN must not resurrect late host-side punch work')
})
