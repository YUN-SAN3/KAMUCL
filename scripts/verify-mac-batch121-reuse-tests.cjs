const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto')
const asar = require('asar'), { spawnSync } = require('node:child_process')
const reuse = require('./verify-mac-batch121-reuse.cjs'), { matrixPlan } = require('./verify-mac-batch121.cjs')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex'), qa = 'a'.repeat(40)
function temporary() { return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-reuse121-test-'))) }
function cleanup(root) { assert.equal(path.dirname(root), fs.realpathSync.native(os.tmpdir())); assert(path.basename(root).startsWith('kamucl-reuse121-test-')); fs.rmSync(root, { recursive: true, force: true }) }
function origin() {
  const repository = { full_name: reuse.REPOSITORY, id: reuse.REPOSITORY_ID }
  return { run: { id: reuse.RUN, head_sha: reuse.SOURCE, head_branch: 'master', event: 'workflow_dispatch', path: '.github/workflows/mac-build.yml', run_attempt: 1, repository, head_repository: { ...repository }, status: 'completed', conclusion: 'failure' }, jobs: [{ id: reuse.PACKAGE_JOB, run_id: reuse.RUN, run_attempt: 1, head_sha: reuse.SOURCE, name: 'package (macos-26, arm64)', status: 'completed', conclusion: 'success' }], artifacts: [{ ...reuse.ARTIFACT, expired: false, workflow_run: { id: reuse.RUN, repository_id: reuse.REPOSITORY_ID, head_repository_id: reuse.REPOSITORY_ID, head_branch: 'master', head_sha: reuse.SOURCE } }] }
}
function executor({ head = qa, dirty = '', paths = '', ancestor = true } = {}) {
  return (_file, args) => { if (args[0] === 'rev-parse') return head; if (args[0] === 'status') return dirty; if (args[0] === 'merge-base') { assert.equal(args[2], reuse.SOURCE); if (!ancestor) throw Error('not an ancestor'); return '' }; if (args[0] === 'diff') return paths; assert.fail('Unexpected source operation') }
}
function manifest() {
  const identity = { schemaVersion: 1, product: 'KAMUCL', platform: 'darwin', version: '1.1.21', arch: 'arm64', sourceCommit: reuse.SOURCE, runtimeVersion: '44.3.0', minimumSystemVersion: '13.0.0', appAsarSHA256: reuse.ASAR, signing: 'ad-hoc; not Developer ID or notarized' }
  return { version: '1.1.21', arch: 'arm64', commit: reuse.SOURCE, runtimeVersion: '44.3.0', frameworkVersion: '44.3.0', minimum: '13.0.0', signing: identity.signing, packageIntegrity: true, nativeAcceptance: 'separate required native APP/DMG/game/tools/update jobs', appAsarSHA256: reuse.ASAR, buildIdentity: identity, buildIdentitySHA256: '63b0b6b8cce46ef7f5d6b170927e113fdf3a5ac5d7648dcd2b304eed8cfd7f86', assets: reuse.ASSETS }
}
function selections() {
  return [['auto', 'direct', true], ['auto', 'direct', false], ['direct', 'mirror', true], ['direct', 'mirror', false], ['mirror', 'auto', false]].map(([previous, target, expectedFailure], index) => {
    const options = [{ value: 'auto', label: '自动择优（直连与镜像）', disabled: false }, { value: 'direct', label: '仅 GitHub 直连', disabled: false }, { value: 'mirror', label: '仅镜像', disabled: false }]
    const char = target === 'auto' ? '自' : '仅', start = index * 1000 + 100, selected = expectedFailure ? previous : target
    const call = { index, patch: { updateSource: target }, startedAt: start + 21, completedAt: start + (expectedFailure ? 171 : 30), outcome: expectedFailure ? 'rejected' : 'resolved' }
    const snapshot = (value, id = 'update-source', sourceCalls = []) => ({ selected: value, persisted: value, popupOpen: false, busy: false, hidden: false, options, focus: { id, hasFocus: true, inSources: id === 'update-source' }, sourceCalls, native: { browserWindowFocused: false, webContentsFocused: false, visible: true, offscreen: true, debuggerAttached: true } })
    return {
      protocol: 'chromium-select-typeahead-v1', platform: 'darwin', previous, target, expectedFailure, startedAt: start, completedAt: start + 400, options,
      setup: { dispatches: ['keyDown', 'keyUp'].map((type, i) => ({ transport: 'Chromium CDP keyboard', type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, dispatchCompleted: true, startedAt: start + i, completedAt: start + i + 1 })), before: snapshot(previous), afterEscape: snapshot(previous), afterBlur: snapshot(previous, ''), beforeJump: snapshot(previous) },
      dispatches: [['keyDown', char], ['char', char], ['keyUp', char], ['keyDown', 'Enter'], ['keyUp', 'Enter']].map(([type, key], index) => ({ transport: 'Chromium CDP keyboard', type, key, code: index < 3 ? 'Unidentified' : 'Enter', windowsVirtualKeyCode: index < 3 ? 0 : 13, dispatchCompleted: true, startedAt: start + [15,20,200,210,220][index], completedAt: start + [16,21,201,211,221][index], ...(type === 'char' ? { text: char, unmodifiedText: char } : {}) })),
      keyEvents: [['keypress', char, 'update-source'], ['keyup', char, 'update-source'], ['keydown', 'Enter', 'update-source'], ['keyup', 'Enter', 'update-source']].map(([type, key, targetId], i) => ({ type, key, targetId, isTrusted: true, at: start + [20,200,210,220][i] })),
      focusEvents: ['blur', 'focus'].map((type, i) => ({ type, targetId: 'update-source', isTrusted: true, at: start + 5 + i })),
      observations: { beforeFocusSetup: snapshot(selected, 'update-source', [call]), beforeEnter: snapshot(selected, 'update-source', [call]), afterEnter: snapshot(selected, 'update-source', [call]) },
      events: [{ type: 'change', isTrusted: true, targetId: 'update-source', value: target, at: start + 21 }], invocations: [call],
      final: { selected, persisted: selected, busy: false, error: expectedFailure ? 'Controlled updateSource save failure after 150ms' : null, focus: { id: 'update-source', inSources: true } },
    }
  })
}
const row = matrixPlan()[0], expected = { version: '1.1.21', commit: reuse.SOURCE, electron: '44.3.0', rendererHashes: { 'index.html': 'b'.repeat(64) }, sourceHashes: { [row.script]: 'c'.repeat(64), 'scripts/qa-fixture-ui121.cjs': 'd'.repeat(64) } }
function proof() { return { complete: true, errors: [], classification: 'Actual offscreen native renderer with disposable fixture services', runtime: { platform: 'darwin', arch: 'arm64', electron: '44.3.0' }, configuration: { packageVersion: '1.1.21', pageZoom: 1, requestedTheme: 'dark', physicalViewport: { width: 960, height: 620 }, cssViewport: { width: 960, height: 620 }, controlledFailureDelayMs: 150 }, graphics: { policy: { platform: 'darwin', backend: 'platform-default', hardwareAcceleration: 'default', angle: 'default' }, featureStatus: { webgl: 'enabled' }, info: { gpuDevice: [] }, webgl: { created: true, renderer: 'contract sample' } }, rendererArtifacts: [{ file: '/owned/renderer/index.html', sha256: 'b'.repeat(64) }], inputReplacements: Array.from({ length: 4 }, () => ({ selection: { focused: true, value: 'old', start: 0, end: 3 }, emptyValue: '', value: 'new', expectedValue: 'new' })), sourceFiles: Object.entries(expected.sourceHashes).map(([file, sha256]) => ({ file, sha256 })), executionDriver: { sha256: expected.sourceHashes[row.script] }, sourceSelections: selections() } }

test('fixed parent failure authorizes only its unique successful original package and immutable artifact', () => {
  const result = reuse.validateOrigin(origin()); assert.equal(result.run.conclusion, 'failure'); assert.equal(result.packageJob.conclusion, 'success'); assert.equal(result.artifact.digest, reuse.ARTIFACT.digest)
  for (const mutate of [o => o.run.head_sha = qa, o => o.run.repository.full_name = 'foreign/KAMUCL', o => o.run.head_repository.id++, o => o.run.path = '.github/workflows/foreign.yml', o => o.run.event = 'push', o => o.run.run_attempt++, o => o.run.conclusion = 'success', o => o.jobs[0].conclusion = 'failure', o => o.jobs[0].head_sha = qa, o => o.jobs[0].id++, o => o.jobs.push({ ...o.jobs[0] }), o => o.artifacts[0].id++, o => o.artifacts[0].digest = 'sha256:' + '0'.repeat(64), o => o.artifacts[0].expired = true, o => o.artifacts[0].workflow_run.head_repository_id++, o => o.artifacts.push({ ...o.artifacts[0], expired: true })]) { const value = origin(); mutate(value); assert.throws(() => reuse.validateOrigin(value)) }
})
test('actual branch dispatch source is distinct from artifact and cannot be replaced by tag or foreign checkout', () => {
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: reuse.REPOSITORY, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_TYPE: 'branch', GITHUB_REF: 'refs/heads/master', GITHUB_SHA: qa }
  assert.doesNotThrow(() => reuse.validateWorkflowContext(env, qa))
  for (const patch of [{ GITHUB_REF_TYPE: 'tag', GITHUB_REF: 'refs/tags/v1.1.21' }, { GITHUB_REPOSITORY: 'foreign/KAMUCL' }, { GITHUB_SHA: 'short' }, { GITHUB_EVENT_NAME: 'push' }, { GITHUB_REF: 'refs/heads/wuhui' }]) assert.throws(() => reuse.validateWorkflowContext({ ...env, ...patch }, qa))
  assert.throws(() => reuse.validateWorkflowContext(env, 'b'.repeat(40)))
})
test('only seven explicit QA paths may differ; product/runtime/docs/old coordinator changes reject before execution', () => {
  const paths = [...reuse.ALLOWED]; assert.deepEqual(reuse.validateQaPaths(paths), paths)
  const result = reuse.proveReuseSource(qa, { execute: executor({ paths: paths.join('\0') + '\0' }) }); assert.equal(result.artifactSourceCommit, reuse.SOURCE); assert.equal(result.qaSourceCommit, qa)
  for (const file of ['src/main/core/download.ts', 'src/renderer/src/App.vue', 'native/mac/game.swift', 'package.json', 'package-lock.json', 'electron.vite.config.ts', 'docs/validation-1.1.21.md', '.github/workflows/mac-build.yml', 'scripts/verify-mac-batch121.cjs', 'AGENTS.md']) assert.throws(() => reuse.validateQaPaths([file]), /forbidden path/)
  assert.throws(() => reuse.validateQaPaths([paths[0], paths[0]]), /Duplicate/)
  assert.throws(() => reuse.proveReuseSource(qa, { execute: executor({ head: 'b'.repeat(40) }) }), /HEAD/)
  assert.throws(() => reuse.proveReuseSource(qa, { execute: executor({ dirty: ' M src/main/index.ts' }) }), /Tracked/)
  assert.throws(() => reuse.proveReuseSource(qa, { execute: executor({ ancestor: false }) }), /ancestor/)
})
test('raw original manifest retains artifact source and locked ABI; semantically similar or rebuilt bytes fail', () => {
  const bytes = Buffer.from(JSON.stringify(manifest(), null, 2)); assert.equal(hash(bytes), reuse.MANIFEST); assert.deepEqual(reuse.verifyManifest(bytes), manifest())
  for (const mutation of [m => m.commit = qa, m => m.buildIdentity.sourceCommit = qa, m => m.runtimeVersion = '43.0.0', m => m.appAsarSHA256 = '0'.repeat(64), m => m.assets[0].sha256 = '0'.repeat(64)]) { const changed = manifest(); mutation(changed); assert.throws(() => reuse.verifyManifest(Buffer.from(JSON.stringify(changed, null, 2))), /raw manifest/); }
  assert.throws(() => reuse.verifyManifest(Buffer.concat([bytes, Buffer.from('\n')])), /raw manifest/)
})
test('artifact-ids layout cannot silently select unrelated flat packages or a missing original asset', () => {
  const root = temporary()
  try { fs.writeFileSync(path.join(root, 'mac-package-arm64.json'), 'foreign'); assert.throws(() => reuse.originalPackageFiles(root), /ENOENT/); const dir = path.join(root, reuse.ARTIFACT.name); fs.mkdirSync(dir); for (const file of ['mac-package-arm64.json', ...reuse.ASSETS.map(a => a.name)]) fs.writeFileSync(path.join(dir, file), 'layout fixture only'); assert.equal(reuse.originalPackageFiles(root).manifest, path.join(dir, 'mac-package-arm64.json')); fs.unlinkSync(path.join(dir, reuse.ASSETS[1].name)); assert.throws(() => reuse.originalPackageFiles(root), /ENOENT/); }
  finally { cleanup(root) }
})
test('actual ASAR renderer extraction copies every original byte and refuses a previous renderer', async () => {
  const root = temporary()
  try { const source = path.join(root, 'source/out/renderer'); fs.mkdirSync(path.join(source, 'assets'), { recursive: true }); fs.writeFileSync(path.join(source, 'index.html'), '<original renderer>'); fs.writeFileSync(path.join(source, 'assets/app.js'), 'original-script'); fs.writeFileSync(path.join(source, 'assets/texture.bin'), Buffer.from([0, 1, 255])); const archive = path.join(root, 'fixture.asar'); await asar.createPackage(path.join(root, 'source'), archive); const target = path.join(root, 'copied'); const result = reuse.extractPackagedRenderer(asar, archive, target); assert.equal(result.length, 3); for (const record of result) assert(fs.readFileSync(record.file).equals(fs.readFileSync(path.join(source, record.relative)))); assert.throws(() => reuse.extractPackagedRenderer(asar, archive, target), /Never overwrite/); }
  finally { cleanup(root) }
})
test('unsafe, linked, unpacked, colliding or incomplete renderer archives reject without building', () => {
  const root = temporary()
  try { for (const [entries, stats] of [[['/out/renderer/../escape'], {}], [['/out/renderer/index.html'], { link: 'foreign' }], [['/out/renderer/index.html'], { unpacked: true }], [['/out/renderer/index.html', '/out/renderer/INDEX.HTML'], {}], [['/out/renderer/assets/app.js'], {}]]) { const fake = { listPackage: () => entries, statFile: () => stats, extractFile: () => Buffer.from('fixture') }; assert.throws(() => reuse.extractPackagedRenderer(fake, 'fixture', path.join(root, 'target'))); assert.equal(fs.existsSync(path.join(root, 'target')), false); } }
  finally { cleanup(root) }
})
test('source selection qualifies only actual trusted change, one completed patch and paired native dispatches', () => {
  assert.doesNotThrow(() => reuse.validateSourceSelections(selections()))
  for (const mutate of [r => r.pop(), r => r[0].events[0].isTrusted = false, r => r[0].events[0].value = 'mirror', r => r[0].events[0].targetId = 'foreign', r => r[0].dispatches.pop(), r => r[0].dispatches[4].type = 'keyDown', r => r[0].dispatches[3].dispatchCompleted = false, r => r[0].dispatches[3].transport = 'DOM setter', r => r[0].invocations = [], r => r[0].invocations.push({ ...r[0].invocations[0] }), r => r[0].invocations[0].completedAt = undefined, r => r[0].invocations[0].patch = { updateSource: 'mirror' }, r => r[0].invocations[0].outcome = 'resolved', r => r[0].final.busy = true, r => r[0].final.error = undefined, r => r[0].final.focus.id = '', r => r[0].final.persisted = 'direct', r => r[1].final.persisted = 'auto', r => r[1].invocations[0].index = 0]) { const value = selections(); mutate(value); assert.throws(() => reuse.validateSourceSelections(value)) }
})
test('Darwin collapsed picker route retains actual options, unchanged setup, trusted key receipt and native context', () => {
  assert.doesNotThrow(() => reuse.validateSourceSelections(selections()))
  const invalid = [
    r => r[0].protocol = 'arrow-dispatch-only', r => r[0].platform = 'win32', r => r[0].options.reverse(),
    r => r[0].options[1].disabled = true, r => r[0].options[1].label = '自动重复前缀',
    r => r[0].setup.dispatches.pop(), r => r[0].setup.dispatches[1].key = 'Enter', r => r[0].setup.dispatches[1].dispatchCompleted = false,
    r => r[0].setup.before.sourceCalls.push({ patch: { updateSource: 'direct' } }), r => r[0].setup.afterEscape.selected = 'direct',
    r => r[0].setup.afterBlur.popupOpen = true, r => r[0].setup.afterBlur.focus.id = 'update-source',
    r => r[0].setup.beforeJump.focus.hasFocus = false, r => r[0].setup.beforeJump.native.offscreen = false, r => delete r[0].setup.beforeJump.native.visible,
    r => r[0].focusEvents = [], r => r[0].focusEvents[0].isTrusted = false,
    r => r[0].dispatches[1].text = '自', r => r[0].dispatches[2].windowsVirtualKeyCode = 40,
    r => r[0].keyEvents = [], r => r[0].keyEvents[0].isTrusted = false, r => r[0].keyEvents[0].targetId = 'foreign',
    r => r[0].keyEvents[1].type = 'keydown', r => r[0].keyEvents[1].targetId = 'foreign', r => r[0].keyEvents[2].targetId = 'foreign', r => r[0].keyEvents[3].targetId = 'foreign',
    r => r[0].dispatches[2].startedAt = r[0].invocations[0].completedAt - 1, r => r[0].dispatches[1].completedAt = undefined,
    r => r[0].events[0].at = r[0].startedAt - 1, r => r[0].events[0].at = r[0].dispatches[1].startedAt - 1,
    r => r[0].events[0].at = r[0].invocations[0].startedAt + 1, r => r[0].events.push({ ...r[0].events[0] }),
    r => r[0].invocations[0].startedAt = r[0].dispatches[1].startedAt - 1,
    r => r[0].invocations[0].completedAt = r[0].invocations[0].startedAt + 149,
    r => r[0].keyEvents.reverse(), r => r[0].keyEvents[3].at = r[0].completedAt + 1,
    r => r[0].observations.beforeFocusSetup.focus.id = '', r => r[0].observations.successFocusSetup = 'QA repaired failed product focus',
    r => r[0].observations.beforeEnter.popupOpen = true, r => r[0].observations.beforeEnter.busy = true, r => r[0].observations.afterEnter.sourceCalls = [],
    r => r[0].observations.beforeEnter.persisted = 'direct', r => r[0].completedAt = undefined,
  ]
  for (const mutate of invalid) { const rows = structuredClone(selections()); mutate(rows); assert.throws(() => reuse.validateSourceSelections(rows)) }
  const success = structuredClone(selections()); success[1].observations.beforeFocusSetup.focus.id = ''; success[1].observations.successFocusSetup = 'QA select focus after successful disabled save'; assert.doesNotThrow(() => reuse.validateSourceSelections(success))
})
test('additive proof gate keeps old graphics/selection/renderer gates and rejects stale or missing new source protocol', () => {
  assert.doesNotThrow(() => reuse.validateReuseProof(proof(), row, expected))
  for (const mutate of [p => p.complete = false, p => p.graphics.webgl.created = false, p => p.inputReplacements[0].selection.end = 2, p => p.rendererArtifacts[0].sha256 = '0'.repeat(64), p => p.sourceFiles.pop(), p => p.sourceFiles[0].sha256 = '0'.repeat(64), p => p.configuration.controlledFailureDelayMs = 0, p => p.sourceSelections = undefined, p => p.sourceSelections[0].invocations = []]) { const value = proof(); mutate(value); assert.throws(() => reuse.validateReuseProof(value, row, expected)) }
})
test('nonzero child with complete proof preserves original stdout/stderr/proof and cannot qualify', async () => {
  const root = temporary(); const out = path.join(root, 'out'); fs.mkdirSync(out)
  try { const attempt = await reuse.runAttempt(row, { out, receiptRoot: root, number: 1, electron: 'owned', env: {}, expected, guard: () => {}, execute: (_exe, _args, options) => { assert.equal(options.timeout, 180000); const dir = path.join(out, row.prefix + 'original-failure'); fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'proof.json'), JSON.stringify(proof())); return { status: 17, signal: null, stdout: 'original stdout\n', stderr: 'original stderr\n' } } }); assert.equal(attempt.complete, false); assert.equal(attempt.exit.status, 17); assert.equal(attempt.proofs.length, 1); assert.equal(fs.readFileSync(path.join(root, 'attempt-1.stdout.log'), 'utf8'), 'original stdout\n'); assert.equal(fs.readFileSync(path.join(root, 'attempt-1.stderr.log'), 'utf8'), 'original stderr\n'); assert.equal(JSON.parse(fs.readFileSync(attempt.proofs[0].file)).complete, true); }
  finally { cleanup(root) }
})
test('missing, malformed and multiple new proof roots preserve evidence and reject instead of choosing latest', async () => {
  for (const mode of ['missing', 'malformed', 'foreign']) { const root = temporary(), out = path.join(root, 'out'); fs.mkdirSync(out); try { const attempt = await reuse.runAttempt(row, { out, receiptRoot: root, number: 2, electron: 'owned', env: {}, expected, guard: () => {}, execute: () => { if (mode !== 'missing') { const dir = path.join(out, row.prefix + 'first'); fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'proof.json'), mode === 'malformed' ? '{original broken' : JSON.stringify(proof())); if (mode === 'foreign') fs.mkdirSync(path.join(out, row.prefix + 'second')); } return { status: 0, signal: null, stdout: 'original', stderr: '' } } }); assert.equal(attempt.complete, false); assert(fs.existsSync(path.join(root, 'attempt-2.failure.log'))); if (mode === 'malformed') assert.equal(fs.readFileSync(path.join(attempt.evidenceRoots[0], 'proof.json'), 'utf8'), '{original broken'); }
    finally { cleanup(root) } }
})
test('timed-out native child cannot qualify even with reported zero exit and complete proof', async () => {
  const root = temporary(), out = path.join(root, 'out'); fs.mkdirSync(out)
  try { const attempt = await reuse.runAttempt(row, { out, receiptRoot: root, number: 3, electron: 'owned', env: {}, expected, guard: () => {}, execute: () => ({ status: 0, signal: 'SIGTERM', stdout: 'before timeout', stderr: '', error: Object.assign(Error('180s elapsed'), { code: 'ETIMEDOUT' }) }) }); assert.equal(attempt.complete, false); assert.equal(attempt.exit.error.code, 'ETIMEDOUT'); }
  finally { cleanup(root) }
})
test('zero-exit attempt requires every original screenshot, readable renderer bytes and post-run freeze guard', async () => {
  const png = await require('sharp')({ create: { width: 2, height: 2, channels: 4, background: '#102030' } }).png().toBuffer()
  for (const mode of ['valid', 'missing', 'truncated', 'changed-renderer', 'changed-source']) {
    const root = temporary(), out = path.join(root, 'out'); fs.mkdirSync(out); let guardCalls = 0
    try {
      const rendererBytes = Buffer.from('original renderer test'), localExpected = { ...expected, rendererHashes: { 'index.html': hash(rendererBytes) } }
      const attempt = await reuse.runAttempt(row, { out, receiptRoot: root, number: 4, electron: 'owned', env: {}, expected: localExpected, guard: () => { if (++guardCalls === 2 && mode === 'changed-source') throw Error('Frozen QA source changed') }, execute: () => {
        const dir = path.join(out, row.prefix + 'readback'), renderer = path.join(dir, 'renderer'); fs.mkdirSync(renderer, { recursive: true }); const file = path.join(renderer, 'index.html'); fs.writeFileSync(file, mode === 'changed-renderer' ? 'foreign bytes' : rendererBytes)
        const actual = proof(); actual.rendererArtifacts = [{ file, sha256: hash(rendererBytes) }]; fs.writeFileSync(path.join(dir, 'proof.json'), JSON.stringify(actual))
        for (const name of reuse.APPEARANCE_PNG) if (!(mode === 'missing' && name === 'failed-apply.png')) fs.writeFileSync(path.join(dir, name), mode === 'truncated' && name === 'failed-apply.png' ? png.subarray(0, 30) : png)
        return { status: 0, signal: null, stdout: 'actual zero exit', stderr: '' }
      } })
      assert.equal(attempt.complete, mode === 'valid'); assert.equal(attempt.exit.status, 0); assert.equal(attempt.proofs.length, 1)
      if (mode === 'valid') { assert.equal(attempt.screenshots.length, 26); assert(attempt.screenshots.every(image => image.width === 2 && image.height === 2)); assert.equal(guardCalls, 2) }
      else assert(fs.existsSync(path.join(root, 'attempt-4.failure.log')))
    } finally { cleanup(root) }
  }
})
test('successful smoke is additional and cannot substitute skipped, duplicate, wrong-order or failed matrix rows', () => {
  const receipt = { smoke: { complete: true }, attempts: matrixPlan().map(row => ({ ...row, complete: true, exit: { status: 0, signal: null } })) }; assert.doesNotThrow(() => reuse.assertMatrixComplete(receipt))
  for (const mutate of [r => r.smoke.complete = false, r => r.attempts.pop(), r => r.attempts[0].complete = false, r => r.attempts[0].exit.status = 1, r => r.attempts[0] = r.attempts[1], r => r.attempts.reverse()]) { const value = structuredClone(receipt); mutate(value); assert.throws(() => reuse.assertMatrixComplete(value)) }
})
test('foreign native host leaves an original false reuse receipt with eighteen unexecuted rows', () => {
  if (process.platform === 'darwin') return
  const root = temporary()
  try { const result = spawnSync(process.execPath, [path.resolve(__dirname, 'verify-mac-batch121-reuse.cjs')], { cwd: root, encoding: 'utf8' }); assert.equal(result.status, 1); const folders = fs.readdirSync(path.join(root, 'out')); assert.equal(folders.length, 1); const receipt = JSON.parse(fs.readFileSync(path.join(root, 'out', folders[0], 'receipt.json'))); assert.equal(receipt.complete, false); assert.equal(receipt.primaryFullNativeAcceptance, false); assert.equal(receipt.attempts.length, 18); assert(receipt.attempts.every(row => row.complete === false && row.executed === false)); assert.match(receipt.error.message, /native macOS/); }
  finally { cleanup(root) }
})
test('reuse workflow downloads only immutable artifact, retains failures and never builds or dispatches original qualification', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/mac-batch121-reuse.yml'), 'utf8')
  assert.match(workflow, /artifact-ids: 11568754732/); assert.match(workflow, /run-id: 37820579554/); assert.match(workflow, /reuse\.validateOrigin\(origin\)/); assert.match(workflow, /fetch-depth: 0/); assert.match(workflow, /if: always\(\)/)
  for (const forbidden of ['npm run build', 'pack-mac', 'continue-on-error', 'verify-mac-job.cjs', 'refs/tags/', 'git push']) assert(!workflow.includes(forbidden), 'Forbidden replacement or acceptance bypass: ' + forbidden)
  for (const evidence of ['artifact-origin121-reuse.json', 'reuse-contracts.log', 'receipt.json', '*.log', 'proof.json', '*.png']) assert(workflow.includes(evidence), 'Original evidence upload omitted: ' + evidence)
  assert.equal(matrixPlan().length, 18); assert.equal(reuse.APPEARANCE_PNG.length, 26)
})
