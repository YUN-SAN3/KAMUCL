import test from 'node:test'
import assert from 'node:assert/strict'
import {BackSide,BufferAttribute,BufferGeometry,DataTexture,DoubleSide,FrontSide,Matrix4,Mesh,MeshStandardMaterial,OrthographicCamera} from 'three'
import {MascotRasterScratch,MascotSoftwareRenderer,rasterizeMascotFrame,type MascotRasterInput,type MascotRasterTarget,type MascotRasterTexture} from '../src/renderer/src/mascotSoftware'
import {MascotBatchRenderer} from '../src/renderer/src/mascotBatch'
import {PreviewPlayer} from '../src/renderer/src/skinModel'

const identity=new Matrix4().elements
function target(width=4,height=4):MascotRasterTarget{return{width,height,rgba:new Uint8ClampedArray(width*height*4),depth:new Float32Array(width*height)}}
function texture(data:number[],width:number,height=1,flipY=true):MascotRasterTexture{return{width,height,data:new Uint8ClampedArray(data),flipY}}
function quad(z=0,u?:number):Pick<MascotRasterInput,'positions'|'normals'|'uvs'|'indices'>{
 return{positions:new Float32Array([-1,-1,z,1,-1,z,1,1,z,-1,1,z]),normals:new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]),uvs:new Float32Array(u===undefined?[0,0,1,0,1,1,0,1]:[u,.5,u,.5,u,.5,u,.5]),indices:new Uint16Array([0,1,2,0,2,3])}
}
function combine(...quads:ReturnType<typeof quad>[]):ReturnType<typeof quad>{
 let vertex=0;const positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices:number[]=[]
 for(const q of quads){positions.push(...Array.from(q.positions));normals.push(...Array.from(q.normals));uvs.push(...Array.from(q.uvs));indices.push(...Array.from(q.indices,i=>i+vertex));vertex+=q.positions.length/3}
 return{positions:new Float32Array(positions),normals:new Float32Array(normals),uvs:new Float32Array(uvs),indices:new Uint16Array(indices)}
}
function pixel(t:MascotRasterTarget,x:number,y:number){return Array.from(t.rgba.subarray((y*t.width+x)*4,(y*t.width+x+1)*4))}
function draw(q:ReturnType<typeof quad>,atlas:MascotRasterTexture,t=target(),more:Partial<MascotRasterInput>={}){
 rasterizeMascotFrame({...q,projection:identity,texture:atlas,...more},t,new MascotRasterScratch());return t
}

test('software rasterizer keeps Minecraft UV flipY and exact nearest-texel boundary orientation',()=>{
 const atlas=texture([255,0,0,255,0,255,0,255,0,0,255,255,255,255,0,255],2,2)
 const t=draw(quad(),atlas)
 assert(pixel(t,0,0)[0]>100&&pixel(t,0,0)[1]===0&&pixel(t,0,0)[2]===0,'top-left skin texel is red')
 assert(pixel(t,3,0)[1]>100&&pixel(t,3,0)[0]===0,'top-right is green')
 assert(pixel(t,0,3)[2]>100&&pixel(t,0,3)[0]===0,'bottom-left is blue')
 assert(pixel(t,3,3)[0]>100&&pixel(t,3,3)[1]>100&&pixel(t,3,3)[2]===0,'bottom-right is yellow')
 const reversed=draw(quad(),{...atlas,flipY:false});assert(pixel(reversed,0,0)[2]>100);assert(pixel(reversed,0,3)[0]>100)
 const edge=quad(0,.25);edge.uvs=new Float32Array([.25,.5,.25,.5,.25,.5,.25,.5])
 assert(pixel(draw(edge,atlas),1,1)[0]>100,'exact v=.5 samples the upper source row after upload flipY, not its opposite')
})

test('software z-buffer resolves crossing surfaces per pixel independently of triangle input order',()=>{
 const sloped=quad(0,.25);sloped.positions=new Float32Array([-1,-1,-.6,1,-1,.6,1,1,.6,-1,1,-.6])
 const flat=quad(0,.75),atlas=texture([255,0,0,255,0,255,0,255],2),first=draw(combine(sloped,flat),atlas,target(8,4)),second=draw(combine(flat,sloped),atlas,target(8,4))
 assert.deepEqual(first.rgba,second.rgba);assert.deepEqual(first.depth,second.depth)
 assert(pixel(first,1,2)[0]>100&&pixel(first,1,2)[1]===0,'red sloped surface is closer on the left')
 assert(pixel(first,6,2)[1]>100&&pixel(first,6,2)[0]===0,'green constant-depth surface is closer on the right')
 assert(first.depth[2*8+1]<first.depth[2*8+6],'depth comes from each fragment, not average triangle depth')
})

test('software rasterizer culls actual projected winding and clips viewport and near/far depths',()=>{
 const atlas=texture([255,255,255,255],1),front=quad(),back={...front,indices:new Uint16Array([2,1,0,3,2,0])}
 const visible=draw(front,atlas);assert.equal(visible.rgba.filter((_,i)=>i%4===3&&visible.rgba[i]===255).length,16,'both triangles tile every pixel without cracks')
 assert(draw(back,atlas).rgba.every(n=>n===0));assert(draw(back,atlas,target(),{side:BackSide}).rgba.some(n=>n>0))
 assert(draw(back,atlas,target(),{side:DoubleSide}).rgba.some(n=>n>0))
 assert(draw(front,atlas,target(),{side:BackSide}).rgba.every(n=>n===0))
 assert(draw(quad(-2),atlas).rgba.every(n=>n===0));assert(draw(quad(2),atlas).rgba.every(n=>n===0))
 const off=quad();off.positions=Float32Array.from(off.positions,(v,i)=>i%3===0?v+4:v);assert(draw(off,atlas).rgba.every(n=>n===0))
})

test('transparent skin texels never occlude a farther figure and partial-alpha diagonal pixels blend once',()=>{
 const atlas=texture([255,0,0,0,0,0,255,255,255,0,0,128],3)
 const far=quad(.5,.5),transparent=quad(-.5,1/6),partial=quad(-.5,5/6)
 const clear=draw(combine(transparent,far),atlas),clearReverse=draw(combine(far,transparent),atlas)
 assert.deepEqual(clear.rgba,clearReverse.rgba);assert(pixel(clear,1,1)[2]>100&&pixel(clear,1,1)[0]===0);assert(Math.abs(clear.depth[5]-.75)<1e-6)
 const a=draw(combine(partial,far),atlas),b=draw(combine(far,partial),atlas)
 assert.deepEqual(a.rgba,b.rgba);assert(pixel(a,1,1)[0]>100&&pixel(a,1,1)[2]>100&&pixel(a,1,1)[3]===255)
 const alone=draw(partial,atlas);for(let y=0;y<4;y++)for(let x=0;x<4;x++)assert.equal(pixel(alone,x,y)[3],128,'shared triangle edge is covered once, never alpha 192')
 const masked=draw(combine(partial,far),atlas,target(),{alphaTest:.6});assert.deepEqual(masked.rgba,clear.rgba)
})

test('partially transparent crossing surfaces sort fragment depth, including three layers in arbitrary order',()=>{
 const atlas=texture([255,0,0,128,0,255,0,128,0,0,255,255],3)
 const red=quad(-.6,1/6),green=quad(-.2,.5),blue=quad(.6,5/6)
 const expected=draw(combine(red,green,blue),atlas)
 for(const order of [[blue,red,green],[green,blue,red],[blue,green,red]])assert.deepEqual(draw(combine(...order),atlas).rgba,expected.rgba)
 const p=pixel(expected,1,1);assert(p[0]>p[1]&&p[1]>=p[2]&&p[2]>0,'nearer red contributes more; green and blue differ by less than one 8-bit step at alpha 128/255');assert.equal(p[3],255)
})

test('software rasterizer applies material linear color and lighting without allocating per-frame vertex/depth buffers',()=>{
 const t=target(),scratch=new MascotRasterScratch(),input={...quad(),projection:identity,texture:texture([255,255,255,255],1),color:new Float64Array([1,.25,0])}
 rasterizeMascotFrame(input,t,scratch);const vertices=scratch.projected,heads=scratch.heads,depth=t.depth,rgba=t.rgba
 const p=pixel(t,1,1);assert(p[0]>p[1]&&p[1]>0&&p[2]===0&&p[0]<255,'linear material tint and matte lighting affect real output pixels')
 rasterizeMascotFrame(input,t,scratch);assert.equal(scratch.projected,vertices);assert.equal(scratch.heads,heads);assert.equal(t.depth,depth);assert.equal(t.rgba,rgba)
})

test('all seven real Minecraft rigs retain their 504 triangles, atlas bands and changing projected poses at 775×59',()=>{
 const width=775,height=59,worldWidth=34*width/height,atlasWidth=7*66,atlasHeight=66,atlasData=new Uint8Array(atlasWidth*atlasHeight*4)
 for(let y=0;y<atlasHeight;y++)for(let x=0;x<atlasWidth;x++){
  const skin=Math.floor(x/66),k=(y*atlasWidth+x)*4;atlasData[k]=35+skin*30;atlasData[k+1]=230-skin*20;atlasData[k+2]=50+skin*15;atlasData[k+3]=255
 }
 const map=new DataTexture(atlasData,atlasWidth,atlasHeight),players=Array.from({length:7},(_,i)=>{
  const player=new PreviewPlayer();player.skin.map=map;player.skin.setOuterLayerVisible(false);player.position.x=-worldWidth/2+worldWidth/7*(i+.5);player.rotation.y=.1+i*.17;player.updateMatrixWorld(true);return player
 })
 const parts=players.map(player=>{
  const meshes:Mesh[]=[];for(const part of [player.skin.head,player.skin.body,player.skin.leftArm,player.skin.rightArm,player.skin.leftLeg,player.skin.rightLeg])part.innerLayer.traverse(object=>{if(object instanceof Mesh)meshes.push(object)});return meshes
 })
 const batch=new MascotBatchRenderer(parts,map),camera=new OrthographicCamera(-worldWidth/2,worldWidth/2,34,0,.1,300)
 camera.position.z=100;camera.lookAt(0,0,0);camera.updateMatrixWorld(true)
 const projection=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).elements,t=target(width,height),scratch=new MascotRasterScratch(),geometry=batch.mesh.geometry
 const input:MascotRasterInput={positions:geometry.getAttribute('position').array,normals:geometry.getAttribute('normal').array,uvs:geometry.getAttribute('uv').array,indices:geometry.getIndex()!.array,projection,texture:{width:atlasWidth,height:atlasHeight,data:atlasData,flipY:false}}
 assert.equal(input.indices.length/3,504);assert.equal(input.positions.length/3,1008)
 batch.update();rasterizeMascotFrame(input,t,scratch)
 for(let person=0;person<7;person++){
  let filled=0;for(let y=0;y<height;y++)for(let x=Math.ceil(person*width/7);x<(person+1)*width/7;x++)if(t.rgba[(y*width+x)*4+3])filled++
  assert(filled>300,'actual model '+person+' has visible textured pixels in its original header slot')
 }
 const before=t.rgba.slice(),reused=scratch.projected
 players.forEach((player,i)=>{player.skin.leftArm.rotation.x=.3+i*.09;player.skin.rightLeg.rotation.x=-.2-i*.04;player.rotation.y+=.21;player.updateMatrixWorld(true)})
 batch.update();rasterizeMascotFrame(input,t,scratch);assert.notDeepEqual(t.rgba,before,'actual articulated geometry changes the rendered pixels');assert.equal(scratch.projected,reused)
 batch.dispose();players.forEach(player=>player.dispose());map.dispose()
})

test('Canvas2D software renderer uploads exact changed pixels, invalidates after resize and stops after disposal',()=>{
 let uploads=0,last:ImageData|undefined,options:unknown
 const context={imageSmoothingEnabled:true,createImageData:(w:number,h:number)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)} as ImageData),putImageData:(image:ImageData)=>{uploads++;last=image}}
 const canvas={width:0,height:0,style:{width:'',height:''},getContext:(_type:string,o:unknown)=>{options=o;return context}} as unknown as HTMLCanvasElement
 const renderer=new MascotSoftwareRenderer(canvas),geometry=new BufferGeometry(),q=quad()
 geometry.setAttribute('position',new BufferAttribute(q.positions as Float32Array,3));geometry.setAttribute('normal',new BufferAttribute(q.normals as Float32Array,3));geometry.setAttribute('uv',new BufferAttribute(q.uvs as Float32Array,2));geometry.setIndex(new BufferAttribute(q.indices as Uint16Array,1))
 const map=new DataTexture(new Uint8Array([255,0,0,255]),1,1),material=new MeshStandardMaterial({map}),mesh=new Mesh(geometry,material),camera=new OrthographicCamera(-1,1,1,-1,.1,10)
 camera.position.z=2;camera.lookAt(0,0,0);camera.updateProjectionMatrix()
 renderer.setSize(4,4,2);assert.equal(canvas.width,8);assert.equal(canvas.height,8);assert.equal(canvas.style.width,'4px');assert.deepEqual(options,{alpha:true,willReadFrequently:true})
 renderer.render(mesh,camera);assert.equal(uploads,1);assert.equal(renderer.info.render.calls,0);assert.equal(renderer.info.render.triangles,2);assert.equal(renderer.info.frames,1);assert.equal(renderer.info.uploads,1);assert(last!.data.some(n=>n>0))
 const reusableImage=last,before=last!.data.slice();renderer.render(mesh,camera);assert.equal(last,reusableImage);assert.equal(uploads,1);assert.equal(renderer.info.uploads,0,'identical RGBA raster must not dirty the compositor canvas');assert.equal(renderer.info.frames,2,'real raster work is reported separately from canvas upload');assert.equal(renderer.info.unchangedFrames,1)
 // A material change is a real visible pixel change, even with identical geometry.
 material.color.setRGB(.25,1,1);renderer.render(mesh,camera);assert.equal(uploads,2);assert.notDeepEqual(last!.data,before);assert.equal(renderer.info.uploads,1);assert.equal(renderer.info.totalUploads,2)
 renderer.render(mesh,camera);assert.equal(uploads,2);assert.equal(renderer.info.uploads,0)
 // Resize clears a canvas. The next raster must re-upload, even when the new
 // pixels happen to equal a previously cached image or contain only transparency.
 renderer.setSize(3,3,2);renderer.render(mesh,camera);assert.equal(uploads,3);assert.equal(canvas.width,6);assert.equal(renderer.info.uploads,1)
 renderer.dispose();renderer.dispose();assert.equal(canvas.width,0);assert.equal(canvas.height,0);assert.equal(renderer.info.uploads,0)
 renderer.setSize(4,4);renderer.render(mesh,camera);assert.equal(uploads,3,'closed stage cannot upload or allocate another canvas');assert.equal(canvas.width,0)
 geometry.dispose();material.dispose();map.dispose()
})
