// Protocol validation only: integrity is not a substitute for independent native review.
const assert=require('node:assert/strict'),crypto=require('node:crypto')
const baseline=require('./platform-acceptance-baseline.json'),functions=require('./platform-acceptance-subassertions.cjs'),criteria=require('./platform-ipc-contracts.cjs')
assert.equal(baseline.channels.length,280);assert.equal(functions.length,63)
assert.deepEqual(criteria.map(row=>row.name).sort(),[...baseline.channels].sort())
const ipcContracts=criteria.map(row=>({...row,operations:baseline.transports[row.name],ipc:true}))
const runtimeSources=new Set(['native-product','native-capture','native-game','real-service','fault-injection'])
const documentCache=new WeakMap()
const text=value=>typeof value==='string'&&value.trim().length>0
function verifyInventory(matrix){
 const channels=matrix.inventory?.ipcChannels
 assert(Array.isArray(channels)&&new Set(channels.map(row=>row.channel)).size===channels.length,'IPC库存缺少或重复')
 assert(baseline.channels.every(channel=>channels.some(row=>row.channel===channel)),'原280个IPC库存不可缩减或替换')
 assert.equal(matrix.inventory.ipcChannelCount,channels.length,'IPC库存数量声明不符')
 const rows=matrix.features.flatMap(group=>group.functions)
 assert.deepEqual(rows.map(row=>row.id).sort(),baseline.functions.map(row=>row.id).sort(),'原63项功能库存不可缩减或替换')
 for(const row of baseline.functions)assert.equal(rows.find(value=>value.id===row.id).acceptance,row.acceptance,'原功能验收定义不能被改写：'+row.id)
 assert.deepEqual(channels.map(row=>row.channel).sort(),[...baseline.channels].sort(),'280接口新增或修改需明确更新固定行为合同')
 return ipcContracts
}
const subassertionsFor=(id,platform)=>functions.find(row=>row.id===id).subassertions.filter(row=>!row.platforms||row.platforms.includes(platform))
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)
const declarations=new Set(['passed','success','exists','status','present','registered','handlerPresent','declared','implemented'])
function meaningful(value){
 if(value===null)return true
 if(Array.isArray(value))return value.length===0||value.some(meaningful)
 if(object(value)){const keys=Object.keys(value);return keys.length>0&&!keys.every(key=>declarations.has(key))&&keys.some(key=>!declarations.has(key)&&meaningful(value[key]))}
 return typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&text(value)&&!declarations.has(value.toLowerCase())
}
function structuredObservation(value,row,contract){
 assert(object(value),'不能以整行布尔或存在性替代语义')
 if(contract.ipc){
  assert(contract.operations.includes(row.operation),'实际IPC操作类型不符合固定接口合同')
  if(row.operation==='event'){
   assert(object(value.trigger)&&text(value.trigger.operation)&&object(value.event)&&value.event.channel===row.name&&Object.hasOwn(value.event,'payload')&&meaningful(value.event.payload),'事件需要真实触发及实际接收payload，不能只有成功宣告')
   assert(object(value.before)&&object(value.after)&&meaningful(value.before)&&meaningful(value.after),'事件需要可核查前后状态')
  }else{
   assert(object(value.request)&&value.request.channel===row.name&&value.request.transport===row.operation&&(Array.isArray(value.request.arguments)||object(value.request.arguments)),'必须记录实际IPC请求参数和操作类型')
   const response=Object.hasOwn(value,'response')&&meaningful(value.response),effects=object(value.effects)&&object(value.effects.before)&&object(value.effects.after)&&meaningful(value.effects.before)&&meaningful(value.effects.after)
   assert(row.operation==='send'?effects:response||effects,'请求需要有判定意义的实际返回值或副作用前后状态，不能以passed/success/exists/status宣告替代')
  }
 }else assert(object(value.action)&&value.action.operation===row.operation&&(object(value.action.inputs)||Array.isArray(value.action.inputs))&&object(value.before)&&object(value.after)&&meaningful(value.before)&&meaningful(value.after),'功能子项需要实际操作和可核查前后状态，不能以passed/success/exists/status宣告替代')
}
function verifySemanticRows(proof,rows,contracts,label){
 assert(Array.isArray(rows),label+'缺少实际语义观察')
 assert.deepEqual(rows.map(row=>row.name).sort(),contracts.map(row=>row.name).sort(),label+'逐项语义遗漏/重复/未知')
 let documents=documentCache.get(proof);if(!documents){documents=new Map();documentCache.set(proof,documents)}
 for(const row of rows){
  assert.equal(row.status,'passed',label+'语义未通过'+row.name)
  assert(runtimeSources.has(row.source)&&row.source===proof.source,label+'静态存在/夹具不是实际语义来源')
  assert(text(row.criterion)&&text(row.operation)&&text(row.observationId),'缺少语义判据/操作/原始观察ID')
  const contract=contracts.find(value=>value.name===row.name)
  if(contract.criterion)assert.equal(row.criterion,contract.criterion,'子断言判据不能缩减或替换：'+row.name)
  for(const key of['expected','actual'])structuredObservation(row[key],row,contract)
  assert.deepEqual(row.actual,row.expected,label+'实际语义结果不符：'+row.name)
  const attachment=proof.attached.get(row.observationAttachment)
  assert(attachment?.role==='original-semantic-observations','缺少原始运行语义观察附件')
  let doc=documents.get(attachment.id)
  if(!doc){
   doc=JSON.parse(attachment.bytes.toString('utf8'));documents.set(attachment.id,doc)
   assert.equal(doc.schema,1);assert.equal(doc.observationType,'runtime-behavior','静态库存不构成行为证据');assert.equal(doc.source,proof.source)
   for(const key of['version','sourceCommit','platformId','architecture','runtimeVersion'])assert.equal(doc[key],proof[key],'原始语义身份不一致：'+key)
   assert.deepEqual(doc.artifactSHA256,proof.artifactSHA256);assert.deepEqual(doc.host,proof.host);assert.deepEqual(doc.run,proof.run)
   assert(Array.isArray(doc.observations)&&new Set(doc.observations.map(value=>value.id)).size===doc.observations.length,'原始语义观察缺少/重复')
  }
  const observed=doc.observations.find(value=>value.id===row.observationId)
  assert(observed,'没有对应原始语义观察：'+row.name)
  assert.equal(observed.subject,row.name,'不能将其他接口或子断言的观察复用')
  assert.equal(observed.performed,true,'未实际执行操作')
  const time=Date.parse(observed.observedAt)
  assert(Number.isFinite(time)&&time>=Date.parse(proof.run.startedAt)&&time<=Date.parse(proof.run.endedAt),'语义观察不在实际命令时间内')
  for(const key of['criterion','operation','source','status','expected','actual'])assert.deepEqual(observed[key],row[key],'原始语义结果不能重标：'+key)
  const locator=observed.traceLocator,trace=proof.attached.get(locator?.attachment)
  assert(trace?.role==='original-runtime-trace'&&Number.isSafeInteger(locator.byteOffset)&&locator.byteOffset>=0&&Number.isSafeInteger(locator.byteLength)&&locator.byteLength>0&&locator.byteOffset+locator.byteLength<=trace.bytes.length,'没有可核查实际原trace字节位置')
  const raw=trace.bytes.subarray(locator.byteOffset,locator.byteOffset+locator.byteLength)
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),locator.sha256,'原trace片段摘要不符')
  const original=JSON.parse(raw.toString('utf8'));assert.equal(original.subject,row.name);assert.equal(original.operation,row.operation);assert.equal(original.observedAt,observed.observedAt);assert.deepEqual(original.observation,row.actual,'actual必须来自实际原请求返回或状态，不能由宣告包装')
 }
}
module.exports={baselineChannels:baseline.channels,baselineFunctions:baseline.functions,ipcContracts,subassertionsFor,verifyInventory,verifySemanticRows}
