const test = require('node:test'), assert = require('node:assert/strict')
const { dockReopenReady, observeDockReopen } = require('../scripts/mac-reopen-observer.cjs')
const expected = { pid: 123, versionId: 'fabric-native' }
function ready() { return { gameAlive: true, main: { runningRecord: expected, window: { webContentsId: 9, visible: true, minimized: false, bounds: { width: 960, height: 620 } }, events: [{ kind: 'renderer-ready', sender: 9 }, { kind: 'launch-state', sender: 9, state: { status: 'running', versionId: expected.versionId } }] }, renderer: { documentReady: 'complete', visible: true, runningText: '游戏运行中', bounds: { width: 120, height: 40 } } } }
test('Dock observer waits for actual delayed boot/replay and painted running status', async () => {
  let clock = 0; const records = []
  const proof = await observeDockReopen({ expected, now: () => clock, sleep: async ms => { clock += ms }, record: p => records.push(p.ready), snapshot: async () => { const p = ready(); if (clock < 3400) { p.main.events = []; p.renderer.runningText = '就绪' } return p } })
  assert.equal(proof.ready, true); assert.equal(proof.elapsedMs, 3400); assert(records.includes(false))
})
test('Dock observer rejects stale text without current-window replay or visible running UI', () => {
  for (const change of [p => { p.main.events[1].sender = 8 }, p => { p.main.events[1].state.versionId = 'another' }, p => { p.main.events[0].sender = 8 }, p => { p.renderer.visible = false }, p => { p.main.runningRecord = { ...expected, pid: 999 } }, p => { p.renderer.runningText = '游戏运行中（旧）' }]) { const p = ready(); change(p); assert.equal(dockReopenReady(p, expected), false) }
})
test('Dock observer preserves failure when running state never returns, or owned process exits', async () => {
  let clock = 0
  const proof = await observeDockReopen({ expected, timeoutMs: 1000, now: () => clock, sleep: async ms => { clock += ms }, record() {}, snapshot: async () => { const p = ready(); p.main.events = []; return p } })
  assert.equal(proof.ready, false); assert.equal(proof.timedOut, true); assert.equal(proof.elapsedMs, 1000)
  const dead = await observeDockReopen({ expected, record() {}, snapshot: async () => ({ ...ready(), gameAlive: false }) })
  assert.equal(dead.ready, false); assert.equal(dead.samples.length, 1)
})
