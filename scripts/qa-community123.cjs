// Controlled progressive-search business fixture, not real repository/network evidence.
const assert=require('node:assert/strict'),crypto=require('node:crypto')
const VERSION='1.1.23',THEMES=['blue-white','black-orange','black-pink','custom']
const FLAGS=['earlyUpdateDominatesStart','staleRequestIgnored','staleRevisionIgnored','partialActionsAvailable','pageContinuation','discoveryContinuation','cancelStopsUpdates','routeReturnPreserved','resumeContinuation','cachedResumeSingleAction','failureRecovery','failedBeforeSnapshot','filterNotExpanded','explicitAllVersions','emptyState','legacyQueryPath']
const CAPTURES=['partial','partial-actions','ready','continued','paused','resumed','empty','failed','failed-before-snapshot']
const combinations=()=>THEMES.flatMap(theme=>[[1366,768],[960,620]].flatMap(contentSize=>[1,1.25].map(zoom=>({theme,contentSize,zoom}))))
const capturePrefix=combo=>combo.theme+'-'+combo.contentSize.join('x')+'-'+combo.zoom*100
const key=row=>JSON.stringify([row.theme,row.contentSize,row.zoom])
const copy=value=>structuredClone(value)
function createSearchFixture(sendUpdate,{replyDelayMs=80}={}) {
  const sessions=new Map(),records=[],updates=[];let phase='partial',lastId='',legacyCalls=0
  const record=(action,payload)=>{const r={action,...copy(payload),at:Date.now(),monotonicMs:performance.now()};records.push(r);return r}
  const rows=(query,count,marker='')=>Array.from({length:count},(_,i)=>({source:i%2?'curseforge':'modrinth',projectId:'qa123-'+i,slug:'qa123-'+i,title:marker||`${query.keyword||'合成社区'} · 已确认模组 ${i+1}`,originalTitle:'Synthetic confirmed MOD '+(i+1),description:'公开合成界面验收元数据；未从服务搜索、下载或安装。',iconUrl:'',author:'KAMUCL QA',downloads:123,updatedAt:'2026-10-14T00:00:00Z',categories:[]}))
  const snapshot=(s,{revision=s.revision,count=s.confirmed,visible=s.visible,phase:sPhase=s.phase,marker=''}={})=>({requestId:s.id,revision,query:copy(s.query),phase:sPhase,items:rows(s.query,Math.min(count,visible),marker),total:count,totalKind:'confirmed',offset:0,limit:visible,discoveryHasMore:!s.empty&&count<45,cursor:'qa123:'+s.id+':'+revision,warnings:[],...(sPhase==='failed'?{error:'合成故障注入：社区请求失败'}:{})})
  function emit(value){updates.push(copy(value));record('event',{requestId:value.requestId,revision:value.revision,phase:value.phase,count:value.items.length,total:value.total});sendUpdate(copy(value))}
  async function call(channel,...args){
    if(channel==='community:search') {legacyCalls++;record('legacy',{query:args[0]});return {items:rows(args[0],4),total:4,offset:args[0].offset||0,limit:20,warnings:[]}}
    if(channel==='community:searchStart') {
      const [id,query]=args;assert.equal(typeof id,'string');assert(query&&typeof query==='object');lastId=id
      record('start',{requestId:id,query});if(phase==='reject'){record('start-reject',{requestId:id,beforeSnapshot:true});throw Error('合成故障注入：Start 在任何 snapshot 前失败')}
      const s={id,query:copy(query),revision:2,confirmed:phase==='empty'?0:phase==='cached'?40:6,visible:query.limit||20,empty:phase==='empty',phase:['empty','cached'].includes(phase)?'ready':phase==='failed'?'failed':'enriching',cancelled:false};sessions.set(id,s)
      emit(snapshot(s));const value=phase==='cached'?snapshot(s,{revision:1,count:40,phase:'ready'}):snapshot(s,{revision:1,count:0,phase:'initial'})
      await new Promise(resolve=>setTimeout(resolve,replyDelayMs));record('start-return',{requestId:id,revision:1,phase:value.phase,count:value.items.length});return value
    }
    if(channel==='community:searchCancel') {const s=sessions.get(args[0]);record('cancel',{requestId:args[0]});if(s)s.cancelled=true;return !!s}
    if(channel==='community:searchContinue') {
      const [id,continuation]=args,s=sessions.get(id);assert(s,'Fixture continuation requires its original session');record('continue',{requestId:id,continuation})
      if(continuation.cursor!==snapshot(s).cursor)throw Error('Synthetic stale continuation cursor')
      s.cancelled=false
      if(continuation.mode==='page'){s.visible+=20;s.revision++;s.phase='ready';return snapshot(s)}
      assert.equal(continuation.mode,'discover');s.phase='enriching';s.revision++;emit(snapshot(s));await new Promise(resolve=>setTimeout(resolve,replyDelayMs));s.confirmed=Math.min(45,s.confirmed+5);s.phase='ready';s.revision++;const value=snapshot(s);emit(value);return value
    }
    if(channel==='community:files'){record('files',{source:args[0],projectId:args[1],filter:args[2]});return [{source:args[0],projectId:args[1],fileId:'qa123-public-file',fileName:'qa123-not-downloaded.jar',version:'synthetic UI only',url:'https://example.invalid/qa123-not-downloaded.jar',sha1:'0'.repeat(40),size:1024,gameVersions:['1.20.1'],loaders:['fabric'],date:'2026-10-14T00:00:00Z',releaseType:'release'}]}
    if(channel==='community:project'){record('project',{source:args[0],projectId:args[1],kind:args[2]});return {source:args[0],projectId:args[1],title:'合成已确认模组',kind:'mod',categories:[],description:'仅界面夹具'}}
    return undefined
  }
  return {call,records,updates,sessions,get lastId(){return lastId},get legacyCalls(){return legacyCalls},setPhase(value){assert(['partial','empty','failed','reject','cached'].includes(value));phase=value},
    ready(id=lastId){const s=sessions.get(id);assert(s);s.confirmed=40;s.phase='ready';s.revision++;const value=snapshot(s);emit(value);return value},
    emitStale(id=lastId,revision=1,marker='STALE-123-MUST-NOT-RENDER'){const s=sessions.get(id);assert(s);emit(snapshot(s,{revision,marker}));},
    inspect(){return {records:copy(records),updates:copy(updates),sessions:[...sessions.values()].map(s=>({requestId:s.id,query:copy(s.query),revision:s.revision,phase:s.phase,cancelled:s.cancelled})),classification:'Controlled fixture only; no real service/download/installed-game qualification'}}
  }
}
function validateUiProof(proof,{version=VERSION,platform,arch,runtimeVersion}={}) {
  assert.equal(proof.version,version);assert.equal(proof.complete,true);assert.deepEqual(proof.errors,[])
  if(platform)assert.equal(proof.runtime.platform,platform);if(arch)assert.equal(proof.runtime.arch,arch);if(runtimeVersion)assert.equal(proof.runtime.electron,runtimeVersion)
  const expected=combinations().map(key).sort();assert.equal(proof.matrix.length,expected.length);assert.equal(new Set(proof.matrix.map(key)).size,expected.length);assert.deepEqual(proof.matrix.map(key).sort(),expected)
  for(const row of proof.matrix)for(const flag of FLAGS)assert.equal(row[flag],true,'Required changed-scope evidence missing: '+flag)
  assert(proof.images.length>=expected.length*CAPTURES.length,'Every required visible state needs an original capture')
  const names=new Set(proof.images.map(image=>image.file));assert.equal(names.size,proof.images.length,'Original image filenames must be unique')
  for(const combo of combinations())for(const state of CAPTURES)assert(names.has(capturePrefix(combo)+'-'+state+'.png'),'Required actual state image missing: '+capturePrefix(combo)+'-'+state)
  for(const image of proof.images){assert(/^[a-f0-9]{64}$/.test(image.sha256));assert(Number.isSafeInteger(image.bytes)&&image.bytes>0);assert(!image.file.includes('/')&&!image.file.includes('\\'))}
  assert(proof.actions.length>=expected.length*8);assert(proof.actions.every(a=>['coordinate-click','coordinate-scroll','chromium-input'].includes(a.type)));assert(proof.receiverEvents.some(e=>e.type==='click'&&e.isTrusted===true));assert(proof.receiverEvents.some(e=>e.type==='input'&&e.isTrusted===true))
  assert(proof.rendererFiles.length>0&&proof.rendererFiles.some(f=>f.file==='index.html'))
  return true
}
module.exports={VERSION,THEMES,FLAGS,CAPTURES,capturePrefix,combinations,createSearchFixture,validateUiProof,sha:b=>crypto.createHash('sha256').update(b).digest('hex')}
