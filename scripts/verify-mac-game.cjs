// Native integration test: use the packaged launcher's real install/launch IPC.
// Restricted to disposable GitHub runners; never touches a player's instances.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { spawn, execFileSync } = require('node:child_process')
assert.equal(process.platform, 'darwin'); assert.equal(process.env.GITHUB_ACTIONS, 'true')
const app = path.resolve(process.argv[2]), arch = process.argv[3]
assert.equal(process.arch, arch)
const proof = path.resolve(`release/mac-game-proof-${arch}`)
fs.mkdirSync(proof, { recursive: true })
const { readMacPackageIdentity, collectMacWorldHashes, findMacGameExit, assertMacNormalGameExit } = require('./mac-package-identity.cjs')
const packageIdentity = readMacPackageIdentity(app, {version:require('../package.json').version,arch,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),runtimeVersion:require('../package.json').devDependencies.electron,minimumSystemVersion:'13.0.0'})
fs.writeFileSync(path.join(proof,'package-identity.json'),JSON.stringify(packageIdentity,null,2))
// This job owns its native observation tool; it does not consume another job's
// temporary material fixture. Keep compilation and signature checks before any
// launcher or game process starts so a setup failure cannot strand either one.
const probeSource = path.resolve('scripts/mac-material-fixture.swift')
const fixture = path.join(proof, 'native-window-probe')
const probeTarget = `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macos13.0`
execFileSync('swiftc', [probeSource, '-target', probeTarget, '-o', fixture], { timeout: 60000 })
execFileSync('lipo', [fixture, '-verify_arch', arch === 'x64' ? 'x86_64' : 'arm64'])
execFileSync('codesign', ['--force', '--sign', '-', fixture])
execFileSync('codesign', ['--verify', '--strict', fixture])
const probeHash = file => require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex')
fs.writeFileSync(path.join(proof, 'native-window-probe.json'), JSON.stringify({
  source: path.relative(process.cwd(), probeSource), sourceSHA256: probeHash(probeSource),
  executable: fixture, sha256: probeHash(fixture), arch, target: probeTarget,
  binary: execFileSync('file', [fixture], { encoding: 'utf8' }).trim(),
  signing: 'local ad-hoc; strict signature verified',
  observation: 'CGWindowListCopyWindowInfo and frontmostApplication query the actual owned process window and focus'
}, null, 2))
const log = fs.openSync(path.join(proof, 'launcher.log'), 'w'), env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
// Hosted Intel Macs expose a paravirtual GPU whose Metal argument encoder
// aborts inside MoltenVK. This documented driver setting is CI-only.
if (arch === 'x64') {
  env.MVK_CONFIG_USE_METAL_ARGUMENT_BUFFERS = '0'
  env.MVK_CONFIG_USE_MTLHEAP = '0'
}
const child = spawn(path.join(app, 'Contents/MacOS/KAMUCL'), ['--remote-debugging-port=9230', '--inspect=9231'], { env, stdio: ['ignore', log, log] })
const wait = ms => new Promise(r => setTimeout(r, ms))
let ws, mainWs, evaluate, gamePid, gameFolder, debuggerProcess, events = []
const captureObserver = require('./mac-game-capture-observer.cjs').createGameCaptureObserver({
  proof, getGamePID: () => gamePid, launcherPID: child.pid
})
async function connectRenderer() {
  let page
  for (let i = 0; i < 60; i++) {
    try { page = (await (await fetch('http://127.0.0.1:9230/json')).json()).find(p => p.url.includes('/renderer/index.html')) } catch {}
    if (page) break
    assert.equal(child.exitCode, null); await wait(1000)
  }
  assert(page, 'renderer missing')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }) })
  let id = 0; const pending = new Map()
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id) })
  evaluate = (expression) => new Promise((resolve, reject) => {
    const n = ++id, timer = setTimeout(() => reject(Error('IPC evaluation timed out')), 30000)
    pending.set(n, m => { clearTimeout(timer); const r = m.result; m.error || r?.exceptionDetails ? reject(Error(JSON.stringify(m.error || r.exceptionDetails))) : resolve(r.result.value) })
    ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  await wait(3000)
}
let mainCommandId=10
async function evaluateMain(expression){
  const id=++mainCommandId
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{mainWs.removeEventListener('message',receive);reject(Error('main inspector timeout'))},15000)
    const receive=e=>{const m=JSON.parse(e.data);if(m.id!==id)return;clearTimeout(timeout);mainWs.removeEventListener('message',receive);m.result?.exceptionDetails?reject(Error(JSON.stringify(m.result.exceptionDetails))):resolve(m.result?.result?.value)}
    mainWs.addEventListener('message',receive);mainWs.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}))
  })
}
async function main() {
  await captureObserver.start()
  await connectRenderer()
  const folder = await evaluate(`(async()=>{
    window.__gameTestEvents=[];
    for(const name of ['launchLog','launchState','installDone','progress']) window.kamucl.on('event:'+name,value=>{window.__gameTestEvents.push({name,value});});
    await window.kamucl.invoke('settings:set',{mirror:'official',javaAuto:true,memoryAuto:false,memoryMB:2048,closeAfterLaunch:false,autoUpdate:false});
    await window.kamucl.invoke('accounts:addOffline','NativeMacTest');
    return (await window.kamucl.invoke('folders:list')).active;
  })()`)
  gameFolder = folder
  // Force the reported fresh-install scenario, even if the runner image has Java 25.
  console.log('Hidden runner runtimes', await evaluate(`(async()=>{const list=await window.kamucl.invoke('java:list');const hidden=list.filter(j=>j.major>=25).map(j=>j.path);await window.kamucl.invoke('settings:set',{javaHidden:hidden});return hidden;})()`))
  const version = process.env.MAC_GAME_VERSION || '26.2'
  await evaluate(`window.kamucl.invoke('versions:install',${JSON.stringify(version)},{loader:'fabric',loaderVersion:'0.19.5'})`)
  let installed
  for (let i = 0; i < 600; i++) {
    const batch = await evaluate('window.__gameTestEvents.splice(0)'); events.push(...batch)
    installed = batch.find(e => e.name === 'installDone')?.value
    if (installed) break
    if (i % 15 === 0) console.log('Install', batch.filter(e => e.name === 'progress').at(-1)?.value?.text || 'waiting')
    await wait(1000)
  }
  assert(installed?.ok, 'installation failed: ' + JSON.stringify(installed))
  // Block only Temurin's binary host, reproducing a working metadata lookup but
  // failed GitHub download. Instrument the disposable app via Node's inspector;
  // no production test switches or network-validation bypass are introduced.
  const mainTarget = (await (await fetch('http://127.0.0.1:9231/json')).json())[0]
  mainWs = new WebSocket(mainTarget.webSocketDebuggerUrl)
  await new Promise((r,j)=>{mainWs.addEventListener('open',r,{once:true});mainWs.addEventListener('error',j,{once:true})})
  await new Promise((resolve,reject)=>{
    mainWs.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id===1)m.result?.exceptionDetails?reject(Error(JSON.stringify(m.result.exceptionDetails))):resolve()})
    mainWs.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:`process.mainModule.require('electron').session.defaultSession.webRequest.onBeforeRequest({urls:['https://github.com/adoptium/*']},(details,callback)=>callback({cancel:true}));const cp=process.mainModule.require('child_process'),originalSpawn=cp.spawn;cp.spawn=function(...args){const child=originalSpawn.apply(this,args);if(String(args[0]).endsWith('/bin/java'))child.on('exit',(code,signal)=>console.log('[native-java-exit]',child.pid,code,signal));return child;}`}}))
  })
  // Run the official demo, without requiring or exporting player credentials.
  const idPath = path.join(folder, 'versions', installed.installedId, `${installed.installedId}.json`)
  const metadata = JSON.parse(fs.readFileSync(idPath, 'utf8'))
  const trigger=path.join(path.dirname(idPath),'native-demo.trigger'),classes=path.resolve(`out/mac-demo-probe-${arch}`)
  fs.mkdirSync(classes,{recursive:true});fs.mkdirSync(path.join(path.dirname(idPath),'mods'),{recursive:true})
  const loader=path.join(folder,'libraries/net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar')
  execFileSync(path.join(process.env.JAVA_HOME,'bin/javac'),['--release','17','-cp',loader,'-d',classes,'scripts/fixtures/MacDemoProbe.java'])
  fs.writeFileSync(path.join(classes,'fabric.mod.json'),JSON.stringify({schemaVersion:1,id:'kamucl_native_demo_probe',version:'1',environment:'client',entrypoints:{client:['kamucltest.MacDemoProbe']}}))
  execFileSync(path.join(process.env.JAVA_HOME,'bin/jar'),['cf',path.join(path.dirname(idPath),'mods/native-demo-test-only.jar'),'-C',classes,'.'])
  metadata.arguments ??= {}; metadata.arguments.game ??= []
  metadata.arguments.jvm ??=[];metadata.arguments.jvm.push('-Dkamucl.nativeProofTrigger='+trigger)
  metadata.arguments.game.push('--demo'); fs.writeFileSync(idPath, JSON.stringify(metadata))
  await evaluate(`window.kamucl.invoke('game:launch',${JSON.stringify(installed.installedId)},null,${JSON.stringify(folder)})`)
  let nativeWindow, lastState
  for (let i = 0; i < 240; i++) {
    const batch = await evaluate('window.__gameTestEvents.splice(0)'); events.push(...batch)
    for (const e of batch) {
      if (e.name === 'launchState') { lastState = e.value; console.log('Launch state', lastState) }
      if (e.name === 'launchLog') { console.log(e.value); const match = /游戏进程已启动.*pid=(\d+)/.exec(e.value); if (match) gamePid = Number(match[1]) }
    }
    // launch PID is persisted by the real launcher; never discover/kill unrelated Java processes.
    if (!gamePid) {
      const homes = [path.join(process.env.HOME, 'Library/Application Support/kamucl'), path.join(process.env.HOME, 'Library/Application Support/KAMUCL')]
      for (const home of homes) {
        try { const info = JSON.parse(fs.readFileSync(path.join(home, 'running-game.json'), 'utf8')); if (info.versionId === installed.installedId) gamePid = info.pid } catch {}
      }
    }
    if (gamePid && arch === 'x64' && process.env.MAC_GAME_NATIVE_DEBUG === '1' && !debuggerProcess) {
      const output = fs.openSync(path.join(proof, 'native-backtrace.txt'), 'w')
      debuggerProcess = spawn('/usr/bin/sudo', ['/usr/bin/lldb', '--batch',
        '-O', 'settings set platform.plugin.darwin.ignored-exceptions EXC_BAD_ACCESS|EXC_BAD_INSTRUCTION|EXC_ARITHMETIC', '-p', String(gamePid),
        '-o', 'process handle SIGSEGV -s false -n false -p true',
        '-o', 'process handle SIGBUS -s false -n false -p true',
        '-o', 'process handle SIGILL -s false -n false -p true',
        '-o', 'continue', '-k', 'thread backtrace all', '-o', 'thread backtrace all', '-o', 'detach'], { stdio: ['ignore', output, output] })
      fs.closeSync(output)
    }
    assert(!['error', 'exited'].includes(lastState?.status), 'game failed: ' + JSON.stringify(lastState))
    if (gamePid) try { nativeWindow = JSON.parse(execFileSync(fixture, ['--window-id', String(gamePid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) } catch {}
    if (gamePid && i === 90) {
      try { execFileSync('/usr/bin/sample', [String(gamePid), '3', '-file', path.join(proof, 'game-sample.txt')], { timeout: 15000, stdio: 'ignore' }) } catch {}
      try { execFileSync(path.join(process.env.JAVA_HOME,'bin/jcmd'), [String(gamePid),'Thread.print'], { timeout: 15000, stdio: ['ignore', fs.openSync(path.join(proof,'game-threads.txt'),'w'), 'ignore'] }) } catch {}
    }
    if (nativeWindow && events.some(e => e.name === 'launchLog' && /Created: .*textures\/atlas\/gui/.test(e.value))) break
    await wait(1000)
  }
  assert(nativeWindow, 'Minecraft did not create a native window')
  assert(events.some(e => e.name === 'launchLog' && /Created: .*textures\/atlas\/gui/.test(e.value)), 'Minecraft did not finish creating its GUI textures')
  assert(events.some(e => e.name === 'progress' && /Java 25 就绪 · Azul Zulu/.test(e.value.text)), 'Java fallback was not exercised')
  await wait(10000)
  events.push(...await evaluate('window.__gameTestEvents.splice(0)'))
  assert(!events.some(e => e.name === 'launchState' && ['error', 'exited'].includes(e.value.status)), 'game exited during initialization')
  await captureObserver.capture('minecraft.png', gamePid)
  // Observe the real new-window handshake and the main process's own state replay.
  // Connecting CDP (and its fixed initial settle delay) does not imply that async
  // account/instance/assets boot tasks have emitted boot:renderer-ready yet.
  await evaluateMain(`(()=>{
    const electron=process.mainModule.require('electron');globalThis.__dockReopenObservation={events:[]};
    const note=value=>__dockReopenObservation.events.push({at:Date.now(),...value});
    electron.ipcMain.on('boot:stage',(event,stage)=>note({kind:'boot-stage',sender:event.sender.id,stage}));
    electron.ipcMain.on('boot:renderer-ready',event=>note({kind:'renderer-ready',sender:event.sender.id}));
    electron.app.on('browser-window-created',(_event,window)=>{
      note({kind:'window-created',sender:window.webContents.id,windowId:window.id});
      const original=window.webContents.send;
      window.webContents.send=function(channel,...args){if(channel==='event:launchState')note({kind:'launch-state',sender:this.id,state:args[0]});return original.call(this,channel,...args)};
    });
  })()`)
  await evaluateMain(`process.mainModule.require('electron').BrowserWindow.getAllWindows().forEach(w=>w.close())`)
  await wait(1500);process.kill(gamePid,0)
  assert.equal(await evaluateMain(`process.mainModule.require('electron').BrowserWindow.getAllWindows().length`),0)
  await evaluateMain(`process.mainModule.require('electron').app.emit('activate')`)
  await connectRenderer()
  const dockReopen = await require('./mac-reopen-observer.cjs').observeDockReopen({
    expected: { pid: gamePid, versionId: installed.installedId },
    timeoutMs: 10000,
    record: value => fs.writeFileSync(path.join(proof, 'dock-reopen.json'), JSON.stringify({arch,version,source:'Existing test app.emit(activate) invokes the production activation handler; observed actual main-process boot/launch-state sends, owned PID and visible running UI; no synthetic state replay',...value}, null, 2)),
    snapshot: async () => {
      let gameAlive = true; try { process.kill(gamePid, 0) } catch { gameAlive = false }
      const [main, renderer] = await Promise.all([
        evaluateMain(`(()=>{const e=process.mainModule.require('electron'),fs=process.mainModule.require('fs'),p=process.mainModule.require('path'),w=e.BrowserWindow.getAllWindows().find(w=>!w.isDestroyed());let runningRecord=null;try{const r=JSON.parse(fs.readFileSync(p.join(e.app.getPath('userData'),'running-game.json'),'utf8'));runningRecord={pid:r.pid,versionId:r.versionId}}catch{}return{events:__dockReopenObservation.events,runningRecord,window:w?{id:w.id,webContentsId:w.webContents.id,visible:w.isVisible(),minimized:w.isMinimized(),bounds:w.getBounds(),loading:w.webContents.isLoading()}:null}})()`),
        evaluate(`(()=>{const e=document.querySelector('.runtime-state.running strong'),r=e?.getBoundingClientRect(),style=e?getComputedStyle(e):null;return{documentReady:document.readyState,bodyText:document.body.innerText,runningText:e?.textContent?.trim()??null,visible:!!e&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):style.display!=='none'&&style.visibility==='visible'&&Number(style.opacity)>0),bounds:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null}})()`)
      ])
      return { gameAlive, main, renderer }
    }
  })
  await captureObserver.capture('dock-reopen.png', child.pid)
  assert(dockReopen.ready, 'Dock reopen forgot the live game: within 10 seconds require real current-window boot/state replay, live owned PID and visible 游戏运行中; original observations saved')
  await evaluate(`window.__gameTestEvents=[];for(const name of ['launchLog','launchState'])window.kamucl.on('event:'+name,value=>window.__gameTestEvents.push({name,value}));`)
  const helper=path.join(app,'Contents/Resources/app.asar.unpacked/out/main/MacGameWindow')
  execFileSync('/usr/bin/open',['-a',app]);await wait(1500)
  assert.equal(Number(execFileSync(fixture,['--front-pid'],{encoding:'utf8'}).trim()),child.pid,'launcher must own focus before game focus test')
  execFileSync(helper,['focus',String(gamePid),'15000'],{timeout:17000})
  // Drive the real client button through a test-only Fabric mod, without relying
  // on permission to synthesize desktop mouse input in a hosted Mac session.
  fs.writeFileSync(trigger,'play-demo')
  let worldStarted=false
  for(let i=0;i<150;i++){
    const batch=await evaluate('window.__gameTestEvents.splice(0)');events.push(...batch)
    for(const e of batch.filter(e=>e.name==='launchLog'))console.log(e.value)
    if(events.some(e=>e.name==='launchLog'&&/logged in with entity id|joined the game/.test(e.value))){worldStarted=true;break}
    process.kill(gamePid,0);await wait(1000)
  }
  assert(worldStarted,'demo world did not start')
  await wait(10000) // Let the client finish its terrain transition before capturing it.
  await captureObserver.capture('minecraft-world.png', gamePid)
  execFileSync(helper,['close',String(gamePid),'6000'],{timeout:8000})
  const expectedExit={versionId:installed.installedId,folder,launchId:lastState?.launchId}
  let exited=false
  for(let i=0;i<90;i++){
    events.push(...await evaluate('window.__gameTestEvents.splice(0)'))
    try{process.kill(gamePid,0)}catch{exited=true}
    if(exited&&findMacGameExit(events,expectedExit))break
    await wait(1000)
  }
  assert(exited,'normal Cocoa close did not exit Minecraft')
  const normalExit=assertMacNormalGameExit(events,expectedExit)
  assert(events.some(e=>e.name==='launchLog'&&/Stopping!|Stopping the|Saving|正常退出|退出.*0/.test(e.value)),'game did not report a normal shutdown')
  const saveDir=path.join(path.dirname(idPath),'saves','Demo_World')
  assert(fs.statSync(path.join(saveDir,'level.dat')).size>0,'demo world metadata was not saved')
  const regionDir=path.join(saveDir,'dimensions','minecraft','overworld','region')
  const regionFiles=fs.readdirSync(regionDir).filter(f=>f.endsWith('.mca')&&fs.statSync(path.join(regionDir,f)).size>0)
  assert(regionFiles.length>0,'demo world chunks were not saved')
  // Observe final save bytes only after this owned game has exited; never publish the world.
  const world=collectMacWorldHashes(saveDir)
  fs.writeFileSync(path.join(proof,'saved-world-hashes.json'),JSON.stringify(world,null,2))
  assert(!fs.readFileSync(path.join(proof,'launcher.log'),'utf8').includes('Object has been destroyed'),'closed window broke background callbacks')
  fs.writeFileSync(path.join(proof, 'verification.json'), JSON.stringify({ arch, version, packageIdentity, nativeWindow, gamePid, gameWindow: true, worldStarted,savedWorld:true,world,normalExit:{...normalExit,saved:true},regionFiles,nativeFocus:true, gracefulClose:true,closeAndDockReopen:true,ciMetalArgumentBuffers:env.MVK_CONFIG_USE_METAL_ARGUMENT_BUFFERS??null,ciMetalHeap:env.MVK_CONFIG_USE_MTLHEAP??null }, null, 2))
  gamePid=null
  console.log('PASS actual Minecraft window', arch, version)
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => {
  try {
  try { if (evaluate) events.push(...await evaluate('window.__gameTestEvents.splice(0)')) } catch {}
  fs.writeFileSync(path.join(proof, 'events.json'), JSON.stringify(events, null, 2))
  if (process.exitCode) {
    await wait(10000) // macOS writes its native crash report asynchronously.
    for (const [name, command, args] of [
      ['graphics.txt', '/usr/sbin/system_profiler', ['SPDisplaysDataType']],
      ['native-system.log', '/usr/bin/log', ['show', '--last', '5m', '--style', 'compact', '--predicate', 'process == "java" OR eventMessage CONTAINS "java"']]
    ]) try { fs.writeFileSync(path.join(proof, name), execFileSync(command, args, { timeout: 20000, maxBuffer: 8 * 1024 * 1024 })); } catch {}
  }
  // Preserve native crash evidence as well as Java stdout in the disposable runner.
  for (const root of [gameFolder, path.join(process.env.HOME, 'Library/Logs/DiagnosticReports'), '/Library/Logs/DiagnosticReports']) {
    if (!root || !fs.existsSync(root)) continue
    const walk = (dir, depth) => {
      if (depth > 4) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(file, depth + 1)
        else if (entry.isFile() && /^(hs_err_pid.*\.log|java.*\.(ips|crash)|crash-.*\.txt)$/.test(entry.name)) {
          fs.copyFileSync(file, path.join(proof, entry.name))
          console.log('Native crash evidence', entry.name, fs.readFileSync(file, 'utf8').slice(0, 20000))
        }
      }
    }
    try { walk(root, 0) } catch (e) { console.log('Crash evidence read', e.message) }
  }
  if (gamePid) try { process.kill(gamePid, 'SIGTERM') } catch {}
  mainWs?.close(); ws?.close()
  const ended=new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve)})
  child.kill('SIGTERM');await ended;fs.closeSync(log)
  // Startup/tools/update run in independent required jobs against this exact bundle.
  // A failed or slow game run must not consume their native validation budget.
  } finally {
    try { await captureObserver.stop() } catch (e) { console.error(e); process.exitCode = 1 }
  }
})
