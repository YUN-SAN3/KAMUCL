// Real gallery files and shared favorite UI; network fixtures remain inside the isolated test process.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{gunzipSync}=require('node:zlib');
module.exports=async({call,evaluate,main,click,nav,screenshot,wait,root,profile,version})=>{
 const textClick=async(scope,text)=>evaluate(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing '+${JSON.stringify(text)});b.click()})()`);
 const settings=()=>evaluate("window.kamucl.invoke('settings:get')");
 const original=await settings();
 const motionReadiness=[],favoriteReadiness=[],motionPreference={fixture:'prefers-reduced-motion: no-preference'};let result;
 const writeLiveProof=()=>fs.writeFileSync('out/gallery-favorites-motion-live.json',JSON.stringify({version,motionPreference,motionReadiness,favoriteReadiness},null,2));
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
 await nav('home');assert.equal(await evaluate('document.querySelectorAll(".hero-image").length'),6+images.length);await activateGallery('multiple enabled images',1);assert.equal(await evaluate('window.__galleryTimers.size'),1);
 // Theme code uses bundled IDs directly, remaps managed references, and keeps disabled data.
 const code=await evaluate("window.kamucl.invoke('appearance:exportTheme')");const payload=JSON.parse(gunzipSync(Buffer.from(code.slice(8),'base64')));assert(payload.launchThumbnail.order.includes('builtin:piston'));assert(payload.launchThumbnail.disabled[0].startsWith('image-'));
 const roundtrip=await evaluate(`window.kamucl.invoke('appearance:importTheme',${JSON.stringify(code)},true)`);assert(roundtrip.launchThumbnail.order.includes('builtin:piston'));assert(roundtrip.launchThumbnail.disabled.includes(roundtrip.launchThumbnail.images[0]));assert.deepEqual(roundtrip.launchThumbnail.images.map(file=>fs.readFileSync(file)),images.map(file=>fs.readFileSync(file)));
 // Two sources on external cards; clicking a favorite never opens the download dialog.
 await main("globalThis.favoriteFixtureFail=false;globalThis.favoriteFixtureWrites=0;globalThis.favoriteFixturePending=0;globalThis.favoriteFixtureTrace=[];globalThis.favoriteFixtureStore=testElectron.ipcMain._invokeHandlers.get('mods:favorite');testElectron.ipcMain.removeHandler('mods:favorite');testElectron.ipcMain.handle('mods:favorite',async(...args)=>{const write=++favoriteFixtureWrites,key=args[1].source+':'+args[1].projectId;favoriteFixturePending++;favoriteFixtureTrace.push({type:'start',at:Date.now(),write,key,enabled:args[2]});try{if(favoriteFixtureFail)throw Error('隔离验证：收藏写入失败');await new Promise(r=>setTimeout(r,80));const list=await favoriteFixtureStore(...args);favoriteFixtureTrace.push({type:'confirmed',at:Date.now(),write,key,keys:list.map(f=>f.key)});return list}catch(error){favoriteFixtureTrace.push({type:'failed',at:Date.now(),write,key,error:error.message});throw error}finally{favoriteFixturePending--}});testElectron.ipcMain.removeHandler('community:search');testElectron.ipcMain.handle('community:search',()=>({items:[{source:'modrinth',projectId:'galleryMr',title:'外置收藏 MR',downloads:123,updatedAt:'2026-10-02',description:'隔离搜索数据'},{source:'curseforge',projectId:'987654',title:'外置收藏 CF',downloads:456,updatedAt:'2026-10-02',description:'隔离搜索数据'}],total:2}));testElectron.ipcMain.removeHandler('community:files');testElectron.ipcMain.handle('community:files',(_e,s,p)=>[{source:s,projectId:p,fileId:'fixture',version:'fixture',fileName:'fixture.jar',gameVersions:['26.3'],loaders:['fabric'],releaseType:'release',size:1,url:'https://fixture.invalid/fixture.jar'}]);");
 await nav('community');await wait(250);assert.equal(await evaluate('document.querySelectorAll(".result-favorite").length'),2);
 await evaluate('document.querySelectorAll(".result-favorite").forEach(e=>e.click())');await waitForFavorites('both external cards collected',favoriteTargets.map(t=>t.key),2);assert.equal(await evaluate('document.querySelectorAll(".result-favorite[aria-pressed=true]").length'),2);assert(!await evaluate('!!document.querySelector(".download-modal")'));
 await click('.result-dl');await wait(150);assert((await evaluate('document.querySelector(".download-modal").innerText')).includes('已收藏'));await evaluate('[...document.querySelectorAll(".modal-links button")].find(e=>e.textContent.includes("已收藏")).click()');await waitForFavorites('detail removal synchronized',['curseforge:987654'],3);await evaluate('document.querySelector(".modal-mask").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');await wait(100);assert.equal(await evaluate('document.querySelectorAll(".result-favorite[aria-pressed=true]").length'),1);
 await main('favoriteFixtureFail=true');await click('.result-favorite');await waitForFavorites('failed write preserves confirmed favorites',['curseforge:987654'],4,true);assert.equal(await evaluate('document.querySelector(".result-favorite").getAttribute("aria-pressed")'),'false');assert(!await evaluate('document.querySelector(".result-favorite").disabled'));assert((await evaluate('document.body.innerText')).includes('收藏写入失败'));await main('favoriteFixtureFail=false');await click('.result-favorite');await waitForFavorites('retry synchronizes both cards',favoriteTargets.map(t=>t.key),5);assert.equal(await evaluate('document.querySelector(".result-favorite").getAttribute("aria-pressed")'),'true');await screenshot('community-external-favorites');
 await main("for(const [channel,fn]of [['versions:catalog',()=>({versions:[{id:'26.3',type:'release',url:'https://fixture.invalid/26.3.json',releaseTime:'2026-09-15T11:00:00Z'}],checkedAt:Date.now(),stale:false})],['loaders:list',()=>['fixture-loader']],['mods:favoriteVersions',async(_e,s,p,mc,l)=>[{source:s,projectId:p,fileId:'fixture',version:'compatible-'+l,fileName:'fixture.jar',gameVersions:[mc],loaders:[l],releaseType:'release',size:1,url:'https://fixture.invalid/fixture.jar'}]]]){testElectron.ipcMain.removeHandler(channel);testElectron.ipcMain.handle(channel,fn)}");
 await nav('game');await click('[data-tab=download]');await wait(150);await click('.latest-release .btn-gold');await wait(120);await click('.favorite-picker>label input');await textClick('.loader-options','Fabric');await wait(250);const picker=await evaluate('document.querySelector(".favorite-picker").innerText');assert(picker.includes('外置收藏 MR')&&picker.includes('外置收藏 CF'));await textClick('.modal-actions','取消');
 await evaluate(`window.kamucl.invoke('settings:set',{launchThumbnail:${JSON.stringify(original.launchThumbnail)}})`);await nav('home');await evaluate('window.setInterval=window.__gallerySet;window.clearInterval=window.__galleryClear');
 result={version,builtins:7,mixed:true,disabledPreservesFiles:true,zeroAndSingleNoTimer:true,mixedOrder:reordered,themeRoundtrip:true,externalBothSources:true,detailAndInstallSynced:true,writeFailureRecoverable:true};
 }finally{
  await call('Emulation.setEmulatedMedia',{features:[]});await wait(80);motionPreference.restored=await motionSnapshot();
  writeLiveProof();
 }
 fs.writeFileSync('out/gallery-favorites-ui-'+(process.env.KAMUCL_TEST_THEME||'black-orange')+'.json',JSON.stringify({...result,motionPreference,motionReadiness,favoriteReadiness},null,2));console.log('Gallery and external favorites GUI checks passed');
};
