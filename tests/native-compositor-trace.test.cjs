const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const runTrace=require('../scripts/native-compositor-trace-119.cjs')
const runModule=require('../scripts/verify-kamu-native-trace-119.cjs')
function fixture(t,fail={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kamu-native-trace-test-'))
 t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert(path.basename(dir).startsWith('kamu-native-trace-test-'));fs.rmSync(dir,{recursive:true,force:true})})
 const calls=[];let listener,marker
 const transport={subscribe(fn){listener=fn;return()=>calls.push('unsubscribe')},close(){calls.push('close')},async call(method){calls.push(method);if(method==='Tracing.start'&&fail.start)throw Error('another trace active');if(method==='Tracing.end'){if(!fail.noComplete)listener('Tracing.tracingComplete',{stream:'owned-stream'});if(fail.end)throw Error('end ack lost')}if(method==='IO.read'){if(fail.read)throw Error('stream read failed');return{eof:true,data:JSON.stringify({traceEvents:[{name:marker.name,cat:'blink.user_timing',ph:'R',pid:1,tid:2,ts:100000},{name:'Paint',cat:'devtools.timeline',ph:'X',pid:1,tid:2,ts:110000,dur:5000,args:{data:{clip:[0,0,48,72],url:'https://secret.invalid',value:'typed secret'}}}]})}}return{}}}
 const nativeWindow={id:1,isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,isFocused:()=>true,getBounds:()=>({x:0,y:0,width:1280,height:900}),webContents:{id:2,getURL:()=> 'file:///app/out/renderer/index.html',getBackgroundThrottling:()=>{calls.push('read-background-throttling');return true}}}
 const electron={BrowserWindow:{getAllWindows:()=>[nativeWindow]},app:{isHidden:()=>false}}
 const h={version:require('../package.json').version,main:async code=>code==='process.platform'?'darwin':new Function('testElectron','return '+code)(electron),evaluate:async code=>{if(code.startsWith('performance.clearMarks')){calls.push('clear-marker');return}if(code.startsWith('({now:'))return{now:50,timeOrigin:1000,hidden:false,focused:true};const name=JSON.parse(code.match(/performance\.mark\(("[^"]+")\)/)[1]);marker={name,startTime:50,timeOrigin:1000};return marker}}
 return{h,transport,calls,base:path.join(dir,'diagnostic'),options:{enabled:true,separateRun:true,transport,outputBase:path.join(dir,'diagnostic'),completionTimeoutMs:5}}
}
test('tracing remains opt-in and refuses normal acceptance registration',async()=>{
 let invoked=false;const result=await runTrace({},async()=>{invoked=true},{enabled:false});assert.equal(result.enabled,false);assert.equal(invoked,false)
 await assert.rejects(runTrace({},async()=>{}, {enabled:true}),/separate diagnostic/)
})
test('original action failure survives while tracing ends, drains and closes its stream',async t=>{
 const f=fixture(t),original=Error('actual click failed');await assert.rejects(runTrace(f.h,async()=>{throw original},f.options),e=>e===original)
 for(const action of ['Tracing.end','IO.read','IO.close','clear-marker','unsubscribe','close'])assert(f.calls.includes(action),action)
 const proof=JSON.parse(fs.readFileSync(f.base+'.json'));assert.equal(proof.complete,false);assert.equal(proof.cleanup.drained,true)
 const events=fs.readFileSync(f.base+'-events.json','utf8');assert(!events.includes('secret'));assert(events.includes('clip'));assert.equal(proof.clock.valid,true)
})
test('IO read failure still closes the returned handle and disconnects',async t=>{
 const f=fixture(t,{read:true});await assert.rejects(runTrace(f.h,async()=>{},f.options),/stream read failed/)
 assert(f.calls.includes('IO.close'));assert(f.calls.includes('close'));const p=JSON.parse(fs.readFileSync(f.base+'.json'));assert.equal(p.complete,false);assert.equal(p.cleanup.streamClosed,true)
})
test('end acknowledgement failure still drains a received completion; missing completion is bounded',async t=>{
 const f=fixture(t,{end:true});await assert.rejects(runTrace(f.h,async()=>{},f.options),/end ack lost/);assert(f.calls.includes('IO.read'));assert(f.calls.includes('IO.close'));assert(f.calls.includes('close'))
 const g=fixture(t,{noComplete:true});await assert.rejects(runTrace(g.h,async()=>{},g.options),/tracingComplete timed out/);assert(g.calls.includes('close'));assert(!g.calls.includes('IO.read'))
})
test('rejected start never ends an unowned active tracing session',async t=>{
 const f=fixture(t,{start:true});let action=false;await assert.rejects(runTrace(f.h,async()=>{action=true},f.options),/another trace active/)
 assert.equal(action,false);assert(!f.calls.includes('Tracing.end'));assert(f.calls.includes('close'))
})
test('privacy removes arbitrary marks and strings; missing trace clock stays unknown',()=>{
 const events=runTrace.redactEvents([{name:'Paint typed private text',cat:'blink.user_timing',ph:'R',ts:10},{name:'Paint',cat:'devtools.timeline',ph:'X',ts:20,dur:60000,pid:1,tid:2,args:{value:'password',data:{url:'private',clip:[1,2,3,4],nodeId:5}}}], 'owned-marker')
 assert.equal(events.length,1);assert.deepEqual(events[0].args,{data:{clip:[1,2,3,4],nodeId:5}})
 const summary=runTrace.summarize(events,{name:'owned-marker',timeOrigin:0,startTime:0});assert.equal(summary.clock.valid,false);assert.equal(summary.longEvents[0].performanceStartMs,null);assert.equal(summary.longEvents[0].durationMs,60)
})
test('native-trace registration selects a separate Darwin cold diagnostic and preserves capture parameters',async()=>{
 const calls=[],proofs=[],recording={fps:18,frames:[{timestamp:1},{timestamp:1.1}]},h={version:require('../package.json').version,main:async()=> 'darwin',evaluate:async()=>({samples:[]}),recordScreencast:async(name,action,duration)=>{calls.push({name,duration});await action();return recording}}
 const result=await runModule(h,{trace:async(same,action,options)=>{assert.equal(same,h);assert.deepEqual(options,{enabled:true,separateRun:true});return action({observe:async label=>calls.push(label)})},motion:async ctx=>{assert.equal(ctx.motionDiagnosticInvocation,'native-trace');await ctx.nativeTraceObserve('ready');return ctx.recordScreencast('original-name',async()=>{calls.push('action')},250)},writeProof:(name,value)=>proofs.push({name,value})})
 assert.equal(result,recording);assert.deepEqual(calls,['ready',{name:'original-name',duration:250},'action']);assert.equal(proofs.length,1)
 let invoked=false;await assert.rejects(runModule({...h,main:async()=> 'win32'},{trace:async()=>{invoked=true}}),/Darwin/);assert.equal(invoked,false)
})
test('native-trace registration flushes failed action frames and retains the original failure',async()=>{
 const original=Error('trusted action failed'),calls=[],proofs=[],h={version:require('../package.json').version,main:async()=> 'darwin',evaluate:async()=>({samples:[{at:1}]}),recordScreencast:async(name,action,duration)=>{await action();calls.push('flushed');return{frames:[{timestamp:1}],duration}}}
 await assert.rejects(runModule(h,{trace:async(same,action)=>action({observe:async()=>{}}),motion:async ctx=>ctx.recordScreencast('failed',async()=>{throw original},250),writeProof:(name,value)=>proofs.push({name,value})}),e=>e===original)
 assert.deepEqual(calls,['flushed']);assert.equal(proofs.length,2);assert.equal(proofs[0].value.recording.duration,250);assert.equal(proofs[1].value.samples[0].at,1)
})

const cpuQA=require('../scripts/native-cpu-profile-119.cjs')
function cpuFixture(){return{startTime:100,endTime:500,nodes:[{id:1,children:[2,3],callFrame:{functionName:'(root)',url:'',scriptId:'0',lineNumber:-1,columnNumber:-1}},{id:2,hitCount:1,callFrame:{functionName:'rA',url:'file:///static/assets/index-ABC.js',scriptId:'7',lineNumber:3,columnNumber:4}},{id:3,callFrame:{functionName:'(garbage collector)',url:'',scriptId:'0',lineNumber:-1,columnNumber:-1}}],samples:[2,3],timeDeltas:[100,100]}}
test('CPU projection preserves samples/times/tree and engine enums; fake asset/eval/private names are redacted',()=>{
 const original=cpuFixture(),before=structuredClone(original),assets=new Map([['file:///static/assets/index-ABC.js','index-ABC.js']]),result=cpuQA.filterProfile(original,assets)
 assert.deepEqual(original,before);assert.deepEqual(result.samples,original.samples);assert.deepEqual(result.timeDeltas,original.timeDeltas);assert.equal(result.startTime,100);assert.equal(result.nodes[0].callFrame.functionName,'(root)');assert.equal(result.nodes[2].callFrame.functionName,'(garbage collector)');assert.equal(result.nodes[1].callFrame.asset,'index-ABC.js')
 for(const mutate of [x=>x.nodes[1].callFrame.url+='?private=1',x=>x.nodes[1].callFrame.url='eval://private',x=>x.nodes[1].callFrame.functionName='PrivateTypedAccountPassword']){const p=cpuFixture();mutate(p);const filtered=cpuQA.filterProfile(p,assets);assert.equal(filtered.nodes[1].callFrame.redacted,true);assert(!JSON.stringify(filtered).includes('PrivateTyped'));assert(!JSON.stringify(filtered).includes('eval://'))}
 for(const mutate of [x=>x.samples[0]=999,x=>x.timeDeltas.pop(),x=>x.nodes[0].children=[999],x=>x.nodes[0].id=2]){const p=cpuFixture();mutate(p);assert.throws(()=>cpuQA.filterProfile(p,assets))}
})
test('CPU stop/disable and private original survive actual traced action failure; public keeps only projection',async()=>{
 const calls=[],publicProofs=[],privateOriginals=[],original=Error('trusted contact failed'),profile=cpuFixture(),h={evaluate:async()=>({now:50,timeOrigin:1000}),call:async method=>{calls.push(method);return method==='Profiler.stop'?{profile}:{}}}
 await assert.rejects(cpuQA.withCPUProfile(h,'unused',()=>{throw original},{assets:new Map([['file:///static/assets/index-ABC.js','index-ABC.js']]),writePrivate:b=>privateOriginals.push(b),writePublic:p=>publicProofs.push(p)}),e=>e===original)
 assert.deepEqual(calls,['Profiler.enable','Profiler.setSamplingInterval','Profiler.start','Profiler.stop','Profiler.disable']);assert.deepEqual(JSON.parse(privateOriginals[0]),profile);assert.equal(publicProofs[0].complete,false);assert(publicProofs[0].profileStopped&&publicProofs[0].disabled);assert(!JSON.stringify(publicProofs[0]).includes('file:///static'))
})
test('requested compilation/GC/main-task/layout events retain numeric timing without private URL arguments',()=>{
 const names=['V8.CompileCode','V8.GCScavenger','ThreadControllerImpl::RunTask','Paint','UpdateLayerTree','Commit'],events=names.map((name,index)=>({name,cat:'v8',ph:'X',ts:100+index,dur:67000,args:{url:'file:///private-user',source:'private body',data:{nodeId:3}}})),kept=runTrace.redactEvents(events,'owned-marker')
 assert.deepEqual(kept.map(e=>e.name),names);assert(kept.every(e=>e.dur===67000));assert(!JSON.stringify(kept).includes('private'))
 assert.equal(runTrace.redactEvents([{name:'V8.Compile file:///private',cat:'v8',ph:'X',ts:1}],'owned-marker').length,0)
})
test('after-DMG trace-only gate preserves prior six-case proof, deadline failure and safe filtered collection',t=>{
 const preflight=require('../scripts/native-trace-control-preflight-119.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'kamu-trace-control-test-'))
 t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('kamu-trace-control-test-'));fs.rmSync(root,{recursive:true,force:true})})
 const outRoot=path.join(root,'out'),appRoot=path.join(root,'app'),extensionProof=path.join(root,'dmg');for(const d of [outRoot,appRoot,extensionProof])fs.mkdirSync(d)
 fs.mkdirSync(path.join(appRoot,'original'));fs.writeFileSync(path.join(appRoot,'observer-aba-preflight.json'),JSON.stringify({complete:true,processExitCode:0,directories:[{name:'original'}]}));fs.writeFileSync(path.join(appRoot,'original','observer-aba.json'),JSON.stringify({complete:true,cases:Array.from({length:6},()=>({complete:true}))}))
 const options={version:require('../package.json').version,arch:'x64',stage:'dmg',ci:'true',env:{},exe:'fixture-only',outRoot,appRoot,extensionProof};assert(preflight.eligible(options));for(const patch of [{arch:'arm64'},{stage:'app'},{ci:'false'}])assert(!preflight.eligible({...options,...patch}))
 const result=preflight.run(options,{invoke:(exe,args,o)=>{assert.equal(o.timeout,85000);assert.equal(o.killSignal,'SIGTERM');assert.equal(o.env.KAMUCL_OBSERVER_TRACE_CONTROL119,'1');const d=path.join(outRoot,'kamu-observer-trace-control-119-12345678-1234-1234-1234-123456789abc-black-orange');fs.mkdirSync(d);fs.writeFileSync(path.join(d,'observer-aba.json'),JSON.stringify({startedAt:new Date().toISOString(),complete:false,error:'original deadline retained'}));fs.writeFileSync(path.join(d,'trace-cpu.json'),'{}');fs.writeFileSync(path.join(d,'private-cpu.json'),'PRIVATE');throw Object.assign(Error('timeout'),{code:'ETIMEDOUT',signal:'SIGTERM'})}})
 assert.equal(result.complete,false);assert.equal(result.error.code,'ETIMEDOUT');assert.equal(result.deadlineMs,90000);assert.equal(result.directories.length,1);assert(result.directories[0].files.some(f=>f.file==='trace-cpu.json'));assert(!result.directories[0].files.some(f=>f.file.includes('private')));assert(!preflight.allowedFile('private-cpu.json'));assert(!preflight.allowedFile('qa-account.txt'));assert.equal(result.normalAcceptanceChanged,false)
})
