import { minecraftData } from './projectionRegistry'
import { readTypedNbt, writeTypedNbt, tag, type NbtCompound, type NbtTag } from './typedNbt'
import type { ProjectionFormat } from '../../shared/projections'
export type Vec=[number,number,number]
export interface ProjectionRegion {name:string;offset:Vec;size:Vec;signedSize?:Vec;anchor?:Vec;palette:NbtTag[];blocks:Uint32Array;entities:NbtTag[];blockEntities:NbtTag[];extra:NbtCompound}
export interface Projection {format:ProjectionFormat;name:string;dataVersion?:number;regions:ProjectionRegion[];metadata:NbtCompound;extra:NbtCompound;rootName:string;raw:NbtCompound}
export const compound=(t:NbtTag|undefined):NbtCompound=>{if(!t||t.type!==10)throw new Error('缺少 Compound 标签');return t.value}
export const value=(c:NbtCompound,k:string,type:number,fallback?:any):any=>{const t=c[k];if(!t&&fallback!==undefined)return fallback;if(!t||t.type!==type)throw new Error('缺少或无效标签：'+k);return t.value}
export const list=(c:NbtCompound,k:string):NbtTag[]=>value(c,k,9,[])
export const vec=(c:NbtCompound):Vec=>['x','y','z'].map(k=>value(c,k,3)) as Vec
export const vecTag=(v:Vec)=>tag(10,Object.fromEntries(['x','y','z'].map((k,i)=>[k,tag(3,v[i])])) )
export const listTag=(values:NbtTag[],type=10)=>tag(9,values,type as any)
export function volume(size:Vec){if(size.some(n=>!Number.isSafeInteger(n)||n<=0||n>65535)||size.reduce((a,n)=>a*n,1)>16777216)throw new Error('投影区域尺寸无效或超过 1600 万方块');return size.reduce((a,n)=>a*n,1)}
export function stateText(t:NbtTag){const c=compound(t),name=value(c,'Name',8),properties=c.Properties?compound(c.Properties):{};const pairs=Object.entries(properties).map(([k,v])=>`${k}=${v.value}`).sort();return name+(pairs.length?'['+pairs.join(',')+']':'')}
export function stateTag(text:string):NbtTag{const m=/^([a-z0-9_.-]+:[a-z0-9_./-]+)(?:\[([^\]]*)\])?$/.exec(text);if(!m)throw new Error('无效方块状态：'+text);const c:NbtCompound={Name:tag(8,m[1])};if(m[2]){const properties:NbtCompound=Object.create(null);for(const pair of m[2].split(',')){const [key,val,...rest]=pair.split('=');if(!key||!val||rest.length||Object.hasOwn(properties,key))throw new Error('无效方块属性');properties[key]=tag(8,val)}c.Properties=tag(10,properties)}return tag(10,c)}
export function unpackLongs(longs:bigint[],n:number,palette:number){const bits=Math.max(2,Math.ceil(Math.log2(Math.max(1,palette)))),mask=(1n<<BigInt(bits))-1n,result=new Uint32Array(n);if(longs.length!==Math.ceil(n*bits/64))throw new Error('Litematic 方块数组长度不匹配');for(let i=0;i<n;i++){const bit=i*bits,word=Math.floor(bit/64),shift=bit%64;let b=BigInt.asUintN(64,longs[word])>>BigInt(shift);if(shift+bits>64)b|=BigInt.asUintN(64,longs[word+1])<<BigInt(64-shift);const v=Number(b&mask);if(v>=palette)throw new Error('投影调色板索引越界');result[i]=v}return result}
export function packLongs(blocks:Uint32Array,palette:number){const bits=Math.max(2,Math.ceil(Math.log2(Math.max(1,palette)))),result=Array<bigint>(Math.ceil(blocks.length*bits/64)).fill(0n);for(let i=0;i<blocks.length;i++){const bit=i*bits,w=Math.floor(bit/64),shift=bit%64,v=BigInt(blocks[i]);result[w]|=v<<BigInt(shift);if(shift+bits>64)result[w+1]|=v>>BigInt(64-shift)}return result.map(v=>BigInt.asIntN(64,v))}
export function decodeVarints(bytes:Buffer,n:number,palette:number){const out=new Uint32Array(n);let p=0;for(let i=0;i<n;i++){let v=0,shift=0;for(;;){if(p>=bytes.length||shift>28)throw new Error('Sponge VarInt 损坏');const b=bytes[p++];v+=(b&127)*2**shift;if(!(b&128))break;shift+=7}if(!Number.isSafeInteger(v)||v>=palette)throw new Error('投影调色板索引越界');out[i]=v}if(p!==bytes.length)throw new Error('Sponge 方块数组有尾数据');return out}
export function encodeVarints(blocks:Uint32Array){const out:number[]=[];for(let v of blocks){while(v>=128){out.push((v&127)|128);v>>>=7}out.push(v)}return Buffer.from(out)}
function extras(c:NbtCompound,known:string[]):NbtCompound{return Object.fromEntries(Object.entries(c).filter(([k])=>!known.includes(k)))}
function xyzList(t:NbtTag|undefined):Vec{if(!t)return [0,0,0];if(t.type===11&&t.value.length===3)return t.value as Vec;if(t.type===9&&t.value.length===3)return t.value.map((v:NbtTag)=>Number(v.value)) as Vec;throw new Error('投影坐标无效')}
export const position=xyzList
function entityFromSponge(t:NbtTag):NbtTag{const c=compound(t),data=c.Data?{...compound(c.Data)}:extras(c,['Pos','Id']);data.id=tag(8,value(c,'Id',8));data.Pos=c.Pos;return tag(10,data)}
function blockEntityFromSponge(t:NbtTag):NbtTag{const c=compound(t),data=c.Data?{...compound(c.Data)}:extras(c,['Pos','Id']);data.id=tag(8,value(c,'Id',8));const p=xyzList(c.Pos);['x','y','z'].forEach((k,i)=>data[k]=tag(3,p[i]));return tag(10,data)}
export function readProjection(input:Buffer,format?:ProjectionFormat):Projection{
  const parsed=readTypedNbt(input),raw=compound(parsed.root),c=raw.Schematic?compound(raw.Schematic):raw
  let actual:ProjectionFormat=raw.Regions?'litematic':c.Palette||c.Blocks?.type===10?'schem':c.Blocks?.type===7?'schematic':raw.palette&&raw.blocks?'nbt':format!
  if(!actual)throw new Error('无法识别投影格式');if(format&&format!==actual)throw new Error('扩展名与投影内容不匹配')
  const out:Projection={format:actual,name:parsed.name,dataVersion:c.DataVersion?.value||raw.MinecraftDataVersion?.value,regions:[],metadata:c.Metadata?compound(c.Metadata):{},extra:{},rootName:parsed.name,raw}
  if(actual==='litematic'){
    const regions=compound(raw.Regions);for(const [name,t] of Object.entries(regions)){
      const r=compound(t),signedSize=vec(compound(r.Size)),size=signedSize.map(Math.abs) as Vec,anchor=vec(compound(r.Position)),localMin=signedSize.map(v=>v<0?v+1:0) as Vec,offset=anchor.map((v,i)=>v+localMin[i]) as Vec
      const palette=list(r,'BlockStatePalette');if(!palette.length)throw new Error('投影调色板为空')
      const blockEntities=list(r,'TileEntities').map(t=>{const c={...compound(t)};['x','y','z'].forEach((k,i)=>c[k]=tag(3,value(c,k,3)-localMin[i]));return tag(10,c)})
      const entities=list(r,'Entities').map(t=>shiftEntity(t,localMin.map(v=>-v) as Vec))
      out.regions.push({name,offset,size,signedSize,anchor,palette,blocks:unpackLongs(value(r,'BlockStates',12),volume(size),palette.length),entities,blockEntities,extra:extras(r,['Position','Size','BlockStatePalette','BlockStates','Entities','TileEntities'])})
    }
    out.extra=extras(raw,['Version','SubVersion','MinecraftDataVersion','Metadata','Regions'])
  }else if(actual==='schem'){
    const version=value(c,'Version',3);if(![1,2,3].includes(version))throw new Error('Sponge 文件版本不支持')
    const size=['Width','Height','Length'].map(k=>value(c,k,2)&65535) as Vec,n=volume(size),b=version===3?compound(c.Blocks):c,p=compound(b.Palette),palette:NbtTag[]=[]
    for(const [name,v] of Object.entries(p)){if(v.type!==3||v.value<0||v.value>65535||palette[v.value])throw new Error('Sponge 调色板无效');palette[v.value]=stateTag(name)}
    if(!palette.length||palette.some(v=>!v)||Object.keys(p).length!==palette.length)throw new Error('Sponge 调色板索引不连续')
    const be=list(b,version===1?'TileEntities':'BlockEntities').map(blockEntityFromSponge),entities=list(c,'Entities').map(entityFromSponge)
    out.regions.push({name:'region',offset:xyzList(c.Offset),size,palette,blocks:decodeVarints(value(b,version===3?'Data':'BlockData',7),n,palette.length),entities,blockEntities:be,extra:extras(b,version===3?['Palette','Data','BlockEntities']:['Version','DataVersion','Width','Height','Length','Offset','Palette','PaletteMax','BlockData','TileEntities','BlockEntities','Entities','Metadata'])})
    out.extra=version===3?extras(c,['Version','DataVersion','Width','Height','Length','Offset','Blocks','Entities','Metadata']):{}
  }else if(actual==='schematic'){
    const size=['Width','Height','Length'].map(k=>value(c,k,2)&65535) as Vec,n=volume(size),ids:Buffer=value(c,'Blocks',7),data:Buffer=value(c,'Data',7),add:Buffer=value(c,'AddBlocks',7,Buffer.alloc(0))
    if(ids.length!==n||data.length!==n||(add.length&&add.length!==Math.ceil(n/2)))throw new Error('旧投影方块数组长度不匹配')
    const palette:NbtTag[]=[],map=new Map<string,number>(),blocks=new Uint32Array(n),legacy=(minecraftData as any).legacy.pc.blocks
    for(let i=0;i<n;i++){const id=ids[i]|((add.length?(i%2?add[i>>1]>>4:add[i>>1]&15):0)<<8),meta=data[i]&15,key=id+':'+meta,text=legacy[key]||`legacy:block_${id}[data=${meta}]`;let index=map.get(text);if(index===undefined){index=palette.length;palette.push(stateTag(text));map.set(text,index)}blocks[i]=index}
    out.regions.push({name:'region',offset:[c.WEOffsetX?.value||0,c.WEOffsetY?.value||0,c.WEOffsetZ?.value||0],size,palette,blocks,entities:list(c,'Entities'),blockEntities:list(c,'TileEntities'),extra:{}})
    out.dataVersion=1343;out.extra=extras(c,['Width','Height','Length','Blocks','Data','AddBlocks','Entities','TileEntities','Materials','WEOffsetX','WEOffsetY','WEOffsetZ'])
  }else{
    if(raw.palettes)throw new Error('原版结构包含多个候选调色板，暂不支持无损转换，请先在游戏内选定一个调色板')
    const size=xyzList(raw.size),n=volume(size),palette=list(raw,'palette'),blocks=new Uint32Array(n),be:NbtTag[]=[]
    if(!palette.length)throw new Error('结构调色板为空')
    let air=palette.findIndex(t=>stateText(t)==='minecraft:air');if(air<0){air=palette.length;palette.push(stateTag('minecraft:air'))}blocks.fill(air)
    const occupied=new Uint8Array(n);for(const t of list(raw,'blocks')){const b=compound(t),p=xyzList(b.pos);if(Object.keys(b).some(k=>!['pos','state','nbt'].includes(k)))throw Error('结构方块含未支持的附加包装标签，无法保证无损转换');if(p.some((v,i)=>!Number.isInteger(v)||v<0||v>=size[i]))throw new Error('结构方块坐标越界');const index=p[0]+p[2]*size[0]+p[1]*size[0]*size[2],state=value(b,'state',3);if(state<0||state>=palette.length||occupied[index]!==0)throw new Error('结构方块重复或状态无效');occupied[index]=1;blocks[index]=state;if(b.nbt){const c={...compound(b.nbt)};['x','y','z'].forEach((k,i)=>c[k]=tag(3,p[i]));be.push(tag(10,c))}}
    const entities=list(raw,'entities').map(t=>{const c=compound(t),nbt={...compound(c.nbt)},pos=xyzList(c.pos);if(Object.keys(c).some(k=>!['pos','blockPos','nbt'].includes(k))||c.blockPos&&xyzList(c.blockPos).some((v,i)=>v!==Math.floor(pos[i])))throw Error('结构实体包装包含未验证的数据，暂不支持无损转换');if(nbt.Pos&&xyzList(nbt.Pos).some((v,i)=>v!==pos[i]))throw Error('结构实体位置标签不一致，暂不支持无损转换');nbt.Pos=listTag(pos.map(v=>tag(6,v)),6);return tag(10,nbt)})
    out.regions.push({name:'region',offset:raw.KAMUCLOffset?xyzList(raw.KAMUCLOffset):[0,0,0],size,palette,blocks,entities,blockEntities:be,extra:{}});out.extra=extras(raw,['DataVersion','size','palette','blocks','entities','KAMUCLOffset'])
  }
  if(out.metadata.Name?.type===8)out.name=out.metadata.Name.value
  if(!out.regions.length)throw new Error('投影没有区域');const total=out.regions.reduce((n,r)=>n+r.blocks.length,0);if(total>16777216)throw new Error('投影总量超过 1600 万方块')
  for(const r of out.regions)for(const state of r.palette)stateText(state)
  return out
}
export function shiftEntity(t:NbtTag,delta:Vec):NbtTag{const c={...compound(t)},p=xyzList(c.Pos);c.Pos=listTag(p.map((v,i)=>tag(6,v+delta[i])),6);return tag(10,c)}
export function shiftBlockEntity(t:NbtTag,delta:Vec):NbtTag{const c={...compound(t)};['x','y','z'].forEach((k,i)=>c[k]=tag(3,value(c,k,3)+delta[i]));return tag(10,c)}
export function flatten(p:Projection):ProjectionRegion{
  const min=[0,1,2].map(i=>Math.min(...p.regions.map(r=>r.offset[i]))) as Vec,max=[0,1,2].map(i=>Math.max(...p.regions.map(r=>r.offset[i]+r.size[i]))) as Vec,size=max.map((v,i)=>v-min[i]) as Vec,blocks=new Uint32Array(volume(size)),palette=[stateTag('minecraft:air')],map=new Map<string,number>([['minecraft:air',0]]),occupied=new Uint8Array(blocks.length),entities:NbtTag[]=[],blockEntities:NbtTag[]=[]
  for(const r of p.regions){const delta=r.offset.map((v,i)=>v-min[i]) as Vec,indexes=r.palette.map(t=>{const text=stateText(t);if(!map.has(text)){map.set(text,palette.length);palette.push(t)}return map.get(text)!});for(let i=0;i<r.blocks.length;i++){const x=i%r.size[0]+delta[0],z=Math.floor(i/r.size[0])%r.size[2]+delta[2],y=Math.floor(i/(r.size[0]*r.size[2]))+delta[1],at=x+z*size[0]+y*size[0]*size[2];if(occupied[at]!==0)throw new Error('区域重叠，无法可靠合并为单区域格式');occupied[at]=1;blocks[at]=indexes[r.blocks[i]]}entities.push(...r.entities.map(t=>shiftEntity(t,delta)));blockEntities.push(...r.blockEntities.map(t=>shiftBlockEntity(t,delta)))}
  return {name:p.name||'region',offset:min,size,palette,blocks,entities,blockEntities,extra:{}}
}
function spongeEntity(t:NbtTag,block=false):NbtTag{const c=compound(t),id=value(c,'id',8),data=extras(c,block?['id','x','y','z']:['id','Pos']),pos=block?tag(11,vec(c)):listTag(xyzList(c.Pos).map(v=>tag(6,v)),6);return tag(10,{Id:tag(8,id),Pos:pos,Data:tag(10,data)})}
export function writeProjection(p:Projection,format:ProjectionFormat):Buffer{
  let root:NbtCompound
  if(format==='litematic'){
    const regions:NbtCompound={};for(const r of p.regions){const signed=r.signedSize||r.size,anchor=r.anchor||r.offset,delta=signed.map(v=>v<0?v+1:0) as Vec;regions[r.name]=tag(10,{...r.extra,Position:vecTag(anchor),Size:vecTag(signed),BlockStatePalette:listTag(r.palette),BlockStates:tag(12,packLongs(r.blocks,r.palette.length)),Entities:listTag(r.entities.map(t=>shiftEntity(t,delta))),TileEntities:listTag(r.blockEntities.map(t=>shiftBlockEntity(t,delta)))})}
    root={...p.extra,Version:tag(3,6),SubVersion:tag(3,1),MinecraftDataVersion:tag(3,p.dataVersion||0),Metadata:tag(10,{...p.metadata,Name:tag(8,p.name||'KAMUCL'),RegionCount:tag(3,p.regions.length),TotalVolume:tag(3,p.regions.reduce((n,r)=>n+r.blocks.length,0)),TotalBlocks:tag(3,p.regions.reduce((n,r)=>{const nonAir=r.palette.map(t=>!['minecraft:air','minecraft:cave_air','minecraft:void_air'].includes(stateText(t)));for(const i of r.blocks)if(nonAir[i])n++;return n},0))}),Regions:tag(10,regions)}
  }else{
    const r=p.regions.length===1?p.regions[0]:flatten(p),[w,h,l]=r.size
    if(format==='schem')root={Schematic:tag(10,{...p.extra,Version:tag(3,3),DataVersion:tag(3,p.dataVersion||0),Metadata:tag(10,p.metadata),Width:tag(2,w>32767?w-65536:w),Height:tag(2,h>32767?h-65536:h),Length:tag(2,l>32767?l-65536:l),Offset:tag(11,r.offset),Blocks:tag(10,{...r.extra,Palette:tag(10,Object.fromEntries(r.palette.map((t,i)=>[stateText(t),tag(3,i)]))),Data:tag(7,encodeVarints(r.blocks)),BlockEntities:listTag(r.blockEntities.map(t=>spongeEntity(t,true)))}),Entities:listTag(r.entities.map(t=>spongeEntity(t)))})}
    else if(format==='nbt'){
      const be=new Map(r.blockEntities.map(t=>[vec(compound(t)).join(','),t])),blocks:NbtTag[]=[]
      for(let i=0;i<r.blocks.length;i++){const pos:Vec=[i%w,Math.floor(i/(w*l)),Math.floor(i/w)%l],c:NbtCompound={pos:listTag(pos.map(v=>tag(3,v)),3),state:tag(3,r.blocks[i])},entity=be.get(pos.join(','));if(entity)c.nbt=tag(10,extras(compound(entity),['x','y','z']));blocks.push(tag(10,c))}
      root={...p.extra,DataVersion:tag(3,p.dataVersion||0),size:listTag(r.size.map(v=>tag(3,v)),3),palette:listTag(r.palette),blocks:listTag(blocks),entities:listTag(r.entities.map(t=>{const pos=xyzList(compound(t).Pos);return tag(10,{pos:listTag(pos.map(v=>tag(6,v)),6),blockPos:listTag(pos.map(v=>tag(3,Math.floor(v))),3),nbt:t})})),KAMUCLOffset:tag(11,r.offset)}
    }else{
      const reverse=new Map<string,string>();for(const [k,v] of Object.entries((minecraftData as any).legacy.pc.blocks))if(!reverse.has(v as string))reverse.set(v as string,k)
      const mappings=r.palette.map(t=>{const text=stateText(t),key=reverse.get(text)||(/^legacy:block_(\d+)\[data=(\d+)\]$/.exec(text)?.slice(1).join(':'));if(!key)throw new Error('方块无法表示为旧 schematic：'+text);return key.split(':').map(Number)})
      const ids=Buffer.alloc(r.blocks.length),data=Buffer.alloc(ids.length),add=Buffer.alloc(Math.ceil(ids.length/2));for(let i=0;i<ids.length;i++){const [id,meta]=mappings[r.blocks[i]];ids[i]=id&255;data[i]=meta;add[i>>1]|=(id>>8)<<(i%2?4:0)}
      root={...p.extra,Materials:tag(8,'Alpha'),Width:tag(2,w>32767?w-65536:w),Height:tag(2,h>32767?h-65536:h),Length:tag(2,l>32767?l-65536:l),Blocks:tag(7,ids),Data:tag(7,data),AddBlocks:tag(7,add),Entities:listTag(r.entities),TileEntities:listTag(r.blockEntities),WEOffsetX:tag(3,r.offset[0]),WEOffsetY:tag(3,r.offset[1]),WEOffsetZ:tag(3,r.offset[2])}
    }
  }
  return writeTypedNbt(tag(10,root),format==='schematic'?'Schematic':'')
}
