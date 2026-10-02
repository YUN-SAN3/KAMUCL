// Real PCL-exported MRPACK acceptance. All writes and games are isolated under out.
// Pass the private archive explicitly; it is never copied into public source/artifacts.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const assert = require('node:assert/strict'), net = require('node:net'), { spawn, execFileSync } = require('node:child_process')
const Zip = require('adm-zip')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const digest = (bytes, algorithm = 'sha256') => crypto.createHash(algorithm).update(bytes).digest('hex')
const input = path.resolve(process.argv[2] || '')
assert(fs.statSync(input).isFile(), 'Supply the private PCL exported ZIP')
const root = path.resolve(process.env.KAMUCL_PCL_QA_ROOT || fs.mkdtempSync(path.resolve('out/pcl-real-119-')))
assert(root.startsWith(path.resolve('out') + path.sep), 'QA root must remain under ignored out')
const profile = path.join(root, 'profile'), games = path.join(root, 'games'), proofFile = path.join(root, 'proof.json')
fs.mkdirSync(profile, { recursive: true }); fs.mkdirSync(games, { recursive: true })
if (!fs.existsSync(path.join(profile, 'settings.json'))) fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ gameDir: games, activeFolder: games, folders: [{ path: games, name: 'Isolated PCL acceptance', isDefault: true }], autoUpdate: false, mirror: 'official', memoryAuto: false, memoryMB: 3072, closeAfterLaunch: false, javaAuto: true }))
const previous = fs.existsSync(proofFile) ? JSON.parse(fs.readFileSync(proofFile)) : null
if (previous) fs.copyFileSync(proofFile, path.join(root, 'proof-attempt-' + Date.now() + '.json'))
const proof = { version: require('../package.json').version, product: process.env.KAMUCL_PCL_APP ? 'supplied production executable' : 'built development entry', archiveSHA256: digest(fs.readFileSync(input)), root, startedAt: new Date().toISOString(), realServices: true, fixtureTransport: false, attempts: previous ? [...(previous.attempts || []), { startedAt: previous.startedAt, finishedAt: previous.finishedAt, error: previous.error, installedId: previous.installedId, classification: previous.classification }] : [], complete: false, events: [] }
assert.equal(proof.archiveSHA256, '7890ac1dbf08c116173adcb1929ed46d701cf99c0538e87847b7296d1edf25a3')
const save = () => fs.writeFileSync(proofFile, JSON.stringify(proof, null, 2))
const port = async () => { const server = net.createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); const value = server.address().port; await new Promise(r => server.close(r)); return value }
let child, ws, mainWs, evaluate, main, ownGamePid, activeTask
async function connect(url, required) {
  for (let i = 0; i < 90; i++) {
    assert.equal(child.exitCode, null, 'QA launcher exited before inspector readiness')
    try { const targets = await (await fetch(url)).json(), page = targets.find(required); if (page) { const socket = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { socket.addEventListener('open', r, { once: true }); socket.addEventListener('error', j, { once: true }) }); return socket } } catch {}
    await wait(500)
  }
  throw Error('Inspector readiness timeout')
}
function inspector(socket) {
  let id = 0; const pending = new Map()
  socket.addEventListener('message', e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m) })
  return expression => new Promise((resolve, reject) => {
    const n = ++id, timer = setTimeout(() => { pending.delete(n); reject(Error('Inspector evaluation timed out')) }, 60000)
    pending.set(n, m => { clearTimeout(timer); pending.delete(n); const r = m.result; m.error || r?.exceptionDetails ? reject(Error(JSON.stringify(m.error || r.exceptionDetails))) : resolve(r?.result?.value) })
    socket.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
}
async function drain() { const events = await evaluate('window.__pclRealEvents.splice(0)'); proof.events.push(...events); save(); return events }
async function verifyFiles(id) {
  const instance = path.join(games, 'versions', id), zip = new Zip(input)
  const manifest = JSON.parse(zip.getEntry('modrinth.index.json').getData().toString())
  assert.equal(manifest.dependencies.minecraft, '1.20.1'); assert.equal(manifest.dependencies.forge, '47.4.23')
  proof.manifestFiles = []
  for (const [index, entry] of manifest.files.entries()) {
    const file = path.join(instance, entry.path), bytes = fs.readFileSync(file)
    for (const [algorithm, expected] of Object.entries(entry.hashes)) assert.equal(digest(bytes, algorithm), expected, 'Download hash mismatch at manifest item ' + index)
    proof.manifestFiles.push({ index, category: entry.path.split('/')[0], bytes: bytes.length, sha1: digest(bytes, 'sha1'), sha512: digest(bytes, 'sha512'), verified: true })
  }
  // Do not expose private save names or individual save hashes in public proof.
  const overrideGroups = {}
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith('overrides/')) continue
    const rel = entry.entryName.slice(10), expected = entry.getData(), actual = fs.readFileSync(path.join(instance, rel))
    assert(actual.equals(expected), 'Override byte mismatch in category ' + rel.split('/')[0])
    const group = rel.split('/')[0]; overrideGroups[group] = (overrideGroups[group] || 0) + 1
  }
  const count = directory => fs.readdirSync(path.join(instance, directory), { withFileTypes: true }).filter(e => e.isFile() && /\.(jar|zip)$/.test(e.name)).length
  const worlds = fs.readdirSync(path.join(instance, 'saves'), { withFileTypes: true }).filter(e => e.isDirectory() && fs.existsSync(path.join(instance, 'saves', e.name, 'level.dat'))).length
  proof.counts = { mods: count('mods'), resourcepacks: count('resourcepacks'), shaderpacks: count('shaderpacks'), worlds }
  assert.deepEqual(proof.counts, { mods: 46, resourcepacks: 4, shaderpacks: 2, worlds: 1 })
  proof.overrideGroups = overrideGroups; proof.overrideByteEquality = true
  const metadata = JSON.parse(fs.readFileSync(path.join(instance, id + '.json')))
  assert.equal(metadata._mcVersion, '1.20.1'); assert.equal(metadata._loader, 'forge'); assert.equal(metadata._loaderVersion, '47.4.23')
  proof.metadata = { mcVersion: metadata._mcVersion, loader: metadata._loader, loaderVersion: metadata._loaderVersion, isolated: metadata._gameDir }
  assert.equal(digest(fs.readFileSync(input)), proof.archiveSHA256)
}
(async () => {
  const rendererPort = await port(), mainPort = await port(), log = fs.openSync(path.join(root, 'launcher.log'), 'a')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const app = process.env.KAMUCL_PCL_APP || path.resolve('node_modules/electron/dist/electron.exe')
  child = spawn(app, [...(process.env.KAMUCL_PCL_APP ? [] : ['.']), `--user-data-dir=${profile}`, `--remote-debugging-port=${rendererPort}`, `--inspect=127.0.0.1:${mainPort}`], { env, stdio: ['ignore', log, log], windowsHide: true })
  fs.closeSync(log)
  ws = await connect(`http://127.0.0.1:${rendererPort}/json`, p => p.url.includes('/renderer/index.html'))
  mainWs = await connect(`http://127.0.0.1:${mainPort}/json`, p => !!p.webSocketDebuggerUrl)
  evaluate = inspector(ws); main = inspector(mainWs)
  const runtime = await main("(()=>{const require=process.mainModule.require.bind(process.mainModule),app=require('electron').app,fs=require('node:fs'),path=require('node:path'),entry=path.join(app.getAppPath(),JSON.parse(fs.readFileSync(path.join(app.getAppPath(),'package.json'))).main);return{userData:app.getPath('userData'),version:app.getVersion(),entry,mainSHA256:require('node:crypto').createHash('sha256').update(fs.readFileSync(entry)).digest('hex')}})()")
  assert.equal(path.resolve(runtime.userData).toLowerCase(), profile.toLowerCase(), 'Profile isolation must hold')
  proof.runtime = runtime; save()
  await evaluate("(()=>{window.__pclRealEvents=[];for(const name of ['progress','installDone','taskDone','launchState','launchLog'])window.kamucl.on('event:'+name,value=>window.__pclRealEvents.push({name,value,at:Date.now()}))})()")
  const settings = await evaluate("window.kamucl.invoke('settings:get')")
  assert.equal(path.resolve(settings.gameDir).toLowerCase(), games.toLowerCase()); assert.equal(settings.folders.length, 1)
  const hasClassifier = await main("process.mainModule.require('electron').ipcMain._invokeHandlers.has('import:probe')")
  proof.classification = hasClassifier ? await evaluate(`window.kamucl.invoke('import:probe',${JSON.stringify(input)})`) : { pending: true, reason: 'pre-change production entry lacks classifier; legacy modpack:probe still real' }
  if (hasClassifier) assert.equal(proof.classification.kind, 'modpack')
  // Sanitize the private pack name in evidence; retain the generic resource counts.
  if (proof.classification.info) for (const key of ['name', 'innerName', 'fileName']) if (key in proof.classification.info) proof.classification.info[key] = '[private PCL pack]'
  proof.probe = await evaluate(`window.kamucl.invoke('modpack:probe',${JSON.stringify(input)})`)
  for (const key of ['name', 'innerName', 'fileName']) if (key in proof.probe) proof.probe[key] = '[private PCL pack]'; assert.equal(proof.probe.mcVersion, '1.20.1'); assert.equal(proof.probe.loaderVersion, '47.4.23'); save()
  let id = process.env.KAMUCL_PCL_EXISTING_ID
  if (!id) {
    const result = await evaluate(`window.kamucl.invoke('modpack:install',${JSON.stringify(input)},{instanceName:${JSON.stringify(process.env.KAMUCL_PCL_INSTANCE_NAME || 'PCL-real-119')},targetFolder:${JSON.stringify(games)}})`)
    activeTask = result?.taskId || result?.id || (typeof result === 'string' ? result : null)
    proof.installStartResponse = result; save(); let done
    for (let i = 0; i < 3600; i++) {
      const batch = await drain(); done = batch.find(e => e.name === 'installDone')?.value
      if (done) break
      if (i % 15 === 0) console.log(JSON.stringify({ root, phase: 'real install', progress: batch.filter(e => e.name === 'progress').at(-1)?.value?.text || 'waiting' }))
      await wait(1000)
    }
    assert(done, 'Real install timed out after 60 minutes'); proof.installResult = done; save(); assert(done.ok, 'Real installation failed: ' + JSON.stringify(done)); id = done.versionId
  }
  proof.installedId = id; await verifyFiles(id); save()
  if (process.env.KAMUCL_PCL_NO_LAUNCH !== '1') {
    await evaluate("window.kamucl.invoke('accounts:addOffline','PCLAcceptance')")
    proof.java = await evaluate("window.kamucl.invoke('java:list')"); save()
    await evaluate(`window.kamucl.invoke('game:launch',${JSON.stringify(id)},null,${JSON.stringify(games)})`)
    let ready = false
    for (let i = 0; i < 240; i++) {
      const events = await drain(), state = events.filter(e => e.name === 'launchState').at(-1)?.value
      if (['error', 'exited'].includes(state?.status)) { proof.gameFailure = state; throw Error('Real game launch failed: ' + JSON.stringify(state)) }
      try { const running = JSON.parse(fs.readFileSync(path.join(profile, 'running-game.json'))); if (running.versionId === id) ownGamePid = running.pid } catch {}
      const logFile = path.join(games, 'versions', id, 'logs/latest.log'), text = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''
      if (ownGamePid && /\[Render thread\/INFO\].*OpenAL initialized/.test(text) && /\[Render thread\/INFO\].*Created:.*atlas/.test(text)) { proof.gameRenderReady = { pid: ownGamePid, at: Date.now(), logSignals: [...new Set(text.split('\n').filter(l => /\[Render thread\/INFO\].*(?:OpenAL initialized|Created:.*atlas)/.test(l)).map(l => l.replace(/^\[[^\]]*\]/, '[time]')).slice(-8))] }; ready = true; break }
      if (i % 15 === 0) console.log(JSON.stringify({ root, phase: 'actual game', ownGamePid, state }))
      await wait(1000)
    }
    assert(ready, 'No actual render/resource initialization signal within four minutes')
    await wait(10000); await drain()
    proof.gameStillRunning = fs.existsSync(path.join(profile, 'running-game.json'))
    assert(proof.gameStillRunning, 'Game exited shortly after resource readiness')
    if (process.platform === 'win32') {
      const native = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-Process -Id ${ownGamePid} | Select-Object Id,MainWindowHandle,MainWindowTitle | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true }))
      assert.equal(native.Id, ownGamePid); assert(native.MainWindowHandle, 'Owned Java process must have an actual native window'); assert(native.MainWindowTitle.includes('1.20.1'))
      proof.nativeWindow = native
      const koffi = require('koffi'), user = koffi.load('user32.dll'), rectType = koffi.struct('PclQARect', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
      const getRect = user.func('GetWindowRect', 'bool', ['uintptr', koffi.out(koffi.pointer(rectType))]), isVisible = user.func('bool __stdcall IsWindowVisible(uintptr_t)'), isIconic = user.func('bool __stdcall IsIconic(uintptr_t)'), foreground = user.func('uintptr_t __stdcall GetForegroundWindow()'), restore = user.func('bool __stdcall ShowWindow(uintptr_t,int)'), focus = user.func('bool __stdcall SetForegroundWindow(uintptr_t)')
      const rect = {}; assert(getRect(native.MainWindowHandle, rect)); proof.nativeWindow.beforeCapture = { visible: isVisible(native.MainWindowHandle), iconic: isIconic(native.MainWindowHandle), bounds: rect }
      restore(native.MainWindowHandle, 9); focus(native.MainWindowHandle); await wait(750)
      const captureOwnedWindow=async()=>{
        assert(getRect(native.MainWindowHandle,rect),'Owned window still exists');
      const capture = await main(`(async()=>{const e=process.mainModule.require('electron'),sources=await e.desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1280,height:800}}),s=sources.find(s=>s.id.startsWith('window:${native.MainWindowHandle}:'));if(!s)return{found:false,gameSources:sources.filter(s=>s.name.includes('Minecraft')).map(s=>({id:s.id,name:s.name})),sourceCount:sources.length};const fs=process.mainModule.require('node:fs');fs.writeFileSync(${JSON.stringify(path.join(root, 'game-window.png'))},s.thumbnail.toPNG());return{found:true,id:s.id,size:s.thumbnail.getSize()}})()`)
      proof.gameWindowCapture = capture
      if (!capture.found || !capture.size.width) {
        const printed = await main(`(()=>{const require=process.mainModule.require.bind(process.mainModule),k=require(${JSON.stringify(require.resolve('koffi'))}),u=k.load('user32.dll'),g=k.load('gdi32.dll'),hwnd=${native.MainWindowHandle},width=${rect.right-rect.left},height=${rect.bottom-rect.top},dc=u.func('uintptr_t __stdcall GetWindowDC(uintptr_t)')(hwnd),mem=g.func('uintptr_t __stdcall CreateCompatibleDC(uintptr_t)')(dc),bitmap=g.func('uintptr_t __stdcall CreateCompatibleBitmap(uintptr_t,int,int)')(dc,width,height),select=g.func('uintptr_t __stdcall SelectObject(uintptr_t,uintptr_t)'),old=select(mem,bitmap);try{const ok=u.func('bool __stdcall PrintWindow(uintptr_t,uintptr_t,uint32_t)')(hwnd,mem,2),info=Buffer.alloc(40),pixels=Buffer.alloc(width*height*4);info.writeUInt32LE(40,0);info.writeInt32LE(width,4);info.writeInt32LE(-height,8);info.writeUInt16LE(1,12);info.writeUInt16LE(32,14);const lines=g.func('int __stdcall GetDIBits(uintptr_t,uintptr_t,uint32_t,uint32_t,void*,void*,uint32_t)')(mem,bitmap,0,height,pixels,info,0),colors=new Set();for(let i=0;i<pixels.length;i+=4){colors.add((pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2]);pixels[i+3]=255}if(!ok||lines!==height||colors.size<16)return{found:false,api:'Win32 PrintWindow(PW_RENDERFULLCONTENT)+GetDIBits of owned HWND',ok,lines,uniqueColors:colors.size};const image=require('electron').nativeImage.createFromBitmap(pixels,{width,height});require('fs').writeFileSync(${JSON.stringify(path.join(root,'game-window.png'))},image.toPNG());return{found:true,api:'Win32 PrintWindow(PW_RENDERFULLCONTENT)+GetDIBits of owned HWND',size:image.getSize(),uniqueColors:colors.size}}finally{select(mem,old);g.func('bool __stdcall DeleteObject(uintptr_t)')(bitmap);g.func('bool __stdcall DeleteDC(uintptr_t)')(mem);u.func('int __stdcall ReleaseDC(uintptr_t,uintptr_t)')(hwnd,dc)}})()`)
        proof.ownedPrintWindow = printed
        if (printed.found) proof.windowCaptureFallback = printed
        else {
        // OpenGL can yield an empty WGC thumbnail. Capture only the verified foreground
        // owned HWND's screen rectangle, and reject if another app takes focus.
        assert.equal(Number(foreground()), native.MainWindowHandle, 'Owned game must be foreground before cropped screen capture')
        assert(getRect(native.MainWindowHandle, rect)); const box = { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top }
        const fallback = await main(`(async()=>{const e=process.mainModule.require('electron'),b=${JSON.stringify(box)},display=e.screen.getDisplayMatching(b),size={width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor)},sources=await e.desktopCapturer.getSources({types:['screen'],thumbnailSize:size}),s=sources.find(s=>s.display_id===String(display.id));if(!s)return{found:false};const actual=s.thumbnail.getSize(),ratio=actual.width/display.bounds.width,crop={x:Math.max(0,Math.round((b.x-display.bounds.x)*ratio)),y:Math.max(0,Math.round((b.y-display.bounds.y)*ratio)),width:Math.min(actual.width,Math.round(b.width*ratio)),height:Math.min(actual.height,Math.round(b.height*ratio))};crop.width=Math.min(crop.width,actual.width-crop.x);crop.height=Math.min(crop.height,actual.height-crop.y);const image=s.thumbnail.crop(crop);process.mainModule.require('node:fs').writeFileSync(${JSON.stringify(path.join(root, 'game-window.png'))},image.toPNG());return{found:true,api:'Electron desktopCapturer screen cropped to owned foreground HWND Win32 GetWindowRect',bounds:b,displayBounds:display.bounds,crop,size:image.getSize()}})()`)
        assert.equal(Number(foreground()), native.MainWindowHandle, 'Owned game must retain foreground through cropped screen capture')
        proof.windowCaptureFallback = fallback; assert(fallback.found && fallback.size.width > 0, 'Actual owned window cropped capture must be available')
        }
      }
      }
      // Resource/atlas logs can precede the actual title screen. Preserve every
      // native capture time and wait for two real menu-like button-band frames.
      // This does not click the game or open any imported user world.
      const sharp=require('sharp'),menuBands=require('./pcl-title-frame-119.cjs')
      proof.titleFrameObservations=[];let menuFrames=0
      for(let attempt=0;attempt<120;attempt++){
        await captureOwnedWindow()
        const bytes=fs.readFileSync(path.join(root,'game-window.png')),raw=await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true}),observed=menuBands(raw.info.width,raw.info.height,raw.data)
        proof.titleFrameObservations.push({at:Date.now(),attempt,...observed,sha256:digest(bytes)});save()
        if(!attempt)fs.writeFileSync(path.join(root,'first-title-attempt.png'),bytes)
        menuFrames=observed.menuLike?menuFrames+1:0
        if(menuFrames>=2){proof.mainMenuCaptured=true;break}
        assert(fs.existsSync(path.join(profile,'running-game.json')),'Game must remain running while waiting for title screen')
        await wait(1000)
      }
      assert(proof.mainMenuCaptured,'Owned game title menu did not appear; preserve original loading frames')

    }
  } else proof.gameLaunch = { covered: false, reason: 'explicit QA no-launch option' }
  proof.complete = true; proof.finishedAt = new Date().toISOString(); save()
  const publicSummary = { version: proof.version, product: proof.product, startedAt: proof.startedAt, finishedAt: proof.finishedAt, archiveSHA256: proof.archiveSHA256, mainSHA256: proof.runtime.mainSHA256, fixtureTransport: false, realServices: true, classification: proof.classification.kind, mcVersion: proof.metadata.mcVersion, loader: proof.metadata.loader, loaderVersion: proof.metadata.loaderVersion, counts: proof.counts, manifestFilesVerified: proof.manifestFiles.length, verifiedAlgorithms: ['sha1', 'sha512'], overrideGroups: proof.overrideGroups, overrideByteEquality: proof.overrideByteEquality, originalArchiveUnchanged: true, gameAudioAndTextureInitialization: !!proof.gameRenderReady, nativeGameWindow: !!proof.nativeWindow, mainMenuCaptured: !!proof.mainMenuCaptured, titleFrameObservations: proof.titleFrameObservations, gameStillRunningAfterTenSeconds: proof.gameStillRunning, capturedOwnedGameWindow: !!proof.windowCaptureFallback?.found || !!(proof.gameWindowCapture?.found && proof.gameWindowCapture.size?.width), captureAPI: proof.windowCaptureFallback?.api || "Electron desktopCapturer window thumbnail", captureSize: proof.windowCaptureFallback?.size || proof.gameWindowCapture?.size, screenshotSHA256: fs.existsSync(path.join(root, 'game-window.png')) ? digest(fs.readFileSync(path.join(root, 'game-window.png'))) : null, complete: true, limitations: ['Actual imported world play is not covered; no world was opened.', 'Offline QA account; Microsoft authentication is not covered.', 'Native game initialization is tested on this Windows host only.'] }
  fs.writeFileSync(path.join(root, 'safe-summary.json'), JSON.stringify(publicSummary, null, 2))
  console.log(JSON.stringify({ proofFile, complete: proof.complete, counts: proof.counts, game: proof.gameRenderReady }))
})().catch(error => { proof.error = String(error.stack || error); proof.finishedAt = new Date().toISOString(); save(); console.error(error); process.exitCode = 1 }).finally(async () => {
  // Only the PID recorded by this disposable launcher can be stopped.
  if (ownGamePid) try { process.kill(ownGamePid) } catch {}
  if (activeTask && !proof.installResult && evaluate) try { await evaluate(`window.kamucl.invoke('tasks:cancel',${JSON.stringify(activeTask)})`) } catch {}
  if (main) try { await main("process.mainModule.require('electron').app.quit()") } catch {}
  ws?.close(); mainWs?.close(); if (child && child.exitCode === null) { await wait(2000); if (child.exitCode === null) child.kill() }
})
