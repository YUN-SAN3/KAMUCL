// Optional, independent ScreenCaptureKit observation. No CDP recording is used
// here, and no result replaces or changes normal CDP performance evidence.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { spawn, execFile } = require('node:child_process'), { promisify } = require('node:util')
const { createHash } = require('node:crypto')
const { installRendererObserver, withRestoration } = require('./verify-kamu-native-compositor-119.cjs')
const { evidenceStage, introSettled } = require('./verify-kamu-native-recorder-119.cjs')

function nativeVideoSnapshot(electron, pid) {
  const candidates = electron.BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && /\/renderer\/index\.html(?:[?#]|$)/.test(w.webContents.getURL()))
  if (candidates.length !== 1) throw Error('Native video requires one owned launcher window')
  const w = candidates[0], d = electron.screen.getDisplayMatching(w.getBounds())
  return { ownerPID: pid, windowId: w.id, webContentsId: w.webContents.id, bounds: w.getBounds(), contentBounds: w.getContentBounds(), zoom: w.webContents.getZoomFactor(), visible: w.isVisible(), focused: w.isFocused(), minimized: w.isMinimized(), appHidden: electron.app.isHidden(), backgroundThrottling: w.webContents.getBackgroundThrottling(), backgroundColor: w.getBackgroundColor(), opacity: w.getOpacity(), activeDisplay: { id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor, displayFrequency: d.displayFrequency } }
}

function captureRequest(native, state) {
  assert(native.visible && native.focused && !native.minimized && !native.appHidden && !state.hidden && state.focus, 'actual foreground visible UI required')
  const c = native.contentBounds, r = state.footprint, z = native.zoom, display = native.activeDisplay
  assert(Number.isFinite(z) && z > 0 && Number.isFinite(display.scaleFactor) && display.scaleFactor > 0, 'actual native zoom and backing scale required')
  assert(Math.abs(c.width / z - state.viewport.width) < 2 && Math.abs(c.height / z - state.viewport.height) < 2, 'DOM viewport must match native content bounds at actual zoom')
  assert(state.viewport.scale === 1, 'unexpected visual viewport pinch scale; refuse guessed crop')
  assert(r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0, 'actual settled LOGO rectangle required')
  const x = Math.max(c.x, Math.floor(c.x + (r.x - 12) * z)), y = Math.max(c.y, Math.floor(c.y + (r.y - 12) * z))
  const right = Math.min(c.x + c.width, Math.ceil(c.x + (r.x + r.width + 12) * z)), bottom = Math.min(c.y + c.height, Math.ceil(c.y + (r.y + r.height + 12) * z))
  const crop = { x, y, width: right - x, height: bottom - y }, d = display.bounds
  assert(crop.width > 0 && crop.height > 0 && crop.width <= 256 && crop.height <= 256, 'bounded native LOGO crop required')
  assert(crop.x >= d.x && crop.y >= d.y && right <= d.x + d.width && bottom <= d.y + d.height, 'crop cannot cross the actual display')
  return { displayID: display.id, ownerPID: native.ownerPID, windowBounds: native.bounds, crop, expectedScale: display.scaleFactor }
}

function captureStatistics(capture, markers) {
  const complete = capture.frames.filter(f => f.complete === true && f.validSample === true && f.file && f.presentationTime?.numeric === true && Number.isFinite(f.presentationTime.seconds))
  assert(complete.length >= 2, 'at least two actual complete native pixel frames required')
  const intervals = complete.slice(1).map((f, i) => f.presentationTime.seconds - complete[i].presentationTime.seconds)
  assert(intervals.every(v => v > 0), 'native complete PTS must actually increase; do not reorder or rewrite them')
  const elapsed = complete.at(-1).presentationTime.seconds - complete[0].presentationTime.seconds
  const changed = complete.filter((f, i) => i === 0 || f.sha256 !== complete[i - 1].sha256)
  let activeWindow = null
  if (markers) {
    const begin = BigInt(markers.start.clock.machAbsoluteTime), end = BigInt(markers.complete.clock.machAbsoluteTime)
    assert(end > begin, 'real native action markers must increase')
    const frames = complete.filter(frame => { const at = BigInt(frame.callbackClock.machAbsoluteTime); return at >= begin && at <= end })
    assert(frames.length >= 2, 'actual native action interval needs complete pixel frames')
    const seconds = frames.at(-1).presentationTime.seconds - frames[0].presentationTime.seconds
    activeWindow = { sampleIndices: frames.map(frame => frame.index), completeSampleCount: frames.length, elapsedPTS: seconds, completeDeliveryFps: (frames.length - 1) / seconds,
      selection: 'Actual sample callback machAbsoluteTime between acknowledged pre-click start and observed natural completion markers. PTS remains original; callback and presentation timestamps are not assumed identical.' }
  }
  return { allSampleCount: capture.frames.length, completePixelSampleCount: complete.length, nonCompleteOrInvalidCount: capture.frames.length - complete.length,
    completeDeliveryFps: (complete.length - 1) / elapsed, elapsedPTS: elapsed, completePTSIntervals: intervals,
    changedPixelCount: changed.length, changedPixelUpdatesPerSecond: (changed.length - 1) / elapsed,
    samePixelsAsPreviousComplete: complete.length - changed.length,
    statuses: capture.frames.reduce((counts, frame) => (counts[frame.status] = (counts[frame.status] || 0) + 1, counts), {}),
    dropCount: capture.dropCount, dropCountKnown: capture.dropCountKnown, activeWindow,
    interpretation: 'Whole capture actual complete-sample delivery rate includes naturally repeated complete images, reported separately; idle/non-complete samples never count as updates. Pixel-change rate is not a motion FPS or a replacement threshold.' }
}

async function bounded(promise, ms, label) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ' timed out')), ms) })]) }
  finally { clearTimeout(timer) }
}

async function stopOwnedHelper(child, exitPromise, requestStop, timeout = 5000) {
  const pid = child.pid
  assert(Number.isInteger(pid) && pid > 0, 'only the spawned capture helper may be stopped')
  try { requestStop(); return await bounded(exitPromise, timeout, 'native stream graceful stop') }
  catch (original) {
    // Never kill by name or process group. This child is a disposable QA helper.
    if (child.exitCode === null && child.signalCode === null && child.pid === pid) child.kill('SIGTERM')
    try { await bounded(exitPromise, 1000, 'owned helper termination') }
    catch { if (child.exitCode === null && child.signalCode === null && child.pid === pid) child.kill('SIGKILL'); await bounded(exitPromise, 1000, 'owned helper forced exit') }
    throw original
  }
}

async function verifyPixels(directory, capture) {
  const sharp = require('sharp'), converted = []
  for (const frame of capture.frames) {
    if (!frame.file) continue
    assert(/^frame-\d{6}\.bgra$/.test(frame.file), 'untrusted native frame path')
    assert(Number.isInteger(frame.width) && frame.width > 0 && frame.width <= 1024 && Number.isInteger(frame.height) && frame.height > 0 && frame.height <= 1024, 'valid bounded pixel dimensions required')
    const raw = fs.readFileSync(path.join(directory, frame.file))
    assert.equal(raw.length, frame.width * frame.height * 4); assert.equal(createHash('sha256').update(raw).digest('hex'), frame.sha256, 'original native pixel SHA must match')
    // Lossless BGRA -> RGBA channel ordering after the stream has stopped. No
    // resizing, frame interpolation, alpha removal or time/base-rate conversion.
    const rgba = Buffer.from(raw)
    for (let i = 0; i < rgba.length; i += 4) { const b = rgba[i]; rgba[i] = rgba[i + 2]; rgba[i + 2] = b }
    const png = frame.file.replace(/\.bgra$/, '.png'), target = path.join(directory, png)
    assert(!fs.existsSync(target), 'refusing to replace a native PNG')
    await sharp(rgba, { raw: { width: frame.width, height: frame.height, channels: 4 } }).png().toFile(target)
    const decoded = await sharp(target).ensureAlpha().raw().toBuffer()
    assert(decoded.equals(rgba), 'derived PNG must preserve every original RGBA byte')
    converted.push({ index: frame.index, file: png, original: frame.file, originalSHA256: frame.sha256, sha256: createHash('sha256').update(fs.readFileSync(target)).digest('hex'), losslessPixelsVerified: true })
  }
  return converted
}

async function diagnostic(h) {
  const { main, evaluate, call, nav, wait, version } = h
  assert.equal(await main('process.platform'), 'darwin', 'ScreenCaptureKit requires actual Darwin')
  const stage = evidenceStage(process.env.KAMUCL_NATIVE_VIDEO_STAGE119), theme = process.env.KAMUCL_TEST_THEME || 'black-orange'
  const stem = `kamu-native-video-119-${stage}-${theme}`, directory = path.resolve('out', stem), file = path.resolve('out', `kamu-native-video-diagnostic-119-${stage}-${theme}.json`)
  assert(!fs.existsSync(directory) && !fs.existsSync(file), 'native-video evidence is immutable; use a fresh stage')
  fs.mkdirSync(directory, { recursive: true })
  const proof = { version, stage, directory, file, complete: false, functionalComplete: false, classification: 'Independent optional ScreenCaptureKit visible LOGO observation; never replaces normal CDP recording, benchmark, or earlier failures', normalCDPChanged: false, traceEnabled: false, hardwareListening: 'not performed', startedAt: new Date().toISOString() }
  const persist = () => fs.writeFileSync(file, JSON.stringify(proof, null, 2))
  const native = () => main(`(${nativeVideoSnapshot.toString()})(testElectron,process.pid)`)
  const state = () => evaluate(`(()=>{const e=document.querySelector('.mascot-stage'),strip=e?.querySelector('.figure-strip'),r=strip?.getBoundingClientRect(),b=document.querySelector('[data-hit=kamu]');return{now:performance.now(),timeOrigin:performance.timeOrigin,open:!!e,readyAt:Number(e?.dataset.readyAt),activation:Number(e?.dataset.activation),introAnimations:strip?.getAnimations().filter(a=>a.playState!=='finished'&&a.playState!=='idle').length,footprint:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,phase:e?.dataset.phase,queue:Number(e?.dataset.queue),contacts:Number(e?.dataset.contacts||0),sounds:Number(e?.dataset.soundsPlayed||0),disabled:b?.disabled,hidden:document.hidden,focus:document.hasFocus(),bufferPreparation:e?.dataset.audioPreparation,viewport:{width:innerWidth,height:innerHeight,scale:visualViewport?.scale??1},backend:e?.dataset.renderBackend}})()`)
  const saved = () => evaluate("window.kamucl.invoke('mascots:state')")
  const until = async (label, predicate, ms = 6000) => {
    const begin = Date.now(); let last
    do { last = await state(); if (await predicate(last)) return last; await wait(30) } while (Date.now() - begin < ms)
    proof.failureState = { label, last }; persist(); assert.fail(label)
  }
  const click = async selector => {
    const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Missing native video target');const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);if(h!==e&&!e.contains(h))throw Error('Occluded real native video target');return{x,y}})()`)
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...p })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...p })
  }
  let child, exitPromise, operationError, ownsStage = false, observerAttempted = false
  const exitState = { exited: false }
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
  const awaitFile = async (name, ms = 5000) => {
    const begin = Date.now()
    while (!fs.existsSync(path.join(directory, name))) {
      if (exitState.exited) throw Error('Native helper exited before ' + name + ': ' + JSON.stringify(exitState))
      if (Date.now() - begin >= ms) throw Error('Native helper ' + name + ' timed out')
      await wait(20)
    }
    return read(name)
  }
  const mark = async name => { fs.writeFileSync(path.join(directory, name + '.request'), 'requested'); return awaitFile(name + '.json', 2000) }
  try {
    persist()
    const source = path.resolve('scripts/mac-logo-capture-119.swift'), binary = path.join(directory, 'mac-logo-capture')
    proof.compile = { startedAt: new Date().toISOString(), sourceSHA256: createHash('sha256').update(fs.readFileSync(source)).digest('hex') }; persist()
    try {
      const output = await promisify(execFile)('/usr/bin/xcrun', ['swiftc', '-parse-as-library', source, '-o', binary, '-framework', 'ScreenCaptureKit', '-framework', 'AppKit', '-framework', 'CoreMedia', '-framework', 'CoreVideo', '-framework', 'QuartzCore'], { timeout: 20000, maxBuffer: 1024 * 1024 })
      fs.writeFileSync(path.join(directory, 'compile.log'), output.stdout + output.stderr); proof.compile.success = true
      proof.compile.binarySHA256 = createHash('sha256').update(fs.readFileSync(binary)).digest('hex')
    } catch (error) { fs.writeFileSync(path.join(directory, 'compile.log'), String(error.stdout || '') + String(error.stderr || '') + String(error)); throw error }
    finally { proof.compile.finishedAt = new Date().toISOString(); persist() }
    await withRestoration(async () => {
      await nav('skins'); assert.equal((await state()).open, false, 'prior module must close its owned stage')
      proof.preferencesBefore = (await saved()).sound; assert(!proof.preferencesBefore.muted && proof.preferencesBefore.volume > 0)
      ownsStage = true; await click('.brand-avatar')
      proof.ready = await until('actual native LOGO ready and entrance settled', s => s.open && !s.disabled && s.readyAt > 0 && s.bufferPreparation === 'ended' && s.phase === 'front' && s.queue === 0 && introSettled(s))
      proof.nativeBefore = await native(); proof.request = captureRequest(proof.nativeBefore, proof.ready)
      fs.writeFileSync(path.join(directory, 'request.json'), JSON.stringify(proof.request, null, 2))
      assert.equal(await evaluate('!!window.__kamuCompositorDiag'), false, 'do not replace existing observer')
      observerAttempted = true; proof.observer = await evaluate(`(${installRendererObserver.toString()})()`)
      await evaluate('window.__kamuCompositorDiag.start()')
      child = spawn(binary, [path.join(directory, 'request.json'), directory], { stdio: ['ignore', 'pipe', 'pipe'] })
      const output = fs.createWriteStream(path.join(directory, 'helper.log'), { flags: 'wx' })
      child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false })
      exitPromise = new Promise((resolve, reject) => {
        child.once('error', error => { exitState.exited = true; exitState.error = String(error); output.end(); reject(error) })
        child.once('close', (code, signal) => { Object.assign(exitState, { exited: true, code, signal }); output.end(); resolve({ code, signal }) })
      }); exitPromise.catch(() => {})
      proof.helperPID = child.pid; proof.nativeFirstFrame = await awaitFile('ready.json'); persist()
      proof.clickStart = await state(); proof.savedBefore = await saved(); proof.nativeAtFirstFrame = await native()
      assert.deepEqual(captureRequest(proof.nativeAtFirstFrame, proof.clickStart), proof.request, 'capture geometry must remain actual and unchanged')
      proof.startMarker = await mark('clicks-start'); proof.inputs = []
      for (let i = 0; i < 10; i++) { await click('[data-hit=kamu]'); proof.inputs.push({ ordinal: i + 1, deliveredAt: Date.now() }) }
      proof.actionComplete = await until('ten actual contacts/sounds saved with natural front/queue zero', async s => s.phase === 'front' && s.queue === 0 && s.contacts === proof.clickStart.contacts + 10 && s.sounds === proof.clickStart.sounds + 10 && (await saved()).counts.kamu === proof.savedBefore.counts.kamu + 10)
      proof.actionCompleteMarker = await mark('action-complete'); await wait(250)
      proof.nativeAfter = await native(); proof.after = await state(); proof.savedAfter = await saved()
      assert.equal(proof.after.readyAt, proof.ready.readyAt); assert.deepEqual(captureRequest(proof.nativeAfter, proof.after), proof.request)
      for (const key of ['windowId', 'webContentsId', 'backgroundThrottling', 'backgroundColor', 'opacity']) assert.deepEqual(proof.nativeAfter[key], proof.nativeBefore[key], key + ' must stay unchanged')
      assert.deepEqual(proof.savedAfter.sound, proof.preferencesBefore)
    }, async () => {
      if (child?.pid) {
        proof.helperExit = await stopOwnedHelper(child, exitPromise, () => fs.writeFileSync(path.join(directory, 'stop.request'), 'stop owned stream'))
        persist(); assert.equal(proof.helperExit.code, 0, 'native helper must stop successfully')
      }
    }, async () => {
      await withRestoration(async () => {}, async () => {
        if (observerAttempted && await evaluate('!!window.__kamuCompositorDiag')) {
          proof.observations = await evaluate('window.__kamuCompositorDiag.stop()'); proof.observerRestored = await evaluate('window.__kamuCompositorDiag.restore()'); persist()
          assert(proof.observerRestored.restored && proof.observerRestored.observerRemoved)
        }
      }, async () => {
        if (ownsStage && (await state()).open) { await click('.menu-tool'); await click('.sound-panel button:last-of-type'); await until('owned native-video stage closed', s => !s.open) }
        proof.preferencesAfter = (await saved()).sound; if (proof.preferencesBefore) assert.deepEqual(proof.preferencesAfter, proof.preferencesBefore); persist()
      })
    })
    proof.capture = read('capture.json'); assert(proof.capture.complete && proof.capture.streamStopped, 'native capture must complete and drain')
    proof.nativeCadence = captureStatistics(proof.capture, { start: proof.startMarker, complete: proof.actionCompleteMarker })
    assert(proof.nativeCadence.changedPixelCount >= 3, 'native LOGO pixels must actually change across the real action; no blank/frozen capture acceptance')
    proof.nativeDeliveryBenchmark = require('./mascot-capture-budget.cjs')(proof.nativeBefore, proof.nativeCadence.completeDeliveryFps)
    const sources = proof.observations.sources
    assert.equal(sources.length, 10); assert(sources.every(s => s.role === 'palm' && s.state === 'running'))
    proof.sourceIntervals = sources.slice(1).map((s, i) => s.at - sources[i].at)
    assert(proof.sourceIntervals.every(ms => ms >= 90), 'original source interval requirement unchanged')
    assert(proof.observations.samples.every(s => s.focus && !s.hidden), 'foreground samples required')
    proof.functionalComplete = true
  } catch (error) { operationError = error; proof.error = String(error); if (error.errors) proof.errors = error.errors.map(String); throw error }
  finally {
    try {
      if (fs.existsSync(path.join(directory, 'capture.json'))) { proof.capture ??= read('capture.json'); proof.pngs = await verifyPixels(directory, proof.capture) }
      proof.complete = proof.functionalComplete && !!proof.pngs?.length
    } catch (error) { proof.complete = false; proof.pixelVerificationError = String(error); persist(); throw operationError ? new AggregateError([operationError, error], 'Native action and pixel preservation both failed') : error }
    finally { proof.finishedAt = new Date().toISOString(); persist() }
  }
  console.log('INDEPENDENT native LOGO video saved; normal CDP evidence unchanged; native delivery benchmark ' + (proof.nativeDeliveryBenchmark.passed ? 'passed' : 'below-target'))
  return proof
}
module.exports = diagnostic
module.exports.captureRequest = captureRequest
module.exports.captureStatistics = captureStatistics
module.exports.stopOwnedHelper = stopOwnedHelper
module.exports.verifyPixels = verifyPixels
module.exports.nativeVideoSnapshot = nativeVideoSnapshot
