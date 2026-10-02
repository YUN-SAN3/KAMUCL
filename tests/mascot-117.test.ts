import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
import {compileScript,parse} from '@vue/compiler-sfc'
import * as vue from 'vue'
import sharp from 'sharp'
import {MASCOTS,MascotSweepGate,addMascotHits,mascotHull,mascotShapeContains,mascotWalkFrame,normalizeMascotSound,type MascotHitRect} from '../src/shared/mascots'
import {MascotAudio,slapSamples} from '../src/renderer/src/mascotAudio'
import {BoxGeometry,FrontSide,Matrix3,Mesh,MeshStandardMaterial,Texture,Vector3} from 'three'
import {MascotBatchRenderer,mascotAtlasUV} from '../src/renderer/src/mascotBatch'
import {KamuInteraction} from '../src/shared/kamuInteraction'
import * as Three from 'three'
import {PreviewPlayer} from '../src/renderer/src/skinModel'

function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
let mascotSetupBundle:Promise<string>|undefined
async function mascotLifecycleFixture(options:{model?:boolean;softwareFails?:boolean}={}){
 mascotSetupBundle??=build({entryPoints:['src/renderer/src/components/MascotStage.vue'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'mascot-lifecycle',setup(b){
  b.onResolve({filter:/^(@shared\/|\.\.\/)/},args=>({path:args.path,external:true}))
  b.onLoad({filter:/\.vue$/},async args=>{const {descriptor}=parse(await fs.readFile(args.path,'utf8'));return{contents:compileScript(descriptor,{id:args.path}).content,loader:'ts',resolveDir:path.dirname(args.path)}})
 }}]}).then(bundle=>bundle.outputFiles[0].text)
 const state=deferred<any>(),unlock=deferred<void>(),notices:string[]=[],images:any[]=[],events:any[]=[],plays:number[]=[],hidden=vue.ref(false),counts={unlocks:0,audioDisposed:0,rendererCreated:0,rendererDisposed:0,contextLost:0,attached:0,removed:0,rigs:0,frames:0,unsubscribed:0,compile:0,draw:0,fences:0,deleted:0,checks:0,flush:0,focus:0,software:0,rasters:0,softwareDisposed:0}
 let now=100,fenceStatus=0,lost=false,nextFrame=0,nextTimer=0,softwareFails=options.softwareFails
 const frames=new Map<number,(time:number)=>void>(),timers=new Map<number,{callback:()=>void;at:number}>(),listeners=new Map<string,(event:any)=>void>()
 const context={SYNC_GPU_COMMANDS_COMPLETE:1,ALREADY_SIGNALED:2,CONDITION_SATISFIED:3,WAIT_FAILED:4,TIMEOUT_EXPIRED:0,getExtension:()=>null,getParameter:()=> 'lifecycle fixture native GPU',isContextLost:()=>lost,fenceSync:()=>{counts.fences++;return{}},deleteSync:()=>counts.deleted++,clientWaitSync:(_sync:any,flags:number,timeout:number)=>{assert.equal(flags,0);assert.equal(timeout,0,'readiness must not synchronously wait');counts.checks++;return fenceStatus},flush:()=>counts.flush++}
 let mounted!:()=>Promise<void>,unmounted!:()=>void
 class Renderer{
  domElement={remove:()=>counts.removed++,addEventListener:(name:string,callback:any)=>listeners.set(name,callback),removeEventListener:(name:string)=>listeners.delete(name)}
  info={render:{calls:1}}
  constructor(){counts.rendererCreated++}
  setPixelRatio(){}setSize(){}setClearColor(){}
  getContext(){return context}compile(){counts.compile++;now+=.6}render(){counts.draw++;now+=.4}
  dispose(){counts.rendererDisposed++}forceContextLoss(){counts.contextLost++}
 }
 class ImageFixture{onload:any=null;onerror:any=null;src='';constructor(){images.push(this)}}
 class AudioFixture{unlock(){counts.unlocks++;return unlock.promise}dispose(){counts.audioDisposed++;return Promise.resolve()}pause(){}play(){plays.push(now)}update(){}}
 const nodeRequire=createRequire(path.resolve('package.json')),mod={exports:{} as any}
 const requireFixture=(name:string):any=>{
  if(name==='vue')return{...vue,onMounted:(callback:any)=>mounted=callback,onUnmounted:(callback:any)=>unmounted=callback}
  if(name==='three')return{...Three,WebGLRenderer:Renderer}
  if(name==='@shared/mascots')return{MASCOTS,addMascotHits,normalizeMascotSound}
  if(name==='@shared/kamuInteraction')return{KamuInteraction}
  if(name==='../motion')return{useMotion:()=>({reduced:vue.ref(false),hidden,decorativeActive:vue.ref(true)})}
  if(name==='../api')return{errText:String}
  if(name==='../store')return{toast:(message:string)=>notices.push(message)}
  if(name==='../mascotAudio')return{MascotAudio:AudioFixture}
  if(name==='../skinModel')return{PreviewPlayer:options.model?class extends PreviewPlayer{constructor(){super();counts.rigs++}}:class{constructor(){counts.rigs++}}}
  if(name==='../mascotBatch')return{createMascotAtlas:()=>{if(!options.model)throw Error('unexpected post-unmount atlas allocation');return new Texture()},MascotBatchRenderer}
  if(name==='../mascotSoftware')return{MascotSoftwareRenderer:class{domElement={remove:()=>counts.removed++};info={render:{calls:1},frames:0,totalUploads:0};constructor(){if(!options.model||softwareFails)throw Error('software unavailable');counts.software++}setSize(){}render(){counts.rasters++;this.info.frames++;this.info.totalUploads++}dispose(){counts.softwareDisposed++}}}
  if(name.endsWith('.png'))return'disposable-lifecycle-skin.png'
  return nodeRequire(name)
 }
 const windowFixture={kamucl:{invoke:()=>state.promise,on:()=>()=>counts.unsubscribed++,send:()=>{}}}
 new Function('require','module','exports','window','Image','requestAnimationFrame','cancelAnimationFrame','performance','setTimeout','clearTimeout',await mascotSetupBundle)(requireFixture,mod,mod.exports,windowFixture,ImageFixture,(callback:any)=>{counts.frames++;frames.set(++nextFrame,callback);return nextFrame},(id:number)=>frames.delete(id),{now:()=>now},(callback:any,delay:number)=>{timers.set(++nextTimer,{callback,at:now+delay});return nextTimer},(id:number)=>timers.delete(id))
 const scope=vue.effectScope(),setup=scope.run(()=>mod.exports.default.setup({focusOnReady:true},{expose:()=>{},emit:(...event:any[])=>events.push(event)}))
 const palmStyles=new Map<string,string>(),printStyles=new Map<string,string>(),feedback={dataset:{},style:{setProperty:()=>{}},querySelector:(selector:string)=>({style:{setProperty:(key:string,value:string)=>(selector==='.pixel-palm'?palmStyles:printStyles).set(key,value)}})}
 setup.host.value={dataset:{},querySelector:()=>feedback};setup.viewport.value={prepend:()=>counts.attached++}
 setup.hit.value={focus:()=>counts.focus++}
 return{state,unlock,counts,images,notices,setup,events,plays,palmStyles,printStyles,hidden,context,frames,timers,listeners,clock:()=>now,setSoftwareFailure:(value:boolean)=>softwareFails=value,mount:()=>mounted(),unmount:()=>{unmounted();setup.host.value=undefined;setup.viewport.value=undefined;scope.stop()},signal:(status=context.CONDITION_SATISFIED)=>fenceStatus=status,lose:()=>{lost=true;listeners.get('webglcontextlost')?.({preventDefault:()=>{}})},runFrame:(elapsed=16,rafTimestamp?:number)=>{now+=elapsed;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(rafTimestamp??now)},expire:()=>{now+=3001;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback()}}}
}
test('real mascot setup cannot allocate after unmount overtakes state or audio initialization',async()=>{
 for(const gate of ['state','audio']){
  const fixture=await mascotLifecycleFixture(),mount=fixture.mount()
  if(gate==='audio'){fixture.state.resolve({counts:{},order:[],sound:{muted:false,volume:.45}});await Promise.resolve();assert.equal(fixture.counts.unlocks,1)}
  fixture.unmount();fixture.state.resolve({counts:{},order:[],sound:{muted:false,volume:.45}});fixture.unlock.resolve();await mount
  assert.equal(fixture.counts.rendererCreated,0,gate+' continuation cannot create a late WebGL context');assert.equal(fixture.counts.attached,0);assert.equal(fixture.counts.rigs,0);assert.equal(fixture.counts.frames,0);assert.equal(fixture.counts.audioDisposed,1);assert.equal(fixture.counts.unsubscribed,1);assert.deepEqual(fixture.notices,[])
 }
})
test('real mascot setup cancels pending image work and releases its pre-existing context on unmount',async()=>{
 const fixture=await mascotLifecycleFixture(),mount=fixture.mount();fixture.state.resolve({counts:{},order:[],sound:{muted:false,volume:.45}});fixture.unlock.resolve()
 for(let i=0;i<6;i++)await Promise.resolve()
 assert.equal(fixture.counts.rendererCreated,1);assert.equal(fixture.images.length,1);assert.equal(fixture.counts.attached,1)
 fixture.unmount();await mount
 assert.equal(fixture.images[0].src,'');assert.equal(fixture.images[0].onload,null);assert.equal(fixture.images[0].onerror,null);assert.equal(fixture.counts.rendererDisposed,1);assert.equal(fixture.counts.contextLost,1);assert.equal(fixture.counts.removed,1);assert.equal(fixture.counts.rigs,0);assert.equal(fixture.counts.frames,0);assert.equal(fixture.setup.persistError.value,'');assert.deepEqual(fixture.notices,[])
})
test('a state failure arriving after mascot unmount cannot emit stale notices',async()=>{
 const fixture=await mascotLifecycleFixture(),mount=fixture.mount();fixture.unmount();fixture.state.reject(Error('late state failure'));await mount
 assert.equal(fixture.counts.rendererCreated,0);assert.equal(fixture.setup.persistError.value,'');assert.deepEqual(fixture.notices,[])
})

async function mountedMascotModel(options:{softwareFails?:boolean}={}){
 const fixture=await mascotLifecycleFixture({...options,model:true}),mount=fixture.mount()
 fixture.state.resolve({counts:{},order:[],sound:{muted:false,volume:.45}});fixture.unlock.resolve()
 for(let i=0;i<6;i++)await Promise.resolve()
 assert.equal(fixture.images.length,1);fixture.images[0].onload();await mount;return fixture
}

test('actual mascot first draw waits for a naturally signalled GPU fence before readiness and focus',async()=>{
 const f=await mountedMascotModel()
 try{
  f.runFrame();assert.equal(f.counts.compile,1);assert.equal(f.counts.draw,1);assert.equal(f.counts.fences,1);assert.equal(f.counts.flush,1);assert.equal(f.setup.ready.value,false);assert.equal(f.counts.focus,0)
  assert.equal(f.setup.host.value.dataset.gpuReadyStatus,'pending');assert.equal(f.timers.size,1)
  f.runFrame();f.runFrame();assert.equal(f.counts.draw,1,'polling does not submit dummy repeated frames');assert.equal(f.counts.compile,1);assert.equal(f.setup.ready.value,false);assert.equal(f.counts.focus,0)
  f.signal();f.runFrame();assert.equal(f.setup.ready.value,true);assert.equal(f.counts.deleted,1);assert.equal(f.timers.size,0);await vue.nextTick();assert.equal(f.counts.focus,1)
  assert.equal(f.events.filter(event=>event[0]==='ready').length,1);assert.equal(f.setup.host.value.dataset.gpuReadyStatus,'commands-complete');assert(Number(f.setup.host.value.dataset.compileMs)>.59);assert(Number(f.setup.host.value.dataset.firstSubmitMs)>.39);assert(Number(f.setup.host.value.dataset.gpuCheckMs)>=48)
  f.runFrame();await vue.nextTick();assert.equal(f.counts.focus,1);assert.equal(f.events.filter(event=>event[0]==='ready').length,1)
 }finally{f.unmount()}
 assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0)
})

test('hiding cancels the actual pending fence and visibility requires a new real draw and fence',async()=>{
 const f=await mountedMascotModel()
 try{
  f.runFrame();f.hidden.value=true;assert.equal(f.counts.deleted,1);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);assert.equal(f.setup.ready.value,false)
  f.signal();f.runFrame();await vue.nextTick();assert.equal(f.counts.focus,0);assert.equal(f.counts.draw,1)
  f.hidden.value=false;f.signal(f.context.TIMEOUT_EXPIRED);f.runFrame();assert.equal(f.counts.draw,2);assert.equal(f.counts.fences,2);assert.equal(f.setup.ready.value,false)
  f.signal(f.context.ALREADY_SIGNALED);f.runFrame();await vue.nextTick();assert.equal(f.setup.ready.value,true);assert.equal(f.counts.focus,1);assert.equal(f.counts.deleted,2)
 }finally{f.unmount()}
})

test('unmount cancels GPU work, deletes the real sync and suppresses all deferred readiness',async()=>{
 const f=await mountedMascotModel();f.runFrame();f.unmount();f.signal();f.runFrame();f.expire();await vue.nextTick()
 assert.equal(f.counts.deleted,1);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);assert.equal(f.counts.rendererDisposed,1);assert.equal(f.counts.contextLost,1);assert.equal(f.counts.focus,0);assert.equal(f.events.filter(event=>event[0]==='ready').length,0);assert.equal(f.counts.software,0)
})

test('ready focus queued by Vue cannot run after immediate hide or unmount',async()=>{
 for(const action of ['hide','unmount']){
  const f=await mountedMascotModel();f.signal();f.runFrame();assert.equal(f.setup.ready.value,true)
  if(action==='hide')f.hidden.value=true;else f.unmount()
  await vue.nextTick();assert.equal(f.counts.focus,0,action+' prevents the deferred focus handoff');if(action==='hide')f.unmount()
 }
})

test('GPU WAIT_FAILED, context loss and deadline release resources and gate readiness on actual CPU raster',async()=>{
 for(const failure of ['wait','lost','deadline']){
  const f=await mountedMascotModel()
  try{
   f.runFrame();if(failure==='wait'){f.signal(f.context.WAIT_FAILED);f.runFrame()}else if(failure==='lost')f.lose();else f.expire()
   assert.equal(f.setup.ready.value,false,'fallback construction is not a rendered frame');assert.equal(f.counts.deleted,1);assert.equal(f.counts.rendererDisposed,1);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);assert.equal(f.counts.rasters,0)
   assert.match(f.setup.host.value.dataset.gpuReadyFallback,failure==='wait'?/WAIT_FAILED/:failure==='lost'?/context lost/:/timed out/)
   f.runFrame();await vue.nextTick();assert.equal(f.counts.rasters,1);assert.equal(f.setup.ready.value,true);assert.equal(f.counts.focus,1);assert.equal(f.setup.host.value.dataset.gpuReadyStatus,'software-first-raster');assert.equal(f.setup.host.value.dataset.renderBackend,'canvas2d-depth')
  }finally{f.unmount()}
  assert.equal(f.counts.softwareDisposed,1)
 }
})

test('failed CPU fallback remains visibly unavailable and can recover without inventing readiness',async()=>{
 const f=await mountedMascotModel({softwareFails:true})
 try{
  f.runFrame();f.signal(f.context.WAIT_FAILED);f.runFrame();assert.equal(f.setup.supported.value,false);assert.equal(f.setup.ready.value,false);assert.equal(f.setup.host.value.dataset.gpuReadyStatus,'failed');assert.match(f.setup.persistError.value,/software unavailable/);assert.equal(f.counts.focus,0);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0)
  f.setSoftwareFailure(false);f.setup.retryPreview();assert.equal(f.setup.supported.value,true);assert.equal(f.setup.ready.value,false);assert.equal(f.counts.rasters,0)
  f.runFrame();await vue.nextTick();assert.equal(f.counts.rasters,1);assert.equal(f.setup.ready.value,true);assert.equal(f.counts.focus,1);assert.equal(f.setup.persistError.value,'')
 }finally{f.unmount()}
})

test('visible contact, palm and sound use actual callback time despite delayed rAF timestamp delivery',async()=>{
 const f=await mountedMascotModel()
 try{
  f.signal();f.runFrame();f.runFrame(400)
  const shadow=new KamuInteraction(),acceptedAt=f.clock()
  for(let i=0;i<10;i++){f.setup.slap();assert(shadow.accept(acceptedAt))}
  // Native Intel evidence: an old timestamp arrives 65ms late, followed by a
  // nearly current callback. Timestamp time advances ~150ms while wall time
  // between source calls was only 85.7ms. Replay that delivery pattern.
  const delivery=[[33,1],[33,1],[33,1],[72,41],[6,16],[83,65],[14,13],[21,1],[50,1],[33,1]]
  let contacts=0,lastContact=-1000,previousTimestamp=0
  for(let i=0;i<160&&shadow.busy;i++){
   const [elapsed,lag]=delivery[i%delivery.length],actual=f.clock()+elapsed,timestamp=actual-lag
   assert(timestamp>previousTimestamp);previousTimestamp=timestamp
   const expected=shadow.advance(actual,false,50),before=f.plays.length
   f.runFrame(elapsed,timestamp)
   assert.equal(Number(f.setup.host.value.dataset.renderNow),actual);assert.equal(Number(f.setup.host.value.dataset.rafTimestamp),timestamp,'keep host-supplied timing as an independent observation')
   assert.equal(f.plays.length-before,expected.contacts.length);assert(expected.contacts.length<=1)
   for(const contact of expected.contacts){lastContact=contact;contacts++;assert.equal(f.plays.at(-1),actual,'contact source starts on this same actual callback clock')}
   const opacity=expected.palm>=0?1-Math.max(0,(expected.palm-.5)*2):0
   assert(Math.abs(Number(f.palmStyles.get('opacity'))-opacity)<1e-10,'presented palm advances on actual contact clock')
   const print=actual-lastContact<500?.72*(1-(actual-lastContact)/500):0
   assert(Math.abs(Number(f.printStyles.get('opacity'))-print)<1e-10)
   assert.equal(Number(f.setup.host.value.dataset.contacts),contacts)
  }
  assert.equal(shadow.busy,false);assert.equal(f.plays.length,10);assert.equal(f.setup.state.value.counts.kamu,10)
  const intervals=f.plays.slice(1).map((at,index)=>at-f.plays[index]);assert(intervals.every(interval=>interval>=100),'visible 50ms frame budget preserves at least 100ms between actual contacts: '+intervals.join(','))
 }finally{f.unmount()}
})

test('hidden close still drains all accepted contacts unbounded without hidden sound or visible-frame fabrication',async()=>{
 const f=await mountedMascotModel()
 try{
  f.signal();f.runFrame();for(let i=0;i<10;i++)f.setup.slap()
  f.hidden.value=true;const draws=f.counts.draw;await f.setup.flush()
  assert.equal(f.setup.state.value.counts.kamu,10);assert.equal(f.plays.length,0);assert.equal(f.counts.draw,draws);assert.equal(f.frames.size,0);assert.equal(f.setup.busy.value,false)
 }finally{f.unmount()}
})

test('actual handprint SVG keeps its pixel silhouette and readable outline without a first-contact filter surface',async()=>{
 const {descriptor}=parse(await fs.readFile('src/renderer/src/components/MascotStage.vue','utf8')),template=descriptor.template!.content,css=descriptor.styles.map(style=>style.content).join('\n')
 const svg=template.match(/<svg class="palm-print"[^>]*>[\s\S]*?<\/svg>/)![0],rule=css.match(/\.palm-print\{([^}]*)\}/)![1]
 assert(!/\bfilter\s*:|<filter\b|\bfilter\s*=/.test(rule+svg),'no CSS or SVG filter graph is created by the first visible handprint')
 const raster=async(style:string,size:number)=>sharp(Buffer.from(svg.replace('<svg ',`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" shape-rendering="crispEdges" `).replace('</svg>',`<style>.palm-print{${style}}</style></svg>`))).ensureAlpha().raw().toBuffer()
 for(const size of [15,160]){
  const actual=await raster(rule,size),base=await raster('fill:#cf674e',size);let filled=0,outline=0,added=0
  for(let i=0;i<base.length;i+=4){
   const alpha=actual[i+3]
   if(base[i+3]===255){assert.equal(alpha,255);assert.deepEqual([...actual.subarray(i,i+3)],[207,103,78],'stroke behind fill preserves every fully opaque original handprint pixel');filled++}
   if(alpha===255&&actual[i]===70&&actual[i+1]===34&&actual[i+2]===30)outline++
   if(alpha&&!base[i+3])added++
  }
  assert(filled>size*size*.3);assert(outline>0,'dark pixel edge stays visible against clothing');assert(added<size*size*.35,'one-unit outline does not replace the recognizable hand silhouette')
 }
})

test('mascot batch preserves all 42 animated meshes, world positions, inverse-transpose normals and skin UVs',()=>{
 const atlas=new Texture(),original=new Texture(),material=new MeshStandardMaterial({map:original,roughness:.83,metalness:.07,side:FrontSide})
 const skins=Array.from({length:7},(_,skinIndex)=>Array.from({length:6},(_,part)=>{
  const mesh=new Mesh(new BoxGeometry(8,12,4),material);mesh.position.set(skinIndex*24,part*3,-part);mesh.rotation.set(part*.14,skinIndex*.2,part*.03);mesh.scale.set(1.42,.68,1.1);mesh.updateMatrixWorld(true);return mesh
 }))
 const batch=new MascotBatchRenderer(skins,atlas);batch.update()
 const geometry=batch.mesh.geometry,positions=geometry.getAttribute('position'),normals=geometry.getAttribute('normal'),uvs=geometry.getAttribute('uv'),index=geometry.getIndex()!
 assert.equal(positions.count,1008);assert.equal(index.count,1512);assert.equal(geometry.groups.length,0,'one indexed material draw, not 42 groups');assert.equal(batch.mesh.material.map,atlas);assert.equal(batch.mesh.material.roughness,material.roughness);assert.equal(batch.mesh.material.metalness,material.metalness);assert.equal(batch.mesh.material.side,material.side);assert.equal(material.map,original);assert.notEqual(batch.mesh.material,material)
 for(const sample of [0,1]){
  if(sample){skins.forEach((parts,i)=>parts.forEach((mesh,j)=>{mesh.position.x-=13;mesh.rotation.x+=.31;mesh.scale.y=.9+j*.02;mesh.updateMatrixWorld(true)}));batch.update()}
  let offset=0,indexOffset=0
  for(const [skinIndex,parts] of skins.entries())for(const mesh of parts){
   const position=mesh.geometry.getAttribute('position'),normal=mesh.geometry.getAttribute('normal'),uv=mesh.geometry.getAttribute('uv'),sourceIndex=mesh.geometry.getIndex()!,normalMatrix=new Matrix3().getNormalMatrix(mesh.matrixWorld)
   for(let i=0;i<position.count;i++){
    const expectedPosition=new Vector3().fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld),expectedNormal=new Vector3().fromBufferAttribute(normal,i).applyMatrix3(normalMatrix).normalize(),expectedUV=mascotAtlasUV(uv.getX(i),uv.getY(i),skinIndex,skins.length)
    assert(new Vector3().fromBufferAttribute(positions,offset+i).distanceTo(expectedPosition)<1e-5);assert(new Vector3().fromBufferAttribute(normals,offset+i).distanceTo(expectedNormal)<1e-6)
    assert(Math.abs(uvs.getX(offset+i)-expectedUV[0])<1e-7&&Math.abs(uvs.getY(offset+i)-expectedUV[1])<1e-7)
   }
   for(let i=0;i<sourceIndex.count;i++)assert.equal(index.getX(indexOffset+i),offset+sourceIndex.getX(i))
   offset+=position.count;indexOffset+=sourceIndex.count
  }
 }
 let geometryDisposals=0,materialDisposals=0;geometry.addEventListener('dispose',()=>geometryDisposals++);batch.mesh.material.addEventListener('dispose',()=>materialDisposals++)
 batch.dispose();batch.dispose();assert.equal(geometryDisposals,1);assert.equal(materialDisposals,1);const version=positions.version;batch.update();assert.equal(positions.version,version,'disposed batch cannot allocate or upload another frame')
 skins.flat().forEach(mesh=>mesh.geometry.dispose());material.dispose();atlas.dispose();original.dispose()
})
test('mascot atlas leaves independent one-pixel gutters around every 64px skin',()=>{
 for(let i=0;i<7;i++){
  const min=mascotAtlasUV(0,0,i,7),max=mascotAtlasUV(1,1,i,7)
  assert.equal(Math.round(min[0]*462),i*66+1);assert.equal(Math.round(max[0]*462),i*66+65);assert.equal(Math.round(min[1]*66),1);assert.equal(Math.round(max[1]*66),65)
  if(i<6)assert(mascotAtlasUV(0,0,i+1,7)[0]>max[0],'a UV edge cannot bleed into an adjacent skin')
 }
})

const rectangles:MascotHitRect[]=MASCOTS.map((m,index)=>({id:m.id,left:20+index*30,right:40+index*30,top:10,bottom:24}))
test('a sparse pointer sweep intersects all seven hip zones in travel order',()=>{
 const gate=new MascotSweepGate();assert.deepEqual(gate.move(0,17,rectangles),[])
 assert.deepEqual(gate.move(250,17,rectangles),MASCOTS.map(m=>m.id))
 assert.deepEqual(gate.move(0,17,rectangles),MASCOTS.map(m=>m.id).reverse())
 gate.reset();assert.deepEqual(gate.move(0,50,rectangles),[]);assert.deepEqual(gate.move(250,50,rectangles),[])
})
test('staying inside, stationary reorder, and a sorting character under the pointer do not slap',()=>{
 const gate=new MascotSweepGate();assert.deepEqual(gate.move(25,15,rectangles),['q3']);assert.deepEqual(gate.move(26,15,rectangles),[])
 const swapped=rectangles.map((r,i)=>({...r,id:i===0?'qiqi':i===1?'q3':r.id}))
 assert.deepEqual(gate.move(26,15,swapped),[]);assert.deepEqual(gate.move(27,15,swapped),[])
 assert.deepEqual(gate.move(0,15,swapped),[]);assert.deepEqual(gate.move(30,15,swapped),['qiqi'])
 gate.reset();assert.deepEqual(gate.move(35,15,swapped),['qiqi'])
})
test('coalesced intermediate points follow their trajectory instead of a false diagonal',()=>{
 const gate=new MascotSweepGate();gate.move(0,0,rectangles)
 assert.deepEqual(gate.move(100,0,rectangles),[]);assert.deepEqual(gate.move(100,17,rectangles),['biyuehu']);assert.deepEqual(gate.move(100,30,rectangles),[])
})
test('part silhouettes exclude empty bounding-box corners and dedupe a whole person',()=>{
 const polygon=mascotHull([{x:20,y:10},{x:30,y:0},{x:40,y:10},{x:30,y:20},{x:30,y:10}]),head={id:'q3',part:'head',left:20,right:40,top:0,bottom:20,polygon}
 assert.equal(polygon.length,4);assert.equal(mascotShapeContains(head,21,1),false);assert.equal(mascotShapeContains(head,30,10),true)
 const gate=new MascotSweepGate();gate.move(0,1,[head]);assert.deepEqual(gate.move(23,1,[head]),[],'empty corner does not slap')
 gate.reset();gate.move(0,10,[head]);assert.deepEqual(gate.move(50,10,[head,{...head,part:'body'}]),['q3'],'two parts crossing in one event are one entry')
 gate.reset();assert.deepEqual(gate.move(30,10,[head]),['q3']);assert.deepEqual(gate.move(31,10,[head,{...head,part:'arm'}]),[])
})
test('full-person sparse sweeps hit head, torso and feet separately without hitting gaps',()=>{
 const shapes=MASCOTS.flatMap((m,i)=>[{id:m.id,left:20+i*30,right:40+i*30,top:0,bottom:12,part:'head'},{id:m.id,left:24+i*30,right:36+i*30,top:12,bottom:38,part:'body'},{id:m.id,left:24+i*30,right:29+i*30,top:38,bottom:50,part:'leftLeg'},{id:m.id,left:31+i*30,right:36+i*30,top:38,bottom:50,part:'rightLeg'}])
 for(const y of [6,25,45]){const gate=new MascotSweepGate();gate.move(0,y,shapes);assert.deepEqual(gate.move(250,y,shapes),MASCOTS.map(m=>m.id))}
 const gate=new MascotSweepGate();assert.deepEqual(gate.move(30,45,shapes),[],'between legs is empty');assert.deepEqual(gate.move(30,55,shapes),[])
})
test('a passing figure occludes covered farther pixels, while visible farther edges remain hittable',()=>{
 const near={id:'q3',left:10,right:30,top:0,bottom:20,depth:-.5},far={id:'qiqi',left:10,right:30,top:0,bottom:20,depth:.5}
 const gate=new MascotSweepGate();gate.move(0,10,[near,far]);assert.deepEqual(gate.move(40,10,[near,far]),['q3'])
 gate.reset();gate.move(0,10,[near,{...far,right:35}]);assert.deepEqual(gate.move(40,10,[near,{...far,right:35}]),['q3','qiqi'])
 gate.reset();assert.deepEqual(gate.move(20,10,[near,far]),['q3'])
})
test('moving from a covered overlap onto an exposed farther edge is a fresh visible entry',()=>{
 const near={id:'near',left:0,right:8,top:0,bottom:20,depth:0},far={id:'far',left:4,right:12,top:0,bottom:20,depth:1},shapes=[near,far],gate=new MascotSweepGate()
 assert.deepEqual(gate.move(5,10,shapes),['near'],'only the front person occupies the overlap')
 assert.deepEqual(gate.move(10,10,shapes),['far'],'crossing x=8 enters the exposed farther pixels')
 assert.deepEqual(gate.move(15,10,shapes),[],'leaving the exposed person is not another slap')
 assert.deepEqual(gate.move(10,10,shapes),['far'],'a real reentry still counts once')
 assert.deepEqual(gate.move(11,10,shapes),[],'holding within visible farther pixels does not count')
 assert.deepEqual(gate.move(5,10,shapes),['near'],'returning across the front boundary hits the front person')
 assert.deepEqual(gate.move(5,10,[far,{...near,depth:2}]),[],'depth/geometry changing at a stationary pointer is not travel')
 assert.deepEqual(gate.move(5.5,10,[far,{...near,depth:2}]),[],'the now-visible person is rebased before the next real move')
})
test('overlap occupancy uses the nearest part of each person and preserves equal-depth visibility',()=>{
 const gate=new MascotSweepGate(),near={id:'near',left:0,right:8,top:0,bottom:20,depth:0},far={id:'far',left:4,right:12,top:0,bottom:20,depth:1}
 assert.deepEqual(gate.move(5,10,[{...near,part:'arm',depth:2},far,{...near,part:'head'}]),['near'])
 assert.deepEqual(gate.move(10,10,[{...near,part:'arm',depth:2},far,{...near,part:'head'}]),['far'])
 gate.reset();assert.deepEqual(gate.move(5,10,[near,{...far,depth:0}]),['near','far'],'depth ties are not falsely occluded')
})
test('sorting silhouettes alone cannot count, and real motion during sorting remains available',()=>{
 const gate=new MascotSweepGate(),shape={id:'q3',left:10,right:20,top:0,bottom:20}
 gate.move(30,10,[shape]);assert.deepEqual(gate.move(30,10,[{...shape,left:25,right:35}]),[])
 assert.deepEqual(gate.move(31,10,[{...shape,left:25,right:35}]),[],'new geometry is rebased under the cursor')
 gate.move(40,10,[{...shape,left:25,right:35}]);assert.deepEqual(gate.move(25,10,[{...shape,left:25,right:35}]),['q3'])
})
test('walking reaches exact targets, and retargeting can preserve position and travelled phase',()=>{
 assert.deepEqual(mascotWalkFrame(6,0,1000,1000),{position:0,progress:1,travelled:6,direction:-1,walking:false})
 const midway=mascotWalkFrame(6,0,400,1000),retarget=mascotWalkFrame(midway.position,2,0,500)
 assert.equal(retarget.position,midway.position);assert(midway.travelled>0&&midway.position>0);assert.equal(mascotWalkFrame(6,0,0,0).position,0)
 assert.equal(mascotWalkFrame(1,1,20,300).walking,false)
})
test('batched counts retain overflow bounds, stable ties, and sound migration defaults',()=>{
 const base={counts:{q3:Number.MAX_SAFE_INTEGER},order:MASCOTS.map(m=>m.id)}
 const next=addMascotHits(base,['qiqi','kamu','qiqi','q3']);assert.equal(next.counts.q3,Number.MAX_SAFE_INTEGER);assert.equal(next.counts.qiqi,2);assert.equal(base.counts.q3,Number.MAX_SAFE_INTEGER)
 assert.deepEqual(addMascotHits({counts:{},order:base.order},MASCOTS.map(m=>m.id)).order,base.order)
 assert.deepEqual(normalizeMascotSound(),{muted:false,volume:.45});assert.deepEqual(normalizeMascotSound({muted:true,volume:4}),{muted:true,volume:1});assert.equal(normalizeMascotSound({volume:NaN}).volume,.45)
})
test('original palm-pop waveform is deterministic, bounded, nonzero and fades out',()=>{
 const a=slapSamples(48000),b=slapSamples(48000);assert.deepEqual(a,b);assert.equal(a.length,3600)
 assert(a.every(n=>Number.isFinite(n)&&Math.abs(n)<1));assert(a.some(n=>Math.abs(n)>.25));assert(Math.max(...a.slice(-100).map(Math.abs))<.005)
})

class FakeMascotConstantSource {
 offset={value:1};onended:null|(()=>void)=null;destinations:unknown[]=[];starts:Array<{when:number;state:string;offset:number}>=[];stops:Array<number|undefined>=[];disconnects=0
 constructor(private context:FakeMascotAudioContext){}
 connect(target:unknown){this.destinations.push(target)}
 disconnect(){this.disconnects++}
 start(when=0){this.starts.push({when,state:this.context.state,offset:this.offset.value})}
 stop(when?:number){this.stops.push(when);if(when===undefined)this.finish()}
 finish(){this.onended?.()}
}
class FakeMascotGain {
 gain={value:1,setTargetAtTime:(value:number)=>{this.gain.value=value}};destinations:unknown[]=[];disconnects=0
 connect(target:unknown){this.destinations.push(target)}disconnect(){this.disconnects++}
}
class FakeMascotBufferSource {
 buffer?:ReturnType<FakeMascotAudioContext['createBuffer']>;playbackRate={value:1};onended:null|(()=>void)=null;destinations:unknown[]=[];starts:number[]=[];stops=0;disconnects=0;ended=false
 declare kamuclInitialization?:{role:string;zeroGain:FakeMascotGain}
 constructor(private context:FakeMascotAudioContext){}
 connect(target:unknown){this.destinations.push(target)}disconnect(){this.disconnects++}
 start(when=0){if(this.kamuclInitialization&&this.context.preparationStartFails)throw Error('preparation source unavailable');this.starts.push(when);if(this.kamuclInitialization){this.context.bufferPrimerStarts++;if(this.context.autoEndPreparation)queueMicrotask(()=>this.finish())}else{this.context.sourceStarts++;this.context.startTimes.push(when)}}
 stop(){this.stops++;this.finish(false)}
 finish(natural=true){if(this.ended)return;this.ended=true;if(natural)this.context.currentTime=Math.max(this.context.currentTime,this.starts[0]+this.buffer!.duration/this.playbackRate.value);this.onended?.()}
}
class FakeMascotAudioContext extends EventTarget {
 state='suspended';sampleRate=48000;currentTime=0;destination={};resumeCalls=0;suspendCalls=0;sourceStarts=0;startTimes:number[]=[]
 deferResume=false;deferSuspend=false;pendingResume?:()=>void;pendingSuspend?:()=>void
 primers:FakeMascotConstantSource[]=[];gainNode=new FakeMascotGain();gains:FakeMascotGain[]=[];buffers:FakeMascotBufferSource[]=[];bufferPrimerStarts=0;autoEndPreparation=true;preparationStartFails=false
 transition(state:string){this.state=state;this.dispatchEvent(new Event('statechange'))}
 createBuffer(_channels:number,length:number,sampleRate:number){const samples=new Float32Array(length);return{duration:length/sampleRate,sampleRate,samples,copyToChannel(data:Float32Array){samples.set(data)}}}
 createDynamicsCompressor(){return{threshold:{value:0},knee:{value:0},ratio:{value:0},attack:{value:0},release:{value:0},connect(){}}}
 createGain(){const gain=this.gains.length?new FakeMascotGain():this.gainNode;this.gains.push(gain);return gain}
 createConstantSource(){const source=new FakeMascotConstantSource(this);this.primers.push(source);return source}
 createBufferSource(){const source=new FakeMascotBufferSource(this);this.buffers.push(source);return source}
 resume(){this.resumeCalls++;const finish=()=>{if(this.state!=='closed')this.transition('running')};if(this.deferResume)return new Promise<void>(resolve=>{this.pendingResume=()=>{finish();resolve()}});finish();return Promise.resolve()}
 suspend(){this.suspendCalls++;const finish=()=>{if(this.state!=='closed')this.transition('suspended')};if(this.deferSuspend)return new Promise<void>(resolve=>{this.pendingSuspend=()=>{finish();resolve()}});finish();return Promise.resolve()}
 close(){this.transition('closed');return Promise.resolve()}
}
async function fakeMascotAudio(run:(contexts:FakeMascotAudioContext[])=>Promise<void>,deferResume=false,deferPreparation=false){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'AudioContext'),contexts:FakeMascotAudioContext[]=[]
 class Context extends FakeMascotAudioContext {constructor(){super();this.deferResume=deferResume;this.autoEndPreparation=!deferPreparation;contexts.push(this)}}
 Object.defineProperty(globalThis,'AudioContext',{configurable:true,writable:true,value:Context})
 try{await run(contexts)}finally{if(previous)Object.defineProperty(globalThis,'AudioContext',previous);else delete(globalThis as any).AudioContext}
}
const settleAudio=async()=>{for(let i=0;i<5;i++)await Promise.resolve()}
test('LOGO audio output initializes once with exact digital silence outside slap counts and voices',async()=>{
 await fakeMascotAudio(async contexts=>{
  const preferences={muted:false,volume:.45},stats:number[][]=[],audio=new MascotAudio(()=>preferences,(played,voices)=>stats.push([played,voices]))
  await audio.unlock();const context=contexts[0],primer=context.primers[0]
  assert.equal(context.primers.length,1);assert.deepEqual(primer.starts,[{when:0,state:'running',offset:0}]);assert.deepEqual(primer.stops,[.05]);assert.equal(primer.destinations[0],context.gainNode,'silent source uses the original gain/compressor/output pipeline')
  assert.equal(context.sourceStarts,0);assert.deepEqual(stats,[],'initialization cannot report a palm sound or voice');assert.deepEqual(preferences,{muted:false,volume:.45})
  await Promise.all([audio.unlock(),audio.unlock()]);assert.equal(context.primers.length,1,'concurrent and repeated unlocks do not prime twice')
  primer.finish();assert.equal(primer.disconnects,1,'scheduled end disconnects the independent initialization resource')
  audio.play();assert.equal(context.sourceStarts,1);assert.deepEqual(stats,[[1,1]],'the first accepted slap remains the first played voice')
  await audio.dispose();assert.equal(primer.disconnects,1,'ended primer is not stopped or disconnected again by disposal')
 })
})

test('silent buffer preparation exercises the real sample and first resampling path, completing only on actual end',async()=>{
 await fakeMascotAudio(async contexts=>{
  const preferences={muted:false,volume:.45},stats:number[][]=[],events:any[]=[],audio=new MascotAudio(()=>preferences,(played,voices)=>stats.push([played,voices]),()=>true,event=>events.push(event))
  let completed=false;const unlocking=audio.unlock().then(()=>{completed=true});await settleAudio();const context=contexts[0],source=context.buffers[0],output=source.kamuclInitialization!.zeroGain
  assert.equal(completed,false);assert.equal(source.kamuclInitialization!.role,'silent-slap-buffer');assert.equal(Object.getOwnPropertyDescriptor(source,'kamuclInitialization')!.writable,false);assert(Object.isFrozen(source.kamuclInitialization))
  assert.equal(output.gain.value,0);assert.notEqual(output,context.gainNode);assert.deepEqual(source.destinations,[output]);assert.deepEqual(output.destinations,[context.destination]);assert.equal(source.playbackRate.value,.95)
  assert(source.buffer!.samples.some(value=>Math.abs(value)>.25),'this prepares the actual nonzero slap buffer, not another zero constant');assert(source.buffer!.samples.every(value=>value*output.gain.value===0),'dedicated output is exactly silent for every sample')
  assert.equal(context.bufferPrimerStarts,1);assert.equal(context.sourceStarts,0);assert.deepEqual(stats,[]);assert.deepEqual(events.map(e=>e.phase),['pending']);assert.equal(audio.play(),0);assert.equal(context.sourceStarts,0,'cannot accept a voice before actual audio preparation completes')
  const concurrent=audio.unlock();await settleAudio();assert.equal(context.buffers.length,1,'all unlock callers share the one actual pending source')
  source.finish();await Promise.all([unlocking,concurrent]);assert.equal(completed,true);assert.deepEqual(events.map(e=>e.phase),['pending','ended']);assert.equal(events[1].audioTime,.075/.95);assert.equal(source.disconnects,1);assert.equal(output.disconnects,1)
  await audio.unlock();assert.equal(context.buffers.length,1,'the bounded completed source is never looped or recreated after idle')
  audio.play();const palm=context.buffers[1];assert.equal(palm.buffer,source.buffer);assert.equal(palm.playbackRate.value,source.playbackRate.value);assert.equal(palm.kamuclInitialization,undefined);assert.deepEqual(palm.destinations,[context.gainNode]);assert.deepEqual(stats,[[1,1]]);assert.deepEqual(preferences,{muted:false,volume:.45})
  await audio.dispose();assert.equal(source.disconnects,1);assert.equal(output.disconnects,1)
 },false,true)
})

test('pause and disposal cancel real buffer preparation, release independent nodes and unblock every unlock',async()=>{
 for(const ending of ['pause','dispose'])await fakeMascotAudio(async contexts=>{
  let visible=true;const stats:number[][]=[],events:any[]=[],audio=new MascotAudio(()=>({muted:true,volume:.45}),(played,voices)=>stats.push([played,voices]),()=>visible,event=>events.push(event))
  const unlocking=audio.unlock();await settleAudio();const context=contexts[0],source=context.buffers[0],output=source.kamuclInitialization!.zeroGain
  visible=false;if(ending==='pause')audio.pause();else await audio.dispose();await unlocking;await settleAudio()
  assert.deepEqual(events.map(e=>e.phase),['pending','cancelled']);assert.equal(source.stops,1);assert.equal(source.onended,null);assert.equal(source.disconnects,1);assert.equal(output.disconnects,1);assert.deepEqual(stats,[]);assert.equal(context.sourceStarts,0);assert.equal(context.state,ending==='pause'?'suspended':'closed')
  visible=true;await audio.unlock();assert.equal(context.buffers.length,1,'cancellation is explicit and cannot be disguised as another hidden preparation');source.finish();assert.deepEqual(events.map(e=>e.phase),['pending','cancelled']);await audio.dispose()
 },false,true)
})

test('buffer preparation device deadline is a failure boundary, never an assumed successful end',async t=>{
 t.mock.timers.enable({apis:['setTimeout']})
 await fakeMascotAudio(async contexts=>{
  const events:any[]=[],stats:number[][]=[],audio=new MascotAudio(()=>({muted:false,volume:.45}),(played,voices)=>stats.push([played,voices]),()=>true,event=>events.push(event))
  let completed=false;const unlocking=audio.unlock().then(()=>{completed=true});await settleAudio();const source=contexts[0].buffers[0],output=source.kamuclInitialization!.zeroGain
  t.mock.timers.tick(1499);await settleAudio();assert.equal(completed,false);assert.deepEqual(events.map(e=>e.phase),['pending'])
  t.mock.timers.tick(1);await unlocking;assert.equal(completed,true);assert.deepEqual(events.map(e=>e.phase),['pending','timeout']);assert.equal(events[1].audioTime,0,'no natural audio frames finished');assert.equal(source.stops,1);assert.equal(source.disconnects,1);assert.equal(output.disconnects,1);assert.deepEqual(stats,[]);await audio.dispose()
 },false,true)
})

test('a refused preparation start releases its graph, reports failure and can retry without a palm count',async()=>{
 await fakeMascotAudio(async contexts=>{
  const events:any[]=[],stats:number[][]=[],audio=new MascotAudio(()=>({muted:false,volume:.45}),(played,voices)=>stats.push([played,voices]),()=>true,event=>events.push(event))
  const unlocking=audio.unlock();const context=contexts[0];context.preparationStartFails=true;await unlocking
  const failed=context.buffers[0];assert.deepEqual(events.map(e=>e.phase),['pending','failed']);assert.equal(failed.disconnects,1);assert.equal(failed.kamuclInitialization!.zeroGain.disconnects,1);assert.equal(context.bufferPrimerStarts,0);assert.equal(context.sourceStarts,0);assert.deepEqual(stats,[])
  context.preparationStartFails=false;await audio.unlock();assert.deepEqual(events.map(e=>e.phase),['pending','failed','pending','ended']);assert.equal(context.bufferPrimerStarts,1);assert.equal(context.primers.length,1);assert.deepEqual(stats,[]);await audio.dispose()
 })
})
test('silent output initialization is stopped on pause and disposal without restarting per context',async()=>{
 await fakeMascotAudio(async contexts=>{
  let visible=true;const audio=new MascotAudio(()=>({muted:true,volume:.2}),()=>{},()=>visible)
  await audio.unlock();const context=contexts[0],primer=context.primers[0]
  assert.equal(primer.offset.value,0,'muted preferences still remain exactly silent');visible=false;audio.pause();await settleAudio()
  assert.deepEqual(primer.stops,[.05,undefined]);assert.equal(primer.disconnects,1);assert.equal(context.sourceStarts,0);assert.equal(context.state,'suspended')
  visible=true;await audio.unlock();assert.equal(context.primers.length,1,'show/resume preserves once-per-context initialization');await audio.dispose();assert.equal(primer.disconnects,1)
  const second=new MascotAudio(()=>({muted:false,volume:.45}),()=>{});await second.unlock();const own=contexts[1].primers[0];await second.dispose()
  assert.deepEqual(own.stops,[.05,undefined]);assert.equal(own.disconnects,1);assert.equal(contexts[1].state,'closed');await second.unlock();assert.equal(contexts.length,2,'disposed audio never creates another initialization graph')
 })
})
test('palm contact and seven original pia sources share exact scheduling, including muted visuals',async()=>{
 await fakeMascotAudio(async contexts=>{
  let muted=false;const audio=new MascotAudio(()=>({muted,volume:.45}),()=>{});await audio.unlock();const context=contexts[0];context.currentTime=2
  const delays=Array.from({length:7},()=>audio.play(80));assert.equal(context.startTimes.length,7)
  context.startTimes.forEach((when,i)=>{assert(Math.abs(when-(2.08+i*.015))<1e-8);assert(Math.abs(delays[i]-(80+i*15))<1e-8)})
  muted=true;assert.equal(audio.play(80),80,'muting keeps the same hand approach, without a new voice');assert.equal(context.startTimes.length,7);await audio.dispose()
 })
})
test('hidden audio cannot create, resume or play a context, and visible activation restores playback',async()=>{
 await fakeMascotAudio(async contexts=>{
  let visible=false;const audio=new MascotAudio(()=>({muted:false,volume:.45}),()=>{},()=>visible)
  await audio.unlock();audio.play();assert.equal(contexts.length,0,'hidden unlock must not start an audio device')
  visible=true;await audio.unlock();const context=contexts[0];audio.play();assert.equal(context.sourceStarts,1)
  visible=false;audio.pause();await settleAudio();const resumes=context.resumeCalls;await audio.unlock();audio.play();assert.equal(context.resumeCalls,resumes);assert.equal(context.sourceStarts,1);assert.equal(context.state,'suspended')
  // Browsers can change a context state independently of a JS resume request.
  context.transition('running');await settleAudio();assert.equal(context.state,'suspended','hidden native auto-resume is suspended again')
  visible=true;await audio.unlock();assert.equal(context.state,'running');audio.play();assert.equal(context.sourceStarts,2)
  await audio.dispose();await audio.unlock();assert.equal(context.state,'closed');assert.equal(contexts.length,1)
 })
})
test('a deferred resume finishing after pause cannot leave hidden audio running',async()=>{
 await fakeMascotAudio(async contexts=>{
  let visible=true;const audio=new MascotAudio(()=>({muted:false,volume:.45}),()=>{},()=>visible)
  const unlocking=audio.unlock(),context=contexts[0];assert.equal(context.resumeCalls,1)
  visible=false;audio.pause();context.pendingResume!();await unlocking;await settleAudio()
  assert.equal(context.state,'suspended');audio.play();assert.equal(context.sourceStarts,0);assert.equal(context.primers.length,0,'resume overtaken by hiding cannot prime a hidden graph')
  context.deferResume=false;visible=true;await audio.unlock();assert.equal(context.state,'running');await audio.dispose()
 },true)
})
test('foreground waits for an earlier pending suspend before resuming the same context',async()=>{
 await fakeMascotAudio(async contexts=>{
  let visible=true;const audio=new MascotAudio(()=>({muted:false,volume:.45}),()=>{},()=>visible)
  await audio.unlock();const context=contexts[0];context.deferSuspend=true;visible=false;audio.pause()
  visible=true;const unlocking=audio.unlock();context.pendingSuspend!();await unlocking
  assert.equal(context.state,'running','an earlier hide operation cannot suspend a newly restored stage')
  context.deferSuspend=false;await audio.dispose()
 })
})
test('disposing while resume is pending never restores an audio context or voice',async()=>{
 await fakeMascotAudio(async contexts=>{
  const audio=new MascotAudio(()=>({muted:false,volume:.45}),()=>{},()=>true)
  const unlocking=audio.unlock(),context=contexts[0];await audio.dispose();context.pendingResume!();await unlocking;await audio.unlock();audio.play()
  assert.equal(context.state,'closed');assert.equal(context.resumeCalls,1);assert.equal(context.sourceStarts,0);assert.equal(contexts.length,1);assert.equal(context.primers.length,0,'dispose overtaking resume cannot create initialization resources')
 },true)
})
test('seven Minecraft textures are independent 64×64 RGBA skin atlases with opaque base faces',async()=>{
 const hashes=new Set<string>()
 for(const mascot of MASCOTS){
  const image=await sharp(path.join('src/renderer/src/assets/mascot-skins',mascot.id+'.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  assert.equal(image.info.width,64);assert.equal(image.info.height,64)
  for(const [x,y] of [[8,8],[20,20],[32,20],[44,20],[4,20],[20,52],[36,52]])assert.equal(image.data[(y*64+x)*4+3],255,mascot.id+' base face')
  assert.equal(image.data[(8*64+40)*4+3],0,mascot.id+' transparent outer hat');hashes.add(image.data.toString('base64'))
 }
 assert.equal(hashes.size,7)
})
test('real file-backed IPC batches are idempotent, ordered, durable, and reject changed receipts',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'kamucl-mascot-117-')),handlers=new Map<string,Function>(),event={sender:{isDestroyed:()=>false}}
 const mock={app:{getPath:()=>root},BrowserWindow:{fromWebContents:()=>({})},ipcMain:{handle:(channel:string,handler:Function)=>handlers.set(channel,handler)}}
 try{
  await fs.writeFile(path.join(root,'mascot-counts.json'),JSON.stringify({counts:{q3:4},order:['q3','qiqi','biyuehu','hongshu','kamu','milo','muchuanbei']}))
  const result=await build({entryPoints:['src/main/core/mascots.ts'],bundle:true,write:false,platform:'node',format:'cjs',external:['electron']})
  const runtime={exports:{} as any},require=createRequire(path.resolve('package.json'))
  new Function('require','module','exports',result.outputFiles[0].text)((id:string)=>id==='electron'?mock:require(id),runtime,runtime.exports)
  runtime.exports.registerMascotsIpc();const invoke=(channel:string,...args:unknown[])=>handlers.get(channel)!(event,...args)
  const old=await invoke('mascots:state');assert.equal(old.counts.q3,4);assert.deepEqual(old.sound,{muted:false,volume:.45})
  const batch={batchId:'same-retry-id',hits:MASCOTS.map(m=>m.id)}
  await Promise.all([invoke('mascots:batch',batch),invoke('mascots:batch',batch)])
  assert.equal((await invoke('mascots:state')).counts.q3,5)
  await assert.rejects(()=>invoke('mascots:batch',{...batch,hits:['q3']}),/已被使用/)
  await Promise.all(Array.from({length:10},(_,i)=>invoke('mascots:batch',{batchId:'ordered-'+i,hits:['milo']})))
  await invoke('mascots:sound',{muted:true,volume:.21});const saved=JSON.parse(await fs.readFile(path.join(root,'mascot-counts.json'),'utf8'));assert.equal(saved.counts.milo,11);assert.equal(saved.receipts.length,11);assert.deepEqual(saved.sound,{muted:true,volume:.21})
  await invoke('mascots:batch',{batchId:'kamu-before-reset',hits:['kamu','kamu']})
  await invoke('mascots:reset',true,'kamu');const kamuReset=await invoke('mascots:state');assert.equal(kamuReset.counts.kamu,0);assert.equal(kamuReset.counts.q3,5);assert.equal(kamuReset.counts.milo,11);assert.deepEqual(kamuReset.sound,{muted:true,volume:.21})
  assert.throws(()=>invoke('mascots:reset',true,'milo'),/范围无效/)
  await invoke('mascots:reset',true);assert.equal((await invoke('mascots:state')).counts.q3,0);assert.deepEqual((await invoke('mascots:state')).sound,{muted:true,volume:.21})
  // A delayed acknowledgement retry must also stay idempotent after reset.
  await invoke('mascots:batch',batch);assert.equal((await invoke('mascots:state')).counts.q3,0)
  assert.throws(()=>runtime.exports.validateMascotBatch({batchId:'bad',hits:['unknown']}));assert.throws(()=>runtime.exports.validateMascotBatch({batchId:'bad',hits:Array(513).fill('q3')}))
  const damaged='{broken json';await fs.writeFile(path.join(root,'mascot-counts.json'),damaged);await assert.rejects(()=>invoke('mascots:batch',{batchId:'later',hits:['q3']}),/未覆盖原记录/);assert.equal(await fs.readFile(path.join(root,'mascot-counts.json'),'utf8'),damaged)
 }finally{await fs.rm(root,{recursive:true,force:true})}
})
