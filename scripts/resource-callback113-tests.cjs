// Synthetic tool qualification only; none of these fields are native evidence.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm')
const callback=require('./resource-callback113.cjs'),{frameStats}=require('./resource-frames113.cjs'),{attachCallbackFixture}=require('./resource-callback113-fixtures.cjs')
function browser(){
 let clock=10,nextHandle=0;const pending=new Map(),cancelled=[],reads=[]
 const sandbox={window:{},document:{URL:'file:///owned/index.html',hidden:false,hasFocus:()=>true,querySelector:selector=>{reads.push({selector,clock});clock+=1;return null}},performance:{timeOrigin:100000,now:()=>clock},requestAnimationFrame:callback=>{const handle=nextHandle;nextHandle+=17;pending.set(handle,callback);return handle},cancelAnimationFrame:handle=>{cancelled.push(handle);pending.delete(handle)}}
 vm.createContext(sandbox)
 return{sandbox,pending,cancelled,reads,evaluate:expression=>vm.runInContext(expression,sandbox),setClock:value=>{clock=value},deliver:(handle,now,entry)=>{assert(pending.has(handle));const tick=pending.get(handle);pending.delete(handle);clock=entry;tick(now)}}
}
const fixture=()=>attachCallbackFixture({rendererWindow:{start:10,end:30,timeOrigin:100000,endTimeOrigin:100000},frames:[{now:9.6,deliveredAt:10.2},{now:13.6,deliveredAt:14.2}]})
test('Serialized original observer samples entry before DOM work and retains actual request-consumption-cancellation chain',()=>{
 const b=browser(),token='actual-vm-hold-token-1',start=b.evaluate(callback.beginExpression(token,'vm-context-unique'))
 assert.equal(start.initialRequestHandle,0,'Handle zero is legal');assert.equal(b.sandbox.window.__resource113Frames,undefined);assert.equal(Object.getOwnPropertyDescriptor(b.sandbox.window,'__resource113ObservationStop').writable,false)
 b.deliver(0,9.6,10.2);b.deliver(17,13.6,14.2);b.setClock(30)
 const final=b.evaluate(callback.stopExpression(token));assert.equal(final.callbackCount,2);assert.equal(final.frames[0].deliveredAt,10.2);assert.equal(b.reads[0].clock,10.2);assert.equal(final.frames[0].nextHandle,17);assert.equal(final.frames[1].requestHandle,17);assert.deepEqual(Array.from(final.requests,r=>r.handle),[0,17,34]);assert.deepEqual(b.cancelled,[34]);assert.equal(b.pending.size,0);assert.equal(b.sandbox.window.__resource113ObservationStop,undefined)
 assert.throws(()=>b.evaluate(callback.stopExpression(token)));assert.equal(final.frames[0].now,9.6)
 const tracker=callback.contextTracker();callback.contextEvent(tracker,{method:'Runtime.executionContextCreated',params:{context:{id:7,uniqueId:'vm-context-unique',auxData:{isDefault:true,frameId:'vm-main-frame'}}}});const context=callback.selectContext(tracker,{frameTree:{frame:{id:'vm-main-frame',url:start.documentURL}}}),{frames,...end}=final
 const operation={frames,rendererWindow:{start:start.begin,end:end.end,timeOrigin:start.timeOrigin,endTimeOrigin:end.timeOrigin},callbackEvidence:{schema:1,holdToken:token,contextStart:context,contextEnd:structuredClone(context),start,end,lifecycleEvents:[]}}
 assert.equal(callback.assertCallbackEvidence(operation),true);assert.equal(frameStats(operation).originalCallbacks,2)
})
test('Wrong token cannot stop or consume an active closure, and a starved hold cancels its original pending request without inventing callbacks',()=>{
 const b=browser(),token='actual-vm-starved-token',start=b.evaluate(callback.beginExpression(token,'vm-context-unique'));assert.throws(()=>b.evaluate(callback.beginExpression('second-active-token','vm-context-unique')),/still active/);assert.throws(()=>b.evaluate(callback.stopExpression('wrong-token')),/Invalid/);assert.equal(b.pending.size,1);b.setClock(3010)
 const final=b.evaluate(callback.stopExpression(token));assert.equal(final.callbackCount,0);assert.equal(final.frames.length,0);assert.equal(final.requests.length,1);assert.equal(final.cancelledRequestHandle,start.initialRequestHandle);assert.equal(final.end-start.begin,3000)
})
test('Actual context event ledger chooses one main-frame default unique identity including its original fragment',()=>{
 const tracker=callback.contextTracker(),created={method:'Runtime.executionContextCreated',params:{context:{id:7,uniqueId:'actual-system-context-7',auxData:{isDefault:true,frameId:'actual-frame'}}}}
 callback.contextEvent(tracker,created);const original=JSON.stringify(created),tree={frameTree:{frame:{id:'actual-frame',url:'file:///owned/index.html',urlFragment:'#/home'}}},selected=callback.selectContext(tracker,tree)
 assert.equal(selected.uniqueContextId,'actual-system-context-7');assert.equal(selected.frameURL,'file:///owned/index.html#/home');assert.equal(JSON.stringify(created),original)
 callback.contextEvent(tracker,{method:'Runtime.executionContextDestroyed',params:{executionContextId:7,executionContextUniqueId:'other-system-context'}});assert.equal(callback.selectContext(tracker,tree).uniqueContextId,selected.uniqueContextId)
 callback.contextEvent(tracker,{method:'Runtime.executionContextDestroyed',params:{executionContextId:7,executionContextUniqueId:'actual-system-context-7'}});assert.throws(()=>callback.selectContext(tracker,tree),/Exactly one/);assert.equal(tracker.events.at(-1).params.executionContextUniqueId,'actual-system-context-7')
})
test('Missing, ambiguous, cleared, or observer-invalid contexts fail closed with original lifecycle events retained',()=>{
 const tree={frameTree:{frame:{id:'frame',url:'file:///owned/index.html'}}},t=callback.contextTracker();assert.throws(()=>callback.selectContext(t,tree));for(const uniqueId of['one','two'])callback.contextEvent(t,{method:'Runtime.executionContextCreated',params:{context:{id:uniqueId==='one'?1:2,uniqueId,auxData:{isDefault:true,frameId:'frame'}}}});assert.throws(()=>callback.selectContext(t,tree),/Exactly one/)
 callback.contextEvent(t,{method:'Runtime.executionContextsCleared',params:{}});assert.equal(t.generation,1);assert.equal(t.events.length,3);assert.throws(()=>callback.selectContext(t,tree));t.errors.push({message:'original missing unique id'});assert.throws(()=>callback.selectContext(t,tree),/complete/)
})
test('Distinct original callback chains allow equal coarsened entry clocks, preserve zero gaps, and never modify raw frames',()=>{
 const o=fixture();o.frames[1].deliveredAt=o.frames[0].deliveredAt;attachCallbackFixture(o);const original=JSON.stringify(o),s=frameStats(o)
 assert.equal(JSON.stringify(o),original);assert.deepEqual(s.gaps,[.1999999999999993,0,19.8]);assert.equal(s.elapsedMs,20);assert.equal(s.originalCallbacks,2);assert.equal(s.equalDeliveryClockPairs.length,1);assert.equal(s.equalDeliveryClockPairs[0].previousRequestHandle,501);assert.equal(s.equalDeliveryClockPairs[0].requestHandle,518);assert.equal(s.tailGapMs,19.8)
})
test('Duplicate rAF clocks and backward entry clocks still fail even with an otherwise complete synthetic chain',()=>{
 const duplicate=fixture();duplicate.frames[1].now=duplicate.frames[0].now;attachCallbackFixture(duplicate);assert.throws(()=>frameStats(duplicate),/frame timestamps/)
 const backward=fixture();backward.frames[1].deliveredAt=10.1;attachCallbackFixture(backward);assert.throws(()=>frameStats(backward),/backwards/)
})
test('Old arrays, altered callback ordinal or request chain, wrong final pending cancellation and callback count cannot be accepted',()=>{
 const mutations=[o=>delete o.callbackEvidence,o=>delete o.frames[0].ordinal,o=>o.frames[1].ordinal=0,o=>o.frames[0].holdToken='foreign',o=>o.frames[0].contextUniqueId='foreign',o=>o.frames[0].requestHandle=999,o=>o.frames[0].nextHandle=999,o=>o.callbackEvidence.end.consumptions[0].requestHandle=999,o=>o.callbackEvidence.end.requests[1].handle=o.callbackEvidence.end.requests[0].handle,o=>o.callbackEvidence.end.cancelledRequestHandle=999,o=>o.callbackEvidence.end.callbackCount++,o=>o.callbackEvidence.end.requests.pop()]
 for(const mutate of mutations){const o=fixture();mutate(o);assert.throws(()=>frameStats(o))}
})
test('Destroyed context, switched URL/time origin, fabricated creation event and changed unique context fail without losing original evidence',()=>{
 const mutations=[o=>o.callbackEvidence.lifecycleEvents.push({method:'Runtime.executionContextDestroyed',params:{executionContextId:7,executionContextUniqueId:o.callbackEvidence.contextStart.uniqueContextId}}),o=>o.callbackEvidence.lifecycleEvents.push({method:'Runtime.executionContextsCleared',params:{}}),o=>o.callbackEvidence.contextEnd.uniqueContextId='replacement',o=>o.callbackEvidence.end.documentURL='file:///foreign/index.html',o=>o.callbackEvidence.end.timeOrigin++,o=>o.frames[0].documentURL='foreign',o=>o.callbackEvidence.contextStart.createdEvent.params.context.uniqueId='fabricated',o=>delete o.callbackEvidence.contextStart.createdEvent]
 for(const mutate of mutations){const o=fixture();mutate(o);const original=JSON.stringify(o);assert.throws(()=>frameStats(o));assert.equal(JSON.stringify(o),original)}
 const o=fixture();o.callbackEvidence.lifecycleEvents.push({method:'Runtime.executionContextDestroyed',params:{executionContextId:7,executionContextUniqueId:'different-unique-context'}});assert.doesNotThrow(()=>frameStats(o),'A reused numeric id alone cannot destroy a different unique context')
})
test('Collector-source or frozen-evidence SHA changes cannot reuse a qualified contract',()=>{
 const provenance=require('./resource-provenance113.cjs'),sources=provenance.collectorSources('win32'),proof={platform:'win32',observerSources:structuredClone(sources)}
 assert.equal(provenance.assertCollectorSources(proof,sources),true);proof.observerSources.files['resource-callback113.cjs'].sha256='0'.repeat(64);assert.throws(()=>provenance.assertCollectorSources(proof,sources),/source SHA/)
 const frozen={collector:sources,analysis:{source:{bytes:3,sha256:'a'.repeat(64)}},raw:{file:{bytes:3,sha256:'b'.repeat(64)}}};assert.equal(provenance.assertFrozenBindings(frozen,structuredClone(frozen)),true)
 for(const mutate of[v=>v.analysis.source.sha256='c'.repeat(64),v=>v.raw.file.sha256='c'.repeat(64),v=>v.raw.file.bytes=2,v=>delete v.collector]){const changed=structuredClone(frozen);mutate(changed);assert.throws(()=>provenance.assertFrozenBindings(frozen,changed),/bytes changed/)}
})
test('Original run summaries, native logs, entry frames and screenshots are byte-bound, while foreign evidence paths fail closed',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),provenance=require('./resource-provenance113.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-callback-provenance-'))
 try{
  const group={i:0,kind:'baseline'};for(const label of['cold','warm']){const directory=path.join(root,label);fs.mkdirSync(directory);group[label]=directory;fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify({platform:'win32',screenshots:[{file:'original.png'}]}));for(const name of['native.jsonl','process.log','boot.json','boot-frames.txt','original.png'])fs.writeFileSync(path.join(directory,name),'original-'+name)}
  const file=path.join(root,'run.json');fs.writeFileSync(file,JSON.stringify({groups:[group]}));const frozen=provenance.rawEvidenceBindings(file);assert.equal(frozen.sessions.length,2);assert.equal(Object.keys(frozen.sessions[0].files).length,6)
  fs.appendFileSync(path.join(root,'warm','native.jsonl'),'changed');assert.throws(()=>provenance.assertFrozenBindings(frozen,provenance.rawEvidenceBindings(file)),/bytes changed/)
  group.warm=path.dirname(root);fs.writeFileSync(file,JSON.stringify({groups:[group]}));assert.throws(()=>provenance.rawEvidenceBindings(file),/own run root/)
 }finally{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true})}
})
test('Original source bytes survive snapshot and cross-host verification without EOL normalization, fallback paths or overwrites',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),p=require('./resource-provenance113.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-original-source-bytes-'))
 try{
  const expected=p.sourceBindings(['resource-callback113.cjs']),directory=path.join(root,'tool-sources');p.recordSourceSnapshot(directory,expected);assert.equal(p.verifySourceSnapshot(directory,expected),true);assert.throws(()=>p.recordSourceSnapshot(directory,expected),/EEXIST/)
  const file=path.join(directory,'resource-callback113.cjs');fs.appendFileSync(file,'\r\n');assert.throws(()=>p.verifySourceSnapshot(directory,expected),/bytes changed/)
  const artifact=path.join(root,'stage-0','cold');fs.mkdirSync(artifact,{recursive:true});fs.writeFileSync(path.join(artifact,'native.jsonl'),'original native raw');const run=path.join(root,'original-run.json');fs.writeFileSync(run,JSON.stringify({groups:[{cold:'/Users/original-native-host/stage-0/cold'}]}))
  const binding={run:p.fileBinding(run),sessions:[{directory:'stage-0/cold',files:{'native.jsonl':p.fileBinding(path.join(artifact,'native.jsonl'))}}]};assert.equal(p.verifyRawEvidenceSnapshot(run,binding,root),true);const wrong=structuredClone(binding);wrong.sessions[0].directory='../foreign';assert.throws(()=>p.verifyRawEvidenceSnapshot(run,wrong,root),/relative owned/)
  for(const directory of['.','..','tool/sub','tool\\sub','/absolute','C:\\absolute']){const invalid=structuredClone(binding);invalid.sessions[0].sourceSnapshot={directory,files:{}};assert.throws(()=>p.verifyRawEvidenceSnapshot(run,invalid,root))}
  const outside=path.join(root,'outside'),alias=path.join(root,'symbolic-source-alias');fs.mkdirSync(outside);fs.symlinkSync(outside,alias,'junction');assert.throws(()=>p.verifySourceSnapshot(alias,{}),/symbolic links/);assert.throws(()=>p.sourceBindings(['../resource-callback113.cjs']),/leaf names/)
  fs.appendFileSync(path.join(artifact,'native.jsonl'),'changed');assert.throws(()=>p.verifyRawEvidenceSnapshot(run,binding,root),/bytes changed/)
 }finally{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true})}
})
