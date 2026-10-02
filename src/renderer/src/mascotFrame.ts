// SPDX-License-Identifier: MIT
// Reusable frame state for the header stage; projection and feedback timing are unchanged.
import {type Matrix4,type OrthographicCamera,Vector3} from 'three'
import {type MascotHitRect,type MascotPoint} from '@shared/mascots'

export interface MascotProjectedPoint extends MascotPoint {z:number}
export interface MascotPartFrame {
 readonly points:MascotProjectedPoint[]
 readonly sorted:MascotProjectedPoint[]
 readonly lower:MascotProjectedPoint[]
 readonly upper:MascotProjectedPoint[]
 readonly shape:MascotHitRect&{polygon:MascotProjectedPoint[]}
}
export function createMascotPartFrame(id:string,part:string,count=8):MascotPartFrame{
 const points=Array.from({length:count},()=>({x:0,y:0,z:0}))
 return{points,sorted:[...points],lower:[...points],upper:[...points],shape:{id,part,left:0,right:0,top:0,bottom:0,depth:0,polygon:[]}}
}
const cross=(a:MascotPoint,b:MascotPoint,c:MascotPoint)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)
/** Stable insertion order matches the allocating hull, including equal projected corners. */
function updateHull(frame:MascotPartFrame){
 const {points,sorted,lower,upper,shape}=frame,count=points.length
 for(let i=0;i<count;i++){
  const point=points[i];let j=i
  while(j>0&&(sorted[j-1].x>point.x||(sorted[j-1].x===point.x&&sorted[j-1].y>point.y))){sorted[j]=sorted[j-1];j--}
  sorted[j]=point
 }
 const polygon=shape.polygon
 if(count<3){for(let i=0;i<count;i++)polygon[i]=sorted[i];polygon.length=count;return}
 let lowerCount=0,upperCount=0
 for(let i=0;i<count;i++){
  const point=sorted[i]
  while(lowerCount>1&&cross(lower[lowerCount-2],lower[lowerCount-1],point)<=0)lowerCount--
  lower[lowerCount++]=point
 }
 for(let i=count-1;i>=0;i--){
  const point=sorted[i]
  while(upperCount>1&&cross(upper[upperCount-2],upper[upperCount-1],point)<=0)upperCount--
  upper[upperCount++]=point
 }
 let output=0
 for(let i=0;i<lowerCount-1;i++)polygon[output++]=lower[i]
 for(let i=0;i<upperCount-1;i++)polygon[output++]=upper[i]
 polygon.length=output
}
export function projectMascotPoint(target:MascotProjectedPoint,point:Vector3,camera:OrthographicCamera,width:number,height:number){
 point.project(camera);target.x=(point.x+1)*width/2;target.y=(1-point.y)*height/2;target.z=point.z
 return target
}
/** Eight real world-space corners, with the same camera operations and per-part mean depth. */
export function updateMascotPartFrame(frame:MascotPartFrame,corners:readonly Vector3[],world:Matrix4,camera:OrthographicCamera,width:number,height:number,scratch:Vector3){
 if(corners.length!==frame.points.length)throw new Error('Mascot projection corner count changed')
 let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity,depth=0
 for(let i=0;i<corners.length;i++){
  const point=projectMascotPoint(frame.points[i],scratch.copy(corners[i]).applyMatrix4(world),camera,width,height)
  if(point.x<left)left=point.x;if(point.x>right)right=point.x;if(point.y<top)top=point.y;if(point.y>bottom)bottom=point.y;depth+=point.z
 }
 const shape=frame.shape;shape.left=left;shape.right=right;shape.top=top;shape.bottom=bottom;shape.depth=depth/corners.length
 updateHull(frame)
}

export interface MascotViewportFrame {shape:MascotHitRect&{polygon:MascotProjectedPoint[]};points:MascotProjectedPoint[]}
export function createMascotViewportFrame(source:MascotHitRect,capacity=8):MascotViewportFrame{
 const points=Array.from({length:capacity},()=>({x:0,y:0,z:0}))
 return{points,shape:{id:source.id,part:source.part,left:0,right:0,top:0,bottom:0,depth:0,polygon:[]}}
}
/** The gate consumes these synchronously; geometry is rebased on every real pointer event. */
export function updateMascotViewportFrame(target:MascotViewportFrame,source:MascotHitRect,left:number,top:number){
 const shape=target.shape,polygon=source.polygon??[]
 if(polygon.length>target.points.length)throw new Error('Mascot viewport hull capacity exceeded')
 shape.left=source.left+left;shape.right=source.right+left;shape.top=source.top+top;shape.bottom=source.bottom+top;shape.depth=source.depth
 for(let i=0;i<polygon.length;i++){
  const point=target.points[i],original=polygon[i] as MascotProjectedPoint;point.x=original.x+left;point.y=original.y+top;point.z=original.z
  shape.polygon[i]=point
 }
 shape.polygon.length=polygon.length
 return shape
}

export interface MascotPalmTiming {start:number;contact:number}
export function appendMascotPalmTiming(queue:MascotPalmTiming[],timing:MascotPalmTiming){
 queue.push(timing);if(queue.length>24){queue.copyWithin(0,queue.length-24);queue.length=24}
}
export interface MascotFeedbackFrame {
 readonly active:Array<MascotPalmTiming|undefined>
 readonly prints:Array<MascotPalmTiming|undefined>
 readonly contacts:number[]
 lastLandedContact:number|undefined
 contactsChanged:boolean
}
export function createMascotFeedbackFrame():MascotFeedbackFrame{
 return{active:new Array<MascotPalmTiming|undefined>(4).fill(undefined),prints:new Array<MascotPalmTiming|undefined>(4).fill(undefined),contacts:[],lastLandedContact:undefined,contactsChanged:false}
}
/** Retain original queue order, first four active palms and last four landed prints. */
export function updateMascotFeedbackFrame(frame:MascotFeedbackFrame,queue:MascotPalmTiming[],now:number,palmMs:number,printMs:number){
 let live=0,active=0,landed=0,changed=false
 const oldCount=frame.contacts.length
 frame.active.fill(undefined);frame.prints.fill(undefined);frame.lastLandedContact=undefined
 for(let i=0;i<queue.length;i++){
  const timing=queue[i]
  if(now-timing.contact>=printMs)continue
  queue[live]=timing;if(frame.contacts[live]!==timing.contact)changed=true;frame.contacts[live++]=timing.contact
  if(now>=timing.start&&now-timing.start<palmMs&&active<4)frame.active[active++]=timing
  if(timing.contact<=now){
   frame.lastLandedContact=timing.contact
   if(landed<4)frame.prints[landed]=timing
   else{frame.prints[0]=frame.prints[1];frame.prints[1]=frame.prints[2];frame.prints[2]=frame.prints[3];frame.prints[3]=timing}
   landed++
  }
 }
 queue.length=live;frame.contacts.length=live;frame.contactsChanged=changed||oldCount!==live
 return frame
}

/** Compare raw numbers before formatting, so resting elements incur no repeated DOM write. */
export class MascotDomCache {
 private readonly styles:Record<string,string|number>=Object.create(null)
 private readonly suffixes:Record<string,string>=Object.create(null)
 private readonly attributes:Record<string,string|number>=Object.create(null)
 constructor(readonly element:HTMLElement|null){}
 style(property:string,value:string|number,suffix=''){
  if(!this.element||(this.styles[property]===value&&this.suffixes[property]===suffix))return
  this.styles[property]=value;this.suffixes[property]=suffix;this.element.style.setProperty(property,String(value)+suffix)
 }
 data(property:string,value:string|number){
  if(!this.element||this.attributes[property]===value)return
  this.attributes[property]=value;this.element.dataset[property]=String(value)
 }
}
