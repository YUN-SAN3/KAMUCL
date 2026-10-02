export const MASCOTS=[{id:'q3',name:'q3'},{id:'qiqi',name:'qiqi'},{id:'biyuehu',name:'碧月狐'},{id:'hongshu',name:'红叔'},{id:'kamu',name:'卡慕'},{id:'milo',name:'米洛'},{id:'muchuanbei',name:'幕川北'}] as const
export interface MascotSound { muted:boolean; volume:number }
export const DEFAULT_MASCOT_SOUND:Readonly<MascotSound>={muted:false,volume:.45}
export interface MascotState {counts:Record<string,number>;order:string[];sound?:MascotSound}
export interface MascotBatch {batchId:string;hits:string[];tieOrder?:string[]}
export interface MascotPoint {x:number;y:number}
export interface MascotHitRect {id:string;left:number;top:number;right:number;bottom:number;polygon?:MascotPoint[];part?:string;depth?:number}
/** Convex screen silhouette of one visible block part, independent of its pose. */
export function mascotHull(points:readonly MascotPoint[]):MascotPoint[]{
 const sorted=[...points].sort((a,b)=>a.x-b.x||a.y-b.y),cross=(a:MascotPoint,b:MascotPoint,c:MascotPoint)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)
 const half=(list:MascotPoint[])=>{const out:MascotPoint[]=[];for(const point of list){while(out.length>1&&cross(out[out.length-2],out[out.length-1],point)<=0)out.pop();out.push(point)}return out}
 if(sorted.length<3)return sorted
 const lower=half(sorted),upper=half([...sorted].reverse());lower.pop();upper.pop();return [...lower,...upper]
}
export function mascotShapeContains(shape:MascotHitRect,x:number,y:number):boolean {
 if(x<shape.left||x>shape.right||y<shape.top||y>shape.bottom)return false
 if(!shape.polygon?.length)return true
 let sign=0;const points=shape.polygon
 for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],cross=(b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x);if(Math.abs(cross)<1e-7)continue;const next=Math.sign(cross);if(sign&&sign!==next)return false;sign=next}
 return true
}
/** Only the nearest visible person's parts occupy a point. A covered person's
 * silhouette is not occupied until the pointer reaches its exposed pixels. */
export function mascotVisibleOccupants(shapes:readonly MascotHitRect[],x:number,y:number):Set<string>{
 const depths=new Map<string,number>()
 for(const shape of shapes)if(mascotShapeContains(shape,x,y))depths.set(shape.id,Math.min(depths.get(shape.id)??Infinity,shape.depth??0))
 const nearest=Math.min(...depths.values())
 // Equal-depth shapes remain co-visible, matching interval occlusion below.
 return new Set([...depths].filter(([,depth])=>depth===nearest).map(([id])=>id))
}
/** Time-based easing and a travelled-distance step phase; exact settled positions. */
export function mascotWalkFrame(from:number,to:number,elapsed:number,duration:number){
 const progress=duration<=0?1:Math.min(1,Math.max(0,elapsed/duration)),ease=progress*progress*(3-2*progress),position=from+(to-from)*ease
 return {position,progress,travelled:Math.abs(position-from),direction:Math.sign(to-from),walking:progress<1&&from!==to}
}
export function normalizeMascotSound(value?:Partial<MascotSound>):MascotSound {
 return {muted:value?.muted===true,volume:typeof value?.volume==='number'&&Number.isFinite(value.volume)?Math.min(1,Math.max(0,value.volume)):DEFAULT_MASCOT_SOUND.volume}
}
export function addMascotHits(state:MascotState,hits:readonly string[]):MascotState {
 const next={...state,counts:{...state.counts},order:[...state.order]}
 for(const id of hits){if(!MASCOTS.some(m=>m.id===id))throw new Error('人物标识无效');next.counts[id]=Math.min(Number.MAX_SAFE_INTEGER,(next.counts[id]||0)+1)}
 next.order=sortMascots(next)
 return next
}
export function sortMascots(state:MascotState):string[]{return [...state.order].sort((a,b)=>(state.counts[b]||0)-(state.counts[a]||0))}
/** Detects every zone crossed, even when a mouse event skips multiple characters.
 * Geometry changes alone never enter a zone: each test uses actual pointer travel. */
export class MascotSweepGate {
 private previous?:{x:number;y:number};private occupied=new Set<string>()
 move(x:number,y:number,rects:readonly MascotHitRect[]):string[]{
  if(!Number.isFinite(x)||!Number.isFinite(y))return []
  const from=this.previous;this.previous={x,y}
  if(from&&from.x===x&&from.y===y)return []
  const inside=mascotShapeContains,hits=new Map<string,number>()
  const occupied=mascotVisibleOccupants(rects,from?.x??x,from?.y??y)
  const intervals=new Map<MascotHitRect,[number,number]|undefined>()
  const computeInterval=(r:MascotHitRect):[number,number]|undefined=>{
   const points=r.polygon?.length?r.polygon:[{x:r.left,y:r.top},{x:r.right,y:r.top},{x:r.right,y:r.bottom},{x:r.left,y:r.bottom}]
   if(!from)return inside(r,x,y)?[0,0]:undefined
   let start=0,end=1;const area=points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.y-b.x*a.y},0),orientation=area<0?-1:1
   for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],d0=orientation*((b.x-a.x)*(from.y-a.y)-(b.y-a.y)*(from.x-a.x)),d1=orientation*((b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x)),delta=d1-d0
    if(Math.abs(delta)<1e-9){if(d0<0)return;continue}
    const t=-d0/delta;if(delta>0)start=Math.max(start,t);else end=Math.min(end,t);if(start>end)return
   }
   return end>=0&&start<=1?[Math.max(0,start),Math.min(1,end)]:undefined
  }
  const interval=(r:MascotHitRect)=>{if(!intervals.has(r))intervals.set(r,computeInterval(r));return intervals.get(r)}
  for(const r of rects){
   if(!from&&this.occupied.has(r.id)||from&&occupied.has(r.id))continue
   // Rebase the occupied set to current positions after a layout/sort animation.
   // A person walking under the pointer is already occupied, never a fresh entry.
   const range=interval(r);if(!range)continue
   let spans=[range]
   // During a passing manoeuvre, covered pixels of a farther person cannot hit.
   for(const occluder of rects){if(occluder.id===r.id||(occluder.depth??0)>=(r.depth??0)||occluder.right<r.left||occluder.left>r.right||occluder.bottom<r.top||occluder.top>r.bottom)continue;const cover=interval(occluder);if(!cover)continue
    spans=spans.flatMap(([a,b])=>cover[1]<a||cover[0]>b?[[a,b] as [number,number]]:[...(cover[0]>a?[[a,cover[0]-1e-7] as [number,number]]:[]),...(cover[1]<b?[[cover[1]+1e-7,b] as [number,number]]:[])])
   }
   const entry=spans[0]?.[0];if(entry!==undefined)hits.set(r.id,Math.min(hits.get(r.id)??Infinity,entry))
  }
  this.occupied=mascotVisibleOccupants(rects,x,y)
  return [...hits].sort((a,b)=>a[1]-b[1]).map(([id])=>id)
 }
 reset(){this.previous=undefined;this.occupied.clear()}
}
/** Retained for compatibility with the previous public hover helper. */
export class MascotHoverGate {
  private x=NaN;private y=NaN;private target=''
  move(x:number,y:number,target:string,moving:boolean):string|undefined {
    if(x===this.x&&y===this.y)return
    this.x=x;this.y=y
    const previous=this.target;this.target=target
    if(!moving&&target&&target!==previous)return target
  }
  reset(){this.target='';this.x=this.y=NaN}
}
