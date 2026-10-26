import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import { build } from 'esbuild'
import AdmZip from 'adm-zip'
import { resolveInstanceMetadata, isMinecraftVersionId } from '../src/main/core/instanceMetadata'
import { cachedClientVersionEvidence, readClientVersionEvidence } from '../src/main/core/instanceVersionEvidence'
import { versionInstallHarness } from './helpers/version-install-harness'
import type { VersionJson } from '../src/main/core/versions'

const fabric = [{ name: 'net.fabricmc:fabric-loader:0.19.5' }, { name: 'net.fabricmc:intermediary:0.0.0' }]
function temporary(t: { after: (fn: () => void) => void }) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-metadata117-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}
function writeVersion(root: string, name: string, json: VersionJson, base = false) {
  const dir = path.join(root, base ? '.kamucl/base' : 'versions', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(json))
  return dir
}
function client(file: string, id?: string, size = 0) {
  const zip = new AdmZip()
  zip.addFile('ignored.class', size ? crypto.randomBytes(size) : Buffer.alloc(0))
  if (id) zip.addFile('version.json', Buffer.from(JSON.stringify({ id })))
  zip.writeZip(file)
}

test('117 Fabric placeholder never overrides explicit, inherited, old mapping or modern MC versions', () => {
  for (const mc of ['1.21.5', '26.3', '26.3-snapshot-7', '26.3-rc-1', '1.21 Pre-Release 2', 'b1.7.3', 'b1.9-pre6', 'a1.2.6', '13w16a', 'c0.0.13a', 'c0.30_01c', '3D Shareware v1.34', '1.RV-Pre1', 'b1.3b', 'a1.2.2a', 'a1.2.2b']) {
    const known = { id: 'renamed', libraries: fabric, _mcVersion: mc }
    assert.equal(resolveInstanceMetadata(known, () => undefined).mcVersion, mc)
    const result = resolveInstanceMetadata({ id: '显示名 99.99', inheritsFrom: mc, libraries: fabric }, id => ({ id }))
    assert.equal(result.mcVersion, mc)
    assert.equal(result.loader, 'fabric')
    assert.equal(result.loaderVersion, '0.19.5')
    assert.equal(result.broken, false)
  }
  assert.equal(resolveInstanceMetadata({ id: 'not-a-version', clientVersion: '0.0.0', _mcVersion: '26.3', libraries: fabric }, () => undefined).mcVersion, '26.3')
  assert.equal(resolveInstanceMetadata({ id: 'opaque', libraries: [{ name: 'net.fabricmc:intermediary:1.20.1' }] }, () => undefined).mcVersion, '1.20.1')
  assert.equal(resolveInstanceMetadata({ id: 'opaque', libraries: [{ name: 'net.minecraftforge:fmlloader:47.4.23' }] }, () => undefined).mcVersion, '未知')
})

test('117 unknown stays unknown without evidence; missing and cyclic inheritance stay broken', () => {
  let calls = 0
  const resolve = (json: VersionJson) => resolveInstanceMetadata(json, () => undefined, () => { calls++; return undefined })
  assert.equal(resolve({ id: '1.21.5-Fabric', libraries: fabric, _mcVersion: '0.0.0' }).mcVersion, '未知')
  assert.equal(calls, 1)
  const inherited = resolve({ id: 'renamed', inheritsFrom: '26.3', libraries: fabric })
  assert.equal(inherited.mcVersion, '26.3')
  assert.equal(inherited.broken, true)
  assert.equal(calls, 1) // Known metadata does not read a client or initiate a request.
  assert.equal(resolveInstanceMetadata({ id: 'a', inheritsFrom: 'b', libraries: fabric }, id => ({ id, inheritsFrom: 'a' })).broken, true)
  assert.equal(resolveInstanceMetadata({ id: '99.99-looks-like-MC', libraries: fabric }, () => undefined, () => '0.0.0').mcVersion, '未知')
  assert.equal(isMinecraftVersionId('../26.3'), false)
})

test('117 selective client manifest reads are bounded, cache invalidation follows identity, no data rewritten', t => {
  const root = temporary(t), file = path.join(root, '中文 客户端 §.jar')
  client(file, '1.21.5', 8 * 1024 * 1024)
  const original = fs.readFileSync(file)
  let largestRead = 0, totalRead = 0
  const originalRead = fs.readSync
  fs.readSync = ((...args: any[]) => { largestRead = Math.max(largestRead, args[3] ?? 0); totalRead += args[3] ?? 0; return Reflect.apply(originalRead, fs, args) }) as typeof fs.readSync
  try { assert.equal(readClientVersionEvidence(file), '1.21.5') }
  finally { fs.readSync = originalRead }
  assert(largestRead <= 65557)
  assert(totalRead < 128 * 1024)
  assert.deepEqual(fs.readFileSync(file), original)
  client(file, '26.3')
  assert.equal(readClientVersionEvidence(file), '26.3')
  client(file)
  assert.equal(readClientVersionEvidence(file), undefined)
  const zip = new AdmZip(); zip.addFile('version.json', Buffer.from(JSON.stringify({ id: '26.3', excessive: 'x'.repeat(70000) }))); zip.writeZip(file)
  assert.equal(readClientVersionEvidence(file), undefined)
  fs.writeFileSync(file, 'not a ZIP')
  assert.equal(readClientVersionEvidence(file), undefined)
  client(file, '0.0.0')
  assert.equal(readClientVersionEvidence(file), undefined)
  client(file, '26.3')
  const corrupt = fs.readFileSync(file)
  for (let at = 0; at < corrupt.length - 46; at++) {
    if (corrupt.readUInt32LE(at) === 0x02014b50 && corrupt.subarray(at + 46, at + 58).toString() === 'version.json') { corrupt.writeUInt32LE(0, at + 16); break }
  }
  fs.writeFileSync(file, corrupt)
  assert.equal(readClientVersionEvidence(file), undefined)
})

test('117 cached vanilla recovery requires one exact client SHA1, never asset-index/display-name guessing', t => {
  const root = temporary(t), hash = 'a'.repeat(40), base = path.join(root, '.kamucl/base')
  const json = { id: 'renamed', libraries: fabric, assetIndex: { id: '26', url: '' }, downloads: { client: { sha1: hash, url: 'https://fixture.invalid/client' } } }
  writeVersion(root, '26.3', { id: '26.3', downloads: json.downloads }, true)
  assert.equal(cachedClientVersionEvidence([json], [base]), '26.3')
  assert.equal(cachedClientVersionEvidence([{ ...json, downloads: { client: { sha1: 'b'.repeat(40), url: '' } } }], [base]), undefined)
  writeVersion(root, '26.2', { id: '26.2', downloads: json.downloads }, true)
  assert.equal(cachedClientVersionEvidence([json], [base]), undefined)
  assert.equal(cachedClientVersionEvidence([{ id: '26.3-Fabric', libraries: fabric, assetIndex: { id: '26.3', url: '' } }], [base]), undefined)
})

test('117 actual installed scan reads local inheritance/client/cache and preserves all JSON bytes offline', async t => {
  const root = temporary(t), api = await versionInstallHarness(root, async () => { throw new Error('Network is forbidden in installed scanning') })
  t.after(() => api.closeHttpClient())
  const folder = path.join(root, '游戏 目录'), settings = api.getSettings()
  settings.gameDir = settings.activeFolder = folder
  settings.folders = [{ path: folder, name: 'fixture', isDefault: true }]
  const dir = writeVersion(folder, '1.21.5-Fabric', { id: '1.21.5-Fabric', libraries: fabric, _mcVersion: '0.0.0' })
  client(path.join(dir, '1.21.5-Fabric.jar'), '1.21.5')
  writeVersion(folder, '26.3', { id: '26.3' }, true)
  const child = writeVersion(folder, 'new-client', { id: 'new-client', inheritsFrom: '26.3', libraries: fabric })
  const hash = 'c'.repeat(40)
  writeVersion(folder, '26.2', { id: '26.2', downloads: { client: { sha1: hash, url: '' } } }, true)
  writeVersion(folder, 'cached-profile', { id: 'cached-profile', libraries: fabric, downloads: { client: { sha1: hash, url: '' } } })
  writeVersion(folder, 'broken-profile', { id: 'broken-profile', libraries: fabric })
  const original = fs.readFileSync(path.join(dir, '1.21.5-Fabric.json'))
  const list = api.listInstalled()
  assert.equal(list.find(v => v.id === '1.21.5-Fabric')?.mcVersion, '1.21.5')
  assert.equal(list.find(v => v.id === 'new-client')?.mcVersion, '26.3')
  assert.equal(list.find(v => v.id === 'new-client')?.incomplete, undefined)
  assert.equal(list.find(v => v.id === 'cached-profile')?.mcVersion, '26.2')
  assert.equal(list.find(v => v.id === 'broken-profile')?.mcVersion, '未知')
  assert.deepEqual(fs.readFileSync(path.join(dir, '1.21.5-Fabric.json')), original)
  assert.equal(fs.readdirSync(child).length, 1)
})

test('117 backend resource paths use native joining for shared, isolated and configured directories', async t => {
  const root = temporary(t), req = createRequire(import.meta.url), fixture = { app: { getPath: () => root } }
  const result = await build({ stdin: { contents: "export {resolveResourceDirectory} from './src/main/core/resourceDirectory'", resolveDir: process.cwd() }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', logLevel: 'silent' })
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)((name: string) => name === 'electron' ? fixture : req(name), module, module.exports)
  const folder = path.join(root, '中文 包'), override = path.join(root, '自定义 目录')
  for (const [name, json, expected] of [
    ['shared', { id: 'shared', _gameDir: false }, folder],
    ['isolated', { id: 'isolated', _gameDir: true }, path.join(folder, 'versions', 'isolated')],
    ['configured', { id: 'configured', gameDirectory: override }, override]
  ] as const) {
    writeVersion(folder, name, json)
    for (const kind of ['mods', 'resourcepacks', 'shaderpacks']) {
      const actual = await module.exports.resolveResourceDirectory(folder, name, kind)
      assert.equal(actual, path.join(expected, kind))
      assert.equal(path.isAbsolute(actual), true)
      if (process.platform === 'win32') assert.equal(actual.includes('/'), false)
    }
  }
  await assert.rejects(module.exports.resolveResourceDirectory(folder, '../escape', 'mods'), /版本名称/)
  await assert.rejects(module.exports.resolveResourceDirectory(folder, 'shared', '../escape'), /资源目录/)
})
