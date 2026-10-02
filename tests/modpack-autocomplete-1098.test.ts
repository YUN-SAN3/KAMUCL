import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { BundledModpackFiles } from '../src/main/core/modpackBundledFiles'
import { LocalModpackFiles } from '../src/main/core/modpackLocalFiles'
import { resolveCurseForgeFileUrl } from '../src/main/core/curseforgeDownload'
import { versionInstallHarness } from './helpers/version-install-harness'

const sha1 = (bytes: Buffer) => crypto.createHash('sha1').update(bytes).digest('hex')

test('包内全局数据包按真实路径复用，加载器缓存和同名错误副本不能满足清单', async () => {
  const bytes = Buffer.from('exact datapack'), zip = new AdmZip()
  zip.addFile('overrides/global_packs/datapacks/BotanyPots.zip', bytes)
  zip.addFile('overrides/global_packs/both/both.zip', Buffer.from('both'))
  zip.addFile('overrides/resourcepacks/renamed.zip', Buffer.from('resource'))
  zip.addFile('overrides/mods/.cache/hidden.jar', Buffer.from('hidden'))
  zip.addFile('overrides/backups/copied.jar', Buffer.from('backup'))
  const index = new BundledModpackFiles(zip, 'overrides')
  for (const [text, rel] of [['exact datapack','global_packs/datapacks/BotanyPots.zip'], ['both','global_packs/both/both.zip'], ['resource','resourcepacks/renamed.zip']]) {
    const data = Buffer.from(text)
    assert.equal(await index.find({ size: data.length, sha1: sha1(data) }), rel)
  }
  for (const text of ['hidden', 'backup']) {
    const data = Buffer.from(text)
    assert.equal(await index.find({ size: data.length, sha1: sha1(data) }), null)
  }
})

test('独立下载地址接口拒绝无效协议、认证 URL 和失败响应，尝试下一配置来源', async () => {
  const server = http.createServer((req, res) => {
    const data = req.url!.startsWith('/valid') ? 'https://example.invalid/exact.jar' :
      req.url!.startsWith('/credentials') ? 'https://user:secret@example.invalid/a.jar' : 'file:///C:/fake.jar'
    res.end(JSON.stringify({ data }))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as any).port}`
  try {
    assert.equal(await resolveCurseForgeFileUrl(1, 2, [{ base }]), null)
    assert.equal(await resolveCurseForgeFileUrl(1, 2, [{ base: base + '/credentials' }]), null)
    assert.equal(await resolveCurseForgeFileUrl(1, 2, [{ base }, { base: base + '/valid' }]), 'https://example.invalid/exact.jar')
    const controller = new AbortController(); controller.abort()
    await assert.rejects(resolveCurseForgeFileUrl(1, 2, [{ base }], controller.signal), /abort/i)
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())) }
})

for (const corrupt of [false, true]) test(`整合包真实安装编排：包内 ZIP、本地改名 JAR、API 补链、Maven 精确补全，错误内容=${corrupt}`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-autocomplete-'))
  const game = path.join(root, 'game'), other = path.join(root, 'other'), bytes = [
    Buffer.from('bundle datapack'), Buffer.from('local file'), Buffer.from('maven mod'), Buffer.from('resource zip')
  ]
  const names = ['bundled.zip', 'local.jar', 'missing.jar', 'resource.zip']
  const client = Buffer.from('client'), requests: string[] = []
  fs.mkdirSync(game)
  let base = '', runtime: Awaited<ReturnType<typeof versionInstallHarness>> | undefined
  const controller = new AbortController()
  const server = http.createServer((req, res) => {
    const url = req.url!; requests.push(url)
    if (url === '/version') return void res.end(JSON.stringify({ id: '1.20.1', mainClass: 'fixture.Main', libraries: [], downloads: { client: { url: base + '/client', sha1: sha1(client), size: client.length } } }))
    if (url === '/client') return void res.end(client)
    if (url === '/resource') return void res.end(bytes[3])
    if (url.startsWith('/curse/maven/')) return void res.end(corrupt ? Buffer.from('wrong mod') : bytes[2])
    if (url.endsWith('/download-url')) return void res.end(JSON.stringify({ data: url.includes('/mods/4/') ? 'https://pack-test.invalid/resource' : null }))
    const m = url.match(/\/mods\/(\d+)\/files\/(\d+)$/)
    if (m) {
      const index = Number(m[1]) - 1
      return void res.end(JSON.stringify({ data: { modId: Number(m[1]), id: Number(m[2]), isAvailable: true, fileName: names[index],
        downloadUrl: null, fileLength: bytes[index].length, hashes: [{ algo: 1, value: sha1(bytes[index]) }] } }))
    }
    if (url === '/curseforge/v1/mods/4' || url === '/v1/mods/4') return void res.end(JSON.stringify({ data: { id: 4, classId: 12 } }))
    res.writeHead(404); res.end()
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${(server.address() as any).port}`
  try {
    runtime = await versionInstallHarness(root,
      async () => Response.json({ versions: [{ id: '1.20.1', type: 'release', url: base + '/version', releaseTime: '2023-01-01' }] }),
      url => /curseforge|mcimirror|modrinth|cursemaven|forgecdn/.test(url) ? base + new URL(url).pathname : url.replace('https://pack-test.invalid', base))
    Object.assign(runtime.getSettings(), { gameDir: game, activeFolder: game, folders: [{ path: game, name: 'new', isDefault: true }, { path: other, name: 'old' }], defaultIsolation: true, mirror: 'bmclapi' })
    const source = path.join(other, 'versions', 'previous', 'mods', 'renamed.jar.disabled')
    fs.mkdirSync(path.dirname(source), { recursive: true }); fs.writeFileSync(source, bytes[1])
    const input = path.join(root, 'pack.zip'), zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ name: 'fixture', minecraft: { version: '1.20.1' }, overrides: 'overrides',
      files: bytes.map((_, i) => ({ projectID: i + 1, fileID: i + 101, required: true })) })))
    zip.addFile('overrides/global_packs/datapacks/renamed.zip', bytes[0]); zip.writeZip(input)
    const manual: any[] = []
    const install = runtime.installModpack(input, e => {
      if (e.manualFiles) { manual.push(...e.manualFiles.files); controller.abort() }
    }, { targetFolder: game, instanceName: 'test', signal: controller.signal })
    const instance = path.join(game, 'versions', 'test')
    if (corrupt) {
      await assert.rejects(install, /abort|取消/i)
      assert.deepEqual(manual.map(f => f.fileName), ['missing.jar'])
      assert(!fs.existsSync(instance), 'failed import must roll back')
    } else {
      assert.equal(await install, 'test'); assert.deepEqual(manual, [])
      for (const [i, rel] of ['global_packs/datapacks/renamed.zip', 'mods/local.jar', 'mods/missing.jar', 'resourcepacks/resource.zip'].entries()) {
        assert.deepEqual(fs.readFileSync(path.join(instance, rel)), bytes[i])
      }
      assert(!fs.existsSync(path.join(instance, 'mods', 'bundled.zip')))
      assert(!fs.existsSync(path.join(instance, 'mods', 'resource.zip')))
      assert(!requests.some(url => url.includes('/mods/1/files/101/download-url') || url.includes('/mod-2/')))
      fs.writeFileSync(path.join(instance, 'mods/local.jar'), 'changed')
    }
    assert.deepEqual(fs.readFileSync(source), bytes[1], 'reuse must copy, never mutate original')
    const index = new LocalModpackFiles([other])
    assert.equal(await index.find({ fileName: 'local.jar', size: bytes[1].length, sha1: '0'.repeat(40) }), null)
  } finally {
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await runtime?.closeHttpClient()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
