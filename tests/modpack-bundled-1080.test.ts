import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { BundledModpackFiles } from '../src/main/core/modpackBundledFiles'
import { resolveCurseForgeMetadata, requireCurseForgeDownload, exactModrinthDownload } from '../src/main/core/curseforgeDownload'
import { versionInstallHarness } from './helpers/version-install-harness'

const sha1 = (bytes: Buffer) => crypto.createHash('sha1').update(bytes).digest('hex')

test('包内文件按大小和 SHA1 复用，保留改名和禁用状态；缓存及同名不同内容不能冒充', async () => {
  const zip = new AdmZip(), bytes = Buffer.from('included mod'), wrong = Buffer.from('differentmod')
  zip.addFile('custom/mods/renamed.jar.disabled', bytes)
  zip.addFile('custom/mods/same-name.jar', wrong)
  zip.addFile('custom/mods/.connector/cache.jar', Buffer.from('cache mod'))
  const bundled = new BundledModpackFiles(zip, 'custom')
  assert.equal(await bundled.find({ size: bytes.length, sha1: sha1(bytes).toUpperCase() }), 'mods/renamed.jar.disabled')
  assert.equal(await bundled.find({ size: bytes.length + 1, sha1: sha1(bytes) }), null)
  assert.equal(await bundled.find({ size: bytes.length, sha1: '0'.repeat(40) }), null)
  assert.equal(await bundled.find({ size: 9, sha1: sha1(Buffer.from('cache mod')) }), null)
  assert.equal(await new BundledModpackFiles(zip, 'other').find({ size: bytes.length, sha1: sha1(bytes) }), null)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(bundled.find({ size: bytes.length, sha1: sha1(bytes) }, controller.signal), /abort/i)
})

test('拒绝会在 Windows 覆盖已校验文件的大小写重复条目和符号链接', () => {
  const zip = new AdmZip(); zip.addFile('overrides/mods/a.jar', Buffer.from('a')); zip.addFile('overrides/mods/A.jar', Buffer.from('b'))
  assert.throws(() => new BundledModpackFiles(zip, 'overrides'), /重名/)
  const link = new AdmZip(); const entry = link.addFile('overrides/mods/a.jar', Buffer.from('outside')); entry.attr = (0o120777 << 16) >>> 0
  assert.throws(() => new BundledModpackFiles(link, 'overrides'), /符号链接/)
})

test('受限文件元数据可用于包内校验，备用来源可提供地址；不凭空拼接下载链接', async () => {
  const data = { id: 8695500, modId: 1661637, isAvailable: true, fileName: 'whisperingstatusbar-1.3.jar', fileLength: 113028,
    hashes: [{ algo: 1, value: '529727f48d67e11c8f94b7993779086d1b1be184' }], downloadUrl: null as string | null }
  const server = http.createServer((req, res) => res.end(JSON.stringify({ data: { ...data,
    ...(req.url!.startsWith('/fallback') ? { downloadUrl: 'https://example.invalid/exact.jar' } : {}) } })))
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as any).port}`
  try {
    const local = await resolveCurseForgeMetadata(data.modId, data.id, [{ base }])
    assert.equal(local.url, null); assert.equal(local.sha1, data.hashes[0].value)
    assert.throws(() => requireCurseForgeDownload(local, data.modId, data.id), /whisperingstatusbar-1.3.jar.*SHA1/)
    const fallback = await resolveCurseForgeMetadata(data.modId, data.id, [{ base }, { base: base + '/fallback' }])
    assert.equal(requireCurseForgeDownload(fallback, data.modId, data.id).url, 'https://example.invalid/exact.jar')
    await assert.rejects(resolveCurseForgeMetadata(1, data.id, [{ base }]), /不匹配/)
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())) }
})

test('跨平台备用下载只接受 SHA1、大小都一致的官方文件，不按名称猜测', async () => {
  const identity = { fileName: 'cf-name.jar', size: 12, sha1: 'a'.repeat(40), url: null, isAvailable: true }
  const file = { filename: 'another-name.jar', size: 12, hashes: { sha1: 'a'.repeat(40) }, url: 'https://cdn.modrinth.com/data/exact.jar' }
  const server = http.createServer((_req, res) => res.end(JSON.stringify({ files: [file] })))
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const bases = [`http://127.0.0.1:${(server.address() as any).port}`]
  try {
    assert.equal(await exactModrinthDownload(identity, undefined, bases), file.url)
    file.size = 13; assert.equal(await exactModrinthDownload(identity, undefined, bases), null)
    file.size = 12; file.hashes.sha1 = 'b'.repeat(40); assert.equal(await exactModrinthDownload(identity, undefined, bases), null)
    file.hashes.sha1 = identity.sha1; file.url = 'https://untrusted.invalid/a.jar'; assert.equal(await exactModrinthDownload(identity, undefined, bases), null)
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())) }
})

for (const outcome of ['included', 'mismatch', 'missing', 'supplied'] as const) test(`真实整合包导入：${outcome}，受限模组必须有精确副本`, {timeout:15000}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-bundled-1080-')), game = path.join(root, 'game'), id = '包内文件验证'
  fs.mkdirSync(game)
  const bundled = Buffer.from('restricted-mod'), network = Buffer.from('downloaded-mod'), client = Buffer.from('client fixture')
  const requests: string[] = []
  const controller = new AbortController()
  let base = '', runtime: Awaited<ReturnType<typeof versionInstallHarness>> | undefined
  const server = http.createServer((req, res) => {
    const url = req.url!; requests.push(url)
    if (url === '/version') return void res.end(JSON.stringify({ id: '1.20.1', mainClass: 'fixture.Main', libraries: [], downloads: { client: { url: base + '/client', sha1: sha1(client), size: client.length } } }))
    if (url === '/client') return void res.end(client)
    if (url === '/network') return void res.end(network)
    const match = url.match(/\/mods\/(\d+)\/files\/(\d+)/)
    if (match) {
      const local = match[2] === '101', bytes = local ? bundled : network
      return void res.end(JSON.stringify({ data: { id: Number(match[2]), modId: Number(match[1]), isAvailable: true,
        fileName: local ? 'restricted.jar' : 'network.jar', fileLength: bytes.length, hashes: [{ algo: 1, value: sha1(bytes) }],
        downloadUrl: local ? null : 'https://pack-test.invalid/network' } }))
    }
    res.writeHead(404); res.end()
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${(server.address() as any).port}`
  try {
    runtime = await versionInstallHarness(root,
      async () => Response.json({ versions: [{ id: '1.20.1', type: 'release', url: base + '/version', releaseTime: '2023-01-01' }] }),
      url => /\/mods\/\d+\/files\/\d+|\/version_file\/|cursemaven\.com|forgecdn\.net/.test(url) ? base + new URL(url).pathname : url.replace('https://pack-test.invalid', base))
    Object.assign(runtime.getSettings(), { gameDir: game, activeFolder: game, folders: [{ path: game, name: 'fixture', isDefault: true }], defaultIsolation: true, mirror: 'bmclapi' })
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ name: id, manifestVersion: 1, minecraft: { version: '1.20.1' }, overrides: 'overrides',
      files: [{ projectID: 1, fileID: 101 }, { projectID: 2, fileID: 102 }] })))
    if (outcome === 'included' || outcome === 'mismatch') zip.addFile('overrides/mods/renamed.jar.disabled', outcome === 'included' ? bundled : Buffer.from('wrong-file----'))
    zip.addFile('overrides/mods/.connector/restricted.jar', bundled)
    zip.addFile('overrides/config/player.txt', Buffer.from('keep'))
    const input = path.join(root, 'pack.zip'); zip.writeZip(input)
    const events: any[] = []
    let token = ''
    let manualReady!: () => void
    const ready = new Promise<void>(resolve => { manualReady = resolve })
    const install = runtime.installModpack(input, e => {
      events.push(e)
      if (e.manualFiles && !token) {
        token = e.manualFiles.token
        assert.equal(e.manualFiles.files.length, 1)
        assert.equal(e.manualFiles.files[0].fileName, 'restricted.jar')
        if (outcome !== 'supplied') controller.abort()
        else manualReady()
      }
    }, { targetFolder: game, instanceName: id, signal: controller.signal })
    if (outcome === 'supplied') {
      await ready
      const otherFolder = path.join(root, '另一个默认目录')
      runtime.getSettings().folders[0].path = otherFolder
      // Simulate a later file-picker IPC outside the install's AsyncLocalStorage.
      const bad = path.join(root, 'bad.jar'), good = path.join(root, 'downloaded.jar')
      fs.writeFileSync(bad, Buffer.from('wrong-file----')); fs.writeFileSync(good, bundled)
      const rejected = await runtime!.supplyModpackFiles(token, [bad])
      assert.deepEqual(rejected, { accepted: 0, remaining: 1, rejected: ['bad.jar'] })
      const accepted = await runtime!.supplyModpackFiles(token, [good])
      assert.deepEqual(accepted, { accepted: 1, remaining: 0, rejected: [] })
      assert.deepEqual(fs.readFileSync(good), bundled)

      assert(!fs.existsSync(path.join(otherFolder, '.kamucl', 'modpack-cache')))
      runtime.getSettings().folders[0].path = game
    }
    const instance = path.join(game, 'versions', id)
    if (outcome === 'mismatch' || outcome === 'missing') {
      await assert.rejects(install, /abort|取消/i)
      assert(token, 'must offer manual supplement before cancellation')
      assert(!fs.existsSync(instance)); assert(!events.some(e => e.stage === 'done'))
    } else {
      assert.equal(await install, id)
      const localName = outcome === 'included' ? 'renamed.jar.disabled' : 'restricted.jar'
      assert.deepEqual(fs.readFileSync(path.join(instance, 'mods', localName)), bundled)
      if (outcome === 'included') assert(!fs.existsSync(path.join(instance, 'mods/restricted.jar')))
      assert.deepEqual(fs.readFileSync(path.join(instance, 'mods/network.jar')), network)
      assert.deepEqual(fs.readFileSync(path.join(instance, 'config/player.txt')), Buffer.from('keep'))
      assert(requests.includes('/network'))
      assert.equal(requests.some(r => r.includes('restricted.jar')), outcome === 'supplied', 'only missing files need a CDN probe')
      assert.equal(events.at(-1).stage, 'done')
      const managed = JSON.parse(fs.readFileSync(path.join(instance, '.kamucl-modpack.json'), 'utf8')).managedFiles
      assert(managed.includes('mods/' + localName)); assert(managed.includes('mods/network.jar'))
      if (outcome === 'supplied') {
        const downloads = requests.filter(r => r === '/network').length
        const again = await runtime.installModpack(input, e => assert(!e.manualFiles), { targetFolder: game, instanceName: '再次导入' })
        assert.deepEqual(fs.readFileSync(path.join(game, 'versions', again, 'mods/restricted.jar')), bundled)
        assert.equal(requests.filter(r => r === '/network').length, downloads)
      }
    }
  } finally {
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await runtime?.closeHttpClient()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
