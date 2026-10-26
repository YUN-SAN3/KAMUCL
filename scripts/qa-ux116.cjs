// Exactly owned, foreground-checked packaged Windows UI. Provider metadata and
// install responses below are isolated fixtures; no real service/game claim.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const native = require('./qa-native-window115.cjs'), community = require('./qa-community116.cjs')
const nativeKey = require('./qa-native-key116.cjs')
module.exports = async function(h) {
  assert(['win32','darwin'].includes(process.platform)); const isMac = process.platform === 'darwin'
  const directory = path.resolve('out', 'qa-ux116-' + process.env.KAMUCL_TEST_THEME + '-' + crypto.randomUUID())
  fs.mkdirSync(directory, { recursive: true })
  const proof = { complete: false, version: h.version, directory, theme: process.env.KAMUCL_TEST_THEME, observations: [], screenshots: [], classification: 'Actual Windows portable UI, foreground-checked coordinate/keyboard input. Synthetic provider/installation responses, not live services. Actual host display unchanged; 1366x768/DPI geometry is separately unit-tested.' }
  const save = () => fs.writeFileSync(path.join(directory, 'live.json'), JSON.stringify(proof, null, 2))
  const identity = await h.main(`(()=>{const fs=process.mainModule.require('node:fs'),windows=testElectron.BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('/renderer/index.html'));if(windows.length!==1)throw Error('Ambiguous owned renderer');const w=windows[0];return{pid:process.pid,ppid:process.ppid,windowId:w.id,webContentsId:w.webContents.id,profile:fs.realpathSync.native(testElectron.app.getPath('userData')),electron:process.versions.electron,arch:process.arch}})()`)
  assert(identity.pid === h.ownedTrack.pid || identity.ppid === h.ownedTrack.pid)
  assert.equal(identity.profile, fs.realpathSync.native(h.profile)); assert.equal(identity.arch, isMac ? 'arm64' : 'x64')
  proof.identity = identity
  const binding = { pid: identity.pid, windowId: identity.windowId, webContentsId: identity.webContentsId }, koffi = path.resolve('node_modules/koffi')
  const mac = isMac ? await require('./qa-native-mac120.cjs').create(h,proof,directory,binding) : null
  proof.platform = process.platform; if(isMac)proof.classification = proof.classification.replace('Windows portable','signed Mac package').replace('Actual host display unchanged','Original native display changes and restoration are recorded by the owning Mac driver')
  const state = async () => ({ native: await h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${identity.windowId});return{bounds:w.getBounds(),content:w.getContentSize(),zoom:w.webContents.getZoomFactor(),maximized:w.isMaximized(),workArea:testElectron.screen.getDisplayMatching(w.getBounds()).workArea}})()`), renderer: await h.evaluate('({width:innerWidth,height:innerHeight,hasFocus:document.hasFocus(),hidden:document.hidden,theme:document.documentElement.dataset.theme})'), settings: await h.evaluate("window.kamucl.invoke('settings:get')") })
  const foreground = async () => {
    if(mac)return mac.observe()
    const value = await h.main(`(${native.observeOwned})(${JSON.stringify(binding)},${JSON.stringify(koffi)})`)
    assert.equal(value.foreground, value.hwnd); assert.equal(value.foregroundPid, binding.pid); assert(value.visible && value.focused && !value.minimized)
    return value
  }
  const until = async (label, read, predicate) => {
    const row = { label, samples: [] }; proof.observations.push(row); save()
    for (let i = 0; i < 125; i++) { const value = await read(); row.samples.push({ at: Date.now(), value }); if (predicate(value)) { row.complete = true; save(); return value }; await h.wait(80) }
    throw Error('Actual state did not become ready: ' + label)
  }
  const click = async selector => {
    await h.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing coordinate target');e.scrollIntoView({block:'center',inline:'nearest'})})()`)
    const target = await until('coordinate target ' + selector, () => h.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e?.getBoundingClientRect(),x=r&&r.x+r.width/2,y=r&&r.y+r.height/2,hit=r&&document.elementFromPoint(x,y);return{exists:!!e,disabled:!!e?.disabled,inert:!!e?.closest('[inert]'),x,y,width:r?.width,height:r?.height,hit:!!hit&&(hit===e||e.contains(hit)),viewport:!!r&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight}})()`), v => v.exists && !v.disabled && !v.inert && v.hit && v.viewport && v.width > 0 && v.height > 0)
    await foreground()
    await h.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y })
    await h.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: target.x, y: target.y })
    await h.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: target.x, y: target.y })
    await foreground(); await h.wait(160)
  }
  const nav = async id => {
    if (['mods','packs','shaders','recordings','projections','bridge','servers'].includes(id) && await h.evaluate("document.querySelector('[data-nav=resources]')?.getAttribute('aria-expanded')!=='true'")) await click('[data-nav=resources]')
    await click('[data-nav=' + id + ']')
    await until('navigation ' + id, () => h.evaluate(`document.querySelector('[data-nav=${id}]')?.getAttribute('aria-current')`), v => v === 'page'); await h.wait(350)
  }
  const screenshot = async label => {
    await h.wait(400)
    const before = await foreground(), renderer = await h.evaluate('({hasFocus:document.hasFocus(),hidden:document.hidden,width:innerWidth,height:innerHeight})')
    assert(renderer.hasFocus && !renderer.hidden)
    const data = Buffer.from((await h.call('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    const file = label + '.png'; fs.writeFileSync(path.join(directory, file), data, { flag: 'wx' })
    const row = { file, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), before, after: await foreground(), renderer }
    proof.screenshots.push(row); save(); return row
  }
  const key = async (key, code, vk, modifiers = 0) => { await foreground(); for (const type of ['keyDown','keyUp']) await h.call('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, modifiers }); await h.wait(150); await foreground() }
  let primary
  try {
    await h.call('Emulation.setFocusEmulationEnabled', { enabled: false })
    proof.nativeFocus = mac ? await mac.focus() : await h.main(`(${native.focusOwned})(${JSON.stringify(binding)},${JSON.stringify(koffi)})`)
    await until('actual focus', () => h.evaluate('document.hasFocus()&&!document.hidden'), Boolean)
    const before = await state(); assert.equal(before.settings.uiWindowAutoFit, false); assert.equal(before.native.zoom, 1); proof.defaultOff = before
    await nav('settings'); await click('[data-section="ui-window-fit"] label.switch')
    await until('actual auto-fit enabled and saved', state, v => v.settings.uiWindowAutoFit === true)
    await screenshot('adaptive-setting-enabled')
    // A one-shot settings rejection is a fault-injection case, never a real
    // storage failure claim. Restore the exact original IPC even on failure.
    proof.settingsFailureSetup = await h.main(`(()=>{const ipc=testElectron.ipcMain,original=ipc._invokeHandlers.get('settings:set');if(typeof original!=='function')throw Error('Missing settings handler');globalThis.__qaFit116={original,failed:false,restore(){ipc.removeHandler('settings:set');ipc._invokeHandlers.set('settings:set',original);const complete=ipc._invokeHandlers.get('settings:set')===original;delete globalThis.__qaFit116;return{complete}}};ipc.removeHandler('settings:set');ipc.handle('settings:set',async(event,patch)=>{if(event.sender.id===${binding.webContentsId}&&Object.hasOwn(patch,'uiWindowAutoFit')&&!__qaFit116.failed){__qaFit116.failed=true;throw Error('合成：自适应设置保存失败')}return original(event,patch)});return{owned:true}})()`)
    await click('[data-section="ui-window-fit"] label.switch')
    proof.settingsFailure = await until('failed setting rolls back actual switch', async () => ({ state: await state(), failed: await h.main('__qaFit116.failed'), checked: await h.evaluate("document.querySelector('[aria-label=\"UI 窗口自适应\"]')?.checked") }), v => v.failed && v.checked && v.state.settings.uiWindowAutoFit === true)
    proof.settingsFailureRestored = await h.main('__qaFit116.restore()'); assert(proof.settingsFailureRestored.complete)
    await h.reloadThemeReady('adaptive116-persisted')
    proof.reload = await until('enabled survives actual document reload', state, v => v.settings.uiWindowAutoFit === true && v.renderer.hasFocus && !v.renderer.hidden)
    await h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${identity.windowId});w.setSize(960,620);return true})()`)
    const small = await until('actual minimum comfortable layout', state, v => v.native.zoom < 1 && Math.abs(v.native.zoom - Math.max(.5, Math.min(1,v.native.content[0]/1120,v.native.content[1]/740))) < .0001 && v.renderer.hasFocus && !v.renderer.hidden)
    proof.minimum = small
    await nav('home'); await screenshot('adaptive-minimum-home')
    proof.keyboardBefore = await state()
    await h.main(`(()=>{const wc=testElectron.BrowserWindow.fromId(${identity.windowId}).webContents;globalThis.__qaKey116={events:[],allEvents:[],wc};__qaKey116.observer=(event,input)=>{const value={type:input.type,key:input.key,code:input.code,control:input.control,meta:input.meta,alt:input.alt,shift:input.shift,zoom:wc.getZoomFactor(),at:Date.now()};if(__qaKey116.allEvents.length<128)__qaKey116.allEvents.push(value);if(input.key==='-'||input.key==='0')__qaKey116.events.push(value)};wc.on('before-input-event',__qaKey116.observer);return true})()`)
    proof.nativeMinusInput=mac ? await mac.zoomKey('-') : await h.main(`(${nativeKey.sendOwnedZoomKey})(${JSON.stringify(binding)},189,${JSON.stringify(koffi)})`);await h.wait(200)
    const minus = await state(); proof.keyboardAfterMinus=minus;proof.keyboardEvents=await h.main('__qaKey116.events');save();assert(Math.abs(minus.native.zoom - proof.keyboardBefore.native.zoom/1.1) < .0001)
    proof.nativeResetInput=mac ? await mac.zoomKey('0') : await h.main(`(${nativeKey.sendOwnedZoomKey})(${JSON.stringify(binding)},48,${JSON.stringify(koffi)})`);await h.wait(200); assert(Math.abs((await state()).native.zoom - small.native.zoom) < .0001)
    if(mac){proof.keyboardEvents=await h.main('__qaKey116.events');for(const key of ['-','0'])for(const type of ['keyDown','keyUp'])assert(proof.keyboardEvents.some(e=>e.key===key&&e.type===type&&e.meta===true&&e.control===false),'Actual owned before-input-event must receive native CmdOrCtrl '+key+' '+type)}
    proof.keyboardZoom = { minus: minus.native.zoom, restored: (await state()).native.zoom }
    proof.recording = await h.recordScreencast('ux116-minimum-' + crypto.randomUUID(), async () => { await foreground(); await nav('settings'); await nav('home') }, 1500)
    await h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${identity.windowId});w.maximize();return true})()`)
    await until('auto-fit respects maximize', state, v => v.native.maximized && v.native.zoom === 1)
    await h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${identity.windowId});w.unmaximize();return true})()`)
    await until('auto-fit restored after unmaximize', state, v => !v.native.maximized && Math.abs(v.native.zoom-small.native.zoom)<.0001)
    await nav('settings'); await click('[data-section="ui-window-fit"] label.switch')
    await until('disabling restores manual zoom', state, v => v.settings.uiWindowAutoFit === false && v.native.zoom === 1)
    await screenshot('adaptive-disabled-minimum')
    await click('[data-section="ui-window-fit"] label.switch')
    await until('enabled for minimum community', state, v => v.settings.uiWindowAutoFit === true && v.native.zoom < 1)
    const target = { id: '联机验证实例', folder: h.games, gameDir: path.join(h.games,'versions','联机验证实例'), mcVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.19.5' }
    proof.fixture = await h.main(`(${community.installCommunityFixture})(${JSON.stringify({ ...binding, profile: identity.profile, target })})`)
    proof.community = await community.runCommunityChecks({ ...h, click, nav, screenshot })
    // Direct host zoom is setup, not a keyboard claim. Keep actual 125% geometry
    // and compare it with the separate trusted Ctrl-minus/Ctrl-0 case above.
    await nav('settings'); await click('[data-section="ui-window-fit"] label.switch')
    await until('disabled before 125 percent host setup', state, v => v.settings.uiWindowAutoFit === false && v.native.zoom === 1)
    await h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${identity.windowId});w.webContents.setZoomFactor(1.25);return true})()`)
    await nav('community'); await click('[aria-label="Minecraft 版本"]')
    proof.manual125 = await state(); assert.equal(proof.manual125.native.zoom,1.25)
    await screenshot('manual-125-minimum-version-popup'); await key('Escape','Escape',27)
    await h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${identity.windowId});w.webContents.setZoomFactor(1);return true})()`)
    proof.fixtureRestored = await h.main('__qaCommunity116.restore()'); assert(proof.fixtureRestored.complete)
    await nav('settings')
    await until('final persisted default-compatible state', state, v => v.settings.uiWindowAutoFit === false && v.native.zoom === 1)
    await h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${identity.windowId});w.setSize(1360,860);return true})()`)
    await nav('home'); await screenshot('normal-home-final')
    if(process.env.KAMUCL_INSTALLER_EVENTS116)proof.installProgress=await require('./qa-install-progress116.cjs')({...h,click,nav,screenshot},binding)
    proof.final = await state(); proof.ownedAppMetricsBeforeClose=await h.main('testElectron.app.getAppMetrics().map(row=>({pid:row.pid,type:row.type}))'); proof.complete = true
    fs.writeFileSync(path.join(directory,'summary.json'), JSON.stringify(proof,null,2), { flag:'wx' }); console.log(JSON.stringify({ complete:true, directory, theme:proof.theme }))
  } catch(error) { primary = error; proof.error={ name:error.name, message:error.message, stack:error.stack }; try { const data=Buffer.from((await h.call('Page.captureScreenshot',{format:'png'})).data,'base64');fs.writeFileSync(path.join(directory,'failure.png'),data,{flag:'wx'}) } catch{}; throw error
  } finally {
    try { proof.keyboardDiagnostic=await h.main('globalThis.__qaKey116?({filteredEvents:__qaKey116.events,allEvents:__qaKey116.allEvents}):null') } catch(error) { proof.keyboardDiagnosticError=error.message }
    try { proof.keyboardObserverRestored=await h.main('globalThis.__qaKey116?(()=>{__qaKey116.wc.removeListener("before-input-event",__qaKey116.observer);delete globalThis.__qaKey116;return true})():true') } catch(error) { proof.keyboardObserverError=error.message }
    try { proof.finalSettingsRestoration = await h.main('globalThis.__qaFit116?__qaFit116.restore():({complete:true,absent:true})'); assert(proof.finalSettingsRestoration.complete) } catch(error) { proof.settingsRestorationError=error.message; if(!primary)throw error }
    try { const result = await h.main('globalThis.__qaCommunity116?__qaCommunity116.restore():({complete:true,absent:true})'); proof.finalFixtureRestoration=result; assert(result.complete) } catch(error) { proof.restorationError=error.message; if(!primary)throw error }
    proof.finishedAt=new Date().toISOString();save();if(primary)fs.writeFileSync(path.join(directory,'failure.json'),JSON.stringify(proof,null,2),{flag:'wx'})
  }
}
