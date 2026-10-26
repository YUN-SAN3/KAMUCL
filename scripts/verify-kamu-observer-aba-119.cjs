// Explicit instrumentation-only SCK A/B/A. Never normal FPS/visual acceptance.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto'),{spawn,execFile}=require('node:child_process'),{promisify}=require('node:util')
const {installRendererObserver,withRestoration}=require('./verify-kamu-native-compositor-119.cjs')
const {nativeVideoSnapshot,captureRequest,captureStatistics,stopOwnedHelper,verifyPixels}=require('./verify-kamu-native-video-119.cjs')
const {assertSameWindow,introSettled}=require('./verify-kamu-native-recorder-119.cjs')
const ownedQA=require('./qa-owned-process-119.cjs')
function observerCases(){return[
 {name:'clocks-A-original',group:'clocks',role:'A',options:{probeClocks:true,queryFeedback:true,measureProbe:true}},
 {name:'clocks-B-no-extra-clocks',group:'clocks',role:'B',options:{probeClocks:false,queryFeedback:true,measureProbe:true}},
 {name:'clocks-A-restored',group:'clocks',role:'A',options:{probeClocks:true,queryFeedback:true,measureProbe:true}},
 {name:'queries-A-original',group:'queries',role:'A',options:{probeClocks:true,queryFeedback:true,measureProbe:true}},
 {name:'queries-B-no-feedback-queries',group:'queries',role:'B',options:{probeClocks:true,queryFeedback:false,measureProbe:true}},
 {name:'queries-A-restored',group:'queries',role:'A',options:{probeClocks:true,queryFeedback:true,measureProbe:true}}
]}
function traceControlCases(){return['control-A-before','trace-A','control-A-restored'].map((name,index)=>({name,group:'trace-control',role:'A',trace:index===1,options:{probeClocks:true,queryFeedback:true,measureProbe:true}}))}
async function runDiagnosticCase(h,entry,action,dependencies={}){
 if(!entry.trace)return action()
 const trace=dependencies.trace||require('./native-compositor-trace-119.cjs'),cpu=dependencies.cpu||require('./native-cpu-profile-119.cjs').withCPUProfile
 return cpu(h,path.join(entry.directory,'trace'),()=>trace(h,action,{enabled:true,separateRun:true,outputBase:path.join(entry.directory,'trace'),completionTimeoutMs:20000,maxBytes:32*1024*1024}))
}
function assertNormalMotion(state){
 assert.equal(state.motion?.noPreference,true,'observer ABA requires actual no-preference media')
 assert.equal(state.motion?.reduced,false,'observer ABA cannot run in reduced-motion media')
 assert.equal(state.motion?.stageReduced,false,'same actual ready stage must retain normal palm rendering')
}
async function requireNormalMotion(call,evaluate){
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
 const actual=await evaluate("({noPreference:matchMedia('(prefers-reduced-motion: no-preference)').matches,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches})")
 assert.equal(actual.noPreference,true,'requested media must actually take effect before opening LOGO')
 assert.equal(actual.reduced,false,'reduced-motion media must actually be off before opening LOGO')
 return {requested:'no-preference',actual}
}
function assertSameStage(reference,next){
 assertNormalMotion(reference.state);assertNormalMotion(next.state)
 assertSameWindow(reference.native,next.native)
 assert.equal(next.state.readyAt,reference.state.readyAt,'ABA must retain the same actually prepared mascot')
 assert.equal(next.state.backend,reference.state.backend,'ABA cannot change product backend')
 assert.equal(next.state.bufferPreparation,'ended');assert(next.state.focus&&!next.state.hidden&&!next.state.disabled)
 assert.equal(next.native.ownerPID,reference.native.ownerPID);assert.equal(next.native.zoom,reference.native.zoom)
 assert.deepEqual(next.request,reference.request,'original SCK display/window/crop/backing scale must remain identical')
 assert.deepEqual(next.state.viewport,reference.state.viewport)
}
function assertNaturalAction(before,after,observations,inputs,savedBefore,savedAfter){
 assert.equal(inputs.length,10);assert(inputs.every(input=>input.pressReturned&&input.releaseReturned),'ten exact trusted press/release returns required; no retry')
 assert.equal(after.phase,'front');assert.equal(after.queue,0);assert.equal(after.contacts,before.contacts+10);assert.equal(after.sounds,before.sounds+10)
 assert.equal(savedAfter.counts.kamu,savedBefore.counts.kamu+10);assert.deepEqual(savedAfter.sound,savedBefore.sound)
 for(const key of Object.keys(savedBefore.counts))if(key!=='kamu')assert.equal(savedAfter.counts[key],savedBefore.counts[key],'legacy counts intact')
 assert.equal(observations.sources.length,10);assert(observations.sources.every(source=>source.role==='palm'&&source.state==='running'&&!source.hidden))
 assert(observations.sources.slice(1).every((source,index)=>source.at-observations.sources[index].at>=90),'original native source spacing')
 assert(observations.samples.length>=2);assert(observations.samples.every(sample=>sample.focus&&!sample.hidden&&sample.queue>=0&&sample.queue<=32))
 assert(observations.samples.slice(1).every((sample,index)=>sample.contacts-observations.samples[index].contacts<=1),'no catch-up contacts in one actual callback')
 const seen=new Set(observations.samples.filter(sample=>sample.phase==='slap').map(sample=>sample.contacts))
 assert(Array.from({length:10},(_,index)=>before.contacts+index+1).every(contact=>seen.has(contact)),'each actual contact requires an observed slap phase')
 if(observations.instrumentation?.queryFeedback!==false){const visible=new Set(observations.samples.filter(sample=>sample.phase==='slap'&&sample.palm>0).map(sample=>sample.contacts));assert(Array.from({length:10},(_,index)=>before.contacts+index+1).every(contact=>visible.has(contact)),'queried cases retain each visible palm sample; raw SCK remains independent')}
}
function assertCaptureIdentity(request,identity){
 assert.equal(identity.displayID,request.displayID);assert.equal(identity.ownerPID,request.ownerPID)
 assert.deepEqual(identity.windowBounds,request.windowBounds);assert.deepEqual(identity.globalCrop,request.crop);assert.equal(identity.backingScaleFactor,request.expectedScale)
 assert.equal(identity.pixelFormat,'BGRA8');assert.equal(identity.minimumFrameInterval.numeric,true);assert.equal(identity.minimumFrameInterval.seconds,0);assert.equal(identity.queueDepth,5)
}

async function diagnostic(h,{traceControl=false}={}){
 const {main,evaluate,call,nav,wait,version}=h
 assert.equal(await main('process.platform'),'darwin','observer ABA requires actual Darwin')
 const theme=process.env.KAMUCL_TEST_THEME||'black-orange',stem=`kamu-observer-${traceControl?'trace-control':'aba'}-119-${randomUUID()}-${theme}`,root=path.resolve('out',stem),file=path.join(root,'observer-aba.json'),configs=traceControl?traceControlCases():observerCases()
 assert(!fs.existsSync(root),'immutable new diagnostic root required');fs.mkdirSync(root,{recursive:true})
 const proof={version,stage:stem,complete:false,functionalComplete:false,classification:'Instrumentation-only observer SCK A/B/A; never replaces formal header/native baselines or their failures',normalAcceptanceChanged:false,physicalListening:'not performed',originalSourceSpacingMs:90,cases:[],startedAt:new Date().toISOString()}
 proof.classification=traceControl?'Independent 3 A control/trace/control after original formal and six-case ABA; CPU/trace overhead cannot establish normal acceptance':proof.classification
 proof.sourceSHA256=createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');proof.stateQueries=[]
 proof.ownedBefore=h.ownedTrack?await ownedQA.ownedInventory([h.ownedTrack]):null
 const persist=()=>fs.writeFileSync(file,JSON.stringify(proof,null,2)),saved=()=>evaluate("window.kamucl.invoke('mascots:state')")
 const native=()=>main(`(${nativeVideoSnapshot.toString()})(testElectron,process.pid)`)
 const state=()=>ownedQA.measuredStateQuery(()=>evaluate(`(()=>{const e=document.querySelector('.mascot-stage'),strip=e?.querySelector('.figure-strip'),r=strip?.getBoundingClientRect(),b=document.querySelector('[data-hit=kamu]');return{now:performance.now(),timeOrigin:performance.timeOrigin,open:!!e,readyAt:Number(e?.dataset.readyAt),activation:Number(e?.dataset.activation),introAnimations:strip?.getAnimations().filter(a=>a.playState!=='finished'&&a.playState!=='idle').length,footprint:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,phase:e?.dataset.phase,queue:Number(e?.dataset.queue),contacts:Number(e?.dataset.contacts||0),sounds:Number(e?.dataset.soundsPlayed||0),disabled:b?.disabled,hidden:document.hidden,focus:document.hasFocus(),bufferPreparation:e?.dataset.audioPreparation,motion:{noPreference:matchMedia('(prefers-reduced-motion: no-preference)').matches,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,stageReduced:e?.classList.contains('reduced')??null},viewport:{width:innerWidth,height:innerHeight,scale:visualViewport?.scale??1},backend:e?.dataset.renderBackend}})()`),proof.stateQueries)
 const until=async(label,predicate,ms=6000)=>{const began=Date.now();let last;do{last=await state();if(await predicate(last))return last;await wait(30)}while(Date.now()-began<ms);proof.failureState={label,last};persist();assert.fail(label)}
 const click=async selector=>{
  const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Missing observer ABA target');const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);if(h!==e&&!e.contains(h))throw Error('Occluded observer ABA target');return{x,y}})()`)
  const input={position:p,pressAt:Date.now()};input.pressResult=await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});input.pressReturned=true;input.releaseAt=Date.now();input.releaseResult=await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});input.releaseReturned=true;return input
 }
 const sampleReference=async()=>{const next={native:await native(),state:await state()};next.request=captureRequest(next.native,next.state);return next}
 let ownsStage=false,observerAttempted=false,outerFailure
 try{
  persist();await nav('skins');assert.equal((await state()).open,false,'previous module must close its own stage')
  proof.preferencesBefore=(await saved()).sound;assert(!proof.preferencesBefore.muted&&proof.preferencesBefore.volume>0)
  proof.runtime=await main('({electron:process.versions.electron,chrome:process.versions.chrome,gpuFeatureStatus:testElectron.app.getGPUFeatureStatus()})')
  proof.motionMode=await requireNormalMotion(call,evaluate)
  ownsStage=true;await click('.brand-avatar');proof.ready=await until('same actual mascot ready and entrance complete',s=>s.open&&!s.disabled&&s.readyAt>0&&s.bufferPreparation==='ended'&&s.phase==='front'&&s.queue===0&&introSettled(s))
  assertNormalMotion(proof.ready)
  proof.renderer=await evaluate(`(()=>{const e=document.querySelector('.mascot-stage'),canvas=e.querySelector('.figure-strip canvas'),context=e.dataset.renderBackend==='canvas2d-depth'?canvas.getContext('2d'):null;return{rendererProbe:e.dataset.rendererProbe,fallback:e.dataset.gpuReadyFallback,canvasWidth:canvas.width,canvasHeight:canvas.height,contextAttributes:context?.getContextAttributes?.()??null}})()`)
  proof.reference=await sampleReference()
  const source=path.resolve('scripts/mac-logo-capture-119.swift'),binary=path.join(root,'mac-logo-capture')
  proof.compile={sourceSHA256:createHash('sha256').update(fs.readFileSync(source)).digest('hex'),startedAt:new Date().toISOString()};persist()
  try{const output=await promisify(execFile)('/usr/bin/xcrun',['swiftc','-parse-as-library',source,'-o',binary,'-framework','ScreenCaptureKit','-framework','AppKit','-framework','CoreMedia','-framework','CoreVideo','-framework','QuartzCore'],{timeout:20000,maxBuffer:1024*1024});fs.writeFileSync(path.join(root,'compile.log'),output.stdout+output.stderr);proof.compile.success=true;proof.compile.binarySHA256=createHash('sha256').update(fs.readFileSync(binary)).digest('hex')}
  catch(error){fs.writeFileSync(path.join(root,'compile.log'),String(error.stdout||'')+String(error.stderr||'')+String(error));throw error}
  finally{proof.compile.finishedAt=new Date().toISOString();persist()}
  assert.equal(await evaluate('!!window.__kamuCompositorDiag'),false,'never replace an existing observer');observerAttempted=true;proof.observer=await evaluate(`(${installRendererObserver.toString()})()`)
  for(const config of configs){
   const entry={...config,directory:path.join(root,config.name),complete:false,classification:'Instrumentation diagnostic only',startedAt:new Date().toISOString()};proof.cases.push(entry);fs.mkdirSync(entry.directory);persist()
   entry.stateQueryStart=proof.stateQueries.length
   let child,childTrack,exitPromise,operationError;const exitState={exited:false},read=name=>JSON.parse(fs.readFileSync(path.join(entry.directory,name),'utf8'))
   const awaitFile=async(name,ms=5000)=>{const begin=Date.now();while(!fs.existsSync(path.join(entry.directory,name))){if(exitState.exited)throw Error('Owned SCK helper exited before '+name+': '+JSON.stringify(exitState));if(Date.now()-begin>=ms)throw Error('Owned SCK '+name+' timed out');await wait(20)}return read(name)}
   const mark=async name=>{fs.writeFileSync(path.join(entry.directory,name+'.request'),'requested');return awaitFile(name+'.json',2000)}
   const perform=async()=>{
    await withRestoration(async()=>{
     entry.before=await sampleReference();assertSameStage(proof.reference,entry.before);entry.savedBefore=await saved();fs.writeFileSync(path.join(entry.directory,'request.json'),JSON.stringify(entry.before.request,null,2))
     await evaluate(`window.__kamuCompositorDiag.start(${JSON.stringify(config.options)})`)
     child=spawn(binary,[path.join(entry.directory,'request.json'),entry.directory],{stdio:['ignore','pipe','pipe']});entry.helperPID=child.pid
     childTrack=ownedQA.trackOwnedChild(child,'owned-SCK-'+config.name);entry.ownedHelper=childTrack.ledger
     const output=fs.createWriteStream(path.join(entry.directory,'helper.log'),{flags:'wx'});child.stdout.pipe(output,{end:false});child.stderr.pipe(output,{end:false})
     exitPromise=new Promise((resolve,reject)=>{child.once('error',error=>{exitState.exited=true;exitState.error=String(error);output.end();reject(error)});child.once('close',(code,signal)=>{Object.assign(exitState,{exited:true,code,signal});output.end();resolve({code,signal})})});exitPromise.catch(()=>{})
     entry.nativeFirstFrame=await awaitFile('ready.json');assertCaptureIdentity(entry.before.request,entry.nativeFirstFrame.identity);entry.atFirstFrame=await sampleReference();assertSameStage(proof.reference,entry.atFirstFrame)
     entry.startMarker=await mark('clicks-start');entry.inputs=[]
     for(let i=0;i<10;i++)entry.inputs.push({ordinal:i+1,...await click('[data-hit=kamu]')})
     entry.actionComplete=await until(config.name+' ten actual contacts/sources saved and natural front',async s=>s.phase==='front'&&s.queue===0&&s.contacts===entry.before.state.contacts+10&&s.sounds===entry.before.state.sounds+10&&(await saved()).counts.kamu===(entry.savedBefore.counts.kamu||0)+10)
     entry.completeMarker=await mark('action-complete');await wait(250);entry.after=await sampleReference();assertSameStage(proof.reference,entry.after);entry.savedAfter=await saved()
    },async()=>{if(child?.pid){entry.helperExit=await stopOwnedHelper(child,exitPromise,()=>fs.writeFileSync(path.join(entry.directory,'stop.request'),'stop owned stream'));persist();assert.equal(entry.helperExit.code,0)}},async()=>{entry.observations=await evaluate('window.__kamuCompositorDiag.stop()');persist()})
    entry.capture=read('capture.json');assert(entry.capture.complete&&entry.capture.streamStopped);assertCaptureIdentity(entry.before.request,entry.capture.identity)
    entry.nativeCadence=captureStatistics(entry.capture,{start:entry.startMarker,complete:entry.completeMarker});assert(entry.nativeCadence.changedPixelCount>=3,'original native pixels must actually change')
    entry.nativeDeliveryBenchmark=require('./mascot-capture-budget.cjs')(entry.before.native,entry.nativeCadence.completeDeliveryFps)
    assertNaturalAction(entry.before.state,entry.after.state,entry.observations,entry.inputs,{...entry.savedBefore,counts:{...entry.savedBefore.counts,kamu:entry.savedBefore.counts.kamu||0}},entry.savedAfter)
    entry.functionalComplete=true
   }
   try{await runDiagnosticCase(h,entry,perform)
   }catch(error){operationError=error;entry.error=String(error);if(error.errors)entry.errors=error.errors.map(String);throw error}
   finally{try{if(fs.existsSync(path.join(entry.directory,'capture.json'))){entry.capture??=read('capture.json');entry.pngs=await verifyPixels(entry.directory,entry.capture)}entry.complete=!operationError&&entry.functionalComplete===true&&!!entry.pngs?.length}
    catch(error){entry.complete=false;entry.pixelVerificationError=String(error);throw operationError?new AggregateError([operationError,error],'ABA action and original pixel verification both failed'):error}
    finally{entry.stateQueryEnd=proof.stateQueries.length;entry.ownedAfter=await ownedQA.ownedInventory([...(h.ownedTrack?[h.ownedTrack]:[]),...(childTrack?[childTrack]:[])]);entry.finishedAt=new Date().toISOString();persist()}}
  }
  proof.functionalComplete=true
 }catch(error){outerFailure=error;proof.error=String(error);if(error.errors)proof.errors=error.errors.map(String)}
 finally{
  await withRestoration(async()=>{if(outerFailure)throw outerFailure},async()=>{if(observerAttempted&&await evaluate('!!window.__kamuCompositorDiag')){proof.observerRestored=await evaluate('window.__kamuCompositorDiag.restore()');persist();assert(proof.observerRestored.restored&&proof.observerRestored.observerRemoved,'all original hooks and observation resources must restore')}},async()=>{try{if(ownsStage&&(await state()).open){await click('.menu-tool');await click('.sound-panel button:last-of-type');await until('owned ABA stage closed',s=>!s.open)}proof.preferencesAfter=(await saved()).sound;if(proof.preferencesBefore)assert.deepEqual(proof.preferencesAfter,proof.preferencesBefore);proof.stageClosed=!(await state()).open}finally{proof.complete=proof.functionalComplete&&proof.stageClosed===true&&proof.cases.length===configs.length&&proof.cases.every(entry=>entry.complete)&&proof.observerRestored?.restored===true;proof.finishedAt=new Date().toISOString();persist()}})
 }
 console.log('OBSERVER ABA diagnostic complete; original below-target values retained; not formal acceptance: '+file)
 return proof
}
module.exports=diagnostic
module.exports.observerCases=observerCases
module.exports.assertSameStage=assertSameStage
module.exports.assertNaturalAction=assertNaturalAction
module.exports.assertCaptureIdentity=assertCaptureIdentity

module.exports.assertNormalMotion=assertNormalMotion
module.exports.requireNormalMotion=requireNormalMotion
module.exports.traceControlCases=traceControlCases
module.exports.runDiagnosticCase=runDiagnosticCase
