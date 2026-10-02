<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import SkinViewer3D from './SkinViewer3D.vue'
import SkinColorPalette from './SkinColorPalette.vue'
import UiGlyph from './UiGlyph.vue'
import { loadImage, migrateLegacySkin } from '../skin-render'
import { makeBaseOpaque, paintSkinPixel, type SkinFace } from '@shared/skinPixels'
import { parseSkinHex, rememberSkinColor, rgbToSkinHex, skinBrushRgba } from '@shared/skinColors'
import { normalizeSkinPalettePreferences } from '@shared/skinPalettePreferences'
import type { SkinEditorPaletteSettings } from '@shared/types'
import { store, toast } from '../store'
import { errText, saveSettings } from '../api'
import { refreshSkinAfter } from '../skinRevision'
import { mergeSkinCloseIntent, type SkinCloseIntent } from '../skinEditorInteraction'
const props = defineProps<{ current?: string; variant?: 'classic' | 'slim' }>()
const emit = defineEmits<{ close: []; uploaded: [] }>()
const canvas = shallowRef(document.createElement('canvas'))
canvas.value.width = canvas.value.height = 64
const ctx = canvas.value.getContext('2d', { willReadFrequently: true })!
const blank = ctx.createImageData(64,64); makeBaseOpaque(blank.data)
for(let i=0;i<blank.data.length;i+=4)if(blank.data[i+3]===255)blank.data[i]=blank.data[i+1]=blank.data[i+2]=220
ctx.putImageData(blank,0,0)
const viewer = ref<InstanceType<typeof SkinViewer3D>>(), closeButton = ref<HTMLButtonElement>(), fileInput = ref<HTMLInputElement>()
const variant = ref(props.variant || 'classic'), layer = ref<'inner'|'outer'>('inner')
const palettePreferences = ref(normalizeSkinPalettePreferences(store.settings?.skinEditorPalette))
const color = computed({ get: () => palettePreferences.value.color, set: value => { const rgb = parseSkinHex(value); if (rgb) palettePreferences.value.color = rgbToSkinHex(rgb) } })
const alpha = computed({ get: () => palettePreferences.value.alpha, set: value => { if (Number.isFinite(value)) palettePreferences.value.alpha = Math.max(0, Math.min(1, value)) } })
const tool = ref('brush'), revision = ref(0), dirty = ref(false), busy = ref(false), busyText = ref(''), finishingClose = ref(false), askClose = ref(false), uploadConfirm = ref(false)
const operationError = ref('')
const hiddenParts = ref<string[]>([]), undo = ref<Uint8ClampedArray[]>([]), redo = ref<Uint8ClampedArray[]>([])
type CloseIntent = SkinCloseIntent<typeof store.currentView>
const closeIntent = shallowRef<CloseIntent>()
const blocked = computed(() => busy.value || finishingClose.value || askClose.value || uploadConfirm.value)
const ownerId = crypto.randomUUID()
let disposed = false, paletteTimer: ReturnType<typeof setTimeout> | undefined, pendingPalette: SkinEditorPaletteSettings | undefined, paletteWrite: Promise<void> | undefined
function flushPalette(): Promise<void> {
  if (paletteWrite) return paletteWrite
  paletteWrite = (async () => {
    while (pendingPalette) {
      const next = pendingPalette; pendingPalette = undefined
      try { await saveSettings({ skinEditorPalette: next }) }
      catch (error) { toast('调色板偏好未能保存：' + errText(error), 'error') }
    }
  })().finally(() => { paletteWrite = undefined; window.kamucl.send('window:skinEditorPrefsPending', { ownerId, pending: !!pendingPalette }) })
  return paletteWrite
}
watch(palettePreferences, value => {
  pendingPalette = normalizeSkinPalettePreferences(value)
  window.kamucl.send('window:skinEditorPrefsPending', { ownerId, pending: true })
  if (store.settings) store.settings.skinEditorPalette = pendingPalette
  clearTimeout(paletteTimer); paletteTimer = setTimeout(() => void flushPalette(), 350)
}, { deep: true, flush: 'sync' })
watch(busy, pending => window.kamucl.send('window:skinEditorBusy', { ownerId, pending }), { flush: 'sync' })
const parts = [{key:'head',name:'头部'},{key:'body',name:'身体'},{key:'leftArm',name:'左臂'},{key:'rightArm',name:'右臂'},{key:'leftLeg',name:'左腿'},{key:'rightLeg',name:'右腿'}]
const views = [{name:'正面',yaw:0,pitch:0},{name:'背面',yaw:Math.PI,pitch:0},{name:'左侧',yaw:Math.PI/2,pitch:0},{name:'右侧',yaw:-Math.PI/2,pitch:0},{name:'俯视',yaw:0,pitch:Math.PI*5/12},{name:'仰视',yaw:0,pitch:-Math.PI*5/12}]
const selectedView = ref('')
const previewExpanded = ref(false), studioLight = ref(true)
const contentElement = ref<HTMLElement>(), toolRailHeight = ref(300)
let contentResize: ResizeObserver | undefined
onMounted(()=>{contentResize=new ResizeObserver(()=>{const el=contentElement.value;if(el)toolRailHeight.value=Math.max(40,el.clientHeight-parseFloat(getComputedStyle(el).paddingBottom||'0'))});if(contentElement.value)contentResize.observe(contentElement.value)})
const drawingTools = [{key:'brush',name:'绘制',shortcut:'B'},{key:'erase',name:'橡皮',shortcut:'E'},{key:'pick',name:'吸色',shortcut:'I'},{key:'fill',name:'填色',shortcut:'G'}]
function toggleLighting(){if(!blocked.value){endGesture();studioLight.value=!studioLight.value;viewer.value?.setLighting(studioLight.value)}}
function togglePreview(){if(!blocked.value){endGesture();previewExpanded.value=!previewExpanded.value}}
const uploadState = computed(() => store.selectedAccount?.type === 'microsoft' ? `上传至 ${store.selectedAccount.username}` : '上传需要微软正版账号；可编辑与保存 PNG')
let snapshot: Uint8ClampedArray | undefined, last: {x:number;y:number;key:string} | undefined
const pixels = () => ctx.getImageData(0,0,64,64)
const canEdit = () => !disposed && !blocked.value
function changed() { revision.value++; dirty.value = true }
function commit() {
  const current=pixels().data
  if (snapshot && snapshot.some((v,i) => v !== current[i])) { undo.value.push(snapshot); if(undo.value.length>80)undo.value.shift(); redo.value=[]; changed() }
  snapshot=undefined; last=undefined
}
function endGesture() { viewer.value?.finishGesture(); commit() }
function stroke(active: boolean) { if(!active){commit();return}if(canEdit()){snapshot=pixels().data;last=undefined;selectedView.value=''} }
function paint(x:number,y:number,face:SkinFace) {
  if(!canEdit())return
  const image=pixels(), i=(y*64+x)*4
  if(tool.value==='pick'){color.value='#'+Array.from(image.data.slice(i,i+3)).map(v=>v.toString(16).padStart(2,'0')).join('');if(layer.value==='outer')alpha.value=image.data[i+3]/255;return}
  const before=new Uint8ClampedArray(image.data)
  const value=tool.value==='erase'?(layer.value==='outer'?[0,0,0,0]:[255,255,255,255]):skinBrushRgba(color.value,alpha.value,layer.value==='outer')
  if(!value)return
  const key=JSON.stringify(face)
  if(tool.value==='fill')paintSkinPixel(image.data,x,y,value,face,true)
  else{const steps=last?.key===key?Math.max(Math.abs(x-last.x),Math.abs(y-last.y)):0;for(let s=0;s<=steps;s++)paintSkinPixel(image.data,steps?Math.round(last!.x+(x-last!.x)*s/steps):x,steps?Math.round(last!.y+(y-last!.y)*s/steps):y,value,face)}
  last={x,y,key};ctx.putImageData(image,0,0);revision.value++
  const rendered=pixels().data
  if(before.some((v,index)=>v!==rendered[index])){dirty.value=true;if(tool.value!=='erase'&&palettePreferences.value.recent[0]!==color.value)palettePreferences.value.recent=rememberSkinColor(palettePreferences.value.recent,color.value)}
}
function history(back:boolean){if(!canEdit())return;endGesture();const from=back?undo.value:redo.value,to=back?redo.value:undo.value,next=from.pop();if(!next)return;to.push(pixels().data);ctx.putImageData(new ImageData(new Uint8ClampedArray(next),64,64),0,0);changed()}
async function replaceImage(src:string){const raw=await loadImage(src);if(disposed||finishingClose.value)return;if(raw.width!==64||![32,64].includes(raw.height))throw Error('请选择 64×64 或 64×32 皮肤 PNG');const image=migrateLegacySkin(raw);snapshot=pixels().data;ctx.clearRect(0,0,64,64);ctx.drawImage(image,0,0);const result=pixels();makeBaseOpaque(result.data);ctx.putImageData(result,0,0);commit();revision.value++}
function beginOperation(text:string){endGesture();operationError.value='';busyText.value=text;busy.value=true}
function finishOperation(){busy.value=false;busyText.value='';if(!disposed)processClose()}
function failOperation(error:unknown){operationError.value=errText(error);toast(operationError.value,'error')}
async function importImage(src:string){if(!canEdit())return;beginOperation('正在读取皮肤…');try{await replaceImage(src)}catch(error){failOperation(error)}finally{finishOperation()}}
async function choose(event:Event){
  const input=event.target as HTMLInputElement,file=input.files?.[0]
  if(!file||!canEdit()){input.value='';return}
  beginOperation('正在读取皮肤…')
  try{if(file.size>200000)throw Error('皮肤 PNG 文件过大，请使用标准 64×64 或 64×32 PNG');const src=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('皮肤 PNG 读取失败'));reader.readAsDataURL(file)});await replaceImage(src)}catch(error){failOperation(error)}finally{input.value='';finishOperation()}
}
function newSkin(){if(canEdit()){endGesture();operationError.value='';snapshot=pixels().data;ctx.putImageData(blank,0,0);commit();revision.value++}}
async function save(){
  if(busy.value||finishingClose.value||disposed)return false
  beginOperation('正在保存皮肤…')
  try{const saved=await window.kamucl.invoke('skin:editorSave',canvas.value.toDataURL('image/png'));if(saved){dirty.value=false;toast('皮肤 PNG 已保存','success')}return !!saved}catch(error){failOperation(error);return false}finally{finishOperation()}
}
function openUpload(){if(canEdit()){endGesture();operationError.value='';uploadConfirm.value=true}}
async function upload(){
  if(busy.value||finishingClose.value||disposed)return
  beginOperation('正在上传皮肤…')
  try{await refreshSkinAfter(window.kamucl.invoke('skin:editorUpload',canvas.value.toDataURL('image/png'),variant.value,store.selectedAccount?.id));uploadConfirm.value=false;emit('uploaded');toast('皮肤已上传，预览与历史已更新','success')}catch(error){failOperation(error)}finally{finishOperation()}
}
function requestClose(intent:CloseIntent={kind:'editor'}){if(disposed)return;closeIntent.value=mergeSkinCloseIntent(closeIntent.value,intent);if(finishingClose.value)return;endGesture();uploadConfirm.value=false;processClose()}
function processClose(){if(!closeIntent.value||busy.value||finishingClose.value||disposed)return;if(dirty.value)askClose.value=true;else void finishClose()}
function cancelClose(){if(finishingClose.value)return;askClose.value=false;closeIntent.value=undefined;void nextTick(()=>closeButton.value?.focus({preventScroll:true}))}
function cancelUpload(){if(busy.value)requestClose();else{uploadConfirm.value=false;void nextTick(()=>closeButton.value?.focus({preventScroll:true}))}}
async function finishClose(){
  if(finishingClose.value||busy.value||disposed)return
  endGesture();finishingClose.value=true;askClose.value=false;uploadConfirm.value=false;clearTimeout(paletteTimer);await flushPalette()
  const intent=closeIntent.value;closeIntent.value=undefined
  dirty.value=false;window.kamucl.send('window:skinEditorDirty',false);emit('close')
  if(intent?.kind==='quit')window.kamucl.send('window:skinEditorQuit');else if(intent?.kind==='window')window.kamucl.send('window:close');else if(intent?.kind==='navigate')store.currentView=intent.destination
}
async function saveClose(){if(await save() && closeIntent.value)await finishClose()}
function selectView(view:typeof views[number]){if(!blocked.value){endGesture();selectedView.value=view.name;viewer.value?.view(view.yaw,view.pitch)}}
function resetView(){if(!blocked.value){endGesture();selectedView.value='';viewer.value?.resetView()}}
function togglePart(key:string){if(!blocked.value){endGesture();hiddenParts.value=hiddenParts.value.includes(key)?hiddenParts.value.filter(v=>v!==key):[...hiddenParts.value,key]}}
function keys(event:KeyboardEvent){
  if(event.isComposing||event.defaultPrevented)return
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(askClose.value||busy.value&&closeIntent.value)cancelClose();else if(uploadConfirm.value)cancelUpload();else if(previewExpanded.value)previewExpanded.value=false;else requestClose();return}
  const target=event.target as HTMLElement
  if(target?.closest('input,textarea,select')||target?.isContentEditable||blocked.value)return
  const key=event.key.toLowerCase()
  if((event.ctrlKey||event.metaKey)&&key==='z'){event.preventDefault();history(!event.shiftKey)}
  else if((event.ctrlKey||event.metaKey)&&key==='s'){event.preventDefault();void save()}
  else if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&['b','e','i','g'].includes(key)){event.preventDefault();tool.value=({b:'brush',e:'erase',i:'pick',g:'fill'} as Record<string,string>)[key]}
}
watch([tool,color,alpha],()=>viewer.value?.finishGesture(),{flush:'sync'})
let restoringView=false
watch(()=>store.currentView,(next,old)=>{if(restoringView||next===old||!(dirty.value||busy.value||finishingClose.value))return;restoringView=true;store.currentView=old;restoringView=false;requestClose({kind:'navigate',destination:next})},{flush:'sync'})
watch(dirty,value=>window.kamucl.send('window:skinEditorDirty',value),{flush:'sync'})
const offClose=window.kamucl.on('window:skinEditorClose',(data:any)=>requestClose({kind:data?.quit===true?'quit':'window'}))
onBeforeUnmount(()=>{endGesture();disposed=true;contentResize?.disconnect();clearTimeout(paletteTimer);void flushPalette();offClose();window.kamucl.send('window:skinEditorDirty',false);window.kamucl.send('window:skinEditorBusy',{ownerId,pending:false})})
</script>

<template>
  <Teleport to="body">
    <div class="modal-mask skin-editor-mask" @keydown="keys"><section class="modal skin-editor" role="dialog" aria-modal="true" aria-label="绘制皮肤" :inert="finishingClose || askClose || uploadConfirm">
      <header class="editor-header"><div><h2>绘制皮肤</h2><p class="muted">64 × 64 像素 · {{dirty?'有未保存更改':'已保存'}}</p></div><button ref="closeButton" class="icon-btn editor-close" :disabled="finishingClose" @click="requestClose()" aria-label="关闭绘制皮肤" data-modal-dismiss><UiGlyph name="close" /></button></header>
      <div ref="contentElement" class="editor-content" :style="{'--editor-tool-max-height':`${toolRailHeight}px`}" :class="{'preview-expanded':previewExpanded}" :inert="busy">
        <nav class="editor-tool-rail" aria-label="绘制工具">
          <button v-for="item in drawingTools" :key="item.key" class="editor-tool" :class="{selected:tool===item.key}" :aria-pressed="tool===item.key" :title="`${item.name} (${item.shortcut})`" :disabled="blocked" @click="tool=item.key"><UiGlyph :name="item.key" :size="24" /><span>{{item.name}}</span></button>
          <span class="tool-rail-divider"></span>
          <button class="editor-tool" :disabled="blocked||!undo.length" @click="history(true)" title="撤销 (Ctrl+Z)"><UiGlyph name="undo" :size="24" /><span>撤销</span></button>
          <button class="editor-tool" :disabled="blocked||!redo.length" @click="history(false)" title="重做 (Ctrl+Shift+Z)"><UiGlyph name="redo" :size="24" /><span>重做</span></button>
        </nav>
        <div class="editor-model">
        <div class="editor-preview">
          <SkinViewer3D ref="viewer" :edit-canvas="canvas" :revision="revision" :variant="variant" edit-mode="draw" :edit-disabled="blocked" :layer="layer" :hidden-parts="hiddenParts" paused animation="idle" @stroke="stroke" @pixel="paint" @gap="last=undefined" @rotate="selectedView=''" />
          <button class="icon-btn preview-light" :aria-pressed="studioLight" aria-label="切换预览灯光" title="切换预览灯光" :disabled="blocked" @click="toggleLighting"><UiGlyph name="sun" /></button>
          <div class="preview-camera"><button class="icon-btn" :aria-pressed="previewExpanded" :aria-label="previewExpanded?'恢复编辑布局':'扩大模型预览'" :title="previewExpanded?'恢复布局 (Esc)':'扩大预览'" :disabled="blocked" @click="togglePreview"><UiGlyph name="expand" /></button><div class="preview-zoom"><button class="icon-btn" aria-label="放大皮肤预览" :disabled="blocked" @click="viewer?.zoomBy(1.2)">+</button><button class="icon-btn" aria-label="缩小皮肤预览" :disabled="blocked" @click="viewer?.zoomBy(1/1.2)">−</button></div></div>
          <p class="editor-pointer-help muted">左键绘制 · 中键 / Alt+左键旋转 · 滚轮缩放</p>
        </div>
        <div class="editor-controls editor-view-controls" role="group" aria-label="快捷视角"><span class="control-label">视角</span><div class="tools view-tools"><button v-for="view in views" :key="view.name" class="btn btn-ghost" :class="{selected:selectedView===view.name}" :aria-pressed="selectedView===view.name" @click="selectView(view)"><UiGlyph name="cube" /><span>{{view.name}}</span></button><button class="btn btn-ghost" @click="resetView"><UiGlyph name="cube" /><span>恢复视角</span></button></div></div>
        <div class="editor-controls editor-part-controls" role="group" aria-label="显示部位"><div class="control-heading"><span class="control-label">显示部位</span><button class="btn btn-ghost btn-sm editor-show-all" :disabled="!hiddenParts.length" @click="hiddenParts=[]">全部显示</button></div><div class="tools part-tools"><button v-for="part in parts" :key="part.key" class="btn btn-ghost" :class="{selected:!hiddenParts.includes(part.key)}" :aria-pressed="!hiddenParts.includes(part.key)" @click="togglePart(part.key)">{{part.name}}</button></div><p v-if="hiddenParts.length===parts.length" class="muted editor-empty-parts" role="status">所有部位已隐藏，点击部位或“全部显示”恢复。</p></div>
      </div><aside aria-label="绘制工具与颜色">
        <div class="tools file-tools"><button class="btn" @click="newSkin"><UiGlyph name="file" />新建</button><button class="btn" @click="fileInput?.click()"><UiGlyph name="image" />导入 PNG</button><input ref="fileInput" class="file-input" type="file" accept="image/png" @change="choose"><button class="btn" :disabled="!current" @click="current&&importImage(current)"><UiGlyph name="folder" />读取当前皮肤</button></div>
        <div class="editor-options"><label>模型<select v-model="variant" aria-label="皮肤模型"><option value="classic">经典 Classic</option><option value="slim">纤细 Slim</option></select></label><label>图层<select v-model="layer" aria-label="皮肤图层"><option value="inner">基础层（不透明）</option><option value="outer">外层（可透明）</option></select></label></div>
        <SkinColorPalette v-model:color="color" v-model:alpha="alpha" :alpha-enabled="layer==='outer'" :custom="palettePreferences.custom" :recent="palettePreferences.recent" @update:custom="palettePreferences.custom=$event" />
      </aside></div>
      <footer class="editor-footer"><button class="btn btn-ghost editor-upload" :disabled="blocked||store.selectedAccount?.type!=='microsoft'" @click="openUpload"><UiGlyph name="upload" />{{store.selectedAccount?.type==='microsoft'?`上传至 ${store.selectedAccount.username}`:'上传到当前账号'}}</button><div class="editor-footer-save"><button class="btn" :disabled="finishingClose" @click="requestClose()">取消</button><button class="btn btn-gold" :disabled="blocked" @click="save"><UiGlyph name="download" />保存 PNG…</button></div><p v-if="finishingClose||busy||store.selectedAccount?.type!=='microsoft'" class="muted editor-operation-status" role="status">{{finishingClose?'正在保存调色板偏好…':busy?busyText+(closeIntent?' 完成后处理关闭请求。':''):uploadState}}</p><button v-if="busy&&closeIntent" class="btn btn-ghost btn-sm" @click="cancelClose">取消关闭</button><p v-if="operationError" class="editor-operation-error" role="alert">{{operationError}}</p></footer>
    </section></div>
    <div v-if="askClose" class="modal-mask skin-confirm-mask" @keydown="keys"><section class="modal skin-close-dialog editor-confirm" role="alertdialog" aria-modal="true" aria-label="保存皮肤更改" aria-describedby="skin-unsaved-description"><h2>皮肤尚未保存</h2><p id="skin-unsaved-description">保存当前皮肤后退出，或放弃本次未保存的修改。</p><div class="modal-actions"><button class="btn btn-gold" :disabled="busy" @click="saveClose">保存并退出</button><button class="btn" :disabled="busy" @click="finishClose">放弃更改</button><button class="btn" data-modal-initial-focus data-modal-dismiss @click="cancelClose">{{busy?'取消关闭':'继续绘制'}}</button></div><p v-if="busy" class="muted" role="status">{{busyText}}</p><p v-if="operationError" class="editor-operation-error" role="alert">{{operationError}}</p></section></div>
    <div v-if="uploadConfirm" class="modal-mask skin-confirm-mask" @keydown="keys"><section class="modal skin-upload-dialog editor-confirm" role="alertdialog" aria-modal="true" aria-label="确认上传皮肤"><h2>上传皮肤</h2><p>将上传至 {{store.selectedAccount?.username}}，使用{{variant==='slim'?'纤细':'经典'}}模型。</p><div class="modal-actions"><button class="btn btn-gold" :disabled="busy" @click="upload">{{busy?'正在上传…':'确认上传'}}</button><button class="btn" data-modal-initial-focus data-modal-dismiss @click="cancelUpload">{{busy?'完成后关闭编辑器':'取消'}}</button></div><p v-if="operationError" class="editor-operation-error" role="alert">{{operationError}}</p></section></div>
  </Teleport>
</template>

<style scoped>
.skin-editor{width:min(1200px,calc(100vw - 32px));height:min(880px,calc(100dvh - 32px));max-height:calc(100dvh - 32px);padding:0;display:flex;flex-direction:column;overflow:hidden;border-radius:20px}.editor-header{display:flex;flex-shrink:0;align-items:center;justify-content:space-between;gap:16px;padding:20px 24px 14px}.editor-header h2{margin:0;font-size:24px}.editor-header p{margin:5px 0 0;font-size:12px}.editor-close{width:36px;height:36px;flex-shrink:0}.editor-content{display:grid;grid-template-columns:64px minmax(280px,1.2fr) minmax(290px,1fr);min-height:0;flex:1;overflow:hidden;gap:14px;padding:0 20px 16px}.editor-tool-rail{display:flex;flex-direction:column;gap:8px;overflow-y:auto;min-height:0;padding:14px 0}.editor-tool{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;min-height:66px;border:1px solid transparent;border-radius:12px;color:var(--text-dim);background:transparent;font:inherit;font-size:12px;cursor:pointer;position:relative;flex-shrink:0}.editor-tool.selected{background:var(--accent-soft);color:var(--accent-2);border-color:color-mix(in srgb,var(--accent) 40%,transparent)}.editor-tool.selected::before{content:'';position:absolute;left:-1px;top:12px;bottom:12px;width:3px;border-radius:2px;background:var(--accent)}.editor-tool:hover:not(:disabled){background:var(--hover)}.editor-tool:disabled{opacity:.4;cursor:default}.tool-rail-divider{height:1px;background:var(--border);margin:3px 8px;flex-shrink:0}.editor-model{min-height:0;display:flex;flex-direction:column;overflow:auto;scrollbar-gutter:stable}.editor-preview{position:relative;flex:1 1 0;min-height:220px;border:1px solid var(--border);border-radius:16px;overflow:hidden;background:var(--card-2)}.editor-model :deep(.viewer3d){position:absolute;inset:0;height:100%;min-height:0;background:transparent;border-radius:0}.editor-preview::before{content:'';position:absolute;bottom:0;left:-25%;width:150%;height:35%;opacity:.24;transform:perspective(120px) rotateX(40deg);transform-origin:bottom;background-image:linear-gradient(var(--text-dim) 1px,transparent 1px),linear-gradient(90deg,var(--text-dim) 1px,transparent 1px);background-size:32px 32px;pointer-events:none}.preview-light{position:absolute;top:14px;left:14px}.preview-camera{position:absolute;right:14px;top:14px;display:grid;gap:8px}.preview-camera>.icon-btn,.preview-light{background:var(--card);border:1px solid var(--border);border-radius:10px;width:36px;height:36px}.preview-zoom{background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden}.preview-zoom .icon-btn{width:34px;height:34px;border:0;border-radius:0;font-size:23px}.preview-zoom .icon-btn+.icon-btn{border-top:1px solid var(--border)}.editor-pointer-help{position:absolute;bottom:9px;left:12px;right:12px;text-align:center;pointer-events:none;margin:0;font-size:11px;line-height:1.4}.editor-content aside{min-height:0;overflow:auto;scrollbar-gutter:stable;padding-right:2px}.tools{display:flex;flex-wrap:wrap;gap:6px}.file-tools{display:grid;grid-template-columns:.8fr 1fr 1.2fr;margin-bottom:14px}.file-tools .btn{font-size:12px;padding:8px 6px;display:flex;align-items:center;justify-content:center;gap:6px}.file-tools .btn:first-child{border-color:var(--accent);color:var(--accent-2);background:var(--accent-soft)}.file-tools svg{width:16px;flex-shrink:0}.editor-options{display:grid;gap:10px;margin:0 0 16px;padding:4px 10px}.editor-options label{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;font-weight:600}.editor-options select{color:var(--text);background:var(--card-2);padding:9px 12px;border-radius:10px;border:1px solid var(--border);width:65%;font:inherit;font-weight:400}.file-input{display:none}.editor-controls{border:1px solid var(--border);border-radius:14px;padding:12px;margin-top:10px;background:var(--card-2);flex-shrink:0}.control-label{font-size:12px;font-weight:600}.control-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.view-tools,.part-tools{margin-top:8px}.view-tools{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}.view-tools .btn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;min-height:56px;font-size:11px;padding:6px 2px;border:1px solid var(--border);border-radius:11px}.part-tools .btn{padding:6px 10px;font-size:12px;min-height:30px;border:1px solid var(--border);border-radius:10px}.editor-controls .btn.selected{background:var(--accent-soft);border-color:var(--accent);color:var(--text)}.editor-empty-parts{margin:8px 0 0;font-size:12px}.editor-show-all{font-size:11px;padding:4px 8px}.editor-footer{flex-shrink:0;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:12px 24px 16px;border-top:1px solid var(--border)}.editor-footer .btn{display:flex;align-items:center;justify-content:center;gap:8px;min-height:40px;border-radius:12px}.editor-upload{font-size:12px;color:var(--text-dim)}.editor-footer-save{display:flex;gap:10px;margin-left:auto}.editor-footer-save .btn{min-width:108px}.editor-operation-status{flex:1 1 100%;margin:0;font-size:11px;line-height:1.4}.editor-operation-error{flex:1 1 100%;margin:0;max-height:72px;overflow:auto;overflow-wrap:anywhere;font-size:12px;line-height:1.6;color:var(--danger)}.preview-expanded{grid-template-columns:64px minmax(0,1fr)}.preview-expanded aside{display:none}.skin-confirm-mask{z-index:10001}.editor-confirm{width:min(460px,calc(100vw - 32px))}.editor-confirm h2{margin:0;font-size:20px}.editor-confirm p{line-height:1.7}.editor-confirm .modal-actions{gap:8px}.editor-confirm .btn{padding:8px 12px;font-size:13px}
@media(max-width:980px){.editor-content{grid-template-columns:54px minmax(0,1fr);overflow:auto;gap:12px}.editor-tool-rail{grid-row:1 / 3;position:sticky;top:0;align-self:start;max-height:100%;padding-top:0;overflow:visible}.editor-model{height:450px;min-height:450px;overflow:visible}.editor-content aside{grid-column:2;overflow:visible}.editor-tool{min-height:60px}.preview-expanded .editor-model{height:100%;min-height:360px}.editor-header,.editor-footer{padding:14px 20px}.editor-header h2{font-size:22px}.editor-content{padding:0 16px 14px}.editor-preview{min-height:200px}}
@media(max-height:620px) and (min-width:981px){.editor-header{padding:10px 20px}.editor-header h2{font-size:20px}.editor-header>div{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.editor-header p{margin:0}.editor-content{gap:12px;padding-bottom:10px}.editor-preview{min-height:160px}.editor-tool{min-height:52px;gap:4px}.editor-controls{padding:8px;margin-top:6px}.view-tools .btn{min-height:42px;font-size:10px;gap:3px}.view-tools svg{width:16px;height:16px}.editor-footer{padding:8px 20px}.editor-footer .btn{min-height:32px}.editor-footer-save .btn{min-width:94px}.editor-operation-status{font-size:10px}.editor-pointer-help{font-size:10px}}
@media(max-width:520px){.editor-header,.editor-footer{padding:12px}.editor-content{padding:0 10px 12px;gap:8px;grid-template-columns:46px minmax(0,1fr)}.editor-tool{font-size:11px;min-height:54px}.view-tools{grid-template-columns:repeat(4,minmax(0,1fr))}.editor-model{height:470px;min-height:470px}.editor-footer .btn{min-height:34px;font-size:12px}.editor-footer-save{gap:6px}.editor-footer-save .btn{min-width:74px}.editor-upload{width:100%;justify-content:flex-start!important}.file-tools{grid-template-columns:1fr 1fr}.file-tools .btn:last-child{grid-column:1 / -1}}
@media(max-height:620px) and (max-width:980px){.editor-header{padding:8px 16px}.editor-header h2{font-size:18px}.editor-header>div{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.editor-header p{font-size:11px;margin:0}.editor-footer{padding:7px 16px;gap:4px 8px}.editor-footer .btn{min-height:30px;font-size:11px}.editor-footer-save .btn{min-width:86px}.editor-operation-status{font-size:10px}.editor-content{padding-bottom:10px}.editor-model{height:clamp(224px,calc(100dvh - 172px),450px);min-height:224px}.editor-preview{min-height:120px}.editor-tool{min-height:42px;gap:3px;font-size:10px}.editor-tool svg{width:18px;height:18px}.editor-tool-rail{gap:5px}.editor-controls{padding:6px 8px;margin-top:6px}.editor-view-controls{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:8px}.view-tools{margin:0;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.view-tools .btn{min-height:28px;font-size:10px}.view-tools svg{display:none}.editor-part-controls{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:6px}.editor-part-controls .control-heading{display:contents}.editor-part-controls .control-label{grid-column:1;grid-row:1;white-space:nowrap}.editor-show-all{grid-column:3;grid-row:1;white-space:nowrap;font-size:10px;padding:4px}.part-tools{grid-column:2;grid-row:1;margin:0;gap:4px}.part-tools .btn{font-size:10px;min-height:26px;padding:4px 6px}.editor-empty-parts{grid-column:1 / -1}.preview-camera{top:8px;right:8px;gap:5px}.preview-light{top:8px;left:8px}.preview-camera>.icon-btn,.preview-light{width:28px;height:28px}.preview-zoom .icon-btn{width:26px;height:26px}.editor-pointer-help{font-size:10px;bottom:5px}}
</style>
<style scoped>
.preview-zoom{display:flex;flex-direction:column}
@media(max-width:980px){.editor-tool-rail{max-height:var(--editor-tool-max-height);overflow-y:auto}.editor-model{height:var(--editor-tool-max-height);min-height:var(--editor-tool-max-height);overflow:auto}}
</style>
