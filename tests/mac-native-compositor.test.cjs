const test=require('node:test'),assert=require('node:assert/strict')
const {createNativeSession,withRestoration}=require('../scripts/verify-kamu-native-compositor-119.cjs')
const {installRendererObserver}=require('../scripts/verify-kamu-native-compositor-119.cjs'),vm=require('node:vm')
function fixture(){
 const calls=[],w={id:7,webContents:{id:11,getURL:()=> 'file:///Applications/KAMUCL.app/Contents/Resources/app.asar/out/renderer/index.html',isDestroyed:()=>false},isDestroyed:()=>false,isFocused:()=>true,isVisible:()=>true,isMinimized:()=>false,getBounds:()=>({x:0,y:0,width:1280,height:900}),getBackgroundColor:()=> '#00000000',getOpacity:()=>1,setVibrancy:value=>calls.push(value)}
 const electron={BrowserWindow:{getAllWindows:()=>[w]},screen:{getDisplayMatching:()=>({id:1,size:{width:1920,height:1080},scaleFactor:1,displayFrequency:60})}}
 return{calls,w,electron}
}
test('native compositor guards the exact window identity and rejects ambiguity',()=>{
 const f=fixture();assert.throws(()=>createNativeSession(f.electron,'win32'),/Darwin/)
 const session=createNativeSession(f.electron,'darwin');session.set(null)
 f.w.webContents={...f.w.webContents,id:12};assert.throws(()=>session.restore(),/target changed/);assert.deepEqual(f.calls,[null])
 const g=fixture();g.electron.BrowserWindow.getAllWindows=()=>[g.w,{...g.w,id:8}];assert.throws(()=>createNativeSession(g.electron,'darwin'),/exactly one/);assert.deepEqual(g.calls,[])
})
test('a failed B recording still restores sidebar and renderer hooks without passing the failure',async()=>{
 const f=fixture(),session=createNativeSession(f.electron,'darwin');let restored=false
 await assert.rejects(withRestoration(async()=>{session.set('sidebar');session.set(null);throw Error('capture lost')},()=>session.restore(),()=>{restored=true}),/capture lost/)
 assert.deepEqual(f.calls,['sidebar',null,'sidebar']);assert.equal(restored,true);assert.equal(session.snapshot().appliedMaterial,'sidebar')
})
test('a destroyed native target does not prevent renderer cleanup or suppress either failure',async()=>{
 const f=fixture(),session=createNativeSession(f.electron,'darwin');let restored=false
 await assert.rejects(withRestoration(async()=>{session.set(null);f.w.isDestroyed=()=>true;throw Error('window disappeared')},()=>session.restore(),()=>{restored=true}),error=>error instanceof AggregateError&&error.errors.length===2&&error.errors[0].message==='window disappeared'&&/target changed/.test(error.errors[1].message))
 assert.equal(restored,true);assert.deepEqual(f.calls,[null])
})

test('renderer observer records public Animation timing and computed feedback without driving or replacing any effect',()=>{
 let now=100,observer,reads=0
 const timing={duration:75,activeDuration:75,endTime:75,localTime:12,progress:.16,currentIteration:0,fill:'both'}
 const effect={getComputedTiming(){reads++;return timing}},animation={currentTime:12,startTime:88,playState:'running',pending:false,playbackRate:1,effect}
 const palm={computed:{opacity:'.84',transform:'matrix(1, 0, 0, 1, 2, -2)'},getAnimations:()=>[animation]},print={computed:{opacity:'.70',transform:'none'},getAnimations:()=>[]}
 const stage={dataset:{phase:'slap',queue:'2',contacts:'1',soundsPlayed:'1',cycleId:'5',contactAt:'88',palmAnimationPhase:'retreat',printAnimationPhase:'fade',renderMs:'.5',renderNow:'100',frameCallbackKind:'watchdog'},querySelector:selector=>selector==='.pixel-palm'?palm:print}
 class Canvas2D{putImageData(){return 'original canvas draw'}}
 class BufferSource{start(){return 'original sound start'}}
 const sourceStart=BufferSource.prototype.start,canvasDraw=Canvas2D.prototype.putImageData
 const window={addEventListener(){},removeEventListener(){}}
 const context=vm.createContext({window,document:{hidden:false,hasFocus:()=>true,querySelector:()=>stage,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}},Element:class{},CanvasRenderingContext2D:Canvas2D,AudioBufferSourceNode:BufferSource,getComputedStyle:image=>image.computed,performance:{now:()=>now},MutationObserver:class{constructor(callback){observer=callback}observe(){}disconnect(){}},requestAnimationFrame:()=>7,cancelAnimationFrame(){},setInterval:()=>8,clearInterval(){},PerformanceObserver:class{constructor(){}observe(){}takeRecords(){return[]}disconnect(){}}})
 vm.runInContext(`(${installRendererObserver.toString()})()`,context);window.__kamuCompositorDiag.start();observer()
 now=125;animation.currentTime=37;timing.localTime=37;timing.progress=37/75;palm.computed.opacity=String(1-37/75);observer()
 const result=window.__kamuCompositorDiag.stop(),first=result.samples[0],next=result.samples[1]
 assert.equal(first.cycleId,5);assert.equal(first.contactAt,88);assert.equal(first.palmAnimationPhase,'retreat');assert.equal(first.printAnimationPhase,'fade')
 assert.equal(first.palmAnimation.animations[0].currentTime,12);assert.equal(first.palmAnimation.animations[0].computedTiming.localTime,12);assert.equal(first.palmAnimation.transform,palm.computed.transform)
 assert.equal(next.palmAnimation.animations[0].currentTime,37);assert.equal(next.palmAnimation.animations[0].computedTiming.progress,37/75);assert.equal(next.palm,1-37/75);assert.equal(reads,2)
 assert.equal(animation.currentTime,37);assert.equal(animation.effect,effect,'read-only observer never creates, cancels or swaps an animation')
 const restored=window.__kamuCompositorDiag.restore();assert(restored.restored);assert.equal(BufferSource.prototype.start,sourceStart);assert.equal(Canvas2D.prototype.putImageData,canvasDraw)
})
