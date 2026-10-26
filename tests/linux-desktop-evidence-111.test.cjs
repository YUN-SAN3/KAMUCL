const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto')
const source = fs.readFileSync(path.resolve('scripts/verify-linux-desktop.cjs'), 'utf8')

async function preflightFailure({ removeOut, finalizerFailure } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-linux-evidence-fixture-')), commit = 'a'.repeat(40), arch = 'x64', version = require('../package.json').version
  let spawned = 0, outReadyAtFailure = false
  const processFixture = { argv: ['node', 'script', arch, '--fixture-smoke'], platform: 'linux', arch, execPath: process.execPath, env: { DISPLAY: ':fixture' }, getuid: () => 1000 }
  try {
    const release = path.join(root, 'release'), bytes = Buffer.from('synthetic preflight archive; never executed'), name = `KAMUCL-${version}-linux-${arch}.tar.gz`
    fs.mkdirSync(path.join(release, 'linux-proof-x64-packages'), { recursive: true }); fs.writeFileSync(path.join(release, name), bytes)
    fs.writeFileSync(path.join(release, 'linux-proof-x64-packages/summary.json'), JSON.stringify({ version, arch, sourceCommit: commit, packages: [{ name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }] }))
    const requireFixture = id => {
      if (id === 'node:fs') return { ...fs, readFileSync: (file, ...args) => file === '/etc/os-release' ? 'VERSION_ID="24.04"\n' : fs.readFileSync(file, ...args), readdirSync: (file, ...args) => {
        if (finalizerFailure && file === path.join(root, 'out')) throw Object.assign(Error('evidence collection denied'), { code: 'EACCES', syscall: 'scandir' })
        return fs.readdirSync(file, ...args)
      } }
      if (id === 'node:os') return { ...os, tmpdir: () => root }
      if (id === '../package.json') return { version }
      if (id === './qa-owned-process-119.cjs') return {}
      if (id === './verify-linux-runtime.cjs') return { observeLinuxRuntime: () => ({ platform: 'linux', arch, electron: '44.3.0' }) }
      if (id === 'node:child_process') return { spawn: () => { spawned++; throw Error('No product may start before preflight succeeds') }, execFileSync: (command, args) => {
        if (command === 'git') return commit + '\n'
        if (command === 'glxinfo') return 'OpenGL renderer string: llvmpipe fixture\n'
        if (command === '/bin/ps') return 'Xvfb\nopenbox\n'
        if (command === '/usr/bin/tar') {
          const app = path.join(args[3], 'KAMUCL'); fs.mkdirSync(path.join(app, 'resources'), { recursive: true })
          fs.writeFileSync(path.join(app, 'resources/kamucl-linux.json'), JSON.stringify({ schemaVersion: 1, version, arch, installationKind: 'portable-directory', sourceCommit: commit, runtimeVersion: '44.3.0' })); return ''
        }
        assert.equal(command, 'xdpyinfo'); outReadyAtFailure = fs.existsSync(path.join(root, 'out'))
        if (removeOut) fs.rmSync(path.join(root, 'out'), { recursive: true, force: true })
        throw Object.assign(Error('spawnSync xdpyinfo ENOENT'), { code: 'ENOENT', syscall: 'spawnSync xdpyinfo' })
      } }
      return require(id)
    }
    await new vm.Script(source, { filename: 'verify-linux-desktop.cjs' }).runInNewContext({ require: requireFixture, __dirname: path.join(root, 'scripts'), process: processFixture, console: { error: () => {} }, Buffer, setTimeout, clearTimeout })
    const proof = fs.readdirSync(release).find(file => file.startsWith('linux-desktop-'))
    return { report: JSON.parse(fs.readFileSync(path.join(release, proof, 'summary.json'))), exitCode: processFixture.exitCode, spawned, outReadyAtFailure }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

test('Linux QA persists original missing-tool evidence on a fresh checkout even if out disappears', async () => {
  const result = await preflightFailure({ removeOut: true })
  assert.equal(result.outReadyAtFailure, true); assert.equal(result.spawned, 0); assert.equal(result.exitCode, 1)
  assert.equal(result.report.complete, false); assert.equal(result.report.nativeDesktop, false); assert.deepEqual(result.report.steps, [])
  assert.equal(result.report.error.code, 'ENOENT'); assert.equal(result.report.error.syscall, 'spawnSync xdpyinfo'); assert(result.report.finishedAt)
  assert.equal(result.report.finalizationError, undefined)
})

test('Linux QA preserves the primary failure when evidence collection also fails', async () => {
  const result = await preflightFailure({ finalizerFailure: true })
  assert.equal(result.spawned, 0); assert.equal(result.exitCode, 1); assert.equal(result.report.complete, false)
  assert.equal(result.report.error.code, 'ENOENT'); assert.equal(result.report.error.syscall, 'spawnSync xdpyinfo')
  assert.equal(result.report.finalizationError.code, 'EACCES'); assert.equal(result.report.finalizationError.syscall, 'scandir'); assert(result.report.finishedAt)
})
