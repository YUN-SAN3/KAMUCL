import test from 'node:test'
import assert from 'node:assert/strict'
import {KamuInteraction} from '../src/shared/kamuInteraction'

test('Kamu accepted clicks contact once at 75ms after the 180ms turn, then return front',()=>{
 const animation=new KamuInteraction()
 assert.equal(animation.accept(0),true)
 assert.equal(animation.advance(179).contacts.length,0)
 assert.equal(animation.advance(180).yaw,Math.PI)
 assert.equal(animation.advance(254).contacts.length,0)
 assert.deepEqual(animation.advance(255).contacts,[255])
 assert.equal(animation.advance(255).contacts.length,0)
 assert.equal(animation.queued,0)
 assert.equal(animation.advance(710).yaw,0)
 assert.equal(animation.busy,false)
})
test('Kamu queue limit is exact and dropped render frames preserve every accepted contact',()=>{
 const animation=new KamuInteraction()
 for(let i=0;i<32;i++)assert(animation.accept(0))
 assert.equal(animation.accept(0),false)
 const frame=animation.advance(10000)
 assert.equal(frame.contacts.length,32)
 assert.deepEqual(frame.contacts,Array.from({length:32},(_,i)=>255+i*150))
 assert.equal(animation.busy,false)
 assert.equal(animation.advance(10001).contacts.length,0)
})
test('Kamu pause keeps the timeline frozen; resume shifts contact and queue without loss',()=>{
 const animation=new KamuInteraction();animation.accept(0);animation.pause(150)
 assert.equal(animation.advance(5000).contacts.length,0)
 animation.resume(5150)
 assert.equal(animation.advance(5254).contacts.length,0)
 assert.deepEqual(animation.advance(5255).contacts,[5255])
})
test('Kamu click during return reverses smoothly and reduced motion preserves exact contacts',()=>{
 const animation=new KamuInteraction();animation.accept(0);animation.advance(620)
 const before=animation.advance(620).yaw;animation.accept(620)
 assert(Math.abs(before-animation.advance(620).yaw)<1e-8)
 assert.equal(animation.advance(1500).contacts.length,1)
 const reduced=new KamuInteraction();reduced.accept(0);reduced.accept(0)
 assert.deepEqual(reduced.advance(1000,true).contacts,[76,226])
 assert.equal(reduced.busy,false)
})
test('visible late frames preserve individual palm cycles and separated contacts',()=>{
 const animation=new KamuInteraction();for(let i=0;i<10;i++)animation.accept(0)
 const contacts:number[]=[],cycles=new Map<number,number>()
 for(let now=0;now<3600;now+=25){
  if(now===300)now=750 // a real host stall after the first contact
  const pose=animation.advance(now,false,50)
  assert(pose.contacts.length<=1,'a displayed callback cannot compress several contacts')
  contacts.push(...pose.contacts)
  if(animation.phase==='slap')cycles.set(10-animation.queued,(cycles.get(10-animation.queued)||0)+1)
 }
 assert.equal(contacts.length,10);assert.equal(animation.busy,false)
 for(let i=1;i<contacts.length;i++)assert(contacts[i]-contacts[i-1]>=150)
 assert.equal(contacts[0],255);assert(contacts[1]>=800)
 assert(cycles.size>=10,'every accepted slap has visible observations')
})
test('presentation clock starts at activation after a long idle and resumes after hiding',()=>{
 const animation=new KamuInteraction();animation.advance(0,false,50);animation.accept(10000)
 assert.equal(animation.advance(10050,false,50).contacts.length,0)
 animation.pause(10050);animation.resume(20050)
 const contacts:number[]=[];for(let now=20100;now<=20700;now+=25)contacts.push(...animation.advance(now,false,50).contacts)
 assert.deepEqual(contacts,[20255]);assert.equal(animation.busy,true)
 assert.equal(animation.advance(20710,false,50).yaw,0);assert.equal(animation.busy,false)
})
test('visible return reverses the actual presented pose after a delayed input',()=>{
 const animation=new KamuInteraction();animation.accept(0)
 let before=0;for(let now=0;now<=620;now+=20)before=animation.advance(now,false,50).yaw
 animation.accept(1500)
 assert(Math.abs(animation.advance(1500,false,50).yaw-before)<1e-8)
})
test('hidden drain keeps unbounded exact contacts after using presentation mode',()=>{
 const animation=new KamuInteraction();for(let i=0;i<32;i++)animation.accept(0)
 animation.advance(100,false,50);animation.pause(100);animation.resume(5000)
 const drained=animation.advance(20000)
 assert.equal(drained.contacts.length,32);assert.equal(animation.busy,false)
 assert.equal(animation.advance(20001,false,50).contacts.length,0)
})
