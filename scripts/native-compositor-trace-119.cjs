// Explicit opt-in, separate diagnostic run only. Not registered with acceptance.
// Caller supplies the SAME existing action/recordScreencast, without changing its
// input, capture parameters or assertions. Tracing overhead invalidates FPS claims.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const categories=['toplevel','devtools.timeline','disabled-by-default-devtools.timeline.frame','cc','viz','gpu','renderer.scheduler','blink.user_timing','disabled-by-default-cc.debug','disabled-by-default-viz.debug','v8','disabled-by-default-v8.compile','disabled-by-default-v8.gc']
const relevant=/BeginFrame|BeginMainFrame|RequestMainFrame|NeedsBeginFrame|Deadline|DrawFrame|SubmitCompositorFrame|ReceiveCompositorFrame|SurfaceAggregator|Swap|Presentation|Display::|Paint|Raster|Composite|Commit|Activate|Tile|Layer|Layout|UpdateStyle|UpdateLayout|FireAnimationFrame|AnimationFrame|RunTask|ProcessTask|Wait|Gpu|GPU|Flush|ReadPixels|DrawAndSwap|Scheduler|VSync|vsync|FrameSink|V8[.:]|Compile|Parse|GC[.:]|Scavenge|MarkCompact/
// Additional Chromium rendering names only. Argument privacy remains numeric
// allowlist-only; unrelated capture payloads and user timing marks stay excluded.
const recorderRelevant=/^(?:CopyOutput(?:Request|Result)?(?:::[A-Za-z0-9_]+)?|DirectRenderer::DrawRenderPass|SoftwareRenderer::(?:Draw|Copy)[A-Za-z0-9_]*|(?:DevToolsVideoConsumer|FrameSinkVideoCapturerImpl|VideoCaptureOracle|VideoFrameCapture|ScreenCapture|CaptureFrame|CaptureContent|CaptureScreenshot|CopyFromSurface)(?:::[A-Za-z0-9_]+)?)$/
const allowedArgs=new Set(['data','clip','rect','bounds','damage','damage_rect','layerId','layer_id','frameId','frame_id','source_id','sequence_number','frame_time','deadline','interval','has_damage','type','x','y','width','height','begin_frame_args','expected_display_time','frame_token','surface_id','local_surface_id','frame_sink_id','id','nodeId','backendNodeId'])
function numericArgs(value,key){
  if(!allowedArgs.has(key))return undefined
  if(typeof value==='number')return Number.isFinite(value)?value:undefined
  if(typeof value==='boolean')return value
  if(Array.isArray(value)){const kept=value.map(v=>typeof v==='number'&&Number.isFinite(v)?v:undefined);return kept.every(v=>v!==undefined)?kept:undefined}
  if(value&&typeof value==='object'){const result={};for(const [k,v]of Object.entries(value)){const clean=numericArgs(v,k);if(clean!==undefined)result[k]=clean}return result}
  // No URL, path, script, DOM text, typed value, arbitrary annotation or payload.
  return undefined
}
function redactEvents(events,markerName){
  return events.flatMap((e,sourceIndex)=>{
    if(typeof e.name!=='string'||!/^[A-Za-z0-9_ .:<>-]+$/.test(e.name))return[]
    if(String(e.cat||'').split(',').includes('blink.user_timing')&&e.name!==markerName)return[]
    const meta=e.ph==='M'&&['thread_name','process_name'].includes(e.name)
    if(!meta&&e.name!==markerName&&!relevant.test(e.name||'')&&!recorderRelevant.test(e.name||''))return[]
    const clean={sourceIndex};for(const key of ['name','cat','ph'])if(typeof e[key]==='string')clean[key]=e[key]
    for(const key of ['pid','tid','ts','dur','tdur','tts','id'])if(Number.isFinite(e[key]))clean[key]=e[key]
    clean.args={}
    if(meta){const name=e.args?.name;if(typeof name==='string'&&/^(CrRendererMain|CrBrowserMain|CrGpuMain|Renderer|Browser|GPU Process|Compositor|VizCompositorThread|ThreadPool[A-Za-z0-9 _-]*|[A-Za-z0-9 _-]*(?:Compositor|Raster|Gpu|GPU|Renderer|Browser)[A-Za-z0-9 _-]*)$/.test(name))clean.args.name=name}
    else for(const [key,value]of Object.entries(e.args||{})){const kept=numericArgs(value,key);if(kept!==undefined)clean.args[key]=kept}
    return[clean]
  })
}
function summarize(events,marker){
  const stamp=events.find(e=>e.name===marker?.name&&Number.isFinite(e.ts)),offset=stamp?marker.timeOrigin+marker.startTime-stamp.ts/1000:null,threads=new Map(),stacks=new Map(),durations=[]
  for(const e of events){
    if(e.name==='thread_name')threads.set(e.pid+':'+e.tid,e.args.name||null)
    if(e.ph==='X'&&Number.isFinite(e.dur))durations.push(e)
    else if(e.ph==='B'){const key=e.pid+':'+e.tid;const stack=stacks.get(key)||[];stack.push(e);stacks.set(key,stack)}
    else if(e.ph==='E'){const start=stacks.get(e.pid+':'+e.tid)?.pop();if(start&&start.name===e.name&&e.ts>=start.ts)durations.push({...start,dur:e.ts-start.ts,endSourceIndex:e.sourceIndex,pairedActualBeginEnd:true})}
  }
  const describe=e=>({...e,thread:threads.get(e.pid+':'+e.tid)||null,durationMs:e.dur/1000,performanceStartMs:offset===null?null:e.ts/1000+offset-marker.timeOrigin})
  return{clock:{marker,traceTimestamp:stamp?.ts??null,valid:offset!==null,monotonicToEpochOffsetMs:offset},eventCount:events.length,frameEvents:events.filter(e=>/BeginFrame|BeginMainFrame|DrawFrame|SubmitCompositorFrame|Swap|Presentation|VSync|vsync/.test(e.name)),paintEvents:events.filter(e=>/Paint|Raster|Layout|UpdateStyle|UpdateLayout/.test(e.name)),longEvents:durations.filter(e=>e.dur>=50000).map(describe),note:'Original monotonic microseconds and source indices retained. Missing events/clock are not synthesized. Nested event durations are not exclusive CPU time.'}
}
function bounded(promise,ms,label){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),ms)})]).finally(()=>clearTimeout(timer))}

// Browser-level CDP exposes Viz/GPU processes in addition to the renderer. This
// uses only the disposable launcher's existing loopback port; no preference write.
async function connectTransport(h){
  const port=await h.main("Number(testElectron.app.commandLine.getSwitchValue('remote-debugging-port'))")
  if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('Missing disposable loopback debugger')
  const endpoint=await(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(10000)})).json(),url=new URL(endpoint.webSocketDebuggerUrl)
  if(url.protocol!=='ws:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||Number(url.port)!==port)throw Error('Refusing nonlocal/unowned trace target')
  const socket=new WebSocket(url),pending=new Map(),listeners=new Set();let id=0
  const dispose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Trace transport closed'))}pending.clear();listeners.clear();socket.close()}
  try{await bounded(new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('Trace socket open failed')),{once:true})}),10000,'Trace socket open')}catch(error){dispose();throw error}
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message||'CDP trace command rejected')):p.resolve(m.result)}}else for(const listener of listeners)listener(m.method,m.params)})
  socket.addEventListener('close',()=>{for(const listener of listeners)listener('__closed',{});dispose()},{once:true})
  return{call:(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error(method+' timed out'))},12000);pending.set(n,{resolve,reject,timer});socket.send(JSON.stringify({id:n,method,params}))}),subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},close:dispose}
}

async function runTrace(h,action,options={}){
  const enabled=options.enabled===true||process.env.KAMUCL_NATIVE_COMPOSITOR_TRACE==='1'
  if(!enabled)return{enabled:false,actionExecuted:false,reason:'opt-in diagnostic only; no automatic registration'}
  if(options.separateRun!==true)throw Error('Tracing requires an explicitly separate diagnostic run')
  if(await h.main('process.platform')!=='darwin')throw Error('Native compositor trace requires Darwin')
  const base=options.outputBase||path.resolve('out/kamu-native-compositor-trace-119'),proof={version:h.version,enabled:true,complete:false,actionExecuted:false,classification:'separate instrumented diagnostic; never normal performance acceptance',privacy:'Screenshots, netlog, input values, script URLs and arbitrary trace args are not collected to disk. Only rendering event fields plus allowlisted numeric geometry/IDs survive. Unsanitized stream exists only in memory.',limitations:'V8 compile/GC, renderer task, Paint/UpdateLayerTree/Commit categories/names requested, but support, buffer loss and event/privacy filtering limit coverage. Missing events never establish absence; nested wall durations are not exclusive CPU time.',categories,errors:[],cleanup:{},startedAt:new Date().toISOString()}
  const save=()=>{fs.mkdirSync(path.dirname(base),{recursive:true});fs.writeFileSync(base+'.json',JSON.stringify(proof,null,2))}
  let transport,unsubscribe,started=false,stream,marker,actionError,traceError,resolveComplete,rejectComplete
  const observe=async label=>{
    if(!['before-action','ready','before-capture','after-capture','after-action'].includes(label))throw Error('Unknown trace observation phase')
    const native=await h.main(`(()=>{const candidates=testElectron.BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()&&/\\/renderer\\/index\\.html(?:[?#]|$)/.test(w.webContents.getURL()));if(candidates.length!==1)throw Error('Ambiguous native observation target');const w=candidates[0];return{windowId:w.id,webContentsId:w.webContents.id,visible:w.isVisible(),minimized:w.isMinimized(),focused:w.isFocused(),bounds:w.getBounds(),backgroundThrottling:w.webContents.getBackgroundThrottling(),appHidden:testElectron.app.isHidden()}})()`)
    const renderer=await h.evaluate("({now:performance.now(),timeOrigin:performance.timeOrigin,visibilityState:document.visibilityState,hidden:document.hidden,focused:document.hasFocus(),readyState:document.readyState})")
    ;(proof.surfaces??=[]).push({label,native,renderer});save()
  }
  const completion=new Promise((resolve,reject)=>{resolveComplete=resolve;rejectComplete=reject});completion.catch(()=>{})
  const timeout=options.completionTimeoutMs??20000,maxBytes=options.maxBytes??64*1024*1024
  try{
    transport=options.transport||await connectTransport(h)
    unsubscribe=transport.subscribe((method,params)=>{if(method==='Tracing.tracingComplete')resolveComplete(params);else if(method==='__closed')rejectComplete(Error('Trace connection closed before completion'))})
    await transport.call('Tracing.start',{categories:categories.join(','),options:'record-until-full',transferMode:'ReturnAsStream',streamFormat:'json',streamCompression:'none'});started=true;proof.startAcknowledged=true
    const name='KAMUCL-native-compositor-diagnostic-'+crypto.randomUUID()
    marker=await h.evaluate(`(()=>{performance.mark(${JSON.stringify(name)});const m=performance.getEntriesByName(${JSON.stringify(name)}).at(-1);return{name:m.name,startTime:m.startTime,timeOrigin:performance.timeOrigin}})()`);proof.marker=marker
    await observe('before-action');proof.actionExecuted=true
    try{await action({observe})}catch(error){actionError=error;proof.errors.push({phase:'action',message:error.name||'Error'} /* arbitrary exception strings may contain input */)}
    try{await observe('after-action')}catch(error){traceError??=error;proof.errors.push({phase:'after-action-observation',message:error.name||'Error'})}
  }catch(error){traceError=error;proof.errors.push({phase:started?'marker':'start',message:error.name||'Error'})}
  finally{
    // Start rejection must not stop someone else's active browser trace. Once
    // our start is acknowledged, end/drain/close are attempted even on assertion failure.
    if(started&&transport){
      try{await transport.call('Tracing.end');proof.cleanup.endAcknowledged=true}catch(error){proof.cleanup.endAcknowledged=false;traceError??=error;proof.errors.push({phase:'end',message:error.name||'Error'})}
      try{
        const completed=await bounded(completion,timeout,'Tracing.tracingComplete');proof.completion={dataLossOccurred:completed.dataLossOccurred??null,hasStream:!!completed.stream}
        if(!completed.stream)throw Error('No trace stream returned');stream=completed.stream
        const chunks=[];let eof=false,total=0;const deadline=Date.now()+(options.drainTimeoutMs??20000)
        try{while(!eof){const remaining=deadline-Date.now();if(remaining<=0)throw Error('Trace stream drain timed out');const chunk=await bounded(transport.call('IO.read',{handle:stream,size:1024*1024}),remaining,'IO.read');const bytes=Buffer.from(chunk.data,chunk.base64Encoded?'base64':'utf8');total+=bytes.length;if(total>maxBytes)throw Error('Trace exceeded bounded memory limit');chunks.push(bytes);eof=chunk.eof===true}
          const raw=Buffer.concat(chunks),parsed=JSON.parse(raw.toString('utf8')),events=Array.isArray(parsed)?parsed:parsed.traceEvents;if(!Array.isArray(events))throw Error('Trace event array missing')
          const filtered=redactEvents(events,marker?.name),document=JSON.stringify({classification:proof.classification,privacy:proof.privacy,traceEvents:filtered}),eventFile=base+'-events.json'
          fs.writeFileSync(eventFile,document);proof.eventsFile=eventFile;proof.eventsSHA256=crypto.createHash('sha256').update(document).digest('hex');proof.receivedBytes=total;proof.receivedEvents=events.length;proof.redactedEvents=filtered.length;Object.assign(proof,summarize(filtered,marker));proof.cleanup.drained=true
        }finally{await transport.call('IO.close',{handle:stream});proof.cleanup.streamClosed=true}
        if(completed.dataLossOccurred===true)throw Error('Trace buffer lost events; incomplete diagnostic')
      }catch(error){traceError??=error;proof.errors.push({phase:'drain',message:error.name||'Error'})}
    }
    try{if(marker)await h.evaluate(`performance.clearMarks(${JSON.stringify(marker.name)})`)}catch(error){traceError??=error;proof.errors.push({phase:'clear-marker',message:error.name||'Error'})}
    try{unsubscribe?.();proof.cleanup.unsubscribed=true}catch(error){traceError??=error;proof.errors.push({phase:'unsubscribe',message:error.name||'Error'})}
    try{transport?.close();proof.cleanup.transportClosed=!!transport}catch(error){traceError??=error;proof.errors.push({phase:'transport-close',message:error.name||'Error'})}
    proof.finishedAt=new Date().toISOString();proof.complete=!!proof.cleanup.drained&&!!proof.cleanup.streamClosed&&!actionError&&!traceError;save()
  }
  if(actionError&&traceError)throw new AggregateError([actionError,traceError],'Diagnostic action and trace collection failed')
  if(actionError)throw actionError
  if(traceError)throw traceError
  return proof
}
module.exports=runTrace
module.exports.redactEvents=redactEvents
module.exports.summarize=summarize
