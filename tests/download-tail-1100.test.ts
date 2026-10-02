import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { downloadAll, downloadFile, resetHostHealthForTest, slowSpeedThresholds } from '../src/main/core/download'
import { downloadLimiter, DEFAULT_DOWNLOAD_LIMITS } from '../src/main/core/downloadLimits'
import { versionInstallHarness } from './helpers/version-install-harness'
import { ParallelProgress } from '../src/main/core/parallelProgress'
import { isNewerVersion } from '../src/shared/semver'

const hash = (data: Buffer) => crypto.createHash('sha1').update(data).digest('hex')
async function fixture(handler: http.RequestListener) {
  const server = http.createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-tail-1100-'))
  return { root, url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(root, { recursive: true, force: true }); resetHostHealthForTest(); downloadLimiter.configure(DEFAULT_DOWNLOAD_LIMITS)
  } }
}

test('小文件持续低速会续传到备用源，最后唯一来源仍可正常完成', { timeout: 6000 }, async () => {
  const body = Buffer.alloc(128 * 1024, 21), saved = { ...slowSpeedThresholds }, resumed: number[] = []
  slowSpeedThresholds.smallWindowMs = 150
  const f = await fixture((req, res) => {
    let offset = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] ?? 0)
    res.writeHead(offset ? 206 : 200, { 'content-length': body.length - offset, ...(offset ? { 'content-range': `bytes ${offset}-${body.length - 1}/${body.length}` } : {}) })
    if (req.url === '/fast') { resumed.push(offset); res.end(body.subarray(offset)); return }
    const timer = setInterval(() => { const end = Math.min(body.length, offset + (req.url === '/only' ? 8192 : 1024)); res.write(body.subarray(offset, end)); offset = end; if (end === body.length) { clearInterval(timer); res.end() } }, 50)
    res.on('close', () => clearInterval(timer))
  })
  try {
    const started = performance.now()
    await downloadFile(f.url + '/slow', path.join(f.root, 'small'), undefined, hash(body), 'official', AbortSignal.timeout(3000), [f.url + '/fast'], { size: body.length })
    assert(performance.now() - started < 2000); assert(resumed[0] > 0); assert.equal(hash(fs.readFileSync(path.join(f.root, 'small'))), hash(body))
    await downloadFile(f.url + '/only', path.join(f.root, 'only'), undefined, hash(body), 'official', AbortSignal.timeout(2000), [], { size: body.length })
    assert.equal(hash(fs.readFileSync(path.join(f.root, 'only'))), hash(body))
  } finally { Object.assign(slowSpeedThresholds, saved); await f.close() }
})

test('分片重试重新访问镜像入口，不被第一次跳转的慢节点锁住', { timeout: 6000 }, async () => {
  const body = crypto.randomBytes(2 * 1024 * 1024), saved = slowSpeedThresholds.largeWindowMs
  slowSpeedThresholds.largeWindowMs = 150
  let redirects = 0, slowShardIssued = false; const starts: number[] = [], mirrorStarts: number[] = []
  const f = await fixture((req, res) => {
    if (req.url === '/mirror') {
      const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range!); assert(range)
      const start = Number(range[1]); mirrorStarts.push(start); redirects++
      // Parallel shards can reach the server in either order. Bind the stalled
      // prefix to shard zero so the exact 8192-byte continuation is deterministic.
      const slow = start === 0 && !slowShardIssued
      if (slow) slowShardIssued = true
      res.writeHead(302, { location: slow ? '/slow-node' : '/healthy-node' }); res.end(); return
    }
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range!); assert(range)
    const start = Number(range[1]), end = Number(range[2]); starts.push(start)
    res.writeHead(206, { 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${body.length}` })
    if (req.url === '/slow-node') res.write(body.subarray(start, start + 8192))
    else res.end(body.subarray(start, end + 1))
  })
  try {
    await downloadFile(f.url + '/mirror', path.join(f.root, 'large'), undefined, hash(body), 'official', AbortSignal.timeout(3000), [], { size: body.length })
    assert(redirects >= 3); assert(starts.includes(8192))
    assert(mirrorStarts.includes(8192), 'the resumed shard must revisit the mirror entry rather than pinning its first redirect')
    assert.equal(hash(fs.readFileSync(path.join(f.root, 'large'))), hash(body))
  } finally { slowSpeedThresholds.largeWindowMs = saved; await f.close() }
})

test('大文件尚未完成时小文件队列已被处理，全部请求仍遵守全局连接限制', { timeout: 6000 }, async () => {
  const big = Buffer.alloc(1024 * 1024, 7), small = Buffer.from('small'), held: Array<() => void> = []
  let active = 0, peak = 0, tiny = 0, released = false
  downloadLimiter.configure({ downloadThreads: 4, downloadSpeedKBps: 0 })
  const f = await fixture((req, res) => {
    active++; peak = Math.max(peak, active); res.on('close', () => active--)
    if (req.url!.startsWith('/small')) {
      res.end(small)
      if (++tiny === 8) { released = true; held.forEach(send => send()) }
      return
    }
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range!); assert(range)
    const start = Number(range[1]), end = Number(range[2]); res.writeHead(206, { 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${big.length}` })
    const send = () => res.end(big.subarray(start, end + 1)); if (released) send(); else held.push(send)
  })
  try {
    const tasks = Array.from({ length: 16 }, (_, i) => { const data = i < 8 ? big : small; return { url: f.url + (i < 8 ? '/big' : '/small') + i, dest: path.join(f.root, '' + i), size: data.length, sha1: hash(data) } })
    await downloadAll(tasks, undefined, 4, 'official', AbortSignal.timeout(3000))
    assert.equal(tiny, 8); assert(peak <= 4); for (const task of tasks) assert.equal(hash(fs.readFileSync(task.dest)), task.sha1)
  } finally { await f.close() }
})

test('并行覆盖文件解压保留内容、真实进度和取消后的写入终止', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-extract-1100-'))
  try {
    const core = await versionInstallHarness(root), zip = new AdmZip(), updates: number[] = []
    for (let i = 0; i < 80; i++) zip.addFile('overrides/config/' + i + '.json', Buffer.from('file-' + i))
    const target = path.join(root, 'output')
    const files = await core.extractOverrides(zip, 'overrides', target, undefined, (done: number) => updates.push(done))
    assert.equal(files.length, 80); assert.equal(updates.at(-1), 80)
    for (let i = 0; i < 80; i++) assert.equal(fs.readFileSync(path.join(target, 'config', i + '.json'), 'utf8'), 'file-' + i)
    const controller = new AbortController(), cancelDir = path.join(root, 'cancel')
    await assert.rejects(core.extractOverrides(zip, 'overrides', cancelDir, controller.signal, () => controller.abort()), /abort|已取消/i)
    const count = fs.readdirSync(path.join(cancelDir, 'config')).length
    await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(fs.readdirSync(path.join(cancelDir, 'config')).length, count)
    const bad = new AdmZip(); const entry = bad.addFile('overrides/config/link', Buffer.from('outside')); entry.attr = (0o120777 << 16) >>> 0
    await assert.rejects(core.extractOverrides(bad, 'overrides', path.join(root, 'bad')), /符号链接/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('加载器处理未知进度保留到嵌套下载中心，不伪装成卡在 0%', () => {
  const events: any[] = [], outer = new ParallelProgress([{ id: 'runtime', label: '环境', weight: 1 }], event => events.push(event), '', [0, 1])
  const inner = new ParallelProgress([{ id: 'processor', label: '生成运行文件', weight: 1 }], event => outer.update('runtime', event), '', [0, 1])
  inner.update('processor', { stage: 'loader-process', progress: 0, indeterminate: true, text: '正在生成运行文件' })
  assert.equal(events.at(-1).parallelStages[0].indeterminate, true)
})

test('分片字节收齐后不再等待迟到的 EOF 或发出越界的续传请求', { timeout: 4000 }, async () => {
  const body = Buffer.alloc(2 * 1024 * 1024, 19); let requests = 0
  const f = await fixture((req, res) => {
    requests++
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range!); assert(range)
    const start = Number(range[1]), end = Number(range[2]); assert(start <= end)
    res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${body.length}` })
    res.write(body.subarray(start, end + 1)) // Intentionally leave the transport open.
  })
  try {
    await downloadFile(f.url + '/late-eof', path.join(f.root, 'complete'), undefined, hash(body), 'official', AbortSignal.timeout(2000), [], { size: body.length })
    assert.equal(requests, 2); assert.equal(hash(fs.readFileSync(path.join(f.root, 'complete'))), hash(body))
  } finally { await f.close() }
})

test('百进一后的 1.1.0 仍被旧版正确识别为更新', () => {
  assert(isNewerVersion('1.1.0', '1.0.99'))
  assert(!isNewerVersion('1.0.99', '1.1.0'))
})
