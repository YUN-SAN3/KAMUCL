// Actual portable EXE GUI, with an isolated profile and loopback-only inspection.
function classifyThemeReadiness(sample, expected) {
  const check=require('node:assert/strict'), main=sample.main, renderer=sample.renderer
  check(main&&Number.isInteger(main.pid),'owned theme main observation missing')
  check(main.pid===expected.childPid||main.ppid===expected.childPid,'theme inspector belongs to another process')
  check.equal(main.profile,expected.profile,'theme profile must be the actual owned profile')
  check.equal(main.persistedReadError,null,'owned settings file could not be read')
  check.equal(main.persistedTheme,expected.theme,'persisted theme must match the requested theme')
  if(!renderer)return false
  check.equal(renderer.timeOrigin,renderer.before.timeOrigin,'theme observation changed document during settings read')
  check.equal(renderer.url,expected.url,'theme observation left the actual renderer document')
  if(renderer.timeOrigin===expected.beforeTimeOrigin||renderer.readyState!=='complete')return false
  check.equal(renderer.settingsTheme,expected.theme,'real settings:get must preserve the requested theme')
  check.equal(renderer.storeFound,true,'actual App store must be observable')
  if(renderer.initialized!==true)return false
  check.equal(renderer.storeTheme,expected.theme,'initialized App store must preserve the requested theme')
  check.equal(renderer.domTheme,expected.theme,'requested theme must actually apply after initialization')
  return true
}
async function waitForThemeReadiness({observe,expected,now=()=>performance.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),onSample=()=>{},maximumMs=12000}) {
  const started=now()
  while(now()-started<maximumMs){
    let sample
    try{sample=await observe(()=>Math.max(1,maximumMs-(now()-started)))}
    catch(error){onSample({elapsedMs:now()-started,error:{name:error.name,message:error.message}});throw error}
    const row={elapsedMs:now()-started,sample};onSample(row)
    if(now()-started>=maximumMs)throw Error('Actual theme readiness exceeded the existing 12-second inspection budget')
    if(classifyThemeReadiness(sample,expected))return row
    await sleep(Math.min(80,Math.max(0,maximumMs-(now()-started))))
  }
  throw Error('Actual new-document theme did not become ready within the existing 12-second inspection budget')
}
async function readActualRendererTheme(beforeTimeOrigin) {
  const before={timeOrigin:performance.timeOrigin,url:document.URL,readyState:document.readyState}
  if(before.timeOrigin===beforeTimeOrigin||before.readyState!=='complete')return{before,...before}
  const settings=await window.kamucl.invoke('settings:get')
  // Production inline templates do not expose setupState. Import the document's
  // already-loaded entry module and identify its actual exported reactive store.
  const scripts=[...document.querySelectorAll('script[type="module"][src]')],moduleURL=scripts.length===1?scripts[0].src:null
  const namespace=moduleURL?await import(moduleURL):{},candidates=Object.entries(namespace).filter(([,value])=>value&&typeof value==='object'&&typeof value.initialized==='boolean'&&typeof value.currentView==='string'&&Array.isArray(value.accounts)&&Array.isArray(value.installed)&&Array.isArray(value.tasks))
  const store=candidates.length===1?candidates[0][1]:null
  return{before,timeOrigin:performance.timeOrigin,url:document.URL,readyState:document.readyState,settingsTheme:settings.theme,moduleURL,storeExportKey:store?candidates[0][0]:null,storeCandidates:candidates.length,storeFound:!!store,initialized:store?.initialized,storeTheme:store?.settings?.theme,domTheme:document.documentElement.dataset.theme}
}
function readSettingsScopeState() {
  const visible=e=>!!e&&e.getClientRects().length>0
  const isolation=document.querySelector('[data-section=isolation] input[type=checkbox]'),location=document.querySelector('[data-ui="download-location:path"]')
  return{scope:document.querySelector('.settings-scopes [aria-current=page]')?.textContent.trim(),category:document.querySelector('.settings-categories [aria-current=page]')?.textContent.trim(),categories:[...document.querySelectorAll('.settings-categories button')].map(e=>e.textContent.trim()),visibleSections:[...document.querySelectorAll('.settings-body [data-section]')].filter(visible).map(e=>e.dataset.section),isolation:{visible:visible(isolation),type:isolation?.type,disabled:isolation?.disabled,checked:isolation?.checked,hint:document.querySelector('[data-section=isolation] .group-hint')?.textContent.trim()},download:{card:visible(document.querySelector('[data-ui="download-location:settings"]')),path:visible(location),readOnly:location?.readOnly,value:location?.value,change:visible(document.querySelector('[data-ui="download-location:change"]')),manage:visible(document.querySelector('[data-ui="download-location:manage"]'))}}
}
function assertSettingsScopeState(state,expected) {
  const check=require('node:assert/strict')
  check.equal(state.scope,expected==='game'?'游戏设置':'启动器设置','actual settings scope')
  check.equal(state.category,expected==='game'?'目录与隔离':'下载','actual settings category')
  check.deepEqual(state.categories,expected==='game'?['运行环境','游戏窗口','目录与隔离']:['外观','行为与登录','下载','功能与插件','关于与更新'],'each scope exposes only its own categories')
  if(expected==='game'){
    check.deepEqual(state.visibleSections,['isolation'],'game directories exposes its actual isolation control, not the download-location card')
    check.equal(state.isolation.visible,true);check.equal(state.isolation.type,'checkbox');check.equal(state.isolation.disabled,false)
    check.match(state.isolation.hint,/独立保存存档、模组与配置/,'actual isolation explanation')
    check.equal(state.download.card,false);check.equal(state.download.path,false);check.equal(state.download.change,false);check.equal(state.download.manage,false)
  }else{
    check.deepEqual(state.visibleSections,['installation','downloads','mirror'],'downloads exposes location and download controls while other settings remain hidden')
    check.equal(state.isolation.visible,false)
    for(const key of ['card','path','readOnly','change','manage'])check.equal(state.download[key],true,'actual download-location '+key)
    check.equal(typeof state.download.value,'string');check(state.download.value.length>0,'actual default download path must be displayed')
  }
}
function readSettingsCoordinate(group,label) {
  const matches=[...document.querySelectorAll(group+' button')].filter(e=>e.textContent.trim()===label)
  if(matches.length!==1)return{matches:matches.length}
  const e=matches[0],r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y),ancestors=[]
  for(let node=e;node;node=node.parentElement){const c=getComputedStyle(node);ancestors.push(c.display!=='none'&&c.visibility==='visible'&&Number(c.opacity)===1)}
  return{matches:1,x,y,width:r.width,height:r.height,viewport:{width:innerWidth,height:innerHeight},disabled:e.disabled,inert:!!e.closest('[inert]'),hit:hit===e||e.contains(hit),ancestorsVisible:ancestors.every(Boolean),runningFiniteAnimations:document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getComputedTiming().iterations!==Infinity).length}
}
function settingsCoordinateReady(state) {
  return state.matches===1&&state.disabled===false&&state.inert===false&&state.hit===true&&state.ancestorsVisible===true&&state.runningFiniteAnimations===0&&['x','y','width','height'].every(key=>Number.isFinite(state[key]))&&state.width>0&&state.height>0&&state.x>=0&&state.y>=0&&state.x<state.viewport?.width&&state.y<state.viewport?.height
}
const MAC_QUIT_INSPECTION='setTimeout(()=>testElectron.app.quit(),500);true'
module.exports={classifyThemeReadiness,waitForThemeReadiness,readActualRendererTheme,readSettingsScopeState,assertSettingsScopeState,readSettingsCoordinate,settingsCoordinateReady,MAC_QUIT_INSPECTION}
// The established skin-surface CLI intentionally imports this runner.
if(require.main===module||module.parent?.filename===require.resolve('./verify-skin-surfaces-ui.cjs')){
if (process.argv[2]) {
  if (!['transparent', 'black-orange', 'blue-white', 'custom'].includes(process.argv[2])) throw new Error('Unknown GUI theme argument')
  process.env.KAMUCL_TEST_THEME = process.argv[2]
}
const fs=require('fs'),path=require('path'),os=require('os'),net=require('net'),assert=require('assert/strict'),{spawn}=require('child_process');
const ownedQA=require('./qa-owned-process-119.cjs'),{randomUUID}=require('node:crypto');
const macParity=process.env.KAMUCL_UI_MODULE==='mac-parity',parityPhase=process.env.KAMUCL_PARITY_PHASE,privacyOwned=require('./qa-privacy-categories115.cjs').ownedProfileConfiguration(process.env);
const version=require('../package.json').version,root=privacyOwned?.root||(macParity?require('./verify-mac-parity.cjs').parityRoot(process.env):fs.mkdtempSync(path.join(os.tmpdir(),'KAMUCL EXE GUI 中文 '))),profile=path.join(root,'profile'),games=path.join(root,'games'),other=path.join(root,'second-games');
if(privacyOwned?privacyOwned.phase==='first':!macParity||parityPhase==='first'){
fs.mkdirSync(profile);fs.mkdirSync(games);fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({gameDir:games,activeFolder:games,folders:[{path:games,name:'独立验证目录',isDefault:true}],autoUpdate:false,theme:process.env.KAMUCL_TEST_THEME || 'black-orange'}));
const fixtureDir=path.join(games,'versions','联机验证实例');fs.mkdirSync(fixtureDir,{recursive:true});fs.writeFileSync(path.join(fixtureDir,'联机验证实例.json'),JSON.stringify({id:'联机验证实例',_mcVersion:'1.20.1',_loader:'fabric',_gameDir:true,mainClass:'net.fabricmc.loader.impl.launch.knot.KnotClient',libraries:[]}));fs.writeFileSync(path.join(fixtureDir,'联机验证实例.jar'),'fixture-only-no-launch');
fs.writeFileSync(path.join(profile,'servers.json'),JSON.stringify([{id:'one',name:'普通服务器',address:'127.0.0.1:9',versionId:'联机验证实例',folder:games},{id:'two',name:'我收藏的服务器',address:'127.0.0.1:10',versionId:'联机验证实例',folder:games}]));
fs.mkdirSync(other);
const settings=JSON.parse(fs.readFileSync(path.join(profile,'settings.json')));settings.folders.push({path:other,name:'整合包收藏',isDefault:false});if(settings.theme==='custom')settings.custom={colors:{bg:'#171520',card:'#242232',accent:'#8759cd',text:'#f6f2ff',textDim:'#bcb7cc',border:'#4a455c',sidebarBg:'#201d2b',sidebarText:'#e5dff2',bannerText:'#ffffff'}};fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify(settings));
for(const [i,name] of ['26.3 Fabric 生存世界','Mecha Craftaleon 客户端 v10 — 超长名称完整显示测试与更多文字','1.21.11 Forge','26.2 NeoForge','原版建筑存档','旧版测试实例'].entries()) { const folder=i<3?games:other,dir=path.join(folder,'versions',name);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify({id:name,_mcVersion:i===0?'26.3':'1.21.11',_loader:['fabric','fabric','forge','neoforge',undefined,undefined][i],_loaderVersion:i===3?'26.2.1':'0.19.5',mainClass:'net.minecraft.client.main.Main',libraries:[]}));fs.writeFileSync(path.join(dir,name+'.jar'),'fixture-not-launched');}
for(const folder of [games,other])for(const id of fs.readdirSync(path.join(folder,'versions'))){
  for(const rel of ['mods','resourcepacks','shaderpacks']){const dir=path.join(folder,'versions',id,rel);fs.mkdirSync(dir,{recursive:true});for(const name of ['Fabric API','Long display name for a resource with several words and 中文名称','Replay recording tools']){const zip=new(require('adm-zip'))();zip.addFile('fabric.mod.json',Buffer.from(JSON.stringify({schemaVersion:1,id:name.replace(/[^a-z]/gi,'').toLowerCase(),version:'1.0.0',name})));zip.addFile('pack.mcmeta',Buffer.from(JSON.stringify({pack:{pack_format:15,description:name}})));zip.writeZip(path.join(dir,name+(rel==='mods'?'.jar':'.zip')))}}
}
}
if(privacyOwned?.phase==='first')require('./qa-privacy-categories115.cjs').prepareFixtures(root);
const exe=process.env.KAMUCL_GUI_APP||path.join(root,`KAMUCL-${version}.exe`);if(!process.env.KAMUCL_GUI_DEV&&!process.env.KAMUCL_GUI_APP)fs.copyFileSync(`release/KAMUCL-${version}.exe`,exe);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const mainServer=net.createServer();await new Promise(r=>mainServer.listen(0,'127.0.0.1',r));const mainPort=mainServer.address().port;await new Promise(r=>mainServer.close(r));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const log=fs.openSync(path.join(root,'process.log'),'w');
 const child=spawn(process.env.KAMUCL_GUI_DEV ? path.resolve('node_modules/electron/dist/electron.exe') : exe,[...(process.env.KAMUCL_GUI_DEV ? ['.'] : []),...(process.env.KAMUCL_GUI_SOFTWARE==='1'?['--use-gl=angle','--use-angle=swiftshader']:[]),`--inspect=127.0.0.1:${mainPort}`,'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling',`--user-data-dir=${profile}`,`--remote-debugging-port=${port}`],{env,stdio:['ignore',log,log]});let ws,mainWs,operationError,diagnosticRendererURL;const originalConsoleErrors=[];
 const ownedTrack=ownedQA.trackOwnedChild(child,'refinement-app'),ownedProcessProof={classification:'Read-only disposable QA child lifecycle; never command lines or external signals',child:ownedTrack.ledger,before:await ownedQA.ownedInventory([ownedTrack])};
 let restoreOwnedCancellation
 if(process.env.KAMUCL_OBSERVER_TRACE_CONTROL119==='1')restoreOwnedCancellation=ownedQA.installOwnedCancellation(process,async()=>{
  const cancelled={classification:'Independent trace deadline failure; only tracked spawned children may be signalled',startedAt:new Date().toISOString(),children:[...ownedQA.trackedChildren].map(t=>t.ledger),complete:false}
  try{const results=await Promise.allSettled([...ownedQA.trackedChildren].map(t=>ownedQA.finishOwnedChild(t,{terminate:true,timeoutMs:4500})));cancelled.cleanupComplete=results.every(r=>r.status==='fulfilled');cancelled.errors=results.filter(r=>r.status==='rejected').map(r=>r.reason.name)}
  finally{cancelled.finishedAt=new Date().toISOString();fs.writeFileSync(path.join('out','qa-owned-process-119-'+randomUUID()+'.json'),JSON.stringify(cancelled,null,2));process.exit(1)}
 })
 try {
  let page;for(let i=0;i<90;i++){assert(child.exitCode===null,'portable exited before UI');try{page=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p=>p.url.includes('/renderer/index.html'));if(page)break}catch{}await wait(1000)}assert(page,'renderer unavailable');
  diagnosticRendererURL=page.webSocketDebuggerUrl;ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);if(m.method==='Runtime.exceptionThrown'||m.method==='Runtime.consoleAPICalled'&&m.params.type==='error'){if(originalConsoleErrors.length<128)originalConsoleErrors.push({method:m.method,...m.params});console.error(JSON.stringify(m.params))}});
  const call=(method,params={},timeoutMs=12000)=>new Promise((resolve,reject)=>{const n=++id,t=setTimeout(()=>{pending.delete(n);reject(Error(method+' timed out: '+(params.expression||'').slice(0,180)))},timeoutMs);pending.set(n,m=>{clearTimeout(t);pending.delete(n);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result)});ws.send(JSON.stringify({id:n,method,params}))});
  const evaluate=async (expression,timeoutMs=12000)=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},timeoutMs);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
  await call('Runtime.enable');await call('Emulation.setFocusEmulationEnabled',{enabled:true});await call('Page.bringToFront');
  let text='';for(let i=0;i<30;i++){text=await evaluate("document.body?.innerText || ''");if(text?.includes(version)&&text.includes('开始游戏')&&(macParity||await evaluate("!!document.querySelector('.viewer3d canvas')")))break;await wait(1000)}
  assert(text.includes(version)&&text.includes('开始游戏'));if(!macParity)assert(await evaluate("!!document.querySelector('.viewer3d canvas')"),'skin canvas missing');await wait(6500);

  const mainReadiness={port:mainPort,maximumMs:6000,samples:[]},mainStarted=Date.now();let mainPage;
  while(Date.now()-mainStarted<mainReadiness.maximumMs){
    try{const pages=await(await fetch(`http://127.0.0.1:${mainPort}/json`,{signal:AbortSignal.timeout(Math.max(1,mainReadiness.maximumMs-(Date.now()-mainStarted)))})).json();mainPage=pages.find(p=>p.webSocketDebuggerUrl);mainReadiness.samples.push({elapsedMs:Date.now()-mainStarted,ready:!!mainPage})}
    catch(error){mainReadiness.samples.push({elapsedMs:Date.now()-mainStarted,ready:false,error:error.message,cause:error.cause?.code})}
    fs.writeFileSync('out/main-inspector-ready-live.json',JSON.stringify(mainReadiness,null,2));if(mainPage)break;await wait(Math.max(0,Math.min(100,mainReadiness.maximumMs-(Date.now()-mainStarted))))
  }
  assert(mainPage,'main inspector did not become available within 6 seconds: '+JSON.stringify(mainReadiness.samples.at(-1)));
  mainWs=new WebSocket(mainPage.webSocketDebuggerUrl);await new Promise(r=>mainWs.addEventListener('open',r,{once:true}));let mid=0;const mp=new Map();mainWs.addEventListener('message',e=>{const m=JSON.parse(e.data);mp.get(m.id)?.(m)});
  const main=(expression,timeoutMs=10000)=>new Promise((resolve,reject)=>{const n=++mid,t=setTimeout(()=>{mp.delete(n);reject(Error('Main inspection timeout'))},timeoutMs);mp.set(n,m=>{clearTimeout(t);mp.delete(n);m.error?reject(Error(JSON.stringify(m.error))):m.result?.exceptionDetails?reject(Error(JSON.stringify(m.result.exceptionDetails))):resolve(m.result?.result?.value)});mainWs.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}))});

  const shotDir=path.resolve('release/ui-refinement-'+(process.env.KAMUCL_TEST_THEME||'black-orange'));fs.mkdirSync(shotDir,{recursive:true});
  fs.writeFileSync('out/ui-live.json',JSON.stringify({root,port,mainPort,pid:child.pid,shotDir}));
  if(macParity)await main("globalThis.testElectron=process.mainModule.require('electron');true");
  else{
  const skinFixture = await evaluate("(()=>{const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');g.fillStyle='#49a595';g.fillRect(0,0,64,64);g.fillStyle='#a07856';g.fillRect(8,8,8,8);return c.toDataURL()})()");
  await main(`globalThis.testElectron=process.mainModule.require('electron');globalThis.uiSkin=${JSON.stringify(skinFixture)};globalThis.uiAccount={id:'ui-fixture',type:'microsoft',username:'界面验证账户',uuid:'00000000000000000000000000000001'};for(const [channel,handler] of [['accounts:selected',()=>uiAccount],['accounts:list',()=>[uiAccount]],['skin:profile',()=>({username:uiAccount.username,skins:[{id:'fixture',variant:'classic',dataUrl:uiSkin,url:''}],capes:[]})],['skin:history',()=>[]],['skin:avatar',()=>uiSkin]]){testElectron.ipcMain.removeHandler(channel);testElectron.ipcMain.handle(channel,handler)}`);
  }
  const reloadThemeReady=async(label,requestedTheme=process.env.KAMUCL_TEST_THEME||'black-orange')=>{
    const expectedProfile=fs.realpathSync.native(profile)
    const stage=process.env.KAMUCL_NATIVE_RECORDER_STAGE119||(exe.split(path.sep).includes('dmg-mount')?'dmg':'app')
    const directory=macParity?path.resolve('release','mac-parity-proof-'+process.arch+'-app'):process.platform==='darwin'?path.resolve('release','mac-proof-'+process.arch+'-'+stage,'theme-readiness'):path.resolve('out','theme-readiness')
    fs.mkdirSync(directory,{recursive:true})
    const name='theme-reload-'+(parityPhase||'gui')+'-'+label+'-'+randomUUID(),receiptFile=path.join(directory,name+'.json'),captureFile=path.join(directory,name+'.png')
    const receipt={version,classification:'Read-only actual owned profile/settings and new renderer document; no theme setter or fabricated state',label,requestedTheme,expectedProfile,childPid:child.pid,startedAt:new Date().toISOString(),maximumMs:12000,complete:false,samples:[]}
    fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2),{flag:'wx'})
    const save=()=>fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2))
    try{
      receipt.before=await evaluate('({timeOrigin:performance.timeOrigin,url:document.URL,readyState:document.readyState,domTheme:document.documentElement.dataset.theme})');save()
      await call('Page.reload')
      const expected={childPid:child.pid,profile:expectedProfile,theme:requestedTheme,url:receipt.before.url,beforeTimeOrigin:receipt.before.timeOrigin}
      await waitForThemeReadiness({expected,onSample:row=>{receipt.samples.push(row);save()},observe:async remaining=>{
        const mainState=await main(`(()=>{const e=globalThis.testElectron||process.mainModule.require('electron'),f=process.mainModule.require('node:fs'),p=process.mainModule.require('node:path');const raw=e.app.getPath('userData'),actual=f.realpathSync.native(raw);let persistedTheme=null,persistedReadError=null;if(actual===${JSON.stringify(expectedProfile)})try{persistedTheme=JSON.parse(f.readFileSync(p.join(actual,'settings.json'),'utf8')).theme}catch(error){persistedReadError={name:error.name,message:error.message}};return{pid:process.pid,ppid:process.ppid,profile:actual,profileAsReported:raw,persistedTheme,persistedReadError}})()`,Math.min(10000,remaining()))
        // Validate ownership before reading any renderer settings, and retain the
        // main sample even when the current renderer execution context is gone.
        try{classifyThemeReadiness({main:mainState},expected)}catch(error){receipt.samples.push({elapsedMs:null,sample:{main:mainState},classificationError:{name:error.name,message:error.message}});save();throw error}
        let renderer
        try{renderer=await evaluate(`(${readActualRendererTheme.toString()})(${JSON.stringify(receipt.before.timeOrigin)})`,Math.min(12000,remaining()))}
        catch(error){receipt.samples.push({elapsedMs:null,sample:{main:mainState},rendererReadError:{name:error.name,message:error.message}});save();if(/Cannot find (?:default )?execution context|Execution context was destroyed|Inspected target navigated|Cannot find context with specified id/.test(error.message))return{main:mainState};throw error}
        return{main:mainState,renderer}
      }})
      receipt.complete=true
    }catch(error){receipt.error={name:error.name,message:error.message};throw error}
    finally{
      try{const image=await call('Page.captureScreenshot',{format:'png'});const bytes=Buffer.from(image.data,'base64');fs.writeFileSync(captureFile,bytes,{flag:'wx'});receipt.capture={file:path.basename(captureFile),bytes:bytes.length,sha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex'),classification:receipt.complete?'Actual ready-state capture':'Original failure-state capture; no ready-state success inferred'}}catch(error){receipt.captureError={name:error.name,message:error.message}}
      receipt.finishedAt=new Date().toISOString();save()
    }
  }
  await reloadThemeReady('initial')
  if(process.platform==='darwin'){
    // CDP focus emulation does not activate NSApp. The disposable native QA
    // window must be genuinely foreground before trusted coordinate gestures.
    const nativeFocus=await main(`(()=>{const w=testElectron.BrowserWindow.getAllWindows()[0],before={focused:w.isFocused(),visible:w.isVisible(),hidden:testElectron.app.isHidden()};testElectron.app.focus({steal:true});w.show();w.focus();return{before,after:{focused:w.isFocused(),visible:w.isVisible(),hidden:testElectron.app.isHidden()}}})()`);
    await wait(250);fs.writeFileSync('out/native-gui-focus-live.json',JSON.stringify({source:'actual disposable macOS NSApp activation and BrowserWindow focus; no system preferences changed',...nativeFocus},null,2));
  }
  assert.equal(await evaluate('document.documentElement.dataset.theme'),process.env.KAMUCL_TEST_THEME||'black-orange','requested theme must actually apply');
  const screenshot=async name=>{await wait(220);fs.writeFileSync(path.join(shotDir,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));if(process.env.KAMUCL_STABLE_NAV_PROOF==='1'&&/gallery-118-themed-rows|community-118-favorites/.test(name)){await wait(1800);const state=await evaluate("({now:performance.now(),view:document.querySelector('.nav-item.active')?.dataset.nav,transitions:document.querySelector('nav')?.getAnimations({subtree:true}).filter(a=>a.playState==='running').map(a=>({state:a.playState,currentTime:a.currentTime})),items:[...document.querySelectorAll('.nav-item')].map(e=>({text:e.innerText,box:{top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom},opacity:getComputedStyle(e).opacity}))})");fs.writeFileSync(path.join(shotDir,name+'-settled.json'),JSON.stringify(state,null,2));fs.writeFileSync(path.join(shotDir,name+'-settled.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))}};
  const click=async selector=>{
    let state;
    for(let i=0;i<50;i++){
      state=await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');return {exists:!!e,disabled:!!e?.disabled,inert:!!e?.closest("[inert]")}})()');
      if(state.exists&&!state.disabled&&!state.inert)return evaluate('document.querySelector('+JSON.stringify(selector)+').click()');
      await wait(80);
    }
    throw Error('Clickable target did not become ready: '+selector+' '+JSON.stringify(state));
  };
  const type=async (selector,value)=>evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');e.value='+JSON.stringify(value)+';e.dispatchEvent(new Event("input",{bubbles:true}))})()');
  const nav=async id=>{
    if(['mods','packs','shaders','recordings','projections','bridge','servers'].includes(id)&&!await evaluate('document.querySelector("[data-nav=resources]")?.getAttribute("aria-expanded")==="true"'))await click('[data-nav=resources]');
    await click('[data-nav='+id+']');
    let state,ready=false;
    for(let i=0;i<50;i++){
      state=await evaluate('(()=>{const e=document.querySelector("[data-nav='+id+']");return {current:e?.getAttribute("aria-current"),inert:!!e?.closest("[inert]"),selected:document.querySelector("[data-nav][aria-current=page]")?.dataset.nav,resourcesExpanded:document.querySelector("[data-nav=resources]")?.getAttribute("aria-expanded")}})()');
      if(state.current==='page'&&!state.inert){ready=true;break}await wait(80);
    }
    assert(ready,'Navigation did not select '+id+': '+JSON.stringify(state));await wait(350);
  };
  if(process.env.KAMUCL_EXTENSION_GUI){
    const recordScreencast=async(name,action,duration=2200)=>{
      const directory=path.resolve('out',name+'-'+(process.env.KAMUCL_TEST_THEME||'black-orange'));fs.mkdirSync(directory,{recursive:true});const frames=[],buffers=[],startedAt=Date.now();let nextAck=900000;
      // Acknowledge before decoding or disk I/O so the capture consumer cannot
      // throttle the native compositor; persist the original frames afterwards.
      const listener=e=>{const message=JSON.parse(e.data);if(message.method!=='Page.screencastFrame')return;const frame=message.params,index=frames.length,file='frame-'+String(index).padStart(4,'0')+'.jpg';ws.send(JSON.stringify({id:++nextAck,method:'Page.screencastFrameAck',params:{sessionId:frame.sessionId}}));frames.push({file,receivedAt:Date.now(),...frame.metadata});buffers.push(Buffer.from(frame.data,'base64'))};
      ws.addEventListener('message',listener);
      // Keep the native compositor's real timing, while limiting QA-only JPEG
      // encoding cost. Full-resolution PNGs are captured in a separate run.
      const capture={format:'jpeg',quality:70,maxWidth:960,maxHeight:620,everyNthFrame:1};
      try{await call('Page.startScreencast',capture);await wait(100);await action();await wait(duration)}finally{await call('Page.stopScreencast');ws.removeEventListener('message',listener)}
      for(let i=0;i<frames.length;i++)fs.writeFileSync(path.join(directory,frames[i].file),buffers[i]);
      const intervals=frames.slice(1).map((frame,index)=>frame.timestamp-frames[index].timestamp),elapsed=frames.length>1?frames.at(-1).timestamp-frames[0].timestamp:0,result={version,directory,capture,source:'actual Page.startScreencast full compositor frames scaled to fit 960x620, JPEG quality70, acknowledged before decode and buffered in memory until recording stops; no interpolated frames',startedAt:new Date(startedAt).toISOString(),frames,elapsed,fps:elapsed?(frames.length-1)/elapsed:0,intervals};fs.writeFileSync(path.join(directory,'recording.json'),JSON.stringify(result,null,2));return result;
    };
    const harness={call,evaluate,main,click,nav,screenshot,wait,root,profile,games,other,version,recordScreencast,ownedTrack,ws,reloadThemeReady};
    if(process.env.KAMUCL_UI_MODULE==='ux110')await require('./verify-appearance-motion-110-ui.cjs')(harness);
    if(!process.env.KAMUCL_SKIP_EXTENSION_BASE)await require('./verify-extension-ui.cjs')(harness);
    const selectedModule=process.env.KAMUCL_UI_MODULE||process.env.KAMUCL_117_MODULE;
    const capabilities=require('./ui-capabilities.cjs');
    if(capabilities.singleLogo&&selectedModule==='motion119')await require('./verify-kamu-motion-diagnostic-119.cjs')({...harness,motionDiagnosticInvocation:'standalone-cold-process'});
    if(selectedModule==='native-trace')await require('./verify-kamu-native-trace-119.cjs')(harness);
    if(selectedModule==='native-recorder')await require('./verify-kamu-native-recorder-119.cjs')(harness);
    if(selectedModule==='native-video')await require('./verify-kamu-native-video-119.cjs')(harness);
    if(selectedModule==='native-compositor')await require('./verify-kamu-native-compositor-119.cjs')(harness);
    if(selectedModule==='mac-parity')await require('./verify-mac-parity-ui.cjs')({...harness,phase:parityPhase});
    if(capabilities.singleLogo&&selectedModule==='feedback-scale')await require('./verify-kamu-feedback-scale-119-ui.cjs')(harness);
    // Run the unchanged motion gate before longer editing fixtures, so a native
    // failure yields render diagnostics without an unrelated earlier UI race.
    const modules=[['header','verify-mascot-header-ui.cjs'],['skin118','verify-skin-editor-ui.cjs'],['palette','verify-skin-palette-ui.cjs'],['gallery','verify-gallery-favorites-ui.cjs'],['gallery118','verify-gallery-favorites-118-ui.cjs'],...(capabilities.importRouting?[['import119','verify-import-routing-119-ui.cjs']]:[]),...(capabilities.themedSelection?[['selection119','verify-selection-ui-119.cjs']]:[]),['capes115','qa-capes115.cjs'],['privacy-categories115','qa-privacy-categories115.cjs']];
    const knownModules=new Set([...modules.map(([id])=>id),'ux110','motion119','native-trace','native-recorder','native-video','native-compositor','feedback-scale','mac-parity']);
    if(selectedModule&&!knownModules.has(selectedModule))throw Error('Unknown required UI module: '+selectedModule);
    if(selectedModule==='privacy-categories115')assert(privacyOwned,'Run qa-privacy-categories115.cjs to own the two-process disposable profile');
    for(const [id,file] of modules){
      if((!selectedModule||selectedModule===id)&&(id!=='privacy-categories115'||privacyOwned)){
        await require('./'+file)({...harness,screenshot:name=>harness.screenshot(name.startsWith('extension-')?name:'extension-118-'+name)});
        // Full header module returns only after restoring its recorder/audio graph
        // and draw hooks. Compare the untouched native graph in this same window.
        if(capabilities.singleLogo&&id==='header'){
          await require('./verify-kamu-motion-diagnostic-119.cjs')({...harness,motionDiagnosticInvocation:'after-header'});
          if(process.platform==='darwin'){
            await require('./verify-kamu-native-recorder-119.cjs')(harness);
            // Independent native pixels remain separate from the unchanged CDP
            // benchmark. A capture-tool failure is recorded and never called a
            // passing native-video acceptance or allowed to hide later core QA.
            try{await require('./verify-kamu-native-video-119.cjs')(harness)}catch(error){console.error('INDEPENDENT NATIVE VIDEO FAILED (normal CDP/core results remain separate):',String(error))}
            if(process.env.KAMUCL_NATIVE_COMPOSITOR_ABA119==='1')await require('./verify-kamu-native-compositor-119.cjs')(harness);
          }
        }
      }
    }
  }
  // Return the diagnostic response before destroying its renderer. Completion
  // still requires the actual owned process to exit cleanly; a lost CDP reply
  // from immediate destruction must not be mistaken for a failed close.
  const closeApp=async()=>{if(process.platform==='darwin')await main(MAC_QUIT_INSPECTION);mainWs.close();await wait(100);if(process.platform!=='darwin')await evaluate("setTimeout(()=>window.kamucl.send('window:close'),100); true");for(let i=0;i<100&&child.exitCode===null;i++)await wait(100);assert.equal(child.exitCode,0)};
  if(process.env.KAMUCL_EXTENSION_ONLY){await closeApp();return}
  // Reset renderer caches populated by extension fixtures before the original regression.
  if(process.env.KAMUCL_EXTENSION_GUI)await reloadThemeReady('after-extensions')
  const issues=[];const checkLayout=async name=>{
    const result=await evaluate('(()=>{const c=document.querySelector(".content");return {width:innerWidth,scroll:c.scrollWidth,client:c.clientWidth,over:[...c.querySelectorAll("button,input,select,h1,h3,.fm-row,.result-card")].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().right>innerWidth+3).map(e=>e.className).slice(0,8)}})()');
    if(result.scroll>result.client+3||result.over.length)issues.push({name,...result});
  };
  await main("globalThis.testElectron=process.mainModule.require('electron');testElectron.BrowserWindow.getAllWindows()[0].setSize(1440,960)");
  // Deterministic IPC responses exist only in this isolated test process, never in shipped code.
  await main("globalThis.searchDelay=0;globalThis.searchFail=false;testElectron.ipcMain.removeHandler('community:search');testElectron.ipcMain.handle('community:search',async(_e,q)=>{await new Promise(r=>setTimeout(r,q.keyword==='slow'?700:searchDelay));if(searchFail||q.keyword==='failure')throw Error('验证：连接暂不可用');return {items:q.keyword==='empty'?[]:Array.from({length:8},(_,i)=>({projectId:'test'+i,source:'modrinth',title:(q.keyword||'模组资源')+' · 长名称资源 '+i,description:'用于检验布局与并发响应的隔离测试数据',downloads:4567,updatedAt:'2026-09-21',author:'布局测试',slug:'test',iconUrl:''})),total:q.keyword==='empty'?0:8,warnings:[]}})");
  // 1.1.2: installed entry ignores legacy download-tab preference; cached catalogs survive remounts.
  await main("globalThis.catalogCalls=0;globalThis.catalogDelay=0;testElectron.ipcMain.removeHandler('versions:catalog');testElectron.ipcMain.handle('versions:catalog',async()=>{catalogCalls++;await new Promise(r=>setTimeout(r,catalogDelay));return {versions:[{id:'26.3',type:'release',url:'https://example.test/26.3.json',releaseTime:'2026-09-15T11:23:00Z'}],checkedAt:Date.now(),stale:false}})");
  await evaluate("localStorage.setItem('kamucl.gameTab','download')");await nav('game');
  assert(await evaluate('document.querySelector("[data-tab=installed]").classList.contains("active")'),'entry should be installed');assert.equal(await main('catalogCalls'),0,'installed entry must not fetch remote metadata');
  await click('[data-tab=download]');await wait(250);assert.equal(await main('catalogCalls'),1);await nav('home');await nav('game');await click('[data-tab=download]');await wait(250);assert.equal(await main('catalogCalls'),1,'reuse catalog on revisit');
  await main('catalogDelay=800');await click('.tool-refresh');await wait(100);assert((await evaluate('document.querySelector(".latest-release").innerText')).includes('26.3'),'refresh keeps content');await wait(850);
  await evaluate('document.querySelector(".tool-search input").focus()');await screenshot('download-focus');
  // Native disclosure animates size/opacity on opening AND closing; no scripted toggle delays.
  await nav('settings');await evaluate(`[...document.querySelectorAll('.settings-scopes button')].find(e=>e.textContent==='启动器设置').click()`);await wait(100);await evaluate(`[...document.querySelectorAll('.settings-categories button')].find(e=>e.textContent==='外观').click()`);await wait(100);await evaluate('document.querySelector("details[data-section=theme]").open=false');await wait(300);
  const disclosureSample=()=>evaluate(`(async()=>{const e=document.querySelector('details[data-section=theme]');getComputedStyle(e,'::details-content').opacity;e.querySelector('summary').click();const samples=[];for(let i=0;i<20;i++){await new Promise(r=>requestAnimationFrame(r));const opacity=Number(getComputedStyle(e,'::details-content').opacity);samples.push(opacity);if(opacity>0&&opacity<1)return {opacity,samples,open:e.open}}return {opacity:samples.at(-1),samples,open:e.open,visible:!!e.getClientRects().length,motion:document.documentElement.dataset.motion}})()`);
  const opening=await disclosureSample();assert(opening.opacity>0&&opening.opacity<1,'disclosure opening intermediate opacity: '+JSON.stringify(opening));await wait(300);
  const closing=await disclosureSample();assert(closing.opacity>0&&closing.opacity<1,'disclosure closing intermediate opacity: '+JSON.stringify(closing));await wait(300);
  await nav('mods');await click('.select-menu-btn');await wait(35);assert(await evaluate('Number(getComputedStyle(document.querySelector(".select-menu-float")).opacity)<1'),'dropdown enters gradually');await wait(220);await screenshot('dropdown-open');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await wait(240);assert(!await evaluate('!!document.querySelector(".select-menu-float")'));assert(await evaluate('document.activeElement.classList.contains("select-menu-btn")'),'dropdown restores keyboard focus');
  await nav('friends');await click('.pick-card');await wait(35);assert(await evaluate('Number(getComputedStyle(document.querySelector(".connect-stage.subpage-enter-active")).opacity)<1'),'method page entry animates');await wait(230);await screenshot('method-entry');await click('.method-header .btn');await wait(230);
  for(const id of ['home','game','mods','packs','shaders','recordings','bridge','servers','friends','keys','skins','community','settings']){
    await nav(id);if(id==='game')await click('[data-tab=installed]');await screenshot(id+'-wide');await checkLayout(id+'-wide');
  }

  // Verify real scans across both bound roots without changing the active game folder.
  for(const [folder,name] of [[games,'第一目录录像'],[other,'第二目录录像']]) { const dir=path.join(folder,'replay_recordings');fs.mkdirSync(dir,{recursive:true});const zip=new(require('adm-zip'))();zip.addFile('metaData.json',Buffer.from('{}'));zip.addFile('recording.tmcpr',Buffer.from('isolated-validation'));zip.writeZip(path.join(dir,name+'.mcpr')); }
  await nav('recordings');await click('.recording-heading .actions button:last-child');await wait(500);assert.equal(await evaluate('document.querySelectorAll(".recording-row").length'),2,'recordings across both roots');await screenshot('recordings-populated');
  await nav('mods');await wait(200);await click('[aria-label="选择当前页模组"]');assert.equal(await evaluate('document.querySelectorAll(".fm-row>input:checked").length'),3);await click('.fm-row>input');assert(await evaluate('document.querySelector("[aria-label=选择当前页模组]").indeterminate'));assert.equal(await evaluate('document.querySelectorAll(".fm-toggle input:checked").length'),3,'selection must not disable mods');await click('[aria-label="选择当前页模组"]');await click('[aria-label="选择当前页模组"]');
  await main("globalThis.bridgeFixture='unknown';for(const [channel,fn] of [['bridge:installed',()=>{if(bridgeFixture==='unknown')throw Error('isolated read failure');return true}],['bridge:status',()=>({connected:false,reason:'游戏尚未接入'})]]){testElectron.ipcMain.removeHandler(channel);testElectron.ipcMain.handle(channel,fn)}");await nav('bridge');await wait(200);assert((await evaluate('document.querySelector(".bridge-status").innerText')).includes('尚未确认'));assert(!await evaluate('[...document.querySelectorAll(".bridge-page button")].some(e=>e.textContent.includes("安装桥接 MOD"))'));await screenshot('bridge-unknown');await main("bridgeFixture='installed'");await click('.bridge-context button');await wait(200);assert((await evaluate('document.querySelector(".bridge-status").innerText')).includes('启动游戏后自动接入'));await screenshot('bridge-installed');

  // Connection states are simulated only in this throwaway process: no real room or credentials.
  const connections=async()=>{
    await main("globalThis.tcFixture={phase:'idle',binaryReady:false,running:false,toolVersion:'0.4.2',binaryPath:'C:/isolated/Terracotta.exe'};testElectron.ipcMain.removeHandler('tc:status');testElectron.ipcMain.handle('tc:status',()=>tcFixture);globalThis.frpFixture=Array.from({length:3},(_,i)=>({id:'ui-'+i,name:i?'好友世界 '+i:'很长的隧道名称 · 建筑与生存世界',nodeName:'测试节点',localIp:'127.0.0.1',remoteAddress:i?'':'example.test:25565',status:i?'stopped':'running',desired:i===0,message:i?'尚未启动':'已连接 example.test:25565',config:{tunnelId:100+i,localPort:25565+i},logs:[]}));for(const [name,fn] of [['frp:status',()=>({accessKey:'isolated-fixture',tunnels:frpFixture})],['frp:nodes',()=>({nodes:[],tunnels:frpFixture.map(t=>({id:t.config.tunnelId,name:t.name,type:'tcp',localIp:t.localIp,localPort:t.config.localPort,remotePort:25565,nodeName:'测试节点',online:true}))})]]){testElectron.ipcMain.removeHandler(name);testElectron.ipcMain.handle(name,fn)}");
    await nav('friends');await click('.pick-card');await wait(200);for(let i=0;i<30;i++){if(await evaluate('!!document.querySelector(".frp-account-row .btn:not(:disabled)")'))break;await wait(100)}await click('.frp-account-row .btn');await wait(700);await screenshot('frp-before-assert');assert(await evaluate('!!document.querySelector(".frp-account-summary")'),await evaluate('document.querySelector(".friend-connect-page").innerText'));await screenshot('frp-configured');await checkLayout('frp-configured');assert.equal(await evaluate('document.querySelectorAll(".frp-tunnel-card").length'),3);
    await click('.method-header .btn');await evaluate('document.querySelectorAll(".pick-card")[1].click()');await wait(350);await screenshot('voxlink-entry');await checkLayout('voxlink-entry');assert(await evaluate('!!document.querySelector(".host-form")'));
    await click('.method-header .btn');await evaluate('document.querySelectorAll(".pick-card")[2].click()');await wait(200);await screenshot('terracotta-missing');await checkLayout('terracotta-missing');
    await main("tcFixture={phase:'ready',room:'U/AAAA-BBBB-CCCC-DDDD',url:'127.0.0.1:25565',binaryReady:true,running:true,toolVersion:'0.4.2',binaryPath:'C:/isolated/Terracotta.exe'};testElectron.BrowserWindow.getAllWindows()[0].webContents.send('tc:event',{type:'status',data:tcFixture})");await wait(100);assert.equal(await evaluate('document.querySelectorAll(".room-card").length'),0,'guest must not show host controls');assert((await evaluate('document.querySelector(".mc-address").innerText')).includes('127.0.0.1:25565'));await screenshot('terracotta-guest');
    await main("tcFixture={phase:'ready',room:'U/AAAA-BBBB-CCCC-DDDD',binaryReady:true,running:true,toolVersion:'0.4.2'};testElectron.BrowserWindow.getAllWindows()[0].webContents.send('tc:event',{type:'status',data:tcFixture})");await wait(100);assert(await evaluate('!!document.querySelector(".room-card")'));assert((await evaluate('document.querySelector(".tc-page").innerText')).includes('房间已就绪'));await screenshot('terracotta-host');
    for(const [w,h,z] of [[960,620,1],[1280,900,1.25],[1440,960,1.5]]){
      await main('testElectron.BrowserWindow.getAllWindows()[0].setSize('+w+','+h+');testElectron.BrowserWindow.getAllWindows()[0].webContents.setZoomFactor('+z+')');
      await checkLayout('terracotta-'+w+'-'+z);await screenshot('terracotta-'+w+'-'+z);await click('.method-header .btn');await evaluate('document.querySelectorAll(".pick-card")[1].click()');await wait(100);await checkLayout('voxlink-'+w+'-'+z);await screenshot('voxlink-'+w+'-'+z);await click('.method-header .btn');await click('.pick-card');await wait(100);await click('.frp-account-row .btn');await wait(100);await checkLayout('frp-'+w+'-'+z);await screenshot('frp-'+w+'-'+z);await click('.method-header .btn');await evaluate('document.querySelectorAll(".pick-card")[2].click()');await wait(100);
    }
    await main('testElectron.BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1);testElectron.BrowserWindow.getAllWindows()[0].setSize(1440,960)');
    // Four genuine cape-shaped textures in the isolated fixture, without an account request.
    await main("testElectron.ipcMain.removeHandler('skin:profile');testElectron.ipcMain.handle('skin:profile',()=>({username:uiAccount.username,skins:[{id:'fixture',variant:'classic',dataUrl:uiSkin,url:''}],capes:Array.from({length:4},(_,i)=>({id:'cape-'+i,alias:'测试披风 '+i,name:'长名称披风展示测试 '+i,active:i===0,dataUrl:uiSkin,url:''}))}))");await nav('skins');await wait(300);await screenshot('skins-four-capes');await checkLayout('skins-four-capes');
  };
  await connections();

  await nav('settings');
  // Two scopes expose only their own categories; ordinary items stay compact.
  const settingsScopeEvidence=[]
  const settingsCoordinateClick=async(group,label)=>{
    let state
    for(let i=0;i<50;i++){
      state=await evaluate(`(${readSettingsCoordinate.toString()})(${JSON.stringify(group)},${JSON.stringify(label)})`)
      if(settingsCoordinateReady(state)){
        await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:state.x,y:state.y})
        await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:state.x,y:state.y})
        settingsScopeEvidence.push({operation:'actual coordinate click',group,label,state});return
      }
      await wait(80)
    }
    throw Error('Actual settings coordinate did not become ready: '+JSON.stringify({group,label,state}))
  }
  const settingsScopeCheck=async(expected,name)=>{
    const state=await evaluate(`(${readSettingsScopeState.toString()})()`)
    settingsScopeEvidence.push({operation:'actual scope observation',expected,state})
    fs.writeFileSync(path.join(shotDir,name+'.json'),JSON.stringify({classification:'Actual owned UI coordinate operations and section visibility; no product relocation or synthetic settings response',operations:settingsScopeEvidence},null,2))
    await screenshot(name);assertSettingsScopeState(state,expected)
    if(expected==='game')assert.equal(state.isolation.checked,true,'fixture default isolation remains enabled')
    else assert.equal(fs.realpathSync.native(state.download.value),fs.realpathSync.native(games),'visible download location retains the actual default root')
  }
  await settingsCoordinateClick('.settings-scopes','游戏设置');await wait(160);
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".settings-categories button")].map(e=>e.textContent)'),['运行环境','游戏窗口','目录与隔离']);await screenshot('settings-game-runtime');await checkLayout('settings-game-runtime');
  assert(await evaluate('[...document.querySelectorAll(".runtime-grid>[data-section]")].every(e=>e.getBoundingClientRect().height<350)'),'runtime defaults must stay compact');
  await settingsCoordinateClick('.settings-categories','目录与隔离');await wait(160);await settingsScopeCheck('game','settings-game-directories');
  await settingsCoordinateClick('.settings-scopes','启动器设置');await wait(160);
  assert(await evaluate('[...document.querySelectorAll(".settings-categories button")].some(e=>e.textContent==="行为与登录")'));
  assert(!await evaluate('document.querySelector("[data-section=memory]").getClientRects().length'));
  await screenshot('settings-launcher-compact');
  await settingsCoordinateClick('.settings-categories','下载');await wait(160);await settingsScopeCheck('launcher','settings-launcher-downloads');
  // Every indexed setting must lead to its actual, visible control group.
  const index=require('fs').readFileSync('src/shared/settingsCatalog.ts','utf8');
  const settingIds=[...index.matchAll(/id: '([^']+)', category: '[^']+', name: '([^']+)'/g)];
  for(const [,id,name] of settingIds){await type('.settings-search input',name);await wait(50);await evaluate('[...document.querySelectorAll(".settings-search-results button")].find(e=>e.textContent.includes('+JSON.stringify(name)+')).click()');await wait(50);assert(await evaluate('!!document.querySelector('+JSON.stringify('[data-section='+id+']')+')?.getClientRects().length'),'setting target '+id);assert(await evaluate('document.activeElement.dataset.section==='+JSON.stringify(id)),'setting focus '+id)}
  await type('.settings-search input','动画');await screenshot('settings-search');await click('.settings-search-results button');await screenshot('settings-motion');
  await click('[aria-label="减少动态效果"]');await wait(200);assert.equal(await evaluate('document.documentElement.dataset.motion'),'reduced');
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await click('[aria-label="减少动态效果"]');await wait(200);assert.equal(await evaluate('document.documentElement.dataset.motion'),'reduced');
  await call('Emulation.setEmulatedMedia',{features:[]});await wait(150);assert.equal(await evaluate('document.documentElement.dataset.motion'),'full');
  const stored=JSON.parse(fs.readFileSync(path.join(profile,'settings.json')));assert.equal(stored.reduceMotion,false);assert.equal(stored.defaultIsolation,true);
  await nav('community');await wait(200);
  const keyword=await evaluate('[...document.querySelectorAll(".community-page input,input")].find(e=>/关键|搜索/.test(e.placeholder||""))?.outerHTML');
  fs.writeFileSync(path.join(root,'keyword.txt'),String(keyword));
  const search=async value=>{await type('input[placeholder="输入资源名称，回车搜索…"]',value);await evaluate('document.querySelector('+JSON.stringify('input[placeholder="输入资源名称，回车搜索…"]')+').dispatchEvent(new KeyboardEvent("keyup",{key:"Enter",bubbles:true}))')};
  await search('slow');await wait(60);assert(await evaluate('!!document.querySelector(".result-list[inert]")'),'stale results disabled');await screenshot('community-refresh');await search('newest');await wait(100);assert((await evaluate('document.querySelector(".result-list").innerText')).includes('newest'));await wait(850);assert(!(await evaluate('document.querySelector(".result-list").innerText')).includes('slow'),'late request must not win');
  await search('failure');await wait(100);assert(await evaluate('!!document.querySelector(".result-list[inert]")'),'failed refresh remains non-interactive');await screenshot('community-error');await search('empty');await wait(100);assert((await evaluate('document.body.innerText')).includes('没有找到匹配'));await screenshot('community-empty');await search('恢复');await wait(100);assert(!await evaluate('!!document.querySelector(".result-list[inert]")'));
  await nav('mods');await wait(500);assert.equal(await evaluate('document.querySelectorAll(".fm-row").length'),3);assert(!await evaluate('!!document.querySelector(".fm-pagination")'));await click('.fm-row .file-more summary');await screenshot('mods-menu');await evaluate('document.querySelector(".fm-row .file-more-actions .fm-remove").click()');await wait(50);assert(await evaluate('document.querySelector(".modal").contains(document.activeElement)'),'dialog focus');await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait(50);assert(!await evaluate('!!document.querySelector(".modal-mask")'));
  await nav('home');await main('testElectron.BrowserWindow.getAllWindows()[0].webContents.send("event:launchState",{status:"running",versionId:"联机验证实例",folder:'+JSON.stringify(games)+'})');await wait(150);assert((await evaluate('document.body.innerText')).includes('再次启动'));await screenshot('home-running');await main('testElectron.BrowserWindow.getAllWindows()[0].webContents.send("event:launchState",{status:"idle"})');await evaluate('document.querySelector(".creator-card").dispatchEvent(new PointerEvent("pointerenter"))');await wait(350);assert(await evaluate('!!document.querySelector(".creator-intro").getClientRects().length && !document.querySelector("details.creator-message")'));await screenshot('creators-confined');assert(await evaluate('(()=>{const a=document.querySelector(".creator-card").getBoundingClientRect(),b=document.querySelector(".creator-name-layer").getBoundingClientRect();return b.left>=a.left&&b.right<=a.right&&b.bottom<=a.bottom})()'));
  await evaluate('document.querySelector(".creator-card").dispatchEvent(new PointerEvent("pointerleave"))');await wait(280);assert(await evaluate('document.querySelector(".creator-reveal").getBoundingClientRect().height<1'),'creator names fold on leave');assert(await evaluate('!!document.querySelector(".creator-intro").getClientRects().length'),'creator message never folds');
  // Rapid route replacement must show the final selection without a queued leave animation.
  await evaluate('["game","home","settings","friends","game"].forEach(id=>document.querySelector("[data-nav="+id+"]").click())');await wait(100);assert(await evaluate('!!document.querySelector(".page[data-design-page]")'));
  for(const [width,height,zoom] of [[960,620,1],[1280,900,1.25],[1440,960,1.5],[980,720,1.5]]){
    await main('testElectron.BrowserWindow.getAllWindows()[0].setSize('+width+','+height+');testElectron.BrowserWindow.getAllWindows()[0].webContents.setZoomFactor('+zoom+')');
    for(const id of ['home','game','mods','skins','community','settings','servers','friends','keys','recordings','bridge','packs','shaders']){await nav(id);await checkLayout(id+'-'+width+'-'+zoom);if(['home','mods','settings','community'].includes(id))await screenshot(id+'-'+width+'-'+zoom)}
  }
  await main('testElectron.BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1);testElectron.BrowserWindow.getAllWindows()[0].maximize()');await nav('home');await screenshot('home-maximized');await checkLayout('home-maximized');
  await main('testElectron.BrowserWindow.getAllWindows()[0].unmaximize();testElectron.BrowserWindow.getAllWindows()[0].setSize(960,620)');await nav('settings');
  // Category changes restore their own scroll position without changing settings.
  await evaluate('[...document.querySelectorAll(".settings-categories button")].find(e=>e.textContent==="外观").click()');await wait(100);await evaluate('document.querySelectorAll(".layout-setting").forEach(e=>e.open=true)');await wait(280);await evaluate('document.querySelector(".settings-body").scrollTop=300');const rememberedScroll=await evaluate('document.querySelector(".settings-body").scrollTop');assert(rememberedScroll>0);
  await evaluate('[...document.querySelectorAll(".settings-categories button")].find(e=>e.textContent==="下载").click()');await wait(100);await evaluate('[...document.querySelectorAll(".settings-categories button")].find(e=>e.textContent==="外观").click()');await wait(100);assert(Math.abs(await evaluate('document.querySelector(".settings-body").scrollTop')-rememberedScroll)<=2,'scroll restore within device-pixel rounding');
  assert.equal(issues.length,0,JSON.stringify(issues));
  const result={version,complete:true,exeSHA256:process.env.KAMUCL_GUI_DEV?null:require('crypto').createHash('sha256').update(fs.readFileSync(exe)).digest('hex'),catalogReentry:true,disclosureBothDirections:true,dropdownMotion:true,methodEntryMotion:true,settingsScopes:true,compactRuntime:true,settingsScrollRestored:true,asyncLatestWins:true,errorRetry:true,emptySearch:true,modalKeyboard:true,runningState:true,confinedAnimation:true,root,shotDir,issues,settingsTargets:settingIds.length,reducedMotion:true,legacyConfig:true,rapidNavigation:true,themes:process.env.KAMUCL_TEST_THEME||'black-orange',windows:[[960,620,1],[1280,900,1.25],[1440,960,1.5],[980,720,1.5],'maximized']};fs.writeFileSync('out/ui-refinement-'+result.themes+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  if(process.env.KAMUCL_UI_HOLD){fs.writeFileSync('out/ui-hold.ready','ready');while(!fs.existsSync('out/ui-hold.done'))await wait(500)}
  await closeApp();
 }catch(error){operationError=error;
  if(process.platform==='linux')await require('./qa-linux-graphics-failure.cjs').preserveLinuxFailure(error,{
    outputFile:path.join('out','linux-gpu-failure-'+randomUUID()+'.json'),
    mainInspectorUrl:`http://127.0.0.1:${mainPort}/json`,browserDebugPort:port,rendererDebuggerURL:diagnosticRendererURL,
    ownedChild:ownedTrack.child,expectedPid:ownedTrack.pid,expectedArch:process.arch,expectedExecutable:exe,
    display:{DISPLAY:env.DISPLAY,XDG_SESSION_TYPE:env.XDG_SESSION_TYPE,WAYLAND_DISPLAY:env.WAYLAND_DISPLAY},
    originalConsoleErrors:originalConsoleErrors.slice(),
    onEvidence:evidence=>{console.error('LINUX READ-ONLY GPU DIAGNOSTIC:',JSON.stringify({complete:evidence.complete,ownedIdentityVerified:evidence.ownedIdentityVerified,diagnosticErrors:evidence.diagnosticErrors,saveError:evidence.saveError,unexpectedDiagnosticError:evidence.unexpectedDiagnosticError}))}
  });
  throw error}
 finally{await ownedQA.preservingCleanup(async()=>{if(operationError)throw operationError},async()=>{
  let closeError
  try{if(mainWs?.readyState===WebSocket.OPEN)mainWs.close();if(ws?.readyState===WebSocket.OPEN){ws.send(JSON.stringify({id:999999,method:'Browser.close'}));await wait(1000);ws.close()}await ownedQA.finishOwnedChild(ownedTrack,{terminate:true,timeoutMs:5000})}
  catch(error){closeError=error;ownedProcessProof.failure=error.name}
  finally{const signals=restoreOwnedCancellation?.()??{observerRemoved:true,originalListenersPreserved:true};ownedProcessProof.signalObserverRemoved=signals.observerRemoved;ownedProcessProof.originalSignalListenersPreserved=signals.originalListenersPreserved;ownedProcessProof.after=await ownedQA.ownedInventory([ownedTrack],ownedProcessProof.before.rows?.map(r=>r.pid));ownedProcessProof.complete=!closeError&&signals.observerRemoved&&signals.originalListenersPreserved;fs.closeSync(log);fs.writeFileSync(path.join('out','qa-owned-process-119-'+randomUUID()+'.json'),JSON.stringify(ownedProcessProof,null,2));if(!ownedProcessProof.complete&&!closeError)closeError=Error('owned SIGTERM observer must restore exact original listener identities')}
  if(closeError)throw closeError
 })}
})().catch(e=>{console.error(e);process.exitCode=1});
}
