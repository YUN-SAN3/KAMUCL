// Native product UI and real services. Uses private profiles only; no handler or
// network substitution, no production setup setters and no user game processes.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const {spawn,execFileSync}=require('node:child_process'),owned=require('./qa-owned-process-119.cjs')
const observer=require('./verify-mac-parity-ui.cjs'),pkg=require('../package.json')
const macGameDiagnostic=require('./mac-owned-game-diagnostic113.cjs')
const coordinateGeometry=require('./qa-coordinate-geometry114.cjs')
const SOURCES=[{source:'modrinth',id:'Bh37bMuy',query:'Reese',title:"Reese's Sodium Options"},{source:'curseforge',id:'348521',query:'Cloth Config',title:'Cloth Config API'}]
function qaProxyTransport(raw=process.env.KAMUCL_QA_PROXY_URL){
 if(raw===undefined||raw==='')return{enabled:false,launchArgs:[],mode:'Unmodified default product transport'}
 assert.equal(typeof raw,'string');assert(raw.length<=64,'QA proxy URL is too long')
 const match=/^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(raw)
 assert(match,'QA proxy must be an HTTP 127.0.0.1 URL with an explicit port and no credentials, path, query or fragment')
 const port=Number(match[1]);assert(port>=1&&port<=65535,'QA proxy port is outside 1..65535')
 const url=new URL(raw);assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');assert(!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/')
 return{enabled:true,proxyServer:raw,launchArgs:['--proxy-server='+raw],mode:'Explicit isolated QA transport via normal Electron proxy CLI',validationPolicy:'Original public service URLs, TLS validation, hashes, handlers and acceptance assertions remain unchanged'}
}
function qaDownloadThreads(raw=process.env.KAMUCL_QA_DOWNLOAD_THREADS){
 if(raw===undefined||raw==='')return null
 assert.equal(raw,'4','This isolated single-variable QA comparison accepts only explicit 4 threads')
 return 4
}
function qaDownloadMirror(raw=process.env.KAMUCL_QA_DOWNLOAD_MIRROR){
 if(raw===undefined)return null
 assert.equal(raw,'bmclapi','The optional isolated QA mirror accepts only the literal bmclapi')
 return 'bmclapi'
}
function verifyQaMirrorSetting({before,after,calls,threads}){
 assert.equal(threads,4,'Explicit BMCLAPI QA requires the existing native four-thread Settings change first')
 assert.equal(before.mirror,'official');assert.equal(before.downloadThreads,threads)
 assert.equal(after.mirror,'bmclapi');assert.equal(after.downloadThreads,threads);assert.equal(after.downloadSpeedKBps,before.downloadSpeedKBps)
 assert.equal(calls.length,1,'exactly one original mirror Settings call required');assert.equal(calls[0].channel,'settings:set');assert.deepEqual(calls[0].arguments,[{mirror:'bmclapi'}]);assert(calls[0].completedAt>=calls[0].startedAt&&!calls[0].error)
 return true
}
async function replaceNativeNumberInput(click,call,evaluate,selector,value,platform=process.platform){
 await click(selector)
 const before=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return{focused:document.activeElement===e,value:e?.value,type:e?.type}})()`)
 assert.equal(before.focused,true);assert.equal(before.type,'number')
 for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',modifiers:platform==='darwin'?4:2,windowsVirtualKeyCode:65,...(platform==='darwin'&&type==='keyDown'?{commands:['selectAll']}:{})})
 await call('Input.insertText',{text:String(value)})
 const after=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return{focused:document.activeElement===e,value:e?.value,type:e?.type}})()`)
 assert.equal(after.focused,true);assert.equal(after.value,String(value),'native number replacement must not concatenate the original digits')
 return{before,after}
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),sha=(bytes,algorithm='sha256')=>crypto.createHash(algorithm).update(bytes).digest('hex')
async function freePort(){const s=net.createServer();await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));const p=s.address().port;await new Promise(resolve=>s.close(resolve));return p}
async function protocol(url){assert.equal(new URL(url).hostname,'127.0.0.1');const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});let serial=0;const pending=new Map();socket.addEventListener('message',e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m)});return{socket,call(method,params={},timeoutMs=30000){return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' observation timeout'))},timeoutMs);pending.set(id,m=>{clearTimeout(timer);pending.delete(id);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result)});socket.send(JSON.stringify({id,method,params}))})}}}
function installFavoriteEventObserver(){
 for(const off of window.__favorite113?.off||[])off()
 const observed={events:[],logs:[],states:[],progress:[],timeline:[],timeOrigin:performance.timeOrigin};window.__favorite113=observed
 observed.off=[['event:installDone','events'],['event:launchLog','logs'],['event:launchState','states'],['event:progress','progress']].map(([channel,key])=>window.kamucl.on(channel,value=>{observed[key].push(value);observed.timeline.push({channel,receivedAt:Date.now(),rendererMs:performance.now(),value})}))
 return{timeOrigin:observed.timeOrigin,channels:observed.off.length}
}
function safeQaAccount(account){
 if(account&&(account.type!=='offline'||account.username!=='FavoriteNativeQA'))throw Error('Refuse account projection outside the generated offline QA identity')
 return account?{type:account.type,username:account.username}:null
}
function archivePrivateGameLogs({output,profile,games,instanceId,label}){
 assert(/^[a-z0-9-]+$/.test(label));assert.equal(path.basename(instanceId),instanceId)
 const physicalRoot=fs.realpathSync.native(path.dirname(profile));assert.equal(fs.realpathSync.native(path.dirname(games)),physicalRoot)
 const rows=[{kind:'launcher-current',source:path.join(profile,'logs','launcher-current.log')},{kind:'minecraft-latest',source:path.join(games,'versions',instanceId,'logs','latest.log')}],launchDir=path.join(games,'kamucl-logs')
 if(fs.existsSync(launchDir))for(const dir of fs.readdirSync(launchDir)){if(!/^[a-f0-9-]{36}$/i.test(dir))continue;for(const name of ['latest','stdout','stderr'])rows.push({kind:'launch-'+dir+'-'+name,source:path.join(launchDir,dir,name+'.log')})}
 const records=[]
 for(const row of rows){
  if(!fs.existsSync(row.source))continue
  const before=fs.lstatSync(row.source);assert(before.isFile()&&!before.isSymbolicLink(),'private log must be an ordinary file');const physical=fs.realpathSync.native(row.source),relative=path.relative(physicalRoot,physical);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'private log escaped QA root');assert(before.size<=64*1024*1024,'private diagnostic log too large')
  const bytes=fs.readFileSync(row.source),text=bytes.toString('utf8');assert(!/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bAuthorization\s*:\s*Bearer\s+\S+/i.test(text),'possible secret in isolated game log; original kept private')
  const file=label+'-'+row.kind+'.log';fs.writeFileSync(path.join(output,file),bytes,{flag:'wx'});const after=fs.statSync(row.source);records.push({kind:row.kind,originalPath:row.source,file,bytes:bytes.length,sha256:sha(bytes),sourceBytesBefore:before.size,sourceBytesAfter:after.size,sourceMtimeBefore:before.mtimeMs,sourceMtimeAfter:after.mtimeMs,sourceStableDuringRead:before.size===after.size&&before.mtimeMs===after.mtimeMs,classification:'Exact bytes read from the isolated generated QA account/game; no world or account configuration copied.'})
 }
 return records
}
/** Chromium on macOS needs the native editing command in addition to Cmd+A.
 * Observe the real focused selection before inserting; never assign DOM values. */
async function replaceNativeInput(click,call,evaluate,selector,text,platform=process.platform){
 await click(selector)
 for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',modifiers:platform==='darwin'?4:2,windowsVirtualKeyCode:65,...(platform==='darwin'&&type==='keyDown'?{commands:['selectAll']}:{})})
 const selection=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return{focused:document.activeElement===e,value:e?.value,start:e?.selectionStart,end:e?.selectionEnd}})()`)
 assert.equal(selection.focused,true,'native replacement requires the actual focused input')
 assert.equal(typeof selection.value,'string');assert.equal(selection.start,0,'native shortcut must select from the beginning');assert.equal(selection.end,selection.value.length,'native shortcut must select the entire previous value')
 await call('Input.insertText',{text})
 const value=await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`)
 assert.equal(value,text)
 return{selection,value}
}
function verifyInstalledSummary(result,expected){
 assert(result,'actual install completion must include verified favorite result');assert.equal(result.installed,expected.length);assert.equal(result.selected,expected.length);assert.equal(result.baseOnly,false);assert.equal(result.skipped.length,0)
 assert.equal(fs.realpathSync.native(result.folder),result.folder);assert.equal(fs.realpathSync.native(result.modsDirectory),result.modsDirectory);assert.equal(result.modsDirectory,path.join(result.folder,'versions',result.instanceId,'mods'))
 const files=result.verifiedFiles.map(f=>{const p=path.join(result.modsDirectory,f.fileName);assert.equal(path.basename(f.fileName),f.fileName);const s=fs.lstatSync(p);assert(s.isFile()&&!s.isSymbolicLink());const hash=sha(fs.readFileSync(p),'sha1');assert.equal(hash,f.sha1);return{...f,bytes:s.size,sha256:sha(fs.readFileSync(p))}})
 for(const f of expected)assert(files.some(actual=>actual.source===f.source&&actual.projectId===f.projectId&&actual.fileName===f.fileName&&actual.sha1===f.sha1),'selected public file must actually exist: '+f.fileName)
 assert(result.dependencies>=1,'representative install must include a real required dependency')
 return files
}
async function run(){
 const [application,arch=process.arch,stage=process.platform==='darwin'?'app':'portable']=process.argv.slice(2);assert(application);assert.equal(process.arch,arch);assert(['win32','darwin'].includes(process.platform));assert.equal(require('./ui-capabilities.cjs').favoriteInstallIntent,true,'current favorite installation contract must be tested regardless of patch version')
 const transport=qaProxyTransport()
 const threads=qaDownloadThreads()
 const mirror=qaDownloadMirror();if(mirror!==null)assert.equal(threads,4,'Explicit BMCLAPI QA requires KAMUCL_QA_DOWNLOAD_THREADS=4 and its actual native Settings UI change')
 const app=path.resolve(application),exe=process.platform==='darwin'?path.join(app,'Contents/MacOS/KAMUCL'):app;assert(fs.statSync(exe).isFile())
 const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'KAMUCL favorites113 中文 '))),profile=path.join(root,'profile'),games=path.join(root,'games §'),output=path.resolve(process.env.KAMUCL_FAVORITES_PROOF||`release/favorites-proof-${arch}-${stage}`)
 assert(!fs.existsSync(output),'never overwrite a failed or completed attempt');fs.mkdirSync(output,{recursive:true});fs.mkdirSync(profile);fs.mkdirSync(games)
 fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({gameDir:games,activeFolder:games,folders:[{path:games,name:'专项游戏目录',isDefault:true}],autoUpdate:false,setupCompleted:true,setupWizardVersion:2,theme:'black-orange',mirror:'official',defaultIsolation:true,javaAuto:true,memoryAuto:false,memoryMB:2048,closeAfterLaunch:false}),{flag:'wx'})
 const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),proof={schemaVersion:1,version:pkg.version,sourceCommit,platform:process.platform,arch,stage,startedAt:new Date().toISOString(),complete:false,fullPlatformParity:false,classification:'Real native product coordinate UI → public Modrinth/CurseForge favorites → original new-version installer → checksum readback; private offline-account game Quick Play world via original product IPC. No service fixtures, no credentials, no broad feature-parity claim.',phases:[],inputs:[],operations:[],screenshots:[],services:[],game:{complete:false}}
 proof.transport=transport
 const save=()=>fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(proof,null,2))
 save();let primaryError,installed
 try{
  for(const phase of ['first','restart']){
   const port=await freePort(),inspectPort=await freePort(),log=fs.openSync(path.join(output,phase+'-process.log'),'wx'),env={...process.env,TEMP:root,TMP:root};delete env.ELECTRON_RUN_AS_NODE
   const child=spawn(exe,[...transport.launchArgs,`--inspect=127.0.0.1:${inspectPort}`,`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`],{env,stdio:['ignore',log,log]}),track=owned.trackOwnedChild(child,'favorites113-'+phase),row={phase,child:track.ledger,complete:false};proof.phases.push(row);save();let renderer,main,evaluate,inspect
   let lastGameTelemetry,gameTelemetrySignature='',gameArchiveSerial=0,gameDiagnostic
   const archiveGameLogs=label=>{if(!installed)return;try{const records=archivePrivateGameLogs({output,profile,games,instanceId:installed.summary.instanceId,label:phase+'-game-'+label+'-'+(++gameArchiveSerial)});proof.game.rawLogSnapshots??=[];proof.game.rawLogSnapshots.push({label,at:new Date().toISOString(),records});save()}catch(error){proof.game.rawLogSnapshotError={label,message:error.message};save()}}
   const observeGame=async()=>{
    const snapshot=await evaluate(`(()=>{const o=window.__favorite113;return{timeOrigin:performance.timeOrigin,documentReady:document.readyState,documentHidden:document.hidden,logs:o?.logs||[],states:o?.states||[],progress:o?.progress||[],timeline:o?.timeline||[]}})()`)
    lastGameTelemetry=snapshot;const signature=JSON.stringify([snapshot.timeOrigin,snapshot.logs.length,snapshot.states.length,snapshot.progress.length,snapshot.timeline.length]);if(signature!==gameTelemetrySignature){gameTelemetrySignature=signature;fs.writeFileSync(path.join(output,phase+'-game-original-events.json'),JSON.stringify(snapshot,null,2)+'\n');proof.game.telemetry={file:phase+'-game-original-events.json',timeOrigin:snapshot.timeOrigin,logCount:snapshot.logs.length,stateCount:snapshot.states.length,progressCount:snapshot.progress.length,timelineCount:snapshot.timeline.length};save()}
    // Read-only background evidence. Never await or extend the 240s world wait.
    if(gameDiagnostic)gameDiagnostic.poll(snapshot)?.catch(error=>{proof.game.ownedDiagnosticError={name:error.name,message:error.message};save()})
    return{joined:snapshot.logs.some(line=>/joined the game|logged in with entity/i.test(line)),saved:snapshot.logs.some(line=>/Saving chunks|All dimensions are saved|Saving worlds/i.test(line)),exit:snapshot.states.find(state=>state.status==='exited'),errors:snapshot.states.filter(state=>state.status==='error'||state.status==='exited'),states:snapshot.states,latestLog:snapshot.logs.at(-1),latestProgress:snapshot.progress.at(-1),logCount:snapshot.logs.length,progressCount:snapshot.progress.length,documentHidden:snapshot.documentHidden,timeOrigin:snapshot.timeOrigin}
   }
   try{
    const until=async(label,read,accept,maxMs=30000,deadline)=>{const start=performance.now(),samples=[];do{if(deadline!==undefined&&performance.now()>=deadline)break;assert.equal(child.exitCode,null,'owned launcher exited during '+label);let v;try{v=await read()}catch(e){v={observationError:e.message}}const at=performance.now();samples.push({at,value:v});if((deadline===undefined||at<deadline)&&accept(v)){proof.operations.push({phase,label,maximumMs:maxMs,samples,...(deadline===undefined?{}:{deadline})});save();return v}const remaining=deadline===undefined?100:deadline-performance.now();if(remaining<=0)break;await pause(Math.min(100,remaining))}while(performance.now()-start<maxMs&&(deadline===undefined||performance.now()<deadline));proof.failure={phase,label,maximumMs:maxMs,samples,...(deadline===undefined?{}:{deadline})};save();throw Error('required real state missing: '+label)}
    const pages=await until('owned renderer',async()=>await(await fetch(`http://127.0.0.1:${port}/json`,{signal:AbortSignal.timeout(2000)})).json(),v=>Array.isArray(v)&&v.filter(p=>p.type==='page'&&p.url.includes('/renderer/index.html')).length===1,90000),page=pages.find(p=>p.type==='page'&&p.url.includes('/renderer/index.html'))
    renderer=await protocol(page.webSocketDebuggerUrl);await renderer.call('Runtime.enable');await renderer.call('Page.enable')
    const mains=await until('owned main',async()=>await(await fetch(`http://127.0.0.1:${inspectPort}/json`,{signal:AbortSignal.timeout(2000)})).json(),v=>Array.isArray(v)&&v.length===1);main=await protocol(mains[0].webSocketDebuggerUrl)
    const expressionCall=async(client,expression,timeoutMs=30000)=>{const r=await client.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},timeoutMs);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};evaluate=(e,timeoutMs)=>expressionCall(renderer,e,timeoutMs);inspect=(e,timeoutMs)=>expressionCall(main,e,timeoutMs)
    row.identity=await inspect(`(()=>{const e=process.mainModule.require('electron'),rows=e.BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('/renderer/index.html'));if(process.platform==='darwin'&&rows.length!==1)throw Error('One owned favorites window required');const w=rows[0];return{pid:process.pid,ppid:process.ppid,version:e.app.getVersion(),runtime:process.versions.electron,arch:process.arch,platform:process.platform,profile:e.app.getPath('userData'),exe:process.execPath,url:w?.webContents.getURL(),windowId:w?.id,webContentsId:w?.webContents.id}})()`)
    assert(row.identity.pid===child.pid||row.identity.ppid===child.pid);assert.equal(row.identity.profile,profile);assert.equal(row.identity.version,pkg.version);assert.equal(row.identity.runtime,pkg.devDependencies.electron);assert.equal(row.identity.arch,arch);assert.equal(row.identity.platform,process.platform);assert.equal(row.identity.url,page.url)
    await inspect(`(()=>{const e=process.mainModule.require('electron'),w=e.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));if(process.platform==='darwin')e.app.focus({steal:true});w.show();w.focus();w.unmaximize();w.setSize(1280,900)})()`);await renderer.call('Page.bringToFront')
    await until('actually mounted focused document',()=>evaluate(`({ready:document.readyState==='complete'&&!!window.kamucl&&!!document.querySelector('[data-nav=community]'),focused:document.hasFocus(),hidden:document.hidden})`),v=>v.ready&&v.focused&&!v.hidden)
    await evaluate(`(${observer.installMacParityObserver.toString()})()`)
    const remaining=deadline=>{const ms=deadline-performance.now();assert(ms>0,'Original coordinate/navigation deadline elapsed');return ms}
    const nativeGeometry=timeoutMs=>inspect(`(()=>{const e=process.mainModule.require('electron'),w=e.BrowserWindow.getAllWindows().find(w=>w.id===${row.identity.windowId}&&w.webContents.id===${row.identity.webContentsId});if(!w||w.webContents.getURL()!==${JSON.stringify(row.identity.url)})throw Error('Owned favorites window unavailable');return{pid:process.pid,windowId:w.id,webContentsId:w.webContents.id,bounds:w.getBounds(),contentBounds:w.getContentBounds(),zoom:w.webContents.getZoomFactor(),focused:w.isFocused(),visible:w.isVisible(),minimized:w.isMinimized(),appHidden:e.app.isHidden()}})()`,timeoutMs)
    const point=async(selector,{deadline,expectedZoom,absentSelectors=[]}={})=>{
     if(process.platform==='darwin'){
      deadline??=performance.now()+30000;const samples=[],label='stable owned coordinate '+selector
      try{
       await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',behavior:'instant'})`,remaining(deadline))
       const binding=await evaluate(`({timeOrigin:performance.timeOrigin,url:location.href})`,remaining(deadline));assert.equal(binding.url,row.identity.url)
       const expected={pid:row.identity.pid,windowId:row.identity.windowId,webContentsId:row.identity.webContentsId,...binding,...(expectedZoom===undefined?{}:{zoom:expectedZoom})}
       const value=await coordinateGeometry.waitForStableCoordinate({deadline,expected,wait:pause,read:async budget=>({native:await nativeGeometry(budget),coordinate:await evaluate(coordinateGeometry.coordinateExpression(selector,{absentSelectors}),remaining(deadline))}),onSample:sample=>{assert.equal(child.exitCode,null,'owned launcher exited during '+label);samples.push(sample)}})
       proof.operations.push({phase,label,maximumMs:30000,deadline,expected,samples});save();return{...value.coordinate,rect:value.coordinate.bounds}
      }catch(error){proof.failure={phase,label,maximumMs:30000,deadline,samples,error:{name:error.name,message:error.message}};save();throw error}
     }
     await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',behavior:'instant'})`);return until('trusted coordinate '+selector,()=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return{hit:false};const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,visible=[];for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);visible.push(Number(s.opacity)>=.999&&s.visibility==='visible'&&s.display!=='none')}return{hit:r.width>0&&r.height>0&&x>0&&y>0&&x<innerWidth&&y<innerHeight&&!e.disabled&&!e.closest('[inert]')&&e.contains(document.elementFromPoint(x,y))&&visible.every(Boolean),x,y,label:e.textContent.trim(),rect:r.toJSON()}})()`),v=>v.hit)
    }
    const click=async(selector,options={})=>{
     const deadline=process.platform==='darwin'?(options.deadline??performance.now()+30000):undefined,p=await point(selector,{...options,deadline});let token,dispatchError
     if(process.platform==='darwin')token=await evaluate(coordinateGeometry.trustedTargetStartExpression(selector),remaining(deadline))
     try{for(const[type,buttons]of[['mouseMoved',0],['mousePressed',1],['mouseReleased',0]]){const params={type,x:p.x,y:p.y,button:type==='mouseMoved'?'none':'left',buttons,clickCount:type==='mouseMoved'?0:1};proof.inputs.push({phase,at:performance.now(),method:'Input.dispatchMouseEvent',params});await renderer.call('Input.dispatchMouseEvent',params,deadline===undefined?30000:remaining(deadline))}}catch(error){dispatchError=error;throw error}
     finally{if(token){const original={phase,selector,deadline,coordinate:p};(proof.trustedInputs??=[]).push(original);try{original.observation=await evaluate(coordinateGeometry.trustedTargetStopExpression(token),3000);coordinateGeometry.assertTrustedTargetObservation(original.observation,{selector,timeOrigin:p.renderer.timeOrigin,url:p.renderer.url})}catch(error){original.diagnosticError={name:error.name,message:error.message};if(!dispatchError)throw error}finally{save()}}}
     if(deadline!==undefined)remaining(deadline);return p
    }
    const textClick=async(scope,text)=>{const selector=await until('actual unique visible '+text,()=>evaluate(`(()=>{const rows=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].filter(e=>e.getClientRects().length&&e.textContent.trim()===${JSON.stringify(text)});if(rows.length!==1)return{ready:false,count:rows.length};rows[0].setAttribute('data-favorite113-coordinate','current');return{ready:true,selector:'[data-favorite113-coordinate=current]'}})()`),v=>v.ready);try{return await click(selector.selector)}finally{await evaluate(`document.querySelector('[data-favorite113-coordinate=current]')?.removeAttribute('data-favorite113-coordinate')`)}}
    const type=async(selector,text)=>{const state=await replaceNativeInput(click,(method,params)=>{proof.inputs.push({phase,at:performance.now(),method,params});return renderer.call(method,params)},evaluate,selector,text);proof.operations.push({phase,label:'native input replacement',selector,...state});save()}
    const screenshot=async name=>{await until('finite appearance transitions settled',()=>evaluate(`document.getAnimations().filter(a=>a.playState==='running'&&Number.isFinite(a.effect?.getTiming().iterations)).length`),v=>v===0);const bytes=Buffer.from((await renderer.call('Page.captureScreenshot',{format:'png'})).data,'base64'),file=phase+'-'+name+'.png';fs.writeFileSync(path.join(output,file),bytes,{flag:'wx'});const s={file,bytes:bytes.length,sha256:sha(bytes)};proof.screenshots.push(s);save();return s}
    const route=async(name,options={})=>{const component={community:'CommunityView',game:'GameView',settings:'SettingsView',home:'HomeView'}[name];assert(component);const deadline=process.platform==='darwin'?(options.deadline??performance.now()+30000):undefined;await click('[data-nav='+name+']',{...options,deadline,absentSelectors:['.game-install-modal']});await until('actual route '+name,()=>evaluate(`({selected:document.querySelector('[data-nav=${name}]')?.getAttribute('aria-current'),route:window.__macParityObserver.route(${JSON.stringify(component)})})`,deadline===undefined?30000:remaining(deadline)),v=>v.selected==='page'&&v.route.component&&(v.route.transition||'').indexOf('fade-leave')<0,30000,deadline)}
    if(phase==='restart'){
     if(mirror!==null){const readback=await evaluate(`(async()=>{const s=await window.kamucl.invoke('settings:get');return{mirror:s.mirror,downloadThreads:s.downloadThreads,downloadSpeedKBps:s.downloadSpeedKBps}})()`);assert.equal(readback.mirror,mirror);assert.equal(readback.downloadThreads,threads);proof.networkConditions.restartReadback=readback;save()}
     assert.notEqual(row.identity.pid,proof.phases[0].identity.pid);assert.deepEqual((await evaluate(`window.kamucl.invoke('mods:favorites')`)).map(f=>f.key).sort(),SOURCES.map(s=>s.source+':'+s.id).sort())
     verifyInstalledSummary(installed.summary,installed.selected);await route('community');await click('[data-ui="community:favorites"]');await until('persisted real favorite rows',()=>evaluate(`document.querySelectorAll('.favorite-card[data-favorite-key],.favorite-row[data-favorite-key]').length`),v=>v===SOURCES.length);row.persistedFavorites=true;row.persistedFiles=true;row.screenshot=await screenshot('favorites-persisted')
    }else{
     const traceChannels=['mods:favorite','mods:favoriteVersions','versions:install','game:launch','game:kill',...(threads!==null?['settings:set']:[])]
     await inspect(`(()=>{const e=process.mainModule.require('electron');globalThis.favorite113Trace=(${observer.createInstallHandlerObserver.toString()})(e.ipcMain,${JSON.stringify(traceChannels)});return true})()`)
     await evaluate(`(${installFavoriteEventObserver.toString()})()`)
     if(threads!==null){
      const settings=()=>evaluate(`(async()=>{const s=await window.kamucl.invoke('settings:get');return{mirror:s.mirror,downloadThreads:s.downloadThreads,downloadSpeedKBps:s.downloadSpeedKBps}})()`)
      const before=await settings();assert.equal(before.mirror,'official');assert.equal(before.downloadThreads,16)
      await route('home');await route('settings');await textClick('.settings-scopes','启动器设置');await textClick('.settings-categories','下载')
      const selector='[data-ui="SettingsView:0975603bb2e6"]',replacement=await replaceNativeNumberInput(click,(method,params)=>{proof.inputs.push({phase,at:performance.now(),method,params});return renderer.call(method,params)},evaluate,selector,threads)
      await click('[data-section="mirror"] .group-title') // Native blur/change commits through the actual Settings handler.
      const after=await until('real Settings download thread commit',settings,s=>s.downloadThreads===threads&&s.mirror==='official')
      const calls=await inspect(`favorite113Trace.calls.filter(row=>row.channel==='settings:set'&&row.completedAt&&row.arguments?.[0]?.downloadThreads===${threads}).map(row=>({index:row.index,channel:row.channel,startedAt:row.startedAt,completedAt:row.completedAt,arguments:row.arguments,error:row.error}))`)
      assert.equal(calls.length,1);assert.deepEqual(calls[0].arguments,[{downloadThreads:threads}]);assert(!calls[0].error)
      proof.networkConditions={classification:'Explicit single-variable native Settings comparison; not same-condition resource performance evidence',source:'official',transport,requestedThreads:threads,before,after,replacement,actualHandlerCalls:calls,screenshot:await screenshot('official-four-threads-setting')};save()
      if(mirror!==null){
       const mirrorBefore=await settings(),traceStart=await inspect('favorite113Trace.calls.length'),selector='[data-ui="SettingsView:4948cbbe2972"]',coordinate=await click(selector)
       const mirrorAfter=await until('real Settings BMCLAPI mirror commit',settings,s=>s.mirror===mirror&&s.downloadThreads===threads)
       const mirrorCalls=await inspect(`favorite113Trace.calls.slice(${traceStart}).filter(row=>row.channel==='settings:set'&&row.completedAt&&row.arguments?.[0]?.mirror===${JSON.stringify(mirror)}).map(row=>({index:row.index,channel:row.channel,startedAt:row.startedAt,completedAt:row.completedAt,arguments:row.arguments,error:row.error}))`)
       verifyQaMirrorSetting({before:mirrorBefore,after:mirrorAfter,calls:mirrorCalls,threads})
       Object.assign(proof.networkConditions,{classification:'Explicit user-available BMCLAPI and four-thread native Settings condition through original product network policy; not same-condition resource performance evidence or proof every byte came only from the mirror',source:mirror,requestedMirror:mirror,threadAfter:after,after:mirrorAfter,threadHandlerCalls:calls,actualHandlerCalls:[...calls,...mirrorCalls],mirrorChange:{before:mirrorBefore,after:mirrorAfter,selector,coordinate,actualHandlerCalls:mirrorCalls,screenshot:await screenshot('bmclapi-four-threads-setting')}});save()
      }
     }
     await route('community')
     for(const source of SOURCES){
      await click('.community-page [aria-label="资源来源"]');await textClick('.select-menu-float',source.source==='modrinth'?'Modrinth':'CurseForge');await type('.community-page .search-row input',source.query);await click('.community-page .search-btn')
      const card=await until('real '+source.source+' search card',()=>evaluate(`(()=>{const cards=[...document.querySelectorAll('.result-card')].filter(e=>window.__macParityObserver.nodeForElement('CommunityView',e).key===${JSON.stringify(source.source+':'+source.id)});if(cards.length!==1)return{ready:false,count:cards.length,error:document.querySelector('.list-card .empty')?.innerText};cards[0].setAttribute('data-favorite113-card',${JSON.stringify(source.id)});return{ready:!cards[0].closest('[inert]'),title:cards[0].innerText,key:window.__macParityObserver.nodeForElement('CommunityView',cards[0]).key}})()`),v=>v.ready,90000)
      await click('[data-favorite113-card="'+source.id+'"] .result-favorite');await until('real favorite persistence '+source.id,()=>evaluate(`({pressed:document.querySelector('[data-favorite113-card="${source.id}"] .result-favorite')?.getAttribute('aria-pressed'),busy:document.querySelector('[data-favorite113-card="${source.id}"] .result-favorite')?.disabled})`),v=>v.pressed==='true'&&!v.busy)
      const records=await evaluate(`window.kamucl.invoke('mods:favorites')`),record=records.find(f=>f.key===source.source+':'+source.id);assert(record,'search UI favorite must retain expected canonical project');proof.services.push({source:source.source,projectId:source.id,searchCard:card,record,screenshot:await screenshot('favorite-'+source.source)});save()
     }
     const openInstall=async(options={})=>{
      await route('game',options);await click('.game-tab[data-tab=download]');await type('.game-controls .tool-search input','1.20.1')
      await until('actual 1.20.1 catalogue row',()=>evaluate(`(()=>{const rows=[...document.querySelectorAll('.version-row')].filter(e=>e.querySelector('.version-id')?.textContent.trim()==='1.20.1');if(rows.length!==1)return false;rows[0].setAttribute('data-favorite113-version','chosen');return !rows[0].querySelector('.version-actions button')?.disabled})()`),v=>v===true,90000)
      await click('[data-favorite113-version=chosen] .version-actions button');await until('actual install modal',()=>evaluate(`!!document.querySelector('.game-install-modal')`),v=>v===true);await textClick('.game-install-modal .loader-options','Fabric')
      await until('actual Fabric API option',()=>evaluate(`!!document.querySelector('[data-ui="install:fabric-api"]')`),v=>v===true)
      if(await evaluate(`document.querySelector('[data-ui="install:fabric-api"]').checked`))await click('[data-ui="install:fabric-api"]')
      await until('actual loader metadata complete',()=>evaluate(`({loading:!!document.querySelector('[data-ui="install:loader-loading"]'),version:document.querySelector('[data-ui="install:loader-version"]')?.value,error:document.querySelector('[data-ui="install:loader-error"]')?.textContent})`),v=>!v.loading&&!!v.version&&!v.error,90000)
      await click('[data-ui="favorites:enable"]');await until('actual favorite query decisions complete',()=>evaluate(`(()=>{const p=window.__macParityObserver.one('FavoriteModsPicker');return JSON.parse(JSON.stringify({selected:p.props.modelValue,intent:p.props.intent,text:document.querySelector('[data-ui="favorites:summary"]')?.innerText,disabled:document.querySelector('.game-install-modal .install-footer .btn-gold')?.disabled,errors:[...document.querySelectorAll('.favorite-row [role=alert]')].map(e=>e.innerText)}))})()`),v=>v.selected?.length===SOURCES.length&&!v.disabled&&v.errors.length===0,90000)
     }
     proof.layouts=[]
     for(const theme of ['black-orange','blue-white','transparent','custom']){
      await evaluate(`window.kamucl.invoke('settings:set',${JSON.stringify({theme,...(theme==='custom'?{custom:{colors:{bg:'#171520',card:'#242232',accent:'#8759cd',text:'#f6f2ff',textDim:'#bcb7cc',border:'#4a455c',sidebarBg:'#201d2b',sidebarText:'#e5dff2',bannerText:'#ffffff'}}}:{})})})`);const oldOrigin=await evaluate('performance.timeOrigin');await renderer.call('Page.reload');await until('actual new theme document',()=>evaluate(`({origin:performance.timeOrigin,ready:document.readyState==='complete'&&!!document.querySelector('[data-nav=game]'),theme:document.documentElement.dataset.theme})`),v=>v.origin!==oldOrigin&&v.ready&&v.theme===theme);await evaluate(`(${observer.installMacParityObserver.toString()})()`)
      await inspect(`(()=>{const w=process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));w.setSize(960,620);w.webContents.setZoomFactor(1.25);w.show();w.focus()})()`);await until('actual zoom viewport',async()=>({native:await inspect(`(()=>{const w=process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));return{size:w.getContentSize(),zoom:w.webContents.getZoomFactor()}})()`),view:await evaluate(`({width:innerWidth,height:innerHeight})`)}),v=>v.native.zoom===1.25&&Math.abs(v.view.width-v.native.size[0]/1.25)<2&&Math.abs(v.view.height-v.native.size[1]/1.25)<2)
      await openInstall();const footer=await point('.game-install-modal .install-footer .btn-gold'),check=await point('[data-ui="favorites:enable"]'),content=await evaluate(`(()=>{const m=document.querySelector('.game-install-modal');return{width:innerWidth,height:innerHeight,horizontalOverflow:m.scrollWidth>m.clientWidth+3,title:m.querySelector('.install-header')?.innerText,text:m.querySelector('[data-ui="favorites:summary"]')?.innerText}})()`);assert.equal(content.horizontalOverflow,false);proof.layouts.push({theme,zoom:1.25,requested:[960,620],actual:content,footer,check,screenshot:await screenshot('install-'+theme)});await click('.game-install-modal .install-footer .btn-ghost')
     }
     const finalLayoutDeadline=process.platform==='darwin'?performance.now()+30000:undefined
     await inspect(`(()=>{const w=process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.id===${row.identity.windowId}&&w.webContents.id===${row.identity.webContentsId});if(!w)throw Error('Owned favorites window unavailable');w.setSize(1280,900);w.webContents.setZoomFactor(1)})()`,finalLayoutDeadline===undefined?30000:remaining(finalLayoutDeadline));await openInstall({deadline:finalLayoutDeadline,expectedZoom:1})
     await type('.game-install-modal input.mono','收藏专项 1.20.1 §');await click('.game-install-modal .install-header');await point('.game-install-modal .install-footer .btn-gold');await screenshot('accepted-favorites')
     // Restore subscriptions after the theme reloads; bind the result to this
     // exact accepted original call, never to an unrelated older completion.
     await evaluate(`(${installFavoriteEventObserver.toString()})()`)
     const before=await inspect('favorite113Trace.calls.length');await click('.game-install-modal .install-footer .btn-gold')
     const accepted=await until('one accepted original install invocation',()=>inspect(`favorite113Trace.calls.slice(${before}).filter(r=>r.channel==='versions:install')`),v=>Array.isArray(v)&&v.length===1);const options=accepted[0].arguments[1];assert.equal(options.favoriteMods.length,SOURCES.length);assert.equal(options.favoriteInstallIntent.enabled,true);assert.equal(options.favoriteInstallIntent.approvedSkips.length,0)
     const result=await until('accepted actual install completion',()=>evaluate(`window.__favorite113.events.filter(e=>e.versionId==='1.20.1')`),v=>Array.isArray(v)&&v.length===1,650000);assert.equal(result[0].ok,true,JSON.stringify(result));assert(result[0].taskId);assert.equal(result[0].installedId,options.instanceName)
     const taskProgress=await evaluate(`window.__favorite113.progress.filter(e=>e.taskId===${JSON.stringify(result[0].taskId)}&&e.versionId==='1.20.1')`);assert(taskProgress.length,'completion must bind the actual accepted task progress');proof.acceptedTask={taskId:result[0].taskId,progress:taskProgress}
     const trace=await inspect('favorite113Trace.calls'),acceptedDone=trace.find(r=>r.index===accepted[0].index);assert(acceptedDone.completedAt&&!acceptedDone.error)
     const selected=options.favoriteMods.map(s=>{const queries=trace.filter(r=>r.channel==='mods:favoriteVersions'&&r.arguments[0]===s.source&&r.arguments[1]===s.projectId&&r.arguments[2]==='1.20.1'&&r.arguments[3]==='fabric'&&r.completedAt&&r.result?.status==='available');const exact=queries.at(-1)?.result.files.find(f=>f.fileId===s.fileId);assert(exact,'selected file belongs to completed original compatible response');return exact})
     installed={summary:result[0].favoriteModsResult,selected};assert.equal(installed.summary.folder,games);proof.install={accepted:acceptedDone,completed:result[0],files:verifyInstalledSummary(installed.summary,selected),originalTrace:trace,complete:true};save();await screenshot('installation-complete')
     proof.game.account=await evaluate(`(async()=>{const project=${safeQaAccount.toString()},added=await window.kamucl.invoke('accounts:addOffline','FavoriteNativeQA'),selected=await window.kamucl.invoke('accounts:selected');return{added:project(added),selected:project(selected),selectedMatchesAdded:!!selected&&selected.id===added.id}})()`);assert.equal(proof.game.account.added.type,'offline');assert.equal(proof.game.account.selected.type,'offline');assert.equal(proof.game.account.selected.username,'FavoriteNativeQA');assert.equal(proof.game.account.selectedMatchesAdded,true);save()
     if(process.platform==='darwin'&&arch==='arm64'){
      try{gameDiagnostic=await macGameDiagnostic.createMacOwnedGameDiagnostics({root,profile,games,instanceId:installed.summary.instanceId,output,phase,launcherPID:row.identity.pid,inspect:e=>expressionCall(main,e,4000),onChange:report=>{proof.game.ownedDiagnostics={directory:phase+'-owned-game-diagnostic',report};save()}});await gameDiagnostic.install()}catch(error){proof.game.ownedDiagnosticSetupError={name:error.name,message:error.message};save()}
     }
     const launchStartedAt=Date.now();gameDiagnostic?.setLaunchStartedAt(launchStartedAt);const launchReturn=await evaluate(`window.kamucl.invoke('game:launch',${JSON.stringify(installed.summary.instanceId)},null,${JSON.stringify(games)},true)`);proof.game.launchInvocation={startedAt:launchStartedAt,returnedAt:Date.now(),arguments:[installed.summary.instanceId,null,games,true],returnType:typeof launchReturn,returnValue:launchReturn??null,received:true};proof.game.originalHandlerTrace=await inspect(`favorite113Trace.calls.filter(row=>row.channel==='game:launch'||row.channel==='game:kill')`);save();archiveGameLogs('after-launch-return')
     await until('actual player enters generated game world',observeGame,v=>v.joined,240000);archiveGameLogs('joined-world')
     if(gameDiagnostic)await gameDiagnostic.finish()
     const worlds=fs.readdirSync(path.join(games,'versions',installed.summary.instanceId,'saves')).filter(name=>name.startsWith('KAMUCL-Test-'));assert.equal(worlds.length,1);const world=path.join(games,'versions',installed.summary.instanceId,'saves',worlds[0]);const beforeSave=fs.statSync(path.join(world,'level.dat')).mtimeMs
     const close=await evaluate(`window.kamucl.invoke('game:kill')`);assert.equal(close.requiresForce,false,'must use normal native window close, never force a game process')
     const game=await until('actual normal game save and process exit',observeGame,v=>v.saved&&!!v.exit,60000);assert.equal(game.exit.code,0);assert(fs.statSync(path.join(world,'level.dat')).mtimeMs>beforeSave);assert(fs.existsSync(path.join(world,'region')));Object.assign(proof.game,{complete:true,joined:true,saveLogsObserved:true,normalClose:close,exit:game.exit,generatedWorld:{name:worlds[0],levelDatBytes:fs.statSync(path.join(world,'level.dat')).size,levelDatSha256:sha(fs.readFileSync(path.join(world,'level.dat')))},classification:'Real Minecraft Quick Play generated world and normal save/exit through original launcher IPC, offline QA account. No Java driver and no simulated world.'});proof.game.originalHandlerTrace=await inspect(`favorite113Trace.calls.filter(row=>row.channel==='game:launch'||row.channel==='game:kill')`);save();archiveGameLogs('normal-exit')
     proof.handlerRestoration=await inspect(`(${observer.restoreInstallHandlerObserver.toString()})(process.mainModule.require('electron').ipcMain,favorite113Trace)`);assert.equal(proof.handlerRestoration.complete,true)
    }
    if(process.platform==='darwin'){row.trustedTargetRestoration=await evaluate(coordinateGeometry.trustedTargetRestoreExpression(),3000);assert.equal(row.trustedTargetRestoration.complete,true)}
    row.complete=true;save();await inspect(`(()=>{const e=process.mainModule.require('electron');setTimeout(()=>e.app.quit(),100);return true})()`);renderer.socket.close();main.socket.close();row.debuggersDetached=true;await owned.finishOwnedChild(track,{timeoutMs:15000});assert.equal(track.ledger.code,0);assert.equal(track.ledger.signal,null)
   }catch(error){row.error={name:error.name,message:error.message};if(proof.game.launchInvocation){archiveGameLogs('failed-observation');try{await observeGame();proof.game.originalHandlerTrace=await inspect(`favorite113Trace.calls.filter(row=>row.channel==='game:launch'||row.channel==='game:kill')`)}catch(diagnostic){proof.game.diagnosticObservationError=diagnostic.message}if(gameDiagnostic)try{await gameDiagnostic.beforeFailure(lastGameTelemetry||{states:[],timeline:[]})}catch(diagnostic){proof.game.ownedDiagnosticError={name:diagnostic.name,message:diagnostic.message}}save()}try{if(renderer){const bytes=Buffer.from((await renderer.call('Page.captureScreenshot',{format:'png'})).data,'base64'),file=phase+'-failure.png';fs.writeFileSync(path.join(output,file),bytes,{flag:'wx'});proof.screenshots.push({file,bytes:bytes.length,sha256:sha(bytes)})}}catch{}throw error}
   finally{
    if(evaluate&&process.platform==='darwin'&&!row.trustedTargetRestoration?.complete&&renderer?.socket.readyState===1)try{row.trustedTargetRestoration=await evaluate(coordinateGeometry.trustedTargetRestoreExpression(),3000)}catch(error){row.trustedTargetRestorationError={name:error.name,message:error.message};save()}
    if(gameDiagnostic){try{await gameDiagnostic.finish();await gameDiagnostic.restore()}catch(diagnostic){proof.game.ownedDiagnosticFinalizationError={name:diagnostic.name,message:diagnostic.message};save()}}
    if(main&&row.identity&&(row.identity.pid===child.pid||row.identity.ppid===child.pid)&&!track.ledger.closed){
     try{if(evaluate){const states=await evaluate(`window.__favorite113?.states||[]`);if(states.some(s=>s.status==='running')&&!states.some(s=>s.status==='exited')){const close=await evaluate(`window.kamucl.invoke('game:kill')`);row.cleanupGameClose=close;if(close.requiresForce){assert(close.forceToken);row.cleanupForcedOwnedGame=await evaluate(`window.kamucl.invoke('game:kill',${JSON.stringify(close.forceToken)})`)} }}}catch(e){row.cleanupGameError=e.message}if(proof.game.launchInvocation&&!row.complete){archiveGameLogs('after-failure-cleanup');if(lastGameTelemetry)proof.game.lastObservedStates=lastGameTelemetry.states;save()}
     try{await inspect(`(()=>{const e=process.mainModule.require('electron');if(globalThis.favorite113Trace)(${observer.restoreInstallHandlerObserver.toString()})(e.ipcMain,favorite113Trace);return true})()`)}catch(e){row.cleanupRestorationError=e.message}
     try{await inspect(`(()=>{const e=process.mainModule.require('electron');setTimeout(()=>e.app.quit(),50);return true})()`)}catch(e){row.cleanupQuitError=e.message}
    }
    renderer?.socket.close();main?.socket.close();if(!track.ledger.closed)await owned.finishOwnedChild(track,{timeoutMs:15000}).catch(async e=>{row.cleanupExitError=e.message;await owned.finishOwnedChild(track,{terminate:true,timeoutMs:7000})});fs.closeSync(log);save()
   }
  }
  assert(proof.install?.complete&&proof.game.complete&&proof.phases.every(p=>p.complete&&p.child.code===0&&p.child.signal===null));proof.complete=true
 }catch(error){primaryError=error;proof.error={name:error.name,message:error.message};throw error}
 finally{proof.finishedAt=new Date().toISOString();proof.files=fs.readdirSync(output,{withFileTypes:true}).filter(entry=>entry.isFile()&&entry.name!=='summary.json').map(entry=>{const file=entry.name,b=fs.readFileSync(path.join(output,file));return{file,bytes:b.length,sha256:sha(b)}});save();if(!primaryError)console.log(JSON.stringify({complete:proof.complete,output,sourceCommit,platform:process.platform,arch}))}
}
module.exports={SOURCES,verifyInstalledSummary,protocol,replaceNativeInput,installFavoriteEventObserver,safeQaAccount,archivePrivateGameLogs,qaProxyTransport,qaDownloadThreads,qaDownloadMirror,verifyQaMirrorSetting,replaceNativeNumberInput}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1})
