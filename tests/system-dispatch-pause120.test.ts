import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { build } from 'esbuild'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
let bundled: Promise<string> | undefined
/** Real production dispatch and pause state; only Electron's module lookup is
 * held at its actual await boundary and its transport adapts to local HTTP.
 * Lexical process injection keeps aggregate tests' global runtime unchanged.
 */
async function fixture(run: (api: any, root: string, module: any, transport: any) => Promise<void>) {
  const temporaryBase = fs.realpathSync.native(os.tmpdir()), prefix = 'kamucl-system-dispatch120-'
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(temporaryBase, prefix)))
  assert.equal(fs.realpathSync.native(root), root)
  const requests: string[] = [], calls: Array<{ transport: string; url: string; paused: boolean }> = []
  const server = http.createServer((req, res) => { requests.push(req.url!); res.end('0123456789012345678901234567890123456789') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const local = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  const gates = new Map<string, { entered: ReturnType<typeof Promise.withResolvers<void>>; ready: ReturnType<typeof Promise.withResolvers<any>> }>()
  for (const name of ['httpClient', 'systemDownload']) gates.set(name, { entered: Promise.withResolvers<void>(), ready: Promise.withResolvers<any>() })
  const deferred = { loadElectron(name: string) { const gate = gates.get(name)!; gate.entered.resolve(); return gate.ready.promise } }
  let api: any
  const electron = { app: { getPath: (key: string) => path.join(root, key), getVersion: () => 'test', getName: () => 'System-dispatch-test', isPackaged: false }, net: {
    fetch: async (url: string, init: RequestInit) => { calls.push({ transport: 'fetch', url, paused: api.isTaskPaused(init.signal) }); return fetch(local + new URL(url).pathname, init) },
    request: (options: any) => {
      calls.push({ transport: 'request', url: options.url, paused: api.isTaskPaused(transport.currentSignal) })
      const event = new EventEmitter() as EventEmitter & { end: (body?: string) => void; abort: () => void }
      let request: http.ClientRequest | undefined
      event.end = body => { request = http.request(local + new URL(options.url).pathname, { method: options.method, headers: options.headers }, response => event.emit('response', response)); request.on('error', error => event.emit('error', error)); request.end(body) }
      event.abort = () => request?.destroy()
      return event
    }
  } }
  const transport = { local, calls, requests, electron, currentSignal: undefined as AbortSignal | undefined }
  const require = createRequire(path.resolve('package.json')), mod = { exports: {} }
  const code = await (bundled ??= build({ stdin: { contents: "export {httpFetch,closeHttpClient} from './src/main/core/httpClient';export {systemDownload} from './src/main/core/systemDownload';export {prepareLegacyForgeInstaller} from './src/main/core/legacyForgeInstaller';export {registerTask,pauseTask,resumeTask,finishTask,isTaskPaused} from './src/main/core/tasks';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', logLevel: 'silent', plugins: [{ name: 'defer-exact-module-await', setup(builder) {
    builder.onLoad({ filter: /[\\/]core[\\/](httpClient|systemDownload)\.ts$/ }, input => ({ loader: 'ts', contents: fs.readFileSync(input.path, 'utf8').replaceAll("import('electron')", `__moduleFixture.loadElectron('${path.basename(input.path, '.ts')}')`) }))
  } }] }).then(result => result.outputFiles[0].text))
  new Function('require', 'module', 'exports', 'process', '__moduleFixture', code)(name => name === 'electron' ? electron : require(name), mod, mod.exports, { ...process, versions: { ...process.versions, electron: '44.3.0-test' } }, deferred)
  api = mod.exports
  try { await run(api, root, gates, transport) }
  finally {
    for (const gate of gates.values()) gate.ready.resolve(electron)
    await api.closeHttpClient(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    const relative = path.relative(temporaryBase, root)
    assert(relative.startsWith(prefix) && relative === path.basename(root) && !path.isAbsolute(relative))
    assert.equal(path.dirname(root), temporaryBase)
    assert.equal(fs.realpathSync.native(root), root)
    fs.rmSync(root, { recursive: true, force: true })
  }
}

for (const manual of [false, true]) {
  const kind = manual ? 'manual net.request' : 'following net.fetch'
  const moduleName = manual ? 'systemDownload' : 'httpClient'
  test(`${kind} dispatch rechecks a task paused while Electron's module import was pending`, { timeout: 5000 }, async () => fixture(async (api, _root, modules, transport) => {
    const task = api.registerTask('Deferred Electron import', 'download'); transport.currentSignal = task.controller.signal
    const work = api.httpFetch('https://libraries.minecraft.net/checked.jar', { signal: task.controller.signal, systemProxy: true, ...(manual ? { redirect: 'manual' } : {}) })
    try {
      await modules.get(moduleName).entered.promise; assert(api.pauseTask(task.id)); modules.get(moduleName).ready.resolve(transport.electron)
      await delay(150); assert.equal(transport.calls.length, 0); assert.equal(transport.requests.length, 0); assert.equal(api.isTaskPaused(task.controller.signal), true)
      api.resumeTask(task.id); const response = await work; assert.equal(await response.text(), '0123456789012345678901234567890123456789')
      assert.equal(transport.calls.length, 1); assert.equal(transport.calls[0].paused, false); assert.deepEqual(transport.requests, ['/checked.jar'])
    } finally { api.resumeTask(task.id); await work.catch(() => {}); api.finishTask(task.id) }
  }))
  test(`${kind} cancellation at the module boundary sends no request and clears the paused waiter`, { timeout: 5000 }, async () => fixture(async (api, _root, modules, transport) => {
    const task = api.registerTask('Cancelled Electron import', 'download'); transport.currentSignal = task.controller.signal
    const work = api.httpFetch('https://libraries.minecraft.net/never.jar', { signal: task.controller.signal, systemProxy: true, ...(manual ? { redirect: 'manual' } : {}) })
    void work.catch(() => {})
    try {
      await modules.get(moduleName).entered.promise; api.pauseTask(task.id); modules.get(moduleName).ready.resolve(transport.electron)
      await delay(100); task.controller.abort(new Error('cancel import boundary'))
      await assert.rejects(work, /已取消|cancel import boundary/); assert.equal(transport.calls.length, 0); assert.equal(transport.requests.length, 0)
    } finally { api.finishTask(task.id) }
  }))
  test(`${kind} honors a pre-aborted signal without creating a transport`, async () => fixture(async (api, _root, modules, transport) => {
    const controller = new AbortController(); controller.abort(new Error('pre-aborted dispatch'))
    const work = api.httpFetch('https://libraries.minecraft.net/never.jar', { signal: controller.signal, systemProxy: true, ...(manual ? { redirect: 'manual' } : {}) })
    await modules.get(moduleName).entered.promise; modules.get(moduleName).ready.resolve(transport.electron)
    await assert.rejects(work, /已取消|pre-aborted dispatch/); assert.equal(transport.calls.length, 0); assert.equal(transport.requests.length, 0)
  }))
  test(`${kind} without a registered task preserves its ordinary immediate request`, async () => fixture(async (api, _root, modules, transport) => {
    const controller = new AbortController(); transport.currentSignal = controller.signal
    const work = api.httpFetch('https://libraries.minecraft.net/ordinary.jar', { signal: controller.signal, systemProxy: true, ...(manual ? { redirect: 'manual' } : {}) })
    await modules.get(moduleName).entered.promise; modules.get(moduleName).ready.resolve(transport.electron)
    const response = await work; assert.equal(await response.text(), '0123456789012345678901234567890123456789')
    assert.equal(transport.calls.length, 1); assert.deepEqual(transport.requests, ['/ordinary.jar'])
  }))
}

test('legacy checksum AbortSignal.any inherits pause state through the actual httpClient module await', { timeout: 5000 }, async () => fixture(async (api, root, modules, transport) => {
  const task = api.registerTask('Legacy derived sidecar signal', 'version')
  const libraries = path.join(root, 'libraries'), work = api.prepareLegacyForgeInstaller({ profile: { id: 'Fixture', inheritsFrom: '1.7.10' }, libraries: [{ name: 'fixture:client:1', relative: 'fixture/client/1/client-1.jar', url: 'https://libraries.minecraft.net/fixture/client/1/client-1.jar', checksums: [] }] }, libraries, 'official', () => {}, task.controller.signal)
  void work.catch(() => {})
  try {
    await modules.get('httpClient').entered.promise; api.pauseTask(task.id); modules.get('httpClient').ready.resolve(transport.electron)
    await delay(150); assert.equal(transport.calls.length, 0); assert.equal(transport.requests.length, 0)
    task.controller.abort(new Error('cancel derived sidecar'))
    await assert.rejects(work, /已取消|cancel derived sidecar/)
    assert.equal(transport.calls.length, 0); assert.deepEqual(fs.readdirSync(libraries), [])
  } finally { api.finishTask(task.id); await work.catch(() => {}) }
}))
