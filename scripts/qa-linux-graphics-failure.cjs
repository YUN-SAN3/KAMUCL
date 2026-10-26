// Bounded read-only observations of the same already-failed disposable GUI.
// This module never starts an app, changes graphics settings or passes a GUI gate.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')

const MAIN_IDENTITY = '({pid:process.pid,execPath:process.execPath,platform:process.platform,arch:process.arch,versions:process.versions})'
const GRAPHICS_STATE = `(()=>{const e=process.mainModule.require('electron'),names=['ozone-platform','use-gl','use-angle','disable-gpu','disable-software-rasterizer','ignore-gpu-blocklist','enable-unsafe-swiftshader','no-sandbox','disable-gpu-sandbox','enable-features','disable-features'];return{featureStatus:e.app.getGPUFeatureStatus(),graphicsSwitches:Object.fromEntries(names.map(n=>[n,{present:e.app.commandLine.hasSwitch(n),value:e.app.commandLine.getSwitchValue(n)}])),graphicsArgv:process.argv.filter(a=>names.some(n=>a==='--'+n||a.startsWith('--'+n+'='))),gpuProcesses:e.app.getAppMetrics().filter(p=>p.type==='GPU').map(p=>({pid:p.pid,type:p.type,creationTime:p.creationTime,sandboxed:p.sandboxed}))}})()`
const GPU_INFO = "process.mainModule.require('electron').app.getGPUInfo('complete')"
const SCRATCH_WEBGL = `(()=>{const before={canvas:!!document.querySelector('.viewer3d canvas'),fallback:document.querySelector('.viewer3d-fallback')?.textContent??null},contexts=['webgl','webgl2'].map(kind=>{const canvas=document.createElement('canvas'),errors=[];canvas.width=canvas.height=1;canvas.addEventListener('webglcontextcreationerror',event=>errors.push({statusMessage:event.statusMessage,timeStamp:event.timeStamp}));try{const context=canvas.getContext(kind),debug=context?.getExtension('WEBGL_debug_renderer_info');return{kind,created:!!context,errors,vendor:context?context.getParameter(context.VENDOR):null,renderer:context?context.getParameter(context.RENDERER):null,version:context?context.getParameter(context.VERSION):null,unmaskedVendor:debug?context.getParameter(debug.UNMASKED_VENDOR_WEBGL):null,unmaskedRenderer:debug?context.getParameter(debug.UNMASKED_RENDERER_WEBGL):null}}catch(error){return{kind,created:false,errors,exception:{name:error.name,message:error.message}}}});return{before,contexts,devicePixelRatio,documentReadyState:document.readyState,userAgent:navigator.userAgent}})()`
const errorRecord = error => ({ name: error?.name ?? 'Error', message: String(error?.message ?? error), stack: error?.stack, code: error?.code, actual: error?.actual, expected: error?.expected, operator: error?.operator })

function assertLoopback(url, kind, port) {
  const parsed = new URL(url)
  if (parsed.hostname !== '127.0.0.1' || Number(parsed.port) !== port || parsed.username || parsed.password || parsed.protocol !== (kind === 'http' ? 'http:' : 'ws:')) throw Error('Refuse a diagnostic endpoint outside the original owned loopback port')
  return url
}
async function json(url, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw Error('Diagnostic endpoint returned HTTP ' + response.status)
  return response.json()
}
async function query(url, method, params, timeoutMs) {
  const socket = new WebSocket(url)
  let timer
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error(method + ' graphics diagnostic timed out')), timeoutMs)
      socket.addEventListener('error', () => reject(Error(method + ' graphics diagnostic socket failed')), { once: true })
      socket.addEventListener('close', () => reject(Error(method + ' graphics diagnostic socket closed before its response')), { once: true })
      socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method, params })), { once: true })
      socket.addEventListener('message', event => {
        try { const data = JSON.parse(event.data); if (data.id === 1) data.error ? reject(Error(JSON.stringify(data.error))) : resolve(data.result) }
        catch (error) { reject(error) }
      })
    })
  } finally { clearTimeout(timer); socket.close() }
}
function value(result) {
  if (result?.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
  if (!result?.result || !Object.hasOwn(result.result, 'value')) throw Error('Diagnostic Runtime.evaluate did not return a by-value observation')
  return result.result.value
}
async function bounded(action, timeoutMs) {
  let timer
  try { return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Graphics observation deadline exceeded')), timeoutMs) })]) }
  finally { clearTimeout(timer) }
}

async function recordLinuxGraphicsFailure(primaryError, options, dependencies = {}) {
  const timeoutMs = Math.min(3000, Math.max(1, options.timeoutMs ?? 2500))
  const requestJSON = dependencies.json ?? json, request = dependencies.query ?? query
  const write = dependencies.writeFile ?? (async (file, bytes) => { await fs.promises.mkdir(path.dirname(file), { recursive: true }); await fs.promises.writeFile(file, bytes) })
  const receipt = {
    schemaVersion: 1, startedAt: new Date().toISOString(), diagnosticOnly: true, formalResultsUnchanged: true,
    classification: 'Read-only observations after the original GUI failure, using its existing owned main/renderer/browser inspector endpoints; scratch contexts are not acceptance.',
    primaryError: errorRecord(primaryError), originalConsoleErrors: options.originalConsoleErrors ?? [],
    completeQualification: false, nativeDesktop: false, complete: false, observations: {}, diagnosticErrors: [],
    display: { DISPLAY: options.display?.DISPLAY ?? null, XDG_SESSION_TYPE: options.display?.XDG_SESSION_TYPE ?? null, WAYLAND_DISPLAY: options.display?.WAYLAND_DISPLAY ?? null }
  }
  async function observe(name, action) {
    const startedAt = new Date().toISOString()
    try { const result = await bounded(action, timeoutMs); receipt.observations[name] = { startedAt, finishedAt: new Date().toISOString(), value: result }; return result }
    catch (error) { receipt.diagnosticErrors.push({ observation: name, startedAt, finishedAt: new Date().toISOString(), ...errorRecord(error) }); return undefined }
  }
  const assertOwnedAlive = () => {
    if (!Number.isSafeInteger(options.expectedPid) || options.expectedPid < 1 || options.ownedChild?.pid !== options.expectedPid || options.ownedChild.exitCode !== null || options.ownedChild.signalCode !== null) throw Error('Original owned GUI child exited or its PID identity does not match; refuse further inspection')
  }
  try {
    assertOwnedAlive()
    const mainURL = new URL(options.mainInspectorUrl), mainPort = Number(mainURL.port)
    assertLoopback(options.mainInspectorUrl, 'http', mainPort)
    if (!Number.isInteger(options.browserDebugPort) || options.browserDebugPort < 1 || options.browserDebugPort > 65535 || !Number.isInteger(mainPort) || mainPort < 1 || mainPort > 65535) throw Error('Invalid original inspector ports')
    const pages = await observe('mainInspectorDiscovery', () => requestJSON(options.mainInspectorUrl, timeoutMs))
    const mainEndpoint = pages?.find(page => page.webSocketDebuggerUrl)?.webSocketDebuggerUrl
    if (!mainEndpoint) throw Error('Original main inspector is unavailable; no alternate port will be searched')
    assertLoopback(mainEndpoint, 'ws', mainPort)
    const evaluateMain = expression => { assertOwnedAlive(); return request(mainEndpoint, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs).then(value) }
    const identity = await observe('mainProcessIdentity', () => evaluateMain(MAIN_IDENTITY))
    assertOwnedAlive()
    if (!identity || identity.pid !== options.expectedPid || identity.platform !== 'linux' || identity.arch !== options.expectedArch || path.resolve(identity.execPath) !== path.resolve(options.expectedExecutable)) throw Error('Observed main process PID, ABI, platform or executable does not match the original owned Linux GUI; GPU queries refused')
    receipt.ownedIdentityVerified = true
    const metadata = await observe('embeddedPackageIdentity', () => {
      const file = path.join(path.dirname(options.expectedExecutable), 'resources', 'kamucl-linux.json')
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Unsafe embedded metadata file')
      const bytes = fs.readFileSync(file), parsed = JSON.parse(bytes)
      return { metadataFile: 'resources/kamucl-linux.json', sha256: crypto.createHash('sha256').update(bytes).digest('hex'), schemaVersion: parsed.schemaVersion, product: parsed.product, platform: parsed.platform, arch: parsed.arch, version: parsed.version, sourceCommit: parsed.sourceCommit, runtimeVersion: parsed.runtimeVersion, installationKind: parsed.installationKind, matchesActualRuntime: parsed.runtimeVersion === identity.versions?.electron && parsed.arch === identity.arch && parsed.platform === identity.platform }
    })
    if (metadata && !metadata.matchesActualRuntime) receipt.diagnosticErrors.push({ observation: 'embeddedPackageIdentity', message: 'Embedded metadata does not match the actual owned runtime; original failure is unchanged' })
    await Promise.all([
      observe('electronGraphicsState', () => evaluateMain(GRAPHICS_STATE)),
      observe('electronCompleteGPUInfo', () => evaluateMain(GPU_INFO)),
      observe('browserSystemInfo', async () => {
        assertOwnedAlive()
        const browser = await requestJSON(`http://127.0.0.1:${options.browserDebugPort}/json/version`, timeoutMs)
        assertOwnedAlive()
        assertLoopback(browser.webSocketDebuggerUrl, 'ws', options.browserDebugPort)
        const browserQuery = method => { assertOwnedAlive(); return request(browser.webSocketDebuggerUrl, method, {}, timeoutMs) }
        const [version, systemInfo] = await Promise.all([browserQuery('Browser.getVersion'), browserQuery('SystemInfo.getInfo')])
        return { version, systemInfo }
      }),
      observe('scratchWebGL', async () => {
        assertOwnedAlive()
        assertLoopback(options.rendererDebuggerURL, 'ws', options.browserDebugPort)
        return value(await request(options.rendererDebuggerURL, 'Runtime.evaluate', { expression: SCRATCH_WEBGL, returnByValue: true, awaitPromise: false }, timeoutMs))
      })
    ])
    receipt.complete = receipt.diagnosticErrors.length === 0
  } catch (error) { receipt.diagnosticErrors.push({ observation: 'ownedEndpointIdentity', ...errorRecord(error) }) }
  finally {
    receipt.finishedAt = new Date().toISOString()
    try { await bounded(() => write(options.outputFile, JSON.stringify(receipt, null, 2)), timeoutMs) }
    catch (error) { receipt.saveError = errorRecord(error) }
  }
  return receipt
}
async function preserveLinuxFailure(primaryError, options, dependencies) {
  try {
    const evidence = await recordLinuxGraphicsFailure(primaryError, options, dependencies)
    try { options.onEvidence?.(evidence) } catch {}
  } catch (secondaryError) {
    try { options.onEvidence?.({ diagnosticOnly: true, complete: false, primaryError: errorRecord(primaryError), unexpectedDiagnosticError: errorRecord(secondaryError) }) } catch {}
  }
  throw primaryError
}
module.exports = { recordLinuxGraphicsFailure, preserveLinuxFailure }
