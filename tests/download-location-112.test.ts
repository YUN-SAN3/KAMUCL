import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import test, { type TestContext } from 'node:test'
import { build } from 'esbuild'
import { searchSettings, scopeOfCategory } from '../src/shared/settingsCatalog'

let compiled: Promise<string> | undefined
const requireFixture = createRequire(path.resolve('package.json'))
async function runtime(root: string, rewriteDownload = (url: string) => url) {
  compiled ??= build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    export { getSettings, saveSettings } from './src/main/core/settings';
    export { setDownloadGameFolder, setDefaultGameFolder, setActiveGameFolder, listGameFolders } from './src/main/core/gameFolders';
    export { defaultFolderPath, gameDir, librariesDir, assetsDir, runtimesDir, folderOfVersion, withDownloadFolder } from './src/main/core/paths';
    export { installVersion, listAllInstalled } from './src/main/core/versions';
    export { migrateGameDir } from './src/main/core/gamedir';
    export { closeHttpClient } from './src/main/core/httpClient';
  ` }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' }).then(result => result.outputFiles[0].text)
  const output = { exports: {} as any }
  const electron = { app: { getPath: (name: string) => path.join(root, name), getVersion: () => 'fixture', getName: () => 'KAMUCL-test', isPackaged: false }, BrowserWindow: { getAllWindows: () => [] } }
  new Function('require', 'module', 'exports', await compiled)((name: string) => name === 'electron' ? electron : name === 'undici'
    ? { ...requireFixture(name), fetch: (url: string, init: unknown) => requireFixture(name).fetch(rewriteDownload(String(url)), init) }
    : requireFixture(name), output, output.exports)
  return output.exports
}
function temporary(t: TestContext) {
  const base = fs.realpathSync.native(os.tmpdir()), root = fs.mkdtempSync(path.join(base, 'KAMUCL download location 112 '))
  assert(root.startsWith(base + path.sep))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}
async function fixture(t: TestContext, rewriteDownload?: (url: string) => string) {
  const root = temporary(t), api = await runtime(root, rewriteDownload)
  t.after(() => api.closeHttpClient())
  const old = path.join(root, 'C 旧游戏目录'), selected = path.join(root, 'D 新下载目录 §'), later = path.join(root, 'E 后续下载目录')
  for (const folder of [old, selected, later]) fs.mkdirSync(folder)
  const oldDir = path.join(old, 'versions', '保留旧实例')
  fs.mkdirSync(path.join(oldDir, 'saves', 'old world'), { recursive: true })
  fs.writeFileSync(path.join(oldDir, '保留旧实例.json'), JSON.stringify({ id: '保留旧实例', mainClass: 'net.minecraft.client.Main', _gameDir: true, downloads: { client: { url: 'https://example.invalid/client.jar' } } }))
  fs.writeFileSync(path.join(oldDir, '保留旧实例.jar'), 'existing client')
  fs.writeFileSync(path.join(oldDir, 'saves', 'old world', 'keep.txt'), 'existing private world')
  api.saveSettings({ gameDir: old, activeFolder: old, folders: [{ path: old, name: 'old', isDefault: true }, { path: selected, name: 'selected', isDefault: false }], mirror: 'official', defaultIsolation: true })
  return { root, old, selected, later, oldDir, api }
}
const sha1 = (data: Buffer) => crypto.createHash('sha1').update(data).digest('hex')

test('default download changes atomically select both roots, persist across restart, and preserve old instance binding', async t => {
  const { root, old, selected, oldDir, api } = await fixture(t)
  assert.equal(api.listAllInstalled().find((version: any) => version.id === '保留旧实例').folder, old)
  assert.equal(api.folderOfVersion('保留旧实例'), old, 'startup scan registers the existing instance before changing settings')
  // Choosing versions resolves to its registered Minecraft root, without a duplicate registration.
  fs.mkdirSync(path.join(selected, 'versions'))
  api.setDownloadGameFolder(path.join(selected, 'versions'))
  assert.equal(api.defaultFolderPath(), selected)
  assert.equal(api.gameDir(), selected)
  assert.equal(api.getSettings().folders.filter((folder: any) => folder.isDefault).length, 1)
  assert.equal(api.getSettings().folders.length, 2)
  assert.equal(api.listAllInstalled().find((version: any) => version.id === '保留旧实例').folder, old)
  assert.equal(api.folderOfVersion('保留旧实例'), old)
  assert.equal(fs.readFileSync(path.join(oldDir, 'saves', 'old world', 'keep.txt'), 'utf8'), 'existing private world')
  const restarted = await runtime(root)
  t.after(() => restarted.closeHttpClient())
  assert.equal(restarted.defaultFolderPath(), selected)
  assert.equal(restarted.gameDir(), selected)
  // An explicitly selected old instance changes the active view only; the installation default remains distinct.
  restarted.setActiveGameFolder(old)
  assert.equal(restarted.gameDir(), old)
  assert.equal(restarted.defaultFolderPath(), selected)
  assert.equal(restarted.withDownloadFolder(undefined, () => restarted.gameDir()), selected)
  restarted.setDefaultGameFolder(selected)
  assert.equal(restarted.gameDir(), selected)
  t.diagnostic(JSON.stringify({ old, selected, preservedInstance: oldDir, persisted: true }))
})

test('missing targets and actual settings commit failure preserve prior default, active folder and registration', async t => {
  const { root, old, selected, later, api } = await fixture(t)
  const previous = JSON.parse(JSON.stringify(api.getSettings())), disk = fs.readFileSync(path.join(root, 'userData', 'settings.json'))
  assert.throws(() => api.setDownloadGameFolder(path.join(root, 'missing disk')), /文件夹不存在/)
  assert.throws(() => api.withDownloadFolder(later, () => assert.fail('unregistered target accepted')), /未绑定/)
  fs.rmdirSync(selected)
  assert.throws(() => api.setDefaultGameFolder(selected), /已不存在/)
  assert.throws(() => api.withDownloadFolder(selected, () => assert.fail('missing target accepted')), /已不存在/)
  fs.mkdirSync(selected)
  const blocked = path.join(root, 'userData', 'settings.json.tmp')
  fs.mkdirSync(blocked)
  try {
    assert.throws(() => api.setDownloadGameFolder(later), /设置写入失败/)
    assert.deepEqual(api.getSettings(), previous)
    assert(fs.readFileSync(path.join(root, 'userData', 'settings.json')).equals(disk))
    assert.equal(api.getSettings().folders.some((folder: any) => folder.path === later), false)
    assert.equal(api.gameDir(), old)
  } finally { fs.rmdirSync(blocked) }
  // Failure releases the operation and a retry commits only the requested new root.
  api.setDownloadGameFolder(later)
  assert.equal(api.defaultFolderPath(), later)
  assert.equal(api.gameDir(), later)
  assert.equal(api.getSettings().folders.length, 3)
  assert(!fs.readdirSync(later).some(file => file.startsWith('.kamucl-write-test-')))
})

test('legacy game directory change updates the shared default, while switch-only and copy retain original files', async t => {
  const { old, selected, later, oldDir, api } = await fixture(t)
  await api.migrateGameDir(selected, false, () => {})
  assert.equal(api.gameDir(), selected)
  assert.equal(api.defaultFolderPath(), selected)
  assert.equal(fs.existsSync(path.join(selected, 'versions')), false)
  assert.equal(fs.readFileSync(path.join(oldDir, '保留旧实例.jar'), 'utf8'), 'existing client')
  api.setActiveGameFolder(old)
  await api.migrateGameDir(later, true, () => {})
  assert.equal(api.gameDir(), later)
  assert.equal(api.defaultFolderPath(), later)
  assert.equal(fs.readFileSync(path.join(later, 'versions', '保留旧实例', 'saves', 'old world', 'keep.txt'), 'utf8'), 'existing private world')
  assert.equal(fs.readFileSync(path.join(oldDir, 'saves', 'old world', 'keep.txt'), 'utf8'), 'existing private world')
  assert(api.getSettings().folders.some((folder: any) => folder.path === old))
})

test('real HTTP client, dependency and asset downloads bind to accepted default; subsequent setting changes cannot scatter files', { timeout: 20000 }, async t => {
  const client = crypto.randomBytes(32768), library = Buffer.from('location dependency'), asset = Buffer.from('location asset'), assetHash = sha1(asset)
  const index = Buffer.from(JSON.stringify({ objects: { 'example/中文 §.txt': { hash: assetHash, size: asset.length } } }))
  const responses = new Map<string, Buffer>([['/client', client], ['/library', library], ['/index', index], ['/asset', asset]])
  let release!: () => void, ready!: () => void
  const held = new Promise<void>(resolve => release = resolve), requests = new Set<string>(), accepted = new Promise<void>(resolve => ready = resolve)
  const server = http.createServer((request, response) => {
    const route = request.url || '', bytes = responses.get(route)
    if (!bytes) { response.writeHead(404); response.end(); return }
    requests.add(route)
    if (['/client', '/library', '/index'].every(route => requests.has(route))) ready()
    void held.then(() => { if (!response.destroyed) { response.writeHead(200, { 'content-length': bytes.length }); response.end(bytes) } })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as any).port}`
  const { old, selected, later, api } = await fixture(t, value => value.startsWith('https://resources.download.minecraft.net/') ? url + '/asset' : value)
  let install: Promise<unknown> | undefined
  try {
    api.setDownloadGameFolder(selected)
    api.setActiveGameFolder(old)
    const id = '1.20.1-location-fixture', dir = path.join(selected, 'versions', id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify({ id, libraries: [{ name: 'example:location:1', downloads: { artifact: { path: 'example/location.jar', url: url + '/library', sha1: sha1(library), size: library.length } } }], downloads: { client: { url: url + '/client', sha1: sha1(client), size: client.length } }, assetIndex: { id: 'location-112', url: url + '/index', sha1: sha1(index), size: index.length } }))
    const acceptedPaths: Record<string, string> = {}
    install = api.withDownloadFolder(undefined, async () => {
      await api.installVersion(id, {}, () => {})
      Object.assign(acceptedPaths, { versions: api.gameDir(), libraries: api.librariesDir(), assets: api.assetsDir(), runtimes: api.runtimesDir() })
    })
    await Promise.race([accepted, install.then(() => assert.fail('task finished before real HTTP barrier'))])
    assert.equal(fs.existsSync(path.join(dir, id + '.jar')), false)
    api.setDownloadGameFolder(later)
    release()
    await install
    assert(fs.readFileSync(path.join(dir, id + '.jar')).equals(client))
    assert(fs.readFileSync(path.join(selected, 'libraries', 'example', 'location.jar')).equals(library))
    assert(fs.readFileSync(path.join(selected, 'assets', 'indexes', 'location-112.json')).equals(index))
    assert(fs.readFileSync(path.join(selected, 'assets', 'objects', assetHash.slice(0, 2), assetHash)).equals(asset))
    assert.deepEqual(acceptedPaths, { versions: selected, libraries: path.join(selected, 'libraries'), assets: path.join(selected, 'assets'), runtimes: path.join(selected, 'runtimes') })
    assert.equal(api.defaultFolderPath(), later)
    assert.equal(api.gameDir(), later)
    for (const root of [old, later]) for (const child of ['libraries', 'assets', 'runtimes']) assert.equal(fs.existsSync(path.join(root, child)), false, `old/in-flight task unexpectedly wrote ${root}/${child}`)
    assert.equal(api.withDownloadFolder(old, () => api.gameDir()), old, 'explicit repair/import target preserves old root')
    t.diagnostic(JSON.stringify({ actualRequests: [...requests], acceptedPaths, finalDefault: api.defaultFolderPath(), clientSha1: sha1(client), assetSha1: assetHash, service: 'private loopback fixture, not Mojang production' }))
  } finally {
    release()
    if (install) await Promise.allSettled([install])
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('default download location is discoverable from settings search under launcher downloads', () => {
  for (const query of ['默认下载位置', 'D盘', '游戏版本', '路径', '安装目录', '游戏目录', '版本目录', '安装位置', '新版本安装目录', '新版本安装位置', '默认下载目录']) assert(searchSettings(query).some(item => item.id === 'installation'), query)
  assert.equal(searchSettings('默认下载位置').find(item => item.id === 'installation')?.category, 'downloads')
  assert.equal(scopeOfCategory('downloads'), 'launcher')
})
