// Run only in a separate hosted Intel diagnostic job after formal UI failure.
// Explicit Metal is a diagnostic comparison, never a production fallback or a
// replacement for failed default UI, original capture timings, or FPS gates.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict'), crypto = require('node:crypto')
const { spawn, execFileSync } = require('node:child_process')
const owned = require('./qa-owned-process-119.cjs')
const { readMacPackageIdentity } = require('./mac-package-identity.cjs')
assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'x64')
assert.equal(process.env.GITHUB_ACTIONS, 'true')
const app = path.resolve(process.argv[2]), arch = process.argv[3]
assert.equal(arch, 'x64')
const pkg = require('../package.json'), sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const proof = path.resolve('release/mac-gpu-diagnostic-x64'); fs.mkdirSync(proof, { recursive: true })
const packageIdentity = readMacPackageIdentity(app, { version: pkg.version, arch, sourceCommit, runtimeVersion: pkg.devDependencies.electron, minimumSystemVersion: '13.0.0' })
const receipt = {
  version: pkg.version, arch, sourceCommit, packageIdentity, diagnosticOnly: true,
  formalResultsUnchanged: true, classification: 'Isolated native GPU initialization diagnostic; not functional, animation or frame-rate acceptance',
  officialDefault: 'Chromium 152.0.7977.78 allows Metal then SwiftShader on macOS; explicit Metal is not an alternate hardware backend',
  sourceReferences: ['https://raw.githubusercontent.com/chromium/chromium/152.0.7977.78/ui/gl/init/gl_factory_mac.cc', 'https://raw.githubusercontent.com/chromium/chromium/152.0.7977.78/ui/gl/init/gl_factory.cc', 'https://raw.githubusercontent.com/chromium/chromium/152.0.7977.78/DEPS', 'https://raw.githubusercontent.com/google/angle/736ed80c7552a4b267bd54a282b971aa4555cb3e/src/libANGLE/renderer/metal/DisplayMtl.mm'],
  angleSourceRevision: '736ed80c7552a4b267bd54a282b971aa4555cb3e',
  startedAt: new Date().toISOString(), complete: false, variants: [], errors: []
}
const save = () => fs.writeFileSync(path.join(proof, 'diagnostic.json'), JSON.stringify(receipt, null, 2))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
let active, cancelled = false
const removeCancellation = owned.installOwnedCancellation(process, () => {
  cancelled = true; receipt.cancelled = true
  // The only signalled PID comes from this script's actually spawned child.
  if (active?.child.exitCode === null) active.child.kill('SIGTERM')
})
async function query(url, method, params = {}) {
  const socket = new WebSocket(url); let timer
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error(method + ' diagnostic timeout')), 5000)
      socket.addEventListener('error', () => reject(Error(method + ' diagnostic socket error')), { once: true })
      socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method, params })), { once: true })
      socket.addEventListener('message', event => {
        const value = JSON.parse(event.data)
        if (value.id === 1) value.error ? reject(Error(JSON.stringify(value.error))) : resolve(value.result)
      })
    })
  } finally { clearTimeout(timer); socket.close() }
}
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
  assert(response.ok, 'diagnostic endpoint ' + response.status); return response.json()
}
async function variant(name, angle, port) {
  const directory = path.join(proof, name); fs.mkdirSync(directory, { recursive: true })
  const profile = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL GPU diagnostic ')))
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ autoUpdate: false }))
  const parameters = [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--enable-logging=stderr', '--v=1', '--vmodule=gl_display=2,gl_factory=2,gpu_init=2']
  if (angle) parameters.push('--use-angle=' + angle)
  const row = { name, parameters, profileKind: 'separate disposable diagnostic profile', startedAt: new Date().toISOString(), observations: [], complete: false }
  receipt.variants.push(row); save()
  const output = fs.openSync(path.join(directory, 'process-original.log'), 'w')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(path.join(app, 'Contents/MacOS/KAMUCL'), parameters, { env, stdio: ['ignore', output, output] })
  const track = owned.trackOwnedChild(child, 'gpu-diagnostic-' + name); active = track; row.pid = child.pid
  let operationError
  try {
    let page, state
    for (let i = 0; i < 120; i++) {
      assert(!cancelled, 'diagnostic cancelled'); assert.equal(child.exitCode, null, 'diagnostic APP exited early')
      try {
        page = (await json(`http://127.0.0.1:${port}/json`)).find(value => value.url.includes('/renderer/index.html'))
        if (page) {
          const response = await query(page.webSocketDebuggerUrl, 'Runtime.evaluate', { returnByValue: true, expression: "({ready:document.readyState,home:document.body.innerText.includes('首页'),canvas:!!document.querySelector('.viewer3d canvas'),fallback:document.querySelector('.viewer3d-fallback')?.textContent??null})" })
          state = response.result?.value; row.observations.push({ at: new Date().toISOString(), ...state })
          if (state?.home && (state.canvas || state.fallback)) break
        }
      } catch (error) { row.observations.push({ at: new Date().toISOString(), error: error.message }) }
      await wait(500)
    }
    assert(page && state?.home, 'diagnostic original renderer not ready')
    const browser = await json(`http://127.0.0.1:${port}/json/version`)
    row.browser = { Browser: browser.Browser, userAgent: browser['User-Agent'] }
    assert(browser['User-Agent'].includes('Electron/' + pkg.devDependencies.electron), 'diagnostic must use the exact current runtime')
    row.systemInfo = await query(browser.webSocketDebuggerUrl, 'SystemInfo.getInfo')
    const screenshot = await query(page.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
    fs.writeFileSync(path.join(directory, 'renderer-original.png'), Buffer.from(screenshot.data, 'base64'))
    const response = await query(page.webSocketDebuggerUrl, 'Runtime.evaluate', { returnByValue: true, expression: `(()=>{const contexts=['webgl2','webgl'].map(kind=>{const canvas=document.createElement('canvas'),errors=[];canvas.addEventListener('webglcontextcreationerror',event=>errors.push(event.statusMessage));try{const context=canvas.getContext(kind),debug=context?.getExtension('WEBGL_debug_renderer_info'),result={kind,created:!!context,creationErrors:errors,renderer:debug?context.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,vendor:debug?context.getParameter(debug.UNMASKED_VENDOR_WEBGL):null,version:context?.getParameter(context.VERSION)??null};context?.getExtension('WEBGL_lose_context')?.loseContext();return result}catch(error){return{kind,created:false,creationErrors:errors,error:String(error)}}});return{userAgent:navigator.userAgent,viewerCanvas:!!document.querySelector('.viewer3d canvas'),fallback:document.querySelector('.viewer3d-fallback')?.textContent??null,contexts}})()` })
    assert(!response.exceptionDetails, 'diagnostic renderer query failed'); row.renderer = response.result?.value
    row.complete = true
  } catch (error) {
    operationError = error; row.error = { name: error.name, message: error.message }
  } finally {
    try { await owned.finishOwnedChild(track, { terminate: true, timeoutMs: 10000 }) }
    catch (error) { row.cleanupError = { name: error.name, message: error.message }; operationError ||= error }
    active = null; fs.closeSync(output); row.cleanup = track.ledger
    // Only this function's fixed, actually created private temporary directory.
    fs.rmSync(profile, { recursive: true, force: true })
    row.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(directory, 'diagnostic.json'), JSON.stringify(row, null, 2)); save()
  }
  if (operationError) receipt.errors.push({ variant: name, ...row.error, cleanupError: row.cleanupError })
}
;(async () => {
  save()
  fs.writeFileSync(path.join(proof, 'graphics-original.txt'), execFileSync('/usr/sbin/system_profiler', ['SPDisplaysDataType'], { timeout: 20000 }))
  const source = path.resolve('scripts/mac-metal-diagnostic.swift'), executable = path.join(proof, 'metal-capability-probe')
  execFileSync('swiftc', [source, '-target', 'x86_64-apple-macos13.0', '-o', executable], { timeout: 60000 })
  execFileSync('lipo', [executable, '-verify_arch', 'x86_64'])
  execFileSync('codesign', ['--force', '--sign', '-', executable]); execFileSync('codesign', ['--verify', '--strict', executable])
  receipt.metalProbe = { source: path.relative(process.cwd(), source), sourceSHA256: sha(source), binarySHA256: sha(executable), arch, target: 'x86_64-apple-macos13.0', signing: 'ad-hoc strict signature verified', result: JSON.parse(execFileSync(executable, [], { encoding: 'utf8', timeout: 20000 })) }
  await variant('default', null, 9271)
  if (!cancelled) await variant('explicit-metal', 'metal', 9272)
  receipt.complete = !cancelled && receipt.variants.length === 2 && receipt.variants.every(value => value.complete && value.cleanup.awaitedClose) && receipt.errors.length === 0
  assert(receipt.complete, 'diagnostic collection incomplete; original failures retained')
})().catch(error => {
  receipt.errors.push({ name: error.name, message: error.message }); console.error(error); process.exitCode = 1
}).finally(() => {
  receipt.cancellation = removeCancellation(); receipt.finishedAt = new Date().toISOString(); save()
})
