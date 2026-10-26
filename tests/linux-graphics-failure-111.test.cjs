const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawn } = require('node:child_process'), { once } = require('node:events')
const { recordLinuxGraphicsFailure, preserveLinuxFailure } = require('../scripts/qa-linux-graphics-failure.cjs')

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-graphics-negative-')), executable = path.join(root, 'kamucl'), pid = 11751
  fs.mkdirSync(path.join(root, 'resources'))
  fs.writeFileSync(path.join(root, 'resources/kamucl-linux.json'), JSON.stringify({ schemaVersion: 1, product: 'KAMUCL', platform: 'linux', arch: 'x64', version: '1.1.11', sourceCommit: 'a'.repeat(40), runtimeVersion: '44.3.0', installationKind: 'portable-directory' }))
  const requests = [], options = { outputFile: path.join(root, 'negative-observation.json'), mainInspectorUrl: 'http://127.0.0.1:19211/json', browserDebugPort: 19212, rendererDebuggerURL: 'ws://127.0.0.1:19212/renderer', ownedChild: { pid, exitCode: null, signalCode: null }, expectedPid: pid, expectedArch: 'x64', expectedExecutable: executable, timeoutMs: 100, originalConsoleErrors: [{ method: 'Runtime.consoleAPICalled', timestamp: 1791072643555.17, args: [{ value: 'original context creation error' }] }] }
  const dependencies = {
    json: async url => url.endsWith('/json/version') ? { webSocketDebuggerUrl: 'ws://127.0.0.1:19212/browser' } : [{ webSocketDebuggerUrl: 'ws://127.0.0.1:19211/main' }],
    query: async (url, method, params) => {
      requests.push({ url, method, params })
      if (method === 'Browser.getVersion') return { product: 'Chrome/152.0.7977.78' }
      if (method === 'SystemInfo.getInfo') return { gpu: { featureStatus: { webgl: 'disabled_software' } } }
      if (params.expression.includes('pid:process.pid')) return { result: { value: { pid, execPath: executable, platform: 'linux', arch: 'x64', versions: { electron: '44.3.0' } } } }
      if (params.expression.includes("getGPUInfo('complete')")) throw Error('actual GPU query rejected in negative fixture')
      if (params.expression.includes('getGPUFeatureStatus')) return { result: { value: { featureStatus: { webgl: 'disabled_software' }, graphicsSwitches: { 'disable-gpu': { present: false, value: '' } } } } }
      return { result: { value: { before: { canvas: false }, contexts: [{ kind: 'webgl', created: false, errors: [{ statusMessage: 'fixture context failure' }] }, { kind: 'webgl2', created: false, errors: [{ statusMessage: 'fixture context failure' }] }] } } }
    }
  }
  return { root, requests, options, dependencies }
}

test('Linux failure diagnosis preserves the same original assertion and records GPU/context failures without changing it to a pass', async () => {
  const f = fixture(), primary = Object.assign(Error('skin canvas missing'), { code: 'ERR_ASSERTION', actual: false, expected: true }); let receipt
  try {
    f.options.onEvidence = result => { receipt = result }
    await assert.rejects(preserveLinuxFailure(primary, f.options, f.dependencies), error => error === primary)
    const saved = JSON.parse(fs.readFileSync(f.options.outputFile, 'utf8'))
    assert.equal(saved.primaryError.stack, primary.stack); assert.equal(saved.primaryError.code, 'ERR_ASSERTION')
    assert.equal(saved.originalConsoleErrors[0].timestamp, 1791072643555.17)
    assert.equal(saved.ownedIdentityVerified, true); assert.equal(saved.complete, false); assert.equal(saved.nativeDesktop, false); assert.equal(saved.completeQualification, false)
    assert.equal(receipt.observations.mainProcessIdentity.value.pid, f.options.expectedPid)
    assert.equal(saved.observations.scratchWebGL.value.contexts.every(context => context.created === false), true)
    assert.equal(saved.observations.browserSystemInfo.value.systemInfo.gpu.featureStatus.webgl, 'disabled_software')
    assert.match(saved.diagnosticErrors.find(error => error.observation === 'electronCompleteGPUInfo').message, /query rejected/)
    assert.equal(f.requests[0].params.expression.includes('pid:process.pid'), true, 'verify the owned process before Electron or GPU queries')
    for (const request of f.requests) {
      assert(['Runtime.evaluate', 'Browser.getVersion', 'SystemInfo.getInfo'].includes(request.method))
      assert(!/appendSwitch|setHardware|disableHardware|BrowserWindow|ipcMain|send\(|dispatch|readPixels|drawImage/.test(request.params.expression ?? ''), 'no state-changing or frame-manipulating observation')
    }
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('Linux diagnosis bounds stalled observations and preserves primary failure even when evidence saving is denied', { timeout: 2000 }, async () => {
  const f = fixture(), primary = Object.assign(Error('original context failure'), { code: 'ERR_ASSERTION' }); let receipt
  try {
    f.options.timeoutMs = 20; f.options.onEvidence = result => { receipt = result }
    f.dependencies.query = () => new Promise(() => {})
    f.dependencies.writeFile = () => { throw Object.assign(Error('read-only evidence directory'), { code: 'EACCES' }) }
    await assert.rejects(preserveLinuxFailure(primary, f.options, f.dependencies), error => error === primary)
    assert.equal(receipt.primaryError.stack, primary.stack); assert.equal(receipt.complete, false)
    assert.equal(receipt.saveError.code, 'EACCES')
    assert(receipt.diagnosticErrors.some(error => /deadline/.test(error.message)))
    assert.equal(receipt.observations.electronGraphicsState, undefined, 'identity timeout must prevent GPU queries')
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('Linux diagnosis rejects exited children and foreign endpoints before any inspection request', async () => {
  const f = fixture()
  try {
    let queries = 0; f.dependencies.json = async () => { queries++; throw Error('must never inspect') }
    f.options.ownedChild.exitCode = 0
    let receipt = await recordLinuxGraphicsFailure(Error('primary'), f.options, f.dependencies)
    assert.equal(queries, 0); assert.match(receipt.diagnosticErrors[0].message, /child exited/)
    f.options.ownedChild.exitCode = null; f.options.mainInspectorUrl = 'http://192.0.2.1:19211/json'
    receipt = await recordLinuxGraphicsFailure(Error('primary'), f.options, f.dependencies)
    assert.equal(queries, 0); assert.match(receipt.diagnosticErrors[0].message, /outside the original owned loopback/)
    f.options.mainInspectorUrl = 'http://127.0.0.1:19211/json'
    f.dependencies.json = async url => {
      if (url.endsWith('/json/version')) { f.options.ownedChild.exitCode = 0; return { webSocketDebuggerUrl: 'ws://127.0.0.1:19212/browser' } }
      return [{ webSocketDebuggerUrl: 'ws://127.0.0.1:19211/main' }]
    }
    receipt = await recordLinuxGraphicsFailure(Error('primary'), f.options, f.dependencies)
    assert.equal(receipt.ownedIdentityVerified, true)
    assert(receipt.diagnosticErrors.some(error => error.observation === 'browserSystemInfo' && /child exited/.test(error.message)))
    assert.equal(f.requests.some(request => request.method === 'Browser.getVersion' || request.method === 'SystemInfo.getInfo'), false, 'exit during discovery must prevent reading a potentially reused browser port')
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('Linux diagnostic transport reads the actual owned Node inspector PID and refuses a mismatched ABI before GPU inspection', { timeout: 10000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-owned-inspector-negative-'))
  const child = spawn(process.execPath, ['--inspect=127.0.0.1:0', '-e', 'setTimeout(()=>{},30000)'], { stdio: ['ignore', 'ignore', 'pipe'] })
  const closed = once(child, 'close'); let endpointTimer
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = ''; endpointTimer = setTimeout(() => reject(Error('owned private Node inspector did not open')), 3000)
      child.once('error', reject); child.stderr.on('data', bytes => { stderr += bytes.toString(); const match = stderr.match(/ws:\/\/127\.0\.0\.1:(\d+)\/[^\s]+/); if (match) resolve(Number(match[1])) })
    })
    clearTimeout(endpointTimer)
    const primary = Object.assign(Error('prior GUI failure remains authoritative'), { code: 'ERR_ASSERTION' })
    const outputFile = path.join(root, 'actual-node-negative.json')
    const receipt = await recordLinuxGraphicsFailure(primary, { outputFile, mainInspectorUrl: `http://127.0.0.1:${endpoint}/json`, browserDebugPort: endpoint, ownedChild: child, expectedPid: child.pid, expectedArch: process.arch === 'arm64' ? 'x64' : 'arm64', expectedExecutable: process.execPath, timeoutMs: 1000 })
    assert.equal(receipt.observations.mainProcessIdentity.value.pid, child.pid, 'actual inspector must read this test-owned child')
    assert.equal(receipt.observations.mainProcessIdentity.value.versions.node, process.versions.node)
    assert.equal(receipt.ownedIdentityVerified, undefined)
    assert.match(receipt.diagnosticErrors.at(-1).message, /PID, ABI, platform or executable/)
    assert.equal(receipt.observations.electronGraphicsState, undefined)
    assert.equal(receipt.observations.scratchWebGL, undefined)
    assert.equal(JSON.parse(fs.readFileSync(outputFile, 'utf8')).primaryError.stack, primary.stack)
  } finally {
    clearTimeout(endpointTimer)
    // Only the exact privately spawned test child is signalled.
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await closed; fs.rmSync(root, { recursive: true, force: true })
  }
})
