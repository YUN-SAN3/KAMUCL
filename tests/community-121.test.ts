import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { createCommunityDownloadQueue, type CommunityDownloadPort } from '../src/renderer/src/communityDownloadQueue'
import { dependencyRange, matchesVersionRange, compareVersions, modMatchesInstance } from '../src/shared/modCompatibility'
import { prepareModInstall, executeModPlan, discardModPlan } from '../src/main/core/modInstallPlan'
import { parseModFile } from '../src/main/core/modinfo'
import type { CommunityFile, InstalledVersion, ModInstallPlan } from '../src/shared/types'

const target: InstalledVersion = { id:'same-name', folder:'C:\\games\\one', mcVersion:'1.21.1', loader:'fabric', loaderVersion:'0.19.5' }
const file = (id = 'mod'): CommunityFile => ({ source:'modrinth', projectId:id, fileId:id+'-version', fileName:id+'.jar', version:'1.0', url:'https://fixture.invalid/'+id, sha1:'0'.repeat(40), size:10, gameVersions:['1.21.1'], loaders:['fabric'], releaseType:'release', date:'' })
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
function queueFixture(overrides: Partial<CommunityDownloadPort> = {}) {
  const calls: Array<{ action:string; args:any[] }> = [], changed:string[] = []
  let ids = 0
  const port: CommunityDownloadPort = {
    uuid: () => 'operation-'+(++ids),
    prepare: async (...args) => { calls.push({ action:'prepare', args }); return { id:'plan-'+args[1].file.fileId, target:{...target,folder:args[0].folder}, files:[{name:'root',fileName:'root.jar',version:'1.0',dependency:false}], missing:[], warnings:[] } },
    commit: async (...args) => { calls.push({ action:'commit', args }); return 'installed' },
    discard: async (...args) => { calls.push({ action:'discard', args }) },
    download: async (...args) => { calls.push({ action:'download', args }); return 'saved' },
    cancel: async (...args) => { calls.push({ action:'cancel', args }) },
    changed: item => changed.push(item.id+':'+item.state), ...overrides
  }
  return { queue:createCommunityDownloadQueue(port), calls, changed }
}

test('121 queue snapshots the accepted instance and file, deduplicates active Windows aliases, and frees preparation before confirmation', async () => {
  const prepare = Promise.withResolvers<ModInstallPlan>(), h = queueFixture({ prepare: async (...args) => { h.calls.push({action:'prepare',args}); return prepare.promise } })
  const selected = {...target}, selectedFile = file(), first = h.queue.enqueue({file:selectedFile,kind:'mod',target:selected,folder:selected.folder!})
  selected.folder = 'C:\\games\\changed'; selected.mcVersion = '26.2'; selectedFile.fileName = 'changed.jar'; selectedFile.dependencies = [{required:true,projectId:'changed'}]
  assert.equal(first.item.file.fileName,'mod.jar'); assert.equal(first.item.target!.mcVersion,'1.21.1'); assert.equal(first.item.folder,target.folder)
  assert.equal(h.queue.enqueue({file:file(),kind:'mod',target,folder:'c:/GAMES/one/'}).added,false)
  const next = h.queue.enqueue({file:file('resource'),kind:'resourcepack',target,folder:target.folder!})
  assert.equal(next.item.state,'queued'); assert.equal(h.calls.length,1)
  prepare.resolve({id:'accepted-plan',target,files:[],missing:[],warnings:[]}); await tick()
  assert.equal(first.item.state,'confirmation'); assert.equal(next.item.state,'completed'); assert(!h.calls.some(call=>call.action==='commit'))
  assert(h.queue.confirm(first.item.id)); await tick(); assert.equal(first.item.state,'completed')
  assert.deepEqual(h.calls.find(call=>call.action==='prepare')!.args[0],{id:target.id,folder:target.folder})
  assert(h.queue.enqueue({file:file(),kind:'mod',target:{...target,folder:'C:\\games\\two'},folder:'C:\\games\\two'}).added)
})

test('121 queue ignores unrelated progress, consumes the confirmed plan once, and retries with a new verified plan after failure', async () => {
  let attempts = 0
  const h = queueFixture({commit:async (...args)=>{h.calls.push({action:'commit',args}); if (++attempts===1) throw new Error('网络中断'); return 'installed'}})
  const {item} = h.queue.enqueue({file:file(),kind:'mod',target,folder:target.folder!}); await tick()
  h.queue.progress({stage:'download',progress:.5,text:'other file',operationId:'unrelated',taskId:'foreign'})
  assert.equal(item.progress,undefined)
  assert(h.queue.confirm(item.id)); assert(!h.queue.confirm(item.id)); const firstOperation = item.operationId
  h.queue.progress({stage:'download',progress:.5,text:'own',operationId:firstOperation,taskId:'own'})
  await tick(); assert.equal(item.state,'failed'); assert.equal(item.plan,undefined)
  assert(h.queue.retry(item.id)); await tick(); assert.equal(item.state,'confirmation')
  h.queue.progress({stage:'done',progress:1,text:'stale old commit',operationId:firstOperation,taskId:'own'})
  assert.equal(item.progress,undefined); assert(h.queue.confirm(item.id)); await tick(); assert.equal(item.state,'completed')
  assert.equal(h.calls.filter(call=>call.action==='prepare').length,2); assert.equal(h.calls.filter(call=>call.action==='commit').length,2)
})

test('121 cancellation before the first progress waits for cleanup and never turns the returned plan into an install', async () => {
  const prepare = Promise.withResolvers<ModInstallPlan>(), h = queueFixture({prepare:async()=>prepare.promise})
  const {item} = h.queue.enqueue({file:file(),kind:'mod',target,folder:target.folder!})
  await h.queue.cancel(item.id)
  assert.equal(item.cancelRequested,true)
  h.queue.progress({stage:'download',progress:0,text:'started',operationId:item.operationId,taskId:'owned'})
  assert.equal(h.calls.find(call=>call.action==='cancel')!.args[0],'owned')
  prepare.resolve({id:'cancelled-plan',target,files:[],missing:[],warnings:[]}); await tick()
  assert.equal(item.state,'cancelled'); assert(h.calls.some(call=>call.action==='discard'&&call.args[0]==='cancelled-plan'))
  assert(!h.queue.confirm(item.id)); assert(!h.calls.some(call=>call.action==='commit'))
})

test('121 pack transfer acknowledgment is not installation success; completion is tied to its own task, including early callbacks', async () => {
  const transfer = Promise.withResolvers<string>(), h = queueFixture({download:async()=>transfer.promise})
  const {item} = h.queue.enqueue({file:file('pack'),kind:'modpack',folder:target.folder!})
  h.queue.progress({stage:'download',progress:.1,text:'pack',operationId:item.operationId,taskId:'pack-task'})
  transfer.resolve('整合包已开始安装'); await tick(); assert.equal(item.state,'installing-pack')
  h.queue.done({taskId:'unrelated',ok:true}); assert.equal(item.state,'installing-pack')
  h.queue.done({taskId:'pack-task',ok:false,error:'存档解析失败'}); assert.equal(item.state,'failed')
  assert(h.queue.retry(item.id)); h.queue.progress({stage:'download',progress:0,text:'retry',operationId:item.operationId,taskId:'retry-pack'})
  h.queue.done({taskId:'retry-pack',ok:true}); await tick(); assert.equal(item.state,'completed')
  assert(h.changed.includes(item.id+':completed'))
})

test('121 unresolved dependencies forbid commit, pending plans stay bounded, and resources still download', async () => {
  const h = queueFixture({prepare:async(_ref,input)=>({id:input.file.fileId,target,files:[],missing:['missing *'],warnings:['缺前置']})})
  for(let i=0;i<7;i++) h.queue.enqueue({file:file('root'+i),kind:'mod',target,folder:target.folder!})
  const resource = h.queue.enqueue({file:file('texture'),kind:'resourcepack',target,folder:target.folder!}).item
  await tick(); assert.equal(h.queue.items.filter(item=>item.state==='confirmation').length,4)
  assert.equal(resource.state,'completed'); assert(!h.queue.confirm(h.queue.items[0].id)); assert(!h.calls.some(call=>call.action==='commit'))
  await h.queue.cancel(h.queue.items[0].id); await tick(); assert.equal(h.queue.items.filter(item=>item.state==='confirmation').length,4)
})

test('121 cancelling a plan during recheck cleanup cannot revive it or start a second preparation', async () => {
  const cleanup = Promise.withResolvers<void>(), h = queueFixture({discard:async()=>cleanup.promise})
  const {item} = h.queue.enqueue({file:file(),kind:'mod',target,folder:target.folder!}); await tick()
  const rechecking = h.queue.recheck(item.id)
  await h.queue.cancel(item.id); cleanup.resolve(); await rechecking; await tick()
  assert.equal(item.state,'cancelled'); assert.equal(h.calls.filter(call=>call.action==='prepare').length,1)
})

test('121 Fabric metadata uses its own caret/tilde/wildcard and empty prerelease semantics; other dialects remain unchanged', () => {
  const caret = dependencyRange('^0.15.2')
  assert(matchesVersionRange(caret,'0.16.0')); assert(matchesVersionRange(caret,'0.19.5')); assert(!matchesVersionRange(caret,'0.15.1')); assert(!matchesVersionRange(caret,'1.0.0-alpha'))
  assert(!matchesVersionRange('^0.15.2','0.16.0'),'generic ranges retain the established semver contract')
  assert(matchesVersionRange('>=1.21.1- <1.21.2-','1.21.1')); assert(!matchesVersionRange('>=1.21.1- <1.21.2-','1.21.2-pre1'))
  // Live official Fabric API 0.102.0+1.21, Modrinth version oGwyXeEI:
  // https://api.modrinth.com/v2/version/oGwyXeEI ; actual JAR fabric.mod.json.
  assert(matchesVersionRange('>=1.21- <1.21.1-','1.21')); assert(!matchesVersionRange('>=1.21- <1.21.1-','1.21.1'))
  assert(compareVersions('1.21.1-','1.21.1-alpha')<0); assert(compareVersions('1.21.1-alpha','1.21.1')<0)
  assert(matchesVersionRange(dependencyRange('1.21.x'),'1.21-pre1')); assert(!matchesVersionRange(dependencyRange('~1.21.1'),'1.22-alpha'))
  assert(!matchesVersionRange(dependencyRange('^0.15.2','quilt'),'0.16.0'))
  assert(!matchesVersionRange(dependencyRange('malformed []'),'1.21.1'))
})

test('121 corrected Fabric JAR installs through exact lookup, real SHA1 transfer, existing prerequisite reuse, and frozen transaction target', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-community121-'))
  const accepted: InstalledVersion = {...target,folder:root,gameDirectory:path.join(root,'first','same-name'),isolated:true}
  const other = path.join(root,'second','same-name'), jar = (id:string, version:string, depends:any) => {
    const zip = new AdmZip(); zip.addFile('fabric.mod.json',Buffer.from(JSON.stringify({schemaVersion:1,id,name:id,version,depends}))); return zip.toBuffer()
  }
  const bytes = jar('root','1.0.0',{minecraft:'>=1.21.1- <1.21.2-',fabricloader:'^0.15.2',library:'^0.3.0'})
  const mods = path.join(accepted.gameDirectory!,'mods'); fs.mkdirSync(mods,{recursive:true})
  fs.writeFileSync(path.join(mods,'library.jar'),jar('library','0.9.0',{minecraft:'1.21.x',fabricloader:'>=0.15'}))
  let requests = 0
  const server = http.createServer((_request,response)=>{requests++; response.writeHead(200,{'content-length':bytes.length}); response.end(bytes)})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(async()=>{server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); fs.rmSync(root,{recursive:true,force:true})})
  const source: CommunityFile = {...file(),url:`http://127.0.0.1:${(server.address() as any).port}/root.jar`,sha1:crypto.createHash('sha1').update(bytes).digest('hex'),size:bytes.length}
  const repo = {exact:async()=>source,files:async()=>[],find:async()=>{throw new Error('已有合法前置不应再查询')}}
  const plan = await prepareModInstall(accepted,{file:source},()=>{},undefined,repo)
  assert.equal(plan.warnings.length,0); assert.equal(plan.missing.length,0); assert.equal(plan.files.length,1)
  await executeModPlan(plan.id,true,ref=>{assert.equal(ref.folder,root);assert.equal(ref.gameDirectory,accepted.gameDirectory);return accepted},()=>{})
  assert.equal(requests,1); assert(modMatchesInstance(parseModFile(path.join(mods,'mod.jar')),accepted)); assert(!fs.existsSync(other))
  // Truly incompatible loaders/MC versions and wrong repository hashes still fail without writes.
  const incompatible = path.join(root,'incompatible.jar'); fs.writeFileSync(incompatible,jar('wrong','1.0',{minecraft:'>=1.22-',fabricloader:'>=0.15'}))
  await assert.rejects(prepareModInstall(accepted,{paths:[incompatible]},()=>{},undefined,repo),/Minecraft 1\.21\.1 不满足/)
  await assert.rejects(prepareModInstall({...accepted,loader:'forge',loaderVersion:'47.4'}, {paths:[path.join(mods,'mod.jar')]},()=>{},undefined,repo),/需要 fabric/)
  await assert.rejects(prepareModInstall(accepted,{file:source},()=>{},undefined,{...repo,exact:async()=>({...source,sha1:'f'.repeat(40)})}),/校验|hash|SHA|完整性/i)
  const moved = await prepareModInstall(accepted,{file:source},()=>{},undefined,repo)
  await assert.rejects(executeModPlan(moved.id,true,()=>({...accepted,gameDirectory:other}),()=>{}),/隔离目录已变更/)
  assert(!fs.existsSync(other)); discardModPlan(moved.id)
})
