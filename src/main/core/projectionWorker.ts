import { parentPort,workerData } from 'node:worker_threads'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { readProjection,stateText } from './projectionFormats'
import { analyzeProjection,convertProjection,versionName } from './projectionConversion'
try{
  if(fs.statSync(workerData.file).size>64*1024*1024)throw new Error('投影文件超过 64 MB 压缩文件上限');const input=fs.readFileSync(workerData.file)
  const hash=crypto.createHash('sha256').update(input).digest('hex');if(workerData.hash&&hash!==workerData.hash)throw new Error('原文件已变化，请重新分析')
  parentPort?.postMessage({progress:.15,text:'读取投影与校验原文件'})
  const p=readProjection(input,workerData.sourceFormat)
  parentPort?.postMessage({progress:.45,text:'检查区域、方块状态与实体数据'})
  if(workerData.action==='metadata')parentPort?.postMessage({result:{blocks:p.regions.reduce((n,r)=>{const air=r.palette.map(t=>['minecraft:air','minecraft:cave_air','minecraft:void_air'].includes(stateText(t)));for(const i of r.blocks)if(!air[i])n++;return n},0),dataVersion:p.dataVersion,gameVersion:versionName(p.dataVersion)}})
  else if(workerData.action==='analyze')parentPort?.postMessage({result:{...analyzeProjection(p,workerData.format,workerData.version),sourceHash:hash}})
  else{const output=convertProjection(p,workerData.format,workerData.version,workerData.choices);parentPort?.postMessage({progress:.85,text:'重新读取生成文件验证'});const reread=readProjection(output,workerData.format);if(reread.regions.reduce((n,r)=>n+r.blocks.length,0)<p.regions.reduce((n,r)=>n+r.blocks.length,0))throw new Error('生成文件方块数量异常');if(crypto.createHash('sha256').update(fs.readFileSync(workerData.file)).digest('hex')!==hash)throw new Error('转换过程中原文件已变化');parentPort?.postMessage({result:output})}
}catch(e){parentPort?.postMessage({error:e instanceof Error?e.message:String(e)})}
