// Run the actual packaged app on a disposable native macOS CI runner.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process')
const ownedQA=require('./qa-owned-process-119.cjs')
const appPath=path.resolve(process.argv[2]),arch=process.argv[3],version=require('../package.json').version
assert.equal(process.platform,'darwin');assert.equal(process.arch,arch)
// An independent package-validation job has no prior build output directory.
fs.mkdirSync(path.resolve('out'),{recursive:true})
// Current feature contract, independent of release version: single LOGO mascot and current editor/import/selection behavior.
const mascotProofRevision='119',mascotRecordingKind='logo'
const stage=process.argv[4]||(appPath.split(path.sep).includes('dmg-mount')?'dmg':'app');assert(['app','dmg'].includes(stage),'proof stage must be app or dmg')
const exe=path.join(appPath,'Contents/MacOS/KAMUCL'),proof=path.resolve(`release/mac-proof-${arch}-${stage}`)
fs.mkdirSync(proof,{recursive:true})
const packageIdentity=require('./mac-package-identity.cjs').readMacPackageIdentity(appPath,{version,arch,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),runtimeVersion:require('../package.json').devDependencies.electron,minimumSystemVersion:'13.0.0'})
fs.writeFileSync(path.join(proof,'package-identity.json'),JSON.stringify(packageIdentity,null,2))
const binary=execFileSync('file',[exe],{encoding:'utf8'});assert(binary.includes(arch==='x64'?'x86_64':'arm64'))
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const themes=['transparent','black-orange','blue-white','custom'],themeRuns=[]
const log=fs.openSync(path.join(proof,'process.log'),'w')
const fixtureExe=path.join(proof,'material-fixture'),control=path.join(proof,'material-color.txt')
execFileSync('swiftc',['scripts/mac-material-fixture.swift','-o',fixtureExe])
fs.writeFileSync(control,'black')
const fixture=spawn(fixtureExe,[control],{stdio:'ignore'})
const child=spawn(exe,['--remote-debugging-port=9229'],{env,stdio:['ignore',log,log]})
const ownedTracks=[ownedQA.trackOwnedChild(child,'native-base-app'),ownedQA.trackOwnedChild(fixture,'material-fixture')]
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function gpuFailureDiagnostic(originalError){
 // Observe the same failed process after the formal attempt ends. No startup
 // flags, rendering backend, visibility assertion or frame budget is changed.
 const directory=path.join(proof,'gpu-failure-diagnostic');fs.mkdirSync(directory,{recursive:true})
 const result={classification:'Failure-only diagnostic of the original owned process; not acceptance evidence',formalResultUnchanged:true,pid:child.pid,arch,stage,startedAt:new Date().toISOString(),formalError:{name:originalError.name,message:originalError.message},errors:[]}
 const save=()=>fs.writeFileSync(path.join(directory,'diagnostic.json'),JSON.stringify(result,null,2))
 const get=async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(3000)});assert(response.ok,'diagnostic endpoint '+response.status);return response.json()}
 const query=async(url,method,params={})=>{
  const socket=new WebSocket(url);let timer
  try{return await new Promise((resolve,reject)=>{
   timer=setTimeout(()=>reject(Error(method+' diagnostic timeout')),5000)
   socket.addEventListener('error',()=>reject(Error(method+' diagnostic socket error')),{once:true})
   socket.addEventListener('open',()=>socket.send(JSON.stringify({id:1,method,params})),{once:true})
   socket.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.id===1)value.error?reject(Error(JSON.stringify(value.error))):resolve(value.result)})
  })}finally{clearTimeout(timer);socket.close()}
 }
 save()
 try{fs.writeFileSync(path.join(directory,'graphics.txt'),execFileSync('/usr/sbin/system_profiler',['SPDisplaysDataType'],{timeout:20000,maxBuffer:4*1024*1024}));result.systemProfiler=true}catch(error){result.errors.push({phase:'system-profiler',message:error.message})}
 try{const target=await get('http://127.0.0.1:9229/json/version');result.browser={Browser:target.Browser,'User-Agent':target['User-Agent'],'Protocol-Version':target['Protocol-Version']};result.systemInfo=await query(target.webSocketDebuggerUrl,'SystemInfo.getInfo')}catch(error){result.errors.push({phase:'same-process-gpu-info',message:error.message})}
 try{
  const target=(await get('http://127.0.0.1:9229/json')).find(page=>page.url.includes('/renderer/index.html'));assert(target,'original diagnostic renderer missing')
  const screenshot=await query(target.webSocketDebuggerUrl,'Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});fs.writeFileSync(path.join(directory,'failure-diagnostic.png'),Buffer.from(screenshot.data,'base64'))
  const response=await query(target.webSocketDebuggerUrl,'Runtime.evaluate',{returnByValue:true,expression:`(()=>{const c=document.querySelector('.viewer3d canvas'),r=c?.getBoundingClientRect();const contexts=['webgl2','webgl'].map(kind=>{const canvas=document.createElement('canvas'),errors=[];canvas.addEventListener('webglcontextcreationerror',event=>errors.push(event.statusMessage));try{const context=canvas.getContext(kind),debug=context?.getExtension('WEBGL_debug_renderer_info');const result={kind,created:!!context,creationErrors:errors,renderer:debug?context.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,vendor:debug?context.getParameter(debug.UNMASKED_VENDOR_WEBGL):null};context?.getExtension('WEBGL_lose_context')?.loseContext();return result}catch(error){return{kind,created:false,creationErrors:errors,error:String(error)}}});return{userAgent:navigator.userAgent,viewerCanvas:!!c,fallbackText:document.querySelector('.viewer3d-fallback')?.textContent??null,bounds:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},contexts}})()`});result.renderer=response.exceptionDetails?{exceptionDetails:response.exceptionDetails}:response.result?.value
 }catch(error){result.errors.push({phase:'original-renderer-context',message:error.message})}
 result.finishedAt=new Date().toISOString();save()
}
async function main(){
 let page
 for(let i=0;i<60;i++){
  assert(child.exitCode===null,'packaged app exited early: '+child.exitCode)
  try{page=(await(await fetch('http://127.0.0.1:9229/json')).json()).find(p=>p.url.includes('/renderer/index.html'));if(page)break}catch{}
  await wait(1000)
 }
 assert(page,'main renderer did not load')
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})})
 let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}})
 const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>reject(Error(method+' timeout')),15000);pending.set(n,m=>{clearTimeout(timer);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result)});ws.send(JSON.stringify({id:n,method,params}))})
 let content=''
 for(let i=0;i<30;i++){try { const r=await call('Runtime.evaluate',{expression:'document.body.innerText',returnByValue:true});content=r.result.value||''; } catch(e) { if(!String(e).includes('Cannot find default execution context'))throw e; }if(content.includes('首页')&&content.includes(version))break;await wait(1000)}
 assert(content.includes('首页')&&content.includes(version),'main UI missing')
 const userAgent=(await call('Runtime.evaluate',{expression:'navigator.userAgent',returnByValue:true})).result.value
 assert(userAgent.includes('Electron/'+require('../package.json').devDependencies.electron),'native APP must use the current shared locked Electron runtime')
 const checks=await call('Runtime.evaluate',{expression:`(async()=>{const folders=await window.kamucl.invoke('folders:list');const scan=await window.kamucl.invoke('folders:scan',folders.active);return {platform:document.documentElement.dataset.platform,customButtons:document.querySelectorAll('.win-btn').length,logoTop:document.querySelector('.logo-area').getBoundingClientRect().top,folderStatus:scan.status,folderPath:folders.active}})()`,awaitPromise:true,returnByValue:true});
 const macUI=checks.result.value;assert.equal(macUI.platform,'darwin');assert.equal(macUI.customButtons,0);assert(macUI.logoTop>=38,'native traffic light area overlaps branding');assert.equal(macUI.folderStatus,'ready','default folder missing on first launch');
 await wait(3000)
 const screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(proof,'main.png'),Buffer.from(screenshot.data,'base64'))
 // Inspect rendered default-skin pixels; a live WebGL context alone would miss the old faceless fallback.
 const measureSkin=async()=>{
  const result=await call('Runtime.evaluate',{expression:`(()=>{const c=document.querySelector('.viewer3d canvas');const r=c?.getBoundingClientRect(),v=window.visualViewport,content=document.querySelector('.content');return r?{bounds:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:v?.width||innerWidth,height:v?.height||innerHeight,offsetLeft:v?.offsetLeft||0,offsetTop:v?.offsetTop||0,innerWidth,innerHeight,devicePixelRatio},documentHidden:document.hidden,visibilityState:document.visibilityState,scroll:content?{top:content.scrollTop,height:content.clientHeight,scrollHeight:content.scrollHeight}:null}:null})()`,returnByValue:true})
  return result.result.value
 }
 const skinReadiness={source:'real scrollIntoView and repeated viewport/canvas measurements before and after the complete visible frame',samples:[],captures:[]}
 let skinBounds,skinShot,previous='',stable=0
 const signature=value=>JSON.stringify({bounds:value?.bounds,viewport:value?.viewport})
 try{
  for(let captureAttempt=0;captureAttempt<3;captureAttempt++){
   previous='';stable=0
   for(let i=0;i<30;i++){
    // Native first-launch resizing can finish after the initial screenshot and
    // move the responsive account card below the viewport. Re-scroll using the
    // actual current layout rather than relying on one earlier scroll request.
    await call('Runtime.evaluate',{expression:`document.querySelector('.viewer3d')?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`});await wait(160)
    skinBounds=await measureSkin();const b=skinBounds?.bounds,v=skinBounds?.viewport
    const visible=!!b&&b.width>0&&b.height>0&&b.x>=v.offsetLeft&&b.y>=v.offsetTop&&b.x+b.width<=v.offsetLeft+v.width&&b.y+b.height<=v.offsetTop+v.height
    const current=signature(skinBounds);stable=visible&&current===previous?stable+1:0;previous=current
    skinReadiness.samples.push({captureAttempt,sample:i,visible,stable,...skinBounds});fs.writeFileSync(path.join(proof,'default-skin-readiness.json'),JSON.stringify(skinReadiness,null,2))
    if(stable>=1)break
   }
   assert(stable>=1,'skin canvas never reached a fully visible stable viewport')
   skinShot=await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})
   fs.writeFileSync(path.join(proof,'default-skin-frame.png'),Buffer.from(skinShot.data,'base64'))
   const after=await measureSkin(),matched=signature(after)===signature(skinBounds)
   skinReadiness.captures.push({captureAttempt,before:skinBounds,after,matched});fs.writeFileSync(path.join(proof,'default-skin-readiness.json'),JSON.stringify(skinReadiness,null,2))
   if(matched)break
   skinShot=undefined
  }
  assert(skinShot,'skin viewport/canvas changed during every screenshot attempt')
 }catch(error){console.error('Default skin capture readiness diagnostics',JSON.stringify(skinReadiness,null,2));throw error}
 const sharp=require('sharp'),{bounds,viewport}=skinBounds
 // A separately clipped CDP screenshot can return a black GPU surface on macOS
 // despite the visible WebGL texture being present in the complete compositor
 // frame. Capture the current full visible frame, then crop its actual pixels.
 const skinFrame=Buffer.from(skinShot.data,'base64');fs.writeFileSync(path.join(proof,'default-skin-frame.png'),skinFrame)
 const frameMeta=await sharp(skinFrame).metadata(),frameWidth=frameMeta.width,frameHeight=frameMeta.height
 assert(frameWidth>0&&frameHeight>0&&viewport.width>0&&viewport.height>0,'skin capture dimensions invalid')
 const scaleX=frameWidth/viewport.width,scaleY=frameHeight/viewport.height
 const raw={left:Math.floor((bounds.x-viewport.offsetLeft)*scaleX),top:Math.floor((bounds.y-viewport.offsetTop)*scaleY),right:Math.ceil((bounds.x+bounds.width-viewport.offsetLeft)*scaleX),bottom:Math.ceil((bounds.y+bounds.height-viewport.offsetTop)*scaleY)}
 const left=Math.max(0,Math.min(frameWidth,raw.left)),top=Math.max(0,Math.min(frameHeight,raw.top)),right=Math.max(left,Math.min(frameWidth,raw.right)),bottom=Math.max(top,Math.min(frameHeight,raw.bottom))
 const crop={left,top,width:right-left,height:bottom-top}
 const skinCapture={source:'Page.captureScreenshot full visible compositor frame, cropped with sharp',frame:'default-skin-frame.png',readiness:'default-skin-readiness.json',bounds,viewport,frameSize:{width:frameWidth,height:frameHeight},scale:{x:scaleX,y:scaleY},rawCrop:raw,crop,clamped:raw.left!==left||raw.top!==top||raw.right!==right||raw.bottom!==bottom}
 fs.writeFileSync(path.join(proof,'default-skin-capture.json'),JSON.stringify(skinCapture,null,2))
 assert(crop.width>0&&crop.height>0,'skin canvas is outside the captured visible frame')
 const croppedSkin=await sharp(skinFrame).extract(crop).png().toBuffer();fs.writeFileSync(path.join(proof,'default-skin.png'),croppedSkin)
 const skinPixels=await sharp(croppedSkin).removeAlpha().raw().toBuffer()
 let facePixels=0,shirtPixels=0
 for(let i=0;i<skinPixels.length;i+=3){const [r,g,b]=skinPixels.subarray(i,i+3);if(r>140&&r>g*1.12&&g>b*1.05)facePixels++;if(g>85&&g>r*1.25&&b>r*1.2)shirtPixels++}
 fs.writeFileSync(path.join(proof,'default-skin-capture.json'),JSON.stringify({...skinCapture,facePixels,shirtPixels},null,2))
 assert(facePixels>20&&shirtPixels>20,'default skin texture not rendered')
 // Shared current dark themes use the same translucent shell; exercise native desktop material.
 await call('Runtime.evaluate',{expression:`window.kamucl.invoke('settings:set',{theme:'black-orange'})`,awaitPromise:true})
 // Settings IPC persists state; the normal settings view updates its Vue store.
 // Reload to exercise the same saved-theme startup path without poking Vue internals.
 await call('Page.reload');await wait(3000)
 console.log('Material theme',await call('Runtime.evaluate',{expression:`({theme:document.documentElement.dataset.theme,surface:getComputedStyle(document.querySelector('.shell')).backgroundColor})`,returnByValue:true}))
 // Page.captureScreenshot excludes the OS blur. Capture the actual NSWindow over two backgrounds.
 let nativeMaterial
 try {
   const nativeWindow=JSON.parse(execFileSync(fixtureExe,['--window-id',String(child.pid)],{encoding:'utf8'}))
   console.log('Native material environment',nativeWindow)
   for(const color of ['black','white']){
     fs.writeFileSync(control,color+'|'+nativeWindow.id);await wait(2000)
     // A window-only capture omits behind-window composition. Capture the real display first.
     const screen=path.join(proof,`desktop-${color}.png`)
     execFileSync('/usr/sbin/screencapture',['-x','-D','1',screen])
     const meta=await sharp(screen).metadata(),scale=meta.width/nativeWindow.screenWidth,b=nativeWindow.bounds
     await sharp(screen).extract({left:Math.round(b.X*scale),top:Math.round(b.Y*scale),width:Math.round(b.Width*scale),height:Math.round(b.Height*scale)}).toFile(path.join(proof,`native-${color}.png`))
   }
   nativeMaterial={captured:true,reducedTransparency:nativeWindow.reducedTransparency}
 } catch(e) { throw new Error('Native screen capture failed: '+e.message) }
 if(nativeMaterial.captured){
   assert.equal(nativeMaterial.reducedTransparency,false,'CI must enable transparency to verify native material')
   const samples=[]
   for(const color of ['black','white']){
     const image=sharp(path.join(proof,`native-${color}.png`)),meta=await image.metadata()
     // Empty centre of the title bar, away from branding, controls and character animation.
     const region=await image.extract({left:Math.floor(meta.width*.5),top:Math.floor(meta.height*.025),width:30,height:12}).removeAlpha().toBuffer()
     const stats=await sharp(region).stats()
     samples.push(stats.channels.slice(0,3).map(c=>c.mean))
   }
   nativeMaterial.samples=samples;nativeMaterial.difference=Math.max(...samples[0].map((v,i)=>Math.abs(v-samples[1][i])))
   assert(nativeMaterial.difference>2,'native macOS window still opaque over changing desktop background')
 }
 await call('Runtime.evaluate',{expression:`window.kamucl.invoke('settings:set',{theme:'transparent'})`,awaitPromise:true})
 fs.writeFileSync(path.join(proof,'verification.json'),JSON.stringify({version,arch,stage,packageIdentity,binary,userAgent,mainUI:true,macUI,skin:{facePixels,shirtPixels,capture:skinCapture},nativeMaterial,url:page.url},null,2));ws.close()
 console.log('PASS native macOS '+arch+' packaged app '+version)
}
ownedQA.preservingCleanup(async()=>{
 try{return await main()}catch(error){try{await gpuFailureDiagnostic(error)}catch(diagnosticError){console.warn('Failure diagnostic could not complete; original error retained',diagnosticError.message)}throw error}
},async()=>{
 const cleanup={classification:'Owned QA lifecycle only; no external process signalling',before:await ownedQA.ownedInventory(ownedTracks),children:ownedTracks.map(t=>t.ledger)}
 const results=await Promise.allSettled(ownedTracks.map(t=>ownedQA.finishOwnedChild(t,{terminate:true,timeoutMs:5000})))
 cleanup.after=await ownedQA.ownedInventory(ownedTracks,cleanup.before.rows?.map(r=>r.pid));cleanup.complete=results.every(r=>r.status==='fulfilled')
 fs.closeSync(log);fs.writeFileSync(path.join(proof,'owned-process-cleanup.json'),JSON.stringify(cleanup,null,2))
 const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);if(errors.length)throw new AggregateError(errors,'owned native base cleanup failed')
}).then(()=>{
 // The existing native workflow calls this script for both the APP and mounted DMG.
 // Keep the common-feature checks here so they cannot be omitted by a workflow step.
 const extensionProof=path.join(proof,'extensions');fs.mkdirSync(extensionProof,{recursive:true})
 const requiredProofs=['extension-ui-black-orange.json','skin-palette-ui-black-orange.json','mascot-header-ui-black-orange.json','gallery-favorites-ui-black-orange.json','skin-editor-ui-black-orange.json','gallery-favorites-118-ui-black-orange.json','import-routing-119-ui-black-orange.json','selection-ui-119-black-orange.json','kamu-motion-diagnostic-119-cold-black-orange.json','kamu-motion-diagnostic-119-after-header-black-orange.json','kamu-native-recorder-diagnostic-119-'+stage+'-black-orange.json']
 const proofNames=[...requiredProofs,'native-gui-focus-live.json','skin-palette-ready-live.json','skin-palette-preference-live.json','main-inspector-ready-live.json','mascot-header-keyboard-ready-live.json','mascot-header-performance-live.json','mascot-header-performance-diagnostic.json','mascot-header-timeline.json','mascot-header-timeline-raw.json','mascot-header-native-focus-live.json','mascot-header-reverse-live.json','mascot-header-body-sweep-live.json','mascot-header-layout-live.json','mascot-header-visibility-live.json','mascot-header-persistence-live.json','mascot-header-overlap-live.json','mascot-header-screencast-live.json','gallery-favorites-motion-live.json','mascot-slap-117.wav','mascot-sweep-117.webm','mascot-slap-118.wav','mascot-sweep-118.webm','mascot-motion-118.webm','mascot-kamu-119.webm'],shots='release/ui-refinement-black-orange'
 const attemptStarted=Date.now(),fresh=file=>fs.existsSync(file)&&fs.statSync(file).mtimeMs>=attemptStarted
 const currentEvidence=require('./mac-current-evidence120.cjs'),currentEvidenceBefore=currentEvidence.snapshot(path.resolve('out'))
 {
  requiredProofs.push('skin-palette-state-119-black-orange.json')
  proofNames.push('skin-palette-state-119-black-orange.json','kamu-native-compositor-trace-119.json','kamu-native-compositor-trace-119-events.json','kamu-native-compositor-trace-action.json','kamu-native-compositor-trace-observations.json','kamu-native-compositor-trace-preflight.json','kamu-motion-diagnostic-119-native-trace-black-orange.json')
 }
 let extensionError,complete=false,performanceBenchmark=null,nativeVideoEvidence=null,observerABA119=null,currentEvidenceComplete=false
 try{
  // Explicit opt-in diagnostic-only preflight. It uses a separate process/profile and
  // can never supply acceptance success. Preserve its receipt even if tracing
  // or a later independent normal GUI run fails/times out. Previously collected
  // traces remain evidence; repeating optional trace/ABA experiments by default
  // must not consume the workflow budget needed by required native checks.
  if(process.env.KAMUCL_NATIVE_TRACE119==='1'){
   const began=Date.now(),preflight={version,arch,stage,classification:'instrumented diagnostic only; not normal motion acceptance',startedAt:new Date(began).toISOString(),timeoutMs:180000,complete:false}
   console.log('DIAGNOSTIC native-trace preflight start '+preflight.startedAt)
   try{execFileSync(process.execPath,['scripts/verify-ui-refinement.cjs'],{env:{...env,KAMUCL_GUI_APP:exe,KAMUCL_EXTENSION_GUI:'1',KAMUCL_EXTENSION_ONLY:'1',KAMUCL_SKIP_EXTENSION_BASE:'1',KAMUCL_UI_MODULE:'native-trace',KAMUCL_TEST_THEME:'black-orange'},stdio:'inherit',timeout:180000});preflight.complete=true}
   catch(error){preflight.error={name:error.name,code:error.code??null,status:error.status??null,signal:error.signal??null};console.warn('DIAGNOSTIC native-trace preflight failed; normal acceptance remains independently required',preflight.error)}
   finally{preflight.endedAt=new Date().toISOString();preflight.elapsedMs=Date.now()-began;fs.writeFileSync(path.join('out','kamu-native-compositor-trace-preflight.json'),JSON.stringify(preflight,null,2));console.log('DIAGNOSTIC native-trace preflight end '+preflight.endedAt+' elapsedMs='+preflight.elapsedMs)}
  }
  // Separate disposable process starts native mascot audio cold, without the full
  // header's MediaRecorder/tap hooks. Preserve its diagnostic evidence separately.
  execFileSync(process.execPath,['scripts/verify-ui-refinement.cjs'],{env:{...env,KAMUCL_GUI_APP:exe,KAMUCL_EXTENSION_GUI:'1',KAMUCL_EXTENSION_ONLY:'1',KAMUCL_SKIP_EXTENSION_BASE:'1',KAMUCL_UI_MODULE:'motion119',KAMUCL_TEST_THEME:'black-orange'},stdio:'inherit',timeout:180000})
  execFileSync(process.execPath,['scripts/verify-ui-refinement.cjs'],{
   env:{...env,KAMUCL_GUI_APP:exe,KAMUCL_EXTENSION_GUI:'1',KAMUCL_EXTENSION_ONLY:'1',KAMUCL_TEST_THEME:'black-orange',KAMUCL_NATIVE_RECORDER_STAGE119:stage,KAMUCL_NATIVE_VIDEO_STAGE119:stage},
   stdio:'inherit',timeout:480000
  })
  // An optional recorder may fail, but its current failure receipt must still be
  // archived. A successful GUI process alone cannot prove its raw evidence exists.
  nativeVideoEvidence=require('./native-video-evidence-119.cjs')({root:'out',version,stage,startedAt:attemptStarted})
  for(const name of requiredProofs){const file=path.join('out',name);assert(fresh(file),'successful GUI run is missing current proof '+name);const result=JSON.parse(fs.readFileSync(file));assert.equal(result.version,version,'GUI proof must match this build: '+name);if('complete' in result)assert.equal(result.complete,true,'GUI proof must be complete: '+name)}
  {
   const ledger=JSON.parse(fs.readFileSync('out/skin-palette-state-119-black-orange.json'))
   assert.equal(ledger.saveHandlerRestored,true,'palette QA must restore the original save handler')
   assert.equal(ledger.saves.length,2,'palette acceptance must retain both original exports')
   for(const save of ledger.saves){const file=path.join('out','skin-palette-export-119-black-orange-'+save.sequence+'.png');assert(fresh(file),'missing actual palette PNG '+file);const bytes=fs.readFileSync(file);assert.equal(bytes.length,save.export?.bytes);assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'),save.export?.sha256,'palette export bytes must match original save');assert.equal(save.export?.dimensions?.width,64);assert.equal(save.export?.dimensions?.height,64);assert.equal(save.ready,true)}
  }
  const frameManifest=path.join('out',`mascot-${mascotProofRevision}-frames-black-orange`,'frames.json');assert(fresh(frameManifest),'successful GUI run is missing current compositor frame manifest');assert.equal(JSON.parse(fs.readFileSync(frameManifest)).version,version,'compositor frames must match this build')
  const recordingManifest=path.join('out',`mascot-${mascotProofRevision}-${mascotRecordingKind}-screencast-black-orange`,'recording.json');assert(fresh(recordingManifest),'successful GUI run is missing current actual screencast');const recording=JSON.parse(fs.readFileSync(recordingManifest));assert.equal(recording.version,version)
  const cadenceFile=path.join('out','mascot-header-screencast-live.json');assert(fresh(cadenceFile),'successful GUI run is missing current native display cadence proof');const cadence=JSON.parse(fs.readFileSync(cadenceFile)),budget=require('./mascot-capture-budget.cjs')({activeDisplay:cadence.activeDisplay},recording.fps);assert.equal(cadence.actualFps,recording.fps,'native display cadence must refer to this exact recording');assert.equal(cadence.minimumFps,budget.minimumFps,'wrapper and GUI must use the same native display capture target');assert.equal(cadence.passed,budget.passed,'benchmark passed result must match actual capture');assert.equal(cadence.frameRatePassed,budget.passed,'capture result cannot hide a below-target benchmark');assert(recording.frames.length>=2&&Number.isFinite(recording.fps)&&recording.fps>0&&recording.elapsed>0,'capture evidence must include multiple real frames and valid timing');performanceBenchmark={...budget,status:budget.passed?'passed':'below-target'};if(!budget.passed)console.warn('BENCHMARK BELOW TARGET: native compositor capture '+recording.fps+' fps < '+budget.minimumFps+' fps; functional completeness is reported independently')
  for(const theme of themes){
   const startedAt=Date.now(),row={theme,startedAt:new Date(startedAt).toISOString(),complete:false};themeRuns.push(row)
   try{
    execFileSync(process.execPath,['scripts/verify-ui-refinement.cjs'],{env:{...env,KAMUCL_GUI_APP:exe,KAMUCL_EXTENSION_GUI:'1',KAMUCL_EXTENSION_ONLY:'1',KAMUCL_SKIP_EXTENSION_BASE:'1',KAMUCL_UI_MODULE:'ux110',KAMUCL_TEST_THEME:theme},stdio:'inherit',timeout:240000})
    const file=path.join('out','appearance-motion-'+theme+'-110.json');assert(fs.existsSync(file)&&fs.statSync(file).mtimeMs>=startedAt,'current native theme proof missing')
    const result=JSON.parse(fs.readFileSync(file));assert.equal(result.version,version);assert.equal(result.complete,true);assert.equal(result.theme,theme)
    row.complete=true;row.result=result
   }finally{row.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(extensionProof,'themes.json'),JSON.stringify({version,arch,stage,complete:themeRuns.length===themes.length&&themeRuns.every(row=>row.complete),runs:themeRuns},null,2))}
  }
  complete=true

 }catch(error){extensionError=String(error);throw error}
 finally{
  // Failed GUI runs must retain their last real layout/visibility snapshot and
  // screenshots in the uploaded artifact, not only in the ephemeral runner.
  const copied=[]
  const currentOwnedEvidence=currentEvidence.retainCurrent({out:path.resolve('out'),target:extensionProof,before:currentEvidenceBefore,startedAt:attemptStarted})
  currentEvidenceComplete=currentOwnedEvidence.complete
  fs.writeFileSync(path.join(extensionProof,'current-owned-evidence.json'),JSON.stringify(currentOwnedEvidence,null,2))
  if(!currentOwnedEvidence.complete){complete=false;console.warn('Current owned evidence collection failed; original GUI failure is retained',currentOwnedEvidence.errors)}
  for(const name of proofNames)if(fresh(path.join('out',name))){fs.copyFileSync(path.join('out',name),path.join(extensionProof,name==='extension-ui-black-orange.json'?'results.json':name));copied.push(name)}
  const frames=path.join('out',`mascot-${mascotProofRevision}-frames-black-orange`),frameProof=path.join(extensionProof,`mascot-${mascotProofRevision}-frames-black-orange`)
  if(fs.existsSync(frames))for(const name of fs.readdirSync(frames))if((name==='frames.json'||/^frame-\d+\.png$/.test(name))&&fresh(path.join(frames,name))){fs.mkdirSync(frameProof,{recursive:true});fs.copyFileSync(path.join(frames,name),path.join(frameProof,name));copied.push(`mascot-${mascotProofRevision}-frames-black-orange/`+name)}
  const recording=path.join('out',`mascot-${mascotProofRevision}-${mascotRecordingKind}-screencast-black-orange`),recordingProof=path.join(extensionProof,`mascot-${mascotProofRevision}-${mascotRecordingKind}-screencast-black-orange`)
  if(fs.existsSync(recording))for(const name of fs.readdirSync(recording))if((name==='recording.json'||/^frame-\d+\.jpg$/.test(name))&&fresh(path.join(recording,name))){fs.mkdirSync(recordingProof,{recursive:true});fs.copyFileSync(path.join(recording,name),path.join(recordingProof,name));copied.push(`mascot-${mascotProofRevision}-${mascotRecordingKind}-screencast-black-orange/`+name)}
  {const intro=path.join('out','mascot-119-logo-intro-black-orange'),introProof=path.join(extensionProof,'mascot-119-logo-intro-black-orange');if(fs.existsSync(intro))for(const name of fs.readdirSync(intro))if((name==='recording.json'||/^frame-\d+\.jpg$/.test(name))&&fresh(path.join(intro,name))){fs.mkdirSync(introProof,{recursive:true});fs.copyFileSync(path.join(intro,name),path.join(introProof,name));copied.push('mascot-119-logo-intro-black-orange/'+name)}}
  for(const mode of ['cold','after-header','native-trace'])for(const kind of ['cold-intro','first-native','warm-native','warm-no-backdrop','warm-restored-backdrop']){const name='kamu-motion-119-'+mode+'-'+kind+'-black-orange',dir=path.join('out',name),target=path.join(extensionProof,name);if(fs.existsSync(dir))for(const item of fs.readdirSync(dir))if((item==='recording.json'||/^frame-\d+\.jpg$/.test(item))&&fresh(path.join(dir,item))){fs.mkdirSync(target,{recursive:true});fs.copyFileSync(path.join(dir,item),path.join(target,item));copied.push(name+'/'+item)}}
  for(const phase of ['original-sidebar','without-vibrancy','restored-sidebar']){const name='kamu-native-compositor-119-'+phase+'-black-orange',dir=path.join('out',name),target=path.join(extensionProof,name);if(fs.existsSync(dir))for(const item of fs.readdirSync(dir))if((item==='recording.json'||/^frame-\d+\.jpg$/.test(item))&&fresh(path.join(dir,item))){fs.mkdirSync(target,{recursive:true});fs.copyFileSync(path.join(dir,item),path.join(target,item));copied.push(name+'/'+item)}}
  for(const phase of ['recorder-on','recorder-off','recorder-restored']){const name='kamu-native-recorder-119-'+stage+'-'+phase+'-black-orange',dir=path.join('out',name),target=path.join(extensionProof,name);if(fs.existsSync(dir))for(const item of fs.readdirSync(dir))if((item==='recording.json'||/^frame-\d+\.jpg$/.test(item))&&fresh(path.join(dir,item))){fs.mkdirSync(target,{recursive:true});fs.copyFileSync(path.join(dir,item),path.join(target,item));copied.push(name+'/'+item)}}
  for(const phase of ['original-sidebar-before','original-sidebar-after','without-vibrancy-before','without-vibrancy-after','restored-sidebar-before','restored-sidebar-after','finally-restored']){const name='kamu-native-compositor-119-'+phase+'-native-black-orange.png';if(fresh(path.join('out',name))){fs.copyFileSync(path.join('out',name),path.join(extensionProof,name));copied.push(name)}}
  for(const phase of ['recorder-on','recorder-off','recorder-restored'])for(const when of ['before','after']){const name='extension-native-recorder-119-'+stage+'-'+phase+'-'+when+'-black-orange.png';if(fresh(path.join('out',name))){fs.copyFileSync(path.join('out',name),path.join(extensionProof,name));copied.push(name)}}
  {
   const name='kamu-native-video-diagnostic-119-'+stage+'-black-orange.json';if(fresh(path.join('out',name))){fs.copyFileSync(path.join('out',name),path.join(extensionProof,name));copied.push(name)}
   const dirName='kamu-native-video-119-'+stage+'-black-orange',dir=path.join('out',dirName),target=path.join(extensionProof,dirName);
   if(fs.existsSync(dir))for(const item of fs.readdirSync(dir))if(/^(?:frame-\d{6}\.(?:bgra|png|json)|(?:capture|ready|failure|identity|request|clicks-start|action-complete)\.json|(?:helper|compile)\.log)$/.test(item)&&fresh(path.join(dir,item))){fs.mkdirSync(target,{recursive:true});fs.copyFileSync(path.join(dir,item),path.join(target,item));copied.push(dirName+'/'+item)}
  }
  for(const name of fs.readdirSync('out'))if(/^extension-118-skin-dirty-fixture-(?:native|compositor)-failure-\d+-black-orange\.png$/.test(name)&&fresh(path.join('out',name))){fs.copyFileSync(path.join('out',name),path.join(extensionProof,name));copied.push(name)}
  for(const name of fs.readdirSync('out'))if(/^(?:extension-118-skin-palette-state-(?:native|compositor)-failure-black-orange|skin-palette-export-119-black-orange-(?:\d+|latest-success))\.png$/.test(name)&&fresh(path.join('out',name))){fs.copyFileSync(path.join('out',name),path.join(extensionProof,name));copied.push(name)}
  if(fs.existsSync(shots))for(const name of fs.readdirSync(shots))if(name.startsWith('extension-')&&name.endsWith('.png')&&fresh(path.join(shots,name))){fs.copyFileSync(path.join(shots,name),path.join(extensionProof,name));copied.push(name)}
  for(const theme of themes){
   for(const dir of [path.join('release','ui-refinement-'+theme),path.join('out','skin-walk-110-'+theme)])if(fs.existsSync(dir)){
    const target=path.join(extensionProof,'current-themes',theme,path.basename(dir));fs.mkdirSync(target,{recursive:true})
    for(const name of fs.readdirSync(dir))if(/^(?:110-.*\.png|recording\.json|frame-\d+\.jpg)$/.test(name)&&fresh(path.join(dir,name))){fs.copyFileSync(path.join(dir,name),path.join(target,name));copied.push('current-themes/'+theme+'/'+path.basename(dir)+'/'+name)}
   }
   const file=path.join('out','appearance-motion-'+theme+'-110.json');if(fresh(file)){const target=path.join(extensionProof,'current-themes',theme);fs.mkdirSync(target,{recursive:true});fs.copyFileSync(file,path.join(target,path.basename(file)))}
   // Preserve every original SCK callback/pixel sidecar plus the explicitly
   // derived lossless PNG projection. Never recurse into a profile or include
   // the compiled capture helper or request/stop text markers.
   const nativeName='skin-walk-native-111-'+theme,nativeDir=path.join('out',nativeName),nativeTarget=path.join(extensionProof,'current-themes',theme,nativeName)
   if(fs.existsSync(nativeDir)){
    assert(fs.lstatSync(nativeDir).isDirectory(),'native walking evidence directory cannot be a link')
    for(const name of fs.readdirSync(nativeDir))if(/^(?:frame-\d{6}\.(?:bgra|png|json)|(?:capture|ready|failure|identity|request|png-projection)\.json|(?:helper|compile)\.log)$/.test(name)&&fresh(path.join(nativeDir,name))){
     const source=path.join(nativeDir,name);assert(fs.lstatSync(source).isFile(),'native walking evidence must be a regular original file')
     fs.mkdirSync(nativeTarget,{recursive:true});fs.copyFileSync(source,path.join(nativeTarget,name),fs.constants.COPYFILE_EXCL);copied.push('current-themes/'+theme+'/'+nativeName+'/'+name)
    }
   }
   const nativeReceipt=path.join('out',nativeName+'.json');if(fresh(nativeReceipt)){assert(fs.lstatSync(nativeReceipt).isFile(),'native walking receipt must be a regular file');const target=path.join(extensionProof,'current-themes',theme);fs.mkdirSync(target,{recursive:true});fs.copyFileSync(nativeReceipt,path.join(target,path.basename(nativeReceipt)),fs.constants.COPYFILE_EXCL);copied.push('current-themes/'+theme+'/'+path.basename(nativeReceipt))}
  }
  const nativeAccepted=complete&&performanceBenchmark?.passed===true&&nativeVideoEvidence?.complete===true&&nativeVideoEvidence.nativeDeliveryBenchmark?.passed===true
  fs.writeFileSync(path.join(extensionProof,'attempt.json'),JSON.stringify({version,arch,stage,complete,functionalComplete:complete,nativeAccepted,performanceBenchmark,performancePassed:performanceBenchmark?.passed??null,nativeVideoEvidence,observerABA119,acceptance:'functional and both original capture benchmarks required; independent visual, interaction and motion review is separate',error:extensionError||null,startedAt:new Date(attemptStarted).toISOString(),executable:exe,copied},null,2))
  // Current owned lifecycle receipts were retained by the exact UUID collector
  // above; do not include unrelated/history files solely because mtime is new.
  // One separate, disposable Intel APP diagnostic after archiving the normal
  // result, including its original failure. Diagnostics cannot replace it.
  // Keep workflow permissions/budget and all formal capture assertions intact.
  if(process.env.KAMUCL_MAC_DIAGNOSTICS==='1'&&arch==='x64'&&stage==='app'&&process.env.CI==='true'){
   const began=Date.now();observerABA119={classification:'Independent instrumentation-only observer A/B/A; not formal acceptance',startedAt:new Date(began).toISOString(),timeoutMs:180000,complete:false,normalAcceptanceChanged:false}
   console.log('DIAGNOSTIC observer ABA start '+observerABA119.startedAt)
   try{execFileSync(process.execPath,['scripts/verify-ui-refinement.cjs'],{env:{...env,KAMUCL_GUI_APP:exe,KAMUCL_EXTENSION_GUI:'1',KAMUCL_EXTENSION_ONLY:'1',KAMUCL_SKIP_EXTENSION_BASE:'1',KAMUCL_UI_MODULE:'native-compositor',KAMUCL_OBSERVER_ABA119:'1',KAMUCL_TEST_THEME:'black-orange'},stdio:'inherit',timeout:observerABA119.timeoutMs});observerABA119.processExitCode=0}
   catch(error){observerABA119.error={name:error.name,code:error.code??null,status:error.status??null,signal:error.signal??null};console.warn('DIAGNOSTIC observer ABA failed; original formal results remain unchanged',observerABA119.error)}
   finally{
    observerABA119.finishedAt=new Date().toISOString();observerABA119.elapsedMs=Date.now()-began;observerABA119.directories=[]
    try{for(const name of fs.readdirSync('out').filter(name=>/^kamu-observer-aba-119-[0-9a-f-]{36}-black-orange$/.test(name))){
     const source=path.join('out',name),ledger=path.join(source,'observer-aba.json');if(!fresh(ledger))continue
     const result=JSON.parse(fs.readFileSync(ledger));if(Date.parse(result.startedAt)<began)continue
     const target=path.join(extensionProof,name),copy=(from,to)=>{fs.mkdirSync(to,{recursive:true});for(const entry of fs.readdirSync(from,{withFileTypes:true})){assert(!entry.isSymbolicLink(),'no symlink in diagnostic evidence');const src=path.join(from,entry.name),dst=path.join(to,entry.name);if(entry.isDirectory())copy(src,dst);else if(/\.(?:json|bgra|png|log)$/.test(entry.name))fs.copyFileSync(src,dst)}}
     copy(source,target);observerABA119.directories.push({name,complete:result.complete===true,source:'Original independent UUID directory; compiled helper digest retained in compile ledger, helper binary and request marker text excluded'})
    }}catch(error){observerABA119.collectionError=String(error);console.warn('DIAGNOSTIC evidence collection failed; original formal result remains unchanged',observerABA119.collectionError)}
    observerABA119.complete=!observerABA119.collectionError&&observerABA119.processExitCode===0&&observerABA119.directories.length===1&&observerABA119.directories.every(entry=>entry.complete)
    try{fs.writeFileSync(path.join(extensionProof,'observer-aba-preflight.json'),JSON.stringify(observerABA119,null,2))}catch(error){console.warn('DIAGNOSTIC summary write failed; original formal result remains unchanged',String(error))}console.log('DIAGNOSTIC observer ABA end '+observerABA119.finishedAt+' elapsedMs='+observerABA119.elapsedMs)
   }
  }
  // Only after DMG formal proofs are archived, in a separate owned process.
  // The helper bounds 85s execution + 5s cleanup and excludes private CPU data.
  if(process.env.KAMUCL_MAC_DIAGNOSTICS==='1')require('./native-trace-control-preflight-119.cjs').run({version,arch,stage,ci:process.env.CI,env,exe,extensionProof})

 }
 assert.equal(currentEvidenceComplete,true,'current owned evidence could not be retained; collection errors recorded')
 assert.equal(performanceBenchmark?.passed,true,'original native CDP recording is below its unchanged display capture target; evidence retained')
 assert.equal(nativeVideoEvidence?.complete,true,'original ScreenCaptureKit capture did not complete; failure evidence retained')
 assert.equal(nativeVideoEvidence.nativeDeliveryBenchmark?.passed,true,'original ScreenCaptureKit recording is below its unchanged display target; evidence retained')
 console.log('NATIVE CHECKS PASS macOS '+arch+' current feature GUI '+version+'; original CDP and SCK benchmarks passed; independent review remains separate')
}).catch(e=>{console.error(e);process.exitCode=1})
