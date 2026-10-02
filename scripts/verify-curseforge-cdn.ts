// Live acceptance of the four reported files through the real modpack installer.
// A minimal local vanilla runtime keeps this focused on pack-file resolution,
// downloads, hash checks and install paths; it is not a full-pack/game launch test.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import AdmZip from 'adm-zip'
import { versionInstallHarness } from '../tests/helpers/version-install-harness'

const require = createRequire(import.meta.url)
const undici = require('undici'), originalFetch = undici.fetch
const proxy = process.env.HTTPS_PROXY ? new undici.ProxyAgent(process.env.HTTPS_PROXY) : undefined
const cdnRequests: Array<{ url: string; method: string; status: number }> = []
undici.fetch = async (url: string, init: any = {}) => {
  const response = await originalFetch(url, {
    ...init, ...(proxy && !new URL(url).hostname.match(/^(127\.0\.0\.1|localhost)$/) ? { dispatcher: proxy } : {})
  })
  if (new URL(url).hostname.endsWith('.forgecdn.net')) cdnRequests.push({ url, method: init.method || 'GET', status: response.status })
  return response
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-cdn-live-'))
const game = path.join(root, 'game'), client = Buffer.from('isolated validation runtime')
const hash = (bytes: Buffer) => crypto.createHash('sha1').update(bytes).digest('hex')
const files = [
  { projectID: 1325071, fileID: 8671039, dir: 'mods' },
  { projectID: 542294, fileID: 7453586, dir: 'mods' },
  { projectID: 1359195, fileID: 8066785, dir: 'resourcepacks' },
  { projectID: 941802, fileID: 6168001, dir: 'resourcepacks' }
]
let base = '', runtime: Awaited<ReturnType<typeof versionInstallHarness>> | undefined
const server = http.createServer((req, res) => {
  if (req.url === '/client') return void res.end(client)
  if (req.url === '/version') return void res.end(JSON.stringify({ id: '1.20.1', mainClass: 'validation.Only', libraries: [], downloads: { client: { url: base + '/client', sha1: hash(client), size: client.length } } }))
  res.writeHead(404); res.end()
})

async function main() {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as any).port}`
  fs.mkdirSync(game)
  const identities = await Promise.all(files.map(async f => {
    const res = await undici.fetch(`https://mod.mcimirror.top/curseforge/v1/mods/${f.projectID}/files/${f.fileID}`, { signal: AbortSignal.timeout(30000) })
    assert(res.ok, `metadata HTTP ${res.status}`)
    const { data } = await res.json()
    assert.equal(data.id, f.fileID); assert.equal(data.modId, f.projectID)
    return { ...f, fileName: data.fileName, size: data.fileLength, sha1: data.hashes.find((h: any) => h.algo === 1).value.toLowerCase(), metadataUrl: data.downloadUrl }
  }))
  runtime = await versionInstallHarness(root, async () => Response.json({ versions: [{ id: '1.20.1', type: 'release', url: base + '/version', releaseTime: '2023-01-01' }] }))
  Object.assign(runtime.getSettings(), { gameDir: game, activeFolder: game, folders: [{ path: game, name: 'isolated acceptance', isDefault: true }], defaultIsolation: true, mirror: 'official' })
  const zip = new AdmZip(), input = path.join(root, 'reported-files.zip')
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({ name: 'reported-files', minecraft: { version: '1.20.1' }, overrides: 'overrides', files: files.map(({ projectID, fileID }) => ({ projectID, fileID, required: true })) })))
  zip.writeZip(input)
  const controller = new AbortController(), manual: any[] = []
  let last = 0
  const id = await runtime.installModpack(input, e => {
    if (e.manualFiles) { manual.push(...e.manualFiles.files); controller.abort() }
    if (Date.now() - last > 5000) { console.log(e.text); last = Date.now() }
  }, { targetFolder: game, instanceName: 'reported-files', signal: controller.signal })
  assert.deepEqual(manual, [], 'reported files still require manual supplementation')
  const verified = identities.map(f => {
    const relative = `${f.dir}/${f.fileName}`, bytes = fs.readFileSync(path.join(game, 'versions', id, relative))
    assert.equal(bytes.length, f.size); assert.equal(hash(bytes), f.sha1)
    assert.equal(f.metadataUrl, null, 'sample no longer exercises missing metadata URL')
    const cdnPath = `/files/${Math.floor(f.fileID / 1000)}/${f.fileID % 1000}/${encodeURIComponent(f.fileName)}`
    assert(cdnRequests.some(r => new URL(r.url).pathname === cdnPath && r.method === 'HEAD' && r.status === 302), 'missing successful CDN probe')
    assert(cdnRequests.some(r => new URL(r.url).pathname === cdnPath && r.method === 'GET' && [200, 206].includes(r.status)), 'missing real CDN download')
    return { ...f, installedPath: relative, verified: true }
  })
  const report = { version: require('../package.json').version, checkedAt: new Date().toISOString(), complete: true,
    scope: 'Four real reported files imported with a minimal local vanilla runtime; original full packs unavailable.',
    manualSupplementRequested: false, files: verified, cdnRequests }
  const output = path.resolve(`docs/validation/curseforge-cdn-${report.version}.json`)
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ root, output, ...report }, null, 2))
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()))
  await runtime?.closeHttpClient(); await proxy?.close(); undici.fetch = originalFetch
})
