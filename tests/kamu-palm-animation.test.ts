import test from 'node:test'
import assert from 'node:assert/strict'
import {KamuPalmAnimation} from '../src/renderer/src/kamuPalmAnimation'
import {animationElement} from './palm-animation-fixture'

function fixture(){let now=0;const palm=animationElement(()=>now),print=animationElement(()=>now),events:any[]=[];const effects=new KamuPalmAnimation(palm.element,print.element,e=>events.push(e),()=>now);return{effects,palm,print,events,time:(value:number)=>now=value}}
test('remaining approach is compositor-owned, holds centre, and actual contact starts full retreat and print exactly once',async()=>{
 const f=fixture();assert.equal(f.palm.animations.length,0,'preparation cannot show a fake palm')
 f.effects.present({cycleId:1,palm:.2,reduced:false});assert.equal(f.palm.animations[0].options.duration,45)
 f.time(45);assert.equal(f.palm.styles.get('opacity'),'1');await Promise.resolve();assert.equal(f.effects.snapshot().palmPhase,'hold')
 f.time(110);f.effects.present({cycleId:1,palm:.5,contactAt:110,reduced:false});const retreat=f.palm.animations.at(-1)!;assert.equal(retreat.options.duration,75);assert.deepEqual(retreat.frames[0],{transform:'translate(0px,0px) rotate(0deg)',opacity:1});assert.equal(f.print.animations[0].options.duration,500)
 f.effects.present({cycleId:1,palm:.5,contactAt:110,reduced:false});assert.equal(f.palm.animations.length,2);assert.equal(f.print.animations.length,1)
 f.time(147.5);assert.equal(f.palm.styles.get('opacity'),'0.5','effect advances with no product JS frame');assert(Math.abs(Number(f.print.styles.get('opacity'))-.666)<1e-10)
 f.time(185);assert.equal(f.palm.styles.get('opacity'),'0');assert.equal(f.effects.snapshot().palmPlayState,'finished');f.time(610);assert.equal(f.print.styles.get('opacity'),'0')
 f.effects.dispose();assert.equal((f.palm.element as any).getAnimations().length,0);assert.equal((f.print.element as any).getAnimations().length,0)
})
test('hidden pause preserves actual effect currentTime; resume and disposal cannot consume a click or start a sound',()=>{
 const f=fixture();f.effects.present({cycleId:1,palm:.5,contactAt:0,reduced:false});f.time(25);f.effects.pause();const before=f.effects.snapshot();f.time(10025);assert.equal(f.effects.snapshot().palmCurrentTime,before.palmCurrentTime);assert.equal(f.effects.snapshot().printCurrentTime,before.printCurrentTime)
 f.effects.present({cycleId:2,palm:0,contactAt:10025,reduced:false});assert.equal(f.palm.animations.length,1,'hidden code cannot create a phantom cycle')
 f.effects.resume();f.time(10050);assert.equal(f.effects.snapshot().palmCurrentTime,50);f.effects.dispose();f.effects.resume();f.effects.present({cycleId:2,palm:0,reduced:false});assert.equal(f.palm.animations.length,1)
})
test('continuous independent cycle ids replace only completed retreats and repeat print from the actual new contact',()=>{
 const f=fixture();for(let cycle=1;cycle<=10;cycle++){const contact=cycle*150;f.time(contact-75);if(cycle>1)assert.equal(f.palm.animations.at(-1).currentTime,75,'the previous retreat has its full duration before a new approach');f.effects.present({cycleId:cycle,palm:0,reduced:false})
 f.time(contact);f.effects.present({cycleId:cycle,palm:.5,contactAt:contact,reduced:false});assert.equal(f.effects.snapshot().contactAt,contact);assert.equal(f.palm.styles.get('opacity'),'1')}
 assert.equal(f.print.animations.length,10);assert.equal(f.palm.animations.length,20);assert.equal((f.palm.element as any).getAnimations().length,1);assert.equal((f.print.element as any).getAnimations().length,1);f.effects.dispose()
})
test('reduced motion keeps a real short-lived print and no palm animation; canceled effect completion cannot overwrite successor',async()=>{
 const f=fixture();f.effects.present({cycleId:1,palm:0,reduced:false});f.time(75);f.effects.present({cycleId:1,palm:.5,contactAt:75,reduced:true});assert.equal((f.palm.element as any).getAnimations().length,0);assert.equal(f.print.animations.length,1);await Promise.resolve();assert.equal(f.effects.snapshot().palmPhase,'reduced');f.effects.dispose()
})
test('a resolved old approach cannot publish hold after its actual contact has started a new full retreat',async()=>{
 const f=fixture();f.effects.present({cycleId:8,palm:.2,reduced:false});f.time(45);assert.equal(f.palm.animations[0].currentTime,45)
 // Resolution queued its continuation, but actual contact owns the next effect.
 f.time(120);f.effects.present({cycleId:8,palm:.5,contactAt:120,reduced:false});await Promise.resolve();assert.equal(f.effects.snapshot().palmPhase,'retreat');assert.equal(f.effects.snapshot().palmCurrentTime,0);assert.equal(f.palm.animations.at(-1).options.duration,75);f.effects.dispose()
})
