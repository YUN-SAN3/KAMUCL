import crypto from 'node:crypto'
import {flatten,stateText,shiftEntity,shiftBlockEntity,type Projection,type ProjectionRegion} from './projectionFormats'
import {writeTypedNbt,tag,type NbtTag} from './typedNbt'
import type {ProjectionFormat} from '../../shared/projections'
function canonical(t:NbtTag):NbtTag {
  if(t.type===10)return tag(10,Object.fromEntries(Object.keys(t.value).sort().map(k=>[k,canonical(t.value[k])])))
  if(t.type===9)return tag(9,t.value.map(canonical),t.elementType)
  return t
}
function tags(items:NbtTag[]){return items.map(t=>writeTypedNbt(tag(10,{value:canonical(t)}),'',false).toString('base64')).sort().join('|')}
function blocks(r:ProjectionRegion){
  const names=r.palette.map(stateText),hash=crypto.createHash('sha256'),chunk=Buffer.alloc(16384),seen=new Uint8Array(names.length)
  hash.update(JSON.stringify({size:r.size,offset:r.offset}))
  // Hash state names rather than palette indexes: writers may add unused air entries.
  for(const i of r.blocks)seen[i]=1
  const used=[...new Set(names.filter((_n,i)=>seen[i]))].sort(),ids=new Map(used.map((n,i)=>[n,i]));hash.update(JSON.stringify(used))
  const mapped=names.map(n=>ids.get(n)??0);let count=0
  for(const i of r.blocks){chunk.writeUInt32BE(mapped[i],count*4);if(++count===4096){hash.update(chunk);count=0}}
  if(count)hash.update(chunk.subarray(0,count*4));return hash.digest('hex')
}
/** Re-read output and compare every voxel and typed entity payload after explicit loss choices. */
export function assertProjectionEquivalent(expected:Projection,actual:Projection,format:ProjectionFormat){
  const regions=(p:Projection)=>format==='litematic'?p.regions:(p.regions.length===1?p.regions:[flatten(p)])
  const a=regions(expected),b=regions(actual)
  if(a.length!==b.length||format!=='schematic'&&(expected.dataVersion||0)!==(actual.dataVersion||0))throw Error('生成文件区域或游戏版本校验失败')
  for(let i=0;i<a.length;i++){
    const left=a[i],right=b[i]
    if(blocks(left)!==blocks(right))throw Error('生成文件方块状态或偏移校验失败')
    if(tags(left.entities.map(t=>shiftEntity(t,left.offset)))!==tags(right.entities.map(t=>shiftEntity(t,right.offset)))||tags(left.blockEntities.map(t=>shiftBlockEntity(t,left.offset)))!==tags(right.blockEntities.map(t=>shiftBlockEntity(t,right.offset))))throw Error('生成文件实体或方块实体校验失败')
    if(format==='litematic'&&(left.name!==right.name||JSON.stringify(left.signedSize||left.size)!==JSON.stringify(right.signedSize||right.size)))throw Error('生成文件区域方向校验失败')
    if(tags([tag(10,left.extra)])!==tags([tag(10,right.extra)]))throw Error('生成文件区域附加标签校验失败')
  }
  if(tags([tag(10,expected.extra)])!==tags([tag(10,actual.extra)]))throw Error('生成文件附加标签校验失败')
  const generated=new Set(['Name','RegionCount','TotalVolume','TotalBlocks'])
  for(const [key,value]of Object.entries(expected.metadata)){if(format==='litematic'&&generated.has(key))continue;if(!actual.metadata[key]||tags([value])!==tags([actual.metadata[key]]))throw Error('生成文件元数据校验失败：'+key)}
}
