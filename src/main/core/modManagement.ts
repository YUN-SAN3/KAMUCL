import { protectModChange } from './changeProtection'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { CommunityFile, CommunitySource, LoaderName } from '../../shared/types'
import type { ManagedMod, ModOperationResult, ModVersionChoices, ModChangePlan } from '../../shared/modManagement'
import { scanManagedModDirectory } from './modScan'
import { resolveResourceDirectory } from './resourceDirectory'
import { withGameFolder, gameDir } from './paths'
import { readVersionJson, listAllInstalled } from './versions'
import { resolveInstanceMetadata } from './instanceMetadata'
import { getRunningVersionIds } from './launch'
import { withFileJob } from './fileJobs'
import { communityFiles, communityExactFile, cfChannel } from './community'
import { httpFetch } from './httpClient'
import { isModLocked, modIdentity, rememberModIdentity, setModLocked, transferModLock } from './modState'
import { modHash, safeModName, validateModFile, replaceModFiles, type ModReplacement } from './modTransaction'
import { ModPlanStore } from './modPlanStore'
const MR='https://api.modrinth.com/v2'
async function json(url:string,body?:unknown,headers:Record<string,string>={}){const r=await httpFetch(url,{method:body?'POST':'GET',headers:{'User-Agent':'KAMUCL (github.com/kamubaba-i/KAMUCL)','Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('社区请求失败 HTTP '+r.status);return r.json() as Promise<any>}
export async function assertModsIdle(dir:string){const running=getRunningVersionIds();for(const v of listAllInstalled().filter(v=>running.has(v.id))){const other=await resolveResourceDirectory(v.folder||gameDir(),v.id,'mods');if(path.resolve(other).toLowerCase()===path.resolve(dir).toLowerCase())throw new Error('使用该模组目录的游戏正在运行，请先退出游戏')}}
export async function modCatalog(versionId:string,folder:string):Promise<ManagedMod[]>{const dir=await resolveResourceDirectory(folder,versionId,'mods');const entries=await scanManagedModDirectory(dir,'catalog');return entries.map(i=>({fileName:i.fileName,name:i.name||i.fileName,version:i.version||'',sha1:i.sha1,fingerprint:i.fingerprint,identity:i.sha1?modIdentity(dir,i.sha1):undefined,locked:i.sha1?isModLocked(dir,i.sha1):false,error:i.error}))}
export async function setModsEnabled(versionId:string,folder:string,names:string[],enabled:boolean):Promise<ModOperationResult[]>{const dir=await resolveResourceDirectory(folder,versionId,'mods');return withFileJob(dir,undefined,async()=>{await assertModsIdle(dir);if(!Array.isArray(names)||names.length>10000)throw new Error('单次最多处理10000个模组');const validNames=[...new Set(names)].filter(n=>{try{safeModName(n);return true}catch{return false}});if(validNames.length)await protectModChange(dir,validNames.flatMap(n=>[n,n.replace(/\.disabled$/i,'')+(enabled?'':'.disabled')]),'批量启停模组前');const result:ModOperationResult[]=[];for(const name of [...new Set(names)]){try{safeModName(name);const base=name.replace(/\.disabled$/i,''),target=base+(enabled?'':'.disabled');if(!fs.existsSync(path.join(dir,name))&&fs.existsSync(path.join(dir,target))){await validateModFile(dir,target);result.push({fileName:name,name:target,ok:true});continue}await validateModFile(dir,name);if(name!==target){if(fs.existsSync(path.join(dir,target)))throw new Error('目标文件已存在，未覆盖');await fs.promises.copyFile(path.join(dir,name),path.join(dir,target),fs.constants.COPYFILE_EXCL);try{await fs.promises.unlink(path.join(dir,name))}catch(e){await fs.promises.unlink(path.join(dir,target));throw e}}result.push({fileName:name,name:target,ok:true})}catch(e){result.push({fileName:name,ok:false,error:String(e)})}}return result})}
export async function identify(dir:string,mods:ManagedMod[]):Promise<void>{
 const missing=mods.filter(m=>m.sha1&&modIdentity(dir,m.sha1).startsWith('sha1:'));if(!missing.length)return
 const byHash:Record<string,any>={}
 for(let i=0;i<missing.length;i+=1000)Object.assign(byHash,await json(MR+'/version_files',{hashes:missing.slice(i,i+1000).map(m=>m.sha1),algorithm:'sha1'}))
 for(const m of missing){const id=byHash[m.sha1]?.project_id;if(id)rememberModIdentity(dir,m.sha1,'modrinth:'+id)}
 const cf=missing.filter(m=>!byHash[m.sha1]?.project_id&&m.fingerprint!==undefined);if(!cf.length)return
 const channel=cfChannel(),r=await json(channel.base+'/fingerprints',{fingerprints:cf.map(m=>m.fingerprint)},channel.key?{'x-api-key':channel.key}:{})
 for(const m of cf){const matched=r.data?.exactMatches?.find((x:any)=>x.file?.fileFingerprint===m.fingerprint&&x.file?.hashes?.some((h:any)=>h.algo===1&&h.value?.toLowerCase()===m.sha1));if(matched)rememberModIdentity(dir,m.sha1,'curseforge:'+(matched.file.modId||matched.id))}
}
export async function lockMods(versionId:string,folder:string,names:string[],locked:boolean):Promise<ModOperationResult[]>{const dir=await resolveResourceDirectory(folder,versionId,'mods');return withFileJob(dir,undefined,async()=>{const mods=(await modCatalog(versionId,folder)).filter(m=>names.includes(m.fileName));try{await identify(dir,mods)}catch{/* Hash identity remains stable when offline. */}return Promise.all(names.map(async name=>{try{safeModName(name);const m=mods.find(m=>m.fileName===name);if(!m?.sha1)throw new Error('无法校验模组文件');await validateModFile(dir,name,m.sha1);setModLocked(dir,m.sha1,locked);return {fileName:name,ok:true}}catch(e){return {fileName:name,ok:false,error:String(e)}}}))})}
const choices=new ModPlanStore<{value:ModVersionChoices;dir:string;folder:string;versionId:string;mods:ManagedMod[]}>()
const changes=new ModPlanStore<{view:ModChangePlan;sourceId:string;dir:string;replacements:ModReplacement[];mods:ManagedMod[];lockHash:string}>()
const dependencyChanges=new ModPlanStore<{dir:string;replacements:ModReplacement[];mods:ManagedMod[]}>()
/** Closing a list also retires its unused plans; running transactions finish
 * against their own leases before those snapshots are actually released. */
export function discardModVersionPlan(id:string):void {
 if(typeof id!=='string'||id.length>64)return
 choices.delete(id);changes.delete(id);dependencyChanges.delete(id)
 changes.deleteMatching(change=>change.sourceId===id)
}
function compatible(f:CommunityFile,mc:string,loader:string){return /^https:\/\//.test(f.url)&&/^[a-f0-9]{40}$/i.test(f.sha1||'')&&f.gameVersions.includes(mc)&&f.loaders.includes(loader)&&path.basename(f.fileName)===f.fileName&&!/[\\/:\0]/.test(f.fileName)&&/\.jar$/i.test(f.fileName)}
export async function modVersionChoices(versionId:string,folder:string,fileName:string):Promise<ModVersionChoices>{
 safeModName(fileName);const dir=await resolveResourceDirectory(folder,versionId,'mods'),mods=await modCatalog(versionId,folder);const mod=mods.find(m=>m.fileName===fileName);if(!mod?.sha1)throw new Error('无法读取该模组，请刷新后重试');await identify(dir,mods)
 const identity=modIdentity(dir,mod.sha1);if(identity.startsWith('sha1:'))throw new Error('未能在社区精确识别此文件，无法可靠提供其他版本；可手动下载并导入。')
 const [source,id]=identity.split(':') as [CommunitySource,string]
 const meta=await withGameFolder(folder,()=>resolveInstanceMetadata(readVersionJson(versionId),id=>{try{return readVersionJson(id)}catch{return undefined}}))
 if(!meta.mcVersion||!meta.loader)throw new Error('实例缺少游戏或加载器版本信息')
 const files=(await communityFiles(source,id,{kind:'mod',mcVersion:meta.mcVersion,loader:meta.loader})).filter(f=>compatible(f,meta.mcVersion!,meta.loader!))
 const value:ModVersionChoices={id:crypto.randomUUID(),fileName,name:mod.name,currentVersion:mod.version,mcVersion:meta.mcVersion,loader:meta.loader,locked:isModLocked(dir,mod.sha1),files};choices.set(value.id,{value,dir,folder,versionId,mods});return value
}
export async function planModVersionChange(id:string,fileId:string):Promise<ModChangePlan>{
 const c=choices.get(id);if(!c)throw new Error('版本列表已过期，请重新打开');const file=c.value.files.find(f=>f.fileId===fileId);if(!file)throw new Error('请选择列表内的适配版本');const mod=c.mods.find(m=>m.fileName===c.value.fileName)!,disabled=/\.disabled$/i.test(mod.fileName)
 const warnings:string[]=[],replacements:ModReplacement[]=[{oldName:mod.fileName,oldSha1:mod.sha1,name:file.fileName+(disabled?'.disabled':''),sha1:file.sha1!,url:file.url,size:file.size}],files:ModChangePlan['files']=[{fileName:file.fileName,version:file.version,dependency:false}]
 if(isModLocked(c.dir,mod.sha1))warnings.push('此模组已锁定。确认后仅本次切换版本，新文件仍保持锁定。')
 const queue=[file],visited=new Set([file.source+':'+file.projectId]),used=new Set([file.fileName.toLowerCase()])
 for(let i=0;i<queue.length;i++){if(queue.length>100)throw new Error('前置依赖过多，请手动处理');for(const d of queue[i].dependencies||[]){if(!d.required||disabled)continue;const source=queue[i].source||'modrinth',key=source+':'+d.projectId;if(visited.has(key))continue;visited.add(key)
  const installed=c.mods.find(m=>modIdentity(c.dir,m.sha1)===key&&!/\.disabled$/i.test(m.fileName)&&m.fileName!==mod.fileName)
  if(installed&&!d.fileId)continue
  try{const f=d.fileId?await communityExactFile(source,d.projectId,d.fileId):(await communityFiles(source,d.projectId||'',{kind:'mod',mcVersion:c.value.mcVersion,loader:c.value.loader as LoaderName})).find(f=>compatible(f,c.value.mcVersion,c.value.loader));if(!f||!compatible(f,c.value.mcVersion,c.value.loader))throw new Error('无兼容版本');if(installed){if(installed.sha1!==f.sha1)warnings.push(`${installed.fileName} 与所需前置版本 ${f.version} 不一致，本次保留原文件，请检查兼容性`);continue}if(used.has(f.fileName.toLowerCase()))throw new Error('前置文件名冲突');used.add(f.fileName.toLowerCase());replacements.push({name:f.fileName,sha1:f.sha1!,url:f.url,size:f.size});files.push({fileName:f.fileName,version:f.version,dependency:true});queue.push(f)}catch(e){warnings.push(`必要前置 ${d.projectId||d.fileId||'未知'} 未安装：${String(e)}`)}
 }}
 let changelog='暂无版本说明'
 try{if(file.source==='modrinth')changelog=(await json(MR+'/version/'+encodeURIComponent(file.fileId))).changelog||changelog;else if(file.projectId){const channel=cfChannel();changelog=(await json(channel.base+'/mods/'+file.projectId+'/files/'+file.fileId+'/changelog',undefined,channel.key?{'x-api-key':channel.key}:{})).data||changelog}}catch{changelog='版本说明暂时无法获取，不影响已校验的适配文件选择'}
 // Discard/expiry can overtake remote dependency or changelog responses.
 if(choices.get(id)!==c)throw new Error('版本列表已关闭或过期，请重新打开')
 const view:ModChangePlan={id:crypto.randomUUID(),fileName:mod.fileName,target:file,files,warnings,changelog:String(changelog).replace(/<[^>]*>/g,'').slice(0,20000)};changes.set(view.id,{view,sourceId:id,dir:c.dir,replacements,mods:c.mods,lockHash:mod.sha1});return view
}
async function validateSnapshot(dir:string,mods:ManagedMod[]){const names=(await fs.promises.readdir(dir)).filter(n=>/\.jar(?:\.disabled)?$/i.test(n)).sort();if(JSON.stringify(names)!==JSON.stringify(mods.map(m=>m.fileName).sort()))throw new Error('检查后模组列表发生变化，请重新检查');for(const m of mods)await validateModFile(dir,m.fileName,m.sha1)}
export async function applyModVersionChange(id:string,confirmed:boolean){
 const c=changes.get(id);if(!c)throw new Error('切换计划已过期');if((c.view.warnings.length||isModLocked(c.dir,c.lockHash))&&confirmed!==true)throw new Error('请确认锁定模组与前置提醒')
 const lease=changes.lease(id);if(!lease)throw new Error('切换计划已过期')
 try{return await withFileJob(c.dir,undefined,async()=>{await assertModsIdle(c.dir);await validateSnapshot(c.dir,c.mods);await replaceModFiles(c.dir,c.replacements,async()=>{await assertModsIdle(c.dir);await validateSnapshot(c.dir,c.mods);if(isModLocked(c.dir,c.lockHash)&&confirmed!==true)throw new Error('模组已锁定，请重新确认')});transferModLock(c.dir,c.lockHash,c.replacements[0].sha1);changes.delete(id);return {ok:true}})}finally{lease.release()}
}

/** Resolve required files from the exact installed release, never from a name search. */
export async function planMissingDependencies(versionId:string,folder:string,fileName:string):Promise<ModChangePlan>{
 const list=await modVersionChoices(versionId,folder,fileName)
 let planId:string|undefined
 try{
 const c=choices.get(list.id)!,mod=c.mods.find(m=>m.fileName===fileName)!
 if(/\.disabled$/i.test(fileName))throw new Error('该模组已禁用，无需安装运行前置')
 const exact=list.files.find(f=>f.sha1===mod.sha1)
 if(!exact)throw new Error('社区列表中没有与本地哈希完全一致的版本，无法可靠确定前置，请手动核对')
 const plan=await planModVersionChange(list.id,exact.fileId),change=changes.get(plan.id)!
 planId=plan.id
 const warnings=plan.warnings.filter(w=>!w.startsWith('此模组已锁定'))
 if(warnings.length){changes.delete(plan.id);throw new Error('无法完整确定兼容前置：'+warnings.join('；'))}
 const files=plan.files.filter(f=>f.dependency)
 if(!files.length){changes.delete(plan.id);throw new Error('社区元数据未发现可安全补充的缺失前置，请核对日志中的版本限制')}
 // A distinct store prevents these plans being applied by the version-change endpoint.
 changes.delete(plan.id);dependencyChanges.set(plan.id,{dir:change.dir,mods:change.mods,replacements:change.replacements.slice(1)})
 return {...plan,files,warnings:[],changelog:'仅补充所列必要前置，保留当前模组及其锁定状态。'}
 }finally{choices.delete(list.id);if(planId)changes.delete(planId)}
}
export async function applyMissingDependencies(id:string,confirmed:boolean,signal?:AbortSignal,onProgress?:(fraction:number)=>void){
 const c=dependencyChanges.get(id);if(!c||!confirmed)throw new Error('请重新检查并确认前置安装清单')
 const lease=dependencyChanges.lease(id);if(!lease)throw new Error('请重新检查并确认前置安装清单')
 try{return await withFileJob(c.dir,signal,async()=>{await assertModsIdle(c.dir);await validateSnapshot(c.dir,c.mods);await replaceModFiles(c.dir,c.replacements,async()=>{await assertModsIdle(c.dir);await validateSnapshot(c.dir,c.mods)},signal,onProgress);dependencyChanges.delete(id);return {ok:true}})}finally{lease.release()}
}
