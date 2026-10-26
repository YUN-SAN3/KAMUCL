// QA-only reuse of one immutable native package. This never rebuilds or qualifies all Mac features.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { execFileSync, spawnSync } = require('node:child_process')
const { assertNativeHost, matrixPlan, validateManifest, rendererHashMap, validateProof } = require('./verify-mac-batch121.cjs')
const fixture = require('./qa-fixture-ui121.cjs')
const { readMacPackageIdentity } = require('./mac-package-identity.cjs')

const REPOSITORY = 'kamubaba-i/KAMUCL', REPOSITORY_ID = 1359309072
const SOURCE = '8e29307b0eefa95d12dea948fab2002b7807854b', RUN = 37820579554, PACKAGE_JOB = 113460274229
const ARTIFACT = { id: 11568754732, name: 'mac-packages-arm64', size_in_bytes: 260027091, digest: 'sha256:c1113626d40d6ce3af75ac1c4d14d55685e51526da2a9e202b6fb98fed2009ca' }
const MANIFEST = 'd08f11007cfe20caa4d7cb6f4f4da7c8113623918f1356a5b908ed4c10ad7cec'
const ASAR = '75981e1837d06425234c1279db65e499174fd7898be2bf24c978f7aec1964196'
const ASSETS = [
  { name: 'KAMUCL-1.1.21-mac-arm64.zip', bytes: 125954202, sha256: 'a4930cc3a722b9308ee7df18b9f97484419306a0782257ef821b1bcd30b27579' },
  { name: 'KAMUCL-1.1.21-mac-arm64.dmg', bytes: 135777009, sha256: '36969f1095a211cfede974b34fe0884a4119a6f019095b960ee57861108c07a5' }
]
const ALLOWED = new Set(['.github/workflows/mac-batch121-reuse.yml', 'scripts/verify-mac-batch121-reuse.cjs', 'scripts/verify-mac-batch121-reuse-tests.cjs', 'scripts/verify-appearance-121-ui.cjs', 'scripts/qa-fixture-ui121.cjs', 'scripts/qa-fixture-ui121-tests.cjs', 'tests/all.test.ts'])
const APPEARANCE_PNG = ['after-apply', 'editor-100', 'editor-fit', 'failed-apply', 'fixture', 'mirror-list', 'normal', 'opacity-0', 'opacity-100', 'server-detail-resolved', 'server-detail-unknown', 'server-list', 'server-metadata-resolved', 'server-metadata-unknown', 'update-add-failed', 'update-auto-restored', 'update-auto', 'update-direct-failed', 'update-direct', 'update-duplicate', 'update-invalid', 'update-legacy-remove-failed', 'update-mirror-failed', 'update-mirror', 'update-remove-failed', 'update-removed'].map(name => name + '.png')
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const fingerprint = file => ({ file: path.resolve(file), bytes: fs.statSync(file).size, sha256: sha(fs.readFileSync(file)) })
const relative = file => path.relative(process.cwd(), path.resolve(file)).split(path.sep).join('/')
function regular(file) { const stat = fs.lstatSync(file); assert(stat.isFile() && !stat.isSymbolicLink(), 'Original regular file required: ' + file); return stat }

function validateWorkflowContext(env, actualHead) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Use the owned disposable CI runner')
  assert.equal(env.GITHUB_REPOSITORY, REPOSITORY, 'Foreign repository cannot reuse this package')
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch', 'Reuse requires the separately authorized dispatch')
  assert.equal(env.GITHUB_REF_TYPE, 'branch', 'A tag must not masquerade as a new QA source')
  assert.equal(env.GITHUB_REF, 'refs/heads/master', 'Use the authorized master QA source')
  assert.match(env.GITHUB_SHA, /^[a-f0-9]{40}$/)
  assert.equal(actualHead, env.GITHUB_SHA, 'Actual QA checkout must match GITHUB_SHA')
}
function validateQaPaths(paths) {
  assert.equal(new Set(paths).size, paths.length, 'Duplicate QA diff paths')
  for (const file of paths) assert(ALLOWED.has(file), 'Original production package differs at forbidden path: ' + file)
  return paths
}
function proveReuseSource(qaSourceCommit, { execute = execFileSync } = {}) {
  assert.match(qaSourceCommit, /^[a-f0-9]{40}$/)
  const git = args => execute('git', args, { encoding: 'utf8', windowsHide: true }).trim()
  assert.equal(git(['rev-parse', 'HEAD']), qaSourceCommit, 'QA HEAD changed')
  assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '', 'Tracked checkout must remain unchanged')
  git(['merge-base', '--is-ancestor', SOURCE, qaSourceCommit])
  const changedPaths = validateQaPaths(git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', SOURCE, qaSourceCommit]).split('\0').filter(Boolean))
  return { artifactSourceCommit: SOURCE, qaSourceCommit, changedPaths, allowedQaPaths: [...ALLOWED], scope: 'All other Git-tracked bytes and modes, including product/version/lock/runtime/native, remain unchanged; distinct QA source, not a rebuilt package' }
}
function validateOrigin(origin) {
  const { run, jobs, artifacts } = origin
  assert.equal(run.id, RUN); assert.equal(run.head_sha, SOURCE); assert.equal(run.head_branch, 'master')
  assert.equal(run.event, 'workflow_dispatch'); assert.equal(run.path, '.github/workflows/mac-build.yml'); assert.equal(run.run_attempt, 1)
  for (const repo of [run.repository, run.head_repository]) { assert.equal(repo?.full_name, REPOSITORY); assert.equal(repo.id, REPOSITORY_ID) }
  assert.equal(run.status, 'completed'); assert.equal(run.conclusion, 'failure', 'Preserve the original parent failure; package success is separate')
  const packageJobs = jobs.filter(job => job.name === 'package (macos-26, arm64)')
  assert.equal(packageJobs.length, 1, 'One original package job required')
  const job = packageJobs[0]
  assert.equal(job.id, PACKAGE_JOB); assert.equal(job.run_id, RUN); assert.equal(job.run_attempt, 1); assert.equal(job.head_sha, SOURCE)
  assert.equal(job.status, 'completed'); assert.equal(job.conclusion, 'success')
  const matches = artifacts.filter(artifact => artifact.name === ARTIFACT.name)
  assert.equal(matches.length, 1, 'Exactly one original named artifact required, including expired duplicates')
  const artifact = matches[0]
  for (const [field, value] of Object.entries(ARTIFACT)) assert.equal(artifact[field], value, 'Original artifact ' + field + ' changed')
  assert.equal(artifact.expired, false)
  for (const [field, value] of Object.entries({ id: RUN, repository_id: REPOSITORY_ID, head_repository_id: REPOSITORY_ID, head_branch: 'master', head_sha: SOURCE })) assert.equal(artifact.workflow_run?.[field], value)
  return { run, packageJob: job, artifact }
}
function verifyManifest(bytes) {
  assert.equal(sha(bytes), MANIFEST, 'Exact original raw manifest SHA256 required')
  const manifest = JSON.parse(bytes.toString('utf8'))
  // The existing same-source contract is unchanged: expected.commit is the original artifact source.
  validateManifest(manifest, { version: '1.1.21', commit: SOURCE, electron: '44.3.0' })
  assert.equal(manifest.frameworkVersion, '44.3.0'); assert.equal(manifest.minimum, '13.0.0')
  assert.equal(manifest.appAsarSHA256, ASAR); assert.equal(manifest.buildIdentity.appAsarSHA256, ASAR)
  assert.deepEqual(manifest.assets, ASSETS)
  return manifest
}
function originalPackageFiles(release = path.resolve('release')) {
  const directory = path.join(release, ARTIFACT.name), stat = fs.lstatSync(directory)
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Original artifact-ids directory required')
  const files = { directory, manifest: path.join(directory, 'mac-package-arm64.json'), zip: path.join(directory, ASSETS[0].name), dmg: path.join(directory, ASSETS[1].name) }
  for (const key of ['manifest', 'zip', 'dmg']) regular(files[key])
  return files
}
async function fileSHA(file) { const hash = crypto.createHash('sha256'); for await (const bytes of fs.createReadStream(file)) hash.update(bytes); return hash.digest('hex') }

function extractPackagedRenderer(asar, archive, destination) {
  assert(!fs.existsSync(destination), 'Never overwrite an existing renderer or mix prior build bytes')
  const entries = asar.listPackage(archive).map(name => name.replace(/\\/g, '/')).filter(name => name.startsWith('/out/renderer/'))
  const files = [], seen = new Set()
  for (const entry of entries) {
    const archiveName = entry.slice(1).split('/').join(path.sep)
    const stat = asar.statFile(archive, archiveName, false)
    assert(!stat.link && !stat.unpacked, 'Renderer entry must be original packed bytes: ' + entry)
    if (stat.files) continue
    const name = entry.slice('/out/renderer/'.length)
    assert(name && name.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe renderer archive path')
    assert(!seen.has(name.toLowerCase()), 'Duplicate/colliding renderer archive path'); seen.add(name.toLowerCase())
    files.push({ name, bytes: asar.extractFile(archive, archiveName) })
  }
  assert(files.some(file => file.name === 'index.html'), 'Original renderer index must exist')
  assert(files.some(file => /^assets\/.+\.(js|css)$/.test(file.name)), 'Original renderer assets must exist')
  fs.mkdirSync(destination, { recursive: true })
  return files.map(({ name, bytes }) => {
    const file = path.resolve(destination, name); assert(file.startsWith(path.resolve(destination) + path.sep))
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes, { flag: 'wx' })
    const result = fingerprint(file); assert.equal(result.sha256, sha(bytes)); assert.equal(result.bytes, bytes.length)
    return { relative: name, ...result }
  }).sort((a, b) => a.relative.localeCompare(b.relative))
}
function validateNativeSourceProtocol(row) {
  assert.equal(row.protocol, 'chromium-select-typeahead-v1', 'Native source protocol must name the actual collapsed Chromium text-key route')
  assert.deepEqual(row.options?.map(option => option.value), ['auto', 'direct', 'mirror'])
  assert(row.options.every(option => typeof option.label === 'string' && option.label.trim() && option.disabled === false))
  const char = Array.from(row.options.find(option => option.value === row.target).label.trim())[0]
  const previousIndex = row.options.findIndex(option => option.value === row.previous)
  assert(previousIndex >= 0)
  const ordered = [...row.options.slice(previousIndex + 1), ...row.options.slice(0, previousIndex + 1)]
  assert.equal(ordered.find(option => option.label.trim().startsWith(char))?.value, row.target, 'One real prefix must select the target without saving an intermediate option')
  assert(Number.isFinite(row.startedAt) && Number.isFinite(row.completedAt) && row.completedAt >= row.startedAt)
  const snapshot = state => {
    assert.equal(typeof state.popupOpen, 'boolean'); assert.equal(typeof state.busy, 'boolean'); assert.equal(typeof state.hidden, 'boolean')
    assert.equal(typeof state.focus.id, 'string'); assert.equal(typeof state.focus.hasFocus, 'boolean')
    for (const key of ['browserWindowFocused', 'webContentsFocused', 'visible', 'offscreen', 'debuggerAttached']) assert.equal(typeof state.native[key], 'boolean', 'Retain actual native focus/window context: ' + key)
    assert.equal(state.native.offscreen, true, 'Keep the offscreen fixture classification explicit')
    assert.deepEqual(state.options, row.options)
  }
  assert.equal(row.setup.dispatches.length, 2)
  for (const [index, type] of ['keyDown', 'keyUp'].entries()) {
    const event = row.setup.dispatches[index]
    assert.equal(event.transport, 'Chromium CDP keyboard'); assert.equal(event.type, type); assert.equal(event.key, 'Escape')
    assert.equal(event.code, 'Escape'); assert.equal(event.windowsVirtualKeyCode, 27); assert.equal(event.dispatchCompleted, true)
    assert(Number.isFinite(event.startedAt) && Number.isFinite(event.completedAt) && event.completedAt >= event.startedAt && event.startedAt >= row.startedAt && event.completedAt <= row.completedAt)
  }
  for (const phase of ['before', 'afterEscape', 'afterBlur', 'beforeJump']) {
    const state = row.setup[phase]; snapshot(state)
    assert.equal(state.selected, row.previous); assert.equal(state.persisted, row.previous); assert.equal(state.busy, false)
    assert.deepEqual(state.sourceCalls, [], 'Escape and blur/focus setup must not consume any settings transaction')
  }
  assert.notEqual(row.setup.afterBlur.focus.id, 'update-source'); assert.equal(row.setup.afterBlur.popupOpen, false)
  assert.equal(row.setup.beforeJump.popupOpen, false); assert.equal(row.setup.beforeJump.focus.id, 'update-source')
  assert.equal(row.setup.beforeJump.focus.hasFocus, true); assert.equal(row.setup.beforeJump.native.debuggerAttached, true)
  const freshFocus = event => event.isTrusted === true && event.targetId === 'update-source' && Number.isFinite(event.at) && event.at >= row.startedAt && event.at <= row.completedAt
  const blurIndex = row.focusEvents.findIndex(event => event.type === 'blur' && freshFocus(event))
  assert(blurIndex >= 0 && row.focusEvents.slice(blurIndex + 1).some(event => event.type === 'focus' && freshFocus(event)), 'Actual UA blur then focus reset must be retained; this is not physical OS focus')
  const expected = [['keyDown', char], ['char', char], ['keyUp', char], ['keyDown', 'Enter'], ['keyUp', 'Enter']]
  assert.equal(row.dispatches.length, expected.length, 'Printable Chromium keyDown/char/keyUp plus Enter down/up are all required')
  expected.forEach(([type, key], index) => {
    const event = row.dispatches[index]
    assert.equal(event.transport, 'Chromium CDP keyboard'); assert.equal(event.type, type); assert.equal(event.key, key); assert.equal(event.dispatchCompleted, true)
    assert.equal(event.code, index < 3 ? 'Unidentified' : 'Enter'); assert.equal(event.windowsVirtualKeyCode, index < 3 ? 0 : 13)
    assert(Number.isFinite(event.startedAt) && Number.isFinite(event.completedAt) && event.completedAt >= event.startedAt && event.startedAt >= row.startedAt && event.completedAt <= row.completedAt)
    if (index) assert(event.startedAt >= row.dispatches[index - 1].completedAt, 'Actual target dispatch order must be retained')
    if (type === 'char') { assert.equal(event.text, char); assert.equal(event.unmodifiedText, char) }
  })
  let last = -1, at = row.startedAt
  for (const [type, key, targetRequired] of [['keypress', char, true], ['keyup', char, true], ['keydown', 'Enter', true], ['keyup', 'Enter', true]]) {
    const index = row.keyEvents.findIndex((event, index) => index > last && event.type === type && event.key === key && event.isTrusted === true && (!targetRequired || event.targetId === 'update-source') && Number.isFinite(event.at) && event.at >= at && event.at <= row.completedAt)
    assert(index >= 0, 'Retain ordered actual Chromium received keys, distinct from dispatch completion: ' + type + '/' + key)
    last = index; at = row.keyEvents[index].at
  }
  const expectedValue = row.expectedFailure ? row.previous : row.target
  for (const phase of ['beforeFocusSetup', 'beforeEnter', 'afterEnter']) {
    const state = row.observations[phase]; snapshot(state)
    assert.equal(state.busy, false); assert.equal(state.selected, expectedValue); assert.equal(state.persisted, expectedValue)
    assert.deepEqual(state.sourceCalls, row.invocations, 'Enter or QA focus setup cannot consume another settings invocation')
  }
  if (row.expectedFailure) {
    assert.equal(row.observations.beforeFocusSetup.focus.id, 'update-source', 'Product failed-save focus must be observed before any success-only QA focus setup')
    assert.equal(row.observations.beforeFocusSetup.focus.inSources, true)
    assert.equal(row.observations.successFocusSetup, undefined)
  }
  assert.equal(row.observations.beforeEnter.focus.id, 'update-source'); assert.equal(row.observations.beforeEnter.focus.hasFocus, true)
  assert.equal(row.observations.beforeEnter.popupOpen, false); assert.equal(row.observations.afterEnter.popupOpen, false)
}
function validateSourceSelections(rows, platform = 'darwin') {
  assert.equal(platform, 'darwin')
  assert.equal(rows?.length, 5, 'Five actual source selection transactions required')
  const expected = [['auto', 'direct', true], ['auto', 'direct', false], ['direct', 'mirror', true], ['direct', 'mirror', false], ['mirror', 'auto', false]], indexes = new Set()
  rows.forEach((row, index) => {
    const [previous, target, failed] = expected[index]
    assert.equal(row.platform, platform); assert.equal(row.previous, previous); assert.equal(row.target, target); assert.equal(row.expectedFailure, failed)
    assert.deepEqual(row.options, rows[0].options, 'The same actual unchanged source options must be used by all five transactions')
    validateNativeSourceProtocol(row)
    const changes = row.events.filter(event => event.type === 'change' && event.isTrusted === true)
    assert.equal(changes.length, 1, 'Exactly one actual trusted target change is required; dispatch completion is not receiver acknowledgement')
    const change = changes[0]; assert.equal(change.targetId, 'update-source'); assert.equal(change.value, target); assert(Number.isFinite(change.at))
    assert.equal(row.invocations.length, 1, 'Idle or a selected value cannot replace the actual one settings patch invocation')
    const call = row.invocations[0]; assert(Number.isSafeInteger(call.index) && !indexes.has(call.index)); indexes.add(call.index)
    assert.deepEqual(call.patch, { updateSource: target }); assert(Number.isFinite(call.startedAt) && Number.isFinite(call.completedAt) && call.completedAt >= call.startedAt)
    assert(call.startedAt >= row.startedAt && call.completedAt <= row.completedAt)
    const charStartedAt = row.dispatches[1].startedAt
    assert(change.at >= row.startedAt && change.at >= charStartedAt && change.at <= call.startedAt, 'Trusted change must belong to this actual character and precede its actual settings invocation')
    assert(call.startedAt >= charStartedAt)
    if (failed) assert(call.completedAt - call.startedAt >= 150, 'The controlled failed save must retain its real 150ms asynchronous interval')
    assert(row.dispatches[2].startedAt >= call.completedAt, 'Real Unicode key release must follow completion of the actual target save')
    assert.equal(call.outcome, failed ? 'rejected' : 'resolved'); assert.equal(row.final.busy, false)
    assert.equal(row.final.selected, failed ? previous : target); assert.equal(row.final.persisted, failed ? previous : target)
    if (failed) { assert(row.final.error?.includes('Controlled updateSource save failure')); assert.equal(row.final.focus.id, 'update-source'); assert.equal(row.final.focus.inSources, true) }
  })
}
function validateReuseProof(proof, row, expected) {
  validateProof(proof, row, expected)
  assert(proof.sourceFiles?.length, 'Source fingerprints cannot be omitted')
  for (const item of proof.sourceFiles) { const key = relative(item.file); assert.equal(item.sha256, expected.sourceHashes[key], 'Foreign or changed proof source: ' + key) }
  for (const file of [row.script, 'scripts/qa-fixture-ui121.cjs']) assert(proof.sourceFiles.some(item => relative(item.file) === file), 'Required driver/helper provenance missing')
  if (row.kind === 'appearance') {
    assert.equal(proof.executionDriver?.sha256, expected.sourceHashes[row.script]); assert.equal(proof.configuration.controlledFailureDelayMs, 150)
    validateSourceSelections(proof.sourceSelections, proof.runtime.platform)
    assert.equal(typeof fixture.validateSourceSelection, 'function', 'Reviewed native selection contract required')
    for (const selection of proof.sourceSelections) fixture.validateSourceSelection(selection)
  }
}
function evidenceRootNames(out, row, before) { return fs.readdirSync(out).filter(name => name.startsWith(row.prefix) && !before.has(name)) }
async function runAttempt(row, { out, receiptRoot, number, electron, env, expected, guard, execute = spawnSync, validate = validateReuseProof }) {
  const attempt = { ...row, complete: false, startedAt: new Date().toISOString(), timeoutMs: 180000, exit: null }, before = new Set(fs.readdirSync(out))
  const log = path.join(receiptRoot, `attempt-${number}`)
  try {
    guard(); const result = execute(electron, [row.script, ...row.args], { env, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 })
    fs.writeFileSync(log + '.stdout.log', result.stdout ?? ''); fs.writeFileSync(log + '.stderr.log', result.stderr ?? '')
    attempt.exit = { status: result.status ?? null, signal: result.signal ?? null, error: result.error ? { name: result.error.name, code: result.error.code, message: result.error.message } : null }
    attempt.evidenceRoots = evidenceRootNames(out, row, before).map(name => path.resolve(out, name))
    const proofFiles = attempt.evidenceRoots.map(root => path.join(root, 'proof.json')).filter(file => fs.existsSync(file))
    attempt.proofs = proofFiles.map(fingerprint)
    assert.equal(result.status, 0, 'Actual child exit must be zero; a complete proof cannot override a failed child')
    assert.equal(result.signal ?? null, null); assert(!result.error, 'Timed-out/failed child cannot qualify')
    assert.equal(attempt.evidenceRoots.length, 1, 'One new owned evidence root required; never choose the latest foreign root')
    assert.equal(proofFiles.length, 1, 'Original proof must remain available')
    const proof = read(proofFiles[0]); validate(proof, row, expected)
    for (const item of proof.rendererArtifacts ?? proof.rendererFiles) { regular(item.file); assert(path.resolve(item.file).startsWith(attempt.evidenceRoots[0] + path.sep), 'Renderer evidence must belong to this child'); assert.equal(await fileSHA(item.file), item.sha256) }
    const names = fs.readdirSync(attempt.evidenceRoots[0]).filter(name => name.endsWith('.png'))
    if (row.kind === 'appearance') for (const name of APPEARANCE_PNG) assert(names.includes(name), 'Original required screenshot omitted: ' + name)
    else assert(names.length >= 30, 'Retain all original community screenshot gates')
    attempt.screenshots = []
    for (const name of names.sort()) {
      const file = path.join(attempt.evidenceRoots[0], name), bytes = fs.readFileSync(file); regular(file)
      assert(bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'Actual nonempty PNG required')
      const decoded = await require('sharp')(bytes).raw().toBuffer({ resolveWithObject: true })
      assert(decoded.info.width > 0 && decoded.info.height > 0 && decoded.data.length > 0, 'Original PNG must fully decode')
      attempt.screenshots.push({ ...fingerprint(file), width: decoded.info.width, height: decoded.info.height })
    }
    guard(); attempt.complete = true
  } catch (error) {
    attempt.error = { name: error.name, message: error.message, status: error.status ?? null, signal: error.signal ?? null }
    attempt.evidenceRoots = evidenceRootNames(out, row, before).map(name => path.resolve(out, name))
    fs.writeFileSync(log + '.failure.log', error.stack || error.message)
  } finally { attempt.finishedAt = new Date().toISOString() }
  return attempt
}
function assertMatrixComplete(receipt) {
  assert.equal(receipt.smoke?.complete, true, 'Independent smoke must qualify before the complete matrix')
  assert.equal(receipt.attempts.length, 18); assert.deepEqual(receipt.attempts.map(({ kind, theme, viewport, zoom }) => ({ kind, theme, viewport, zoom })), matrixPlan().map(({ kind, theme, viewport, zoom }) => ({ kind, theme, viewport, zoom })))
  assert(receipt.attempts.every(attempt => attempt.complete && attempt.exit?.status === 0 && attempt.exit?.signal === null), 'Every actual original matrix row must qualify; skipped rows remain failures')
}

async function main() {
  fs.mkdirSync('out', { recursive: true }); const root = fs.mkdtempSync(path.resolve('out/mac-batch121-reuse-'))
  const receipt = { complete: false, root, startedAt: new Date().toISOString(), artifactRunId: RUN, artifactSourceCommit: SOURCE, parentFullRunAcceptance: false, primaryFullNativeAcceptance: false, classification: 'Supplementary native ARM64 Electron offscreen fixture QA using exact original packaged renderer and native codec; distinct bounded QA source. Does not replace original APP/DMG/game/startup/update qualification or erase parent failures.', runtime: { platform: process.platform, arch: process.arch, node: process.versions.node, osRelease: os.release() }, attempts: matrixPlan().map(row => ({ ...row, complete: false, executed: false })) }
  const save = () => fs.writeFileSync(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2)); save()
  try {
    assertNativeHost(process)
    const qaSourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); validateWorkflowContext(process.env, qaSourceCommit)
    receipt.qaSourceCommit = qaSourceCommit; receipt.workflowSha = process.env.GITHUB_SHA; receipt.workflowRef = process.env.GITHUB_REF; receipt.finalTagCommit = null
    const comparison = proveReuseSource(qaSourceCommit); receipt.comparison = comparison
    const pkg = read('package.json'), lock = read('package-lock.json'), runtimeVersion = require('electron/package.json').version, electron = require('electron')
    assert.equal(pkg.version, '1.1.21'); assert.equal(lock.version, pkg.version); assert.equal(lock.packages[''].version, pkg.version)
    assert.equal(pkg.devDependencies.electron, '44.3.0'); assert.equal(runtimeVersion, '44.3.0'); assert.equal(lock.packages['node_modules/electron'].version, '44.3.0')
    assert.equal(typeof fixture.validateSourceSelection, 'function', 'The reviewed actual native source-selection protocol must exist')
    receipt.version = pkg.version; receipt.runtime.electron = runtimeVersion; receipt.runtime.executable = electron; receipt.runtime.executableSHA256 = await fileSHA(electron)
    const originFile = 'release/artifact-origin121-reuse.json'; receipt.originFile = fingerprint(originFile); receipt.origin = validateOrigin(read(originFile)); save()
    const files = originalPackageFiles(), manifest = verifyManifest(fs.readFileSync(files.manifest)); receipt.originalFiles = files; receipt.packageManifest = fingerprint(files.manifest); receipt.package = manifest
    for (const [index, asset] of ASSETS.entries()) { const file = index ? files.dmg : files.zip; assert.equal(regular(file).size, asset.bytes); assert.equal(await fileSHA(file), asset.sha256) }
    const extracted = path.join(root, 'downloaded-package'); execFileSync('ditto', ['-x', '-k', files.zip, extracted], { stdio: 'inherit' })
    const app = path.join(extracted, 'KAMUCL.app'), archive = path.join(app, 'Contents/Resources/app.asar'); regular(archive); assert.equal(await fileSHA(archive), ASAR)
    receipt.packageIdentity = readMacPackageIdentity(app, { version: '1.1.21', arch: 'arm64', sourceCommit: SOURCE, runtimeVersion: '44.3.0', minimumSystemVersion: '13.0.0' }); assert.deepEqual(receipt.packageIdentity.identity, manifest.buildIdentity); assert.equal(receipt.packageIdentity.identitySHA256, manifest.buildIdentitySHA256)
    const renderer = extractPackagedRenderer(require('asar'), archive, path.resolve('out/renderer')); receipt.rendererArtifacts = renderer; receipt.packagedRendererCopiedWithoutBuild = true
    const sourceFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean).filter(file => fs.existsSync(file) && fs.lstatSync(file).isFile())
    const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, sha(fs.readFileSync(file))])); receipt.qaSources = [...ALLOWED, 'scripts/verify-community121-ui.cjs', 'scripts/verify-mac-batch121.cjs'].map(fingerprint)
    const expected = { version: pkg.version, commit: SOURCE, electron: runtimeVersion, sourceHashes, rendererHashes: rendererHashMap(renderer.filter(item => item.relative === 'index.html' || /^assets\/.+\.(js|css)$/.test(item.relative))) }
    const guard = () => { proveReuseSource(qaSourceCommit); for (const item of renderer) assert.equal(sha(fs.readFileSync(item.file)), item.sha256, 'Original renderer changed during QA'); for (const item of receipt.qaSources) assert.equal(sha(fs.readFileSync(item.file)), item.sha256, 'Frozen QA source changed during matrix') }
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.KAMUCL_REVIEW_RENDERER_DIR
    save(); const smokeRow = matrixPlan().find(row => row.kind === 'appearance' && row.theme === 'custom' && row.viewport === '960x620' && row.zoom === 1.25)
    receipt.smoke = await runAttempt(smokeRow, { out: path.resolve('out'), receiptRoot: root, number: 'smoke', electron, env, expected, guard }); save()
    assert.equal(receipt.smoke.complete, true, 'Smoke failed; original false proof and all unexecuted matrix rows are retained')
    for (const [index, row] of matrixPlan().entries()) { console.log('Reused native fixture UI: ' + JSON.stringify(row)); receipt.attempts[index] = { ...(await runAttempt(row, { out: path.resolve('out'), receiptRoot: root, number: index + 1, electron, env, expected, guard })), executed: true }; save() }
    assertMatrixComplete(receipt); guard(); receipt.complete = true
  } catch (error) { receipt.error = { name: error.name, message: error.message, status: error.status ?? null, signal: error.signal ?? null }; console.error(error); process.exitCode = 1 }
  finally { receipt.finishedAt = new Date().toISOString(); save() }
}
module.exports = { SOURCE, RUN, PACKAGE_JOB, REPOSITORY, REPOSITORY_ID, ARTIFACT, MANIFEST, ASAR, ASSETS, ALLOWED, APPEARANCE_PNG, validateWorkflowContext, validateQaPaths, proveReuseSource, validateOrigin, verifyManifest, originalPackageFiles, extractPackagedRenderer, validateNativeSourceProtocol, validateSourceSelections, validateReuseProof, runAttempt, assertMatrixComplete }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
