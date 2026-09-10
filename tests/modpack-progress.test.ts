import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { versionInstallHarness } from './helpers/version-install-harness'
import { ProgressEventGuard } from '../src/main/core/progress'
import { taskProgressPercent } from '../src/shared/taskProgress'
import type { ProgressEvent, CommunityFile } from '../src/shared/types'

const sha1 = (bytes: Buffer) => crypto.createHash('sha1').update(bytes).digest('hex')

test('社区 mrpack 从压缩包下载到模组及覆盖文件落盘，总进度不提前锁在 100%', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-pack-progress-'))
  const game = path.join(root, 'game')
  const id = 'Progress Pack'
  const data = Buffer.alloc(128 * 1024, 'm')
  const pack = new AdmZip()
  pack.addFile('modrinth.index.json', Buffer.from(JSON.stringify({
    formatVersion: 1, game: 'minecraft', name: id, versionId: '1',
    dependencies: { minecraft: '26.2', 'fabric-loader': 'fixture' },
    files: Array.from({ length: 4 }, (_, i) => ({ path: `mods/mod-${i}.jar`, hashes: { sha1: sha1(data) },
      downloads: [`https://pack-test.invalid/mod-${i}.jar`], fileSize: data.length }))
  })))
  pack.addFile('overrides/config/test.txt', Buffer.from('config proof'))
  const archive = pack.toBuffer()
  let downloads = 0, completed = false
  const events: ProgressEvent[] = []
  const guard = new ProgressEventGuard()
  const server = http.createServer((req, res) => {
    const body = req.url === '/pack.mrpack' ? archive : data
    if (req.url !== '/pack.mrpack') downloads++
    res.writeHead(200, { 'content-length': body.length })
    res.write(body.subarray(0, body.length / 2))
    setTimeout(() => res.end(body.subarray(body.length / 2)), req.url === '/pack.mrpack' ? 10 : 180)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  const runtime = await versionInstallHarness(root, async input => {
    assert(String(input).includes('/profile/json'))
    return Response.json({ id: 'loader-fixture', inheritsFrom: '26.2', mainClass: 'fixture.Main', libraries: [] })
  }, url => url.replace('https://pack-test.invalid', base))
  const emit = (event: ProgressEvent) => {
    const normalized = guard.normalize(event)
    events.push(normalized)
    if (event.stage === 'done') {
      assert.equal(downloads, 4)
      assert.equal(fs.readFileSync(path.join(game, 'versions', id, 'config/test.txt'), 'utf8'), 'config proof')
    } else {
      assert(normalized.overall! < 1, `${event.stage}: prematurely reached 100%`)
    }
  }
  try {
    Object.assign(runtime.getSettings(), { gameDir: game, activeFolder: game, folders: [{ path: game, name: 'test', isDefault: true }], defaultIsolation: true, mirror: 'official' })
    const baseDir = path.join(game, '.kamucl/base/26.2')
    fs.mkdirSync(baseDir, { recursive: true })
    fs.writeFileSync(path.join(baseDir, '26.2.json'), JSON.stringify({ id: '26.2', libraries: [] }))
    fs.writeFileSync(path.join(baseDir, '26.2.jar'), 'test runtime')
    const done = Promise.withResolvers<{ ok: boolean; error?: string; versionId: string }>()
    const file = { source: 'modrinth', fileName: 'pack.mrpack', url: `${base}/pack.mrpack`, sha1: sha1(archive) } as CommunityFile
    await runtime.communityDownload(file, { kind: 'modpack', versionId: '' }, emit, value => { completed = true; done.resolve(value) })
    assert.equal(completed, false, 'archive completion must not finish the task')
    const outcome = await done.promise
    assert.equal(outcome.ok, true, outcome.error)
    assert.equal(outcome.versionId, id)
    assert.equal(events.filter(e => e.stage === 'done').length, 1)
    assert.equal(events.at(-1)?.overall, 1)
    const archiveEvents = events.filter(e => e.stage === 'download')
    assert.equal(archiveEvents.at(-1)?.overall, 0.1)
    const fileEvents = events.filter(e => e.text.startsWith('下载整合包文件'))
    assert(fileEvents.length >= 2)
    assert(fileEvents.at(-1)!.overall! > fileEvents[0].overall!)
    assert(fileEvents.every(e => e.overall! >= 0.568 && e.overall! <= 0.956))
    events.forEach((event, index) => { if (index) assert(event.overall! >= events[index - 1].overall!) })
    for (let i = 0; i < 4; i++) assert.equal(sha1(fs.readFileSync(path.join(game, 'versions', id, `mods/mod-${i}.jar`))), sha1(data))

    // 本地导入没有压缩包下载阶段，应仍覆盖完整的 0..1 总进度。
    const localPack = path.join(root, 'local.mrpack')
    fs.writeFileSync(localPack, archive)
    const localEvents: ProgressEvent[] = []
    await runtime.installModpack(localPack, event => localEvents.push(event), { instanceName: 'Local Pack' })
    assert.equal(localEvents[0].overall, 0)
    assert.equal(localEvents.at(-1)?.overall, 1)
    assert.equal(localEvents.filter(e => e.stage === 'done').length, 1)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await runtime.closeHttpClient()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('下载中心百分比在任务成功前不四舍五入成 100%，暂停失败同样保留未完成状态', () => {
  for (const status of ['running', 'paused', 'cancelling', 'cancelled', 'error']) {
    assert.equal(taskProgressPercent({ status, progress: 0.999 }), 99)
    assert.equal(taskProgressPercent({ status, progress: 1 }), 99)
    assert.equal(taskProgressPercent({ status, progress: NaN }), 0)
    assert.equal(taskProgressPercent({ status, progress: 0.183 }), 18)
  }
  assert.equal(taskProgressPercent({ status: 'done', progress: 1 }), 100)
})
