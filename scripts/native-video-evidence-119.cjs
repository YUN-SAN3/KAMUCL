const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

// Collection integrity is separate from optional capture success and its FPS.
module.exports = function verify({ root, version, stage, startedAt, theme = 'black-orange' }) {
  assert(['app', 'dmg'].includes(stage), 'native video collection requires an explicit APP/DMG stage')
  const stem = `kamu-native-video-119-${stage}-${theme}`
  const receiptName = `kamu-native-video-diagnostic-119-${stage}-${theme}.json`
  const directory = path.resolve(root, stem), receipt = path.resolve(root, receiptName)
  const current = file => { assert(fs.existsSync(file), 'native video collection missing current evidence: ' + file); assert(fs.statSync(file).mtimeMs >= startedAt, 'native video collection has stale evidence: ' + file) }
  current(receipt)
  const proof = JSON.parse(fs.readFileSync(receipt, 'utf8'))
  assert.equal(proof.version, version, 'native video version must match build')
  assert.equal(proof.stage, stage, 'native video stage must match wrapper')
  assert.equal(path.resolve(proof.directory), directory, 'native video directory must match collected stage')
  assert.equal(path.resolve(proof.file), receipt, 'native video receipt must match collected stage')
  assert.equal(typeof proof.complete, 'boolean', 'native video must preserve explicit completion status')
  const read = name => { const file = path.join(directory, name); current(file); return JSON.parse(fs.readFileSync(file, 'utf8')) }
  const matches = (name, expected) => { assert(expected !== undefined, 'native video receipt missing ' + name); assert.deepEqual(read(name), expected, 'native video sidecar must match receipt: ' + name) }
  if (proof.complete || proof.compile) current(path.join(directory, 'compile.log'))
  if (proof.complete || proof.helperPID) current(path.join(directory, 'helper.log'))
  if (proof.complete || proof.request) matches('request.json', proof.request)
  if (proof.complete || proof.nativeFirstFrame) matches('ready.json', proof.nativeFirstFrame)
  if (proof.complete || proof.startMarker) matches('clicks-start.json', proof.startMarker)
  if (proof.complete || proof.actionCompleteMarker) matches('action-complete.json', proof.actionCompleteMarker)
  let rawFrames = 0, pngFrames = 0
  if (proof.complete || proof.capture) {
    matches('capture.json', proof.capture)
    matches('identity.json', proof.capture.identity)
    assert(Array.isArray(proof.capture.frames), 'native capture requires original frame records')
    if (proof.nativeFirstFrame) assert.deepEqual(proof.nativeFirstFrame.identity, proof.capture.identity, 'native first-frame identity must match capture')
    if (proof.request) {
      const identity = proof.capture.identity, request = proof.request
      for (const key of ['displayID', 'ownerPID']) assert.equal(identity[key], request[key], 'native identity must match request: ' + key)
      assert.deepEqual(identity.globalCrop, request.crop, 'native crop must match request')
      assert.equal(identity.backingScaleFactor, request.expectedScale, 'native scale must match request')
    }
  }
  const expectedFiles = new Set(), rawByIndex = new Map(), pngIndices = new Set()
  for (const [ordinal, frame] of (proof.capture?.frames || []).entries()) {
    assert.equal(frame.index, ordinal, 'native frame indices must be unique original callback order')
    const stem = `frame-${String(frame.index).padStart(6, '0')}`
    expectedFiles.add(stem + '.json'); matches(stem + '.json', frame)
    if (!frame.file) continue
    assert.equal(frame.file, stem + '.bgra', 'native video raw filename must match unique frame index')
    expectedFiles.add(frame.file); rawByIndex.set(frame.index, frame)
    const file = path.join(directory, frame.file); current(file)
    assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), frame.sha256, 'native video raw hash must match receipt')
    rawFrames++
  }
  if (proof.nativeFirstFrame) assert.deepEqual(proof.nativeFirstFrame.firstFrame, proof.capture?.frames[proof.nativeFirstFrame.firstFrame?.index], 'ready frame must be the original captured row')
  for (const frame of proof.pngs || []) {
    const original = rawByIndex.get(frame.index)
    assert(original && !pngIndices.has(frame.index), 'native PNG requires a unique matching original frame')
    pngIndices.add(frame.index)
    assert.equal(frame.file, original.file.replace(/\.bgra$/, '.png'), 'native PNG filename must match original')
    assert.equal(frame.original, original.file, 'native PNG original must match raw frame')
    assert.equal(frame.originalSHA256, original.sha256, 'native PNG original hash must match raw frame')
    assert.equal(frame.losslessPixelsVerified, true, 'native PNG must preserve lossless verification receipt')
    expectedFiles.add(frame.file)
    const file = path.join(directory, frame.file); current(file)
    assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), frame.sha256, 'native video PNG hash must match receipt')
    pngFrames++
  }
  if (fs.existsSync(directory)) for (const name of fs.readdirSync(directory)) {
    if (/^frame-.*\.(?:bgra|png|json)$/.test(name)) assert(expectedFiles.has(name), 'native collection has unreferenced frame evidence: ' + name)
  }
  if (proof.complete) { assert(rawFrames > 0, 'complete native video requires original frames'); assert.equal(pngFrames, rawFrames, 'complete native video requires every lossless PNG') }
  return { receipt: receiptName, directory: stem, collected: true, complete: proof.complete, rawFrames, pngFrames, nativeDeliveryBenchmark: proof.nativeDeliveryBenchmark ?? null, error: proof.error ?? null }
}
