const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
module.exports=async function verifyMascotHeader(h){
 if(require('./ui-capabilities.cjs').singleLogo)return require('./verify-kamu-logo-119-ui.cjs')(h)
 const {call,evaluate,main,click,nav,screenshot,wait,profile,version,recordScreencast}=h
 const proof={version,checks:[],layouts:[],audio:{},hardwareListening:'not performed'}
 // Hosted macOS runners can enable reduced motion globally. Exercise normal
 // walking/recoil explicitly before the independent reduced-motion regression.
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
 await nav('skins')
 const nativeFocus=activate=>main(`(()=>{const w=testElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));if(${activate}&&process.platform==='darwin'){testElectron.app.focus({steal:true});w.show();w.focus()}return{platform:process.platform,activated:${activate}&&process.platform==='darwin',appIsFocused:typeof testElectron.app.isFocused==='function'?testElectron.app.isFocused():null,appIsFocusedAvailable:typeof testElectron.app.isFocused==='function',appHidden:process.platform==='darwin'?testElectron.app.isHidden():null,windowFocused:w.isFocused(),windowVisible:w.isVisible(),windowMinimized:w.isMinimized(),focusedWindowId:testElectron.BrowserWindow.getFocusedWindow()?.id??null,windowId:w.id}})()`)
 proof.nativeForeground={source:'disposable QA only: native NSApp app.focus({steal:true}) followed by BrowserWindow.show/focus on macOS; no global system preference change',before:await nativeFocus(false),activated:await nativeFocus(true)}
 await call('Page.bringToFront');proof.nativeForeground.samples=[]
 for(let i=0;i<30;i++){const native=await nativeFocus(false),renderer=await evaluate('({hasFocus:document.hasFocus(),hidden:document.hidden,visibilityState:document.visibilityState})');proof.nativeForeground.samples.push({native,renderer});proof.nativeForeground.renderer=renderer;proof.nativeForeground.ready=native.platform!=='darwin'||native.windowFocused&&native.focusedWindowId===native.windowId&&native.windowVisible&&!native.windowMinimized&&renderer.hasFocus;if(proof.nativeForeground.ready)break;await wait(50)}
 fs.writeFileSync('out/mascot-header-native-focus-live.json',JSON.stringify(proof.nativeForeground,null,2));assert(proof.nativeForeground.ready,'macOS disposable QA must activate the real native app/window, beyond CDP focus emulation')
 await main(`(()=>{globalThis.mascotPersistenceTrace={pending:[],batches:[]};globalThis.mascotProofBatchBase=testElectron.ipcMain._invokeHandlers.get('mascots:batch');globalThis.mascotProofPendingListener=(_event,pending)=>mascotPersistenceTrace.pending.push({pending,time:Date.now()});testElectron.ipcMain.on('window:mascotPending',mascotProofPendingListener);testElectron.ipcMain.removeHandler('mascots:batch');testElectron.ipcMain.handle('mascots:batch',async(event,value)=>{const entry={batchId:value.batchId,hits:[...value.hits],time:Date.now(),status:'pending'};mascotPersistenceTrace.batches.push(entry);try{const result=await mascotProofBatchBase(event,value);Object.assign(entry,{status:'saved',completed:Date.now(),counts:result.counts});return result}catch(error){Object.assign(entry,{status:'failed',completed:Date.now(),error:String(error)});throw error}})})()`)
 proof.persistence=[]
 const persistenceSnapshot=async()=>{
  const local=await evaluate(`(()=>{const stage=document.querySelector('.mascot-stage'),active=document.activeElement;return{stageOpen:!!stage,stageHidden:stage?.classList.contains('hidden')??null,focused:{hit:active?.dataset?.hit||null,label:active?.getAttribute('aria-label'),disabled:active?.disabled??null},buttons:[...document.querySelectorAll('.mascot-hit')].map(e=>({id:e.dataset.hit,count:Number(e.getAttribute('aria-label').match(/累计 (\\d+) 次/)?.[1]),disabled:e.disabled,focused:e===active}))}})()`)
  const saved=await evaluate("window.kamucl.invoke('mascots:state')"),ipc=await main('mascotPersistenceTrace')
  return{time:Date.now(),local,saved,ipc}
 }
 const awaitCounts=async(label,expected,closed=false)=>{
  const check={label,expected,closed,samples:[]};proof.persistence.push(check)
  let snapshot,localMatched=false,savedMatched=false,ready=false
  for(let i=0;i<50;i++){
   snapshot=await persistenceSnapshot();check.samples.push(snapshot)
   localMatched=closed?!snapshot.local.stageOpen:snapshot.local.stageOpen&&Object.entries(expected).every(([id,count])=>snapshot.local.buttons.find(b=>b.id===id)?.count===count)
   savedMatched=Object.entries(expected).every(([id,count])=>(snapshot.saved.counts[id]||0)===count)
   ready=localMatched&&savedMatched&&snapshot.ipc.pending.at(-1)?.pending!==true
   fs.writeFileSync('out/mascot-header-persistence-live.json',JSON.stringify({version,checks:proof.persistence},null,2))
   if(ready)break
   await wait(80)
  }
  if(!ready)console.error('Mascot persistence completion diagnostics',JSON.stringify(check,null,2))
  assert(localMatched,label+': local UI must reach the exact expected counts/focus-close state');assert(savedMatched,label+': persistent counts must reach the exact expected counts');assert(ready,label+': the real pending-save protection must clear only after acknowledgement')
  return snapshot.saved
 }
 await evaluate(`(()=>{
  window.__mascotSoundProof={events:[],peakVoices:0,active:0,closed:0,contexts:[],audioLifecycleCalls:[],audioStateTransitions:[],recorders:[],recording:[],draws:0,glDraws:0,cpuUploads:0,cpuCanvases:[],glReleased:0,previewCanvases:[],previewContexts:new WeakMap()};const proof=window.__mascotSoundProof;
  const getContext=HTMLCanvasElement.prototype.getContext,draw=WebGL2RenderingContext.prototype.drawElements,putImageData=CanvasRenderingContext2D.prototype.putImageData;
  HTMLCanvasElement.prototype.getContext=function(type,...args){const context=getContext.call(this,type,...args);if(type==='webgl2'&&context&&!context.__mascotTracked){context.__mascotTracked=true;const originalExtension=context.getExtension.bind(context);context.getExtension=function(name){const extension=originalExtension(name);if(name==='WEBGL_lose_context'&&extension&&!extension.__mascotTracked){extension.__mascotTracked=true;const lose=extension.loseContext.bind(extension);extension.loseContext=()=>{proof.glReleased++;lose()}}return extension}}return context};
  WebGL2RenderingContext.prototype.drawElements=function(...args){if(this.__mascotTracked&&this.canvas?.closest('.figure-strip')){proof.draws++;proof.glDraws++}if(this.canvas?.closest('.viewer3d')){let id=proof.previewContexts.get(this);if(id===undefined){id=proof.previewCanvases.length;proof.previewContexts.set(this,id);proof.previewCanvases.push({id,canvas:this.canvas,draws:0})}proof.previewCanvases[id].draws++}return draw.apply(this,args)};
  CanvasRenderingContext2D.prototype.putImageData=function(...args){const result=putImageData.apply(this,args);if(this.canvas.closest('.figure-strip')){proof.draws++;proof.cpuUploads++;if(!proof.cpuCanvases.includes(this.canvas))proof.cpuCanvases.push(this.canvas)}return result};
  const Original=window.AudioContext,start=AudioBufferSourceNode.prototype.start,connect=AudioNode.prototype.connect,close=Original.prototype.close,resume=Original.prototype.resume,suspend=Original.prototype.suspend;window.__mascotOriginalAudioContext=Original;window.__mascotHooks={Original,start,connect,close,resume,suspend,getContext,draw,putImageData};
  const audioState=context=>({context:proof.contexts.indexOf(context),state:context.state,time:context.currentTime,wallTime:performance.now(),documentHidden:document.hidden,stageHidden:document.querySelector('.mascot-stage')?.classList.contains('hidden')??null});
  window.AudioContext=new Proxy(Original,{construct(target,args){const context=new target(...args);proof.contexts.push(context);context.addEventListener('statechange',()=>proof.audioStateTransitions.push(audioState(context)));context.__mascotTap=context.createMediaStreamDestination();const recorder=new MediaRecorder(context.__mascotTap.stream,{mimeType:'audio/webm;codecs=opus'}),chunks=[];recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)};recorder.__chunks=chunks;proof.recorders.push(recorder);recorder.start();return context}});
  Original.prototype.resume=function(){if(this.__mascotTap)proof.audioLifecycleCalls.push({method:'resume',...audioState(this),stack:new Error().stack?.slice(0,650)});return resume.call(this)};
  Original.prototype.suspend=function(){if(this.__mascotTap)proof.audioLifecycleCalls.push({method:'suspend',...audioState(this),stack:new Error().stack?.slice(0,650)});return suspend.call(this)};
  AudioNode.prototype.connect=function(destination,...rest){if(this.context.__mascotTap&&destination===this.context.destination)connect.call(this,this.context.__mascotTap);return connect.call(this,destination,...rest)};
  AudioBufferSourceNode.prototype.start=function(...args){if(this.context.__mascotTap&&this.buffer){const samples=this.buffer.getChannelData(0);let peak=0,power=0;for(const value of samples){peak=Math.max(peak,Math.abs(value));power+=value*value}proof.events.push({when:args[0]||0,time:this.context.currentTime,wallTime:performance.now(),duration:this.buffer.duration,peak,rms:Math.sqrt(power/samples.length),rate:this.playbackRate.value});if(!proof.samples)proof.samples={sampleRate:this.buffer.sampleRate,values:Array.from(samples)};proof.active++;proof.peakVoices=Math.max(proof.peakVoices,proof.active);this.addEventListener('ended',()=>proof.active--,{once:true})}return start.apply(this,args)};
  Original.prototype.close=function(){if(this.__mascotTap)proof.closed++;return close.call(this)};
 })()`)
 const previewSnapshot=()=>evaluate(`(()=>{const proof=window.__mascotSoundProof;return{now:performance.now(),stageOpen:!!document.querySelector('.mascot-stage'),previews:proof.previewCanvases.map(p=>({id:p.id,draws:p.draws,connected:p.canvas.isConnected,editing:p.canvas.closest('.viewer3d')?.classList.contains('editing')??false,bounds:p.canvas.getBoundingClientRect().toJSON()}))}})()`)
 const stablePreviews=async label=>{
  const samples=[];let previous='',stable=0,last
  for(let i=0;i<40;i++){last=await previewSnapshot();samples.push(last);const signature=JSON.stringify(last.previews.filter(p=>p.connected&&!p.editing).map(p=>({id:p.id,draws:p.draws})));stable=signature===previous?stable+1:0;previous=signature;if(stable>=3)break;await wait(80)}
  proof.previewLifecycle.samples.push({label,samples});assert(last.previews.some(p=>p.connected&&!p.editing),'a real decorative preview must be present');assert(stable>=3,label+': actual decorative preview draw counters stop while the header interaction is open');return last
 }
 proof.previewLifecycle={source:'actual per-context WebGL2 drawElements on public .viewer3d canvases; no private Vue props or simulated draw data',samples:[]}
 let previewBefore;for(let i=0;i<30;i++){previewBefore=await previewSnapshot();if(previewBefore.previews.some(p=>p.connected&&!p.editing&&p.draws>0))break;await wait(50)}assert(previewBefore.previews.some(p=>p.connected&&!p.editing&&p.draws>0),'the normal decorative preview really renders before opening the stage');proof.previewLifecycle.beforeOpen=previewBefore
 let pointerPoint
 const appearanceSnapshot=()=>evaluate(`({software:document.querySelector('.shell').classList.contains('mascots-software'),cards:[...document.querySelectorAll('.skins-page .card')].map(e=>({classes:e.className,color:getComputedStyle(e).backgroundColor,backdrop:getComputedStyle(e).backdropFilter}))})`)
 const appearanceBefore=await appearanceSnapshot()
 const trustedClick=async selector=>{const r=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:r.x,y:r.y});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:r.x,y:r.y});pointerPoint={...r}}
 await trustedClick('[aria-label="打开七人互动彩蛋"]');await wait(850)
 assert.equal(await evaluate('document.querySelectorAll(".mascot-hit").length'),7)
 assert.equal(await evaluate('!!document.querySelector(".topbar .mascot-stage canvas")'),true)
 assert.equal(await evaluate('!!document.querySelector(".mascot-mask")'),false)
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".topbar")).height'),'72px')
 const previewStopped=await stablePreviews('header open');proof.previewLifecycle.open=previewStopped
 // A real camera gesture remains usable while decorative walking is paused.
 const previewTarget=previewStopped.previews.find(p=>p.connected&&!p.editing),r=previewTarget.bounds,x=r.x+r.width/2,y=r.y+r.height/2
 await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x,y});await call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:x+26,y});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:x+26,y});pointerPoint={x:x+26,y}
 let gesturePreview;for(let i=0;i<30;i++){gesturePreview=await previewSnapshot();if(gesturePreview.previews.find(p=>p.id===previewTarget.id)?.draws>previewTarget.draws)break;await wait(50)}assert(gesturePreview.previews.find(p=>p.id===previewTarget.id)?.draws>previewTarget.draws,'the real camera drag produces new preview draws while the stage stays open');proof.previewLifecycle.gesture=gesturePreview
 await stablePreviews('camera drag settled')
 proof.motion={normal:await evaluate(`({systemReduced:matchMedia('(prefers-reduced-motion: reduce)').matches,stageReduced:document.querySelector('.mascot-stage').classList.contains('reduced'),draws:window.__mascotSoundProof.draws})`)};assert.equal(proof.motion.normal.systemReduced,false);assert.equal(proof.motion.normal.stageReduced,false)
 const before=await evaluate("window.kamucl.invoke('mascots:state')")
 const geometry=await evaluate(`(()=>{const host=document.querySelector('.figure-strip').getBoundingClientRect(),r=JSON.parse(document.querySelector('.mascot-stage').dataset.silhouettes).filter(r=>r.part==='head').sort((a,b)=>a.left-b.left);return{left:host.left+1,right:host.right-1,y:host.top+(r[0].top+r[0].bottom)/2,ids:r.map(r=>r.id)}})()`)
 const move=async(x,y)=>{await call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'none',x,y});pointerPoint={x,y}}
 // Observe every actual rendered DOM feedback frame in the browser. A CDP
 // round trip can miss a short half-second overlap on an Intel macOS runner.
 // This collector neither reconstructs animation nor changes product timing.
 await evaluate(`(()=>{
  const strip=document.querySelector('.figure-strip'),trace=window.__mascotReverseTrace={frames:[],inputs:[],samples:[],coalescedCalls:[],stopped:false}
  trace.onMove=event=>trace.inputs.push({now:performance.now(),eventTimeStamp:event.timeStamp,x:event.clientX,y:event.clientY,isTrusted:event.isTrusted,sources:window.__mascotSoundProof.events.length});strip.addEventListener('pointermove',trace.onMove)
  // Chromium may deliver right+left as coalesced samples of one final left
  // event. Observe the exact original objects actually iterated by Stage,
  // recording real source starts before/after each yield without changing
  // coordinates, timestamps, identities, order or animation timing.
  trace.nativeCoalesced=PointerEvent.prototype.getCoalescedEvents
  if(trace.nativeCoalesced)PointerEvent.prototype.getCoalescedEvents=function(...args){
   const samples=trace.nativeCoalesced.apply(this,args)
   if(this.currentTarget!==strip||this.pointerType!=='mouse'||trace.stopped)return samples
   trace.coalescedCalls.push({now:performance.now(),x:this.clientX,y:this.clientY,eventTimeStamp:this.timeStamp,isTrusted:this.isTrusted,samples:samples.map(sample=>({x:sample.clientX,y:sample.clientY,eventTimeStamp:sample.timeStamp,isTrusted:sample.isTrusted}))})
   const iterate=samples[Symbol.iterator].bind(samples)
   samples[Symbol.iterator]=function*(){for(const sample of iterate()){const record={now:performance.now(),x:sample.clientX,y:sample.clientY,eventTimeStamp:sample.timeStamp,isTrusted:sample.isTrusted,sourcesBefore:window.__mascotSoundProof.events.length};try{yield sample}finally{record.sourcesAfter=window.__mascotSoundProof.events.length;record.completedAt=performance.now();trace.samples.push(record)}}}
   return samples
  }
  const tick=()=>{const stage=document.querySelector('.mascot-stage');trace.frames.push({now:performance.now(),sources:window.__mascotSoundProof.events.length,renderMs:Number(stage.dataset.renderMs),poses:JSON.parse(stage.dataset.poses),feedback:[...stage.querySelectorAll('.mascot-feedback')].map(e=>({id:e.dataset.feedback,x:parseFloat(e.style.left),y:parseFloat(e.style.top),target:e.dataset.target,contacts:JSON.parse(e.dataset.contacts||'[]'),palms:[...e.querySelectorAll('.pixel-palm')].map(e=>({opacity:Number(e.style.opacity),contact:Number(e.dataset.contact)})),prints:[...e.querySelectorAll('.palm-print')].map(e=>({opacity:Number(e.style.opacity),contact:Number(e.dataset.contact)}))}))});if(!trace.stopped&&trace.frames.length<180)trace.frame=requestAnimationFrame(tick)};trace.frame=requestAnimationFrame(tick)
 })()`)
 // Simulate one rapid mouse gesture with three REAL trusted CDP inputs. call()
 // sends synchronously to the same WebSocket; enqueue its FIFO messages before
 // awaiting any replies, so CDP latency cannot insert a 200ms artificial dwell.
 // Product clocks, event timestamps, animation lengths and feedback stay intact.
 const rapidPoints=[{x:geometry.left,y:geometry.y},{x:geometry.right,y:geometry.y},{x:geometry.left,y:geometry.y}],rapidSentAt=Date.now()
 await Promise.all(rapidPoints.map(point=>call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'none',...point})))
 pointerPoint={...rapidPoints.at(-1)};await wait(50)
 const feedbackSnapshot=()=>evaluate(`(()=>{const stage=document.querySelector('.mascot-stage');return{now:performance.now(),renderMs:Number(stage.dataset.renderMs),lastSweepMs:Number(stage.dataset.sweepMs),maxSweepMs:Number(stage.dataset.maxSweepMs),focusedId:document.activeElement?.dataset.hit||null,labels:[...stage.querySelectorAll('.mascot-label')].map(e=>({id:e.dataset.label,opacity:Number(getComputedStyle(e).opacity),targetOpacity:Number(e.style.opacity),text:e.textContent})),poses:JSON.parse(stage.dataset.poses),parts:JSON.parse(stage.dataset.silhouettes),feedback:[...stage.querySelectorAll('.mascot-feedback')].map(e=>({id:e.dataset.feedback,x:parseFloat(e.style.left),y:parseFloat(e.style.top),target:e.dataset.target,contacts:JSON.parse(e.dataset.contacts||'[]'),palms:[...e.querySelectorAll('.pixel-palm')].map(e=>({opacity:Number(e.style.opacity),contact:Number(e.dataset.contact)})),prints:[...e.querySelectorAll('.palm-print')].map(e=>({opacity:Number(e.style.opacity),contact:Number(e.dataset.contact)}))}))}})()`)
 let reverseReady=false;for(let i=0;i<25;i++){reverseReady=await evaluate("window.__mascotReverseTrace.frames.some(f=>f.sources===14&&f.feedback.length===7&&f.feedback.every(e=>e.contacts.length===2&&e.prints.filter(p=>p.opacity>0).length===2))");if(reverseReady)break;await wait(16)}
 const reverseTrace=await evaluate(`(()=>{const trace=window.__mascotReverseTrace;trace.stopped=true;cancelAnimationFrame(trace.frame);document.querySelector('.figure-strip').removeEventListener('pointermove',trace.onMove);if(trace.nativeCoalesced)PointerEvent.prototype.getCoalescedEvents=trace.nativeCoalesced;return{now:performance.now(),sources:window.__mascotSoundProof.events.length,events:window.__mascotSoundProof.events.slice(0,14),inputs:trace.inputs,samples:trace.samples,coalescedCalls:trace.coalescedCalls,frames:trace.frames}})()`)
 // A real RAF may land between the last polling reply and the final trace read.
 // Decide from that frozen trace, using exactly the same predicate and timing.
 const landedFrame=reverseTrace.frames.find(f=>f.sources===14&&f.feedback.length===7&&f.feedback.every(e=>e.contacts.length===2&&e.prints.filter(p=>p.opacity>0).length===2));reverseReady=!!landedFrame
 const reverseFeedback=landedFrame||reverseTrace.frames.at(-1)
 proof.reverseCapture={source:'browser requestAnimationFrame samples of actual rendered feedback DOM and real AudioBufferSourceNode starts; no recreated frames',input:'three trusted Input.dispatchMouseEvent messages enqueued in one WebSocket FIFO before awaiting replies, simulating a rapid left-empty/right/left mouse gesture without changing product time',rapidPoints,rapidSentAt,geometry,...reverseTrace,matched:reverseReady,selectedFrameTime:reverseFeedback?.now}
 fs.writeFileSync('out/mascot-header-reverse-live.json',JSON.stringify(proof.reverseCapture,null,2))
 const forwardSample=reverseTrace.samples.find(sample=>Math.abs(sample.x-geometry.right)<1&&Math.abs(sample.y-geometry.y)<1),forwardEvent=reverseTrace.inputs.find(input=>Math.abs(input.x-geometry.right)<1&&Math.abs(input.y-geometry.y)<1),first=forwardSample?.sourcesAfter??forwardEvent?.sources
 proof.reverseCapture.forwardEvidence=forwardSample?{type:'original trusted coalesced PointerEvent processed by Stage',sample:forwardSample}:{type:'trusted top-level PointerEvent processed by Stage',event:forwardEvent}
 fs.writeFileSync('out/mascot-header-reverse-live.json',JSON.stringify(proof.reverseCapture,null,2))
 const reverseSounds=reverseTrace.events
 try{
  assert.equal(first,7,'one sparse sweep must start seven real sample sources');assert.equal(reverseTrace.sources,14,'reverse sweep during recoil must stay responsive')
  if(forwardSample){assert.equal(forwardSample.isTrusted,true,'the original forward coalesced sample is trusted');assert.equal(forwardSample.sourcesBefore,0,'the real forward sample begins before any stage source starts');assert.equal(forwardSample.sourcesAfter-forwardSample.sourcesBefore,7,'the real forward sample itself starts exactly seven sources')}else assert.equal(forwardEvent?.isTrusted,true,'the original forward event is trusted')
  assert(reverseReady&&reverseFeedback.feedback.every(e=>e.contacts.length===2&&e.prints.filter(p=>p.opacity>0).length===2),'rapid reverse keeps both independently landed handprints in an actual rendered frame, rather than restarting the first hand')
  for(const feedback of reverseFeedback.feedback){const pose=reverseFeedback.poses.find(p=>p.id===feedback.id);assert.equal(feedback.target,'pelvis');assert(Math.abs(feedback.x-pose.butt.x)<1&&Math.abs(feedback.y-pose.butt.y)<1);assert(pose.headForward[2]>.7&&pose.bodyForward[2]<0,'actual face looks at the viewer while torso faces back');assert(Math.abs(pose.footY-1.6)<1e-5,'actual foot vertices remain grounded')}
  for(let i=0;i<14;i++){const id=i<7?geometry.ids[i]:[...geometry.ids].reverse()[i-7],contact=reverseFeedback.feedback.find(f=>f.id===id).contacts[i<7?0:1],event=reverseSounds[i];assert(Math.abs(contact-(event.wallTime+(event.when-event.time)*1000))<12,'actual scheduled audio contact and independent palm landing share the same timeline')}
 }catch(error){await screenshot('extension-118-mascot-reverse-failure');console.error('Rapid reverse actual-frame diagnostics saved to out/mascot-header-reverse-live.json');try{await require('./diagnose-mascot-performance.cjs')(h,{version,phase:'rapid-reverse',error:String(error),sources:reverseTrace.sources,matched:reverseReady})}catch(diagnosticError){console.error('Failure-only performance diagnostic error:',String(diagnosticError))}throw error}
 proof.reverseFeedback=reverseFeedback
 proof.contactTimeline={source:'intercepted real AudioBufferSourceNode.start time versus rendered independent hand/print contact times',events:reverseSounds}
 await wait(600)
 let state=await awaitCounts('two full sweeps',Object.fromEntries(geometry.ids.map(id=>[id,(before.counts[id]||0)+2])))
 for(const id of geometry.ids)assert.equal(state.counts[id],(before.counts[id]||0)+2,id+' two full sweeps')
 const stationary={...state.counts};await wait(650);state=await evaluate("window.kamucl.invoke('mascots:state')");assert.deepEqual(state.counts,stationary)
 proof.checks.push('single-event seven hits, reverse sweep during recoil, simultaneous visual feedback, stationary hold')
 await evaluate('document.querySelector("[data-hit=qiqi]").focus()')
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space'});await awaitCounts('keyboard Space equivalence',{...stationary,qiqi:stationary.qiqi+1});await wait(500)
 assert.equal((await evaluate("window.kamucl.invoke('mascots:state')")).counts.qiqi,stationary.qiqi+1)
 assert.equal((await evaluate("window.kamucl.invoke('mascots:state')")).order[0],'qiqi')
 const afterKeyboard=await evaluate("window.kamucl.invoke('mascots:state')");await wait(500);assert.deepEqual((await evaluate("window.kamucl.invoke('mascots:state')")).counts,afterKeyboard.counts)
 proof.checks.push('keyboard equivalence, delayed stable sorting, no stationary reorder counts')
 await screenshot('extension-118-mascot-header')
 // Record the compositor without concurrent PNG readback or geometry polling.
 // A separate second leader fixture below supplies the original 16 PNG proofs.
 const castBefore=await evaluate("window.kamucl.invoke('mascots:state')"),castBaseline=await feedbackSnapshot(),castLeader=castBaseline.poses.reduce((a,b)=>a.position>b.position?a:b).id,castLeaderCount=Math.max(...Object.values(castBefore.counts))+1
 assert.equal(castBaseline.poses.find(p=>p.id===castLeader).position,6,'the screencast leader begins at the actual rightmost slot')
 assert.equal(typeof recordScreencast,'function','real compositor screencast helper is required, without reconstructed frames')
 // Separate browser presentation cadence from CDP JPEG delivery. Read only
 // real rAF timestamps, the intercepted real GL draw counter and live poses.
 // Before/after controls run without any active screencast or PNG readback.
 const gpu=await main(`(async()=>{let basic;try{basic=await testElectron.app.getGPUInfo('basic')}catch(error){basic={error:String(error)}}const window=testElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html')),active=window?testElectron.screen.getDisplayMatching(window.getBounds()):null;return{electron:process.versions.electron,platform:process.platform,arch:process.arch,features:testElectron.app.getGPUFeatureStatus(),basic,activeDisplay:active?{id:active.id,size:active.size,scaleFactor:active.scaleFactor,displayFrequency:active.displayFrequency}:null,displays:testElectron.screen.getAllDisplays().map(d=>({id:d.id,size:d.size,scaleFactor:d.scaleFactor,displayFrequency:d.displayFrequency,internal:d.internal}))}})()`)
 const rendererGpu=await evaluate(`(()=>{const stage=document.querySelector('.mascot-stage'),canvas=document.querySelector('.figure-strip canvas'),probe=JSON.parse(stage.dataset.rendererProbe||'{}'),backend=stage.dataset.renderBackend;return{...probe,probeSource:'original real WebGL context capability probe; released immediately for CPU backend',backend,batch:{drawCalls:Number(stage.dataset.renderDrawCalls),uploads:Number(stage.dataset.renderUploads),triangles:Number(stage.dataset.renderTriangles),contain:getComputedStyle(document.querySelector('.figure-strip')).contain},instrumentation:{glDraws:window.__mascotSoundProof.glDraws,cpuUploads:window.__mascotSoundProof.cpuUploads},canvas:{width:canvas.width,height:canvas.height,clientWidth:canvas.clientWidth,clientHeight:canvas.clientHeight},viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},hasFocus:document.hasFocus(),pageHidden:document.hidden,stageHidden:stage.classList.contains('hidden'),hardwareConcurrency:navigator.hardwareConcurrency}})()`)
 assert.equal(rendererGpu.batch.triangles,504,'both backends retain all42 base cubes without dropping faces or people')
 const appearanceDuring=await appearanceSnapshot(),softwareRenderer=/swiftshader|llvmpipe|lavapipe|softpipe|software/i.test(rendererGpu.unmaskedRenderer||rendererGpu.renderer)
 assert.equal(rendererGpu.backend,softwareRenderer?'canvas2d-depth':'webgl-pbr','actual capability selects the CPU depth rasterizer only for software GL')
 assert.equal(rendererGpu.batch.drawCalls,softwareRenderer?0:1,'CPU frames do not claim a GL draw');assert.equal(rendererGpu.batch.uploads,softwareRenderer?1:0,'CPU uploads exactly one completed raster per frame')
 assert(softwareRenderer?rendererGpu.instrumentation.cpuUploads>0&&rendererGpu.instrumentation.glDraws===0:rendererGpu.instrumentation.glDraws>0&&rendererGpu.instrumentation.cpuUploads===0,'actual canvas methods confirm the chosen backend')
 rendererGpu.material=await evaluate("document.querySelector('.mascot-stage').dataset.material");assert.equal(rendererGpu.material,'MeshStandardMaterial','hardware PBR and original material data for CPU shading remain intact')
 rendererGpu.materialSource=rendererGpu.material;rendererGpu.shading=softwareRenderer?'CPU matte diffuse approximation, original linear material color and atlas; not PBR-equivalent':'original WebGL Standard/PBR'
 assert.equal(appearanceDuring.software,softwareRenderer,'the transient frost fallback is restricted to the real software GL renderer');assert.deepEqual(appearanceDuring.cards.map(c=>({classes:c.classes,color:c.color})),appearanceBefore.cards.map(c=>({classes:c.classes,color:c.color})),'software fallback retains the actual theme card colors');if(softwareRenderer)assert(appearanceDuring.cards.length&&appearanceDuring.cards.every(c=>c.backdrop==='none'),'software interaction yields background blur')
 proof.previewLifecycle.appearance={before:appearanceBefore,during:appearanceDuring,softwareRenderer}
 await evaluate(`(()=>{const trace=window.__mascotPerformanceTrace={phase:'before',timeOrigin:performance.timeOrigin,frames:[],marks:[{phase:'before',now:performance.now()}],longTasks:[]};if(PerformanceObserver.supportedEntryTypes.includes('longtask')){trace.observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())trace.longTasks.push({start:entry.startTime,duration:entry.duration,name:entry.name})});trace.observer.observe({type:'longtask'})}const tick=now=>{const stage=document.querySelector('.mascot-stage');trace.frames.push({now,observedAt:performance.now(),phase:trace.phase,draws:window.__mascotSoundProof.draws,stageDrawCalls:Number(stage.dataset.renderDrawCalls),stageTriangles:Number(stage.dataset.renderTriangles),renderMs:Number(stage.dataset.renderMs),hasFocus:document.hasFocus(),pageHidden:document.hidden,stageHidden:stage.classList.contains('hidden'),poses:JSON.parse(stage.dataset.poses).map(p=>({id:p.id,position:p.position,target:p.target,walking:p.walking}))});trace.frame=requestAnimationFrame(tick)};trace.frame=requestAnimationFrame(tick)})()`)
 await wait(1000)
 const timeline=await require('./mascot-timeline.cjs')(h,{gpu,rendererGpu,leader:castLeader,countsBefore:castBefore.counts,targetCount:castLeaderCount})
 await evaluate("(()=>{const trace=window.__mascotPerformanceTrace;trace.phase='during';trace.marks.push({phase:'during',now:performance.now()})})()")
 let screencast,screencastError
 try{screencast=await recordScreencast('mascot-118-leader-screencast',async()=>{
  for(let i=castBefore.counts[castLeader]||0;i<castLeaderCount;i++)await trustedClick('[data-hit='+castLeader+']')
 },2200)}catch(error){screencastError=error}finally{await timeline.end()}
 if(screencastError){proof.timeline=await timeline.stop();throw screencastError}
 await evaluate("(()=>{const trace=window.__mascotPerformanceTrace;trace.phase='after';trace.marks.push({phase:'after',now:performance.now()})})()");await wait(1000)
 const performanceTrace=await evaluate('(()=>{const trace=window.__mascotPerformanceTrace;cancelAnimationFrame(trace.frame);trace.observer?.disconnect();return{timeOrigin:trace.timeOrigin,marks:trace.marks,frames:trace.frames,longTasks:trace.longTasks}})()')
 // Read and summarize the stream after live cadence sampling has stopped.
 // The first leader animation itself was traced, rather than a warm retry.
 proof.timeline=await timeline.stop()
 const cadence=frames=>{const elapsedMs=frames.length>1?frames.at(-1).now-frames[0].now:0,intervalsMs=frames.slice(1).map((f,i)=>f.now-frames[i].now),renderedFrames=frames.slice(1).filter((f,i)=>f.draws!==frames[i].draws).length;return{samples:frames.length,elapsedMs,rafFps:elapsedMs?(frames.length-1)*1000/elapsedMs:0,renderedFrames,observedDrawFrameRate:elapsedMs?renderedFrames*1000/elapsedMs:0,intervalsMs}}
 proof.performance={source:'read-only browser requestAnimationFrame timestamps, actual stage WebGL drawElements or CPU putImageData instrumentation (explicit backend metrics) and rendered Stage poses; before/after have no screencast; presentation cadence and JPEG delivery are distinct metrics',gpu,rendererGpu,nativeAfter:await nativeFocus(false),...performanceTrace,cadence:Object.fromEntries(['before','during','after'].map(phase=>[phase,cadence(performanceTrace.frames.filter(frame=>frame.phase===phase))])),activeWalking:cadence(performanceTrace.frames.filter(frame=>frame.phase==='during'&&frame.poses.some(p=>p.walking)))}
 const motionFrames=performanceTrace.frames.filter(frame=>frame.phase==='during'&&frame.poses.some(p=>p.walking)),motionEnd=motionFrames.length?performanceTrace.frames.find(frame=>frame.now>motionFrames.at(-1).now):null,motionWindow=motionFrames.length?{start:performanceTrace.timeOrigin+motionFrames[0].now,end:performanceTrace.timeOrigin+(motionEnd?.now??motionFrames.at(-1).now)}:null,activeCapture=motionWindow?screencast.frames.filter(frame=>frame.timestamp*1000>=motionWindow.start&&frame.timestamp*1000<=motionWindow.end):[]
 assert(Array.isArray(screencast.frames)&&screencast.frames.length>=2&&Number.isFinite(screencast.fps)&&screencast.fps>0&&Number.isFinite(screencast.elapsed)&&screencast.elapsed>0,'actual compositor capture must contain multiple real frames and positive finite timing')
 const timestampOrder={receivedFrames:screencast.frames.length,distinctTimestamps:new Set(screencast.frames.map(f=>f.timestamp)).size,outOfOrder:[]};assert(timestampOrder.distinctTimestamps>=2,'capture needs at least two distinct real timestamps')
 for(let i=0;i<screencast.frames.length;i++){const f=screencast.frames[i];assert(Number.isFinite(f.timestamp),'compositor timestamps must be finite');assert(fs.existsSync(path.join(screencast.directory,f.file)),'original compositor frame is missing');if(i&&f.timestamp<screencast.frames[i-1].timestamp)timestampOrder.outOfOrder.push({index:i,previous:screencast.frames[i-1].timestamp,timestamp:f.timestamp})}
 // CDP can deliver native frames out of timestamp order; retain arrival metadata
 // and report it. The separate encoder sorts a copy without modifying originals.
 const captureBudget=require('./mascot-capture-budget.cjs')(gpu,screencast.fps)
 proof.performance.captureCadence={wholeRecordingFps:screencast.fps,wholeRecordingElapsed:screencast.elapsed,wholeFrameCount:screencast.frames.length,motionWindowEpochMs:motionWindow,motionWindowSource:'performance.timeOrigin + unmodified real rAF timestamps containing actual walking poses, through the first following settled frame',activeFrames:activeCapture,activeFps:activeCapture.length>1?(activeCapture.length-1)/(activeCapture.at(-1).timestamp-activeCapture[0].timestamp):0,captureBudget,passesWholeRecording:captureBudget.passed}
 fs.writeFileSync('out/mascot-header-performance-live.json',JSON.stringify(proof.performance,null,2))
 proof.screencast={...screencast,timestampOrder,trigger:'trusted CDP mouse press/release on one actual rightmost character; enough independent hits to become leader',captureIsolation:'no concurrent captureScreenshot or observer CDP geometry queries; the real trustedClick action reads getBoundingClientRect per press/release pair and can synchronously flush layout. Browser rAF presentation diagnostics run in-process; optional native software-renderer tracing has its own overhead.',leader:castLeader,countsBefore:castBefore.counts,targetCount:castLeaderCount,...captureBudget,frameRatePassed:captureBudget.passed,hardwareListening:'not performed'}
 fs.writeFileSync('out/mascot-header-screencast-live.json',JSON.stringify(proof.screencast,null,2))
 if(!captureBudget.passed)try{await require('./diagnose-mascot-performance.cjs')(h,{version,phase:'leader-screencast',fps:screencast.fps,captureBudget,normalCadence:proof.performance.cadence,activeWalking:proof.performance.activeWalking})}catch(diagnosticError){console.error('Failure-only performance diagnostic error:',String(diagnosticError))}
 // Capture delivery is a separately reported benchmark, not evidence that the
 // remaining gestures, persistence, editor or native game checks were executed.
 // Retain a failed result and continue those checks; independent visual/motion
 // acceptance still requires actual frames and separate 9/10 review.
 proof.performanceBenchmark={...captureBudget,status:captureBudget.passed?'passed':'below-target',acceptance:'separate capture-delivery benchmark; does not replace independent visual, interaction or motion review'}
 if(!captureBudget.passed)console.warn('BENCHMARK BELOW TARGET: actual compositor capture '+screencast.fps+' fps < '+captureBudget.minimumFps+' fps; original timestamps and failure retained; remaining functional checks continue')
 const castExpected={...castBefore.counts,[castLeader]:castLeaderCount};await awaitCounts('screencast leader: all actual hit deltas and persistence exact',castExpected)
 let castSettled;for(let i=0;i<40;i++){castSettled=await feedbackSnapshot();const pose=castSettled.poses.find(p=>p.id===castLeader);if(!pose.walking&&pose.position===0&&castSettled.labels.every(l=>l.opacity===1))break;await wait(60)}assert.equal(castSettled.poses.find(p=>p.id===castLeader).position,0,'screencast most-slapped figure finishes at the LEFT first position');assert.equal((await evaluate("window.kamucl.invoke('mascots:state')")).order[0],castLeader);assert(castSettled.labels.every(l=>l.opacity===1),'screencast labels restore after landing');proof.screencast.settled=castSettled
 fs.writeFileSync('out/mascot-header-screencast-live.json',JSON.stringify(proof.screencast,null,2))
 // Real compositor PNGs include WebGL figures AND actual DOM palm/print layers.
 // Restart a rightmost-to-leftmost leader walk with its own strict count baseline.
 const videoDir=path.resolve('out/mascot-118-frames-'+(process.env.KAMUCL_TEST_THEME||'black-orange'));fs.mkdirSync(videoDir,{recursive:true})
 const leaderBefore=await evaluate("window.kamucl.invoke('mascots:state')"),baseline=await feedbackSnapshot(),leader=baseline.poses.reduce((a,b)=>a.position>b.position?a:b).id,leaderCount=Math.max(...Object.values(leaderBefore.counts))+1
 assert.equal(baseline.poses.find(p=>p.id===leader).position,6,'the separate PNG leader begins at the actual rightmost slot')
 for(let i=leaderBefore.counts[leader]||0;i<leaderCount;i++)await trustedClick('[data-hit='+leader+']')
 const frames=[];for(let i=0;i<16;i++){const live=await feedbackSnapshot(),capture=await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false}),name='frame-'+String(i).padStart(3,'0')+'.png';fs.writeFileSync(path.join(videoDir,name),Buffer.from(capture.data,'base64'));frames.push({name,wallTime:Date.now(),...live});await wait(70)}
 fs.writeFileSync(path.join(videoDir,'frames.json'),JSON.stringify({version,source:'actual visible Page.captureScreenshot compositor frames; no reconstructed rendering',baseline,frames},null,2))
 const walkingFrames=frames.filter(frame=>frame.poses.some(p=>p.id===leader&&p.walking));assert(walkingFrames.length>=2,'real intermediate walk frames must exist')
 assert(new Set(walkingFrames.map(frame=>frame.poses.find(p=>p.id===leader).phase.toFixed(2))).size>=2,'the leg step phase advances with travelled distance')
 for(const frame of frames)for(const pose of frame.poses){assert(Math.abs(pose.footY-1.6)<1e-5&&pose.headForward[2]>.7,'walking remains grounded with actual faces visible');const label=frame.labels.find(l=>l.id===pose.id);assert.equal(label.targetOpacity,pose.walking?0:1,'all visual labels fade during walking and restore on landing')}
 const leaderExpected={...leaderBefore.counts,[leader]:leaderCount};await awaitCounts('new leader walking keeps counts and persistence exact',leaderExpected)
 let settled;for(let i=0;i<40;i++){settled=await feedbackSnapshot();const pose=settled.poses.find(p=>p.id===leader);if(!pose.walking&&pose.position===0&&settled.labels.every(l=>l.opacity===1))break;await wait(60)}assert.equal(settled.poses.find(p=>p.id===leader).position,0,'most slapped character finishes at the LEFT first position');assert.equal((await evaluate("window.kamucl.invoke('mascots:state')")).order[0],leader);assert(settled.labels.every(l=>l.opacity===1),'all labels are restored after the walk settles')
 proof.animation={frameDirectory:videoDir,frames:frames.map(frame=>({name:frame.name,wallTime:frame.wallTime,poses:frame.poses,feedback:frame.feedback,labels:frame.labels,focusedId:frame.focusedId})),settled,hardwareListening:'not performed'}
 // Exercise the covered-to-exposed boundary on REAL rendered walking geometry.
 // Atomic PointerEvent input is intentionally non-trusted: its same-frame
 // coordinates isolate the geometry contract from CDP round-trip movement.
 // The ordinary seven-person forward/reverse sweeps above remain trusted CDP.
 const findWalkingOverlap=function(){
  const stage=document.querySelector('.mascot-stage'),strip=document.querySelector('.figure-strip'),bounds=strip.getBoundingClientRect(),parts=JSON.parse(stage.dataset.silhouettes),poses=JSON.parse(stage.dataset.poses)
  if(!poses.some(p=>p.walking))return null
  const contains=(r,x,y)=>{if(x<r.left||x>r.right||y<r.top||y>r.bottom)return false;let sign=0;for(let i=0;i<r.polygon.length;i++){const a=r.polygon[i],b=r.polygon[(i+1)%r.polygon.length],v=(b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x);if(Math.abs(v)<1e-7)continue;if(sign&&sign!==Math.sign(v))return false;sign=Math.sign(v)}return true}
  const visible=(x,y)=>{const depths=new Map();for(const p of parts)if(contains(p,x,y))depths.set(p.id,Math.min(depths.get(p.id)??Infinity,p.depth??0));const nearest=Math.min(...depths.values());return[...depths].filter(([,depth])=>depth===nearest).map(([id])=>id)}
  const range=(p,y)=>{const xs=[];for(let i=0;i<p.polygon.length;i++){const a=p.polygon[i],b=p.polygon[(i+1)%p.polygon.length];if(y>=Math.min(a.y,b.y)&&y<=Math.max(a.y,b.y)){if(Math.abs(a.y-b.y)<1e-7){xs.push(a.x,b.x)}else xs.push(a.x+(b.x-a.x)*(y-a.y)/(b.y-a.y))}}return xs.length?{...p,left:Math.min(...xs),right:Math.max(...xs)}:null}
  for(let y=3;y<strip.clientHeight-15;y+=.75){
   const ranges=parts.filter(p=>y>p.top&&y<p.bottom).map(p=>range(p,y)).filter(Boolean)
   for(const near of ranges)for(const far of ranges){
    if(near.id===far.id||near.depth>=far.depth)continue
    const left=Math.max(near.left,far.left),right=Math.min(near.right,far.right),nearRight=Math.max(...ranges.filter(p=>p.id===near.id).map(p=>p.right)),farRight=Math.max(...ranges.filter(p=>p.id===far.id).map(p=>p.right))
    if(right-left<2||far.right-nearRight<3)continue
    const start=(left+right)/2,end=nearRight+Math.min(2,(far.right-nearRight)/2),exit=farRight+1.5
    if(exit>=strip.clientWidth-1)continue
    if(visible(start,y).join()!==near.id||visible(end,y).join()!==far.id||visible(exit,y).length)continue
    let clean=true;for(let x=start;x<=exit;x+=.35)if(visible(x,y).some(id=>id!==near.id&&id!==far.id)){clean=false;break}if(!clean)continue
    return{near:near.id,far:far.id,start:{x:bounds.left+start,y:bounds.top+y},end:{x:bounds.left+end,y:bounds.top+y},exit:{x:bounds.left+exit,y:bounds.top+y},parts,poses,time:performance.now(),strip:{left:bounds.left,top:bounds.top},visible:{start:visible(start,y),end:visible(end,y),exit:visible(exit,y)}}
   }
  }
  return null
 }
 const overlapBefore=await evaluate("window.kamucl.invoke('mascots:state')"),overlapLeader=settled.poses.reduce((a,b)=>a.position>b.position?a:b).id,overlapLeaderCount=Math.max(...Object.values(overlapBefore.counts))+1
 for(let i=overlapBefore.counts[overlapLeader]||0;i<overlapLeaderCount;i++)await click('[data-hit='+overlapLeader+']')
 const atomic=await evaluate(`(async()=>{const find=${findWalkingOverlap.toString()},stage=document.querySelector('.mascot-stage'),strip=document.querySelector('.figure-strip'),local=()=>Object.fromEntries([...stage.querySelectorAll('.mascot-hit')].map(e=>[e.dataset.hit,Number(e.getAttribute('aria-label').match(/累计 (\\d+) 次/)?.[1])])),samples=[];let candidate;for(let i=0;i<100;i++){await new Promise(resolve=>requestAnimationFrame(resolve));candidate=find();samples.push({time:performance.now(),walking:JSON.parse(stage.dataset.poses).filter(p=>p.walking).map(p=>({id:p.id,position:p.position})),found:!!candidate});if(candidate)break}if(!candidate)return{candidate:null,samples};const events=[];strip.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerType:'mouse'}));const before=local();for(const [label,point] of [['first',candidate.start],['visibleEdge',candidate.end],['afterExit',candidate.exit],['reentry',candidate.end]]){const event=new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:point.x,clientY:point.y});strip.dispatchEvent(event);await Promise.resolve();events.push({label,point,isTrusted:event.isTrusted,counts:local(),sources:window.__mascotSoundProof.events.length,time:performance.now()})}return{candidate,samples,before,events}})()`)
 proof.walkingOverlap={source:'actual live posed Three.js geometry projected to the chosen raster backend; atomic browser-dispatched PointerEvent input (isTrusted=false)',atomic,trusted:{status:'not attempted',samples:[]}}
 fs.writeFileSync('out/mascot-header-overlap-live.json',JSON.stringify(proof.walkingOverlap,null,2))
 assert(atomic.candidate,'a real walking pass must expose a farther silhouette edge')
 const expectedOverlap={...atomic.before};for(const step of atomic.events){if(step.label==='first')expectedOverlap[atomic.candidate.near]++;if(step.label==='visibleEdge'||step.label==='reentry')expectedOverlap[atomic.candidate.far]++;assert.equal(step.isTrusted,false);assert.deepEqual(step.counts,expectedOverlap,'walking overlap '+step.label+' has exact visible-person counts')}
 // The controlled same-frame probe also advanced the actual product gate.
 // Keep its last trajectory point instead of bridging from a stale CDP point.
 pointerPoint={...atomic.events.at(-1).point}
 await awaitCounts('covered walking person becomes hittable at its exposed edge and on reentry',expectedOverlap)
 // Attempt trusted CDP input as well. Both endpoints must remain valid in the
 // post-input live frame; a moving edge that invalidates a coordinate is recorded
 // as inconclusive, never counted as a successful trusted boundary regression.
 for(let i=0;i<3;i++){
  const candidate=await evaluate(`(${findWalkingOverlap.toString()})()`);if(!candidate){proof.walkingOverlap.trusted.samples.push({reason:'no remaining live walking overlap'});break}
  const base=await persistenceSnapshot();await evaluate("document.querySelector('.figure-strip').dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerType:'mouse'}))")
  await move(candidate.start.x,candidate.start.y)
  const first=await evaluate(`(()=>{const find=${findWalkingOverlap.toString()},live=find(),stage=document.querySelector('.mascot-stage');return{live,counts:Object.fromEntries([...stage.querySelectorAll('.mascot-hit')].map(e=>[e.dataset.hit,Number(e.getAttribute('aria-label').match(/累计 (\\d+) 次/)?.[1])]))}})()`)
  await move(candidate.end.x,candidate.end.y)
  const after=await feedbackSnapshot(),sample={candidate,base,first,after};proof.walkingOverlap.trusted.samples.push(sample)
  const visibleAt=(parts,point,strip)=>{const x=point.x-strip.left,y=point.y-strip.top,depths=new Map();for(const p of parts){if(x<p.left||x>p.right||y<p.top||y>p.bottom)continue;let sign=0,inside=true;for(let j=0;j<p.polygon.length;j++){const a=p.polygon[j],b=p.polygon[(j+1)%p.polygon.length],v=(b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x);if(Math.abs(v)<1e-7)continue;if(sign&&sign!==Math.sign(v)){inside=false;break}sign=Math.sign(v)}if(inside)depths.set(p.id,Math.min(depths.get(p.id)??Infinity,p.depth??0))}const nearest=Math.min(...depths.values());return[...depths].filter(([,d])=>d===nearest).map(([id])=>id)}
  const firstParts=first.live?.parts,valid=firstParts&&visibleAt(firstParts,candidate.start,candidate.strip).join()===candidate.near&&visibleAt(firstParts,candidate.end,candidate.strip).join()===candidate.far&&visibleAt(after.parts,candidate.start,candidate.strip).join()===candidate.near&&visibleAt(after.parts,candidate.end,candidate.strip).join()===candidate.far
  sample.validEndpoints=!!valid;fs.writeFileSync('out/mascot-header-overlap-live.json',JSON.stringify(proof.walkingOverlap,null,2))
  if(valid){const expected={...Object.fromEntries(base.local.buttons.map(b=>[b.id,b.count]))};expected[candidate.near]++;assert.deepEqual(first.counts,expected,'trusted overlap begins on the near visible person');expected[candidate.far]++;await awaitCounts('trusted CDP crossing a still-valid walking exposed edge',expected);proof.walkingOverlap.trusted.status='passed';break}
  sample.reason='actual motion invalidated one endpoint between CDP round trips';await wait(30)
 }
 if(proof.walkingOverlap.trusted.status!=='passed')proof.walkingOverlap.trusted.status='inconclusive: no CDP trial retained both endpoint visibility contracts'
 fs.writeFileSync('out/mascot-header-overlap-live.json',JSON.stringify(proof.walkingOverlap,null,2));proof.checks.push('real walking silhouettes: non-trusted same-frame covered/exposed/exit/reentry counts; trusted CDP boundary status separately recorded')
 let overlapSettled;for(let i=0;i<50;i++){overlapSettled=await feedbackSnapshot();if(!overlapSettled.poses.some(p=>p.walking))break;await wait(50)}assert(!overlapSettled.poses.some(p=>p.walking),'walking overlap fixture settles before independent full-body band sweeps')
 const bodySweeps=[]
 for(const part of ['rightArm','leftLeg']){
  const preparation={part,previousPointer:pointerPoint?{...pointerPoint}:null,path:[],samples:[]}
  // Leave vertically, then move sideways wholly above the strip. Positioning
  // is a real trajectory and may legitimately hit while leaving; establish the
  // independent band baseline only AFTER that positioning and save completion.
  const outsideLeft=await evaluate('document.querySelector(".figure-strip").getBoundingClientRect().left+1')
  if(pointerPoint){await move(pointerPoint.x,-5);preparation.path.push({...pointerPoint})}
  await move(outsideLeft,-5);preparation.path.push({...pointerPoint})
  const outside=await persistenceSnapshot(),baselineCounts=Object.fromEntries(outside.local.buttons.map(b=>[b.id,b.count]));preparation.outside=outside
  await awaitCounts('whole-person '+part+' outside positioning baseline',baselineCounts)
  let settled=false,signature='',stableSince=0
  for(let i=0;i<60;i++){
   const live=await feedbackSnapshot(),saved=await evaluate("window.kamucl.invoke('mascots:state')"),now=Date.now(),aligned=live.poses.every(p=>!p.walking&&p.position===p.target&&p.target===saved.order.indexOf(p.id)),current=JSON.stringify({poses:live.poses.map(p=>({id:p.id,position:p.position,target:p.target})),order:saved.order,counts:saved.counts})
   const matched=aligned&&Object.entries(baselineCounts).every(([id,count])=>(saved.counts[id]||0)===count)
   if(!matched||current!==signature)stableSince=now
   signature=current;settled=matched&&now-stableSince>=300;preparation.samples.push({time:now,matched,stableMs:now-stableSince,poses:live.poses,counts:saved.counts,order:saved.order})
   fs.writeFileSync('out/mascot-header-body-sweep-live.json',JSON.stringify({version,completed:bodySweeps,preparation},null,2))
   if(settled)break;await wait(50)
  }
  assert(settled,part+' band geometry must match saved order and stay settled beyond the delayed-sort window')
  const band=await evaluate(`(()=>{const strip=document.querySelector('.figure-strip').getBoundingClientRect(),stage=document.querySelector('.mascot-stage'),parts=JSON.parse(stage.dataset.silhouettes),p=parts.find(p=>p.part===${JSON.stringify(part)});return{left:strip.left+1,right:strip.right-1,y:strip.top+(${JSON.stringify(part)}==='leftLeg'?p.bottom-.7:(p.top+p.bottom)/2),parts,poses:JSON.parse(stage.dataset.poses),strip:{left:strip.left,top:strip.top}}})()`)
  await move(band.left,band.y);preparation.path.push({...pointerPoint});await awaitCounts('whole-person '+part+' empty left-edge entry preserves baseline',baselineCounts)
  await move(band.right,band.y);const expected=Object.fromEntries(Object.entries(baselineCounts).map(([id,count])=>[id,count+1]));await awaitCounts('whole-person '+part+' sparse sweep',expected);bodySweeps.push({part,band,preparation,expected,live:await feedbackSnapshot()})
  fs.writeFileSync('out/mascot-header-body-sweep-live.json',JSON.stringify({version,completed:bodySweeps},null,2))
 }
 proof.bodySweeps=bodySweeps
 for(const [w,hh,zoom] of [[960,620,1],[980,720,1.5],[1360,860,1]]){
  await main(`(()=>{const w=testElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));w.setSize(${w},${hh});w.webContents.setZoomFactor(${zoom});w.show();w.focus();testElectron.app.focus({steal:true});return true})()`);await call('Page.bringToFront')
  let layout,stable=0,previous='',samples=[]
  for(let i=0;i<50;i++){
   await wait(80)
   const native=await main(`(()=>{const w=testElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));return{isVisible:w.isVisible(),isMinimized:w.isMinimized(),focused:w.isFocused(),bounds:w.getBounds(),contentBounds:w.getContentBounds(),zoom:w.webContents.getZoomFactor(),backgroundThrottling:w.webContents.getBackgroundThrottling()}})()`)
   // All DOM rectangles and the rendered model bounds come from one evaluation;
   // never mix a stale hit-area snapshot with a later resized WebGL frame.
   layout=await evaluate(`(()=>{const host=document.querySelector('.mascot-stage'),bar=document.querySelector('.topbar').getBoundingClientRect(),stage=host.getBoundingClientRect(),stripElement=document.querySelector('.figure-strip'),strip=stripElement.getBoundingClientRect(),canvas=stripElement.querySelector('canvas'),canvasRect=canvas.getBoundingClientRect(),buttons=[...document.querySelectorAll('.mascot-hit')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{id:e.dataset.hit,x:r.x,y:r.y,width:r.width,height:r.height,leftStyle:e.style.left,topStyle:e.style.top,visible:s.visibility==='visible'&&r.width>0&&r.height>0}}),controls=[...document.querySelectorAll('.top-actions button,.top-back')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return{label:e.getAttribute('aria-label')||e.title||e.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom}});return{viewport:{width:innerWidth,height:innerHeight,devicePixelRatio,visualWidth:visualViewport?.width,visualHeight:visualViewport?.height},documentHidden:document.hidden,visibilityState:document.visibilityState,stageHidden:host.classList.contains('hidden'),draws:window.__mascotSoundProof.draws,bar:{left:bar.left,right:bar.right,top:bar.top,bottom:bar.bottom,height:bar.height},stage:{left:stage.left,right:stage.right,top:stage.top,bottom:stage.bottom},strip:{left:strip.left,right:strip.right,top:strip.top,bottom:strip.bottom,clientWidth:stripElement.clientWidth,clientHeight:stripElement.clientHeight},canvas:{left:canvasRect.left,right:canvasRect.right,top:canvasRect.top,bottom:canvasRect.bottom,clientWidth:canvas.clientWidth,clientHeight:canvas.clientHeight,width:canvas.width,height:canvas.height},modelBounds:host.dataset.modelBounds?JSON.parse(host.dataset.modelBounds):null,buttons,controls}})()`)
   layout={width:w,height:hh,zoom,native,...layout};const b=layout.modelBounds
   const matched=native.isVisible&&!native.isMinimized&&!layout.stageHidden&&Math.abs(layout.viewport.width-native.contentBounds.width/native.zoom)<2&&Math.abs(layout.viewport.height-native.contentBounds.height/native.zoom)<2&&b?.models.length===7&&b.width===layout.strip.clientWidth&&b.height===layout.strip.clientHeight-12&&layout.canvas.clientWidth===b.width&&layout.canvas.clientHeight===b.height
   const signature=JSON.stringify({viewport:layout.viewport,bar:layout.bar,strip:layout.strip,canvas:layout.canvas,modelBoundsSize:b?{width:b.width,height:b.height}:null,nativeBounds:native.bounds})
   stable=matched&&signature===previous?stable+1:0;previous=signature;samples.push({sample:i,matched,stable,native,viewport:layout.viewport,documentHidden:layout.documentHidden,stageHidden:layout.stageHidden,strip:layout.strip,canvas:layout.canvas,modelBoundsSize:b?{width:b.width,height:b.height}:null,draws:layout.draws})
   fs.writeFileSync('out/mascot-header-layout-live.json',JSON.stringify({...layout,readinessSamples:samples},null,2))
   if(stable>=1)break
  }
  layout.readinessSamples=samples;await screenshot('extension-118-mascot-'+w+'-'+zoom)
  try{
   assert(stable>=1,'resize/zoom must reach a visible, stable viewport and matching rendered canvas/model bounds')
   assert([68,72].includes(layout.bar.height),'preserve the existing 68/72px responsive header height');assert.equal(layout.buttons.length,7)
   const bounds=layout.modelBounds;assert.equal(bounds.models.length,7);for(const model of bounds.models){assert(model.top>=2,model.id+' full head has at least 2px canvas margin');assert(model.bottom<=bounds.height,model.id+' full feet remain inside canvas');assert(model.left>=0&&model.right<=bounds.width,model.id+' full model stays inside canvas')}
   layout.models=bounds.models
   for(const b of layout.buttons){assert(b.visible&&b.width>=10&&b.height>=10,b.id+' visible whole-person keyboard button');assert(b.x>=layout.strip.left-1&&b.x+b.width<=layout.strip.right+1,b.id+' stays in single header row');assert(b.y>=layout.bar.top&&b.y+b.height<=layout.bar.bottom,b.id+' stays in header height');for(const c of layout.controls)assert(!(b.x<c.right&&b.x+b.width>c.left&&b.y<c.bottom&&b.y+b.height>c.top),b.id+' avoids window/action controls')}
  }catch(error){console.error('Mascot header layout diagnostics',JSON.stringify(layout,null,2));throw error}
  proof.layouts.push(layout)
 }
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await wait(450)
 assert.equal(await evaluate('document.querySelector(".mascot-stage").classList.contains("reduced")'),true)
 proof.motion.reduced=await evaluate(`({systemReduced:matchMedia('(prefers-reduced-motion: reduce)').matches,stageReduced:document.querySelector('.mascot-stage').classList.contains('reduced'),draws:window.__mascotSoundProof.draws})`);assert.equal(proof.motion.reduced.systemReduced,true)
 const reducedDraws=await evaluate('window.__mascotSoundProof.draws');await wait(200);assert.equal(await evaluate('window.__mascotSoundProof.draws'),reducedDraws,'reduced-motion idle releases the RAF loop')
 const reducedCounts=await evaluate("window.kamucl.invoke('mascots:state')");await click('[data-hit=q3]');await awaitCounts('reduced motion remains interactive',{...reducedCounts.counts,q3:reducedCounts.counts.q3+1})
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await wait(250)
 proof.motion.restored=await evaluate(`({systemReduced:matchMedia('(prefers-reduced-motion: reduce)').matches,stageReduced:document.querySelector('.mascot-stage').classList.contains('reduced'),draws:window.__mascotSoundProof.draws})`);assert.equal(proof.motion.restored.systemReduced,false);assert.equal(proof.motion.restored.stageReduced,false)
 const visibilitySnapshot=async()=>{
  const native=await main(`(()=>{const w=testElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));return{isVisible:w.isVisible(),isMinimized:w.isMinimized(),backgroundThrottling:w.webContents.getBackgroundThrottling(),electron:process.versions.electron,platform:process.platform}})()`)
  const renderer=await evaluate(`({documentHidden:document.hidden,visibilityState:document.visibilityState,stageHidden:document.querySelector('.mascot-stage').classList.contains('hidden'),draws:window.__mascotSoundProof.draws,activeSources:window.__mascotSoundProof.active,audioStates:window.__mascotSoundProof.contexts.map(context=>context.state)})`)
  renderer.nativeVisibility=await evaluate("window.kamucl.invoke('window:visibility')");return{native,renderer}
 }
 // Page Visibility can remain "visible" under Electron/macOS CDP focus and
 // background flags. Never spoof it: verify the real native hide event through
 // the controlled IPC bridge and then inspect actual WebGL/audio work.
 proof.lifecycle={sources:{native:'BrowserWindow.isVisible/isMinimized in the main process',nativeVisibility:'controlled window:visibility IPC query and hide/show broadcast consumed by useMotion',page:'unmodified document.hidden/document.visibilityState',stage:'useMotion pageHidden || nativeHidden',rendering:softwareRenderer?'intercepted actual Canvas2D putImageData uploads':'intercepted actual WebGL2 drawElements',audio:'actual owned AudioContext.state'},before:await visibilitySnapshot(),hiddenSamples:[]}
 await call('Emulation.setFocusEmulationEnabled',{enabled:false});await main(`testElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html')).hide()`)
 for(let i=0;i<30;i++){await wait(50);const snapshot=await visibilitySnapshot();proof.lifecycle.hiddenSamples.push(snapshot);if(!snapshot.native.isVisible&&snapshot.renderer.stageHidden&&snapshot.renderer.audioStates.every(state=>state==='suspended'))break}
 proof.lifecycle.hidden=proof.lifecycle.hiddenSamples.at(-1);fs.writeFileSync('out/mascot-header-visibility-live.json',JSON.stringify(proof.lifecycle,null,2))
 assert.equal(proof.lifecycle.hidden.native.isVisible,false,'the main BrowserWindow is genuinely hidden');assert.equal(proof.lifecycle.hidden.renderer.nativeVisibility,false,'trusted native visibility IPC reports hidden');assert.equal(proof.lifecycle.hidden.renderer.stageHidden,true,'native hide reaches the stage lifecycle even when Page Visibility lags');assert(proof.lifecycle.hidden.renderer.audioStates.length>0&&proof.lifecycle.hidden.renderer.audioStates.every(state=>state==='suspended'),'hidden stage suspends its actual owned AudioContext')
 const hiddenDraws=proof.lifecycle.hidden.renderer.draws;await wait(220);proof.lifecycle.hiddenSettled=await visibilitySnapshot();proof.lifecycle.audioLifecycleCalls=await evaluate('window.__mascotSoundProof.audioLifecycleCalls');proof.lifecycle.audioStateTransitions=await evaluate('window.__mascotSoundProof.audioStateTransitions');fs.writeFileSync('out/mascot-header-visibility-live.json',JSON.stringify(proof.lifecycle,null,2));assert.equal(proof.lifecycle.hiddenSettled.renderer.draws,hiddenDraws,'hidden stage performs no draw calls');assert.equal(proof.lifecycle.hiddenSettled.renderer.activeSources,0,'hidden stage leaves no live sound sources');assert(proof.lifecycle.hiddenSettled.renderer.audioStates.every(state=>state==='suspended'),'hidden audio remains suspended after delayed resume or browser state changes')
 await main(`(()=>{const w=testElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));if(process.platform==='darwin')testElectron.app.focus({steal:true});w.show();w.focus()})()`);await call('Emulation.setFocusEmulationEnabled',{enabled:true})
 // Native audio resume is asynchronous. Observe its real completion instead of
 // treating one snapshot 300ms after show as a permanent failure. This does not
 // change context state, replay input, or relax the hidden/pending-resume guards.
 const restoreStarted=Date.now(),restoreDeadline=restoreStarted+5000
 proof.lifecycle.restoreWait={source:'bounded observation after actual native app/window activation; real AudioContext state and fresh lifecycle traces, no synthetic state',maximumMs:5000,startedAt:new Date(restoreStarted).toISOString(),samples:[],ready:false,timedOut:false}
 while(Date.now()<restoreDeadline){
  const remaining=restoreDeadline-Date.now();let timer
  const sample=await Promise.race([
   Promise.all([visibilitySnapshot(),nativeFocus(false),evaluate('({hasFocus:document.hasFocus(),now:performance.now(),audioLifecycleCalls:window.__mascotSoundProof.audioLifecycleCalls,audioStateTransitions:window.__mascotSoundProof.audioStateTransitions})')]).then(([snapshot,foreground,audio])=>({...snapshot,foreground,...audio,elapsedMs:Date.now()-restoreStarted})),
   new Promise(resolve=>{timer=setTimeout(()=>resolve(null),remaining)})
  ]).finally(()=>clearTimeout(timer))
  if(!sample)break
  const foreground=sample.foreground
  sample.ready=sample.elapsedMs<=5000&&sample.native.isVisible&&!sample.native.isMinimized&&sample.renderer.nativeVisibility===true&&!sample.renderer.stageHidden&&foreground.windowFocused&&foreground.focusedWindowId===foreground.windowId&&foreground.windowVisible&&!foreground.windowMinimized&&foreground.appHidden!==true&&sample.hasFocus&&sample.renderer.draws>hiddenDraws&&sample.renderer.audioStates.length>0&&sample.renderer.audioStates.every(state=>state==='running')
  proof.lifecycle.restoreWait.samples.push(sample);proof.lifecycle.restoreWait.ready=sample.ready
  proof.lifecycle.restored=sample;proof.lifecycle.audioLifecycleCalls=sample.audioLifecycleCalls;proof.lifecycle.audioStateTransitions=sample.audioStateTransitions
  fs.writeFileSync('out/mascot-header-visibility-live.json',JSON.stringify(proof.lifecycle,null,2))
  if(sample.ready)break
  await wait(Math.max(0,Math.min(50,restoreDeadline-Date.now())))
 }
 proof.lifecycle.restoreWait.elapsedMs=Date.now()-restoreStarted;proof.lifecycle.restoreWait.timedOut=!proof.lifecycle.restoreWait.ready
 fs.writeFileSync('out/mascot-header-visibility-live.json',JSON.stringify(proof.lifecycle,null,2))
 assert(proof.lifecycle.restoreWait.ready,'within 5 seconds actual native foreground must resume owned stage rendering and its running AudioContext; original observed states retained')
 proof.checks.push('real native hide via controlled IPC pauses actual rendering and audio, raw Page Visibility recorded, foreground resumes, reduced-motion idle pauses and remains interactive')
 const voices=await evaluate('window.__mascotSoundProof.peakVoices');assert(voices>=7,'sources must overlap without cutting off the preceding slap')
 const events=await evaluate('window.__mascotSoundProof.events');assert(events.every(e=>e.peak>0&&e.peak<1&&e.rms>0))
 assert(events.slice(0,7).every((e,i,a)=>i===0||e.when>a[i-1].when),'one skipped-event sweep is scheduled as a short roll')
 proof.audio={sourcesStarted:events.length,maxLiveSources:voices,events,waveform:'actual AudioBufferSourceNode buffer captured',hardwareListening:'not performed'}
 const sample=await evaluate('window.__mascotSoundProof.samples'),wav=Buffer.alloc(44+sample.values.length*2)
 wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sample.sampleRate,24);wav.writeUInt32LE(sample.sampleRate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(sample.values.length*2,40);sample.values.forEach((v,i)=>wav.writeInt16LE(Math.round(v*32767),44+i*2));fs.writeFileSync('out/mascot-slap-117.wav',wav)
 await click('[aria-label="互动设置"]');await evaluate("(()=>{const input=document.querySelector('[aria-label=\"拍打音效音量\"]');input.value='32';input.dispatchEvent(new Event('input',{bubbles:true}))})()");await click('[aria-label="静音拍打音效"]');await wait(180)
 const soundBefore=await evaluate('window.__mascotSoundProof.events.length'),beforeMuted=await evaluate("window.kamucl.invoke('mascots:state')");await click('[data-hit=q3]');const mutedCounts={...beforeMuted.counts,q3:beforeMuted.counts.q3+1};await awaitCounts('muted hit still saves once',mutedCounts);assert.equal(await evaluate('window.__mascotSoundProof.events.length'),soundBefore,'mute affects actual sources')
 const previewBeforeClose=await previewSnapshot()
 await click('[aria-label="关闭七人互动"]');await awaitCounts('close flushes and restores the LOGO',mutedCounts,true)
 let previewResumed;for(let i=0;i<30;i++){previewResumed=await previewSnapshot();if(previewResumed.previews.filter(p=>p.connected&&!p.editing).every(p=>p.draws>(previewBeforeClose.previews.find(old=>old.id===p.id)?.draws??Infinity)))break;await wait(50)}assert(previewResumed.previews.some(p=>p.connected&&!p.editing)&&previewResumed.previews.filter(p=>p.connected&&!p.editing).every(p=>p.draws>(previewBeforeClose.previews.find(old=>old.id===p.id)?.draws??Infinity)),'closing the stage resumes actual decorative preview draws on the same contexts');proof.previewLifecycle.afterClose={before:previewBeforeClose,after:previewResumed};proof.checks.push('decorative previews yield to active header, real camera gesture remains usable, same-context preview rendering resumes on close')
 assert.equal(await evaluate('!!document.querySelector(".mascot-stage")'),false);assert.equal(await evaluate('window.__mascotSoundProof.closed'),1,'closing must release the owned AudioContext')
 const appearanceRestored=await appearanceSnapshot();assert.deepEqual(appearanceRestored,appearanceBefore,'closing restores the original theme frost on the same page');proof.previewLifecycle.appearance.restored=appearanceRestored
 assert.equal(await evaluate('window.__mascotSoundProof.glReleased'),1,'hardware close or CPU capability-probe selection loses its one owned WebGL context')
 if(softwareRenderer){const released=await evaluate('window.__mascotSoundProof.cpuCanvases.map(canvas=>({connected:canvas.isConnected,width:canvas.width,height:canvas.height}))');assert.equal(released.length,1);assert(released.every(canvas=>!canvas.connected&&canvas.width===0&&canvas.height===0),'CPU close releases the owned canvas pixel allocation');const uploads=await evaluate('window.__mascotSoundProof.cpuUploads');await wait(120);assert.equal(await evaluate('window.__mascotSoundProof.cpuUploads'),uploads,'disposed CPU renderer uploads no further frames');proof.lifecycle.cpuReleased=released}
 const persisted=JSON.parse(fs.readFileSync(path.join(profile,'mascot-counts.json'),'utf8'));assert.deepEqual(persisted.sound,{muted:true,volume:.32})
 const closeCount=persisted.counts.q3
 assert.equal(await evaluate('document.activeElement.classList.contains("brand-avatar")'),true,'close restores LOGO keyboard focus')
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space'})
 // Observe the real asynchronous reopening and focus handoff. Do not focus a
 // target from the test or treat a fixed-delay snapshot as initialization ready.
 const keyboardStarted=Date.now(),keyboardDeadline=keyboardStarted+6000
 proof.keyboardReady={maximumMs:6000,source:'actual keyboard activation, enabled model targets, native foreground and product-owned focus handoff',samples:[],ready:false,timedOut:false}
 let focusedId
 while(Date.now()<keyboardDeadline){
  const remaining=keyboardDeadline-Date.now();let timer
  const sample=await Promise.race([
   Promise.all([persistenceSnapshot(),nativeFocus(false),evaluate(`(()=>{const stage=document.querySelector('.mascot-stage');return{hasFocus:document.hasFocus(),hidden:document.hidden,visibilityState:document.visibilityState,modelBounds:JSON.parse(stage?.dataset.modelBounds||'[]'),audioStates:window.__mascotSoundProof.contexts.map(context=>context.state)}})()`)]).then(([snapshot,foreground,renderer])=>({snapshot,foreground,renderer,elapsedMs:Date.now()-keyboardStarted})),
   new Promise(resolve=>{timer=setTimeout(()=>resolve(null),remaining)})
  ]).finally(()=>clearTimeout(timer))
  if(!sample)break
  const {local,saved}=sample.snapshot,foreground=sample.foreground
  sample.ready=sample.elapsedMs<=6000&&local.stageOpen&&!local.stageHidden&&local.buttons.length===7&&local.buttons.every(button=>!button.disabled)&&local.focused.hit===saved.order[0]&&!local.focused.disabled&&sample.renderer.modelBounds.models?.length===7&&sample.renderer.hasFocus&&!sample.renderer.hidden&&foreground.windowFocused&&foreground.focusedWindowId===foreground.windowId&&foreground.windowVisible&&!foreground.windowMinimized&&foreground.appHidden!==true
  proof.keyboardReady.samples.push(sample);proof.keyboardReady.ready=sample.ready
  fs.writeFileSync('out/mascot-header-keyboard-ready-live.json',JSON.stringify({version,...proof.keyboardReady},null,2))
  if(sample.ready){focusedId=local.focused.hit;break}
  await wait(Math.max(0,Math.min(50,keyboardDeadline-Date.now())))
 }
 proof.keyboardReady.elapsedMs=Date.now()-keyboardStarted;proof.keyboardReady.timedOut=!proof.keyboardReady.ready
 fs.writeFileSync('out/mascot-header-keyboard-ready-live.json',JSON.stringify({version,...proof.keyboardReady},null,2))
 assert(proof.keyboardReady.ready,'within 6 seconds keyboard LOGO activation must focus the first enabled Minecraft target with real model bounds and native foreground; original observed states retained')
 assert.equal((await evaluate("window.kamucl.invoke('mascots:state')")).counts.q3,closeCount)
 assert.equal(await evaluate('document.querySelector(".stage-tools button").getAttribute("aria-pressed")'),'true')
 const repeatBefore=await evaluate("window.kamucl.invoke('mascots:state')");await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space'});await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',autoRepeat:true});await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',autoRepeat:true});await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space'});await awaitCounts('held keyboard Space is exactly one slap',{...repeatBefore.counts,[focusedId]:repeatBefore.counts[focusedId]+1})
 const beforeEscape=await evaluate("window.kamucl.invoke('mascots:state')")
 await click('[data-hit=q3]');await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});await awaitCounts('Escape flushes the final hit before closing',{...beforeEscape.counts,q3:beforeEscape.counts.q3+1},true);assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'mascot-counts.json'),'utf8')).counts.q3,beforeEscape.counts.q3+1,'Escape immediately flushes the last hit');assert.equal(await evaluate('document.activeElement.classList.contains("brand-avatar")'),true)
 proof.checks.push('sound/volume persisted, mute, close flush, reopen counts, owned audio context released')
 proof.checks.push('real keyboard LOGO activation, focus entry/restore, Space repeat suppressed, full model corner bounds')
 await main(`(()=>{globalThis.originalMascotBatch=testElectron.ipcMain._invokeHandlers.get('mascots:batch');globalThis.dropMascotAck=true;testElectron.ipcMain.removeHandler('mascots:batch');testElectron.ipcMain.handle('mascots:batch',async(event,value)=>{const result=await originalMascotBatch(event,value);if(dropMascotAck){dropMascotAck=false;throw Error('isolated fixture: committed batch acknowledgement lost')}return result});globalThis.mascotPendingTrace=[];testElectron.ipcMain.on('window:mascotPending',(_event,value)=>mascotPendingTrace.push(value))})()`)
 await trustedClick('[aria-label="打开七人互动彩蛋"]');await wait(650)
 const beforeLostAck=await evaluate("window.kamucl.invoke('mascots:state')");await click('[data-hit=q3]');await click('[aria-label="关闭七人互动"]');await wait(150)
 assert.equal(await evaluate('!!document.querySelector(".mascot-stage")'),true,'unknown save acknowledgement keeps the stage open')
 assert.equal(await main('mascotPendingTrace[mascotPendingTrace.length-1]'),true,'failed flush never falsely clears close protection')
 await awaitCounts('committed but lost acknowledgement retries without double count',{...beforeLostAck.counts,q3:beforeLostAck.counts.q3+1})
 await click('[aria-label="关闭七人互动"]');await awaitCounts('close after unknown acknowledgement saves exactly once',{...beforeLostAck.counts,q3:beforeLostAck.counts.q3+1},true);assert.equal(await evaluate('!!document.querySelector(".mascot-stage")'),false);assert.equal(await main('mascotPendingTrace[mascotPendingTrace.length-1]'),false)
 await main(`testElectron.ipcMain.removeHandler('mascots:batch');testElectron.ipcMain.handle('mascots:batch',originalMascotBatch)`)
 proof.checks.push('committed-but-lost acknowledgement retries without duplicates, failed close preserves pending protection')
 const batch={batchId:'gui-117-idempotent-proof',hits:['q3','milo']},beforeBatch=await evaluate("window.kamucl.invoke('mascots:state')")
 await evaluate(`window.kamucl.invoke('mascots:batch',${JSON.stringify(batch)})`);await evaluate(`window.kamucl.invoke('mascots:batch',${JSON.stringify(batch)})`)
 const afterBatch=await evaluate("window.kamucl.invoke('mascots:state')");assert.equal(afterBatch.counts.q3,beforeBatch.counts.q3+1)
 const rejected=await evaluate(`window.kamucl.invoke('mascots:batch',{batchId:'gui-117-idempotent-proof',hits:['qiqi']}).then(()=>false,()=>true)`);assert.equal(rejected,true)
 proof.checks.push('real main IPC retry idempotence and changed-batch rejection')
 const recording=await evaluate(`(async()=>{const proof=window.__mascotSoundProof,all=[];for(const recorder of proof.recorders){if(recorder.state!=='inactive')await new Promise(resolve=>{recorder.addEventListener('stop',resolve,{once:true});recorder.stop()});if(recorder.__chunks.length){const blob=new Blob(recorder.__chunks,{type:'audio/webm'});all.push(Array.from(new Uint8Array(await blob.arrayBuffer())))}}if(all[0]){const decoder=new window.__mascotOriginalAudioContext(),decoded=await decoder.decodeAudioData(new Uint8Array(all[0]).buffer);let peak=0,power=0;for(let c=0;c<decoded.numberOfChannels;c++)for(const value of decoded.getChannelData(c)){peak=Math.max(peak,Math.abs(value));power+=value*value}proof.output={peak,rms:Math.sqrt(power/(decoded.length*decoded.numberOfChannels)),samples:decoded.length,sampleRate:decoded.sampleRate};await decoder.close()}return all})()`)
   if(recording[0]){fs.writeFileSync('out/mascot-sweep-117.webm',Buffer.from(recording[0]));proof.audio.recording='only the stage compressor output, no microphone or system capture';proof.audio.output=await evaluate('window.__mascotSoundProof.output');assert(proof.audio.output.peak>0&&proof.audio.output.peak<.999,'actual recorded mixer output is nonzero and unclipped')}
 proof.audio.lifecycleCalls=await evaluate('window.__mascotSoundProof.audioLifecycleCalls');proof.audio.stateTransitions=await evaluate('window.__mascotSoundProof.audioStateTransitions');proof.finalState=afterBatch;fs.writeFileSync('out/mascot-header-ui-'+(process.env.KAMUCL_TEST_THEME||'black-orange')+'.json',JSON.stringify(proof,null,2));console.log(version+' Minecraft header mascot FUNCTIONAL GUI checks passed; capture benchmark '+proof.performanceBenchmark.status)
 await evaluate('(()=>{const h=window.__mascotHooks;window.AudioContext=h.Original;AudioBufferSourceNode.prototype.start=h.start;AudioNode.prototype.connect=h.connect;h.Original.prototype.close=h.close;h.Original.prototype.resume=h.resume;h.Original.prototype.suspend=h.suspend;HTMLCanvasElement.prototype.getContext=h.getContext;WebGL2RenderingContext.prototype.drawElements=h.draw;CanvasRenderingContext2D.prototype.putImageData=h.putImageData})()')
 await main("testElectron.ipcMain.removeHandler('mascots:batch');testElectron.ipcMain.handle('mascots:batch',mascotProofBatchBase);testElectron.ipcMain.removeListener('window:mascotPending',mascotProofPendingListener)")
 await nav('home')
 await call('Emulation.setEmulatedMedia',{features:[]})
}
