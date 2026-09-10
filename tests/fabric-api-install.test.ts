import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as vue from 'vue'
import type { ProgressEvent } from '../src/shared/types'
import { versionInstallHarness } from './helpers/version-install-harness'

const sha1 = (data: Buffer) => crypto.createHash('sha1').update(data).digest('hex')

for (const isolated of [true, false]) {
  test(`Fabric API uses the final ${isolated ? 'isolated' : 'shared'} mods directory before reporting success`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-fabric-install-'))
    const game = path.join(root, 'game'), other = path.join(root, 'other')
    const id = '自定义 Fabric 实例'
    const payload = Buffer.from('fabric-api fixture bytes')
    const client = Buffer.from('client fixture bytes')
    const events: ProgressEvent[] = []
    let apiRequests = 0
    const server = http.createServer((req, res) => {
      const data = req.url === '/client.jar' ? client : payload
      if (req.url === '/fabric-api.jar') {
        apiRequests++
        assert(!events.some(e => e.stage === 'done'), 'must not report success before API arrives')
        if (isolated) assert.equal(JSON.parse(fs.readFileSync(path.join(game, 'versions', id, `${id}.json`), 'utf8'))._gameDir, true)
      }
      res.writeHead(200, { 'content-length': data.length }); res.end(data)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
    let runtime: Awaited<ReturnType<typeof versionInstallHarness>> | undefined
    try {
      runtime = await versionInstallHarness(root, async (input) => {
        const url = String(input)
        if (url.includes('/profile/json')) {
          // Simulate changing folders/settings while the accepted install is awaiting the loader profile.
          Object.assign(runtime!.getSettings(), { activeFolder: other, defaultIsolation: !isolated })
          return Response.json({ id: 'fabric-loader-0.19.5-26.2', inheritsFrom: '26.2', mainClass: 'fabric.Main', libraries: [] })
        }
        assert(url.includes('/project/fabric-api/version'))
        assert.equal(new URL(url).searchParams.get('game_versions'), '["26.2"]')
        return Response.json([{ version_number: 'test+26.2', files: [{ primary: true, filename: 'fabric-api.jar', url: `${base}/fabric-api.jar`, hashes: { sha1: sha1(payload) } }] }])
      })
      Object.assign(runtime.getSettings(), { gameDir: game, activeFolder: game, folders: [{ path: game, isDefault: true }], defaultIsolation: isolated, mirror: 'official' })
      const baseDir = path.join(game, '.kamucl/base/26.2')
      fs.mkdirSync(baseDir, { recursive: true })
      fs.writeFileSync(path.join(baseDir, '26.2.json'), JSON.stringify({ id: '26.2', libraries: [], downloads: { client: { url: `${base}/client.jar`, sha1: sha1(client), size: client.length } } }))
      const installedId = await runtime.installVersion('26.2', { loader: 'fabric', loaderVersion: '0.19.5', fabricApi: 'test+26.2', instanceName: id }, e => events.push(e))
      assert.equal(installedId, id)
      const target = isolated ? path.join(game, 'versions', id) : game
      assert.equal(sha1(fs.readFileSync(path.join(target, 'mods/fabric-api.jar'))), sha1(payload))
      assert.equal(apiRequests, 1)
      assert(!fs.existsSync(path.join(isolated ? game : path.join(game, 'versions', id), 'mods/fabric-api.jar')))
      assert(!fs.existsSync(path.join(other, 'versions', id)))
      assert.equal(events.filter(e => e.stage === 'done').length, 1)
      assert.equal(events.at(-1)?.stage, 'done')
      assert(events.filter(e => e.stage === 'fabric-api').every(e => e.overall! < 1))
      runtime.getSettings().activeFolder = game
      const listed = runtime.listInstalled().find(v => v.id === id)!
      assert.equal(listed.isolated, isolated)
      assert.equal(path.resolve(listed.gameDirectory!), path.resolve(target))

      // Requested API lookup failures must propagate without a success event or silent skip.
      events.length = 0
      await assert.rejects(runtime.installVersion('26.2', { loader: 'fabric', loaderVersion: '0.19.5', fabricApi: 'missing-version', instanceName: 'failed-api' }, e => events.push(e)), /未找到适配/)
      assert(!events.some(e => e.stage === 'done'))
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await runtime?.closeHttpClient()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
}

test('Fabric selection waits for API metadata, retries failures, and ignores stale modal requests', async () => {
  // Execute the actual SFC setup, keeping its watchers/computed values; omit DOM-only lifecycle hooks.
  const result = await build({
    entryPoints: ['src/renderer/src/views/GameView.vue'], bundle: true, write: false,
    format: 'cjs', platform: 'node', packages: 'external',
    plugins: [{ name: 'game-setup', setup(build) {
      build.onResolve({ filter: /^\.\.\/(api|store)$/ }, args => ({ path: args.path.slice(3), external: true }))
      build.onLoad({ filter: /\.vue$/ }, args => {
        if (!args.path.endsWith('GameView.vue')) return { contents: 'export default {}', loader: 'js' }
        const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'))
        return { contents: compileScript(descriptor, { id: args.path }).content, loader: 'ts', resolveDir: path.dirname(args.path) }
      })
    } }]
  })
  const pending: Array<{ mc: string; resolve: (v: any) => void; reject: (e: Error) => void }> = []
  const installs: any[] = []
  const api = {
    listLoaders: async () => ['0.19.5'],
    listFabricApi: (mc: string) => new Promise((resolve, reject) => pending.push({ mc, resolve, reject })),
    installVersion: async (...args: any[]) => { installs.push(args) },
    errText: (e: Error) => e.message
  }
  const store = { store: vue.reactive({ installed: [], installing: new Set(), searchKeyword: '' }), toast: () => {} }
  const require = createRequire(path.resolve('package.json'))
  const exported = { exports: {} as any }
  new Function('require', 'module', 'exports', 'localStorage', result.outputFiles[0].text)(
    (name: string) => name === 'vue' ? { ...vue, onMounted: () => {}, onUnmounted: () => {} }
      : name === 'api' ? api : name === 'store' ? store : require(name),
    exported, exported.exports, { getItem: () => null, setItem: () => {} }
  )
  const scope = vue.effectScope()
  const state = scope.run(() => exported.exports.default.setup({}, { expose: () => {} }))
  const flush = async () => { await vue.nextTick(); await Promise.resolve(); await vue.nextTick() }
  try {
    state.openInstall({ id: '26.2' }); state.modal.loader = 'fabric'
    await flush()
    assert(state.modal.loadingApi)
    assert.equal(state.canConfirm.value, false)
    await state.confirmInstall()
    assert.equal(installs.length, 0)
    pending.shift()!.reject(new Error('network unavailable'))
    await flush()
    assert.equal(state.canConfirm.value, false)
    state.modal.apiOn = false
    assert.equal(state.canConfirm.value, true, 'explicit opt-out still permits loader-only installation')
    state.modal.apiOn = true
    state.apiRetry.value++
    await flush()
    pending.shift()!.resolve([{ version: 'api+26.2' }])
    await flush()
    assert.equal(state.canConfirm.value, true)
    await state.confirmInstall()
    assert.equal(installs[0][1].fabricApi, 'api+26.2')

    state.openInstall({ id: 'old-mc' }); state.modal.loader = 'fabric'
    await flush()
    const old = pending.shift()!
    state.modal.open = false
    await flush()
    state.openInstall({ id: 'new-mc' }); state.modal.loader = 'fabric'
    await flush()
    const current = pending.shift()!
    assert.equal(current.mc, 'new-mc')
    old.resolve([{ version: 'wrong-api' }])
    await flush()
    assert.equal(state.modal.apiVersion, '')
    assert.equal(state.canConfirm.value, false)
    current.resolve([])
    await flush()
    assert.equal(state.canConfirm.value, false, 'empty API list must not silently skip the requested API')
    assert.match(state.modal.apiError, /暂无适配/)
  } finally { scope.stop() }
})
