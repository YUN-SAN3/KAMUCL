// SPDX-License-Identifier: MIT
// Stage-only software fallback: the attributed rigs, world geometry and skin UVs
// are unchanged. Matte diffuse lighting approximates the original rough skin;
// this intentionally does not claim equivalence to the Standard/PBR specular BRDF.
import {BackSide,DoubleSide,FrontSide,Matrix4,type BufferGeometry,type Mesh,type MeshStandardMaterial,type OrthographicCamera,type Texture} from 'three'

export interface MascotRasterTexture {
 width:number
 height:number
 data:Uint8Array|Uint8ClampedArray
 flipY:boolean
}
export interface MascotRasterTarget {
 width:number
 height:number
 rgba:Uint8ClampedArray
 depth:Float32Array
}
export interface MascotRasterInput {
 positions:ArrayLike<number>
 normals:ArrayLike<number>
 uvs:ArrayLike<number>
 indices:ArrayLike<number>
 /** Column-major world-to-clip matrix; mascot batches already contain world coordinates. */
 projection:ArrayLike<number>
 texture:MascotRasterTexture
 color?:ArrayLike<number>
 opacity?:number
 alphaTest?:number
 side?:number
}

const SRGB_TO_LINEAR=Float64Array.from({length:256},(_,i)=>{
 const c=i/255;return c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4)
})
const LINEAR_TO_SRGB=Uint8ClampedArray.from({length:4097},(_,i)=>{
 const c=i/4096;return Math.round(255*(c<=.0031308?12.92*c:1.055*Math.pow(c,1/2.4)-.055))
})
const LIGHT_LENGTH=Math.hypot(-40,80,70),LX=-40/LIGHT_LENGTH,LY=80/LIGHT_LENGTH,LZ=70/LIGHT_LENGTH
const srgb=(linear:number)=>LINEAR_TO_SRGB[Math.max(0,Math.min(4096,Math.round(linear*4096)))]

/** Reused per-vertex storage; translucent fragment storage grows only if needed. */
export class MascotRasterScratch {
 projected=new Float64Array(0)
 heads=new Int32Array(0)
 fragmentDepth=new Float32Array(0)
 fragmentColors=new Float32Array(0)
 fragmentNext=new Int32Array(0)
 fragmentCount=0
 ensureVertices(count:number){if(this.projected.length<count*4)this.projected=new Float64Array(count*4)}
 ensurePixels(count:number){if(this.heads.length!==count)this.heads=new Int32Array(count);this.heads.fill(-1);this.fragmentCount=0}
 addFragment(pixel:number,depth:number,r:number,g:number,b:number,alpha:number){
  const node=this.fragmentCount++
  if(node>=this.fragmentDepth.length){
   const capacity=Math.max(128,this.fragmentDepth.length*2)
   const depths=new Float32Array(capacity),colors=new Float32Array(capacity*4),next=new Int32Array(capacity)
   depths.set(this.fragmentDepth);colors.set(this.fragmentColors);next.set(this.fragmentNext)
   this.fragmentDepth=depths;this.fragmentColors=colors;this.fragmentNext=next
  }
  this.fragmentDepth[node]=depth;const c=node*4
  this.fragmentColors[c]=r;this.fragmentColors[c+1]=g;this.fragmentColors[c+2]=b;this.fragmentColors[c+3]=alpha
  // Sort actual per-pixel depths far-to-near, never whole-triangle average depth.
  let previous=-1,current=this.heads[pixel]
  while(current!==-1&&this.fragmentDepth[current]>depth){previous=current;current=this.fragmentNext[current]}
  this.fragmentNext[node]=current
  if(previous===-1)this.heads[pixel]=node;else this.fragmentNext[previous]=node
 }
 dispose(){this.projected=new Float64Array(0);this.heads=new Int32Array(0);this.fragmentDepth=new Float32Array(0);this.fragmentColors=new Float32Array(0);this.fragmentNext=new Int32Array(0);this.fragmentCount=0}
}

/** Orthographic triangle rasterization with winding cull, nearest skin texels and a z-buffer. */
export function rasterizeMascotFrame(input:MascotRasterInput,target:MascotRasterTarget,scratch:MascotRasterScratch):number {
 const {positions,normals,uvs,indices,projection:m,texture}=input,{width,height,rgba,depth}=target
 if(width<=0||height<=0)return 0
 if(rgba.length!==width*height*4||depth.length!==width*height)throw new Error('Mascot raster target size mismatch')
 if(texture.width<=0||texture.height<=0||texture.data.length!==texture.width*texture.height*4)throw new Error('Mascot atlas RGBA size mismatch')
 const count=positions.length/3
 if(!Number.isInteger(count)||normals.length!==positions.length||uvs.length!==count*2||m.length!==16)throw new Error('Mascot raster geometry mismatch')
 scratch.ensureVertices(count);scratch.ensurePixels(width*height)
 rgba.fill(0);depth.fill(Infinity)
 const p=scratch.projected,color=input.color,cr=color?.[0]??1,cg=color?.[1]??1,cb=color?.[2]??1
 const opacity=Math.max(0,Math.min(1,input.opacity??1)),alphaTest=input.alphaTest??0,side=input.side??FrontSide
 for(let i=0;i<count;i++){
  const v=i*3,k=i*4,x=positions[v],y=positions[v+1],z=positions[v+2],w=m[3]*x+m[7]*y+m[11]*z+m[15]
  p[k]=((m[0]*x+m[4]*y+m[8]*z+m[12])/w*.5+.5)*width
  p[k+1]=(-(m[1]*x+m[5]*y+m[9]*z+m[13])/w*.5+.5)*height
  p[k+2]=(m[2]*x+m[6]*y+m[10]*z+m[14])/w*.5+.5
  const nx=normals[v],ny=normals[v+1],nz=normals[v+2],length=Math.hypot(nx,ny,nz)
  p[k+3]=length?(nx*LX+ny*LY+nz*LZ)/length:0
 }
 let visibleTriangles=0
 for(let t=0;t+2<indices.length;t+=3){
  let a=indices[t],b=indices[t+1],c=indices[t+2]
  const ak=a*4,bk=b*4,ck=c*4
  let ax=p[ak],ay=p[ak+1],bx=p[bk],by=p[bk+1],cx=p[ck],cy=p[ck+1]
  const signed=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax)
  if(!Number.isFinite(signed)||Math.abs(signed)<1e-10||(side===FrontSide&&signed>=0)||(side===BackSide&&signed<=0))continue
  const front=signed<0
  if(front){const swap=b;b=c;c=swap;bx=p[b*4];by=p[b*4+1];cx=p[c*4];cy=p[c*4+1]}
  const area=Math.abs(signed),invArea=1/area
  const minX=Math.max(0,Math.ceil(Math.min(ax,bx,cx)-.5)),maxX=Math.min(width-1,Math.floor(Math.max(ax,bx,cx)-.5))
  const minY=Math.max(0,Math.ceil(Math.min(ay,by,cy)-.5)),maxY=Math.min(height-1,Math.floor(Math.max(ay,by,cy)-.5))
  if(minX>maxX||minY>maxY)continue
  visibleTriangles++
  const az=p[a*4+2],bz=p[b*4+2],cz=p[c*4+2],na=p[a*4+3],nb=p[b*4+3],nc=p[c*4+3]
  const au=uvs[a*2],av=uvs[a*2+1],bu=uvs[b*2],bv=uvs[b*2+1],cu=uvs[c*2],cv=uvs[c*2+1]
  // Edge equations are incremented across scanlines, without per-pixel objects.
  const e0x=by-cy,e0y=cx-bx,e1x=cy-ay,e1y=ax-cx,e2x=ay-by,e2y=bx-ax
  const top0=cy<by||(cy===by&&cx>bx),top1=ay<cy||(ay===cy&&ax>cx),top2=by<ay||(by===ay&&bx>ax)
  const px=minX+.5,py=minY+.5
  let row0=e0x*(px-bx)+e0y*(py-by),row1=e1x*(px-cx)+e1y*(py-cy),row2=e2x*(px-ax)+e2y*(py-ay)
  for(let y=minY;y<=maxY;y++,row0+=e0y,row1+=e1y,row2+=e2y){
   let e0=row0,e1=row1,e2=row2,pixel=y*width+minX
   for(let x=minX;x<=maxX;x++,pixel++,e0+=e0x,e1+=e1x,e2+=e2x){
    if(e0<0||e1<0||e2<0||(e0===0&&!top0)||(e1===0&&!top1)||(e2===0&&!top2))continue
    const w0=e0*invArea,w1=e1*invArea,w2=e2*invArea,z=w0*az+w1*bz+w2*cz
    if(z<0||z>1||z>=depth[pixel])continue
    const u=w0*au+w1*bu+w2*cu,v=w0*av+w1*bv+w2*cv
    const tx=Math.min(texture.width-1,Math.max(0,Math.floor(u*texture.width))),sampleY=Math.min(texture.height-1,Math.max(0,Math.floor(v*texture.height))),ty=texture.flipY?texture.height-1-sampleY:sampleY
    const texel=(ty*texture.width+tx)*4,alpha=texture.data[texel+3]/255*opacity
    if(alpha===0||alpha<alphaTest)continue
    const dot=(w0*na+w1*nb+w2*nc)*(side===DoubleSide&&!front?-1:1)
    // Original skin is dielectric and very rough. .96 is the diffuse energy;
    // omitted specular makes this a documented matte approximation, not PBR.
    const light=.96*(2.1+1.2*Math.max(0,dot))/Math.PI
    const r=SRGB_TO_LINEAR[texture.data[texel]]*cr*light,g=SRGB_TO_LINEAR[texture.data[texel+1]]*cg*light,blue=SRGB_TO_LINEAR[texture.data[texel+2]]*cb*light
    if(alpha<1){scratch.addFragment(pixel,z,r,g,blue,alpha);continue}
    depth[pixel]=z;const out=pixel*4;rgba[out]=srgb(r);rgba[out+1]=srgb(g);rgba[out+2]=srgb(blue);rgba[out+3]=255
   }
  }
 }
 // Partial alpha uses the same per-pixel depth ordering over the nearest opaque
 // surface. Transparent edge texels never write depth or cover another figure.
 if(scratch.fragmentCount)for(let pixel=0;pixel<scratch.heads.length;pixel++){
  let node=scratch.heads[pixel];if(node===-1)continue
  const out=pixel*4;let alpha=rgba[out+3]/255,r=SRGB_TO_LINEAR[rgba[out]]*alpha,g=SRGB_TO_LINEAR[rgba[out+1]]*alpha,b=SRGB_TO_LINEAR[rgba[out+2]]*alpha
  while(node!==-1){
   if(scratch.fragmentDepth[node]<depth[pixel]){const k=node*4,a=scratch.fragmentColors[k+3],keep=1-a;r=scratch.fragmentColors[k]*a+r*keep;g=scratch.fragmentColors[k+1]*a+g*keep;b=scratch.fragmentColors[k+2]*a+b*keep;alpha=a+alpha*keep}
   node=scratch.fragmentNext[node]
  }
  if(alpha){rgba[out]=srgb(r/alpha);rgba[out+1]=srgb(g/alpha);rgba[out+2]=srgb(b/alpha);rgba[out+3]=Math.round(alpha*255)}
 }
 return visibleTriangles
}

/** Exact raster frames; upload only changed pixels, without compositor readback. */
export class MascotSoftwareRenderer {
 readonly domElement:HTMLCanvasElement
 readonly info={render:{calls:0,triangles:0},uploads:0,frames:0,totalUploads:0,unchangedFrames:0}
 private readonly context:CanvasRenderingContext2D
 private readonly projection=new Matrix4()
 private readonly scratch=new MascotRasterScratch()
 private readonly color=new Float64Array(3)
 private readonly atlases=new Map<Texture,{version:number;texture:MascotRasterTexture}>()
 private target:MascotRasterTarget={width:0,height:0,rgba:new Uint8ClampedArray(0),depth:new Float32Array(0)}
 private image:ImageData|undefined
 private presented:Uint8ClampedArray|undefined
 private disposed=false
 constructor(canvas:HTMLCanvasElement=document.createElement('canvas')){
  this.domElement=canvas
  const context=canvas.getContext('2d',{alpha:true,willReadFrequently:true})
  if(!context)throw new Error('Canvas2D mascot renderer unavailable')
  this.context=context;context.imageSmoothingEnabled=false
 }
 setSize(width:number,height:number,pixelRatio=1){
  if(this.disposed)return
  if(!Number.isFinite(width)||!Number.isFinite(height)||!Number.isFinite(pixelRatio)||width<0||height<0||pixelRatio<=0)throw new Error('Invalid mascot canvas size')
  const w=Math.max(1,Math.round(width*pixelRatio)),h=Math.max(1,Math.round(height*pixelRatio))
  this.domElement.style.width=`${width}px`;this.domElement.style.height=`${height}px`
  if(this.target.width===w&&this.target.height===h)return
  this.domElement.width=w;this.domElement.height=h
  this.image=this.context.createImageData(w,h);this.target={width:w,height:h,rgba:this.image.data,depth:new Float32Array(w*h)};this.presented=undefined
 }
 private readAtlas(map:Texture):MascotRasterTexture{
  const cached=this.atlases.get(map);if(cached?.version===map.version)return cached.texture
  const image=map.image as {width:number;height:number;data?:Uint8Array|Uint8ClampedArray}
  if(!image?.width||!image.height)throw new Error('Mascot atlas missing pixels')
  let data:Uint8Array|Uint8ClampedArray
  if(image.data)data=image.data
  else if(typeof (image as HTMLCanvasElement).getContext==='function'){
   const context=(image as HTMLCanvasElement).getContext('2d',{willReadFrequently:true})
   if(!context)throw new Error('Mascot atlas Canvas2D unavailable')
   data=context.getImageData(0,0,image.width,image.height).data
  }else{
   const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height
   const context=canvas.getContext('2d',{willReadFrequently:true})!
   context.drawImage(image as CanvasImageSource,0,0);data=context.getImageData(0,0,image.width,image.height).data;canvas.width=canvas.height=0
  }
  const texture={width:image.width,height:image.height,data,flipY:map.flipY};this.atlases.set(map,{version:map.version,texture});return texture
 }
 render(mesh:Mesh<BufferGeometry,MeshStandardMaterial>,camera:OrthographicCamera){
  if(this.disposed||!this.image)return
  if(!camera.isOrthographicCamera)throw new Error('Mascot software renderer requires an orthographic camera')
  const geometry=mesh.geometry,position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv'),index=geometry.getIndex(),material=mesh.material
  if(!index||!position||!normal||!uv||!material.map)throw new Error('Mascot software renderer requires the indexed world batch and atlas')
  camera.updateMatrixWorld();this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
  this.color[0]=material.color.r;this.color[1]=material.color.g;this.color[2]=material.color.b
  rasterizeMascotFrame({positions:position.array,normals:normal.array,uvs:uv.array,indices:index.array,projection:this.projection.elements,texture:this.readAtlas(material.map),color:this.color,side:material.side,opacity:material.opacity,alphaTest:material.alphaTest},this.target,this.scratch)
  // Nearest-neighbour pixels can stay identical while a tiny idle pose changes.
  // Re-uploading that identical bitmap needlessly dirties the native canvas layer.
  // Compare every RGBA byte; no pose quantization or animation frame is invented.
  const pixels=this.image.data,previous=this.presented
  let changed=!previous
  if(previous)for(let i=0;i<pixels.length;i++)if(pixels[i]!==previous[i]){changed=true;break}
  if(changed){this.context.putImageData(this.image,0,0);if(previous)previous.set(pixels);else this.presented=new Uint8ClampedArray(pixels);this.info.totalUploads++}
  else this.info.unchangedFrames++
  this.info.render.calls=0;this.info.render.triangles=index.count/3;this.info.uploads=changed?1:0;this.info.frames++
 }
 dispose(){
  if(this.disposed)return;this.disposed=true;this.scratch.dispose();this.atlases.clear();this.image=undefined;this.presented=undefined
  this.target={width:0,height:0,rgba:new Uint8ClampedArray(0),depth:new Float32Array(0)};this.domElement.width=this.domElement.height=0;this.info.render.calls=0;this.info.render.triangles=0;this.info.uploads=0
 }
}
