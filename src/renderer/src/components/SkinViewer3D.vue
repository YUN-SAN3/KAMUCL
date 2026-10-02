<script setup lang="ts">
// SPDX-License-Identifier: MIT
// KAMUCL preview lifecycle and interaction; geometry is skinview3d v3.4.2 (MIT).
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import { MASCOT_INTERACTIVE } from '../mascotInteraction'
import { AmbientLight, DirectionalLight, Mesh, NearestFilter, PerspectiveCamera, Raycaster, Scene, SRGBColorSpace, Texture, Vector2, WebGLRenderer } from 'three'
import type { SkinFace } from '@shared/skinPixels'
import { useMotion } from '../motion'
import { PreviewPlayer } from '../skinModel'
import { loadImage, migrateLegacySkin, detectSkinVariant } from '../skin-render'
import { beginBootTask } from '../bootTasks'
import { createFallbackSkin } from '../fallbackSkin'
import { SkinGestureOwner } from '../skinEditorInteraction'
const props = withDefaults(defineProps<{ src?: string; cape?: string; variant?: 'classic' | 'slim'; animation?: 'walk' | 'idle'; paused?: boolean; editCanvas?: HTMLCanvasElement; revision?: number; editMode?: 'draw' | 'rotate'; editDisabled?: boolean; layer?: 'inner' | 'outer'; hiddenParts?: string[] }>(), { src:'', cape:'', variant:'classic', animation:'walk', paused:false })
const emit = defineEmits<{ stroke: [active: boolean]; pixel: [x: number, y: number, face: SkinFace]; gap: []; rotate: [] }>()
const interactive = inject(MASCOT_INTERACTIVE, undefined)
// Editing and camera gestures continue; only decorative walking yields priority.
const effectivePaused = computed(() => props.paused || (!!interactive?.value && !props.editCanvas))
const gestures = new SkinGestureOwner()
const raycaster = new Raycaster()
const { decorativeActive, hidden } = useMotion()
watch(decorativeActive, wake)
watch(hidden, value => { if (value) finishGesture() })
const container = ref<HTMLDivElement | null>(null), supported = ref(true), dragging = ref(false)
let gl: WebGLRenderer | undefined, world: Scene, camera: PerspectiveCamera, player: PreviewPlayer
let resize: ResizeObserver | undefined, frame = 0, closed = false, skinRequest = 0, capeRequest = 0
let skin: Texture | null = null, cape: Texture | null = null
let ambient: AmbientLight | undefined, keyLight: DirectionalLight | undefined
let yaw = -.35, pitch = 0, zoom = 1, targetYaw = yaw, targetPitch = pitch, targetZoom = zoom
let previous = 0, seconds = 0, blend = 1, distance = 50, pointerX = 0, pointerY = 0
const clamp = (n:number,min:number,max:number) => Math.max(min,Math.min(max,n))
const finishBoot = beginBootTask()
let bootTimer: ReturnType<typeof setTimeout> | undefined
function texture(image: HTMLImageElement | HTMLCanvasElement): Texture {
  const value = new Texture(image)
  value.colorSpace = SRGBColorSpace; value.magFilter = NearestFilter; value.minFilter = NearestFilter
  value.generateMipmaps = false; value.needsUpdate = true
  return value
}
async function updateSkin(): Promise<void> {
  if (!gl) return
  const request = ++skinRequest
  let image: HTMLImageElement | HTMLCanvasElement = props.editCanvas || createFallbackSkin(), remote = !!props.editCanvas
  try { if (props.src && !props.editCanvas) { image = migrateLegacySkin(await loadImage(props.src)); remote = true } } catch { /* Usable local fallback. */ }
  if (closed || request !== skinRequest) return
  const next = texture(image), old = skin
  skin = next; player.skin.map = next; player.skin.setOuterLayerVisible(remote)
  player.skin.modelType = (props.editCanvas ? props.variant === 'slim' : remote && (props.variant === 'slim' || detectSkinVariant(image) === 'slim')) ? 'slim' : 'default'
  old?.dispose(); applyVisibility(); finishBoot(); clearTimeout(bootTimer); wake()
}
function applyVisibility() {
  if (!player || !props.editCanvas) return
  for (const name of ['head','body','leftArm','rightArm','leftLeg','rightLeg'] as const) {
    player.skin[name].visible = !props.hiddenParts?.includes(name)
    player.skin[name].outerLayer.visible = props.layer === 'outer'
  }
  wake()
}
function paintAt(event: PointerEvent) {
  if (!gl || !props.editCanvas || props.editDisabled) return
  const rect = gl.domElement.getBoundingClientRect()
  if (!rect.width || !rect.height || event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom) { emit('gap'); return }
  player.updateMatrixWorld(true); camera.updateMatrixWorld(true)
  raycaster.setFromCamera(new Vector2((event.clientX-rect.left)/rect.width*2-1, 1-(event.clientY-rect.top)/rect.height*2), camera)
  const objects: Mesh[] = []
  player.skin.traverseVisible(object => { if (object instanceof Mesh) { let node = object; while (node && node !== player.skin) { if (node.name === props.layer) { objects.push(object); break }; node = node.parent as Mesh } } })
  const hit = raycaster.intersectObjects(objects, false)[0]
  if (!hit?.uv || hit.faceIndex == null) { emit('gap'); return }
  const mesh = hit.object as Mesh, uv = mesh.geometry.attributes.uv, group = Math.floor(hit.faceIndex / 2) * 4
  const us = [0,1,2,3].map(i => uv.getX(group+i)*64), vs = [0,1,2,3].map(i => (1-uv.getY(group+i))*64)
  const x = Math.round(Math.min(...us)), y = Math.round(Math.min(...vs)), width = Math.round(Math.max(...us))-x, height = Math.round(Math.max(...vs))-y
  emit('pixel', clamp(Math.floor(hit.uv.x*64),x,x+width-1), clamp(Math.floor((1-hit.uv.y)*64),y,y+height-1), {x,y,width,height})
}
async function updateCape(): Promise<void> {
  if (!gl) return
  const request = ++capeRequest
  let image: HTMLImageElement | undefined
  try { if (props.cape) image = await loadImage(props.cape) } catch { /* Hide a failed cape, never reuse a stale texture. */ }
  if (closed || request !== capeRequest) return
  const next = image ? texture(image) : null, old = cape
  cape = next; player.setCape(next); old?.dispose(); wake()
}
function fit(): void {
  const el = container.value
  if (!el || !gl || !el.clientWidth || !el.clientHeight) return
  gl.setSize(el.clientWidth,el.clientHeight)
  camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix()
  distance = Math.max(20, 10 / camera.aspect) / Math.tan(camera.fov * Math.PI / 360)
  wake()
}
function wake(): void {
  if (closed || frame || document.hidden || !gl) return
  previous = performance.now(); frame = requestAnimationFrame(render)
}
function render(now:number): void {
  frame = 0
  if (closed || !gl) return
  const dt = clamp((now-previous)/1000,0,.05), k = 1-Math.exp(-14*dt)
  previous = now
  if (!effectivePaused.value && decorativeActive.value) { seconds += dt; blend += ((props.animation === 'walk' ? 1 : 0)-blend)*Math.min(1,dt*6) }
  yaw += (targetYaw-yaw)*k; pitch += (targetPitch-pitch)*k; zoom += (targetZoom-zoom)*k
  player.pose(seconds,props.editCanvas ? 0 : blend,yaw)
  const d=distance/zoom
  camera.position.set(0,16+Math.sin(pitch)*d,Math.cos(pitch)*d); camera.lookAt(0,16,0)
  gl.render(world,camera)
  if ((!effectivePaused.value && decorativeActive.value) || dragging.value || Math.abs(targetYaw-yaw)+Math.abs(targetPitch-pitch)+Math.abs(targetZoom-zoom)>.0001) frame=requestAnimationFrame(render)
}
function down(event:PointerEvent):void {
  if (props.editDisabled || !supported.value || !gestures.begin(event, !!props.editCanvas, props.editMode)) return
  event.preventDefault()
  dragging.value=true; pointerX=event.clientX; pointerY=event.clientY
  if (gestures.active?.operation === 'draw') {
    // Painting uses the pose the user currently sees, without residual camera easing.
    targetYaw=yaw;targetPitch=pitch;targetZoom=zoom;emit('stroke', true);paintAt(event)
  } else emit('rotate')
  container.value?.setPointerCapture(event.pointerId); wake()
}
function move(event:PointerEvent):void {
  const gesture = gestures.active
  if (!gesture || !gestures.owns(event.pointerId)) return
  if (!(event.buttons & gesture.buttonMask)) { finishGesture(); return }
  if (gesture.operation === 'draw') { paintAt(event); return }
  targetYaw += (event.clientX-pointerX)*.01
  targetPitch=clamp(targetPitch+(event.clientY-pointerY)*.01,-Math.PI*5/12,Math.PI*5/12)
  pointerX=event.clientX; pointerY=event.clientY; wake()
}
function up(event:PointerEvent):void {
  if (gestures.owns(event.pointerId)) finishGesture()
}
function finishGesture():void {
  const gesture = gestures.finish()
  if (!gesture) return
  dragging.value=false
  if (gesture.operation === 'draw') emit('stroke', false)
  if(container.value?.hasPointerCapture(gesture.pointerId)) container.value.releasePointerCapture(gesture.pointerId)
  wake()
}
function wheel(event:WheelEvent):void {
  if (props.editDisabled) return
  finishGesture(); event.preventDefault()
  targetZoom=clamp(targetZoom*Math.exp(-event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?100:1)*.0012),.5,3);wake()
}
function resetView():void { finishGesture();targetYaw=-.35;targetPitch=0;targetZoom=1;wake() }
function zoomBy(factor: number):void { if(props.editDisabled || !Number.isFinite(factor) || factor <= 0)return;finishGesture();targetZoom=clamp(targetZoom*factor,.5,3);wake() }
function setLighting(studio: boolean):void { if(ambient)ambient.intensity=studio?2:1.35;if(keyLight){keyLight.intensity=studio?1:1.6;keyLight.position.set(studio?-15:35,30,50)}wake() }
function visibility():void { if(document.hidden){finishGesture();cancelAnimationFrame(frame);frame=0}else wake() }
onMounted(()=>{
  try {
    gl=new WebGLRenderer({alpha:true,antialias:true});gl.setPixelRatio(Math.min(devicePixelRatio||1,2));gl.setClearColor(0,0)
    container.value!.appendChild(gl.domElement)
    world=new Scene();camera=new PerspectiveCamera(45,1,.5,500);player=new PreviewPlayer()
    ambient=new AmbientLight(0xffffff,2);world.add(player,ambient)
    keyLight=new DirectionalLight(0xffffff,1);keyLight.position.set(-15,30,50);world.add(keyLight)
    skin=texture(createFallbackSkin());player.skin.map=skin;player.skin.setOuterLayerVisible(false)
    resize=new ResizeObserver(fit);resize.observe(container.value!);fit()
    document.addEventListener('visibilitychange',visibility)
    window.addEventListener('blur',finishGesture)
    bootTimer=setTimeout(finishBoot,150);void updateSkin();void updateCape();wake()
  } catch { supported.value=false;finishBoot();gl?.dispose() }
})
watch([()=>props.src,()=>props.variant],()=>{finishGesture();void updateSkin()})
watch(()=>props.editCanvas,()=>void updateSkin())
watch(()=>props.revision,()=>{ if (skin) skin.needsUpdate=true; wake() })
watch([()=>props.layer,()=>props.hiddenParts],()=>{finishGesture();applyVisibility()},{deep:true})
watch([()=>props.editMode,()=>props.editDisabled],finishGesture,{flush:'sync'})
watch(()=>props.cape,()=>void updateCape())
watch([effectivePaused,()=>props.animation],wake)
onUnmounted(()=>{
  finishGesture()
  closed=true;skinRequest++;capeRequest++;cancelAnimationFrame(frame);clearTimeout(bootTimer);finishBoot()
  resize?.disconnect();document.removeEventListener('visibilitychange',visibility)
  window.removeEventListener('blur',finishGesture)
  player?.dispose();skin?.dispose();cape?.dispose();gl?.dispose();gl?.forceContextLoss();gl?.domElement.remove()
})
function view(angle: number, elevation = 0) { finishGesture();targetYaw=angle; targetPitch=clamp(elevation,-Math.PI*5/12,Math.PI*5/12); yaw=angle; pitch=targetPitch; wake() }
defineExpose({resetView,view,finishGesture,zoomBy,setLighting})
</script>
<template>
  <div ref="container" class="viewer3d" :class="{dragging,editing:!!editCanvas, rotating:dragging && gestures.active?.operation==='rotate'}" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @lostpointercapture="up" @wheel="wheel" @auxclick.prevent @dblclick="!editCanvas && resetView()">
    <p v-if="!supported" class="viewer3d-fallback muted">当前环境不支持 3D 预览</p>
  </div>
</template>
<style scoped>
.viewer3d{position:relative;width:100%;height:var(--sv3d-height,340px);border-radius:var(--radius-md,10px);background:var(--sv3d-surface,var(--card-2));overflow:hidden;cursor:grab;user-select:none;touch-action:none}
.viewer3d.dragging{cursor:grabbing}.viewer3d.editing{cursor:crosshair}.viewer3d.editing.rotating{cursor:grabbing}.viewer3d :deep(canvas){display:block}.viewer3d-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:var(--text-sm,13px)}
</style>
