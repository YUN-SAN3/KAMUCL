import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { app, nativeImage } from 'electron'
import type { InstanceTarget, InstanceOverview, InstanceWorld, InstanceScreenshot } from '../../shared/instanceCenter'
import { safePath, safeRelative, copyVerified, scanFiles, type BackupProgress } from './backupStore'
import { instanceBackups } from './changeProtection'
import { instanceDirectoryState } from './instances'
import { listAllInstalled, readVersionJson, resolveVersionChain, clientJarPath, type VersionJson } from './versions'
import { withGameFolder, registerVersionFolder } from './paths'
import { samePath } from './folderPaths'
import { getSettings } from './settings'
import { getRunningVersionIds } from './launch'
import { resolveInstanceMetadata } from './instanceMetadata'
import { exportModState, importModState } from './modState'
import { parseNbt } from './nbt'
import { withFileJob } from './fileJobs'
import { externalGameUsesDirectory } from './gameDirectoryUse'

const OMIT = new Set(['versions','libraries','assets','runtimes','runtime','.kamucl','logs','crash-reports','natives','backups','.installing','session.lock','kamucl-logs','.git','launcher_accounts.json','launcher_profiles.json','accounts.json'])
export function validateInstanceName(name:string) {
  if(typeof name!=='string'||name.trim()!==name||name.length>120||!name||/[\\/:*?"<>|\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)||name==='.'||name==='..') throw new Error('实例名称无效，请使用不含路径符号的名称')
  return name
}
export function centerTarget(target:InstanceTarget) {
  validateInstanceName(target.id)
  if(!getSettings().folders.some(f=>samePath(f.path,target.folder)))throw new Error('游戏文件夹尚未登记')
  const folder=fs.realpathSync(target.folder)
  const json=withGameFolder(folder,()=>readVersionJson(target.id))
  const state=instanceDirectoryState(target.id,json,folder)
  if(!fs.existsSync(state.path))throw new Error('实例目录不存在')
  const dir=fs.realpathSync(state.path)
  if(!samePath(state.path,dir))throw new Error('实例目录不能是符号链接')
  return {folder,dir,json,state,target:{folder,id:target.id}}
}
export async function assertInstanceIdle(dir:string) {
  const running=getRunningVersionIds()
  for(const v of listAllInstalled().filter(v=>running.has(v.id))){
    const j=withGameFolder(v.folder,()=>readVersionJson(v.id))
    if(samePath(instanceDirectoryState(v.id,j,v.folder).path,dir))throw new Error('使用该目录的游戏正在运行，请退出游戏后重试')
  }
  if(await externalGameUsesDirectory(dir))throw new Error('另一个启动器的游戏正在使用此目录，请退出游戏后重试')
}
export async function playerRoots(dir:string,id:string,saves=true,screenshots=false) {
  const names=await fs.promises.readdir(dir)
  return names.filter(n=>!OMIT.has(n.toLowerCase())&&!n.startsWith('.kamucl-')&&!/\.exe$|\.dll$|\.json\.kamucl-bak$/i.test(n)&&n!==id+'.json'&&n!==id+'.jar'&&(saves||n!=='saves')&&(screenshots||n!=='screenshots'))
}
export async function centerOverview(target:InstanceTarget):Promise<InstanceOverview>{
  const c=centerTarget(target),meta=withGameFolder(c.folder,()=>resolveInstanceMetadata(c.json,id=>{try{return readVersionJson(id)}catch{return undefined}}))
  let running=false;try{await assertInstanceIdle(c.dir)}catch{running=true}
  return {target:c.target,directory:c.dir,shared:!c.state.isolated,name:target.id,mcVersion:meta.mcVersion,loader:meta.loader,running,roots:await playerRoots(c.dir,target.id,true,true)}
}
function selfContained(c:ReturnType<typeof centerTarget>,id:string):{json:VersionJson;jar:string}{
  return withGameFolder(c.folder,()=>{
    const {merged,baseId}=resolveVersionChain(c.target.id)
    for(const[k,v]of Object.entries(c.json))if(k.startsWith('_'))(merged as any)[k]=v
    merged.id=id;merged._gameDir=true;merged._flattenedAt=new Date().toISOString();merged._mcVersion=resolveInstanceMetadata(c.json,p=>{try{return readVersionJson(p)}catch{return undefined}}).mcVersion
    delete merged.inheritsFrom;delete (merged as any)._gameDirectory;delete (merged as any).gameDirectory
    delete (merged as any)._displayName
    return {json:merged,jar:clientJarPath(baseId)}
  })
}
async function stageInstance(c:ReturnType<typeof centerTarget>,stage:string,id:string,saves:boolean,screenshots:boolean,signal?:AbortSignal,progress?:BackupProgress){
  const roots=await playerRoots(c.dir,c.target.id,saves,screenshots),inputs=await scanFiles(c.dir,roots,signal)
  const space=await fs.promises.statfs(stage)
  if(space.bavail*space.bsize<inputs.reduce((n,f)=>n+f.size,0)+16*1024*1024)throw new Error('目标目录磁盘空间不足')
  let done=0
  for(const f of inputs){await copyVerified(await safePath(c.dir,f.path),path.join(stage,f.path),signal);progress?.(++done,inputs.length,`复制文件 ${done}/${inputs.length}`)}
  if(JSON.stringify(inputs)!==JSON.stringify(await scanFiles(c.dir,roots,signal)))throw new Error('复制期间实例文件发生变化，请重试')
  const {json,jar}=selfContained(c,id)
  await fs.promises.writeFile(path.join(stage,id+'.json'),JSON.stringify(json,null,2))
  if(fs.existsSync(jar))await copyVerified(jar,path.join(stage,id+'.jar'),signal)
  else if(!json.downloads?.client?.url)throw new Error('缺少游戏本体及下载元数据，无法创建独立副本')
}
export async function backupInstance(target:InstanceTarget,title='实例手动备份',automatic=false,world?:string,signal?:AbortSignal,progress?:BackupProgress){
  const c=centerTarget(target)
  return withFileJob(c.dir,signal,()=>withFileJob(path.join(c.dir,'mods'),signal,async()=>{
    await assertInstanceIdle(c.dir)
    const store=instanceBackups(c.dir)
    if(world){safeRelative(world);if(world.includes('/'))throw new Error('无效存档');return store.create(c.dir,['saves/'+world],title,automatic,{type:'world',target:c.target,world},signal,progress)}
    const stage=await fs.promises.mkdtemp(path.join(app.getPath('temp'),'kamucl-backup-'))
    try{
      await stageInstance(c,stage,target.id,true,true,signal,progress)
      return await store.create(stage,await fs.promises.readdir(stage),title,automatic,{type:'instance',target:c.target,modState:exportModState(path.join(c.dir,'mods'))},signal,progress)
    }finally{await fs.promises.rm(stage,{recursive:true,force:true})}
  }))
}
export async function cloneInstance(target:InstanceTarget,name:string,destinationFolder:string,saves=true,screenshots=false,signal?:AbortSignal,progress?:BackupProgress,restoreId?:string){
  validateInstanceName(name)
  const c=centerTarget(target)
  if(!getSettings().folders.some(f=>samePath(f.path,destinationFolder)))throw new Error('请选择已登记的目标游戏文件夹')
  const parent=path.join(fs.realpathSync(destinationFolder),'versions');await fs.promises.mkdir(parent,{recursive:true})
  const dest=await safePath(parent,name,true)
  return withFileJob(c.dir,signal,()=>withFileJob(path.join(c.dir,'mods'),signal,()=>withFileJob(dest,signal,async()=>{
    await assertInstanceIdle(c.dir)
    if(fs.existsSync(dest))throw new Error('目标实例已存在，请更换名称')
    const stage=await fs.promises.mkdtemp(path.join(parent,'.kamucl-instance-'))
    let published=false
    try{
      let state:unknown=exportModState(path.join(c.dir,'mods'))
      if(restoreId){
        const backups=instanceBackups(c.dir),m=await backups.verify(restoreId,signal)
        if(m.metadata?.type==='world')throw new Error('请在存档页面恢复此备份')
        if(m.metadata?.type==='instance'){
          await backups.materialize(restoreId,stage,signal,progress)
          const old=(m.metadata.target as InstanceTarget).id;validateInstanceName(old)
          const json=JSON.parse(await fs.promises.readFile(await safePath(stage,old+'.json'),'utf8')) as VersionJson
          json.id=name;json._gameDir=true;delete (json as any)._gameDirectory;delete (json as any).gameDirectory;delete json.inheritsFrom
          await fs.promises.unlink(path.join(stage,old+'.json'))
          await fs.promises.writeFile(path.join(stage,name+'.json'),JSON.stringify(json,null,2))
          if(fs.existsSync(path.join(stage,old+'.jar'))&&old!==name)await fs.promises.rename(path.join(stage,old+'.jar'),path.join(stage,name+'.jar'))
        }else{
          await stageInstance(c,stage,name,true,true,signal,progress)
          for(const root of m.roots)await fs.promises.rm(await safePath(stage,root,true),{recursive:true,force:true})
          await backups.materialize(restoreId,stage,signal,progress)
        }
        state=m.metadata?.modState||state
      }else await stageInstance(c,stage,name,saves,screenshots,signal,progress)
      await assertInstanceIdle(c.dir);signal?.throwIfAborted()
      await fs.promises.rename(stage,dest);published=true
      importModState(path.join(dest,'mods'),state)
      registerVersionFolder(name,destinationFolder)
      return {folder:destinationFolder,id:name}
    }catch(e){if(published)await fs.promises.rm(dest,{recursive:true,force:true});throw e}
    finally{await fs.promises.rm(stage,{recursive:true,force:true})}
  })))
}
async function smallImage(dir:string,rel:string):Promise<string|undefined>{try{const file=await safePath(dir,rel),s=await fs.promises.stat(file);if(s.size>64*1024*1024)return;const image=nativeImage.createFromBuffer(await fs.promises.readFile(file));if(image.isEmpty())return;return image.resize({width:Math.min(360,image.getSize().width)}).toDataURL()}catch{return}}
export async function centerWorlds(target:InstanceTarget):Promise<InstanceWorld[]>{
  const c=centerTarget(target),saves=await safePath(c.dir,'saves',true),rows:InstanceWorld[]=[]
  for(const id of await fs.promises.readdir(saves).catch(()=>[] as string[])){
    const row:InstanceWorld={id,name:id}
    try{const file=await safePath(c.dir,'saves/'+id+'/level.dat');const stat=await fs.promises.stat(file);if(stat.size>32*1024*1024)throw new Error('level.dat 超过读取限制');const n=parseNbt(await fs.promises.readFile(file)) as any,d=n.Data||n;row.name=String(d.LevelName||id);row.version=d.Version?.Name;row.mode=['生存','创造','冒险','旁观'][d.GameType];row.lastPlayed=Number(d.LastPlayed)||stat.mtimeMs;row.icon=await smallImage(c.dir,'saves/'+id+'/icon.png')}
    catch(e){row.error=String(e)} rows.push(row)
  }
  return rows.sort((a,b)=>(b.lastPlayed||0)-(a.lastPlayed||0))
}
export async function centerScreenshots(target:InstanceTarget,page:number):Promise<{total:number;items:InstanceScreenshot[]}>{
  const c=centerTarget(target),dir=await safePath(c.dir,'screenshots',true)
  const names=(await fs.promises.readdir(dir).catch(()=>[] as string[])).filter(n=>/\.png$/i.test(n)).sort().reverse()
  page=Math.max(0,Math.floor(Number(page)||0))
  const items:InstanceScreenshot[]=[]
  for(const id of names.slice(page*24,(page+1)*24)){const image=await smallImage(c.dir,'screenshots/'+id);if(image)items.push({id,image,date:(await fs.promises.stat(path.join(dir,id))).mtimeMs})}
  return {total:names.length,items}
}
export async function restoreWorld(target:InstanceTarget,backupId:string,name:string,overwrite:boolean,signal?:AbortSignal,progress?:BackupProgress){
  validateInstanceName(name);const c=centerTarget(target),backups=instanceBackups(c.dir),m=await backups.verify(backupId,signal)
  if(m.metadata?.type!=='world')throw new Error('请选择存档备份')
  const original=String(m.metadata.world);validateInstanceName(original)
  return withFileJob(c.dir,signal,async()=>{
    await assertInstanceIdle(c.dir)
    await fs.promises.mkdir(path.join(c.dir,'saves'),{recursive:true})
    const dest=await safePath(c.dir,'saves/'+name,true),exists=fs.existsSync(dest)
    if(exists&&!overwrite)throw new Error('同名存档已存在，请换一个名称或明确选择覆盖')
    const before=JSON.stringify(await scanFiles(c.dir,['saves/'+name],signal))
    if(exists)await backups.create(c.dir,['saves/'+name],'存档覆盖恢复前',false,{type:'world',world:name,target:c.target},signal,progress)
    const stage=await fs.promises.mkdtemp(path.join(c.dir,'.kamucl-world-')),old=path.join(stage,'old')
    let preserve=false
    try{
      await backups.materialize(backupId,stage,signal,progress)
      await assertInstanceIdle(c.dir);signal?.throwIfAborted()
      if(exists!==fs.existsSync(dest)||before!==JSON.stringify(await scanFiles(c.dir,['saves/'+name],signal)))throw new Error('准备恢复期间存档发生变化，请重试')
      if(exists)await fs.promises.rename(dest,old)
      try{await fs.promises.rename(path.join(stage,'saves',original),dest)}catch(e){if(exists)try{await fs.promises.rename(old,dest)}catch{preserve=true;throw new Error('恢复提交失败，原存档保留于 '+old)}throw e}
      return name
    }finally{if(!preserve)await fs.promises.rm(stage,{recursive:true,force:true})}
  })
}
export async function restoreInstanceInPlace(target:InstanceTarget,backupId:string,signal?:AbortSignal,progress?:BackupProgress){
 const c=centerTarget(target),backups=instanceBackups(c.dir),m=await backups.verify(backupId,signal)
 if(!c.state.isolated||!samePath(c.dir,path.join(c.folder,'versions',target.id)))throw new Error('共享或自定义目录请恢复为新的隔离实例')
 if(m.metadata?.type==='world')throw new Error('请使用存档恢复')
 const roots=[...await playerRoots(c.dir,target.id,true,true),target.id+'.json',target.id+'.jar']
 const beforeFiles=JSON.stringify(await scanFiles(c.dir,roots,signal)),beforeLocks=JSON.stringify(exportModState(path.join(c.dir,'mods')))
 // Create a complete recoverable manual record before touching the destination.
 await backupInstance(target,'实例覆盖恢复前',false,undefined,signal,progress)
 const name='restore-'+crypto.randomUUID()
 const result=await cloneInstance(target,name,c.folder,true,true,signal,progress,backupId)
 const staging=path.join(c.folder,'versions',result.id),old=path.join(c.folder,'versions','.kamucl-restore-old-'+crypto.randomUUID())
 let keepOld=false
 try{
  return await withFileJob(c.dir,signal,()=>withFileJob(path.join(c.dir,'mods'),signal,async()=>{
   await assertInstanceIdle(c.dir);signal?.throwIfAborted()
   if(beforeFiles!==JSON.stringify(await scanFiles(c.dir,roots,signal))||beforeLocks!==JSON.stringify(exportModState(path.join(c.dir,'mods'))))throw new Error('准备恢复期间实例发生变化，已保留现有实例，请重新执行')
   const json=JSON.parse(await fs.promises.readFile(path.join(staging,name+'.json'),'utf8'));json.id=target.id
   await fs.promises.unlink(path.join(staging,name+'.json'))
   await fs.promises.writeFile(path.join(staging,target.id+'.json'),JSON.stringify(json,null,2))
   if(fs.existsSync(path.join(staging,name+'.jar')))await fs.promises.rename(path.join(staging,name+'.jar'),path.join(staging,target.id+'.jar'))
   const modState=exportModState(path.join(staging,'mods')),beforeState=exportModState(path.join(c.dir,'mods'))
   await fs.promises.rename(c.dir,old)
   try{await fs.promises.rename(staging,c.dir);importModState(path.join(c.dir,'mods'),modState)}
   catch(e){try{if(fs.existsSync(c.dir))await fs.promises.rename(c.dir,staging);await fs.promises.rename(old,c.dir);importModState(path.join(c.dir,'mods'),beforeState)}catch{keepOld=true;throw new Error('恢复提交失败；原实例保留于 '+old)}throw e}
   return c.target
  }))
 }finally{await fs.promises.rm(staging,{recursive:true,force:true});if(!keepOld)await fs.promises.rm(old,{recursive:true,force:true})}
}
