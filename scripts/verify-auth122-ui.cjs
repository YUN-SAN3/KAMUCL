// Production renderer/coordinate inputs with explicit synthetic IPC. No real login or profile.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),os=require('node:os')
const {app,BrowserWindow,ipcMain,session}=require('electron'),{buildSync}=require('esbuild')
const {configureGraphics,observeGraphics,validateGraphics}=require('./qa-fixture-ui121.cjs')
const version=require('../package.json').version;assert.equal(version,'1.1.22')
const root=fs.mkdtempSync(path.resolve('out/auth122-ui-')),renderer=path.join(root,'renderer'),profile=path.join(root,'profile')
fs.cpSync(path.resolve(process.env.KAMUCL_REVIEW_RENDERER_DIR||'out/renderer'),renderer,{recursive:true});app.setPath('userData',profile)
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),graphics=configureGraphics(app),errors=[]
const proof={version,complete:false,classification:'Real production renderer in an isolated Electron profile; offscreen supported graphics, synthetic neutral desktop underlay and Chromium coordinates; synthetic IPC. Does not verify native DWM/vibrancy, Microsoft authorization or real game',startedAt:new Date().toISOString(),runtime:{platform:process.platform,arch:process.arch,electron:process.versions.electron,node:process.versions.node,osRelease:os.release()},graphics,sourceFiles:['scripts/verify-auth122-ui.cjs','scripts/qa-fixture-ui121.cjs','src/renderer/src/views/AccountsView.vue','src/renderer/src/views/SettingsView.vue','src/renderer/src/components/connection/FrpPanel.vue','src/renderer/src/api.ts','src/shared/types.ts'].map(file=>({file,sha256:sha(file)})),calls:[],images:[],matrix:[],checks:[],errors}
const save=()=>fs.writeFileSync(path.join(root,'proof.json'),JSON.stringify(proof,null,2)+'\n'),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const bundle=path.join(root,'types.cjs');buildSync({entryPoints:['src/shared/types.ts'],bundle:true,platform:'node',format:'cjs',outfile:bundle});const types=require(bundle)
const folder=path.join(root,'games'),legacy={id:'legacy-fixture',type:'microsoft',username:'AuditTest',uuid:'11111111-1111-1111-1111-111111111111',msReauthRequired:true,msReauthReason:'identity-unknown'},offline={id:'offline-fixture',type:'offline',username:'OfflineTest',uuid:'22222222-2222-2222-2222-222222222222'},external={id:'external-fixture',type:'yggdrasil',username:'ExternalTest',uuid:'33333333-3333-3333-3333-333333333333',providerId:'fixture-provider',providerName:'Synthetic provider'}
let rows=[legacy,offline,external],selected=legacy,phase='service-rejected',win,statusFailure,operation=0,keyFailure=false,frpFailure=false,clearFailure=false,accountListFailure=false
const tunnel={id:'fixture-tunnel',name:'Synthetic tunnel',nodeName:'Synthetic node',localIp:'127.0.0.1',desired:false,busy:false,status:'idle',config:{tunnelId:'1',localPort:25565},remoteAddress:null,pid:null,startedAt:null,message:'尚未启动',logs:[],credentialLocked:false}
let frpConfigured=true,frpLocked=false
const frpStatus=()=>({configured:frpConfigured,locked:frpLocked,notice:frpLocked?(frpConfigured?'系统安全存储未解锁；原记录已保留。':'本机密钥已清除；系统安全存储仍不可用，请解锁后保存新密钥。隧道记录已保留。'):'',tunnels:[{...tunnel,credentialLocked:frpLocked||!frpConfigured}]})
let settings={gameDir:folder,activeFolder:folder,folders:[{path:folder,name:'隔离测试目录',isDefault:true}],javaPath:'',javaAuto:true,javaCustom:[],javaHidden:[],memoryMB:4096,memoryAuto:true,jvmArgs:'',resolution:{width:854,height:480,mode:'windowed'},mirror:'bmclapi',theme:'blue-white',custom:structuredClone(types.DEFAULT_CUSTOM_THEME),disabledFeatures:[],favoriteVersions:[],homeLayout:structuredClone(types.DEFAULT_HOME_LAYOUT),background:structuredClone(types.DEFAULT_BACKGROUND),launchThumbnail:structuredClone(types.DEFAULT_LAUNCH_THUMBNAIL),configVersion:3,modsFavorites:[],updateAutoCheck:false,msClientId:types.DEFAULT_MS_CLIENT_ID}
settings.custom.colors={accent:'#059669',bg:'#f1f5f0',card:'#ffffff',text:'#18342c',textDim:'#627b72',border:'#c9d7cf',sidebarBg:'#e5eee8',sidebarText:'#18342c',bannerText:'#ffffff'}
ipcMain.handle('review:invoke',async(_e,channel,...args)=>{
  proof.calls.push({channel,at:Date.now()});save()
  switch(channel){
    case 'settings:get':return settings
    case 'settings:set':{if(keyFailure&&typeof args[0]?.curseforgeApiKey==='string')throw Error('Synthetic secure-storage write failure');const patch={...args[0]};if(typeof patch.curseforgeApiKey==='string'){patch.curseforgeApiKeyConfigured=!!patch.curseforgeApiKey;delete patch.curseforgeApiKey;}return settings={...settings,...patch}}
    case 'accounts:list':{if(accountListFailure)throw Error('Synthetic account list failure');return rows}
    case 'accounts:selected':return selected
    case 'accounts:select':return selected=rows.find(row=>row.id===args[0])||selected
    case 'accounts:msStatus':return{clientId:types.DEFAULT_MS_CLIENT_ID,applicationName:'KAMUCL',authority:'https://login.microsoftonline.com/consumers/oauth2/v2.0',scopes:'XboxLive.signin offline_access',serviceValidation:'unverified',reauthenticationRequiredAccounts:rows.filter(row=>row.msReauthRequired).length,...(statusFailure?{lastFailure:statusFailure}:{})}
    case 'accounts:msBegin':{
      if(phase==='service-rejected'){statusFailure={code:'APPLICATION_REJECTED',stage:'获取设备码',httpStatus:401,message:'获取设备码：[APPLICATION_REJECTED] KAMUCL 应用配置或服务许可未通过验证。'};throw Error(statusFailure.message)}
      if(phase==='late-device-code')await wait(1000)
      statusFailure=undefined;const info={operationId:'fixture-operation-'+(++operation),userCode:'KAMU-TEST',verificationUri:'https://microsoft.com/devicelogin',message:'Synthetic authorization fixture'};if(phase==='early-done'){win.webContents.send('event:msLoginDone',{operationId:info.operationId,account:rows[0]});await wait(150)}return info
    }
    case 'accounts:msCancel':return
    case 'accounts:addOffline':{const row={...offline,id:'added-fixture',username:String(args[0])};rows=[...rows,row];return row}
    case 'accounts:yggProviders':return[{id:'fixture-provider',name:'Synthetic provider',apiRoot:'https://auth.fixture.invalid/api/yggdrasil',skinDomains:[],insecure:false}]
    case 'frp:status':return frpStatus()
    case 'frp:nodes':{assert.equal(typeof args[0]?.accessKey,'string');if(frpFailure)throw Error('Synthetic key verification failed');frpConfigured=true;return{nodes:[],tunnels:[]}}
    case 'frp:clear-credentials':{assert.equal(args[0]?.confirmed,true);if(clearFailure)throw Error('Synthetic secure-store clear failed');frpConfigured=false;return frpStatus()}
    case 'versions:installed':return[]
    case 'versions:manifest':return[]
    case 'folders:list':return{folders:settings.folders,active:folder}
    case 'skin:profile':return{skins:[],capes:[]}
    case 'skin:avatar':case 'update:getPending':case 'update:getState':return null
    case 'app:systemInfo':return{totalMemMB:16384,freeMemMB:8192,platform:process.platform,credentialStorage:{persistent:true,sessionOnly:false,message:''}}
    case 'clipboard:write':case 'app:copyText':return true
    default:return[]
  }
})
fs.writeFileSync(path.join(root,'preload.cjs'),`const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('kamucl',{platform:process.platform,invoke:(c,...a)=>ipcRenderer.invoke('review:invoke',c,...a),on:(c,fn)=>{const h=(_,p)=>fn(p);ipcRenderer.on(c,h);return()=>ipcRenderer.removeListener(c,h)},send:()=>{},getFilePath:()=>''});`)
app.whenReady().then(async()=>{
 try{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,done)=>done({cancel:true}))
  win=new BrowserWindow({show:false,frame:false,width:1366,height:768,webPreferences:{preload:path.join(root,'preload.cjs'),offscreen:true,backgroundThrottling:false}})
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(String(message))})
  const run=async code=>{const result=await win.webContents.executeJavaScript('(async()=>{try{return await ('+code+')}catch(error){return {__auth122Failure:String(error.message||error)}}})()');if(result?.__auth122Failure)throw Error(result.__auth122Failure);return result},ready=async(code)=>{for(let i=0;i<80;i++){if(await run(code))return;await wait(75)}throw Error('Readiness failed: '+code)}
  let zoom=1
  const click=async(selector)=>{
   const point=await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Unavailable '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);if(h!==e&&!e.contains(h))throw Error('Blocked '+${JSON.stringify(selector)});if(x<0||y<0||x>=innerWidth||y>=innerHeight)throw Error('Outside viewport');return{x,y}})()`)
   const p={x:Math.round(point.x*zoom),y:Math.round(point.y*zoom)}
   for(const type of ['mouseMove','mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...p,...(type==='mouseMove'?{}:{button:'left',clickCount:1})})
   await wait(100)
  }
  const button=async(scope,text)=>{while(await run("!!document.querySelector('.toast-close') && !document.querySelector('.modal-mask')")){await run("(()=>{document.querySelector('.toast-close').id='auth122-toast-dismiss'})()");await click('#auth122-toast-dismiss');await ready("!document.querySelector('#auth122-toast-dismiss')");}await run(`(()=>{document.querySelector('#auth122-button')?.removeAttribute('id');const e=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing button '+${JSON.stringify(text)});e.id='auth122-button'})()`);await click('#auth122-button')}
  const shot=async(name)=>{await wait(120);const file=path.join(root,name+'.png');fs.writeFileSync(file,(await win.webContents.capturePage()).toPNG());const size=win.getContentSize();proof.images.push({file:path.basename(file),bytes:fs.statSync(file).size,sha256:sha(file),contentSize:size,zoom});save()}
  proof.rendererFiles=[]
  const inventory=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())inventory(file);else proof.rendererFiles.push({file:path.relative(renderer,file).replaceAll('\\','/'),sha256:sha(file)})}};inventory(renderer)
  await win.loadFile(path.join(renderer,'index.html'));await ready("!!document.querySelector('.account-more')")
  proof.observedGraphics=await observeGraphics(app,win.webContents,graphics);validateGraphics(proof.observedGraphics)
  for(const theme of ['blue-white','black-orange','black-pink','custom'])for(const size of [[1366,768],[960,620]])for(const z of [1,1.25]){
   settings.theme=theme;win.setBackgroundColor(theme.startsWith('black-')?'#18181b':'#f3f5f7');zoom=z;win.setContentSize(...size);win.webContents.setZoomFactor(zoom)
   await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload()});await ready("!!document.querySelector('.account-more')");await click('.account-more');await ready("!!document.querySelector('[data-ui=\"AccountsView:ms-identity\"]')")
   const key=theme+'-'+size.join('x')+'-'+zoom*100
   const observation=await run("(()=>{const rows=[...document.querySelectorAll('.account-row')];return{theme:document.documentElement.dataset.theme,overflow:document.documentElement.scrollWidth>innerWidth+1,reauth:rows.filter(e=>e.textContent.includes('需要重新登录')).length,buttons:[...document.querySelectorAll('.ms-btn,.account-row button')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return{text:e.textContent.trim(),width:r.width,height:r.height,disabled:e.disabled}}),identity:document.querySelector('[data-ui=\"AccountsView:ms-identity\"]').textContent}})()")
   assert.equal(observation.overflow,false);assert.equal(observation.reauth,1);assert(observation.identity.includes('KAMUCL'));assert(observation.buttons.every(b=>b.width>0&&b.height>0))
   await shot(key+'-migration');phase='service-rejected';await button('.account-row','重新登录');await ready("document.querySelector('.ms-identity-notice').textContent.includes('APPLICATION_REJECTED')")
   assert.equal(await run("!!document.querySelector('.ms-modal')"),false);await shot(key+'-service-failure')
   phase='device-code';await click('.ms-btn');await ready("!!document.querySelector('.ms-modal')");assert.equal(await run("document.querySelector('.user-code').textContent.trim()"),'KAMU-TEST')
   await shot(key+'-device-code');await button('.ms-modal','取消登录');await ready("!document.querySelector('.ms-modal')")
   await button('.account-type-tabs','离线登录');assert(await run("!!document.querySelector('.add-input-wrap input')"));await shot(key+'-offline')
   await button('.account-type-tabs','外置 Yggdrasil 登录');await ready("!!document.querySelector('.ygg-panel')");await shot(key+'-external')
   proof.matrix.push({theme,contentSize:size,zoom,underlay:theme.startsWith('black-')?'#18181b':'#f3f5f7',observation,coordinateActions:true});save()
  }
  await button('.account-type-tabs','Microsoft 正版登录');phase='late-device-code';await click('.ms-btn');await click('.back-btn');await ready("!!document.querySelector('.account-more')");await wait(1100);assert.equal(await run("!!document.querySelector('.ms-modal')"),false)
  proof.checks.push('Cancelled component navigation rejects late device-code responses; no modal reopens')
  await click('.account-more');await ready("!!document.querySelector('.ms-btn')");phase='device-code';await click('.ms-btn');await ready("!!document.querySelector('.ms-modal')")
  const cancelledOperation='fixture-operation-'+operation
  await button('.ms-modal','取消登录');await click('.ms-btn');await ready("!!document.querySelector('.ms-modal')")
  win.webContents.send('event:msLoginDone',{operationId:cancelledOperation,account:legacy});await wait(150);assert(await run("!!document.querySelector('.ms-modal')"))
  proof.checks.push('A cancelled operation completion cannot dismiss the replacement authorization')
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await ready("!document.querySelector('.ms-modal')");assert(await run("document.activeElement?.classList.contains('ms-btn')"))
  proof.checks.push('Escape cancels authorization and restores keyboard focus to its launcher')
  await click('.ms-btn');await ready("!!document.querySelector('.ms-modal')")
  rows=rows.map(row=>row.id===legacy.id?{...row,msReauthRequired:false,msReauthReason:undefined,msOAuthClientId:types.DEFAULT_MS_CLIENT_ID}:row)
  accountListFailure=true;win.webContents.send('event:msLoginDone',{operationId:'fixture-operation-'+operation,account:rows[0]});await ready("!document.querySelector('.ms-modal') && document.querySelector('.page').textContent.includes('Synthetic account list failure')");await shot('completed-login-list-refresh-failure');accountListFailure=false;await button('.ms-identity-notice','刷新账号列表');await ready("!document.querySelector('.ms-modal') && !document.querySelector('.reauth-note')")
  proof.checks.push('A completion followed by account-list IPC failure closes the dialog, preserves prior rows, reports the controlled error and retries refresh without reauthorization')
  proof.checks.push('Synthetic success refreshes the original account row and clears its reauthorization badge')
  await shot('same-account-reauthorized')
  phase='early-done';await click('.ms-btn');await ready("!document.querySelector('.ms-modal') && !document.querySelector('.ms-btn').disabled");assert.equal(await run("!!document.querySelector('.reauth-note')"),false);await shot('matching-completion-before-device-code-response');proof.checks.push('Matching completion delivered before the device-code IPC response is buffered and applied only to that operation, with no stuck authorization dialog')
  proof.cfMatrix=[]
  for(const theme of ['blue-white','black-orange','black-pink','custom'])for(const size of [[1366,768],[960,620]])for(const z of [1,1.25]){
   settings.theme=theme;settings.curseforgeApiKeyConfigured=false;win.setBackgroundColor(theme.startsWith('black-')?'#18181b':'#f3f5f7');zoom=z;win.setContentSize(...size);win.webContents.setZoomFactor(z)
   await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload()});await ready("!!document.querySelector('[data-nav=settings]')")
   const cfKey='cf-key-'+theme+'-'+size.join('x')+'-'+z*100
  await click('[data-nav=settings]');await ready("!!document.querySelector('.settings-categories')")
  await button('.settings-categories','下载');await ready("!!document.querySelector('details.advanced-setting')")
  await click('details.advanced-setting summary');await ready("document.querySelector('details.advanced-setting').open")
  await click('[data-ui="SettingsView:bb44d7c926e9"]');win.webContents.insertText('synthetic-custom-key')
  await ready("document.querySelector('[data-ui=\"SettingsView:bb44d7c926e9\"]').value==='synthetic-custom-key'")
  keyFailure=true;await button('.cf-key-actions','保存密钥');await ready("document.querySelector('[data-ui=\"SettingsView:bb44d7c926e9\"]').value==='synthetic-custom-key' && !document.querySelector('.cf-key-actions button').disabled");assert.equal(settings.curseforgeApiKeyConfigured,false);await shot(cfKey+'-save-failure');keyFailure=false
  await button('.cf-key-actions','保存密钥');await ready("document.querySelector('[data-ui=\"SettingsView:bb44d7c926e9\"]').value==='' && document.querySelector('.cf-key-actions').textContent.includes('已配置')")
  assert.equal(await run("window.kamucl.invoke('settings:get').then(s=>s.curseforgeApiKey)"),undefined)
  await shot(cfKey+'-write-only');await button('.cf-key-actions','清除自定义密钥');await ready("document.querySelector('.cf-key-actions').textContent.includes('未配置')")
  proof.checks.push('Custom key entered through Chromium input is cleared after saving; IPC returns configured status only; explicit clear removes it')
  proof.cfMatrix.push({theme,size,zoom:z,writeOnly:true,saveFailurePreserved:true,explicitClear:true})
  }
  proof.frpMatrix=[]
  for(const theme of ['blue-white','black-orange','black-pink','custom'])for(const size of [[1366,768],[960,620]])for(const z of [1,1.25]){
   settings.theme=theme;win.setBackgroundColor(theme.startsWith('black-')?'#18181b':'#f3f5f7');zoom=z;win.setContentSize(...size);win.webContents.setZoomFactor(z);frpConfigured=true;frpLocked=false;frpFailure=false;clearFailure=false
   await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload()});await ready("!!document.querySelector('[data-nav=friends]')");await click('[data-nav=friends]');await ready("!!document.querySelector('.pick-card')");await click('.pick-card');await ready("!!document.querySelector('.frp-account-row input')")
   const key='frp-'+theme+'-'+size.join('x')+'-'+z*100
   assert.equal(await run("document.querySelector('.frp-account-row input').value"),'');await shot(key+'-configured')
   await button('.frp-account-row','读取我的隧道与节点');await ready("document.querySelector('.frp-account-summary').textContent.includes('访问密钥') && !!document.querySelector('[data-ui=\"FrpPanel:57467d5ded4a\"]')")
   await click('[data-ui="FrpPanel:57467d5ded4a"]');await ready("!!document.querySelector('.frp-account-row input')");frpFailure=true;await click('.frp-account-row input');win.webContents.insertText('synthetic-replacement')
   await button('.frp-account-row','读取我的隧道与节点');await ready("document.querySelector('.frp-page').textContent.includes('Synthetic key verification failed')");assert.equal(await run("document.querySelector('.frp-account-row input').value"),'synthetic-replacement');await shot(key+'-replacement-failure');frpFailure=false
   frpLocked=true;await click('[data-ui="FrpPanel:00eb1ec1c260"]');await ready("document.querySelector('.frp-page').textContent.includes('等待解锁')");assert(await run("document.querySelector('.frp-account-row button').disabled"));await shot(key+'-locked')
   await button('.frp-account-summary','清除本机保存的密钥');await ready("!!document.querySelector('.modal-mask')");await button('.modal','取消');await ready("!document.querySelector('.modal-mask')");assert.equal(frpConfigured,true)
   clearFailure=true;await button('.frp-account-summary','清除本机保存的密钥');await ready("!!document.querySelector('.modal-mask')");await button('.modal','清除保存的密钥');await ready("document.querySelector('.modal').textContent.includes('Synthetic secure-store clear failed')");assert.equal(frpConfigured,true);await shot(key+'-clear-failure')
   clearFailure=false;await button('.modal','清除保存的密钥');await ready("!document.querySelector('.modal-mask') && !document.querySelector('.frp-account-summary')");assert.equal(await run("document.querySelectorAll('.frp-tunnel-card').length"),1);await shot(key+'-cleared-record-preserved')
  proof.frpMatrix.push({theme,contentSize:size,zoom:z,writeOnly:true,replacementFailurePreserved:true,clearFailurePreserved:true,lockedReadDisabled:true,confirmedClearPreservesRecords:true})
  }
  proof.checks.push('FRP uses configured status without autofilling keys; replacement and clear failures preserve input/state; locked reads are disabled; confirmed clear retains tunnel cards across all 16 theme/viewport/zoom cases')
  assert(proof.calls.some(call=>call.channel==='accounts:msCancel'));assert.deepEqual(errors,[]);assert.equal(proof.matrix.length,16)
  proof.complete=true;proof.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({complete:true,root,matrix:proof.matrix.length,images:proof.images.length}));win.destroy();app.quit()
 }catch(error){proof.error=String(error.stack||error);if(win&&!win.isDestroyed()){try{fs.writeFileSync(path.join(root,'failed-state.png'),(await win.webContents.capturePage()).toPNG())}catch{}}save();console.error(error);win?.destroy();app.exit(1)}
})
