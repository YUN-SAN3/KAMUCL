import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { runParallelTasks } from '../src/main/core/parallelTasks'
import { ParallelProgress } from '../src/main/core/parallelProgress'
import { prepareModpackFiles } from '../src/main/core/modpackDownloads'
import { registerTask, pauseTask, resumeTask, finishTask, waitIfTaskPaused } from '../src/main/core/tasks'
import { versionInstallHarness } from './helpers/version-install-harness'
import type { ProgressEvent } from '../src/shared/types'

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const sha1 = (b: Buffer) => crypto.createHash('sha1').update(b).digest('hex')

test('并行组失败时取消同组任务，并等待迟到的写入结束才交给调用者回滚', async () => {
  let drained = false
  const started = Promise.withResolvers<void>()
  await assert.rejects(runParallelTasks([
    async () => { await started.promise; throw new Error('original failure') },
    async signal => {
      started.resolve()
      await new Promise<void>(r => signal.addEventListener('abort', () => r(), { once: true }))
      await delay(30)
      drained = true
    }
  ]), /original failure/)
  assert(drained)
})

test('嵌套并行组继承任务暂停和取消，不在暂停期间启动新的写入', async () => {
  const rec = registerTask('parallel fixture', 'modpack')
  let writes = 0
  try {
    pauseTask(rec.id)
    const work = runParallelTasks([signal => runParallelTasks([
      async child => { await waitIfTaskPaused(child); writes++ }
    ], signal)], rec.controller.signal)
    await delay(20); assert.equal(writes, 0)
    resumeTask(rec.id); await work; assert.equal(writes, 1)
    rec.controller.abort()
    await assert.rejects(runParallelTasks([async () => { writes++ }], rec.controller.signal))
    assert.equal(writes, 1)
  } finally { finishTask(rec.id) }
})

test('并行进度按各阶段权重累积，不因一个阶段完成提前达到 100% 或重复统计速度', () => {
  const events: ProgressEvent[] = []
  const lanes = new ParallelProgress([{ id:'a',label:'A',weight:1 },{ id:'b',label:'B',weight:1 }], e=>events.push(e), 'parallel', [0.04,0.95])
  lanes.update('a', {stage:'download',text:'A',progress:1,speed:100,etaSeconds:2})
  lanes.done('a')
  assert(Math.abs(events.at(-1)!.overall! - 0.495) < 1e-9)
  assert.equal(events.at(-1)!.speed, undefined)
  lanes.update('b', {stage:'download',text:'B',progress:0.5,speed:200,parallelStages:[{id:'child',label:'child',text:'child',progress:0.5,state:'running',speed:200}]})
  assert.equal(events.at(-1)!.speed,200)
  assert.equal(events.at(-1)!.etaSeconds,undefined)
  assert.equal(events.at(-1)!.parallelStages![1].id,'b/child')
  lanes.done('b'); assert.equal(events.at(-1)!.overall,0.95)
})

test('预取无哈希文件只写独立暂存目录，明确提交后才写实例，清理不碰实例', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-prefetch-'))
  const body=Buffer.from('mod fixture'),dest=path.join(root,'instance','mods','a.jar'),cache=path.join(root,'cache')
  const server=http.createServer((_req,res)=>res.end(body))
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
  try {
    const prepared=await prepareModpackFiles([{url:`http://127.0.0.1:${(server.address() as any).port}/mod`,dest}],()=>{},'official',undefined,cache)
    assert(!fs.existsSync(dest)); assert(fs.readdirSync(cache).some(name=>name.startsWith('pending-')))
    await prepared.install(); await prepared.dispose()
    assert.deepEqual(fs.readFileSync(dest),body); assert.deepEqual(fs.readdirSync(cache),[])
    await assert.rejects(prepareModpackFiles([{url:'https://unused.invalid',dest}],()=>{throw new Error('fixture failure')},'official',undefined,cache),/fixture failure/)
    assert.deepEqual(fs.readdirSync(cache),[])
  } finally { server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r())); fs.rmSync(root,{recursive:true,force:true}) }
})

for (const outcome of ['success', 'failure', 'cancel'] as const) test(`真实四阶段并行整合包：${outcome}；成功后提交，失败取消后无迟到写入`, {timeout:15000}, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-parallel-pack-')),game=path.join(root,'game'),id='并行导入'
  fs.mkdirSync(game)
  const bodies=Object.fromEntries(['lib','client','asset','mod'].map(name=>[name,Buffer.from('fixture-'+name)]))
  const index=Buffer.from(JSON.stringify({objects:{sound:{hash:sha1(bodies.asset),size:bodies.asset.length}}}))
  const held=new Map<string,http.ServerResponse>(),seen=new Set<string>()
  let runtime: Awaited<ReturnType<typeof versionInstallHarness>> | undefined
  let base='', maxActive=0
  const version=()=>({id:'1.20.1',mainClass:'fixture.Main',libraries:[{name:'test:library:1',downloads:{artifact:{path:'test/library.jar',url:base+'/lib',sha1:sha1(bodies.lib),size:bodies.lib.length}}}],downloads:{client:{url:base+'/client',sha1:sha1(bodies.client),size:bodies.client.length}},assetIndex:{id:'fixture',url:base+'/index',sha1:sha1(index),size:index.length}})
  const server=http.createServer((req,res)=>{
    const name=req.url!.slice(1)
    if(name==='version'){res.end(JSON.stringify(version()));return}
    if(name==='index'){res.end(index);return}
    assert(bodies[name],name)
    seen.add(name); held.set(name,res); maxActive=Math.max(maxActive,held.size)
    // None can finish until ALL FOUR independent branches have reached the network.
    if(seen.size===4) {
      assert(!fs.existsSync(path.join(game,'versions',id,'mods/a.jar')))
      for(const [key,response] of held) {
        if(outcome==='success') response.end(bodies[key])
        else if(outcome==='failure'&&key==='mod') {response.statusCode=404;response.end('fixture missing')}
        else {response.writeHead(200,{'content-length':bodies[key].length});response.write(bodies[key].subarray(0,2))}
      }
      if(outcome==='cancel') controller.abort()
      held.clear()
    }
  })
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r)); base=`http://127.0.0.1:${(server.address() as any).port}`
  const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),7000)
  try {
    runtime=await versionInstallHarness(root,async()=>Response.json({versions:[{id:'1.20.1',type:'release',url:base+'/version',releaseTime:'2023-01-01'}]}),url=>url.includes('resources.download.minecraft.net')?base+'/asset':url.replace('https://pack-test.invalid',base))
    Object.assign(runtime.getSettings(),{gameDir:game,activeFolder:game,folders:[{path:game,name:'fixture',isDefault:true}],defaultIsolation:true,mirror:'official'})
    const pack=new AdmZip();pack.addFile('modrinth.index.json',Buffer.from(JSON.stringify({formatVersion:1,game:'minecraft',name:id,versionId:'1',dependencies:{minecraft:'1.20.1'},files:[{path:'mods/a.jar',hashes:{sha1:sha1(bodies.mod)},downloads:['https://pack-test.invalid/mod'],fileSize:bodies.mod.length}]})))
    pack.addFile('overrides/options.txt',Buffer.from('fixture'))
    const file=path.join(root,'pack.mrpack');pack.writeZip(file)
    const events: ProgressEvent[]=[]
    const install=runtime.installModpack(file,e=>events.push(e),{instanceName:id,targetFolder:game,signal:controller.signal})
    if(outcome!=='success') {
      await assert.rejects(install,outcome==='failure'?/404/:/取消|abort/i)
      assert.equal(seen.size,4)
      assert(!fs.existsSync(path.join(game,'versions',id)))
      await delay(100)
      assert(!fs.existsSync(path.join(game,'versions',id)),'回滚后不能再产生文件')
      assert(!events.some(e=>e.stage==='done'))
      return
    }
    await install
    assert.equal(maxActive,4)
    assert.equal(seen.size,4)
    assert(events.some(e=>e.parallelStages?.length===4))
    assert(events.slice(0,-1).every(e=>(e.overall??e.progress)<1))
    assert.equal(events.at(-1)!.stage,'done')
    assert.equal(events.at(-1)!.parallelStages,undefined)
    assert.deepEqual(fs.readFileSync(path.join(game,'versions',id,'mods/a.jar')),bodies.mod)
    assert.deepEqual(fs.readFileSync(path.join(game,'versions',id,`${id}.jar`)),bodies.client)
  } finally { clearTimeout(timeout);controller.abort();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await runtime?.closeHttpClient();fs.rmSync(root,{recursive:true,force:true}) }
})
