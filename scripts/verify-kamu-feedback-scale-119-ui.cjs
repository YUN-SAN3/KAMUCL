// Opt-in real-coordinate diagnostic for the authored 15px feedback at noninteger
// zoom. All PNG/JPEG pixels and compositor timestamps are original captures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
function assertScaleContract(entry){
 assert.equal(entry.accepted,8);assert.equal(entry.after.phase,'front');assert.equal(entry.after.queue,0)
 assert.equal(entry.after.contacts-entry.before.contacts,entry.accepted)
 assert.equal(entry.after.sounds-entry.before.sounds,entry.accepted)
 assert.equal((entry.savedAfter.counts.kamu||0)-(entry.savedBefore.counts.kamu||0),entry.accepted)
 assert(entry.observations.length>=2,'real render observations required')
 assert(entry.observations.every(s=>s.queue>=0&&s.queue<=32&&!s.hidden),'real queue limit and visible recording required')
 assert(entry.observations.some(s=>s.palm.opacity>0&&s.phase==='slap'),'moving pixel palm must be observed at actual zoom')
 assert(entry.observations.some(s=>s.print.opacity>0),'handprint must be observed at actual zoom')
 for(const s of entry.observations)for(const image of [s.palm,s.print]){
  assert.equal(image.tag,'IMG');assert.equal(image.complete,true);assert.equal(image.width,15);assert.equal(image.height,15)
  assert.equal(image.imageRendering,'pixelated');assert(image.rect.width>0&&image.rect.height>0)
 }
 assert(entry.recording.frames.length>=2&&Number.isFinite(entry.recording.fps)&&entry.recording.fps>0,'original continuous compositor frames required')
}
module.exports=async function feedbackScale(h){
 const {call,evaluate,main,nav,wait,version,recordScreencast}=h,theme=process.env.KAMUCL_TEST_THEME||'black-orange'
 assert.equal(version,require('../package.json').version);assert(require('./ui-capabilities.cjs').singleLogo);assert.equal(typeof recordScreencast,'function')
 const runId=new Date().toISOString().replace(/[:.]/g,'-')
 const proof={version,theme,runId,complete:false,classification:'opt-in noninteger feedback scale diagnostic; screenshot requests may affect timing, separate from formal baseline motion acceptance',hardwareListening:'not performed',cases:[]}
 const file='out/feedback-scale-119-'+runId+'-'+theme+'.json',persist=()=>{const content=JSON.stringify(proof,null,2);fs.writeFileSync(file,content);fs.writeFileSync('out/feedback-scale-119-'+theme+'.json',content)}
 const stateExpression=`(()=>{const e=document.querySelector('.mascot-stage'),b=document.querySelector('[data-hit=kamu]'),image=selector=>{const img=e?.querySelector(selector);if(!img)return null;const css=getComputedStyle(img);return{tag:img.tagName,complete:img.complete,width:img.naturalWidth,height:img.naturalHeight,rect:img.getBoundingClientRect().toJSON(),opacity:Number(css.opacity),transform:css.transform,imageRendering:css.imageRendering}};return{at:performance.now(),wallTime:Date.now(),open:!!e,readyAt:Number(e?.dataset.readyAt),disabled:b?.disabled,phase:e?.dataset.phase,queue:Number(e?.dataset.queue||0),contacts:Number(e?.dataset.contacts||0),sounds:Number(e?.dataset.soundsPlayed||0),hidden:document.hidden,documentFocus:document.hasFocus(),count:Number(b?.getAttribute('aria-label')?.match(/累计 (\\d+) 次/)?.[1]),feedbackPreparation:e?.dataset.feedbackPreparation,palmDecodedAt:Number(e?.dataset.feedbackPalmDecodedAt),printDecodedAt:Number(e?.dataset.feedbackPrintDecodedAt),palm:image('.pixel-palm'),print:image('.palm-print'),feedbackRect:e?.querySelector('.mascot-feedback')?.getBoundingClientRect().toJSON()}})()`
 const snapshot=()=>evaluate(stateExpression),saved=()=>evaluate("window.kamucl.invoke('mascots:state')")
 const until=async(label,predicate)=>{let last;for(let i=0;i<160;i++){last=await snapshot();if(await predicate(last))return last;await wait(20)}proof.failure={label,last};persist();assert.fail(label+': '+JSON.stringify(last))}
 const click=async selector=>{
  const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Missing or disabled coordinate target');const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,target=document.elementFromPoint(x,y);if(!r.width||!r.height||target!==e&&!e.contains(target))throw Error('Occluded coordinate target');return{x,y}})()`)
  await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p})
 }
 const capture=async(directory,name)=>{
  const before=await snapshot(),requestedAt=Date.now(),png=await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false}),returnedAt=Date.now(),after=await snapshot(),file=path.join(directory,name+'.png')
  fs.writeFileSync(file,Buffer.from(png.data,'base64'));return{file,requestedAt,returnedAt,before,after,classification:'original PNG response; surrounding state samples are observations, not forced frame or phase'}
 }
 const windowState=()=>main("(()=>{const w=testElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));return{bounds:w.getBounds(),zoom:w.webContents.getZoomFactor()}})()")
 const native=activate=>main(`(()=>{const w=testElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));if(${activate}){if(process.platform==='darwin')testElectron.app.focus({steal:true});w.show();w.focus()}const d=testElectron.screen.getDisplayMatching(w.getBounds());return{platform:process.platform,arch:process.arch,windowFocused:w.isFocused(),activeDisplay:{id:d.id,size:d.size,scaleFactor:d.scaleFactor,displayFrequency:d.displayFrequency}}})()`)
 const close=async()=>{if((await snapshot()).open){await click('.menu-tool');await click('.sound-panel button:last-of-type');await until('actual feedback diagnostic stage close',s=>!s.open)}}
 const original=await windowState()
 try{
  await nav('skins');await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await close()
  proof.preferencesBefore=(await saved()).sound;assert(!proof.preferencesBefore.muted&&proof.preferencesBefore.volume>0,'existing audible preference required; diagnostic does not change preferences')
  proof.native=await native(true);await call('Page.bringToFront');await click('.brand-avatar')
  proof.ready=await until('real decoded feedback and rendered model ready',s=>s.open&&!s.disabled&&s.readyAt>0)
  assert.equal(proof.ready.feedbackPreparation,'decoded');for(const image of [proof.ready.palm,proof.ready.print]){assert(image.complete);assert.equal(image.width,15);assert.equal(image.height,15)}
  assert(proof.ready.palmDecodedAt>0&&proof.ready.printDecodedAt>0&&Math.max(proof.ready.palmDecodedAt,proof.ready.printDecodedAt)<=proof.ready.readyAt)
  for(const [width,height,zoom] of [[1280,900,1.25],[960,620,1.5]]){
   await main(`(()=>{const w=testElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));w.setSize(${width},${height});w.webContents.setZoomFactor(${zoom})})()`)
   const entry={width,height,zoom,window:await windowState(),accepted:8,classification:proof.classification,originalNativeDisplay:await native(false),before:await snapshot(),savedBefore:await saved(),screenshots:[]};proof.cases.push(entry);assert.equal(entry.window.zoom,zoom)
   const directory=path.resolve('out','feedback-scale-119-'+runId+'-'+width+'-'+String(zoom).replace('.','_')+'-'+theme);fs.mkdirSync(directory,{recursive:true})
   entry.screenshots.push(await capture(directory,'before'))
   await evaluate(`(()=>{const samples=[],sample=()=>samples.push(${stateExpression}),observer=new MutationObserver(sample);observer.observe(document.querySelector('.mascot-stage'),{attributes:true,attributeFilter:['data-render-ms']});sample();window.__kamuFeedbackScale={samples,observer}})()`)
   entry.recording=await recordScreencast('feedback-scale-119-'+runId+'-'+width+'-'+String(zoom).replace('.','_')+'-screencast',async()=>{
    for(let i=0;i<entry.accepted;i++)await click('[data-hit=kamu]')
    const visible=await until('actual visible palm and handprint at '+zoom,s=>s.phase==='slap'&&s.palm.opacity>0&&s.print.opacity>0)
    entry.contactObserved=visible;entry.screenshots.push(await capture(directory,'contact-visible-request'))
    await until('eight actual contacts, sounds, saved count and front return at '+zoom,async s=>s.phase==='front'&&s.queue===0&&s.contacts===entry.before.contacts+8&&s.sounds===entry.before.sounds+8&&(await saved()).counts.kamu===(entry.savedBefore.counts.kamu||0)+8)
   },250)
   entry.observations=await evaluate("(()=>{const p=window.__kamuFeedbackScale;p.observer.disconnect();window.__kamuFeedbackScale=null;return p.samples})()")
   entry.after=await snapshot();entry.savedAfter=await saved();entry.screenshots.push(await capture(directory,'after'))
   entry.benchmark=require('./mascot-capture-budget.cjs')(entry.originalNativeDisplay,entry.recording.fps);entry.benchmark.status=entry.benchmark.passed?'passed':'below-target';persist();assertScaleContract(entry);entry.functionalComplete=true;persist()
  }
  await close();proof.finalState=await saved();assert.deepEqual(proof.finalState.sound,proof.preferencesBefore);proof.complete=true;persist()
 }catch(error){proof.error=String(error);persist();throw error}
 finally{
  await evaluate("(()=>{const p=window.__kamuFeedbackScale;p?.observer.disconnect();window.__kamuFeedbackScale=null})()");await close()
  await main(`(()=>{const w=testElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));w.webContents.setZoomFactor(${original.zoom});w.setBounds(${JSON.stringify(original.bounds)})})()`);persist()
 }
 console.log('FEEDBACK SCALE119 '+theme+' '+proof.cases.map(c=>c.zoom+'='+c.recording.fps+'fps').join('; ')+' manifest='+file)
}
module.exports.assertScaleContract=assertScaleContract
