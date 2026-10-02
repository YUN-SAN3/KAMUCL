import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { downloadAll, downloadFile, slowSpeedThresholds, resetHostHealthForTest } from '../src/main/core/download'
import { downloadLimiter, DEFAULT_DOWNLOAD_LIMITS } from '../src/main/core/downloadLimits'
const MiB = 1024 * 1024
const sha = (data: Buffer) => crypto.createHash('sha1').update(data).digest('hex')
async function fixture(handler: http.RequestListener) {
  const server = http.createServer(handler)
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-transfer-1076-'))
  downloadLimiter.configure(DEFAULT_DOWNLOAD_LIMITS); resetHostHealthForTest()
  return { root, base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: async () => {
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()))
    downloadLimiter.configure(DEFAULT_DOWNLOAD_LIMITS); resetHostHealthForTest(); fs.rmSync(root, { recursive: true, force: true })
  } }
}
function range(req: http.IncomingMessage, res: http.ServerResponse, data: Buffer) {
  const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '')
  assert(m, 'known immutable large files must keep parallel range transfers')
  const start = Number(m[1]), end = Number(m[2])
  res.writeHead(206, { 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${data.length}` })
  return { start, end }
}

test('last mod inherits free batch connections while its original request is still pending', { timeout: 6000 }, async () => {
  const data = crypto.randomBytes(12 * MiB), small = Buffer.from('small mod'), held: Array<() => void> = []
  let active = 0, peak = 0, largeActive = 0, largePeak = 0, released = false
  const f = await fixture((req, res) => {
    active++; peak = Math.max(peak, active); res.on('close', () => active--)
    if (req.url !== '/large') { setTimeout(() => res.end(small), 100); return }
    const { start, end } = range(req, res, data)
    largeActive++; largePeak = Math.max(largePeak, largeActive); res.on('close', () => largeActive--)
    if (released) return void res.end(data.subarray(start, end + 1))
    held.push(() => res.end(data.subarray(start, end + 1)))
    if (largeActive >= 4) { released = true; held.forEach(send => send()) }
  })
  try {
    const tasks = [data, ...Array<Buffer>(7).fill(small)].map((payload, i) => ({ url: f.base + (i ? '/small' : '/large'), dest: path.join(f.root, i + '.jar'), size: payload.length, sha1: sha(payload) }))
    await downloadAll(tasks, undefined, 8, 'official', AbortSignal.timeout(4000))
    assert(largePeak >= 4, 'budget must update without finishing/restarting the old request')
    assert(peak <= DEFAULT_DOWNLOAD_LIMITS.downloadThreads, 'all files still share the global limit')
    assert.equal(sha(fs.readFileSync(tasks[0].dest)), sha(data))
  } finally { await f.close() }
})

test('a slow shard resumes on another source without cancelling healthy shards', { timeout: 6000 }, async () => {
  const data = crypto.randomBytes(2 * MiB), saved = { ...slowSpeedThresholds }
  const healthy: Array<{ completed: boolean; aborted: boolean }> = [], resumed: number[] = []
  Object.assign(slowSpeedThresholds, { largeWindowMs: 150 })
  const f = await fixture((req, res) => {
    const { start, end } = range(req, res, data)
    if (req.url === '/first' && start === 0) { res.write(data.subarray(0, 16384)); return }
    if (start < MiB) { resumed.push(start); res.end(data.subarray(start, end + 1)); return }
    const record = { completed: false, aborted: false }; healthy.push(record); let at = start
    const timer = setInterval(() => {
      const next = Math.min(end + 1, at + 65536); res.write(data.subarray(at, next)); at = next
      if (at > end) { record.completed = true; clearInterval(timer); res.end() }
    }, 40)
    res.on('close', () => { clearInterval(timer); record.aborted = !record.completed })
  })
  try {
    const dest = path.join(f.root, 'mod.jar')
    await downloadFile(f.base + '/first', dest, undefined, sha(data), 'official', AbortSignal.timeout(4000), [f.base + '/second'], { size: data.length })
    assert(resumed.some(offset => offset === 16384), 'continue from the saved bytes')
    assert.equal(healthy.length, 1); assert.equal(healthy[0].aborted, false)
    assert.equal(sha(fs.readFileSync(dest)), sha(data))
  } finally { Object.assign(slowSpeedThresholds, saved); await f.close() }
})

test('a sole range source reconnects a crawling connection once and keeps the downloaded prefix', { timeout: 6000 }, async () => {
  const data = crypto.randomBytes(2 * MiB), saved = { ...slowSpeedThresholds }, offsets: number[] = []
  Object.assign(slowSpeedThresholds, { largeWindowMs: 150 })
  const f = await fixture((req, res) => {
    const { start, end } = range(req, res, data); offsets.push(start)
    if (start % MiB === 0) { res.write(data.subarray(start, start + 16384)); return }
    res.end(data.subarray(start, end + 1))
  })
  try {
    const dest = path.join(f.root, 'mod.jar')
    await downloadFile(f.base + '/only', dest, undefined, sha(data), 'official', AbortSignal.timeout(4000), [], { size: data.length })
    assert.deepEqual(offsets.sort((a, b) => a - b), [0, 16384, MiB, MiB + 16384])
    assert.equal(sha(fs.readFileSync(dest)), sha(data))
  } finally { Object.assign(slowSpeedThresholds, saved); await f.close() }
})

test('resume preserves the old fragment layout when connection settings change', async () => {
  const data = crypto.randomBytes(5 * MiB), starts: number[] = []
  const f = await fixture((req, res) => { const { start, end } = range(req, res, data); starts.push(start); res.end(data.subarray(start, end + 1)) })
  try {
    const dest = path.join(f.root, 'old.jar'), cache = dest + '.segments-cache', step = Math.ceil(data.length / 3)
    fs.mkdirSync(cache); fs.writeFileSync(path.join(cache, 'identity.json'), JSON.stringify({ version: 1, size: data.length, sha1: sha(data), step }))
    fs.writeFileSync(path.join(cache, '0.part'), data.subarray(0, step)); fs.writeFileSync(path.join(cache, '1.part'), data.subarray(step, step + 8192))
    downloadLimiter.configure({ downloadThreads: 2, downloadSpeedKBps: 0 })
    await downloadFile(f.base + '/old', dest, undefined, sha(data), 'official', undefined, [], { size: data.length })
    assert.deepEqual(starts.sort((a, b) => a - b), [step + 8192, step * 2])
    assert.equal(sha(fs.readFileSync(dest)), sha(data)); assert(!fs.existsSync(cache))
  } finally { await f.close() }
})
