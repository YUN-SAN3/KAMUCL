import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { spawn } from 'node:child_process'

const requireFixture = createRequire(path.resolve('package.json'))
const { ROUTES, THEMES, LAYOUTS, ROUTE_COMPONENTS, assertNavigationCoverage, assertQueueLedger, publicAccount, stableHash, createQueueClickObserver, createInstallHandlerObserver, restoreInstallHandlerObserver, preserveInstallObservation, collectAndRestoreInstallObserver, collectAndRestoreCommitObservation, preservePrimaryFailure, assertMatchingDownloadResponse, assertDownloadTargetSelection } = requireFixture('./scripts/verify-mac-parity-ui.cjs')
function actualInstallProtection() {
  const ts = requireFixture('typescript'), source = ts.createSourceFile('verify-mac-parity-ui.cjs', fs.readFileSync(path.resolve('scripts/verify-mac-parity-ui.cjs'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), registrations: any[] = [], protections: any[] = []
  const visit = (node: any) => { if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression) && node.expression.left.getText(source) === 'proof.realService.handlerRegistration') registrations.push(node); if (ts.isCallExpression(node) && node.expression.getText(source) === 'preserveInstallObservation') protections.push(node); ts.forEachChild(node, visit) }
  visit(source); assert.equal(registrations.length, 1); assert.equal(protections.length, 1)
  const registration = registrations[0], protection = protections[0], statements = [...registration.parent.statements], position = statements.indexOf(registration)
  assert.equal(statements[position + 1], protection.parent.parent, 'actual protected call immediately follows successful registration; no unprotected await or checkpoint')
  return { ts, source, protection }
}
const { parityRoot, assertRestartIdentity, assertNaturalOwnedClose, safeEvidence } = requireFixture('./scripts/verify-mac-parity.cjs')
function temporary(t: TestContext) {
  const base = fs.realpathSync.native(os.tmpdir()), root = fs.realpathSync.native(fs.mkdtempSync(path.join(base, 'KAMUCL synthetic Mac parity contract ')))
  assert(root.startsWith(base + path.sep))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}
function navigation() {
  return THEMES.flatMap((theme: string) => LAYOUTS.flatMap(([width, height, zoom]: number[]) => ROUTES.map((route: string) => ({
    theme, width, height, zoom, route, selectedRoute: route, actualTheme: theme, component: ROUTE_COMPONENTS[route], componentChain: ['ChildWidget', ROUTE_COMPONENTS[route], 'AsyncComponentWrapper'],
    native: { platform: 'darwin', visible: true, focused: true, minimized: false, zoom, bounds: { width, height }, contentBounds: { width, height } }, coordinate: { hit: true }, renderer: { width: Math.round(width / zoom), height: Math.round(height / zoom), hasFocus: true, hidden: false }, layout: { horizontalOverflow: false }, screenshot: 'mac-parity-first-scene.png', bytes: 1024, sha256: 'a'.repeat(64)
  }))))
}
function queue() {
  const clicks = Array.from({ length: 40 }, (_, i) => ({ trusted: true, at: i, afterAt: i + .1, beforePhase: 1, afterPhase: 3, before: Math.min(32, i), after: Math.min(32, i + 1), accepted: i < 32, expectedLimit: 32, acceptedBefore: Math.min(32, i), acceptedAfter: Math.min(32, i + 1), rejectedBefore: Math.max(0, i - 32), rejectedAfter: Math.max(0, i - 31) }))
  const audio = Array.from({ length: 32 }, (_, i) => ({ role: 'palm', at: 300 + i * 150, duration: .095, peak: .5 }))
  const contacts = audio.map((row, i) => ({ contacts: i + 1, contactAt: row.at + .1 }))
  return { ledger: { clicks, audio, contacts, busyVisible: true }, before: { contacts: 0, count: 100 }, after: { contacts: 32, count: 132, persistedCount: 132, phase: 'front', queue: 0 } }
}
test('Mac parity scene contract requires all 240 unique route/theme/native-layout observations', () => {
  const rows = navigation()
  assert.equal(rows.length, 240)
  assertNavigationCoverage(rows)
  const missing = rows.slice(1)
  assert.throws(() => assertNavigationCoverage(missing))
  const duplicate = structuredClone(rows); duplicate[1] = duplicate[0]
  assert.throws(() => assertNavigationCoverage(duplicate), /duplicate/)
})
test('Mac scene contract rejects selected-nav-only snapshots, hidden windows, wrong theme/zoom, occlusion and overflow', () => {
  for (const mutation of [
    (row: any) => { row.component = 'PriorView' },
    (row: any) => { row.componentChain = ['PriorView'] },
    (row: any) => { row.native.focused = false },
    (row: any) => { row.native.platform = 'linux' },
    (row: any) => { row.native.zoom = 2 },
    (row: any) => { row.native.bounds.height = 678 },
    (row: any) => { row.native.bounds.width = 1280 },
    (row: any) => { row.renderer.width += 1 },
    (row: any) => { row.actualTheme = 'blue-white' },
    (row: any) => { row.coordinate.hit = false },
    (row: any) => { row.renderer.hidden = true },
    (row: any) => { row.layout.horizontalOverflow = true }
  ]) {
    const rows = navigation(); mutation(rows[0]); assert.throws(() => assertNavigationCoverage(rows))
  }
})
test('Mac queue contract matches 32 accepted plus overflow to individual actual contacts, sources and saved increments', () => {
  const { ledger, before, after } = queue()
  assert.deepEqual(assertQueueLedger(ledger, before, after), { accepted: 32, rejected: 8, maximumQueue: 32 })
})
test('Mac queue contract rejects synthetic input, unbounded queues, lost sounds, duplicate contacts and unsynchronized sources', () => {
  for (const mutation of [
    (v: any) => { v.ledger.clicks[0].trusted = false },
    (v: any) => { v.ledger.clicks[0].afterPhase = 1 },
    (v: any) => { v.ledger.clicks[0].beforePhase = 3 },
    (v: any) => { v.ledger.clicks[0].afterAt = -1 },
    (v: any) => { v.ledger.clicks[31].after = 33 },
    (v: any) => { v.ledger.clicks[35].after = 31 },
    (v: any) => { v.ledger.clicks[35].rejectedAfter = 0 },
    (v: any) => { v.ledger.audio.pop() },
    (v: any) => { v.ledger.contacts[3].contacts = 3 },
    (v: any) => { v.ledger.audio[0].at += 51 },
    (v: any) => { v.after.persistedCount = 100 },
    (v: any) => { v.after.phase = 'return' },
    (v: any) => { v.ledger.busyVisible = false }
  ]) { const value = queue(); mutation(value); assert.throws(() => assertQueueLedger(value.ledger, value.before, value.after)) }
})
test('Mac click observer binds the same original Event capture and bubble around the actual target handler, without a microtask after-read', async () => {
  const dataset = { queue: '0', acceptedClicks: '0', rejectedClicks: '0', contacts: '0' }, ledger = { clicks: [] as any[] }
  let time = 100
  const observer = createQueueClickObserver(ledger, () => dataset, () => ++time)
  const event = { target: { closest: () => true }, isTrusted: true, eventPhase: 1 }
  observer.before(event)
  // A synthetic event-phase fixture reproduces Chromium's possible checkpoint
  // before the target callback. It is not a trusted native GUI pass.
  await Promise.resolve()
  assert.equal(ledger.clicks[0].afterAt, undefined)
  assert.equal(ledger.clicks[0].before, 0)
  event.eventPhase = 2
  dataset.queue = '1'; dataset.acceptedClicks = '1'
  event.eventPhase = 3
  observer.after(event)
  assert.deepEqual({ before: ledger.clicks[0].before, after: ledger.clicks[0].after, accepted: ledger.clicks[0].accepted, beforePhase: ledger.clicks[0].beforePhase, afterPhase: ledger.clicks[0].afterPhase }, { before: 0, after: 1, accepted: true, beforePhase: 1, afterPhase: 3 })
  assert.throws(() => observer.after(event), /Duplicate bubble/)
  assert.throws(() => observer.before(event), /Duplicate capture/)
})
test('Mac click observer cannot use another Event to finish a captured input and records rejected target handling exactly once', () => {
  const dataset = { queue: '32', acceptedClicks: '32', rejectedClicks: '0', contacts: '0' }, ledger = { clicks: [] as any[] }
  const observer = createQueueClickObserver(ledger, () => dataset, () => 100)
  const event = { target: { closest: () => true }, isTrusted: true, eventPhase: 1 }
  observer.before(event)
  observer.after({ ...event, eventPhase: 3 })
  assert.equal(ledger.clicks[0].afterAt, undefined, 'foreign Event cannot supply the after checkpoint')
  dataset.rejectedClicks = '1'; event.eventPhase = 3; observer.after(event)
  assert.equal(ledger.clicks[0].accepted, false); assert.equal(ledger.clicks[0].after, 32)
  assert.equal(ledger.clicks[0].rejectedAfter - ledger.clicks[0].rejectedBefore, 1)
  observer.before({ target: { closest: () => false }, isTrusted: true, eventPhase: 1 })
  assert.equal(ledger.clicks.length, 1, 'unrelated clicks are not queue inputs')
})
test('Mac restart requires a different actual PID with the same profile, signed source, runtime, version and executable', () => {
  const first = { version: 'synthetic', sourceCommit: 'b'.repeat(40), runtimeVersion: 'synthetic-runtime', arch: 'arm64', executable: '/private/app/KAMUCL', profile: '/private/qa/profile', pid: 500 }
  const restart = { ...first, pid: 501, actualUserData: first.profile, publicAccountsPersisted: true, mascotCountsPersisted: true, settingsPersisted: true, favoritePersisted: true }
  assertRestartIdentity(first, restart)
  for (const field of ['sourceCommit', 'runtimeVersion', 'executable', 'profile', 'arch', 'version']) assert.throws(() => assertRestartIdentity(first, { ...restart, [field]: 'foreign' }))
  assert.throws(() => assertRestartIdentity(first, { ...restart, pid: first.pid }))
  assert.throws(() => assertRestartIdentity(first, { ...restart, actualUserData: '/player/profile' }))
  assert.throws(() => assertRestartIdentity(first, { ...restart, settingsPersisted: false }))
})
test('Mac restart cannot call a forced or foreign process termination a normal owned close', () => {
  const actual = { complete: true, child: { pid: 601, closed: true, awaitedClose: true, code: 0, signal: null, events: [{ event: 'close', code: 0, signal: null }] } }
  assertNaturalOwnedClose(actual, 601)
  assert.throws(() => assertNaturalOwnedClose(actual, 602))
  assert.throws(() => assertNaturalOwnedClose({ ...actual, child: { ...actual.child, code: 1 } }, 601))
  assert.throws(() => assertNaturalOwnedClose({ ...actual, child: { ...actual.child, signal: 'SIGTERM' } }, 601))
  assert.throws(() => assertNaturalOwnedClose({ ...actual, child: { ...actual.child, events: [...actual.child.events, { event: 'SIGTERM-request' }] } }, 601))
})
test('Persistent Mac QA root requires a native disposable session, exact ownership and fresh first / existing restart phase', t => {
  const root = temporary(t), token = 'c'.repeat(32), env = { GITHUB_ACTIONS: 'true', KAMUCL_PARITY_PHASE: 'first', KAMUCL_PARITY_ROOT: root, KAMUCL_PARITY_TOKEN: token }
  fs.writeFileSync(path.join(root, 'mac-parity-owner.json'), JSON.stringify({ schemaVersion: 1, root, token }))
  assert.equal(parityRoot(env, 'darwin'), root)
  assert.throws(() => parityRoot(env, 'win32'))
  assert.throws(() => parityRoot({ ...env, GITHUB_ACTIONS: 'false' }, 'darwin'))
  assert.throws(() => parityRoot({ ...env, KAMUCL_PARITY_TOKEN: 'd'.repeat(32) }, 'darwin'))
  assert.throws(() => parityRoot({ ...env, KAMUCL_PARITY_PHASE: 'restart' }, 'darwin'))
  fs.mkdirSync(path.join(root, 'profile')); fs.writeFileSync(path.join(root, 'profile/settings.json'), '{}')
  assert.throws(() => parityRoot(env, 'darwin'))
  assert.equal(parityRoot({ ...env, KAMUCL_PARITY_PHASE: 'restart' }, 'darwin'), root)
})
test('Mac evidence collector copies only exact regular files without path traversal or overwriting original bytes', t => {
  const root = temporary(t), destination = path.join(root, 'proof'); fs.mkdirSync(destination)
  const bytes = Buffer.from('synthetic original evidence'); fs.writeFileSync(path.join(root, 'sample.png'), bytes)
  const row = safeEvidence(root, 'sample.png', path.join(destination, 'copy.png'))
  assert.equal(row.bytes, bytes.length); assert.deepEqual(fs.readFileSync(path.join(destination, 'copy.png')), bytes)
  assert.throws(() => safeEvidence(root, 'sample.png', path.join(destination, 'copy.png')), /EEXIST/)
  assert.throws(() => safeEvidence(root, 'sample.png', path.join(destination, 'foreign.png'), { bytes: bytes.length, sha256: 'f'.repeat(64) }), /bytes must match/)
  assert.throws(() => safeEvidence(root, '../settings.json', path.join(destination, 'bad.png')))
  assert.throws(() => safeEvidence(root, 'proof', path.join(destination, 'directory.png')))
})
test('Public-account projection excludes credentials while whole-settings hashes retain exact values independently of key order', () => {
  assert.deepEqual(publicAccount({ id: 'one', type: 'offline', username: 'PrivateQA', uuid: 'zero', refreshToken: 'fixture-secret', password: 'not-real' }), { id: 'one', type: 'offline', username: 'PrivateQA', uuid: 'zero' })
  assert.equal(stableHash({ a: [1, 2], b: { y: 2, x: 1 } }), stableHash({ b: { x: 1, y: 2 }, a: [1, 2] }))
  assert.notEqual(stableHash({ interval: 1 }), stableHash({ interval: 2 }))
})

test('Mac real-install observer owns the actual wrapped registration and restores exact original entries without rewrapping', async () => {
  const entries = new Map<string, (...args: any[]) => any>(), calls: any[][] = [], registrations: string[] = []
  const original = async function (this: unknown, ...args: any[]) { calls.push([this, ...args]); return { id: 'original-real-plan', warnings: [] } }
  entries.set('mods:prepare', original)
  const ipc = { _invokeHandlers: entries, removeHandler: (channel: string) => entries.delete(channel), handle(channel: string, callback: (...args: any[]) => any) { registrations.push(channel); entries.set(channel, function (this: unknown, ...args: any[]) { return callback.apply(this, args) }) } }
  const observer = createInstallHandlerObserver(ipc, ['mods:prepare'])
  assert.equal(observer.registration[0].registeredEntryIsSuppliedWrapper, false)
  const event = { sender: 'private-native-fixture' }, target = { id: 'fixture-instance' }, context = { receiver: true }
  const result = await entries.get('mods:prepare')!.call(context, event, target, { file: 'fixture-public-file' })
  assert.equal(calls.length, 1); assert.deepEqual(calls[0], [context, event, target, { file: 'fixture-public-file' }])
  assert.equal(observer.calls[0].result, result); assert.deepEqual(observer.calls[0].arguments, [target, { file: 'fixture-public-file' }])
  assert.deepEqual(restoreInstallHandlerObserver(ipc, observer), { complete: true, restored: [{ channel: 'mods:prepare', exactOriginalEntryRestored: true }] })
  assert.equal(entries.get('mods:prepare'), original); assert.deepEqual(registrations, ['mods:prepare'])
})

test('Mac install observer retains original rejection and never replaces a foreign handler during cleanup', async () => {
  const entries = new Map<string, (...args: any[]) => any>(), primary = new Error('original install download rejection')
  entries.set('mods:prepare', async () => { throw primary })
  const ipc = { _invokeHandlers: entries, removeHandler: (channel: string) => entries.delete(channel), handle(channel: string, callback: (...args: any[]) => any) { entries.set(channel, async (...args: any[]) => callback(...args)) } }
  const observer = createInstallHandlerObserver(ipc, ['mods:prepare'])
  await assert.rejects(entries.get('mods:prepare')!({}, { id: 'fixture' }), error => error === primary)
  assert.equal(observer.calls.length, 1); assert.equal(observer.calls[0].error.message, primary.message)
  const foreign = () => 'foreign-registration'; entries.set('mods:prepare', foreign)
  assert.throws(() => restoreInstallHandlerObserver(ipc, observer), /identity changed/)
  assert.equal(entries.get('mods:prepare'), foreign)
})

test('Mac install diagnostics checkpoint the primary before cleanup and keep any cleanup or writer failure nonzero without masking it', async () => {
  const primary = new Error('original coordinate assertion'), cleanup = new Error('foreign cleanup entry'), writer = new Error('diagnostic EIO'), receipt: any = {}, snapshots: any[] = []
  let restores = 0
  await assert.rejects(preserveInstallObservation(async () => { throw primary }, async () => { restores++; assert.equal(receipt.primaryError.message, primary.message); throw cleanup }, receipt, () => { snapshots.push(structuredClone(receipt)) }), error => error === primary)
  assert.equal(restores, 1); assert.equal(snapshots[0].primaryError.message, primary.message); assert.equal(receipt.cleanupError.message, cleanup.message)
  await assert.rejects(preserveInstallObservation(async () => 1, async () => { throw cleanup }, {}, () => {}), error => error === cleanup)
  const ioReceipt: any = {}; let restoredAfterIO = false
  await assert.rejects(preserveInstallObservation(async () => { throw primary }, async () => { restoredAfterIO = true; return { complete: true } }, ioReceipt, () => { throw writer }), error => error === primary)
  assert.equal(restoredAfterIO, true); assert.equal(ioReceipt.diagnosticErrors[0].message, writer.message)
  await assert.rejects(preserveInstallObservation(async () => 1, async () => ({ complete: true }), {}, () => { throw writer }), error => error === writer)
})

test('Mac actual install cleanup callback attempts exact restoration even when its separate main-process trace read fails', async () => {
  const primary = new Error('original installer assertion'), trace = new Error('trace read transport rejection'), restore = new Error('foreign actual entry'), receipt: any = {}, calls: string[] = []
  const main = async (expression: string) => { calls.push(expression); if (expression === 'macParityInstallTrace.calls') throw trace; assert.match(expression, /_invokeHandlers\.set\(channel,original\)/); return { complete: true, restored: ['mods:prepare', 'mods:commit'] } }
  await assert.rejects(preserveInstallObservation(async () => { throw primary }, () => collectAndRestoreInstallObserver(main, receipt), receipt, () => {}), error => error === primary)
  assert.equal(calls.length, 2, 'the real restoration main call still follows a rejected trace read')
  assert.equal(receipt.handlerRestoration.complete, true, 'a rejected trace read still retains the actual successful restoration result')
  assert.equal(receipt.traceReadError.message, trace.message); assert.equal(receipt.cleanupError.message, trace.message); assert.equal(receipt.primaryError.message, primary.message)
  const both: any = {}, secondMain = async (expression: string) => { if (expression === 'macParityInstallTrace.calls') throw trace; throw restore }
  await assert.rejects(collectAndRestoreInstallObserver(secondMain, both), error => error === restore)
  assert.equal(both.traceReadError.message, trace.message); assert.equal(both.restorationError.message, restore.message)
})

test('Mac outer failure receipt writer cannot replace the original nonzero assertion after observed cleanup', () => {
  const primary = new Error('original native coordinate failure'), writer = new Error('outer receipt EIO'), proof: any = {}
  assert.equal(preservePrimaryFailure(proof, primary, () => { throw writer }), primary)
  assert.equal(proof.error.message, primary.message)
  assert.deepEqual(proof.diagnosticErrors, [{ stage: 'primary failure receipt', name: writer.name, message: writer.message }])
  const source = fs.readFileSync(path.resolve('scripts/verify-mac-parity-ui.cjs'), 'utf8')
  const actual = actualInstallProtection(), cleanup = actual.protection.arguments[1]
  assert(actual.ts.isArrowFunction(cleanup)); assert.equal(cleanup.body.getText(actual.source), 'collectAndRestoreCommitObservation(evaluate,main,proof.realService)', 'actual cleanup invokes the tested independent renderer-listener and exact main-handler restoration entry')
  assert.match(source, /catch\(error\)\{preservePrimaryFailure\(proof,error,save\);try\{await screenshot/, 'the actual outer catch uses the tested primary-preserving writer')
})

test('Mac registered install observation enters finally protection before its first diagnostic checkpoint can fail', async () => {
  const entries = new Map<string, (...args: any[]) => any>(), original = async () => 'original', writer = new Error('first registered checkpoint EIO')
  entries.set('mods:prepare', original)
  const ipc = { _invokeHandlers: entries, removeHandler: (channel: string) => entries.delete(channel), handle(channel: string, callback: (...args: any[]) => any) { entries.set(channel, async (...args: any[]) => callback(...args)) } }
  const observer = createInstallHandlerObserver(ipc, ['mods:prepare']), receipt: any = { handlerRegistration: observer.registration }, mainCalls: string[] = []
  const main = async (expression: string) => { mainCalls.push(expression); return expression === 'macParityInstallTrace.calls' ? observer.calls : restoreInstallHandlerObserver(ipc, observer) }
  await assert.rejects(preserveInstallObservation(async () => { throw writer }, () => collectAndRestoreInstallObserver(main, receipt), receipt, () => { throw writer }), error => error === writer)
  assert.equal(entries.get('mods:prepare'), original); assert.equal(mainCalls.length, 2); assert.equal(receipt.handlerRestoration.complete, true)
  assert.equal(receipt.primaryError.message, writer.message)
  const actual = actualInstallProtection(), operation = actual.protection.arguments[0]
  assert(actual.ts.isArrowFunction(operation)); assert(actual.ts.isBlock(operation.body)); assert(actual.ts.isAwaitExpression(operation.body.statements[0].expression))
  assert.match(operation.body.statements[0].getText(actual.source), /__macParityCommitProgress/, 'actual listener setup and its awaited transport are inside finally protection before the first checkpoint')
  assert.equal(operation.body.statements[1].getText(actual.source), 'save()', 'the first registered writer remains inside the same protected operation')
})

test('Mac commit progress read failure still unsubscribes the actual renderer listener and restores exact main entries', async () => {
  const trace = new Error('progress read transport rejection'), receipt: any = {}, calls: string[] = [], mainCalls: string[] = []
  const evaluate = async (expression: string) => { calls.push(expression); if (expression === 'window.__macParityCommitProgress?.rows||[]') throw trace; assert.match(expression, /o\.off\(\)/); return { complete: true, wasInstalled: true } }
  const main = async (expression: string) => { mainCalls.push(expression); return expression === 'macParityInstallTrace.calls' ? [] : { complete: true, restored: ['mods:commit'] } }
  await assert.rejects(collectAndRestoreCommitObservation(evaluate, main, receipt), error => error === trace)
  assert.equal(calls.length, 2); assert.equal(mainCalls.length, 2); assert.equal(receipt.progressObserverRestoration.complete, true); assert.equal(receipt.handlerRestoration.complete, true); assert.equal(receipt.progressReadError.message, trace.message)
  const release = new Error('progress unsubscribe transport rejection'), both: any = {}; let mainRestored = false
  await assert.rejects(collectAndRestoreCommitObservation(async () => { throw release }, async (expression: string) => { if (expression !== 'macParityInstallTrace.calls') mainRestored = true; return { complete: true } }, both), error => error === release)
  assert(mainRestored); assert.equal(both.handlerRestoration.complete, true); assert.equal(both.progressObserverRestorationError.message, release.message)
})

function publicDownloadFixture() {
  const file = { source: 'modrinth', projectId: 'P7dR8mSH', fileId: 'public-1201', fileName: 'fabric-api+1.20.1.jar', gameVersions: ['1.20.1'], loaders: ['fabric'], sha1: 'a'.repeat(40) }
  const target = { id: '联机验证实例', mcVersion: '1.20.1', loader: 'fabric', folder: '/private/owned/games' }
  const state = { present: true, mcVersion: '1.20.1', loader: 'fabric', loading: false, error: null, selectedFileId: file.fileId, selectedFileName: file.fileName, selectedFileDescription: '版本 public · MC 1.20.1 · fabric', target: { value: 'owned-target-key', options: [{ value: 'owned-target-key', label: '联机验证实例 · 1.20.1 / fabric · /private/owned/games' }] } }
  const call = { channel: 'community:files', index: 2, startedAt: 100, completedAt: 200, arguments: ['modrinth', 'P7dR8mSH', { kind: 'mod', mcVersion: '1.20.1', loader: 'fabric' }], result: [file] }
  return { file, state, call, target }
}

test('Mac public download readiness rejects stale rows until the exact completed public filter and selected file hash agree', () => {
  const value = publicDownloadFixture()
  assert.deepEqual(assertMatchingDownloadResponse(value.state, value.call), value.file)
  for (const mutate of [
    (v: any) => { v.state.mcVersion = '26.3' },
    (v: any) => { v.state.loader = 'forge' },
    (v: any) => { v.state.loading = true },
    (v: any) => { v.state.error = 'public request failed' },
    (v: any) => { v.call.arguments[2].mcVersion = '26.3' },
    (v: any) => { v.call.arguments[2].loader = '' },
    (v: any) => { v.call.arguments[1] = 'foreign-project' },
    (v: any) => { delete v.call.completedAt },
    (v: any) => { v.call.completedAt = 99 },
    (v: any) => { v.call.error = { message: 'download rejected' } },
    (v: any) => { v.state.selectedFileId = 'old-26.3-row' },
    (v: any) => { v.call.result[0].gameVersions = ['26.3'] },
    (v: any) => { v.call.result[0].loaders = ['forge'] },
    (v: any) => { v.call.result[0].sha1 = 'unknown' },
    (v: any) => { v.state.selectedFileName = 'another-file.jar' }
  ]) { const fixture = structuredClone(value); mutate(fixture); assert.throws(() => assertMatchingDownloadResponse(fixture.state, fixture.call)) }
})

test('Mac actual target selection requires the same complete instance label, owned folder and selected option value', () => {
  const value = publicDownloadFixture()
  assert.equal(assertDownloadTargetSelection(value.state, value.target).value, 'owned-target-key')
  for (const mutate of [
    (v: any) => { v.state.target.value = 'seeded-26.3-key' },
    (v: any) => { v.state.target.options[0].label = '联机验证实例 · 26.3 / fabric · /private/owned/games' },
    (v: any) => { v.state.target.options[0].label = '联机验证实例 · 1.20.1 / fabric · /private/foreign/games' },
    (v: any) => { v.state.target.options.push({ ...v.state.target.options[0] }) },
    (v: any) => { v.state.target.options[0].value = '' }
  ]) { const fixture = structuredClone(value); mutate(fixture); assert.throws(() => assertDownloadTargetSelection(fixture.state, fixture.target)) }
})

test('Mac public file and install observations remain exact-once with all three entries restored after a stale-row failure', async () => {
  const fixture = publicDownloadFixture(), entries = new Map<string, (...args: any[]) => any>(), invocations: any[] = []
  for (const channel of ['community:files', 'mods:prepare', 'mods:commit']) entries.set(channel, async (_event, ...args) => { invocations.push({ channel, args }); return channel === 'community:files' ? fixture.call.result : 'original result' })
  const originals = new Map(entries)
  const ipc = { _invokeHandlers: entries, removeHandler: (channel: string) => entries.delete(channel), handle(channel: string, callback: (...args: any[]) => any) { entries.set(channel, async (...args: any[]) => callback(...args)) } }
  const observation = createInstallHandlerObserver(ipc, [...entries.keys()]), receipt: any = {}
  await assert.rejects(preserveInstallObservation(async () => {
    await entries.get('community:files')!({ sender: 'owned' }, ...fixture.call.arguments)
    assertMatchingDownloadResponse({ ...fixture.state, selectedFileId: 'stale-26.3' }, observation.calls[0])
  }, async () => restoreInstallHandlerObserver(ipc, observation), receipt, () => {}))
  assert.deepEqual(invocations, [{ channel: 'community:files', args: fixture.call.arguments }], 'rejected stale rows cannot reach the actual prepare or commit')
  assert.equal(receipt.handlerRestoration.complete, true)
  for (const [channel, original] of originals) assert.equal(entries.get(channel), original)
  const source = fs.readFileSync(path.resolve('scripts/verify-mac-parity-ui.cjs'), 'utf8')
  assert.match(source, /\['community:files','mods:prepare','mods:commit'\]/)
  assert(source.indexOf('await preserveInstallObservation(async()=>{') < source.indexOf("await type('.download-modal input[list="), 'all filtering and selection starts within finally protection')
})

test('Mac selection observation reads production VNode keys and public SelectMenu props without setup setters or DOM dev state', () => {
  const { installMacParityObserver, readDownloadSelectionState } = requireFixture('./scripts/verify-mac-parity-ui.cjs'), fixture = publicDownloadFixture()
  const loader = {}, target = {}, file = { querySelector: (selector: string) => ({ textContent: selector === '.file-name' ? fixture.file.fileName : fixture.state.selectedFileDescription }) }
  const dialog = { querySelector: (selector: string) => selector === '.filter-row .select-menu-btn' ? loader : selector === ':scope > .select-menu-btn' ? target : selector === '.file-row.active' ? file : selector.startsWith('input[') ? { value: '1.20.1' } : null }
  const loaderInstance = { type: { __name: 'SelectMenu' }, props: { modelValue: 'fabric' }, subTree: { children: [{ el: loader }] } }
  const targetInstance = { type: { __name: 'SelectMenu' }, props: { modelValue: fixture.state.target.value, options: fixture.state.target.options }, subTree: { children: [{ el: target }] } }
  const page = { type: { __name: 'CommunityView' }, subTree: { children: [{ component: loaderInstance }, { component: targetInstance }, { children: [{ el: file, key: fixture.file.fileId }] }] } }
  const context: any = { window: {}, document: { querySelector: (selector: string) => selector === '#app' ? { __vue_app__: { _container: { _vnode: { component: page } } } } : selector === '.download-modal' ? dialog : null } }
  vm.runInNewContext(`(${installMacParityObserver.toString()})(); observed=(${readDownloadSelectionState.toString()})();`, context)
  assert.deepEqual(JSON.parse(JSON.stringify(context.observed)), fixture.state)
  assert.equal(assertMatchingDownloadResponse(context.observed, fixture.call).fileId, fixture.file.fileId)
  assert.equal(assertDownloadTargetSelection(context.observed, fixture.target).value, fixture.state.target.value)
  assert.equal(loaderInstance.props.modelValue, 'fabric'); assert.equal(targetInstance.props.modelValue, 'owned-target-key')
})

test('Mac mounted install props are projected read-only inside the renderer into exact plain file and target fields', () => {
  const { readMountedInstallInput } = requireFixture('./scripts/verify-mac-parity-ui.cjs'), fixture = publicDownloadFixture()
  const trap = { set() { throw Error('Readonly product props cannot be changed by QA') }, deleteProperty() { throw Error('Readonly product props cannot be deleted by QA') } }
  const component = { type: { __name: 'ModInstallDialog' }, props: new Proxy({ input: new Proxy({ file: new Proxy(fixture.file, trap) }, trap), target: new Proxy(fixture.target, trap) }, trap) }
  const context: any = { window: { __macParityObserver: { instances: () => [component] } } }
  vm.runInNewContext(`snapshot=(${readMountedInstallInput.toString()})();`, context)
  const snapshot = JSON.parse(JSON.stringify(context.snapshot))
  assert.deepEqual(snapshot, { file: fixture.file, target: fixture.target })
  assert.equal(snapshot.file.fileId, fixture.state.selectedFileId); assert.equal(snapshot.file.sha1, fixture.file.sha1)
  assert.deepEqual(fixture.file, publicDownloadFixture().file, 'the original public file is unchanged')
  context.window.__macParityObserver.instances = () => []
  vm.runInNewContext(`snapshot=(${readMountedInstallInput.toString()})();`, context)
  assert.deepEqual(JSON.parse(JSON.stringify(context.snapshot)), {}, 'an unmounted installer is not a fabricated ready document')
  context.window.__macParityObserver.instances = () => [component, component]
  assert.throws(() => vm.runInNewContext(`snapshot=(${readMountedInstallInput.toString()})();`, context), /Expected one actual ModInstallDialog instance, found 2/, 'two mounted installers cannot silently select the first target')
})

test('Mac props protocol regression reproduces real owned V8 CDP Proxy loss and preserves all fields with renderer-side projection', { timeout: 12000 }, async t => {
  const { readMountedInstallInput } = requireFixture('./scripts/verify-mac-parity-ui.cjs'), fixture = publicDownloadFixture()
  const child = spawn(process.execPath, ['--inspect=127.0.0.1:0', '-e', 'setInterval(()=>{},1000)'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let socket: WebSocket | undefined, nextId = 0
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  t.after(async () => {
    socket?.close()
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Owned protocol fixture closing')) }
    pending.clear()
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve()
      const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); resolve() }, 2000)
      child.once('close', () => { clearTimeout(timer); resolve() })
    })
  })
  const url = await new Promise<string>((resolve, reject) => {
    let stderr = ''
    const timer = setTimeout(() => reject(Error('Owned inspector startup timeout')), 4000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.stderr.on('data', buffer => { stderr += buffer.toString(); const match = /Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[-a-f0-9]+)/.exec(stderr); if (match) { clearTimeout(timer); resolve(match[1]) } })
  })
  socket = new WebSocket(url)
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(Error('Owned inspector connection timeout')), 4000); socket!.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true }); socket!.addEventListener('error', () => { clearTimeout(timer); reject(Error('Owned inspector connection error')) }, { once: true }) })
  socket.addEventListener('message', event => { const message = JSON.parse(String(event.data)), item = pending.get(message.id); if (!item) return; pending.delete(message.id); clearTimeout(item.timer); item.resolve(message) })
  const evaluate = async (expression: string) => {
    const id = ++nextId
    const response: any = await new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error('Owned inspector response timeout')) }, 4000); pending.set(id, { resolve, reject, timer }); socket!.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })) })
    assert(!response.error && !response.result.exceptionDetails); return response.result.result.value
  }
  const identity = await evaluate('({pid:process.pid,execPath:process.execPath})')
  assert.equal(identity.pid, child.pid); assert.equal(identity.execPath, process.execPath, 'the protocol endpoint belongs to the child created by this test')
  const raw = await evaluate(`(()=>{globalThis.ownedProps={file:new Proxy(${JSON.stringify(fixture.file)},{}),target:new Proxy(${JSON.stringify(fixture.target)}, {})};globalThis.window={__macParityObserver:{instances:()=>[{type:{__name:'ModInstallDialog'},props:{input:{file:ownedProps.file},target:ownedProps.target}}]}};return{file:ownedProps.file,target:ownedProps.target}})()`)
  assert.deepEqual(raw, { file: {}, target: {} }, 'raw Proxy returnByValue must reproduce the observed empty native protocol snapshot')
  const projected = await evaluate(`(${readMountedInstallInput.toString()})()`)
  assert.deepEqual(projected, { file: fixture.file, target: fixture.target })
  assert.equal(projected.file.fileId, fixture.state.selectedFileId); assert.equal(projected.file.sha1, fixture.file.sha1)
  assert.equal(projected.target.id, fixture.target.id); assert.equal(projected.target.folder, fixture.target.folder)
  const duplicate = await evaluate(`(()=>{window.__macParityObserver.instances=()=>[{type:{__name:'ModInstallDialog'},props:{input:{file:ownedProps.file},target:ownedProps.target}},{type:{__name:'ModInstallDialog'},props:{input:{file:ownedProps.file},target:ownedProps.target}}];try{(${readMountedInstallInput.toString()})();return{accepted:true}}catch(error){return{rejected:true,name:error.name,message:error.message}}})()`)
  assert.deepEqual(duplicate, { rejected: true, name: 'Error', message: 'Expected one actual ModInstallDialog instance, found 2' }, 'the actual owned protocol endpoint cannot select the first of two mounted-instance observations')
})
