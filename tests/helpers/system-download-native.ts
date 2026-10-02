import { app, session } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { systemDownload, usesSystemProxy } from '../../src/main/core/systemDownload'
import { downloadFetch } from '../../src/main/core/downloadFetch'
import { downloadFile } from '../../src/main/core/download'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-native-http-'))
app.setPath('userData', path.join(root, 'profile'))
void app.whenReady().then(async () => {
  const bytes = crypto.randomBytes(3 * 1024 * 1024), sha1 = crypto.createHash('sha1').update(bytes).digest('hex')
  let destinationHits = 0, streamingClosed = false
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: '/file' }); res.end(); return }
    if (req.url === '/stream') {
      res.writeHead(200, { 'content-type':'application/octet-stream', 'content-length': bytes.length }); res.write(bytes.subarray(0, 4096))
      res.on('close', () => { streamingClosed = true }); return
    }
    destinationHits++
    const match = req.headers.range?.match(/bytes=(\d+)-(\d*)/), start = Number(match?.[1] ?? 0), end = Number(match?.[2] || bytes.length - 1)
    res.writeHead(match ? 206 : 200, { 'content-length': end - start + 1,
      ...(match ? { 'content-range': `bytes ${start}-${end}/${bytes.length}` } : {}) })
    res.end(bytes.subarray(start, end + 1))
  })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    await session.defaultSession.setProxy({ mode: 'direct' })
    assert.equal(await usesSystemProxy(base), false)
    const redirect = await systemDownload(base + '/redirect', {})
    assert.equal(redirect.status, 302); assert.equal(destinationHits, 0)
    assert.equal(new URL(redirect.headers.get('location')!, base).pathname, '/file')
    const result = await downloadFetch(base + '/redirect', { systemProxy: true, headers: { Range: 'bytes=3-8' } })
    assert.equal(result.status, 206); assert.equal(result.url, base + '/file')
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes.subarray(3, 9))
    const head = await systemDownload(base + '/file', { method: 'HEAD' })
    assert.equal(head.body, null); assert.equal(head.headers.get('content-length'), String(bytes.length))
    const controller = new AbortController()
    const stream = await systemDownload(base + '/stream', { signal: controller.signal }), reader = stream.body!.getReader()
    assert.equal((await reader.read()).value?.length, 4096, 'body is streamed before the server finishes')
    const reading = reader.read(); controller.abort(new Error('test cancellation'))
    await assert.rejects(reading, /test cancellation|abort/i)
    await new Promise(resolve => setTimeout(resolve, 50)); assert(streamingClosed)
    const cancelled = new AbortController(); cancelled.abort(new Error('already cancelled'))
    await assert.rejects(systemDownload(base, { signal: cancelled.signal }), /already cancelled/)
    await downloadFile(base + '/redirect', path.join(root, 'payload'), undefined, sha1, 'official', undefined, [], { size: bytes.length, systemProxy: true })
    assert.deepEqual(fs.readFileSync(path.join(root, 'payload')), bytes)
    await session.defaultSession.setProxy({ proxyRules: 'http=127.0.0.1:9', proxyBypassRules: '<-loopback>' })
    assert.equal(await usesSystemProxy(base), true)
    console.log('NATIVE_DOWNLOAD_OK: redirect / Range / streaming / cancellation / HEAD / checksum / current proxy')
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await session.defaultSession.setProxy({ mode: 'direct' }) }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1) })
