// Run after production build: electron.exe scripts/verify-community121-ui.cjs
// Optional KAMUCL_REVIEW_RENDERER_DIR points at a separately built renderer.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{app,BrowserWindow,ipcMain,session}=require('electron'),{buildSync}=require('esbuild')
const {configureGraphics,observeGraphics,validateGraphics,validateQueueControls}=require('./qa-fixture-ui121.cjs')
const zoomArg=process.argv.indexOf('--zoom'),pageZoom=zoomArg<0?1:Number(process.argv[zoomArg+1]),packageVersion=JSON.parse(fs.readFileSync('package.json','utf8')).version
assert([1,1.25].includes(pageZoom),'QA page zoom must be 1 or 1.25');assert.equal(packageVersion,'1.1.21','Build the final 1.1.21 renderer before QA')
const rendererSourceDir=path.resolve(process.env.KAMUCL_REVIEW_RENDERER_DIR||'out/renderer'),fingerprint=file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')})
const root=fs.mkdtempSync(path.resolve('out/community-review-ui121-'+pageZoom*100+'-')),rendererDir=path.join(root,'renderer')
// Keep a coordinated rebuild from mixing another renderer into this in-flight matrix.
fs.cpSync(rendererSourceDir,rendererDir,{recursive:true})
app.setPath('userData',path.join(root,'profile'));const graphics=configureGraphics(app)
const proof={root,classification:'Actual Electron runtime with production renderer and coordinate input; disposable IPC business fixtures, offscreen/'+graphics.backend+' GPU; no real transfer or user profile',runtime:{platform:process.platform,arch:process.arch,electron:process.versions.electron,node:process.versions.node,osRelease:os.release(),startedAt:new Date().toISOString()},configuration:{packageVersion,pageZoom,physicalViewports:[{width:1366,height:768},{width:960,height:620}],themes:['blue-white','black-orange','black-pink','white-pink','transparent','custom'],compositor:graphics},rendererSourceDir,rendererDir,rendererFiles:[path.join(rendererDir,'index.html'),...fs.readdirSync(path.join(rendererDir,'assets')).filter(name=>/\.(?:js|css)$/.test(name)).sort().map(name=>path.join(rendererDir,'assets',name))].map(fingerprint),sourceFiles:['scripts/verify-community121-ui.cjs','scripts/qa-fixture-ui121.cjs','src/renderer/src/views/CommunityView.vue','src/renderer/src/communityDownloadQueue.ts','src/renderer/src/useCommunityDownloadQueue.ts','src/renderer/src/components/CommunityDownloadQueue.vue','src/renderer/src/components/CommunityInstallConfirmation.vue'].map(fingerprint),calls:[],checks:[],geometry:[]},errors=[]
const bundle=path.join(root,'types.cjs');buildSync({entryPoints:['src/shared/types.ts'],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:bundle});const t=require(bundle)
const folder=path.join(root,'games'),target={id:'同名测试实例',folder,mcVersion:'1.21.1',loader:'fabric',loaderVersion:'0.19.5'},account={id:'fixture',type:'offline',username:'Community Review',uuid:'0'.repeat(32)}
let settings={gameDir:folder,activeFolder:folder,folders:[{path:folder,name:'隔离测试目录',isDefault:true}],javaPath:'',javaAuto:true,javaCustom:[],javaHidden:[],memoryMB:4096,memoryAuto:true,jvmArgs:'',resolution:{width:854,height:480,mode:'windowed'},mirror:'bmclapi',theme:'blue-white',custom:structuredClone(t.DEFAULT_CUSTOM_THEME),disabledFeatures:[],favoriteVersions:[],homeLayout:structuredClone(t.DEFAULT_HOME_LAYOUT),background:structuredClone(t.DEFAULT_BACKGROUND),launchThumbnail:structuredClone(t.DEFAULT_LAUNCH_THUMBNAIL),configVersion:1,uiWindowAutoFit:false}
settings.custom.colors={accent:'#059669',bg:'#f1f5f0',card:'#ffffff',text:'#18342c',textDim:'#627b72',border:'#c9d7cf',sidebarBg:'#e5eee8',sidebarText:'#18342c',bannerText:'#ffffff'};proof.configuration.fixtureCustomColors=structuredClone(settings.custom.colors)
const file=(project,kind)=>({source:'modrinth',projectId:project,fileId:project+'-'+kind,fileName:project+'-'+kind+(kind==='mod'?'.jar':'.zip'),version:'1.0.0',url:'https://fixture.invalid/'+project,sha1:'0'.repeat(40),size:123456,gameVersions:['1.21.1'],loaders:kind==='mod'?['fabric']:[],releaseType:'release',date:''})
let selectedKind='mod',failCommit=1,fixtureWindow
const progress=(operationId,taskId,value,text)=>fixtureWindow.webContents.send('event:progress',{operationId,taskId,stage:'download',progress:value,overall:value,text})
const wait=ms=>new Promise(r=>setTimeout(r,ms)),save=()=>fs.writeFileSync(path.join(root,'proof.json'),JSON.stringify({...proof,errors},null,2))
ipcMain.handle('review:invoke',async(_event,channel,...args)=>{
 proof.calls.push({channel,args});save()
 switch(channel){
 case 'settings:get':return settings
 case 'settings:set':return settings={...settings,...args[0]}
 case 'accounts:list':return[account]
 case 'accounts:selected':return account
 case 'versions:installed':return[target]
 case 'versions:manifest':return[{id:'1.21.1',type:'release'}]
 case 'folders:list':return{folders:settings.folders,active:folder}
 case 'skin:profile':return{skins:[],capes:[]}
 case 'skin:avatar':case 'update:getPending':case 'update:getState':return null
 case 'app:systemInfo':return{totalMemMB:16384,freeMemMB:8192,platform:process.platform}
 case 'community:search':selectedKind=args[0].kind;return{items:['review-one','review-two'].map(projectId=>({source:'modrinth',projectId,slug:projectId,title:projectId,author:'fixture',description:'Disposable UI review fixture',iconUrl:'',downloads:1,updatedAt:'',categories:[]})),total:2,offset:0,limit:20}
 case 'community:files':return[file(args[1],args[2].kind)]
 case 'mods:targets':return{versions:[target,{...target,id:'损坏实例',failed:true}],errors:[]}
 case 'mods:prepare':progress(args[2],'prepare-'+args[2],.4,'独立队列检测进度');await wait(900);return{id:args[1].file.projectId+'-plan',target,files:[{name:'root',version:'1.0',dependency:false,fileName:args[1].file.fileName},{name:'required',version:'1.0',dependency:true,fileName:'required-dependency.jar'}],missing:[],warnings:[]}
 case 'mods:commit':await wait(180);if(args[0]==='review-two-plan'&&failCommit-- >0)throw Error('独立 review 模拟网络中断');return'安装完成'
 case 'community:download':progress(args[2],'resource-'+args[2],.5,'独立资源下载进度');await wait(900);return'资源文件已保存'
 case 'mods:discard':return true
 case 'tasks:cancel':return true
 default:return[]
 }
})
fs.writeFileSync(path.join(root,'preload.cjs'),`const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('kamucl',{platform:process.platform,invoke:(c,...a)=>ipcRenderer.invoke('review:invoke',c,...a),on:(c,fn)=>{const h=(_,p)=>fn(p);ipcRenderer.on(c,h);return()=>ipcRenderer.removeListener(c,h)},send:()=>{},getFilePath:()=>''});`)
app.whenReady().then(async()=>{
 let win
 try{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,cb)=>cb({cancel:true}))
 win=new BrowserWindow({show:false,frame:false,width:1366,height:768,webPreferences:{preload:path.join(root,'preload.cjs'),offscreen:true,backgroundThrottling:false}})
 fixtureWindow=win
 win.webContents.on('console-message',(_,level,message)=>{if(level>=3)errors.push(message)})
 const run=code=>win.webContents.executeJavaScript(code),ready=async expression=>{for(let i=0;i<60;i++){if(await run(expression))return;await wait(100)}throw Error('Timed out '+expression)}
 const shot=async name=>{await wait(300);fs.writeFileSync(path.join(root,name+'.png'),(await win.webContents.capturePage()).toPNG())}
 const click=async selector=>{proof.lastClick=selector;save();const pt=await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);if(h!==e&&!e.contains(h))throw Error('Blocked '+${JSON.stringify(selector)}+' by '+h?.className);return{x:x,y:y}})()`);const physical={x:Math.round(pt.x*pageZoom),y:Math.round(pt.y*pageZoom)};win.webContents.sendInputEvent({type:'mouseMove',...physical});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...physical});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...physical});await wait(180)}
 const button=async(scope,text)=>{await run(`(()=>{document.querySelector('#review-button')?.removeAttribute('id');const b=[...document.querySelectorAll(${JSON.stringify(scope)}+' button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button '+${JSON.stringify(text)});b.id='review-button'})()`);await click('#review-button')}
 const enqueue=async(index=0)=>{await ready("document.querySelectorAll('.result-dl').length===2");await click(`.result-card:nth-child(${index+1}) .result-dl`);await ready("!!document.querySelector('.download-modal .btn-gold:not(:disabled)')");await click('.download-modal .modal-actions .btn-gold');await ready("!document.querySelector('.download-modal')")}
 const geometry=async selector=>{const value=await run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,viewport:{width:innerWidth,height:innerHeight}}})()`);proof.geometry.push({selector,theme:settings.theme,...value});assert(value.x>=0&&value.y>=0&&value.x+value.width<=value.viewport.width+.5&&value.y+value.height<=value.viewport.height+.5);save()}
 // A scrollable queue may be taller than the viewport. Prove every real action
 // can be scrolled fully into view and hit, while retaining its original bounds.
 const queueGeometry=async(width,height)=>{
   const container=await run("(()=>{const e=document.querySelector('.community-queue'),r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,viewport:{width:innerWidth,height:innerHeight},scrollHeight:e.querySelector('.queue-items').scrollHeight,clientHeight:e.querySelector('.queue-items').clientHeight}})()");proof.geometry.push({selector:'.community-queue',theme:settings.theme,...container});save();assert(container.x>=0&&container.y>=0&&container.x+container.width<=container.viewport.width+.5)
   const controls=[];const count=await run("document.querySelectorAll('.community-queue button').length");
   for(let i=0;i<count;i++){await run(`document.querySelectorAll('.community-queue button')[${i}].scrollIntoView({block:'center'})`);await wait(120);controls.push(await run(`(()=>{const e=document.querySelectorAll('.community-queue button')[${i}],r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return{text:e.textContent.trim(),rect:{x:r.x,y:r.y,width:r.width,height:r.height},inViewport:r.x>=0&&r.y>=0&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5,hit:h?.className,correct:h===e||e.contains(h)}})()`))}
   proof.geometry.push({label:'scrollable queue controls reachable',theme:settings.theme,width,height,controls});save();validateQueueControls(controls)
   await click('.queue-shortcut');await wait(350)
 }
 const resize=async(width,height)=>{win.setContentSize(width,height);win.webContents.setZoomFactor(pageZoom);await wait(300);const actual=await run('({width:innerWidth,height:innerHeight})');assert(Math.abs(actual.width-width/pageZoom)<1&&Math.abs(actual.height-height/pageZoom)<1,JSON.stringify({actual,width,height,pageZoom}));assert.equal(win.webContents.getZoomFactor(),pageZoom);proof.configuration.cssViewport=actual;save()}
 await win.loadFile(path.join(rendererDir,'index.html'));await ready("!!document.querySelector('[data-nav=community]')");await resize(1366,768);assert.equal(await run("document.querySelector('.logo-version')?.textContent.trim()"),'v1.1.21','The actual loaded renderer must be version 1.1.21')
 proof.graphics=await observeGraphics(app,win.webContents,graphics);save();validateGraphics(proof.graphics)
 await click('[data-nav=community]');await enqueue();await ready("document.querySelector('.queue-item[data-state=preparing]')?.textContent.includes('40%')");assert.equal(await run("!!document.querySelector('.modal-mask')"),false);await shot('mod-preparing-background');await ready("!!document.querySelector('.queue-item[data-state=confirmation]')");await geometry('.queue-shortcut');await shot('mod-awaits-confirmation')
 assert(!proof.calls.some(call=>call.channel==='mods:commit'))
 await click('[data-kind=resourcepack]');await enqueue();await ready("document.querySelector('.queue-item[data-state=downloading]')?.textContent.includes('50%')");assert.equal(await run("!!document.querySelector('.modal-mask')"),false);await shot('resource-download-background');await ready("!!document.querySelector('.queue-item[data-state=completed]')");assert(await run("!!document.querySelector('.queue-item[data-state=confirmation]')"));await shot('resource-continues-with-pending-mod')
 proof.checks.push('Enqueue dismisses the file picker without forcing confirmation; pending MOD plan leaves resource transfer available')
 for(const theme of proof.configuration.themes){
   await click('[data-nav=settings]');await ready("!!document.querySelector('.theme-option')");await run(`(()=>{const names={'blue-white':'白蓝','black-orange':'橙黑','black-pink':'粉黑','white-pink':'粉白','transparent':'默认·黑紫','custom':'个性化'},b=[...document.querySelectorAll('.theme-option')].find(e=>e.textContent.includes(names[${JSON.stringify(theme)}]));if(!b)throw Error('Missing theme');b.id='review-theme'})()`);await click('#review-theme');await ready(`document.documentElement.getAttribute('data-theme')===${JSON.stringify(theme)}`)
   const accent=await run("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()");assert.equal(accent,(theme==='custom'?settings.custom.colors:t.THEME_PRESETS[theme].colors).accent,'Actual selected theme accent must match its valid palette');proof.geometry.push({label:'actual rendered theme accent',theme,accent});save()
   await click('[data-nav=community]');await ready("!!document.querySelector('.queue-shortcut')")
   for(const [width,height] of [[1366,768],[960,620]]){
     await resize(width,height);await click('.queue-shortcut');await geometry('.queue-shortcut');await queueGeometry(width,height);await shot(theme+'-'+width+'-queue')
     const heading=await run("(()=>{const bar=document.querySelector('.queue-shortcut-bar').getBoundingClientRect(),head=document.querySelector('.queue-head').getBoundingClientRect();return{barBottom:bar.bottom,headingTop:head.top}})()");proof.geometry.push({label:'sticky queue jump keeps heading visible',theme,width,height,...heading});save();assert(heading.headingTop>=heading.barBottom,JSON.stringify(heading))
     const searchHits=await run("[...document.querySelectorAll('.search-row button')].map(e=>{e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return{text:e.textContent.trim(),x,y,inViewport:y>0&&y<innerHeight&&x>0&&x<innerWidth,hit:h?.className,correct:h===e||e.contains(h)}})");proof.geometry.push({label:'search action center hits',theme,width,height,searchHits});save();assert(searchHits.every(value=>value.inViewport&&value.correct),JSON.stringify(searchHits))
     await button('.queue-item[data-state=confirmation]','确认前置与安装');await ready("!!document.querySelector('.community-confirm')");await geometry('.community-confirm');await shot(theme+'-'+width+'-confirmation');await button('.community-confirm','稍后确认')
     await run("(()=>{const e=document.querySelector('.content');e.scrollTop=e.scrollHeight})()");await wait(300);await geometry('.queue-shortcut');await click('.queue-shortcut');await wait(250)
   }
 }
 proof.checks.push('Six themes including default black-purple and valid custom colors at exact physical 1366x768 and 960x620, '+pageZoom*100+'% page zoom: actual accents, sticky queue entry, queue card and explicit dependency modal fit; search/reset and scrolled queue coordinate hits pass; 24 matrix screenshots captured')
 await button('.queue-item[data-state=confirmation]','确认前置与安装');await ready("!!document.querySelector('.community-confirm')");await geometry('.community-confirm');await click('.dependency-choice input');assert(await run("document.querySelector('.community-confirm .btn-gold').disabled"));await click('.dependency-choice input');await shot('explicit-dependencies-confirmation');await button('.community-confirm','下载前置并安装');await ready("document.querySelectorAll('.queue-item[data-state=completed]').length===2")
 proof.checks.push('Necessary dependency checkbox blocks installation when unchecked; explicit confirmation commits exactly once')
 await click('[data-kind=mod]');await enqueue(1);await ready("!!document.querySelector('.queue-item[data-state=confirmation]')");await click('[data-nav=settings]');await ready("!!document.querySelector('.personalize-btn')");await click('[data-nav=community]');await ready("!!document.querySelector('.queue-item[data-state=confirmation]')");await button('.queue-item[data-state=confirmation]','确认前置与安装');await button('.community-confirm','下载前置并安装');await ready("!!document.querySelector('.queue-item[data-state=failed]')");await shot('failure-and-retry');await button('.queue-item[data-state=failed]','重试');await ready("!!document.querySelector('.queue-item[data-state=confirmation]')");await button('.queue-item[data-state=confirmation]','取消');await ready("!!document.querySelector('.queue-item[data-state=cancelled]')");assert.equal(await run("!!document.querySelector('.queue-shortcut')"),false)
 assert.equal(proof.calls.filter(call=>call.channel==='mods:prepare'&&call.args[1].file.projectId==='review-two').length,2);assert.equal(proof.calls.filter(call=>call.channel==='mods:commit').length,2)
 assert(proof.calls.some(call=>call.channel==='mods:discard'&&call.args[0]==='review-two-plan'));proof.checks.push('Queue survives route changes; failure retry obtains a new plan; pending cancellation discards it and releases the sticky queue entry')
 assert.deepEqual(errors,[]);proof.complete=true;save();console.log(JSON.stringify({ok:true,root,checks:proof.checks},null,2));win.destroy();app.quit()
 }catch(error){proof.error=String(error.stack||error);if(win&&!win.isDestroyed()){try{fs.writeFileSync(path.join(root,'failed-state.png'),(await win.webContents.capturePage()).toPNG())}catch(captureError){proof.failureCaptureError=String(captureError)}}save();console.error(error);win?.destroy();app.exit(1)}
})


