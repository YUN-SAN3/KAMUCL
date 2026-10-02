import test from 'node:test'
import assert from 'node:assert/strict'
import { Box3, BoxGeometry, Mesh, Texture, Vector3, PerspectiveCamera } from 'three'
import { PreviewPlayer } from '../src/renderer/src/skinModel'

test('changing cape preserves upright pose, camera and zoom during walking and idle', () => {
  const player = new PreviewPlayer(), camera = new PerspectiveCamera(40,1,.1,200)
  camera.position.set(20,27,50); camera.zoom=1.4
  const before=camera.position.clone()
  for(const walk of [0,1])for(const yaw of [-.6,2.5])for(const texture of [new Texture(),new Texture(),null]) {
    player.pose(.4,walk,yaw);player.setCape(texture);player.updateMatrixWorld(true)
    assert(new Vector3(0,1,0).transformDirection(player.matrixWorld).distanceTo(new Vector3(0,1,0))<1e-12)
    assert(camera.position.equals(before));assert.equal(camera.zoom,1.4)
    assert.equal(player.rotation.y,yaw);assert.equal(player.cape.visible,!!texture)
    player.pose(.5,walk,yaw);assert.equal(player.rotation.x,0);assert.equal(player.rotation.z,0)
  }
  player.dispose()
})
test('walking arms have opposite X swings, constant outward tilt and no Y twist',()=>{
  const player=new PreviewPlayer();player.pose(0,1,0)
  assert.equal(player.skin.leftArm.rotation.x,Math.PI/4);assert.equal(player.skin.rightArm.rotation.x,-Math.PI/4)
  assert.equal(player.skin.leftArm.rotation.y,0);assert.equal(player.skin.rightArm.rotation.y,0)
  assert.equal(player.skin.leftArm.rotation.z,Math.PI*.02);assert.equal(player.skin.rightArm.rotation.z,-Math.PI*.02)
  assert.equal(player.skin.leftLeg.rotation.x,-Math.PI/4);assert.equal(player.skin.rightLeg.rotation.x,Math.PI/4)
  player.pose(0,0,0);assert.equal(Math.abs(player.skin.leftArm.rotation.x),0);player.dispose()
})
test('cape dimensions and all box bottom UVs remain rectangular without bowtie distortion',()=>{
  const player=new PreviewPlayer();let capeFound=false,count=0
  player.traverse(object=>{if(!(object instanceof Mesh)||!(object.geometry instanceof BoxGeometry))return
    const geometry=object.geometry,uv=geometry.getAttribute('uv');count++
    const points=[12,13,14,15].map(i=>[uv.getX(i),uv.getY(i)])
    assert.equal(points[0][0],points[2][0]);assert.equal(points[1][0],points[3][0]);assert.equal(points[0][1],points[1][1]);assert.equal(points[2][1],points[3][1])
    if(geometry.parameters.width===10&&geometry.parameters.height===16&&geometry.parameters.depth===1)capeFound=true
  })
  assert(count>=13);assert(capeFound);assert.equal(player.cape.rotation.y,Math.PI);player.dispose()
})

test('texture alpha detects slim while the model switches shoulder width without rebuilding',async()=>{
 const {detectSkinVariant}=await import('../src/renderer/src/skin-render')
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');let alpha=0
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({getContext:()=>({drawImage(){},getImageData(){return{data:new Uint8ClampedArray([0,0,0,alpha])}}})})}})
 try{assert.equal(detectSkinVariant({} as HTMLCanvasElement),'slim');alpha=255;assert.equal(detectSkinVariant({} as HTMLCanvasElement),'classic');const player=new PreviewPlayer();player.skin.modelType='slim';const slim=new Box3().setFromObject(player.skin.leftArm).getSize(new Vector3()).x;player.skin.modelType='default';const classic=new Box3().setFromObject(player.skin.leftArm).getSize(new Vector3()).x;assert(Math.abs(classic-slim-1)<.01);player.dispose()}finally{if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document')}
})
