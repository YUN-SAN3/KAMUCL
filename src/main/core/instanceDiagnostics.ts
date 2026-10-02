import { scanModDirectory } from './modScan'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { DiagnosticFinding, InstanceTarget } from '../../shared/instanceCenter'
import type { JavaInfo } from '../../shared/types'
import { centerTarget, assertInstanceIdle } from './instanceCenter'
import { withGameFolder, assetsDir, defaultFolderPath } from './paths'
import { resolveVersionChain, launchLibraryFiles, clientJarPath } from './versions'
import { invalidLaunchArtifact, ensureLaunchArtifact, type LaunchArtifact } from './launchIntegrity'
import { listJavaSummary, requiredMajor } from './java'
import { getSettings } from './settings'
import { exitHistory } from './exitHistory'
import { getLastLaunch } from './launch'
import { analyzeDiagnosticText } from './diagnosticRules'
import { samePath } from './folderPaths'
import { safePath, type BackupProgress } from './backupStore'
import { withFileJob } from './fileJobs'
import { redactDiagnosticText } from './diagnostics'
import { selectDiagnosticSession } from './diagnosticSession'
const plans=new Map<string,{target:InstanceTarget;files:LaunchArtifact[];metadata:string;time:number}>()
async function tail(file:string){const stat=await fs.promises.stat(file);const size=Math.min(stat.size,2*1024*1024),handle=await fs.promises.open(file,'r');try{const data=Buffer.alloc(size);await handle.read(data,0,size,stat.size-size);return data.toString('utf8')}finally{await handle.close()}}
export async function diagnoseInstance(target:InstanceTarget,signal?:AbortSignal,progress?:BackupProgress):Promise<{id:string;findings:DiagnosticFinding[];java:JavaInfo[];session?:string;requiredJava:number}>{
 const c=centerTarget(target)
 return withGameFolder(c.folder,async()=>{
  const findings:DiagnosticFinding[]=[],{merged,baseId}=resolveVersionChain(target.id),need=requiredMajor(merged)
  const java=(await listJavaSummary()).filter(j=>j.major===need&&j.is64Bit&&(!j.architecture||j.architecture===process.arch||(process.arch==='x64'&&j.architecture==='amd64')))
  const configured=c.json._javaAuto?undefined:c.json._javaPath||(!getSettings().javaAuto?getSettings().javaPath:undefined)
  if(configured&&!fs.existsSync(configured))findings.push({rule:'java-missing',title:'指定的 Java 已不存在',confidence:'certain',evidence:redactDiagnosticText(configured),advice:`为本实例选择 Java ${need}。`,action:'java'})
  else if(configured){const selected=(await listJavaSummary()).find(j=>samePath(j.path,configured));if(selected&&(selected.major!==need||!selected.is64Bit))findings.push({rule:'java-selection',title:'指定 Java 与实例需求不一致',confidence:'certain',evidence:`需要 Java ${need}（64 位），当前为 Java ${selected.major}`,advice:'从兼容列表中重新选择。',action:'java'})}
  else if(!java.length)findings.push({rule:'java-unavailable',title:'未发现已登记的兼容 Java',confidence:'possible',evidence:`实例需求：Java ${need}（64 位）`,advice:'在 Java 管理中扫描或安装适配运行时。',action:'java'})
  const files:LaunchArtifact[]=[{...merged.downloads?.client,dest:clientJarPath(baseId)},...launchLibraryFiles(merged)]
  const asset=merged.assetIndex
  if(asset&&/^[\w.-]+$/.test(asset.id)&&asset.id!=='.'&&asset.id!=='..')files.push({...asset,dest:path.join(assetsDir(),'indexes',asset.id+'.json')})
  const bad:LaunchArtifact[]=[]
  async function check(file:LaunchArtifact){signal?.throwIfAborted();const reason=await invalidLaunchArtifact(file);if(reason){bad.push(file);if(findings.filter(f=>f.rule==='files').length<10)findings.push({rule:'files',title:'运行文件缺失或损坏',confidence:'certain',evidence:path.basename(file.dest)+'：'+reason,advice:file.url?'校验并修复运行文件。':'元数据缺少下载地址，请重新安装对应加载器。',action:file.url?'files':undefined})}}
  for(let i=0;i<files.length;i++){await check(files[i]);progress?.(i+1,files.length,'检查运行文件')}
  if(asset&&!bad.some(f=>f.dest.endsWith('/'+asset.id+'.json')||path.basename(f.dest)===asset.id+'.json')){
    try{const index=JSON.parse(await fs.promises.readFile(path.join(assetsDir(),'indexes',asset.id+'.json'),'utf8'));const objects=Object.values(index.objects||{}) as Array<{hash:string;size:number}>;for(let i=0;i<objects.length;i++){const o=objects[i];if(!/^[a-f0-9]{40}$/.test(o.hash))continue;await check({dest:path.join(assetsDir(),'objects',o.hash.slice(0,2),o.hash),sha1:o.hash,size:o.size,url:'https://resources.download.minecraft.net/'+o.hash.slice(0,2)+'/'+o.hash});if(i%64===0)progress?.(i,objects.length,'检查语言与声音资源')}}catch(e){if(signal?.aborted)throw e}
  }
  const latest=getLastLaunch(),hist=exitHistory().list().filter(e=>e.kind==='game'&&e.context?.effectiveGameDir&&samePath(String(e.context.effectiveGameDir),c.dir)&&e.context.versionId===target.id)
  const context=selectDiagnosticSession(target.id,c.dir,[...(latest?[latest]:[]),...hist.map(e=>e.context!)])
  let session:string|undefined
  if(context?.logDir&&context.startedAt){session=String(context.startedAt);const logDir=String(context.logDir);let text='';for(const name of ['stdout.log','stderr.log'])try{const f=await safePath(logDir,name);text+='\n'+await tail(f)}catch{};findings.push(...analyzeDiagnosticText(text))}
  else findings.push({rule:'no-session',title:'暂无该实例的启动日志',confidence:'unknown',evidence:'只展示本次环境检查结果，未读取其他实例或旧目录的日志。',advice:'下次通过 KAMUCL 启动失败后可查看对应会话原因。'})
  if(findings.some(f=>f.action==='mods'))try{const mods=await scanModDirectory(path.join(c.dir,'mods'),false);for(const f of findings.filter(f=>f.action==='mods'))f.mods=mods.filter(m=>f.evidence.includes(m.fileName)||(m.id&&new RegExp('(?:^|[^a-zA-Z0-9_])'+m.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^a-zA-Z0-9_])').test(f.evidence))).map(m=>({fileName:m.fileName,name:m.name||m.fileName,icon:m.iconDataUrl}))}catch{}
  for(const[id,p]of plans)if(Date.now()-p.time>30*60*1000)plans.delete(id)
  const id=crypto.randomUUID();plans.set(id,{target:c.target,files:bad.filter(f=>f.url),metadata:JSON.stringify(merged),time:Date.now()})
  return {id,findings,java,session,requiredJava:need}
 })
}
export async function repairInstanceFiles(planId:string,signal?:AbortSignal,progress?:BackupProgress){
 const p=plans.get(planId);if(!p||Date.now()-p.time>30*60*1000)throw new Error('检查结果已过期，请重新检查')
 const c=centerTarget(p.target);await assertInstanceIdle(c.dir)
 return withGameFolder(c.folder,async()=>{if(JSON.stringify(resolveVersionChain(p.target.id).merged)!==p.metadata)throw new Error('实例版本配置已变化，请重新检查');let done=0;for(const f of p.files){signal?.throwIfAborted();await assertInstanceIdle(c.dir);const roots=[c.folder,defaultFolderPath()];const root=roots.find(r=>{const rel=path.relative(r,f.dest);return rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)});if(!root)throw new Error('修复路径超出游戏目录');await safePath(root,path.relative(root,f.dest).split(path.sep).join('/'),true);await withFileJob(f.dest,signal,()=>ensureLaunchArtifact(f,getSettings().mirror,undefined,signal));progress?.(++done,p.files.length,`修复文件 ${done}/${p.files.length}`)}plans.delete(planId);return done})
}
