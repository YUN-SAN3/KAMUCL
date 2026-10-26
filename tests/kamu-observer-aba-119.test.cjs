const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm')
const {installRendererObserver}=require('../scripts/verify-kamu-native-compositor-119.cjs'),{assertSameStage,assertNaturalAction,assertCaptureIdentity,observerCases}=require('../scripts/verify-kamu-observer-aba-119.cjs')
function fixture(){
 let time=100,mutation,styleReads=0,animationReads=0,clockReads=0,next=0
 const raf=new Map(),timers=new Map(),observers=[]
 const animation={currentTime:12,playState:'running',effect:{getComputedTiming:()=>({duration:75,localTime:12,progress:.16})}}
 const palm={getAnimations(){animationReads++;return[animation]}},print={getAnimations(){animationReads++;return[]}}
 const stage={dataset:{phase:'slap',queue:'2',contacts:'1',soundsPlayed:'1',cycleId:'5',contactAt:'88',palmAnimationPhase:'retreat',printAnimationPhase:'fade',renderMs:'.5',renderNow:'100'},querySelector:selector=>selector==='.pixel-palm'?palm:print}
 class Canvas2D{putImageData(){return 123}}
 class BufferSource{constructor(){this.buffer={duration:.075};this.context={currentTime:1,state:'running'}}start(){return 456}}
 const originals={put:Canvas2D.prototype.putImageData,start:BufferSource.prototype.start},window={addEventListener(){},removeEventListener(){}}
 const ctx=vm.createContext({window,Element:class{},CanvasRenderingContext2D:Canvas2D,AudioBufferSourceNode:BufferSource,document:{hidden:false,hasFocus:()=>true,querySelector:()=>stage,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}},performance:{now:()=>{clockReads++;return time}},getComputedStyle(){styleReads++;time+=1.5;return{opacity:'.84',transform:'matrix(1,0,0,1,0,0)'}},MutationObserver:class{constructor(cb){mutation=cb;observers.push(this)}observe(){}disconnect(){this.disconnected=true}},requestAnimationFrame:cb=>{raf.set(++next,cb);return next},cancelAnimationFrame:id=>raf.delete(id),setInterval:(cb,ms)=>{assert.equal(ms,16);timers.set(++next,cb);return next},clearInterval:id=>timers.delete(id),PerformanceObserver:class{observe(){}takeRecords(){return[]}disconnect(){}}})
 vm.runInContext(`(${installRendererObserver.toString()})()`,ctx)
 return{p:window.__kamuCompositorDiag,window,originals,Canvas2D,BufferSource,raf,timers,observers,mutation:()=>mutation(),reads:()=>({styleReads,animationReads,clockReads}),time:()=>time}
}
test('formal observer defaults retain original queries, clocks, timestamp and output without diagnostic overhead',()=>{
 const f=fixture();f.p.start();const before=f.reads();f.mutation();const after=f.reads(),o=f.p.stop()
 assert.equal(after.clockReads-before.clockReads,1,'original sample timestamp only, no diagnostic entry/exit timers')
 assert.equal(after.styleReads-before.styleReads,2);assert.equal(after.animationReads-before.animationReads,2)
 assert.equal(o.samples[0].at,103);assert.equal(o.samples[0].palm,.84)
 assert.equal(Object.hasOwn(o,'instrumentation'),false)
 for(const key of ['observerEnteredAt','observerFinishedAt','observerDurationMs'])assert.equal(Object.hasOwn(o.samples[0],key),false)
 assert.equal(f.raf.size,0);assert.equal(f.timers.size,0);assert(f.p.restore().restored)
})
test('diagnostic options reject accidental global observer changes before acquiring resources',()=>{
 const f=fixture();for(const option of [null,{}, {probeClocks:0},{queryFeedback:'false'},{unknown:true}]){
  if(option&&Object.keys(option).length===0)continue
  assert.throws(()=>f.p.start(option),/Invalid/);assert.equal(f.p.watch,null);assert.equal(f.raf.size,0);assert.equal(f.timers.size,0)
 }assert(f.p.restore().restored)
})
test('probe-only ABA preserves real sources, queries and observer timing while removing only extra clocks',()=>{
 const f=fixture()
 for(const probes of [true,false,true]){
  const prior=f.reads();f.p.start({probeClocks:probes,measureProbe:true});assert.equal(f.raf.size,probes?1:0);assert.equal(f.timers.size,probes?1:0)
  assert.equal(new f.BufferSource().start(),456,'original sound method is invoked once and returns its original result');f.mutation()
  const stopped=f.p.stop();assert.equal(stopped.sources.length,1);assert.equal(stopped.sources[0].role,'palm');assert.equal(stopped.samples.length,1);assert.equal(stopped.samples[0].observerDurationMs,3)
  if(!probes){assert.equal(stopped.raf,null);assert.equal(stopped.timers,null)}else{assert(Array.isArray(stopped.raf));assert(Array.isArray(stopped.timers))}
  assert.equal(stopped.samples[0].observerEnteredAt+3,stopped.samples[0].observerFinishedAt);assert.equal(f.reads().styleReads-prior.styleReads,2);assert.equal(f.reads().animationReads-prior.animationReads,2)
  assert.equal(f.raf.size,0);assert.equal(f.timers.size,0);assert(f.observers.at(-1).disconnected)
 }
 assert(f.p.restore().restored);assert.equal(f.BufferSource.prototype.start,f.originals.start);assert.equal(f.Canvas2D.prototype.putImageData,f.originals.put)
})
test('query-only ABA retains clocks and sources, omits queries explicitly and restores exact timing reads',()=>{
 const f=fixture()
 for(const queries of [true,false,true]){
  const prior=f.reads();f.p.start({queryFeedback:queries,measureProbe:true});assert.equal(f.raf.size,1);assert.equal(f.timers.size,1);new f.BufferSource().start();f.mutation()
  const stopped=f.p.stop(),sample=stopped.samples[0];assert.equal(stopped.sources.length,1)
  assert.equal(f.reads().styleReads-prior.styleReads,queries?2:0);assert.equal(f.reads().animationReads-prior.animationReads,queries?2:0);assert.equal(sample.observerDurationMs,queries?3:0)
  if(!queries){assert.equal(sample.palm,null);assert.equal(sample.palmAnimation.animations,null);assert.match(sample.palmAnimation.omitted,/disabled/)}else assert.equal(sample.palmAnimation.animations[0].currentTime,12)
 }
 assert(f.p.restore().restored)
})
test('overlap, changed hook and interrupted observation cannot masquerade as restored clean ABA',()=>{
 const f=fixture();f.p.start();assert.throws(()=>f.p.start({probeClocks:false}),/Overlapping/)
 f.BufferSource.prototype.start=()=>789;const restored=f.p.restore();assert.equal(restored.restored,false);assert(restored.checks.some(row=>!row.untouched));assert.equal(f.BufferSource.prototype.start,f.originals.start);assert.equal(f.raf.size,0);assert.equal(f.timers.size,0);assert.equal(f.window.__kamuCompositorDiag,undefined)
})
function references(){return{native:{windowId:2,webContentsId:2,bounds:{x:280,y:54,width:1280,height:900},backgroundThrottling:true,visible:true,focused:true,minimized:false,appHidden:false},state:{readyAt:123,backend:'canvas2d-depth',bufferPreparation:'ended',motion:{noPreference:true,reduced:false,stageReduced:false},focus:true,hidden:false,disabled:false,viewport:{width:1280,height:900,scale:1}},request:{displayID:1,ownerPID:123,windowBounds:{x:280,y:54,width:1280,height:900},crop:{x:285,y:89,width:72,height:96},expectedScale:1}}}
test('ABA identity rejects ready changes, native replacement, crop changes and background states',()=>{
 for(const change of [x=>x.state.readyAt++,x=>x.native.windowId++,x=>x.request.crop.width++,x=>x.state.focus=false,x=>x.native.focused=false,x=>x.state.backend='webgl-pbr']){
  const before=references(),after=structuredClone(before);change(after);assert.throws(()=>assertSameStage(before,after))
 }
 assertSameStage(references(),references())
})
test('action guards retain count, source, persistence, spacing and foreground failures independent of instrumentation',()=>{
 const before={contacts:0,sounds:0},after={phase:'front',queue:0,contacts:10,sounds:10},savedBefore={counts:{kamu:20,other:99},sound:{volume:.45,muted:false}},savedAfter={counts:{kamu:30,other:99},sound:{volume:.45,muted:false}},inputs=Array.from({length:10},()=>({pressReturned:true,releaseReturned:true})),observations={sources:Array.from({length:10},(_,i)=>({at:i*150,role:'palm',state:'running',hidden:false})),samples:Array.from({length:11},(_,i)=>({contacts:i,phase:'slap',palm:.84,focus:true,hidden:false,queue:10-i}))}
 assertNaturalAction(before,after,observations,inputs,savedBefore,savedAfter)
 for(const mutate of [x=>x.after.contacts--,x=>x.savedAfter.counts.kamu--,x=>x.inputs.pop(),x=>x.observations.sources[1].at=89,x=>x.observations.sources[0].role='silent-slap-buffer',x=>x.observations.samples[0].hidden=true,x=>x.after.phase='return',x=>x.savedAfter.counts.other++,x=>x.observations.samples[5].phase='front',x=>x.observations.samples[5].palm=0]){
  const c=structuredClone({before,after,observations,inputs,savedBefore,savedAfter});mutate(c);assert.throws(()=>assertNaturalAction(c.before,c.after,c.observations,c.inputs,c.savedBefore,c.savedAfter))
 }
})
test('six independent ABA cases change exactly one option and restore A identity',()=>{
 const cases=observerCases();assert.equal(cases.length,6)
 for(const group of [cases.slice(0,3),cases.slice(3)]){
  assert.deepEqual(group.map(c=>c.role),['A','B','A']);assert.deepEqual(group[0].options,group[2].options)
  assert(group.every(c=>c.options.measureProbe===true))
  assert.equal(Object.keys(group[0].options).filter(k=>group[0].options[k]!==group[1].options[k]).length,1)
 }
 assert.equal(cases[1].options.queryFeedback,true);assert.equal(cases[4].options.probeClocks,true)
})
test('native capture identity retains original zero interval, BGRA, queue and geometry contract',()=>{
 const request=references().request,identity={displayID:request.displayID,ownerPID:request.ownerPID,windowBounds:request.windowBounds,globalCrop:request.crop,backingScaleFactor:1,pixelFormat:'BGRA8',minimumFrameInterval:{numeric:true,seconds:0},queueDepth:5}
 assertCaptureIdentity(request,identity)
 for(const mutate of [x=>x.displayID++,x=>x.ownerPID++,x=>x.globalCrop.x++,x=>x.windowBounds.width++,x=>x.backingScaleFactor=2,x=>x.pixelFormat='RGBA8',x=>x.minimumFrameInterval.seconds=1/30,x=>x.queueDepth=3]){
  const next=structuredClone(identity);mutate(next);assert.throws(()=>assertCaptureIdentity(request,next))
 }
})

const qaOwned=require('../scripts/qa-owned-process-119.cjs'),{EventEmitter}=require('node:events')
test('owned cleanup awaits actual close, signals only the tracked child and preserves original failure',async()=>{
 const child=new EventEmitter();Object.assign(child,{pid:431,exitCode:null,signalCode:null,kill(signal){assert.equal(signal,'SIGTERM');setTimeout(()=>{this.signalCode=signal;this.emit('exit',null,signal);this.emit('close',null,signal)},3);return true}})
 const tracked=qaOwned.trackOwnedChild(child,'fixture');await qaOwned.finishOwnedChild(tracked,{terminate:true,timeoutMs:40})
 assert(tracked.ledger.closed&&tracked.ledger.awaitedClose);assert.deepEqual(tracked.ledger.events.map(e=>e.event),['SIGTERM-request','exit','close'])
 const original=Error('actual action failed');await assert.rejects(qaOwned.preservingCleanup(()=>{throw original},async()=>{}),e=>e===original)
 const cleanup=Error('cleanup failed');await assert.rejects(qaOwned.preservingCleanup(()=>{throw original},()=>{throw cleanup}),e=>e instanceof AggregateError&&e.errors[0]===original&&e.errors[1]===cleanup)
})
test('owned timeout remains failure and changed or unowned PID is never signalled',async()=>{
 let signals=0;const child=new EventEmitter();Object.assign(child,{pid:432,exitCode:null,signalCode:null,kill(){signals++;return true}})
 const tracked=qaOwned.trackOwnedChild(child,'hung');await assert.rejects(qaOwned.finishOwnedChild(tracked,{terminate:true,timeoutMs:3}),/timed out/);assert.equal(signals,1);assert(tracked.ledger.failure);assert(!tracked.ledger.awaitedClose)
 child.pid=999;await assert.rejects(qaOwned.finishOwnedChild(tracked,{terminate:true,timeoutMs:3}),/identity/);assert.equal(signals,1)
 assert.throws(()=>qaOwned.trackOwnedChild({pid:undefined},'foreign'),/spawned owned/)
})
test('read-only inventory keeps only numeric owned roots and linked descendants without signalling foreign rows',()=>{
 const text='10 1 S 1.2 1024\n11 10 R 2.3 2048\n12 11 S 0.1 512\n20 1 R 88 4096';assert.deepEqual(qaOwned.selectOwnedInventory(text,[10]).map(r=>r.pid),[10,11,12]);assert(!JSON.stringify(qaOwned.selectOwnedInventory(text,[10])).includes('command'))
})
test('state-query measurements retain returned renderer state and original rejection, including duration',async()=>{
 let time=10;const rows=[],value={now:77,phase:'slap'};assert.equal(await qaOwned.measuredStateQuery(async()=>{time=24;return value},rows,()=>time),value);assert.deepEqual(rows[0],{index:0,requestAt:10,rendererNow:77,returned:true,returnAt:24,durationMs:14})
 const original=Error('CDP timeout');await assert.rejects(qaOwned.measuredStateQuery(async()=>{time=39;throw original},rows,()=>time),e=>e===original);assert.equal(rows[1].durationMs,15);assert.equal(rows[1].returned,false)
})
test('trace cancellation observer restores exact original listener identities and does not delete a foreign listener',()=>{
 const emitter=new EventEmitter(),original=()=>{},foreign=()=>{};emitter.on('SIGTERM',original);let count=0
 let restore=qaOwned.installOwnedCancellation(emitter,()=>count++);emitter.emit('SIGTERM');emitter.emit('SIGTERM');assert.equal(count,1);assert.deepEqual(restore(),{observerRemoved:true,originalListenersPreserved:true});assert.equal(emitter.listeners('SIGTERM')[0],original)
 restore=qaOwned.installOwnedCancellation(emitter,()=>{});emitter.on('SIGTERM',foreign);assert.deepEqual(restore(),{observerRemoved:true,originalListenersPreserved:false});assert.deepEqual(emitter.listeners('SIGTERM'),[original,foreign])
})
test('three independent A controls keep original options/actions; only the middle A traces and profiles',async()=>{
 const {traceControlCases,runDiagnosticCase}=require('../scripts/verify-kamu-observer-aba-119.cjs'),cases=traceControlCases(),calls=[]
 assert.deepEqual(cases.map(c=>c.trace),[false,true,false]);assert(cases.every(c=>JSON.stringify(c.options)===JSON.stringify(observerCases()[0].options)));assert.equal(observerCases().length,6)
 for(const c of cases)await runDiagnosticCase({}, {...c,directory:'fixture'},async()=>calls.push(c.name),{cpu:async(h,base,action)=>{calls.push('CPU-start');try{return await action()}finally{calls.push('CPU-stop')}},trace:async(h,action,options)=>{assert.equal(options.separateRun,true);assert.equal(options.maxBytes,32*1024*1024);calls.push('trace-start');try{return await action()}finally{calls.push('trace-stop')}}})
 assert.deepEqual(calls,['control-A-before','CPU-start','trace-start','trace-A','trace-stop','CPU-stop','control-A-restored'])
 const original=Error('original contact failed');await assert.rejects(runDiagnosticCase({}, {...cases[1],directory:'fixture'},()=>{throw original},{cpu:async(h,b,a)=>a(),trace:async(h,a)=>a()}),e=>e===original)
})

