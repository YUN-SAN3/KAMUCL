import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const { IDENTITY_FILE, createMacIdentity, readMacPackageIdentity, collectMacWorldHashes, assertMacNormalGameExit } = createRequire(path.resolve('package.json'))('./scripts/mac-package-identity.cjs')
const sha = (bytes: Buffer | string) => crypto.createHash('sha256').update(bytes).digest('hex')
function fixture(arch: 'arm64' | 'x64' = 'arm64') {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL Mac identity fixture '))
  const resources = path.join(app, 'Contents', 'Resources'); fs.mkdirSync(resources, { recursive: true })
  const bytes = Buffer.from('synthetic ASAR fixture; no native package claim')
  fs.writeFileSync(path.join(resources, 'app.asar'), bytes)
  const expected = { version: '1.1.11', arch, sourceCommit: '1'.repeat(40), runtimeVersion: '44.3.0', minimumSystemVersion: '13.0.0' }
  const identity = createMacIdentity({ ...expected, appAsarSHA256: sha(bytes) })
  const file = path.join(resources, IDENTITY_FILE); fs.writeFileSync(file, JSON.stringify(identity))
  const commands: string[] = []
  const execute = (command: string, args: string[]) => {
    commands.push(command + ' ' + args.join(' '))
    if (command === 'lipo') return arch === 'x64' ? 'x86_64\n' : 'arm64\n'
    if (command === 'plutil') return args[1] === 'CFBundleVersion' ? '44.3.0\n' : '13.0.0\n'
    return ''
  }
  const read = (wanted = expected, observer = execute) => readMacPackageIdentity(app, wanted, { execute: observer })
  return { app, resources, file, identity, expected, execute, commands, read, dispose: () => fs.rmSync(app, { recursive: true, force: true }) }
}

test('Mac signed resource identity binds source, architecture and actual framework observations on both ABIs', () => {
  for (const arch of ['arm64', 'x64'] as const) {
    const f = fixture(arch)
    try {
      const proof = f.read(); assert.deepEqual(proof.identity, f.identity)
      assert.equal(proof.identitySHA256, sha(fs.readFileSync(f.file)))
      assert.equal(proof.observedRuntime, '44.3.0'); assert.equal(proof.observedMinimum, '13.0.0')
      assert.equal(f.commands.filter(x => x.startsWith('lipo ')).length, 2)
      assert(f.commands.some(x => x.startsWith('codesign --verify --deep --strict ')))
      // These command responses are explicit unit fixtures, not native execution.
      for (const [key, wrong] of Object.entries({ sourceCommit: '2'.repeat(40), arch: arch === 'x64' ? 'arm64' : 'x64', runtimeVersion: '33.4.11', version: '1.1.10', minimumSystemVersion: '12.0.0' })) {
        assert.throws(() => f.read({ ...f.expected, [key]: wrong }), new RegExp(key))
      }
    } finally { f.dispose() }
  }
})

test('Mac identity rejects absent metadata, payload tampering, wrong native ABI and mismatched actual runtime', () => {
  const f = fixture()
  try {
    fs.unlinkSync(f.file); assert.throws(() => f.read(), /ENOENT/)
    fs.writeFileSync(f.file, JSON.stringify({ ...f.identity, sourceCommit: 'unknown' })); assert.throws(() => f.read(), /actual Git commit/)
    fs.writeFileSync(f.file, JSON.stringify(f.identity))
    fs.writeFileSync(path.join(f.resources, 'app.asar'), 'tampered'); assert.throws(() => f.read(), /ASAR bytes/)
    fs.writeFileSync(path.join(f.resources, 'app.asar'), 'synthetic ASAR fixture; no native package claim')
    assert.throws(() => f.read(f.expected, (command: string, args: string[]) => command === 'lipo' ? 'x86_64\n' : f.execute(command, args)), /executable ABI/)
    assert.throws(() => f.read(f.expected, (command: string, args: string[]) => command === 'plutil' && args[1] === 'CFBundleVersion' ? '33.4.11\n' : f.execute(command, args)), /Actual Electron framework/)
    assert.throws(() => f.read(f.expected, (command: string, args: string[]) => command === 'codesign' ? (() => { throw Error('unsigned resource') })() : f.execute(command, args)), /unsigned resource/)
  } finally { f.dispose() }
})

test('Mac saved-world receipt hashes actual level and region bytes without copying private worlds', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL world hash fixture '))
  try {
    const region = path.join(root, 'dimensions', 'minecraft', 'overworld', 'region'); fs.mkdirSync(region, { recursive: true })
    fs.writeFileSync(path.join(root, 'level.dat'), 'synthetic level')
    fs.writeFileSync(path.join(region, 'r.0.0.mca'), 'synthetic region')
    const result = collectMacWorldHashes(root)
    assert.equal(result.fileSHA256, sha('synthetic level')); assert.equal(result.saved, true)
    assert.deepEqual(result.files, [{ path: 'level.dat', bytes: 15, sha256: sha('synthetic level') }, { path: 'dimensions/minecraft/overworld/region/r.0.0.mca', bytes: 16, sha256: sha('synthetic region') }])
    fs.writeFileSync(path.join(region, 'r.0.0.mca'), ''); assert.throws(() => collectMacWorldHashes(root), /empty or unsafe/)
    fs.unlinkSync(path.join(region, 'r.0.0.mca')); assert.throws(() => collectMacWorldHashes(root), /chunks were not saved/)
    fs.writeFileSync(path.join(region, 'r.0.0.mca'), 'region'); fs.unlinkSync(path.join(root, 'level.dat')); assert.throws(() => collectMacWorldHashes(root), /ENOENT/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('Mac normal world-save receipt requires this launch actual code zero, exit kind and unforced shutdown', () => {
  const expected = { versionId: 'fixture-game', folder: '/synthetic-fixture', launchId: 'owned-launch' }
  const state = { ...expected, status: 'exited', code: 0, exitKind: 'normal', intentionalStop: false, intentionalRestart: false }
  const event = (value: Record<string, unknown>) => [{ name: 'launchLog', value: 'Saving chunks!' }, { name: 'launchState', value }]
  assert.deepEqual(assertMacNormalGameExit(event(state), expected), state)
  for (const changed of [{ code: 1 }, { code: null }, { exitKind: 'abnormal' }, { exitKind: 'stopped' }, { intentionalStop: true }, { intentionalRestart: true }, { launchId: 'unrelated-launch' }, { folder: '/other-game' }, { versionId: 'other-game' }, { status: 'running' }]) {
    assert.throws(() => assertMacNormalGameExit(event({ ...state, ...changed }), expected))
  }
  assert.throws(() => assertMacNormalGameExit([{ name: 'launchLog', value: 'Saving chunks! normal close' }], expected), /exit event missing/)
})
