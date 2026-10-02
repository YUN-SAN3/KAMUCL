import { Worker } from 'node:worker_threads'
import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import { ipcMain,type BrowserWindow } from 'electron'
import { IPC_EVENT } from '../../shared/types'
import type { ProjectionAnalysis,ProjectionChoices,ProjectionFormat } from '../../shared/projections'
import { registerTask,finishTask } from './tasks'
import { withFileJob } from './fileJobs'
import { projectionVersions } from './projectionConversion'
export function runProjectionWorker<T=any>(data:Record<string,unknown>,signal?:AbortSignal,progress?:(fraction:number,text:string)=>void):Promise<T>{
  return new Promise((resolve,reject)=>{signal?.throwIfAborted();const worker=new Worker(path.join(__dirname,'projectionWorker.cjs'),{workerData:data,resourceLimits:{maxOldGenerationSizeMb:512}});let settled=false
    const finish=(error?:Error,result?:T)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);void worker.terminate();error?reject(error):resolve(result!)}
    const cancel=()=>finish(new Error('投影任务已取消，原文件保留')),timer=setTimeout(()=>finish(new Error('投影解析超过 120 秒，已停止')),120000)
    signal?.addEventListener('abort',cancel,{once:true})
    if(signal?.aborted)cancel()
    worker.on('message',message=>{if(settled)return;if(message.progress!==undefined)progress?.(message.progress,message.text);else if(message.error)finish(new Error(message.error));else finish(undefined,message.result)})
    worker.once('error',e=>finish(e));worker.once('exit',code=>{if(!settled)finish(new Error('投影线程提前退出：'+code))})
  })
}
export function registerProjectionConversion(getWin:()=>BrowserWindow|null,resolveSource:(id:string)=>Promise<{file:string;format:ProjectionFormat}>){
  const analyses=new Map<string,{view:ProjectionAnalysis;sourceId:string;file:string;time:number}>()
  const task=async<T>(title:string,run:(signal:AbortSignal,progress:(fraction:number,text:string)=>void)=>Promise<T>)=>{const t=registerTask(title,'world');let ok=false;try{const result=await run(t.controller.signal,(fraction,text)=>getWin()?.webContents.send(IPC_EVENT.progress,{taskId:t.id,taskTitle:title,stage:'world',progress:fraction,text}));ok=true;return result}finally{getWin()?.webContents.send(IPC_EVENT.taskDone,{taskId:t.id,ok,cancelled:t.controller.signal.aborted});finishTask(t.id)}}
  ipcMain.handle('projections:versions',()=>projectionVersions())
  ipcMain.handle('projections:analyze',async(_e,id:string,format:ProjectionFormat,version?:string)=>{
    for(const [id,a] of analyses)if(Date.now()-a.time>1800000)analyses.delete(id)
    if(analyses.size>=16)throw new Error('待确认转换过多，请关闭旧转换窗口')
    const source=await resolveSource(id),data=await task('投影转换 · 分析差异',(signal,progress)=>runProjectionWorker<Omit<ProjectionAnalysis,'id'>>({file:source.file,sourceFormat:source.format,action:'analyze',format,version},signal,progress)),view={...data,id:crypto.randomUUID()}
    analyses.set(view.id,{view,sourceId:id,file:source.file,time:Date.now()});return view
  })
  ipcMain.handle('projections:discardAnalysis',(_e,id:string)=>{analyses.delete(id)})
  ipcMain.handle('projections:convert',async(_e,id:string,choices:ProjectionChoices)=>{
    const a=analyses.get(id);if(!a||Date.now()-a.time>1800000)throw new Error('转换分析已过期，请重新分析')
    if(!choices||typeof choices!=='object'||JSON.stringify(choices).length>1000000)throw new Error('转换选择无效')
    const current=await resolveSource(a.sourceId);if(current.file!==a.file||current.format!==a.view.sourceFormat)throw new Error('投影来源已变化，请重新扫描并分析')
    return task('投影转换 · 生成与验证',async(signal,progress)=>{
      const bytes=Buffer.from(await runProjectionWorker<Uint8Array>({file:a.file,sourceFormat:a.view.sourceFormat,action:'convert',hash:a.view.sourceHash,format:a.view.targetFormat,version:a.view.targetVersion,choices},signal,progress))
      const dir=path.dirname(a.file),name=path.basename(a.file,path.extname(a.file))+'-converted';let output=''
      await withFileJob(dir,signal,async()=>{signal.throwIfAborted();const temp=path.join(dir,'.kamucl-convert-'+crypto.randomUUID()+'.part');try{await fs.writeFile(temp,bytes,{flag:'wx'});signal.throwIfAborted();for(let n=1;n<10000;n++){const candidate=path.join(dir,name+(n===1?'':'-'+n)+'.'+a.view.targetFormat);try{await fs.link(temp,candidate);output=candidate;break}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e}}if(!output)throw new Error('转换副本重名过多');if(signal.aborted){await fs.unlink(output);signal.throwIfAborted()}}finally{await fs.unlink(temp).catch(()=>{})}})
      analyses.delete(id);progress(1,'生成文件已验证，原文件哈希保持不变');return {path:output,name:path.basename(output)}
    })
  })
}
