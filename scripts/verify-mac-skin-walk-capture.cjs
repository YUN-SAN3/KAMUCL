// QA only. ScreenCaptureKit's original CMSampleBuffer PTS is the macOS walk
// cadence source; DevTools wall-clock metadata remains a separate diagnostic.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { spawn, execFile, execFileSync } = require('node:child_process'), { promisify } = require('node:util')
const { createHash } = require('node:crypto')
const owned = require('./qa-owned-process-119.cjs')
const { nativeVideoSnapshot, captureStatistics, stopOwnedHelper, verifyPixels } = require('./verify-kamu-native-video-119.cjs')

const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function skinCaptureRequest(native, view) {
  assert(Number.isSafeInteger(native.ownerPID) && native.ownerPID > 0, 'actual native owner PID required')
  assert(native.visible && native.focused && !native.minimized && !native.appHidden && view.focus && !view.hidden, 'actual foreground walking window required')
  const r = view.bounds, c = native.contentBounds, z = native.zoom, d = native.activeDisplay
  assert(Number.isFinite(z) && z > 0 && Number.isFinite(d.scaleFactor) && d.scaleFactor > 0, 'actual native zoom and backing scale required')
  assert(Math.abs(c.width / z - view.viewport.width) < 2 && Math.abs(c.height / z - view.viewport.height) < 2, 'walking viewport must match actual native content bounds')
  assert.equal(view.viewport.scale, 1, 'refuse guessed pinch-scale crop')
  assert(r && [r.x, r.y, r.width, r.height].every(Number.isFinite), 'actual complete walking canvas rectangle required')
  assert(r.hitVisible && r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.x + r.width <= view.viewport.width && r.y + r.height <= view.viewport.height, 'entire walking canvas must be visible and hit-testable')
  assert(r.contextWebGL && !r.contextWebGL.lost && view.pose?.state === 'walk', 'actual live WebGL walking state required')
  const x = Math.floor(c.x + r.x * z), y = Math.floor(c.y + r.y * z)
  const right = Math.ceil(c.x + (r.x + r.width) * z), bottom = Math.ceil(c.y + (r.y + r.height) * z)
  const crop = { x, y, width: right - x, height: bottom - y }
  assert(crop.width <= 512 && crop.height <= 512 && crop.width * d.scaleFactor <= 1024 && crop.height * d.scaleFactor <= 1024, 'whole walking canvas exceeds the explicit capture bound; never crop away a body part')
  assert(x >= c.x && y >= c.y && right <= c.x + c.width && bottom <= c.y + c.height, 'complete crop must remain inside the same native content bounds')
  assert(x >= d.bounds.x && y >= d.bounds.y && right <= d.bounds.x + d.bounds.width && bottom <= d.bounds.y + d.bounds.height, 'complete crop cannot cross the actual display')
  return { capturePurpose: 'skin-walk', displayID: d.id, expectedDisplayBounds: d.bounds, ownerPID: native.ownerPID, windowBounds: native.bounds, crop, expectedScale: d.scaleFactor }
}

function cdpTiming(recording) {
  const frames = recording.frames, failures = []
  if (frames.length < 2) failures.push('insufficient original samples for wall-clock timing')
  if (!frames.every(frame => Number.isFinite(frame.timestamp))) failures.push('non-finite original wall-clock metadata')
  if (!frames.every((frame, index) => index === 0 || frame.timestamp > frames[index - 1].timestamp)) failures.push('original arrival-order wall-clock metadata is not strictly increasing')
  const elapsed = frames.length > 1 ? frames.at(-1).timestamp - frames[0].timestamp : 0
  const intervals = frames.slice(1).map((frame, index) => frame.timestamp - frames[index].timestamp)
  assert.equal(recording.elapsed, elapsed); assert.equal(recording.fps, elapsed ? (frames.length - 1) / elapsed : 0); assert.deepEqual(recording.intervals, intervals)
  const diagnosticThresholdPassed = failures.length === 0 && frames.length >= 10 && recording.fps >= 30
  return { timingUsable: failures.length === 0, failed: !diagnosticThresholdPassed, failures, diagnosticThresholdPassed, nominalMinimumFPS: 30, originalElapsed: elapsed, originalFrameCount: frames.length,
    rawCalculatedFPS: recording.fps, formalCadenceSource: false,
    classification: 'Original arrival-order Page.screencastFrame wall-clock metadata and files retained unchanged. Unusable timing is failed diagnostic evidence, never native presentation FPS.' }
}

function assertCaptureIdentity(capture, request) {
  const i = capture.identity
  assert.equal(i.capturePurpose, 'skin-walk'); assert.equal(i.ownerPID, request.ownerPID); assert.equal(i.displayID, request.displayID)
  assert(Number.isSafeInteger(i.windowID) && i.windowID > 0, 'actual uniquely selected CG window ID required')
  assert.deepEqual(i.windowBounds, request.windowBounds); assert.deepEqual(i.globalCrop, request.crop); assert.equal(i.backingScaleFactor, request.expectedScale)
  assert.deepEqual(i.displayBounds, request.expectedDisplayBounds)
  assert.deepEqual(i.sourceRect, { x: request.crop.x - request.expectedDisplayBounds.x, y: request.crop.y - request.expectedDisplayBounds.y, width: request.crop.width, height: request.crop.height })
  assert.equal(i.pixelFormat, 'BGRA8'); assert.equal(i.minimumFrameInterval.numeric, true); assert.equal(i.minimumFrameInterval.seconds, 0); assert.equal(i.queueDepth, 5)
  assert.equal(i.outputWidth, Math.ceil(request.crop.width * request.expectedScale)); assert.equal(i.outputHeight, Math.ceil(request.crop.height * request.expectedScale))
  assert.equal(capture.complete, true); assert.equal(capture.streamStopped, true)
  assert(Array.isArray(capture.frames) && capture.frames.every((frame, index) => frame.index === index), 'keep every original callback row in original order')
  for (const frame of capture.frames.filter(frame => frame.file)) {
    assert.equal(frame.width, i.outputWidth, 'every actual original pixel row must preserve the full ROI width')
    assert.equal(frame.height, i.outputHeight, 'every actual original pixel row must preserve the full ROI height')
  }
  assert(capture.frames.filter(frame => frame.complete && frame.validSample && frame.file).every(frame => frame.presentationTime?.numeric === true && Number.isFinite(frame.presentationTime.seconds)), 'every complete original pixel frame must retain a finite native PTS')
  const statistics = captureStatistics(capture)
  assert(statistics.completePixelSampleCount >= 10 && statistics.completeDeliveryFps >= 30, 'actual original complete skin-walk PTS must meet 10-frame and fixed 30 FPS minimums')
  return statistics
}

function nativePixelChanges(directory, capture) {
  const complete = capture.frames.filter(frame => frame.complete && frame.validSample && frame.file)
  assert(complete.length >= 10)
  const indices = [...new Set([0, Math.floor(complete.length / 3), Math.floor(complete.length * 2 / 3), complete.length - 1])]
  const samples = indices.map(ordinal => {
    const frame = complete[ordinal]
    assert(/^frame-\d{6}\.bgra$/.test(frame.file), 'unsafe original native pixel filename')
    const pixels = fs.readFileSync(path.join(directory, frame.file))
    assert.equal(pixels.length, frame.width * frame.height * 4); assert.equal(hash(path.join(directory, frame.file)), frame.sha256)
    return { index: frame.index, width: frame.width, height: frame.height, pixels }
  })
  const reference = samples[0], changes = samples.slice(1).map(sample => {
    assert.equal(sample.width, reference.width); assert.equal(sample.height, reference.height); let changed = 0
    for (let i = 0; i < sample.pixels.length; i += 4) if (Math.max(Math.abs(sample.pixels[i] - reference.pixels[i]), Math.abs(sample.pixels[i + 1] - reference.pixels[i + 1]), Math.abs(sample.pixels[i + 2] - reference.pixels[i + 2])) > 12) changed++
    return { index: sample.index, changedPixels: changed, fraction: changed / (sample.width * sample.height) }
  })
  assert(changes.some(sample => sample.fraction > .005), 'natural walking must change original pixels in the complete visible model ROI')
  return { classification: 'Original full-canvas BGRA ROI, no resizing or interpolated frames; unchanged channel delta>12 and changed fraction>0.5% thresholds', samples: samples.map(({ pixels, ...sample }) => sample), changes }
}

function writePNGProjection(directory, capture, pngs) {
  const manifest = path.join(directory, 'capture.json')
  assert.deepEqual(JSON.parse(fs.readFileSync(manifest, 'utf8')), capture, 'PNG projection must refer to the unchanged original manifest')
  assert.equal(pngs.length, capture.frames.filter(frame => frame.file).length, 'project every original pixel frame, including non-complete callbacks')
  const seen = new Set(), originalManifestSHA256 = hash(manifest)
  const projection = { derived: true, classification: 'Lossless PNG projections; original BGRA capture manifest and callback order are unchanged', originalManifest: 'capture.json', originalManifestSHA256,
    frames: pngs.map(png => {
      const original = capture.frames[png.index]
      assert(original && !seen.has(png.index)); seen.add(png.index)
      assert.equal(png.original, original.file); assert.equal(png.originalSHA256, original.sha256); assert.equal(png.losslessPixelsVerified, true)
      assert.equal(png.file, original.file.replace(/\.bgra$/, '.png')); assert.equal(hash(path.join(directory, png.file)), png.sha256)
      const sidecar = path.join(directory, original.file.replace(/\.bgra$/, '.json'))
      assert.deepEqual(JSON.parse(fs.readFileSync(sidecar, 'utf8')), original)
      return { ...png, complete: original.complete, validSample: original.validSample, presentationTime: original.presentationTime, timestamp: original.presentationTime.seconds ?? null, originalSidecarSHA256: hash(sidecar) }
    }) }
  const file = path.join(directory, 'png-projection.json'); assert(!fs.existsSync(file), 'do not overwrite a native projection')
  fs.writeFileSync(file, JSON.stringify(projection, null, 2))
  return { file: 'png-projection.json', sha256: hash(file), derived: true, originalManifestSHA256 }
}

async function captureWalking(h, initialBounds, action) {
  const { main, evaluate, wait, version } = h
  const theme = process.env.KAMUCL_TEST_THEME, directory = path.resolve('out', 'skin-walk-native-111-' + theme), receiptFile = directory + '.json'
  assert(!fs.existsSync(directory) && !fs.existsSync(receiptFile), 'native walking evidence is immutable; use a fresh run')
  fs.mkdirSync(directory, { recursive: true })
  const proof = { version, theme, directory, complete: false, primaryCadenceSource: 'Original ScreenCaptureKit CMSampleBuffer PTS',
    classification: 'Actual naturally walking complete model ROI on the owned foreground native window; no extra action, movement or generated frame', startedAt: new Date().toISOString() }
  const persist = () => fs.writeFileSync(receiptFile, JSON.stringify(proof, null, 2))
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
  const native = () => main(`(${nativeVideoSnapshot.toString()})(testElectron,process.pid)`)
  const view = () => evaluate(`(()=>{const e=document.querySelector('.viewer3d'),canvas=e?.querySelector('canvas'),r=canvas?.getBoundingClientRect(),gl=canvas&&(canvas.getContext('webgl2')||canvas.getContext('webgl'));return{focus:document.hasFocus(),hidden:document.hidden,viewport:{width:innerWidth,height:innerHeight,scale:visualViewport?.scale??1},bounds:r?{x:r.x,y:r.y,width:r.width,height:r.height,hitVisible:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===canvas,contextWebGL:gl?{type:gl.constructor.name,lost:gl.isContextLost()}:null}:null,pose:{state:e?.dataset.animationState,...JSON.parse(e?.dataset.pose||'{}')}}})()`)
  let child, track, exitPromise, operationError
  const exitState = { exited: false }
  const awaitFile = async name => {
    const begin = Date.now()
    while (!fs.existsSync(path.join(directory, name))) {
      assert(!exitState.exited, 'owned native capture exited before ' + name)
      assert(Date.now() - begin < 5000, 'owned native first-frame deadline exceeded')
      await wait(20)
    }
    return read(name)
  }
  try {
    persist()
    proof.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    proof.runtime = await main("({pid:process.pid,platform:process.platform,arch:process.arch,runtimeVersion:process.versions.electron,embeddedIdentity:JSON.parse(process.mainModule.require('fs').readFileSync(process.mainModule.require('path').join(process.resourcesPath,'kamucl-mac.json'),'utf8'))})")
    assert.equal(proof.runtime.pid, h.ownedTrack?.pid, 'native peer must be the actually spawned owned launcher')
    assert.equal(proof.runtime.platform, 'darwin'); assert.equal(proof.runtime.arch, process.arch)
    assert.equal(proof.runtime.embeddedIdentity.sourceCommit, proof.sourceCommit); assert.equal(proof.runtime.embeddedIdentity.version, version)
    assert.equal(proof.runtime.embeddedIdentity.runtimeVersion, proof.runtime.runtimeVersion); assert.equal(proof.runtime.embeddedIdentity.arch, proof.runtime.arch)
    const source = path.resolve('scripts/mac-logo-capture-119.swift'), binary = path.join(directory, 'mac-skin-walk-capture'), target = process.arch === 'arm64' ? 'arm64-apple-macos13.0' : 'x86_64-apple-macos13.0'
    assert(['arm64', 'x64'].includes(process.arch)); proof.compile = { source: path.relative(process.cwd(), source), sourceSHA256: hash(source), target }
    try {
      const compiled = await promisify(execFile)('/usr/bin/xcrun', ['swiftc', '-parse-as-library', source, '-target', target, '-o', binary, '-framework', 'ScreenCaptureKit', '-framework', 'AppKit', '-framework', 'CoreMedia', '-framework', 'CoreVideo', '-framework', 'QuartzCore'], { timeout: 20000, maxBuffer: 1024 * 1024 })
      fs.writeFileSync(path.join(directory, 'compile.log'), compiled.stdout + compiled.stderr)
    } catch (error) { fs.writeFileSync(path.join(directory, 'compile.log'), String(error.stdout || '') + String(error.stderr || '') + String(error)); throw error }
    assert.equal(execFileSync('lipo', ['-archs', binary], { encoding: 'utf8' }).trim(), process.arch === 'arm64' ? 'arm64' : 'x86_64')
    execFileSync('codesign', ['--force', '--sign', '-', binary]); execFileSync('codesign', ['--verify', '--strict', binary])
    proof.compile.binarySHA256 = hash(binary); proof.compile.signing = 'native ABI and strict ad-hoc signature verified'
    proof.nativeBefore = await native(); proof.viewBefore = await view()
    assert.equal(proof.nativeBefore.ownerPID, h.ownedTrack.pid)
    const { viewportWidth, viewportHeight, ...expectedBounds } = initialBounds
    assert.deepEqual(proof.viewBefore.bounds, expectedBounds, 'capture the same complete walking canvas that passed visibility checks')
    assert.equal(proof.viewBefore.viewport.width, viewportWidth); assert.equal(proof.viewBefore.viewport.height, viewportHeight)
  } catch (error) { operationError = error }
  // Set up and stop the owned stream even if a later CDP diagnostic fails.
  if (!operationError) try {
    proof.request = skinCaptureRequest(proof.nativeBefore, proof.viewBefore)
    fs.writeFileSync(path.join(directory, 'request.json'), JSON.stringify(proof.request, null, 2)); persist()
    child = spawn(path.join(directory, 'mac-skin-walk-capture'), [path.join(directory, 'request.json'), directory], { stdio: ['ignore', 'pipe', 'pipe'] })
    track = owned.trackOwnedChild(child, 'native-skin-walk-' + theme); proof.ownedHelper = track.ledger
    const output = fs.createWriteStream(path.join(directory, 'helper.log'), { flags: 'wx' }); child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false })
    exitPromise = new Promise((resolve, reject) => { child.once('error', error => { exitState.exited = true; output.end(); reject(error) }); child.once('close', (code, signal) => { Object.assign(exitState, { exited: true, code, signal }); output.end(); resolve({ code, signal }) }) }); exitPromise.catch(() => {})
    proof.firstFrame = await awaitFile('ready.json'); proof.recording = await action()
    proof.nativeAfter = await native(); proof.viewAfter = await view()
    assert.deepEqual(skinCaptureRequest(proof.nativeAfter, proof.viewAfter), proof.request, 'same whole canvas/display/window/zoom geometry required throughout capture')
    for (const key of ['ownerPID', 'windowId', 'webContentsId', 'contentBounds', 'zoom', 'activeDisplay', 'backgroundThrottling']) assert.deepEqual(proof.nativeAfter[key], proof.nativeBefore[key], 'native capture identity changed: ' + key)
    assert(proof.viewAfter.pose.seconds > proof.viewBefore.pose.seconds, 'existing natural walk must advance')
  } catch (error) { operationError = error }
  finally {
    if (child?.pid) try { proof.helperExit = await stopOwnedHelper(child, exitPromise, () => fs.writeFileSync(path.join(directory, 'stop.request'), 'stop owned natural walk')); await owned.finishOwnedChild(track, { timeoutMs: 1000 }); assert.equal(proof.helperExit.code, 0) }
    catch (error) { operationError = operationError ? new AggregateError([operationError, error], 'native capture and cleanup failed') : error }
  }
  try {
    if (fs.existsSync(path.join(directory, 'capture.json'))) {
      proof.capture = read('capture.json'); proof.originalManifestSHA256 = hash(path.join(directory, 'capture.json'))
      assert.deepEqual(read('identity.json'), proof.capture.identity, 'original native identity sidecar must match manifest')
      if (proof.firstFrame) { assert.deepEqual(proof.firstFrame.identity, proof.capture.identity); assert.deepEqual(proof.firstFrame.firstFrame, proof.capture.frames[proof.firstFrame.firstFrame.index]) }
      for (const [index, frame] of proof.capture.frames.entries()) {
        assert.equal(frame.index, index, 'preserve every original native callback index')
        assert.deepEqual(read('frame-' + String(index).padStart(6, '0') + '.json'), frame, 'original native sidecar must equal original manifest row')
        if (frame.file) assert.equal(frame.file, 'frame-' + String(index).padStart(6, '0') + '.bgra')
      }
      proof.pngs = await verifyPixels(directory, proof.capture)
      proof.pngProjection = writePNGProjection(directory, proof.capture, proof.pngs)
      if (!operationError) { proof.statistics = assertCaptureIdentity(proof.capture, proof.request); proof.pixelChanges = nativePixelChanges(directory, proof.capture) }
    }
    if (operationError) throw operationError
    assert(proof.capture && proof.pngs.length > 0 && proof.ownedHelper.awaitedClose, 'complete raw native capture, all lossless projections and owned cleanup required')
    proof.complete = true
  } catch (error) { proof.error = { name: error.name, message: error.message }; operationError = error }
  finally { proof.finishedAt = new Date().toISOString(); persist() }
  if (operationError) throw operationError
  return proof
}
module.exports = captureWalking
Object.assign(module.exports, { skinCaptureRequest, cdpTiming, assertCaptureIdentity, nativePixelChanges, writePNGProjection })
