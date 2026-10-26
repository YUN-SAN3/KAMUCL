import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { FrpSecureStore, frpCredentialIdentity } from '../src/main/core/frpSecureStore'
import { FrpManager, type FrpRegistry, type TunnelWorker } from '../src/main/core/frpManager'
import type { FrpConfig, FrpState, FrpEvent } from '../src/main/core/frp'
import { FrpCipherFixture } from './helpers/frpCipherFixture'

function fixture(t: test.TestContext, options: { rename?(from: string, to: string): void; platform?: string } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-frp-secure122-')), file = path.join(dir, 'frp-tunnels.json'), legacy = path.join(dir, 'frp-config.json')
  t.after(() => { assert(fs.realpathSync(dir).startsWith(fs.realpathSync(os.tmpdir()) + path.sep + 'kamucl-frp-secure122-')); fs.rmSync(dir, { recursive: true, force: true }) })
  const storage = new FrpCipherFixture(), store = new FrpSecureStore(storage, options.platform || 'win32', options.rename ? { rename: options.rename } : undefined)
  const key = 'synthetic-frp-private-key-122', id = frpCredentialIdentity(key, '42')
  const registry: FrpRegistry = { version: 2, accessKey: key, tunnels: [{ id, config: { accessKey: key, tunnelId: '42', localPort: 25565 }, name: 'Fixture tunnel', nodeName: 'Fixture node', localIp: '127.0.0.1', desired: true }], deletedIds: ['a'.repeat(64)] }
  return { dir, file, legacy, storage, store, key, id, registry }
}
test('FRP schema 3 encrypts selected/per-tunnel keys; reopen keeps IDs, metadata, restore intent and tombstones', t => {
  const f = fixture(t); f.store.writeRegistry(f.file, f.registry)
  const raw = fs.readFileSync(f.file, 'utf8'), disk = JSON.parse(raw)
  assert.equal(disk.version, 3); assert(!raw.includes(f.key)); assert(!raw.includes('"accessKey"'))
  assert.equal(typeof disk.secureKeys, 'string'); assert.deepEqual(new FrpSecureStore(f.storage).readRegistry(f.file).tunnels[0].config, f.registry.tunnels[0].config)
  const restored = new FrpSecureStore(f.storage).readRegistry(f.file)
  assert.equal(restored.accessKey, f.key); assert(restored.tunnels[0].desired); assert.deepEqual(restored.deletedIds, ['a'.repeat(64)])
})
test('valid old plaintext registry migrates atomically and retains every original control field', t => {
  const f = fixture(t); fs.writeFileSync(f.file, JSON.stringify(f.registry))
  const result = f.store.readRegistry(f.file)
  assert.equal(result.accessKey, f.key); assert.equal(result.tunnels[0].id, f.id)
  assert(!fs.readFileSync(f.file, 'utf8').includes(f.key)); assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).version, 3)
})
test('migration rename failure keeps byte-exact old file and releases only its temporary sibling', t => {
  const f = fixture(t, { rename() { throw Error('controlled write failure') } }), before = JSON.stringify(f.registry)
  fs.writeFileSync(f.file, before); assert.throws(() => f.store.readRegistry(f.file), /原文件保持不变/)
  assert.equal(fs.readFileSync(f.file, 'utf8'), before); assert.deepEqual(fs.readdirSync(f.dir), ['frp-tunnels.json'])
})
test('locked plaintext migration displays metadata without using or rewriting credentials', t => {
  const f = fixture(t), raw = JSON.stringify(f.registry); fs.writeFileSync(f.file, raw); f.storage.available = false
  const result = f.store.readRegistry(f.file)
  assert.equal(result.accessKey, ''); assert(result.credentialLocked); assert.equal(result.tunnels[0].config.accessKey, '')
  assert.equal(result.tunnels[0].id, f.id); assert.equal(fs.readFileSync(f.file, 'utf8'), raw)
  assert.throws(() => f.store.writeRegistry(f.file, f.registry), /安全存储/); assert.equal(fs.readFileSync(f.file, 'utf8'), raw)
})
test('locked encrypted registry permits saved stop metadata while preserving the exact ciphertext and rejects a replacement key', t => {
  const f = fixture(t); f.store.writeRegistry(f.file, f.registry)
  const cipher = JSON.parse(fs.readFileSync(f.file, 'utf8')).secureKeys; f.storage.available = false
  const reopened = new FrpSecureStore(f.storage), data = reopened.readRegistry(f.file); data.tunnels[0].desired = false
  reopened.writeRegistry(f.file, data)
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).secureKeys, cipher)
  const before = fs.readFileSync(f.file, 'utf8'); data.accessKey = 'new-synthetic-key'
  assert.throws(() => reopened.writeRegistry(f.file, data), /锁定|安全存储/); assert.equal(fs.readFileSync(f.file, 'utf8'), before)
  f.storage.available = true; assert.equal(reopened.readRegistry(f.file).accessKey, f.key); assert(!reopened.readRegistry(f.file).tunnels[0].desired)
})
test('keyring locking after a successful read can stop intent without re-encrypting or losing the key', t => {
  const f = fixture(t); f.store.writeRegistry(f.file, f.registry); const data = f.store.readRegistry(f.file)
  const cipher = JSON.parse(fs.readFileSync(f.file, 'utf8')).secureKeys; f.storage.available = false; data.tunnels[0].desired = false
  f.store.writeRegistry(f.file, data); assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).secureKeys, cipher)
})
test('decryption failure retains opaque ciphertext, never substitutes a new key, and can be explicitly cleared', t => {
  const f = fixture(t); f.store.writeRegistry(f.file, f.registry)
  const foreignStore = new FrpSecureStore(new FrpCipherFixture()), before = fs.readFileSync(f.file, 'utf8'), data = foreignStore.readRegistry(f.file)
  assert(data.credentialLocked); assert.equal(data.accessKey, ''); assert.equal(fs.readFileSync(f.file, 'utf8'), before)
  data.accessKey = 'synthetic-new-key'; assert.throws(() => foreignStore.writeRegistry(f.file, data), /锁定|解密/); assert.equal(fs.readFileSync(f.file, 'utf8'), before)
  data.accessKey = ''; data.accessKeyConfigured = false; data.tunnels[0].desired = false; data.tunnels[0].credentialConfigured = false
  foreignStore.writeRegistry(f.file, data, true); assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).secureKeys, null)
  assert.equal(foreignStore.readRegistry(f.file).accessKeyConfigured, false); assert.equal(foreignStore.readRegistry(f.file).tunnels.length, 1)
})
test('malformed registry and metadata fail closed without leaking raw contents or allowing overwrite', t => {
  const f = fixture(t); const privateText = 'controlled-secret-that-must-not-appear'; fs.writeFileSync(f.file, privateText)
  assert.throws(() => f.store.readRegistry(f.file), error => error instanceof Error && !error.message.includes(privateText))
  assert.throws(() => f.store.writeRegistry(f.file, f.registry)); assert.equal(fs.readFileSync(f.file, 'utf8'), privateText)
  const malformed = { ...f.registry, tunnels: [f.registry.tunnels[0], f.registry.tunnels[0]] }; fs.writeFileSync(f.file, JSON.stringify(malformed))
  assert.throws(() => f.store.readRegistry(f.file), /无效/); assert.throws(() => f.store.writeRegistry(f.file, f.registry)); assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).tunnels.length, 2)
})
test('a later external registry edit is not overwritten by a cached snapshot', t => {
  const f = fixture(t); f.store.writeRegistry(f.file, f.registry); f.store.readRegistry(f.file)
  const external = fs.readFileSync(f.file, 'utf8') + ' '; fs.writeFileSync(f.file, external)
  assert.throws(() => f.store.writeRegistry(f.file, f.registry), /其他操作/); assert.equal(fs.readFileSync(f.file, 'utf8'), external)
})
test('Linux basic_text and unknown backends do not qualify as protected key storage', t => {
  const f = fixture(t, { platform: 'linux' })
  for (const backend of ['basic_text', 'unknown', '']) { f.storage.backend = backend; assert.equal(f.store.available(), false); assert.throws(() => f.store.writeRegistry(f.file, f.registry), /安全存储/); assert(!fs.existsSync(f.file)) }
  f.storage.backend = 'gnome_libsecret'; f.store.writeRegistry(f.file, f.registry); assert(!fs.readFileSync(f.file, 'utf8').includes(f.key))
})
test('old independent config also migrates to cipher and remains usable after reopen', t => {
  const f = fixture(t), config = f.registry.tunnels[0].config; fs.writeFileSync(f.legacy, JSON.stringify(config))
  assert.deepEqual(f.store.readLegacy(f.legacy), config); assert(!fs.readFileSync(f.legacy, 'utf8').includes(f.key))
  assert.equal(new FrpSecureStore(f.storage).readLegacy(f.legacy)?.accessKey, f.key)
  f.storage.available = false; assert(new FrpSecureStore(f.storage).readLegacy(f.legacy)?.credentialLocked)
})
test('old independent config migration/write failures preserve its byte-exact original', t => {
  const f = fixture(t, { rename() { throw Error('controlled fail') } }), raw = JSON.stringify(f.registry.tunnels[0].config)
  fs.writeFileSync(f.legacy, raw); assert.throws(() => f.store.readLegacy(f.legacy), /原文件保持不变/); assert.equal(fs.readFileSync(f.legacy, 'utf8'), raw)
  fs.writeFileSync(f.legacy, 'malformed'); assert.throws(() => f.store.writeLegacy(f.legacy, f.registry.tunnels[0].config)); assert.equal(fs.readFileSync(f.legacy, 'utf8'), 'malformed')
})
test('explicit legacy clear retains its identity and metadata with no recoverable key material', t => {
  const f = fixture(t); fs.writeFileSync(f.legacy, JSON.stringify(f.registry.tunnels[0].config)); f.storage.available = false
  f.store.clearLegacy(f.legacy); const disk = JSON.parse(fs.readFileSync(f.legacy, 'utf8'))
  assert.equal(disk.secureKey, null); assert.equal(disk.identity, f.id); assert(!JSON.stringify(disk).includes(f.key))
  const result = f.store.readLegacy(f.legacy); assert.equal(result?.credentialConfigured, false); assert.equal(result?.accessKey, '')
})

test('manager public state and event boundaries omit raw keys; blank requests reuse the private key and locked requests make zero service calls', async t => {
  const f = fixture(t); f.store.writeRegistry(f.file, f.registry); const events: unknown[] = []; let calls = 0
  class Worker implements TunnelWorker {
    state: FrpState = { status: 'idle', config: null, remoteAddress: null, pid: null, startedAt: null, message: '', logs: [] }
    sink: (event: FrpEvent) => void = () => {}
    status() { return this.state }; setSink(sink: (event: FrpEvent) => void) { this.sink = sink }
    async start(config: FrpConfig) { this.state = { ...this.state, status: 'running', config, pid: 42, message: `echo ${f.key}`, logs: [{ ts: 'fixture', stream: 'stdout', text: f.key }] }; this.sink({ type: 'status' }); return { pid: 42, remoteAddress: null } }
    async stop() { this.state.pid = null; this.state.status = 'stopped' }
  }
  const manager = new FrpManager({ read: () => f.store.readRegistry(f.file), save: (data, clear) => f.store.writeRegistry(f.file, data, clear),
    credentialAvailable: () => f.store.available(), worker: () => new Worker(), validate: async (key, id) => { calls++; assert.equal(key, f.key); return { id: Number(id), name: 'Fixture', nodeName: 'Node', localIp: '127.0.0.1', localPort: 25565 } } })
  manager.setSink(value => events.push(value)); assert.equal(manager.accessKey(''), f.key); assert.equal(manager.list().configured, true); assert(!Object.hasOwn(manager.list(), 'accessKey'))
  await manager.start(f.id); assert.equal(calls, 1); assert(!JSON.stringify(manager.list()).includes(f.key)); assert(!JSON.stringify(events).includes(f.key)); assert(!Object.hasOwn(manager.list().tunnels[0].config!, 'accessKey'))
  f.storage.available = false; assert.throws(() => manager.accessKey('replacement'), /锁定/); await manager.stop(f.id); await assert.rejects(manager.start(f.id), /解锁/); assert.equal(calls, 1)
  f.storage.available = true; await manager.start(f.id); await manager.clearCredentials(); assert.equal(manager.list().configured, false); assert(!manager.list().tunnels[0].desired); assert.equal(manager.list().tunnels.length, 1)
  assert(!fs.readFileSync(f.file, 'utf8').includes(f.key)); assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).secureKeys, null)
  manager.register(f.key, [{ id: 42, name: 'Restored', nodeName: 'Node', localIp: '127.0.0.1', localPort: 25565 }]); assert.equal(manager.list().tunnels.length, 1); assert(!manager.list().tunnels[0].credentialLocked)
})
test('explicit clearing of a locked plaintext registry works without a keyring and keeps tunnel metadata', async t => {
  const f = fixture(t); fs.writeFileSync(f.file, JSON.stringify(f.registry)); f.storage.available = false
  const manager = new FrpManager({ read: () => f.store.readRegistry(f.file), save: (data, clear) => f.store.writeRegistry(f.file, data, clear), credentialAvailable: () => f.store.available(), worker() { throw Error('No process expected') }, validate: async () => { throw Error('No service expected') } })
  assert(manager.list().locked); assert.match(manager.list().notice, /已保存的密钥/)
  await manager.clearCredentials(); assert.equal(manager.list().configured, false); assert.equal(manager.list().tunnels.length, 1); assert(!fs.readFileSync(f.file, 'utf8').includes(f.key))
  assert(manager.list().locked, 'Explicit clear must not pretend that the actual keyring was unlocked')
  assert.match(manager.list().notice, /本机密钥已清除/); assert.match(manager.list().notice, /仍不可用/); assert.doesNotMatch(manager.list().notice, /已保存的密钥/)
  f.storage.available = true; assert.equal(manager.list().locked, false); assert.equal(manager.list().notice, '')
})
