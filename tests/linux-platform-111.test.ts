import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { protectedCredentialStorage, credentialStorageStatus } from '../src/main/core/credentialProtection'
import { assertLinuxElf, linuxTarHeader, validateLinuxArchive, assertLinuxManifest } from '../src/main/core/linuxUpdateIdentity'

function header(name: string, bytes = 0, kind = '0'): Buffer {
  const b = Buffer.alloc(512)
  b.write(name); b.write('0000755\0', 100); b.write('0000000\0', 108); b.write('0000000\0', 116)
  b.write(bytes.toString(8).padStart(11, '0') + '\0', 124); b.write('00000000000\0', 136)
  b.fill(32, 148, 156); b.write(kind, 156); b.write('ustar\0', 257); b.write('00', 263)
  b.write(b.reduce((sum, value) => sum + value, 0).toString(8).padStart(6, '0') + '\0 ', 148)
  return b
}
function archive(entries: string[], complete = true) {
  const blocks = entries.map(name => header(name))
  if (complete) blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}
test('Linux credentials reject basic_text and unknown backends even if cipher is available', () => {
  for (const backend of ['basic_text', 'unknown', '']) {
    const storage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend }
    assert.equal(protectedCredentialStorage(storage, 'linux'), false)
    assert.equal(credentialStorageStatus(storage, 'linux').sessionOnly, true)
  }
  for (const backend of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']) assert.equal(protectedCredentialStorage({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend }, 'linux'), true)
  assert.equal(protectedCredentialStorage({ isEncryptionAvailable: () => false }, 'win32'), false)
  assert.equal(protectedCredentialStorage({ isEncryptionAvailable: () => true }, 'darwin'), true)
})
test('Linux native ELF identity verifies both architectures rather than 64 bit alone', () => {
  const elf = Buffer.alloc(64); elf.write('\x7fELF', 0, 'binary'); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(183, 18)
  assert.doesNotThrow(() => assertLinuxElf(elf, 'arm64'))
  assert.throws(() => assertLinuxElf(elf, 'x64'), /架构/)
  elf.writeUInt16LE(62, 18); assert.doesNotThrow(() => assertLinuxElf(elf, 'x64'))
  assert.throws(() => assertLinuxElf(elf, 'riscv64'), /架构/)
  elf[4] = 1; assert.throws(() => assertLinuxElf(elf, 'x64'), /64/)
})

test('Linux updater performs real swap, receipt and failure restoration without concurrent launchers', { skip: process.platform !== 'linux' }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linux-update 中文 ' "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const compiled = await build({ entryPoints: ['src/main/core/linuxUpdate.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' })
  const req = createRequire(path.resolve('package.json')), mod: any = { exports: {} }
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)((name: string) => name === 'electron' ? { app: { getPath: () => root, getVersion: () => '1.1.11', isPackaged: true }, shell: {} } : req(name), mod, mod.exports)
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  const q = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'"
  const run = (file: string): Promise<number | null> => new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', [file], { stdio: 'ignore' }), timer = setTimeout(() => { child.kill('SIGTERM'); reject(Error('Owned updater fixture exceeded deadline')) }, 10000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); resolve(code) })
  })
  for (const mode of ['receipt', 'timeout', 'tampered'] as const) {
    const dir = path.join(root, mode), target = path.join(dir, 'KAMUCL'), staged = path.join(dir, 'stage'), state = path.join(dir, 'state'), log = path.join(dir, 'events')
    for (const appDir of [target, staged]) fs.mkdirSync(path.join(appDir, 'resources'), { recursive: true })
    fs.mkdirSync(state); fs.writeFileSync(path.join(target, 'resources/app.asar'), 'old'); fs.writeFileSync(path.join(staged, 'resources/app.asar'), 'new')
    const id = randomUUID(), applying = path.join(state, 'linux-update.json.applying'), pidFile = path.join(dir, 'new.pid')
    fs.writeFileSync(applying, JSON.stringify({ id }))
    const oldProgram = '#!/bin/sh\n' + 'if [ -f ' + q(pidFile) + ' ] && kill -0 "$(cat ' + q(pidFile) + ')" 2>/dev/null; then printf CONCURRENT >>' + q(log) + '; exit 9; fi\nprintf "OLD\\n" >>' + q(log) + '\n'
    const newProgram = '#!/bin/sh\nprintf "NEW\\n" >>' + q(log) + '\nprintf "%s" "$$" >' + q(pidFile) + '\n' + (mode === 'receipt' ? 'printf "%s" ' + q(id) + ' >' + q(applying + '.receipt') + '\n' : 'sleep 5\n')
    fs.writeFileSync(path.join(target, 'kamucl'), oldProgram, { mode: 0o755 }); fs.writeFileSync(path.join(staged, 'kamucl'), newProgram, { mode: 0o755 })
    // Only the fixture clock is shortened. The production helper still waits
    // its original 120 seconds and retains exact PID/starttime identity checks.
    const transaction = { schema: 1, id, target, file: path.join(dir, 'file.tar.gz'), sha256: hash('new'), size: 3, from: '1.1.10', release: { version: '1.1.11' }, mode: 'upgrade' }
    const source = mod.exports.linuxUpdaterScript(transaction, staged, mode === 'tampered' ? hash('wrong') : hash('old'), hash('new'), 2147483647, state, 'portable-directory')
    const script = path.join(dir, 'update.sh')
    fs.writeFileSync(script, source.replace('[ "$n" -lt 240 ]', '[ "$n" -lt 4 ]').replaceAll('sleep 0.5', 'sleep 0.03').replaceAll('sleep 0.25', 'sleep 0.03'))
    const code = await run(script)
    assert.equal(code, mode === 'receipt' ? 0 : 1)
    if (mode === 'receipt') {
      assert.equal(fs.readFileSync(path.join(target, 'resources/app.asar'), 'utf8'), 'new')
      assert(fs.existsSync(applying + '.completed')); assert.equal(fs.readFileSync(log, 'utf8'), 'NEW\n')
    } else if (mode === 'timeout') {
      for (let i = 0; i < 100 && !fs.readFileSync(log, 'utf8').includes('OLD'); i++) await new Promise(resolve => setTimeout(resolve, 10))
      assert.equal(fs.readFileSync(path.join(target, 'resources/app.asar'), 'utf8'), 'old')
      assert.equal(fs.readFileSync(log, 'utf8'), 'NEW\nOLD\n', 'Original launcher must start only after the failed one exited')
      assert(fs.existsSync(staged + '.failed')); assert(fs.existsSync(applying + '.failed'))
      assert(fs.readFileSync(path.join(state, 'update-failed.flag'), 'utf8').includes('已恢复'))
    } else {
      assert.equal(fs.readFileSync(path.join(target, 'resources/app.asar'), 'utf8'), 'old')
      assert(!fs.existsSync(log), 'A tampered target must not be replaced or launched')
    }
  }
})
test('Linux TAR rejects escaping, ambiguous, linked and damaged header paths', () => {
  assert.equal(linuxTarHeader(header('KAMUCL/resources/app.asar'))?.name, 'KAMUCL/resources/app.asar')
  for (const name of ['KAMUCL/../outside', '/KAMUCL/file', 'Other/file', 'KAMUCL//file', 'KAMUCL/./file', 'KAMUCL\\file']) assert.throws(() => linuxTarHeader(header(name)))
  assert.throws(() => linuxTarHeader(header('KAMUCL/link', 0, '2')), /链接/)
  const bad = header('KAMUCL/file'); bad[10] ^= 1; assert.throws(() => linuxTarHeader(bad), /校验/)
})
test('Linux streamed archive validates complete payload and rejects duplicate or missing targets', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-tar-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const files = ['KAMUCL/kamucl', 'KAMUCL/resources/app.asar', 'KAMUCL/resources/kamucl-linux.json'], target = path.join(root, 'payload.tar.gz')
  fs.writeFileSync(target, archive(files)); await validateLinuxArchive(target)
  fs.writeFileSync(target, archive([...files, files[0]])); await assert.rejects(validateLinuxArchive(target), /重复/)
  fs.writeFileSync(target, archive(files.slice(1))); await assert.rejects(validateLinuxArchive(target), /缺少/)
  fs.writeFileSync(target, archive(files, false)); await assert.rejects(validateLinuxArchive(target), /截断/)
  await assert.rejects(validateLinuxArchive(path.join(root, 'absent.tar.gz')), /ENOENT/)
})
test('Linux manifest constrains product architecture and package kind', () => {
  const metadata = { product: 'KAMUCL', platform: 'linux', arch: 'arm64', version: '1.1.11', installationKind: 'appimage' }
  assert.doesNotThrow(() => assertLinuxManifest(JSON.stringify(metadata), '1.1.11', 'appimage', 'arm64'))
  assert.throws(() => assertLinuxManifest(JSON.stringify(metadata), '1.1.11', 'deb', 'arm64'), /身份/)
  assert.throws(() => assertLinuxManifest(JSON.stringify(metadata), '1.1.11', 'appimage', 'x64'), /架构/)
})

test('AppImage replacement refuses wrapper mode or missing FUSE before any file swap', async () => {
  const compiled = await build({ entryPoints: ['src/main/core/linuxUpdate.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' })
  const req = createRequire(path.resolve('package.json')), mod: any = { exports: {} }, fakeProcess = Object.create(process)
  Object.defineProperty(fakeProcess, 'platform', { value: 'linux' })
  Object.defineProperty(fakeProcess, 'env', { value: { APPIMAGE: path.resolve('out/fuse-test.AppImage'), APPDIR: path.resolve('out/fuse-test') } })
  let type = 0x65735546, fuseAvailable = true, writes = 0
  const fakeFs = { ...fs, statfsSync: () => ({ type }), accessSync: (file: string) => { if (file === '/dev/fuse' && !fuseAvailable) throw Error('No FUSE device') }, writeFileSync: () => { writes++; throw Error('No mutation allowed in capability probe') } }
  new Function('require', 'module', 'exports', 'process', compiled.outputFiles[0].text)((name: string) => name === 'electron' ? { app: { isPackaged: true }, shell: {} } : name === 'node:fs' ? fakeFs : req(name), mod, mod.exports, fakeProcess)
  assert.equal(mod.exports.linuxAppImageUpdateReason(), null)
  fakeProcess.env.APPIMAGE_EXTRACT_AND_RUN = '1'; assert.match(mod.exports.linuxAppImageUpdateReason(), /原程序和下载包/)
  delete fakeProcess.env.APPIMAGE_EXTRACT_AND_RUN; type = 0x01021994
  assert.match(mod.exports.linuxAppImageUpdateReason(), /解压模式/)
  type = 0x65735546; fuseAvailable = false; assert.match(mod.exports.linuxAppImageUpdateReason(), /FUSE/)
  assert.equal(writes, 0)
})
test('New securely persisted token remains current after keyring locks, and session tokens never reach disk', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-account-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let backend = 'gnome_libsecret', encryptions = 0
  const storage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend,
    encryptString: (value: string) => { encryptions++; return Buffer.from('encrypted:' + value) },
    decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, '') }
  const file = path.join(root, 'accounts.json'), old = Buffer.from('encrypted:old-refresh').toString('base64')
  fs.writeFileSync(file, JSON.stringify({ accounts: [{ id: 'one', type: 'microsoft', username: 'user', uuid: 'u', secure: { refreshToken: old } }], selectedId: 'one' }))
  const content = fs.readFileSync('src/main/core/accounts.ts', 'utf8') + '\nexport const accountTest = {load,persist,upsert};'
  const compiled = await build({ stdin: { contents: content, resolveDir: path.resolve('src/main/core'), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' })
  const req = createRequire(path.resolve('package.json')), mod: any = { exports: {} }
  const fakeProcess = Object.create(process); Object.defineProperty(fakeProcess, 'platform', { value: 'linux' })
  new Function('require', 'module', 'exports', 'process', compiled.outputFiles[0].text)((name: string) => name === 'electron' ? { app: { getPath: () => root, getVersion: () => '1.1.11' }, safeStorage: storage } : req(name), mod, mod.exports, fakeProcess)
  const api = mod.exports.accountTest
  api.load(); api.upsert({ id: 'one', type: 'microsoft', username: 'user', uuid: 'u', refreshToken: 'new-refresh' })
  const latest = JSON.parse(fs.readFileSync(file, 'utf8')).accounts[0].secure.refreshToken
  assert.notEqual(latest, old); const beforeLock = encryptions
  backend = 'basic_text'
  api.upsert({ id: 'two', type: 'microsoft', username: 'session', uuid: 'v', refreshToken: 'session-secret' })
  api.persist()
  const after = JSON.parse(fs.readFileSync(file, 'utf8')); assert.equal(after.accounts[0].secure.refreshToken, latest)
  assert.equal(after.accounts[1].secure, undefined); assert(!fs.readFileSync(file, 'utf8').includes('session-secret')); assert.equal(encryptions, beforeLock)
  backend = 'gnome_libsecret'; assert.equal(api.load().accounts[0].refreshToken, 'new-refresh')
})
