// Bounded 1.1.22 native package/authentication scope, independent of old whole-platform gates.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { readMacPackageIdentity } = require('./mac-package-identity.cjs')
const { validateAssets, extractPackagedRenderer, validateUiProof, sha } = require('./mac-auth122-contract.cjs')
async function main() {
  assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64')
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Use a disposable native runner, never an existing player profile')
  const pkg = require('../package.json'); assert.equal(pkg.version, '1.1.22')
  const proof = path.resolve('release/mac-auth122-proof'); fs.mkdirSync(proof, { recursive: true })
  fs.mkdirSync(path.resolve('out'), { recursive: true })
  const privateRoot = fs.mkdtempSync(path.resolve('out/mac-auth122-private-'))
  const receipt = { version: pkg.version, arch: process.arch, platform: process.platform, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    complete: false, startedAt: new Date().toISOString(), scope: 'Native original ZIP/DMG integrity and launch smoke; production packaged renderer coordinates with synthetic IPC; isolated actual native protected-storage restart. Does not replace old whole-platform, game, motion, real Microsoft login or notarization acceptance.', steps: [], errors: [] }
  const save = () => fs.writeFileSync(path.join(proof, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
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
    receipt.package = manifest; receipt.steps.push('Original ZIP and DMG filenames, sizes, SHA256, exact commit and shared runtime verified'); save()
    const zipDirectory = path.join(privateRoot, 'zip-extracted'); fs.mkdirSync(zipDirectory)
    run('ditto', ['-x', '-k', path.resolve('release', `KAMUCL-${pkg.version}-mac-arm64.zip`), zipDirectory])
    mount = path.join(privateRoot, 'dmg-mounted'); fs.mkdirSync(mount)
    const dmg = path.resolve('release', `KAMUCL-${pkg.version}-mac-arm64.dmg`)
    run('hdiutil', ['verify', dmg]); run('hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-mountpoint', mount]); attached = true
    receipt.packages = []
    for (const [stage, directory] of [['zip', zipDirectory], ['dmg', mount]]) {
      const app = path.join(directory, 'KAMUCL.app')
      const identity = readMacPackageIdentity(app, { version: expected.version, arch: expected.arch, sourceCommit: expected.commit, runtimeVersion: expected.runtimeVersion, minimumSystemVersion: manifest.minimum })
      assert.deepEqual(identity.identity, manifest.buildIdentity); assert.equal(identity.identitySHA256, manifest.buildIdentitySHA256)
      assert.equal(identity.identity.appAsarSHA256, manifest.appAsarSHA256)
      const asarPath = path.join(app, 'Contents/Resources/app.asar'), asar = require('asar')
      assert.equal(JSON.parse(asar.extractFile(asarPath, 'package.json').toString()).version, pkg.version)
      const renderer = path.join(privateRoot, stage + '-renderer'), rendererFiles = extractPackagedRenderer(asarPath, renderer)
      receipt.packages.push({ stage, identity, rendererFiles, rendererSource: 'Only files extracted from this verified signed original app.asar, byte-for-byte; no QA rebuild' }); save()
      // Smoke launches the actual signed APP entry in the disposable empty runner; no fixtures/accounts are added.
      run(process.execPath, ['scripts/mac-auth122-smoke.cjs', app, path.join(proof, stage + '-smoke')], { timeout: 100000 })
      const before = new Set(fs.readdirSync('out'))
      let uiFailure
      try { run(runtime, ['scripts/verify-auth122-ui.cjs'], { timeout: 7 * 60000, env: { ...nativeEnv, KAMUCL_REVIEW_RENDERER_DIR: renderer } }) }
      catch (error) { uiFailure = error }
      const created = fs.readdirSync('out').filter(name => name.startsWith('auth122-ui-') && !before.has(name))
      assert.equal(created.length, 1, 'Exactly one isolated UI harness receipt must be produced')
      const source = path.resolve('out', created[0]), destination = path.join(proof, stage + '-ui'); fs.mkdirSync(destination)
      // An allowlist prevents profile/accounts/renderer and private helper data from being uploaded, even on failure.
      for (const name of fs.readdirSync(source)) if (name === 'proof.json' || /^[a-z0-9][a-z0-9.-]*\.png$/i.test(name)) {
        const file = path.join(source, name); assert(fs.lstatSync(file).isFile()); fs.copyFileSync(file, path.join(destination, name))
      }
      if (uiFailure) throw uiFailure
      const ui = JSON.parse(fs.readFileSync(path.join(destination, 'proof.json'), 'utf8')); validateUiProof(ui, expected)
      assert.deepEqual(ui.rendererFiles.map(row => ({ path: row.file, sha256: row.sha256 })).sort((a, b) => a.path.localeCompare(b.path)), rendererFiles.map(row => ({ path: row.path, sha256: row.sha256 })), 'UI must exercise every exact renderer file from the original package')
      for (const row of ui.images) { assert.equal(path.basename(row.file), row.file); assert.equal(sha(fs.readFileSync(path.join(destination, row.file))), row.sha256) }
      receipt.steps.push(stage + ': strict signed package/runtime/notices, real APP startup and original packaged renderer changed-scope coordinates passed'); save()
    }
    const storageProfile = path.join(privateRoot, 'safe-storage-profile'); fs.mkdirSync(storageProfile)
    for (const phase of ['write', 'read']) run(runtime, ['scripts/mac-safe-storage122.cjs', phase, storageProfile, path.join(proof, 'safe-storage-' + phase + '.json')], { timeout: 60000, env: nativeEnv })
    receipt.steps.push('Actual native safeStorage encryption and a second independent process decrypting the same synthetic fixture passed; private data excluded from artifacts')
    receipt.complete = true
  } catch (error) {
    receipt.errors.push({ name: error.name, message: error.message, status: error.status ?? null, signal: error.signal ?? null }); console.error(error); process.exitCode = 1
  } finally {
    if (attached) try { run('hdiutil', ['detach', mount]); receipt.mountDetached = true } catch (error) { receipt.complete = false; receipt.errors.push({ phase: 'detach', name: error.name, message: error.message }); process.exitCode = 1 }
    // The owned directory is deliberately retained locally for failure diagnosis, and never uploaded.
    receipt.privateDataUploaded = false; receipt.finishedAt = new Date().toISOString(); save()
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { main }
