// Exactly owned, foreground-checked packaged Windows UI. Provider metadata and
// install responses below are isolated fixtures; no real service/game claim.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const native = require('./qa-native-window115.cjs'), community = require('./qa-community116.cjs')
const nativeKey = require('./qa-native-key116.cjs')
module.exports = async function(h) {
  assert(['win32','darwin'].includes(process.platform)); const isMac = process.platform === 'darwin'
  const directory = path.resolve('out', 'qa-ux117-' + process.env.KAMUCL_TEST_THEME + '-' + crypto.randomUUID())
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
    if(value.foreground!==value.hwnd||value.foregroundPid!==binding.pid||!value.visible||!value.focused||value.minimized){proof.foregroundFailure=value;save()}
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
    let file = label + '.png', ordinal = 1
    while (fs.existsSync(path.join(directory, file))) file = label + '-capture-' + (++ordinal) + '.png'
    fs.writeFileSync(path.join(directory, file), data, { flag: 'wx' })
    const row = { file, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), before, after: await foreground(), renderer }
    proof.screenshots.push(row); save(); return row
  }
  const key = async (key, code, vk, modifiers = 0) => { await foreground(); for (const type of ['keyDown','keyUp']) await h.call('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, modifiers }); await h.wait(150); await foreground() }
  const textClick = async (selector, label) => {
    const index=await h.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).findIndex(e=>e.textContent.trim()===${JSON.stringify(label)})`)
    assert(index>=0, 'Missing text target '+label)
    await click(`:is(${selector}):nth-of-type(${index+1})`)
  }
  const nativeClick = async selector => {
    await h.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`)
    const point=await h.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();if(!e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))throw Error('Native target blocked');return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await foreground(); const result=mac ? await mac.click(point) : await h.main(`(${require('./qa-native-click117.cjs').clickOwned})(${JSON.stringify(binding)},${JSON.stringify(point)},${JSON.stringify(koffi)})`)
    await h.wait(200); await foreground(); return result
  }
  const pose = () => h.evaluate("(()=>{const e=document.querySelector('.preview-3d .viewer3d');return e?.dataset.pose?{...JSON.parse(e.dataset.pose),state:e.dataset.animationState}:null})()")
  let primary
  try {
    await h.call('Emulation.setFocusEmulationEnabled',{enabled:false})
    proof.nativeFocus=mac ? await mac.focus() : await h.main(`(${native.focusOwned})(${JSON.stringify(binding)},${JSON.stringify(koffi)})`)
    await until('actual focus',()=>h.evaluate('document.hasFocus()&&!document.hidden'),Boolean)
    proof.initial=await state();assert.equal(proof.initial.settings.rememberGameWindowSize,false)
    const metadataId='1.21.5-Fabric 版本识别验证',metadataDir=path.join(h.games,'versions',metadataId),metadataJson={id:metadataId,_mcVersion:'0.0.0',_loader:'fabric',_loaderVersion:'0.16.12',mainClass:'net.fabricmc.loader.impl.launch.knot.KnotClient',libraries:[]}
    fs.mkdirSync(metadataDir);const metadataFile=path.join(metadataDir,metadataId+'.json');fs.writeFileSync(metadataFile,JSON.stringify(metadataJson),{flag:'wx'});const zip=new(require('adm-zip'))();zip.addFile('version.json',Buffer.from(JSON.stringify({id:'1.21.5',name:'1.21.5'})));fs.writeFileSync(path.join(metadataDir,metadataId+'.jar'),zip.toBuffer(),{flag:'wx'});proof.metadataOriginal=crypto.createHash('sha256').update(fs.readFileSync(metadataFile)).digest('hex')
    // All observations below use the existing production controls. Only account,
    // source metadata and one injected storage failure belong to private fixtures.
    await nav('settings');await textClick('.settings-scopes button','游戏设置');await textClick('.settings-categories button','游戏窗口')
    const observeWindowSwitch = () => h.evaluate("(()=>{const e=document.querySelector('.remember-window-row .switch-ui'),r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e),knob=e&&getComputedStyle(e,'::before');return{exists:!!e,width:r?.width,height:r?.height,display:s?.display,visibility:s?.visibility,opacity:s?.opacity,background:s?.backgroundColor,knobWidth:knob?.width,knobHeight:knob?.height,knobBackground:knob?.backgroundColor,checked:document.querySelector('[aria-label=\"退出游戏自动保存窗口化大小\"]')?.checked}})()")
    proof.windowSwitchOff=await until('actual painted window switch track and thumb',observeWindowSwitch,v=>v.exists&&v.width>=32&&v.height>=18&&v.display!=='none'&&v.visibility==='visible'&&Number(v.opacity)>0&&v.background!=='rgba(0, 0, 0, 0)'&&parseFloat(v.knobWidth)>=14&&parseFloat(v.knobHeight)>=14&&v.knobBackground!=='rgba(0, 0, 0, 0)')
    assert.equal(await h.evaluate("document.querySelector('[aria-label=\"退出游戏自动保存窗口化大小\"]').checked"),false)
    await nativeClick('.remember-window-row label.switch')
    await until('window size option persisted',state,v=>v.settings.rememberGameWindowSize===true)
    proof.windowSwitchOn=await observeWindowSwitch();assert(proof.windowSwitchOn.checked&&proof.windowSwitchOn.background!==proof.windowSwitchOff.background)
    await screenshot('window-size-setting')
    proof.failureSetup=await h.main(`(()=>{const ipc=testElectron.ipcMain,original=ipc._invokeHandlers.get('settings:set');globalThis.__qaWindow117={original,failed:false,restore(){ipc.removeHandler('settings:set');ipc._invokeHandlers.set('settings:set',original);delete globalThis.__qaWindow117;return{complete:ipc._invokeHandlers.get('settings:set')===original}}};ipc.removeHandler('settings:set');ipc.handle('settings:set',async(event,patch)=>{if(event.sender.id===${binding.webContentsId}&&Object.hasOwn(patch,'rememberGameWindowSize')&&!__qaWindow117.failed){__qaWindow117.failed=true;throw Error('合成：窗口记忆设置保存失败')}return original(event,patch)});return{owned:true}})()`)
    await nativeClick('.remember-window-row label.switch')
    proof.failureRecovery=await until('failed save restores actual checkbox',async()=>({failed:await h.main('__qaWindow117.failed'),checked:await h.evaluate("document.querySelector('[aria-label=\"退出游戏自动保存窗口化大小\"]').checked"),settings:(await state()).settings}),v=>v.failed&&v.checked&&v.settings.rememberGameWindowSize)
    assert((await h.main('__qaWindow117.restore()')).complete)
    await h.reloadThemeReady('window117-persist');await until('persisted window preference after reload',state,v=>v.settings.rememberGameWindowSize&&v.renderer.hasFocus)
    proof.metadataBackend=(await h.evaluate("window.kamucl.invoke('versions:installed')")).find(v=>v.id===metadataId);assert.equal(proof.metadataBackend.mcVersion,'1.21.5');await nav('game');await screenshot('default-download-location');proof.metadataUi=await until('real version card recovered from client manifest',()=>h.evaluate(`Array.from(document.querySelectorAll('.installed-row')).find(e=>e.textContent.includes(${JSON.stringify(metadataId)}))?.textContent`),v=>v?.includes('1.21.5')&&!v.includes('0.0.0'));assert.equal(crypto.createHash('sha256').update(fs.readFileSync(metadataFile)).digest('hex'),proof.metadataOriginal);await h.evaluate(`Array.from(document.querySelectorAll('.installed-row')).find(e=>e.textContent.includes(${JSON.stringify(metadataId)})).scrollIntoView({block:'center'})`);await screenshot('recovered-version-metadata')
    await nav('settings');await textClick('.settings-scopes button','启动器设置');await textClick('.settings-categories button','关于与更新');await click('[data-ui="SettingsView:e3f1fccf0c78"]')
    proof.license=await until('actual Markdown headings rendered',()=>h.evaluate("(()=>{const e=document.querySelector('.notices-markdown');return{headings:e?.querySelectorAll('h4').length,strong:e?.querySelectorAll('strong').length,unsafe:!!e?.querySelector('script,iframe,a[href^=javascript]'),text:e?.textContent.slice(0,250)}})()"),v=>v.headings>0&&!v.unsafe)
    await screenshot('third-party-rendered');await key('Escape','Escape',27)
    assert.equal(await h.evaluate("!!document.querySelector('[aria-label=\"第三方许可与声明\"]')"),false)
    // Private history entries contain public test pixels, with the unused entry
    // intentionally not the current account skin. Preview must never call upload.
    const publicSkin='data:image/png;base64,'+fs.readFileSync(path.resolve('src/renderer/src/assets/mascot-skins/kamu.png')).toString('base64')
    await h.main(`globalThis.uiSkin=${JSON.stringify(publicSkin)};true`)
    proof.historySetup=await h.main(`(()=>{const ipc=testElectron.ipcMain,channels=['skin:history','skin:upload','skin:uploadHistory'],originals=new Map(channels.map(c=>[c,ipc._invokeHandlers.get(c)]));globalThis.__qaSkin117={uploads:0,restore(){for(const[c,f]of originals){ipc.removeHandler(c);if(f)ipc._invokeHandlers.set(c,f)}delete globalThis.__qaSkin117;return{complete:channels.every(c=>ipc._invokeHandlers.get(c)===originals.get(c))}}};ipc.removeHandler('skin:history');ipc.handle('skin:history',()=>[{id:'unused117',name:'尚未使用的公开测试皮肤',dataUrl:uiSkin,variant:'slim',time:1791260000000}]);for(const c of ['skin:upload','skin:uploadHistory']){ipc.removeHandler(c);ipc.handle(c,()=>{__qaSkin117.uploads++;throw Error('Preview unexpectedly uploaded')})}return{owned:true}})()`)
    await nav('skins');await until('real skin model rendered',pose,Boolean)
    await click('.history-preview');await until('unused history selected',()=>h.evaluate("document.querySelector('.preview-selection')?.textContent"),v=>v?.includes('尚未使用'))
    assert.equal(await h.main('__qaSkin117.uploads'),0)
    proof.poses={}
    for(const mode of ['walk','idle','crouch','fly']){
      await click(`[data-seg=${mode}]`)
      proof.poses[mode]=await until('actual '+mode+' pose',pose,v=>v&&(mode==='crouch'?v.crouch>.99:mode==='fly'?v.flight>.99:mode==='idle'?Math.abs(v.arm)<.005:v.state==='walk'))
      await screenshot('history-'+mode)
    }
    proof.poseRecording=await h.recordScreencast('ux117-poses-'+crypto.randomUUID(),async()=>{for(const mode of ['crouch','fly','walk']){await click(`[data-seg=${mode}]`);await h.wait(600)}},1200)
    const a=await pose();await h.wait(450);const b=await pose();assert(Math.abs(a.arm-b.arm)>.01);proof.walkMotion={a,b}
    await h.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await click('[data-seg=fly]')
    proof.reduced=await until('reduced mode holds requested fly stance',pose,v=>v?.state==='paused'&&v.flight===1);await h.wait(400);assert.equal((await pose()).seconds,proof.reduced.seconds);await screenshot('reduced-fly')
    await h.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await click('[data-seg=walk]');await until('walking resumed after reduced media',pose,v=>v?.state==='walk'&&v.flight<.001)
    await h.main(`testElectron.BrowserWindow.fromId(${identity.windowId}).hide();true`);await until('actual owned hidden window',()=>h.evaluate('document.hidden'),Boolean)
    const hiddenA=await pose();await h.wait(400);const hiddenB=await pose();assert.equal(hiddenA.seconds,hiddenB.seconds);proof.hiddenPause={hiddenA,hiddenB}
    await h.main(`testElectron.BrowserWindow.fromId(${identity.windowId}).show();true`);if(mac)await mac.focus();else await h.main(`(${native.focusOwned})(${JSON.stringify(binding)},${JSON.stringify(koffi)})`);await until('visible model resumes',async()=>({ready:await h.evaluate('document.hasFocus()&&!document.hidden'),pose:await pose()}),v=>v.ready&&v.pose?.seconds>hiddenB.seconds)
    await h.main("uiAccount.type='offline';true");await h.reloadThemeReady('offline-history117');await nav('skins');await click('.history-preview');await until('offline unused preview ready',pose,Boolean)
    proof.offline=await h.evaluate("({selected:document.querySelector('.preview-selection')?.textContent,upload:!!document.querySelector('.skin-operation-panel'),localApply:document.querySelector('.skin-operation-panel')?.textContent.includes('应用到离线账号'),message:document.querySelector('.page-sub')?.textContent})");assert(proof.offline.upload&&proof.offline.localApply&&proof.offline.selected?.includes('尚未使用'));assert.equal(await h.main('__qaSkin117.uploads'),0);await screenshot('offline-history-preview')
    await h.main("uiAccount.type='microsoft';true");await h.reloadThemeReady('restored-account117');await nav('skins')
    // Saved editor closes at the visual X using Win32 SendInput, including
    // the former header drag region at minimum size and 125% host zoom.
    proof.nativeClose=[]
    for(const config of [{width:1360,height:860,zoom:1},{width:960,height:620,zoom:1.25}]){
      await h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${identity.windowId});w.setSize(${config.width},${config.height});w.webContents.setZoomFactor(${config.zoom});return true})()`)
      await until('actual editor viewport '+config.width+' '+config.zoom,state,v=>v.native.zoom===config.zoom&&Math.abs(v.native.bounds.width-config.width)<=3&&Math.abs(v.native.bounds.height-config.height)<=3&&Math.abs(v.renderer.width-v.native.content[0]/config.zoom)<1&&Math.abs(v.renderer.height-v.native.content[1]/config.zoom)<1)
      await click('.skin-editor-entry');await until('editor close visible',()=>h.evaluate("(()=>{const e=document.querySelector('.editor-close'),r=e?.getBoundingClientRect();return r&&{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,viewport:innerHeight}})()"),v=>v&&v.y>=0&&v.bottom<=v.viewport)
      await screenshot('editor-'+config.width+'-zoom-'+config.zoom)
      const receipt=await nativeClick('.editor-close');await until('native visual X closes saved editor',()=>h.evaluate("!!document.querySelector('.skin-editor')"),v=>!v);proof.nativeClose.push({config,receipt})
    }
    await h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${identity.windowId});w.setSize(1360,860);w.webContents.setZoomFactor(1);return true})()`)
    proof.resources=[]
    for(const id of ['mods','packs','shaders']){
      await nav(id);const row=await until('native actual resource path '+id,()=>h.evaluate("(()=>{const e=document.querySelector('.fm-path');return{path:e?.textContent,title:e?.title}})()"),v=>v.path&&v.path.includes(path.sep))
      assert(!row.path.includes(isMac ? '\\' : '/'));proof.resources.push({id,...row});await screenshot('native-path-'+id)
    }
    await nav('mods');await click('.fm-ver-select')
    proof.select=await until('generic listbox body popup',()=>h.evaluate("(()=>{const e=document.querySelector('.select-menu-float'),r=e?.getBoundingClientRect();return e&&{body:e.parentElement===document.body,top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:innerHeight,width:innerWidth,id:e.id,control:document.querySelector('.fm-ver-select').getAttribute('aria-controls')}})()"),v=>v&&v.body&&v.top>=0&&v.bottom<=v.height&&v.left>=0&&v.right<=v.width&&v.id===v.control)
    await screenshot('generic-select-popup');await key('Tab','Tab',9);await until('Tab closes generic popup after transition',()=>h.evaluate("!!document.querySelector('.select-menu-float')"),v=>!v)
    const target={id:'联机验证实例',folder:h.games,gameDir:path.join(h.games,'versions','联机验证实例'),mcVersion:'1.20.1',loader:'fabric',loaderVersion:'0.19.5'}
    proof.communityFixture=await h.main(`(${community.installCommunityFixture})(${JSON.stringify({...binding,profile:identity.profile,target})})`)
    await nav('community');await until('resource cards ready',()=>h.evaluate("document.querySelectorAll('.result-card').length"),v=>v>=20)
    await click('[data-ui="community:versions-custom"]');await until('explicit custom-version mode exposes production version input',()=>h.evaluate("document.querySelector('[data-ui=\"community:versions-custom\"]')?.getAttribute('aria-pressed')==='true'&&!!document.querySelector('[aria-label=\"Minecraft 版本\"]')"),Boolean)
    for(const config of [{width:1360,height:860,zoom:1},{width:960,height:620,zoom:1.25}]){
      await h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${identity.windowId});w.setSize(${config.width},${config.height});w.webContents.setZoomFactor(${config.zoom});return true})()`)
      await until('actual community viewport '+config.width+' '+config.zoom,state,v=>v.native.zoom===config.zoom&&Math.abs(v.native.bounds.width-config.width)<=3&&Math.abs(v.native.bounds.height-config.height)<=3&&Math.abs(v.renderer.width-v.native.content[0]/config.zoom)<1&&Math.abs(v.renderer.height-v.native.content[1]/config.zoom)<1)
      await click('[aria-label="Minecraft 版本"]')
      await until('community versions above cards',()=>h.evaluate("(()=>{const e=document.querySelector('#community-version-options'),row=e?.querySelector('button'),r=row?.getBoundingClientRect();return e&&r&&{body:e.parentElement===document.body,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('#community-version-options')===e,top:r.top,bottom:r.bottom,height:innerHeight}})()"),v=>v&&v.body&&v.hit&&v.top>=0&&v.bottom<=v.height)
      await screenshot('community-popup-'+config.width+'-zoom-'+config.zoom);await key('Escape','Escape',27)
    }
    assert((await h.main('__qaCommunity116.restore()')).complete)
    proof.editorScope={fullRegression:process.env.KAMUCL_FULL_EDITOR117==='1',qualification:process.env.KAMUCL_FULL_EDITOR117==='1'?'Full editor suite belongs to this run':'Full editor suite not performed by this run; title/X observations above remain scoped and any full editor qualification requires separately bound original evidence'}
    if(proof.editorScope.fullRegression)proof.editorRegression=await require('./verify-skin-editor-ui.cjs')({...h,nav,screenshot})
    if(process.env.KAMUCL_MOD_PROGRESS117)proof.modProgress=await require('./qa-mod-progress117.cjs')({...h,click,nav,screenshot,until,foreground},binding)
    await h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${identity.windowId});w.setSize(1360,860);w.webContents.setZoomFactor(1);return true})()`)
    await nav('home');await screenshot('final-home')
    proof.final=await state();proof.ownedAppMetricsBeforeClose=await h.main('testElectron.app.getAppMetrics().map(row=>({pid:row.pid,type:row.type}))');proof.complete=true
    fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify(proof,null,2),{flag:'wx'});console.log(JSON.stringify({complete:true,directory,theme:proof.theme}))
  }catch(error){primary=error;proof.error={name:error.name,message:error.message,stack:error.stack};try{fs.writeFileSync(path.join(directory,'failure.png'),Buffer.from((await h.call('Page.captureScreenshot',{format:'png'})).data,'base64'),{flag:'wx'})}catch{};throw error}
  finally{
    for(const name of ['__qaWindow117','__qaSkin117','__qaCommunity116'])try{const value=await h.main(`globalThis.${name}?${name}.restore():({complete:true,absent:true})`);assert(value.complete);proof[name+'Restored']=value}catch(error){proof[name+'RestorationError']=error.message;if(!primary)throw error}
    proof.finishedAt=new Date().toISOString();save();if(primary)fs.writeFileSync(path.join(directory,'failure.json'),JSON.stringify(proof,null,2),{flag:'wx'})
  }
}



