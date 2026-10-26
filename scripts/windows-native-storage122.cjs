// Actual Windows DPAPI, two fresh processes. No existing application profile is opened.
// The default app in the same original Electron runtime executes this fixture; a packaged
// launcher ignores external script arguments, so it must never be used for this entry.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const crypto = require('node:crypto'), assert = require('node:assert/strict')
const digest = value => crypto.createHash('sha256').update(value).digest('hex')
const repository = path.resolve(__dirname, '..')
const pkg = require(path.join(repository, 'package.json'))
const expectedRuntime = pkg.devDependencies.electron
const option = name => process.argv.find(value => value.startsWith(name + '='))?.slice(name.length + 1)

async function nativePhase() {
  const { app, safeStorage } = require('electron')
  const configFile = option('--fixture-config'), phase = option('--native-storage-phase')
  assert(path.isAbsolute(configFile)); assert(['write', 'read'].includes(phase))
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64')
  assert.equal(process.versions.electron, expectedRuntime)
  assert.equal(path.dirname(configFile), config.privateRoot)
  for (const file of [config.profile, config.appData, config.localAppData, config.payload, config.helper])
    assert(path.resolve(file).startsWith(path.resolve(config.privateRoot) + path.sep), 'Only the owned fixture directory is permitted')
  app.setName('KAMUCL isolated native-storage fixture 122')
  app.setPath('appData', config.appData); app.setPath('userData', config.profile)
  const result = { phase, pid: process.pid, complete: false, observedAt: new Date().toISOString(),
    platform: process.platform, arch: process.arch, electron: process.versions.electron,
    provider: 'Actual Windows DPAPI through Electron safeStorage', fixtureOnly: true }
  let timer = setTimeout(() => { result.error = 'owned-native-storage-phase-timeout'; fs.writeFileSync(config.receipts[phase], JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); app.exit(1) }, 20000)
  await app.whenReady()
  try {
    assert.equal(fs.realpathSync(app.getPath('userData')), fs.realpathSync(config.profile))
    assert.equal(fs.realpathSync(app.getPath('appData')), fs.realpathSync(config.appData))
    assert.equal(fs.realpathSync(process.env.APPDATA), fs.realpathSync(config.appData))
    assert.equal(fs.realpathSync(process.env.LOCALAPPDATA), fs.realpathSync(config.localAppData))
    assert(process.argv.includes('--user-data-dir=' + config.profile))
    assert.equal(safeStorage.isEncryptionAvailable(), true, 'Actual protected native storage must be available')
    const { SettingsCredentials, publicSettingsFields } = require(config.helper)
    const vault = new SettingsCredentials(safeStorage)
    result.actualNativeStorageAvailable = true; result.freshAppDataAndExplicitUserData = true
    if (phase === 'write') {
      const value = 'KAMUCL owned synthetic DPAPI fixture § ' + crypto.randomBytes(32).toString('hex')
      const snapshot = vault.prepare({ curseforgeApiKey: value }), ciphertext = Buffer.from(snapshot.ciphertext, 'base64')
      assert.equal(snapshot.legacy, false); assert(vault.configured(snapshot)); assert(ciphertext.length > 0)
      assert.equal(safeStorage.decryptString(ciphertext), value)
      vault.commit(snapshot); assert.equal(vault.read(), value)
      assert(!ciphertext.includes(Buffer.from(value)))
      const stored = { secureCredentials: { curseforgeApiKey: snapshot.ciphertext }, expectedDigest: digest(value) }
      fs.writeFileSync(config.payload, JSON.stringify(stored), { flag: 'wx', mode: 0o600 })
      const publicFields = publicSettingsFields({ curseforgeApiKey: value, secureCredentials: stored.secureCredentials, harmlessFixture: true })
      assert(!Object.hasOwn(publicFields, 'curseforgeApiKey')); assert(!Object.hasOwn(publicFields, 'secureCredentials'))
      result.immediateNativeRoundtrip = true; result.productVaultNativeRoundtrip = true
      result.publicFieldsOmitSecret = true; result.ciphertextContainsNoPlainFixture = true
      result.ciphertextBytes = ciphertext.length; result.ciphertextSHA256 = digest(ciphertext)
    } else {
      const originalBytes = fs.readFileSync(config.payload), stored = JSON.parse(originalBytes)
      const ciphertext = Buffer.from(stored.secureCredentials.curseforgeApiKey, 'base64')
      vault.load(stored); assert.equal(vault.configured(), true)
      const decoded = vault.read()
      assert.equal(digest(decoded), stored.expectedDigest, 'Product vault must decrypt the original snapshot after a process restart')
      assert.equal(safeStorage.decryptString(ciphertext), decoded)
      assert.deepEqual(fs.readFileSync(config.payload), originalBytes, 'Readback must not rewrite the encrypted snapshot')
      result.restartNativeRoundtrip = true; result.productVaultNativeRoundtrip = true
      result.originalEncryptedSnapshotUnchanged = true
      result.ciphertextBytes = ciphertext.length; result.ciphertextSHA256 = digest(ciphertext)
    }
    result.complete = true
    fs.writeFileSync(config.receipts[phase], JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
    clearTimeout(timer); app.quit()
  } catch {
    // Only a fixed failure class is public. No OS payload, secret, plaintext or ciphertext.
    result.error = 'actual-native-storage-verification-failed'
    fs.writeFileSync(config.receipts[phase], JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
    clearTimeout(timer); app.exit(1)
  }
}

async function orchestration() {
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64')
  const { spawn } = require('node:child_process'), { buildSync } = require('esbuild')
  const { trackOwnedChild, finishOwnedChild } = require('./qa-owned-process-119.cjs')
  const executable = require('electron'), runtimeDirectory = path.dirname(executable)
  const privateRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL owned native-storage122 ')))
  const proof = fs.mkdtempSync(path.join(repository, 'out/windows122-native-storage-'))
  const config = { privateRoot, profile: path.join(privateRoot, 'profile'), appData: path.join(privateRoot, 'roaming'),
    localAppData: path.join(privateRoot, 'local'), payload: path.join(privateRoot, 'private-synthetic-cipher.json'),
    helper: path.join(privateRoot, 'actual-settings-credentials.cjs'),
    receipts: { write: path.join(proof, 'write.json'), read: path.join(proof, 'read.json') } }
  for (const directory of [config.profile, config.appData, config.localAppData]) fs.mkdirSync(directory)
  const configFile = path.join(privateRoot, 'fixture-config.json'); fs.writeFileSync(configFile, JSON.stringify(config), { flag: 'wx' })
  const helperBuild = buildSync({ entryPoints: [path.join(repository, 'src/main/core/settingsCredentials.ts')],
    platform: 'node', format: 'cjs', bundle: true, write: false, packages: 'external' })
  fs.writeFileSync(config.helper, helperBuild.outputFiles[0].contents, { flag: 'wx' })
  const receipt = { version: pkg.version, complete: false,
    classification: 'Actual Windows DPAPI plus product SettingsCredentials helper in two processes of the original unpacked Electron runtime. This is not a packaged-launcher DPAPI validation.',
    actualPackagedLauncherTested: false, freshPrivateProfile: true, noPreexistingPlayerData: true,
    expectedRuntime, startedAt: new Date().toISOString(), phases: [],
    sourceFiles: ['scripts/windows-native-storage122.cjs', 'src/main/core/settingsCredentials.ts', 'src/main/core/credentialProtection.ts']
      .map(file => ({ file, sha256: digest(fs.readFileSync(path.join(repository, file))) })),
    runtimeFiles: fs.readdirSync(runtimeDirectory).filter(file => file === path.basename(executable) || file.endsWith('.dll'))
      .map(file => ({ file, bytes: fs.statSync(path.join(runtimeDirectory, file)).size, sha256: digest(fs.readFileSync(path.join(runtimeDirectory, file))) })),
    productHelperBundleSHA256: digest(helperBuild.outputFiles[0].contents) }
  let original
  try {
    for (const phase of ['write', 'read']) {
      const env = { ...process.env, APPDATA: config.appData, LOCALAPPDATA: config.localAppData }
      delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.GH_TOKEN; delete env.GITHUB_TOKEN
      const stdoutFile = path.join(proof, phase + '-stdout-original.log'), stderrFile = path.join(proof, phase + '-stderr-original.log')
      const stdout = fs.openSync(stdoutFile, 'wx'), stderr = fs.openSync(stderrFile, 'wx')
      const child = spawn(executable, [__filename, '--native-storage-phase=' + phase, '--fixture-config=' + configFile, '--user-data-dir=' + config.profile],
        { env, stdio: ['ignore', stdout, stderr], windowsHide: true })
      fs.closeSync(stdout); fs.closeSync(stderr)
      const owned = trackOwnedChild(child, 'windows122-native-storage-' + phase)
      let phaseFailure, exit
      try { exit = await finishOwnedChild(owned, { timeoutMs: 30000 }); assert.equal(exit.code, 0); assert.equal(exit.signal, null) }
      catch (error) { phaseFailure = error; try { await finishOwnedChild(owned, { terminate: true, timeoutMs: 5000 }) } catch {} }
      const evidence = { phase, naturalExit: !phaseFailure, exit: exit ?? null, ownedLifecycle: owned.ledger,
        stdoutSHA256: digest(fs.readFileSync(stdoutFile)), stderrSHA256: digest(fs.readFileSync(stderrFile)) }
      if (fs.existsSync(config.receipts[phase])) {
        const bytes = fs.readFileSync(config.receipts[phase]), observed = JSON.parse(bytes)
        evidence.observation = observed; evidence.receiptSHA256 = digest(bytes)
        assert.equal(observed.pid, child.pid); assert.equal(observed.electron, expectedRuntime)
      }
      receipt.phases.push(evidence)
      if (phaseFailure) throw phaseFailure
      assert.equal(evidence.observation?.complete, true)
    }
    const [written, read] = receipt.phases.map(phase => phase.observation)
    assert.notEqual(written.pid, read.pid); assert.equal(written.ciphertextSHA256, read.ciphertextSHA256)
    assert.equal(written.ciphertextBytes, read.ciphertextBytes)
    receipt.twoDifferentProcesses = true; receipt.ciphertextSHA256 = written.ciphertextSHA256
    receipt.nativeDPAPIImmediateAndRestartRoundtrip = true; receipt.productVaultAcrossRestart = true
    receipt.noPlaintextOrCiphertextInPublicReceipt = true
    assert.equal(fs.realpathSync(privateRoot), privateRoot); assert(path.basename(privateRoot).startsWith('KAMUCL owned native-storage122 '))
    assert.equal(fs.realpathSync(path.dirname(privateRoot)), fs.realpathSync(os.tmpdir()))
    fs.rmSync(privateRoot, { recursive: true }); receipt.privateSyntheticProfileRemoved = true
    receipt.complete = true
  } catch (error) { original = error; receipt.error = 'owned-windows-native-storage-verification-failed'; receipt.privateSyntheticProfileRemoved = false }
  receipt.finishedAt = new Date().toISOString()
  const bytes = JSON.stringify(receipt, null, 2) + '\n'
  fs.writeFileSync(path.join(proof, 'receipt.json'), bytes, { flag: 'wx' })
  fs.writeFileSync(path.join(repository, 'out/windows122-native-storage-receipt.json'), bytes, { flag: 'wx' })
  console.log(JSON.stringify({ complete: receipt.complete, proof: path.relative(repository, proof), actualPackagedLauncherTested: false }))
  if (original) process.exitCode = 1
}

if (process.versions.electron) nativePhase().catch(() => { console.error('Owned native storage fixture could not initialize'); require('electron').app.exit(1) })
else orchestration().catch(() => { console.error('Owned native storage orchestration failed; preserve the owned evidence and do not treat it as a pass'); process.exitCode = 1 })
