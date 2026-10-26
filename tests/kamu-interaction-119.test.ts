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
 assert.equal(contacts[0],275,'first visible late callback is the actual contact, not the old 255ms schedule');assert(contacts[1]>=800)
 assert(cycles.size>=10,'every accepted slap has visible observations')
})
test('presentation clock starts at activation after a long idle and resumes after hiding',()=>{
 const animation=new KamuInteraction();animation.advance(0,false,50);animation.accept(10000)
 assert.equal(animation.advance(10050,false,50).contacts.length,0)
 animation.pause(10050);animation.resume(20050)
 const contacts:number[]=[];for(let now=20100;now<=20700;now+=25)contacts.push(...animation.advance(now,false,50).contacts)
 assert.deepEqual(contacts,[20275]);assert.equal(animation.busy,true)
 assert.equal(animation.advance(20750,false,50).yaw,0);assert.equal(animation.busy,false)
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
test('bounded late contact presents canonical centre and retains a full 75ms retreat before the next cycle',()=>{
 const animation=new KamuInteraction();animation.accept(0);animation.accept(0)
 for(const now of [0,50,100,150,180,220])animation.advance(now,false,50)
 const contact=animation.advance(280,false,50);assert.deepEqual(contact.contacts,[280]);assert.equal(contact.palm,.5);assert.equal(contact.cycleId,1)
 const retreat=animation.advance(330,false,50);assert.equal(retreat.cycleId,1);assert.equal(retreat.palm,5/6);assert.equal(retreat.contacts.length,0)
 const next=animation.advance(355,false,50);assert.equal(next.cycleId,2);assert.equal(next.palm,0);assert.equal(next.contacts.length,0)
 const second=animation.advance(430,false,50);assert.equal(second.contacts.length,0,'a delayed callback preserves its 50ms presentation budget')
 const landed=animation.advance(455,false,50);assert.deepEqual(landed.contacts,[455]);assert.equal(landed.palm,.5);assert.equal(landed.cycleId,2)
})
test('all 32 accepted clicks survive arbitrary visible stalls with one actual centre contact per independent cycle',()=>{
 const animation=new KamuInteraction();for(let i=0;i<32;i++)assert(animation.accept(0));assert.equal(animation.accept(0),false)
 const contacts:number[]=[],cycles=new Set<number>();let now=0
 for(let i=0;i<1000&&animation.busy;i++){
  now+=[17,33,46,320,8,29][i%6];const pose=animation.advance(now,false,50)
  assert(pose.contacts.length<=1)
  if(pose.contacts.length){assert.deepEqual(pose.contacts,[now]);assert.equal(pose.palm,.5);assert(!cycles.has(pose.cycleId));cycles.add(pose.cycleId);contacts.push(now)}
 }
 assert.equal(animation.busy,false);assert.equal(contacts.length,32);assert.equal(cycles.size,32)
 assert(contacts.slice(1).every((at,i)=>at-contacts[i]>=150),'no accepted visible cycle steals the preceding retreat or next approach')
 assert.equal(animation.advance(now+1,false,50).contacts.length,0)
})
