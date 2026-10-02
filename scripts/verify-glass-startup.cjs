// Exercise the actual Electron fallback window/preload/coordinator in an isolated profile.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { app, BrowserWindow, screen } = require('electron'), { build } = require('esbuild')
const root = fs.mkdtempSync(path.resolve('out/glass-startup-'))
const reduced = process.argv.includes('--reduced')
app.setPath('userData', path.join(root, 'profile'))
delete process.env.KAMUCL_BOOT_SIGNAL
const wait = ms => new Promise(r => setTimeout(r, ms))
let overlay
app.on('browser-window-created', (_event, window) => {
  // The first window belongs to createStartupSplash. On macOS Electron 33 the
  // browser-window-created event precedes applying the constructor's title.
  if (!overlay) {
    overlay = window
    // Test rendering without covering or activating the user's desktop.
    if (!(process.platform === 'darwin' && process.env.GITHUB_ACTIONS === 'true')) {
      window.showInactive = () => {}; window.moveTop = () => {}
    }
  }
})
const deadline = setTimeout(() => { console.error('Glass startup timed out', root); app.exit(2) }, 20000)
app.whenReady().then(async () => {
  const bundled = await build({ entryPoints: ['src/main/startupSplash.ts'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  const mod = { exports: {} }
  new Function('require','module','exports','__dirname',bundled.outputFiles[0].text)(require,mod,mod.exports,path.resolve('out/main'))
  const realCursor = screen.getCursorScreenPoint
  let fakeCursor = { x: -10000, y: -10000 }
  screen.getCursorScreenPoint = () => fakeCursor
  const coordinator = await mod.exports.createStartupSplash()
  let painting = false
  const paintTimer = setInterval(async () => {
    if (painting || !overlay || overlay.isDestroyed()) return
    painting = true
    try { await overlay.webContents.capturePage() } catch { /* Overlay can disappear during an in-flight capture. */ } finally { painting = false }
  }, 25)
  const main = new BrowserWindow({ x: -10000, y: -10000, width: 400, height: 300, show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
  coordinator.attach(main)
  try {
    await main.loadURL('data:text/html,<body>Private startup test</body>')
    while (overlay.webContents.isLoading()) await wait(30)
    if (reduced || (process.platform === 'darwin' && process.env.GITHUB_ACTIONS === 'true')) {
      overlay.webContents.debugger.attach('1.3')
      await overlay.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] })
      overlay.webContents.reload()
      while (overlay.webContents.isLoading()) await wait(30)
      assert.equal(await overlay.webContents.executeJavaScript("matchMedia('(prefers-reduced-motion: reduce)').matches"), reduced)
    }
    await wait(200)
    await overlay.webContents.executeJavaScript(`window.glassProof={pointer:null,poses:[]};window.kamuclSplash.onPointer(p=>glassProof.pointer=p);const c=document.querySelector('canvas').getContext('2d');const clear=c.clearRect.bind(c),translate=c.translate.bind(c);c.clearRect=(...a)=>{glassProof.poses=[];return clear(...a)};c.translate=(x,y)=>{glassProof.poses.push({x,y});return translate(x,y)};void 0`)
    await wait(100)
    if (reduced) {
      assert.equal(await overlay.webContents.executeJavaScript('glassProof.poses.length'), 0, 'reduced motion must render one still portrait')
      assert(!main.isVisible())
      main.showInactive(); main.hide()
      const started = Date.now()
      await main.webContents.executeJavaScript(`require('electron').ipcRenderer.send('boot:renderer-ready')`)
      for(let i=0;i<60&&!overlay.isDestroyed();i++) await wait(25)
      assert(main.isVisible()); assert(overlay.isDestroyed())
      assert(Date.now()-started<1500,'reduced motion must skip assembly and portrait hold')
      const report={complete:true,root,reducedMotion:true,readinessGate:true,cleanup:true}
      fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
      return
    }
    let original
    for(let i=0;i<30;i++){
      original=await overlay.webContents.executeJavaScript('glassProof.poses[0]')
      if(original)break
      await overlay.webContents.capturePage();await wait(100)
    }
    if(!original){
      console.log('Glass diagnostics',overlay.isVisible(),overlay.getBounds(),await overlay.webContents.executeJavaScript(`({url:location.href,hidden:document.hidden,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,caption:document.body.innerText,poses:glassProof.poses})`))
      fs.writeFileSync(path.join(root,'missing-frame.png'),(await overlay.webContents.capturePage()).toPNG())
    }
    assert(original,'floating glass must produce actual canvas draw calls')
    const bounds = overlay.getBounds()
    fakeCursor = { x: Math.round(bounds.x + original.x), y: Math.round(bounds.y + original.y) }
    let moved,displacement=0
    // Native CI presentation can skip frames; observe the response, not one wall-clock sample.
    for(let i=0;i<40;i++){
      await wait(50)
      moved=await overlay.webContents.executeJavaScript('({pose:glassProof.poses[0],pointer:glassProof.pointer,caption:document.body.innerText})')
      displacement=moved.pose?Math.hypot(moved.pose.x-original.x,moved.pose.y-original.y):0
      if(displacement>30&&moved.pointer?.x===fakeCursor.x-bounds.x&&moved.pointer?.y===fakeCursor.y-bounds.y)break
    }
    assert(displacement>30, 'nearby cursor must repel actual rendered glass: '+JSON.stringify({original,moved,displacement}))
    assert.equal(moved.pointer.x, fakeCursor.x-bounds.x); assert.equal(moved.pointer.y,fakeCursor.y-bounds.y)
    assert(!main.isVisible(), 'animation and cursor must not reveal unready main window')
    fs.writeFileSync(path.join(root,'floating.png'),(await overlay.webContents.capturePage()).toPNG())
    await main.webContents.executeJavaScript(`for(const stage of ['settings','accounts','instances','assets'])require('electron').ipcRenderer.send('boot:stage',stage)`)
    await wait(650)
    fs.writeFileSync(path.join(root,'assembling.png'),(await overlay.webContents.capturePage()).toPNG())
    await wait(3000)
    assert(!main.isVisible(), 'assembled avatar must still wait for real renderer readiness')
    fs.writeFileSync(path.join(root,'assembled.png'),(await overlay.webContents.capturePage()).toPNG())
    main.showInactive(); main.hide() // consume Windows SW_HIDE without affecting the user
    await main.webContents.executeJavaScript(`require('electron').ipcRenderer.send('boot:renderer-ready')`)
    for(let i=0;i<100&&!overlay.isDestroyed();i++) await wait(30)
    assert(main.isVisible()); assert(overlay.isDestroyed(), 'overlay must clean up after reveal')
    const report = { complete:true,root,pointerDisplacement:Math.hypot(moved.pose.x-original.x,moved.pose.y-original.y),lateAssembly:true,readinessGate:true,cleanup:true }
    fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
  } finally { clearInterval(paintTimer); screen.getCursorScreenPoint=realCursor; main.destroy(); if(overlay&&!overlay.isDestroyed())overlay.destroy(); clearTimeout(deadline) }
  app.exit(0)
}).catch(error => { console.error(error);clearTimeout(deadline);app.exit(1) })
