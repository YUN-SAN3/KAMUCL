import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import sharp from 'sharp'
import { OfflineSkinStore, validateOfflineSkinBytes } from '../src/main/core/offlineSkinStore'
import type { Account } from '../src/shared/types'

const decode = async (bytes: Buffer) => {
  const { info } = await sharp(bytes, { failOn: 'warning', limitInputPixels: 4096 }).raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.width, 64); assert.equal(info.height, 64)
}
const png = (color = '#cf8055', height = 64) => sharp({ create: { width: 64, height, channels: 4, background: color } }).png().toBuffer()
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
async function temporary(work: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kamucl-offline-skin-'))
  try { await work(dir) } finally { await fs.rm(dir, { recursive: true, force: true }) }
}

test('decoded PNGs persist by account, restart without network, deduplicate, and retain immutable launch snapshots', async () => temporary(async dir => {
  const store = new OfflineSkinStore(() => dir, decode), bytes = await png(), different = await png('#418b5b')
  await store.apply('A', bytes, 'slim', 'custom.png')
  const snapshot = (await store.snapshot('A'))!
  assert.equal(snapshot.sha256, crypto.createHash('sha256').update(bytes).digest('hex'))
  assert.deepEqual(await fs.readFile(snapshot.filePath), bytes)
  assert.equal(await store.snapshot('B'), null); assert.deepEqual(await store.history('B'), [])
  await store.apply('A', bytes, 'classic')
  assert.equal((await store.history('A')).length, 1)
  assert.equal((await store.snapshot('A'))?.variant, 'classic')
  await store.apply('B', different, 'slim', 'B.png')
  const restarted = new OfflineSkinStore(() => dir, decode)
  assert.equal((await restarted.profileSkin('A'))?.dataUrl, 'data:image/png;base64,' + bytes.toString('base64'))
  assert.equal((await restarted.history('B'))[0].name, 'B.png')
  await restarted.rename('A', snapshot.sha256, 'renamed')
  assert.equal((await restarted.history('A'))[0].name, 'renamed')
  await restarted.reset('A'); assert.equal(await restarted.snapshot('A'), null)
  await restarted.restore('A', snapshot.sha256); assert.equal((await restarted.snapshot('A'))?.sha256, snapshot.sha256)
  await restarted.delete('A', snapshot.sha256)
  assert.deepEqual(await restarted.history('A'), [])
  assert.equal((await restarted.snapshot('A'))?.sha256, snapshot.sha256)
  await restarted.reset('A')
  assert.deepEqual(await fs.readFile(snapshot.filePath), bytes, 'a running launch still owns the same texture after delete/reset')
  const manifest = (await fs.readdir(path.join(dir, 'accounts'))).map(file => path.join(dir, 'accounts', file))
  for (const file of manifest) assert(!/accessToken|refreshToken|username|apiRoot/.test(await fs.readFile(file, 'utf8')))
}))

test('manifest save failure preserves the previous selected skin and history, with no successful in-memory ghost selection', async () => temporary(async dir => {
  let fail = false
  const storage = { ...fs, rename: (async (from: string, to: string) => {
    if (fail && to.endsWith('.json')) throw Object.assign(new Error('simulated disk full'), { code: 'ENOSPC' })
    return fs.rename(from, to)
  }) as typeof fs.rename }
  const store = new OfflineSkinStore(() => dir, decode, storage), original = await png(), newer = await png('#f04a55')
  await store.apply('A', original, 'classic'); const before = await store.snapshot('A')
  fail = true
  await assert.rejects(store.apply('A', newer, 'slim'), /disk full/)
  assert.deepEqual(await store.snapshot('A'), before)
  assert.equal((await store.history('A')).length, 1)
  await assert.rejects(store.reset('A'), /disk full/)
  assert.deepEqual(await store.snapshot('A'), before)
  assert(!(await fs.readdir(path.join(dir, 'accounts'))).some(file => file.endsWith('.tmp')))
  fail = false; await store.apply('A', newer, 'slim')
  assert.equal((await store.history('A')).length, 2)
}))

test('an asynchronous PNG decode owns its bytes and account, and concurrent account writes remain isolated', async () => temporary(async dir => {
  const gate = deferred(), bytes = await png(), original = Buffer.from(bytes)
  let wait = true
  const store = new OfflineSkinStore(() => dir, async data => { if (wait) await gate.promise; await decode(data) })
  const apply = store.apply('A', bytes, 'slim')
  bytes.fill(0); wait = false
  await store.apply('B', await png('#357fcd'), 'classic')
  assert.equal(await store.snapshot('A'), null)
  gate.resolve(); await apply
  assert.equal((await store.snapshot('A'))?.sha256, crypto.createHash('sha256').update(original).digest('hex'))
  assert.notEqual((await store.snapshot('A'))?.sha256, (await store.snapshot('B'))?.sha256)
}))

test('truncated, forged, oversized, old-size, and corrupt PNGs cannot become an offline launch texture', async () => temporary(async dir => {
  const store = new OfflineSkinStore(() => dir, decode), bytes = await png()
  await assert.rejects(store.apply('A', bytes.subarray(0, 24), 'classic'), /64×64/)
  await assert.rejects(store.apply('A', bytes.subarray(0, bytes.length - 8), 'classic'), /不完整|损坏/)
  await assert.rejects(store.apply('A', Buffer.alloc(200_001), 'classic'), /过大/)
  await assert.rejects(store.apply('A', await png('#cf8055', 32), 'classic'), /64×64/)
  const forged = Buffer.from(bytes); forged[forged.indexOf(Buffer.from('IDAT')) + 5] ^= 255
  await assert.rejects(store.apply('A', forged, 'classic'))
  assert.equal(await store.snapshot('A'), null)
  validateOfflineSkinBytes(bytes)
  await store.apply('A', bytes, 'classic')
  const snapshot = (await store.snapshot('A'))!
  await fs.writeFile(snapshot.filePath, await png('#785f99'))
  await assert.rejects(store.snapshot('A'), /校验失败/)
}))

const compiledSkins = build({ entryPoints: ['src/main/core/skins.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'appearance-services', setup(builder) {
  builder.onResolve({ filter: /^\.\/(recycleFile|fileJobs|accounts|paths|yggdrasil|skinProfileCache|skinTexture)$/ }, args => ({ path: args.path.slice(2), external: true }))
} }] })
test('the actual main skin API captures account A across its asynchronous file read and rejects a stale A confirmation', async () => temporary(async dir => {
  const accounts: Account[] = ['A', 'B'].map(id => ({ id, type: 'offline', username: 'Player' + id, uuid: id.repeat(32) }))
  let selected = accounts[0]
  const require = createRequire(path.resolve('package.json')), module = { exports: {} as any }
  const bytes = await png(), file = path.join(dir, 'skin.png'); await fs.writeFile(file, bytes)
  const electron = { app: { getPath: () => dir }, nativeImage: { createFromBuffer: (data: Buffer) => {
    validateOfflineSkinBytes(data)
    return { isEmpty: () => false, getSize: () => ({ width: 64, height: 64 }) }
  } } }
  const fixtures: Record<string, unknown> = { electron, accounts: { selectedAccount: () => selected, accountById: (id: string) => accounts.find(account => account.id === id) },
    skinProfileCache: { SkinProfileCache: class { get() { throw Error('offline must bypass the old remote profile cache') } } }, paths: { gameDir: () => dir },
    recycleFile: {}, fileJobs: {}, yggdrasil: {}, skinTexture: {} }
  new Function('require', 'module', 'exports', (await compiledSkins).outputFiles[0].text)(
    (name: string) => name in fixtures ? fixtures[name] : require(name), module, module.exports)
  const skins = module.exports
  const accepted = skins.applyOfflineSkin(file, 'slim', 'A')
  selected = accounts[1]
  const result = await accepted
  assert.equal(result.username, 'PlayerA')
  assert.equal((await skins.getOfflineSkin('A')).variant, 'slim')
  assert.equal(await skins.getOfflineSkin('B'), null)
  assert.equal(await skins.getAvatar('A'), 'data:image/png;base64,' + bytes.toString('base64'))
  assert.equal(await skins.getAvatar('B'), null)
  assert.deepEqual((await skins.getProfile(true, 'B')).skins, [])
  await assert.rejects(skins.applyOfflineSkin(file, 'classic', 'A'), /账号已变更/)
  await assert.rejects(skins.resetOfflineSkin('A'), /账号已变更/)
  assert.equal((await skins.getOfflineSkin('A')).variant, 'slim')
  assert.equal(await skins.getOfflineSkin('B'), null)
  selected = accounts[0]; await skins.resetOfflineSkin('A')
  assert.equal(await skins.getAvatar('A'), null)
}))
