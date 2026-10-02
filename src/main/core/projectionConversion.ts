import { minecraftData } from './projectionRegistry'
import type { ProjectionAnalysis, ProjectionChoices, ProjectionDifference, ProjectionFormat } from '../../shared/projections'
import { compound, flatten, position, readProjection, stateTag, stateText, value, writeProjection, type Projection } from './projectionFormats'
import { assertProjectionEquivalent } from './projectionValidation'
export function projectionVersions():{version:string;dataVersion:number;supported:boolean}[]{return (minecraftData as any).versions.pc.filter((v:any)=>v.releaseType==='release'&&/^(1\.20(?:\.\d+)?|1\.21(?:\.\d+)?|26\.\d+(?:\.\d+)?)$/.test(v.minecraftVersion)).map((v:any)=>({version:v.minecraftVersion,dataVersion:v.dataVersion,supported:!!minecraftData(v.minecraftVersion)?.blocksArray}))}
export const versionName=(dataVersion?:number)=>projectionVersions().find((v:any)=>v.dataVersion===dataVersion)?.version
export function validateState(text:string,version:string):string|undefined{
  const t=stateTag(text),c=compound(t),name=value(c,'Name',8),data=minecraftData(version)
  if(!data?.blocksByName) return '目标版本缺少可信方块注册表'
  if(!name.startsWith('minecraft:'))return '目标原版注册表不包含此模组方块'
  const block=data.blocksByName[name.slice(10)] as any;if(!block)return '目标版本没有此方块'
  const props=c.Properties?compound(c.Properties):{},schema=block.states||[]
  for(const [key,v] of Object.entries(props)) { const state=schema.find((s:any)=>s.name===key);if(!state)return '目标版本没有属性 '+key;const values=state.values|| (state.type==='bool'?['true','false']:Array.from({length:state.num_values},(_,i)=>String(i)));if(!values.includes(String(v.value)))return '目标版本不接受 '+key+'='+v.value }
  const missing=schema.filter((s:any)=>!Object.hasOwn(props,s.name)).map((s:any)=>s.name);if(missing.length)return '需要明确选择目标属性：'+missing.join('、')
}
export function analyzeProjection(p:Projection,format:ProjectionFormat,targetVersion?:string):Omit<ProjectionAnalysis,'id'|'sourceHash'>{
  if(!['litematic','schem','schematic','nbt'].includes(format))throw new Error('目标格式无效')
  const sourceVersion=versionName(p.dataVersion),differences:ProjectionDifference[]=[],blocks=p.regions.reduce((n,r)=>n+r.blocks.length,0)
  const result:Omit<ProjectionAnalysis,'id'|'sourceHash'>={sourceFormat:p.format,targetFormat:format,sourceVersion,targetVersion,differences,blocks}
  if(targetVersion && !projectionVersions().find(v=>v.version===targetVersion&&v.supported)){result.unsupported='该版本暂缺可信注册表，未提供版本转换';return result}
  const cross=!!targetVersion&&targetVersion!==sourceVersion
  if(p.format==='litematic'&&format==='litematic'&&(p.raw.Version?.value!==6||p.raw.SubVersion?.value!==1)&&Object.keys(p.raw).length)differences.push({key:'litematicEncoding',kind:'data',description:'将写入已验证的 Litematic v6 / SubVersion 1 编码；原编码版本标签不再保留',count:1,discardOnly:true})
  const spongeUpgrade=p.format==='schem'&&format==='schem'&&(p.raw.Schematic?compound(p.raw.Schematic):p.raw).Version?.value!==3
  if(spongeUpgrade)differences.push({key:'spongeVersion',kind:'data',description:'Sponge 文件版本将升级为 v3；方块、实体与偏移保持，未验证的扩展数据需要逐项舍弃',count:1,discardOnly:true})
  if(cross&&!sourceVersion){result.unsupported='无法确认原文件的现代游戏版本；旧 schematic 仅支持格式导入，不提供完整跨版本转换';return result}
  if(format==='schematic'&&cross){result.unsupported='旧 schematic 无法表示现代版本标签；请选择现代目标格式';return result}
  if(format!=='litematic'){try{const flat=flatten(p);if(format==='nbt'&&flat.blocks.length>180000)result.unsupported='原版结构标签过多；请拆分为不超过 18 万方块的区域'}catch(e){result.unsupported=e instanceof Error?e.message:String(e)}}
  if(p.regions.length>1&&format!=='litematic')differences.push({key:'regions',kind:'data',description:'目标格式只有一个区域，将合并区域，区域名称和有符号选择方向不再保留',count:p.regions.length,discardOnly:true})
  else if(format!=='litematic'&&p.regions.some(r=>r.signedSize?.some(v=>v<0)))differences.push({key:'direction',kind:'data',description:'目标格式保留绝对偏移，但不保留负向选择方向与区域名称',count:1,discardOnly:true})
  if(format==='nbt'&&p.regions.some(r=>r.offset.some(v=>v!==0)))differences.push({key:'nativeOffset',kind:'data',description:'原版结构不支持放置偏移；会保留 KAMUCLOffset 标签供启动器读取，原版游戏将忽略该标签',count:1,discardOnly:true})
  if(format==='schematic'&&p.dataVersion!==1343)differences.push({key:'legacyVersion',kind:'data',description:'旧 schematic 不支持现代游戏版本标签，将保存为 1.12 格式',count:1,discardOnly:true})
  const legacy=new Set<string>(Object.values((minecraftData as any).legacy.pc.blocks))
  for(const [ri,r] of p.regions.entries()){
    const counts=new Map<number,number>();for(const b of r.blocks)counts.set(b,(counts.get(b)||0)+1)
    for(const [pi,t] of r.palette.entries()){
      if(!counts.has(pi))continue
      const text=stateText(t),reason=cross?validateState(text,targetVersion!):format==='schematic'&&!legacy.has(text)&&!text.startsWith('legacy:block_')?'旧 schematic 无法表示此方块状态':format!=='schematic'&&text.startsWith('legacy:block_')?'无法可靠映射旧数值 ID，请选择替代方块或舍弃':undefined
      if(reason)differences.push({key:`block:${ri}:${pi}`,kind:'block',description:text+' · '+reason,count:counts.get(pi)!,replacement:'minecraft:air'})
      const unknown=Object.keys(compound(t)).filter(k=>!['Name','Properties'].includes(k))
      if(unknown.length&&(cross||format==='schem'||format==='schematic'))differences.push({key:`stateExtra:${ri}:${pi}`,kind:'data',description:text+' 的未验证方块状态附加标签：'+unknown.join('、'),count:unknown.length,discardOnly:true})
    }
    for(const [kind,items] of [['entity',r.entities],['blockEntity',r.blockEntities]] as const)for(const [i,t] of items.entries()){
      // Exact typed payload survives format conversion. Cross-version entity schemas require DFU;
      // no unverified migrations are claimed. The user can explicitly discard each payload.
      if(cross || (format==='schematic'&&p.format!=='schematic')){const id=compound(t).id?.value||'未知类型';differences.push({key:`${kind}:${ri}:${i}`,kind,description:`${id}：该版本组合的实体 NBT 迁移规则尚未验证`,count:1,discardOnly:true})}
      else if(kind==='blockEntity'){
        const c=compound(t),pos=['x','y','z'].map(k=>value(c,k,3)),at=pos[0]+pos[2]*r.size[0]+pos[1]*r.size[0]*r.size[2]
        if(differences.some(d=>d.key===`block:${ri}:${r.blocks[at]}`))differences.push({key:`${kind}:${ri}:${i}`,kind,description:'此方块实体对应方块将被替换，需要舍弃其数据',count:1,discardOnly:true})
      }
    }
    if((cross||format!==p.format||spongeUpgrade)&&Object.keys(r.extra).length)differences.push({key:`regionExtra:${ri}`,kind:'data',description:'区域附加标签：'+Object.keys(r.extra).join('、')+'；目标格式或版本不保证语义',count:Object.keys(r.extra).length,discardOnly:true})
  }
  if((cross||format!==p.format||spongeUpgrade)&&Object.keys(p.extra).length)differences.push({key:'extra',kind:'data',description:'附加标签：'+Object.keys(p.extra).join('、')+'；目标格式或版本不保证语义',count:Object.keys(p.extra).length,discardOnly:true})
  if(format==='nbt'&&Object.keys(p.metadata).length)differences.push({key:'metadata',kind:'data',description:'原版结构不支持投影作者等元数据',count:Object.keys(p.metadata).length,discardOnly:true})
  return result
}
export function convertProjection(p:Projection,format:ProjectionFormat,version:string|undefined,choices:ProjectionChoices):Buffer{
  const analysis=analyzeProjection(p,format,version);if(analysis.unsupported)throw new Error(analysis.unsupported)
  for(const difference of analysis.differences){const choice=choices[difference.key];if(!choice)throw new Error('请确认全部差异：'+difference.description);if(difference.discardOnly&&choice!=='discard')throw new Error('此数据仅可舍弃')
    const [kind,ri,pi]=difference.key.split(':');if(kind==='block'){
      const replacement=choice==='discard'?'minecraft:air':choice
      if(version){const reason=validateState(replacement,version);if(reason)throw new Error('替代方块不可用：'+reason)}
      if(format==='schematic'&&!Object.values((minecraftData as any).legacy.pc.blocks).includes(replacement))throw new Error('替代方块无法写入旧 schematic')
      p.regions[+ri].palette[+pi]=stateTag(replacement)
    }
  }
  for(const [ri,r] of p.regions.entries()){r.entities=r.entities.filter((_t,i)=>choices[`entity:${ri}:${i}`]!=='discard');r.blockEntities=r.blockEntities.filter((_t,i)=>choices[`blockEntity:${ri}:${i}`]!=='discard');r.palette=r.palette.map((t,pi)=>choices[`stateExtra:${ri}:${pi}`]==='discard'?stateTag(stateText(t)):t);if(choices[`regionExtra:${ri}`]==='discard')r.extra={}}
  if(choices.extra==='discard')p.extra={};if(choices.metadata==='discard')p.metadata={}
  if(version)p.dataVersion=projectionVersions().find(v=>v.version===version)?.dataVersion
  const bytes=writeProjection(p,format);assertProjectionEquivalent(p,readProjection(bytes,format),format);return bytes
}
