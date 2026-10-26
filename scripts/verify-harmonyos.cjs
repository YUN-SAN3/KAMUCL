'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const JSON5 = require('json5')
const { root, integration, output, project, digest, files } = require('./prepare-harmonyos.cjs')
const { sourceHashes } = require('./harmony-native-adaptations.cjs')

function assert(condition, message) { if (!condition) throw new Error(message) }
const readJson = async file => JSON5.parse(await fs.readFile(file, 'utf8'))

async function verify() {
  const lock = await readJson(path.join(integration, 'runtime.lock.json'))
  const parity = await readJson(path.join(output, 'frontend-parity.json'))
  const appDir = path.join(project, 'web_engine/src/main/resources/resfile/resources/app')
  const pkg = await readJson(path.join(root, 'package.json'))
  assert(parity.version === pkg.version, 'Prepared frontend belongs to another product version')
  const checks = []
  for (const item of parity.production.hashes) {
    const source = await fs.readFile(path.join(root, item.path))
    const staged = await fs.readFile(path.join(appDir, item.path))
    assert(digest(source) === item.sha256 && digest(staged) === item.sha256, `Production parity mismatch: ${item.path}; prepare again after rebuilding`)
  }
  for (const required of ['out/main/index.js', 'out/preload/index.js', 'out/preload/splash.js', 'out/renderer/index.html', 'out/renderer/splash.html']) {
    assert(parity.production.hashes.some(item => item.path === required), `Missing same-product output: ${required}`)
  }
  checks.push({ name: 'production-byte-parity', files: parity.production.hashes.length, passed: true })
  const profile = await readJson(path.join(project, 'build-profile.json5'))
  const nativeApp = await readJson(path.join(project, 'AppScope/app.json5'))
  const entry = await readJson(path.join(project, 'electron/src/main/module.json5'))
  const engine = await readJson(path.join(project, 'web_engine/src/main/module.json5'))
  const stagedPackage = await readJson(path.join(appDir, 'package.json'))
  assert(profile.app.signingConfigs.length === 0 && !profile.app.products.some(product => product.signingConfig), 'Upstream signing configuration leaked into project')
  assert(nativeApp.app.bundleName === 'com.kamucl.launcher' && nativeApp.app.versionName === pkg.version, 'Wrong native app identity')
  assert(!nativeApp.app.multiAppMode, 'Upstream multiple application instances are still enabled')
  assert(entry.module.deviceTypes.join(',') === '2in1' && engine.module.deviceTypes.join(',') === '2in1', 'Target must be the native HarmonyOS PC')
  assert(entry.module.abilities.find(ability => ability.name === 'EntryAbility').launchType === 'specified', 'Native focus/multiwindow route changed')
  assert(stagedPackage.version === pkg.version && stagedPackage.main === 'entry.cjs', 'Native bootstrap was not installed')
  assert(engine.module.requestPermissions.some(permission => permission.name === 'ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY'), 'Required native runtime JIT permission absent')
  checks.push({ name: 'native-app-and-template-configuration', passed: true })
  const sourceWindow = await fs.readFile(path.join(project, 'web_engine/src/main/ets/components/WebWindow.ets'), 'utf8')
  const sourceStage = await fs.readFile(path.join(project, 'web_engine/src/main/ets/application/WebAbilityStage.ets'), 'utf8')
  assert(sourceWindow.includes('XComponent') && sourceWindow.includes('libraryname: "adapter"') && sourceWindow.includes('runBrowser'), 'Native maintainer surface adapter missing')
  assert(sourceStage.includes('kGetLastActiveWidget') && sourceStage.includes('instanceKey'), 'Maintainer focus handover route missing')
  const adaptations = await readJson(path.join(output, 'native-adaptation-evidence.json'))
  assert(adaptations.runtime === lock.electronVersion, 'Native adaptations belong to another runtime')
  const requiredAdaptations = Object.keys(sourceHashes).map(file => 'web_engine/src/main/ets/' + file).sort()
  assert(JSON.stringify(adaptations.changes.map(change => change.path).sort()) === JSON.stringify(requiredAdaptations), 'Native adaptation list is incomplete or duplicated')
  for (const change of adaptations.changes) {
    assert(change.originalSHA256 === sourceHashes[change.path.slice('web_engine/src/main/ets/'.length)], 'Native adaptation uses an unreviewed template')
    assert(digest(await fs.readFile(path.join(project, change.path))) === change.adaptedSHA256, `Native adaptation changed after preparation: ${change.path}`)
  }
  assert(sourceStage.includes('PrepareTermination.CANCEL') && sourceStage.includes('if (GlobalThisHelper.isTerminationApproved())'), 'Native termination bypasses the product close state machine')
  const sourceLifecycle = await fs.readFile(path.join(project, 'web_engine/src/main/ets/adapter/AppLifecycleAdapter.ets'), 'utf8')
  assert(sourceLifecycle.includes('GlobalThisHelper.confirmTermination()'), 'Completed Electron quit cannot finish native termination')
  assert(sourceStage.includes('this.bindingsReady = true') && sourceStage.includes('this.dispatchPendingTermination()'), 'Early close intention is not replayed after native bindings become ready')
  assert(sourceStage.includes('GlobalThisHelper.isBrowserReady()') && sourceLifecycle.includes('GlobalThisHelper.markBrowserReady()'), 'Close readiness substitutes bindings for actual native Browser startup')
  const sourceDialog = await fs.readFile(path.join(project, 'web_engine/src/main/ets/adapter/DialogAdapter.ets'), 'utf8')
  assert(sourceDialog.includes('await Inject.get(PermissionManagerAdapter).persistGrantedDirectories(directories)'), 'Standard Electron directory dialog bypasses persistent permission handling')
  checks.push({ name: 'native-close-and-directory-source-adaptations', files: adaptations.changes.length, passed: true, scope: adaptations.scope })
  checks.push({ name: 'native-surface-source-present', passed: true, scope: 'Source inspection only, not ArkTS compilation or device execution.' })
  for (const lib of lock.libraries) {
    const binary = await fs.readFile(path.join(project, 'electron/libs/arm64-v8a', lib.name))
    assert(binary.length === lib.bytes && digest(binary) === lib.sha256, 'Native runtime library integrity mismatch')
    assert(binary.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) && binary[4] === 2 && binary[5] === 1 && binary.readUInt16LE(18) === 183, 'Native runtime library is not ARM64 ELF')
  }
  checks.push({ name: 'maintainer-library-integrity-and-architecture', libraries: lock.libraries.length, passed: true })
  const projectFiles = await files(project)
  const privateNames = /(?:^|[\\/])(?:settings\.json|accounts\.json|launcher-current\.log|favorites\.json|pelican-bicycle\.html|local\.properties|MacGameWindow|LinuxGameWindow)$|\.(?:p12|pfx|p7b|cer|key|pem|exe|dll|node|dylib)$/i
  assert(!projectFiles.some(file => privateNames.test(file)), 'User data, credentials or a foreign executable entered the native project')
  assert(!projectFiles.some(file => /[\\/]node_modules[\\/]koffi[\\/]/.test(file)), 'Foreign native ffi dependency was packaged')
  for (const file of projectFiles) if (/\.(?:json5|properties)$/.test(file)) {
    const text = await fs.readFile(file, 'utf8')
    assert(!/storePassword|keyPassword|certpath|\/Users\/zhanghao/.test(text), 'Upstream personal signing fields leaked')
  }
  checks.push({ name: 'allowlisted-package-privacy-and-native-abi', files: projectFiles.length, passed: true })
  const evidence = { schemaVersion: 1, createdAt: new Date().toISOString(), version: pkg.version, checks,
    result: 'engineering-inspection-passed', sdkCompiled: false, signedAndInstalled: false, realDevicePassed: false,
    gamePassed: false, fullFeatureParityPassed: false,
    warning: 'File and source checks cannot prove ArkTS compile validity, runtime security, graphics, audio or a local Minecraft JVM.' }
  await fs.writeFile(path.join(output, 'inspection-evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence, null, 2))
  return evidence
}

module.exports = { verify }
if (require.main === module) verify().catch(async error => {
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(path.join(output, 'inspection-evidence.json'), JSON.stringify({
    schemaVersion: 1, createdAt: new Date().toISOString(), result: 'engineering-inspection-failed',
    error: error.message, fullFeatureParityPassed: false
  }, null, 2) + '\n')
  console.error(error.message)
  process.exitCode = 1
})
