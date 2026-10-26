import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import sharp from 'sharp'
import type { Account } from '../src/shared/types'

const compiled = build({ entryPoints: ['src/main/core/offlineSkinLaunch.ts'], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'offline-preparation-services', setup(builder) {
    builder.onResolve({ filter: /^\.\/(skins|yggdrasil)$/ }, args => ({ path: args.path.slice(2), external: true }))
  } }] })
const png = sharp({ create: { width: 64, height: 64, channels: 4, background: '#cf8055' } }).png().toBuffer()
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const account = (): Account => ({ id: 'captured-A', type: 'offline', uuid: 'a'.repeat(32), username: 'PlayerA' })
async function promptly(pending: Promise<unknown>, reason: Error) {
  let timer: NodeJS.Timeout | undefined
  await Promise.race([assert.rejects(pending, error => error === reason), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error('cancelled preparation kept waiting for shared work')), 500)
  })]).finally(() => clearTimeout(timer))
}
async function fixture(options: {
  snapshot?: (value: any) => Promise<any>; injector?: () => Promise<string>
  generateKeyPair?: (callback: (error: Error | null, publicKey: Buffer, privateKey: Buffer) => void) => void
  onListen?: () => void; onWrite?: () => void
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL preparation118 ')), bytes = await png
  const filePath = path.join(root, 'skin.png'); fs.writeFileSync(filePath, bytes)
  fs.writeFileSync(path.join(root, 'kamucl-offline-skin.jar'), 'bundled-agent-fixture')
  const snapshot = { filePath, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), variant: 'slim' }
  const observed = { skinIds: [] as string[], injector: 0, keys: 0, servers: [] as net.Server[] }
  const require = createRequire(path.resolve('package.json')), module = { exports: {} as any }
  const fixtures: Record<string, unknown> = {
    electron: { app: { getPath: () => root } },
    skins: { getOfflineSkin: (id: string) => { observed.skinIds.push(id); return options.snapshot?.(snapshot) ?? Promise.resolve(snapshot) } },
    yggdrasil: { ensureAuthlibInjector: () => { observed.injector++; return options.injector?.() ?? Promise.resolve('cached-injector.jar') } },
    'node:crypto': { ...crypto, generateKeyPair: (algorithm: any, settings: any, callback: any) => {
      observed.keys++
      if (options.generateKeyPair) options.generateKeyPair(callback)
      else crypto.generateKeyPair(algorithm, settings, callback)
    } },
    'node:net': { ...net, createServer: (listener: (socket: net.Socket) => void) => {
      const server = net.createServer(listener); observed.servers.push(server)
      if (options.onListen) {
        const listen = server.listen
        server.listen = function (...args: any[]) {
          const callback = args.pop(); args.push(() => { options.onListen!(); callback() })
          return listen.apply(this, args as any)
        } as typeof server.listen
      }
      return server
    } },
    'node:fs': { ...fs, writeFileSync: (...args: any[]) => {
      const result = (fs.writeFileSync as any)(...args)
      if (String(args[0]).endsWith('.properties.tmp')) options.onWrite?.()
      return result
    } }
  }
  new Function('require', 'module', 'exports', '__dirname', (await compiled).outputFiles[0].text)(
    (name: string) => name in fixtures ? fixtures[name] : require(name), module, module.exports, root)
  return { root, snapshot, observed, prepare: module.exports.prepareOfflineSkinLaunch,
    clean: () => { for (const server of observed.servers) if (server.listening) server.close(); fs.rmSync(root, { recursive: true, force: true }) } }
}

test('actual preparation promptly cancels a slow snapshot read and never starts late component or session work', async () => {
  const getter = deferred<any>(), controller = new AbortController(), reason = Error('snapshot cancelled')
  const f = await fixture({ snapshot: () => getter.promise })
  try {
    const pending = f.prepare(account(), controller.signal)
    controller.abort(reason); await promptly(pending, reason)
    getter.resolve(f.snapshot); await new Promise<void>(resolve => setImmediate(resolve))
    assert.deepEqual(f.observed.skinIds, ['captured-A']); assert.equal(f.observed.injector, 0)
    assert.equal(f.observed.keys, 0); assert.equal(f.observed.servers.length, 0)
    assert.equal(fs.existsSync(path.join(f.root, 'offline-skin-sessions')), false)
  } finally { f.clean() }
})

test('actual preparation detaches a slow shared injector, ignores its late cache result, and allows a fresh launch', async () => {
  const injector = deferred<string>(), entered = deferred<void>(), controller = new AbortController(), reason = Error('injector cancelled')
  const f = await fixture({ injector: () => { entered.resolve(); return injector.promise } })
  let launch: any
  try {
    const captured = account(), pending = f.prepare(captured, controller.signal)
    await entered.promise; controller.abort(reason); await promptly(pending, reason)
    injector.resolve('completed-shared-cache.jar'); await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(f.observed.keys, 0); assert.equal(f.observed.servers.length, 0)
    assert.equal(fs.existsSync(path.join(f.root, 'offline-skin-sessions')), false)
    launch = await f.prepare(captured, new AbortController().signal)
    assert.equal(f.observed.injector, 2); assert.equal(f.observed.servers.length, 1)
    await launch.dispose()
    assert.deepEqual(fs.readdirSync(path.join(f.root, 'offline-skin-sessions')), [])
  } finally { await launch?.dispose(); f.clean() }
})

test('actual preparation captures account identity before awaiting the injector', async () => {
  const injector = deferred<string>(), entered = deferred<void>()
  const f = await fixture({ injector: () => { entered.resolve(); return injector.promise } })
  let launch: any
  try {
    const captured = account(), pending = f.prepare(captured)
    await entered.promise; captured.id = 'B'; captured.username = 'PlayerB'; captured.uuid = 'b'.repeat(32)
    injector.resolve('cached.jar'); launch = await pending
    const config = Buffer.from(launch.args[0].split('=')[1], 'base64url').toString('utf8')
    const properties = fs.readFileSync(config, 'utf8')
    assert(properties.includes('uuid=' + 'a'.repeat(32)))
    assert(properties.includes('username64=' + Buffer.from('PlayerA').toString('base64')))
    assert.deepEqual(f.observed.skinIds, ['captured-A'])
  } finally { await launch?.dispose(); f.clean() }
})

test('cancellation during actual RSA preparation never reserves a port after the crypto callback arrives', async () => {
  const entered = deferred<void>(), controller = new AbortController(), reason = Error('RSA cancelled')
  let callback!: (error: Error | null, publicKey: Buffer, privateKey: Buffer) => void
  const f = await fixture({ generateKeyPair: done => { callback = done; entered.resolve() } })
  try {
    const pending = f.prepare(account(), controller.signal)
    await entered.promise; controller.abort(reason); await promptly(pending, reason)
    callback(null, Buffer.from('public'), Buffer.from('private')); await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(f.observed.servers.length, 0)
    assert.equal(fs.existsSync(path.join(f.root, 'offline-skin-sessions')), false)
  } finally { f.clean() }
})

test('cancellation after binding or writing closes the actual reserved socket and removes partial session files', async () => {
  for (const step of ['listen', 'write'] as const) {
    const controller = new AbortController(), reason = Error(step + ' cancelled')
    const f = await fixture({ [step === 'listen' ? 'onListen' : 'onWrite']: () => controller.abort(reason) })
    try {
      await assert.rejects(f.prepare(account(), controller.signal), error => error === reason)
      assert.equal(f.observed.servers.length, 1); assert.equal(f.observed.servers[0].listening, false)
      const directory = path.join(f.root, 'offline-skin-sessions')
      assert.deepEqual(fs.existsSync(directory) ? fs.readdirSync(directory) : [], [])
    } finally { f.clean() }
  }
})

test('a pre-cancelled actual preparation performs no snapshot, component or crypto work', async () => {
  const controller = new AbortController(), reason = Error('already cancelled'); controller.abort(reason)
  const f = await fixture()
  try {
    await assert.rejects(f.prepare(account(), controller.signal), error => error === reason)
    assert.deepEqual(f.observed.skinIds, []); assert.equal(f.observed.injector, 0); assert.equal(f.observed.keys, 0)
    assert.equal(f.observed.servers.length, 0)
  } finally { f.clean() }
})
