const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto')
const { execFileSync } = require('node:child_process'), { build } = require('esbuild')
const asar = require('@electron/asar')
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

test('actual pinned Electron preserves physical ASAR validation and backup bytes through the real Linux product boundary', {
  timeout: 40000,
  skip: process.platform === 'linux' && !process.env.DISPLAY ? 'No display on native package host; mandatory Xvfb integration runs this actual Electron contract separately' : false
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL physical-ASAR contract-')), rootIdentity = fs.realpathSync(root)
  fs.mkdirSync(path.resolve('out'), { recursive: true })
  const proof = fs.mkdtempSync(path.resolve('out/linux-asar-proof-')), sourceFile = path.resolve('src/main/core/linuxUpdate.ts')
  const backup = path.join(root, "backup 中文 § O'Neil"), resources = path.join(backup, 'resources'), input = path.join(root, 'input')
  const archive = path.join(resources, 'app.asar'), version = require('../package.json').version
  fs.mkdirSync(resources, { recursive: true }); fs.mkdirSync(input)
  const packageJSON = { name: 'kamucl-physical-asar-contract', productName: 'KAMUCLContract', version }
  fs.writeFileSync(path.join(input, 'package.json'), JSON.stringify(packageJSON)); fs.writeFileSync(path.join(input, 'payload.txt'), 'original ASAR payload 中文 §')
  await asar.createPackage(input, archive)
  fs.writeFileSync(path.join(resources, 'kamucl-linux.json'), JSON.stringify({ product: 'KAMUCL', platform: 'linux', arch: process.arch, version, installationKind: 'portable-directory' }))
  // The ELF header is a small classifier fixture, never executed. This contract
  // validates actual Electron ASAR operations, not a Linux game/update run.
  const elf = Buffer.alloc(64); elf.write('\x7fELF', 0, 'binary'); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(process.arch === 'arm64' ? 183 : 62, 18)
  fs.writeFileSync(path.join(backup, 'kamucl'), elf); fs.chmodSync(path.join(backup, 'kamucl'), 0o755)
  fs.mkdirSync(path.join(backup, 'assets')); fs.writeFileSync(path.join(backup, 'assets', 'source.txt'), 'owned symlink target')
  let symlinkCreated = false, symlinkUnavailable
  try { fs.symlinkSync('source.txt', path.join(backup, 'assets', 'alias.txt')); symlinkCreated = true }
  catch (error) { if (!['EPERM', 'EACCES'].includes(error.code)) throw error; symlinkUnavailable = { code: error.code, message: error.message } }
  const compiled = await build({ entryPoints: [sourceFile], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  // Expose a private function only in the test's private compiled copy. Shipping
  // exports and the product source remain unchanged by this observation.
  const productBundle = path.join(root, 'product-bundle.cjs')
  fs.writeFileSync(productBundle, compiled.outputFiles[0].text + '\nmodule.exports.__verifyDirectory = verifyDirectory;\n')
  const fixture = path.join(root, 'fixture.cjs'), receipt = path.join(proof, 'verification.json')
  const config = { root, backup, archive, productBundle, receipt, version, packageJSON, baselineHash: hash(archive), sourceSHA256: hash(sourceFile), executableSHA256: hash(require('electron')), symlinkCreated, symlinkUnavailable }
  fs.writeFileSync(fixture, `
const fs = require('node:fs'), raw = require('original-fs'), path = require('node:path'), crypto = require('node:crypto'), vm = require('node:vm'), assert = require('node:assert/strict')
const { app } = require('electron'), config = ${JSON.stringify(config)}
const profile = path.join(config.root, 'profile'), appData = path.join(config.root, 'config')
raw.mkdirSync(profile); raw.mkdirSync(appData); app.setPath('appData', appData); app.setPath('userData', profile)
const report = { schemaVersion: 1, contractOnly: true, nativeDesktop: false, fullUpdateTransaction: false, actualLinuxDesktop: false, complete: false,
  startedAt: new Date().toISOString(), actual: { pid: process.pid, executable: process.execPath, argv: [...process.argv], platform: process.platform, arch: process.arch, runtime: process.versions.electron, profile, appData, sourceSHA256: config.sourceSHA256, executableSHA256: config.executableSHA256 },
  localPlatformFacade: 'linux only inside private product VM on non-Linux hosts', ELFClassifierFixture: true, symlinkCreated: config.symlinkCreated, symlinkUnavailable: config.symlinkUnavailable, observations: {} }
const save = () => raw.writeFileSync(config.receipt, JSON.stringify(report, null, 2) + '\\n')
const digest = file => crypto.createHash('sha256').update(raw.readFileSync(file)).digest('hex')
save()
const timer = setTimeout(() => { report.error = { message: 'Actual Electron ASAR contract ready/operation deadline' }; save(); app.exit(1) }, 20000)
app.whenReady().then(async () => {
  assert.equal(process.versions.electron, ${JSON.stringify(require('../package.json').devDependencies.electron)}); assert.notEqual(process.env.ELECTRON_RUN_AS_NODE, '1')
  const noAsarBefore = process.noAsar ?? null
  const patchedStat = await fs.promises.stat(config.archive), originalStat = await raw.promises.stat(config.archive)
  report.observations.stat = { patched: { isFile: patchedStat.isFile(), isDirectory: patchedStat.isDirectory() }, physical: { isFile: originalStat.isFile(), bytes: originalStat.size } }
  assert.equal(patchedStat.isFile(), false); assert.equal(patchedStat.isDirectory(), true); assert.equal(originalStat.isFile(), true)
  let patchedReadError
  try { fs.readFileSync(config.archive) } catch (error) { patchedReadError = { code: error.code, message: error.message } }
  assert.equal(patchedReadError?.code, 'ENOENT'); report.observations.patchedReadError = patchedReadError
  assert.equal(digest(config.archive), config.baselineHash)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(config.archive, 'package.json'), 'utf8')), config.packageJSON)
  let legacyCopyError
  try { await fs.promises.cp(config.backup, path.join(config.root, 'legacy-copy'), { recursive: true, dereference: true }) } catch (error) { legacyCopyError = { code: error.code, message: error.message } }
  assert(legacyCopyError, 'Legacy patched fs must preserve its observed ASAR copy failure'); report.observations.legacyCopyError = legacyCopyError
  const localProcess = Object.create(process), environment = { ...process.env }; delete environment.APPIMAGE; delete environment.APPDIR; delete environment.APPIMAGE_EXTRACT_AND_RUN
  Object.defineProperties(localProcess, { platform: { value: 'linux' }, execPath: { value: path.join(config.backup, 'kamucl') }, env: { value: environment } })
  const productModule = { exports: {} }, commands = [], boundaryError = Object.assign(Error('STOP_BEFORE_EXTERNAL_TAR'), { code: 'ASAR_CONTRACT_TAR_BOUNDARY' })
  const productRequire = name => {
    if (name === 'electron') return { app: { isPackaged: true, getVersion: () => config.version, getPath: () => profile }, shell: {} }
    if (name !== 'node:child_process') return require(name)
    return { ...require(name), execFile(file, args, options, callback) {
      if (typeof options === 'function') { callback = options; options = undefined }
      commands.push({ file, args, options }); assert.equal(file, '/usr/bin/tar')
      queueMicrotask(() => callback(boundaryError, '', '')); return { pid: undefined }
    } }
  }
  vm.runInNewContext(raw.readFileSync(config.productBundle, 'utf8'), { module: productModule, exports: productModule.exports, process: localProcess, __dirname: config.root, require: productRequire, Buffer, console, setTimeout, clearTimeout, queueMicrotask })
  await productModule.exports.__verifyDirectory(config.backup, config.version)
  report.observations.realProductDirectoryValidation = { passed: true, realArchiveHash: digest(config.archive) }
  await assert.rejects(productModule.exports.stageLinuxBackup(config.backup, config.version), error => error === boundaryError)
  assert.equal(commands.length, 1)
  const copyRoot = commands[0].args[commands[0].args.indexOf('-C') + 1], copiedArchive = path.join(copyRoot, 'KAMUCL', 'resources', 'app.asar')
  assert(raw.lstatSync(copiedArchive).isFile()); assert.equal(digest(copiedArchive), config.baselineHash)
  assert.equal(raw.readFileSync(path.join(copyRoot, 'KAMUCL', 'assets', 'source.txt'), 'utf8'), 'owned symlink target')
  if (config.symlinkCreated) { const alias = path.join(copyRoot, 'KAMUCL', 'assets', 'alias.txt'); assert(!raw.lstatSync(alias).isSymbolicLink()); assert.equal(raw.readFileSync(alias, 'utf8'), 'owned symlink target') }
  report.observations.realProductBackupCopy = { rawArchiveIsFile: true, rawArchiveHash: digest(copiedArchive), commands, tarExecuted: false, stagingOrUpdateApplied: false, symlinkDereferenced: config.symlinkCreated }
  assert.equal(process.noAsar ?? null, noAsarBefore); report.globalNoAsarBefore = noAsarBefore; report.globalNoAsarAfter = process.noAsar ?? null
  report.ready = true; report.complete = true; report.finishedAt = new Date().toISOString(); save(); clearTimeout(timer); app.exit(0)
}).catch(error => { report.error = { name: error.name, message: error.message, code: error.code, stack: error.stack }; save(); clearTimeout(timer); app.exit(1) })
`)
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE
  let originalError
  try {
    const stdout = execFileSync(require('electron'), [fixture], { env: environment, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 })
    fs.writeFileSync(path.join(proof, 'stdout-original.log'), stdout, { flag: 'wx' })
    const report = JSON.parse(fs.readFileSync(receipt, 'utf8'))
    assert.equal(report.complete, true); assert.equal(report.ready, true); assert.equal(report.nativeDesktop, false); assert.equal(report.fullUpdateTransaction, false)
    assert.equal(report.actual.platform, process.platform); assert.equal(report.actual.arch, process.arch); assert.equal(report.actual.sourceSHA256, hash(sourceFile))
    assert.equal(report.actual.executableSHA256, hash(require('electron'))); assert.equal(report.observations.realProductBackupCopy.rawArchiveHash, config.baselineHash)
    console.log('ASAR_PHYSICAL_PROOF ' + receipt)
  } catch (error) {
    originalError = error
    try {
      fs.writeFileSync(path.join(proof, 'parent-error.json'), JSON.stringify({ message: error.message, code: error.status ?? error.code, stack: error.stack }, null, 2), { flag: 'wx' })
      if (!fs.existsSync(path.join(proof, 'stdout-original.log'))) fs.writeFileSync(path.join(proof, 'stdout-original.log'), error.stdout ?? '', { flag: 'wx' })
      fs.writeFileSync(path.join(proof, 'stderr-original.log'), error.stderr ?? '', { flag: 'wx' })
    } catch { /* The original operation/child failure remains the test result. */ }
    throw error
  } finally {
    // The owned native child has closed (including timeout) before private files
    // are removed. A cleanup failure never replaces its original assertion.
    try {
      assert.equal(fs.realpathSync(root), rootIdentity); assert(fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink())
      assert(path.basename(root).startsWith('KAMUCL physical-ASAR contract-')); fs.rmSync(root, { recursive: true })
    } catch (error) {
      if (!originalError) throw error
      try { fs.writeFileSync(path.join(proof, 'cleanup-error.json'), JSON.stringify({ message: error.message, stack: error.stack }, null, 2), { flag: 'wx' }) }
      catch { /* Cleanup evidence cannot replace the original child/assertion failure. */ }
    }
  }
})
