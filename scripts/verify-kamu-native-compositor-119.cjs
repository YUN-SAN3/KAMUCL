// Diagnostic only. Native sidebar -> no vibrancy -> restored sidebar in one
// window and one ready mascot. No audio tap, preference write or acceptance bypass.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {execFileSync} = require('node:child_process')

// Serialized into the disposable Electron main process; keep self-contained.
function createNativeSession(electron, platform) {
  if (platform !== 'darwin') throw Error('Native compositor diagnostic requires Darwin')
  const eligible = electron.BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && /\/renderer\/index\.html(?:[?#]|$)/.test(w.webContents.getURL()))
  if (eligible.length !== 1) throw Error('Expected exactly one packaged launcher window')
  const target = eligible[0], id = target.id, contents = target.webContents, url = contents.getURL()
  const calls = [], initialMaterial = 'sidebar'; let applied = initialMaterial
  function guard() {
    if (target.isDestroyed() || !electron.BrowserWindow.getAllWindows().includes(target) || target.id !== id || target.webContents !== contents || contents.isDestroyed() || contents.getURL() !== url) throw Error('Native compositor target changed; refusing to mutate another window')
  }
  function snapshot() {
    guard(); const d = electron.screen.getDisplayMatching(target.getBounds())
    return { platform, windowId: id, webContentsId: contents.id, url, windowFocused: target.isFocused(), visible: target.isVisible(), minimized: target.isMinimized(), bounds: target.getBounds(), backgroundColor: target.getBackgroundColor(), opacity: target.getOpacity(), activeDisplay: { id: d.id, size: d.size, scaleFactor: d.scaleFactor, displayFrequency: d.displayFrequency }, appliedMaterial: applied, materialEvidence: 'setVibrancy returned successfully on the same target; Electron has no material readback, native pixels retained separately', calls: calls.slice() }
  }
  function set(value) {
    guard(); if (value !== null && value !== initialMaterial) throw Error('Unsupported diagnostic material')
    target.setVibrancy(value); applied = value; calls.push({ at: Date.now(), material: value, windowId: id, webContentsId: contents.id }); return snapshot()
  }
  return { snapshot, set, restore: () => set(initialMaterial) }
}

// Always try both independent restorations, even if observation/cleanup fails.
async function withRestoration(action, restoreNative, restoreRenderer) {
  const failures = []; let result
  try { result = await action() } catch (error) { failures.push(error) }
  for (const restore of [restoreNative, restoreRenderer]) try { await restore() } catch (error) { failures.push(error) }
  if (failures.length === 1) throw failures[0]
  if (failures.length) throw new AggregateError(failures, 'Compositor diagnostic/restoration failed')
  return result
}

// No graph connections, recording taps, context construction or synthetic events.
// Count every existing/new WebGL1/2 draw dispatch, including instanced methods,
// independently from the mascot's canvas2d uploads. Hooks only observe arguments.
function installRendererObserver() {
  if (window.__kamuCompositorDiag) throw Error('Compositor observer already installed')
  const p = window.__kamuCompositorDiag = { hooks: [], contexts: [], ids: new WeakMap(), canvasIds:new WeakMap(),canvasCount:0,draws: [], sources: [], watch: null, visibility: [] }
  // Define cleanup before the first mutation, so a partial hook install can
  // always be unwound by the outer finally as well.
  p.restore=()=>{const partial=p.stop?.()??null,checks=[];for(const h of p.hooks){const untouched=h.proto[h.key]===h.wrapped;Object.defineProperty(h.proto,h.key,h.descriptor);checks.push({key:h.key,untouched,restored:h.proto[h.key]===h.descriptor.value})}if(p.onVisibility){document.removeEventListener('visibilitychange',p.onVisibility);window.removeEventListener('focus',p.onVisibility);window.removeEventListener('blur',p.onVisibility)}delete window.__kamuCompositorDiag;return{checks,partial,restored:checks.every(c=>c.untouched&&c.restored),observerRemoved:!window.__kamuCompositorDiag}}
  function canvasInfo(canvas) {
    if(canvas&&!p.canvasIds.has(canvas))p.canvasIds.set(canvas,p.canvasCount++)
    const r = canvas?.getBoundingClientRect?.(), style = canvas instanceof Element ? getComputedStyle(canvas) : null
    return { id:canvas?p.canvasIds.get(canvas):null,kind: canvas?.closest?.('.figure-strip') ? 'mascot' : 'other-preview', tag: canvas?.tagName || 'OffscreenCanvas', className: canvas?.className || '', ancestorClass: canvas?.parentElement?.className || '', width: canvas?.width, height: canvas?.height, connected: canvas?.isConnected ?? false, visible: !!r && r.width > 0 && r.height > 0 && style?.visibility !== 'hidden' && style?.display !== 'none', bounds: r ? { x:r.x,y:r.y,width:r.width,height:r.height } : null }
  }
  function contextId(context) {
    if (!p.ids.has(context)) { p.ids.set(context,p.contexts.length); p.contexts.push({ id:p.contexts.length, type:context.constructor.name, canvas:canvasInfo(context.canvas), calls:0, methods:{} }) }
    return p.ids.get(context)
  }
  function hook(proto, key, observe) {
    const descriptor = Object.getOwnPropertyDescriptor(proto,key)
    if (!descriptor || typeof descriptor.value !== 'function') return
    const original=descriptor.value, wrapped=function(...args){ observe(this,args); return original.apply(this,args) }
    Object.defineProperty(proto,key,{...descriptor,value:wrapped}); p.hooks.push({proto,key,descriptor,wrapped})
  }
  for (const Type of [window.WebGLRenderingContext,window.WebGL2RenderingContext]) if(Type) for(const key of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']) hook(Type.prototype,key,(context)=>{const id=contextId(context),c=p.contexts[id];c.calls++;c.methods[key]=(c.methods[key]||0)+1;p.draws.push({at:performance.now(),id,method:key,kind:c.canvas.kind})})
  hook(CanvasRenderingContext2D.prototype,'putImageData',context=>{const id=contextId(context),c=p.contexts[id];c.calls++;c.methods.putImageData=(c.methods.putImageData||0)+1;p.draws.push({at:performance.now(),id,method:'putImageData',kind:c.canvas.kind})})
  hook(AudioBufferSourceNode.prototype,'start',(source,args)=>{if(source.buffer)p.sources.push({at:performance.now(),when:args[0]??0,audioTime:source.context.currentTime,state:source.context.state,duration:source.buffer.duration,role:source.kamuclInitialization?.role||'palm',hidden:document.hidden})})
  p.onVisibility=e=>p.visibility.push({at:performance.now(),type:e.type,hidden:document.hidden,focus:document.hasFocus()})
  document.addEventListener('visibilitychange',p.onVisibility);window.addEventListener('focus',p.onVisibility);window.addEventListener('blur',p.onVisibility)
  function feedbackState(image){
    const computed=getComputedStyle(image)
    return {transform:computed.transform,opacity:Number(computed.opacity),animations:image.getAnimations().map(animation=>{
      const timing=animation.effect?.getComputedTiming()
      return{currentTime:animation.currentTime,startTime:animation.startTime,playState:animation.playState,pending:animation.pending,playbackRate:animation.playbackRate,computedTiming:timing?{delay:timing.delay,endDelay:timing.endDelay,fill:timing.fill,iterationStart:timing.iterationStart,iterations:timing.iterations,duration:timing.duration,direction:timing.direction,easing:timing.easing,endTime:timing.endTime,activeDuration:timing.activeDuration,localTime:timing.localTime,progress:timing.progress,currentIteration:timing.currentIteration}:null}
    })}
  }
  p.start=(instrumentation)=>{
    if(instrumentation!==undefined){if(!instrumentation||typeof instrumentation!=='object'||Object.keys(instrumentation).some(key=>!['probeClocks','queryFeedback','measureProbe'].includes(key))||Object.values(instrumentation).some(value=>typeof value!=='boolean'))throw Error('Invalid observer diagnostic options')}
    const probeClocks=instrumentation?.probeClocks!==false,queryFeedback=instrumentation?.queryFeedback!==false,measureProbe=instrumentation?.measureProbe===true
    if(p.watch)throw Error('Overlapping compositor observations')
    const w=p.watch={samples:[],raf:[],timers:[],longTasks:[],drawStart:p.draws.length,sourceStart:p.sources.length,visibilityStart:p.visibility.length,canvasInventory:[...document.querySelectorAll('canvas')].map(canvasInfo)}
    if(instrumentation!==undefined)w.instrumentation={probeClocks,queryFeedback,measureProbe,classification:'Instrumentation-only diagnostic; never formal acceptance'}
    const sample=()=>{const observerEnteredAt=measureProbe?performance.now():undefined,e=document.querySelector('.mascot-stage');if(!e)return;const omitted={opacity:null,transform:null,animations:null,omitted:'style/Animation queries explicitly disabled for this diagnostic only'},palm=queryFeedback?feedbackState(e.querySelector('.pixel-palm')):omitted,print=queryFeedback?feedbackState(e.querySelector('.palm-print')):omitted;const entry={at:performance.now(),phase:e.dataset.phase,queue:Number(e.dataset.queue),contacts:Number(e.dataset.contacts),sounds:Number(e.dataset.soundsPlayed),cycleId:Number(e.dataset.cycleId),contactAt:Number(e.dataset.contactAt),palmAnimationPhase:e.dataset.palmAnimationPhase,printAnimationPhase:e.dataset.printAnimationPhase,renderMs:Number(e.dataset.renderMs),callbackAt:Number(e.dataset.renderNow),rafTimestamp:Number(e.dataset.rafTimestamp),frameCallbackKind:e.dataset.frameCallbackKind,frameFallbacks:Number(e.dataset.frameFallbacks||0),frameCallbackGap:Number(e.dataset.frameCallbackGap||0),framePendingAge:Number(e.dataset.framePendingAge||0),palm:palm.opacity,print:print.opacity,palmAnimation:palm,printAnimation:print,hidden:document.hidden,focus:document.hasFocus(),contextCalls:p.contexts.map(c=>({id:c.id,calls:c.calls}))};if(measureProbe){entry.observerEnteredAt=observerEnteredAt;entry.observerFinishedAt=performance.now();entry.observerDurationMs=entry.observerFinishedAt-observerEnteredAt}w.samples.push(entry)}
    w.observer=new MutationObserver(sample);w.observer.observe(document.querySelector('.mascot-stage'),{attributes:true,attributeFilter:['data-render-ms']})
    if(probeClocks){const raf=t=>{w.raf.push({timestamp:t,at:performance.now()});w.rafId=requestAnimationFrame(raf)};w.rafId=requestAnimationFrame(raf)}
    if(probeClocks)w.timer=setInterval(()=>w.timers.push({at:performance.now(),hidden:document.hidden}),16)
    try{w.tasks=new PerformanceObserver(list=>w.longTasks.push(...list.getEntries().map(e=>({startTime:e.startTime,duration:e.duration}))));w.tasks.observe({entryTypes:['longtask']});w.longTaskSupported=true}catch(error){w.longTaskSupported=false;w.longTaskError=String(error)}
  }
  p.stop=()=>{const w=p.watch;if(!w)return null;w.observer.disconnect();if(w.tasks){w.longTasks.push(...w.tasks.takeRecords().map(e=>({startTime:e.startTime,duration:e.duration})));w.tasks.disconnect()}if(w.rafId!==undefined)cancelAnimationFrame(w.rafId);if(w.timer!==undefined)clearInterval(w.timer);p.watch=null;return{...(w.instrumentation?{instrumentation:w.instrumentation}:{}),samples:w.samples,raf:w.instrumentation?.probeClocks===false?null:w.raf,timers:w.instrumentation?.probeClocks===false?null:w.timers,longTasks:w.longTasks,longTaskSupported:w.longTaskSupported,longTaskError:w.longTaskError,canvasInventory:w.canvasInventory,contexts:p.contexts,draws:p.draws.slice(w.drawStart),sources:p.sources.slice(w.sourceStart),visibility:p.visibility.slice(w.visibilityStart)}}
  return { hooks:p.hooks.map(h=>h.key),canvasInventory:[...document.querySelectorAll('canvas')].map(canvasInfo),coverage:'All renderer WebGL1/2 core draw methods and Canvas2D.putImageData; zero-call existing canvases remain in inventory. ANGLE extension/worker/offscreen contexts outside this renderer are not observed.' }
}

async function diagnostic(h) {
  if(process.env.KAMUCL_OBSERVER_ABA119==='1')return require('./verify-kamu-observer-aba-119.cjs')(h)
  if(process.env.KAMUCL_OBSERVER_TRACE_CONTROL119==='1')return require('./verify-kamu-observer-aba-119.cjs')(h,{traceControl:true})
  const {call,evaluate,main,nav,wait,version,recordScreencast,screenshot}=h
  if(await main('process.platform')!=='darwin')return
  const theme=process.env.KAMUCL_TEST_THEME||'black-orange',file=`out/kamu-native-compositor-diagnostic-119-${theme}.json`
  const proof={version,complete:false,classification:'QA-only native vibrancy ABA diagnostic; not normal theme screenshots, not a substitute for header or motion acceptance',hardwareListening:'not performed',trace:'not enabled; primary cadence measured without tracing overhead',cases:[]}
  const persist=()=>fs.writeFileSync(file,JSON.stringify(proof,null,2)),saved=()=>evaluate("window.kamucl.invoke('mascots:state')")
  const nativeScreenshot=(name,native)=>{
    const b=native.bounds,rect=[b.x,b.y,b.width,b.height].map(Math.round);assert(rect.every(Number.isFinite)&&rect[2]>0&&rect[3]>0,'native capture requires actual valid window bounds')
    const output=path.resolve('out',`kamu-native-compositor-119-${name}-native-${theme}.png`)
    execFileSync('/usr/sbin/screencapture',['-x','-R'+rect.join(','),output],{timeout:10000})
    const data=fs.readFileSync(output);assert(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'actual native PNG required')
    return{file:output,source:'macOS screencapture actual screen region at unchanged native window bounds, including native material; diagnostic only',bounds:b,pixelWidth:data.readUInt32BE(16),pixelHeight:data.readUInt32BE(20),bytes:data.length}
  }
  const snapshot=()=>evaluate(`(()=>{const e=document.querySelector('.mascot-stage'),b=document.querySelector('[data-hit=kamu]');return{open:!!e,readyAt:Number(e?.dataset.readyAt),phase:e?.dataset.phase,queue:Number(e?.dataset.queue),contacts:Number(e?.dataset.contacts),sounds:Number(e?.dataset.soundsPlayed),disabled:b?.disabled,hidden:document.hidden,focus:document.hasFocus(),backend:e?.dataset.renderBackend,bufferPreparation:e?.dataset.audioPreparation}})()`)
  const until=async(label,predicate)=>{let s;for(let i=0;i<200;i++){s=await snapshot();if(await predicate(s))return s;await wait(50)}proof.failure={label,last:s};persist();assert.fail(label+': '+JSON.stringify(s))}
  const click=async selector=>{const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Missing/disabled trusted target');const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(hit!==e&&!e.contains(hit))throw Error('Occluded trusted target');return{x,y}})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p})}
  const close=async()=>{if((await snapshot()).open){await click('.menu-tool');await click('.sound-panel button:last-of-type');await until('diagnostic stage closes',s=>!s.open)}}
  let nativeCreated=false,rendererCreated=false
  try {
    await withRestoration(async()=>{
      await nav('skins');assert.equal((await snapshot()).open,false,'prior header/native audio diagnostic must close its stage')
      proof.preferencesBefore=(await saved()).sound;assert(!proof.preferencesBefore.muted&&proof.preferencesBefore.volume>0,'requires existing audible preference; never changes preferences')
      assert.equal(await main('!!globalThis.__kamuCompositorNative'),false,'native diagnostic session already exists')
      nativeCreated=true;proof.nativeInitial=await main(`(()=>{globalThis.__kamuCompositorNative=(${createNativeSession.toString()})(testElectron,process.platform);return globalThis.__kamuCompositorNative.snapshot()})()`)
      // Explicit original material establishes the A condition using the same
      // target as B/restoration; there is no unsupported getVibrancy readback.
      proof.originalMaterialApplied=await main("globalThis.__kamuCompositorNative.set('sidebar')")
      await click('.brand-avatar');proof.ready=await until('same mascot ready before ABA',s=>s.open&&!s.disabled&&s.readyAt>0&&s.bufferPreparation==='ended')
      rendererCreated=true;proof.observer=await evaluate(`(${installRendererObserver.toString()})()`)
      for(const [name,material]of [['original-sidebar','sidebar'],['without-vibrancy',null],['restored-sidebar','sidebar']]){
        const entry={name,material,classification:'diagnostic native material comparison only'};proof.cases.push(entry);persist()
        entry.nativeBefore=await main(`globalThis.__kamuCompositorNative.set(${JSON.stringify(material)})`)
        await wait(200);entry.before=await snapshot();assert.equal(entry.before.readyAt,proof.ready.readyAt,'ABA must retain exactly the same stage')
        assert(entry.nativeBefore.visible&&!entry.nativeBefore.minimized&&entry.nativeBefore.windowFocused&&entry.before.focus&&!entry.before.hidden,'ABA requires actual foreground window')
        entry.savedBefore=await saved();entry.beforeScreenshot=`extension-diagnostic-native-compositor-119-${name}-before`;await screenshot(entry.beforeScreenshot);entry.nativeBeforeScreenshot=nativeScreenshot(name+'-before',entry.nativeBefore)
        await evaluate('window.__kamuCompositorDiag.start()')
        // Preserve original JPEGs even when a trusted click/readiness assertion
        // fails: let the recorder flush, then rethrow the exact failure.
        let actionFailure
        try{entry.recording=await recordScreencast(`kamu-native-compositor-119-${name}`,async()=>{try{for(let i=0;i<10;i++)await click('[data-hit=kamu]');await until(name+' natural completion',async s=>s.phase==='front'&&s.queue===0&&s.contacts===entry.before.contacts+10&&s.sounds===entry.before.sounds+10&&(await saved()).counts.kamu===entry.savedBefore.counts.kamu+10)}catch(error){actionFailure=error}},250);if(actionFailure)throw actionFailure}finally{entry.observations=await evaluate('window.__kamuCompositorDiag.stop()');persist()}
        entry.nativeAfter=await main('globalThis.__kamuCompositorNative.snapshot()');entry.after=await snapshot();entry.afterScreenshot=`extension-diagnostic-native-compositor-119-${name}-after`;await screenshot(entry.afterScreenshot);entry.nativeAfterScreenshot=nativeScreenshot(name+'-after',entry.nativeAfter)
        entry.benchmark=require('./mascot-capture-budget.cjs')(entry.nativeBefore,entry.recording.fps);entry.benchmark.status=entry.benchmark.passed?'passed':'below-target'
        const o=entry.observations,gaps=a=>a.slice(1).map((s,i)=>s.at-a[i].at),sourceIntervals=gaps(o.sources),series=o.samples
        entry.cadence={sampleIntervals:gaps(series),rafIntervals:gaps(o.raf),timerIntervals:gaps(o.timers),sourceIntervals,activeGaps:series.slice(1).flatMap((s,i)=>s.at-series[i].at>100&&(s.phase!=='front'||series[i].phase!=='front')?[{prior:series[i],next:s,ms:s.at-series[i].at}]:[])}
        persist();assert.equal(o.sources.length,10,'ten real palm sources required');assert(o.sources.every(s=>s.role==='palm'&&s.state==='running'),'no initialization source mixed with ABA');assert(sourceIntervals.every(ms=>ms>=90),'same native source-spacing requirement');assert(series.length>=2&&entry.recording.frames.length>=2&&Number.isFinite(entry.recording.fps)&&entry.recording.fps>0,'actual frames and timing required');assert(series.every(s=>!s.hidden&&s.focus),'no hidden/background samples')
        assert(series.slice(1).every((s,i)=>s.contacts-series[i].contacts<=1),'contacts must not catch up in one observed frame')
        const seen=new Set(series.filter(s=>s.phase==='slap'&&s.palm>0).map(s=>s.contacts));assert(Array.from({length:10},(_,i)=>entry.before.contacts+i+1).every(n=>seen.has(n)),'every contact needs an actual visible palm sample')
        assert.equal(entry.after.readyAt,proof.ready.readyAt);assert.deepEqual((await saved()).sound,proof.preferencesBefore);entry.functionalComplete=true;persist()
      }
    },async()=>{
      if(nativeCreated&&await main('!!globalThis.__kamuCompositorNative')){proof.nativeRestored=await main('globalThis.__kamuCompositorNative.restore()');assert.equal(proof.nativeRestored.appliedMaterial,'sidebar');if(proof.nativeInitial)assert.equal(proof.nativeRestored.windowId,proof.nativeInitial.windowId);await main('delete globalThis.__kamuCompositorNative');persist();await wait(200);proof.finallyRestoredScreenshot=nativeScreenshot('finally-restored',proof.nativeRestored);persist()}
    },async()=>{
      try{if(rendererCreated&&await evaluate('!!window.__kamuCompositorDiag')){proof.rendererRestored=await evaluate('window.__kamuCompositorDiag.restore()');persist();assert(proof.rendererRestored.restored&&proof.rendererRestored.observerRemoved,'all original renderer methods/listeners must be restored')}}finally{await close();proof.preferencesAfter=(await saved()).sound;if(proof.preferencesBefore)assert.deepEqual(proof.preferencesAfter,proof.preferencesBefore);persist()}
    })
    proof.complete=true
  }catch(error){proof.error=String(error);if(error.errors)proof.errors=error.errors.map(String);throw error}finally{persist()}
  console.log('DIAGNOSTIC native vibrancy ABA '+proof.cases.map(c=>c.name+'='+c.recording.fps+'fps '+c.benchmark.status).join('; '))
}
module.exports=diagnostic
module.exports.createNativeSession=createNativeSession
module.exports.withRestoration=withRestoration
// Shared read-only observer; exposing it does not change the vibrancy ABA.
module.exports.installRendererObserver=installRendererObserver
