import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { FrpSecureStore, frpCredentialIdentity } from '../src/main/core/frpSecureStore'
import { FrpCipherFixture } from './helpers/frpCipherFixture'

const compiled = build({ entryPoints: ['src/main/core/frpService.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'owned-no-workers-or-network', setup(builder) {
    builder.onResolve({ filter: /^\.\/frp$/ }, () => ({ path: 'frp', namespace: 'fixture' }))
    builder.onResolve({ filter: /^\.\/frpNodes$/ }, () => ({ path: 'nodes', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'frp'
      ? `export class FrpController { constructor(){ throw Error('No worker expected') } }; export const loadFrpConfig=()=>fixture.legacyStore.readLegacy(fixture.legacy);`
      : `export const getRunnableFrpTunnel=async()=>{throw Error('No real service expected')};export const deleteFrpTunnel=async()=>{throw Error('No real service expected')};` }))
  } }] }).then(result => result.outputFiles[0].text)
const nativeRequire = createRequire(path.resolve('package.json'))
async function fixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-frp-service-clear122-')), file = path.join(root, 'frp-tunnels.json'), legacy = path.join(root, 'frp-config.json')
  t.after(() => { assert(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir()) + path.sep + 'kamucl-frp-service-clear122-')); fs.rmSync(root, { recursive: true, force: true }) })
  const storage = new FrpCipherFixture(), legacyStore = new FrpSecureStore(storage), key = 'owned-service-fixture-key', id = frpCredentialIdentity(key, '42')
  const registry = { version: 2 as const, accessKey: key, tunnels: [{ id, config: { accessKey: key, tunnelId: '42', localPort: 25565 }, name: 'Owned fixture', nodeName: '', localIp: '127.0.0.1', desired: false }] }
  legacyStore.writeRegistry(file, registry); legacyStore.writeLegacy(legacy, registry.tunnels[0].config)
  const before = { registry: fs.readFileSync(file, 'utf8'), legacy: fs.readFileSync(legacy, 'utf8') }
  const state = { failRegistry: false, failRollback: false, externalLegacy: '', postRenameFailure: false, renameDestinations: [] as string[] }
  const module = { exports: {} as any }, context = { root, file, legacy, legacyStore }
  new Function('require', 'module', 'exports', 'fixture', await compiled)((name: string) => {
    if (name === 'electron') return { app: { getPath: () => root }, safeStorage: storage }
    if (name === 'node:fs') return { ...fs, renameSync: (from: string, to: string) => {
      state.renameDestinations.push(path.basename(to))
      if (to === file && state.failRegistry) { if (state.externalLegacy) fs.writeFileSync(legacy, state.externalLegacy); throw Error('owned-second-commit-failure') }
      if (to === legacy && state.failRollback && state.renameDestinations.filter(name => name === 'frp-config.json').length > 1) throw Error('owned-rollback-failure')
      fs.renameSync(from, to)
      if (to === file && state.postRenameFailure) { state.postRenameFailure = false; throw Error('owned-post-rename-report-failure') }
    } }
    return nativeRequire(name)
  }, module, module.exports, context)
  const manager = module.exports.frpManager; manager.list()
  return { root, file, legacy, storage, key, before, state, manager, legacyStore }
}
test('actual FRP service second-file commit failure restores both byte-exact originals and can retry successfully', async t => {
  const f = await fixture(t); f.state.failRegistry = true
  await assert.rejects(f.manager.clearCredentials(), /本次已写入的文件已恢复/)
  assert.equal(fs.readFileSync(f.file, 'utf8'), f.before.registry); assert.equal(fs.readFileSync(f.legacy, 'utf8'), f.before.legacy)
  assert.equal(f.manager.accessKey(''), f.key); assert.equal(fs.readdirSync(f.root).filter(name => name.endsWith('.tmp')).length, 0)
  f.state.failRegistry = false; await f.manager.clearCredentials()
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).secureKeys, null); assert.equal(JSON.parse(fs.readFileSync(f.legacy, 'utf8')).secureKey, null)
  assert.equal(f.manager.list().configured, false); assert.equal(f.manager.list().tunnels.length, 1)
})
test('actual FRP service protects an external legacy update instead of unsafe rollback or false all-retained claim', async t => {
  const f = await fixture(t); f.state.failRegistry = true; f.state.externalLegacy = f.before.legacy + ' '
  await assert.rejects(f.manager.clearCredentials(), /部分写入无法自动恢复/)
  assert.equal(fs.readFileSync(f.legacy, 'utf8'), f.state.externalLegacy); assert.equal(fs.readFileSync(f.file, 'utf8'), f.before.registry)
  assert.equal(f.manager.list().configured, true); assert.equal(f.state.renameDestinations.filter(name => name === 'frp-config.json').length, 1)
})
test('actual FRP service failed rollback is reported as incomplete and retains current recoverable registry', async t => {
  const f = await fixture(t); f.state.failRegistry = true; f.state.failRollback = true
  await assert.rejects(f.manager.clearCredentials(), /部分写入无法自动恢复/)
  assert.equal(JSON.parse(fs.readFileSync(f.legacy, 'utf8')).keyCleared, true); assert.equal(fs.readFileSync(f.file, 'utf8'), f.before.registry)
  assert.equal(f.manager.accessKey(''), f.key)
})
test('actual FRP service preflights corrupt secondary config and stale primary snapshots before any clear writes', async t => {
  for (const corruptLegacy of [true, false]) {
    const f = await fixture(t)
    if (corruptLegacy) fs.writeFileSync(f.legacy, 'owned-invalid-secondary')
    else fs.writeFileSync(f.file, f.before.registry + ' ')
    const primary = fs.readFileSync(f.file, 'utf8'), secondary = fs.readFileSync(f.legacy, 'utf8')
    await assert.rejects(f.manager.clearCredentials(), /损坏|其他操作/)
    assert.equal(fs.readFileSync(f.file, 'utf8'), primary); assert.equal(fs.readFileSync(f.legacy, 'utf8'), secondary); assert.deepEqual(f.state.renameDestinations, [])
  }
})
test('actual FRP service handles a reported rename failure after commit without leaving a half-clear', async t => {
  const f = await fixture(t); f.state.postRenameFailure = true
  await assert.rejects(f.manager.clearCredentials(), /本次已写入的文件已恢复/)
  assert.equal(fs.readFileSync(f.file, 'utf8'), f.before.registry); assert.equal(fs.readFileSync(f.legacy, 'utf8'), f.before.legacy)
})
test('actual FRP service clears both old encrypted files with unavailable keyring while keeping accurate locked state', async t => {
  const f = await fixture(t); f.storage.available = false
  await f.manager.clearCredentials(); assert.equal(f.manager.list().configured, false); assert.equal(f.manager.list().locked, true)
  assert.match(f.manager.list().notice, /已清除/); assert(!fs.readFileSync(f.file, 'utf8').includes(f.key)); assert.equal(JSON.parse(fs.readFileSync(f.legacy, 'utf8')).secureKey, null)
})
