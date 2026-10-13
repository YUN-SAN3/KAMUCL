// Packaging/QA only. Source identity lives in signed Resources, outside the ASAR
// whose hash it records, so signing introduces no circular payload hash.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const crypto = require('node:crypto'), { execFileSync } = require('node:child_process')
const { verifyRuntimeNotices } = require('./mac-runtime-notices.cjs')
const IDENTITY_FILE = 'kamucl-mac.json'
const signing = 'ad-hoc; not Developer ID or notarized'
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function assertMacIdentity(identity, expected) {
  assert.equal(identity.schemaVersion, 1, 'Mac package identity schema missing')
  assert.equal(identity.product, 'KAMUCL'); assert.equal(identity.platform, 'darwin')
  assert(['arm64', 'x64'].includes(identity.arch), 'Unsupported Mac package architecture')
  assert.match(identity.sourceCommit, /^[a-f0-9]{40}$/, 'Mac source must be an actual Git commit')
  assert.match(identity.appAsarSHA256, /^[a-f0-9]{64}$/, 'Mac ASAR identity hash missing')
  assert.equal(identity.signing, signing)
  for (const key of ['version', 'arch', 'sourceCommit', 'runtimeVersion', 'minimumSystemVersion']) {
    assert.equal(typeof expected[key], 'string', 'Missing expected Mac ' + key)
    assert.equal(identity[key], expected[key], 'Mac package ' + key + ' differs from verification source')
  }
  assert.equal(Number(identity.minimumSystemVersion.split('.')[0]), 13, 'Mac package minimum must be 13+')
  return identity
}
function createMacIdentity(values) {
  const identity = { schemaVersion: 1, product: 'KAMUCL', platform: 'darwin', ...values, signing }
  return assertMacIdentity(identity, values)
}
function readMacPackageIdentity(appPath, expected, { execute = execFileSync } = {}) {
  const resources = path.join(appPath, 'Contents', 'Resources'), file = path.join(resources, IDENTITY_FILE)
  const stat = fs.lstatSync(file)
  assert(stat.isFile() && !stat.isSymbolicLink(), 'Mac embedded identity must be a regular signed resource')
  const identity = assertMacIdentity(JSON.parse(fs.readFileSync(file, 'utf8')), expected)
  execute('codesign', ['--verify', '--deep', '--strict', appPath], { timeout: 30000 })
  const nativeArch = identity.arch === 'x64' ? 'x86_64' : 'arm64'
  for (const executable of [path.join(appPath, 'Contents', 'MacOS', 'KAMUCL'), path.join(resources, 'app.asar.unpacked', 'out', 'main', 'MacGameWindow')]) {
    const observed = execute('lipo', ['-archs', executable], { encoding: 'utf8', timeout: 10000 }).trim().split(/\s+/)
    assert.deepEqual(observed, [nativeArch], 'Mac executable ABI differs from embedded architecture')
  }
  const observedRuntime = execute('plutil', ['-extract', 'CFBundleVersion', 'raw', path.join(appPath, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Resources', 'Info.plist')], { encoding: 'utf8', timeout: 10000 }).trim()
  const observedMinimum = execute('plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', path.join(appPath, 'Contents', 'Info.plist')], { encoding: 'utf8', timeout: 10000 }).trim()
  assert.equal(observedRuntime, identity.runtimeVersion, 'Actual Electron framework runtime differs from signed identity')
  assert.equal(observedMinimum, identity.minimumSystemVersion, 'Actual Mac minimum differs from signed identity')
  assert.equal(sha256(path.join(resources, 'app.asar')), identity.appAsarSHA256, 'Mac ASAR bytes differ from signed identity')
  const parts = identity.version.split('.').map(Number)
  const needsRuntimeNotices = parts[0] > 1 || (parts[0] === 1 && (parts[1] > 1 || (parts[1] === 1 && parts[2] >= 22)))
  if (needsRuntimeNotices) verifyRuntimeNotices(resources, identity.runtimeNotices)
  return { identity, identitySHA256: sha256(file), observedRuntime, observedMinimum, nativeArch, signature: 'strict deep verification passed' }
}
function collectMacWorldHashes(saveDirectory) {
  const regionDirectory = path.join(saveDirectory, 'dimensions', 'minecraft', 'overworld', 'region')
  const regionFiles = fs.readdirSync(regionDirectory).filter(name => name.endsWith('.mca')).sort()
  assert(regionFiles.length > 0, 'demo world chunks were not saved')
  const files = ['level.dat', ...regionFiles.map(name => path.join('dimensions', 'minecraft', 'overworld', 'region', name))].map(relative => {
    const file = path.join(saveDirectory, relative), stat = fs.lstatSync(file)
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0, 'Saved world file missing, empty or unsafe: ' + relative)
    return { path: relative.split(path.sep).join('/'), bytes: stat.size, sha256: sha256(file) }
  })
  return { saved: true, fileSHA256: files[0].sha256, files, observation: 'Actual level.dat and region bytes read after the owned game has exited normally; hashes only, world files are not included in artifacts' }
}
function findMacGameExit(events, expected) {
  for (const key of ['versionId', 'folder', 'launchId']) assert(typeof expected[key] === 'string' && expected[key], 'Owned game ' + key + ' observation missing')
  return events.filter(event => event.name === 'launchState').map(event => event.value).reverse().find(state => state?.status === 'exited' && ['versionId', 'folder', 'launchId'].every(key => state[key] === expected[key]))
}
function assertMacNormalGameExit(events, expected) {
  const state = findMacGameExit(events, expected)
  assert(state, 'Owned game normal exit event missing')
  assert.equal(state.code, 0, 'Owned game actual exit code must be zero')
  assert.equal(state.exitKind, 'normal', 'Owned game actual exit kind must be normal')
  assert.equal(state.intentionalStop, false, 'Normal native close cannot be a forced game stop')
  assert.equal(state.intentionalRestart, false, 'Normal native close cannot be a game restart')
  return state
}
module.exports = { IDENTITY_FILE, createMacIdentity, assertMacIdentity, readMacPackageIdentity, collectMacWorldHashes, findMacGameExit, assertMacNormalGameExit }
