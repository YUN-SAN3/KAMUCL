const test=require('node:test'),assert=require('node:assert/strict'),{requireNormalMotion,assertNormalMotion,assertSameStage,observerCases}=require('../scripts/verify-kamu-observer-aba-119.cjs')
const normal=()=>({readyAt:123,backend:'canvas2d-depth',bufferPreparation:'ended',focus:true,hidden:false,disabled:false,motion:{noPreference:true,reduced:false,stageReduced:false},viewport:{width:1280,height:900,scale:1}})
const reference=()=>({native:{windowId:2,webContentsId:2,ownerPID:123,zoom:1,bounds:{x:280,y:54,width:1280,height:900},backgroundThrottling:true,visible:true,focused:true,minimized:false,appHidden:false},state:normal(),request:{displayID:1,ownerPID:123,windowBounds:{x:280,y:54,width:1280,height:900},crop:{x:285,y:89,width:72,height:96},expectedScale:1}})
test('normal motion request is exact and actual media is read only after original dispatch returns',async()=>{
 let resolve,requested=false,read=false;const returned=new Promise(r=>resolve=r)
 const task=requireNormalMotion(async(method,params)=>{assert.equal(method,'Emulation.setEmulatedMedia');assert.deepEqual(params,{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});requested=true;await returned},async expression=>{read=true;assert.match(expression,/matchMedia/);return{noPreference:true,reduced:false}})
 assert(requested);assert.equal(read,false);resolve();assert.deepEqual(await task,{requested:'no-preference',actual:{noPreference:true,reduced:false}});assert(read)
})
test('successful dispatch cannot disguise actual reduced media and no LOGO action is fabricated',async()=>{
 for(const actual of [{noPreference:false,reduced:true},{noPreference:true,reduced:true},{noPreference:false,reduced:false}])await assert.rejects(requireNormalMotion(async()=>({}),async()=>actual))
 const error=new Error('original dispatch failure');let read=false;await assert.rejects(requireNormalMotion(async()=>{throw error},async()=>{read=true}),e=>e===error);assert.equal(read,false)
})
test('normal-ready guard rejects missing, requested-only, media-reduced and actual reduced stage states',()=>{
 assertNormalMotion(normal())
 for(const mutate of [s=>delete s.motion,s=>s.motion.noPreference=false,s=>s.motion.reduced=true,s=>s.motion.stageReduced=true,s=>s.motion.stageReduced=null]){const s=normal();mutate(s);assert.throws(()=>assertNormalMotion(s))}
})
test('each of the six ABA cases rejects actual mid-run media/class changes and an already reduced reference',()=>{
 for(const config of observerCases())for(const mutate of [s=>s.motion.noPreference=false,s=>s.motion.reduced=true,s=>s.motion.stageReduced=true]){
  const before=reference(),after=reference();assertSameStage(before,after);mutate(after.state);assert.throws(()=>assertSameStage(before,after),undefined,config.name)
  const reduced=reference();mutate(reduced.state);assert.throws(()=>assertSameStage(reduced,reference()),undefined,config.name)
 }
})

