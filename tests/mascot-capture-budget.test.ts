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
