import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readTypedNbt,writeTypedNbt,tag} from '../src/main/core/typedNbt'
import {packLongs,unpackLongs,readProjection,writeProjection,stateTag,stateText,type Projection} from '../src/main/core/projectionFormats'
import {analyzeProjection,convertProjection,validateState} from '../src/main/core/projectionConversion'
import {paintSkinPixel,makeBaseOpaque,isBasePixel} from '../src/shared/skinPixels'
import {favoriteKey} from '../src/shared/modFavorites'
import {MascotHoverGate,sortMascots} from '../src/shared/mascots'
import {shouldSkipMemoryProcess} from '../src/shared/memoryOrganizer'
test('typed NBT retains every numeric width, signed long, list type and arrays',()=>{
 const root=tag(10,{byte:tag(1,-128),short:tag(2,-32768),int:tag(3,2147483647),long:tag(4,-9223372036854775808n),float:tag(5,1.25),double:tag(6,-2.5),bytes:tag(7,Buffer.from([0,255])),string:tag(8,'中文'),list:tag(9,[tag(2,1)],2),empty:tag(9,[],10),compound:tag(10,{}),ints:tag(11,[-1,2]),longs:tag(12,[-1n,9223372036854775807n])})
 for(const compressed of [true,false]){const output=readTypedNbt(writeTypedNbt(root,'投影',compressed));assert.equal(output.name,'投影');assert.deepEqual(writeTypedNbt(output.root,'',false),writeTypedNbt(root,'',false))}
 assert.throws(()=>readTypedNbt(Buffer.from([10,0,0,7,0,1,65,127,255,255,255])))
})
test('litematic packing preserves palette indexes crossing long boundaries',()=>{
 for(const palette of [1,3,17,511,2049]){const input=Uint32Array.from({length:117},(_,i)=>i%palette);assert.deepEqual(unpackLongs(packLongs(input,palette),input.length,palette),input)}
 assert.throws(()=>unpackLongs([],30,3))
})
function projection():Projection{return {format:'litematic',name:'测试',dataVersion:3465,rootName:'',raw:{},extra:{},metadata:{Author:tag(8,'测试作者')},regions:[{name:'负向区域',size:[2,1,2],signedSize:[-2,1,-2],anchor:[0,0,0],offset:[-1,0,-1],palette:[stateTag('minecraft:air'),stateTag('minecraft:stone')],blocks:Uint32Array.from([1,0,0,1]),entities:[tag(10,{id:tag(8,'minecraft:pig'),Pos:tag(9,[tag(6,.2),tag(6,0),tag(6,.4)],6),Health:tag(5,20)})],blockEntities:[tag(10,{id:tag(8,'minecraft:chest'),x:tag(3,0),y:tag(3,0),z:tag(3,0),Items:tag(9,[],10)})],extra:{}}]}}
test('four projection formats roundtrip positions, block states and entity numeric types',()=>{
 for(const format of ['litematic','schem','nbt','schematic'] as const){const p=projection(),next=readProjection(writeProjection(p,format),format),r=next.regions[0];assert.deepEqual(r.offset,[-1,0,-1]);assert.deepEqual(r.size,[2,1,2]);assert.deepEqual(Array.from(r.blocks).map(i=>stateText(r.palette[i])),['minecraft:stone','minecraft:air','minecraft:air','minecraft:stone']);assert.equal(r.entities[0].value.Health.type,5);assert.equal(r.entities[0].value.Health.value,20);assert.equal(r.blockEntities[0].value.Items.elementType,10)}
 const next=readProjection(writeProjection(projection(),'litematic'));assert.deepEqual(next.regions[0].signedSize,[-2,1,-2]);assert.deepEqual(next.regions[0].anchor,[0,0,0])
})
test('version analysis rejects unavailable registries and requires explicit entity loss decisions',()=>{
 assert.equal(validateState('minecraft:oak_log[axis=y]','1.20.1'),undefined)
 assert.match(validateState('minecraft:oak_log[axis=wrong]','1.20.1')!,/不接受/)
 const p=projection(),analysis=analyzeProjection(p,'schem','1.21.1');assert.equal(analysis.unsupported,undefined);assert.equal(analysis.differences.filter(d=>d.kind==='entity'||d.kind==='blockEntity').length,2)
 assert.throws(()=>convertProjection(projection(),'schem','1.21.1',{}),/确认全部差异/)
 const choices=Object.fromEntries(analysis.differences.map(d=>[d.key,'discard'])),next=readProjection(convertProjection(projection(),'schem','1.21.1',choices));assert.equal(next.dataVersion,3955);assert.equal(next.regions[0].entities.length,0)
 assert.match(analyzeProjection(p,'schem','99.9').unsupported!,/注册表/)
})
test('skin regional fill stops at face boundary and base erasing cannot create transparent holes',()=>{
 const data=new Uint8ClampedArray(64*64*4);makeBaseOpaque(data);paintSkinPixel(data,8,8,[9,8,7,255],{x:8,y:8,width:8,height:8},true)
 assert.equal(data[(8*64+8)*4],9);assert.equal(data[(8*64+16)*4],0);paintSkinPixel(data,8,8,[0,0,0,0],{x:8,y:8,width:8,height:8});assert.equal(data[(8*64+8)*4+3],255)
 assert.equal(isBasePixel(40,40),false)
})
test('favorites distinguish platforms and unknown local hashes',()=>{assert.notEqual(favoriteKey({source:'modrinth',projectId:'123'}),favoriteKey({source:'curseforge',projectId:'123'}));assert.equal(favoriteKey({sha1:'A'.repeat(40)}),'sha1:'+'a'.repeat(40));assert.throws(()=>favoriteKey({source:'invalid',projectId:'../file'}))})
test('hover only counts true mouse entries; stationary reorder and moving targets do not count',()=>{
 const gate=new MascotHoverGate();assert.equal(gate.move(1,1,'q3',false),'q3');assert.equal(gate.move(1,1,'qiqi',false),undefined);assert.equal(gate.move(2,1,'q3',false),undefined);assert.equal(gate.move(3,1,'',false),undefined);assert.equal(gate.move(4,1,'qiqi',true),undefined);assert.equal(gate.move(5,1,'qiqi',false),undefined);assert.equal(gate.move(6,1,'',false),undefined);assert.equal(gate.move(7,1,'qiqi',false),'qiqi');assert.deepEqual(sortMascots({order:['qiqi','q3'],counts:{q3:2,qiqi:2}}),['qiqi','q3'])
})
test('memory organizer skips known games, Java and Windows system executables',()=>{for(const [pid,name] of [[4,'x.exe'],[100,'C:\\Games\\javaw.exe'],[100,'C:\\Windows\\System32\\foo.exe'],[22,'C:\\Game.exe']] as const)assert.equal(shouldSkipMemoryProcess(pid,name,[22],'C:\\Windows'),true);assert.equal(shouldSkipMemoryProcess(90,'C:\\Tools\\app.exe',[22],'C:\\Windows'),false)})
import {flatten} from '../src/main/core/projectionFormats'
import {assertProjectionEquivalent} from '../src/main/core/projectionValidation'
test('modern downgrade enumerates unavailable blocks; manual replacement generates verified data without mutating original bytes',()=>{
 const p=projection();p.dataVersion=3955;p.regions[0].entities=[];p.regions[0].blockEntities=[];p.regions[0].palette[1]=stateTag('minecraft:trial_spawner');const original=writeProjection(p,'litematic'),source=readProjection(original),analysis=analyzeProjection(source,'schem','1.20.1');assert(analysis.differences.some(d=>d.key==='block:0:1'));const choices=Object.fromEntries(analysis.differences.map(d=>[d.key,d.kind==='block'?'minecraft:stone':'discard']));const converted=readProjection(convertProjection(source,'schem','1.20.1',choices));assert.equal(converted.dataVersion,3465);assert.equal(stateText(converted.regions[0].palette[1]),'minecraft:stone');assert.equal(stateText(readProjection(original).regions[0].palette[1]),'minecraft:trial_spawner');assert.throws(()=>convertProjection(readProjection(original),'schem','1.20.1',{...choices,'block:0:1':'minecraft:trial_spawner'}),/替代方块不可用/)
})
test('typed unknown data survives same-format copies and requires explicit loss acknowledgement across formats',()=>{
 const p=projection();p.extra.CustomLong=tag(4,9223372036854775807n);p.regions[0].extra.Extension=tag(11,[1,-1]);const bytes=writeProjection(p,'litematic'),source=readProjection(bytes),same=readProjection(convertProjection(source,'litematic',undefined,{}));assert.equal(same.extra.CustomLong.value,9223372036854775807n);assert.equal(same.regions[0].extra.Extension.type,11);const analysis=analyzeProjection(readProjection(bytes),'schem');assert(analysis.differences.some(d=>d.key==='extra'));assert.throws(()=>convertProjection(readProjection(bytes),'schem',undefined,{}),/全部差异/);const copy=readProjection(convertProjection(readProjection(bytes),'schem',undefined,Object.fromEntries(analysis.differences.map(d=>[d.key,'discard']))));assert.equal(copy.regions[0].entities[0].value.Health.type,5);assert.equal(copy.regions[0].blockEntities[0].value.Items.elementType,10);const damaged=readProjection(writeProjection(projection(),'litematic'));damaged.regions[0].blocks[0]=0;assert.throws(()=>assertProjectionEquivalent(projection(),damaged,'litematic'),/方块状态/)
})
test('regional merge handles gaps and rejects overlaps; unverified native wrappers and corrupt arrays fail closed',()=>{
 const p=projection();p.regions[0].entities=[];p.regions[0].blockEntities=[];p.regions.push({...p.regions[0],name:'另一区域',offset:[2,0,2]});const flat=flatten(p);assert.deepEqual(flat.size,[5,1,5]);p.regions[1].offset=[-1,0,-1];assert.throws(()=>flatten(p),/重叠/);const native=readTypedNbt(writeProjection(projection(),'nbt'));native.root.value.entities.value[0].value.UnknownWrapper=tag(3,1);assert.throws(()=>readProjection(writeTypedNbt(native.root),'nbt'),/包装/);assert.throws(()=>readProjection(Buffer.from([10,0,0,12,0,1,65,127,255,255,255])),/超限|截断/)
})
test('official 26.2 and 26.3 registries validate properties and reject fabricated states',()=>{
 for(const version of ['26.2','26.3']){assert.equal(validateState('minecraft:oak_log[axis=x]',version),undefined);assert.match(validateState('minecraft:oak_log[axis=banana]',version)!,/不接受/);assert.match(validateState('minecraft:made_up_block',version)!,/没有/)}
})
import {dependencyGraph} from '../src/main/core/modInstallPlan'
import type {CommunityFile,InstalledVersion} from '../src/shared/types'
test('favorites and recording roots share a deduplicated graph and reject pinned dependency conflicts',async()=>{
 const target={id:'fixture',mcVersion:'1.20.1',loader:'fabric'} as InstalledVersion;
 const make=(project:string,id:string):CommunityFile=>({source:'modrinth',projectId:project,fileId:id,fileName:id+'.jar',version:'1',gameVersions:['1.20.1'],loaders:['fabric'],url:'https://fixture.invalid/'+id,size:1,date:'',releaseType:'release'});
 const api=make('api','api-1'),recording=make('recording','recording-1'),favorite=make('favorite','favorite-1');recording.dependencies=[{projectId:'api',fileId:'api-1',required:true}];favorite.dependencies=[{projectId:'api',required:true}];let queried=0;const repository={files:async()=>{queried++;return[api]},exact:async()=>{queried++;return api},find:async()=>undefined};assert.deepEqual((await dependencyGraph([recording,favorite,api,api],target,repository)).map(f=>f.fileId),['api-1','recording-1','favorite-1']);assert.equal(queried,0,'explicit root satisfies both dependencies without duplicate lookup');await assert.rejects(dependencyGraph([recording,make('api','api-2')],target,repository),/冲突/);await assert.rejects(dependencyGraph([make('api','api-1'),make('api','api-2')],target,repository),/冲突/);await assert.rejects(dependencyGraph([favorite],{...target,loader:'forge'},repository),/不支持/)
})
