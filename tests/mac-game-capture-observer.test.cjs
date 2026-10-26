const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { EventEmitter } = require('node:events'), sharp = require('sharp')
const { createGameCaptureObserver, pixelContent, ownedWindowCrop } = require('../scripts/mac-game-capture-observer.cjs')
function native() {
  return { mainDisplayID: 7, screenCaptureAccess: true, frontPID: 101,
    displays: [{ id: 7, main: true, online: true, active: true, asleep: false, bounds: { x: 0, y: 0, width: 4, height: 4 } }],
    windows: [101, 102].map(ownerPID => ({ id: ownerPID + 5, ownerPID, layer: 0, onScreen: true, alpha: 1, bounds: { X: 0, Y: 0, Width: 4, Height: 4 } })) }
}
function fixture(t, { captureError, image, state = native() } = {}) {
  const proof = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-game-capture-observer-'))
  t.after(() => fs.rmSync(proof, { recursive: true, force: true }))
  const calls = [], kills = [], child = new EventEmitter()
  Object.assign(child, { pid: 103, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter(),
    kill(signal) { kills.push({ pid: child.pid, signal }); child.signalCode = signal; queueMicrotask(() => child.emit('exit', null, signal)); return true } })
  const observer = createGameCaptureObserver({ proof, qaPID: 100, launcherPID: 102, getGamePID: () => 101,
    platform: 'darwin', ci: 'true', alive: () => true,
    spawnProcess(command, args) { calls.push({ command, args }); queueMicrotask(() => child.emit('spawn')); return child },
    execute(command, args) {
      calls.push({ command, args })
      if (command.endsWith('game-display-observer')) return JSON.stringify(state)
      if (command === '/usr/sbin/screencapture') {
        if (captureError) throw captureError
        fs.writeFileSync(args.at(-1), image); return Buffer.alloc(0)
      }
      return 'actual test command observation'
    } })
  return { observer, calls, kills, proof }
}
test('capture content rejects uniform RGB including coloured/black empty frames', () => {
  assert.throws(() => pixelContent(Buffer.from([10, 20, 30, 10, 20, 30]), 3), /uniform/)
  assert.throws(() => pixelContent(Buffer.alloc(12), 3), /uniform/)
  assert.throws(() => pixelContent(Buffer.alloc(0), 3), /decode RGB/)
  assert.equal(pixelContent(Buffer.from([10, 20, 30, 10, 20, 31]), 3).spatiallyNonuniform, true)
})
test('owned window crop uses real bounds and rejects another/hidden/off-display window', () => {
  const n = native(); n.displays[0].bounds = { x: -10, y: -5, width: 100, height: 60 }
  n.windows[0].bounds = { X: -20, Y: 5, Width: 30, Height: 20 }
  assert.deepEqual(ownedWindowCrop(n, 101, 200, 120), { ownerPID: 101, windowID: 106, scale: { x: 2, y: 2 }, left: 0, top: 20, width: 40, height: 40 })
  assert.throws(() => ownedWindowCrop(n, 999, 200, 120), /owned on-screen/)
  n.windows[0].onScreen = false
  assert.throws(() => ownedWindowCrop(n, 101, 200, 120), /owned on-screen/)
  n.windows[0].onScreen = true; n.windows[0].bounds.X = 500
  assert.throws(() => ownedWindowCrop(n, 101, 200, 120), /intersect/)
})
test('single native capture error remains original with immediate PID/display/error evidence', async t => {
  const original = Object.assign(Error('could not create image from display 25165824'), { status: 1, stderr: Buffer.from('original stderr') })
  const { observer, calls, proof } = fixture(t, { captureError: original })
  await assert.rejects(observer.capture('minecraft-world.png', 101), error => error === original)
  assert.equal(calls.filter(c => c.command === '/usr/sbin/screencapture').length, 1)
  const ledger = JSON.parse(fs.readFileSync(path.join(proof, 'capture-state.json')))
  assert.equal(ledger.complete, false); assert.equal(ledger.captures[0].complete, false)
  assert.equal(ledger.captures[0].failure.status, 1); assert.equal(ledger.captures[0].failure.stderr, 'original stderr')
  assert.equal(ledger.captures[0].failureState.gameAlive, true)
  assert.equal(ledger.captures[0].failureState.native.displays[0].asleep, false)
  assert.equal(ledger.captures[0].failureSystemLog.ok, true)
})
test('owned inhibitor, three single captures, actual PNG decode/SHA/content and exact PID release', async t => {
  const data = Buffer.from(Array.from({ length: 4 * 4 * 3 }, (_, i) => i * 5))
  const image = await sharp(data, { raw: { width: 4, height: 4, channels: 3 } }).png().toBuffer()
  const { observer, calls, kills, proof } = fixture(t, { image })
  await observer.start()
  for (const [name, owner] of [['minecraft.png', 101], ['dock-reopen.png', 102], ['minecraft-world.png', 101]]) await observer.capture(name, owner)
  await observer.stop()
  assert.deepEqual(calls.find(c => c.command === '/usr/bin/caffeinate').args, ['-d', '-i', '-u', '-w', '100'])
  assert.deepEqual(kills, [{ pid: 103, signal: 'SIGTERM' }])
  assert.equal(calls.filter(c => c.command === '/usr/sbin/screencapture').length, 3)
  const ledger = JSON.parse(fs.readFileSync(path.join(proof, 'capture-state.json')))
  assert.equal(ledger.complete, true); assert.equal(ledger.inhibitor.released, true)
  for (const row of ledger.captures) { assert.equal(row.png.format, 'png'); assert.equal(row.png.width, 4); assert.equal(row.png.sha256.length, 64); assert.equal(row.png.ownedWindowContent.spatiallyNonuniform, true) }
})
test('successful tool exit cannot hide blank PNG content or silently mark a capture complete', async t => {
  const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000000' } }).png().toBuffer()
  const { observer, calls } = fixture(t, { image })
  await assert.rejects(observer.capture('minecraft-world.png', 101), /uniform/)
  assert.equal(observer.ledger.captures[0].complete, false)
  assert.equal(calls.filter(c => c.command === '/usr/sbin/screencapture').length, 1)
})
