import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import AdmZip from 'adm-zip'
import http from 'node:http'
import { atomicUpdateJson, buildUpdaterScript, readUpdateTransaction, updateMarker, validateUpdatePayload, type UpdateTransaction } from '../src/main/core/updateTransaction'
import { installerDependencyTasks, prepareInstallerDependencies } from '../src/main/core/installerDependencies'
import { downloadFile } from '../src/main/core/download'
import { fetchSha256Sums } from '../src/main/core/selfUpdate'

const hash = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex')
test('update checksum lookup stays on the selected release when latest changes', async () => {
  const requested: string[] = [], hint = 'https://github.com/kamubaba-i/KAMUCL/releases/download/v1.0.77/KAMUCL-1.0.77.exe'
  const sums = await fetchSha256Sums(hint, async url => { requested.push(url); return new Response(hash('77') + '  KAMUCL-1.0.77.exe') })
  assert.equal(sums?.get('KAMUCL-1.0.77.exe'), hash('77'))
  assert.deepEqual(requested, [hint.replace(/[^/]+$/, 'SHA256SUMS.txt')])
  assert.equal(await fetchSha256Sums(hint, async url => url.endsWith('/latest')
    ? Response.json({ assets: [{ name: 'SHA256SUMS.txt', browser_download_url: 'https://example.com/SHA256SUMS.txt' }] })
    : new Response(hash('78') + '  KAMUCL-1.0.78.exe')), null)
})
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL 更新 [验证] ')), target = path.join(root, '我的启动器.exe')
  const file = path.join(root, 'KAMUCL-update', 'payload', 'KAMUCL-1.0.78.exe')
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(target, 'old'); fs.writeFileSync(file, 'new')
  const t: UpdateTransaction = { schema: 1, id: crypto.randomUUID(), target, file, sha256: hash('new'), size: 3, from: '1.0.77', mode: 'upgrade',
    release: { version: '1.0.78', assetName: 'KAMUCL-1.0.78.exe', assetUrl: '', assetSize: 3, publishedAt: '', body: '' } }
  return { root, target, file, t }
}
test('update marker roundtrip is target scoped; changed payload and invalid paths cannot apply', async () => {
  const f = fixture()
  try {
    atomicUpdateJson(updateMarker(f.target), f.t)
    assert.deepEqual(readUpdateTransaction(updateMarker(f.target), f.target), f.t)
    assert.equal(readUpdateTransaction(updateMarker(f.target), path.join(f.root, 'other.exe')), null)
    await validateUpdatePayload(f.t)
    fs.writeFileSync(f.file, 'bad')
    await assert.rejects(validateUpdatePayload(f.t), /SHA256/)
    atomicUpdateJson(updateMarker(f.target), { ...f.t, file: f.target })
    assert.equal(readUpdateTransaction(updateMarker(f.target), f.target), null)
    assert.equal(fs.readFileSync(f.target, 'utf8'), 'old')
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('native updater keeps the original filename, accepts an immediately closed healthy launcher, and never relaunches on replacement failure', { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
  const f = fixture()
  try {
    const source = path.join(f.root, 'Receipt.cs')
    fs.writeFileSync(source, `using System; using System.IO; class Receipt { static void Main() {
      string d=AppDomain.CurrentDomain.BaseDirectory;
      File.AppendAllText(Path.Combine(d,"launches.txt"),"started\\n");
      File.Copy(Path.Combine(d,"ack-fixture.json"),Path.Combine(d,".kamuclupdate.applying.receipt.json"),true);
    } }`)
    const csc = path.join(process.env.WINDIR!, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
    const compile = spawnSync(csc, ['/nologo', '/target:winexe', '/out:' + f.file, source], { windowsHide: true, encoding: 'utf8' })
    assert.equal(compile.status, 0, compile.stdout + compile.stderr)
    f.t.sha256 = hash(fs.readFileSync(f.file)); f.t.size = fs.statSync(f.file).size
    const claim = updateMarker(f.target) + '.applying'
    atomicUpdateJson(claim, f.t); atomicUpdateJson(path.join(f.root, 'ack-fixture.json'), { id: f.t.id, version: f.t.release.version })
    // A same-version filename beside the original must remain untouched.
    const collision = path.join(f.root, 'KAMUCL-1.0.78.exe'); fs.writeFileSync(collision, 'unrelated')
    const script = path.join(f.root, 'update.ps1')
    const spec = { oldExe: f.target, newExe: f.file, backupDir: path.join(f.root, 'backups'), mainPid: 99999999, stateDir: f.root, transaction: f.t, oldSha256: hash('old') }
    fs.writeFileSync(script, '\uFEFF' + buildUpdaterScript(spec))
    let run = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, timeout: 20000, encoding: 'utf8' })
    assert.equal(run.status, 0, run.stdout + run.stderr)
    assert.equal(hash(fs.readFileSync(f.target)), f.t.sha256, fs.readFileSync(path.join(f.root, 'updater-last.log'), 'utf8'))
    assert.equal(fs.readFileSync(path.join(spec.backupDir, f.t.id + '.exe'), 'utf8'), 'old')
    assert.equal(fs.readFileSync(collision, 'utf8'), 'unrelated')
    assert(fs.existsSync(claim + '.completed'), fs.readFileSync(path.join(f.root, 'updater-last.log'), 'utf8'))
    assert.equal(fs.readFileSync(path.join(f.root, 'launches.txt'), 'utf8'), 'started\n')
    assert(!fs.existsSync(path.join(f.root, 'update-failed.flag')))
    // A payload changed after claim fails before replacement and performs zero launches.
    atomicUpdateJson(claim, f.t); fs.writeFileSync(f.file, 'tampered')
    fs.writeFileSync(script, '\uFEFF' + buildUpdaterScript({ ...spec, oldSha256: f.t.sha256 }))
    run = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, timeout: 10000, encoding: 'utf8' })
    assert.equal(run.status, 0, run.stdout + run.stderr)
    assert(fs.existsSync(claim + '.failed'))
    assert.equal(hash(fs.readFileSync(f.target)), f.t.sha256)
    assert.equal(fs.readFileSync(path.join(f.root, 'launches.txt'), 'utf8'), 'started\n')
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('installer dependency preparation downloads concurrently, verifies cached bytes and excludes generated artifacts', { timeout: 15000 }, async () => {
  const f = fixture(), bytes = Buffer.from('verified artifact'), sha1 = crypto.createHash('sha1').update(bytes).digest('hex')
  let active = 0, peak = 0, requests = 0
  const server = http.createServer((_req, res) => { active++; requests++; peak = Math.max(peak, active); setTimeout(() => { active--; res.end(bytes) }, 80) })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const libraries = [0,1,2,3].map(i => ({ downloads: { artifact: { path: `lib/${i}.jar`, url: base + '/' + i, sha1, size: bytes.length } } }))
    const zip = new AdmZip(); zip.addFile('install_profile.json', Buffer.from(JSON.stringify({ libraries })))
    zip.addFile('version.json', Buffer.from(JSON.stringify({ libraries: [...libraries, { downloads: { artifact: { path: 'generated.jar', url: '' } } }] })))
    const jar = path.join(f.root, 'installer.jar'); zip.writeZip(jar)
    fs.mkdirSync(path.join(f.root, 'libraries', 'lib'), { recursive: true }); fs.writeFileSync(path.join(f.root, 'libraries', 'lib', '0.jar'), 'bad')
    assert.equal(installerDependencyTasks(jar, f.root).length, 4)
    await prepareInstallerDependencies(jar, f.root, 'official', () => {})
    assert(peak >= 2); assert.equal(requests, 4)
    for (const lib of libraries) assert.deepEqual(fs.readFileSync(path.join(f.root, 'libraries', lib.downloads.artifact.path)), bytes)
    await prepareInstallerDependencies(jar, f.root, 'official', () => {}); assert.equal(requests, 4)
    zip.addFile('version.json', Buffer.from(JSON.stringify({ libraries: [{ downloads: { artifact: { path: '../outside.jar', url: base } } }] }))); zip.writeZip(jar)
    assert.throws(() => installerDependencyTasks(jar, f.root), /越界/)
    await assert.rejects(downloadFile(base + '/failure', path.join(f.root, 'failure.jar'), undefined, undefined, 'official', AbortSignal.abort(new Error('cancelled'))), /cancelled/)
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); fs.rmSync(f.root, { recursive: true, force: true }) }
})
