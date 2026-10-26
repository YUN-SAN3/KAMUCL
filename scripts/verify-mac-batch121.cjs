// Supplementary native-runtime fixture UI QA. The real APP/DMG jobs remain required.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { validateGraphics, validateSelection, validateQueueControls } = require('./qa-fixture-ui121.cjs')

const THEMES = ['dark', 'black-purple', 'blue-white', 'custom']
const VIEWPORTS = ['960x620', '1366x768']
const ZOOMS = [1, 1.25]
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const fingerprint = file => ({ file, sha256: sha(fs.readFileSync(file)) })

function assertNativeHost(host) {
  assert.equal(host.platform, 'darwin', 'This job must execute on native macOS, not an emulated Windows fixture')
  assert.equal(host.arch, 'arm64', 'Use the matching native ARM64 runner and Electron')
}

function matrixPlan() {
  return [
    ...THEMES.flatMap(theme => VIEWPORTS.flatMap(viewport => ZOOMS.map(zoom => ({
      kind: 'appearance', theme, viewport, zoom,
      script: 'scripts/verify-appearance-121-ui.cjs',
      args: ['--theme', theme, '--viewport', viewport, '--zoom', String(zoom)],
      prefix: 'appearance-121-ui-'
    })))),
    ...ZOOMS.map(zoom => ({ kind: 'community', zoom, script: 'scripts/verify-community121-ui.cjs', args: ['--zoom', String(zoom)], prefix: 'community-review-ui121-' }))
  ]
}

function validateManifest(manifest, expected) {
  assert.equal(expected.version, '1.1.21', 'The batch121 script accepts only its current batch')
  assert.equal(manifest.version, expected.version)
  assert.equal(manifest.arch, 'arm64')
  assert.equal(manifest.commit, expected.commit, 'Downloaded package and QA checkout must be the same source')
  assert.equal(manifest.buildIdentity?.sourceCommit, expected.commit)
  assert.equal(manifest.buildIdentity?.version, expected.version)
  assert.equal(manifest.runtimeVersion, expected.electron)
  assert.equal(manifest.buildIdentity?.runtimeVersion, expected.electron)
  assert.equal(manifest.packageIntegrity, true)
  assert.deepEqual(manifest.assets.map(asset => asset.name).sort(), [`KAMUCL-${expected.version}-mac-arm64.dmg`, `KAMUCL-${expected.version}-mac-arm64.zip`])
  for (const asset of manifest.assets) {
    assert.equal(path.basename(asset.name), asset.name)
    assert(Number.isSafeInteger(asset.bytes) && asset.bytes > 0)
    assert.match(asset.sha256, /^[a-f\d]{64}$/)
  }
}

function rendererHashMap(artifacts) {
  const entries = artifacts.map(item => {
    assert.match(item.sha256, /^[a-f\d]{64}$/)
    return [path.basename(item.file), item.sha256]
  })
  assert.equal(new Set(entries.map(([name]) => name)).size, entries.length, 'Duplicate renderer evidence')
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)))
}

function validateProof(proof, row, expected) {
  assert.equal(proof.complete, true, 'An incomplete or failed matrix row never qualifies')
  assert.deepEqual(proof.errors ?? proof.failures ?? [], [])
  assertNativeHost(proof.runtime)
  assert.equal(proof.runtime.electron, expected.electron)
  assert.equal(proof.configuration.packageVersion, expected.version)
  assert.equal(proof.configuration.pageZoom, row.zoom)
  assert.match(proof.classification, /fixture/i)
  assert.match(proof.classification, /offscreen/i)
  validateGraphics(proof.graphics, 'darwin')
  assert.deepEqual(rendererHashMap(proof.rendererArtifacts ?? proof.rendererFiles), expected.rendererHashes, 'UI must load this exact fully built renderer')
  if (row.kind === 'appearance') {
    assert.equal(proof.configuration.requestedTheme, row.theme)
    const [width, height] = row.viewport.split('x').map(Number)
    assert.deepEqual(proof.configuration.physicalViewport, { width, height })
    assert(Math.abs(proof.configuration.cssViewport.width - width / row.zoom) < 1)
    assert(Math.abs(proof.configuration.cssViewport.height - height / row.zoom) < 1)
    assert(proof.inputReplacements?.length >= 4, 'Retain actual full-selection, empty and replacement observations')
    for (const item of proof.inputReplacements) { validateSelection(item.selection); assert.equal(item.emptyValue, ''); assert.equal(typeof item.expectedValue, 'string'); assert.equal(item.value, item.expectedValue) }
  } else {
    assert.deepEqual(proof.configuration.themes, ['blue-white', 'black-orange', 'black-pink', 'white-pink', 'transparent', 'custom'])
    assert.deepEqual(proof.configuration.physicalViewports, [{ width: 1366, height: 768 }, { width: 960, height: 620 }])
    const accents = proof.geometry.filter(item => item.label === 'actual rendered theme accent')
    assert.equal(accents.length, 6, 'Every selected theme requires an observed renderer accent')
    assert.equal(accents.find(item => item.theme === 'transparent')?.accent, '#9475ed', 'Default black-purple must retain its actual purple accent')
    assert(Object.values(proof.configuration.fixtureCustomColors ?? {}).length >= 9 && Object.values(proof.configuration.fixtureCustomColors).every(color => /^#[a-f\d]{6}$/i.test(color)), 'Use a complete valid custom palette')
    assert.equal(accents.find(item => item.theme === 'custom')?.accent, proof.configuration.fixtureCustomColors.accent)
    const hits = proof.geometry.filter(item => item.label === 'search action center hits')
    for (const item of hits) assert(item.searchHits?.length >= 2 && item.searchHits.every(hit => hit.inViewport === true && hit.correct === true), 'Actual search/reset coordinates must hit their intended controls')
    const layouts = new Set(hits.map(item => `${item.theme}:${item.width}x${item.height}`))
    for (const theme of proof.configuration.themes) for (const viewport of VIEWPORTS) assert(layouts.has(theme + ':' + viewport), 'Missing actual community layout: ' + theme + ':' + viewport)
    const headings = proof.geometry.filter(item => item.label === 'sticky queue jump keeps heading visible')
    assert.equal(headings.length, 12, 'Every actual queue jump requires a heading observation')
    for (const item of headings) assert(Number.isFinite(item.headingTop) && Number.isFinite(item.barBottom) && item.headingTop >= item.barBottom, 'Sticky entry must not cover the queue heading')
    const controls = proof.geometry.filter(item => item.label === 'scrollable queue controls reachable')
    assert.equal(controls.length, 12, 'Every queue layout requires every scrolled action to be observed')
    const controlLayouts = new Set(controls.map(item => `${item.theme}:${item.width}x${item.height}`))
    for (const theme of proof.configuration.themes) for (const viewport of VIEWPORTS) assert(controlLayouts.has(theme + ':' + viewport), 'Missing actual queue action layout: ' + theme + ':' + viewport)
    for (const item of controls) validateQueueControls(item.controls)
  }
}

async function fileSha(file) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function main() {
  fs.mkdirSync('out', { recursive: true })
  const root = fs.mkdtempSync(path.resolve('out/mac-batch121-ui-'))
  const receipt = { complete: false, root, startedAt: new Date().toISOString(), classification: 'Supplementary actual native ARM64 Electron with production renderer; isolated IPC, offscreen renderer and platform-default ANGLE/GPU. Does not replace packaged APP/DMG/native-game/startup qualification.', runtime: { platform: process.platform, arch: process.arch, node: process.versions.node, osRelease: os.release() }, attempts: [] }
  const save = () => fs.writeFileSync(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2))
  try {
    save()
    assertNativeHost(process)
    assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Use the owned disposable CI runner')
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    assert.equal(commit, process.env.GITHUB_SHA, 'CI checkout must match the requested workflow source')
    const electron = require('electron'), runtimeVersion = require('electron/package.json').version
    assert.equal(runtimeVersion, pkg.devDependencies.electron, 'Installed native Electron must equal the locked product runtime')
    const manifestFile = 'release/mac-package-arm64.json', manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    const expected = { version: pkg.version, commit, electron: runtimeVersion }
    validateManifest(manifest, expected)
    receipt.version = pkg.version; receipt.artifactSourceCommit = manifest.commit; receipt.qaSourceCommit = commit
    receipt.workflowSha = process.env.GITHUB_SHA; receipt.workflowRef = process.env.GITHUB_REF
    receipt.finalTagCommit = process.env.GITHUB_REF_TYPE === 'tag' ? commit : null
    receipt.packageManifest = fingerprint(manifestFile); receipt.packageAssets = manifest.assets
    receipt.runtime.electron = runtimeVersion; receipt.runtime.executable = electron
    receipt.runtime.executableSHA256 = await fileSha(electron)
    receipt.qaSources = ['.github/workflows/mac-build.yml', 'scripts/verify-mac-batch121.cjs', 'scripts/verify-appearance-121-ui.cjs', 'scripts/verify-community121-ui.cjs', 'scripts/qa-fixture-ui121.cjs'].map(fingerprint)
    save()
    for (const asset of manifest.assets) {
      const file = path.join('release', asset.name)
      assert.equal(fs.statSync(file).size, asset.bytes)
      assert.equal(await fileSha(file), asset.sha256, 'Original downloaded asset SHA256 must match its manifest')
    }
    const rendererFiles = ['index.html', ...fs.readdirSync('out/renderer/assets').filter(name => /\.(js|css)$/.test(name)).sort().map(name => 'assets/' + name)]
    const rendererArtifacts = rendererFiles.map(relative => fingerprint(path.join('out/renderer', relative)))
    expected.rendererHashes = rendererHashMap(rendererArtifacts); receipt.rendererArtifacts = rendererArtifacts
    // Compare every freshly built renderer byte to the current downloaded ZIP, without launching it.
    const extracted = path.join(root, 'downloaded-package')
    execFileSync('ditto', ['-x', '-k', path.resolve('release', `KAMUCL-${pkg.version}-mac-arm64.zip`), extracted], { stdio: 'inherit' })
    const archive = path.join(extracted, 'KAMUCL.app/Contents/Resources/app.asar')
    assert.equal(await fileSha(archive), manifest.appAsarSHA256)
    const asar = require('asar')
    for (const relative of rendererFiles) assert.equal(sha(asar.extractFile(archive, 'out/renderer/' + relative)), expected.rendererHashes[path.basename(relative)], 'Built renderer differs from the packaged application: ' + relative)
    receipt.packagedRendererMatches = true; save()
    const childEnv = { ...process.env }; delete childEnv.ELECTRON_RUN_AS_NODE; delete childEnv.KAMUCL_REVIEW_RENDERER_DIR
    for (const row of matrixPlan()) {
      const attempt = { ...row, complete: false, startedAt: new Date().toISOString() }
      receipt.attempts.push(attempt); save()
      const before = new Set(fs.readdirSync('out'))
      try {
        console.log('Native fixture UI: ' + JSON.stringify(row))
        const output = execFileSync(electron, [row.script, ...row.args], { env: childEnv, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 })
        fs.writeFileSync(path.join(root, `attempt-${receipt.attempts.length}.log`), output)
        const created = fs.readdirSync('out').filter(name => name.startsWith(row.prefix) && !before.has(name))
        assert.equal(created.length, 1, 'Each isolated child must write one new evidence root')
        const proofFile = path.resolve('out', created[0], 'proof.json'), proof = JSON.parse(fs.readFileSync(proofFile, 'utf8'))
        attempt.proofFile = proofFile; attempt.proofSHA256 = (await fileSha(proofFile))
        validateProof(proof, row, expected)
        const screenshots = fs.readdirSync(path.dirname(proofFile)).filter(name => name.endsWith('.png'))
        assert(screenshots.length >= (row.kind === 'community' ? 30 : 5), 'Screenshots must remain available for review')
        attempt.screenshots = screenshots; attempt.nativeRuntime = proof.runtime; attempt.complete = true
      } catch (error) {
        attempt.error = { message: error.message, status: error.status ?? null, signal: error.signal ?? null }
        attempt.evidenceRoots = fs.readdirSync('out').filter(name => name.startsWith(row.prefix) && !before.has(name)).map(name => path.resolve('out', name))
        fs.writeFileSync(path.join(root, `attempt-${receipt.attempts.length}.log`), [error.stack, error.stdout, error.stderr].filter(Boolean).join('\n'))
        console.error(attempt.error)
      } finally { attempt.finishedAt = new Date().toISOString(); save() }
    }
    assert.equal(receipt.attempts.length, 18)
    assert(receipt.attempts.every(attempt => attempt.complete), 'Native fixture UI matrix failed; original failures and screenshots are retained')
    receipt.complete = true
  } catch (error) {
    receipt.error = { name: error.name, message: error.message, status: error.status ?? null, signal: error.signal ?? null }
    console.error(error); process.exitCode = 1
  } finally { receipt.finishedAt = new Date().toISOString(); save() }
}

module.exports = { assertNativeHost, matrixPlan, validateManifest, rendererHashMap, validateProof }
if (require.main === module) main()
