// Native disposable QA: Chrome's real first-leader timeline, never reconstructed frames.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const categories=['toplevel','devtools.timeline','disabled-by-default-devtools.timeline','disabled-by-default-devtools.timeline.frame','blink','blink.user_timing','cc','gpu','renderer.scheduler','v8']

function summarize(events,marker){
 const metadata=events.filter(e=>e.ph==='M'),names=new Map()
 for(const event of metadata)if(event.name==='thread_name'||event.name==='process_name')names.set(event.pid+':'+(event.name==='thread_name'?event.tid:'process'),event.args?.name)
 const stamp=events.find(e=>e.name===marker.name&&Number.isFinite(e.ts)),offsetMs=stamp?marker.timeOrigin+marker.startTime-stamp.ts/1000:null
 const clock={source:'actual performance.mark startTime/timeOrigin matched to its blink.user_timing trace event; original monotonic microsecond timestamps retained',marker,traceMarker:stamp||null,valid:offsetMs!==null,monotonicToEpochOffsetMs:offsetMs}
 const durationEvents=[],stacks=new Map()
 for(const [index,event] of events.entries()){
  if(event.ph==='X'&&Number.isFinite(event.dur))durationEvents.push({...event,sourceIndex:index})
  else if(event.ph==='B'){const key=event.pid+':'+event.tid,stack=stacks.get(key)||[];stack.push({event,index});stacks.set(key,stack)}
  else if(event.ph==='E'){const start=stacks.get(event.pid+':'+event.tid)?.pop();if(start&&event.ts>=start.event.ts)durationEvents.push({...start.event,ph:'X',dur:event.ts-start.event.ts,sourceIndex:start.index,endSourceIndex:index,sourcePhase:'paired actual B/E events'})}
 }
 const describe=event=>({name:event.name,category:event.cat,pid:event.pid,tid:event.tid,process:names.get(event.pid+':process')||null,thread:names.get(event.pid+':'+event.tid)||null,ts: event.ts,dur:event.dur,durationMs:event.dur/1000,epochStartMs:offsetMs===null?null:event.ts/1000+offsetMs,epochEndMs:offsetMs===null?null:(event.ts+event.dur)/1000+offsetMs,performanceStartMs:offsetMs===null?null:event.ts/1000+offsetMs-marker.timeOrigin,sourceIndex:event.sourceIndex,endSourceIndex:event.endSourceIndex,sourcePhase:event.sourcePhase||'actual X duration event',args:event.args||null})
 const tasks=durationEvents.filter(e=>/RunTask|ProcessTaskFromWorkQueue/.test(e.name)&&e.dur>=50000)
 const interesting=/Paint|UpdateLayoutTree|Layout|Composite|Raster|Commit|Draw|GPU|Gpu|Swap|Wait|FunctionCall|EvaluateScript|FireAnimationFrame|TimerFire|Style|Animation|Compile|GC/
 const longTasks=tasks.map(task=>({...describe(task),children:durationEvents.filter(e=>e!==task&&e.pid===task.pid&&e.tid===task.tid&&e.ts>=task.ts&&e.ts+e.dur<=task.ts+task.dur&&interesting.test(e.name)).map(describe)}))
 const longEvents=durationEvents.filter(e=>e.dur>=50000).map(describe)
 return{clock,totalEvents:events.length,durationEvents:durationEvents.length,longTasks,longEvents,metadata,note:'Task children are actual same-thread contained duration events, which can nest. Their durations must not be summed as exclusive time. Missing clock marker remains unmapped, never estimated.'}
}

module.exports=async function startMascotTimeline(h,environment){
 const enabled=process.env.KAMUCL_MASCOT_TRACE==='1'&&environment.gpu.platform==='darwin'&&/swiftshader|llvmpipe|lavapipe|softpipe|software/i.test(environment.rendererGpu.unmaskedRenderer||environment.rendererGpu.renderer)
 if(!enabled)return{enabled:false,end:async()=>{},stop:async()=>({enabled:false,reason:'diagnostic tracing is explicit opt-in; normal acceptance retains its original first interaction without tracing overhead'})}
 const summaryFile=path.resolve('out/mascot-header-timeline.json'),rawFile=path.resolve('out/mascot-header-timeline-raw.json')
 const proof={version:h.version,enabled,source:'real Chrome Tracing ReturnAsStream captured concurrently with the original first-leader Page.startScreencast; no changed FPS threshold, window size, extra warmup or recreated timestamps',instrumentation:'Tracing has its own overhead. This is a diagnostic run, not an uninstrumented FPS comparison. Trace startup/end add protocol work around the during phase; before/during/after cannot be claimed to have exactly equal instrumentation.',categories,environment,startedAt:new Date().toISOString(),complete:false,errors:[],rawFile}
 const save=()=>fs.writeFileSync(summaryFile,JSON.stringify(proof,null,2))
 let socket,id=0,tracing=false,endPromise,stopPromise,completionResolve,completionReject,marker
 const pending=new Map(),completion=new Promise((resolve,reject)=>{completionResolve=resolve;completionReject=reject});completion.catch(()=>{})
 const command=(method,params={})=>new Promise((resolve,reject)=>{const commandId=++id,timer=setTimeout(()=>{pending.delete(commandId);reject(Error(method+' tracing command timeout'))},15000);pending.set(commandId,{resolve,reject,timer});socket.send(JSON.stringify({id:commandId,method,params}))})
 const dispose=()=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('timeline connection closed'))}pending.clear();socket?.close()}
 save()
 try{
  const port=await h.main("Number(testElectron.app.commandLine.getSwitchValue('remote-debugging-port'))")
  if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('disposable remote-debugging loopback port unavailable')
  const endpoint=await(await fetch('http://127.0.0.1:'+port+'/json/version',{signal:AbortSignal.timeout(10000)})).json(),url=new URL(endpoint.webSocketDebuggerUrl)
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||Number(url.port)!==port)throw Error('timeline browser endpoint must be the existing disposable loopback debugger')
  socket=new WebSocket(url);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeline WebSocket open timeout')),10000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});socket.addEventListener('error',error=>{clearTimeout(timer);reject(error)},{once:true})})
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const request=pending.get(message.id);if(request){clearTimeout(request.timer);pending.delete(message.id);message.error?request.reject(Error(JSON.stringify(message.error))):request.resolve(message.result)}}else if(message.method==='Tracing.tracingComplete')completionResolve(message.params)})
  socket.addEventListener('close',()=>completionReject(Error('timeline socket closed before stream completion')),{once:true})
  await command('Tracing.start',{categories:categories.join(','),options:'record-until-full',transferMode:'ReturnAsStream',streamFormat:'json',streamCompression:'none'});tracing=true
  const name='KAMUCL-mascot-first-leader-'+crypto.randomUUID()
  marker=await h.evaluate(`(()=>{performance.mark(${JSON.stringify(name)});const mark=performance.getEntriesByName(${JSON.stringify(name)}).at(-1);return{name:mark.name,startTime:mark.startTime,timeOrigin:performance.timeOrigin}})()`)
  proof.marker=marker;save()
 }catch(error){proof.errors.push({at:'start',error:String(error)});if(tracing)try{await command('Tracing.end')}catch{}dispose();save();return{enabled:true,end:async()=>{},stop:async()=>proof}}
 const end=()=>endPromise??=(async()=>{try{proof.endedMarker=await h.evaluate('({now:performance.now(),timeOrigin:performance.timeOrigin})');await command('Tracing.end');tracing=false}catch(error){proof.errors.push({at:'end',error:String(error)})}})()
 return{enabled:true,end,stop:()=>stopPromise??=(async()=>{
  try{
   await end()
   let timer;const completed=await Promise.race([completion,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Tracing.tracingComplete timeout')),20000)})]).finally(()=>clearTimeout(timer))
   proof.completion=completed
   if(!completed.stream)throw Error('Chrome did not provide the requested ReturnAsStream handle')
   const chunks=[];let eof=false
   try{while(!eof){const chunk=await command('IO.read',{handle:completed.stream,size:1024*1024});chunks.push(Buffer.from(chunk.data,chunk.base64Encoded?'base64':'utf8'));eof=chunk.eof}}finally{await command('IO.close',{handle:completed.stream})}
   const raw=Buffer.concat(chunks);fs.writeFileSync(rawFile,raw);proof.rawBytes=raw.length;proof.rawSHA256=crypto.createHash('sha256').update(raw).digest('hex')
   const parsed=JSON.parse(raw.toString('utf8')),events=Array.isArray(parsed)?parsed:parsed.traceEvents
   if(!Array.isArray(events))throw Error('Chrome trace has no raw traceEvents array')
   Object.assign(proof,summarize(events,marker));proof.complete=true
  }catch(error){proof.errors.push({at:'stop',error:String(error)})}
  finally{if(tracing)try{await command('Tracing.end')}catch(error){proof.errors.push({at:'cleanup:Tracing.end',error:String(error)})}dispose();proof.finishedAt=new Date().toISOString();save()}
  return proof
 })()}
}
module.exports.summarize=summarize
