/** Independent documented Windows PSAPI implementation. No PCL binaries or unpublished code.
 * https://learn.microsoft.com/windows/win32/api/psapi/nf-psapi-emptyworkingset */
import os from 'node:os'
import { ipcMain } from 'electron'
import { shouldSkipMemoryProcess, type MemoryOrganizeResult } from '../../shared/memoryOrganizer'
import { getRunningGamePids } from './launch'
let active:Promise<MemoryOrganizeResult>|undefined
const freeMB=()=>Math.floor(os.freemem()/1048576)
export function organizeMemory():Promise<MemoryOrganizeResult> {
  if(active)return active
  active=run().finally(()=>{active=undefined});return active
}
async function run():Promise<MemoryOrganizeResult>{
  const started=Date.now(),result:MemoryOrganizeResult={applicable:process.platform==='win32',beforeMB:freeMB(),afterMB:freeMB(),processed:0,skipped:0,failures:{},elapsedMs:0}
  if(!result.applicable)return result
  const failure=(reason:string)=>{result.failures[reason]=(result.failures[reason]||0)+1}
  try{
    const module=await import('koffi'),koffi=module.default||module
    const kernel=koffi.load('kernel32.dll'),psapi=koffi.load('psapi.dll')
    const enumerate=psapi.func('bool __stdcall EnumProcesses(void *pids, uint32_t size, void *bytes)')
    const open=kernel.func('uintptr_t __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)')
    const image=kernel.func('bool __stdcall QueryFullProcessImageNameW(uintptr_t process, uint32_t flags, void *name, void *size)')
    const trim=psapi.func('bool __stdcall EmptyWorkingSet(uintptr_t process)')
    const close=kernel.func('bool __stdcall CloseHandle(uintptr_t process)'),error=kernel.func('uint32_t __stdcall GetLastError()')
    let pids=Buffer.alloc(4096),length=Buffer.alloc(4)
    for(;;){if(!enumerate(pids,pids.length,length))throw new Error('无法枚举进程（Windows '+error()+'）');if(length.readUInt32LE(0)<pids.length)break;if(pids.length>=1048576)throw new Error('进程清单超过上限');pids=Buffer.alloc(pids.length*2)}
    const count=length.readUInt32LE(0)/4,protectedPids=getRunningGamePids()
    for(let i=0;i<count;i++){
      if(i%8===0)await new Promise<void>(resolve=>setImmediate(resolve))
      const pid=pids.readUInt32LE(i*4)
      if(pid<=4||protectedPids.includes(pid)){result.skipped++;continue}
      // PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA, no elevation.
      const handle=open(0x1100,false,pid)
      if(!handle){result.skipped++;failure('打开进程失败（Windows '+error()+'）');continue}
      try{const chars=Buffer.alloc(65536),size=Buffer.alloc(4);size.writeUInt32LE(32768)
        if(!image(handle,0,chars,size)){result.skipped++;failure('无法识别进程（Windows '+error()+'）');continue}
        const name=chars.subarray(0,size.readUInt32LE(0)*2).toString('utf16le')
        if(shouldSkipMemoryProcess(pid,name,protectedPids,process.env.SystemRoot||'C:\\Windows')){result.skipped++;continue}
        if(trim(handle))result.processed++;else{result.skipped++;failure('整理失败（Windows '+error()+'）')}
      }finally{close(handle)}
    }
    await new Promise(resolve=>setTimeout(resolve,300))
  }catch(e){failure(e instanceof Error?e.message:String(e))}
  result.afterMB=freeMB();result.elapsedMs=Date.now()-started;return result
}
export function registerMemoryOrganizerIpc(){ipcMain.handle('memory:organize',()=>organizeMemory())}
