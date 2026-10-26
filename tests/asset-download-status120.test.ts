import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assetDownloadStatus } from '../src/shared/assetDownloadStatus'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { versionInstallHarness } from './helpers/version-install-harness'

test('asset tail identifies actual active logical files without changing the count', () => {
  assert.equal(assetDownloadStatus(3574, 3575, { activeFiles: ['minecraft/sounds/music/menu.ogg'] }),
    '下载资源文件 3574/3575 · 正在处理 minecraft/sounds/music/menu.ogg')
  assert.equal(assetDownloadStatus(10, 3575, { activeFiles: ['a'] }), '下载资源文件 10/3575')
  assert.equal(assetDownloadStatus(3575, 3575, { activeFiles: ['a'] }), '下载资源文件 3575/3575')
  assert.equal(assetDownloadStatus(0, 1, {}), '下载资源文件 0/1')
})

test('asset wait describes the actual server deadline, switching and paused state', () => {
  const wait = { reason: 'rate-limit' as const, action: 'waiting' as const, retryAt: 5500 }
  assert.equal(assetDownloadStatus(1, 3, { waits: [wait], activeFiles: ['a'] }, 1000), '下载资源文件 1/3 · 下载源限流，5 秒后重试')
  assert.equal(assetDownloadStatus(1, 3, { waits: [wait] }, 5500), '下载资源文件 1/3')
  assert.equal(assetDownloadStatus(1, 3, { waits: [wait], paused: true }, 1000), '下载资源文件 1/3')
  assert.equal(assetDownloadStatus(1, 3, { waits: [{ ...wait, action: 'switching' }] }, 1000), '下载资源文件 1/3 · 下载源限流，切换备用来源')
})

test('real vanilla asset pipeline deduplicates hashes and reports the index name of its remaining file', { timeout: 12000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl asset120 ')), game = path.join(root, 'game')
  const payload = Buffer.from('synthetic asset120'), client = Buffer.from('synthetic client120')
  const sha1 = (value: Buffer) => crypto.createHash('sha1').update(value).digest('hex')
  const hash = sha1(payload)
  let base = '', assetRequests = 0
  const index = Buffer.from(JSON.stringify({ objects: {
    'minecraft/sounds/test120.ogg': { hash, size: payload.length },
    'minecraft/sounds/duplicate120.ogg': { hash, size: payload.length }
  } }))
  const server = http.createServer((req, res) => {
    if (req.url === '/version') return res.end(JSON.stringify({ id: '1.20.1', libraries: [], mainClass: 'fixture.Main',
      downloads: { client: { url: base + '/client', sha1: sha1(client), size: client.length } },
      assetIndex: { id: 'fixture120', url: base + '/index', sha1: sha1(index), size: index.length } }))
    if (req.url === '/client') return res.end(client)
    if (req.url === '/index') return res.end(index)
    if (req.url === `/${hash.slice(0, 2)}/${hash}`) {
      assetRequests++; setTimeout(() => { res.writeHead(200, { 'content-length': payload.length }); res.end(payload) }, 800)
      return
    }
    res.writeHead(404); res.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let runtime: Awaited<ReturnType<typeof versionInstallHarness>> | undefined
  try {
    runtime = await versionInstallHarness(root,
      async () => Response.json({ versions: [{ id: '1.20.1', type: 'release', url: base + '/version', releaseTime: '2023-01-01' }] }),
      url => url.replace('https://resources.download.minecraft.net', base))
    Object.assign(runtime.getSettings(), { gameDir: game, activeFolder: game, folders: [{ path: game, isDefault: true }], mirror: 'official' })
    const texts: string[] = []
    await runtime.installVanilla('1.20.1', event => {
      texts.push(event.text)
      for (const stage of event.parallelStages ?? []) texts.push(stage.text ?? '')
    })
    assert.equal(assetRequests, 1)
    assert(texts.some(text => text.includes('下载资源文件 0/1 · 正在处理 minecraft/sounds/test120.ogg')))
    assert.deepEqual(fs.readFileSync(path.join(game, 'assets', 'objects', hash.slice(0, 2), hash)), payload)
    assert(texts.some(text => text.includes('安装成功')))
  } finally {
    await runtime?.closeHttpClient()
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(root, { recursive: true, force: true })
  }
})
