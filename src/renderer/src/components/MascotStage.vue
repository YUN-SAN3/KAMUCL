<script setup lang="ts">
import {computed,nextTick,onMounted,onUnmounted,ref,watch} from 'vue'
import {AmbientLight,DirectionalLight,Group,Mesh,NearestFilter,Object3D,OrthographicCamera,Scene,SRGBColorSpace,Texture,Vector3,WebGLRenderer} from 'three'
import {MASCOTS,addMascotHits,normalizeMascotSound,type MascotBatch,type MascotState} from '@shared/mascots'
import {KamuInteraction} from '@shared/kamuInteraction'
import {useMotion} from '../motion'
import {errText} from '../api'
import {toast} from '../store'
import {PreviewPlayer} from '../skinModel'
import {MascotAudio} from '../mascotAudio'
import {createMascotAtlas,MascotBatchRenderer} from '../mascotBatch'
import {MascotSoftwareRenderer} from '../mascotSoftware'
import {prepareFeedbackImages} from '../mascotFeedback'
import {MascotFrameDriver,type MascotFrame} from '../mascotFrameDriver'
import {KamuPalmAnimation} from '../kamuPalmAnimation'
import skinUrl from '../assets/mascot-skins/kamu.png'
import palmUrl from '../assets/mascot-feedback/pixel-palm.png'
import printUrl from '../assets/mascot-feedback/palm-print.png'
const props=defineProps<{focusOnReady?:boolean}>(),emit=defineEmits<{close:[];ready:[];activity:[active:boolean];'render-mode':[software:boolean]}>()
const {reduced,hidden,decorativeActive}=useMotion(),host=ref<HTMLElement>(),viewport=ref<HTMLElement>(),hit=ref<HTMLButtonElement>(),menuButton=ref<HTMLButtonElement>()
const ready=ref(false),supported=ref(true),closing=ref(false),menu=ref(false),confirmReset=ref(false),persistError=ref(''),busy=ref(false)
watch(busy,value=>emit('activity',value),{flush:'sync'})
const state=ref<MascotState>({counts:{},order:MASCOTS.map(m=>m.id),sound:normalizeMascotSound()})
const sound=computed(()=>normalizeMascotSound(state.value.sound)),interaction=new KamuInteraction()
const audio=new MascotAudio(()=>sound.value,(played,voices)=>{if(host.value){host.value.dataset.soundsPlayed=String(played);host.value.dataset.activeSounds=String(voices)}},()=>!hidden.value,event=>{data('audioPreparation',event.phase);data('audioPrepareStartedAt',String(event.startedAt));data('audioPrepareAt',String(event.at));data('audioPrepareTime',String(event.audioTime))})
let gl:WebGLRenderer|undefined,software:MascotSoftwareRenderer|undefined,batchRenderer:MascotBatchRenderer|undefined,scene:Scene,camera:OrthographicCamera,player:PreviewPlayer|undefined,waist:Group,pelvis:Object3D
const textures:Texture[]=[],feet:Array<{mesh:Mesh;corners:Vector3[]}>=[],parts:Mesh[]=[],point=new Vector3(),projected=new Vector3()
let feedbackElement:HTMLElement|undefined,palmElement:HTMLImageElement|undefined,printElement:HTMLImageElement|undefined
let palmAnimation:KamuPalmAnimation|undefined
let feedbackReady=false,feedbackPending=false,initialStateReady=false,restartFeedback=false,cancelFeedback:undefined|(()=>void)
let previousPose:number[]|undefined
const writtenStyles=new WeakMap<Element,Map<string,string>>(),writtenData=new Map<string,string>()
function style(element:HTMLElement|SVGElement|undefined,key:string,value:string){if(!element)return;let values=writtenStyles.get(element);if(!values){values=new Map();writtenStyles.set(element,values)}if(values.get(key)===value)return;element.style.setProperty(key,value);values.set(key,value)}
function data(key:string,value:string){if(!host.value||writtenData.get(key)===value)return;host.value.dataset[key]=value;writtenData.set(key,value)}
let disposed=false,activated=0,lastContact=-1000,contactsTotal=0,reported=false,acceptedClicks=0,rejectedClicks=0
const frameDriver=new MascotFrameDriver(render,{now:()=>performance.now(),requestAnimationFrame:callback=>requestAnimationFrame(callback),cancelAnimationFrame:id=>cancelAnimationFrame(id),setTimeout:(callback,delay)=>setTimeout(callback,delay),clearTimeout:id=>clearTimeout(id)})
let cancelImage:undefined|(()=>void)
let gpuContext:WebGL2RenderingContext|undefined,gpuFence:WebGLSync|undefined,gpuFrame=0,gpuStarted=0,gpuDeadline:ReturnType<typeof setTimeout>|undefined
let contextCanvas:HTMLCanvasElement|undefined
function cancelGpuReady(){cancelAnimationFrame(gpuFrame);gpuFrame=0;clearTimeout(gpuDeadline);gpuDeadline=undefined;if(gpuFence){gpuContext?.deleteSync(gpuFence);gpuFence=undefined}gpuContext=undefined}
function publishReady(now:number){
 if(disposed||hidden.value||!feedbackReady||!player||!host.value||ready.value)return
 ready.value=true;activated=now;interaction.resume(now);palmAnimation?.resume();host.value.dataset.readyAt=String(now);emit('ready')
 if(props.focusOnReady)void nextTick(()=>{if(!disposed&&!hidden.value&&ready.value)hit.value?.focus()})
 wake()
}
function releaseGl(){if(contextCanvas){contextCanvas.removeEventListener('webglcontextlost',contextLost);contextCanvas=undefined}gl?.dispose();gl?.forceContextLoss();gl?.domElement.remove();gl=undefined}
function useSoftware(reason:string){
 cancelGpuReady();ready.value=false;interaction.pause(performance.now());palmAnimation?.pause();data('gpuReadyFallback',reason);data('gpuReadyStatus','software-pending');releaseGl()
 try{software??=new MascotSoftwareRenderer();software.setSize(48,72,1);if(disposed||!viewport.value){software.dispose();software=undefined;return}viewport.value.prepend(software.domElement);data('renderBackend','canvas2d-depth');emit('render-mode',true);supported.value=true;previousPose=undefined;wake()}
 catch(error){supported.value=false;data('gpuReadyStatus','failed');persistError.value='像素预览无法加载：'+errText(error)}
}
function contextLost(event:Event){event.preventDefault();if(!disposed)useSoftware('WebGL context lost')}
function checkGpuReady(){
 gpuFrame=0;if(disposed||hidden.value){cancelGpuReady();return}
 const context=gpuContext,fence=gpuFence;if(!context||!fence)return
 try{
  if(context.isContextLost()){useSoftware('WebGL context lost during first draw');return}
  const result=context.clientWaitSync(fence,0,0);data('gpuCheckMs',String(performance.now()-gpuStarted))
  if(result===context.ALREADY_SIGNALED||result===context.CONDITION_SATISFIED){cancelGpuReady();data('gpuReadyStatus','commands-complete');publishReady(performance.now())}
  else if(result===context.WAIT_FAILED)useSoftware('WebGL first draw fence WAIT_FAILED')
  else gpuFrame=requestAnimationFrame(checkGpuReady)
 }catch(error){useSoftware('WebGL first draw fence: '+errText(error))}
}
function confirmGpuDraw(){
 if(!gl||gpuFence||disposed||hidden.value)return
 try{
  const context=gl.getContext();if(context.isContextLost()){useSoftware('WebGL context lost before first draw');return}
  const fence=context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE,0);if(!fence){useSoftware('WebGL first draw fence unavailable');return}
  gpuContext=context;gpuFence=fence;gpuStarted=performance.now();data('gpuReadyStatus','pending');context.flush()
  // This is only a failure boundary. A naturally signalled fence publishes immediately.
  gpuDeadline=setTimeout(()=>{if(!disposed&&gpuFence)useSoftware('WebGL first draw fence timed out (3000ms)')},3000);checkGpuReady()
 }catch(error){useSoftware('WebGL first draw submission: '+errText(error))}
}
function retryPreview(){if(disposed)return;persistError.value='';if(!feedbackReady){void prepareScene();return}useSoftware('manual software preview retry')}
let hits:string[]=[],batch:MascotBatch|undefined,flight:Promise<void>|undefined,saveTimer:ReturnType<typeof setTimeout>|undefined,retryTimer:ReturnType<typeof setTimeout>|undefined,retryDelay=800,soundRevision=0,savedSoundRevision=0
const unsaved=()=>!!batch||!!hits.length||soundRevision!==savedSoundRevision
function reportPending(){const pending=unsaved()||interaction.busy;if(pending!==reported){reported=pending;window.kamucl.send('window:mascotPending',pending)}}
async function save():Promise<void>{
 if(flight)return flight
 flight=(async()=>{while(unsaved()){
  if(batch||hits.length){batch??={batchId:crypto.randomUUID(),hits:hits.splice(0,512)};await window.kamucl.invoke('mascots:batch',batch);batch=undefined}
  else{const revision=soundRevision,prefs={...sound.value};await window.kamucl.invoke('mascots:sound',prefs);savedSoundRevision=revision}
 }persistError.value='';retryDelay=800})().catch(error=>{persistError.value=errText(error);throw error}).finally(()=>{
  flight=undefined;reportPending();if(unsaved()&&!disposed){clearTimeout(retryTimer);retryTimer=setTimeout(()=>void save().catch(()=>{}),retryDelay);retryDelay=Math.min(8000,retryDelay*2)}
 });return flight
}
function queueSave(){reportPending();if(!saveTimer)saveTimer=setTimeout(()=>{saveTimer=undefined;void save().catch(()=>{})},120)}
function recordContacts(contacts:number[],now:number){for(const contact of contacts){state.value=addMascotHits(state.value,['kamu']);hits.push('kamu');lastContact=hidden.value?-1000:contact;contactsTotal++;if(!hidden.value)audio.play(0)}if(contacts.length)queueSave()}
async function drain(){while(interaction.busy&&!disposed){if(!supported.value)throw new Error('互动预览不可用，请重试预览后保存');if(hidden.value){const now=performance.now();interaction.resume(now);recordContacts(interaction.advance(now+10000,reduced.value).contacts,now+10000);interaction.pause(now);busy.value=interaction.busy;reportPending()}else{wake();await new Promise<void>(resolve=>setTimeout(resolve,16))}}}
async function flush(){const wasClosing=closing.value;closing.value=true;try{await drain();clearTimeout(saveTimer);saveTimer=undefined;clearTimeout(retryTimer);await save()}finally{closing.value=wasClosing}}
async function closeStage(){if(closing.value)return;closing.value=true;try{await flush();emit('close')}catch(error){toast('互动次数尚未保存：'+errText(error),'error')}finally{closing.value=false}}
async function closeWindow(quit=false){if(closing.value)return;closing.value=true;try{await flush();window.kamucl.send(quit?'window:mascotQuit':'window:close')}catch(error){toast('互动次数尚未保存，关闭已暂停：'+errText(error),'error')}finally{closing.value=false}}
const unsubscribe=window.kamucl.on('window:mascotClose',payload=>void closeWindow((payload as {quit?:boolean}|undefined)?.quit===true))
function slap(){if(!ready.value||hidden.value||closing.value||confirmReset.value)return;void audio.unlock();if(!interaction.accept(performance.now())){rejectedClicks++;data('rejectedClicks',String(rejectedClicks));data('queue',String(interaction.queued));toast('拍打队列已满，请稍候');return}acceptedClicks++;data('acceptedClicks',String(acceptedClicks));data('queue',String(interaction.queued));busy.value=true;reportPending();wake()}
function keyDown(event:KeyboardEvent){if(event.key===' '||event.key==='Enter'){event.preventDefault();if(!event.repeat)slap()}}
function soundChanged(value:Partial<{muted:boolean;volume:number}>){state.value.sound=normalizeMascotSound({...sound.value,...value});soundRevision++;audio.update();void audio.unlock();queueSave()}
async function resetCounts(){try{await flush();state.value=await window.kamucl.invoke('mascots:reset',true,'kamu') as MascotState;confirmReset.value=false;menu.value=false;await nextTick(()=>menuButton.value?.focus())}catch(error){toast(errText(error),'error')}}
function closeMenu(){menu.value=false;confirmReset.value=false;void nextTick(()=>menuButton.value?.focus())}
function wake(){if(!disposed&&!hidden.value&&player)frameDriver.request()}
function render(delivery:MascotFrame){
 const now=performance.now()
 if(disposed||hidden.value||!player)return
 // Host delivery may lag behind the rAF timestamp and recover on the next frame.
 // Phase, contact playback and feedback use the same actual callback clock.
 const started=now,pose=interaction.advance(now,reduced.value,50);recordContacts(pose.contacts,now);busy.value=interaction.busy
 if(ready.value)palmAnimation?.present({cycleId:pose.cycleId,palm:pose.palm,contactAt:pose.contacts.length?now:undefined,reduced:reduced.value})
 const activation=ready.value?Math.min(1,(now-activated)/(reduced.value?100:380)):0,ease=activation*activation*(3-2*activation)
 const idle=ready.value&&decorativeActive.value?Math.sin(now*.002)*.016:0,pop=Math.max(0,1-(now-lastContact)/210)*Math.sin(Math.min(1,Math.max(0,(now-lastContact)/210))*Math.PI)
 const waistAngle=Math.sin(pose.yaw/2)*.28+pop*.12,headAngle=-waistAngle+idle,armAngle=-.04+pop*.15,scale=.75+ease*.25
 const nextPose=[pose.yaw,waistAngle,headAngle,armAngle,scale],modelChanged=!previousPose||nextPose.some((value,index)=>value!==previousPose![index])
 if(modelChanged){
 player.rotation.y=pose.yaw;waist.rotation.x=waistAngle;player.skin.head.rotation.x=headAngle
 player.skin.leftArm.rotation.set(-.04+pop*.15,0,.05);player.skin.rightArm.rotation.set(-.04+pop*.15,0,-.05)
 player.skin.leftLeg.rotation.x=0;player.skin.rightLeg.rotation.x=0
 player.scale.setScalar(scale);player.position.y=0;player.updateMatrixWorld(true)
 let footY=Infinity;for(const part of feet)for(const corner of part.corners)footY=Math.min(footY,point.copy(corner).applyMatrix4(part.mesh.matrixWorld).y)
 player.position.y+=1-footY;player.updateMatrixWorld(true)
 projected.copy(pelvis.getWorldPosition(point)).project(camera)
 batchRenderer?.update()
 try{
  if(software&&batchRenderer)software.render(batchRenderer.mesh,camera)
  else if(gl){const drawingGl=gl;if(!ready.value){const compileStarted=performance.now();gl.compile(scene,camera);data('compileMs',String(performance.now()-compileStarted))}const submitStarted=performance.now();gl.render(scene,camera);if(gl!==drawingGl){previousPose=undefined;return}if(!ready.value)data('firstSubmitMs',String(performance.now()-submitStarted))}
 }catch(error){if(software){supported.value=false;persistError.value='像素预览无法加载：'+errText(error)}else useSoftware('WebGL compile/draw: '+errText(error));return}
 previousPose=nextPose
 }
 // Only the local compositor transform moves the feedback; left/top stay fixed.
 // The palm's own transform remains relative to this projected pelvis position.
 style(feedbackElement,'translate',`${(projected.x+1)*24}px ${(1-projected.y)*36}px`)
 if(feedbackElement&&feedbackElement.dataset.contacts!==String(contactsTotal))feedbackElement.dataset.contacts=String(contactsTotal)
 data('cycleId',String(pose.cycleId));if(pose.contacts.length)data('contactAt',String(now))
 const feedback=palmAnimation?.snapshot();if(feedback){data('palmAnimationCurrentTime',String(feedback.palmCurrentTime));data('printAnimationCurrentTime',String(feedback.printCurrentTime));data('palmAnimationPlayState',feedback.palmPlayState);data('printAnimationPlayState',feedback.printPlayState)}
 data('phase',interaction.phase);data('queue',String(interaction.queued));data('contacts',String(contactsTotal));data('bodyYaw',String(pose.yaw));data('activation',String(activation));data('renderDrawCalls',String(modelChanged?(software?.info.render.calls??gl?.info.render.calls??0):0));data('rasterFrames',String(software?.info.frames??0));data('canvasUploads',String(software?.info.totalUploads??0))
 data('rafTimestamp',delivery.kind==='raf'?String(delivery.rafTimestamp):'NaN');data('renderNow',String(now))
 data('frameCallbackKind',delivery.kind);data('frameFallbacks',String(delivery.fallbacks));data('frameCallbackGap',String(delivery.gap));data('framePendingAge',String(delivery.pendingAge))
 // A real callback observation is separate from raster work or canvas uploads.
 // Keep this observation even when exact pixels are unchanged.
 if(host.value)host.value.dataset.renderMs=String(performance.now()-started)
 reportPending()
 if(!ready.value){if(software){data('gpuReadyStatus','software-first-raster');publishReady(now)}else confirmGpuDraw();return}
 if(decorativeActive.value||interaction.busy||now-lastContact<500||activation<1)frameDriver.request()
}
async function prepareScene(){
 if(disposed||hidden.value||!initialStateReady||!host.value)return
 if(feedbackPending){restartFeedback=true;return}
 feedbackPending=true
 try{
  feedbackElement=host.value.querySelector<HTMLElement>('.mascot-feedback')??undefined;palmElement=feedbackElement?.querySelector<HTMLImageElement>('.pixel-palm')??undefined;printElement=feedbackElement?.querySelector<HTMLImageElement>('.palm-print')??undefined
  if(!palmElement||!printElement)throw new Error('反馈像素图片节点不可用')
  if(!feedbackReady){
   data('feedbackPreparation','pending')
   const preparation=prepareFeedbackImages([{name:'palm',image:palmElement,url:palmUrl},{name:'print',image:printElement,url:printUrl}],event=>{
    if(disposed)return
    const prefix=event.name==='palm'?'feedbackPalm':'feedbackPrint';data(prefix+'Phase',event.phase);data(prefix+event.phase[0].toUpperCase()+event.phase.slice(1)+'At',String(event.at));if(event.reason)data(prefix+'Reason',event.reason)
   });cancelFeedback=preparation.cancel;await preparation.promise
   if(disposed||hidden.value)return
   feedbackReady=true;data('feedbackPreparation','decoded');supported.value=true
  }
  palmAnimation??=new KamuPalmAnimation(palmElement,printElement,event=>{data(event.role==='palm'?'palmAnimationPhase':'printAnimationPhase',event.phase);data(event.role==='palm'?'palmAnimationAt':'printAnimationAt',String(event.at))},()=>performance.now())
  if(!player)await buildScene();else wake()
 }catch(error){if(!disposed&&!hidden.value){supported.value=false;data('feedbackPreparation','failed');persistError.value='互动反馈无法加载：'+errText(error)}}
 finally{cancelFeedback=undefined;feedbackPending=false;const restart=restartFeedback;restartFeedback=false;if(restart&&!disposed&&!hidden.value&&!feedbackReady)void prepareScene()}
}
async function buildScene(){
 if(disposed||!host.value||!viewport.value)return
 try{
  scene=new Scene();camera=new OrthographicCamera(-12,12,35,-1,.1,300);camera.position.set(0,0,100);camera.lookAt(0,0,0)
  scene.add(new AmbientLight(0xffffff,2.1));const light=new DirectionalLight(0xffffff,1.2);light.position.set(-40,80,70);scene.add(light)
  try{gl=new WebGLRenderer({alpha:true,antialias:false,powerPreference:'low-power'});gl.setPixelRatio(1);gl.setSize(48,72);gl.setClearColor(0,0)
   const context=gl.getContext(),debug=context.getExtension('WEBGL_debug_renderer_info'),renderer=String(context.getParameter(debug?.UNMASKED_RENDERER_WEBGL??context.RENDERER));host.value!.dataset.rendererProbe=renderer
   if(/swiftshader|llvmpipe|lavapipe|softpipe|software/i.test(renderer)){gl.dispose();gl.forceContextLoss();gl=undefined;software=new MascotSoftwareRenderer()}
  }catch{gl?.dispose();gl=undefined;software=new MascotSoftwareRenderer()}
  if(gl){contextCanvas=gl.domElement;contextCanvas.addEventListener('webglcontextlost',contextLost)}
  software?.setSize(48,72,1);viewport.value!.prepend(software?.domElement??gl!.domElement);host.value!.dataset.renderBackend=software?'canvas2d-depth':'webgl-pbr';emit('render-mode',!!software)
  const image=await new Promise<HTMLImageElement>((resolve,reject)=>{
   const image=new Image(),clear=()=>{image.onload=null;image.onerror=null;cancelImage=undefined}
   cancelImage=()=>{clear();image.src='';reject(new Error('像素预览已关闭'))}
   image.onload=()=>{clear();resolve(image)};image.onerror=event=>{clear();reject(event)};image.src=skinUrl
  })
  if(disposed||!host.value||!viewport.value)return
  const skin=new Texture(image);skin.colorSpace=SRGBColorSpace;skin.magFilter=skin.minFilter=NearestFilter;skin.generateMipmaps=false;skin.needsUpdate=true;textures.push(skin)
  player=new PreviewPlayer();player.skin.map=skin;player.skin.setOuterLayerVisible(false);player.skin.position.y=16.8
  player.skin.head.scale.setScalar(1.42);player.skin.body.scale.y=.72;player.skin.body.position.y=-4.3
  for(const leg of [player.skin.leftLeg,player.skin.rightLeg]){leg.scale.y=.68;leg.position.y=-8.6}
  for(const arm of [player.skin.leftArm,player.skin.rightArm]){arm.scale.y=.72;arm.position.y=-1.4}
  waist=new Group();waist.position.y=-8.6;player.skin.add(waist);player.updateMatrixWorld(true)
  for(const part of [player.skin.head,player.skin.body,player.skin.leftArm,player.skin.rightArm])waist.attach(part)
  pelvis=new Object3D();pelvis.position.set(0,-7.9,-2.3);player.skin.add(pelvis)
  for(const [name,part] of [['head',player.skin.head],['body',player.skin.body],['leftArm',player.skin.leftArm],['rightArm',player.skin.rightArm],['leftLeg',player.skin.leftLeg],['rightLeg',player.skin.rightLeg]] as const)part.innerLayer.traverse(object=>{if(object instanceof Mesh){parts.push(object);if(name.endsWith('Leg')){object.geometry.computeBoundingBox();const b=object.geometry.boundingBox!,corners:Vector3[]=[];for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])corners.push(new Vector3(x,y,z));feet.push({mesh:object,corners})}}})
  const atlas=createMascotAtlas([image]);textures.push(atlas);batchRenderer=new MascotBatchRenderer([parts],atlas);scene.add(batchRenderer.mesh)
  activated=performance.now();wake()
 }catch(error){if(!disposed){supported.value=false;persistError.value='像素预览无法加载：'+errText(error)}}
}
watch(hidden,value=>{if(value){interaction.pause(performance.now());palmAnimation?.pause();frameDriver.cancel();cancelGpuReady();cancelFeedback?.();audio.pause();void save().catch(()=>{})}else{if(ready.value){interaction.resume(performance.now());palmAnimation?.resume()}else previousPose=undefined;void audio.unlock();if(!feedbackReady)void prepareScene();else wake()}},{flush:'sync'})
watch(decorativeActive,wake);watch(reduced,wake)
onMounted(async()=>{try{const initial=await window.kamucl.invoke('mascots:state') as MascotState;if(disposed)return;state.value=initial;await audio.unlock();if(disposed)return;initialStateReady=true;await prepareScene()}catch(error){if(!disposed){persistError.value=errText(error);toast(errText(error),'error')}}})
onUnmounted(()=>{disposed=true;frameDriver.dispose();palmAnimation?.dispose();cancelFeedback?.();palmElement?.removeAttribute('src');printElement?.removeAttribute('src');cancelImage?.();cancelGpuReady();unsubscribe();clearTimeout(saveTimer);clearTimeout(retryTimer);batchRenderer?.dispose();player?.dispose();for(const texture of textures)texture.dispose();releaseGl();software?.dispose();software?.domElement.remove();void audio.dispose()})
defineExpose({flush,closeStage})
</script>
<template>
 <section ref="host" class="mascot-stage" :class="{reduced,hidden,ready}" aria-label="卡慕像素互动" data-ui="mascot:logo" @keydown.esc.stop.prevent="menu?closeMenu():closeStage()">
  <div ref="viewport" class="figure-strip">
   <button ref="hit" class="mascot-hit" data-hit="kamu" :aria-label="'拍一下卡慕，累计 '+(state.counts.kamu||0)+' 次'" :title="'卡慕 · '+(state.counts.kamu||0)+' 次；点击转身拍打'" :disabled="!ready||closing" @click="slap" @pointerdown="audio.unlock()" @keydown="keyDown"></button>
   <span class="mascot-feedback" data-feedback="kamu" aria-hidden="true"><img class="palm-print" alt="" width="15" height="15" draggable="false"/><img class="pixel-palm" alt="" width="15" height="15" draggable="false"/></span>
   <button v-if="!supported" class="fallback-note" title="预览不可用，点击重试" @click="retryPreview">重试预览</button>
  </div>
  <button ref="menuButton" class="menu-tool" :aria-expanded="menu" aria-label="卡慕互动设置" title="次数、音量与关闭" @click="menu=!menu">⋯</button>
  <div v-if="menu" class="sound-panel" @keydown.esc.stop.prevent="closeMenu"><strong>卡慕 <span>{{state.counts.kamu||0}} 次</span></strong><label>音量 <input type="range" min="0" max="100" :value="Math.round(sound.volume*100)" aria-label="拍打音效音量" @input="soundChanged({volume:Number(($event.target as HTMLInputElement).value)/100})"/><b>{{Math.round(sound.volume*100)}}%</b></label><button class="btn btn-sm btn-ghost" :aria-pressed="sound.muted" @click="soundChanged({muted:!sound.muted})">{{sound.muted?'开启音效':'静音音效'}}</button><template v-if="confirmReset"><span>仅清空卡慕累计次数？</span><div><button class="btn btn-sm btn-ghost" @click="confirmReset=false">取消</button><button class="btn btn-sm btn-ghost" :disabled="busy||closing" @click="resetCounts">确认清空</button></div></template><button v-else class="btn btn-sm btn-ghost" :disabled="busy||closing" @click="confirmReset=true">重置卡慕次数</button><button class="btn btn-sm btn-ghost" :disabled="closing" @click="closeStage">{{closing?'正在保存并关闭…':'恢复 LOGO'}}</button><button v-if="persistError" class="btn btn-sm btn-ghost" @click="flush().catch(()=>{})">保存失败，重试</button><p v-if="persistError" role="status">{{persistError}}</p></div>
 </section>
</template>
<style scoped>
.mascot-stage{position:absolute;inset:0;width:48px;height:72px;-webkit-app-region:no-drag;isolation:isolate}.figure-strip{position:relative;width:48px;height:72px;overflow:visible;touch-action:none;opacity:0;contain:layout style;will-change:opacity,transform}.ready .figure-strip{animation:kamu-in .38s ease-out both}.figure-strip :deep(canvas){position:absolute;inset:0;display:block;width:48px;height:72px;pointer-events:none;image-rendering:pixelated;transform:translateZ(0);will-change:transform}.mascot-hit{position:absolute;inset:0;z-index:2;padding:0;border:0;border-radius:8px;background:transparent;cursor:pointer;touch-action:manipulation}.mascot-hit:focus-visible{outline:2px solid var(--accent);outline-offset:2px;background:color-mix(in srgb,var(--accent) 8%,transparent)}.menu-tool{position:absolute;right:-8px;bottom:0;z-index:35;border:1px solid var(--border);background:var(--card-solid,var(--bg-2));color:var(--text-dim);width:20px;height:16px;padding:0;border-radius:5px;line-height:10px;cursor:pointer;font-size:15px}.menu-tool:hover,.menu-tool:focus-visible{color:var(--accent);outline:2px solid var(--accent)}.sound-panel{position:absolute;left:0;top:calc(100% + 4px);z-index:9100;width:230px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--card-solid,var(--bg-2));box-shadow:var(--shadow-lg);display:grid;gap:10px;font-size:12px}.sound-panel strong{display:flex;justify-content:space-between}.sound-panel strong span{color:var(--accent)}.sound-panel label{display:flex;align-items:center;gap:7px}.sound-panel input{width:110px;accent-color:var(--accent)}.sound-panel b{min-width:30px}.sound-panel>div{display:flex;justify-content:flex-end;gap:4px}.sound-panel p{margin:0;color:var(--danger);overflow-wrap:anywhere}.fallback-note{position:absolute;inset:0;display:grid;place-items:center;font-size:10px;color:var(--text-dim)}.mascot-feedback{position:absolute;left:0;top:0;will-change:translate;width:15px;height:15px;margin:-7.5px 0 0 -7.5px;pointer-events:none;z-index:30}.mascot-feedback img{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;will-change:opacity,transform;opacity:0}.pixel-palm{transform-origin:70% 90%}.reduced.ready .figure-strip{animation:kamu-in .1s ease-out both}.hidden *{animation-play-state:paused!important}@keyframes kamu-in{from{opacity:0;transform:translateY(-7px) scale(.65)}to{opacity:1;transform:none}}
</style>
