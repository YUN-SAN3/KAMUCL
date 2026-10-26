import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { build } from 'esbuild'
import { serverVersionDisplay } from '../src/shared/serverVersionDisplay'
import { normalizeUpdateMirrorUrl, storedUpdateMirrorUrls, validateUpdateMirrorUrls } from '../src/shared/updateMirrors'
import type { InstalledVersion, ServerEntry } from '../src/shared/types'

async function sandbox(t: any, entry: string) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-compat121-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const code = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' })
  const req = createRequire(path.resolve('package.json')), mod = { exports: {} as any }
  new Function('require', 'module', 'exports', code.outputFiles[0].text)(
    (name: string) => name === 'electron' ? { app: { getPath: () => root, isPackaged: false } } : req(name), mod, mod.exports)
  return { root, api: mod.exports }
}

test('server metadata display refreshes old 0.0.0 bindings from a resolved 26.x instance without mutating saved data', () => {
  const saved = { id: 'server', name: 'synthetic', address: 'localhost', versionId: '26.1.2-Fabric', minecraftVersion: '0.0.0', loader: 'fabric', loaderVersion: 'old' } as ServerEntry
  const target = { id: saved.versionId, folder: '/fixture', mcVersion: '26.1.2', loader: 'fabric', loaderVersion: '0.19.3' } as InstalledVersion
  const display = serverVersionDisplay(saved, target)
  assert.equal(display.minecraftVersion, '26.1.2'); assert.equal(display.loaderVersion, '0.19.3')
  assert.equal(saved.minecraftVersion, '0.0.0'); assert.equal(saved.loaderVersion, 'old')
  assert.equal(serverVersionDisplay(saved).minecraftVersion, '未知')
  assert.equal(serverVersionDisplay(saved, { ...target, loader: undefined, loaderVersion: undefined }).loader, undefined)
  const unbound = { ...saved, versionId: undefined }; assert.equal(serverVersionDisplay(unbound, target), unbound)
})

test('resource lists hide Finder metadata without deleting it or hiding a real resource', async t => {
  const { root, api } = await sandbox(t, 'src/main/core/resourceDirectory.ts')
  fs.writeFileSync(path.join(root, '.DS_Store'), 'user Finder metadata')
  fs.writeFileSync(path.join(root, '中文 § pack.zip'), 'real resource')
  fs.mkdirSync(path.join(root, '.DS_Store-folder'))
  const names = (await api.listResourceEntries(root)).map((entry: { name: string }) => entry.name)
  assert.deepEqual(names.sort(), ['.DS_Store-folder', '中文 § pack.zip'].sort())
  assert.equal(fs.readFileSync(path.join(root, '.DS_Store'), 'utf8'), 'user Finder metadata')
})

test('mirror settings reject unsafe new inputs but safely normalize legacy entries', () => {
  assert.equal(normalizeUpdateMirrorUrl(' HTTPS://Example.org/prefix '), 'https://example.org/prefix/')
  for (const input of ['http://example.org', 'https://name:secret@example.org', 'https://example.org/?token=x', 'https://example.org/#x', 'file:///tmp', 42]) assert.equal(normalizeUpdateMirrorUrl(input), null)
  assert.deepEqual(storedUpdateMirrorUrls(['bad', 'https://example.org/', 'https://example.org']), ['https://example.org/'])
  assert.throws(() => validateUpdateMirrorUrls(['http://example.org']), /HTTPS/)
  assert.throws(() => validateUpdateMirrorUrls(Array(9).fill('https://example.org')), /8/)
})

test('nested PCL MRPACK larger than 512 MiB probes through real bounded disk streams and leaves originals unchanged', { timeout: 180_000 }, async t => {
  const { root, api } = await sandbox(t, 'src/main/core/modpacks.ts')
  const { ZipFile } = createRequire(path.resolve('package.json'))('yazl')
  const innerFile = path.join(root, '内层 § with spaces.mrpack'), outerFile = path.join(root, 'PCL distribution.zip')
  const inner = new ZipFile(), size = 513 * 1024 * 1024, chunk = crypto.randomBytes(1024 * 1024)
  inner.addBuffer(Buffer.from(JSON.stringify({ formatVersion: 1, game: 'minecraft', name: 'Nested disk fixture', versionId: '121', dependencies: { minecraft: '1.20.1' }, files: [] })), 'modrinth.index.json')
  inner.addReadStream(Readable.from((function* () { for (let count = 0; count < 513; count++) yield chunk })()), 'overrides/config/large-fixture.bin', { compress: false, size })
  inner.end(); await pipeline(inner.outputStream, fs.createWriteStream(innerFile))
  assert(fs.statSync(innerFile).size > 512 * 1024 * 1024)
  const outer = new ZipFile(); outer.addFile(innerFile, 'payload/内层 § with spaces.mrpack', { compress: false }); outer.end()
  await pipeline(outer.outputStream, fs.createWriteStream(outerFile))
  const hash = async (file: string) => { const digest = crypto.createHash('sha256'); for await (const bytes of fs.createReadStream(file)) digest.update(bytes); return digest.digest('hex') }
  const before = await hash(outerFile), foldersBefore = new Set(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('kamucl-pack-entry-')))
  const result = await api.probeModpack(outerFile)
  assert.equal(result.format, 'mrpack'); assert.equal(result.mcVersion, '1.20.1')
  assert.equal(await hash(outerFile), before)
  const leftovers = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('kamucl-pack-entry-') && !foldersBefore.has(name))
  assert.deepEqual(leftovers, [], 'owned nested extraction must be cleaned after probe')
  t.diagnostic(JSON.stringify({ innerBytes: fs.statSync(innerFile).size, outerBytes: fs.statSync(outerFile).size, sourceSha256: before, metadata: result }))
})
