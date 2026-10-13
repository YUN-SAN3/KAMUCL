// Scope and provenance checks shared by the native coordinator and offline tests.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
function validateAssets(manifest, expected) {
  for (const key of ['version', 'arch', 'commit', 'runtimeVersion']) assert.equal(manifest[key], expected[key], 'Mac package ' + key + ' mismatch')
  assert.equal(manifest.minimum, '13.0.0'); assert.equal(manifest.packageIntegrity, true)
  assert.equal(manifest.signing, 'ad-hoc; not Developer ID or notarized')
  const names = ['zip', 'dmg'].map(ext => `KAMUCL-${expected.version}-mac-${expected.arch}.${ext}`)
  assert.equal(manifest.assets.length, 2); assert.deepEqual(manifest.assets.map(row => row.name).sort(), names.sort())
  for (const row of manifest.assets) { assert.equal(path.basename(row.name), row.name); assert.match(row.sha256, /^[a-f0-9]{64}$/); assert(Number.isSafeInteger(row.bytes) && row.bytes > 0) }
  return manifest.assets
}
function extractPackagedRenderer(asarPath, destination, asar = require('asar')) {
  const files = []
  for (const entry of asar.listPackage(asarPath)) {
    // ASAR listPackage emits the host separator; normalize that representation first.
    const relative = entry.split(path.sep).join('/').replace(/^\//, '')
    if (!relative.startsWith('out/renderer/')) continue
    assert(!relative.includes('\\') && !relative.split('/').includes('..'), 'Unsafe packaged renderer path')
    const archiveName = relative.split('/').join(path.sep)
    const info = asar.statFile(asarPath, archiveName, false)
    assert(!info.link && !info.unpacked, 'Renderer must consist of signed packed files')
    if (info.files) continue
    const name = relative.slice('out/renderer/'.length), bytes = asar.extractFile(asarPath, archiveName, false)
    const target = path.resolve(destination, name)
    assert(target.startsWith(path.resolve(destination) + path.sep), 'Renderer extraction leaves its owned directory')
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes)
    assert.equal(sha(fs.readFileSync(target)), sha(bytes), 'Renderer bytes changed during extraction')
    files.push({ path: name, bytes: bytes.length, sha256: sha(bytes) })
  }
  assert(files.some(row => row.path === 'index.html'), 'Original package lacks its renderer entry')
  return files.sort((a, b) => a.path.localeCompare(b.path))
}
function validateUiProof(proof, expected) {
  assert.equal(proof.version, expected.version); assert.equal(proof.complete, true)
  assert.equal(proof.runtime.platform, 'darwin'); assert.equal(proof.runtime.arch, 'arm64'); assert.equal(proof.runtime.electron, expected.runtimeVersion)
  assert.deepEqual(proof.errors, [])
  const combinations = []
  for (const theme of ['blue-white', 'black-orange', 'black-pink', 'custom']) for (const size of [[1366, 768], [960, 620]]) for (const zoom of [1, 1.25]) combinations.push(JSON.stringify([theme, size, zoom]))
  for (const [field, sizeField, flags] of [
    ['matrix', 'contentSize', ['coordinateActions']],
    ['cfMatrix', 'size', ['writeOnly', 'saveFailurePreserved', 'explicitClear']],
    ['frpMatrix', 'contentSize', ['writeOnly', 'replacementFailurePreserved', 'clearFailurePreserved', 'lockedReadDisabled', 'confirmedClearPreservesRecords']]
  ]) {
    assert(Array.isArray(proof[field]) && proof[field].length === combinations.length, 'Native required matrix missing/incomplete: ' + field)
    const observed = proof[field].map(row => {
      for (const flag of flags) assert.equal(row[flag], true, 'Missing required native observation: ' + field + '.' + flag)
      return JSON.stringify([row.theme, row[sizeField], row.zoom])
    })
    assert.equal(new Set(observed).size, combinations.length, 'Duplicate native matrix combination: ' + field)
    assert.deepEqual(observed.sort(), [...combinations].sort(), 'Native matrix has the wrong theme/viewport/zoom: ' + field)
  }
  assert(proof.images.length > 0 && proof.images.every(row => /^[a-f0-9]{64}$/.test(row.sha256)), 'Native screenshot bytes must be hashed')
  return true
}
module.exports = { validateAssets, extractPackagedRenderer, validateUiProof, sha }
