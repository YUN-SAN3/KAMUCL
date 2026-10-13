// Negative fixtures exercise the materials gate without touching a real package.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { checkLicenses } = require('./check-licenses.cjs')
const source = path.resolve(__dirname, '..')
function fixture(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-license-fixture-122-'))
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }))
  const copy = name => { const destination = path.join(rootDir, name); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(path.join(source, name), destination) }
  const provenance = JSON.parse(fs.readFileSync(path.join(source, 'docs/third-party-provenance.json'), 'utf8'))
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/license-status.json', 'docs/CORRESPONDING_SOURCE.md', 'docs/third-party-provenance.json', provenance.skinview3d.file]) copy(name)
  fs.cpSync(path.join(source, 'licenses'), path.join(rootDir, 'licenses'), { recursive: true })
  for (const name of provenance.voxlink.files) copy('src/main/core/voxlink/' + name)
  for (const name of provenance.voxlink.sharedFiles || []) copy(name)
  return { rootDir, provenance }
}
test('1.1.22 complete notices and supplied source pass the deterministic gate', () => assert.doesNotThrow(() => checkLicenses({ release: true })))
test('a zero-length MIT notice cannot pass solely because its filename exists', t => {
  const { rootDir } = fixture(t); fs.writeFileSync(path.join(rootDir, 'licenses/three.txt'), '')
  assert.throws(() => checkLicenses({ rootDir, release: true }), /Incomplete MIT license/)
})
test('missing native header attribution fails before packaging', t => {
  const { rootDir } = fixture(t); fs.unlinkSync(path.join(rootDir, 'licenses/node-addon-api.txt'))
  assert.throws(() => checkLicenses({ rootDir, release: true }), /ENOENT/)
})
test('a truncated LGPL text cannot masquerade as the full supplement', t => {
  const { rootDir } = fixture(t); fs.writeFileSync(path.join(rootDir, 'licenses/LGPL-3.0.txt'), 'GNU LESSER GENERAL PUBLIC LICENSE\n')
  assert.throws(() => checkLicenses({ rootDir, release: true }), /Incomplete copyleft license/)
})
test('tampered primary notice with correct headings still fails its source digest', t => {
  const { rootDir } = fixture(t); fs.appendFileSync(path.join(rootDir, 'licenses/node-api-headers.txt'), '\nchanged copyright owner\n')
  assert.throws(() => checkLicenses({ rootDir, release: true }), /Verified license material changed/)
})
test('missing or corrupted library corresponding source stops release', t => {
  const { rootDir } = fixture(t); const file = path.join(rootDir, 'licenses/source/7zip-19.00-source.7z'); fs.writeFileSync(file, 'same public URL is not supplied source')
  assert.throws(() => checkLicenses({ rootDir, release: true }), /Corresponding-source archive changed/)
})
test('line endings may change in a Git checkout without changing license text', t => {
  const { rootDir } = fixture(t); const file = path.join(rootDir, 'licenses/node-api-headers.txt'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'))
  assert.doesNotThrow(() => checkLicenses({ rootDir, release: true }))
})
test('new unresolved source permission is a release failure and materials-only remains inspectable', t => {
  const { rootDir } = fixture(t); const file = path.join(rootDir, 'docs/license-status.json'); const status = JSON.parse(fs.readFileSync(file, 'utf8')); status.unresolved.push({ id: 'fixture-only', reason: 'unknown source permissions' }); fs.writeFileSync(file, JSON.stringify(status))
  assert.throws(() => checkLicenses({ rootDir, release: true }), /Release blocked by unresolved source permissions/)
  assert.doesNotThrow(() => checkLicenses({ rootDir, release: false }))
})
test('provenance cannot redirect a license reader outside its controlled root', t => {
  const { rootDir, provenance } = fixture(t); provenance.koffiNativeHeaders.materials[0].file = '../external-license.txt'; fs.writeFileSync(path.join(rootDir, 'docs/third-party-provenance.json'), JSON.stringify(provenance))
  assert.throws(() => checkLicenses({ rootDir, release: true }), /Unsafe license material path/)
})
