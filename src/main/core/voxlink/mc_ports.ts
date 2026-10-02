// SPDX-License-Identifier: MIT
// KAMUCL process/port discovery. Process arguments are inspected locally and never logged.
import { execFile } from 'node:child_process'
import net from 'node:net'
export interface McPortEntry { port: number; pid: number }
const capture = (file:string,args:string[]) => new Promise<string>((resolve,reject)=>execFile(file,args,{windowsHide:true,timeout:8000,maxBuffer:4*1024*1024},(error,out)=>error?reject(error):resolve(out)))
export async function detectMcPorts():Promise<McPortEntry[]> {
  const found:McPortEntry[]=[]
  if(process.platform==='win32') {
    const query="$p = @(Get-CimInstance Win32_Process -Filter \"Name = 'java.exe' OR Name = 'javaw.exe'\" | Where-Object { $_.CommandLine -match 'minecraft|fabric|forge|quilt|net\\.minecraft' } | ForEach-Object { $_.ProcessId }); @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $p -contains $_.OwningProcess } | Select-Object LocalPort,OwningProcess) | ConvertTo-Json -Compress"
    const raw=await capture('powershell.exe',['-NoProfile','-NonInteractive','-Command',query]);const values=raw.trim()?JSON.parse(raw):[]
    for(const row of Array.isArray(values)?values:[values])found.push({port:Number(row.LocalPort),pid:Number(row.OwningProcess)})
  } else {
    const processes=await capture('ps',['-axo','pid=,command=']);const pids=new Set<number>()
    for(const line of processes.split('\n')){const match=line.trim().match(/^(\d+)\s+(.*)$/);if(match&&/java/i.test(match[2])&&/minecraft|fabric|forge|quilt/i.test(match[2]))pids.add(Number(match[1]))}
    if(pids.size){const listing=await capture('lsof',['-nP','-iTCP','-sTCP:LISTEN','-Fpn']);let pid=0;for(const line of listing.split('\n')){if(line.startsWith('p'))pid=Number(line.slice(1));if(line.startsWith('n')&&pids.has(pid)){const port=Number(line.match(/:(\d+)$/)?.[1]);found.push({port,pid})}}}
  }
  return [...new Map(found.filter(row=>Number.isInteger(row.port)&&row.port>0&&row.port<=65535&&row.pid>0).map(row=>[`${row.pid}:${row.port}`,row])).values()].sort((a,b)=>a.port-b.port)
}
export async function probeHostPort(port:number,timeoutMs=1500):Promise<void>{if(!port)throw new Error('请先启动游戏并对局域网开放世界');if(!Number.isInteger(port)||port<1||port>65535)throw new Error('请填写游戏中显示的有效端口（1–65535）');await new Promise<void>((resolve,reject)=>{const socket=net.createConnection({host:'127.0.0.1',port});const timer=setTimeout(()=>finish(new Error('请先启动游戏并对局域网开放世界')),timeoutMs);const finish=(error?:Error)=>{clearTimeout(timer);socket.destroy();error?reject(error):resolve()};socket.once('connect',()=>finish());socket.once('error',()=>finish(new Error('请先启动游戏并对局域网开放世界')))})}
