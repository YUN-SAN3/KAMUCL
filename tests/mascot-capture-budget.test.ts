import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const budget=createRequire(import.meta.url)('../scripts/mascot-capture-budget.cjs')
test('native frame acceptance honors the active display ceiling without rounding or invalid-frequency bypass',()=>{
 const low={activeDisplay:{id:1,displayFrequency:29.8623}}
 assert.equal(budget(low,29.959248199).passed,true)
 assert.equal(budget(low,28.2347).passed,false)
 assert.equal(budget({activeDisplay:{displayFrequency:60}},29.99999).passed,false)
 assert.equal(budget({activeDisplay:{displayFrequency:60}},30).passed,true)
 for(const hz of [undefined,NaN,Infinity,0,9,501,'29'])assert.equal(budget({activeDisplay:{displayFrequency:hz}},29.959248199).passed,false)
 assert.equal(budget({displays:[{displayFrequency:20}]},29.959248199).passed,false,'another screen cannot relax the actual window target')
 for(const fps of [undefined,NaN,Infinity,-1,'30'])assert.equal(budget(low,fps).passed,false)
 assert.equal(budget(low,29.86229).passed,false,'the unrounded threshold remains strict')
})

test('noninteger feedback diagnostic guards reject missing cycles, sound, saved counts and invalid actual image state',()=>{
 const check=createRequire(import.meta.url)('../scripts/verify-kamu-feedback-scale-119-ui.cjs').assertScaleContract
 // State-only fixtures exercise validation, never fabricate a screenshot or
 // claim compositor/native acceptance. Real PNG/JPEG pixels come only from CDP.
 const image={tag:'IMG',complete:true,width:15,height:15,imageRendering:'pixelated',opacity:1,rect:{width:18.75,height:18.75}}
 const fixture={accepted:8,before:{contacts:0,sounds:0},after:{phase:'front',queue:0,contacts:8,sounds:8},savedBefore:{counts:{kamu:5}},savedAfter:{counts:{kamu:13}},observations:[{phase:'slap',queue:7,hidden:false,palm:{...image},print:{...image}},{phase:'front',queue:0,hidden:false,palm:{...image},print:{...image}}],recording:{frames:[{},{}],fps:30}}
 check(fixture)
 for(const mutate of [
  (f:any)=>f.after.contacts=7,(f:any)=>f.after.sounds=7,(f:any)=>f.savedAfter.counts.kamu=12,
  (f:any)=>f.after.phase='return',(f:any)=>f.observations[0].queue=33,(f:any)=>f.observations[0].hidden=true,
  (f:any)=>f.observations[0].palm.complete=false,(f:any)=>f.observations[0].print.width=16,
  (f:any)=>f.observations.forEach((s:any)=>s.palm.opacity=0),(f:any)=>f.observations.forEach((s:any)=>s.print.opacity=0),
  (f:any)=>f.recording.frames=[],(f:any)=>f.recording.fps=NaN
 ]){const bad=structuredClone(fixture);mutate(bad);assert.throws(()=>check(bad))}
})
