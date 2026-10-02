import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { downloadAll } from './download'
import { protectModChange } from './changeProtection'
import { getSettings } from './settings'
export interface ModReplacement { oldName?:string; oldSha1?:string; name:string; sha1:string; url?:string; size?:number }
export const modHash=async(file:string)=>crypto.createHash('sha1').update(await fs.promises.readFile(file)).digest('hex')
export function safeModName(name:string){if(typeof name!=='string'||path.basename(name)!==name||/[\\/:\0]/.test(name)||!/^.+\.jar(?:\.disabled)?$/i.test(name))throw new Error('无效的模组文件名');return name}
export async function validateModFile(dir:string,name:string,sha1?:string){safeModName(name);const p=path.join(dir,name),s=await fs.promises.lstat(p);if(!s.isFile()||s.isSymbolicLink())throw new Error('模组不是普通文件');if(sha1&&await modHash(p)!==sha1)throw new Error('模组文件已变化，请重新检查：'+name)}
/** Caller holds the directory write lock. Downloads never touch the current files. */
export async function replaceModFiles(dir:string,items:ModReplacement[],validate?:()=>Promise<void>,signal?:AbortSignal,onProgress?:(fraction:number)=>void){
 const names=new Set<string>(),olds=new Set<string>()
 for(const i of items){safeModName(i.name);if(!/^[a-f0-9]{40}$/i.test(i.sha1)||!i.url?.startsWith('https://'))throw new Error('文件缺少可信哈希或下载地址');const k=i.name.toLowerCase();if(names.has(k))throw new Error('目标文件名重复：'+i.name);names.add(k);if(i.oldName){safeModName(i.oldName);if(olds.has(i.oldName.toLowerCase()))throw new Error('重复的源文件');olds.add(i.oldName.toLowerCase());await validateModFile(dir,i.oldName,i.oldSha1)}}
 const stage=await fs.promises.mkdtemp(path.join(path.dirname(dir),'.kamucl-mod-change-')),backups:Array<{original:string;backup:string}>=[],written:Array<{file:string;sha1:string}>=[]
 let canClean=true
 let phase='下载新模组'
 try{
  const settings=getSettings()
  await downloadAll(items.map((i,n)=>({label:i.name,url:i.url!,dest:path.join(stage,'new-'+n+'-'+i.name),sha1:i.sha1,size:i.size})),(_d,_t,_speed,detail)=>onProgress?.(detail.fraction ?? 0),settings.downloadThreads,settings.mirror,signal)
  phase='检查模组状态'
  await validate?.()
  for(const i of items){if(i.oldName)await validateModFile(dir,i.oldName,i.oldSha1);if(fs.existsSync(path.join(dir,i.name))&&i.name!==i.oldName)throw new Error('目标文件已存在，未覆盖：'+i.name)}
  phase='保存修改前备份'
  await protectModChange(dir,items.flatMap(i=>i.oldName?[i.oldName,i.name]:[i.name]),'模组版本修改前',signal)
  phase='检查模组状态'
  await validate?.()
  for(const i of items)if(i.oldName)await validateModFile(dir,i.oldName,i.oldSha1)
  signal?.throwIfAborted()
  try{
   phase='替换模组文件'
   canClean=false
   for(let n=0;n<items.length;n++){const i=items[n];if(i.oldName){const original=path.join(dir,i.oldName),backup=path.join(stage,'old-'+n);await fs.promises.rename(original,backup);backups.push({original,backup})}}
   for(let n=0;n<items.length;n++){const i=items[n],file=path.join(dir,i.name);await fs.promises.copyFile(path.join(stage,'new-'+n+'-'+i.name),file,fs.constants.COPYFILE_EXCL);written.push({file,sha1:i.sha1})}
   canClean=true
  }catch(e){
   try{
    for(const w of written)if(fs.existsSync(w.file)&&await modHash(w.file)===w.sha1)await fs.promises.unlink(w.file)
    for(const b of backups)await fs.promises.copyFile(b.backup,b.original,fs.constants.COPYFILE_EXCL)
   }catch(rollbackError){throw new Error('文件被外部修改，自动恢复未完成；原文件已保存在 '+stage+'。原因：'+String(rollbackError))}
   canClean=true
   throw e
  }
 }catch(error){
  throw new Error(`${phase}失败：${error instanceof Error?error.message:String(error)}`,{cause:error})
 }finally{
  // Keep recoverable originals when an outside change prevented rollback.
  const parent=path.resolve(path.dirname(dir));const resolved=path.resolve(stage)
  if(canClean&&path.dirname(resolved)===parent&&path.basename(resolved).startsWith('.kamucl-mod-change-'))await fs.promises.rm(resolved,{recursive:true,force:true})
 }
}
