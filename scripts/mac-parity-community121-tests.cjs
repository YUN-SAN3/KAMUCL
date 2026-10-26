// QA contract fixtures only; not native Mac or live public-install acceptance.
const test=require('node:test'),assert=require('node:assert/strict')
const {assertCommunityQueuePrepare,assertCommunityQueueConfirmation,classifyPreparationBrowse,readCommunityConfirmation,readCommunityQueueState}=require('./verify-mac-parity-ui.cjs')
const operation='22345678-1234-4123-8123-123456789abc',queueId='12345678-1234-4123-8123-123456789abc',file={source:'modrinth',projectId:'P7dR8mSH',fileId:'real-file',fileName:'fabric-api.jar',url:'https://cdn.modrinth.com/declared.jar',sha1:'a'.repeat(40),size:123,gameVersions:['1.20.1'],loaders:['fabric']},target={id:'owned',folder:'/private/owned/games',mcVersion:'1.20.1',loader:'fabric'}
const make=()=>{const plan={id:'plan',target:{id:target.id,folder:target.folder},warnings:[],files:[{...file,dependency:false}],missing:[]},call={channel:'mods:prepare',startedAt:100,completedAt:200,arguments:[{id:target.id,folder:target.folder},{file:structuredClone(file)},operation],result:plan},state={blocked:false,items:[{id:queueId,state:'preparing',fileName:file.fileName,target:target.id+' · '+target.folder,status:'预下载与检测'}]},item={id:queueId,state:'confirmation',operationId:operation,folder:target.folder,file:structuredClone(file),target:structuredClone(target),plan:structuredClone(plan)};return{call,state,item}}
test('queue preparation guard binds the one original request, target and operation without a blocking dialog',()=>{
 const {call,state}=make();assert.equal(assertCommunityQueuePrepare(state,call,file,target).id,queueId);state.items[0].state='confirmation';assertCommunityQueuePrepare(state,call,file,target)
 for(const mutate of [x=>x.state.blocked=true,x=>x.state.items.push({...x.state.items[0]}),x=>x.state.items[0].state='completed',x=>x.state.items[0].state='failed',x=>x.state.items[0].fileName='different.jar',x=>x.state.items[0].target='/foreign/games',x=>x.call.error={message:'real failure'},x=>x.call.arguments[0].folder='/foreign/games',x=>x.call.arguments[1].file.sha1='b'.repeat(40),x=>x.call.arguments[1].file.fileId='different',x=>x.call.arguments[2]='bad-operation']){const x=make();mutate(x);assert.throws(()=>assertCommunityQueuePrepare(x.state,x.call,file,target))}
})
test('explicit confirmation must show the exact completed public prepare plan and immutable selected file',()=>{
 const {call,item}=make();assert.equal(assertCommunityQueueConfirmation(item,call,file,target,queueId).id,'plan')
 for(const mutate of [x=>delete x.call.completedAt,x=>x.call.completedAt=99,x=>x.call.error={message:'prepare failed'},x=>x.item.id='different-queue',x=>x.item.state='installing',x=>x.item.operationId=queueId,x=>x.item.file.sha1='b'.repeat(40),x=>x.item.target.loader='forge',x=>x.item.folder='/foreign',x=>x.item.plan.id='other-plan',x=>x.item.plan.files[0].sha1='b'.repeat(40),x=>{x.item.plan.warnings=['incompatible'];x.call.result.warnings=['incompatible']}]){const x=make();mutate(x);assert.throws(()=>assertCommunityQueueConfirmation(x.item,x.call,file,target,queueId))}
})
test('original public-service action timing distinguishes in-flight preparation from fast completion',()=>{
 const {call}=make(),row=at=>({at,label:'original native control',originalTrustedClick:{isTrusted:true,type:'click',timeOrigin:100,at:at-100},observedAt:at+5}),early=classifyPreparationBrowse(call,[row(150),row(210)]);assert.equal(early.duringPrepare,true)
 assert.equal(classifyPreparationBrowse(call,[row(210),row(250)]).duringPrepare,false,'naturally fast service does not fabricate in-flight coverage')
 for(const actions of [[],[row(99)],[row(NaN)]])assert.throws(()=>classifyPreparationBrowse(call,actions));const pending={...call};delete pending.completedAt;assert.throws(()=>classifyPreparationBrowse(pending,[row(150)]))
 for(const mutate of [x=>x.originalTrustedClick.isTrusted=false,x=>x.originalTrustedClick.type='keydown',x=>x.at++,x=>x.observedAt=100,x=>delete x.originalTrustedClick]){const x=row(150);mutate(x);assert.throws(()=>classifyPreparationBrowse(call,[x]))}
})
test('confirmation reader serializes actual reactive item props without inventing installer input',()=>{
 const {item}=make();const read=rows=>new Function('window',`return (${readCommunityConfirmation.toString()})()`)({__macParityObserver:{instances:()=>rows}})
 assert.deepEqual(read([{type:{__name:'CommunityInstallConfirmation'},props:{item:new Proxy(item,{})}}]),item);assert.deepEqual(read([]),{})
 assert.throws(()=>read([{type:{__name:'CommunityInstallConfirmation'},props:{item}},{type:{__name:'CommunityInstallConfirmation'},props:{item}}]));assert.deepEqual(read([{type:{__name:'ModInstallDialog'},props:{input:{file},target}}]),{},'old local installer cannot qualify the new community queue')
})
test('queue reader uses current keyed rendered articles and actual dialog state',()=>{
 const article={dataset:{state:'confirmation'},querySelector:s=>({textContent:s==='.queue-name'?'fabric-api.jar':s==='.queue-info small'?'owned · /private/owned/games':'等待确认前置'})},o={nodeForElement:(name,element)=>{assert.equal(name,'CommunityDownloadQueue');assert.equal(element,article);return{key:queueId}}}
 const read=blocked=>new Function('document','window',`return (${readCommunityQueueState.toString()})()`)({querySelector:s=>s.startsWith('[data-nav')?{dataset:{nav:'community'}}:blocked?{}:null,querySelectorAll:()=>[article]},{__macParityObserver:o})
 assert.deepEqual(read(false),{route:'community',blocked:false,items:[{id:queueId,state:'confirmation',fileName:'fabric-api.jar',target:'owned · /private/owned/games',status:'等待确认前置'}]});assert.equal(read(true).blocked,true)
})
