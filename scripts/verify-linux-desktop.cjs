// Real desktop and CI fixture runs have deliberately different acceptance status.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { execFileSync, spawn } = require('node:child_process')
const root = path.resolve(__dirname, '..'), arch = process.argv[2], fixture = process.argv.includes('--fixture-smoke'), version = require('../package.json').version
const proof = path.join(root, 'release/linux-desktop-' + arch + '-' + (fixture ? 'fixture-' : 'native-') + Date.now())
fs.mkdirSync(proof, { recursive: true })
fs.mkdirSync(path.join(root, 'out'), { recursive: true })
const report = { version, arch, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), fixture, nativeDesktop: false, complete: false, steps: [], serviceEvidence: 'Community artwork and account identity use explicit isolated fixtures; no real authentication or community CDN claim', unverifiedRequired: ['real account login and credential restart', 'Minecraft native installation, world load and save', 'LAN and Sakura/Terracotta remote peer', 'AppImage/DEB GUI update installer and rollback', 'native system material by compositor', 'actual slap sound listening', 'independent visual/interaction/motion review'] }
const save = () => fs.writeFileSync(path.join(proof, 'summary.json'), JSON.stringify(report, null, 2))
const read = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 })
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const owned = require('./qa-owned-process-119.cjs')
let recorder, recordLog
async function runHarness(theme, module, executable) {
  const start = Date.now(), logName = theme + '-' + module + '.log', descriptor = fs.openSync(path.join(proof, logName), 'w')
  const env = { ...process.env, KAMUCL_GUI_APP: executable, KAMUCL_EXTENSION_GUI: '1', KAMUCL_EXTENSION_ONLY: '1', KAMUCL_SKIP_EXTENSION_BASE: '1', KAMUCL_UI_MODULE: module, KAMUCL_OBSERVER_TRACE_CONTROL119: '1' }
  delete env.ELECTRON_RUN_AS_NODE; delete env.KAMUCL_GUI_DEV; delete env.KAMUCL_GUI_SOFTWARE
  const child = spawn(process.execPath, ['scripts/verify-ui-refinement.cjs', theme], { cwd: root, env, stdio: ['ignore', descriptor, descriptor] })
  const track = owned.trackOwnedChild(child, 'linux-' + theme + '-' + module)
  let timeout
  try {
    const result = await Promise.race([track.closed, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('GUI trace deadline exceeded: ' + theme + '/' + module)), 8 * 60 * 1000) })])
    assert.equal(result.code, 0, 'GUI trace failed: ' + theme + '/' + module + '; original output is in ' + logName)
    report.steps.push({ theme, module, complete: true, startedAt: new Date(start).toISOString(), finishedAt: new Date().toISOString(), child: track.ledger }); save()
  } catch (error) {
    report.steps.push({ theme, module, complete: false, error: String(error), child: track.ledger }); save()
    if (!track.ledger.closed) await owned.finishOwnedChild(track, { terminate: true, timeoutMs: 15000 })
    throw error
  } finally { clearTimeout(timeout); fs.closeSync(descriptor) }
}
;(async () => {
  save(); assert.equal(process.platform, 'linux'); assert.equal(process.arch, arch); assert(['x64', 'arm64'].includes(arch))
  assert(process.env.DISPLAY, 'X11 or XWayland DISPLAY is required; pure Wayland is not accepted')
  assert(process.getuid() !== 0, 'Do not run the desktop application as root or bypass Chromium sandbox')
  report.osRelease = fs.readFileSync('/etc/os-release', 'utf8')
  const osVersion = report.osRelease.match(/^VERSION_ID="?([^"\n]+)"?$/m)?.[1]
  assert(['24.04', '26.04'].includes(osVersion), 'Desktop baseline is native Ubuntu 24.04 or 26.04')
  report.graphics = read('glxinfo', ['-B']); fs.writeFileSync(path.join(proof, 'graphics.txt'), report.graphics)
  const processNames = read('/bin/ps', ['-eo', 'comm='])
  if (!fixture) {
    assert(!/^(Xvfb|Xvnc|Xephyr)$/m.test(processNames), 'A virtual X server is fixture evidence, never native desktop acceptance')
    assert(!/llvmpipe|softpipe|swiftshader|software rasterizer/i.test(report.graphics), 'A software renderer cannot establish native motion acceptance')
  }
  const prefix = 'KAMUCL-' + version + '-linux-' + arch, archive = path.join(root, 'release', prefix + '.tar.gz')
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'release/linux-proof-' + arch + '-packages/summary.json'), 'utf8'))
  assert.equal(receipt.version, version); assert.equal(receipt.arch, arch); assert.equal(receipt.sourceCommit, report.sourceCommit)
  const asset = receipt.packages.find(p => p.name === prefix + '.tar.gz')
  assert(asset); assert.equal(fs.statSync(archive).size, asset.bytes); assert.equal(sha(archive), asset.sha256)
  report.package = asset
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL Linux native 中文 '))
  read('/usr/bin/tar', ['-xzf', archive, '-C', clean])
  const application = path.join(clean, 'KAMUCL'), executable = path.join(application, 'kamucl')
  const metadata = JSON.parse(fs.readFileSync(path.join(application, 'resources/kamucl-linux.json'), 'utf8'))
  assert.equal(metadata.schemaVersion, 1, 'Unknown Linux package identity schema')
  assert.equal(metadata.version, version); assert.equal(metadata.arch, arch); assert.equal(metadata.installationKind, 'portable-directory')
  assert.equal(metadata.sourceCommit, report.sourceCommit, 'Embedded source must match this desktop test checkout')
  const runtime = require('./verify-linux-runtime.cjs').observeLinuxRuntime(executable, arch)
  assert.equal(metadata.runtimeVersion, runtime.electron, 'Embedded runtime must match the actual executable')
  report.packageIdentity = { metadata, observedExecutable: runtime }; save()
  const dimensions = read('xdpyinfo', []).match(/dimensions:\s+(\d+)x(\d+)/)
  assert(dimensions); report.display = { display: process.env.DISPLAY, width: Number(dimensions[1]), height: Number(dimensions[2]), sessionType: process.env.XDG_SESSION_TYPE || 'unknown' }
  if (!fixture) {
    const video = path.join(proof, 'original-desktop.mkv')
    recordLog = fs.openSync(path.join(proof, 'original-capture.log'), 'w')
    const child = spawn('ffmpeg', ['-hide_banner', '-nostats', '-f', 'x11grab', '-framerate', '60', '-video_size', dimensions[1] + 'x' + dimensions[2], '-i', process.env.DISPLAY, '-vf', 'showinfo', '-fps_mode', 'passthrough', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', video], { stdio: ['pipe', recordLog, recordLog] })
    recorder = owned.trackOwnedChild(child, 'linux-original-native-capture'); report.capture = { file: path.basename(video), source: 'ffmpeg x11grab original desktop samples; no interpolation or synthetic frames; exact timestamps retained in original-capture.log', requestedRate: 60 }; save()
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
  }
  const themes = fixture ? ['black-orange'] : ['transparent', 'black-orange', 'blue-white', 'custom']
  const capabilities = require('./ui-capabilities.cjs')
  const modules = fixture ? ['ux110', 'skin118', ...(capabilities.themedSelection ? ['selection119'] : [])] : ['ux110', 'skin118', 'gallery118', ...(capabilities.themedSelection ? ['selection119'] : []), ...(capabilities.importRouting ? ['import119'] : []), 'header']
  for (const theme of themes) for (const module of modules) await runHarness(theme, module, executable)
  report.guiComplete = true; report.nativeDesktop = !fixture
  report.complete = true; report.acceptanceComplete = false
})().catch(error => { report.complete = false; report.error = { message: error.message, name: error.name, code: error.code, syscall: error.syscall }; console.error(error); process.exitCode = 1; save() }).finally(async () => {
  try {
  if (recorder) {
    try {
      if (!recorder.ledger.closed) recorder.child.stdin.write('q\n')
      await owned.finishOwnedChild(recorder, { timeoutMs: 15000 })
      assert.equal(recorder.ledger.code, 0, 'Original desktop capture failed')
      const info = read('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time,pkt_duration_time', '-of', 'json', path.join(proof, 'original-desktop.mkv')])
      fs.writeFileSync(path.join(proof, 'original-frame-times.json'), info)
      report.capture.frames = JSON.parse(info).frames.length
      assert(report.capture.frames > 0, 'No original capture frames')
      report.capture.sha256 = sha(path.join(proof, 'original-desktop.mkv'))
    } catch (error) { report.complete = false; report.captureError = String(error); process.exitCode = 1 }
    finally { fs.closeSync(recordLog) }
  }
  for (const directory of ['out', 'release']) {
    const evidenceDirectory = path.join(root, directory)
    if (!fs.existsSync(evidenceDirectory)) continue
    for (const name of fs.readdirSync(evidenceDirectory)) {
      if (!/^(appearance-motion-|skin-walk-110-|skin-editor-|skin-118-|gallery-118-|favorites-118-|selection-119-|import-119-|mascot-|kamu-|ui-refinement-|main-inspector-ready-live|qa-owned-process-119-|linux-gpu-failure-)/.test(name)) continue
      const file = path.join(root, directory, name)
      if (fs.statSync(file).mtimeMs >= fs.statSync(path.join(proof, 'summary.json')).birthtimeMs) fs.cpSync(file, path.join(proof, directory + '-' + name), { recursive: true })
    }
  }
  } catch (error) {
    report.complete = false; report.finalizationError = { message: error.message, name: error.name, code: error.code, syscall: error.syscall }; console.error(error); process.exitCode = 1
  } finally { report.finishedAt = new Date().toISOString(); save() }
})
