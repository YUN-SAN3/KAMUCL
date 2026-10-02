import { computed, ref, shallowRef, watch } from 'vue'
import { store, toast } from './store'
import type { Settings } from '@shared/types'
import { emptyDesign, cleanDesign, resolveComponentDesign, type ComponentDesign, type VisualDesign } from '@shared/visualDesign'
type Appearance=Pick<Settings,'theme'|'custom'|'background'|'launchThumbnail'|'homeLayout'|'visualDesign'>
export interface DesignTarget { key:string; scope:string; label:string; tag:string; depth:number; element:HTMLElement; parentKey?:string; text:boolean; container:boolean; sortable:boolean; decoration:boolean }
export const designTargets=shallowRef<DesignTarget[]>([])
export const designSelection=ref('')
export const designScope=ref('home')
export const designHistory=ref<Appearance[]>([]),designFuture=ref<Appearance[]>([])
export const designDraft=ref<Appearance|null>(null),designStageReady=ref(false),designSaveState=ref(''),designRecovered=ref(false)
export const appearancePreview=computed(()=>store.editMode&&designDraft.value?{...store.settings,...designDraft.value} as Settings:store.settings)
export const currentDesign=computed(()=>appearancePreview.value?.visualDesign||emptyDesign())
export const designSelected=computed(()=>designTargets.value.find(t=>t.scope+'|'+t.key===designSelection.value))
export const selectedDesign=computed(()=>{const t=designSelected.value;return t?resolveComponentDesign(currentDesign.value.pages[t.scope]?.components,t.key)||{}:{}})
const appearance=(s:Settings):Appearance=>JSON.parse(JSON.stringify({theme:s.theme,custom:s.custom,background:s.background,launchThumbnail:s.launchThumbnail,homeLayout:s.homeLayout,visualDesign:cleanDesign(s.visualDesign)}))
const copy=()=>JSON.parse(JSON.stringify(designDraft.value||appearance(store.settings!))) as Appearance
let refresh=()=>{},saveTimer:ReturnType<typeof setTimeout>|undefined,saveQueue:Promise<unknown>=Promise.resolve(),baseline=''
export const designDirty=computed(()=>!!designDraft.value&&JSON.stringify(designDraft.value)!==baseline)
export async function beginDesign(){
 const base=appearance(store.settings!);baseline=JSON.stringify(base);designDraft.value=base;designHistory.value=[];designFuture.value=[];designSelection.value='';designRecovered.value=false;designSaveState.value=''
 try{const saved=await window.kamucl.invoke('appearance:draftRead') as Appearance|null;if(saved&&store.editMode){designDraft.value=saved;designRecovered.value=JSON.stringify(saved)!==baseline}}catch{designSaveState.value='草稿读取失败'}
 refresh()
}
export function checkpoint(){designHistory.value.push(copy());if(designHistory.value.length>50)designHistory.value.shift();designFuture.value=[]}
export async function flushDesign(){
 clearTimeout(saveTimer);saveTimer=undefined;if(!designDraft.value)return
 const snapshot=copy();designSaveState.value='正在保存草稿…'
 const work=saveQueue.catch(()=>{}).then(()=>window.kamucl.invoke('appearance:draftSave',snapshot));saveQueue=work
 try{await work;designSaveState.value='草稿已保存'}catch(e){designSaveState.value='草稿保存失败，请重试';throw e}
}
function scheduleSave(){clearTimeout(saveTimer);designSaveState.value='有未应用的修改';saveTimer=setTimeout(()=>void flushDesign().catch(()=>{}),400)}
function persist(design:VisualDesign){if(!designDraft.value)return;designDraft.value.visualDesign=cleanDesign(design);scheduleSave();refresh()}
export function previewAppearance(value:Partial<Settings>){checkpoint();designDraft.value=appearance({...appearancePreview.value!,...value});scheduleSave();refresh()}
export async function finishDesign(action:'apply'|'keep'|'discard'){
 clearTimeout(saveTimer);await saveQueue.catch(()=>{})
 if(action==='apply'){await flushDesign();store.settings=await window.kamucl.invoke('appearance:draftApply',copy()) as Settings}
 else if(action==='keep')await flushDesign()
 else await window.kamucl.invoke('appearance:draftDiscard')
 designDraft.value=null;designRecovered.value=false;refresh()
}
export function changeComponent(patch:Partial<ComponentDesign>,record=true){const t=designSelected.value;if(!t||!designDraft.value)return;if(record)checkpoint();const d=JSON.parse(JSON.stringify(currentDesign.value)) as VisualDesign;const page=d.pages[t.scope]??={width:window.innerWidth,height:window.innerHeight,components:{}};page.components[t.key]={...page.components[t.key],...patch};persist(d)}
export function resetComponent(){const t=designSelected.value;if(!t)return;checkpoint();const d=JSON.parse(JSON.stringify(currentDesign.value));if(d.pages[t.scope])delete d.pages[t.scope].components[t.key];persist(d)}
export function resetPage(all=false){checkpoint();const d=JSON.parse(JSON.stringify(currentDesign.value));if(all)d.pages={};else delete d.pages[designScope.value];persist(d)}
export function undoDesign(redo=false){const from=redo?designFuture:designHistory,to=redo?designHistory:designFuture;const d=from.value.pop();if(!d)return;to.value.push(copy());designDraft.value=d;scheduleSave();refresh()}
export function reorderComponent(target:DesignTarget,before:boolean){
 const selected=designSelected.value;if(!selected||selected.element.parentElement!==target.element.parentElement||!selected.sortable)return
 const siblings=designTargets.value.filter(t=>t.element.parentElement===selected.element.parentElement&&!t.decoration).sort((a,b)=>(currentDesign.value.pages[a.scope]?.components[a.key]?.order??0)-(currentDesign.value.pages[b.scope]?.components[b.key]?.order??0))
 const from=siblings.indexOf(selected);if(from<0)return;siblings.splice(from,1);const i=siblings.indexOf(target);siblings.splice(i+(before?0:1),0,selected)
 checkpoint();const d=JSON.parse(JSON.stringify(currentDesign.value)) as VisualDesign
 siblings.forEach((t,index)=>{const p=d.pages[t.scope]??={width:window.innerWidth,height:window.innerHeight,components:{}};p.components[t.key]={...p.components[t.key],order:index,mode:'flow',x:undefined,y:undefined}});persist(d)
}
export function installVisualDesign(){
 let frame=0
 const originals=new Map<HTMLElement,{styles:Map<string,string>;text:Map<Text,string>}>()
 const original=(el:HTMLElement)=>{let o=originals.get(el);if(!o){o={styles:new Map(),text:new Map()};originals.set(el,o)}return o}
 function set(el:HTMLElement,key:string,value:string){const o=original(el);if(!o.styles.has(key))o.styles.set(key,el.style.getPropertyValue(key));if(el.style.getPropertyValue(key)!==value)el.style.setProperty(key,value,'important')}
 function restore(){for(const [el,o]of originals){for(const[k,v]of o.styles){if(v)el.style.setProperty(k,v);else el.style.removeProperty(k)}for(const[n,v]of o.text)if(n.isConnected&&n.nodeValue!==v)n.nodeValue=v}originals.clear()}
 const update=()=>{
  frame=0
  const suffix=Array.from(document.querySelectorAll<HTMLElement>('.content [data-design-page]')).filter(e=>e.getClientRects().length).map(e=>e.dataset.designPage).join('/')
  designScope.value=store.currentView+(suffix?'/'+suffix:'')
  const d=currentDesign.value
  if(!store.editMode&&!Object.keys(d.pages).length){restore();designTargets.value=[];return}
  // Restore only when an override is removed; keep original values independent of our previous write.
  for(const[el,o]of originals)if(!el.isConnected)originals.delete(el)
  const targets:DesignTarget[]=[],counts=new Map<string,number>(),seen=new Set<HTMLElement>(),elementKeys=new Map<HTMLElement,string>()
  for(const el of document.querySelectorAll<HTMLElement>('[data-ui]')){
   if(el.closest('[data-design-tools]')||el.closest('.edit-tip')||el.classList.contains('app-bg'))continue
   const content=el.closest('.content')
   const scope=el.closest('.sidebar, .topbar') || el.classList.contains('shell') ? 'global' : designScope.value
   const ancestors:string[]=[];let parent:HTMLElement|null=el
   while(parent){if(parent.dataset.ui)ancestors.unshift(parent.dataset.ui);parent=parent.parentElement}
   let key=ancestors.join('/');const duplicate=counts.get(key)||0;counts.set(key,duplicate+1);key+='~'+duplicate
   elementKeys.set(el,key)
   const text=Array.from(el.childNodes).some(n=>n.nodeType===Node.TEXT_NODE&&(n.textContent?.trim()||originals.get(el)?.text.has(n as Text))),tag=el.tagName.toLowerCase()
   const named:Array<[string,string]>=[['.shell','启动器窗口'],['.sidebar','侧栏'],['.topbar','顶栏'],['.content','页面'],['.hero','游戏封面'],['.hero-content','封面信息'],['.home-layout','首页布局'],['.home-main','首页主区'],['.home-side','首页侧区'],['.instance-card','游戏实例卡片'],['.theme-option','主题卡片'],['.launch-btn,.launch-main','启动按钮']];const semantic=named.find(([selector])=>el.matches(selector))?.[1]
   let decoration=!!el.closest('.theme-preview,.fm-file-icon,.nav-bubble,svg,.nav-icon')||(!text&&!el.children.length&&!['input','textarea','img','button','select'].includes(tag))
   const kind=el.matches('button')?'按钮':el.matches('input,select,textarea')?'输入控件':el.matches('.card,article,section')?'卡片':el.matches('h1,h2,h3,h4')?'标题':text?'文字':el.matches('.sidebar')?'侧栏':el.matches('.topbar')?'顶栏':'容器'
   if(!semantic&&!text&&!el.matches('button,input,select,textarea,img,.card,article,section,[role]'))decoration=true
   const labelText=(semantic||el.getAttribute('aria-label')||el.getAttribute('title')||(text?Array.from(el.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join(''):el.matches('button')?el.textContent:el.querySelector('h1,h2,h3,h4,strong')?.textContent)||'').trim().replace(/\s+/g,' ').slice(0,34)
   const parentEl=el.parentElement?.closest<HTMLElement>('[data-ui]')
   targets.push({key,scope,label:semantic|| (labelText?kind+' · '+labelText:kind),tag,depth:ancestors.length,element:el,parentKey:parentEl?elementKeys.get(parentEl):undefined,text,container:el.children.length>0&&!['button','label'].includes(tag),sortable:!!el.parentElement&&['flex','inline-flex','grid','inline-grid'].includes(getComputedStyle(el.parentElement).display),decoration})
   const style=resolveComponentDesign(d.pages[scope]?.components,key)
   const o=originals.get(el)
   if(!style){if(o){for(const[k,v]of o.styles){if(v)el.style.setProperty(k,v);else el.style.removeProperty(k)}for(const[n,v]of o.text)if(n.isConnected)n.nodeValue=v;originals.delete(el)}continue}
   seen.add(el)
   // Pixel geometry is retained at the original window size; CSS layout continues adapting around it.
   const properties:Record<string,string>={}
   if(style.mode==='free'){properties.position='relative';properties.translate=`${style.x||0}px ${style.y||0}px`;properties['z-index']=String(style.layer??0)}
   else if(style.layer!==undefined){properties.position='relative';properties['z-index']=String(style.layer)}
   if(style.width!==undefined){properties.width=style.width+'px';properties['max-width']='100%';properties['flex-shrink']='0';if(getComputedStyle(el).display==='inline')properties.display='inline-block'}
   if(style.height!==undefined){properties.height=style.height+'px';properties['min-height']=style.height+'px'}
   if(style.color)properties.color=style.color
   if(style.background)properties.background=style.background
   if(style.opacity!==undefined)properties.opacity=String(style.opacity)
   if(style.radius!==undefined)properties['border-radius']=style.radius+'px'
   if(style.blur!==undefined)properties['backdrop-filter']=`blur(${style.blur}px)`
   if(style.fontSize!==undefined)properties['font-size']=style.fontSize+'px'
   if(style.fontFamily)properties['font-family']=style.fontFamily
   if(style.fontWeight!==undefined)properties['font-weight']=String(style.fontWeight)
   if(style.gap!==undefined)properties.gap=style.gap+'px'
   if(style.padding!==undefined)properties.padding=style.padding+'px'
   if(style.hidden){if(store.editMode){properties.opacity='0.25';properties.outline='1px dashed #ff9e52'}else properties.display='none'}
   if(style.order!==undefined&&el.parentElement&&['flex','inline-flex','grid','inline-grid'].includes(getComputedStyle(el.parentElement).display))properties.order=String(style.order)
   if(o)for(const[k,v]of o.styles)if(!(k in properties)){if(v)el.style.setProperty(k,v);else el.style.removeProperty(k);o.styles.delete(k)}
   for(const[k,v]of Object.entries(properties))set(el,k,v)
   const texts=Array.from(el.childNodes).filter(n=>n.nodeType===Node.TEXT_NODE&&(n.textContent?.trim()||o?.text.has(n as Text))) as Text[]
   if(style.text!==undefined&&texts.length){const base=original(el);texts.forEach((n,i)=>{if(!base.text.has(n))base.text.set(n,n.nodeValue||'');const value=i===0?style.text!:'';if(n.nodeValue!==value)n.nodeValue=value})}
   else if(o?.text.size){for(const[n,v]of o.text)if(n.isConnected)n.nodeValue=v;o.text.clear()}
  }
  for(const t of targets){let p=targets.find(x=>x.key===t.parentKey);while(p?.decoration)p=targets.find(x=>x.key===p!.parentKey);t.parentKey=p?.key;t.depth=(p?.depth||0)+1}
  designTargets.value=targets
 }
 refresh=()=>{if(!frame)frame=requestAnimationFrame(update)}
 const observer=new MutationObserver(records=>{if(records.every(r=>(r.target instanceof Element?r.target:r.target.parentElement)?.closest('[data-design-tools]')))return;refresh()})
 observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-design-page']})
 const stop=watch(()=>[store.currentView,store.editMode,currentDesign.value],refresh,{deep:true})
 window.addEventListener('resize',refresh);refresh()
 return()=>{stop();observer.disconnect();cancelAnimationFrame(frame);restore();window.removeEventListener('resize',refresh)}
}
