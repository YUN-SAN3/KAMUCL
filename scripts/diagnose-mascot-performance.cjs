// Disposable failure diagnostics only. None of these controls can satisfy a GUI gate.
const fs=require('node:fs')
module.exports=async function diagnoseMascotPerformance(h,cause){
 const {call,evaluate,main,wait}=h,out='out/mascot-header-performance-diagnostic.json'
 const proof={source:'Failure-only disposable QA controls at the original viewport. Preview GL submission bypass and card blur removal are diagnostic ablations, not product behavior or successful acceptance.',cause,startedAt:new Date().toISOString(),phases:[],errors:[],complete:false}
 const save=()=>fs.writeFileSync(out,JSON.stringify(proof,null,2))
 const native=()=>main(`(()=>{const w=testElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));return{now:Date.now(),processCPU:process.getCPUUsage(),metrics:testElectron.app.getAppMetrics(),window:w?{bounds:w.getBounds(),visible:w.isVisible(),focused:w.isFocused(),zoom:w.webContents.getZoomFactor()}:null}})()`)
 let installed=false,profiling=false
 try{
  proof.nativeBefore=await native()
  proof.controls=await evaluate(`(()=>{
   const trace=window.__mascotFailureDiagnostic={frames:[],longTasks:[],phase:'none',skipPreview:false,calls:{stage:{clear:0,drawElements:0,drawArrays:0},preview:{clear:0,drawElements:0,drawArrays:0},other:{clear:0,drawElements:0,drawArrays:0}},canvases:[],canvasIds:new WeakMap(),suppressed:{clear:0,drawElements:0,drawArrays:0},originals:[]};
   for(const name of ['WebGLRenderingContext','WebGL2RenderingContext']){
    const proto=window[name]?.prototype;if(!proto)continue;
    for(const method of ['clear','drawElements','drawArrays']){
     const original=proto[method],owned=Object.prototype.hasOwnProperty.call(proto,method);trace.originals.push({proto,method,original,owned});
     proto[method]=function(...args){const canvas=this.canvas,area=canvas?.closest?.('.figure-strip')?'stage':canvas?.closest?.('.viewer3d')?'preview':'other';let id=trace.canvasIds.get(canvas);if(id===undefined){id=trace.canvases.length;trace.canvasIds.set(canvas,id);trace.canvases.push({id,area,width:canvas.width,height:canvas.height,parent:canvas.parentElement?.className,bounds:canvas.getBoundingClientRect?.().toJSON(),calls:{clear:0,drawElements:0,drawArrays:0},suppressed:{clear:0,drawElements:0,drawArrays:0}})}trace.canvases[id].calls[method]++;trace.calls[area][method]++;if(trace.skipPreview&&area==='preview'){trace.suppressed[method]++;trace.canvases[id].suppressed[method]++;return}return original.apply(this,args)}
    }
   }
   const style=document.createElement('style');style.dataset.mascotDiagnostic='true';style.textContent='.skins-page .card{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}';trace.style=style;
   if(PerformanceObserver.supportedEntryTypes.includes('longtask')){trace.observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())trace.longTasks.push({start:entry.startTime,duration:entry.duration,name:entry.name,phase:trace.phase})});trace.observer.observe({type:'longtask'})}
   return{viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},previews:[...document.querySelectorAll('.viewer3d')].map(e=>({classes:e.className,bounds:e.getBoundingClientRect().toJSON(),editing:e.classList.contains('editing')})),cards:[...document.querySelectorAll('.skins-page .card')].map(e=>({classes:e.className,backdrop:getComputedStyle(e).backdropFilter})),stage:document.querySelector('.mascot-stage')?.className,note:'GL clear/draw bypass applies only to actual .viewer3d canvases; CPU rig updates and other renderer submissions remain active. This is not a production paused prop.'}
  })()`)
  installed=true;save()
  try{await call('Profiler.enable');await call('Profiler.setSamplingInterval',{interval:1000});proof.cpuProfilerSupported=true}catch(error){proof.cpuProfilerSupported=false;proof.errors.push({at:'Profiler.enable',error:String(error)})}
  for(const [name,skipPreview,noBlur] of [['normal',false,false],['preview-gl-bypass',true,false],['card-no-blur',false,true],['combined',true,true],['restored-normal',false,false]]){
   await evaluate(`(()=>{const t=window.__mascotFailureDiagnostic;t.skipPreview=${skipPreview};if(${noBlur})document.head.appendChild(t.style);else t.style.remove();t.phase='settling'})()`)
   await wait(200)
   const phase={name,skipPreview,noBlur,nativeBefore:await native(),cpuProfile:null}
   proof.phases.push(phase)
   if(proof.cpuProfilerSupported)try{await call('Profiler.start');profiling=true}catch(error){proof.errors.push({at:name+':Profiler.start',error:String(error)})}
   await evaluate(`(()=>{const t=window.__mascotFailureDiagnostic;t.phase=${JSON.stringify(name)};t.frames=[];t.startedAt=performance.now();t.callsBefore=JSON.parse(JSON.stringify(t.calls));t.canvasesBefore=JSON.parse(JSON.stringify(t.canvases));t.suppressedBefore={...t.suppressed};const tick=now=>{const stage=document.querySelector('.mascot-stage'),poses=JSON.parse(stage?.dataset.poses||'[]');t.frames.push({now,observedAt:performance.now(),renderMs:Number(stage?.dataset.renderMs),stageDrawCalls:Number(stage?.dataset.renderDrawCalls),walking:poses.some(p=>p.walking),positions:poses.map(p=>({id:p.id,position:p.position,target:p.target})),stageHidden:stage?.classList.contains('hidden')??null,pageHidden:document.hidden,hasFocus:document.hasFocus(),calls:JSON.parse(JSON.stringify(t.calls))});t.frame=requestAnimationFrame(tick)};t.frame=requestAnimationFrame(tick)})()`)
   await wait(1000)
   phase.renderer=await evaluate(`(()=>{const t=window.__mascotFailureDiagnostic;cancelAnimationFrame(t.frame);const endedAt=performance.now(),frames=t.frames;return{startedAt:t.startedAt,endedAt,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},frames,longTasks:t.longTasks.filter(e=>e.phase===${JSON.stringify(name)}),callsBefore:t.callsBefore,callsAfter:JSON.parse(JSON.stringify(t.calls)),canvasesBefore:t.canvasesBefore,canvasesAfter:JSON.parse(JSON.stringify(t.canvases)),suppressedBefore:t.suppressedBefore,suppressedAfter:{...t.suppressed},cardBackdrop:[...document.querySelectorAll('.skins-page .card')].map(e=>getComputedStyle(e).backdropFilter)}})()`)
   if(profiling)try{phase.cpuProfile=(await call('Profiler.stop')).profile}catch(error){proof.errors.push({at:name+':Profiler.stop',error:String(error)})}finally{profiling=false}
   phase.nativeAfter=await native()
   const frames=phase.renderer.frames,elapsedMs=frames.length>1?frames.at(-1).now-frames[0].now:0
   phase.cadence={samples:frames.length,elapsedMs,rafFps:elapsedMs?(frames.length-1)*1000/elapsedMs:0,intervalsMs:frames.slice(1).map((f,i)=>f.now-frames[i].now)}
   save()
  }
  proof.complete=true
 }catch(error){proof.errors.push({at:'diagnostic',error:String(error)})}
 finally{
  if(profiling)try{await call('Profiler.stop')}catch(error){proof.errors.push({at:'cleanup:Profiler.stop',error:String(error)})}
  if(installed)try{proof.restored=await evaluate(`(()=>{const t=window.__mascotFailureDiagnostic;cancelAnimationFrame(t.frame);t.observer?.disconnect();t.style.remove();for(const entry of t.originals.reverse()){if(entry.owned)entry.proto[entry.method]=entry.original;else delete entry.proto[entry.method]}const result={viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},cards:[...document.querySelectorAll('.skins-page .card')].map(e=>getComputedStyle(e).backdropFilter),prototypesRestored:true};delete window.__mascotFailureDiagnostic;return result})()`)}catch(error){proof.errors.push({at:'cleanup:renderer',error:String(error)})}
  proof.finishedAt=new Date().toISOString();save()
 }
 return proof
}
