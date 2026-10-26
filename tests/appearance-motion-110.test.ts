import test from 'node:test'
import assert from 'node:assert/strict'
import { CarouselPlayback } from '../src/shared/carouselPlayback'
import { carouselTiming, activeCarouselKeys } from '../src/shared/appearancePolicy'
import { favoriteIconUrl, linkFavoriteRecords } from '../src/shared/modFavorites'
import { PreviewPlayer } from '../src/renderer/src/skinModel'

test('random carousel uses complete shuffled cycles, no consecutive repeat, and stable peek while loading', () => {
  const slides = Array.from({length:7}, (_,i) => ({path:'image'+i,durationMs:1000+i*100}))
  let seed=7; const rng=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296)
  const p=new CarouselPlayback(slides,0,undefined,true,rng)
  let now=0, previous=p.index
  const first=[p.index]
  for(let i=0;i<6;i++) { now+=slides[p.index].durationMs;const next=p.peekNext(now);assert.equal(p.peekNext(now+500),next);assert.notEqual(next,previous);first.push(p.tick(now));previous=p.index }
  assert.equal(new Set(first).size,7)
  for(let round=0;round<8;round++) {
    const cycle=[]
    for(let i=0;i<7;i++){now+=slides[p.index].durationMs;const index=p.tick(now);assert.notEqual(index,previous);cycle.push(index);previous=index}
    assert.equal(new Set(cycle).size,7)
  }
  assert.deepEqual(slides.map(s=>s.path),Array.from({length:7},(_,i)=>'image'+i))
})
test('random bookmarks resume remaining time and queue, do not advance unready pictures, reject stale library keys', () => {
  const slides=[{path:'a',durationMs:1000},{path:'b',durationMs:2000},{path:'c',durationMs:3000}]
  const p=new CarouselPlayback(slides,0,undefined,true,()=>0)
  const before=p.index, next=p.peekNext(10000), saved=p.bookmark(10000)
  assert.equal(p.index,before);assert.equal(saved.path,slides[before].path);assert.equal(saved.remainingMs,1)
  const q=new CarouselPlayback(slides,40000,saved,true,()=>.9)
  assert.equal(q.tick(40000),before);assert.equal(q.tick(40001),next)
  const reduced=new CarouselPlayback([slides[0]],0,saved,true,()=>0)
  assert.equal(reduced.tick(1e8),0)
  const stale=new CarouselPlayback(slides.slice(0,2),0,{path:'a',remainingMs:100,random:true,remainingPaths:['removed']},true,()=>0)
  assert.equal(stale.tick(100),1)
  assert.equal(new CarouselPlayback([],0,undefined,true).peekNext(1000),0)
})
test('random selection normalizes truth values and never changes enablement or durations',()=>{
  assert.equal(carouselTiming({randomPlayback:true}).randomPlayback,true)
  assert.equal(carouselTiming({randomPlayback:'true' as any}).randomPlayback,false)
  const input={images:['custom'],disabled:['custom'],randomPlayback:true,intervalSeconds:3,durations:{custom:8}}
  assert(!activeCarouselKeys(input).includes('custom'));assert.equal(carouselTiming(input).durations.custom,8)
})
test('favorite icons preserve identity and time during linking, reject local and credential URLs',()=>{
  assert.equal(favoriteIconUrl('https://cdn.modrinth.com/data/example/icon.png'),'https://cdn.modrinth.com/data/example/icon.png')
  for(const url of ['file:///C:/accounts.json','data:image/png;base64,a','http://site/icon','https://user:secret@site/icon','javascript:alert(1)'])assert.equal(favoriteIconUrl(url),undefined)
  const records=[{key:'sha1:'+'a'.repeat(40),name:'Local',sha1:'a'.repeat(40),added:12}]
  const linked=linkFavoriteRecords(records,records[0].key,{source:'modrinth',projectId:'api',name:'Fabric API',iconUrl:'https://cdn.modrinth.com/icon.png'})
  assert.equal(linked[0].iconUrl,'https://cdn.modrinth.com/icon.png');assert.equal(linked[0].added,12);assert.equal(linked[0].sha1,records[0].sha1)
})
test('actual preview model can return from a swinging pose to neutral then resume opposite limbs',()=>{
  const p=new PreviewPlayer();p.pose(.3,1,0);assert.notEqual(p.skin.leftArm.rotation.x,0)
  p.pose(.3,0,0);assert.equal(Math.abs(p.skin.leftArm.rotation.x),0);assert.equal(Math.abs(p.skin.leftLeg.rotation.x),0)
  p.pose(.6,1,0);assert.notEqual(p.skin.leftArm.rotation.x,0);assert.equal(p.skin.leftArm.rotation.x,-p.skin.rightArm.rotation.x);p.dispose()
})
