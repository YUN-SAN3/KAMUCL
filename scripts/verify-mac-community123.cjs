// Current native package acceptance for the 1.1.23 community-search change.
// Full games, physical audio, OAuth, old GPU failures and notarization are separate.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { readMacPackageIdentity } = require('./mac-package-identity.cjs')
const { validateAssets, extractPackagedRenderer, validateUiProof, sha } = require('./mac-community123-contract.cjs')
const { VERSION } = require('./qa-community123.cjs')
function copyPublicEvidence(source, destination) {
  fs.mkdirSync(destination, { recursive: true })
  for (const name of fs.readdirSync(source)) if (['receipt.json', 'proof.json'].includes(name) || /^[a-z0-9][a-z0-9.-]*\.png$/i.test(name)) {
    const file = path.join(source, name); assert(fs.lstatSync(file).isFile()); fs.copyFileSync(file, path.join(destination, name))
  }
}
async function main() {
  assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64')
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Native verification owns a disposable runner, never an existing player profile')
  const pkg = require('../package.json'); assert.equal(pkg.version, VERSION)
  const directory = path.resolve('release/mac-community123-proof'); fs.mkdirSync(directory, { recursive: true })
  fs.mkdirSync(path.resolve('out'), { recursive: true })
  const privateRoot = fs.mkdtempSync(path.resolve('out/mac-community123-private-'))
  const receipt = { version: pkg.version, arch: process.arch, platform: process.platform,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), complete: false,
    startedAt: new Date().toISOString(), scope: 'Original native ZIP/DMG integrity and APP startup; actual progressive-backend 无尽 live-service project/file identity; original packaged production-renderer coordinate matrix with synthetic IPC. No full-game, real OAuth, FPS/audio, OS desktop-material or notarization acceptance is inferred.', steps: [], errors: [] }
  const save = () => fs.writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
  const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: 'inherit', timeout: 60000, ...options })
  const runtime = require('electron'), expected = { version: pkg.version, arch: 'arm64', commit: receipt.commit, runtimeVersion: pkg.devDependencies.electron }
  const nativeEnv = { ...process.env }; delete nativeEnv.ELECTRON_RUN_AS_NODE
  let mount, attached = false
  try {
    save(); assert.equal(receipt.commit, process.env.GITHUB_SHA)
    const manifest = JSON.parse(fs.readFileSync('release/mac-package-arm64.json', 'utf8'))
    for (const row of validateAssets(manifest, expected)) {
      const file = path.resolve('release', row.name); assert.equal(fs.statSync(file).size, row.bytes); assert.equal(sha(fs.readFileSync(file)), row.sha256)
    }
    receipt.package = manifest; receipt.steps.push('Both original package hashes, names, source commit and shared runtime checked'); save()
    const zipDirectory = path.join(privateRoot, 'zip-extracted'); fs.mkdirSync(zipDirectory)
    run('ditto', ['-x', '-k', path.resolve('release', `KAMUCL-${pkg.version}-mac-arm64.zip`), zipDirectory])
    mount = path.join(privateRoot, 'dmg-mounted'); fs.mkdirSync(mount)
    const dmg = path.resolve('release', `KAMUCL-${pkg.version}-mac-arm64.dmg`)
    run('hdiutil', ['verify', dmg]); run('hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-mountpoint', mount]); attached = true
    receipt.packages = []
    for (const [stage, packageDirectory] of [['zip', zipDirectory], ['dmg', mount]]) {
      const app = path.join(packageDirectory, 'KAMUCL.app')
      const identity = readMacPackageIdentity(app, { version: expected.version, arch: expected.arch, sourceCommit: expected.commit, runtimeVersion: expected.runtimeVersion, minimumSystemVersion: manifest.minimum })
      assert.deepEqual(identity.identity, manifest.buildIdentity); assert.equal(identity.identitySHA256, manifest.buildIdentitySHA256)
      assert.equal(identity.identity.appAsarSHA256, manifest.appAsarSHA256)
      const asarPath = path.join(app, 'Contents/Resources/app.asar'), asar = require('asar')
      assert.equal(JSON.parse(asar.extractFile(asarPath, 'package.json').toString()).version, VERSION)
      const renderer = path.join(privateRoot, stage + '-renderer'), rendererFiles = extractPackagedRenderer(asarPath, renderer)
      const packageRow = { stage, identity, rendererFiles, rendererSource: 'Exact original package ASAR extraction; no QA rebuild' }; receipt.packages.push(packageRow); save()
      const nativeOutput = path.join(privateRoot, stage + '-native'); let nativeFailure
      try { run(process.execPath, ['scripts/community123-native-smoke.cjs', path.join(app, 'Contents/MacOS/KAMUCL'), nativeOutput], { timeout: 16 * 60000, env: nativeEnv }) } catch (error) { nativeFailure = error }
      if (fs.existsSync(nativeOutput)) copyPublicEvidence(nativeOutput, path.join(directory, stage + '-native'))
      if (nativeFailure) throw nativeFailure
      const native = JSON.parse(fs.readFileSync(path.join(directory, stage + '-native/receipt.json'), 'utf8'))
      assert.equal(native.complete, true); assert.equal(native.live.complete, true)
      assert.equal(native.observed.platform, 'darwin'); assert.equal(native.observed.sourceVersion, VERSION)
      packageRow.nativeReceiptSHA256 = sha(fs.readFileSync(path.join(directory, stage + '-native/receipt.json'))); save()
      const before = new Set(fs.readdirSync('out')); let uiFailure
      try { run(runtime, ['scripts/verify-community123-ui.cjs'], { timeout: 8 * 60000, env: { ...nativeEnv, KAMUCL_REVIEW_RENDERER_DIR: renderer } }) } catch (error) { uiFailure = error }
      const created = fs.readdirSync('out').filter(name => name.startsWith('community123-ui-') && !before.has(name))
      assert.equal(created.length, 1, 'Exactly one fresh isolated coordinate harness receipt is required')
      const source = path.resolve('out', created[0]), destination = path.join(directory, stage + '-ui'); copyPublicEvidence(source, destination)
      if (uiFailure) throw uiFailure
      const ui = JSON.parse(fs.readFileSync(path.join(destination, 'proof.json'), 'utf8')); validateUiProof(ui, expected)
      assert.deepEqual(ui.rendererFiles.map(row => ({ path: row.file, sha256: row.sha256 })).sort((a, b) => a.path.localeCompare(b.path)), rendererFiles.map(row => ({ path: row.path, sha256: row.sha256 })), 'Every exercised renderer file must match the original ASAR bytes')
      for (const image of ui.images) { assert.equal(path.basename(image.file), image.file); const bytes = fs.readFileSync(path.join(destination, image.file)); assert.equal(bytes.length, image.bytes); assert.equal(sha(bytes), image.sha256) }
      packageRow.uiReceiptSHA256 = sha(fs.readFileSync(path.join(destination, 'proof.json')))
      receipt.steps.push(stage + ': original package/native live IPC and strict 16 coordinate matrices passed'); save()
    }
    receipt.complete = true
  } catch (error) {
    receipt.errors.push({ name: error.name, message: error.message, status: error.status ?? null, signal: error.signal ?? null }); console.error(error); process.exitCode = 1
  } finally {
    if (attached) try { run('hdiutil', ['detach', mount]); receipt.mountDetached = true } catch (error) { receipt.complete = false; receipt.errors.push({ phase: 'detach', name: error.name, message: error.message }); process.exitCode = 1 }
    receipt.privateDataUploaded = false; receipt.finishedAt = new Date().toISOString(); save()
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { main, copyPublicEvidence }
