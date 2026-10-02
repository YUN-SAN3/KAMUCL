import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { versionInstallHarness } from './helpers/version-install-harness'

for (const mode of ['success', 'processor-error', 'cancel'] as const) test(`加载器只等本体与依赖，资源保持并行；${mode} 必须排空后结束`, { timeout: 10000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-ready-')), game = path.join(root, 'game')
  const bodies = { client: Buffer.from('client'), lib: Buffer.from('library'), asset: Buffer.from('asset') }
  const hash = (bytes: Buffer) => crypto.createHash('sha1').update(bytes).digest('hex')
  const index = Buffer.from(JSON.stringify({ objects: { a: { hash: hash(bodies.asset), size: bodies.asset.length } } }))
  let assetResponse: http.ServerResponse | undefined, sawAsset!: () => void, assetClosed!: () => void
  const assetStarted = new Promise<void>(r => { sawAsset = r }), drained = new Promise<void>(r => { assetClosed = r })
  const controller = new AbortController()
  const server = http.createServer((req, res) => {
    if (req.url === '/asset') { assetResponse = res; res.once('close', assetClosed); sawAsset(); return }
    if (req.url === '/index') { res.end(index); return }
    res.end(bodies[req.url!.slice(1) as 'client' | 'lib'])
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const versionDir = path.join(game, 'versions', 'fixture'); fs.mkdirSync(versionDir, { recursive: true })
  fs.writeFileSync(path.join(versionDir, 'fixture.json'), JSON.stringify({ id: 'fixture',
    downloads: { client: { url: base + '/client', size: bodies.client.length, sha1: hash(bodies.client) } },
    libraries: [{ downloads: { artifact: { path: 'a/lib.jar', url: base + '/lib', size: bodies.lib.length, sha1: hash(bodies.lib) } } }],
    assetIndex: { id: 'fixture', url: base + '/index', size: index.length, sha1: hash(index) } }))
  const runtime = await versionInstallHarness(root, fetch, url => url.includes('resources.download.minecraft.net') ? base + '/asset' : url)
  Object.assign(runtime.getSettings(), { gameDir: game, activeFolder: game, folders: [{ path: game, name: 'test', isDefault: true }], mirror: 'official' })
  let invoked = false
  try {
    const work = runtime.installVanilla('fixture', () => {}, 'versions', undefined, controller.signal, false, async signal => {
      invoked = true
      assert.deepEqual(fs.readFileSync(path.join(versionDir, 'fixture.jar')), bodies.client)
      assert.deepEqual(fs.readFileSync(path.join(game, 'libraries/a/lib.jar')), bodies.lib)
      await assetStarted
      if (mode === 'success') { assetResponse!.end(bodies.asset); return }
      if (mode === 'processor-error') throw Error('processor failed')
      controller.abort(Error('cancelled test'))
      await new Promise<void>(resolve => signal.aborted ? resolve() : signal.addEventListener('abort', () => resolve(), { once: true }))
      signal.throwIfAborted()
    })
    if (mode === 'success') { await work; assert(!fs.existsSync(path.join(versionDir, '.installing'))) }
    else { await assert.rejects(work, mode === 'cancel' ? /cancelled/ : /processor failed/); await drained }
    assert(invoked)
  } finally { controller.abort(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await runtime.closeHttpClient(); fs.rmSync(root, { recursive: true, force: true }) }
})
