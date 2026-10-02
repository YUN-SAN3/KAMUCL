import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fetchVersionCatalog, mergeVersionCatalogs, parseVersionCatalog, VERSION_SOURCES } from '../src/main/core/versionCatalog'
import { formatReleaseTime } from '../src/shared/releaseTime'
import type { RemoteVersion } from '../src/shared/types'
const version = (id: string, releaseTime: string, type: RemoteVersion['type'] = 'release'): RemoteVersion => ({id,type,releaseTime,url:`https://piston-meta.mojang.com/${id}.json`})
const old = version('26.2','2026-06-16T11:00:00Z'), latest = version('26.3','2026-09-15T11:23:02Z')
async function fixture(run: (file:string)=>Promise<void>) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'catalog-1081-'));try{await run(path.join(dir,'manifest.json'))}finally{fs.rmSync(dir,{recursive:true,force:true})} }

test('清单：镜像先返回旧版本时仍纳入官方新正式版，重复 ID 使用官方信息并按发布时间排序',()=>fixture(async file=>{
  const fetched:string[]=[]
  const fetcher = (async url => {fetched.push(String(url));if(String(url)===VERSION_SOURCES[0]){await new Promise(r=>setTimeout(r,20));return Response.json({versions:[old,latest]})}return Response.json({versions:[{...old,url:'https://mirror.invalid/old.json'}]})}) as typeof fetch
  const result=await fetchVersionCatalog(file,true,undefined,fetcher)
  assert.deepEqual(result.versions,[latest,old]);assert.equal(result.stale,false);assert.equal(fetched.length,2)
}))
test('清单：旧一小时缓存立即升级，新缓存五分钟过期且强制刷新绕过缓存',()=>fixture(async file=>{
  const now=Date.now();fs.writeFileSync(file,JSON.stringify({fetchedAt:now,versions:[old]}));let requests=0
  const fetcher=(async()=>{requests++;return Response.json({versions:[latest,old]})}) as typeof fetch
  assert.equal((await fetchVersionCatalog(file,false,undefined,fetcher,now)).versions[0].id,'26.3');assert.equal(requests,2)
  await fetchVersionCatalog(file,false,undefined,fetcher,now+60_000);assert.equal(requests,2)
  await fetchVersionCatalog(file,true,undefined,fetcher,now+60_001);assert.equal(requests,4)
  await fetchVersionCatalog(file,false,undefined,fetcher,now+6*60_000+1);assert.equal(requests,6)
}))
test('清单：官方离线时镜像与已知缓存合并，不丢失已发现的新版本并标记降级',()=>fixture(async file=>{
  fs.writeFileSync(file,JSON.stringify({schema:2,checkedAt:1,versions:[latest,old]}))
  const fetcher=(async url=>{if(String(url)===VERSION_SOURCES[0])throw Error('offline');return Response.json({versions:[old]})}) as typeof fetch
  const result=await fetchVersionCatalog(file,true,undefined,fetcher);assert.equal(result.versions[0].id,'26.3');assert.equal(result.stale,true)
}))
test('清单：两端损坏或离线不污染缓存；无缓存显示可重试错误',()=>fixture(async file=>{
  const fetcher=(async()=>Response.json({versions:[{id:'bad',url:'javascript:bad'}]})) as typeof fetch
  await assert.rejects(fetchVersionCatalog(file,true,undefined,fetcher),/无法获取/)
  const bytes=JSON.stringify({fetchedAt:1,versions:[old]});fs.writeFileSync(file,bytes)
  const result=await fetchVersionCatalog(file,true,undefined,fetcher);assert.equal(result.stale,true);assert.equal(fs.readFileSync(file,'utf8'),bytes)
}))
test('清单：取消不能被缓存回退吞掉',()=>fixture(async file=>{
  fs.writeFileSync(file,JSON.stringify({versions:[old]}));const c=new AbortController()
  const fetcher=(async()=>{c.abort();return Response.json({versions:[latest]})}) as typeof fetch
  await assert.rejects(fetchVersionCatalog(file,true,c.signal,fetcher),{name:'AbortError'})
}))
test('清单：过滤无效记录，保留快照和远古版，发布时间使用本地小时分钟',()=>{
  const snapshot=version('26.3-rc-3','2026-09-14T12:58:38Z','snapshot'),ancient=version('old','2010-01-01T00:00:00Z','old_alpha')
  assert.deepEqual(mergeVersionCatalogs([parseVersionCatalog({versions:[ancient,latest,snapshot,{...old,releaseTime:'bad'}]})]),[latest,snapshot,ancient])
  const d=new Date(latest.releaseTime),pad=(n:number)=>String(n).padStart(2,'0')
  assert.equal(formatReleaseTime(latest.releaseTime),`${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`)
  assert.equal(formatReleaseTime('invalid'),'发布时间未知')
})
