import assert from 'node:assert/strict'
import {test} from 'node:test'
import {Group,Matrix4,Mesh,OrthographicCamera,Vector3} from 'three'
import {MASCOTS,MascotSweepGate,mascotHull,type MascotHitRect} from '../src/shared/mascots'
import {PreviewPlayer} from '../src/renderer/src/skinModel'
import {MascotDomCache,appendMascotPalmTiming,createMascotFeedbackFrame,createMascotPartFrame,createMascotViewportFrame,updateMascotFeedbackFrame,updateMascotPartFrame,updateMascotViewportFrame,type MascotPalmTiming} from '../src/renderer/src/mascotFrame'

function makeCamera(width=775,height=59){
 const world=34*width/height,camera=new OrthographicCamera(-world/2,world/2,34,0,.1,300)
 camera.position.set(0,0,100);camera.lookAt(0,0,0);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);return camera
}
function cornersOf(mesh:Mesh){
 mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox!,corners:Vector3[]=[]
 for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])corners.push(new Vector3(x,y,z))
 return corners
}
/** Independent allocating reference: the original projected-corner/hull operations. */
function reference(corners:Vector3[],world:Matrix4,camera:OrthographicCamera,width:number,height:number,id:string,part:string):MascotHitRect{
 const points=corners.map(c=>{const p=c.clone().applyMatrix4(world).project(camera);return{x:(p.x+1)*width/2,y:(1-p.y)*height/2,z:p.z}})
 return{id,part,left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y)),depth:points.reduce((sum,p)=>sum+p.z,0)/points.length,polygon:mascotHull(points)}
}

test('reused projections match all 42 actual Minecraft parts through pose and viewport changes',()=>{
 const scratch=new Vector3(),players=MASCOTS.map(()=>new PreviewPlayer()),waists:Group[]=[],parts:Array<{mesh:Mesh;corners:Vector3[];frame:ReturnType<typeof createMascotPartFrame>}>=[]
 for(const [i,player] of players.entries()){
  player.skin.setOuterLayerVisible(false);player.skin.position.y=16.8;player.skin.head.scale.setScalar(1.42);player.skin.body.scale.y=.72;player.skin.body.position.y=-4.3
  for(const leg of [player.skin.leftLeg,player.skin.rightLeg]){leg.scale.y=.68;leg.position.y=-8.6}
  for(const arm of [player.skin.leftArm,player.skin.rightArm]){arm.scale.y=.72;arm.position.y=-1.4}
  const waist=new Group();waist.position.y=-8.6;player.skin.add(waist);player.updateMatrixWorld(true)
  for(const limb of [player.skin.head,player.skin.body,player.skin.leftArm,player.skin.rightArm])waist.attach(limb)
  waists.push(waist)
  for(const [name,limb] of [['head',player.skin.head],['body',player.skin.body],['leftArm',player.skin.leftArm],['rightArm',player.skin.rightArm],['leftLeg',player.skin.leftLeg],['rightLeg',player.skin.rightLeg]] as const)limb.innerLayer.traverse(object=>{if(object instanceof Mesh)parts.push({mesh:object,corners:cornersOf(object),frame:createMascotPartFrame(MASCOTS[i].id,name)})})
 }
 assert.equal(parts.length,42)
 const buffers=parts.map(p=>({points:p.frame.points,objects:[...p.frame.points],polygon:p.frame.shape.polygon,sorted:p.frame.sorted,lower:p.frame.lower,upper:p.frame.upper,shape:p.frame.shape}))
 try{
  for(let frame=0;frame<24;frame++){
   const width=frame<12?775:617,height=frame<12?59:47,camera=makeCamera(width,height)
   for(const [i,player] of players.entries()){player.position.set((i-3)*40+Math.sin(frame*.13)*14,1.6,frame%3-1);player.rotation.y=2.36-frame*.08;player.scale.setScalar(.9+frame*.006);waists[i].rotation.x=.44+Math.sin(frame*.4)*.16;player.skin.head.rotation.y=-1.9+frame*.05;player.skin.leftLeg.rotation.x=Math.sin(frame*.6)*.35;player.skin.rightArm.rotation.z=Math.cos(frame*.3)*.12;player.updateMatrixWorld(true)}
   for(const [i,p] of parts.entries()){
    updateMascotPartFrame(p.frame,p.corners,p.mesh.matrixWorld,camera,width,height,scratch)
    assert.deepEqual(p.frame.shape,reference(p.corners,p.mesh.matrixWorld,camera,width,height,p.frame.shape.id,p.frame.shape.part!),`part ${i}, frame ${frame}`)
    assert.equal(p.frame.points,buffers[i].points);assert.equal(p.frame.shape.polygon,buffers[i].polygon);assert.equal(p.frame.sorted,buffers[i].sorted);assert.equal(p.frame.lower,buffers[i].lower);assert.equal(p.frame.upper,buffers[i].upper);assert.equal(p.frame.shape,buffers[i].shape)
    for(let j=0;j<8;j++)assert.equal(p.frame.points[j],buffers[i].objects[j])
   }
  }
  assert.notEqual(parts[0].frame.points[0],parts[1].frame.points[0],'parts never share projected point objects')
 }finally{for(const player of players)player.dispose()}
})

test('reused hulls preserve duplicate/collinear depth ties and shrink without stale vertices',()=>{
 const camera=makeCamera(),world=new Matrix4(),scratch=new Vector3(),frame=createMascotPartFrame('q3','head'),polygon=frame.shape.polygon
 const fixtures=[[[0,0,0],[0,0,1],[0,0,2],[0,0,3],[0,0,4],[0,0,5],[0,0,6],[0,0,7]],[[0,0,0],[1,1,0],[2,2,0],[3,3,0],[4,4,0],[5,5,0],[6,6,0],[7,7,0]],[[-2,-1,-1],[-2,-1,1],[-2,1,-1],[-2,1,1],[2,-1,-1],[2,-1,1],[2,1,-1],[2,1,1]]]
 for(const fixture of fixtures){const corners=fixture.map(p=>new Vector3(...p));updateMascotPartFrame(frame,corners,world,camera,775,59,scratch);assert.deepEqual(frame.shape,reference(corners,world,camera,775,59,'q3','head'));assert.equal(frame.shape.polygon,polygon)}
 const box=fixtures[2].map(p=>new Vector3(...p)),rotation=new Matrix4().makeRotationY(.5).multiply(new Matrix4().makeRotationX(.35))
 updateMascotPartFrame(frame,box,rotation,camera,775,59,scratch);assert.equal(polygon.length,6)
 updateMascotPartFrame(frame,box,world,camera,775,59,scratch);assert.equal(polygon.length,4);assert.deepEqual(frame.shape,reference(box,world,camera,775,59,'q3','head'))
})

test('feedback reuse retains insertion-order palms/prints, expiry boundaries and the last landed pop',()=>{
 const frame=createMascotFeedbackFrame(),active=frame.active,prints=frame.prints,contacts=frame.contacts
 const inputs:Array<MascotPalmTiming>=[{start:20,contact:120},{start:30,contact:90},{start:40,contact:100},{start:10,contact:80},{start:50,contact:110},{start:60,contact:70},{start:190,contact:270}]
 for(const now of [19.999,20,70,90,100,110,120,169.999,170,269.999,270,579.999,580,590,600,770]){
  const queue=inputs.map(p=>({...p})),expected=queue.filter(p=>now-p.contact<500),landed=expected.filter(p=>p.contact<=now)
  updateMascotFeedbackFrame(frame,queue,now,150,500)
  assert.deepEqual(queue,expected);assert.deepEqual(frame.contacts,expected.map(p=>p.contact));assert.deepEqual(frame.active.filter(Boolean),expected.filter(p=>now>=p.start&&now-p.start<150).slice(0,4));assert.deepEqual(frame.prints.filter(Boolean),landed.slice(-4));assert.equal(frame.lastLandedContact,landed.at(-1)?.contact)
  assert.equal(frame.active,active);assert.equal(frame.prints,prints);assert.equal(frame.contacts,contacts)
 }
 const future=[{start:920,contact:1000}];updateMascotFeedbackFrame(frame,future,900,150,500);assert.equal(frame.contacts.length,1);assert.deepEqual(frame.active.filter(Boolean),[]);assert.deepEqual(frame.prints.filter(Boolean),[])
 updateMascotFeedbackFrame(frame,future,900,150,500);assert.equal(frame.contactsChanged,false)
 updateMascotFeedbackFrame(frame,future,1500,150,500);assert.equal(frame.contactsChanged,true);assert.deepEqual(frame.contacts,[])
})

test('rapid feedback append retains the same queue and exactly the newest 24 independent hits',()=>{
 const queue:MascotPalmTiming[]=[],original=queue,timings=Array.from({length:31},(_,i)=>({start:i,contact:80+i}))
 for(const timing of timings)appendMascotPalmTiming(queue,timing)
 assert.equal(queue,original);assert.deepEqual(queue,timings.slice(-24));assert.equal(new Set(queue).size,24)
})

test('rebased reusable silhouettes preserve exposed edges, stable depth ties and stationary sorting guards',()=>{
 const camera=makeCamera(40,34),corners=[new Vector3(0,0,0),new Vector3(8,0,0),new Vector3(8,20,0),new Vector3(0,20,0)],near=createMascotPartFrame('near','body',4),far=createMascotPartFrame('far','body',4),scratch=new Vector3(),shift=new Matrix4()
 const viewport=[createMascotViewportFrame(near.shape),createMascotViewportFrame(far.shape)],shapes=viewport.map(v=>v.shape),pointObjects=viewport.map(v=>[...v.points]),polygons=viewport.map(v=>v.shape.polygon),gate=new MascotSweepGate()
 function update(nearX:number,farX:number,nearZ:number,farZ:number){
  updateMascotPartFrame(near,corners,shift.makeTranslation(nearX,0,nearZ),camera,40,34,scratch);updateMascotPartFrame(far,corners,shift.makeTranslation(farX,0,farZ),camera,40,34,scratch)
  updateMascotViewportFrame(viewport[0],near.shape,100,50);updateMascotViewportFrame(viewport[1],far.shape,100,50)
 }
 update(0,4,0,-1)
 assert.deepEqual(gate.move(125,64,shapes),['near']);assert.deepEqual(gate.move(130,64,shapes),['far']);assert.deepEqual(gate.move(135,64,shapes),[]);assert.deepEqual(gate.move(130,64,shapes),['far'])
 update(0,4,-2,0);assert.deepEqual(gate.move(130,64,shapes),[]);assert.deepEqual(gate.move(130.5,64,shapes),[])
 update(0,4,0,0);gate.reset();assert.deepEqual(gate.move(125,64,shapes),['near','far'])
 for(let i=0;i<2;i++){assert.equal(viewport[i].shape.polygon,polygons[i]);for(let j=0;j<8;j++)assert.equal(viewport[i].points[j],pointObjects[i][j])}
})

test('DOM caches write exact initial values, skip resting frames and clear hidden feedback without stale cache',()=>{
 const writes:Array<[string,string]>=[],dataset=new Proxy<Record<string,string>>({}, {set(target,key,value){writes.push(['data:'+String(key),value]);target[String(key)]=value;return true}}),styles:Record<string,string>={}
 const element={style:{setProperty:(name:string,value:string)=>{writes.push([name,value]);styles[name]=value}},dataset} as unknown as HTMLElement,cache=new MascotDomCache(element)
 cache.style('left',1.25,'px');cache.style('opacity',.72);cache.data('contact',123);assert.deepEqual(writes,[['left','1.25px'],['opacity','0.72'],['data:contact','123']])
 for(let i=0;i<60;i++){cache.style('left',1.25,'px');cache.style('opacity',.72);cache.data('contact',123)}assert.equal(writes.length,3)
 cache.style('opacity',0);cache.data('contact',0);cache.style('opacity',0);assert.equal(styles.opacity,'0');assert.equal(dataset.contact,'0');assert.equal(writes.length,5)
 cache.style('opacity',.72);assert.equal(styles.opacity,'0.72');assert.equal(writes.length,6)
 const independent=new MascotDomCache(element);independent.style('opacity',.72);assert.equal(writes.length,7,'each real element cache starts with an actual first write')
 const missing=new MascotDomCache(null);missing.style('opacity',1);missing.data('contact',1);assert.equal(writes.length,7)
})
