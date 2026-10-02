import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { downloadAll, retryAfterTime } from '../src/main/core/download'
import { DEFAULT_DOWNLOAD_LIMITS, downloadLimiter, DownloadLimiter, validateDownloadLimits } from '../src/main/core/downloadLimits'

test('default pool downloads distinct files concurrently and respects the shared configured ceiling', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kamucl-many-files-'))
  let active = 0, peak = 0
  const paths = new Set<string>()
  const server = http.createServer((req, res) => {
    paths.add(req.url!); active++; peak = Math.max(peak, active)
    setTimeout(() => { active--; res.end(req.url) }, 150)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  downloadLimiter.configure(DEFAULT_DOWNLOAD_LIMITS)
  try {
    const base = `http://127.0.0.1:${(server.address() as any).port}`
    await downloadAll(Array.from({ length: 40 }, (_, i) => ({ url: `${base}/${i}`, dest: path.join(dir, String(i)) })))
    assert.equal(paths.size, 40); assert(peak >= 16 && peak <= DEFAULT_DOWNLOAD_LIMITS.downloadThreads, `peak=${peak}`)
    assert.equal(await fs.readFile(path.join(dir, '39'), 'utf8'), '/39')
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await fs.rm(dir, { recursive: true, force: true }) }
})

test('server Retry-After accepts seconds and HTTP dates without retrying early', () => {
  const now = Date.parse('2026-09-16T12:00:00Z')
  assert.equal(retryAfterTime('60', now), now + 60_000)
  assert.equal(retryAfterTime('Wed, 16 Sep 2026 12:02:00 GMT', now), now + 120_000)
  assert.equal(retryAfterTime('invalid', now), now + 30_000)
})

test('两个独立下载池共享 HTTP 并发上限和总速率，完成内容一致', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kamucl-limits-'))
  let active = 0, peak = 0
  const payload = Buffer.alloc(64 * 1024, 83)
  const server = http.createServer((_req, res) => {
    active++; peak = Math.max(peak, active)
    res.on('close', () => active--)
    setTimeout(() => { res.writeHead(200, { 'Content-Length': payload.length }); res.end(payload) }, 80)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as any).port}/file`
  downloadLimiter.configure({ downloadThreads: 2, downloadSpeedKBps: 128 })
  try {
    const tasks = Array.from({ length: 4 }, (_, i) => ({ url, dest: path.join(dir, String(i)), size: payload.length }))
    const started = performance.now()
    await Promise.all([downloadAll(tasks.slice(0, 2)), downloadAll(tasks.slice(2))])
    assert.ok(peak <= 2 && peak > 0, `peak=${peak}`)
    assert.ok(performance.now() - started >= 1700, '合计限速未生效')
    for (const task of tasks) assert.deepEqual(await fs.readFile(task.dest), payload)
  } finally {
    downloadLimiter.configure(DEFAULT_DOWNLOAD_LIMITS)
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()))
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('排队与限速等待均可立即取消，取消后不会泄漏并发名额', async () => {
  const limiter = new DownloadLimiter()
  limiter.configure({ downloadThreads: 1, downloadSpeedKBps: 1 })
  const release = await limiter.acquire()
  const abort = new AbortController()
  const queued = limiter.acquire(abort.signal)
  abort.abort()
  await assert.rejects(queued)
  release()
  const next = await limiter.acquire(); next()
  const slow = new AbortController()
  const waiting = limiter.consume(1e8, slow.signal)
  slow.abort()
  await assert.rejects(waiting)
  assert.throws(() => validateDownloadLimits({ downloadThreads: 0, downloadSpeedKBps: 0 }))
  assert.throws(() => validateDownloadLimits({ downloadThreads: 8, downloadSpeedKBps: NaN }))
})
