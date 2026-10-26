// Optional CPU samples in the independently traced A only; never FPS acceptance.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto')
const publicFunctions=new Set(['renderFigure','advance','present','animate','recordContacts','tick','render','draw','scheduleFrame','renderScene','project','rasterize','paintTriangle','renderPart'])
const metaFunctions=new Set(['(root)','(program)','(idle)','(garbage collector)'])
function filterProfile(profile,assets){
 assert(Array.isArray(profile.nodes)&&Array.isArray(profile.samples)&&Array.isArray(profile.timeDeltas),'actual CPU nodes/samples/deltas required')
 assert(Number.isFinite(profile.startTime)&&Number.isFinite(profile.endTime)&&profile.endTime>=profile.startTime,'actual CPU monotonic interval required')
 const ids=new Set(profile.nodes.map(n=>n.id));assert(ids.size===profile.nodes.length&&[...ids].every(n=>Number.isSafeInteger(n)&&n>0),'unique original CPU node IDs required')
 for(const [url,basename] of assets){const parsed=new URL(url);assert(parsed.protocol==='file:'&&!parsed.search&&!parsed.hash&&/^[A-Za-z0-9_.-]+\.js$/.test(basename)&&decodeURIComponent(parsed.pathname.split('/').at(-1))===basename,'exact static asset URL/basename inventory required')}
 const parents=new Map();for(const node of profile.nodes)for(const child of node.children||[]){assert(ids.has(child)&&!parents.has(child),'unique original CPU parent/child references required');parents.set(child,node.id)}
 for(const id of ids){const seen=new Set();for(let at=id;at!==undefined;at=parents.get(at)){assert(!seen.has(at),'original CPU tree cannot be cyclic');seen.add(at)}}
 assert(profile.samples.length===profile.timeDeltas.length&&profile.samples.every(n=>ids.has(n))&&profile.timeDeltas.every(n=>Number.isFinite(n)&&n>=0),'original sample references and nonnegative deltas required')
 const nodes=profile.nodes.map(node=>{
  assert(!node.children||node.children.every(id=>ids.has(id)),'actual CPU child references required')
  const frame=node.callFrame||{},asset=assets.get(frame.url),name=frame.functionName||''
  assert(typeof frame.url==='string'&&typeof frame.functionName==='string'&&typeof frame.scriptId==='string'&&Number.isInteger(frame.lineNumber)&&Number.isInteger(frame.columnNumber),'original CPU call-frame metadata required')
  assert(node.hitCount===undefined||Number.isSafeInteger(node.hitCount)&&node.hitCount>=0,'original CPU hit count required')
  const publicName=asset&&(publicFunctions.has(name)||/^[A-Za-z_$][A-Za-z0-9_$]{0,2}$/.test(name)),meta=!frame.url&&metaFunctions.has(name)
  const result={id:node.id,callFrame:publicName?{functionName:name,asset,scriptId:frame.scriptId,lineNumber:frame.lineNumber,columnNumber:frame.columnNumber}:meta?{functionName:name,classification:'CPU runtime metadata'}:{redacted:true}}
  if(node.children!==undefined)result.children=node.children
  if(node.hitCount!==undefined)result.hitCount=node.hitCount
  return result
 })
 return{startTime:profile.startTime,endTime:profile.endTime,nodes,samples:[...profile.samples],timeDeltas:[...profile.timeDeltas],classification:'Filtered CPU original samples only; not a complete source/stack inventory or performance acceptance',privacy:'Exact runtime static asset URL equality plus public render names or <=3 character static minified identifiers. Arbitrary URLs/function names/deopt reasons are removed; full original is private.',limitations:'Only this projection is archived publicly and can be independently audited. Full original CPU is temporary remote-private data with digest/size provenance, not publicly archived or locally byte-verified. Missing or redacted frames/events cannot establish absence of compilation, GC, layout or any cause. CPU sampling/tracing overhead prevents no-trace acceptance.'}
}
async function runtimeAssets(h){
 const inventory=await h.main(`(()=>{const fs=process.mainModule.require('node:fs'),path=process.mainModule.require('node:path'),url=process.mainModule.require('node:url'),wins=testElectron.BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()&&/\\/renderer\\/index\\.html$/.test(w.webContents.getURL()));if(wins.length!==1)throw Error('Ambiguous static asset target');const entry=url.fileURLToPath(wins[0].webContents.getURL());if(!entry.replaceAll('\\\\','/').endsWith('/Contents/Resources/app.asar/out/renderer/index.html'))throw Error('CPU profiling requires the actual packaged static renderer');const dir=path.join(path.dirname(entry),'assets');return fs.readdirSync(dir).filter(n=>/^[A-Za-z0-9_.-]+\\.js$/.test(n)).map(name=>({name,url:url.pathToFileURL(path.join(dir,name)).href}))})()`)
 assert(inventory.length>0,'actual static JS inventory required')
 return new Map(inventory.map(row=>[row.url,row.name]))
}
async function withCPUProfile(h,base,action,{assets,writePrivate,writePublic}={}){
 const proof={classification:'Separate traced A CPU sampling; no formal acceptance',complete:false,intervalMicroseconds:1000,normalAcceptanceChanged:false,startedAt:new Date().toISOString()}
 const save=()=>writePublic?writePublic(proof):fs.writeFileSync(base+'-cpu.json',JSON.stringify(proof,null,2))
 let actionError,collectionError,value,started=false
 try{
  assets??=await runtimeAssets(h);proof.staticAssets=[...new Set(assets.values())]
  proof.before=await h.evaluate('({now:performance.now(),timeOrigin:performance.timeOrigin})')
  proof.hostBefore=Number(process.hrtime.bigint())/1e6
  await h.call('Profiler.enable');await h.call('Profiler.setSamplingInterval',{interval:1000});await h.call('Profiler.start');started=true
  try{value=await action()}catch(error){actionError=error;proof.actionFailure=error.name}
 }catch(error){collectionError=error;proof.collectionFailure=error.name}
 finally{
  if(started)try{
   const {profile}=await h.call('Profiler.stop'),bytes=Buffer.from(JSON.stringify(profile));assert(bytes.length<=8*1024*1024,'CPU original exceeds bounded 8 MiB diagnostic size');const privateSHA256=createHash('sha256').update(bytes).digest('hex')
   if(writePrivate)writePrivate(bytes);else{const dir=path.resolve('out','private-native-cpu119-'+randomUUID());fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'cpu-profile-private.json'),bytes,{flag:'wx'})}
   proof.privateOriginalSHA256=privateSHA256;proof.privateOriginalBytes=bytes.length;proof.filteredProfile=filterProfile(profile,assets)
   proof.traceClock=value?.clock??null;proof.clockCorrelation={traceMarkerInsideOriginalProfile:Number.isFinite(value?.clock?.traceTimestamp)&&value.clock.traceTimestamp>=profile.startTime&&value.clock.traceTimestamp<=profile.endTime,limitations:'Original renderer performance.now/timeOrigin, host request brackets, trace marker microseconds and CPU start/end remain separate fields. Marker inclusion tests numerical domain compatibility only; no interpolated samples, continuous stack or causal/exclusive CPU claim.'}
   proof.after=await h.evaluate('({now:performance.now(),timeOrigin:performance.timeOrigin})');proof.hostAfter=Number(process.hrtime.bigint())/1e6
   proof.profileStopped=true
  }catch(error){collectionError??=error;proof.collectionFailure=error.name}
  try{await h.call('Profiler.disable');proof.disabled=true}catch(error){collectionError??=error;proof.disableFailure=error.name}
  proof.finishedAt=new Date().toISOString();proof.complete=proof.profileStopped===true&&proof.disabled===true&&!actionError&&!collectionError;save()
 }
 if(actionError&&collectionError)throw new AggregateError([actionError,collectionError],'traced action and CPU collection failed')
 if(actionError)throw actionError
 if(collectionError)throw collectionError
 return value
}
module.exports={filterProfile,runtimeAssets,withCPUProfile}
