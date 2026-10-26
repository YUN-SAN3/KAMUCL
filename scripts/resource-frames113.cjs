// Original renderer callback clocks, including the entire observation window.
// These describe callback delivery, never GPU presents or video capture FPS.
const assert=require('node:assert/strict')
const {assertCallbackEvidence}=require('./resource-callback113.cjs')
const percentile=(a,p)=>{const v=[...a].sort((x,y)=>x-y);return v[Math.min(v.length-1,Math.ceil(v.length*p)-1)]}
function frameStats(operation){
 const {frames,rendererWindow}=operation;assert(rendererWindow&&Number.isFinite(rendererWindow.start)&&Number.isFinite(rendererWindow.end)&&rendererWindow.end>rendererWindow.start,'Original renderer window clocks required')
 const elapsedMs=rendererWindow.end-rendererWindow.start,frameClocks=frames.map(f=>f.now),deliveries=frames.map(f=>f.deliveredAt)
 assert(frameClocks.every(Number.isFinite));assert(frameClocks.slice(1).every((t,i)=>t>frameClocks[i]),'Original frame timestamps cannot be duplicated or inserted')
 assert(deliveries.every(Number.isFinite),'Each original callback requires its actual delivery clock');assert(deliveries.every(t=>t>=rendererWindow.start&&t<=rendererWindow.end));assert(deliveries.slice(1).every((t,i)=>t>=deliveries[i]),'Original entry observation clock cannot move backwards')
 assert(Number.isFinite(rendererWindow.timeOrigin)&&Number.isFinite(rendererWindow.endTimeOrigin)&&rendererWindow.timeOrigin===rendererWindow.endTimeOrigin,'Actual original document time origin must remain unchanged across the full observation window')
 assertCallbackEvidence(operation)
 // A rAF argument is the beginning of its frame, and can precede registration
 // within that same frame. Retain it exactly; the actual callback-delivery clock
 // bounds the full observation window without deleting that legitimate frame.
 const frameClockGapsMs=frameClocks.slice(1).map((t,i)=>t-frameClocks[i]),gaps=deliveries.length?[deliveries[0]-rendererWindow.start,...deliveries.slice(1).map((t,i)=>t-deliveries[i]),rendererWindow.end-deliveries.at(-1)]:[elapsedMs]
 const equalDeliveryClockPairs=deliveries.flatMap((t,i)=>i>0&&t===deliveries[i-1]?[{previousIndex:i-1,index:i,previousRAFClock:frameClocks[i-1],RAFClock:frameClocks[i],deliveredAt:t,previousOrdinal:frames[i-1].ordinal,ordinal:frames[i].ordinal,previousRequestHandle:frames[i-1].requestHandle,requestHandle:frames[i].requestHandle}]:[])
 return{elapsedMs,originalCallbacks:deliveries.length,callbackRatePerSecond:deliveries.length*1000/elapsedMs,initialGapMs:gaps[0],tailGapMs:gaps.at(-1),gapP95Ms:percentile(gaps,.95),gapMaxMs:Math.max(...gaps),equalDeliveryClockPairs,crossClockOffsetsMs:frameClocks.map((t,i)=>t-deliveries[i]),frameClockGapsMs,frameClockGapP95Ms:frameClockGapsMs.length?percentile(frameClockGapsMs,.95):null,frameClockGapMaxMs:frameClockGapsMs.length?Math.max(...frameClockGapsMs):null,preRegistrationFrameClocks:frameClocks.filter(t=>t<rendererWindow.start).length,classification:'Actual original callback-entry performance.now observations with closure request/ordinal/context evidence over the full window; unchanged rAF frame clocks retained separately. Equal coarsened entry clocks are preserved, not merged or altered. Not GPU present/capture FPS',gaps}
}
module.exports={frameStats}
