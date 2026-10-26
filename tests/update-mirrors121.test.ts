import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { downloadUpdatePayload } from '../src/main/core/updateDownload'
import { UpdateProbeCache, rankUpdateSources, updateDownloadCandidates, updateProbePolicy, validateUpdateDownloadUrl } from '../src/main/core/updateSources'
import { downloadFetch } from '../src/main/core/downloadFetch'
import { httpFetch } from '../src/main/core/httpClient'
import { downloadLimiter, DEFAULT_DOWNLOAD_LIMITS } from '../src/main/core/downloadLimits'
import { resetHostHealthForTest, slowSpeedThresholds } from '../src/main/core/download'
import { cancelTaskAndWait, finishTask, pauseTask, registerTask, resumeTask } from '../src/main/core/tasks'
import { fetchSha256Sums, updateBodyPolicy } from '../src/main/core/selfUpdate'
import { UPDATE_MIRROR_PRESETS, normalizeUpdateMirrorUrl } from '../src/shared/updateMirrors'

const hash = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex')
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
async function fixture(handler: http.RequestListener) {
  const server = http.createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  } }
}
function rangeResponse(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer, delay = 0) {
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
  const start = range ? Number(range[1]) : 0, end = range?.[2] ? Number(range[2]) : body.length - 1
  setTimeout(() => {
    if (res.destroyed) return
    res.writeHead(range ? 206 : 200, { 'content-type': 'application/octet-stream', 'content-length': end - start + 1, ...(range ? { 'content-range': `bytes ${start}-${end}/${body.length}` } : {}) })
    res.end(body.subarray(start, end + 1))
  }, delay)
}

test('update source preferences retain presets, append normalized legacy/new mirrors and exclude unsafe prefixes', () => {
  const asset = 'https://github.com/kamubaba-i/KAMUCL/releases/download/v1.1.20/KAMUCL-1.1.20.exe'
  const settings = { updateMirrorUrl: 'https://legacy.example/proxy', updateMirrorUrls: [' https://custom.example ', 'https://ghproxy.net/', 'http://plain.example/', 'https://user:pass@example.org/', 'https://example.org/?token=x'] }
  const mirrors = [...UPDATE_MIRROR_PRESETS.map(prefix => prefix + asset), 'https://legacy.example/proxy/' + asset, 'https://custom.example/' + asset]
  assert.deepEqual(updateDownloadCandidates(asset, settings), [asset, ...mirrors])
  assert.deepEqual(updateDownloadCandidates(asset, { ...settings, updateSource: 'mirror' }), mirrors)
  assert.deepEqual(updateDownloadCandidates(asset, { ...settings, updateSource: 'direct' }), [asset])
  assert.equal(normalizeUpdateMirrorUrl('https://safe.example/path//'), 'https://safe.example/path/')
  for (const url of ['http://example.org/a', 'https://u:p@example.org/a', 'file:///tmp/a', 'https://example.org/a#fragment']) assert.throws(() => validateUpdateDownloadUrl(url))
  assert.doesNotThrow(() => validateUpdateDownloadUrl('http://127.0.0.1:1234/fixture', true))
  assert.throws(() => validateUpdateDownloadUrl('http://example.org/fixture', true))
})

test('Range probe measures full first block rather than headers; caches exact asset and size for five minutes', async () => {
  const body = Buffer.alloc(128 * 1024, 42), hits: string[] = [], cache = new UpdateProbeCache()
  const slow = await fixture((req, res) => { hits.push('slow'); rangeResponse(req, res, body, 150) })
  const fast = await fixture((req, res) => { hits.push('fast'); rangeResponse(req, res, body, 5) })
  try {
    const urls = [slow.url, fast.url]
    assert.deepEqual(await rankUpdateSources(urls, body.length, undefined, { allowLoopback: true, cache }), [fast.url, slow.url])
    assert.equal(hits.length, 2)
    assert.deepEqual(await rankUpdateSources(urls, body.length, undefined, { allowLoopback: true, cache }), [fast.url, slow.url])
    assert.equal(hits.length, 2, 'cached probes must not request duplicate bytes')
    await rankUpdateSources(urls.map(url => url + '/other'), body.length, undefined, { allowLoopback: true, cache })
    assert.equal(hits.length, 4)
    await rankUpdateSources(urls, body.length + 1, undefined, { allowLoopback: true, cache })
    assert.equal(hits.length, 6, 'a changed representation size invalidates an old measurement')
    assert.equal(cache.get(fast.url, body.length)?.bytes, 65536)
  } finally { await slow.close(); await fast.close() }
})

test('cache expires and evicts older entries at a fixed bound', () => {
  let now = 100
  const cache = new UpdateProbeCache(() => now), sample = (url: string) => ({ url, ok: true, headersMs: 2, bodyMs: 10, bytes: 65536 })
  cache.put(sample('https://a.example/asset'), 100000)
  now += updateProbePolicy.cacheTtlMs - 1
  assert(cache.get('https://a.example/asset', 100000))
  now++
  assert.equal(cache.get('https://a.example/asset', 100000), undefined)
  for (let i = 0; i < updateProbePolicy.maxCacheEntries + 10; i++) cache.put(sample(`https://a.example/${i}`), 100000)
  assert.equal(cache.size, updateProbePolicy.maxCacheEntries)
  assert.equal(cache.get('https://a.example/0', 100000), undefined)
  assert(cache.get(`https://a.example/${updateProbePolicy.maxCacheEntries + 9}`, 100000))
})

test('a source with early headers and a slow body loses to the faster complete first block', async () => {
  const body = Buffer.alloc(128 * 1024), cache = new UpdateProbeCache()
  const early = await fixture((_req, res) => {
    res.writeHead(206, { 'content-range': `bytes 0-65535/${body.length}`, 'content-length': 65536 })
    res.write(body.subarray(0, 1024)); setTimeout(() => { if (!res.destroyed) res.end(body.subarray(1024, 65536)) }, 180)
  })
  const fast = await fixture((req, res) => rangeResponse(req, res, body, 35))
  try {
    assert.equal((await rankUpdateSources([early.url, fast.url], body.length, undefined, { allowLoopback: true, cache }))[0], fast.url)
    assert(cache.get(early.url, body.length)!.bodyMs > 100)
  } finally { await early.close(); await fast.close() }
})

test('a hanging probe times out without removing its fallback or leaking a connection slot', async () => {
  const old = updateProbePolicy.timeoutMs, cache = new UpdateProbeCache(), body = Buffer.alloc(128 * 1024)
  let closed = false
  const hung = await fixture((_req, res) => { res.on('close', () => { closed = true }); res.writeHead(206, { 'content-range': `bytes 0-65535/${body.length}` }); res.write(body.subarray(0, 1024)) })
  const fast = await fixture((req, res) => rangeResponse(req, res, body))
  updateProbePolicy.timeoutMs = 120
  try {
    const started = Date.now()
    assert.deepEqual(await rankUpdateSources([hung.url, fast.url], body.length, undefined, { allowLoopback: true, cache }), [fast.url, hung.url])
    assert(Date.now() - started < 1000)
    assert.equal(cache.get(hung.url, body.length)?.ok, false)
    await wait(40); assert.equal(closed, true)
    const release = await downloadLimiter.acquire(AbortSignal.timeout(500)); release()
  } finally { updateProbePolicy.timeoutMs = old; await hung.close(); await fast.close() }
})

test('probe rejects HTML and inconsistent Content-Range; ignored Range reads only one block and closes transport', async () => {
  const body = Buffer.alloc(128 * 1024, 11), cache = new UpdateProbeCache()
  let ignoredClosed = false
  const s = await fixture((req, res) => {
    if (req.url === '/html') { res.writeHead(200, { 'content-type': 'text/html' }).end('<html>portal</html>'); return }
    if (req.url === '/bad') { res.writeHead(206, { 'content-range': `bytes 1-65536/${body.length}` }).end(body.subarray(0, 65536)); return }
    if (req.url === '/ignore') {
      res.on('close', () => { ignoredClosed = true })
      res.writeHead(200, { 'content-length': body.length }); res.write(body.subarray(0, 65536)); return
    }
    rangeResponse(req, res, body)
  })
  try {
    const urls = ['/html', '/bad', '/ignore'].map(part => s.url + part)
    assert.equal((await rankUpdateSources(urls, body.length, undefined, { allowLoopback: true, cache }))[0], s.url + '/ignore')
    assert.equal(cache.get(urls[0], body.length)?.ok, false)
    assert.equal(cache.get(urls[1], body.length)?.ok, false)
    assert.equal(cache.get(urls[2], body.length)?.bytes, 65536)
    await wait(40); assert.equal(ignoredClosed, true)
  } finally { await s.close() }
})

test('all probe failures preserve candidates and useful transfer still falls back with SHA256 verification', async () => {
  const body = Buffer.from('verified updater payload'), root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-update121-'))
  const s = await fixture((req, res) => {
    if (req.headers.range || req.url === '/missing') { res.writeHead(503).end(); return }
    res.writeHead(200, { 'content-length': body.length }).end(body)
  })
  try {
    const urls = [s.url + '/missing', s.url + '/good'], cache = new UpdateProbeCache()
    assert.deepEqual(await rankUpdateSources(urls, body.length, undefined, { allowLoopback: true, cache }), urls)
    const dest = path.join(root, 'update.exe')
    await downloadUpdatePayload({ urls, dest, sha256: hash(body), size: body.length }, undefined, AbortSignal.timeout(3000), { allowLoopback: true, cache })
    assert.deepEqual(fs.readFileSync(dest), body)
    await assert.rejects(downloadUpdatePayload({ urls: [s.url + '/good'], dest: path.join(root, 'corrupt.exe'), sha256: hash('different'), size: body.length }, undefined, AbortSignal.timeout(3000)), /sha256 校验失败/)
    assert.equal(fs.existsSync(path.join(root, 'corrupt.exe')), false)
  } finally { await s.close(); resetHostHealthForTest(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('a probe winner that slows during the real download switches through the shared engine and resumes with SHA256 intact', async () => {
  const body = crypto.randomBytes(512 * 1024), root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-update-slow121-'))
  const old = { ...slowSpeedThresholds }, ranges: string[] = []
  const slow = await fixture((req, res) => {
    if (req.headers.range === 'bytes=0-65535') { rangeResponse(req, res, body, 1); return }
    res.writeHead(200, { 'content-length': body.length }); res.write(body.subarray(0, 1024))
    let sent = 1024
    const timer = setInterval(() => { res.write(body.subarray(sent, sent + 256)); sent += 256 }, 30)
    res.on('close', () => clearInterval(timer))
  })
  const fast = await fixture((req, res) => { ranges.push(req.headers.range ?? ''); rangeResponse(req, res, body, req.headers.range === 'bytes=0-65535' ? 100 : 0) })
  downloadLimiter.configure({ downloadThreads: 1, downloadSpeedKBps: 0 })
  Object.assign(slowSpeedThresholds, { smallWindowMs: 200, smallMinBps: 128 * 1024 })
  try {
    const urls = [slow.url, fast.url], cache = new UpdateProbeCache(), dest = path.join(root, 'update.exe')
    // Known earlier measurements make the degradation scenario deterministic;
    // the live first-block measurement itself is covered by separate fixtures.
    cache.put({ url: slow.url, ok: true, headersMs: 1, bodyMs: 1, bytes: 65536 }, body.length)
    cache.put({ url: fast.url, ok: true, headersMs: 100, bodyMs: 200, bytes: 65536 }, body.length)
    assert.equal((await rankUpdateSources(urls, body.length, undefined, { allowLoopback: true, cache }))[0], slow.url)
    await downloadUpdatePayload({ urls, dest, sha256: hash(body), size: body.length }, undefined, AbortSignal.timeout(3000), { allowLoopback: true, cache })
    assert.deepEqual(fs.readFileSync(dest), body)
    assert(ranges.some(range => /^bytes=[1-9]\d*-$/.test(range)), `alternate must resume rather than discard bytes: ${ranges}`)
    assert.equal(fs.existsSync(dest + '.part'), false)
  } finally { Object.assign(slowSpeedThresholds, old); downloadLimiter.configure(DEFAULT_DOWNLOAD_LIMITS); resetHostHealthForTest(); await slow.close(); await fast.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('probe respects the shared connection limit; cancellation waits for every reader and leaves slots reusable', async () => {
  let active = 0, peak = 0, starts = 0, closed = 0
  const s = await fixture((_req, res) => { starts++; active++; peak = Math.max(active, peak); res.on('close', () => { active--; closed++ }); res.writeHead(206, { 'content-range': 'bytes 0-65535/131072' }); res.write(Buffer.alloc(1024)) })
  downloadLimiter.configure({ downloadThreads: 2, downloadSpeedKBps: 0 })
  const task = registerTask('镜像探测取消测试', 'download'), cache = new UpdateProbeCache()
  const pending = rankUpdateSources(Array.from({ length: 6 }, (_, i) => s.url + '/' + i), 131072, task.controller.signal, { allowLoopback: true, cache })
    .then(() => null, error => error).finally(() => finishTask(task.id))
  try {
    while (starts < 2) await wait(10)
    assert(peak <= 2)
    const started = Date.now()
    await cancelTaskAndWait(task.id)
    const error = await pending
    assert.match(error.message, /取消/)
    assert(Date.now() - started < 1000)
    await wait(40)
    assert.equal(starts, 2, 'queued sources must not start after cancel')
    assert.equal(closed, 2)
    assert.equal(cache.size, 0, 'cancelled samples must not poison cache')
    const slot1 = await downloadLimiter.acquire(AbortSignal.timeout(500)), slot2 = await downloadLimiter.acquire(AbortSignal.timeout(500))
    slot1(); slot2()
  } finally { downloadLimiter.configure(DEFAULT_DOWNLOAD_LIMITS); await s.close() }
})

test('pause consumes no probe timeout and a configured download speed cap skips preflight traffic', async () => {
  const oldTimeout = updateProbePolicy.timeoutMs, body = Buffer.alloc(128 * 1024)
  let starts = 0
  const s = await fixture((req, res) => { starts++; rangeResponse(req, res, body, 150) })
  const task = registerTask('镜像探测暂停测试', 'download'), cache = new UpdateProbeCache()
  updateProbePolicy.timeoutMs = 80
  try {
    pauseTask(task.id)
    const pending = rankUpdateSources([s.url + '/1', s.url + '/2'], body.length, task.controller.signal, { allowLoopback: true, cache })
    await wait(130)
    assert.equal(starts, 0)
    updateProbePolicy.timeoutMs = 1000
    resumeTask(task.id)
    await pending
    assert.equal(cache.get(s.url + '/1', body.length)?.ok, true)
    downloadLimiter.configure({ downloadThreads: 2, downloadSpeedKBps: 1 })
    await rankUpdateSources([s.url + '/3', s.url + '/4'], body.length, undefined, { allowLoopback: true, cache })
    assert.equal(starts, 2, 'preflight must not misclassify deliberate throttling')
  } finally { finishTask(task.id); updateProbePolicy.timeoutMs = oldTimeout; downloadLimiter.configure(DEFAULT_DOWNLOAD_LIMITS); await s.close() }
})

test('cancelling useful update transfer leaves the previous package intact and no detached writer', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-update-cancel121-')), body = Buffer.alloc(512 * 1024, 21)
  let received = 0, started = false, closed = false
  const s = await fixture((_req, res) => {
    started = true
    res.writeHead(200, { 'content-length': body.length })
    const timer = setInterval(() => { received++; res.write(body.subarray(0, 1024)) }, 15)
    res.on('close', () => { closed = true; clearInterval(timer) })
  })
  const task = registerTask('更新有效传输取消测试', 'download'), dest = path.join(root, 'update.exe')
  const previous = Buffer.from('previous verified update'); fs.writeFileSync(dest, previous)
  const pending = downloadUpdatePayload({ urls: [s.url], dest, sha256: hash(body), size: body.length }, undefined, task.controller.signal)
    .then(() => null, error => error).finally(() => finishTask(task.id))
  try {
    while (!started) await wait(10)
    await wait(40)
    await cancelTaskAndWait(task.id)
    assert.match((await pending).message, /取消/)
    await wait(40); assert.equal(closed, true)
    const before = received
    await wait(40); assert.equal(received, before)
    assert.deepEqual(fs.readFileSync(dest), previous)
    assert.equal(fs.existsSync(dest + '.part'), false)
  } finally { await s.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('redirect keeps Range and signed CDN query while stripping cross-origin source credentials', async () => {
  const requests: Array<{ url: string; headers: Record<string, string> }> = []
  const fetcher = async (url: string, init: any) => {
    requests.push({ url, headers: init.headers })
    return requests.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://cdn.example.org/file?X-Amz-Signature=opaque' } }) : new Response('ok')
  }
  const response = await downloadFetch('https://origin.example.org/file', { headers: { Range: 'bytes=0-65535', Authorization: 'secret', Cookie: 'session=secret', 'Proxy-Authorization': 'proxy-secret', 'X-API-Key': 'source-secret', 'accept-encoding': 'identity' } }, async () => 'cf-secret', fetcher)
  assert.equal(await response.text(), 'ok')
  assert.equal(requests[0].headers.Authorization, 'secret')
  assert.deepEqual(requests[1], { url: 'https://cdn.example.org/file?X-Amz-Signature=opaque', headers: { Range: 'bytes=0-65535', 'accept-encoding': 'identity' } })
  for (const destination of ['http://cdn.example.org/file', 'https://u:p@cdn.example.org/file', 'file:///tmp/file']) {
    let hits = 0
    await assert.rejects(downloadFetch('https://origin.example.org/file', undefined, undefined, async () => { hits++; return new Response(null, { status: 302, headers: { location: destination } }) }), /不安全/)
    assert.equal(hits, 1)
  }
})

test('same-origin redirects preserve authorization and CF keys are recomputed only at the official endpoint', async () => {
  const requests: Array<{ url: string; headers: Record<string, string> }> = []
  await downloadFetch('https://edge.forgecdn.net/files/12/34/a.jar', { headers: { Range: 'bytes=0-1' } }, async () => 'cf-secret', async (url, init: any) => {
    requests.push({ url, headers: init.headers })
    return requests.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://mirror.example.org/a.jar' } }) : new Response('ok')
  })
  assert.equal(requests[0].headers['x-api-key'], 'cf-secret')
  assert.equal(requests[1].headers['x-api-key'], undefined)
  let hits = 0
  await downloadFetch('https://origin.example.org/a', { headers: { Authorization: 'same-secret' } }, undefined, async (_url, init: any) => {
    assert.equal(init.headers.Authorization, 'same-secret')
    return ++hits === 1 ? new Response(null, { status: 302, headers: { location: '/b' } }) : new Response('ok')
  })
  assert.equal(hits, 2)
})

test('checksum lookup cancellation propagates before probes or useful transfer', async () => {
  const controller = new AbortController(), hint = 'https://github.com/kamubaba-i/KAMUCL/releases/download/v1.1.20/KAMUCL-1.1.20.exe'
  let calls = 0
  const pending = fetchSha256Sums(hint, async (_url, _etag, signal) => {
    calls++
    return new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }))
  }, controller.signal)
  controller.abort(new Error('已取消'))
  await assert.rejects(pending, /已取消/)
  assert.equal(calls, 1)
})

test('official exact-release API digest permits verified mirror transfer when the checksum CDN is unavailable', async () => {
  const hint = 'https://github.com/kamubaba-i/KAMUCL/releases/download/v1.1.20/KAMUCL-1.1.20.exe', calls: string[] = []
  const digest = hash('official payload')
  const result = await fetchSha256Sums(hint, async url => {
    calls.push(url)
    if (url.endsWith('/SHA256SUMS.txt')) return new Response('unavailable', { status: 503 })
    return Response.json({ tag_name: 'v1.1.20', assets: [{ name: 'KAMUCL-1.1.20.exe', browser_download_url: hint, size: 1024, digest: 'sha256:' + digest }] })
  })
  assert.equal(result?.get('KAMUCL-1.1.20.exe'), digest)
  assert.deepEqual(calls, [hint.replace(/[^/]+$/, 'SHA256SUMS.txt'), 'https://api.github.com/repos/kamubaba-i/KAMUCL/releases/tags/v1.1.20'])
})

test('API digest fallback rejects wrong release, wrong origin, invalid hash and unpublished assets', async () => {
  const hint = 'https://github.com/kamubaba-i/KAMUCL/releases/download/v1.1.20/KAMUCL-1.1.20.exe'
  const release = { tag_name: 'v1.1.20', assets: [{ name: 'KAMUCL-1.1.20.exe', browser_download_url: hint, size: 1024, digest: 'sha256:' + hash('official') }] }
  for (const changed of [
    { ...release, tag_name: 'v1.1.21' },
    { ...release, draft: true },
    { ...release, prerelease: true },
    { ...release, assets: [{ ...release.assets[0], browser_download_url: 'https://mirror.example.org/update.exe' }] },
    { ...release, assets: [{ ...release.assets[0], digest: 'sha1:' + 'a'.repeat(40) }] },
    { ...release, assets: [{ ...release.assets[0], digest: undefined }] },
    { ...release, assets: [{ ...release.assets[0], size: 0 }] }
  ]) {
    assert.equal(await fetchSha256Sums(hint, async url => url.includes('/releases/tags/') ? Response.json(changed) : new Response('', { status: 404 })), null)
  }
})

test('a stalled official API JSON body is cancelled by its own deadline after headers arrive', async () => {
  const old = updateBodyPolicy.timeoutMs, hint = 'https://github.com/kamubaba-i/KAMUCL/releases/download/v1.1.20/KAMUCL-1.1.20.exe'
  let closed = false
  updateBodyPolicy.timeoutMs = 120
  try {
    const started = Date.now()
    const result = await fetchSha256Sums(hint, async url => url.includes('/releases/tags/')
      ? new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('{')) }, cancel() { closed = true } }))
      : new Response('', { status: 404 }))
    assert.equal(result, null)
    assert.equal(closed, true)
    assert(Date.now() - started < 1000, 'body EOF cannot wait indefinitely after header timeout is cleared')
  } finally { updateBodyPolicy.timeoutMs = old }
})

test('oversized official API JSON cannot provide a checksum and is closed before parsing', async () => {
  const hint = 'https://github.com/kamubaba-i/KAMUCL/releases/download/v1.1.20/KAMUCL-1.1.20.exe'
  let closed = false
  const result = await fetchSha256Sums(hint, async url => url.includes('/releases/tags/')
    ? new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.alloc(updateBodyPolicy.maxBytes + 1, 32)) }, cancel() { closed = true } }))
    : new Response('', { status: 404 }))
  assert.equal(result, null)
  assert.equal(closed, true)
})

test('real HTTP API headers followed by a hung JSON body time out and close the socket', async () => {
  const old = updateBodyPolicy.timeoutMs, hint = 'https://github.com/kamubaba-i/KAMUCL/releases/download/v1.1.20/KAMUCL-1.1.20.exe'
  let closed = false
  const s = await fixture((_req, res) => { res.on('close', () => { closed = true }); res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"tag_name":"v1.1.20","assets":[') })
  updateBodyPolicy.timeoutMs = 120
  try {
    const started = Date.now()
    assert.equal(await fetchSha256Sums(hint, async (url, _etag, signal) => url.includes('/releases/tags/') ? httpFetch(s.url, { signal }) : new Response('', { status: 404 })), null)
    assert(Date.now() - started < 1000)
    await wait(40); assert.equal(closed, true)
  } finally { updateBodyPolicy.timeoutMs = old; await s.close() }
})

test('a paused API body consumes no active deadline; cancellation closes its pending read before returning', async () => {
  const old = updateBodyPolicy.timeoutMs, hint = 'https://github.com/kamubaba-i/KAMUCL/releases/download/v1.1.20/KAMUCL-1.1.20.exe'
  let closed = false, started = false, settled = false
  const s = await fixture((_req, res) => { started = true; res.on('close', () => { closed = true }); res.writeHead(200, { 'content-type': 'application/json' }); res.write('{') })
  const task = registerTask('官方校验API正文暂停取消测试', 'download')
  updateBodyPolicy.timeoutMs = 120
  const pending = fetchSha256Sums(hint, async (url, _etag, signal) => url.includes('/releases/tags/') ? httpFetch(s.url, { signal }) : new Response('', { status: 404 }), task.controller.signal)
    .then(() => null, error => error).finally(() => { settled = true; finishTask(task.id) })
  try {
    while (!started) await wait(10)
    pauseTask(task.id)
    await wait(280)
    assert.equal(settled, false, 'a user pause must not exhaust the body budget')
    await cancelTaskAndWait(task.id)
    assert.match((await pending).message, /取消/)
    await wait(40); assert.equal(closed, true)
  } finally { updateBodyPolicy.timeoutMs = old; finishTask(task.id); await s.close() }
})
