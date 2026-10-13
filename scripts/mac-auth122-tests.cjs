const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { validateAssets, extractPackagedRenderer, validateUiProof, sha } = require('./mac-auth122-contract.cjs')
const expected = { version: '1.1.22', arch: 'arm64', commit: 'a'.repeat(40), runtimeVersion: '44.3.0' }
const manifest = () => ({ ...expected, minimum: '13.0.0', signing: 'ad-hoc; not Developer ID or notarized', packageIntegrity: true, assets: ['zip', 'dmg'].map(ext => ({ name: `KAMUCL-1.1.22-mac-arm64.${ext}`, bytes: 10, sha256: 'b'.repeat(64) })) })
test('Mac auth122 provenance requires the exact source, runtime and both original asset names', () => {
  assert.equal(validateAssets(manifest(), expected).length, 2)
  for (const key of ['commit', 'runtimeVersion', 'version', 'arch']) assert.throws(() => validateAssets({ ...manifest(), [key]: 'wrong' }, expected))
  for (const assets of [[manifest().assets[0]], [manifest().assets[0], manifest().assets[0]], [{ ...manifest().assets[0], name: '../private.zip' }, manifest().assets[1]]]) assert.throws(() => validateAssets({ ...manifest(), assets }, expected))
})
test('Mac UI extraction uses actual packed renderer bytes and excludes other ASAR data', async t => {
  const asar = require('asar'), root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-mac-auth122-test-'))
  t.after(() => { assert(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir()) + path.sep + 'kamucl-mac-auth122-test-')); fs.rmSync(root, { recursive: true, force: true }) })
  const source = path.join(root, 'source'), destination = path.join(root, 'extracted'), archive = path.join(root, 'app.asar')
  fs.mkdirSync(path.join(source, 'out/renderer/assets'), { recursive: true }); fs.mkdirSync(path.join(source, 'profile'))
  fs.writeFileSync(path.join(source, 'out/renderer/index.html'), '<html>original bytes</html>'); fs.writeFileSync(path.join(source, 'out/renderer/assets/中文 asset.js'), 'original module')
  fs.writeFileSync(path.join(source, 'profile/accounts.json'), 'synthetic data must not be extracted')
  await asar.createPackage(source, archive)
  const result = extractPackagedRenderer(archive, destination)
  assert.equal(result.length, 2); assert.equal(fs.readFileSync(path.join(destination, 'index.html'), 'utf8'), '<html>original bytes</html>')
  assert(!fs.existsSync(path.join(destination, 'profile'))); assert.equal(result.find(row => row.path === 'index.html').sha256, sha(Buffer.from('<html>original bytes</html>')))
})
test('Mac renderer extraction rejects links, unpacked payloads and traversal', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-mac-auth122-paths-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const entry of ['/out/renderer/../escape.js', '/out/renderer/../../escape.js']) assert.throws(() => extractPackagedRenderer('unused', root, { listPackage: () => [entry] }), /Unsafe/)
  for (const info of [{ link: 'outside' }, { unpacked: true }]) assert.throws(() => extractPackagedRenderer('unused', root, { listPackage: () => ['/out/renderer/index.html'], statFile: () => info }), /signed packed/)
})
test('Mac UI gate cannot count synthetic success from another platform or missing credential checks', () => {
  const combinations = []
  for (const theme of ['blue-white', 'black-orange', 'black-pink', 'custom']) for (const contentSize of [[1366, 768], [960, 620]]) for (const zoom of [1, 1.25]) combinations.push({ theme, contentSize, zoom })
  const proof = { version: '1.1.22', complete: true, runtime: { platform: 'darwin', arch: 'arm64', electron: '44.3.0' }, errors: [], checks: [], images: [{ sha256: 'a'.repeat(64) }],
    matrix: combinations.map(row => ({ ...row, coordinateActions: true })),
    cfMatrix: combinations.map(({ contentSize: size, ...row }) => ({ ...row, size, writeOnly: true, saveFailurePreserved: true, explicitClear: true })),
    frpMatrix: combinations.map(row => ({ ...row, writeOnly: true, replacementFailurePreserved: true, clearFailurePreserved: true, lockedReadDisabled: true, confirmedClearPreservesRecords: true })) }
  assert(validateUiProof(proof, expected))
  for (const change of [{ complete: false }, { runtime: { ...proof.runtime, arch: 'x64' } }, { matrix: [] }, { errors: ['actual failure'] }, { cfMatrix: undefined }, { frpMatrix: [] }, { images: [] }]) assert.throws(() => validateUiProof({ ...proof, ...change }, expected))
  for (const field of ['matrix', 'cfMatrix', 'frpMatrix']) {
    const duplicated = structuredClone(proof); duplicated[field][1] = { ...duplicated[field][0] }; assert.throws(() => validateUiProof(duplicated, expected), /Duplicate/)
    const missingTheme = structuredClone(proof); missingTheme[field][0].theme = 'transparent'; assert.throws(() => validateUiProof(missingTheme, expected), /wrong theme/)
  }
  for (const [field, flag] of [['cfMatrix', 'saveFailurePreserved'], ['frpMatrix', 'clearFailurePreserved'], ['frpMatrix', 'lockedReadDisabled']]) {
    const missing = structuredClone(proof); missing[field][0][flag] = false; assert.throws(() => validateUiProof(missing, expected), /Missing required/)
  }
})
test('native workflow retains raw failures, verified action commits and a strict evidence allowlist', () => {
  const workflow = fs.readFileSync('.github/workflows/mac-auth122.yml', 'utf8'), driver = fs.readFileSync('scripts/verify-mac-auth122.cjs', 'utf8')
  assert.match(workflow, /runs-on: macos-26/); assert.match(workflow, /npm test/); assert.match(workflow, /set -o pipefail/); assert.doesNotMatch(workflow, /continue-on-error/)
  const provenance = JSON.parse(fs.readFileSync('audit-reports/ACTION_PIN_PROVENANCE.json', 'utf8'))
  const verified = JSON.stringify(provenance)
  for (const match of workflow.matchAll(/uses: (actions\/[\w-]+)@([^\s]+)/g)) { assert.match(match[2], /^[a-f0-9]{40}$/); assert(verified.includes(match[2]), 'Action commit must have verified official-ref evidence') }
  assert.doesNotMatch(workflow, /out\/auth122-ui-\*|out\/mac-auth122-private/)
  assert.match(driver, /KAMUCL_REVIEW_RENDERER_DIR: renderer/); assert.match(driver, /name === 'proof.json'/); assert.doesNotMatch(driver, /npm.*build|cpSync\(source, destination/)
})
