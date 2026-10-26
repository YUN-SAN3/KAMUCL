// Opt-in module only. Each CLI invocation creates its own disposable profile.
// The later cold/native acceptance processes do not reuse this traced renderer.
const fs=require('node:fs')
async function nativeTraceModule(h,dependencies={}){
 if(h.version!==require('../package.json').version||!require('./ui-capabilities.cjs').singleLogo||await h.main('process.platform')!=='darwin')throw Error('native-trace requires the current disposable Darwin harness')
 const trace=dependencies.trace||require('./native-compositor-trace-119.cjs'),motion=dependencies.motion||require('./verify-kamu-motion-diagnostic-119.cjs')
 const writeProof=dependencies.writeProof||((name,value)=>fs.writeFileSync('out/'+name,JSON.stringify(value,null,2)))
 const recordScreencast=async(name,action,duration)=>{
  let failure
  const recording=await h.recordScreencast(name,async()=>{try{await action()}catch(error){failure=error}},duration)
  if(failure){writeProof('kamu-native-compositor-trace-action.json',{version:h.version,classification:'failed separate diagnostic; original frames saved before rethrow',name,errorType:failure.name,recording});throw failure}
  return recording
 }
 return trace(h,async({observe})=>{
  let failure,result
  try{result=await motion({...h,recordScreencast,motionDiagnosticInvocation:'native-trace',nativeTraceObserve:observe})}catch(error){failure=error}
  try{
   const state=await h.evaluate(`(()=>{const p=window.__kamuNativeDiag,w=p?.watch;return{classification:'separate diagnostic last real observations, including failed action',samples:w?.samples||[],raf:w?.raf||[],timers:w?.timers||[],longTasks:w?.longTasks||[],sources:p?.events||[],initialization:p?.initialization||[],bufferInitialization:p?.bufferInitialization||null}})()`)
   writeProof('kamu-native-compositor-trace-observations.json',{version:h.version,...state})
  }catch(error){if(failure)throw new AggregateError([failure,error],'Trace action and last observation both failed');throw error}
  if(failure)throw failure
  return result
 },{enabled:true,separateRun:true})
}
module.exports=nativeTraceModule
