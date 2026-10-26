import test from 'node:test'
import assert from 'node:assert/strict'
import {MascotFrameDriver,type MascotFrame,type MascotFrameClock} from '../src/renderer/src/mascotFrameDriver'

function scheduler(){
 let now=0,id=0
 const rafs=new Map<number,(timestamp:number)=>void>(),allRafs=new Map<number,(timestamp:number)=>void>(),timers=new Map<number,{at:number;callback:()=>void}>(),allTimers=new Map<number,()=>void>()
 const clock:MascotFrameClock={now:()=>now,requestAnimationFrame:callback=>{const token=++id;rafs.set(token,callback);allRafs.set(token,callback);return token},cancelAnimationFrame:token=>{rafs.delete(token)},setTimeout:(callback,delay)=>{const token=++id;timers.set(token,{at:now+delay,callback});allTimers.set(token,callback);return token as unknown as ReturnType<typeof setTimeout>},clearTimeout:token=>{timers.delete(token as unknown as number)}}
 return{clock,rafs,timers,raf:(token:number,at:number,timestamp=at)=>{now=at;rafs.delete(token);allRafs.get(token)!(timestamp)},timer:(token:number,at:number)=>{now=at;timers.delete(token);allTimers.get(token)!()},setNow:(value:number)=>now=value}
}
test('frame driver keeps rAF primary at 30Hz, one pending pair and original callback timing',()=>{
 const s=scheduler(),draws:MascotFrame[]=[],driver=new MascotFrameDriver(frame=>draws.push(frame),s.clock)
 for(let i=0;i<20;i++)driver.request();assert.equal(s.rafs.size,1);assert.equal(s.timers.size,1)
 const raf=[...s.rafs.keys()][0],timer=[...s.timers.keys()][0];s.raf(raf,33.3,32.8)
 assert.deepEqual(draws,[{kind:'raf',at:33.3,rafTimestamp:32.8,gap:0,pendingAge:33.3,fallbacks:0}]);assert.equal(driver.hasPending,false);assert.equal(s.timers.size,0)
 s.timer(timer,40);assert.equal(draws.length,1,'cancelled watchdog cannot render after normal rAF');assert.equal(driver.fallbacks,0)
})
test('starved rAF gets one actual watchdog render and rejects the late native callback',()=>{
 const s=scheduler(),draws:MascotFrame[]=[],driver=new MascotFrameDriver(frame=>draws.push(frame),s.clock);driver.request()
 const raf=[...s.rafs.keys()][0],timer=[...s.timers.keys()][0];s.timer(timer,40)
 assert.equal(draws.length,1);assert.deepEqual(draws[0],{kind:'watchdog',at:40,gap:0,pendingAge:40,fallbacks:1});assert.equal(s.rafs.size,0);assert.equal(s.timers.size,0)
 driver.request();const next=[...s.rafs.keys()][0];s.raf(raf,50,49);assert.equal(draws.length,1,'stale callback cannot consume the newly pending frame')
 s.raf(next,56,55);assert.equal(draws.length,2);assert.equal(draws[1].kind,'raf');assert.equal(draws[1].gap,16);assert.equal(draws[1].fallbacks,1);assert.equal(s.timers.size,0)
})
test('frame callback can request its next frame without losing it or doubling its pair',()=>{
 const s=scheduler(),draws:MascotFrame[]=[],driver=new MascotFrameDriver(frame=>{draws.push(frame);driver.request();driver.request()},s.clock)
 driver.request();s.raf([...s.rafs.keys()][0],16);assert.equal(draws.length,1);assert.equal(s.rafs.size,1);assert.equal(s.timers.size,1)
 s.timer([...s.timers.keys()][0],56);assert.equal(draws.length,2);assert.equal(s.rafs.size,1);assert.equal(s.timers.size,1);assert.equal(driver.fallbacks,1)
 driver.cancel();assert.equal(s.rafs.size,0);assert.equal(s.timers.size,0)
})
test('cancel stops both callbacks, resumes naturally without idle gap, and dispose forbids new work',()=>{
 const s=scheduler(),draws:MascotFrame[]=[],driver=new MascotFrameDriver(frame=>draws.push(frame),s.clock);driver.request()
 const raf=[...s.rafs.keys()][0],timer=[...s.timers.keys()][0];driver.cancel();driver.cancel();assert.equal(s.rafs.size,0);assert.equal(s.timers.size,0)
 s.raf(raf,16);s.timer(timer,40);assert.equal(draws.length,0)
 s.setNow(5000);driver.request();s.raf([...s.rafs.keys()][0],5016);assert.equal(draws[0].gap,0,'a hidden/idle interval is not an active callback gap')
 driver.request();const nextRaf=[...s.rafs.keys()][0],nextTimer=[...s.timers.keys()][0];driver.dispose();driver.request();s.raf(nextRaf,5032);s.timer(nextTimer,5056)
 assert.equal(draws.length,1);assert.equal(driver.hasPending,false);assert.equal(s.rafs.size,0);assert.equal(s.timers.size,0)
})
test('render exceptions cancel even a newly requested frame and leave no timer behind',()=>{
 const s=scheduler(),driver=new MascotFrameDriver(()=>{driver.request();throw Error('actual draw failed')},s.clock)
 driver.request();assert.throws(()=>s.timer([...s.timers.keys()][0],40),/actual draw failed/);assert.equal(s.rafs.size,0);assert.equal(s.timers.size,0);assert.equal(driver.hasPending,false)
})
test('a scheduler registration failure cancels its already pending native rAF',()=>{
 const s=scheduler(),driver=new MascotFrameDriver(()=>assert.fail('cannot draw'),{...s.clock,setTimeout:()=>{throw Error('timer unavailable')}})
 assert.throws(()=>driver.request(),/timer unavailable/);assert.equal(s.rafs.size,0);assert.equal(s.timers.size,0);assert.equal(driver.hasPending,false)
})
test('native rAF registration failure does not leave a phantom pending frame',()=>{
 const s=scheduler(),driver=new MascotFrameDriver(()=>assert.fail('cannot draw'),{...s.clock,requestAnimationFrame:()=>{throw Error('rAF unavailable')}})
 assert.throws(()=>driver.request(),/rAF unavailable/);assert.equal(driver.hasPending,false);assert.equal(s.timers.size,0)
})
