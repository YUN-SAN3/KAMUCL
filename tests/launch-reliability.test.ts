import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import http from 'node:http'
import test from 'node:test'
import AdmZip from 'adm-zip'
import { versionInstallHarness } from './helpers/version-install-harness'
import { invalidLaunchArtifact, ensureLaunchArtifact } from '../src/main/core/launchIntegrity'
import { ExitJournal } from '../src/main/core/exitJournal'

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-reliability-'))
const sha1 = (b: Buffer) => crypto.createHash('sha1').update(b).digest('hex')

test('Maven conflict identity selects child version while preserving classifiers/types and OS rules', async () => {
  const root = temp(), runtime = await versionInstallHarness(root)
  try {
    const library = (name: string, file: string, rules?: any[]) => ({ name, rules, downloads: { artifact: { path: file, url: 'https://example.invalid/' + file } } })
    const libs = [library('g:a:3', 'disallowed.jar', [{ action: 'disallow' }]), library('g:a:2', 'child.jar'), library('g:a:1', 'parent.jar'), library('g:a:2:tests', 'tests.jar'), library('g:a:2@zip', 'data.zip')]
    const vj = { libraries: libs }
    assert.deepEqual(runtime.libraryTasks(vj).map(t => path.basename(t.dest)), ['child.jar', 'tests.jar', 'data.zip'])
    assert.deepEqual(runtime.resolvedLibraries(vj).artifacts.map(p => path.basename(p)), ['child.jar', 'tests.jar', 'data.zip'])
    const folder = runtime.getSettings().gameDir
    for (const [id, json] of Object.entries({ parent: { id: 'parent', libraries: [libs[2]] }, child: { id: 'child', inheritsFrom: 'parent', libraries: [libs[1]] } })) {
      const dir = path.join(folder, 'versions', id); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(json))
    }
    assert.deepEqual(runtime.libraryTasks(runtime.resolveVersionChain('child').merged).map(t => path.basename(t.dest)), ['child.jar'])
    const native = { libraries: [{ name: 'g:a:2', natives: { windows: 'natives-windows', linux: 'natives-windows', osx: 'natives-windows' }, downloads: { artifact: { path: 'a.jar', url: 'https://example.invalid/a' }, classifiers: { 'natives-windows': { path: 'native.jar', url: 'https://example.invalid/n' } } } }] }
    assert.equal(runtime.resolvedLibraries(native).natives.length, 1)
    assert.equal(runtime.resolvedLibraries(native).artifacts.length, 1)
  } finally { await runtime.closeHttpClient(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('launch verification catches truncated and same-size corrupt client/library downloads and repairs them', async () => {
  const root = temp(), zip = new AdmZip(); zip.addFile('data.txt', Buffer.from('correct jar data'))
  const bytes = zip.toBuffer(); let hits = 0
  const server = http.createServer((_req, res) => { hits++; res.end(bytes) })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/client.jar`
    for (const data of [Buffer.alloc(0), bytes.subarray(0, 5), Buffer.alloc(bytes.length, 5)]) {
      const artifact = { dest: path.join(root, 'client.jar'), url, size: bytes.length, sha1: sha1(bytes) }
      fs.writeFileSync(artifact.dest, data)
      assert(await invalidLaunchArtifact(artifact))
      assert(await ensureLaunchArtifact(artifact, 'official'))
      assert.equal(await invalidLaunchArtifact(artifact), null)
      assert.deepEqual(fs.readFileSync(artifact.dest), bytes)
    }
    assert.equal(hits, 3)
    assert.equal(await ensureLaunchArtifact({ dest: path.join(root, 'client.jar'), url, sha1: sha1(bytes), size: bytes.length }, 'official'), false)
    assert.equal(hits, 3, 'valid files stay offline')
    const unknown = { dest: path.join(root, 'unknown.jar'), url }
    fs.writeFileSync(unknown.dest, '<html>not a jar</html>')
    assert(await ensureLaunchArtifact(unknown, 'official'))
    assert.equal(await invalidLaunchArtifact(unknown), null)
    await assert.rejects(ensureLaunchArtifact({ dest: path.join(root, 'generated.jar') }, 'official'), /缺少下载地址/)
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); fs.rmSync(root, { recursive: true, force: true }) }
})

test('failed repair cannot pass integrity verification or launch', async () => {
  const root = temp(), server = http.createServer((_req, res) => res.writeHead(404).end())
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  try {
    fs.writeFileSync(path.join(root, 'client.jar'), 'damaged but recoverable original')
    await assert.rejects(ensureLaunchArtifact({ dest: path.join(root, 'client.jar'), url: `http://127.0.0.1:${(server.address() as { port: number }).port}/bad` }, 'official'), /下载失败/)
    assert.equal(fs.readFileSync(path.join(root, 'client.jar'),'utf8'),'damaged but recoverable original')
    assert(!fs.readdirSync(root).some(n=>n.startsWith('.kamucl-repair-')))
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); fs.rmSync(root, { recursive: true, force: true }) }
})

test('abnormal launcher/game exits persist across reopen; normal and intentional exits do not create crash records', () => {
  const root = temp(), file = path.join(root, 'exits.json')
  try {
    const j = new ExitJournal(file, () => false)
    const normal = j.begin('launcher', 123, 'test'); j.end(normal, 0)
    const stopped = j.begin('game', 124, 'MC'); j.end(stopped, 1, true)
    assert.equal(j.list().length, 0)
    const game = j.begin('game', 125, 'instance', { versionId: 'instance', logDir: 'private/logs' }); j.end(game, -1)
    j.begin('launcher', 126, 'test')
    const reopened = new ExitJournal(file, () => false); reopened.reconcile()
    assert.equal(reopened.list().length, 2)
    assert.equal(reopened.list()[1].context?.exitCode, -1)
    reopened.reconcile(); assert.equal(reopened.list().length, 2, 'no duplicate report')
    reopened.acknowledge(); assert(reopened.list().every(e => e.seen))
    assert.equal(new ExitJournal(file).list().length, 2, 'reading does not erase history')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('live games survive launcher reopening and parallel game records cannot overwrite each other', () => {
  const root = temp(), file = path.join(root, 'exits.json')
  try {
    const j = new ExitJournal(file, pid => pid === 20)
    const first = j.begin('game', 20, 'same version'), second = j.begin('game', 21, 'same version')
    j.reconcile(); assert.equal(j.list().length, 1); assert.match(j.list()[0].text, /未收到退出状态/)
    j.end(first, 0); j.end(second, 0); assert.equal(j.list().length, 1)
    j.clearHistory(); assert.equal(j.list().length, 0)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
