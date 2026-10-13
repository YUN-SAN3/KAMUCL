const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto')
const { spawn } = require('node:child_process'), { pathToFileURL } = require('node:url')
const { observeTamperedRejection, openOwnedInspector } = require('../scripts/linux-update-observer.cjs')
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

function rejectionFixture() {
  const staged = { id: 'private-request', size: 123, sha256: 'a'.repeat(64), mode: 'local', file: '/private/payload.tar.gz' }
  return { staged, failed: structuredClone(staged), actualSize: 145, actualSHA256: 'b'.repeat(64), baselineSHA256: 'c'.repeat(64), targetSHA256: 'c'.repeat(64), previousLog: Buffer.from('prior observation\n'), currentLog: Buffer.from('prior observation\n2026-10-04T07:53:03.087Z Error: 更新包大小或文件类型已变化，请重新下载\n'), flag: { state: 'absent', observedAt: 'fixture' } }
}
test('Linux tamper observation accepts an already-consumed notification only with exact persistent rejection and unchanged application bytes', () => {
  const f = rejectionFixture(), result = observeTamperedRejection(f), bytes = f.currentLog.subarray(result.rejectionLog.offset, result.rejectionLog.offset + result.rejectionLog.length)
  assert.equal(result.id, f.staged.id); assert.equal(result.flag.state, 'absent'); assert.equal(result.rejectionLog.sha256, hash(bytes)); assert.deepEqual(result.failed, f.staged)
})
test('Linux tamper observation rejects missing/old log, different request, unmodified payload and changed target despite a notification flag', () => {
  for (const changed of [{ currentLog: Buffer.from('prior observation\n') }, { previousLog: rejectionFixture().currentLog }, { failed: { id: 'other-request' } }, { actualSize: 123 }, { actualSHA256: 'a'.repeat(64) }, { targetSHA256: 'd'.repeat(64) }]) {
    assert.throws(() => observeTamperedRejection({ ...rejectionFixture(), flag: { state: 'present', text: 'failure' }, ...changed }))
  }
})

function fakeTransport(mode = 'ready', beforeEvaluationResponse = () => {}) {
  const commands = [], context = { id: 7, uniqueId: 'fixture-context', name: '', origin: 'file://', auxData: { isDefault: true, frameId: 'owned-frame' } }
  let lastSocket
  class FixtureSocket extends EventTarget {
    static OPEN = 1
    constructor() { super(); lastSocket = this; this.readyState = 0; queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')) }) }
    message(message) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })) }
    send(raw) {
      const command = JSON.parse(raw); commands.push(command)
      queueMicrotask(() => {
        if (command.method === 'Runtime.enable') this.message({ id: command.id, result: {} })
        if (command.method === 'Page.enable') this.message({ id: command.id, result: {} })
        if (command.method === 'Page.getFrameTree') {
          this.message({ id: command.id, result: { frameTree: { frame: { id: 'owned-frame', url: mode === 'wrong-url' ? 'file:///different.html' : mode === 'initial-empty' ? '' : 'file:///owned/index.html' } } } })
          setImmediate(() => {
            this.message({ method: 'Runtime.executionContextCreated', params: { context: mode === 'missing' ? { ...context, auxData: { ...context.auxData, isDefault: false } } : context } })
            if (mode === 'initial-empty') setImmediate(() => this.message({ method: 'Page.frameNavigated', params: { frame: { id: 'owned-frame', url: 'file:///owned/index.html' } } }))
          })
        }
        if (command.method === 'Runtime.evaluate') {
          beforeEvaluationResponse()
          if (mode === 'command-error') { this.message({ method: 'Runtime.executionContextDestroyed', params: { executionContextId: 7 } }); this.message({ id: command.id, error: { code: -32000, message: 'Original command failed' } }) }
          else this.message({ id: command.id, result: { result: { value: 42 } } })
        }
      })
    }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')) }
  }
  return { FixtureSocket, commands, message: message => lastSocket.message(message) }
}
const fixtureOptions = transport => ({ url: 'ws://127.0.0.1:1234/private-target', port: 1234, role: 'renderer', ownedPid: 19, ownedChild: { pid: 19, exitCode: null, signalCode: null }, rendererURL: 'file:///owned/index.html', deadline: Date.now() + 1000, WebSocketClass: transport.FixtureSocket })
test('Linux inspector waits for actual default-frame creation before its first evaluation and specifies that context', async () => {
  for (const mode of ['ready', 'initial-empty']) {
    const transport = fakeTransport(mode), events = [], session = await openOwnedInspector({ ...fixtureOptions(transport), observe: event => events.push(event) })
    try { assert.equal(transport.commands.filter(c => c.method === 'Runtime.evaluate').length, 0); assert.equal(await session.evaluate('42'), 42); assert.equal(transport.commands.at(-1).params.contextId, 7); assert(events.some(e => e.name === 'Runtime.executionContextCreated')); assert.equal(session.readiness.ownedPid, 19); if (mode === 'initial-empty') assert(events.some(e => e.name === 'Page.frameNavigated')) }
    finally { session.socket.close() }
  }
})
test('Linux inspector rejects wrong owned PID, changed URL and missing default context without an evaluation', async () => {
  for (const mode of ['ready', 'wrong-url', 'missing']) {
    const transport = fakeTransport(mode), options = fixtureOptions(transport)
    if (mode === 'ready') options.ownedPid = 20
    if (mode === 'missing') options.deadline = Date.now() + 40
    await assert.rejects(openOwnedInspector(options)); assert.equal(transport.commands.filter(c => c.method === 'Runtime.evaluate').length, 0)
  }
})
test('Linux inspector preserves the original command failure and never resends IPC after context destruction', async () => {
  const transport = fakeTransport('command-error'), session = await openOwnedInspector(fixtureOptions(transport))
  try {
    await assert.rejects(session.evaluate('fixture_update_request()'), error => error.cdpError?.code === -32000 && error.cdpError.message === 'Original command failed')
    await assert.rejects(session.evaluate('fixture_update_request()'), /destroyed; IPC will not be retried/)
    assert.equal(transport.commands.filter(c => c.method === 'Runtime.evaluate').length, 1)
  } finally { session.socket.close() }
})
test('Linux inspector permanently rejects a destroyed/cleared context even if the same numeric ID is recreated', async () => {
  for (const method of ['Runtime.executionContextDestroyed', 'Runtime.executionContextsCleared']) {
    const transport = fakeTransport(), session = await openOwnedInspector(fixtureOptions(transport))
    try {
      transport.message({ method, params: { executionContextId: 7 } })
      transport.message({ method: 'Runtime.executionContextCreated', params: { context: { ...session.readiness.context, uniqueId: 'different-original-context' } } })
      await assert.rejects(session.evaluate('fixture_update_request()'), /destroyed; IPC will not be retried/)
      assert.equal(transport.commands.filter(c => c.method === 'Runtime.evaluate').length, 0)
    } finally { session.socket.close() }
  }
})
test('Linux inspector rejects a nominally successful response if its owned child or original context disappeared while awaiting it', async () => {
  for (const ending of ['child-exit', 'context-cleared']) {
    let options
    const transport = fakeTransport('ready', () => { if (ending === 'child-exit') options.ownedChild.exitCode = 0; else transport.message({ method: 'Runtime.executionContextsCleared', params: {} }) })
    options = fixtureOptions(transport); const session = await openOwnedInspector(options)
    try { await assert.rejects(session.evaluate('fixture_update_request()'), /original owned launcher exited|destroyed; IPC will not be retried/); assert.equal(transport.commands.filter(c => c.method === 'Runtime.evaluate').length, 1) }
    finally { session.socket.close() }
  }
})

async function freePort() {
  const server = require('node:net').createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port
  await new Promise(resolve => server.close(resolve)); return port
}
test('actual pinned Electron main and sandboxed private renderer expose observed contexts; navigation rejects the old context without another evaluation', {
  timeout: 40000,
  skip: process.platform === 'linux' && !process.env.DISPLAY ? 'No display on package host; mandatory native-integration executes this actual browser contract under Xvfb' : false
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL update-context contract-')), rootIdentity = fs.realpathSync(root)
  fs.mkdirSync(path.resolve('out'), { recursive: true }); const proof = fs.mkdtempSync(path.resolve('out/linux-context-proof-'))
  const port = await freePort(), mainPort = await freePort(), entry = path.join(root, 'fixture.cjs'), html = path.join(root, 'index.html'), second = path.join(root, 'next.html'), receipt = path.join(proof, 'verification.json')
  fs.writeFileSync(html, '<!doctype html><body>private context contract</body>'); fs.writeFileSync(second, '<!doctype html><body>next owned context</body>')
  const config = { root, html, second, receipt, version: require('../package.json').devDependencies.electron }
  fs.writeFileSync(entry, `
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{app,BrowserWindow}=require('electron'),config=${JSON.stringify(config)};
const profile=path.join(config.root,'profile'),data=path.join(config.root,'config');fs.mkdirSync(profile);fs.mkdirSync(data);app.setPath('userData',profile);app.setPath('appData',data);
const report={contractOnly:true,nativeDesktop:false,complete:false,actual:{pid:process.pid,platform:process.platform,arch:process.arch,electron:process.versions.electron,executable:process.execPath,argv:[...process.argv],profile,appData:data},startedAt:new Date().toISOString()};let revision=0;const save=(final=false)=>{const file=final?config.receipt:path.join(path.dirname(config.receipt),'verification-'+(++revision)+'.json'),bytes=JSON.stringify(report,null,2)+'\\n';fs.writeFileSync(file+'.tmp',bytes,{flag:'wx'});fs.renameSync(file+'.tmp',file);return{file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}};save();let win;const timer=setTimeout(()=>{report.error={message:'Private context contract deadline'};save(true);app.exit(1)},20000);
process.on('message',async message=>{try{if(message.command==='navigate'){await win.loadFile(config.second);report.navigated=true;const saved=save();process.send?.({event:'owned-navigation-saved',pid:process.pid,...saved})}if(message.command==='quit'){report.complete=true;report.closedAt=new Date().toISOString();save(true);clearTimeout(timer);win?.destroy();app.exit(0)}}catch(error){report.error={message:error.message,stack:error.stack};save(true);app.exit(1)}});
app.whenReady().then(async()=>{if(process.versions.electron!==config.version)throw Error('Pinned runtime mismatch');win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});const p=win.webContents.getLastWebPreferences();report.nativeWindowPreferences={sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration};report.ready=true;await win.loadFile(config.html);report.loaded=true;save()}).catch(error=>{report.error={message:error.message,stack:error.stack};save(true);clearTimeout(timer);app.exit(1)});
`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [entry, '--inspect=127.0.0.1:' + mainPort, '--remote-debugging-port=' + port], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const childPid = child.pid, events = []; let stdout = '', stderr = '', main, renderer, primary, outcome, navigationNotice
  child.on('message', message => { if (message?.event === 'owned-navigation-saved' && message.pid === childPid) navigationNotice = { pid: childPid, file: message.file, sha256: message.sha256, observedAt: new Date().toISOString() } })
  child.stdout.on('data', value => { stdout += value }); child.stderr.on('data', value => { stderr += value })
  const closed = new Promise(resolve => child.once('close', (code, signal) => { outcome = { code, signal }; resolve(outcome) }))
  child.once('error', error => { primary ??= error })
  try {
    const deadline = Date.now() + 15000, rendererURL = pathToFileURL(html).href; let page, mainTarget
    for (let i = 0; i < 120 && Date.now() < deadline; i++) {
      assert.equal(child.exitCode, null)
      try { page = (await (await fetch('http://127.0.0.1:' + port + '/json', { signal: AbortSignal.timeout(500) })).json()).find(p => p.url === rendererURL); mainTarget = (await (await fetch('http://127.0.0.1:' + mainPort + '/json', { signal: AbortSignal.timeout(500) })).json())[0]; if (page && mainTarget) break } catch {}
      await wait(30)
    }
    assert(page && mainTarget, 'Actual owned private browser targets did not become available')
    const owned = { ownedPid: childPid, ownedChild: child, deadline, observe: event => { events.push(event); fs.writeFileSync(path.join(proof, 'context-observations.json'), JSON.stringify(events, null, 2)) } }
    main = await openOwnedInspector({ url: mainTarget.webSocketDebuggerUrl, port: mainPort, role: 'main', ...owned })
    const identity = await main.evaluate('({pid:process.pid,platform:process.platform,arch:process.arch,electron:process.versions.electron})', { startupDeadline: true }); assert.equal(identity.pid, childPid); assert.equal(identity.electron, config.version)
    renderer = await openOwnedInspector({ url: page.webSocketDebuggerUrl, port, role: 'renderer', rendererURL, ...owned })
    const observed = await renderer.evaluate('({body:document.body.textContent,url:location.href})', { startupDeadline: true }); assert.equal(observed.body, 'private context contract'); assert.equal(observed.url, rendererURL)
    // Immutable stage receipts avoid replacing evidence an observer/scanner may have open.
    // Wait for the owned child's completed atomic write, then verify its exact snapshot.
    child.send({ command: 'navigate' }); for (let i = 0; i < 100; i++) { if (navigationNotice) break; assert.equal(child.exitCode, null, 'Owned child exited before recording navigation'); await wait(20) }
    assert(navigationNotice && navigationNotice.pid === childPid, 'Actual navigation and its receipt write were not acknowledged by the owned child')
    assert.equal(path.dirname(navigationNotice.file), proof)
    assert.match(path.basename(navigationNotice.file), /^verification-\d+\.json$/)
    const navigationBytes = fs.readFileSync(navigationNotice.file)
    assert.equal(hash(navigationBytes), navigationNotice.sha256)
    const original = JSON.parse(navigationBytes)
    assert.equal(original.navigated, true)
    for (let i = 0; i < 50 && !events.some(e => e.role === 'renderer' && e.name === 'Runtime.executionContextsCleared'); i++) await wait(10)
    const evaluations = events.filter(e => e.name === 'command-sent' && e.value.method === 'Runtime.evaluate').length
    await assert.rejects(renderer.evaluate('fixture_update_request()'), /destroyed; IPC will not be retried/)
    assert.equal(events.filter(e => e.name === 'command-sent' && e.value.method === 'Runtime.evaluate').length, evaluations)
    assert.equal(original.actual.pid, childPid); assert.equal(original.actual.platform, process.platform); assert.equal(original.actual.arch, process.arch); assert.deepEqual(original.nativeWindowPreferences, { sandbox: true, contextIsolation: true, nodeIntegration: false })
    fs.writeFileSync(path.join(proof, 'parent-observation.json'), JSON.stringify({ nativeDesktop: false, contractOnly: true, identity, navigationNotice, mainReadiness: main.readiness, rendererReadiness: renderer.readiness, oldContextRejectedWithoutResend: true, helperSHA256: hash(fs.readFileSync(path.resolve('scripts/linux-update-observer.cjs'))), executableSHA256: hash(fs.readFileSync(require('electron'))) }, null, 2))
  } catch (error) { primary ??= error }
  finally {
    const secondaryErrors = [], failedCleanup = error => { secondaryErrors.push({ message: error.message, stack: error.stack }); primary ??= error }
    try { main?.socket.close(); renderer?.socket.close(); if (child.connected && child.exitCode === null && child.signalCode === null) child.send({ command: 'quit' }) } catch (error) { failedCleanup(error) }
    const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM') }, 5000)
    try { await closed; assert.equal(outcome.code, 0); assert.equal(outcome.signal, null) } catch (error) { failedCleanup(error) } finally { clearTimeout(timer) }
    for (const [name, content] of [['stdout-original.log', stdout], ['stderr-original.log', stderr]]) try { fs.writeFileSync(path.join(proof, name), content, { flag: 'wx' }) } catch (error) { failedCleanup(error) }
    try { assert.equal(fs.realpathSync(root), rootIdentity); assert(fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink()); assert(path.basename(root).startsWith('KAMUCL update-context contract-')); fs.rmSync(root, { recursive: true }) } catch (error) { failedCleanup(error) }
    if (primary) try { fs.writeFileSync(path.join(proof, 'parent-error.json'), JSON.stringify({ message: primary.message, stack: primary.stack, secondaryErrors }, null, 2), { flag: 'wx' }) } catch { /* Original child/observation failure remains primary. */ }
  }
  if (primary) throw primary
  assert.equal(JSON.parse(fs.readFileSync(receipt, 'utf8')).complete, true); console.log('LINUX_CONTEXT_PROOF ' + proof)
})
