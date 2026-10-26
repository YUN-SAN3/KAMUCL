// Actual owned Windows UI and production local storage. No test game is launched.
// Only the optional deferred response is synthetic; PNG decoding, manifests and
// account selection use the production main handlers in a disposable QA profile.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const native = require('./qa-native-window115.cjs')
module.exports = async function(h) {
  assert(['win32','darwin'].includes(process.platform)); const isMac = process.platform === 'darwin'
  const directory = path.resolve('out', 'qa-offline118-' + (process.env.KAMUCL_TEST_THEME || 'black-orange') + '-' + crypto.randomUUID())
  fs.mkdirSync(directory, { recursive: true })
  const proof = { complete: false, version: h.version, theme: process.env.KAMUCL_TEST_THEME, directory, observations: [], screenshots: [], classification: 'Actual owned Windows UI coordinate and keyboard input; genuine production PNG decoding and account-scoped disk storage. Deferred reply is an isolated scheduling fixture. No game launch or game-screen acceptance.' }
  const save = () => fs.writeFileSync(path.join(directory, 'live.json'), JSON.stringify(proof, null, 2))
  const identity = await h.main(`(()=>{const f=process.mainModule.require('node:fs'),w=testElectron.BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('/renderer/index.html'));if(w.length!==1)throw Error('Ambiguous QA renderer');return{pid:process.pid,ppid:process.ppid,windowId:w[0].id,webContentsId:w[0].webContents.id,profile:f.realpathSync.native(testElectron.app.getPath('userData'))}})()`)
  assert(identity.pid === h.ownedTrack.pid || identity.ppid === h.ownedTrack.pid)
  assert.equal(identity.profile, fs.realpathSync.native(h.profile)); proof.identity = identity
  const binding = { pid: identity.pid, windowId: identity.windowId, webContentsId: identity.webContentsId }, koffi = path.resolve('node_modules/koffi')
  const mac = isMac ? await require('./qa-native-mac120.cjs').create(h,proof,directory,binding) : null
  proof.platform=process.platform;if(isMac)proof.classification=proof.classification.replace('Windows UI','signed Mac package UI')
  const foreground = async () => {
    if(mac){const state=await mac.observe();proof.nativeFocusObservations??=[];proof.nativeFocusObservations.push({at:Date.now(),state});save();return state}
    const state = await h.main(`(${native.observeOwned})(${JSON.stringify(binding)},${JSON.stringify(koffi)})`)
    proof.nativeFocusObservations ??= []; proof.nativeFocusObservations.push({ at: Date.now(), state }); save()
    if (state.foregroundPid !== binding.pid) {
      try { proof.foregroundConflictProcess = await h.main(`process.mainModule.require('node:child_process').execFileSync('tasklist.exe',['/FI','PID eq ${Number(state.foregroundPid)}','/FO','CSV','/NH'],{encoding:'utf8',windowsHide:true})`) } catch (error) { proof.foregroundConflictObservationError = error.message }
      save()
    }
    assert.equal(state.foreground, state.hwnd); assert.equal(state.foregroundPid, binding.pid)
    assert(state.visible && state.focused && !state.minimized); return state
  }
  const until = async (label, read, predicate) => {
    const row = { label, complete: false, samples: [] }; proof.observations.push(row); save()
    for (let i = 0; i < 125; i++) {
      const value = await read(); row.samples.push({ at: Date.now(), value }); save()
      if (predicate(value)) { row.complete = true; save(); return value }
      await h.wait(80)
    }
    row.failedAt = new Date().toISOString(); save(); throw Error('UI state not ready: ' + label)
  }
  const element = selector => `document.querySelector(${JSON.stringify(selector)})`
  const textElement = (selector, label) => `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.trim()===${JSON.stringify(label)})`
  const clickElement = async (expression, label) => {
    await h.evaluate(`(()=>{const e=${expression};if(!e)throw Error('Missing coordinate target');e.scrollIntoView({block:'center',inline:'nearest'})})()`)
    const point = await until('coordinate ' + label, () => h.evaluate(`(()=>{const e=${expression},r=e?.getBoundingClientRect(),x=r&&r.x+r.width/2,y=r&&r.y+r.height/2,hit=r&&document.elementFromPoint(x,y);return{exists:!!e,disabled:!!e?.disabled,inert:!!e?.closest('[inert]'),x,y,width:r?.width,height:r?.height,hit:!!hit&&(hit===e||e.contains(hit)),viewport:!!r&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight}})()`), value => value.exists && !value.disabled && !value.inert && value.hit && value.viewport && value.width > 0 && value.height > 0)
    await foreground()
    for (const [type, button] of [['mouseMoved','none'], ['mousePressed','left'], ['mouseReleased','left']]) await h.call('Input.dispatchMouseEvent', { type, button, clickCount: type === 'mouseMoved' ? 0 : 1, x: point.x, y: point.y })
    await foreground(); await h.wait(160)
  }
  const click = selector => clickElement(element(selector), selector)
  const textClick = (selector, text) => clickElement(textElement(selector, text), text)
  const nav = async id => {
    if (id === 'accounts') {
      await nav('home'); await click('.account-provider')
      await until('account management view', () => h.evaluate("document.querySelector('.page-title')?.textContent.trim()"), value => value === '账号')
    } else {
      await click('[data-nav=' + id + ']')
      await until('navigation ' + id, () => h.evaluate(`document.querySelector('[data-nav=${id}]')?.getAttribute('aria-current')`), value => value === 'page')
    }
    await h.wait(350)
  }
  const screenshot = async (label, options = {}) => {
    if (!options.keepScroll) await h.evaluate("(()=>{for(const e of document.querySelectorAll('main.content,.editor-content,.editor-model,.editor-content aside,.editor-tool-rail'))e.scrollTo({top:0,left:0,behavior:'instant'})})()")
    await h.wait(350); const before = await foreground()
    const renderer = await h.evaluate("({width:innerWidth,height:innerHeight,zoom:devicePixelRatio,mainScroll:document.querySelector('main.content')?.scrollTop,editorScroll:document.querySelector('.editor-content')?.scrollTop,modelScroll:document.querySelector('.editor-model')?.scrollTop,editor:!!document.querySelector('.skin-editor'),confirmation:!!document.querySelector('.skin-upload-dialog')})")
    const bytes = Buffer.from((await h.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'), file = label + '.png'
    fs.writeFileSync(path.join(directory, file), bytes, { flag: 'wx' })
    proof.screenshots.push({ file, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), before, after: await foreground(), renderer, coverage: options.keepScroll ? 'Entire original viewport at the explicitly observed control section' : 'Entire original viewport with page and editor scrollers restored to their top; no crop or image reconstruction' }); save()
  }
  const viewport = async () => ({ native: await h.main(`(()=>{const e=testElectron,w=e.BrowserWindow.fromId(${identity.windowId}),bounds=w.getBounds(),display=e.screen.getDisplayMatching(bounds);return{bounds,content:w.getContentSize(),contentBounds:w.getContentBounds(),minimum:w.getMinimumSize(),maximum:w.getMaximumSize(),zoom:w.webContents.getZoomFactor(),maximized:w.isMaximized(),display:{id:display.id,scaleFactor:display.scaleFactor,bounds:display.bounds,workArea:display.workArea}}})()`), renderer: await h.evaluate('({width:innerWidth,height:innerHeight,rootClientWidth:document.documentElement.clientWidth,rootClientHeight:document.documentElement.clientHeight,rootRectWidth:document.documentElement.getBoundingClientRect().width,rootRectHeight:document.documentElement.getBoundingClientRect().height,visualViewport:visualViewport&&{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale},devicePixelRatio,hasFocus:document.hasFocus(),hidden:document.hidden})') })
  const setViewport = async (config, row) => {
    if (row) { row.beforeGeometry = await viewport(); row.requestedAt = new Date().toISOString(); save() }
    await h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${identity.windowId});if(process.pid!==${binding.pid}||w.webContents.id!==${binding.webContentsId})throw Error('Unowned viewport');if(w.isMaximized())w.unmaximize();w.setSize(${config.width},${config.height});w.webContents.setZoomFactor(${config.zoom});return true})()`)
    // Windows display scaling gives fractional CSS viewports. innerWidth and
    // Electron's DIP content size use different integer rounding; compare the
    // observed fractional viewport with the same original <1 CSS-pixel limit.
    const geometry = await until('actual viewport ' + config.width + 'x' + config.height + ' zoom ' + config.zoom, viewport, value => {
      const n = value.native, r = value.renderer, v = r.visualViewport
      return Math.abs(n.bounds.width - config.width) <= 3 && Math.abs(n.bounds.height - config.height) <= 3 && n.zoom === config.zoom && v?.scale === 1 && Math.abs(v.width - n.content[0] / config.zoom) < 1 && Math.abs(v.height - n.content[1] / config.zoom) < 1 && r.width === Math.round(v.width) && r.height === Math.round(v.height) && r.rootClientWidth === r.width && r.rootClientHeight === r.height && Math.abs(r.rootRectWidth - v.width) < 0.02 && Math.abs(r.rootRectHeight - v.height) < 0.02 && Math.abs(r.devicePixelRatio - n.display.scaleFactor * config.zoom) < 0.000001 && r.hasFocus && !r.hidden
    })
    if (row) { row.measurement = { requestedBoundsDIP: { width: config.width, height: config.height }, nativeBoundsDeltaDIP: { width: geometry.native.bounds.width - config.width, height: geometry.native.bounds.height - config.height }, contentDIP: geometry.native.content, fractionalCSSViewport: geometry.renderer.visualViewport, innerCSSViewport: { width: geometry.renderer.width, height: geometry.renderer.height }, displayScaleFactor: geometry.native.display.scaleFactor, electronZoomFactor: geometry.native.zoom, classification: 'Requested native window DIP bounds, subject to the observed application minimum and Windows display-scale rounding. The fractional CSS viewport and rounded inner viewport are recorded separately; this is not a claim of exact 960x620 physical pixels.' }; save() }
    return geometry
  }
  const reachable = async (expression, label) => {
    await h.evaluate(`(()=>{const e=${expression};if(!e)throw Error('Missing reachability target');e.scrollIntoView({block:'center',inline:'nearest'})})()`)
    const value = await until('fully reachable ' + label, () => h.evaluate(`(()=>{const e=${expression},r=e?.getBoundingClientRect(),x=r&&r.x+r.width/2,y=r&&r.y+r.height/2,hit=r&&document.elementFromPoint(x,y),ancestors=[];for(let p=e?.parentElement;p;p=p.parentElement){const s=getComputedStyle(p);if(/auto|scroll|hidden|clip/.test(s.overflow+s.overflowX+s.overflowY)){const a=p.getBoundingClientRect();ancestors.push({tag:p.tagName,class:p.className,left:a.left,right:a.right,top:a.top,bottom:a.bottom,scroll:p.scrollTop})}}return{exists:!!e,disabled:!!e?.disabled,inert:!!e?.closest('[inert]'),x,y,width:r?.width,height:r?.height,left:r?.left,right:r?.right,top:r?.top,bottom:r?.bottom,hit:!!hit&&(hit===e||e.contains(hit)),viewport:!!r&&r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,ancestors}})()`), state => state.exists && !state.disabled && !state.inert && state.hit && state.viewport && state.width >= 12 && state.height >= 12)
    await foreground(); return { label, ...value }
  }
  const key = async (key, code, vk) => { await foreground(); for (const type of ['keyDown', 'keyUp']) await h.call('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk }); await h.wait(120); await foreground() }
  const invoke = (channel, ...args) => h.evaluate(`window.kamucl.invoke(${JSON.stringify(channel)},...${JSON.stringify(args)})`)
  const profile = accountId => invoke('skin:profile', true, accountId)
  const select = async account => {
    await nav('accounts')
    await until('production account row ' + account.username, () => h.evaluate(`Array.from(document.querySelectorAll('.account-row')).some(e=>e.textContent.includes(${JSON.stringify(account.username)}))`), Boolean)
    await clickElement(`Array.from(document.querySelectorAll('.account-row')).find(e=>e.textContent.includes(${JSON.stringify(account.username)}))`, 'account ' + account.username)
    await until('selected ' + account.id, () => invoke('accounts:selected'), value => value?.id === account.id)
    await nav('skins')
    await until('skin account heading', () => h.evaluate("document.querySelector('.skin-username')?.textContent.trim()"), value => value === account.username)
  }
  const choose = async file => {
    await h.call('Page.setInterceptFileChooserDialog', { enabled: true })
    let listener, timer
    const opened = new Promise((resolve, reject) => {
      timer = setTimeout(() => { h.ws.removeEventListener('message', listener); reject(Error('File chooser did not open')) }, 8000)
      listener = event => { const message = JSON.parse(event.data); if (message.method === 'Page.fileChooserOpened') { clearTimeout(timer); h.ws.removeEventListener('message', listener); resolve(message.params) } }
      h.ws.addEventListener('message', listener)
    })
    void opened.catch(() => {}) // Keep a chooser timeout handled while the coordinate readiness check is pending.
    try {
      await textClick('.skin-actions button', '选择皮肤文件…')
      const chooser = await opened
      await h.call('DOM.setFileInputFiles', { backendNodeId: chooser.backendNodeId, files: [file] })
      await until('actual File input preview', () => h.evaluate("({name:document.querySelector('.pending-name')?.textContent.trim(),canvas:!!document.querySelector('.pending-viewer canvas')})"), value => value.name === path.basename(file) && value.canvas)
    } finally { clearTimeout(timer); h.ws.removeEventListener('message', listener); await h.call('Page.setInterceptFileChooserDialog', { enabled: false }) }
  }
  let primary, accounts = []
  try {
    // Runtime.enable alone does not deliver Page.fileChooserOpened events.
    await h.call('Page.enable')
    await h.call('DOM.enable')
    await h.call('Emulation.setFocusEmulationEnabled', { enabled: false })
    if(mac)await mac.focus();else await h.main(`(${native.focusOwned})(${JSON.stringify(binding)},${JSON.stringify(koffi)})`)
    await until('real native focus', () => h.evaluate('document.hasFocus()&&!document.hidden'), Boolean)
    proof.initialViewport = await viewport()
    proof.setup = await h.main(`(()=>{
      const ipc=testElectron.ipcMain,base=globalThis.__qaOriginalAppearanceHandlers;
      if(!(base instanceof Map))throw Error('Harness must retain original appearance handlers before replacing them');
      const channels=['accounts:selected','accounts:list','skin:profile','skin:history','skin:avatar','skin:offlineApply','skin:upload'],originals=new Map(channels.map(c=>[c,ipc._invokeHandlers.get(c)])),owned=new Map();
      const q=globalThis.__qaOffline118={originals,owned,operations:[],officialUploads:0,holdNext:false,held:false,release:null,restore(){if(this.release)this.release();let complete=true;for(const[c,fn]of this.originals){if(ipc._invokeHandlers.get(c)!==this.owned.get(c)){complete=false;continue}ipc.removeHandler(c);if(fn)ipc._invokeHandlers.set(c,fn)}if(complete)delete globalThis.__qaOffline118;return{complete}}};
      for(const c of channels){let fn=(base.get(c)||originals.get(c));if(typeof fn!=='function')throw Error('Production handler missing '+c);if(c==='skin:offlineApply'){const original=fn;fn=async(event,...args)=>{const row={accountId:args[2],variant:args[1],startedAt:Date.now(),completed:false};q.operations.push(row);const result=await original(event,...args);if(q.holdNext){q.holdNext=false;q.held=true;await new Promise(resolve=>q.release=resolve);q.held=false;q.release=null}row.completed=true;row.completedAt=Date.now();return result}}if(c==='skin:upload')fn=()=>{q.officialUploads++;throw Error('Offline UI must never invoke official upload')};ipc.removeHandler(c);ipc._invokeHandlers.set(c,fn);owned.set(c,fn)}
      return{complete:channels.every(c=>ipc._invokeHandlers.get(c)===owned.get(c)),profile:testElectron.app.getPath('userData')}
    })()`)
    assert(proof.setup.complete)
    proof.previousAccount = await invoke('accounts:selected')
    const suffix = crypto.randomBytes(3).toString('hex')
    accounts = [await invoke('accounts:addOffline', '本地验证甲_' + suffix), await invoke('accounts:addOffline', '本地验证乙_' + suffix)]
    proof.accounts = accounts.map(({ id, uuid, username }) => ({ id, uuid, username }))
    const source = await h.evaluate("(()=>{const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');g.fillStyle='#c97943';g.fillRect(0,0,64,64);g.fillStyle='#41ac85';g.fillRect(20,20,8,12);return c.toDataURL('image/png')})()")
    const fixture = path.join(h.root, 'offline118-custom.png'); fs.writeFileSync(fixture, Buffer.from(source.split(',')[1], 'base64'), { flag: 'wx' })
    proof.source = { file: fixture, sha256: crypto.createHash('sha256').update(fs.readFileSync(fixture)).digest('hex') }
    await h.reloadThemeReady('offline118-production-accounts')
    await select(accounts[0])
    const hints = await h.evaluate("document.querySelector('.offline-skin-hint')?.textContent")
    for (const words of ['本机', '下次启动', '校验', '作者官方来源', 'authlib-injector', '缓存', '断网', '其他玩家']) assert(hints.includes(words), 'Missing accurate offline hint ' + words)
    assert.equal((await profile(accounts[0].id)).skins.length, 0)
    assert.equal(await invoke('skin:avatar', accounts[0].id), null)
    await screenshot('default-offline-account')
    await choose(fixture); await textClick('.pending-box button', '纤细 Slim')
    await textClick('.skin-actions button', '应用到离线账号')
    proof.applied = await until('production slim skin committed', () => profile(accounts[0].id), value => value.skins[0]?.dataUrl === source && value.skins[0]?.variant === 'slim')
    assert.equal(await invoke('skin:avatar', accounts[0].id), source)
    await until('actual apply UI settled', () => h.evaluate("({pending:!!document.querySelector('.pending-box'),label:document.querySelector('.pane-info .tag')?.textContent.trim()})"), value => !value.pending && value.label === '纤细 Slim')
    proof.history = await invoke('skin:history', accounts[0].id); assert.equal(proof.history.length, 1)
    assert.equal(proof.history[0].hash, proof.source.sha256)
    await screenshot('applied-slim-local-skin')
    await textClick('.skin-actions button', '恢复游戏默认皮肤')
    await until('reset persisted', () => profile(accounts[0].id), value => value.skins.length === 0)
    assert.equal((await invoke('skin:history', accounts[0].id)).length, 1)
    assert.equal(await invoke('skin:avatar', accounts[0].id), null)
    await click('.history-preview'); await until('history preview without application', () => h.evaluate("document.querySelector('.preview-selection')?.textContent"), value => value?.includes('仅预览'))
    assert.equal((await profile(accounts[0].id)).skins.length, 0); await screenshot('history-preview-after-reset')
    await textClick('.history-actions button', '换回')
    await until('history applied only to A', () => profile(accounts[0].id), value => value.skins[0]?.dataUrl === source && value.skins[0]?.variant === 'slim')
    assert.equal((await profile(accounts[1].id)).skins.length, 0)
    await screenshot('restored-local-history')
    proof.recording = await h.recordScreencast('offline118-editor-' + crypto.randomUUID(), async () => {
      await click('.skin-editor-entry')
      await until('offline editor actionable', () => h.evaluate("({text:document.querySelector('.editor-upload')?.textContent.trim(),disabled:document.querySelector('.editor-upload')?.disabled})"), value => value.text === '应用到离线账号' && !value.disabled)
      await textClick('.file-tools button', '读取当前皮肤')
      await until('current PNG imported', () => h.evaluate("document.querySelector('.editor-header p')?.textContent"), value => value?.includes('有未保存'))
      await textClick('.file-tools button', '新建')
      await click('[aria-label="皮肤模型"]'); await key('ArrowUp', 'ArrowUp', 38); await key('Enter', 'Enter', 13)
      assert.equal(await h.evaluate("document.querySelector('[aria-label=\"皮肤模型\"]').value"), 'classic')
      await click('.editor-upload'); await until('local editor confirmation', () => h.evaluate("document.querySelector('.skin-upload-dialog')?.textContent"), value => value?.includes('应用到离线账号') && value.includes(accounts[0].username) && value.includes('缓存'))
      await screenshot('editor-local-confirmation')
      await textClick('.skin-upload-dialog button', '确认应用')
      await until('actual local editor operation completes', () => h.evaluate("({dialog:!!document.querySelector('.skin-upload-dialog'),inert:!!document.querySelector('.editor-content')?.inert,error:document.querySelector('.editor-operation-error')?.textContent})"), value => !value.dialog && !value.inert && !value.error)
      proof.editorApplied = await profile(accounts[0].id); assert.equal(proof.editorApplied.skins[0]?.variant, 'classic'); assert.notEqual(proof.editorApplied.skins[0]?.dataUrl, source)
      await click('.editor-close'); await until('saved local editor closes', () => h.evaluate("!!document.querySelector('.skin-editor')"), value => !value)
    }, 800)
    await screenshot('editor-applied-classic-skin')
    // Hold only the returned IPC reply after genuine A persistence. A new
    // selection via real account controls must retain B's default appearance.
    await choose(fixture); await h.main('__qaOffline118.holdNext=true;true')
    await textClick('.skin-actions button', '应用到离线账号')
    await until('actual committed A reply held', () => h.main('__qaOffline118.held'), Boolean)
    await select(accounts[1])
    assert.equal((await profile(accounts[1].id)).skins.length, 0); assert.equal((await invoke('skin:history', accounts[1].id)).length, 0)
    await h.main('__qaOffline118.release();true')
    await until('deferred A reply completed', () => h.main('__qaOffline118.operations.at(-1).completed'), Boolean)
    proof.switched = await h.evaluate("({username:document.querySelector('.skin-username')?.textContent.trim(),history:document.querySelectorAll('.history-item').length,pending:!!document.querySelector('.pending-box'),variant:document.querySelector('.pane-info .tag')?.textContent.trim()})")
    assert.equal(proof.switched.username, accounts[1].username); assert.equal(proof.switched.pending, false)
    assert.equal((await profile(accounts[1].id)).skins.length, 0)
    assert.equal((await profile(accounts[0].id)).skins[0]?.dataUrl, source)
    await screenshot('account-B-isolated-after-late-A-reply')
    await select(accounts[0]); await h.reloadThemeReady('offline118-local-persisted'); await nav('skins')
    assert.equal((await profile(accounts[0].id)).skins[0]?.dataUrl, source)
    proof.smallViewports = []
    for (const config of [{ width: 960, height: 620, zoom: 1 }, { width: 960, height: 620, zoom: 1.25 }]) {
      const row = { config, skinControls: [], editorControls: [], complete: false }
      proof.smallViewports.push(row); save()
      row.geometry = await setViewport(config, row); save()
      const label = '960x620-zoom-' + config.zoom
      await screenshot(label + '-skin-overview-top')
      await choose(fixture)
      for (const [expression, name] of [[textElement('.skin-actions button', '选择皮肤文件…'), 'choose PNG'], [textElement('.skin-actions button', '应用到离线账号'), 'apply local PNG'], [textElement('.skin-actions button', '恢复游戏默认皮肤'), 'reset default'], [textElement('.pending-box button', '经典 Classic'), 'classic model'], [textElement('.pending-box button', '纤细 Slim'), 'slim model']]) row.skinControls.push(await reachable(expression, name))
      await screenshot(label + '-skin-pending-controls', { keepScroll: true })
      await textClick('.pending-box button', '经典 Classic'); await textClick('.skin-actions button', '应用到离线账号')
      await until('small viewport actual apply ' + label, () => profile(accounts[0].id), value => value.skins[0]?.dataUrl === source && value.skins[0]?.variant === 'classic')
      for (const [expression, name] of [[element('.history-preview'), 'history preview'], [textElement('.history-actions button', '换回'), 'restore history'], [textElement('.history-actions button', '删除'), 'delete history']]) row.skinControls.push(await reachable(expression, name))
      await screenshot(label + '-skin-history-coverage', { keepScroll: true })
      row.skinControls.push(await reachable(element('.skin-editor-entry'), 'open editor'))
      await click('.skin-editor-entry')
      await until('small editor mounted ' + label, () => h.evaluate("!!document.querySelector('.skin-editor')"), Boolean)
      await screenshot(label + '-editor-overview-top')
      for (const [expression, name] of [[element('.editor-close'), 'editor close'], [element('.editor-upload'), 'apply editor skin'], [textElement('.editor-footer-save button', '保存 PNG…'), 'save PNG'], [textElement('.file-tools button', '新建'), 'new skin'], [textElement('.file-tools button', '导入 PNG'), 'import skin'], [textElement('.file-tools button', '读取当前皮肤'), 'import current skin'], [element('[aria-label="皮肤模型"]'), 'editor model'], [element('[aria-label="皮肤图层"]'), 'editor layer'], [element('.editor-tool.selected'), 'drawing tool'], [element('.preview-light'), 'preview light'], [element('.palette-sv'), 'color picker'], [element('[aria-label="HEX 颜色"]'), 'HEX input']]) row.editorControls.push(await reachable(expression, name))
      await screenshot(label + '-editor-colors-coverage', { keepScroll: true })
      await click('.editor-upload')
      await until('small local confirmation mounted ' + label, () => h.evaluate("!!document.querySelector('.skin-upload-dialog')"), Boolean)
      row.editorControls.push(await reachable(textElement('.skin-upload-dialog button', '确认应用'), 'confirm local apply'))
      row.editorControls.push(await reachable(textElement('.skin-upload-dialog button', '取消'), 'cancel local apply'))
      await screenshot(label + '-editor-confirmation-full-frame')
      await textClick('.skin-upload-dialog button', '取消'); await click('.editor-close')
      await until('small clean editor closes ' + label, () => h.evaluate("!!document.querySelector('.skin-editor')"), value => !value)
      row.finalGeometry = await viewport(); row.complete = true; save()
    }
    await setViewport({ width: proof.initialViewport.native.bounds.width, height: proof.initialViewport.native.bounds.height, zoom: proof.initialViewport.native.zoom })
    proof.persisted = await h.main(`(()=>{const f=process.mainModule.require('node:fs'),p=process.mainModule.require('node:path'),c=process.mainModule.require('node:crypto'),dir=p.join(testElectron.app.getPath('userData'),'offline-skins');return{manifests:f.readdirSync(p.join(dir,'accounts')).map(file=>({file,data:JSON.parse(f.readFileSync(p.join(dir,'accounts',file),'utf8'))})),textures:f.readdirSync(p.join(dir,'textures')).map(file=>({file,sha256:c.createHash('sha256').update(f.readFileSync(p.join(dir,'textures',file))).digest('hex')})),officialUploads:__qaOffline118.officialUploads,operations:__qaOffline118.operations}})()`)
    assert.equal(proof.persisted.officialUploads, 0)
    assert(proof.persisted.textures.every(texture => texture.file === texture.sha256 + '.png'))
    assert(!/accessToken|refreshToken/.test(JSON.stringify(proof.persisted.manifests)))
    await screenshot('persisted-A-local-appearance'); proof.complete = true
  } catch (error) {
    primary = error; proof.error = { name: error.name, message: error.message, stack: error.stack }
    try { await screenshot('failure-state', { keepScroll: true }) } catch (captureError) { proof.captureError = captureError.message }
    throw error
  } finally {
    try {
      await h.main('globalThis.__qaOffline118?.release?.();true')
      if (proof.initialViewport) await h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${identity.windowId});w.webContents.setZoomFactor(${proof.initialViewport.native.zoom});w.setBounds(${JSON.stringify(proof.initialViewport.native.bounds)});${proof.initialViewport.native.maximized ? 'w.maximize();' : ''}return true})()`)
      for (const account of accounts) await invoke('accounts:remove', account.id)
      if (proof.previousAccount) await invoke('accounts:select', proof.previousAccount.id)
      proof.restored = await h.main('globalThis.__qaOffline118?__qaOffline118.restore():({complete:true,absent:true})')
      assert(proof.restored.complete, 'Only owned handlers may be restored')
      await h.reloadThemeReady('offline118-restored-harness')
    } catch (error) { proof.restoreError = error.message; if (!primary) throw error }
    proof.finishedAt = new Date().toISOString(); save()
    fs.writeFileSync(path.join(directory, proof.complete ? 'summary.json' : 'failure.json'), JSON.stringify(proof, null, 2), { flag: 'wx' })
  }
  console.log(JSON.stringify({ complete: true, theme: proof.theme, directory, screenshots: proof.screenshots.length, recording: proof.recording?.directory }))
  return proof
}
