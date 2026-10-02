import { ipcMain, dialog, shell, type BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { IPC, IPC_EVENT, type ProgressEvent } from '../../shared/types'
import type { InstanceTarget, InstanceOperation } from '../../shared/instanceCenter'
import * as center from './instanceCenter'
import { instanceBackups } from './changeProtection'
import { safePath, exportTreeZip, type BackupProgress } from './backupStore'
import { diagnoseInstance, repairInstanceFiles } from './instanceDiagnostics'
import { registerTask, finishTask, isCancelError, waitIfTaskPaused } from './tasks'
import { planMissingDependencies, applyMissingDependencies } from './modManagement'
export function registerInstanceCenterIpc(getWin:()=>BrowserWindow|null){
 const send=(event:string,payload:unknown)=>getWin()?.webContents.send(event,payload)
 async function task<T>(title:string,action:(signal:AbortSignal,progress:BackupProgress)=>Promise<T>):Promise<T>{
  const t=registerTask(title,'world')
  const progress:BackupProgress=(done,total,text)=>send(IPC_EVENT.progress,{taskId:t.id,taskTitle:t.title,stage:'world',progress:total?done/total:0,text} satisfies ProgressEvent)
  progress(0,1,'准备任务…')
  try{const result=await action(t.controller.signal,progress);send(IPC_EVENT.taskDone,{taskId:t.id,ok:true});return result}
  catch(e){send(IPC_EVENT.taskDone,{taskId:t.id,ok:false,cancelled:isCancelError(e),error:String(e)});throw e}
  finally{finishTask(t.id)}
 }
 ipcMain.handle(IPC.centerOverview,(_e,t:InstanceTarget)=>center.centerOverview(t))
 ipcMain.handle(IPC.centerWorlds,(_e,t:InstanceTarget)=>center.centerWorlds(t))
 ipcMain.handle(IPC.centerScreenshots,(_e,t:InstanceTarget,page:number)=>center.centerScreenshots(t,page))
 ipcMain.handle(IPC.centerBackups,(_e,t:InstanceTarget)=>instanceBackups(center.centerTarget(t).dir).list())
 ipcMain.handle(IPC.centerDiagnose,(_e,t:InstanceTarget)=>task('检查实例运行环境',(signal,progress)=>diagnoseInstance(t,signal,progress)))
 ipcMain.handle('center:dependencyPlan',(_e,t:InstanceTarget,name:string)=>{const c=center.centerTarget(t);return planMissingDependencies(c.target.id,c.folder,name)})
 ipcMain.handle('center:dependencyApply',(_e,id:string,confirmed:boolean)=>task('补充必要前置',(signal,progress)=>applyMissingDependencies(id,confirmed===true,signal,done=>progress(done,1,'下载并校验必要前置'))))
 ipcMain.handle(IPC.centerOperation,async(_e,o:InstanceOperation&{planId?:string})=>{
  const c=center.centerTarget(o.target)
  switch(o.kind){
   case 'backup':return task(o.world?'备份存档':'备份实例',(s,p)=>center.backupInstance(c.target,o.world?'存档手动备份':'实例手动备份',false,o.world,s,p))
   case 'clone':return task('复制实例',(s,p)=>center.cloneInstance(c.target,o.name||'',o.destinationFolder||c.folder,o.saves!==false,o.screenshots===true,s,p))
   case 'restore':{
    if(!o.backupId)throw new Error('请选择备份')
    const m=await instanceBackups(c.dir).read(o.backupId)
    if(m.metadata?.type==='world')return task('恢复存档',(s,p)=>center.restoreWorld(c.target,o.backupId!,o.name||'',o.overwrite===true,s,p))
    if(o.overwrite)return task('覆盖恢复实例',(s,p)=>center.restoreInstanceInPlace(c.target,o.backupId!,s,p))
    return task('恢复实例',(s,p)=>center.cloneInstance(c.target,o.name||'',o.destinationFolder||c.folder,true,true,s,p,o.backupId))
   }
   case 'repair':return task('修复运行文件',(s,p)=>repairInstanceFiles(o.planId||'',s,p))
   case 'worldExport':{
    center.validateInstanceName(o.world||'');await center.assertInstanceIdle(c.dir)
    const source=await safePath(c.dir,'saves/'+o.world),picked=await dialog.showSaveDialog({title:'导出存档',defaultPath:o.world+'.zip',filters:[{name:'ZIP',extensions:['zip']}]})
    if(picked.canceled||!picked.filePath)return null
    if(fs.existsSync(picked.filePath))throw new Error('导出文件已存在，请选择新文件名')
    return task('导出存档',async s=>{await center.assertInstanceIdle(c.dir);await exportTreeZip(source,picked.filePath!,s);return picked.filePath})
   }
   default:throw new Error('未知实例操作')
  }
 })
 ipcMain.handle(IPC.centerFile,async(_e,t:InstanceTarget,kind:'world'|'screenshot'|'preview'|'directory',id:string,save=false)=>{
  const c=center.centerTarget(t)
  let file=c.dir
  if(kind==='world'){center.validateInstanceName(id);file=await safePath(c.dir,'saves/'+id)}
  else if(kind==='screenshot'||kind==='preview'){center.validateInstanceName(id);if(!/\.png$/i.test(id))throw new Error('仅支持 PNG 截图');file=await safePath(c.dir,'screenshots/'+id)}
  else if(kind!=='directory')throw new Error('未知文件类型')
  if(kind==='preview'){if((await fs.promises.stat(file)).size>64*1024*1024)throw new Error('截图过大，请打开目录查看原图');return 'data:image/png;base64,'+(await fs.promises.readFile(file)).toString('base64')}
  if(save&&kind==='screenshot'){const out=await dialog.showSaveDialog({defaultPath:id,filters:[{name:'PNG',extensions:['png']}]});if(!out.canceled&&out.filePath)await fs.promises.copyFile(file,out.filePath,fs.constants.COPYFILE_EXCL)}
  else {const error=await shell.openPath(kind==='screenshot'?path.dirname(file):file);if(error)throw new Error(error)}
 })
}
