import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const requireFixture = createRequire(path.resolve('package.json'))
const { skinCaptureRequest, cdpTiming, assertCaptureIdentity, nativePixelChanges, writePNGProjection } = requireFixture('./scripts/verify-mac-skin-walk-capture.cjs')
const { captureRequest, verifyPixels } = requireFixture('./scripts/verify-kamu-native-video-119.cjs')
const sha = (bytes: Buffer | string) => crypto.createHash('sha256').update(bytes).digest('hex')
function directory(t: TestContext) {
  const tempRoot = fs.realpathSync(os.tmpdir()), result = fs.mkdtempSync(path.join(tempRoot, 'KAMUCL synthetic SCK walk '))
  assert(path.resolve(result).startsWith(tempRoot + path.sep))
  t.after(() => fs.rmSync(result, { recursive: true, force: true }))
  return result
}
function geometry() {
  const native: any = { ownerPID: 501, windowId: 3, webContentsId: 4, bounds: { x: 100, y: 70, width: 1024, height: 708 }, contentBounds: { x: 100, y: 94, width: 1024, height: 684 }, zoom: 1, visible: true, focused: true, minimized: false, appHidden: false, activeDisplay: { id: 8, bounds: { x: 0, y: 0, width: 2048, height: 1536 }, scaleFactor: 1, displayFrequency: 60 } }
  const view: any = { focus: true, hidden: false, viewport: { width: 1024, height: 684, scale: 1 }, bounds: { x: 638, y: 399.375, width: 343, height: 228, hitVisible: true, contextWebGL: { type: 'WebGL2RenderingContext', lost: false } }, pose: { state: 'walk', seconds: 5 } }
  return { native, view }
}
function captureFixture() {
  const { native, view } = geometry(), request = skinCaptureRequest(native, view)
  const capture: any = { complete: true, streamStopped: true, dropCount: null, dropCountKnown: false,
    identity: { capturePurpose: 'skin-walk', ownerPID: 501, windowID: 19, displayID: 8, displayBounds: structuredClone(request.expectedDisplayBounds), sourceRect: structuredClone(request.crop), windowBounds: structuredClone(request.windowBounds), globalCrop: structuredClone(request.crop), backingScaleFactor: 1, pixelFormat: 'BGRA8', minimumFrameInterval: { numeric: true, seconds: 0 }, queueDepth: 5, outputWidth: request.crop.width, outputHeight: request.crop.height },
    frames: Array.from({ length: 12 }, (_, index) => ({ index, width: request.crop.width, height: request.crop.height, complete: true, validSample: true, file: `frame-${String(index).padStart(6, '0')}.bgra`, sha256: String(index).padStart(64, '0'), presentationTime: { numeric: true, seconds: index / 60 } })) }
  return { request, capture }
}

test('synthetic SCK walk geometry retains the entire >256pt model with exact native transforms', () => {
  const { native, view } = geometry(), request = skinCaptureRequest(native, view)
  assert.deepEqual(request.crop, { x: 738, y: 493, width: 343, height: 229 })
  assert.equal(request.capturePurpose, 'skin-walk')
  assert.throws(() => captureRequest(native, { focus: true, hidden: false, viewport: view.viewport, footprint: view.bounds }), /bounded native LOGO crop/)
  for (const mutate of [
    (n: any, _v: any) => { n.focused = false }, (n: any, _v: any) => { n.appHidden = true },
    (_n: any, v: any) => { v.hidden = true }, (_n: any, v: any) => { v.bounds.hitVisible = false },
    (_n: any, v: any) => { v.bounds.contextWebGL.lost = true }, (_n: any, v: any) => { v.pose.state = 'paused' },
    (_n: any, v: any) => { v.bounds.width = 513 }, (_n: any, v: any) => { v.bounds.y = 680 },
    (n: any, _v: any) => { n.zoom = 1.25 }, (n: any, _v: any) => { n.activeDisplay.scaleFactor = 4 },
    (n: any, _v: any) => { n.activeDisplay.bounds.width = 900 }, (_n: any, v: any) => { v.viewport.scale = 1.5 }
  ]) { const pair = geometry(); mutate(pair.native, pair.view); assert.throws(() => skinCaptureRequest(pair.native, pair.view)) }
})

test('synthetic native walk refuses mismatched PID/display/window/crop/scale and unsupported capture identity', () => {
  const { request, capture } = captureFixture()
  assert.equal(assertCaptureIdentity(capture, request).completePixelSampleCount, 12)
  for (const mutate of [
    (i: any) => { i.ownerPID++ }, (i: any) => { i.displayID++ }, (i: any) => { i.windowID = 0 },
    (i: any) => { i.displayBounds.x++ }, (i: any) => { i.sourceRect.y++ },
    (i: any) => { i.windowBounds.x++ }, (i: any) => { i.globalCrop.width-- }, (i: any) => { i.backingScaleFactor = 2 },
    (i: any) => { i.capturePurpose = 'logo' }, (i: any) => { i.pixelFormat = 'RGBA8' },
    (i: any) => { i.minimumFrameInterval.seconds = 1 / 30 }, (i: any) => { i.queueDepth = 8 },
    (i: any) => { i.outputWidth-- }
  ]) { const fixture = captureFixture(); mutate(fixture.capture.identity); assert.throws(() => assertCaptureIdentity(fixture.capture, fixture.request)) }
})

test('native walk keeps fixed30/10 and rejects non-finite, reversed, duplicate or rewritten original PTS', () => {
  for (const mutate of [
    (c: any) => { c.frames = c.frames.slice(0, 9) },
    (c: any) => { c.frames.forEach((f: any) => { f.presentationTime.seconds = f.index / 29 }) },
    (c: any) => { c.frames[3].presentationTime.seconds = NaN },
    (c: any) => { c.frames[3].presentationTime.numeric = false },
    (c: any) => { c.frames[3].presentationTime.seconds = c.frames[2].presentationTime.seconds },
    (c: any) => { c.frames[3].presentationTime.seconds = .001 },
    (c: any) => { c.frames[3].index = 2 }, (c: any) => { c.complete = false }, (c: any) => { c.streamStopped = false },
    (c: any) => { c.frames[3].width-- }, (c: any) => { c.frames[3].complete = false; c.frames[3].height-- }
  ]) { const f = captureFixture(); mutate(f.capture); assert.throws(() => assertCaptureIdentity(f.capture, f.request)) }
})

test('CDP original wall-clock reversal is explicitly unusable and never sorted, dropped or relabelled', () => {
  const frames = [100, 100.02, 100.01, 100.04].map((timestamp, index) => ({ timestamp, file: `original-${index}.jpg`, receivedAt: index === 2 ? 1 : index }))
  const elapsed = frames.at(-1)!.timestamp - frames[0].timestamp
  const recording = { frames, elapsed, fps: (frames.length - 1) / elapsed, intervals: frames.slice(1).map((f, i) => f.timestamp - frames[i].timestamp) }, before = JSON.stringify(recording)
  const result = cdpTiming(recording)
  assert.equal(result.timingUsable, false); assert.equal(result.failed, true); assert.equal(result.formalCadenceSource, false)
  assert.equal(JSON.stringify(recording), before); assert.equal(result.originalFrameCount, 4)
  assert.equal(cdpTiming({ frames: [], elapsed: 0, fps: 0, intervals: [] }).timingUsable, false)
  assert.throws(() => cdpTiming({ ...recording, fps: 60 }), /strictly equal/)
})

test('actual synthetic BGRA files reject frozen or tiny pixel changes and preserve raw hashes', t => {
  const d = directory(t), build = (changed: number, delta: number) => {
    const capture: any = { frames: Array.from({ length: 12 }, (_, index) => {
      const raw = Buffer.alloc(20 * 20 * 4); for (let i = 3; i < raw.length; i += 4) raw[i] = 255
      if (index > 0) for (let pixel = 0; pixel < changed; pixel++) raw[pixel * 4] = delta
      const file = `frame-${String(index).padStart(6, '0')}.bgra`; fs.writeFileSync(path.join(d, file), raw)
      return { index, file, width: 20, height: 20, complete: true, validSample: true, sha256: sha(raw) }
    }) }; return capture
  }
  assert.throws(() => nativePixelChanges(d, build(0, 255)), /natural walking must change/)
  assert.throws(() => nativePixelChanges(d, build(2, 255)), /natural walking must change/)
  assert.throws(() => nativePixelChanges(d, build(10, 12)), /natural walking must change/)
  const valid = build(10, 13); assert(nativePixelChanges(d, valid).changes.some((sample: any) => sample.fraction === .025))
  fs.writeFileSync(path.join(d, valid.frames[0].file), Buffer.alloc(1600)); assert.throws(() => nativePixelChanges(d, valid), /strictly equal/)
})

test('lossless PNG projection links every original BGRA/sidecar/index/PTS without modifying the raw manifest', async t => {
  const d = directory(t), frames = [0, 1, 2].map(index => {
    const raw = Buffer.from([10 + index, 40, 60, 255]), file = `frame-${String(index).padStart(6, '0')}.bgra`
    fs.writeFileSync(path.join(d, file), raw)
    const row = { index, file, width: 1, height: 1, sha256: sha(raw), complete: index !== 1, validSample: true, presentationTime: { numeric: true, seconds: index === 1 ? .009 : index / 60 } }
    fs.writeFileSync(path.join(d, file.replace('.bgra', '.json')), JSON.stringify(row)); return row
  }), capture = { complete: true, streamStopped: true, frames }, bytes = JSON.stringify(capture)
  fs.writeFileSync(path.join(d, 'capture.json'), bytes)
  const pngs = await verifyPixels(d, capture)
  assert.throws(() => writePNGProjection(d, { ...capture, frames: [...frames].reverse() }, pngs), /unchanged original manifest/)
  assert.throws(() => writePNGProjection(d, capture, pngs.slice(0, 2)), /project every original pixel frame/)
  assert.throws(() => writePNGProjection(d, capture, pngs.map((p: any, i: number) => i ? p : { ...p, originalSHA256: '0'.repeat(64) })), /strictly equal/)
  const projection = writePNGProjection(d, capture, pngs), data = JSON.parse(fs.readFileSync(path.join(d, projection.file), 'utf8'))
  assert.equal(fs.readFileSync(path.join(d, 'capture.json'), 'utf8'), bytes); assert.equal(data.derived, true)
  assert.equal(data.originalManifestSHA256, sha(bytes)); assert.equal(data.frames.length, 3)
  assert.deepEqual(data.frames.map((f: any) => f.presentationTime), frames.map(f => f.presentationTime)); assert.equal(data.frames[1].complete, false)
  assert(data.frames.every((f: any) => f.losslessPixelsVerified)); assert.throws(() => writePNGProjection(d, capture, pngs), /overwrite/)
})
