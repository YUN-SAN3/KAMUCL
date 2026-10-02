import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { downloadAll, downloadFile, transferTimeouts, resetHostHealthForTest } from '../src/main/core/download'
import { DownloadSourcePool } from '../src/main/core/downloadSources'
import { downloadLimiter, DEFAULT_DOWNLOAD_LIMITS } from '../src/main/core/downloadLimits'
import { versionInstallHarness } from './helpers/version-install-harness'

const sha = (data: Buffer) => crypto.createHash('sha1').update(data).digest('hex')
async function server(handler: http.RequestListener) {
  const instance = http.createServer(handler)
  await new Promise<void>(r => instance.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${(instance.address() as { port: number }).port}`, close: async () => {
    instance.closeAllConnections(); await new Promise<void>(r => instance.close(() => r()))
  } }
}
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-speed-1096-'))

test('批量下载由实际文件学会选快源；不为每个小文件重复测速、不超出连接上限', async () => {
  const body = Buffer.alloc(8192, 42), root = temporary()
  let slowHits = 0, fastHits = 0, active = 0, peak = 0
  const serve = (slow: boolean): http.RequestListener => (_req, res) => {
    if (slow) slowHits++; else fastHits++
    active++; peak = Math.max(peak, active); res.on('close', () => active--)
    setTimeout(() => res.end(body), slow ? 130 : 5)
  }
  const slow = await server(serve(true)), fast = await server(serve(false))
  downloadLimiter.configure({ downloadThreads: 2, downloadSpeedKBps: 0 })
  try {
    const tasks = Array.from({ length: 40 }, (_, i) => ({ url: slow.url + '/' + i, urls: [fast.url + '/' + i], size: body.length, sha1: sha(body), dest: path.join(root, '' + i) }))
    await downloadAll(tasks, undefined, 2)
    assert(slowHits <= 4, `slow source occupied ${slowHits} useful requests`)
    assert.equal(slowHits + fastHits, tasks.length, 'sampling must not download duplicate data')
    assert(peak <= 2)
    for (const task of tasks) assert.equal(sha(fs.readFileSync(task.dest)), task.sha1)
  } finally { await slow.close(); await fast.close(); downloadLimiter.configure(DEFAULT_DOWNLOAD_LIMITS); fs.rmSync(root, { recursive: true, force: true }) }
})

test('来源学习按批隔离，保留官方单源、错误回退与不同资源分类', () => {
  const urls = ['https://mirror.test/assets/a', 'https://official.test/a']
  const pool = new DownloadSourcePool()
  for (let i = 0; i < 6; i++) {
    const url = pool.order(urls)[0]
    pool.observe(url, url.includes('mirror') ? 600 : 20, 1, 1024)
  }
  assert.equal(pool.order(urls)[0], urls[1])
  pool.fail(urls[1]); assert.equal(pool.order(urls)[0], urls[0])
  assert.equal(new DownloadSourcePool().order(urls)[0], urls[0])
  assert.deepEqual(pool.order([urls[1]]), [urls[1]])
  assert.equal(pool.order(['https://mirror.test/maven/a', urls[1]])[0], 'https://mirror.test/maven/a')
})

test('慢首响应只提前让出有备用源的连接，唯一慢源仍正常完成', async () => {
  const root = temporary(), old = transferTimeouts.alternativeHeadersMs, hits: string[] = []
  const s = await server((req, res) => { hits.push(req.url!); if (req.url === '/stuck') return; setTimeout(() => res.end('ok'), req.url === '/last' ? 180 : 1) })
  transferTimeouts.alternativeHeadersMs = 80
  try {
    await downloadFile(s.url + '/stuck', path.join(root, 'fallback'), undefined, undefined, 'official', AbortSignal.timeout(2000), [s.url + '/fast'])
    await downloadFile(s.url + '/last', path.join(root, 'last'), undefined, undefined, 'official', AbortSignal.timeout(2000))
    assert.deepEqual(hits, ['/stuck', '/fast', '/last'])
    assert.equal(fs.readFileSync(path.join(root, 'last'), 'utf8'), 'ok')
  } finally { transferTimeouts.alternativeHeadersMs = old; resetHostHealthForTest(); await s.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('已知哈希文件跨目录准确复用，损坏缓存回退网络，不复用无哈希文件', async () => {
  const root = temporary(), body = Buffer.from('verified asset'), good = path.join(root, 'good'), bad = path.join(root, 'bad')
  fs.writeFileSync(good, body); fs.writeFileSync(bad, Buffer.alloc(body.length))
  let hits = 0, wire = 0
  const s = await server((_req, res) => { hits++; res.end(body) })
  try {
    await downloadAll([{ url: s.url, dest: path.join(root, 'target'), sha1: sha(body), size: body.length, reuseFiles: [bad, good] }], (_d, _t, speed) => { wire += speed })
    assert.equal(hits, 0); assert.equal(wire, 0, 'cache bytes must not inflate network speed')
    assert.equal(sha(fs.readFileSync(path.join(root, 'target'))), sha(body))
    fs.writeFileSync(path.join(root, 'target'), 'modified copy'); assert.equal(sha(fs.readFileSync(good)), sha(body), 'no mutable hard links')
    await downloadFile(s.url, path.join(root, 'network'), undefined, sha(body), 'official', undefined, [], { size: body.length, reuseFiles: [bad] })
    await downloadFile(s.url, path.join(root, 'unidentified'), undefined, undefined, 'official', undefined, [], { size: body.length, reuseFiles: [good] })
    assert.equal(hits, 2)
  } finally { await s.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('版本安装复用其他已绑定目录的资源索引、资源和依赖，不联网获取已有内容', async () => {
  const root = temporary(), game = path.join(root, 'game'), other = path.join(root, 'other'), asset = Buffer.from('asset'), lib = Buffer.from('library')
  const index = Buffer.from(JSON.stringify({ objects: { a: { hash: sha(asset), size: asset.length } } }))
  for (const [rel, data] of [[`assets/objects/${sha(asset).slice(0, 2)}/${sha(asset)}`, asset], ['assets/indexes/reuse.json', index], ['libraries/test/lib.jar', lib]] as const) {
    const file = path.join(other, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data)
  }
  fs.mkdirSync(path.join(game, 'versions', 'reuse'), { recursive: true })
  fs.writeFileSync(path.join(game, 'versions', 'reuse', 'reuse.json'), JSON.stringify({ id: 'reuse', mainClass: 'fixture.Main', assetIndex: { id: 'reuse', url: 'https://unused.invalid/index', sha1: sha(index), size: index.length }, libraries: [{ name: 'test:lib:1', downloads: { artifact: { path: 'test/lib.jar', url: 'https://unused.invalid/lib', sha1: sha(lib), size: lib.length } } }] }))
  const runtime = await versionInstallHarness(root, async () => { throw Error('Unexpected metadata request') }, () => { throw Error('Unexpected download') })
  try {
    Object.assign(runtime.getSettings(), { gameDir: game, activeFolder: game, folders: [{ path: game, name: 'main', isDefault: true }, { path: other, name: 'bound' }], mirror: 'official' })
    await runtime.installVersion('reuse', {}, () => {})
    assert.equal(sha(fs.readFileSync(path.join(game, 'libraries/test/lib.jar'))), sha(lib))
    assert.equal(sha(fs.readFileSync(path.join(game, `assets/objects/${sha(asset).slice(0, 2)}/${sha(asset)}`))), sha(asset))
  } finally { await runtime.closeHttpClient(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('大文件优先派发，但进度仍对应原任务且缓存命中不改写其他文件', async () => {
  const root = temporary(), hits: string[] = [], payloads = [Buffer.alloc(2), Buffer.alloc(1024), Buffer.alloc(256)]
  const s = await server((req, res) => { hits.push(req.url!); res.end(payloads[Number(req.url!.slice(1))]) })
  let completed = 0
  try {
    await downloadAll(payloads.map((b, i) => ({ url: s.url + '/' + i, dest: path.join(root, '' + i), size: b.length, sha1: sha(b) })), d => { completed = d }, 1)
    assert.deepEqual(hits, ['/1', '/2', '/0']); assert.equal(completed, 3)
  } finally { await s.close(); fs.rmSync(root, { recursive: true, force: true }) }
})
