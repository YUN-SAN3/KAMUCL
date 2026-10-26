// QA-only callback ownership and original-clock evidence. No product mutation.
const assert=require('node:assert/strict')
function contextTracker(){return{live:new Map(),events:[],generation:0,errors:[]}}
function contextEvent(tracker,message){
 if(!['Runtime.executionContextCreated','Runtime.executionContextDestroyed','Runtime.executionContextsCleared'].includes(message.method))return
 const event={method:message.method,params:structuredClone(message.params||{}),receivedAtUnixMs:Date.now(),sequence:tracker.events.length}
 tracker.events.push(event)
 if(message.method==='Runtime.executionContextsCleared'){tracker.live.clear();tracker.generation++;return}
 if(message.method==='Runtime.executionContextCreated'){
  const context=event.params.context;assert(context&&Number.isInteger(context.id)&&typeof context.uniqueId==='string'&&context.uniqueId.length,'Actual CDP execution context identity required')
  tracker.live.set(context.uniqueId,{context,createdEvent:event});return
 }
 const id=event.params.executionContextId,uniqueId=event.params.executionContextUniqueId
 if(typeof uniqueId==='string')tracker.live.delete(uniqueId)
 else for(const[key,value]of tracker.live)if(value.context.id===id)tracker.live.delete(key)
}
function selectContext(tracker,tree){
 assert.deepEqual(tracker.errors,[],'Original context lifecycle observer must be complete')
 const frame=tree.frameTree?.frame;assert(frame&&typeof frame.id==='string'&&typeof frame.url==='string','Actual main-frame identity required')
 const matches=[...tracker.live.values()].filter(v=>v.context.auxData?.isDefault===true&&v.context.auxData.frameId===frame.id)
 assert.equal(matches.length,1,'Exactly one live default context for the owned main frame required')
 const {context,createdEvent}=matches[0]
 return{contextId:context.id,uniqueContextId:context.uniqueId,frameId:frame.id,frameURL:frame.url+(frame.urlFragment||''),generation:tracker.generation,createdEvent:structuredClone(createdEvent)}
}
// Serialized into the explicitly bound, real default renderer context.
function beginObservation(holdToken,contextUniqueId){
 if(Object.prototype.hasOwnProperty.call(window,'__resource113ObservationStop'))throw Error('An original hold is still active')
 const frames=[],requests=[],consumptions=[],begin=performance.now(),timeOrigin=performance.timeOrigin,documentURL=document.URL
 let ended=false,callbackCount=0,pendingRequestHandle
 const request=ordinal=>{const handle=requestAnimationFrame(tick);requests.push(Object.freeze({ordinal,handle}));pendingRequestHandle=handle;return handle}
 const tick=now=>{
  const deliveredAt=performance.now() // First callback statement, before any DOM lookup.
  if(ended)return
  const ordinal=callbackCount++,requestHandle=pendingRequestHandle
  pendingRequestHandle=null
  consumptions.push(Object.freeze({ordinal,requestHandle,now,deliveredAt}))
  const skin=document.querySelector('.viewer3d'),mascot=document.querySelector('.mascot-stage')
  const row={ordinal,holdToken,contextUniqueId,requestHandle,now,deliveredAt,timeOrigin:performance.timeOrigin,documentURL:document.URL,hidden:document.hidden,focus:document.hasFocus(),skinAnimation:skin?.dataset.animationState,skinPose:skin?.dataset.pose,mascotPhase:mascot?.dataset.phase,contacts:mascot?.dataset.contacts,banner:document.querySelector('.hero-image.active')?.getAttribute('src'),bannerComplete:document.querySelector('.hero-image.active')?.complete}
  const nextHandle=request(ordinal+1)
  frames.push(Object.freeze({...row,nextHandle}))
 }
 const initialRequestHandle=request(0)
 const stop=token=>{
  const end=performance.now()
  if(token!==holdToken||ended)throw Error('Invalid or repeated original hold snapshot')
  ended=true
  const cancelledRequestHandle=pendingRequestHandle
  cancelAnimationFrame(cancelledRequestHandle)
  delete window.__resource113ObservationStop
  return{end,timeOrigin:performance.timeOrigin,documentURL:document.URL,holdToken,contextUniqueId,callbackCount,initialRequestHandle,pendingRequestHandle,cancelledRequestHandle,requests:requests.slice(),consumptions:consumptions.slice(),frames:frames.slice()}
 }
 Object.defineProperty(window,'__resource113ObservationStop',{value:stop,configurable:true,writable:false,enumerable:false})
 return{begin,timeOrigin,documentURL,holdToken,contextUniqueId,initialRequestHandle}
}
const beginExpression=(token,contextUniqueId)=>'('+beginObservation.toString()+')('+JSON.stringify(token)+','+JSON.stringify(contextUniqueId)+')'
const stopExpression=token=>'window.__resource113ObservationStop('+JSON.stringify(token)+')'
function assertCallbackEvidence(operation){
 const {frames,rendererWindow,callbackEvidence:e}=operation
 assert(e&&e.schema===1,'Actual callback ownership evidence required; old arrays cannot be backfilled')
 assert(typeof e.holdToken==='string'&&e.holdToken.length>10)
 const {contextStart:s,contextEnd:t,start,end,lifecycleEvents}=e
 assert(s&&t&&s.uniqueContextId===t.uniqueContextId&&s.contextId===t.contextId&&s.frameId===t.frameId&&s.frameURL===t.frameURL&&s.generation===t.generation,'Original renderer execution context must remain unchanged')
 assert(typeof s.uniqueContextId==='string'&&s.uniqueContextId.length>0&&Number.isInteger(s.contextId)&&s.contextId>0)
 assert(s.createdEvent?.method==='Runtime.executionContextCreated'&&s.createdEvent.params.context.uniqueId===s.uniqueContextId&&s.createdEvent.params.context.id===s.contextId&&s.createdEvent.params.context.auxData?.frameId===s.frameId&&s.createdEvent.params.context.auxData?.isDefault===true,'Identity must come from the actual CDP context-created event')
 assert.deepEqual(t.createdEvent,s.createdEvent)
 assert(Array.isArray(lifecycleEvents))
 assert(!lifecycleEvents.some(event=>event.method==='Runtime.executionContextsCleared'||event.method==='Runtime.executionContextDestroyed'&&(typeof event.params?.executionContextUniqueId==='string'?event.params.executionContextUniqueId===s.uniqueContextId:event.params?.executionContextId===s.contextId)),'Observed hold context was destroyed or cleared')
 assert(start.documentURL===end.documentURL&&start.documentURL===s.frameURL&&start.timeOrigin===end.timeOrigin&&start.timeOrigin===rendererWindow.timeOrigin&&end.timeOrigin===rendererWindow.endTimeOrigin,'Actual document URL and time origin must remain unchanged')
 assert(start.holdToken===e.holdToken&&end.holdToken===e.holdToken&&start.contextUniqueId===s.uniqueContextId&&end.contextUniqueId===s.uniqueContextId)
 assert.equal(start.begin,rendererWindow.start);assert.equal(end.end,rendererWindow.end)
 assert.equal(end.callbackCount,frames.length,'Closure callback count and original rows must match')
 assert(Array.isArray(end.requests)&&Array.isArray(end.consumptions))
 assert.equal(end.requests.length,frames.length+1);assert.equal(end.consumptions.length,frames.length)
 const handles=end.requests.map((r,i)=>{assert.equal(r.ordinal,i);assert(Number.isInteger(r.handle)&&r.handle>=0);return r.handle})
 assert.equal(new Set(handles).size,handles.length,'An original request handle cannot be reused in this bounded hold')
 assert.equal(start.initialRequestHandle,handles[0]);assert.equal(end.initialRequestHandle,handles[0]);assert.equal(end.pendingRequestHandle,handles.at(-1));assert.equal(end.cancelledRequestHandle,handles.at(-1),'Stop must cancel the actual final pending request')
 for(let i=0;i<frames.length;i++){
  const f=frames[i],consume=end.consumptions[i]
  assert.equal(f.ordinal,i,'Original callback ordinal chain required');assert.equal(consume.ordinal,i)
  assert.equal(f.holdToken,e.holdToken);assert.equal(f.contextUniqueId,s.uniqueContextId)
  assert.equal(f.requestHandle,handles[i]);assert.equal(f.nextHandle,handles[i+1]);assert.equal(consume.requestHandle,handles[i])
  assert.equal(consume.now,f.now);assert.equal(consume.deliveredAt,f.deliveredAt)
  assert.equal(f.documentURL,start.documentURL);assert.equal(f.timeOrigin,start.timeOrigin)
 }
 return true
}
module.exports={contextTracker,contextEvent,selectContext,beginExpression,stopExpression,beginObservation,assertCallbackEvidence}
