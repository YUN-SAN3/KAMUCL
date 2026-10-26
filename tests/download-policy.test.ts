import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  BMCL_MAVEN_ROOT,
  classifyHttpStatus,
  downloadCandidates,
  downloadFile,
  mirrorUrl,
  resetHostHealthForTest
} from '../src/main/core/download'
import { downloadLimiter, DEFAULT_DOWNLOAD_LIMITS } from '../src/main/core/downloadLimits'

test('BMCL URL 只按已知资源规则转换，且路径前缀正确', () => {
  assert.equal(
    mirrorUrl('https://resources.download.minecraft.net/ab/abcdef', 'bmclapi'),
    'https://bmclapi2.bangbang93.com/assets/ab/abcdef'
  )
  assert.equal(
    mirrorUrl('https://libraries.minecraft.net/com/example/a.jar', 'bmclapi'),
    'https://bmclapi2.bangbang93.com/maven/com/example/a.jar'
  )
  assert.equal(
    mirrorUrl('https://maven.fabricmc.net/net/fabricmc/a.jar', 'bmclapi'),
    'https://bmclapi2.bangbang93.com/maven/net/fabricmc/a.jar'
  )
  assert.equal(
    mirrorUrl('https://maven.neoforged.net/releases/net/neoforged/neoforge/a.jar', 'bmclapi'),
    'https://bmclapi2.bangbang93.com/maven/net/neoforged/neoforge/a.jar'
  )
  assert.equal(
    mirrorUrl('https://files.minecraftforge.net/maven/net/minecraftforge/a.jar', 'bmclapi'),
    'https://bmclapi2.bangbang93.com/maven/net/minecraftforge/a.jar'
  )
  assert.equal(
    mirrorUrl('https://files.minecraftforge.net/some-unsupported/path', 'bmclapi'),
    'https://files.minecraftforge.net/some-unsupported/path'
  )
  assert.equal(
    mirrorUrl('https://maven.quiltmc.org/repository/release/org/quiltmc/a.jar', 'bmclapi'),
    'https://maven.quiltmc.org/repository/release/org/quiltmc/a.jar'
  )
  assert.equal(BMCL_MAVEN_ROOT, 'https://bmclapi2.bangbang93.com/maven/')
})

test('下载源遵循用户选择，已知镜像优先并保留官方回退', () => {
  const official = 'https://libraries.minecraft.net/com/example/a.jar'
  assert.deepEqual(downloadCandidates([official], 'bmclapi'), [
    'https://bmclapi2.bangbang93.com/maven/com/example/a.jar',
    official
  ])
  assert.deepEqual(downloadCandidates([official], 'official'), [official])
  assert.deepEqual(downloadCandidates(['https://example.com/a.jar'], 'bmclapi'), [
    'https://example.com/a.jar'
  ])
})

test('HTTP 状态按永久不可用、临时错误和确定性错误分类', () => {
  for (const status of [404, 410]) assert.equal(classifyHttpStatus(status), 'unavailable')
  for (const status of [304, 408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(classifyHttpStatus(status), 'transient')
  }
  for (const status of [400, 401, 403, 422, 501, 505]) {
    assert.equal(classifyHttpStatus(status), 'fatal')
  }
})

const contentSha1 = (data: Buffer) => crypto.createHash('sha1').update(data).digest('hex')
async function notModifiedFixture(handler: http.RequestListener) {
  const requests: Array<{ url: string | undefined; headers: http.IncomingHttpHeaders }> = []
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, headers: { ...req.headers } })
    handler(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-304-policy-'))
  downloadLimiter.configure(DEFAULT_DOWNLOAD_LIMITS); resetHostHealthForTest()
  return { root, requests, base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(root, { recursive: true, force: true })
    downloadLimiter.configure(DEFAULT_DOWNLOAD_LIMITS); resetHostHealthForTest()
  } }
}
function assertUnconditional(requests: Array<{ headers: http.IncomingHttpHeaders }>) {
  for (const { headers } of requests) {
    assert.equal(headers['if-none-match'], undefined)
    assert.equal(headers['if-modified-since'], undefined)
    assert.equal(headers['if-range'], undefined)
  }
}

test('无条件下载遇一次 304 后重新请求实际字节，按大小和 SHA1 校验提交', { timeout: 6000 }, async () => {
  const body = Buffer.from('actual immutable asset bytes'); let hits = 0
  const f = await notModifiedFixture((_req, res) => {
    if (++hits === 1) { res.writeHead(304, { etag: '"unexpected-cache-response"' }).end(); return }
    res.writeHead(200, { 'content-length': body.length }).end(body)
  })
  try {
    const dest = path.join(f.root, 'asset')
    await downloadFile(f.base + '/asset', dest, undefined, contentSha1(body), 'official', AbortSignal.timeout(3000), [], { size: body.length })
    assert.equal(hits, 2); assertUnconditional(f.requests)
    assert.deepEqual(fs.readFileSync(dest), body); assert.equal(contentSha1(fs.readFileSync(dest)), contentSha1(body))
    assert.equal(fs.existsSync(dest + '.part'), false)
  } finally { await f.close() }
})

test('永久 304 保持四次请求上限并失败，不提交空文件或覆盖已有目标', { timeout: 6000 }, async () => {
  const body = Buffer.from('expected asset'); let hits = 0
  const f = await notModifiedFixture((_req, res) => { hits++; res.writeHead(304).end() })
  try {
    const dest = path.join(f.root, 'asset'), previous = Buffer.from('previous user file')
    fs.writeFileSync(dest, previous)
    await assert.rejects(downloadFile(f.base + '/asset', dest, undefined, contentSha1(body), 'official', AbortSignal.timeout(3000), [], { size: body.length, maxAttempts: 99 }), /HTTP 304/)
    assert.equal(hits, 4); assertUnconditional(f.requests)
    assert.deepEqual(fs.readFileSync(dest), previous); assert.equal(fs.existsSync(dest + '.part'), false)
  } finally { await f.close() }
})

test('已有前缀的 Range 续传遇 304 后保留准确起点和前缀，最终哈希正确', { timeout: 6000 }, async () => {
  const body = crypto.randomBytes(64 * 1024), prefix = 8192; let hits = 0
  const f = await notModifiedFixture((req, res) => {
    assert.equal(req.headers.range, `bytes=${prefix}-`)
    if (++hits === 1) { res.writeHead(304).end(); return }
    res.writeHead(206, { 'content-length': body.length - prefix, 'content-range': `bytes ${prefix}-${body.length - 1}/${body.length}` }).end(body.subarray(prefix))
  })
  try {
    const dest = path.join(f.root, 'asset'); fs.writeFileSync(dest + '.part', body.subarray(0, prefix))
    await downloadFile(f.base + '/asset', dest, undefined, contentSha1(body), 'official', AbortSignal.timeout(3000), [], { size: body.length })
    assert.equal(hits, 2); assertUnconditional(f.requests)
    assert.deepEqual(fs.readFileSync(dest), body); assert.equal(contentSha1(fs.readFileSync(dest)), contentSha1(body))
    assert.equal(fs.existsSync(dest + '.part'), false)
  } finally { await f.close() }
})

test('单个分片 304 后独立重试正确 206，健康分片不重下且完整 SHA1 正确', { timeout: 6000 }, async () => {
  const body = crypto.randomBytes(2 * 1024 * 1024), visits = new Map<number, number>()
  const f = await notModifiedFixture((req, res) => {
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? ''); assert(range)
    const start = Number(range[1]), end = Number(range[2]), count = (visits.get(start) ?? 0) + 1
    visits.set(start, count)
    if (start === 0 && count === 1) { res.writeHead(304).end(); return }
    res.writeHead(206, { 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${body.length}` }).end(body.subarray(start, end + 1))
  })
  try {
    const dest = path.join(f.root, 'asset')
    await downloadFile(f.base + '/asset', dest, undefined, contentSha1(body), 'official', AbortSignal.timeout(3000), [], { size: body.length })
    assert.equal(visits.get(0), 2); assert.equal(visits.get(1024 * 1024), 1); assert.equal(f.requests.length, 3)
    assertUnconditional(f.requests); assert.deepEqual(fs.readFileSync(dest), body)
    assert.equal(contentSha1(fs.readFileSync(dest)), contentSha1(body)); assert.equal(fs.existsSync(dest + '.segments-cache'), false)
  } finally { await f.close() }
})

test('304 恢复后返回等长错误内容仍被 SHA1 拒绝，保留已有目标并清理临时文件', { timeout: 6000 }, async () => {
  const body = Buffer.from('verified bytes'), corrupt = Buffer.from(body); corrupt[0] ^= 255; let hits = 0
  const f = await notModifiedFixture((_req, res) => {
    if (++hits === 1) { res.writeHead(304).end(); return }
    res.writeHead(200, { 'content-length': corrupt.length }).end(corrupt)
  })
  try {
    const dest = path.join(f.root, 'asset'), previous = Buffer.from('keep existing file')
    fs.writeFileSync(dest, previous)
    await assert.rejects(downloadFile(f.base + '/asset', dest, undefined, contentSha1(body), 'official', AbortSignal.timeout(3000), [], { size: body.length }), /sha1 校验失败/)
    assert.equal(hits, 2); assertUnconditional(f.requests)
    assert.deepEqual(fs.readFileSync(dest), previous); assert.equal(fs.existsSync(dest + '.part'), false)
  } finally { await f.close() }
})

test('304 有显式备用源时立即切换且校验实际内容，official 不自动插入镜像', { timeout: 6000 }, async () => {
  const body = Buffer.from('verified explicit fallback')
  const f = await notModifiedFixture((req, res) => {
    if (req.url === '/primary') { res.writeHead(304).end(); return }
    assert.equal(req.url, '/fallback'); res.writeHead(200, { 'content-length': body.length }).end(body)
  })
  try {
    const dest = path.join(f.root, 'asset'), primary = f.base + '/primary'
    assert.deepEqual(downloadCandidates([primary], 'official'), [primary])
    await downloadFile(primary, dest, undefined, contentSha1(body), 'official', AbortSignal.timeout(3000), [f.base + '/fallback'], { size: body.length })
    assert.deepEqual(f.requests.map(request => request.url), ['/primary', '/fallback']); assertUnconditional(f.requests)
    assert.deepEqual(fs.readFileSync(dest), body); assert.equal(contentSha1(fs.readFileSync(dest)), contentSha1(body))
  } finally { await f.close() }
})

test('404 不重试同一 URL，立即切换备用地址', async () => {
  let missingHits = 0
  let okHits = 0
  const payload = Buffer.from('valid fallback payload')
  const server = http.createServer((req, res) => {
    if (req.url === '/missing') {
      missingHits++
      res.writeHead(404).end('missing')
      return
    }
    okHits++
    res.writeHead(200, { 'content-length': String(payload.length) }).end(payload)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kamucl-fallback-test-'))
  const dest = path.join(root, 'resource.jar')
  try {
    const base = `http://127.0.0.1:${address.port}`
    await downloadFile(`${base}/missing`, dest, undefined, undefined, 'official', undefined, [
      `${base}/ok`
    ])
    assert.equal(missingHits, 1)
    assert.equal(okHits, 1)
    assert.deepEqual(await fs.promises.readFile(dest), payload)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})

test('临时 503 使用退避重试，内容哈希错误则直接切换来源', async () => {
  let flakyHits = 0
  let corruptHits = 0
  let goodHits = 0
  const good = Buffer.from('verified content')
  const sha1 = crypto.createHash('sha1').update(good).digest('hex')
  const server = http.createServer((req, res) => {
    if (req.url === '/flaky') {
      flakyHits++
      if (flakyHits < 3) return void res.writeHead(503).end('retry')
      return void res.end(good)
    }
    if (req.url === '/corrupt') {
      corruptHits++
      return void res.end('corrupt')
    }
    goodHits++
    res.end(good)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kamucl-retry-test-'))
  try {
    const base = `http://127.0.0.1:${address.port}`
    await downloadFile(`${base}/flaky`, path.join(root, 'flaky.bin'))
    assert.equal(flakyHits, 3)

    await downloadFile(
      `${base}/corrupt`,
      path.join(root, 'verified.bin'),
      undefined,
      sha1,
      'official',
      undefined,
      [`${base}/good`]
    )
    assert.equal(corruptHits, 1)
    assert.equal(goodHits, 1)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})

test('404 持续响应体被关闭后切换来源，不遗留幽灵网络流', async () => {
  let closed = false
  let resolveClosed!: () => void
  const closedPromise = new Promise<void>(resolve => { resolveClosed = resolve })
  const server = http.createServer((req, res) => {
    if (req.url === '/missing') {
      res.writeHead(404)
      res.write('missing')
      const timer = setInterval(() => res.write('still streaming'), 20)
      res.once('close', () => { clearInterval(timer); closed = true; resolveClosed() })
    } else res.end('ok')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kamucl-response-close-'))
  let timeout: NodeJS.Timeout | undefined
  try {
    const base = `http://127.0.0.1:${address.port}`
    await downloadFile(`${base}/missing`, path.join(root, 'ok'), undefined, undefined, 'official', undefined, [`${base}/ok`])
    await Promise.race([closedPromise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('404 流没有被关闭')), 1000) })])
    assert.ok(closed)
    assert.equal(await fs.promises.readFile(path.join(root, 'ok'), 'utf8'), 'ok')
  } finally {
    clearTimeout(timeout)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})
