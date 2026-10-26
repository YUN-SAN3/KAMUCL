const test = require('node:test'), assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { preserveBusinessFailure, ownChild, awaitOwnedClose, stopOwnedChild, selectOwnedExecutable } = require('../scripts/verify-linux-business.cjs')

test('Linux native QA preserves the original operation error when cleanup and evidence saving also fail', async () => {
  const original = Object.assign(new Error('original graphics or business failure'), { code: 'ERR_ASSERTION' }), stack = original.stack
  const cleanup = new Error('owned child cleanup failed'), saving = new Error('readonly output location'), report = { complete: false }
  await assert.rejects(preserveBusinessFailure(report, async () => { throw original }, async () => { throw cleanup }, async () => { throw saving }), error => error === original)
  assert.equal(original.stack, stack); assert.equal(report.error.code, 'ERR_ASSERTION')
  assert.deepEqual(report.secondaryErrors.map(row => [row.stage, row.message]), [['owned-cleanup', cleanup.message], ['evidence-save', saving.message]])
  assert.equal(report.complete, false)
})
test('Linux native QA never writes complete=true after an owned cleanup failure', async () => {
  const original = new Error('owned cleanup failed'), snapshots = [], report = { complete: false }
  await assert.rejects(preserveBusinessFailure(report, async () => { report.complete = true }, async () => { throw original }, () => { snapshots.push(JSON.parse(JSON.stringify(report))) }), error => error === original)
  assert.equal(snapshots.length, 1); assert.equal(snapshots[0].complete, false); assert.equal(snapshots[0].error.message, original.message)
})
test('Linux native QA observes a real private child normal exit and only signals its own live child', { timeout: 10000 }, async t => {
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("fixture-ready\\n");setTimeout(()=>process.exit(0),150)'], { stdio: ['ignore', 'pipe', 'pipe'] })
  const natural = ownChild(child, 'test-created natural child')
  t.after(() => stopOwnedChild(natural))
  let output = ''; child.stdout.on('data', bytes => { output += bytes })
  assert.equal((await awaitOwnedClose(natural)).code, 0); assert.equal(output, 'fixture-ready\n')
  assert.deepEqual(natural.ledger.events.map(event => event.event), ['exit', 'close'])
  const live = ownChild(spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }), 'test-created live child')
  t.after(() => stopOwnedChild(live))
  await stopOwnedChild(live)
  assert(live.ledger.closed); assert(live.ledger.events.some(event => event.event === 'owned-SIGTERM'))
  await stopOwnedChild(natural); assert(!natural.ledger.events.some(event => event.event === 'owned-SIGTERM'), 'A naturally exited child is never signalled')
})
test('Linux update observer selects only the single same-user private executable main, allowing its linked renderer children', () => {
  const expected = { exe: '/private/owned-123/KAMUCL/kamucl', uid: 1001 }
  const main = { pid: 701, ppid: 600, uid: 1001, exe: expected.exe, startTime: '30000' }
  const renderer = { pid: 702, ppid: 701, uid: 1001, exe: expected.exe, startTime: '30001' }
  const other = { pid: 703, ppid: 600, uid: 1001, exe: '/private/not-owned/KAMUCL/kamucl', startTime: '30002' }
  const otherUser = { pid: 704, ppid: 600, uid: 1002, exe: expected.exe, startTime: '30003' }
  assert.equal(selectOwnedExecutable([main, renderer, other, otherUser], expected), main)
  assert.equal(selectOwnedExecutable([other, otherUser, { ...main, startTime: '' }], expected), null)
  assert.throws(() => selectOwnedExecutable([main, { ...main, pid: 705, startTime: '30004' }], expected), /multiple instances/)
})
