import test from 'node:test'
import assert from 'node:assert/strict'
import { ObservedPreparation } from '../src/main/core/observedPreparation'
import { ParallelProgress } from '../src/main/core/parallelProgress'
import type { ProgressEvent } from '../src/shared/types'

test('Concurrent Java preparations forward current and subsequent progress to both installer callers without duplicate writes', async () => {
  const shared = new ObservedPreparation<string, string>(), first: string[] = [], second: string[] = []
  const start = Promise.withResolvers<void>(), done = Promise.withResolvers<string>()
  let writes = 0, publish!: (s: string) => void
  const one = shared.run('folder:jre17', e => first.push(e), async emit => { writes++; publish = emit; emit('checking Java'); start.resolve(); return done.promise })
  await start.promise
  const two = shared.run('folder:jre17', e => second.push(e), async () => { throw Error('duplicate writer') })
  assert.deepEqual(second, ['checking Java'])
  publish('verified; extracting Java'); done.resolve('verified/bin/java')
  assert.deepEqual(await Promise.all([one,two]), ['verified/bin/java','verified/bin/java'])
  assert.equal(writes,1); assert.deepEqual(first,second)
  assert.equal(await shared.run('folder:jre17', () => {}, async emit => { emit('new inspection'); return 'new path' }), 'new path')
})

test('Failed shared preparation does not cache failure and disconnected observers cannot break a live installer', async () => {
  const shared = new ObservedPreparation<string, string>()
  await assert.rejects(shared.run('jre', () => { throw Error('UI disconnected') }, async emit => { emit('checking'); throw Error('download hash mismatch') }), /hash mismatch/)
  assert.equal(await shared.run('jre', () => {}, async emit => { emit('retry'); return 'ok' }), 'ok')
})

test('Runtime generation names its waiting prerequisites and becomes running for Java instead of remaining at generic waiting', () => {
  const events: ProgressEvent[] = []
  const outer = new ParallelProgress([{id:'runtime',label:'运行环境',weight:1}], e => events.push(e), 'pack', [0,.9])
  const progress = new ParallelProgress([{id:'vanilla',label:'原版',weight:3},{id:'installer',label:'加载器',weight:1},{id:'processor',label:'生成运行文件',weight:1}], e => outer.update('runtime',e), 'prepare', [0,1])
  progress.waiting('processor','等待游戏本体、依赖库和加载器准备完成…')
  const lane = () => events.at(-1)!.parallelStages!.find(x => x.id.endsWith('/processor'))!
  assert.equal(lane().state,'waiting'); assert.match(lane().text,/游戏本体/)
  progress.done('vanilla'); progress.done('installer')
  progress.update('processor',{stage:'java',progress:0,indeterminate:true,text:'正在检查加载器所需的 Java 环境…'})
  assert.equal(lane().state,'running'); assert.equal(lane().indeterminate,true); assert.match(lane().text,/Java/)
  assert(events.at(-1)!.overall! < .9,'Java readiness cannot finish the pack')
  progress.update('processor',{stage:'loader-process',progress:0,indeterminate:true,text:'正在生成运行文件…'})
  assert.match(lane().text,/正在生成运行文件/,'Nested Java-to-installer phase changes must reach the actual outer pack event immediately')
  progress.done('processor')
  assert.equal(lane().state,'done');assert.equal(lane().progress,1)
})
