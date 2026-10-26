// Actual production renderer and native image codec, isolated settings/IPC fixtures.
// Run after build: electron.exe scripts/verify-appearance-121-ui.cjs --theme dark --viewport 960x620 --zoom 1.25
// Theme QA aliases use the persisted product keys: dark -> black-orange, black-purple -> transparent.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),sharp=require('sharp')
const {app,BrowserWindow,ipcMain,session}=require('electron'),{buildSync}=require('esbuild')
const {configureGraphics,observeGraphics,validateGraphics,selectAllInput,backspaceInput,validateSelection,selectSourceInput,validateSourceSelection,resetSourcePicker,waitForMinimumDuration}=require('./qa-fixture-ui121.cjs')
const args=process.argv.slice(2),arg=(name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1]}
const requestedTheme=arg('theme','blue-white'),themeKeys={dark:'black-orange','black-orange':'black-orange','blue-white':'blue-white','black-purple':'transparent',transparent:'transparent',custom:'custom'}
assert(Object.hasOwn(themeKeys,requestedTheme),'Unknown QA theme: '+requestedTheme)
const theme=themeKeys[requestedTheme],viewport=arg('viewport','1366x768'),dimensions=viewport.match(/^(960x620|1366x768)$/)
assert(dimensions,'Unknown QA viewport: '+viewport)
const [width,height]=viewport.split('x').map(Number),pageZoom=Number(arg('zoom','1'))
assert([1,1.25].includes(pageZoom),'QA page zoom must be 1 or 1.25')
const packageVersion=JSON.parse(fs.readFileSync('package.json','utf8')).version
assert.equal(packageVersion,'1.1.21','Build the final 1.1.21 renderer before QA')
const root=fs.mkdtempSync(path.resolve(`out/appearance-121-ui-${requestedTheme}-${viewport}-${pageZoom*100}-`))
app.setPath('userData',path.join(root,'userData'));const graphics=configureGraphics(app)
function bundle(entry,name){const file=path.join(root,name+'.cjs');buildSync({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:file});return require(file)}
const types=bundle('src/shared/types.ts','types'),assets=bundle('src/main/core/appearanceAssets.ts','assets')
const folder=path.join(root,'games'),account={id:'fixture',type:'offline',username:'Appearance Test',uuid:'00000000000000000000000000000000'}
const serverTarget={id:'重命名客户端',folder,mcVersion:'26.1.2',loader:'fabric',loaderVersion:'0.19.3'}
const serverRecords=[
 {id:'resolved',name:'隔离 26.x 服务',address:'private.fixture.invalid:25565',versionId:serverTarget.id,folder,minecraftVersion:'0.0.0',loader:'fabric',loaderVersion:'old'},
 {id:'missing',name:'原客户端已移除',address:'missing.fixture.invalid:25565',versionId:'已移除客户端',folder,minecraftVersion:'0.0.0',loader:'fabric',loaderVersion:'old'},
 {id:'unbound',name:'未关联实例服务',address:'unbound.fixture.invalid:25565',minecraftVersion:'1.20.1'}
],serverRecordsBefore=structuredClone(serverRecords)
const oldThemeTitleKey='App:e8c1fdc22711/App:f900e94b908a/App:4f03b68b3168/App:ece4739a5266/SettingsView:bf6b46a9d4d6/SettingsView:3f9566ff298f/SettingsView:24e434dcfefc/SettingsView:f10bc27bda82/SettingsView:12a109aabb6e~0'
let settings={gameDir:folder,activeFolder:folder,folders:[{path:folder,name:'测试目录',isDefault:true}],javaPath:'',javaAuto:true,javaCustom:[],javaHidden:[],memoryMB:4096,memoryAuto:true,jvmArgs:'',resolution:{width:854,height:480,mode:'windowed'},mirror:'bmclapi',theme,custom:structuredClone(types.DEFAULT_CUSTOM_THEME),disabledFeatures:[],favoriteVersions:[],homeLayout:structuredClone(types.DEFAULT_HOME_LAYOUT),background:structuredClone(types.DEFAULT_BACKGROUND),launchThumbnail:structuredClone(types.DEFAULT_LAUNCH_THUMBNAIL),configVersion:1,visualDesign:{version:1,pages:{settings:{width:1366,height:768,components:{[oldThemeTitleKey]:{color:'#9b3e17'}}}}},uiWindowAutoFit:false,updateSource:'auto',updateMirrorUrl:'https://legacy.example.test/',updateMirrorUrls:[]}
if(theme==='custom')settings.custom.colors={accent:'#059669',bg:'#f1f5f0',card:'#ffffff',text:'#18342c',textDim:'#627b72',border:'#c9d7cf',sidebarBg:'#e5eee8',sidebarText:'#18342c',bannerText:'#ffffff'}
const actions=bundle('src/main/core/appearanceAssetActions.ts','assetActions').createAppearanceAssetActions({getSettings:()=>settings,saveSettings:patch=>settings={...settings,...patch},importImage:assets.importGlobalImage,removeImage:assets.removeGlobalImage})
// Freeze the built renderer so another coordinated build cannot mix artifacts
// into an in-flight QA run. Only the disposable evidence directory is written.
const rendererSourceDir=path.resolve('out/renderer'),rendererDir=path.join(root,'renderer'),digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
fs.cpSync(rendererSourceDir,rendererDir,{recursive:true})
const rendererArtifacts=[path.join(rendererDir,'index.html'),...fs.readdirSync(path.join(rendererDir,'assets')).filter(name=>/\.(js|css)$/.test(name)).map(name=>path.join(rendererDir,'assets',name))].map(file=>({file,sha256:digest(file)}))
const sourceFiles=['scripts/verify-appearance-121-ui.cjs','scripts/qa-fixture-ui121.cjs','src/renderer/src/composables/useDesignSession.ts','src/renderer/src/designNavigationScroll.ts','src/renderer/src/composables/useNavigationBubble.ts','src/renderer/src/components/UpdateSources.vue','src/renderer/src/controlFocus.ts','src/renderer/src/views/ServersView.vue','src/shared/serverVersionDisplay.ts'].map(file=>({file:path.resolve(file),sha256:digest(file)}))
let draft=null,failNextDraftApply=false,failNextSettingsPatch=null;const writes=[],settingsPatchInvocations=[],failures=[],proof={root,classification:'Actual renderer/native codec with disposable profile and controlled service fixtures; offscreen Chromium with '+graphics.backend+' GPU, not a visible desktop/native production-session test; Mac Cmd+A uses the Chromium editing command, not an OS physical shortcut',runtime:{platform:process.platform,arch:process.arch,electron:process.versions.electron,chromium:process.versions.chrome},configuration:{requestedTheme,theme,physicalViewport:{width,height},pageZoom,packageVersion,compositor:graphics,controlledFailureDelayMs:150,fixtureCustomColors:theme==='custom'?settings.custom.colors:undefined},executionDriver:{file:__filename,sha256:digest(__filename)},rendererSourceDir,rendererArtifacts,sourceFiles,windowFocusEvents:[],rendererFocusEvents:[],interactions:[],inputReplacements:[],updateSources:[],sourceSelections:[],settingsPatchInvocations,checks:[],geometry:[],images:[]}
const save=()=>fs.writeFileSync(path.join(root,'proof.json'),JSON.stringify(proof,null,2))
ipcMain.on('appearance-fixture:focus',(_event,payload)=>{proof.rendererFocusEvents.push(payload)})
ipcMain.handle('appearance-fixture:invoke',(_event,channel,...args)=>{
 switch(channel){
 case 'settings:get':return settings
 case 'settings:set':{
  const invocation={index:settingsPatchInvocations.length,patch:structuredClone(args[0]),startedAt:Date.now()};settingsPatchInvocations.push(invocation);writes.push(args[0])
  if(failNextSettingsPatch&&Object.hasOwn(args[0],failNextSettingsPatch)){const key=failNextSettingsPatch;failNextSettingsPatch=null;return waitForMinimumDuration(proof.configuration.controlledFailureDelayMs,{wallStartedAt:invocation.startedAt}).then(observation=>{invocation.controlledDelay=observation;invocation.completedAt=Date.now();invocation.outcome='rejected';throw Error('Controlled '+key+' save failure after 150ms')})}
  settings={...settings,...args[0]};invocation.completedAt=Date.now();invocation.outcome='resolved';return settings
 }
 case 'accounts:list':return [account]
 case 'accounts:selected':return account
 case 'versions:installed':return []
 case 'versions:manifest':return []
 case 'folders:list':return{folders:settings.folders,active:folder}
 case 'skin:profile':return{skins:[],capes:[]}
 case 'skin:avatar':return null
 case 'app:systemInfo':return{totalMemMB:16384,freeMemMB:8192,platform:process.platform}
 case 'update:getPending':case 'update:getState':return null
 case 'servers:list':return structuredClone(serverRecords)
 case 'servers:syncFromDat':return{list:structuredClone(serverRecords),targets:[serverTarget],added:0,updated:0,errors:[]}
 case 'servers:ping':return{online:true,players:'2 / 20',motd:'隔离截图夹具 · '+args[0],version:'Minecraft fixture',latencyMs:42}
 case 'game:launch':throw Error('A UI screenshot fixture must never launch a game')
 case 'appearance:draftRead':return draft
 case 'appearance:draftSave':draft=args[0];return draft
 case 'appearance:draftApply':if(failNextDraftApply){failNextDraftApply=false;return waitForMinimumDuration(proof.configuration.controlledFailureDelayMs).then(observation=>{proof.failedDraftApplyDelay=observation;throw Error('Controlled draft save failure after 150ms')})};settings={...settings,...args[0]};draft=null;return settings
 case 'appearance:draftDiscard':draft=null;return true
 default:return []
 }
})
fs.writeFileSync(path.join(root,'preload.cjs'),`const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('kamucl',{platform:process.platform,invoke:(c,...a)=>ipcRenderer.invoke('appearance-fixture:invoke',c,...a),on:(c,fn)=>{const h=(_,p)=>fn(p);ipcRenderer.on(c,h);return()=>ipcRenderer.removeListener(c,h)},send:()=>{},getFilePath:()=>''});for(const type of ['focus','blur'])window.addEventListener(type,()=>ipcRenderer.send('appearance-fixture:focus',{event:type,at:new Date().toISOString(),tag:document.activeElement?.tagName,hasFocus:document.hasFocus()}));`)
app.whenReady().then(async()=>{
 let win
 try{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}))
 for(const format of ['png','jpeg','webp']){
  const source=path.join(root,'fixture.'+(format==='jpeg'?'jpg':format));const original=await sharp({create:{width:32,height:24,channels:4,background:{r:90,g:120,b:200,alpha:format==='png'?.5:1}}})[format]().toBuffer();fs.writeFileSync(source,original)
  const imported=await assets.importGlobalImage(source,'background');assert(fs.existsSync(imported.path));assert.deepEqual(fs.readFileSync(source),original)
  proof.images.push({format,source,imported});save()
 }
 // Asset service validates the single-image transition using real imported files.
 const old=proof.images.slice(0,2).map(item=>item.imported.path);settings.background={...settings.background,mode:'image',image:old[0],images:old,switchMode:'random'}
 const result=await actions.singleBackground(proof.images[0].source)
 assert.equal(result.background.switchMode,'off');assert.deepEqual(result.background.images,[result.background.image]);assert(old.every(file=>!fs.existsSync(file)))
 proof.checks.push('PNG/JPEG/WebP native imports succeed and leave original bytes intact; single PNG replaces old slideshow and disables switching')
 settings.background=structuredClone(types.DEFAULT_BACKGROUND)
 win=new BrowserWindow({show:false,frame:false,width,height,webPreferences:{preload:path.join(root,'preload.cjs'),backgroundThrottling:false,offscreen:true}})
 for(const event of ['focus','blur'])win.on(event,()=>{proof.windowFocusEvents.push({event,at:new Date().toISOString(),focused:win.isFocused()})})
 win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)failures.push(message)})
 const run=code=>win.webContents.executeJavaScript(code),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
 const resize=async(width,height)=>{win.setContentSize(width,height);win.webContents.setZoomFactor(pageZoom);await wait(300);const actual=await run('({width:innerWidth,height:innerHeight})');assert(Math.abs(actual.width-width/pageZoom)<1&&Math.abs(actual.height-height/pageZoom)<1,JSON.stringify({actual,width,height,pageZoom}));proof.configuration.cssViewport=actual;assert.equal(win.webContents.getZoomFactor(),pageZoom)}
 const ready=async(expression)=>{for(let i=0;i<50;i++){if(await run(expression))return;await wait(100)}throw Error('Timed out: '+expression)}
 const shot=async name=>{const target=name==='mirror-list'?'.custom-mirror-list':name.startsWith('update-')&&(/failed|duplicate|invalid/.test(name))?'.source-error':null;if(target)await run(`document.querySelector(${JSON.stringify(target)})?.scrollIntoView({block:'nearest'})`);await wait(350);fs.writeFileSync(path.join(root,name+'.png'),(await win.webContents.capturePage()).toPNG())}
 const click=async(selector,horizontal=.5)=>{
  const point=await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width*${horizontal},y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(hit!==e&&!e.contains(hit))throw Error('Blocked hit: '+hit?.className);return{x:Math.round(x),y:Math.round(y),rect:{x:r.x,y:r.y,width:r.width,height:r.height},hit:{tag:hit.tagName,classes:hit.className},viewport:{width:innerWidth,height:innerHeight}}})()`)
  const physical={x:Math.round(point.x*pageZoom),y:Math.round(point.y*pageZoom)}
  proof.interactions.push({selector,css:point,physical});save()
  win.webContents.sendInputEvent({type:'mouseMove',...physical});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...physical});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...physical});await wait(200)
 }
 const key=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await wait(100)}
 const type=async(selector,value)=>{await click(selector);await selectAllInput(win.webContents);await wait(100);const selection=await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return{focused:document.activeElement===e,value:e?.value,start:e?.selectionStart,end:e?.selectionEnd}})()`);proof.inputReplacements.push({selector,command:process.platform==='darwin'?'CDP Cmd+A selectAll editing command and Backspace key events':'Ctrl+A and Backspace input events',selection,expectedValue:value});save();validateSelection(selection);await backspaceInput(win.webContents);await ready(`document.querySelector(${JSON.stringify(selector)}).value===''`);proof.inputReplacements.at(-1).emptyValue=await run(`document.querySelector(${JSON.stringify(selector)}).value`);save();await win.webContents.insertText(value);await ready(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`);proof.inputReplacements.at(-1).value=await run(`document.querySelector(${JSON.stringify(selector)}).value`);save()}
 const button=async text=>{const id='fixture-button';await run(`(()=>{document.querySelectorAll('#fixture-button').forEach(e=>e.removeAttribute('id'));const b=[...document.querySelectorAll('.designer-toolbar button,.designer-panel button,.designer-dialog button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button '+${JSON.stringify(text)});b.id=${JSON.stringify(id)}})()`);await click('#'+id)}
 const clearNotifications=async()=>{while(await run("!!document.querySelector('.toast-close')")){await run("document.querySelector('.toast-close').id='fixture-toast-close'");await click('#fixture-toast-close');await ready("!document.querySelector('#fixture-toast-close')")}}
 const geometry=async(label,visible=false)=>{
  await wait(450)
  const value=await run(`(()=>{const r=e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height}};const nav=document.querySelector('.nav'),b=nav.getBoundingClientRect(),s=b.height/nav.offsetHeight;return{item:r(document.querySelector('[data-nav="settings"]')),selection:r(document.querySelector('.nav-selection')),bubble:r(document.querySelector('.nav-bubble')),nav:{top:b.top+nav.clientTop*s,bottom:b.top+(nav.clientTop+nav.clientHeight)*s,scrollTop:nav.scrollTop},host:document.querySelector('#design-preview-host')?.getAttribute('style'),viewport:{width:innerWidth,height:innerHeight}}})()`)
  proof.geometry.push({label,...value});save()
  for(const name of ['selection','bubble'])for(const key of ['x','y','width','height'])assert(Math.abs(value.item[key]-value[name][key])<1.6,`${label} ${name} ${key}: ${JSON.stringify(value)}`)
  if(visible)assert(value.item.y>=value.nav.top-1.6&&value.item.y+value.item.height<=value.nav.bottom+1.6,`${label} current nav item is clipped: ${JSON.stringify(value)}`)
 }
 await win.loadFile(path.join(rendererDir,'index.html'));await ready("!!document.querySelector('[data-nav=\"settings\"]')")
 proof.graphics=await observeGraphics(app,win.webContents,graphics);save();validateGraphics(proof.graphics)
 await resize(width,height)
 assert.equal(await run("document.querySelector('.logo-version')?.textContent.trim()"),'v1.1.21','The actual loaded renderer must be version 1.1.21')
 proof.configuration.renderedTheme=await run("document.documentElement.getAttribute('data-theme')")
 assert.equal(proof.configuration.renderedTheme,theme)
 proof.configuration.renderedAccent=await run("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
 assert.equal(proof.configuration.renderedAccent,(theme==='custom'?settings.custom.colors:types.THEME_PRESETS[theme].colors).accent)
 await click('[data-nav="settings"]');await ready("!!document.querySelector('.personalize-btn')")
 proof.oldThemeKey=await run("(()=>{const path=[];for(let e=document.querySelector('[data-section=\"theme\"] h3');e;e=e.parentElement)if(e.dataset.ui)path.unshift(e.dataset.ui);return path.join('/')+'~0'})()")
 assert.equal(proof.oldThemeKey,oldThemeTitleKey)
 await ready("getComputedStyle(document.querySelector('[data-section=\"theme\"] h3')).color==='rgb(155, 62, 23)'")
 assert.equal(await run("getComputedStyle(document.querySelector('[data-section=\"theme\"] h3')).color"),'rgb(155, 62, 23)')
 proof.checks.push('1.1.20 generated theme title ID still resolves its existing saved customization after component extraction')
 assert.equal(await run("document.querySelector('[aria-label=\"UI 窗口自适应\"]').checked"),false)
 await geometry(`${viewport} page zoom ${pageZoom*100}% normal`,true);await shot('normal')
 await click('.personalize-btn');await ready("!!document.querySelector('#design-preview-host .shell')")
 await geometry(`${viewport} page zoom ${pageZoom*100}% fit editor`);await shot('editor-fit')
 await click('#design-preview-host [data-nav="settings"]')
 assert(await run("document.querySelector('.designer-panel h3')?.textContent.includes('设置')"),'coordinate click selects actual settings component')
 let outline=await run("(()=>{const a=document.querySelector('.designer-outline').getBoundingClientRect(),b=document.querySelector('#design-preview-host [data-nav=\"settings\"]').getBoundingClientRect();return{dx:a.x-b.x,dy:a.y-b.y,dw:a.width-b.width,dh:a.height-b.height}})()")
 assert(Object.values(outline).every(value=>Math.abs(value)<1.6),JSON.stringify(outline));proof.geometry.push({label:'actual-coordinate selection outline',...outline})
 const setPreviewZoom=async value=>{await run(`(()=>{const e=document.querySelector('[aria-label="预览缩放"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);await wait(350)}
 await setPreviewZoom('100');await geometry('100% editor canvas');await click('#design-preview-host [data-nav="settings"]')
 assert(await run("document.querySelector('.designer-panel h3')?.textContent.includes('设置')"),'100% coordinate click selects actual settings component')
 outline=await run("(()=>{const a=document.querySelector('.designer-outline').getBoundingClientRect(),b=document.querySelector('#design-preview-host [data-nav=\"settings\"]').getBoundingClientRect();return{dx:a.x-b.x,dy:a.y-b.y,dw:a.width-b.width,dh:a.height-b.height}})()")
 assert(Object.values(outline).every(value=>Math.abs(value)<1.6),JSON.stringify(outline));proof.geometry.push({label:'100% actual-coordinate selection outline',...outline});await shot('editor-100')
 await setPreviewZoom('fit');await geometry('returned to fit editor')
 await run("(()=>{const e=[...document.querySelectorAll('.designer-panel select')].find(e=>e.querySelector('option[value=free]'));e.value='free';e.dispatchEvent(new Event('change',{bubbles:true}))})()");await wait(150)
 await run("(()=>{const e=document.querySelector('[aria-label=\"纵向位移\"]');e.value='12';e.dispatchEvent(new Event('change',{bubbles:true}))})()");await geometry('freely moved sidebar component')
 await button('外观')
 await ready("!!document.querySelector('[aria-label=\"背景颜色透明度\"]')")
 await run("(()=>{const e=document.querySelector('[aria-label=\"背景颜色透明度\"]');e.focus();e.value='100';e.dispatchEvent(new Event('input',{bubbles:true}))})()");await wait(500)
 const slider=await run("(()=>{const e=document.querySelector('[aria-label=\"背景颜色透明度\"]'),s=getComputedStyle(e);return{value:e.value,fill:s.getPropertyValue('--range-fill').trim(),background:s.backgroundImage,padding:s.padding,border:s.borderWidth,appearance:s.appearance}})()")
 assert.equal(slider.value,'100');assert.equal(slider.fill,'100%');assert.equal(slider.padding,'0px');assert.equal(slider.border,'0px');assert.equal(slider.appearance,'none');proof.slider=slider
 await shot('opacity-100')
 await run("(()=>{const e=document.querySelector('[aria-label=\"背景颜色透明度\"]');e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}))})()");await wait(300)
 const zero=await run("(()=>{const e=document.querySelector('[aria-label=\"背景颜色透明度\"]'),s=getComputedStyle(e);return{value:e.value,fill:s.getPropertyValue('--range-fill').trim(),padding:s.padding,border:s.borderWidth,appearance:s.appearance}})()")
 assert.equal(zero.value,'0');assert.equal(zero.fill,'0%');assert.equal(zero.padding,'0px');assert.equal(zero.border,'0px');assert.equal(zero.appearance,'none');proof.sliderZero=zero;await shot('opacity-0')
 const appearanceBefore=structuredClone(settings.visualDesign)
 await button('取消 / 退出');await button('取消修改并退出');await ready("!document.querySelector('.design-workspace')");await geometry('after cancel editor',true);assert.deepEqual(settings.visualDesign,appearanceBefore)
 await click('.personalize-btn');await ready("!!document.querySelector('#design-preview-host .shell')")
 await button('预览导航');await click('#design-preview-host [data-nav="home"]');await ready("document.querySelector('[aria-current=\"page\"]')?.dataset.nav==='home'")
 await click('#design-preview-host [data-nav="settings"]');await ready("document.querySelector('[aria-current=\"page\"]')?.dataset.nav==='settings'")
 await geometry('preview navigation returns settings')
 await button('编辑组件');await click('#design-preview-host [data-nav="settings"]');await button('外观')
 await run("(()=>{const e=document.querySelector('[aria-label=\"背景颜色值\"]');e.value='#e1a454';e.dispatchEvent(new Event('change',{bubbles:true}))})()");await wait(300)
 await button('取消 / 退出');await button('保留草稿并退出');assert(draft);assert.deepEqual(settings.visualDesign,appearanceBefore);await geometry('after keep draft editor',true)
 await click('.personalize-btn');await ready("document.querySelector('.notice')?.textContent.includes('已恢复')");await button('恢复已应用外观');await wait(200)
 await button('取消 / 退出');await ready("!document.querySelector('.design-workspace')")
 await click('.personalize-btn');await ready("!!document.querySelector('#design-preview-host .shell')");await click('#design-preview-host [data-nav="settings"]');await button('外观')
 await run("(()=>{const e=document.querySelector('[aria-label=\"背景颜色值\"]');e.value='#e1a454';e.dispatchEvent(new Event('change',{bubbles:true}))})()");await wait(300)
 failNextDraftApply=true;await button('应用外观');await ready("[...document.querySelectorAll('.toast')].some(e=>e.textContent.includes('保存失败'))&&!!document.querySelector('.design-workspace')");assert(draft);assert.deepEqual(settings.visualDesign,appearanceBefore);proof.failedApplyFocus={...await run("({tag:document.activeElement?.tagName,classes:document.activeElement?.className,text:document.activeElement?.textContent?.slice(0,100),hasFocus:document.hasFocus(),inEditor:!!document.activeElement?.closest('.design-workspace')})"),browserWindowFocused:win.isFocused(),webContentsFocused:win.webContents.isFocused()};save();assert(proof.failedApplyFocus.inEditor,'Failed apply keeps editor focus: '+JSON.stringify(proof.failedApplyFocus));await geometry('failed apply retains editor');await shot('failed-apply')
 await button('应用外观');await ready("!document.querySelector('.design-workspace')")
 assert(Object.values(settings.visualDesign.pages.global.components).some(value=>value.background==='#e1a454'));assert.equal(draft,null);await clearNotifications();await geometry('after apply editor',true);await shot('after-apply')
 proof.checks.push(`${viewport} physical viewport at ${pageZoom*100}% page zoom: default fit disabled; actual-coordinate selection outline and nav surfaces align in fit and 100% editor and after exit; cancel/keep/recover/apply retain persistence boundaries; preview navigation remains usable; alpha 0%/100% fills correct endpoints`)
 // Use observed coordinates and Chromium keyboard/edit commands for update-source controls.
 await run("(()=>{const e=[...document.querySelectorAll('.settings-categories button')].find(e=>e.textContent.includes('关于'));if(!e)throw Error('Missing About category');e.id='fixture-about-category'})()");await click('#fixture-about-category');await ready("!!document.querySelector('#update-mirror')")
 const sourceState=async(label,expected)=>{
  const state=await run("(()=>{const e=document.querySelector('.update-sources'),r=e.getBoundingClientRect(),f=document.activeElement;return{selected:document.querySelector('#update-source').value,busy:document.querySelector('#update-source').disabled,presets:[...document.querySelectorAll('.source-preset')].map(e=>e.textContent),help:document.querySelector('.update-sources .source-help').textContent,custom:[...document.querySelectorAll('.custom-mirror-list li>span')].map(e=>e.textContent.trim()),input:document.querySelector('#update-mirror')?.value,error:document.querySelector('.source-error')?.textContent,focus:{tag:f?.tagName,id:f?.id,classes:f?.className,inSources:!!f?.closest('.update-sources'),hasFocus:document.hasFocus()},rect:{x:r.x,y:r.y,width:r.width,height:r.height}}})()")
  proof.updateSources.push({label,...state,persisted:{source:settings.updateSource,legacy:settings.updateMirrorUrl,custom:structuredClone(settings.updateMirrorUrls)}});save();assert.equal(state.selected,expected);assert.equal(settings.updateSource,expected);assert.equal(state.busy,false)
  assert.deepEqual(state.presets,expected==='direct'?[]:['ghproxy.net','gh-proxy.com','ghfast.top']);assert(state.help.includes(expected==='direct'?'只通过 GitHub':expected==='mirror'?'不使用 GitHub 直连':'自动切换来源'));return state
 }
 await run("(()=>{window.__qaSourceEvents121=[];window.__qaSourceObserver121=event=>{if(event.target?.id==='update-source')window.__qaSourceEvents121.push({type:event.type,isTrusted:event.isTrusted,targetId:event.target.id,value:event.target.value,at:Date.now()})};for(const type of ['input','change'])document.addEventListener(type,window.__qaSourceObserver121,true)})()")
 if(process.platform==='darwin')await run("(()=>{window.__qaSourceKeys121=[];window.__qaSourceFocus121=[];for(const type of ['keydown','keypress','keyup'])document.addEventListener(type,event=>window.__qaSourceKeys121.push({type:event.type,key:event.key,code:event.code,isTrusted:event.isTrusted,targetId:event.target?.id,at:Date.now()}),true);for(const type of ['focus','blur'])document.addEventListener(type,event=>window.__qaSourceFocus121.push({type:event.type,isTrusted:event.isTrusted,targetId:event.target?.id,at:Date.now()}),true)})()")
 const chooseSource=async value=>{
  const previous=await run("document.querySelector('#update-source').value"),baseline=settingsPatchInvocations.length,expectedFailure=failNextSettingsPatch==='updateSource';assert.notEqual(previous,value)
  if(process.platform==='darwin'){
   const row={protocol:'chromium-select-typeahead-v1',platform:process.platform,previous,target:value,expectedFailure,startedAt:Date.now(),classification:'Chromium Unicode keypress typeahead and DOM blur/focus picker-session setup; actual trusted select/key receipt and controlled IPC transaction. Not a physical OS keyboard or visible desktop test.',dispatches:[],events:[],invocations:[],keyEvents:[],focusEvents:[],observations:{}};proof.sourceSelections.push(row);save()
   await run("window.__qaSourceEvents121=[];window.__qaSourceKeys121=[];window.__qaSourceFocus121=[];document.querySelector('#update-source').scrollIntoView({block:'center'})");await click('#update-source')
   const observe=async()=>({...await run("(()=>{const e=document.querySelector('#update-source'),f=document.activeElement;return{selected:e.value,busy:e.disabled,popupOpen:e.matches(':open'),options:[...e.options].map(o=>({value:o.value,label:o.label,disabled:o.disabled})),focus:{tag:f?.tagName,id:f?.id,inSources:!!f?.closest('.update-sources'),hasFocus:document.hasFocus()},hidden:document.hidden}})()"),persisted:settings.updateSource,sourceCalls:structuredClone(settingsPatchInvocations.slice(baseline).filter(call=>Object.hasOwn(call.patch,'updateSource'))),native:{browserWindowFocused:win.isFocused(),webContentsFocused:win.webContents.isFocused(),visible:win.isVisible(),offscreen:win.webContents.isOffscreen(),debuggerAttached:win.webContents.debugger.isAttached()}})
   row.observations.afterClick=await observe();save();row.setup={};await resetSourcePicker(win.webContents,observe,row.setup);row.options=row.setup.beforeJump.options;save()
   for(const phase of ['before','afterEscape','afterBlur','beforeJump']){assert.equal(row.setup[phase].selected,previous);assert.equal(row.setup[phase].persisted,previous);assert.equal(row.setup[phase].sourceCalls.length,0,'Picker setup must never consume a settings save')}
   await selectSourceInput(win.webContents,previous,value,process.platform,{options:row.options,dispatches:row.dispatches,beforeEnter:async()=>{
    for(let i=0;i<50;i++){row.events=await run("window.__qaSourceEvents121");row.invocations=structuredClone(settingsPatchInvocations.slice(baseline).filter(call=>Object.hasOwn(call.patch,'updateSource')));row.keyEvents=await run("window.__qaSourceKeys121");row.focusEvents=await run("window.__qaSourceFocus121");row.observations.afterCharacter=await observe();save();if(row.invocations.length&&row.invocations.every(call=>Number.isFinite(call.completedAt)))break;await wait(100)}
    assert.equal(row.invocations.length,1,'Native source selection must invoke exactly one actual updateSource settings:set: '+JSON.stringify(row));assert.equal(row.invocations[0].patch.updateSource,value,'Native source selection must request its target option');await ready("!document.querySelector('#update-source').disabled")
    row.observations.beforeFocusSetup=await observe();save();if(expectedFailure)assert.equal(row.observations.beforeFocusSetup.focus.id,'update-source','Failed source selection must restore actual product focus')
    else if(row.observations.beforeFocusSetup.focus.id!=='update-source'){row.observations.successFocusSetup='DOM focus API restores the actual select only as QA key-release/Enter input precondition after the successful busy period';await run("document.querySelector('#update-source').focus({preventScroll:true})")}
    row.observations.beforeEnter=await observe();save();assert.equal(row.observations.beforeEnter.focus.id,'update-source');assert.equal(row.observations.beforeEnter.popupOpen,false)
   }});row.invocations=structuredClone(settingsPatchInvocations.slice(baseline).filter(call=>Object.hasOwn(call.patch,'updateSource')));row.events=await run("window.__qaSourceEvents121");row.keyEvents=await run("window.__qaSourceKeys121");row.focusEvents=await run("window.__qaSourceFocus121");row.observations.afterEnter=await observe();row.final={...await run("(()=>{const e=document.querySelector('#update-source'),f=document.activeElement;return{selected:e.value,busy:e.disabled,error:document.querySelector('.source-error')?.textContent,focus:{tag:f?.tagName,id:f?.id,classes:f?.className,inSources:!!f?.closest('.update-sources'),hasFocus:document.hasFocus()}}})()"),persisted:settings.updateSource};row.completedAt=Date.now();save();validateSourceSelection(row);return
  }
  await run("window.__qaSourceEvents121=[]");await click('#update-source');if(process.platform!=='darwin')await key('Escape');assert(await run("document.activeElement===document.querySelector('#update-source')"),'Native select click retains focus')
  const row={platform:process.platform,previous,target:value,expectedFailure,classification:'Original Chromium/Electron key dispatch completion plus real trusted select change and actual controlled settings IPC invocation; no offscreen OS receiver acknowledgement',dispatches:await selectSourceInput(win.webContents,previous,value),events:[],invocations:[]};proof.sourceSelections.push(row)
  for(let i=0;i<50;i++){row.events=await run("window.__qaSourceEvents121");row.invocations=structuredClone(settingsPatchInvocations.slice(baseline).filter(call=>Object.hasOwn(call.patch,'updateSource')));save();if(row.invocations.length&&row.invocations.every(call=>Number.isFinite(call.completedAt)))break;await wait(100)}
  assert.equal(row.invocations.length,1,'Native source selection must invoke exactly one actual updateSource settings:set: '+JSON.stringify(row));assert.equal(row.invocations[0].patch.updateSource,value,'Native source selection must request its target option')
  await ready("!document.querySelector('#update-source').disabled")
  row.final={...await run("(()=>{const e=document.querySelector('#update-source'),f=document.activeElement;return{selected:e.value,busy:e.disabled,error:document.querySelector('.source-error')?.textContent,focus:{tag:f?.tagName,id:f?.id,classes:f?.className,inSources:!!f?.closest('.update-sources'),hasFocus:document.hasFocus()}}})()"),persisted:settings.updateSource};save();validateSourceSelection(row)
 }
 const addMirror=async url=>{await type('#update-mirror',url);await click('.update-sources .source-row button');await ready("!document.querySelector('#update-source').disabled")}
 await sourceState('initial auto source and preserved legacy mirror','auto');assert.equal(settings.updateMirrorUrl,'https://legacy.example.test/');await shot('update-auto')
 failNextSettingsPatch='updateMirrorUrls';await addMirror('https://custom.example.test');assert.deepEqual(settings.updateMirrorUrls,[]);let failedState=await sourceState('failed custom mirror append','auto');assert(failedState.error.includes('Controlled updateMirrorUrls save failure'));assert.equal(failedState.input,'https://custom.example.test');assert(failedState.focus.inSources,'Failed mirror append restores focus');await shot('update-add-failed');await clearNotifications()
 await click('.update-sources .source-row button');await ready("!document.querySelector('#update-source').disabled");assert.deepEqual(settings.updateMirrorUrls,['https://custom.example.test/']);assert.equal((await sourceState('retried custom mirror append','auto')).input,'');await shot('mirror-list')
 let writesBefore=writes.length;await addMirror('https://custom.example.test/');assert.equal(writes.length,writesBefore);assert((await sourceState('duplicate custom mirror rejected','auto')).error.includes('候选列表'));assert.deepEqual(settings.updateMirrorUrls,['https://custom.example.test/']);await shot('update-duplicate')
 writesBefore=writes.length;await addMirror('https://ghproxy.net');assert.equal(writes.length,writesBefore);assert((await sourceState('duplicate preset mirror rejected','auto')).error.includes('候选列表'))
 writesBefore=writes.length;await addMirror('http://unsafe.test');assert.equal(writes.length,writesBefore);assert((await sourceState('invalid HTTP mirror rejected','auto')).error.includes('HTTPS'));assert.deepEqual(settings.updateMirrorUrls,['https://custom.example.test/']);await shot('update-invalid')
 failNextSettingsPatch='updateMirrorUrls';await click('[aria-label="移除镜像 https://custom.example.test/"]');await ready("!document.querySelector('#update-source').disabled");assert.deepEqual(settings.updateMirrorUrls,['https://custom.example.test/']);failedState=await sourceState('failed custom mirror removal retains entry','auto');assert(failedState.error.includes('Controlled updateMirrorUrls save failure'));assert(failedState.focus.inSources,'Failed mirror removal restores focus');await shot('update-remove-failed');await clearNotifications()
 await click('[aria-label="移除镜像 https://custom.example.test/"]');await ready("!document.querySelector('#update-source').disabled");assert.deepEqual(settings.updateMirrorUrls,[]);await sourceState('retried custom mirror removal','auto')
 failNextSettingsPatch='updateMirrorUrl';await click('.custom-mirror-list li button');await ready("!document.querySelector('#update-source').disabled");assert.equal(settings.updateMirrorUrl,'https://legacy.example.test/');failedState=await sourceState('failed legacy mirror removal retains entry','auto');assert(failedState.error.includes('Controlled updateMirrorUrl save failure'));assert(failedState.focus.inSources,'Failed legacy mirror removal restores focus');await shot('update-legacy-remove-failed');await clearNotifications()
 await click('.custom-mirror-list li button');await ready("!document.querySelector('#update-source').disabled");assert.equal(settings.updateMirrorUrl,'');assert.equal(await run("!!document.querySelector('.custom-mirror-list')"),false);await sourceState('retried legacy mirror removal persists','auto');await shot('update-removed')
 failNextSettingsPatch='updateSource';await chooseSource('direct');failedState=await sourceState('failed direct source save rolls back','auto');assert(failedState.error.includes('Controlled updateSource save failure'));assert.equal(failedState.focus.id,'update-source','Failed direct source save restores select focus');await shot('update-direct-failed');await clearNotifications()
 await chooseSource('direct');await sourceState('retried direct source hides mirror controls','direct');assert.equal(await run("!!document.querySelector('#update-mirror')"),false);await shot('update-direct')
 failNextSettingsPatch='updateSource';await chooseSource('mirror');failedState=await sourceState('failed mirror source save rolls back','direct');assert(failedState.error.includes('Controlled updateSource save failure'));assert.equal(failedState.focus.id,'update-source','Failed mirror source save restores select focus');await shot('update-mirror-failed');await clearNotifications()
 await chooseSource('mirror');await sourceState('retried mirror source restores preset controls','mirror');assert(await run("!!document.querySelector('#update-mirror')"));await shot('update-mirror')
 await chooseSource('auto');await sourceState('auto source restored after direct/mirror failure recovery','auto');await shot('update-auto-restored')
 proof.checks.push('Actual-coordinate and Chromium-keyboard/edit-command update-source controls verify all three presets, custom/legacy append/remove, invalid HTTP and duplicate rejection without writes, and 150ms failed add/remove/direct/mirror saves preserving persisted settings and restoring focus before successful retry')
 await clearNotifications()
 // Production server list/details use resolved instance metadata while masking
 // only synthetic .invalid fixture addresses. No socket or game is started.
 await click('[data-nav="resources"]');await ready("!document.querySelector('[data-nav=\"servers\"]').closest('[inert]')");await click('[data-nav="servers"]')
 await ready("document.querySelectorAll('.server-list-item').length===3&&document.querySelector('.server-detail')&&!document.querySelector('.server-list-item').textContent.includes('检测中')")
 const rowText=await run("[...document.querySelectorAll('.server-list-item')].map(e=>e.innerText)")
 assert(rowText.find(text=>text.includes('隔离 26.x 服务')).includes('26.1.2 · fabric · 0.19.3'))
 assert(rowText.find(text=>text.includes('原客户端已移除')).includes('未知'))
 assert(rowText.find(text=>text.includes('未关联实例服务')).includes('1.20.1'))
 const privateText=await run("document.querySelector('.servers-page').innerText");assert(!privateText.includes('0.0.0'));for(const server of serverRecords)assert(!privateText.includes(server.address))
 await shot('server-list')
 const selectServer=async name=>{
  await run(`(()=>{document.querySelectorAll('[data-fixture-server]').forEach(e=>e.removeAttribute('data-fixture-server'));const row=[...document.querySelectorAll('.server-list-item')].find(e=>e.querySelector('strong')?.textContent===${JSON.stringify(name)});if(!row)throw Error('Missing fixture server');row.querySelector('.server-select-hit').dataset.fixtureServer='selected'})()`)
  await click('[data-fixture-server="selected"]',.1)
  await ready(`document.querySelector('.server-detail h3')?.textContent===${JSON.stringify(name)}`)
  await run("(()=>{const e=document.querySelector('.server-detail');e.scrollTop=0;e.scrollIntoView({block:'start'})})()");await shot(name===serverRecords[0].name?'server-detail-resolved':'server-detail-unknown')
  const metadata=await run("document.querySelector('[data-ui=\"ServerDetails:1399ead01b1a\"]').textContent")
  assert(metadata.includes(name===serverRecords[0].name?'26.1.2':'未知'));assert(!metadata.includes('0.0.0'))
  await run("document.querySelector('[data-ui=\"ServerDetails:1399ead01b1a\"]').scrollIntoView({block:'center'})")
  await shot(name===serverRecords[0].name?'server-metadata-resolved':'server-metadata-unknown')
  const text=await run("document.querySelector('.server-detail').innerText");for(const server of serverRecords)assert(!text.includes(server.address))
 }
 await selectServer(serverRecords[0].name);await selectServer(serverRecords[1].name)
 assert.deepEqual(serverRecords,serverRecordsBefore)
 proof.serverDisplay={rows:rowText,originalSavedMinecraftVersion:serverRecords[0].minecraftVersion,originalSavedLoaderVersion:serverRecords[0].loaderVersion,addressesMasked:true,sourceRecordsUnchanged:true}
 proof.checks.push('Actual coordinate server selection renders resolved 26.1.2/Fabric and missing-target unknown in list/details, keeps unbound version, masks synthetic fixture addresses, and leaves saved 0.0.0 records unchanged')
 proof.failures=failures;proof.writes=writes;assert.deepEqual(failures,[]);proof.complete=true;save();console.log(JSON.stringify({ok:true,root,checks:proof.checks,failures},null,2));win.destroy();app.quit()
 }catch(error){proof.error=String(error.stack||error);proof.failures=failures;if(win&&!win.isDestroyed()){try{fs.writeFileSync(path.join(root,'failed-state.png'),(await win.webContents.capturePage()).toPNG())}catch(captureError){proof.failureCaptureError=String(captureError)}}save();console.error(error);win?.destroy();app.exit(1)}
})
