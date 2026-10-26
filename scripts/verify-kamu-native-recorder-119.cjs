// QA-only recorder on/off/on counterfactual. Never product or visual acceptance.
// Same existing action clock, stage, material, preferences and capture parameters.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const { execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { installRendererObserver, withRestoration } = require('./verify-kamu-native-compositor-119.cjs')

// Off has no recording object and no fabricated FPS. Preserve originals on failed
// input by allowing the existing recorder to finish writing before rethrowing.
async function runPhaseCapture({ enabled, name, action, record, wait }) {
  if (!enabled) { await action(); await wait(250); return { recorderEnabled: false } }
  let failure
  const recording = await record(name, async () => { try { await action() } catch (error) { failure = error } }, 250)
  return { recorderEnabled: true, recording, failure }
}

function nativeSnapshot(electron) {
  const candidates = electron.BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && /\/renderer\/index\.html(?:[?#]|$)/.test(w.webContents.getURL()))
  if (candidates.length !== 1) throw Error('Recorder diagnostic requires exactly one packaged launcher window')
  const w = candidates[0], display = electron.screen.getDisplayMatching(w.getBounds())
  return { windowId: w.id, webContentsId: w.webContents.id, bounds: w.getBounds(), visible: w.isVisible(), minimized: w.isMinimized(), focused: w.isFocused(), appHidden: electron.app.isHidden(), backgroundThrottling: w.webContents.getBackgroundThrottling(), activeDisplay: { id: display.id, scaleFactor: display.scaleFactor, displayFrequency: display.displayFrequency } }
}

function assertSameWindow(before, after) {
  assert.equal(after.windowId, before.windowId, 'diagnostic cannot move to another native window')
  assert.equal(after.webContentsId, before.webContentsId, 'diagnostic cannot change renderer')
  assert.deepEqual(after.bounds, before.bounds, 'window bounds must stay unchanged')
  assert.equal(after.backgroundThrottling, before.backgroundThrottling, 'background throttling must stay unchanged')
  assert(after.visible && after.focused && !after.minimized && !after.appHidden, 'actual foreground window required')
}

function evidenceStage(value) {
  if (value === undefined || value === '') return 'standalone-' + randomUUID()
  assert(['app', 'dmg'].includes(value), 'recorder stage must be app or dmg')
  return value
}

// Counterfactual phases must share the final LOGO footprint. This is an actual
// renderer/CSS readiness observation, never an extra warm-up or fixed delay.
function introSettled(state) {
  return state.activation === 1 && state.introAnimations === 0 &&
    Number.isFinite(state.footprint?.width) && state.footprint.width > 0 &&
    Number.isFinite(state.footprint?.height) && state.footprint.height > 0
}

async function diagnostic(h, options = {}) {
  const { call, evaluate, main, nav, wait, recordScreencast, version } = h
  assert.equal(await main('process.platform'), 'darwin', 'recorder counterfactual requires Darwin')
  const traceEnabled = options.enabled === true || process.env.KAMUCL_NATIVE_RECORDER_TRACE119 === '1'
  const theme = process.env.KAMUCL_TEST_THEME || 'black-orange'
  const stage = evidenceStage(process.env.KAMUCL_NATIVE_RECORDER_STAGE119)
  const mode = traceEnabled ? 'traced-' : ''
  const stem = `kamu-native-recorder-119-${stage}-${mode}${theme}`
  const file = path.resolve('out', `kamu-native-recorder-diagnostic-119-${stage}-${mode}${theme}.json`)
  assert(!fs.existsSync(file), 'immutable recorder evidence already exists; use a fresh output directory')
  const proof = { version, stage, file, complete: false, classification: 'QA-only recorder on/off/on diagnostic, not performance or visual acceptance', traceEnabled, hardwareListening: 'not performed', normalAcceptanceChanged: false, startedAt: new Date().toISOString(), cases: [] }
  const persist = () => fs.writeFileSync(file, JSON.stringify(proof, null, 2))
  const native = () => main(`(${nativeSnapshot.toString()})(testElectron)`)
  const saved = () => evaluate("window.kamucl.invoke('mascots:state')")
  const snapshot = () => evaluate(`(()=>{const e=document.querySelector('.mascot-stage'),b=document.querySelector('[data-hit=kamu]'),strip=e?.querySelector('.figure-strip'),r=strip?.getBoundingClientRect();return{now:performance.now(),timeOrigin:performance.timeOrigin,open:!!e,readyAt:Number(e?.dataset.readyAt),activation:Number(e?.dataset.activation),introAnimations:strip?.getAnimations().filter(a=>a.playState!=='finished'&&a.playState!=='idle').length,footprint:r?{width:r.width,height:r.height}:null,phase:e?.dataset.phase,queue:Number(e?.dataset.queue),contacts:Number(e?.dataset.contacts),sounds:Number(e?.dataset.soundsPlayed),disabled:b?.disabled,hidden:document.hidden,focus:document.hasFocus(),visibility:document.visibilityState,backend:e?.dataset.renderBackend,bufferPreparation:e?.dataset.audioPreparation}})()`)
  const until = async (label, predicate) => {
    const start = Date.now(); let s
    do { s = await snapshot(); if (await predicate(s)) return s; await wait(50) } while (Date.now() - start < 10000)
    proof.failure = { label, last: s }; persist(); assert.fail(label + ': ' + JSON.stringify(s))
  }
  const click = async selector => {
    const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Missing/disabled trusted target');const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(hit!==e&&!e.contains(hit))throw Error('Occluded trusted target');return{x,y}})()`)
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  }
  const captureNative = (name, state) => {
    const bounds = [state.bounds.x, state.bounds.y, state.bounds.width, state.bounds.height].map(Math.round)
    assert(bounds.every(Number.isFinite) && bounds[2] > 0 && bounds[3] > 0, 'valid native bounds required')
    const target = path.resolve('out', `extension-native-recorder-119-${stage}-${mode}${name}-${theme}.png`)
    assert(!fs.existsSync(target), 'refusing to overwrite native diagnostic pixels')
    execFileSync('/usr/sbin/screencapture', ['-x', '-R' + bounds.join(','), target], { timeout: 10000 })
    const data = fs.readFileSync(target)
    assert(data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'actual native PNG required')
    return { file: target, bounds: state.bounds, pixelWidth: data.readUInt32BE(16), pixelHeight: data.readUInt32BE(20), bytes: data.length, source: 'native screen pixels outside measured action; diagnostic only' }
  }
  let ownsStage = false, observerAttempted = false
  const run = async () => withRestoration(async () => {
    await nav('skins')
    assert.equal((await snapshot()).open, false, 'prior diagnostic must close its own stage')
    proof.preferencesBefore = (await saved()).sound
    assert(!proof.preferencesBefore.muted && proof.preferencesBefore.volume > 0, 'audible existing preferences required, never rewritten')
    proof.nativeInitial = await native()
    assertSameWindow(proof.nativeInitial, proof.nativeInitial)
    ownsStage = true; await click('.brand-avatar')
    proof.ready = await until('same stage ready', s => s.open && !s.disabled && s.readyAt > 0 && s.bufferPreparation === 'ended' && s.phase === 'front' && s.queue === 0)
    proof.introComplete = await until('actual LOGO introduction finished', introSettled)
    assert.equal(await evaluate('!!window.__kamuCompositorDiag'), false, 'cannot overwrite another observer')
    observerAttempted = true
    proof.observer = await evaluate(`(${installRendererObserver.toString()})()`)
    for (const [name, enabled] of [['recorder-on', true], ['recorder-off', false], ['recorder-restored', true]]) {
      const entry = { name, recorderEnabled: enabled, startedAt: new Date().toISOString(), traceEnabled }; proof.cases.push(entry); persist()
      entry.nativeBefore = await native(); assertSameWindow(proof.nativeInitial, entry.nativeBefore)
      entry.before = await snapshot(); entry.savedBefore = await saved()
      assert.equal(entry.before.readyAt, proof.ready.readyAt, 'same live stage required')
      assert.equal(entry.before.backend, proof.ready.backend, 'same rendering backend required')
      assert.equal(entry.before.phase, 'front'); assert.equal(entry.before.queue, 0)
      assert(introSettled(entry.before), 'counterfactual must begin after actual introduction')
      assert.deepEqual(entry.before.footprint, proof.introComplete.footprint, 'counterfactual footprint must stay unchanged')
      assert(!entry.before.hidden && entry.before.focus, 'real visible focused document required')
      assert.deepEqual(entry.savedBefore.sound, proof.preferencesBefore)
      entry.beforeScreenshot = captureNative(name + '-before', entry.nativeBefore)
      await evaluate('window.__kamuCompositorDiag.start()')
      await withRestoration(async () => {
        const result = await runPhaseCapture({ enabled, name: `kamu-native-recorder-119-${stage}-${mode}${name}`, record: recordScreencast, wait, action: async () => {
          entry.inputs = []
          for (let i = 0; i < 10; i++) { await click('[data-hit=kamu]'); entry.inputs.push({ ordinal: i + 1, deliveredAt: Date.now() }) }
          entry.completed = await until(name + ' exact natural completion', async s => s.phase === 'front' && s.queue === 0 && s.contacts === entry.before.contacts + 10 && s.sounds === entry.before.sounds + 10 && (await saved()).counts.kamu === entry.savedBefore.counts.kamu + 10)
        } })
        if (result.recording) entry.recording = result.recording
        persist()
        if (result.failure) throw result.failure
      }, async () => { entry.observations = await evaluate('window.__kamuCompositorDiag.stop()'); entry.finishedAt = new Date().toISOString(); persist() }, async () => {})
      entry.nativeAfter = await native(); assertSameWindow(proof.nativeInitial, entry.nativeAfter)
      entry.after = await snapshot(); entry.savedAfter = await saved()
      entry.afterScreenshot = captureNative(name + '-after', entry.nativeAfter)
      const o = entry.observations, gaps = series => series.slice(1).map((s, i) => s.at - series[i].at)
      entry.cadence = { sampleIntervals: gaps(o.samples), rafIntervals: gaps(o.raf), timerIntervals: gaps(o.timers), sourceIntervals: gaps(o.sources), activeGaps: o.samples.slice(1).flatMap((s, i) => s.at - o.samples[i].at > 100 && (s.phase !== 'front' || o.samples[i].phase !== 'front') ? [{ prior: o.samples[i], next: s, ms: s.at - o.samples[i].at }] : []) }
      if (enabled) {
        assert(entry.recording.frames.length >= 2 && Number.isFinite(entry.recording.fps) && entry.recording.fps > 0, 'actual original recording required')
        entry.benchmark = require('./mascot-capture-budget.cjs')(entry.nativeBefore, entry.recording.fps)
        entry.benchmark.status = entry.benchmark.passed ? 'passed' : 'below-target'
      }
      persist()
      assert.equal(o.sources.length, 10, 'ten actual palm sources required')
      assert(o.sources.every(s => s.role === 'palm' && s.state === 'running'), 'no initialization or artificial sources')
      assert(entry.cadence.sourceIntervals.every(ms => ms >= 90), 'unchanged actual source spacing')
      assert(o.samples.length >= 2 && o.samples.every(s => !s.hidden && s.focus), 'actual foreground samples required')
      assert(o.samples.slice(1).every((s, i) => s.contacts - o.samples[i].contacts <= 1), 'contacts cannot catch up within one observed frame')
      const seen = new Set(o.samples.filter(s => s.phase === 'slap' && s.palm > 0).map(s => s.contacts))
      assert(Array.from({ length: 10 }, (_, i) => entry.before.contacts + i + 1).every(n => seen.has(n)), 'every contact needs an actual visible palm sample')
      assert.equal(entry.after.readyAt, proof.ready.readyAt)
      assert.deepEqual(entry.savedAfter.sound, proof.preferencesBefore)
      entry.observationComplete = true; persist()
    }
    proof.recorderRestored = proof.cases[2].recorderEnabled && proof.cases[2].recording.frames.length >= 2
    assert(proof.recorderRestored, 'final phase must use the original recorder again')
  }, async () => {
    if (observerAttempted && await evaluate('!!window.__kamuCompositorDiag')) {
      proof.observerRestored = await evaluate('window.__kamuCompositorDiag.restore()'); persist()
      assert(proof.observerRestored.restored && proof.observerRestored.observerRemoved, 'restore every observer hook')
    }
  }, async () => {
    if (ownsStage && (await snapshot()).open) {
      await click('.menu-tool'); await click('.sound-panel button:last-of-type'); await until('owned stage closes', s => !s.open)
    }
    proof.preferencesAfter = (await saved()).sound
    if (proof.preferencesBefore) assert.deepEqual(proof.preferencesAfter, proof.preferencesBefore)
    proof.nativeFinal = await native(); if (proof.nativeInitial) assertSameWindow(proof.nativeInitial, proof.nativeFinal)
    persist()
  })
  try {
    persist()
    if (traceEnabled) await require('./native-compositor-trace-119.cjs')(h, run, { enabled: true, separateRun: true, outputBase: path.resolve('out', stem + '-trace') })
    else await run()
    proof.complete = true
  } catch (error) { proof.error = String(error); if (error.errors) proof.errors = error.errors.map(String); throw error }
  finally { proof.finishedAt = new Date().toISOString(); persist() }
  console.log('DIAGNOSTIC recorder on/off/on complete; off has no recording or FPS; independent acceptance unchanged')
  return proof
}
module.exports = diagnostic
module.exports.runPhaseCapture = runPhaseCapture
module.exports.nativeSnapshot = nativeSnapshot
module.exports.assertSameWindow = assertSameWindow
module.exports.evidenceStage = evidenceStage
module.exports.introSettled = introSettled
