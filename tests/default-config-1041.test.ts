import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import AdmZip from 'adm-zip'
import { trackLaunchState, instanceLaunchBusy, type LaunchTracking } from '../src/shared/launchTracking'

let code: Promise<string>
async function runtime(t: any, env: Record<string, string> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-defaults-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  code ??= build({ stdin: { contents: `export * from './src/main/core/defaultResourcePacks';export {getPendingUpdate} from './src/main/core/applyUpdate';export {checkLatest,currentVersion} from './src/main/core/selfUpdate';export {trustedUpdateRelease} from './src/main/core/updateTrust';export {setDefaultKey,syncKeysToGameDir} from './src/main/core/keybindings';`, resolveDir: process.cwd() }, platform: 'node', format: 'cjs', bundle: true, write: false, packages: 'external' }).then(r => r.outputFiles[0].text)
  const require = createRequire(path.resolve('package.json')), mod = { exports: {} as any }, requested: string[] = []
  const fakeProcess = { ...process, env: { ...process.env, ...env } }
  new Function('require','module','exports','process',await code)(
    (name: string) => name === 'electron' ? { app: { isPackaged: true, getPath: () => root, getVersion: () => '1.0.41', getName: () => 'test' } }
      : name === 'undici' ? { ...require(name), fetch: async (url: string) => { requested.push(String(url)); return Response.json({ tag_name: 'v1.0.30', assets: [{ name: 'KAMUCL-1.0.30.exe', size: 123, browser_download_url: 'https://github.com/kamubaba-i/KAMUCL/releases/download/v1.0.30/KAMUCL-1.0.30.exe' }] }) } }
      : require(name), mod, mod.exports, fakeProcess)
  return { root, api: mod.exports, requested }
}
function pack(file: string, marker: string) {
  const zip = new AdmZip(); zip.addFile('pack.mcmeta', Buffer.from(JSON.stringify({ pack: { pack_format: 75, description: marker } }))); zip.addFile('assets/minecraft/test.txt', Buffer.from(marker)); zip.writeZip(file)
}

test('default packs import multiple ZIPs, deduplicate, preserve sources and apply to isolated/legacy instances', async t => {
  const { root, api } = await runtime(t)
  const a = path.join(root, 'A.zip'), b = path.join(root, 'B.zip'); pack(a, 'A'); pack(b, 'B')
  let packs = api.importDefaultResourcePacks([a, b, a]); assert.equal(packs.length, 2)
  const firstId = packs[0].id
  packs = api.moveDefaultResourcePack(firstId, 1); assert.equal(packs[1].id, firstId)
  for (const [name, mc] of [['isolated-fabric', '26.2'], ['isolated-forge', '1.20.1'], ['legacy', '1.12.2']]) {
    const game = path.join(root, name); fs.mkdirSync(game)
    fs.writeFileSync(path.join(game, 'options.txt'), 'lang:zh_cn\nkey_key.forward:key.keyboard.q\nresourcePacks:["vanilla","file/Personal.zip"]\ncustom:keep\n')
    assert.equal(api.syncDefaultResourcePacks(game, mc), 2)
    const options = fs.readFileSync(path.join(game, 'options.txt'), 'utf8')
    assert(options.includes('custom:keep')); assert(options.includes('key_key.forward:key.keyboard.q')); assert(options.includes('file/Personal.zip'))
    const enabled = JSON.parse(options.split('\n').find(l => l.startsWith('resourcePacks:'))!.slice(14))
    assert.equal(enabled.length, 4); assert(enabled.at(-1).includes(firstId))
    assert.equal(enabled.at(-1).startsWith('file/'), mc !== '1.12.2')
    assert.equal(fs.readdirSync(path.join(game, 'resourcepacks')).length, 2)
    api.syncDefaultResourcePacks(game, mc)
    assert.equal(fs.readFileSync(path.join(game, 'options.txt'), 'utf8'), options, 'repeat launch must not duplicate packs')
  }
  api.removeDefaultResourcePack(firstId)
  const game = path.join(root, 'isolated-fabric'); api.syncDefaultResourcePacks(game, '26.2')
  assert(!fs.readFileSync(path.join(game, 'options.txt'), 'utf8').includes(firstId))
  assert.equal(fs.readdirSync(path.join(game, 'resourcepacks')).length, 2, 'remove never deletes existing instance files')
  assert(fs.existsSync(a) && fs.existsSync(b))
})

test('invalid pack batch and malformed options preserve existing configuration', async t => {
  const { root, api } = await runtime(t)
  const good = path.join(root, 'good.zip'), bad = path.join(root, 'bad.zip'); pack(good, 'good'); new AdmZip().writeZip(bad)
  assert.throws(() => api.importDefaultResourcePacks([good, bad]), /pack.mcmeta/)
  assert.equal(api.getDefaultResourcePacks().length, 0)
  api.importDefaultResourcePacks([good])
  const game = path.join(root, 'game'); fs.mkdirSync(game); const options = path.join(game, 'options.txt')
  fs.writeFileSync(options, 'resourcePacks:damaged\nlang:en_us\n')
  assert.throws(() => api.syncDefaultResourcePacks(game, '26.2'), /格式无效/)
  assert.equal(fs.readFileSync(options, 'utf8'), 'resourcePacks:damaged\nlang:en_us\n')
})

test('compatible defaults are selected on the first launch, clearing old false incompatibility overrides', async t => {
  const { root, api } = await runtime(t)
  const client = path.join(root, 'client.jar'), game = path.join(root, 'game'), resource = path.join(root, 'Fullbright.zip')
  const jar = new AdmZip(); jar.addFile('version.json', Buffer.from(JSON.stringify({ pack_version: { resource_major: 88, resource_minor: 0 } }))); jar.writeZip(client)
  const zip = new AdmZip(); zip.addFile('pack.mcmeta', Buffer.from(JSON.stringify({ pack: { pack_format: 15, min_format: [15, 0], max_format: [1000, 0], supported_formats: [15, 1000] } }))); zip.writeZip(resource)
  const [p] = api.importDefaultResourcePacks([resource]), id = `file/KAMUCL-default-${p.id}-${p.name}`
  fs.mkdirSync(game)
  fs.writeFileSync(path.join(game, 'options.txt'), `resourcePacks:["vanilla","file/Personal.zip","${id}"]\nincompatibleResourcePacks:["file/Personal.zip","${id}"]\nlang:zh_cn\n`)
  api.syncDefaultResourcePacks(game, '26.2', client)
  const lines = fs.readFileSync(path.join(game, 'options.txt'), 'utf8').split('\n')
  const selected = JSON.parse(lines.find(x => x.startsWith('resourcePacks:'))!.slice(14))
  const overrides = JSON.parse(lines.find(x => x.startsWith('incompatibleResourcePacks:'))!.slice(26))
  assert(selected.includes(id)); assert(!overrides.includes(id)); assert(overrides.includes('file/Personal.zip'))
  const before = fs.readFileSync(path.join(game, 'options.txt'), 'utf8')
  api.syncDefaultResourcePacks(game, '26.2', client)
  assert.equal(fs.readFileSync(path.join(game, 'options.txt'), 'utf8'), before)
  assert(api.resourcePackIncompatible({ min_format: [90, 0], max_format: [1000, 0] }, [88, 0]))
  assert(!api.resourcePackIncompatible({ min_format: [88, 0], max_format: 88 }, [88, 1]))
  assert(api.resourcePackIncompatible({ min_format: [88, 0], max_format: [88, 0] }, [88, 1]))
  assert(!api.resourcePackIncompatible({ pack_format: 15, supported_formats: { min_inclusive: 15, max_inclusive: 34 } }, [34, 0]))
  assert(api.resourcePackIncompatible({ pack_format: 15, supported_formats: [15, 1000] }, [12, 0]))
})

test('unassigned key persists and syncs as unknown while other settings survive', async t => {
  const { root, api } = await runtime(t)
  assert.equal(api.setDefaultKey('key_key.forward', 'key.keyboard.unknown')['key_key.forward'], 'key.keyboard.unknown')
  const game = path.join(root, 'game'); fs.mkdirSync(game); fs.writeFileSync(path.join(game, 'options.txt'), 'resourcePacks:["vanilla"]\n')
  api.syncKeysToGameDir(game)
  const text = fs.readFileSync(path.join(game, 'options.txt'), 'utf8')
  assert(text.includes('key_key.forward:key.keyboard.unknown')); assert(text.includes('resourcePacks:["vanilla"]'))
})

test('packaged updates ignore test overrides and reject local v99 pending/cache pollution', async t => {
  const { root, api, requested } = await runtime(t, { KAMUCL_USERDATA_DIR: 'unused-test-dir', KAMUCL_UPDATE_API_BASE: 'http://127.0.0.1:8310', KAMUCL_VERSION_OVERRIDE: '99.0.0' })
  assert.equal(api.currentVersion(), '1.0.41')
  const file = path.join(root, 'KAMUCL-99.0.0.exe'); fs.writeFileSync(file, 'fixture')
  const release = { version: '99.0.0', assetName: path.basename(file), assetUrl: 'http://127.0.0.1:8310/download/KAMUCL-99.0.0.exe', assetSize: 7 }
  fs.writeFileSync(path.join(root, 'pending-update.json'), JSON.stringify({ release, file }))
  assert.equal(api.getPendingUpdate(), null); assert(fs.existsSync(file)); assert(fs.readdirSync(root).some(f => f.startsWith('pending-update.json.rejected-')))
  fs.writeFileSync(path.join(root, 'update-check-cache.json'), JSON.stringify({ checkedAt: Date.now(), latest: release }))
  const checked = await api.checkLatest(false)
  assert.equal(checked.hasUpdate, false); assert.equal(checked.release.version, '1.0.30'); assert(requested.every(u => u.startsWith('https://api.github.com/')))
  const official = { ...release, version: '1.0.42', assetName: 'KAMUCL-1.0.42.exe', assetUrl: 'https://github.com/kamubaba-i/KAMUCL/releases/download/v1.0.42/KAMUCL-1.0.42.exe' }
  const officialFile = path.join(root, official.assetName); fs.writeFileSync(officialFile, 'fixture')
  fs.writeFileSync(path.join(root, 'pending-update.json'), JSON.stringify({ release: official, file: officialFile }))
  assert.equal(api.getPendingUpdate().release.version, '1.0.42')
  assert.equal(api.trustedUpdateRelease({ ...official, assetUrl: official.assetUrl.replace('/v1.0.42/', '/v1.0.30/') }), false)
})

test('launch states remain independent across versions and folders; background exit cannot overwrite active launch', () => {
  const s: LaunchTracking = { launchState: null, launchStates: {}, launchingVersionId: '', launchingFolder: '' }
  trackLaunchState(s, { versionId: 'same', folder: 'A', status: 'launching', text: '' })
  trackLaunchState(s, { versionId: 'same', folder: 'A', status: 'running', text: '' })
  assert(!instanceLaunchBusy(s.launchStates, 'same', 'A')); assert(!instanceLaunchBusy(s.launchStates, 'other', 'A')); assert(!instanceLaunchBusy(s.launchStates, 'same', 'B'))
  trackLaunchState(s, { versionId: 'same', folder: 'B', status: 'launching', text: '' })
  trackLaunchState(s, { versionId: 'same', folder: 'A', status: 'exited', text: '' })
  assert.equal(s.launchState?.status, 'launching'); assert.equal(s.launchingFolder, 'B')
  assert(!instanceLaunchBusy(s.launchStates, 'same', 'A')); assert(instanceLaunchBusy(s.launchStates, 'same', 'B'))
})
