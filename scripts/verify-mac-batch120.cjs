// Exact signed ARM64 application, actual foreground and trusted coordinates.
// Download messages are synthetic visual replays, not network/install evidence.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net')
const assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn,execFileSync}=require('node:child_process')
const owned=require('./qa-owned-process-119.cjs'),coordinates=require('./verify-mac-parity-ui.cjs')
const {readMacPackageIdentity}=require('./mac-package-identity.cjs')
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const DOWNLOAD_BUTTON='[data-ui="App:50549c4d6612"][title="下载中心"]',DOWNLOAD_MASK='[data-ui="App:32e6a4482be2"]'
// The backdrop centre is covered by the panel at the minimum 125% layout.
// This QA-only adapter observes a fixed fractional point in the real backdrop;
// the original bounds, native state and trusted target ledger remain unchanged.
function backdropExpression(selector,options){return require('./qa-coordinate-geometry114.cjs').coordinateExpression(selector,options).replace('x=r.x+r.width/2,y=r.y+r.height/2','x=r.x+r.width*.05,y=r.y+r.height*.9')}
function backdropReady(row,previous,expected){
 const finite=Number.isFinite,rect=r=>r&&['x','y','width','height'].every(k=>finite(r[k]))&&r.width>0&&r.height>0
 const ready=value=>{const n=value?.native,c=value?.coordinate,r=c?.renderer;return n&&c&&r&&['pid','windowId','webContentsId'].every(k=>Number.isInteger(expected[k])&&expected[k]>0&&n[k]===expected[k])&&n.visible===true&&n.minimized===false&&n.focused===true&&n.appHidden===false&&rect(n.bounds)&&rect(n.contentBounds)&&finite(n.zoom)&&n.zoom>0&&(expected.zoom===undefined||n.zoom===expected.zoom)&&r.width===Math.round(n.contentBounds.width/n.zoom)&&r.height===Math.round(n.contentBounds.height/n.zoom)&&r.hasFocus===true&&r.hidden===false&&r.ready==='complete'&&finite(r.pixelRatio)&&r.pixelRatio>0&&r.timeOrigin===expected.timeOrigin&&r.url===expected.url&&c.hit===true&&c.ancestorsVisible===true&&c.runningAnimations===0&&c.absent===true&&rect(c.bounds)&&finite(c.x)&&finite(c.y)&&c.x===c.bounds.x+c.bounds.width*.05&&c.y===c.bounds.y+c.bounds.height*.9&&c.bounds.x>=0&&c.bounds.y>=0&&c.bounds.x+c.bounds.width<=r.width&&c.bounds.y+c.bounds.height<=r.height}
 if(!ready(row)||!ready(previous))return false
 return row.native.zoom===previous.native.zoom&&['x','y','width','height'].every(k=>['bounds','contentBounds'].every(name=>row.native[name][k]===previous.native[name][k])&&row.coordinate.bounds[k]===previous.coordinate.bounds[k])&&row.coordinate.x===previous.coordinate.x&&row.coordinate.y===previous.coordinate.y&&['width','height','pixelRatio','timeOrigin','url'].every(k=>row.coordinate.renderer[k]===previous.coordinate.renderer[k])
}
async function waitForBackdrop({read,expected,deadline,now=()=>performance.now(),wait:pause=wait,pollMs=75,onSample=()=>{}}){
 let previous,last
 while(now()<deadline){let timer,value;try{value=await Promise.race([Promise.resolve().then(()=>read(deadline-now())),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Original backdrop coordinate deadline elapsed during read')),Math.max(1,deadline-now()))})])}catch(error){value={observationError:{name:error.name,message:error.message}}}finally{clearTimeout(timer)}
  const at=now();last=value;onSample({at,value});if(at<deadline&&backdropReady(value,previous,expected))return value;previous=value;const left=deadline-now();if(left<=0)break;await pause(Math.min(pollMs,left))
 }
 const error=Error('Original coordinate deadline elapsed before two stable owned backdrop observations');error.code='QA_COORDINATE_DEADLINE';error.last=last;throw error
}
async function port(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value}
async function connect(port,isMain){
 let page
 for(let i=0;i<100;i++){try{page=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(row=>row.webSocketDebuggerUrl&&(isMain||row.url.includes('/renderer/index.html')));if(page)break}catch{}await wait(200)}
 assert(page,'Actual packaged inspector unavailable')
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})})
 let id=0;const pending=new Map()
 ws.addEventListener('message',event=>{const response=JSON.parse(event.data);pending.get(response.id)?.(response)})
 ws.addEventListener('close',()=>{for(const entry of pending.values())entry({error:{message:'Actual inspector closed'}})})
 const call=(method,params={},timeoutMs=12000)=>new Promise((resolve,reject)=>{const current=++id,timer=setTimeout(()=>{pending.delete(current);reject(Error(method+' timed out'))},timeoutMs);pending.set(current,response=>{clearTimeout(timer);pending.delete(current);response.error?reject(Error(JSON.stringify(response.error))):resolve(response.result)});ws.send(JSON.stringify({id:current,method,params}))})
 const evaluate=async(expression,timeoutMs)=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},timeoutMs);assert(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value}
 return{ws,call,evaluate}
}
async function bindRenderer(evaluate,observe,waitFor=wait,budgetMs=10000,startedAt=Date.now()){
 const deadline=startedAt+budgetMs
 while(Date.now()<deadline){
  const state=await evaluate("(()=>{globalThis.testElectron=process.mainModule.require('electron');const windows=testElectron.BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed());const matching=windows.filter(w=>w.webContents.getURL().includes('/renderer/index.html'));return{appReady:testElectron.app.isReady(),windows:windows.map(w=>{const url=w.webContents.getURL();return{windowId:w.id,webContentsId:w.webContents.id,url,visible:w.isVisible(),opacity:w.getOpacity(),role:url.includes('/renderer/index.html')?'main-renderer':url.includes('/renderer/splash.html')?'startup-splash':url?'other':'uncommitted'}}),matches:matching.length,binding:matching.length===1?{pid:process.pid,windowId:matching[0].id,webContentsId:matching[0].webContents.id,profile:testElectron.app.getPath('userData'),executable:process.execPath,version:testElectron.app.getVersion(),arch:process.arch}:null}})()")
  observe({at:Date.now(),...state});assert(state.matches<=1,'More than one actual production renderer exists')
  if(state.appReady&&state.matches===1&&state.windows.some(w=>w.role==='main-renderer'&&w.visible&&w.opacity>=.999)&&!state.windows.some(w=>w.role==='startup-splash'))return state.binding
  await waitFor(80)
 }
 const error=Error('Unique actual production renderer did not become ready within '+budgetMs+' ms; original window inventory retained');error.code='QA_RENDERER_BIND_DEADLINE';throw error
}
function createBatchNavigation({click,until,foreground,evaluate}){
 return async id=>{
  const component=coordinates.ROUTE_COMPONENTS[id];assert(component,'Unknown native QA route')
  if(['mods','packs','shaders','recordings','projections','bridge','servers'].includes(id)&&await evaluate("document.querySelector('[data-nav=resources]')?.getAttribute('aria-expanded')!=='true'"))await click('[data-nav=resources]')
  await click(`[data-nav=${id}]`);await until('actual route '+id,`window.__macParityObserver.route(${JSON.stringify(component)}).component`,value=>value===component);await foreground()
 }
}
async function run(){
 assert.equal(process.platform,'darwin');assert.equal(process.env.GITHUB_ACTIONS,'true','Only an owned disposable Mac runner is authorized')
 const [argument,arch,stage='app',packageSourceArgument]=process.argv.slice(2),app=fs.realpathSync.native(argument),pkg=require('../package.json')
 assert.equal(process.arch,arch);assert.equal(arch,'arm64');assert(['app','dmg'].includes(stage))
 const qaSourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceCommit=packageSourceArgument?.replace(/^--package-source-commit=/,'')||qaSourceCommit,exe=path.join(app,'Contents/MacOS/KAMUCL')
 if(packageSourceArgument)assert(packageSourceArgument.startsWith('--package-source-commit='),'Unknown QA source option')
 const sourceComparison=packageSourceArgument?require('./verify-mac-batch120-reuse.cjs').proveReuseSource(sourceCommit,qaSourceCommit):{mode:'identical source',artifactSourceCommit:sourceCommit,qaSourceCommit}
 const identity=readMacPackageIdentity(app,{version:pkg.version,arch,sourceCommit,runtimeVersion:pkg.devDependencies.electron,minimumSystemVersion:'13.0.0'})
 const output=path.resolve(`release/mac-batch120-proof-${arch}-${stage}`);fs.mkdirSync(output,{recursive:true});assert(!fs.existsSync(path.join(output,'proof.json')),'Do not replace an earlier attempt')
 const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'KAMUCL Mac 120 中文 ')))
 const proof={version:pkg.version,arch,stage,sourceCommit,artifactSourceCommit:sourceCommit,qaSourceCommit,sourceComparison,packageIdentity:identity,executable:exe,executableSHA256:hash(exe),startedAt:new Date().toISOString(),complete:false,classification:'Actual signed packaged native Mac foreground, production renderer/IPC and trusted coordinate UI. Artifact and QA commits are recorded separately. Download status events are synthetic visual replays. Community metadata fixtures and actual service interactions are separately classified by the community helper; no original user archives are read or uploaded.',rows:[],errors:[]}
 const save=()=>fs.writeFileSync(path.join(output,'proof.json'),JSON.stringify(proof,null,2))
 save()
 const probe=path.join(output,'native-window-probe'),probeSource=path.resolve('scripts/mac-material-fixture.swift')
 execFileSync('swiftc',[probeSource,'-target','arm64-apple-macos13.0','-o',probe],{timeout:60000})
 execFileSync('lipo',[probe,'-verify_arch','arm64']);execFileSync('codesign',['--force','--sign','-',probe]);execFileSync('codesign',['--verify','--strict',probe])
 proof.nativeProbe={source:'scripts/mac-material-fixture.swift',sourceSHA256:hash(probeSource),executableSHA256:hash(probe),classification:'Actual NSWorkspace frontmost PID and CGWindowList owned window; no simulated focus'};save()
 for(const theme of ['black-orange','blue-white','transparent','custom']){
  const profile=path.join(root,theme),game=path.join(profile,'game');fs.mkdirSync(game,{recursive:true})
  const settings={gameDir:game,activeFolder:game,folders:[{path:game,name:'Owned synthetic QA',isDefault:true}],autoUpdate:false,theme}
  if(theme==='custom')settings.custom={colors:{bg:'#171520',card:'#242232',accent:'#8759cd',text:'#f6f2ff',textDim:'#bcb7cc',border:'#4a455c',sidebarBg:'#201d2b',sidebarText:'#e5dff2',bannerText:'#ffffff'}}
  fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify(settings))
  const communityFixture=await require('./qa-community120.cjs').prepareCommunityProfile({root,profile,game})
  const rendererPort=await port(),mainPort=await port(),logPath=path.join(output,theme+'-process.log'),log=fs.openSync(logPath,'wx'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const child=spawn(exe,[`--user-data-dir=${profile}`,`--inspect=127.0.0.1:${mainPort}`,`--remote-debugging-port=${rendererPort}`],{env,stdio:['ignore',log,log]})
  const track=owned.trackOwnedChild(child,'mac-batch120-'+stage+'-'+theme),row={theme,complete:false,profile,communityFixture,ownedLedger:track.ledger,operations:[],inputEvents:[],screenshots:[],layouts:[]};proof.rows.push(row);save()
  let renderer,main
  try{
   renderer=await connect(rendererPort,false);main=await connect(mainPort,true)
   row.bindingStartedAt=Date.now();row.bindingBudgetMs=10000
   row.bootObserver=await main.evaluate(`(${require('./mac-boot-observer120.cjs').installBootObserver})(${JSON.stringify({pid:track.pid,profile})})`,row.bindingBudgetMs);save()
   row.bindingSamples=[]
   const binding=await bindRenderer(main.evaluate,sample=>{row.bindingSamples.push(sample);save()},wait,row.bindingBudgetMs,row.bindingStartedAt)
   assert.equal(binding.pid,track.pid);assert.equal(binding.arch,arch);assert.equal(binding.version,pkg.version);assert.equal(fs.realpathSync.native(binding.profile),profile);assert.equal(fs.realpathSync.native(binding.executable),fs.realpathSync.native(exe));row.binding=binding;row.actualExecutableSHA256=hash(binding.executable);assert.equal(row.actualExecutableSHA256,proof.executableSHA256)
   const observedNative=async()=>{
    const state=await main.evaluate(`(()=>{const w=testElectron.BrowserWindow.fromId(${binding.windowId});if(!w||w.webContents.id!==${binding.webContentsId})throw Error('Owned window changed');return{pid:process.pid,windowId:w.id,webContentsId:w.webContents.id,bounds:w.getBounds(),contentBounds:w.getContentBounds(),zoom:w.webContents.getZoomFactor(),focused:w.isFocused(),visible:w.isVisible(),minimized:w.isMinimized(),appHidden:testElectron.app.isHidden()}})()`)
    state.frontmostPID=Number(execFileSync(probe,['--front-pid'],{encoding:'utf8',timeout:5000}).trim());assert.equal(state.frontmostPID,binding.pid,'Native foreground belongs to another process')
    state.window=JSON.parse(execFileSync(probe,['--window-id',String(binding.pid)],{encoding:'utf8',timeout:5000}));assert(state.window.id,'Actual owned CGWindow is absent');return state
   }
   await main.evaluate(`(()=>{const w=testElectron.BrowserWindow.fromId(${binding.windowId});testElectron.app.show();w.show();w.focus();return true})()`)
   await renderer.call('Emulation.setFocusEmulationEnabled',{enabled:false})
   const evaluate=renderer.evaluate,call=renderer.call
   const until=async(label,read,accept=Boolean,maximumMs=10000)=>{const operation={label,samples:[],complete:false},end=Date.now()+maximumMs;row.operations.push(operation);save();while(Date.now()<end){const value=typeof read==='function'?await read():await evaluate(read);operation.samples.push({at:Date.now(),value});if(accept(value)){operation.complete=true;save();return value}await wait(80)}save();throw Error(label+' did not reach the required actual state')}
   await until('actual production theme and home',`document.documentElement.dataset.theme===${JSON.stringify(theme)}&&!!document.querySelector('[data-nav=home]')`)
   await evaluate(`(${coordinates.installMacParityObserver})()`)
   row.identity={pid:binding.pid,windowId:binding.windowId,webContentsId:binding.webContentsId};row.documentBinding=await evaluate('({timeOrigin:performance.timeOrigin,url:location.href})')
   const foreground=async()=>{const actual=await observedNative();assert(actual.visible&&actual.focused&&!actual.minimized&&!actual.appHidden);return actual}
   const coordinate=coordinates.createParityCoordinate({call,evaluate,native:observedNative,wait,identity:row.identity,documentBinding:()=>row.documentBinding,proof:row,save})
   const backdropCoordinate=coordinates.createParityCoordinate({call,evaluate,native:observedNative,wait,identity:row.identity,documentBinding:()=>row.documentBinding,proof:row,save,pointerDismissal:true,geometry:{...require('./qa-coordinate-geometry114.cjs'),coordinateExpression:backdropExpression,waitForStableCoordinate:waitForBackdrop}})
   const click=(selector,options)=>coordinate(selector,options)
   const nav=createBatchNavigation({click,until,foreground,evaluate})
   const screenshot=async label=>{
    await foreground();const prefix=theme+'-'+label,pageFile=prefix+'-page.png',nativeFile=prefix+'-native.png'
    const bytes=Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64');fs.writeFileSync(path.join(output,pageFile),bytes,{flag:'wx'})
    const actual=await foreground();execFileSync('/usr/sbin/screencapture',['-x','-l',String(actual.window.id),path.join(output,nativeFile)],{timeout:15000});const after=await foreground();assert.equal(actual.window.id,after.window.id)
    const result={label,page:{file:pageFile,bytes:bytes.length,sha256:hash(path.join(output,pageFile))},native:{file:nativeFile,bytes:fs.statSync(path.join(output,nativeFile)).size,sha256:hash(path.join(output,nativeFile))},foregroundBefore:actual,foregroundAfter:after};row.screenshots.push(result);save();return result
   }
   let opened=false
   for(const[width,height,zoom]of[[960,620,1],[960,620,1.25],[1280,900,1.25]]){
    await main.evaluate(`(()=>{const w=testElectron.BrowserWindow.fromId(${binding.windowId});w.unmaximize();w.setSize(${width},${height});w.webContents.setZoomFactor(${zoom});return true})()`)
    const actual=await until('actual requested window and zoom',observedNative,value=>Math.abs(value.bounds.width-width)<=1&&Math.abs(value.bounds.height-height)<=1&&value.zoom===zoom)
    const layout={requested:{width,height,zoom},actual,states:[]};row.layouts.push(layout);save()
    const texts={tail:'下载资源文件 3574/3575 · 正在处理 minecraft/sounds/fixture120/very-long-folder-name/long-tail-resource-with-a-readable-name.ogg',wait:'下载资源文件 3574/3575 · 下载源限流，24 秒后重试',switching:'下载资源文件 3574/3575 · 下载源限流，切换备用来源'}
    for(const[state,text]of Object.entries(texts)){
     const event={taskId:`mac-ui120-${theme}-${width}-${zoom}`,taskTitle:'导入整合包 · 合成界面验收',stage:'assets',text,progress:.999,overall:.86,parallelStages:[{id:'assets',label:'资源文件',state:'running',progress:.999,text}]}
     await main.evaluate(`testElectron.BrowserWindow.fromId(${binding.windowId}).webContents.send('event:progress',${JSON.stringify(event)});true`)
     if(!opened||!await evaluate("!!document.querySelector('.dl-panel')")){await click(DOWNLOAD_BUTTON);opened=true}
     await until('actual production task receiver text',`document.querySelector('.dl-stage-detail')?.innerText`,value=>value===text)
     const geometry=await evaluate("(()=>{const e=document.querySelector('.dl-stage-detail'),p=document.querySelector('.dl-panel'),b=e.getBoundingClientRect(),r=p.getBoundingClientRect();return{text:e.innerText,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,whiteSpace:getComputedStyle(e).whiteSpace,bodyOverflow:document.documentElement.scrollWidth>innerWidth,panel:r.toJSON(),detail:b.toJSON(),viewport:{width:innerWidth,height:innerHeight}}})()")
     assert.equal(geometry.whiteSpace,'normal');assert(geometry.scrollWidth<=geometry.clientWidth+1);assert(!geometry.bodyOverflow);assert(geometry.detail.y>=geometry.panel.y&&geometry.detail.bottom<=Math.min(geometry.panel.bottom,geometry.viewport.height)+1)
     layout.states.push({state,geometry,screenshot:await screenshot(`${width}-${zoom}-${state}`)});save()
    }
    await main.evaluate(`testElectron.BrowserWindow.fromId(${binding.windowId}).webContents.send('event:installDone',{taskId:${JSON.stringify(`mac-ui120-${theme}-${width}-${zoom}`)},ok:false,error:'下载源限流，可稍后重试：资源文件 minecraft/sounds/fixture120/test.ogg',stage:'assets'});true`)
    await until('actual task failure dismissal',"!!document.querySelector('.dl-error')");await click('.dl-error .dl-dismiss')
    if(await evaluate("!!document.querySelector('.dl-panel')"))await backdropCoordinate(DOWNLOAD_MASK)
    await until('actual download panel closed',"!document.querySelector('.dl-panel')");opened=false
    if(await evaluate("!!document.querySelector('.toast-close')"))await click('.toast-close')
    await until('actual previous terminal toast gone',"!document.querySelector('.toast-close')")
   }
   row.downloadStatus={complete:true,classification:'Synthetic ProgressEvent/terminal messages sent through actual production webContents.send and renderer receiver. Trusted UI interactions and actual window screenshots. No download, rate-limited service or user original failure attribution.'};save()
   const h={root,profile,game,games:game,theme,version:pkg.version,output,call,evaluate,main:main.evaluate,click,nav,wait,until,screenshot,foreground,ownedTrack:track,binding}
   row.community=await require('./qa-community120.cjs')(h,binding);assert.equal(row.community.complete,true);save()
   row.complete=true
  }catch(error){row.error={name:error.name,message:error.message,stack:error.stack};proof.errors.push({theme,...row.error});save()
   if(error.code==='QA_RENDERER_BIND_DEADLINE'&&main){try{row.bootFailureDiagnostic=await require('./mac-boot-failure120.cjs').observeFailedBoot({evaluate:main.evaluate,expected:{pid:track.pid,profile,executable:fs.realpathSync.native(exe),windows:row.bindingSamples.at(-1).windows.filter(w=>['main-renderer','startup-splash'].includes(w.role))},trigger:{code:error.code,bindingStartedAt:row.bindingStartedAt,bindingBudgetMs:row.bindingBudgetMs,failedAt:Date.now(),originalMessage:row.error.message},output,captureDesktop:(file,left)=>execFileSync('/usr/sbin/screencapture',['-x',file],{timeout:Math.max(1,Math.floor(left)),stdio:['ignore','ignore','pipe']})});save()}catch(diagnosticError){row.bootFailureDiagnosticError={name:diagnosticError.name,message:diagnosticError.message};save()}}
  }
  finally{
   if(main)try{row.bootObservation=await main.evaluate('globalThis.__qaBoot120?__qaBoot120.snapshot():null');row.bootObserverRestored=await main.evaluate('globalThis.__qaBoot120?__qaBoot120.restore():({complete:true,absent:true})');save()}catch(error){row.bootObservationError={name:error.name,message:error.message};save()}
   if(main)try{await main.evaluate('setTimeout(()=>testElectron.app.quit(),500);true')}catch(error){row.quitRequestError=String(error)}
   renderer?.ws.close();main?.ws.close()
   try{await owned.finishOwnedChild(track,{timeoutMs:15000});assert.equal(track.ledger.code,0);assert.equal(track.ledger.signal,null)}catch(error){row.complete=false;row.cleanupError=String(error);proof.errors.push({theme,cleanup:row.cleanupError});await owned.finishOwnedChild(track,{terminate:true,timeoutMs:7000}).catch(error=>{row.forcedCleanupError=String(error)})}
   fs.closeSync(log);save()
   try{row.launcherLogs=require('./mac-current-evidence120.cjs').retainLauncherLogs({root,profile,target:path.join(output,theme+'-launcher-logs'),startedAt:Date.parse(track.ledger.startedAt)});save()}catch(error){row.launcherLogCollectionError={name:error.name,message:error.message};save()}
  }
 }
 proof.complete=proof.rows.length===4&&proof.rows.every(row=>row.complete)&&!proof.errors.length;proof.finishedAt=new Date().toISOString();save();assert.equal(proof.complete,true,JSON.stringify(proof.errors));console.log(JSON.stringify({complete:true,output,arch,stage,sourceCommit}))
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1})
module.exports={connect,port,bindRenderer,createBatchNavigation,DOWNLOAD_BUTTON,DOWNLOAD_MASK,backdropExpression,backdropReady}
