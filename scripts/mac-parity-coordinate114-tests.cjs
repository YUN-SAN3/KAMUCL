// Pure parity orchestration fixtures; trusted flags here are synthetic data,
// never native GUI or real service acceptance. Uses the actual shared sampler.
const test=require('node:test'),assert=require('node:assert/strict')
const{createParityCoordinate,assertParityTrustedTarget,assertParityPointerDismissal,observePointerDismissInteger,createParityReload,parityReloadReady}=require('./verify-mac-parity-ui.cjs')
const geometry=require('./qa-coordinate-geometry114.cjs')
const selector='.download-modal .filter-row .select-menu-btn',identity={pid:20,windowId:2,webContentsId:2},documentBinding={timeOrigin:100,url:'file:///owned/index.html'}
function fixture({positions=[380,262,262],absence=[true],badTarget=false,inputError,readAdvance=1,lateInput=false,binding=documentBinding,rendererBinding=binding,duringRead,duringInput,pointerDismissal=false,actuallyDismissed=true,foreignNative=false,integerHit=true,integerDocument=documentBinding,changedIntegerBounds=false,wrongEventCoordinate=false}={}){
 let at=0,index=0,point,dispatchedPoint,records=[],reads=0,nativeReads=0;const inputs=[],timeouts=[],proof={operations:[],inputEvents:[],documentBinding:{...binding}}
 const native={...identity,visible:true,minimized:false,focused:true,appHidden:false,frontmostPID:identity.pid,window:{id:7},zoom:1,bounds:{x:0,y:20,width:1280,height:900},contentBounds:{x:0,y:20,width:1280,height:900}},actualSelector=pointerDismissal?'[data-ui="App:32e6a4482be2"]':selector
 let expected
 const row=y=>({hit:true,x:815.5,y,bounds:{x:646,y:y-18.5,width:339,height:37},label:'Fabric',ancestorsVisible:true,runningAnimations:0,absent:true,renderer:{width:1280,height:900,hasFocus:true,hidden:false,pixelRatio:1,ready:'complete',...(typeof rendererBinding==='function'?rendererBinding():rendererBinding)}})
 const entry=type=>({type,isTrusted:true,at,timeOrigin:point.renderer.timeOrigin,url:point.renderer.url,x:dispatchedPoint.x+(wrongEventCoordinate?1:0),y:dispatchedPoint.y,button:0,buttons:type.endsWith('down')?1:0,target:pointerDismissal?{tag:type==='pointerdown'?'DIV':'BODY',ui:type==='pointerdown'?'App:32e6a4482be2':null}:{tag:'BUTTON'},matchesSelector:!badTarget&&(!pointerDismissal||type==='pointerdown'),renderer:{width:1280,height:900,hasFocus:true,hidden:false,pixelRatio:1}})
 const run=createParityCoordinate({identity,documentBinding:()=>proof.documentBinding,proof,save:()=>{},now:()=>at,wait:async ms=>{at+=ms},pointerDismissal,geometry,native:async(_identity,timeoutMs)=>{assert.deepEqual(_identity,identity);timeouts.push(timeoutMs);nativeReads++;return{...structuredClone(native),...(foreignNative&&nativeReads>2?{frontmostPID:999}:{})}},evaluate:async(expression,timeoutMs)=>{
  timeouts.push(timeoutMs)
  if(expression.includes('scrollIntoView'))return
  if(expression.includes('const renderer=')){at+=readAdvance;reads++;const sampleIndex=index++;point=row(positions[Math.min(sampleIndex,positions.length-1)]);point.absent=absence[Math.min(sampleIndex,absence.length-1)];duringRead?.(proof,reads);if(!pointerDismissal)assert(expression.includes('.files-loading'),'real modal loading absence is required');return point}
  if(pointerDismissal&&expression.includes('observePointerDismissInteger'))return{count:1,connected:true,sameTarget:integerHit,target:{tag:'DIV',ui:'App:32e6a4482be2'},x:Math.trunc(point.x),y:Math.trunc(point.y),bounds:{...point.bounds,...(changedIntegerBounds?{width:point.bounds.width+1}:{})},renderer:{...point.renderer,...integerDocument}}
  if(expression.includes('o.begin(')){expected={selector:actualSelector,token:point.renderer.timeOrigin+':1',timeOrigin:point.renderer.timeOrigin,url:point.renderer.url};return expected.token}
  if(expression.includes('.finish('))return{...expected,overflow:false,records}
  if(pointerDismissal&&expression==="!!document.querySelector('.dl-panel')")return true
  if(pointerDismissal&&expression.includes('({panel:'))return{panel:!actuallyDismissed,backdrop:!actuallyDismissed,...documentBinding}
  throw Error('Unexpected fixture expression')
 },call:async(method,args,timeoutMs)=>{
  assert.equal(method,'Input.dispatchMouseEvent');inputs.push(args);timeouts.push(timeoutMs);dispatchedPoint={x:args.x,y:args.y}
  duringInput?.(proof,args.type)
  if(inputError&&args.type==='mousePressed')throw inputError
  if(args.type==='mousePressed')records.push(entry('pointerdown'),entry('mousedown'))
  if(args.type==='mouseReleased'){records.push(entry('pointerup'),entry('mouseup'));if(!pointerDismissal)records.push(entry('click'));if(lateInput)at+=10001}
 }})
 return{run,proof,inputs,timeouts,get reads(){return reads},get at(){return at}}
}
test('actual pointerdown backdrop dismissal keeps complete trusted down/up, native identity and real panel removal',async()=>{
 const f=fixture({pointerDismissal:true,positions:[262,262]});await f.run('[data-ui="App:32e6a4482be2"]');const op=f.proof.operations[0]
 assert.equal(op.complete,true);assert.equal(op.trigger,'pointerdown dismissal');assert.equal(op.nativeSequence.length,6);assert.equal(op.actualDismissal.panel,false);assert.equal(op.trustedTargets.records[0].matchesSelector,true);assert.equal(op.trustedTargets.records[1].matchesSelector,false);assert.deepEqual(f.inputs.map(x=>x.type),['mouseMoved','mousePressed','mouseReleased'])
 assert.throws(()=>assertParityTrustedTarget(op.trustedTargets,{...op.trustedTargets}),'generic five-event click contract remains strict and cannot accept this separate dismissal')
})
test('pointerdown dismissal refuses wrong overlay target, unremoved panel or foreign native foreground without retry',async()=>{
 for(const options of [{badTarget:true},{actuallyDismissed:false},{foreignNative:true}]){const f=fixture({pointerDismissal:true,positions:[262,262],...options});await assert.rejects(f.run('[data-ui="App:32e6a4482be2"]'));assert.equal(f.proof.operations[0].complete,false);assert(f.inputs.filter(x=>x.type==='mousePressed').length<=1)}
 const f=fixture({pointerDismissal:true});await assert.rejects(f.run('.different-mask'));assert.equal(f.inputs.length,0)
})
test('special backdrop dismissal refuses synthetic, incomplete, foreign-document or changed-coordinate evidence',async()=>{
 const f=fixture({pointerDismissal:true,positions:[262,262]});await f.run('[data-ui="App:32e6a4482be2"]');const trace=f.proof.operations[0].trustedTargets,expected={selector:trace.selector,token:trace.token,...documentBinding,...f.proof.operations[0].integerDismissal.dispatch}
 for(const mutate of [x=>x.records[0].isTrusted=false,x=>x.records.pop(),x=>x.records[1].x++,x=>x.records[0].target.ui='different',x=>x.records[1].url='file:///foreign',x=>x.records[2].renderer.hasFocus=false,x=>x.overflow=true]){const changed=structuredClone(trace);mutate(changed);assert.throws(()=>assertParityPointerDismissal(changed,expected))}
})

test('special dismissal sends revalidated integer pixels and rejects a coherent wrong coordinate without tolerance',async()=>{
 const f=fixture({pointerDismissal:true,positions:[262.4,262.4]});await f.run('[data-ui="App:32e6a4482be2"]');const op=f.proof.operations[0]
 assert.deepEqual(op.integerDismissal.original,{x:815.5,y:262.4});assert.deepEqual(op.integerDismissal.dispatch,{x:815,y:262});assert.equal(op.integerDismissal.actual.sameTarget,true)
 assert(f.inputs.every(input=>input.x===815&&input.y===262));assert(op.trustedTargets.records.every(event=>event.x===815&&event.y===262))
 for(const options of[{integerHit:false},{integerDocument:{timeOrigin:200,url:documentBinding.url}},{changedIntegerBounds:true}]){const wrong=fixture({pointerDismissal:true,positions:[262.4,262.4],...options});await assert.rejects(wrong.run('[data-ui="App:32e6a4482be2"]'));assert.equal(wrong.inputs.length,0)}
 const wrong=fixture({pointerDismissal:true,positions:[262.4,262.4],wrongEventCoordinate:true});await assert.rejects(wrong.run('[data-ui="App:32e6a4482be2"]'));assert.equal(wrong.inputs.length,3);assert.equal(wrong.proof.operations[0].complete,false)
 const rawFloat=structuredClone(op.trustedTargets);for(const event of rawFloat.records){event.x=event.type.startsWith('pointer')?38.400001525878906:38;event.y=event.type.startsWith('pointer')?446.3999938964844:446}
 assert.throws(()=>assertParityPointerDismissal(rawFloat,{...rawFloat,x:38,y:446}),'prior floating event evidence cannot be retroactively qualified')
 const generic=fixture({positions:[262.4,262.4]});await generic.run(selector);assert(generic.inputs.every(input=>input.x===815.5&&input.y===262.4),'ordinary controls retain their actual measured coordinates')
})

test('integer dismissal observation reads the actual original and integer hit target in one document',()=>{
 const mask={isConnected:true,tagName:'DIV',getAttribute:()=> 'App:32e6a4482be2',getBoundingClientRect:()=>({toJSON:()=>({x:0,y:0,width:768,height:496})})},other={tagName:'BUTTON',getAttribute:()=>null}
 const observe=(integerTarget=mask,originalTarget=mask,count=1)=>new Function('document','innerWidth','innerHeight','devicePixelRatio','performance','location',`return (${observePointerDismissInteger.toString()})('[data-ui="App:32e6a4482be2"]',{x:38.4,y:446.4},{x:38,y:446})`)({querySelectorAll:()=>Array.from({length:count},()=>mask),elementFromPoint:(x,y)=>x===38.4&&y===446.4?originalTarget:integerTarget,hasFocus:()=>true,hidden:false,readyState:'complete'},768,496,1.25,{timeOrigin:100},{href:documentBinding.url})
 const valid=observe();assert.equal(valid.sameTarget,true);assert.equal(valid.x,38);assert.equal(valid.y,446);assert.deepEqual(valid.renderer,{width:768,height:496,hasFocus:true,hidden:false,pixelRatio:1.25,timeOrigin:100,url:documentBinding.url,ready:'complete'})
 assert.equal(observe(other).sameTarget,false);assert.equal(observe(mask,other).sameTarget,false);assert.equal(observe(mask,mask,2).sameTarget,false)
})
test('parity samples async-moving modal geometry twice before a single native event sequence',async()=>{
 const f=fixture(),point=await f.run(selector)
 assert.equal(f.reads,3);assert.equal(point.y,262)
 assert.deepEqual(f.inputs.map(row=>row.type),['mouseMoved','mousePressed','mouseReleased'])
 assert(f.inputs.every(row=>row.y===262),'obsolete y380 cannot be dispatched')
 const operation=f.proof.operations[0];assert.equal(operation.complete,true);assert.equal(operation.samples[0].value.coordinate.y,380);assert.equal(operation.samples[1].value.coordinate.y,262);assert.equal(operation.samples[2].value.coordinate.y,262)
 assert.deepEqual(operation.absentSelectors,['.download-modal .files-loading']);assert(operation.trustedTargets.records.every(row=>row.matchesSelector&&row.isTrusted))
})

function reloadFixture({proof={documentBinding:{...documentBinding}},samples,before=proof.documentBinding,readAdvance=1,reloadAdvance=0}={}){
 let at=0,index=0,reloaded=false;const calls=[],timeouts=[]
 const rows=samples??[{...documentBinding,timeOrigin:200,theme:'black-orange',readyState:'complete',ready:true}]
 const reload=createParityReload({proof,save:()=>{},now:()=>at,wait:async ms=>{at+=ms},evaluate:async(expression,timeoutMs)=>{
  timeouts.push(timeoutMs);at+=readAdvance
  if(!reloaded){assert.equal(expression,'({timeOrigin:performance.timeOrigin,url:location.href})');return structuredClone(before)}
  assert(expression.includes('readyState:document.readyState'))
  const row=rows[Math.min(index++,rows.length-1)];if(row instanceof Error)throw row;return structuredClone(row)
 },call:async(method,args,timeoutMs)=>{assert.equal(method,'Page.reload');assert.deepEqual(args,{});calls.push({method,args,at});timeouts.push(timeoutMs);reloaded=true;at+=reloadAdvance}})
 return{proof,reload,calls,timeouts,get at(){return at}}
}

test('explicit reload rejects old-document readiness and binds only the actual new ready document',async()=>{
 const old={...documentBinding,theme:'black-orange',readyState:'complete',ready:true},pending={...old,timeOrigin:200,readyState:'loading',ready:false},ready={...pending,readyState:'complete',ready:true}
 const f=reloadFixture({samples:[old,Error('execution context was destroyed'),pending,ready]})
 await f.reload('black-orange','initial theme reload')
 assert.equal(f.calls.length,1);assert.deepEqual(f.proof.documentBinding,{timeOrigin:200,url:documentBinding.url})
 const lineage=f.proof.documentLineage[0];assert.equal(lineage.complete,true);assert.deepEqual(lineage.before,documentBinding);assert.equal(lineage.samples.length,4);assert.equal(lineage.samples[0].value.timeOrigin,100);assert.equal(lineage.samples[1].value.transitionError.message,'execution context was destroyed');assert.equal(lineage.samples[2].value.readyState,'loading');assert.equal(lineage.after.timeOrigin,200)
 assert(f.timeouts.every(ms=>ms>0&&ms<=10000))
})

test('old binding rejects a new renderer; a separately observed Page.reload permits only future coordinates',async()=>{
 const actualNew={timeOrigin:200,url:documentBinding.url},old=fixture({positions:[262,262],rendererBinding:actualNew})
 await assert.rejects(old.run(selector),/Original coordinate deadline/)
 assert.equal(old.inputs.length,0);const original=structuredClone(old.proof.operations[0])
 const fresh=fixture({positions:[262,262],rendererBinding:actualNew}),r=reloadFixture({proof:fresh.proof})
 await r.reload('black-orange','fresh actual reload');await fresh.run(selector)
 assert.equal(fresh.proof.operations[0].documentBinding.timeOrigin,200);assert.equal(fresh.proof.operations[0].trustedTargets.timeOrigin,200)
 assert.deepEqual(old.proof.operations[0],original,'an old failed observation cannot be retroactively rebound')
})

test('each coordinate snapshots its document even if the next binding changes during native input',async()=>{
 const f=fixture({positions:[262,262],duringInput:(proof,type)=>{if(type==='mousePressed')proof.documentBinding={timeOrigin:200,url:documentBinding.url}}})
 await f.run(selector)
 assert.equal(f.proof.documentBinding.timeOrigin,200);assert.equal(f.proof.operations[0].documentBinding.timeOrigin,100);assert.equal(f.proof.operations[0].trustedTargets.timeOrigin,100);assert.equal(f.inputs.length,3)
})

test('changing the binding during coordinate observations cannot qualify the new document inside that call',async()=>{
 let actual={...documentBinding}
 const f=fixture({positions:[262,262],rendererBinding:()=>actual,duringRead:(proof,reads)=>{if(reads===1){actual={timeOrigin:200,url:documentBinding.url};proof.documentBinding={...actual}}}})
 await assert.rejects(f.run(selector),/Original coordinate deadline/)
 assert.equal(f.inputs.length,0);assert.equal(f.proof.operations[0].documentBinding.timeOrigin,100);assert.equal(f.proof.operations[0].samples[1].value.coordinate.renderer.timeOrigin,200)
})

test('reload requires the original bound document and rejects a foreign URL without rebinding',async()=>{
 for(const options of[{before:{timeOrigin:200,url:documentBinding.url}},{samples:[{timeOrigin:200,url:'file:///foreign/index.html',theme:'black-orange',readyState:'complete',ready:true}]}]){
  const f=reloadFixture(options)
  await assert.rejects(f.reload('black-orange','owned reload'),/currently bound document|owned renderer URL/)
  assert.deepEqual(f.proof.documentBinding,documentBinding);assert.equal(f.proof.documentLineage[0].complete,false);assert(f.proof.documentLineage[0].error)
 }
})

test('wrong theme, missing mounted root and a late valid response cannot renew the original reload budget',async()=>{
 const ready={timeOrigin:200,url:documentBinding.url,theme:'black-orange',readyState:'complete',ready:true}
 for(const options of[{samples:[{...ready,theme:'transparent'}]},{samples:[{...ready,ready:false}]},{samples:[ready],readAdvance:5001}]){
  const f=reloadFixture(options)
  await assert.rejects(f.reload('black-orange','strict theme reload'),/original reload deadline/i)
  assert.deepEqual(f.proof.documentBinding,documentBinding);assert.equal(f.proof.documentLineage[0].complete,false)
  assert(f.timeouts.every(ms=>ms>0&&ms<=10000));assert(f.proof.documentLineage[0].samples.length>0||f.at>=10000)
 }
 assert.equal(parityReloadReady({...ready,timeOrigin:100},documentBinding,'black-orange'),false)
 assert.equal(parityReloadReady({...ready,timeOrigin:0},documentBinding,'black-orange'),false)
 assert.equal(parityReloadReady({...ready,timeOrigin:-1},documentBinding,'black-orange'),false)
})

test('return-to-black reload records a separate lineage and cannot accept the previous custom document',async()=>{
 const proof={documentBinding:{timeOrigin:300,url:documentBinding.url}}
 const f=reloadFixture({proof,samples:[{timeOrigin:300,url:documentBinding.url,theme:'black-orange',readyState:'complete',ready:true},{timeOrigin:400,url:documentBinding.url,theme:'black-orange',readyState:'complete',ready:true}]})
 await f.reload('black-orange','return theme and mounted root for restart')
 assert.equal(proof.documentLineage[0].before.timeOrigin,300);assert.equal(proof.documentLineage[0].after.timeOrigin,400);assert.equal(proof.documentBinding.timeOrigin,400)
})
test('stable old modal bounds cannot qualify while the original file-loading state is present',async()=>{
 const f=fixture({positions:[380,380,262,262],absence:[false,false,true,true]})
 const point=await f.run(selector);assert.equal(f.reads,4);assert.equal(point.y,262)
 assert(f.inputs.every(row=>row.y===262));assert.equal(f.proof.operations[0].samples[0].value.coordinate.absent,false);assert.equal(f.proof.operations[0].samples[1].value.coordinate.absent,false)
})
test('parity rejects the original click landing on a changed target and does not retry it',async()=>{
 const f=fixture({badTarget:true})
 await assert.rejects(f.run(selector),/original native event must hit the intended target/)
 assert.equal(f.inputs.filter(row=>row.type==='mousePressed').length,1)
 assert.equal(f.proof.operations[0].complete,false);assert.equal(f.proof.operations[0].trustedTargets.records.length,5)
})
test('original input error is preserved together with the partial trusted event receipt',async()=>{
 const original=Error('actual CDP input failed'),f=fixture({inputError:original})
 await assert.rejects(f.run(selector),error=>error===original)
 assert.equal(f.inputs.filter(row=>row.type==='mousePressed').length,1);assert(!f.inputs.some(row=>row.type==='mouseReleased'))
 const operation=f.proof.operations[0];assert.deepEqual(operation.error,{name:original.name,message:original.message});assert.equal(operation.complete,false);assert.deepEqual(operation.trustedTargets.records,[]);assert(operation.trustedTargetError)
})
test('parity keeps the original ten-second budget and rejects a late observation without dispatch',async()=>{
 const f=fixture({readAdvance:10001})
 await assert.rejects(f.run(selector),/Original coordinate deadline/)
 assert.equal(f.inputs.length,0);assert.equal(f.proof.operations[0].deadline,10000)
 assert(f.proof.operations[0].samples.length>0);assert.equal(f.proof.operations[0].samples[0].value.coordinate.y,380)
})
test('provided route deadline is shared with every native and renderer call, not renewed per sample',async()=>{
 const f=fixture({positions:[262,262]})
 await assert.rejects(f.run(selector,{deadline:50}),/Original coordinate deadline/)
 assert.equal(f.inputs.length,0);assert.equal(f.proof.operations[0].deadline,50);assert(f.timeouts.every(ms=>ms<=50&&ms>0))
})
test('late native input completion cannot supply success even when all original target events were captured',async()=>{
 const f=fixture({positions:[262,262],lateInput:true})
 await assert.rejects(f.run(selector),/Original coordinate deadline elapsed during input dispatch/)
 assert.equal(f.inputs.filter(row=>row.type==='mousePressed').length,1);assert.equal(f.proof.operations[0].complete,false);assert.equal(f.proof.operations[0].trustedTargets.records.length,5)
})
test('trusted targets refuse fabricated, foreign-context, overflowed or incomplete event evidence',()=>{
 const expected={selector,token:'100:1',...documentBinding},records=['pointerdown','mousedown','pointerup','mouseup','click'].map(type=>({type,isTrusted:true,matchesSelector:true,at:5,x:815,y:262,target:{tag:'BUTTON'},...documentBinding,renderer:{hasFocus:true,hidden:false}})),valid={...expected,overflow:false,records}
 assertParityTrustedTarget(valid,expected)
 for(const mutate of[r=>r.records[0].isTrusted=false,r=>r.records[4].matchesSelector=false,r=>r.records[1].timeOrigin++,r=>r.records[1].url='file:///foreign/index.html',r=>r.overflow=true,r=>r.records.pop(),r=>r.records.push({...r.records[4]}),r=>r.records[3].renderer.hidden=true,r=>r.records[3].renderer.hasFocus=false]){const wrong=structuredClone(valid);mutate(wrong);assert.throws(()=>assertParityTrustedTarget(wrong,expected))}
})
