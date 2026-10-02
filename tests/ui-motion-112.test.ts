import test from 'node:test'
import assert from 'node:assert/strict'
import { createCatalogSession } from '../src/shared/catalogSession'
import { THEME_PRESETS, normalizeThemeName } from '../src/shared/types'
test('catalog session deduplicates re-entry and preserves real results on refresh failure', async () => {
 let calls=0, clock=100, fail=false, release!:()=>void
 const barrier=new Promise<void>(r=>release=r)
 const result={versions:[],checkedAt:100,stale:false}
 const cache=createCatalogSession(async()=>{calls++;await barrier;if(fail)throw Error('offline');return result},()=>clock)
 const a=cache.load(), b=cache.load(true);assert.equal(a,b);assert.equal(calls,1);release();await a
 assert.equal(cache.peek(),result);await cache.load();assert.equal(calls,1)
 clock+=300001;await cache.load();assert.equal(calls,2)
 fail=true;await assert.rejects(cache.load(true),/offline/);assert.equal(cache.peek(),result)
 fail=false;await cache.load(true);assert.equal(calls,4)
})
test('default theme migrates the existing key to black purple, other presets stay separate',()=>{
 assert.equal(normalizeThemeName('transparent'),'transparent')
 assert.equal(THEME_PRESETS.transparent.label,'默认·黑紫')
 assert.equal(THEME_PRESETS.transparent.colors.accent,'#9475ed')
 assert.equal(THEME_PRESETS['blue-white'].colors.accent,'#2563eb')
})
