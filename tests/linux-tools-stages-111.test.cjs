const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawn } = require('node:child_process')
const { createToolsStages, createToolsSpawner } = require('../scripts/verify-linux-tools.cjs')
const { preserveBusinessFailure, ownChild, awaitOwnedClose, stopOwnedChild } = require('../scripts/verify-linux-business.cjs')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

test('Linux tools stages persist the initial identity and running phase before an operation, then actual observations', async () => {
  const report = { sourceCommit: 'fixture-source', runtime: 'fixture-runtime', complete: false }, snapshots = []
  const stages = createToolsStages(report, () => snapshots.push(structuredClone(report)))
  stages.observation('before-app-ready', { isReady: false })
  const value = await stages.run('owned-api-state', async () => {
    assert.equal(snapshots.at(-1).activeStage, 'owned-api-state')
    assert.equal(snapshots.at(-1).stages.at(-1).status, 'running')
    return { port: 43210, phase: 'hosting' }
  }, value => value)
  assert.deepEqual(value, { port: 43210, phase: 'hosting' })
  assert.deepEqual(snapshots[0].observations[0].value, { isReady: false })
  assert.equal(snapshots[0].sourceCommit, 'fixture-source')
  assert.deepEqual(snapshots.at(-1).stages[0].actual, value)
  value.phase = 'stopped'; value.port = 54321
  assert.deepEqual(report.stages[0].actual, { port: 43210, phase: 'hosting' }, 'Later state must not rewrite an earlier actual observation')
  assert.equal(report.complete, false, 'Phase success is not whole-platform acceptance')
})

test('Linux tools an unready operation reaches a nonzero deadline and saves that failure before cleanup', { timeout: 5000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-tools-deadline-'))
  const file = path.join(root, 'verification.json'), report = { complete: false }
  const stages = createToolsStages(report, () => fs.writeFileSync(file, JSON.stringify(report)), 30)
  let thrown, cleaned = false
  try {
    await assert.rejects(preserveBusinessFailure(report,
      () => stages.run('app-not-ready', () => new Promise(() => {})),
      async () => {
        const original = JSON.parse(fs.readFileSync(file))
        assert.equal(original.stages[0].status, 'failure')
        assert.equal(original.error.code, 'LINUX_TOOLS_QA_DEADLINE')
        cleaned = true
      }, () => fs.writeFileSync(file, JSON.stringify(report))), error => {
        thrown = error; return error.code === 'LINUX_TOOLS_QA_DEADLINE' && error.stage === 'app-not-ready'
      })
    assert(cleaned); assert.equal(report.error.message, thrown.message); assert.equal(report.complete, false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('Linux tools preserves the same operation assertion when cleanup and diagnostic saves fail', async () => {
  const original = Object.assign(Error('original owned API assertion'), { code: 'ERR_ASSERTION' })
  const report = { complete: false }, stages = createToolsStages(report, () => {
    if (report.error) throw Error('diagnostic disk rejected')
  })
  await assert.rejects(preserveBusinessFailure(report,
    () => stages.run('owned-api-assertion', () => { throw original }),
    () => stages.cleanup(() => { throw Error('owned cleanup rejected') }),
    () => { throw Error('final evidence disk rejected') }), error => error === original)
  assert.equal(report.error.code, 'ERR_ASSERTION')
  assert(report.secondaryErrors.some(error => error.stage === 'stage-evidence-save'))
  assert(report.secondaryErrors.some(error => error.stage === 'owned-cleanup'))
  assert(report.secondaryErrors.some(error => error.stage === 'evidence-save'))
  assert.equal(report.cleanup.status, 'failure')
})

test('Linux tools a late source rejection cannot replace the recorded QA deadline or become unhandled', { timeout: 5000 }, async () => {
  const report = { complete: false }, stages = createToolsStages(report, () => {}, 20)
  let rejectOperation
  await assert.rejects(stages.run('slow-official-download', () => new Promise((_, reject) => { rejectOperation = reject })), { code: 'LINUX_TOOLS_QA_DEADLINE' })
  const original = structuredClone(report.error)
  rejectOperation(Error('late connection rejection'))
  await wait(20)
  assert.deepEqual(report.error, original); assert.equal(report.stages[0].status, 'failure'); assert.equal(report.complete, false)
})

test('Linux tools a stalled owned cleanup is bounded and leaves failure plus unclosed identity visible', { timeout: 5000 }, async () => {
  const original = Object.assign(Error('original fixture start failed'), { code: 'ORIGINAL_FIXTURE_FAILURE' })
  const report = { complete: false, children: [{ pid: 4242, closed: false }] }, snapshots = []
  const stages = createToolsStages(report, () => snapshots.push(structuredClone(report)))
  await assert.rejects(preserveBusinessFailure(report,
    () => { throw original }, () => stages.cleanup(() => new Promise(() => {}), 20),
    () => snapshots.push(structuredClone(report))), error => error === original)
  assert.equal(report.cleanup.error.code, 'LINUX_TOOLS_QA_CLEANUP_DEADLINE')
  assert.equal(report.children[0].closed, false)
  assert.equal(snapshots.at(-1).error.code, 'ORIGINAL_FIXTURE_FAILURE')
  assert.equal(snapshots.at(-1).complete, false)
})

test('Linux tools failure cleanup closes only this test owned child and preserves the unrelated private sibling', { timeout: 15000 }, async () => {
  const tracks = [], report = { complete: false }, stages = createToolsStages(report, () => {})
  const original = Error('owned fixture failure')
  const forwarded = [], spawner = createToolsSpawner((...args) => { forwarded.push(args); return spawn(...args) }, () => {})
  try {
    for (const label of ['owned service', 'independent private sibling']) {
      const args = [process.execPath, ['-e', 'process.stdout.write("ready\\n");setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'pipe'] }]
      const child = label === 'owned service' ? spawner.spawn(...args) : spawn(...args)
      if (label === 'owned service') { assert.equal(forwarded.length, 1); assert.deepEqual(forwarded[0], args) }
      const track = ownChild(child, label); tracks.push(track)
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('private child did not become ready')), 5000)
        child.stdout.once('data', () => { clearTimeout(timer); resolve() })
        child.once('error', error => { clearTimeout(timer); reject(error) })
      })
    }
    await assert.rejects(preserveBusinessFailure(report, () => { throw original },
      () => stages.cleanup(async () => { spawner.close(); await stopOwnedChild(tracks[0]); report.children = tracks.map(track => track.ledger) }), () => {}), error => error === original)
    assert.equal(tracks[0].ledger.closed, true)
    assert.equal(tracks[1].child.exitCode, null); assert.equal(tracks[1].child.signalCode, null)
    assert.equal(report.cleanup.status, 'success')
    assert.throws(() => spawner.spawn(process.execPath, ['-e', 'throw Error("must never execute")']), { code: 'LINUX_TOOLS_QA_CLOSED' })
    assert.equal(forwarded.length, 1, 'Teardown must reject before launching any late child')
  } finally {
    for (const track of tracks) { await stopOwnedChild(track); await awaitOwnedClose(track) }
  }
})
