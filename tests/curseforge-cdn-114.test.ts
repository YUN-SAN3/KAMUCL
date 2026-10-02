import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { constructCurseForgeCdnUrl, probeCurseForgeCdnUrl } from '../src/main/core/curseforgeDownload'
import { versionInstallHarness } from './helpers/version-install-harness'

const sha1 = (bytes: Buffer) => crypto.createHash('sha1').update(bytes).digest('hex')

test('CurseForge CDN uses unpadded ID segments and encodes the exact filename', () => {
  assert.equal(constructCurseForgeCdnUrl(8671039, 'tcrcore-2.8.7.jar'), 'https://edge.forgecdn.net/files/8671/39/tcrcore-2.8.7.jar')
  assert.equal(constructCurseForgeCdnUrl(6168001, 'Create Style for Refined Storage.zip'), 'https://edge.forgecdn.net/files/6168/1/Create%20Style%20for%20Refined%20Storage.zip')
  assert.equal(constructCurseForgeCdnUrl(1000, '中文 +#%.zip'), 'https://edge.forgecdn.net/files/1/0/%E4%B8%AD%E6%96%87%20%2B%23%25.zip')
  for (const id of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => constructCurseForgeCdnUrl(id, 'a.jar'))
  for (const name of ['', '..', '../a.jar', 'a\\b.jar']) assert.throws(() => constructCurseForgeCdnUrl(1, name))
})

test('CDN probe sends HEAD without Range, does not follow redirects, and preserves cancellation', async () => {
  const requests: string[] = []
  let delayed!: () => void
  const arrived = new Promise<void>(resolve => { delayed = resolve })
  const server = http.createServer((req, res) => {
    requests.push(req.url!)
    assert.equal(req.method, 'HEAD'); assert.equal(req.headers.range, undefined)
    if (req.url === '/delay') { delayed(); return }
    if (req.url === '/disconnect') { req.socket.destroy(); return }
    res.writeHead(Number(req.url!.slice(1)), { Location: '/must-not-follow' }); res.end()
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as any).port}`
  try {
    assert.equal(await probeCurseForgeCdnUrl(base + '/302'), true)
    for (const status of [200, 403, 404, 500]) assert.equal(await probeCurseForgeCdnUrl(base + '/' + status), false)
    assert.equal(await probeCurseForgeCdnUrl(base + '/disconnect'), false)
    const aborted = new AbortController(); aborted.abort()
    await assert.rejects(probeCurseForgeCdnUrl(base + '/not-requested', aborted.signal), /abort/i)
    const controller = new AbortController()
    const probe = probeCurseForgeCdnUrl(base + '/delay', controller.signal)
    await arrived; controller.abort()
    await assert.rejects(probe, /abort/i)
    assert(!requests.includes('/must-not-follow')); assert(!requests.includes('/not-requested'))
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())) }
})

for (const outcome of ['success', 'unavailable', 'corrupt'] as const) test(`real modpack pipeline with missing API URLs and CDN fallback: ${outcome}`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-cdn-'))
  const game = path.join(root, 'game'), client = Buffer.from('fixture-client')
  fs.mkdirSync(game)
  const files = [
    { projectID: 1325071, fileID: 8671039, name: 'tcrcore-2.8.7.jar', dir: 'mods' },
    { projectID: 542294, fileID: 7453586, name: 'ba_bt-1.20.1-3.0.0-beta3.2.1.jar', dir: 'mods' },
    { projectID: 1359195, fileID: 8066785, name: 'Vulmoons calaclysm remake_0.5.zip', dir: 'resourcepacks' },
    { projectID: 941802, fileID: 6168001, name: 'Create Style for Refined Storage.zip', dir: 'resourcepacks' },
    { projectID: 1, fileID: 1000, name: 'ordinary.jar', dir: 'mods' }
  ].map((f, index) => ({ ...f, bytes: Buffer.from('fixture-file-' + index), cdnPath: new URL(constructCurseForgeCdnUrl(f.fileID, f.name)).pathname }))
  const requests: Array<{ method: string; url: string }> = []
  const controller = new AbortController()
  let base = '', runtime: Awaited<ReturnType<typeof versionInstallHarness>> | undefined
  const server = http.createServer((req, res) => {
    const url = req.url!; requests.push({ method: req.method!, url })
    if (url === '/version') return void res.end(JSON.stringify({ id: '1.20.1', mainClass: 'fixture.Main', libraries: [], downloads: { client: { url: base + '/client', sha1: sha1(client), size: client.length } } }))
    if (url === '/client') return void res.end(client)
    if (url === '/ordinary') return void res.end(files[4].bytes)
    if (url.endsWith('/download-url')) return void res.end(JSON.stringify({ data: null }))
    const fileMatch = url.match(/\/mods\/(\d+)\/files\/(\d+)$/)
    if (fileMatch) {
      const f = files.find(f => f.projectID === Number(fileMatch[1]) && f.fileID === Number(fileMatch[2]))!
      return void res.end(JSON.stringify({ data: { id: f.fileID, modId: f.projectID, fileName: f.name,
        isAvailable: outcome !== 'unavailable', fileLength: f.bytes.length, hashes: [{ algo: 1, value: sha1(f.bytes) }],
        downloadUrl: f === files[4] ? 'https://pack-test.invalid/ordinary' : null } }))
    }
    const projectMatch = url.match(/\/mods\/(\d+)$/)
    if (projectMatch) {
      const f = files.find(f => f.projectID === Number(projectMatch[1]))!
      return void res.end(JSON.stringify({ data: { id: f.projectID, classId: f.dir === 'mods' ? 6 : 12 } }))
    }
    const f = files.find(f => url === f.cdnPath || url === '/payload' + f.cdnPath)
    if (f) {
      if (url === f.cdnPath) { assert.equal(req.headers.range, undefined); res.writeHead(302, { Location: 'https://pack-test.invalid/payload' + f.cdnPath }); return void res.end() }
      // Same-sized corrupt payload must still fail SHA1 validation.
      return void res.end(outcome === 'corrupt' ? Buffer.alloc(f.bytes.length, 120) : f.bytes)
    }
    res.writeHead(404); res.end()
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${(server.address() as any).port}`
  try {
    runtime = await versionInstallHarness(root,
      async () => Response.json({ versions: [{ id: '1.20.1', type: 'release', url: base + '/version', releaseTime: '2023-01-01' }] }),
      url => /curseforge|mcimirror|modrinth|cursemaven|forgecdn|pack-test\.invalid/.test(url) ? base + new URL(url).pathname : url)
    Object.assign(runtime.getSettings(), { gameDir: game, activeFolder: game, folders: [{ path: game, name: 'fixture', isDefault: true }], defaultIsolation: true, mirror: 'official' })
    const zip = new AdmZip(), input = path.join(root, 'fixture.zip')
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ name: 'cdn', minecraft: { version: '1.20.1' }, overrides: 'overrides', files: files.map(f => ({ projectID: f.projectID, fileID: f.fileID, required: true })) })))
    zip.writeZip(input)
    const manual: string[] = []
    const install = runtime.installModpack(input, e => {
      if (e.manualFiles) { manual.push(...e.manualFiles.files.map(f => f.fileName)); controller.abort() }
    }, { targetFolder: game, instanceName: 'cdn', signal: controller.signal })
    const instance = path.join(game, 'versions', 'cdn')
    if (outcome === 'success') {
      assert.equal(await install, 'cdn'); assert.deepEqual(manual, [])
      for (const f of files) assert.deepEqual(fs.readFileSync(path.join(instance, f.dir, f.name)), f.bytes)
      assert(!fs.existsSync(path.join(instance, 'mods', files[3].name)))
      for (const f of files.slice(0, 4)) assert(requests.some(r => r.method === 'HEAD' && r.url === f.cdnPath))
      assert(!requests.some(r => /cursemaven|version_file/.test(r.url)))
      assert(!requests.some(r => r.url.includes('/mods/1/files/1000/download-url') || r.url === files[4].cdnPath))
    } else {
      await assert.rejects(install, outcome === 'corrupt' ? /校验|hash|sha1/i : /abort|取消/i)
      assert(!fs.existsSync(instance), 'failed import must not publish an instance')
      if (outcome === 'unavailable') { assert(manual.length); assert(!requests.some(r => r.method === 'HEAD')) }
      else assert(requests.some(r => r.url.startsWith('/payload')), 'must exercise downloaded corrupt bytes')
    }
  } finally {
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await runtime?.closeHttpClient()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
