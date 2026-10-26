// Real gallery files and shared favorite UI; network fixtures remain inside the isolated test process.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{gunzipSync}=require('node:zlib');
function readMountedEnabledPlaylist(){
 const observer=window.__macParityObserver
 if(!observer)throw Error('Actual mounted production VNode observer missing')
 return[...document.querySelectorAll('.launch-carousel-list>li')].filter(row=>row.querySelector('.carousel-enabled input')?.checked).map(row=>{
  const vnode=observer.nodeForElement('HomeLayoutEditor',row),image=row.querySelector('img'),imageVNode=image&&observer.nodeForElement('HomeLayoutEditor',image)
  if(typeof vnode.key!=='string'||!image||typeof imageVNode.props?.src!=='string')throw Error('Actual enabled carousel VNode key/source missing')
  const source=new URL(imageVNode.props.src,document.baseURI).href
  if(source!==image.src)throw Error('Actual enabled playlist VNode and DOM source disagree')
  return{path:vnode.key,src:source}
 })
}
function readMountedCarousel(banners){
 const observer=window.__macParityObserver,component=observer?.one('HomeView'),hero=document.querySelector('.hero-card')
 if(!component||!hero)throw Error('Actual mounted HomeView VNode missing')
 const images=[...hero.querySelectorAll('.hero-image')].map(image=>{
  const vnode=observer.nodeForElement('HomeView',image),key=vnode.key,index=banners.findIndex(item=>item.path===key),source=typeof vnode.props?.src==='string'?new URL(vnode.props.src,document.baseURI).href:null,classes=vnode.props?.class
  if(typeof key!=='string'||index<0||banners.filter(item=>item.path===key).length!==1||source!==image.src||source!==banners[index].src||typeof classes!=='string')throw Error('Actual retained carousel VNode path/source missing or disagrees with saved playlist')
  const active=classes.split(/\s+/).includes('active')
  if(active!==image.classList.contains('active'))throw Error('Actual retained carousel VNode and DOM active state disagree')
  return{index,key,vnodeSrc:source,vnodeClass:classes,src:image.src,active,complete:image.complete,naturalWidth:image.naturalWidth}
 })
 const active=images.filter(image=>image.active)
 if(active.length!==1)throw Error('Exactly one actual active carousel VNode is required')
 const current=active[0].index,next=(current+1)%banners.length,previous=(current+banners.length-1)%banners.length,layerIndices=images.map(image=>image.index).sort((a,b)=>a-b)
 if(new Set(layerIndices).size!==layerIndices.length||!layerIndices.includes(next)||layerIndices.some(index=>![current,next,previous].includes(index)))throw Error('Actual retained VNodes must contain current/next and only the optional previous outgoing layer')
 return{banners,current,upcoming:next,outgoing:layerIndices.includes(previous)?previous:null,layerIndices,images,documentHidden:document.hidden,timers:window.__galleryTimers.size,observer:{componentUID:component.uid,indexSource:'Original mounted image VNode path key mapped to exact saved playlist',nextSource:'Next saved playlist index, required to exist as an actual retained VNode',outgoingSource:'Previous saved playlist index only when present as an actual retained VNode',classification:'Read-only actual mounted production VNode key/props/source/class plus previously observed enabled Settings VNode playlist; no setup bindings or DOM dev expandos'}}
}
function verifyRetainedCarousel(snapshot,expected){
 assert.deepEqual(snapshot.banners.map(item=>item.path),expected,'all enabled logical images retain their exact saved order')
 assert.equal(snapshot.banners.length,expected.length);assert.equal(new Set(expected).size,expected.length)
 const indices=[...new Set([snapshot.current,snapshot.upcoming,snapshot.outgoing])].filter(index=>index!==null&&Number.isInteger(index)&&index>=0&&index<expected.length).sort((a,b)=>a-b)
 assert.deepEqual(snapshot.layerIndices,indices,'render layers are precisely current/next/outgoing')
 assert(snapshot.images.length>=1&&snapshot.images.length<=3,'only current/next/outgoing decoded DOM images are retained');assert.equal(snapshot.images.length,indices.length)
 assert.deepEqual(snapshot.images.map(item=>item.src).sort(),indices.map(index=>snapshot.banners[index].src).sort());assert(snapshot.images.every(item=>item.complete&&item.naturalWidth>0),'retained resources actually decode')
 const active=snapshot.images.filter(item=>item.active);assert.equal(active.length,1);assert.equal(active[0].src,snapshot.banners[snapshot.current].src)
 return{current:snapshot.current,path:expected[snapshot.current],layers:indices.length}
}
function verifyCarouselReadiness(snapshot,state,requestStartedAt,observedAt){
 assert(Number.isFinite(requestStartedAt)&&Number.isFinite(observedAt)&&observedAt>=requestStartedAt)
 assert(requestStartedAt>=state.previousRequestStartedAt,'Original readiness observations must remain ordered')
 assert(requestStartedAt>=(state.previousObservedAt??state.previousRequestStartedAt),'Original serial readiness observations cannot precede the previous returned observation')
 const present=new Set(snapshot.images.map(image=>image.src)),active=snapshot.images.filter(image=>image.active)
 assert.equal(active.length,1)
 state.initialSource??=active[0].src
 // Event-driven observation must retain the original decode deadline even
 // when no DOM event occurred at that deadline. A late load or removal cannot
 // turn an already overdue, actually observed pending resource into success.
 for(const bound of state.mounted.values())if(bound.decodingPending)assert(observedAt-bound.earliestMountAt<4000,'carousel resource exceeded its original readiness bound before decode or removal')
 for(const source of state.mounted.keys())if(!present.has(source))state.mounted.delete(source)
 const rows=[]
 for(const image of snapshot.images){
  if(!state.mounted.has(image.src))state.mounted.set(image.src,{earliestMountAt:state.previousRequestStartedAt,firstObservedAt:observedAt})
  const bound=state.mounted.get(image.src),decoded=image.complete&&image.naturalWidth>0
  // A new next layer has its own original four-second decode window. Its
  // conservative start is the previous request, when that source was absent.
  // Once initial presentation is ready, an undecoded active layer is a failure.
  if(image.active&&!decoded&&(state.initialDecoded||image.src!==state.initialSource))assert.fail('active carousel image must decode before presentation')
  if(!decoded)assert(observedAt-bound.earliestMountAt<4000,'carousel resource did not decode within its original readiness bound: '+image.src)
  if(!decoded)bound.decodingPending=true
  else{if(bound.decodingPending)bound.firstDecodedAt=observedAt;bound.decodingPending=false}
  if(image.active&&decoded)state.initialDecoded=true
  rows.push({src:image.src,active:image.active,decoded,...bound,deadline:bound.earliestMountAt+4000})
 }
 state.previousRequestStartedAt=requestStartedAt
 state.previousObservedAt=observedAt
 return{ready:rows.every(row=>row.decoded),rows,classification:'Original four-second bound per actual retained-source mount; previous observation request is the conservative lower time bound, never a later first-seen grace period'}
}
// Capture actual presentation changes in the renderer's own event loop. CDP
// round trips can exceed this fixture's one-second image duration on a busy
// native runner; their arrival time must not erase an intervening real frame.
function installCarouselPresentationObserver(banners,readSnapshot){
 const hero=document.querySelector('.hero-card');if(!hero)throw Error('Mounted carousel missing')
 if(window.__carouselPresentation)throw Error('Carousel observer already installed')
 const state={timeOrigin:performance.timeOrigin,events:[],errors:[],closed:false};let lastSignature
 const capture=reason=>{
  if(state.closed)return
  const at=Date.now(),monotonic=performance.now()
  try{
   const snapshot=readSnapshot(banners),signature=JSON.stringify({images:snapshot.images.map(image=>[image.key,image.src,image.active,image.complete,image.naturalWidth]),hidden:snapshot.documentHidden,timers:snapshot.timers})
   if(signature===lastSignature)return
   if(state.events.length>=2048)throw Error('Original carousel event buffer overflow')
   lastSignature=signature;state.events.push({at,monotonic,timeOrigin:performance.timeOrigin,reason,snapshot})
  }catch(error){state.errors.push({at,monotonic,reason,error:String(error?.stack||error)})}
 }
 const observer=new MutationObserver(()=>capture('actual DOM mutation'))
 observer.observe(hero,{subtree:true,childList:true,attributes:true,attributeFilter:['class','src']})
 const loaded=event=>{if(event.target?.classList?.contains('hero-image'))capture('actual image '+event.type)}
 const visibility=()=>capture('actual document visibility')
 hero.addEventListener('load',loaded,true);hero.addEventListener('error',loaded,true)
 document.addEventListener('visibilitychange',visibility)
 state.stop=(from=0)=>{if(!state.closed){observer.disconnect();hero.removeEventListener('load',loaded,true);hero.removeEventListener('error',loaded,true);document.removeEventListener('visibilitychange',visibility);state.closed=true}return{from,count:state.events.length,timeOrigin:state.timeOrigin,errors:[...state.errors],events:state.events.slice(from),closed:state.closed}}
 window.__carouselPresentation=state;capture('initial actual presentation')
 return{timeOrigin:state.timeOrigin,startedAt:Date.now(),monotonicStartedAt:performance.now(),classification:'Read-only renderer DOM mutation and image-load observations with original wall and monotonic clocks; no timers, pixels, VNodes or application state changed'}
}
function verifyCarouselEventBatch(batch,cursor){
 assert.equal(batch.timeOrigin,cursor.timeOrigin,'carousel renderer must not reload during the cycle')
 assert.deepEqual(batch.errors,[],'all original renderer observations must succeed')
 assert.equal(batch.from,cursor.offset,'carousel event stream must not drop or repeat observations')
 assert.equal(batch.count,batch.from+batch.events.length,'complete original event batch required')
 for(const event of batch.events){
  assert.equal(event.timeOrigin,cursor.timeOrigin)
  assert(Number.isFinite(event.at)&&Number.isFinite(event.monotonic))
  assert(event.monotonic>=cursor.monotonic,'original renderer event clocks must remain ordered')
  cursor.monotonic=event.monotonic
 }
 cursor.offset=batch.count;return batch.events
}
module.exports=async({call,evaluate,main,click,nav,screenshot,wait,root,profile,version})=>{
 const textClick=async(scope,text)=>evaluate(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing '+${JSON.stringify(text)});b.click()})()`);
 const settings=()=>evaluate("window.kamucl.invoke('settings:get')");
 const original=await settings();
 const motionReadiness=[],favoriteReadiness=[],favoritePickerReadiness=[],carouselResourceReadiness=[],motionPreference={fixture:'prefers-reduced-motion: no-preference'};let result;
 const writeLiveProof=()=>fs.writeFileSync('out/gallery-favorites-motion-live.json',JSON.stringify({version,motionPreference,motionReadiness,favoriteReadiness,favoritePickerReadiness,carouselResourceReadiness},null,2));
 const motionSnapshot=async()=>{
  const native=await main("(()=>{const w=testElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));return{isVisible:w.isVisible(),isMinimized:w.isMinimized(),focused:w.isFocused(),bounds:w.getBounds(),backgroundThrottling:w.webContents.getBackgroundThrottling(),platform:process.platform,electron:process.versions.electron}})()");
  const renderer=await evaluate("(async()=>{const s=await window.kamucl.invoke('settings:get');return{documentHidden:document.hidden,visibilityState:document.visibilityState,motion:document.documentElement.dataset.motion,reduceMotion:s.reduceMotion,systemReduced:matchMedia('(prefers-reduced-motion: reduce)').matches,nativeVisibility:await window.kamucl.invoke('window:visibility'),stageHidden:document.querySelector('.mascot-stage')?.classList.contains('hidden')??null,images:document.querySelectorAll('.hero-image').length,timers:window.__galleryTimers?.size??null}})()");
  return{native,renderer};
 };
 const activateGallery=async(label,expectedTimers)=>{
  const proof={label,before:await motionSnapshot(),samples:[]};motionReadiness.push(proof);
  // Reloading after the native hide/show regression can leave macOS occlusion
  // pending. Activate the real window; never replace document.hidden or accept
  // a stopped multi-image carousel as a successful normal-motion test.
  await main("(()=>{const w=testElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));if(w.isMinimized())w.restore();w.show();w.focus();testElectron.app.focus({steal:true})})()");
  await call('Emulation.setFocusEmulationEnabled',{enabled:true});await call('Page.bringToFront');
  let ready=false;
  for(let i=0;i<50;i++){
   await wait(80);const sample=await motionSnapshot();proof.samples.push(sample);
   const {native,renderer}=sample;
   ready=native.isVisible&&!native.isMinimized&&native.focused&&renderer.nativeVisibility&&!renderer.documentHidden&&renderer.visibilityState==='visible'&&renderer.motion==='full'&&renderer.reduceMotion!==true&&!renderer.systemReduced&&(expectedTimers===undefined||renderer.timers===expectedTimers);
   writeLiveProof();
   if(ready)break;
  }
  if(!ready)console.error('Gallery motion readiness diagnostics',JSON.stringify(proof,null,2));
  assert(ready,label+': real foreground window and normal-motion carousel must become ready');
 };
 const favoriteTargets=[{title:'外置收藏 MR',key:'modrinth:galleryMr'},{title:'外置收藏 CF',key:'curseforge:987654'}];
 const favoriteSnapshot=async()=>{
  const renderer=await evaluate(`(async()=>{const targets=${JSON.stringify(favoriteTargets)};return{buttons:[...document.querySelectorAll('.result-favorite')].map(b=>{const label=b.getAttribute('aria-label')||'';return{key:targets.find(t=>label.endsWith(t.title))?.key??null,label,pressed:b.getAttribute('aria-pressed')==='true',busy:b.disabled}}),persistentKeys:(await window.kamucl.invoke('mods:favorites')).map(f=>f.key),failureNotice:document.body.innerText.includes('收藏写入失败'),downloadModal:!!document.querySelector('.download-modal')}})()`);
  const fixture=await main('({writes:favoriteFixtureWrites,pending:favoriteFixturePending,trace:favoriteFixtureTrace})');
  const diskKeys=JSON.parse(fs.readFileSync(path.join(profile,'mod-favorites.json'),'utf8')).map(f=>f.key);
  return{at:Date.now(),renderer,fixture,diskKeys};
 };
 const waitForFavorites=async(label,expectedKeys,writes,failureNotice=false)=>{
  const expected=[...expectedKeys].sort(),targetKeys=favoriteTargets.map(t=>t.key),proof={label,expectedKeys:expected,writes,samples:[]};favoriteReadiness.push(proof);let ready=false;
  for(let i=0;i<60;i++){
   await wait(80);const sample=await favoriteSnapshot();proof.samples.push(sample);const {renderer,fixture,diskKeys}=sample;
   const same=keys=>JSON.stringify(keys.filter(k=>targetKeys.includes(k)).sort())===JSON.stringify(expected);
   ready=renderer.buttons.length===2&&new Set(renderer.buttons.map(b=>b.key)).size===2&&renderer.buttons.every(b=>targetKeys.includes(b.key)&&!b.busy)&&same(renderer.buttons.filter(b=>b.pressed).map(b=>b.key))&&same(renderer.persistentKeys)&&same(diskKeys)&&fixture.writes===writes&&fixture.pending===0&&(!failureNotice||renderer.failureNotice);
   writeLiveProof();if(ready)break;
  }
  if(!ready)console.error('Gallery favorite readiness diagnostics',JSON.stringify(proof,null,2));
  assert(ready,label+': both idle cards, confirmed IPC/disk favorites and completed writes must agree');
 };
 // Test normal carousel playback explicitly, independent of the CI desktop's
 // accessibility preference. Record the real preference before the override,
 // restore it even after failure, and leave OS settings/product defaults alone.
 await call('Emulation.setEmulatedMedia',{features:[]});await wait(80);motionPreference.system=await motionSnapshot();
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 try{
 const sources=[path.join(root,'gallery-one.png'),path.join(root,'gallery-two.png')];
 await main(`(()=>{const fs=process.mainModule.require('node:fs');for(const [i,file]of ${JSON.stringify(sources)}.entries()){const b=Buffer.alloc(16*16*4);for(let j=0;j<b.length;j+=4){b[j]=i?30:80;b[j+1]=120;b[j+2]=i?180:220;b[j+3]=255}fs.writeFileSync(file,testElectron.nativeImage.createFromBitmap(b,{width:16,height:16}).toPNG())}testElectron.dialog.showOpenDialog=async()=>({canceled:false,filePaths:${JSON.stringify(sources)}})})()`);
 const imported=await evaluate("window.kamucl.invoke('appearance:importLaunchThumbnail')");
 const images=imported.launchThumbnail.images;assert(images.length>=2);assert(images.every(file=>fs.existsSync(file)));
 await call('Page.reload');await wait(1400);
 await evaluate(`(${require('./verify-mac-parity-ui.cjs').installMacParityObserver.toString()})()`)
 // Observe actual 100ms carousel timers without changing application code.
 await evaluate("(()=>{window.__galleryTimers=new Set();window.__gallerySet=window.setInterval;window.__galleryClear=window.clearInterval;window.setInterval=(fn,ms,...args)=>{const id=window.__gallerySet(fn,ms,...args);if(ms===100)window.__galleryTimers.add(id);return id};window.clearInterval=id=>{window.__galleryTimers.delete(id);window.__galleryClear(id)}})()");
 await activateGallery('after gallery reload');
 const openGallery=async()=>{await nav('settings');await textClick('.settings-scopes','启动器设置');await textClick('.settings-categories','外观');await evaluate('document.querySelector("details[data-section=thumbnail]").open=true');await wait(150)};
 await openGallery();assert.equal(await evaluate('document.querySelectorAll(".launch-carousel-list>li").length'),7+images.length);
 const originalImages=[...images];
 await textClick('[data-section=thumbnail]','全不选');await wait(150);let saved=await settings();assert.equal(saved.launchThumbnail.disabled.length,7+images.length);assert.deepEqual(saved.launchThumbnail.images,originalImages);assert(images.every(file=>fs.existsSync(file)));
 await nav('home');assert.equal(await evaluate('document.querySelectorAll(".hero-image").length'),0);assert(await evaluate('document.querySelector(".hero-card").classList.contains("no-banner")'));assert.equal(await evaluate('window.__galleryTimers.size'),0);await screenshot('gallery-all-disabled');
 await openGallery();await click('.launch-carousel-list .carousel-enabled input');await wait(150);await nav('home');assert.equal(await evaluate('document.querySelectorAll(".hero-image").length'),1);assert.equal(await evaluate('window.__galleryTimers.size'),0);
 await openGallery();await textClick('[data-section=thumbnail]','全选');await wait(100);
 await evaluate('(()=>{const row=document.querySelector(".launch-carousel-list>li");const input=row.querySelector(".slide-duration input");input.value="1";input.dispatchEvent(new Event("change",{bubbles:true}));row.querySelector("button[title=向后移动]").click()})()');await wait(200);saved=await settings();const reordered=saved.launchThumbnail.order;assert.equal(saved.launchThumbnail.durations['builtin:piston'],1);assert.equal(reordered[1],'builtin:piston');
 // Disable one custom file using its checkbox, preserving its physical managed copy.
 await evaluate(`(()=>{const row=[...document.querySelectorAll('.launch-carousel-list>li')].find(e=>e.querySelector('label span')?.title===${JSON.stringify(images[0])});if(!row)throw Error('custom row missing');row.querySelector('input[type=checkbox]').click()})()`);await wait(150);saved=await settings();assert(saved.launchThumbnail.disabled.includes(images[0]));assert(fs.existsSync(images[0]));await screenshot('gallery-settings');
 // A logical playlist retains every enabled item while the renderer now owns
 // only current/next/outgoing image resources. Verify a whole real timer cycle
 // using explicit one-second durations in this isolated fixture profile.
 const expectedKeys=saved.launchThumbnail.order.filter(key=>!saved.launchThumbnail.disabled.includes(key));assert.equal(expectedKeys.length,6+images.length);assert.equal(new Set(expectedKeys).size,6+images.length)
 const actualPlaylist=await evaluate(`(${readMountedEnabledPlaylist.toString()})()`);assert.deepEqual(actualPlaylist.map(row=>row.path),expectedKeys,'Actual enabled Settings VNode order must match the persisted complete logical playlist');carouselResourceReadiness.push({actualPlaylist,expectedKeys,classification:'Original enabled Settings VNode keys/sources read before leaving Settings'});writeLiveProof()
 // Commit fixture timing through the real editor. A direct main settings:set
 // persists bytes but does not update the renderer's existing appearance store.
 const randomSelector='input[aria-label="随机播放启动卡图片"]'
 if(await evaluate(`document.querySelector(${JSON.stringify(randomSelector)}).checked`))await click(randomSelector)
 for(const key of expectedKeys){
  await evaluate(`(()=>{const row=[...document.querySelectorAll('.launch-carousel-list>li')].find(e=>window.__macParityObserver.nodeForElement('HomeLayoutEditor',e).key===${JSON.stringify(key)});if(!row)throw Error('Missing actual enabled duration row');const input=row.querySelector('.slide-duration input');input.value='1';input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  let committed=false;for(let attempt=0;attempt<30;attempt++){await wait(80);const current=await settings();if(current.launchThumbnail.durations[key]===1){committed=true;break}}
  assert(committed,'actual duration editor must persist one-second timing for '+key)
 }
 const cycleSettings=await settings();assert.equal(cycleSettings.launchThumbnail.randomPlayback,false);assert(expectedKeys.every(key=>cycleSettings.launchThumbnail.durations[key]===1));carouselResourceReadiness.push({cycleSettings:cycleSettings.launchThumbnail,classification:'Real duration editor change handlers and original saved settings; complete timer cycle still required within original bounds'});writeLiveProof()
 await nav('home');await activateGallery('multiple enabled images',1);assert.equal(await evaluate('window.__galleryTimers.size'),1)
 const observerStart=await evaluate(`(${installCarouselPresentationObserver.toString()})(${JSON.stringify(actualPlaylist)},${readMountedCarousel.toString()})`);carouselResourceReadiness.push({observerStart});writeLiveProof()
 const rotation=[],rotationStarted=Date.now(),readiness={mounted:new Map(),previousRequestStartedAt:0,initialSource:null,initialDecoded:false},eventCursor={offset:0,timeOrigin:observerStart.timeOrigin,monotonic:0};let cycleComplete=false
 while(Date.now()-rotationStarted<15000){
  await wait(80);const batchRequestStartedAt=Date.now(),batch=await evaluate(`(()=>{const state=window.__carouselPresentation;if(!state)throw Error('Actual carousel observation stream missing');return{from:${eventCursor.offset},count:state.events.length,timeOrigin:state.timeOrigin,errors:state.errors,events:state.events.slice(${eventCursor.offset})}})()`),batchReturnedAt=Date.now();carouselResourceReadiness.push({batchRequestStartedAt,batchReturnedAt,batch});writeLiveProof()
  for(const event of verifyCarouselEventBatch(batch,eventCursor)){
  assert(event.monotonic-observerStart.monotonicStartedAt<15000,'complete actual carousel cycle must be captured within the original fifteen-second limit')
  const {snapshot}=event,requestStartedAt=event.at;readiness.previousRequestStartedAt||=requestStartedAt;const proof={...event,requestStartedAt,source:'Original renderer event, not CDP response arrival'};carouselResourceReadiness.push(proof);writeLiveProof();assert.equal(snapshot.documentHidden,false);assert.equal(snapshot.timers,1)
  proof.readiness=verifyCarouselReadiness(snapshot,readiness,requestStartedAt,proof.at);writeLiveProof();if(!proof.readiness.ready)continue
  const observed=verifyRetainedCarousel(snapshot,expectedKeys)
  if(rotation.at(-1)?.current!==observed.current){if(rotation.length)assert.equal(observed.current,(rotation.at(-1).current+1)%expectedKeys.length,'real timer follows complete saved cyclic order');rotation.push(observed)}
  cycleComplete=rotation.length>=expectedKeys.length+1&&new Set(rotation.slice(0,expectedKeys.length).map(row=>row.current)).size===expectedKeys.length&&rotation.at(-1).current===rotation[0].current
  if(cycleComplete)break
  }
  if(cycleComplete)break
 }
 const finalEventBatch=await evaluate(`window.__carouselPresentation.stop(${eventCursor.offset})`);verifyCarouselEventBatch(finalEventBatch,eventCursor);assert.equal(finalEventBatch.closed,true);carouselResourceReadiness.push({finalEventBatch,classification:'Atomic stop and remaining original event closure; tail is retained and never used to manufacture a completed cycle'});writeLiveProof()
 assert(cycleComplete,'all eight logical images must rotate through one complete actual timer cycle without retaining more than three DOM image layers');carouselResourceReadiness.push({complete:true,expectedKeys,rotation,fixtureDurationsSeconds:1});writeLiveProof()
 // Theme code uses bundled IDs directly, remaps managed references, and keeps disabled data.
 const code=await evaluate("window.kamucl.invoke('appearance:exportTheme')");const payload=JSON.parse(gunzipSync(Buffer.from(code.slice(8),'base64')));assert(payload.launchThumbnail.order.includes('builtin:piston'));assert(payload.launchThumbnail.disabled[0].startsWith('image-'));
 const roundtrip=await evaluate(`window.kamucl.invoke('appearance:importTheme',${JSON.stringify(code)},true)`);assert(roundtrip.launchThumbnail.order.includes('builtin:piston'));assert(roundtrip.launchThumbnail.disabled.includes(roundtrip.launchThumbnail.images[0]));assert.deepEqual(roundtrip.launchThumbnail.images.map(file=>fs.readFileSync(file)),images.map(file=>fs.readFileSync(file)));
 // Two sources on external cards; clicking a favorite never opens the download dialog.
 await main("globalThis.favoriteFixtureFail=false;globalThis.favoriteFixtureWrites=0;globalThis.favoriteFixturePending=0;globalThis.favoriteFixtureTrace=[];globalThis.favoriteFixtureStore=testElectron.ipcMain._invokeHandlers.get('mods:favorite');testElectron.ipcMain.removeHandler('mods:favorite');testElectron.ipcMain.handle('mods:favorite',async(...args)=>{const write=++favoriteFixtureWrites,key=args[1].source+':'+args[1].projectId;favoriteFixturePending++;favoriteFixtureTrace.push({type:'start',at:Date.now(),write,key,enabled:args[2]});try{if(favoriteFixtureFail)throw Error('隔离验证：收藏写入失败');await new Promise(r=>setTimeout(r,80));const list=await favoriteFixtureStore(...args);favoriteFixtureTrace.push({type:'confirmed',at:Date.now(),write,key,keys:list.map(f=>f.key)});return list}catch(error){favoriteFixtureTrace.push({type:'failed',at:Date.now(),write,key,error:error.message});throw error}finally{favoriteFixturePending--}});testElectron.ipcMain.removeHandler('community:search');testElectron.ipcMain.handle('community:search',()=>({items:[{source:'modrinth',projectId:'galleryMr',title:'外置收藏 MR',downloads:123,updatedAt:'2026-10-02',description:'隔离搜索数据'},{source:'curseforge',projectId:'987654',title:'外置收藏 CF',downloads:456,updatedAt:'2026-10-02',description:'隔离搜索数据'}],total:2}));testElectron.ipcMain.removeHandler('community:files');testElectron.ipcMain.handle('community:files',(_e,s,p)=>[{source:s,projectId:p,fileId:'fixture',version:'fixture',fileName:'fixture.jar',gameVersions:['26.3'],loaders:['fabric'],releaseType:'release',size:1,url:'https://fixture.invalid/fixture.jar'}]);");
 await nav('community');await wait(250);assert.equal(await evaluate('document.querySelectorAll(".result-favorite").length'),2);
 await evaluate('document.querySelectorAll(".result-favorite").forEach(e=>e.click())');await waitForFavorites('both external cards collected',favoriteTargets.map(t=>t.key),2);assert.equal(await evaluate('document.querySelectorAll(".result-favorite[aria-pressed=true]").length'),2);assert(!await evaluate('!!document.querySelector(".download-modal")'));
 await click('.result-dl');await wait(150);assert((await evaluate('document.querySelector(".download-modal").innerText')).includes('已收藏'));await evaluate('[...document.querySelectorAll(".modal-links button")].find(e=>e.textContent.includes("已收藏")).click()');await waitForFavorites('detail removal synchronized',['curseforge:987654'],3);await evaluate('document.querySelector(".modal-mask").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');await wait(100);assert.equal(await evaluate('document.querySelectorAll(".result-favorite[aria-pressed=true]").length'),1);
 await main('favoriteFixtureFail=true');await click('.result-favorite');await waitForFavorites('failed write preserves confirmed favorites',['curseforge:987654'],4,true);assert.equal(await evaluate('document.querySelector(".result-favorite").getAttribute("aria-pressed")'),'false');assert(!await evaluate('document.querySelector(".result-favorite").disabled'));assert((await evaluate('document.body.innerText')).includes('收藏写入失败'));await main('favoriteFixtureFail=false');await click('.result-favorite');await waitForFavorites('retry synchronizes both cards',favoriteTargets.map(t=>t.key),5);assert.equal(await evaluate('document.querySelector(".result-favorite").getAttribute("aria-pressed")'),'true');await screenshot('community-external-favorites');
 // Synthetic metadata only: its fixture URL and SHA1 are never downloaded or
 // counted as real-service evidence. Ticket callers receive the current IPC shape.
 await main("globalThis.galleryFavoriteRequests=[];for(const [channel,fn]of [['versions:catalog',()=>({versions:[{id:'26.3',type:'release',url:'https://fixture.invalid/26.3.json',releaseTime:'2026-09-15T11:00:00Z'}],checkedAt:Date.now(),stale:false})],['loaders:list',()=>['fixture-loader']],['mods:favoriteVersions',async(_e,s,p,mc,l,ticket)=>{const request={source:s,project:p,mc,loader:l,ticket,startedAt:Date.now(),finishedAt:0};galleryFavoriteRequests.push(request);const files=[{source:s,projectId:p,fileId:'fixture',version:'compatible-'+l,fileName:'fixture.jar',gameVersions:[mc],loaders:[l],releaseType:'release',size:1,url:'https://fixture.invalid/fixture.jar',sha1:'1'.repeat(40)}];request.finishedAt=Date.now();return ticket===undefined?files:{files,status:'available'}}]]){testElectron.ipcMain.removeHandler(channel);testElectron.ipcMain.handle(channel,fn)}");
 await nav('game');await click('[data-tab=download]');await wait(150);await click('.latest-release .btn-gold');await wait(120);await click('.favorite-picker>label input');await textClick('.loader-options','Fabric');
 let pickerReady=false;
 for(let i=0;i<60;i++){
  await wait(80);const renderer=await evaluate("(()=>{const p=document.querySelector('.favorite-picker');return{enabled:p?.querySelector('label input')?.checked,loading:!!p?.querySelector('[data-ui=\"favorites:loading\"]'),rows:[...p?.querySelectorAll('.favorite-row')||[]].map(e=>({key:e.dataset.favoriteKey,text:e.innerText,checked:e.querySelector('input')?.checked,disabled:e.querySelector('input')?.disabled})),summary:p?.querySelector('[data-ui=\"favorites:summary\"]')?.innerText,alert:p?.querySelector('[role=alert]')?.innerText}})()"),requests=await main('galleryFavoriteRequests');
  const sample={at:Date.now(),renderer,requests};favoritePickerReadiness.push(sample);writeLiveProof();
  const targetRows=renderer.rows.filter(row=>favoriteTargets.some(target=>target.key===row.key)),selectedRows=renderer.rows.filter(row=>row.checked===true&&row.disabled===false),skippedRows=renderer.rows.filter(row=>row.checked===false&&row.disabled===true&&row.text.includes('来源项目尚未关联')&&row.text.includes('本次跳过'));
  pickerReady=renderer.enabled===true&&!renderer.loading&&!renderer.alert&&targetRows.length===2&&new Set(targetRows.map(row=>row.key)).size===2&&targetRows.every(row=>row.checked===true&&row.disabled===false&&row.text.includes('compatible-fabric'))&&renderer.rows.every(row=>selectedRows.includes(row)||skippedRows.includes(row))&&renderer.summary?.includes('将安装 '+selectedRows.length+' 项收藏模组，跳过 '+skippedRows.length+' 项')&&favoriteTargets.every(target=>requests.some(request=>request.source+':'+request.project===target.key&&request.loader==='fabric'&&request.mc==='26.3'&&request.ticket&&request.finishedAt));
  if(pickerReady)break;
 }
 assert(pickerReady,'both target favorite rows must settle as selected compatible Fabric metadata; every retained row must be selected or explicitly unlinked/skipped, with exact summary and completed ticket requests');await textClick('.modal-actions','取消');
 await evaluate(`window.kamucl.invoke('settings:set',{launchThumbnail:${JSON.stringify(original.launchThumbnail)}})`);await nav('home');await evaluate('window.setInterval=window.__gallerySet;window.clearInterval=window.__galleryClear');
 result={version,builtins:7,mixed:true,disabledPreservesFiles:true,zeroAndSingleNoTimer:true,mixedOrder:reordered,logicalPlaylistCount:expectedKeys.length,completeRealRotation:cycleComplete,maxDecodedLayers:Math.max(...carouselResourceReadiness.filter(row=>row.snapshot).map(row=>row.snapshot.images.length)),themeRoundtrip:true,externalBothSources:true,detailAndInstallSynced:true,writeFailureRecoverable:true,serviceClassification:'Isolated synthetic search, compatibility metadata and injected write failure; no real downloads or game installation in this module.'};
 }finally{
  const finalObserverClosure=await evaluate('window.__carouselPresentation?.stop(0)??null');if(finalObserverClosure){carouselResourceReadiness.push({finalObserverClosure,classification:'Original full observation buffer from installation through atomic disconnection, including failure paths'});writeLiveProof()}
  await call('Emulation.setEmulatedMedia',{features:[]});await wait(80);motionPreference.restored=await motionSnapshot();
  writeLiveProof();
 }
 fs.writeFileSync('out/gallery-favorites-ui-'+(process.env.KAMUCL_TEST_THEME||'black-orange')+'.json',JSON.stringify({...result,motionPreference,motionReadiness,favoriteReadiness,favoritePickerReadiness,carouselResourceReadiness},null,2));console.log('Gallery and external favorites GUI checks passed');
};
module.exports.verifyRetainedCarousel=verifyRetainedCarousel;
Object.assign(module.exports,{readMountedEnabledPlaylist,readMountedCarousel,verifyCarouselReadiness,installCarouselPresentationObserver,verifyCarouselEventBatch});
