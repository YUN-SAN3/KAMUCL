// Native QA only. Keep the original screencapture command and failure; do not
// retry, change capture tools or equate display online with display awake.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { spawn, execFileSync } = require('node:child_process')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const errorRecord = error => ({ name: error.name, message: error.message, status: error.status ?? null,
  signal: error.signal ?? null, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') })
function pixelContent(data, channels) {
  assert(channels >= 3 && data.length >= channels && data.length % channels === 0, 'capture must decode RGB pixels')
  let min = 255, max = 0, differs = false
  for (let i = 0; i < data.length; i += channels) {
    for (let c = 0; c < 3; c++) {
      const value = data[i + c]; min = Math.min(min, value); max = Math.max(max, value)
      if (value !== data[c]) differs = true
    }
  }
  assert(differs, 'capture contains only one uniform RGB colour')
  return { pixels: data.length / channels, channels, min, max, spatiallyNonuniform: differs }
}
function ownedWindowCrop(native, ownerPID, width, height) {
  const display = native.displays.find(d => d.main)
  assert(display && display.bounds.width > 0 && display.bounds.height > 0, 'capture requires actual main display bounds')
  const window = native.windows.find(w => w.ownerPID === ownerPID && w.layer === 0 && w.onScreen && w.alpha > 0 && w.bounds.Width > 0 && w.bounds.Height > 0)
  assert(window, 'capture requires the actual owned on-screen window')
  const b = window.bounds, d = display.bounds, sx = width / d.width, sy = height / d.height
  const left = Math.max(0, Math.floor((b.X - d.x) * sx)), top = Math.max(0, Math.floor((b.Y - d.y) * sy))
  const right = Math.min(width, Math.ceil((b.X + b.Width - d.x) * sx)), bottom = Math.min(height, Math.ceil((b.Y + b.Height - d.y) * sy))
  assert(right > left && bottom > top, 'owned window must intersect captured display')
  return { ownerPID, windowID: window.id, scale: { x: sx, y: sy }, left, top, width: right - left, height: bottom - top }
}
function createGameCaptureObserver({ proof, getGamePID, launcherPID, qaPID = process.pid,
  execute = execFileSync, spawnProcess = spawn, now = Date.now, platform = process.platform,
  ci = process.env.GITHUB_ACTIONS, alive = pid => { try { process.kill(pid, 0); return true } catch { return false } },
  decode = require('sharp') }) {
  assert.equal(platform, 'darwin'); assert.equal(ci, 'true')
  const ledger = { schemaVersion: 1, source: 'single original macOS screencapture with actual native display/window observations',
    complete: false, qaPID, startedAt: now(), captures: [], inhibitor: null,
    completionScope: 'Three original captures only; game world, graceful shutdown and disk-save assertions remain separate',
    interpretation: 'CI-only idle prevention; the historical screenshot failure is not diagnosed as display sleep' }
  const file = path.join(proof, 'capture-state.json'), helper = path.join(proof, 'game-display-observer')
  let inhibitor
  const persist = () => fs.writeFileSync(file, JSON.stringify(ledger, null, 2))
  const command = (name, args, timeout = 5000) => {
    try { return { ok: true, output: String(execute(name, args, { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })) } }
    catch (error) { return { ok: false, error: errorRecord(error) } }
  }
  function snapshot() {
    const gamePID = getGamePID(), raw = command(helper, [String(gamePID || 0), String(launcherPID)])
    let native = null
    if (raw.ok) try { native = JSON.parse(raw.output) } catch (error) { raw.parseError = errorRecord(error) }
    return { at: now(), gamePID, gameAlive: !!gamePID && alive(gamePID), launcherPID, launcherAlive: alive(launcherPID),
      native, nativeQuery: raw, inhibitorPID: inhibitor?.pid ?? null,
      inhibitorAlive: !!inhibitor?.pid && alive(inhibitor.pid),
      assertions: command('/usr/bin/pmset', ['-g', 'assertions']),
      processes: command('/bin/ps', ['-p', [gamePID, launcherPID, inhibitor?.pid].filter(Boolean).join(','), '-o', 'pid=,ppid=,stat=,etime=,comm=']) }
  }
  async function start() {
    ledger.initialPowerSettings = command('/usr/bin/pmset', ['-g', 'custom']); persist()
    const args = ['-d', '-i', '-u', '-w', String(qaPID)]
    inhibitor = spawnProcess('/usr/bin/caffeinate', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    ledger.inhibitor = { pid: inhibitor.pid ?? null, command: '/usr/bin/caffeinate', args, stdout: '', stderr: '', released: false }
    inhibitor.stdout?.on('data', b => { ledger.inhibitor.stdout += String(b) })
    inhibitor.stderr?.on('data', b => { ledger.inhibitor.stderr += String(b) })
    inhibitor.on('error', error => { ledger.inhibitor.error = errorRecord(error); persist() })
    inhibitor.on('exit', (code, signal) => { ledger.inhibitor.exit = { at: now(), code, signal }; persist() })
    try {
      await new Promise((resolve, reject) => { inhibitor.once('spawn', resolve); inhibitor.once('error', reject) })
      ledger.inhibitor.pid = inhibitor.pid
      const source = path.resolve('scripts/mac-game-display-observer.swift')
      ledger.helperSourceSHA256 = sha(fs.readFileSync(source)); persist()
      execute('/usr/bin/xcrun', ['swiftc', source, '-o', helper], { timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] })
      ledger.initialState = snapshot(); persist()
      assert(ledger.initialState.native, 'native display observer must return actual state')
      assert(ledger.initialState.inhibitorAlive, 'owned display idle inhibitor must be alive')
    } catch (error) { ledger.startFailure = errorRecord(error); persist(); throw error }
  }
  async function capture(name, ownerPID) {
    const output = path.join(proof, name), args = ['-x', '-D', '1', output]
    const row = { name, ownerPID, startedAt: now(), command: '/usr/sbin/screencapture', args, before: snapshot(), complete: false }
    ledger.captures.push(row); persist()
    try {
      execute('/usr/sbin/screencapture', args, { stdio: ['ignore', 'pipe', 'pipe'] })
      row.captureReturnedAt = now(); row.after = snapshot(); persist()
      const bytes = fs.readFileSync(output), image = decode(bytes), metadata = await image.metadata()
      row.png = { file: name, bytes: bytes.length, sha256: sha(bytes), format: metadata.format, width: metadata.width, height: metadata.height }
      persist()
      assert.equal(metadata.format, 'png', 'native capture must be an actual decoded PNG')
      assert(metadata.width > 0 && metadata.height > 0, 'native PNG dimensions must be positive')
      const full = await decode(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      row.png.content = pixelContent(full.data, full.info.channels)
      assert(row.after.native && row.after.launcherAlive, 'actual post-capture native state and owned launcher must exist')
      if (ownerPID === getGamePID()) assert(row.after.gameAlive, 'owned game must remain alive at capture')
      row.png.crop = ownedWindowCrop(row.after.native, ownerPID, metadata.width, metadata.height)
      const { left, top, width, height } = row.png.crop
      const region = await decode(bytes).extract({ left, top, width, height }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      row.png.ownedWindowContent = pixelContent(region.data, region.info.channels)
      row.complete = true; row.finishedAt = now(); persist()
    } catch (error) {
      // Capture the original exception and immediate actual state before slower
      // power/system diagnostics; no second attempt or substitute PNG.
      row.failure = errorRecord(error); row.failedAt = now(); persist()
      row.failureState = snapshot(); persist()
      row.failurePowerLog = command('/usr/bin/pmset', ['-g', 'log'], 10000); persist()
      const predicate = 'process == "WindowServer" OR process == "powerd" OR process == "tccd" OR process == "screencapture"'
      row.failureSystemLog = command('/usr/bin/log', ['show', '--last', '3m', '--style', 'compact', '--predicate', predicate], 15000); persist()
      throw error
    }
  }
  async function stop() {
    if (inhibitor?.pid && inhibitor.exitCode === null && inhibitor.signalCode === null) {
      const ended = new Promise(resolve => inhibitor.once('exit', resolve))
      assert(inhibitor.kill('SIGTERM'), 'could not release owned display idle inhibitor') // Only this exact spawned process object.
      await ended
    }
    if (ledger.inhibitor) ledger.inhibitor.released = true
    ledger.finishedAt = now(); ledger.complete = !ledger.startFailure && ledger.captures.length === 3 && ledger.captures.every(c => c.complete)
    ledger.finalAssertions = command('/usr/bin/pmset', ['-g', 'assertions']); persist()
  }
  return { start, capture, stop, snapshot, ledger }
}
module.exports = { createGameCaptureObserver, pixelContent, ownedWindowCrop }
