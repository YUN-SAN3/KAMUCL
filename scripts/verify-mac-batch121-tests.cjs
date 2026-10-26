const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { assertNativeHost, matrixPlan, validateManifest, rendererHashMap, validateProof } = require('./verify-mac-batch121.cjs')

const expected = { version: '1.1.21', commit: 'a'.repeat(40), electron: '44.3.0', rendererHashes: { 'index.html': 'b'.repeat(64) } }
const manifest = () => ({ version: expected.version, arch: 'arm64', commit: expected.commit, runtimeVersion: expected.electron, buildIdentity: { version: expected.version, sourceCommit: expected.commit, runtimeVersion: expected.electron }, packageIntegrity: true, assets: ['dmg', 'zip'].map(ext => ({ name: `KAMUCL-${expected.version}-mac-arm64.${ext}`, bytes: 123, sha256: 'c'.repeat(64) })) })
const row = matrixPlan()[0]
const proof = () => ({ complete: true, failures: [], classification: 'Actual renderer and controlled fixtures; offscreen platform-default GPU', runtime: { platform: 'darwin', arch: 'arm64', electron: expected.electron }, configuration: { packageVersion: expected.version, pageZoom: row.zoom, requestedTheme: row.theme, physicalViewport: { width: 960, height: 620 }, cssViewport: { width: 960, height: 620 } }, graphics: { policy: { platform: 'darwin', backend: 'platform-default', hardwareAcceleration: 'default', angle: 'default' }, featureStatus: { webgl: 'enabled' }, info: { gpuDevice: [] }, webgl: { created: true, renderer: 'Contract sample' } }, inputReplacements: Array.from({ length: 4 }, () => ({ selection: { focused: true, value: 'old', start: 0, end: 3 }, emptyValue: '', expectedValue: 'new', value: 'new' })), rendererArtifacts: [{ file: '/disposable/renderer/index.html', sha256: 'b'.repeat(64) }] })

test('native batch refuses foreign hosts and preserves the original failed receipt', () => {
  assert.doesNotThrow(() => assertNativeHost({ platform: 'darwin', arch: 'arm64' }))
  assert.throws(() => assertNativeHost({ platform: 'win32', arch: 'x64' }), /native macOS/)
  assert.throws(() => assertNativeHost({ platform: 'darwin', arch: 'x64' }), /ARM64/)
  if (process.platform === 'darwin') return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-mac121-guard-'))
  try {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, 'verify-mac-batch121.cjs')], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 1)
    const dirs = fs.readdirSync(path.join(root, 'out'))
    assert.equal(dirs.length, 1)
    const receipt = JSON.parse(fs.readFileSync(path.join(root, 'out', dirs[0], 'receipt.json'), 'utf8'))
    assert.equal(receipt.complete, false)
    assert.equal(receipt.runtime.platform, process.platform)
    assert.match(receipt.error.message, /native macOS/)
    assert.deepEqual(receipt.attempts, [])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('matrix covers all four appearance themes, physical layouts and zooms plus both full community matrices', () => {
  const rows = matrixPlan()
  assert.equal(rows.length, 18)
  assert.equal(rows.filter(row => row.kind === 'appearance').length, 16)
  assert.equal(new Set(rows.filter(row => row.kind === 'appearance').map(row => `${row.theme}:${row.viewport}:${row.zoom}`)).size, 16)
  assert.deepEqual(rows.filter(row => row.kind === 'community').map(row => row.zoom), [1, 1.25])
  for (const row of rows) assert(fs.existsSync(path.resolve(__dirname, '..', row.script)))
})

test('downloaded package version, both source identities, runtime and exact asset names are enforced', () => {
  assert.doesNotThrow(() => validateManifest(manifest(), expected))
  for (const patch of [{ version: '1.1.20' }, { commit: 'd'.repeat(40) }, { arch: 'x64' }, { runtimeVersion: '43.0.0' }, { packageIntegrity: false }, { buildIdentity: { ...manifest().buildIdentity, sourceCommit: 'd'.repeat(40) } }, { assets: [{ ...manifest().assets[0], name: '../KAMUCL-1.1.21-mac-arm64.dmg' }, manifest().assets[1]] }]) {
    assert.throws(() => validateManifest({ ...manifest(), ...patch }, expected))
  }
})

test('a failed, foreign-runtime, old-version, wrong-zoom or foreign-renderer proof cannot qualify', () => {
  assert.doesNotThrow(() => validateProof(proof(), row, expected))
  for (const changed of [
    { ...proof(), complete: false },
    { ...proof(), failures: ['Original defect'] },
    { ...proof(), runtime: { ...proof().runtime, platform: 'win32' } },
    { ...proof(), runtime: { ...proof().runtime, electron: '43.0.0' } },
    { ...proof(), configuration: { ...proof().configuration, packageVersion: '1.1.20' } },
    { ...proof(), configuration: { ...proof().configuration, pageZoom: 1.25 } },
    { ...proof(), graphics: { ...proof().graphics, webgl: { created: false } } },
    { ...proof(), inputReplacements: [{ selection: { focused: true, value: 'old', start: 2, end: 3 }, value: 'new' }] },
    { ...proof(), rendererArtifacts: [{ file: '/elsewhere/index.html', sha256: 'd'.repeat(64) }] }
  ]) assert.throws(() => validateProof(changed, row, expected))
  assert.throws(() => rendererHashMap([{ file: 'a/index.html', sha256: 'b'.repeat(64) }, { file: 'b/index.html', sha256: 'b'.repeat(64) }]), /Duplicate/)
})

test('community qualification requires evidence for each actual theme and physical viewport', () => {
  const community = matrixPlan().find(row => row.kind === 'community')
  const themes = ['blue-white', 'black-orange', 'black-pink', 'white-pink', 'transparent', 'custom']
  const actual = {
    ...proof(),
    configuration: { packageVersion: expected.version, pageZoom: 1, themes, physicalViewports: [{ width: 1366, height: 768 }, { width: 960, height: 620 }], fixtureCustomColors: Object.fromEntries(['accent', 'bg', 'card', 'text', 'textDim', 'border', 'sidebarBg', 'sidebarText', 'bannerText'].map(key => [key, '#059669'])) },
    geometry: [...themes.flatMap(theme => [{ width: 1366, height: 768 }, { width: 960, height: 620 }].flatMap(bounds => [
      { label: 'search action center hits', theme, ...bounds, searchHits: [{ inViewport: true, correct: true }, { inViewport: true, correct: true }] },
      { label: 'scrollable queue controls reachable', theme, ...bounds, controls: Array.from({ length: 4 }, () => ({ inViewport: true, correct: true })) },
      { label: 'sticky queue jump keeps heading visible', theme, ...bounds, headingTop: 160, barBottom: 139 }
    ])), ...themes.map(theme => ({ label: 'actual rendered theme accent', theme, accent: theme === 'transparent' ? '#9475ed' : '#059669' }))]
  }
  assert.doesNotThrow(() => validateProof(actual, community, expected))
  assert.throws(() => validateProof({ ...actual, geometry: actual.geometry.slice(1) }, community, expected), /Missing actual/)
  assert.throws(() => validateProof({ ...actual, geometry: actual.geometry.map((item, i) => i ? item : { ...item, searchHits: [{ inViewport: true, correct: false }] }) }, community, expected), /intended controls/)
  assert.throws(() => validateProof({ ...actual, geometry: actual.geometry.map(item => item.label.startsWith('sticky') ? { ...item, headingTop: 120 } : item) }, community, expected), /cover/)
  assert.throws(() => validateProof({ ...actual, geometry: actual.geometry.filter(item => item.label !== 'actual rendered theme accent') }, community, expected), /observed renderer/)
  assert.throws(() => validateProof({ ...actual, geometry: actual.geometry.filter(item => item.label !== 'scrollable queue controls reachable') }, community, expected), /every scrolled action/)
  assert.throws(() => validateProof({ ...actual, geometry: actual.geometry.map(item => item.controls ? { ...item, controls: item.controls.map((control, i) => i ? control : { ...control, correct: false }) } : item) }, community, expected), /intended control/)
})

test('workflow routes only matching batch versions and keeps original real application qualification', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/mac-build.yml'), 'utf8')
  assert.match(workflow, /batch120:\s*\n\s*if: inputs\.verification_groups != 'parity' && needs\.package\.outputs\.version == '1\.1\.20'/)
  assert.match(workflow, /batch121-fixture-ui:\s*\n\s*if: inputs\.verification_groups != 'parity' && needs\.package\.outputs\.version == '1\.1\.21'/)
  assert.match(workflow, /Fully build the production renderer[\s\S]*?npm run build[\s\S]*?node scripts\/verify-mac-batch121\.cjs/)
  for (const group of ['ui', 'parity', 'game']) assert(workflow.includes(`node scripts/verify-mac-job.cjs ${group}`))
  assert(workflow.includes('group: startup') && workflow.includes('group: tools') && workflow.includes('group: update'))
  const job = workflow.slice(workflow.indexOf('  batch121-fixture-ui:'), workflow.indexOf('  resources:'))
  assert(!job.includes('continue-on-error'))
  assert(job.includes('if: always()'))
  assert(!job.includes('1.1.20-mac') && !job.includes('refs/tags/') && !job.includes('ref:'))
})
