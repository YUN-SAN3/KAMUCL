import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { samePath } from './folderPaths'
const execute=promisify(execFile)
let cached:{at:number;commands:string[]}|undefined
/** Keep process arguments in memory only. Never persist account tokens from command lines. */
export async function externalGameUsesDirectory(directory:string):Promise<boolean>{
  if(!cached||Date.now()-cached.at>800){
    let stdout:string
    if(process.platform==='win32')({stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_Process -Filter "Name = \'java.exe\' OR Name = \'javaw.exe\'" | ForEach-Object { $_.CommandLine }'],{windowsHide:true,timeout:8000,maxBuffer:4*1024*1024}))
    else ({stdout}=await execute('/bin/ps',['-axo','command='],{timeout:8000,maxBuffer:4*1024*1024}))
    cached={at:Date.now(),commands:stdout.split(/\r?\n/)}
  }
  return cached.commands.some(command=>{const m=/(?:^|\s)--gameDir(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(command);return m&&samePath(m[1]||m[2]||m[3],directory)})
}
