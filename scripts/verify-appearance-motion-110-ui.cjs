// Exact built product in a disposable profile. Service fixtures are labeled below.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
module.exports=async({call,evaluate,main,nav,wait,screenshot,recordScreencast,version,profile,ws,ownedTrack})=>{
 const proof={version,theme:process.env.KAMUCL_TEST_THEME,service:'Favorite artwork metadata fixtures; UI, settings storage, image rendering and WebGL are the actual product',checks:[],samples:[]}
 const save=()=>fs.writeFileSync(`out/appearance-motion-${proof.theme}-110.json`,JSON.stringify(proof,null,2))
 let nativeLayoutScene=null
 const ready=async(expr,label)=>{let result;for(let i=0;i<100;i++){result=await evaluate(expr);if(result)return result;await wait(100)}throw Error(label+' timed out')}
 const coordinateClick=async(selector)=>{
   // Wait for native disclosure/resize geometry, then verify the actual hit at
   // the coordinates being dispatched (not just existence of a DOM input).
   await wait(280)
   await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center'})`);await wait(280)
   const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Unavailable target');const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(hit!==e&&!e.contains(hit))throw Error('Coordinate hit blocked: '+JSON.stringify({x,y,width:innerWidth,height:innerHeight,hit:hit?.className,tag:hit?.tagName}));return{x,y}})()`)
   for(const type of ['mouseMoved','mousePressed','mouseReleased']){const params={type,...p,button:type==='mouseMoved'?'none':'left',buttons:type==='mousePressed'?1:0,clickCount:type==='mouseMoved'?0:1};if(nativeLayoutScene)(proof.layoutInputs??=[]).push({atUnixMs:Date.now(),scene:nativeLayoutScene,selector,method:'Input.dispatchMouseEvent',params});await call('Input.dispatchMouseEvent',params)}
 }
 try{
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
  const pose=()=>evaluate("(()=>{const e=document.querySelector('.viewer3d');return {state:e?.dataset.animationState,...JSON.parse(e?.dataset.pose||'{}'),hidden:document.hidden}})()")
  await nav('home');await ready("document.querySelector('.viewer3d')?.dataset.animationState==='walk'",'walking')
  const a=await pose();await wait(400);const b=await pose();assert(b.seconds>a.seconds);assert.notEqual(a.arm,b.arm);proof.samples.push({normal:[a,b]})
  // Starve only rAF delivery in this QA renderer, retaining timers. It verifies
  // actual draw/pose progress, then restores the unmodified browser scheduler.
  await evaluate("window.__realRaf=requestAnimationFrame;window.__realCancel=cancelAnimationFrame;window.requestAnimationFrame=()=>987654;window.cancelAnimationFrame=()=>{};true")
  await wait(300);const stalledA=await pose();await wait(400);const stalledB=await pose();assert(stalledB.seconds>stalledA.seconds);assert(stalledB.fallbacks>stalledA.fallbacks);assert.notEqual(stalledA.arm,stalledB.arm)
  await evaluate("window.requestAnimationFrame=window.__realRaf;window.cancelAnimationFrame=window.__realCancel;true")
  proof.samples.push({rafStarvation:[stalledA,stalledB]});proof.checks.push('real WebGL walk changes limbs; one-shot watchdog advances actual pose when rAF is starved')
  await coordinateClick('.brand-avatar')
  await ready("document.querySelector('.mascot-stage.ready') && !document.querySelector('.mascot-hit').disabled",'actual mascot ready')
  await ready("document.querySelector('.viewer3d')?.dataset.animationState==='walk'",'idle logo must not pause skin')
  const logoIdle=await pose();await wait(300);assert((await pose()).seconds>logoIdle.seconds)
  await coordinateClick('.mascot-hit')
  await ready("document.querySelector('.viewer3d')?.dataset.animationState==='paused'",'action temporarily yields')
  assert.equal(Math.abs((await pose()).arm),0)
  await ready("document.querySelector('.viewer3d')?.dataset.animationState==='walk'",'action ends and skin resumes')
  await coordinateClick('[aria-label="卡慕互动设置"]');await evaluate("[...document.querySelectorAll('.sound-panel button')].find(e=>e.textContent==='恢复 LOGO').click()")
  await ready("!document.querySelector('.mascot-stage')",'mascot close')
  proof.checks.push('opened idle mascot keeps skin walking; one actual click temporarily yields neutral pose and resumes after action')
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await ready("document.querySelector('.viewer3d')?.dataset.animationState==='paused'",'system reduced pose')
  const reduced=await pose();assert.equal(Math.abs(reduced.arm),0);assert.equal(Math.abs(reduced.leg),0);await wait(400);assert.equal((await pose()).seconds,reduced.seconds)
  await nav('settings');assert(await evaluate("document.body.innerText.includes('当前系统已关闭动画')"))
  await screenshot('110-system-reduced-explanation')
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await nav('home')
  await ready("document.querySelector('.viewer3d')?.dataset.animationState==='walk'",'resumed walk')
  await call('Emulation.setFocusEmulationEnabled',{enabled:false})
  await main('testElectron.BrowserWindow.getAllWindows()[0].minimize()');await ready("window.kamucl.invoke('window:visibility').then(visible=>!visible)",'native minimize visibility')
  const hidden=await pose();await wait(450);assert.equal((await pose()).seconds,hidden.seconds)
  await main('testElectron.BrowserWindow.getAllWindows()[0].restore();testElectron.BrowserWindow.getAllWindows()[0].focus()')
  await ready("window.kamucl.invoke('window:visibility')",'native restore');const restoreA=await pose();await wait(400);assert((await pose()).seconds>restoreA.seconds)
  proof.checks.push('OS reduced mode neutral stance, correct settings explanation, no hidden animation, restore resumes')
  proof.walkCapture={classification:'actual naturally walking model, visibly in the viewport; no extra animation or interpolated frames',nativeWindow:await main("(()=>{const w=testElectron.BrowserWindow.getAllWindows()[0];if(process.platform==='darwin')testElectron.app.focus({steal:true});w.show();w.focus();return{platform:process.platform,visible:w.isVisible(),focused:w.isFocused(),minimized:w.isMinimized(),appHideCapability:typeof testElectron.app.isHidden==='function',appHidden:typeof testElectron.app.isHidden==='function'?testElectron.app.isHidden():null}})()")};save()
  proof.walkCapture.focusSamples=[]
  for(let i=0;i<100;i++){
    const observed=await main("(()=>{const w=testElectron.BrowserWindow.getAllWindows()[0];return{visible:w.isVisible(),focused:w.isFocused(),minimized:w.isMinimized(),appHidden:typeof testElectron.app.isHidden==='function'?testElectron.app.isHidden():null}})()")
    proof.walkCapture.focusSamples.push({observedAt:new Date().toISOString(),...observed});proof.walkCapture.nativeWindow={...proof.walkCapture.nativeWindow,...observed};save()
    if(observed.visible&&observed.focused&&!observed.minimized&&!observed.appHidden)break
    await wait(100)
  }
  assert(proof.walkCapture.nativeWindow.visible&&proof.walkCapture.nativeWindow.focused&&!proof.walkCapture.nativeWindow.minimized&&!proof.walkCapture.nativeWindow.appHidden,'walking capture requires observed native focus, not merely a request to focus')
  await ready("!document.hidden&&window.kamucl.invoke('window:visibility')",'walking capture actual native visibility')
  await evaluate("document.querySelector('.viewer3d').scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})");await wait(280)
  proof.walkCapture.bounds=await evaluate("(()=>{const e=document.querySelector('.viewer3d canvas'),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),gl=e.getContext('webgl2')||e.getContext('webgl');return{x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,hitVisible:hit===e,contextWebGL:gl?{type:gl.constructor.name,lost:gl.isContextLost()}:null}})()");save()
  const bounds=proof.walkCapture.bounds
  assert(bounds.contextWebGL&&!bounds.contextWebGL.lost,'walking capture must use the actual live WebGL context')
  assert(bounds.hitVisible&&bounds.width>0&&bounds.height>0&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=bounds.viewportWidth&&bounds.y+bounds.height<=bounds.viewportHeight,'actual walking canvas must be fully visible, not below the home-page fold')
  let recording
  if(proof.walkCapture.nativeWindow.platform==='darwin'){
    const nativeWalk=await require('./verify-mac-skin-walk-capture.cjs')({main,evaluate,wait,version,ownedTrack},bounds,()=>recordScreencast('skin-walk-110',async()=>{},1400))
    proof.walkCapture.nativeCapture=nativeWalk;recording=nativeWalk.recording
    proof.walkCapture.cdpTiming=require('./verify-mac-skin-walk-capture.cjs').cdpTiming(recording)
  }else recording=await recordScreencast('skin-walk-110',async()=>{},1400)
  proof.recording=recording;save()
  const monotonic=recording.frames.every((frame,index)=>Number.isFinite(frame.timestamp)&&(index===0||frame.timestamp>recording.frames[index-1].timestamp))
  // The macOS cadence gate above uses actual native presentation PTS. Preserve
  // CDP arrival order and failed wall-clock diagnostics without relabelling
  // their FPS; Chromium does not promise monotonic arrival-order metadata.
  if(proof.walkCapture.nativeWindow.platform!=='darwin')assert(monotonic,'original compositor timestamps must be finite and strictly increasing')
  const originalElapsed=recording.frames.length>1?recording.frames.at(-1).timestamp-recording.frames[0].timestamp:0
  const originalIntervals=recording.frames.slice(1).map((frame,index)=>frame.timestamp-recording.frames[index].timestamp)
  const originalFps=originalElapsed?(recording.frames.length-1)/originalElapsed:0
  assert.equal(recording.elapsed,originalElapsed);assert.equal(recording.fps,originalFps);assert.deepEqual(recording.intervals,originalIntervals)
  proof.walkCapture.originalTiming={elapsed:originalElapsed,fps:originalFps,frameCount:recording.frames.length,strictlyIncreasing:monotonic,timingUsable:proof.walkCapture.cdpTiming?.timingUsable??monotonic,formalCadenceSource:proof.walkCapture.nativeWindow.platform!=='darwin'};save()
  if(proof.walkCapture.nativeWindow.platform!=='darwin')assert(recording.frames.length>=10&&recording.fps>=30,'original visible skin-walk capture must meet the existing 30 FPS release minimum')
  const sharp=require('sharp'),pixelSamples=[]
  for(const index of recording.frames.length?[...new Set([0,Math.floor(recording.frames.length/3),Math.floor(recording.frames.length*2/3),recording.frames.length-1])]:[]){
    const image=sharp(path.join(recording.directory,recording.frames[index].file)),size=await image.metadata(),sx=size.width/bounds.viewportWidth,sy=size.height/bounds.viewportHeight
    const left=Math.max(0,Math.floor(bounds.x*sx)),top=Math.max(0,Math.floor(bounds.y*sy)),width=Math.min(size.width-left,Math.floor(bounds.width*sx)),height=Math.min(size.height-top,Math.floor(bounds.height*sy))
    assert(width>0&&height>0)
    const pixels=await image.extract({left,top,width,height}).removeAlpha().raw().toBuffer();pixelSamples.push({index,pixels,left,top,width,height})
  }
  const reference=pixelSamples[0],changes=pixelSamples.slice(1).map(sample=>{assert.equal(sample.pixels.length,reference.pixels.length);let changed=0;for(let i=0;i<sample.pixels.length;i+=3)if(Math.max(Math.abs(sample.pixels[i]-reference.pixels[i]),Math.abs(sample.pixels[i+1]-reference.pixels[i+1]),Math.abs(sample.pixels[i+2]-reference.pixels[i+2]))>12)changed++;return{index:sample.index,changedPixels:changed,fraction:changed/(sample.width*sample.height)}})
  proof.walkCapture.pixelChanges={classification:'decoded original visible-canvas ROI; JPEG compression noise under12 ignored; frames and times unchanged',samples:pixelSamples.map(({pixels,...sample})=>sample),changes};save()
  if(proof.walkCapture.nativeWindow.platform!=='darwin')assert(changes.some(sample=>sample.fraction>.005),'natural walking must change pixels in the actual visible canvas')
  // The true OS/native splash preference is checked separately without changing system settings.
  const shell=await evaluate("({surface:getComputedStyle(document.documentElement).getPropertyValue('--shell-surface'),sidebar:getComputedStyle(document.documentElement).getPropertyValue('--bg-2')})")
  if(proof.theme==='transparent'){assert(shell.surface.includes('30%'));assert(shell.sidebar.includes('26%'))}
  proof.shell=shell
  const nativeUserData=await main("testElectron.app.getPath('userData')")
  const profileStat=fs.statSync(profile),nativeStat=fs.statSync(nativeUserData)
  const canonicalProfile=fs.realpathSync(profile),canonicalUserData=fs.realpathSync(nativeUserData)
  proof.background={fixtureIdentity:{profile,nativeUserData,canonicalProfile,canonicalUserData,profileFileId:{dev:profileStat.dev,ino:profileStat.ino},nativeFileId:{dev:nativeStat.dev,ino:nativeStat.ino}},readinessSamples:[]};save()
  assert.equal(canonicalProfile,canonicalUserData,'wallpaper fixture must belong to the actual isolated application profile')
  assert.equal(profileStat.dev,nativeStat.dev);assert.equal(profileStat.ino,nativeStat.ino)
  // Use the actual managed directory returned by this main process. On macOS
  // /var and /private/var can name the same directory while the deliberately
  // lexical image admission rule correctly rejects the non-managed alias.
  const wallpaper=path.join(nativeUserData,'appearance','backgrounds','qa-wallpaper.png')
  fs.mkdirSync(path.dirname(wallpaper),{recursive:true})
  await require('sharp')(Buffer.from('<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="600" fill="#c43a9a"/><circle cx="400" cy="300" r="240" fill="#2d8bb0"/></svg>')).png().toFile(wallpaper)
  const patch=image=>`window.kamucl.invoke('settings:set',{background:{mode:'image',image:${JSON.stringify(image)},opacity:.7,blur:12,fit:'crop'}}).then(s=>s.background)`
  const alias=path.join(profile,'appearance','backgrounds','qa-wallpaper.png')
  if(alias!==wallpaper){
    const aliasStat=fs.statSync(alias),actualStat=fs.statSync(wallpaper)
    assert.equal(aliasStat.dev,actualStat.dev);assert.equal(aliasStat.ino,actualStat.ino)
    proof.background.aliasObservation={classification:'diagnostic of the original fixture alias; not a product success assertion',path:alias,canonical:fs.realpathSync(alias),set:await evaluate(patch(alias)),get:await evaluate("window.kamucl.invoke('settings:get').then(s=>s.background)")};save()
  }
  proof.background.set=await evaluate(patch(wallpaper))
  proof.background.get=await evaluate("window.kamucl.invoke('settings:get').then(s=>s.background)");save()
  assert.equal(proof.background.get.mode,'image');assert.equal(fs.realpathSync(proof.background.get.image),fs.realpathSync(wallpaper))
  const previousTimeOrigin=await evaluate('performance.timeOrigin'),reloadStarted=performance.now()
  await call('Page.reload')
  // Observe a new document and the real style within the original two-second
  // budget, instead of treating a fixed sleep as proof of image readiness.
  do{
    try{
      const sample=await evaluate("(()=>{const e=document.querySelector('.app-bg');return{timeOrigin:performance.timeOrigin,readyState:document.readyState,style:e?.getAttribute('style'),computed:e?getComputedStyle(e).backgroundImage:null}})()")
      proof.background.readinessSamples.push({elapsedMs:performance.now()-reloadStarted,...sample});save()
      if(sample.timeOrigin!==previousTimeOrigin&&sample.readyState==='complete'&&sample.style?.includes('qa-wallpaper.png')){proof.background.style=sample.style;proof.background.computed=sample.computed;break}
    }catch(error){
      if(!/Execution context was destroyed|Cannot find context with specified id/i.test(error.message))throw error
      proof.background.readinessSamples.push({elapsedMs:performance.now()-reloadStarted,navigationContextError:error.message});save()
    }
    await wait(Math.max(0,Math.min(100,2000-(performance.now()-reloadStarted))))
  }while(performance.now()-reloadStarted<2000)
  assert(proof.background.style?.includes('qa-wallpaper.png'),'validated managed wallpaper is actually present')
  const decodeBudget=Math.max(1,2000-(performance.now()-reloadStarted))
  proof.background.imageDecode=await evaluate(`new Promise(resolve=>{const css=${JSON.stringify(proof.background.computed)},image=new Image();let timer;const finish=loaded=>{clearTimeout(timer);resolve({loaded,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,src:image.src})};timer=setTimeout(()=>finish(false),${decodeBudget});image.onload=()=>finish(true);image.onerror=()=>finish(false);image.src=css.startsWith('url(')?css.slice(4,-1).trim().replace(/^["']|["']$/g,''):''})`);save()
  assert(proof.background.imageDecode.loaded&&proof.background.imageDecode.naturalWidth>0,'actual managed background image must decode')
  await screenshot('110-wallpaper-glass-home')
  await nav('settings');await evaluate("document.querySelector('[data-section=thumbnail]').open=true")
  await coordinateClick('[aria-label="随机播放启动卡图片"]')
  const thumbnail=await evaluate("window.kamucl.invoke('settings:get').then(s=>s.launchThumbnail)");assert.equal(thumbnail.randomPlayback,true)
  const order=thumbnail.order;assert(order.length>=7)
  await screenshot('110-random-playback-controls');await nav('home')
  await evaluate("window.kamucl.invoke('settings:set',{launchThumbnail:{intervalSeconds:1}})");await call('Page.reload');await wait(2000)
  const paths=[];for(let i=0;i<9;i++){const src=await evaluate("document.querySelector('.hero-image.active')?.getAttribute('src')");assert(src,'actual active carousel image');paths.push(src);await wait(1050)}
  assert(new Set(paths).size>=3,'enabled random carousel actually changes pictures')
  proof.carouselObserved=paths
  assert.equal((await evaluate("window.kamucl.invoke('settings:get').then(s=>s.launchThumbnail.randomPlayback)")),true)
  assert.deepEqual((await evaluate("window.kamucl.invoke('settings:get').then(s=>s.launchThumbnail.order)")),order)
  proof.checks.push('trusted coordinate random-playback toggle persists across reload without changing saved ordering')
  // Actual favorite storage; old record backfill uses a service fixture. Serve
  // Intercept only the fixture artwork URL: actual Chromium image decode,
  // no live CDN availability is implied by this fixture verification.
  const iconUrl='https://artwork.example.test/fixture.png'
  const artwork=fs.readFileSync(wallpaper).toString('base64')
  const intercept=async e=>{const msg=JSON.parse(e.data);if(msg.method==='Fetch.requestPaused')await call('Fetch.fulfillRequest',{requestId:msg.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/png'}],body:artwork})}
  ws.addEventListener('message',intercept);await call('Fetch.enable',{patterns:[{urlPattern:iconUrl}]})
  await main(`(()=>{const fs=process.mainModule.require('fs'),p=process.mainModule.require('path');fs.writeFileSync(p.join(testElectron.app.getPath('userData'),'mod-favorites.json'),JSON.stringify([{key:'modrinth:old',source:'modrinth',projectId:'old',name:'Old favorite',added:1},{key:'curseforge:123',source:'curseforge',projectId:'123',name:'New favorite',iconUrl:${JSON.stringify(iconUrl)},added:2}]));testElectron.ipcMain.removeHandler('community:project');testElectron.ipcMain.handle('community:project',(_e,source,projectId)=>({kind:'mod',source,projectId,title:'Artwork fixture',iconUrl:${JSON.stringify(iconUrl)},categories:[]}));return true})()`)
  await nav('community');await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('已收藏 MOD')).click()")
  await ready("document.querySelectorAll('.favorite-icon img').length===2",'favorite artwork')
  await ready("[...document.querySelectorAll('.favorite-icon img')].every(e=>e.complete&&e.naturalWidth>0)",'fixture images decoded')
  assert.equal(await evaluate("document.querySelectorAll('.favorite-monogram').length"),0)
  await screenshot('110-favorite-project-icons');proof.checks.push('new and old favorites show decoded MOD artwork, never initials')
  await call('Fetch.disable');ws.removeEventListener('message',intercept)
  proof.layout=[]
  const layoutScenes=process.platform==='darwin'?[[960,620,1],[1280,900,1.25],[960,620,1.25]]:[[960,620,1],[1280,900,1.25]]
  for(const [width,height,zoom] of layoutScenes){
    nativeLayoutScene=process.platform==='darwin'?{width,height,zoom}:null
    await main(`testElectron.BrowserWindow.getAllWindows()[0].setSize(${width},${height});testElectron.BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(${zoom})`)
    await nav('settings');await evaluate("document.querySelector('[data-section=thumbnail]').open=true")
    await coordinateClick('[aria-label="随机播放启动卡图片"]')
    await ready("window.kamucl.invoke('settings:get').then(s=>s.launchThumbnail.randomPlayback===false)",'coordinate toggle off')
    for(const type of ['keyDown','keyUp']){const params={type,key:' ',code:'Space',windowsVirtualKeyCode:32};if(nativeLayoutScene)(proof.layoutInputs??=[]).push({atUnixMs:Date.now(),scene:nativeLayoutScene,method:'Input.dispatchKeyEvent',params});await call('Input.dispatchKeyEvent',params)}
    await ready("window.kamucl.invoke('settings:get').then(s=>s.launchThumbnail.randomPlayback===true)",'keyboard checkbox toggle on')
    const layout=await evaluate("(()=>{const e=document.querySelector('[aria-label=\"随机播放启动卡图片\"]'),r=e.getBoundingClientRect();return{width:innerWidth,height:innerHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()")
    assert(layout.left>=0&&layout.right<=layout.width&&layout.top>=0&&layout.bottom<=layout.height)
    if(process.platform==='darwin'){const native=await main("(()=>{const w=testElectron.BrowserWindow.getAllWindows()[0];return{bounds:w.getBounds(),contentBounds:w.getContentBounds(),zoom:w.webContents.getZoomFactor(),scale:testElectron.screen.getDisplayMatching(w.getBounds()).scaleFactor}})()"),renderer=await evaluate("({innerWidth,innerHeight,devicePixelRatio})");assert.equal(native.zoom,zoom);assert(Math.abs(native.contentBounds.width/native.zoom-renderer.innerWidth)<2&&Math.abs(native.contentBounds.height/native.zoom-renderer.innerHeight)<2,'Native layout and real renderer viewport must agree');proof.layout.push({width,height,zoom,...layout,requested:{width,height,zoom},native,renderer,screenshotName:`110-random-keyboard-${width}-${zoom}.png`})}else proof.layout.push({width,height,zoom,...layout});await screenshot(`110-random-keyboard-${width}-${zoom}`)
  }
  nativeLayoutScene=null
  proof.checks.push('minimum window and 125% zoom: real coordinate checkbox and native Space toggle retain state and remain visible')
  if(process.platform==='darwin')proof.checks.push('four-theme native 960x620 requested window at 125% zoom: original dispatched coordinates, actual bounds/viewport/device scale and unchanged full screenshot retained')
  proof.complete=true;save();console.log('PASS 1.1.10 appearance/motion '+proof.theme)
 }catch(error){proof.complete=false;proof.error=String(error);save();throw error}
}
