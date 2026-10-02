// Run the actual packaged app on a disposable native macOS CI runner.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process')
const appPath=path.resolve(process.argv[2]),arch=process.argv[3],version=require('../package.json').version
assert.equal(process.platform,'darwin');assert.equal(process.arch,arch)
const mascotProofRevision=version==='1.1.9'?'119':'118',mascotRecordingKind=version==='1.1.9'?'logo':'leader'
const stage=process.argv[4]||(appPath.split(path.sep).includes('dmg-mount')?'dmg':'app');assert(['app','dmg'].includes(stage),'proof stage must be app or dmg')
const exe=path.join(appPath,'Contents/MacOS/KAMUCL'),proof=path.resolve(`release/mac-proof-${arch}-${stage}`)
fs.mkdirSync(proof,{recursive:true})
const binary=execFileSync('file',[exe],{encoding:'utf8'});assert(binary.includes(arch==='x64'?'x86_64':'arm64'))
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const log=fs.openSync(path.join(proof,'process.log'),'w')
const fixtureExe=path.join(proof,'material-fixture'),control=path.join(proof,'material-color.txt')
execFileSync('swiftc',['scripts/mac-material-fixture.swift','-o',fixtureExe])
fs.writeFileSync(control,'black')
const fixture=spawn(fixtureExe,[control],{stdio:'ignore'})
const child=spawn(exe,['--remote-debugging-port=9229'],{env,stdio:['ignore',log,log]})
const wait=ms=>new Promise(r=>setTimeout(r,ms))
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
 // The black-purple default intentionally uses a 96% solid surface. Test native
 // material using the existing translucent black-orange theme, without changing defaults.
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
 fs.writeFileSync(path.join(proof,'verification.json'),JSON.stringify({version,arch,stage,binary,mainUI:true,macUI,skin:{facePixels,shirtPixels,capture:skinCapture},nativeMaterial,url:page.url},null,2));ws.close()
 console.log('PASS native macOS '+arch+' packaged app '+version)
}
main().finally(async()=>{
 const ended=new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve)})
 child.kill('SIGTERM');fixture.kill('SIGTERM');await ended;fs.closeSync(log)
}).then(()=>{
 // The existing native workflow calls this script for both the APP and mounted DMG.
 // Keep the common-feature checks here so they cannot be omitted by a workflow step.
 const extensionProof=path.join(proof,'extensions');fs.mkdirSync(extensionProof,{recursive:true})
 const requiredProofs=['extension-ui-black-orange.json','skin-palette-ui-black-orange.json','mascot-header-ui-black-orange.json','gallery-favorites-ui-black-orange.json','skin-editor-ui-black-orange.json','gallery-favorites-118-ui-black-orange.json',...(version==='1.1.9'?['import-routing-119-ui-black-orange.json','selection-ui-119-black-orange.json','kamu-motion-diagnostic-119-cold-black-orange.json','kamu-motion-diagnostic-119-after-header-black-orange.json']:[])]
 const proofNames=[...requiredProofs,'native-gui-focus-live.json','skin-palette-ready-live.json','skin-palette-preference-live.json','main-inspector-ready-live.json','mascot-header-keyboard-ready-live.json','mascot-header-performance-live.json','mascot-header-performance-diagnostic.json','mascot-header-timeline.json','mascot-header-timeline-raw.json','mascot-header-native-focus-live.json','mascot-header-reverse-live.json','mascot-header-body-sweep-live.json','mascot-header-layout-live.json','mascot-header-visibility-live.json','mascot-header-persistence-live.json','mascot-header-overlap-live.json','mascot-header-screencast-live.json','gallery-favorites-motion-live.json','mascot-slap-117.wav','mascot-sweep-117.webm','mascot-slap-118.wav','mascot-sweep-118.webm','mascot-motion-118.webm','mascot-kamu-119.webm'],shots='release/ui-refinement-black-orange'
 const attemptStarted=Date.now(),fresh=file=>fs.existsSync(file)&&fs.statSync(file).mtimeMs>=attemptStarted
 let extensionError,complete=false,performanceBenchmark=null
 try{
  // Separate disposable process starts native mascot audio cold, without the full
  // header's MediaRecorder/tap hooks. Preserve its diagnostic evidence separately.
  if(version==='1.1.9')execFileSync(process.execPath,['scripts/verify-ui-refinement.cjs'],{env:{...env,KAMUCL_GUI_APP:exe,KAMUCL_EXTENSION_GUI:'1',KAMUCL_EXTENSION_ONLY:'1',KAMUCL_SKIP_EXTENSION_BASE:'1',KAMUCL_UI_MODULE:'motion119',KAMUCL_TEST_THEME:'black-orange'},stdio:'inherit',timeout:180000})
  execFileSync(process.execPath,['scripts/verify-ui-refinement.cjs'],{
   env:{...env,KAMUCL_GUI_APP:exe,KAMUCL_EXTENSION_GUI:'1',KAMUCL_EXTENSION_ONLY:'1',KAMUCL_TEST_THEME:'black-orange'},
   stdio:'inherit',timeout:480000
  })
  for(const name of requiredProofs){const file=path.join('out',name);assert(fresh(file),'successful GUI run is missing current proof '+name);const result=JSON.parse(fs.readFileSync(file));assert.equal(result.version,version,'GUI proof must match this build: '+name);if('complete' in result)assert.equal(result.complete,true,'GUI proof must be complete: '+name)}
  const frameManifest=path.join('out',`mascot-${mascotProofRevision}-frames-black-orange`,'frames.json');assert(fresh(frameManifest),'successful GUI run is missing current compositor frame manifest');assert.equal(JSON.parse(fs.readFileSync(frameManifest)).version,version,'compositor frames must match this build')
  const recordingManifest=path.join('out',`mascot-${mascotProofRevision}-${mascotRecordingKind}-screencast-black-orange`,'recording.json');assert(fresh(recordingManifest),'successful GUI run is missing current actual screencast');const recording=JSON.parse(fs.readFileSync(recordingManifest));assert.equal(recording.version,version)
  const cadenceFile=path.join('out','mascot-header-screencast-live.json');assert(fresh(cadenceFile),'successful GUI run is missing current native display cadence proof');const cadence=JSON.parse(fs.readFileSync(cadenceFile)),budget=require('./mascot-capture-budget.cjs')({activeDisplay:cadence.activeDisplay},recording.fps);assert.equal(cadence.actualFps,recording.fps,'native display cadence must refer to this exact recording');assert.equal(cadence.minimumFps,budget.minimumFps,'wrapper and GUI must use the same native display capture target');assert.equal(cadence.passed,budget.passed,'benchmark passed result must match actual capture');assert.equal(cadence.frameRatePassed,budget.passed,'capture result cannot hide a below-target benchmark');assert(recording.frames.length>=2&&Number.isFinite(recording.fps)&&recording.fps>0&&recording.elapsed>0,'capture evidence must include multiple real frames and valid timing');performanceBenchmark={...budget,status:budget.passed?'passed':'below-target'};if(!budget.passed)console.warn('BENCHMARK BELOW TARGET: native compositor capture '+recording.fps+' fps < '+budget.minimumFps+' fps; functional completeness is reported independently')
  complete=true
 }catch(error){extensionError=String(error);throw error}
 finally{
  // Failed GUI runs must retain their last real layout/visibility snapshot and
  // screenshots in the uploaded artifact, not only in the ephemeral runner.
  const copied=[]
  for(const name of proofNames)if(fresh(path.join('out',name))){fs.copyFileSync(path.join('out',name),path.join(extensionProof,name==='extension-ui-black-orange.json'?'results.json':name));copied.push(name)}
  const frames=path.join('out',`mascot-${mascotProofRevision}-frames-black-orange`),frameProof=path.join(extensionProof,`mascot-${mascotProofRevision}-frames-black-orange`)
  if(fs.existsSync(frames))for(const name of fs.readdirSync(frames))if((name==='frames.json'||/^frame-\d+\.png$/.test(name))&&fresh(path.join(frames,name))){fs.mkdirSync(frameProof,{recursive:true});fs.copyFileSync(path.join(frames,name),path.join(frameProof,name));copied.push(`mascot-${mascotProofRevision}-frames-black-orange/`+name)}
  const recording=path.join('out',`mascot-${mascotProofRevision}-${mascotRecordingKind}-screencast-black-orange`),recordingProof=path.join(extensionProof,`mascot-${mascotProofRevision}-${mascotRecordingKind}-screencast-black-orange`)
  if(fs.existsSync(recording))for(const name of fs.readdirSync(recording))if((name==='recording.json'||/^frame-\d+\.jpg$/.test(name))&&fresh(path.join(recording,name))){fs.mkdirSync(recordingProof,{recursive:true});fs.copyFileSync(path.join(recording,name),path.join(recordingProof,name));copied.push(`mascot-${mascotProofRevision}-${mascotRecordingKind}-screencast-black-orange/`+name)}
  if(version==='1.1.9'){const intro=path.join('out','mascot-119-logo-intro-black-orange'),introProof=path.join(extensionProof,'mascot-119-logo-intro-black-orange');if(fs.existsSync(intro))for(const name of fs.readdirSync(intro))if((name==='recording.json'||/^frame-\d+\.jpg$/.test(name))&&fresh(path.join(intro,name))){fs.mkdirSync(introProof,{recursive:true});fs.copyFileSync(path.join(intro,name),path.join(introProof,name));copied.push('mascot-119-logo-intro-black-orange/'+name)}}
  if(version==='1.1.9')for(const mode of ['cold','after-header'])for(const kind of ['cold-intro','first-native','warm-native','warm-no-backdrop','warm-restored-backdrop']){const name='kamu-motion-119-'+mode+'-'+kind+'-black-orange',dir=path.join('out',name),target=path.join(extensionProof,name);if(fs.existsSync(dir))for(const item of fs.readdirSync(dir))if((item==='recording.json'||/^frame-\d+\.jpg$/.test(item))&&fresh(path.join(dir,item))){fs.mkdirSync(target,{recursive:true});fs.copyFileSync(path.join(dir,item),path.join(target,item));copied.push(name+'/'+item)}}
  if(fs.existsSync(shots))for(const name of fs.readdirSync(shots))if(name.startsWith('extension-')&&name.endsWith('.png')&&fresh(path.join(shots,name))){fs.copyFileSync(path.join(shots,name),path.join(extensionProof,name));copied.push(name)}
  fs.writeFileSync(path.join(extensionProof,'attempt.json'),JSON.stringify({version,arch,stage,complete,functionalComplete:complete,performanceBenchmark,performancePassed:performanceBenchmark?.passed??null,acceptance:'functional results only; independent visual, interaction and motion review is separate',error:extensionError||null,startedAt:new Date(attemptStarted).toISOString(),executable:exe,copied},null,2))
 }
 console.log('FUNCTIONAL PASS native macOS '+arch+' extension GUI '+version+'; capture benchmark '+performanceBenchmark.status)
}).catch(e=>{console.error(e);process.exitCode=1})
