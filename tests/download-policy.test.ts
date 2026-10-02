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
  mirrorUrl
} from '../src/main/core/download'

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
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(classifyHttpStatus(status), 'transient')
  }
  for (const status of [400, 401, 403, 422, 501, 505]) {
    assert.equal(classifyHttpStatus(status), 'fatal')
  }
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
