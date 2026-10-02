// SPDX-License-Identifier: MIT
// Only the mascot stage is batched. The attributed skinview3d rigs remain unmodified.
import {BufferAttribute,BufferGeometry,DynamicDrawUsage,Matrix3,Mesh,MeshStandardMaterial,NearestFilter,SRGBColorSpace,Texture,Vector3} from 'three'

const SKIN_SIZE=64,GUTTER=1,TILE_SIZE=SKIN_SIZE+GUTTER*2
export function mascotAtlasUV(u:number,v:number,index:number,count:number):[number,number]{
 return[(index*TILE_SIZE+GUTTER+u*SKIN_SIZE)/(count*TILE_SIZE),(GUTTER+v*SKIN_SIZE)/TILE_SIZE]
}

/** The gutters retain each skin's edge texels even at an exact UV boundary. */
export function createMascotAtlas(images:HTMLImageElement[]):Texture{
 const canvas=document.createElement('canvas');canvas.width=images.length*TILE_SIZE;canvas.height=TILE_SIZE
 const context=canvas.getContext('2d')!;context.imageSmoothingEnabled=false
 for(const [index,image] of images.entries()){
  const x=index*TILE_SIZE
  context.drawImage(image,x+1,1,SKIN_SIZE,SKIN_SIZE)
  context.drawImage(image,0,0,1,64,x,1,1,64);context.drawImage(image,63,0,1,64,x+65,1,1,64)
  context.drawImage(image,0,0,64,1,x+1,0,64,1);context.drawImage(image,0,63,64,1,x+1,65,64,1)
  for(const [sx,sy,dx,dy] of [[0,0,0,0],[63,0,65,0],[0,63,0,65],[63,63,65,65]])context.drawImage(image,sx,sy,1,1,x+dx,dy,1,1)
 }
 const texture=new Texture(canvas);texture.colorSpace=SRGBColorSpace;texture.magFilter=texture.minFilter=NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true
 return texture
}

/** One indexed draw, with the exact original world positions and inverse-transpose normals. */
export class MascotBatchRenderer{
 readonly mesh:Mesh<BufferGeometry,MeshStandardMaterial>
 private readonly entries:Array<{source:Mesh;offset:number}>=[]
 private readonly positions:BufferAttribute
 private readonly normals:BufferAttribute
 private readonly normalMatrix=new Matrix3()
 private readonly vector=new Vector3()
 private disposed=false
 constructor(skins:Mesh[][],atlas:Texture){
  const material=skins[0]?.[0]?.material
  if(!(material instanceof MeshStandardMaterial))throw new Error('Mascot batch requires the original standard base material')
  const vertexCount=skins.flat().reduce((sum,part)=>sum+part.geometry.getAttribute('position').count,0)
  const indices:number[]=[],uvs=new Float32Array(vertexCount*2)
  let offset=0
  for(const [skinIndex,parts] of skins.entries())for(const source of parts){
   const position=source.geometry.getAttribute('position'),uv=source.geometry.getAttribute('uv'),index=source.geometry.getIndex()
   if(!index||!source.geometry.getAttribute('normal')||position.count!==uv.count)throw new Error('Mascot batch requires indexed textured geometry')
   for(let i=0;i<position.count;i++)uvs.set(mascotAtlasUV(uv.getX(i),uv.getY(i),skinIndex,skins.length),(offset+i)*2)
   for(let i=0;i<index.count;i++)indices.push(offset+index.getX(i))
   this.entries.push({source,offset});offset+=position.count
  }
  this.positions=new BufferAttribute(new Float32Array(vertexCount*3),3).setUsage(DynamicDrawUsage)
  this.normals=new BufferAttribute(new Float32Array(vertexCount*3),3).setUsage(DynamicDrawUsage)
  const geometry=new BufferGeometry();geometry.setAttribute('position',this.positions);geometry.setAttribute('normal',this.normals);geometry.setAttribute('uv',new BufferAttribute(uvs,2));geometry.setIndex(indices)
  const batchedMaterial=material.clone();batchedMaterial.map=atlas
  this.mesh=new Mesh(geometry,batchedMaterial);this.mesh.frustumCulled=false;this.mesh.matrixAutoUpdate=false
 }
 update(){
  if(this.disposed)return
  for(const {source,offset} of this.entries){
   const position=source.geometry.getAttribute('position'),normal=source.geometry.getAttribute('normal');this.normalMatrix.getNormalMatrix(source.matrixWorld)
   for(let i=0;i<position.count;i++){
    this.vector.fromBufferAttribute(position,i).applyMatrix4(source.matrixWorld);this.positions.setXYZ(offset+i,this.vector.x,this.vector.y,this.vector.z)
    this.vector.fromBufferAttribute(normal,i).applyMatrix3(this.normalMatrix).normalize();this.normals.setXYZ(offset+i,this.vector.x,this.vector.y,this.vector.z)
   }
  }
  this.positions.needsUpdate=true;this.normals.needsUpdate=true
 }
 dispose(){if(this.disposed)return;this.disposed=true;this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose()}
}
