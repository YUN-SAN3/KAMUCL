const test = require('node:test'), assert = require('node:assert/strict')
const { runPhaseCapture, nativeSnapshot, assertSameWindow, evidenceStage, introSettled } = require('../scripts/verify-kamu-native-recorder-119.cjs')
const { withRestoration } = require('../scripts/verify-kamu-native-compositor-119.cjs')
const { redactEvents } = require('../scripts/native-compositor-trace-119.cjs')

test('counterfactual observes both model activation and CSS introduction instead of delaying or accepting an intermediate footprint', () => {
  const ready = { activation: 1, introAnimations: 0, footprint: { width: 48, height: 72 } }
  assert.equal(introSettled(ready), true)
  assert.equal(introSettled({ ...ready, activation: .9 }), false)
  assert.equal(introSettled({ ...ready, introAnimations: 1 }), false)
  assert.equal(introSettled({ ...ready, introAnimations: undefined }), false)
  assert.equal(introSettled({ ...ready, footprint: null }), false)
})

test('APP and DMG evidence cannot collide; standalone diagnostics get separate immutable identities', () => {
  assert.equal(evidenceStage('app'), 'app'); assert.equal(evidenceStage('dmg'), 'dmg')
  const a = evidenceStage(), b = evidenceStage(); assert.notEqual(a, b); assert.match(a, /^standalone-[0-9a-f-]+$/)
  assert.throws(() => evidenceStage('../app'), /stage must be/)
  assert.throws(() => evidenceStage('arbitrary-private-text'), /stage must be/)
})

test('recorder off retains the actual action and tail without invoking a recorder or fabricating timing', async () => {
  const calls = []
  const result = await runPhaseCapture({ enabled: false, name: 'off', action: async () => calls.push('real-action'), record: async () => { throw Error('must not record') }, wait: async ms => calls.push(ms) })
  assert.deepEqual(calls, ['real-action', 250])
  assert.deepEqual(result, { recorderEnabled: false })
  assert(!('recording' in result) && !('fps' in result) && !('benchmark' in result))
})

test('recorder on failure flushes unchanged raw recording and original error before independent restorations', async () => {
  const original = Error('native target occluded'), restoreError = Error('native cleanup failed')
  const recording = { fps: 17.2, frames: [{ timestamp: 10 }, { timestamp: 10.058 }] }, calls = []
  const result = await runPhaseCapture({ enabled: true, name: 'owned-recording', action: async () => { calls.push('input'); throw original }, record: async (name, action, tail) => { assert.equal(name, 'owned-recording'); assert.equal(tail, 250); await action(); calls.push('raw-flushed'); return recording }, wait: async () => assert.fail('extra delay') })
  assert.equal(result.recording, recording); assert.equal(result.failure, original)
  await assert.rejects(withRestoration(async () => { throw result.failure }, async () => { calls.push('hooks-restored'); throw restoreError }, async () => calls.push('stage-closed')), error => error instanceof AggregateError && error.errors[0] === original && error.errors[1] === restoreError)
  assert.deepEqual(calls, ['input', 'raw-flushed', 'hooks-restored', 'stage-closed'])
})

test('off input failure stays failure and cannot silently advance to restored-on', async () => {
  const original = Error('natural queue did not drain'); let waited = false
  await assert.rejects(runPhaseCapture({ enabled: false, action: async () => { throw original }, wait: async () => { waited = true }, record: async () => assert.fail('recorder called') }), error => error === original)
  assert.equal(waited, false)
})

test('native snapshot reads real focus and throttling and refuses an ambiguous window without mutation', () => {
  let reads = 0
  const window = { id: 7, isDestroyed: () => false, getBounds: () => ({ x: 0, y: 25, width: 1024, height: 684 }), isVisible: () => true, isMinimized: () => false, isFocused: () => true, webContents: { id: 8, getURL: () => 'file:///KAMUCL/renderer/index.html', getBackgroundThrottling: () => { reads++; return true } } }
  const electron = { BrowserWindow: { getAllWindows: () => [window] }, app: { isHidden: () => false }, screen: { getDisplayMatching: () => ({ id: 2, scaleFactor: 2, displayFrequency: 59.9 }) } }
  const before = nativeSnapshot(electron)
  assert.equal(reads, 1); assert.equal(before.backgroundThrottling, true); assertSameWindow(before, before)
  assert.throws(() => assertSameWindow(before, { ...before, windowId: 9 }), /another native window/)
  assert.throws(() => assertSameWindow(before, { ...before, backgroundThrottling: false }), /throttling/)
  assert.throws(() => assertSameWindow(before, { ...before, focused: false }), /foreground/)
  electron.BrowserWindow.getAllWindows = () => [window, { ...window, id: 9 }]
  assert.throws(() => nativeSnapshot(electron), /exactly one/)
})

test('new compositor recording names retain original numeric fields, never capture text, URLs or image payloads', () => {
  const names = ['CopyOutputRequest::SendResult', 'DirectRenderer::DrawRenderPass', 'SoftwareRenderer::DrawQuad', 'SoftwareRenderer::CopyDrawnRenderPass', 'FrameSinkVideoCapturerImpl::Capture', 'CaptureFrame']
  const input = names.map((name, i) => ({ name, cat: 'viz', ph: 'X', ts: 100 + i, dur: 30, tdur: 5, pid: 1, tid: 2, args: { data: { width: 48, height: 72, url: 'https://private.invalid', value: 'typed secret', clip: [0, 0, 48, 72] }, screenshot: 'base64-private', path: '/private/user', type: 'private text', frame_token: 12 } }))
  input.push({ name: 'CaptureFrame https://private.invalid', cat: 'viz', ph: 'X', ts: 200 }, { name: 'CaptureFrame', cat: 'blink.user_timing', ph: 'R', ts: 201 })
  const clean = redactEvents(input, 'our-marker')
  assert.equal(clean.length, names.length)
  clean.forEach((event, i) => { assert.equal(event.name, names[i]); assert.equal(event.sourceIndex, i); assert.equal(event.ts, 100 + i); assert.equal(event.dur, 30); assert.equal(event.tdur, 5); assert.deepEqual(event.args, { data: { width: 48, height: 72, clip: [0, 0, 48, 72] }, frame_token: 12 }) })
  assert(!JSON.stringify(clean).includes('private')); assert(!JSON.stringify(clean).includes('secret'))
})
