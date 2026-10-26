const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { createHash } = require('node:crypto')
const { captureRequest, captureStatistics, stopOwnedHelper, verifyPixels } = require('../scripts/verify-kamu-native-video-119.cjs')
const verifyCollection = require('../scripts/native-video-evidence-119.cjs')

test('native collection cannot silently omit a UUID-stage receipt, but preserves an actual optional failure', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-native-collection-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const args = { root, version: '1.1.9', stage: 'app', startedAt: 0 }
  const directory = path.join(root, 'kamu-native-video-119-app-black-orange'), file = path.join(root, 'kamu-native-video-diagnostic-119-app-black-orange.json')
  fs.writeFileSync(path.join(root, 'kamu-native-video-diagnostic-119-standalone-random-black-orange.json'), '{}')
  assert.throws(() => verifyCollection(args), /missing current/)
  const proof = { version: '1.1.9', stage: 'app', directory, file, complete: false, error: 'Screen recording permission unavailable' }
  fs.writeFileSync(file, JSON.stringify(proof))
  assert.deepEqual(verifyCollection(args), { receipt: path.basename(file), directory: path.basename(directory), collected: true, complete: false, rawFrames: 0, pngFrames: 0, nativeDeliveryBenchmark: null, error: proof.error })
  assert.throws(() => verifyCollection({ ...args, startedAt: Date.now() + 1000 }), /stale/)
  fs.writeFileSync(file, JSON.stringify({ ...proof, stage: 'dmg' }))
  assert.throws(() => verifyCollection(args), /stage must match/)
})

test('native collection verifies immutable raw, timestamp sidecar, lossless PNG and preserves below-target benchmark', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-native-collection-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const directory = path.join(root, 'kamu-native-video-119-dmg-black-orange'), file = path.join(root, 'kamu-native-video-diagnostic-119-dmg-black-orange.json')
  fs.mkdirSync(directory)
  const raw = Buffer.from([12, 34, 56, 255]), name = 'frame-000000.bgra'
  fs.writeFileSync(path.join(directory, name), raw)
  const request = { displayID: 8, ownerPID: 123, crop: { x: 10, y: 20, width: 1, height: 1 }, expectedScale: 1 }
  const identity = { displayID: 8, ownerPID: 123, globalCrop: request.crop, backingScaleFactor: 1 }
  const capture = { identity, frames: [{ index: 0, file: name, width: 1, height: 1, sha256: createHash('sha256').update(raw).digest('hex'), presentationTime: { seconds: 12.3 } }] }
  fs.writeFileSync(path.join(directory, 'capture.json'), JSON.stringify(capture))
  fs.writeFileSync(path.join(directory, 'frame-000000.json'), JSON.stringify(capture.frames[0]))
  const pngs = await verifyPixels(directory, capture), benchmark = { passed: false, actualFps: 28, minimumFps: 30 }
  const nativeFirstFrame = { identity, firstFrame: capture.frames[0], clock: { machAbsoluteTime: '100' } }
  const startMarker = { name: 'clicks-start', clock: { machAbsoluteTime: '110' } }, actionCompleteMarker = { name: 'action-complete', clock: { machAbsoluteTime: '150' } }
  const proof = { version: '1.1.9', stage: 'dmg', directory, file, complete: true, capture, pngs, request, nativeFirstFrame, startMarker, actionCompleteMarker, nativeDeliveryBenchmark: benchmark }
  const metadata = { 'identity.json': identity, 'request.json': request, 'ready.json': nativeFirstFrame, 'clicks-start.json': startMarker, 'action-complete.json': actionCompleteMarker }
  for (const [name, value] of Object.entries(metadata)) fs.writeFileSync(path.join(directory, name), JSON.stringify(value))
  for (const name of ['compile.log', 'helper.log']) fs.writeFileSync(path.join(directory, name), '')
  fs.writeFileSync(file, JSON.stringify(proof))
  const args = { root, version: '1.1.9', stage: 'dmg', startedAt: 0 }, result = verifyCollection(args)
  assert.equal(result.rawFrames, 1); assert.equal(result.pngFrames, 1); assert.deepEqual(result.nativeDeliveryBenchmark, benchmark)
  // Correct pixel hashes alone must not conceal missing identity, altered PTS,
  // duplicated mappings, or files omitted from the receipt.
  for (const name of [...Object.keys(metadata), 'compile.log', 'helper.log']) {
    const target = path.join(directory, name), original = fs.readFileSync(target)
    fs.unlinkSync(target); assert.throws(() => verifyCollection(args), /missing current/); fs.writeFileSync(target, original)
  }
  for (const [name, value] of Object.entries({ ...metadata, 'capture.json': capture, 'frame-000000.json': capture.frames[0] })) {
    const target = path.join(directory, name)
    fs.writeFileSync(target, JSON.stringify({ wrong: true })); assert.throws(() => verifyCollection(args), /must match/)
    fs.writeFileSync(target, JSON.stringify(value))
  }
  for (const altered of [{ ...proof, pngs: [pngs[0], pngs[0]] }, { ...proof, pngs: [{ ...pngs[0], originalSHA256: 'wrong' }] }]) {
    fs.writeFileSync(file, JSON.stringify(altered)); assert.throws(() => verifyCollection(args), /unique matching|original hash/)
  }
  fs.writeFileSync(file, JSON.stringify(proof))
  const extra = path.join(directory, 'frame-000001.bgra'); fs.writeFileSync(extra, raw)
  assert.throws(() => verifyCollection(args), /unreferenced/); fs.unlinkSync(extra)
  const duplicate = { ...proof, capture: { ...capture, frames: [capture.frames[0], capture.frames[0]] } }
  fs.writeFileSync(file, JSON.stringify(duplicate)); fs.writeFileSync(path.join(directory, 'capture.json'), JSON.stringify(duplicate.capture))
  assert.throws(() => verifyCollection(args), /unique original callback order/)
  fs.writeFileSync(file, JSON.stringify({ ...proof, complete: false, error: 'Actual later action failed' }))
  fs.writeFileSync(path.join(directory, 'capture.json'), JSON.stringify(capture))
  const failed = verifyCollection(args); assert.equal(failed.complete, false); assert.equal(failed.error, 'Actual later action failed'); assert.equal(failed.rawFrames, 1)
  fs.writeFileSync(file, JSON.stringify(proof))
  fs.writeFileSync(path.join(directory, name), Buffer.from([0, 0, 0, 0]))
  assert.throws(() => verifyCollection(args), /raw hash/)
})

function geometry() {
  return { native: { ownerPID: 123, bounds: { x: 100, y: 50, width: 1000, height: 700 }, contentBounds: { x: 100, y: 50, width: 1000, height: 700 }, zoom: 2, visible: true, focused: true, minimized: false, appHidden: false, activeDisplay: { id: 8, scaleFactor: 2, bounds: { x: 0, y: 0, width: 1920, height: 1080 } } }, state: { hidden: false, focus: true, viewport: { width: 500, height: 350, scale: 1 }, footprint: { x: 17, y: 47, width: 48, height: 72 } } }
}
test('native crop uses actual content bounds and zoom once, keeps Retina backing scale distinct', () => {
  const { native, state } = geometry(), request = captureRequest(native, state)
  assert.deepEqual(request.crop, { x: 110, y: 120, width: 144, height: 192 })
  assert.equal(request.expectedScale, 2); assert.equal(request.ownerPID, 123); assert.equal(request.displayID, 8)
  assert.throws(() => captureRequest(native, { ...state, viewport: { ...state.viewport, scale: 1.2 } }), /pinch/)
  assert.throws(() => captureRequest({ ...native, focused: false }, state), /foreground/)
  assert.throws(() => captureRequest(native, { ...state, viewport: { ...state.viewport, width: 1000 } }), /viewport/)
  assert.throws(() => captureRequest({ ...native, activeDisplay: { ...native.activeDisplay, bounds: { x: 0, y: 0, width: 150, height: 150 } } }, state), /cross/)
})

test('native statistics preserve original complete timestamps, expose duplicates and exclude idle/invalid updates', () => {
  const make = (index, seconds, hash, status = 'complete') => ({ index, complete: status === 'complete', validSample: true, file: 'frame.bgra', status, sha256: hash, presentationTime: { numeric: true, seconds }, callbackClock: { machAbsoluteTime: String(100 + index * 10) } })
  const frames = [make(0, 2, 'a'), make(1, 2.02, 'a', 'idle'), make(2, 2.04, 'a'), make(3, 2.07, 'b'), make(4, 2.1, 'c')]
  const capture = { frames, dropCount: null, dropCountKnown: false }, before = JSON.stringify(capture)
  const stats = captureStatistics(capture, { start: { clock: { machAbsoluteTime: '120' } }, complete: { clock: { machAbsoluteTime: '140' } } })
  assert.equal(stats.allSampleCount, 5); assert.equal(stats.completePixelSampleCount, 4); assert.equal(stats.nonCompleteOrInvalidCount, 1)
  assert.equal(stats.samePixelsAsPreviousComplete, 1); assert.equal(stats.changedPixelCount, 3)
  assert.equal(stats.dropCount, null); assert.equal(stats.dropCountKnown, false)
  assert.deepEqual(stats.activeWindow.sampleIndices, [2, 3, 4]); assert.equal(JSON.stringify(capture), before)
  assert.throws(() => captureStatistics({ ...capture, frames: [make(0, 3, 'a'), make(1, 2, 'b')] }), /actually increase/)
  assert.throws(() => captureStatistics({ ...capture, frames: [make(0, 3, 'a', 'idle'), make(1, 4, 'b', 'idle')] }), /two actual/)
})

test('serial sink diagnostics never replace original frame rows, statuses or below-target PTS cadence',()=>{
 const frames=[0,1,2].map(index=>({index,complete:true,validSample:true,file:'frame-'+index+'.bgra',status:'complete',sha256:String(index),presentationTime:{numeric:true,seconds:2+index*.05},callbackClock:{machAbsoluteTime:String(100+index)}})),capture={frames,dropCount:null,dropCountKnown:false},before=structuredClone(capture),baseline=captureStatistics(capture)
 capture.sinkMetrics=frames.map(f=>({index:f.index,startMonotonicSeconds:100,endMonotonicSeconds:100.2,durationMs:200,bgraWrite:{durationMs:150},sidecarWrite:{durationMs:20}}));assert.deepEqual(captureStatistics(capture),baseline);assert.deepEqual(capture.frames,before.frames);assert(baseline.completeDeliveryFps<30)
 const swift=fs.readFileSync(path.resolve('scripts/mac-logo-capture-119.swift'),'utf8');assert(swift.includes('"sinkMetrics": state.3'));assert(swift.includes('measuredSink(&metrics, "sidecarWrite")'));assert(swift.includes('sinkMetrics.append(metrics)'));assert(!swift.includes('row["sinkMetrics"]'),'separate metric ledger cannot make sidecar/manifest original row differ')
})

test('owned helper stop is graceful; even stop-request I/O failure terminates only its own child and remains failure', async () => {
  let asked = false, killed = []
  const child = { pid: 444, exitCode: null, signalCode: null, kill: signal => killed.push(signal) }
  assert.deepEqual(await stopOwnedHelper(child, Promise.resolve({ code: 0 }), () => { asked = true }), { code: 0 })
  assert(asked); assert.deepEqual(killed, [])
  const original = Error('write stop failed'); let resolveExit
  const exit = new Promise(resolve => { resolveExit = resolve })
  child.kill = signal => { killed.push(signal); child.signalCode = signal; resolveExit({ code: null, signal }) }
  await assert.rejects(stopOwnedHelper(child, exit, () => { throw original }, 5), error => error === original)
  assert.deepEqual(killed, ['SIGTERM'])
  await assert.rejects(stopOwnedHelper({ pid: undefined }, exit, () => assert.fail('request on unowned process')), /only the spawned/)
})

test('owned stream stop deadline is a failure even if terminating the hung helper succeeds', async () => {
  const kills = []; let resolveExit
  const exit = new Promise(resolve => { resolveExit = resolve })
  const child = { pid: 445, exitCode: null, signalCode: null, kill: signal => { kills.push(signal); child.signalCode = signal; resolveExit({ code: null, signal }) } }
  await assert.rejects(stopOwnedHelper(child, exit, () => {}, 5), /graceful stop timed out/)
  assert.deepEqual(kills, ['SIGTERM'])
})

test('raw BGRA remains immutable and derived PNG is exact RGBA, including transparent color bytes', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-native-pixels-'))
  t.after(() => { assert.equal(path.dirname(dir), os.tmpdir()); assert(path.basename(dir).startsWith('kamu-native-pixels-')); fs.rmSync(dir, { recursive: true, force: true }) })
  const bytes = Buffer.from([9, 17, 33, 255, 40, 50, 60, 0, 77, 88, 99, 127, 0, 255, 255, 255])
  const file = 'frame-000000.bgra', hash = createHash('sha256').update(bytes).digest('hex')
  fs.writeFileSync(path.join(dir, file), bytes)
  const frame = { index: 0, file, width: 2, height: 2, sha256: hash }
  const result = await verifyPixels(dir, { frames: [frame] })
  assert.equal(result.length, 1); assert.equal(result[0].losslessPixelsVerified, true); assert.equal(result[0].originalSHA256, hash)
  assert(fs.readFileSync(path.join(dir, file)).equals(bytes))
  await assert.rejects(verifyPixels(dir, { frames: [frame] }), /replace/)
  await assert.rejects(verifyPixels(dir, { frames: [{ ...frame, sha256: 'wrong' }] }), /SHA/)
  await assert.rejects(verifyPixels(dir, { frames: [{ ...frame, file: '../outside.bgra' }] }), /untrusted/)
})
