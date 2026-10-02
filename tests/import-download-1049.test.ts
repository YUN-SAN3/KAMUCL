import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { downloadFile } from '../src/main/core/download'
import { downloadLimiter } from '../src/main/core/downloadLimits'
import { withFileJob } from '../src/main/core/fileJobs'
import { probeModpack } from '../src/main/core/modpacks'
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms))

test('两版本并行安装共享库；取消一个不影响另一个，切换默认文件夹不改变在途目标',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-multi-install-'))
 const lib=Buffer.from('shared library'),client=crypto.randomBytes(512*1024),sha=(b:Buffer)=>crypto.createHash('sha1').update(b).digest('hex');let libraryRequests=0
 const server=http.createServer((req,res)=>{
  if(req.url==='/lib'){libraryRequests++;setTimeout(()=>res.end(lib),50);return}
  res.writeHead(200,{'content-length':client.length});let n=0
  const timer=setInterval(()=>{if(n>=client.length){res.end();return}res.write(client.subarray(n,n+16384));n+=16384},5);res.on('close',()=>clearInterval(timer))
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
 try{
  const output=await build({stdin:{contents:"export { installVersion } from './src/main/core/versions'; export { saveSettings } from './src/main/core/settings'",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',packages:'external'})
  const mod={exports:{} as any},req=createRequire(path.resolve('package.json'))
  new Function('require','module','exports','__dirname',output.outputFiles[0].text)((id:string)=>id==='electron'?{app:{getPath:()=>root,isPackaged:false},BrowserWindow:{getAllWindows:()=>[]}}:req(id),mod,mod.exports,root)
  const api=mod.exports,folder=path.join(root,'game'),shared=path.join(root,'shared'),other=path.join(root,'other'),url=`http://127.0.0.1:${(server.address() as any).port}`
  api.saveSettings({gameDir:folder,activeFolder:folder,folders:[{path:folder,name:'game',isDefault:false},{path:shared,name:'shared',isDefault:true}],mirror:'official'})
  for(const id of ['a','b']){const dir=path.join(folder,'versions',id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify({id,libraries:[{name:'example:shared:1',downloads:{artifact:{path:'example/shared.jar',url:url+'/lib',sha1:sha(lib),size:lib.length}}}],downloads:{client:{url:url+'/'+id,sha1:sha(client),size:client.length}}}))}
  const ctrl=new AbortController(),events:string[]=[]
  const first=api.installVersion('a',{},(e:any)=>{if(e.stage==='client'||e.parallelStages?.some((s:any)=>s.id==='client'&&s.state==='running'))events.push('a')},ctrl.signal);const rejected=assert.rejects(first)
  const second=api.installVersion('b',{},(e:any)=>{if(e.stage==='client'||e.parallelStages?.some((s:any)=>s.id==='client'&&s.state==='running'))events.push('b')})
  api.saveSettings({activeFolder:other,folders:[{path:other,name:'other',isDefault:true}]})
  for(let n=0;n<100&&!['a','b'].every(x=>events.includes(x));n++)await wait(10)
  assert(events.includes('a')&&events.includes('b'),'两个客户端应同时开始下载')
  // Client transfers now start before the shared library finishes; wait for its reusable commit.
  for(let n=0;n<100&&!fs.existsSync(path.join(shared,'libraries/example/shared.jar'));n++)await wait(10)
  ctrl.abort();await rejected;await second
  assert.equal(libraryRequests,1);assert(fs.readFileSync(path.join(folder,'versions/b/b.jar')).equals(client));assert(fs.existsSync(path.join(shared,'libraries/example/shared.jar')));assert(!fs.existsSync(path.join(other,'libraries')));assert(!fs.existsSync(path.join(folder,'versions/b/.installing')))
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(root,{recursive:true,force:true})}
})

test('外层启动器分发ZIP识别唯一mrpack，保留包名和配置，不执行外层EXE',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-wrapper-'))
 try{
  const inner=new AdmZip();inner.addFile('modrinth.index.json',Buffer.from(JSON.stringify({formatVersion:1,game:'minecraft',name:'内部包名',dependencies:{minecraft:'1.21.11','fabric-loader':'0.19.2'},files:[]})));inner.addFile('overrides/options.txt',Buffer.from('lang:zh_cn'))
  const outer=new AdmZip();outer.addFile('modpack.mrpack',inner.toBuffer());outer.addFile('Plain Craft Launcher.exe',Buffer.from('not an executable'))
  const file=path.join(root,'直播.zip');outer.writeZip(file)
  const info=await probeModpack(file);assert.equal(info.format,'mrpack');assert.equal(info.mcVersion,'1.21.11');assert.equal(info.loaderVersion,'0.19.2');assert.equal(info.fileName,'直播');assert.equal(info.hasPresetKeys,true)
  outer.addFile('another.mrpack',inner.toBuffer());outer.writeZip(file);await assert.rejects(probeModpack(file),/多个 mrpack/)
  const bad=new AdmZip();bad.addFile('modpack.mrpack',Buffer.from('not a zip'));bad.writeZip(file);await assert.rejects(probeModpack(file),/损坏/)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})

test('同目标写入互斥、不同目标并行；取消排队者不提前释放正在写入的任务',async()=>{
 const order:string[]=[];let release!:()=>void;const hold=new Promise<void>(r=>release=r)
 const one=withFileJob('a-test',undefined,async()=>{order.push('a-start');await hold;order.push('a-end')})
 await wait(5);const ctrl=new AbortController();const two=withFileJob('a-test',ctrl.signal,async()=>{order.push('never')});const cancelled=assert.rejects(two)
 const three=withFileJob('a-test',undefined,async()=>{order.push('third')})
 await withFileJob('b-test',undefined,async()=>{order.push('other')});ctrl.abort();await cancelled
 assert.deepEqual(order,['a-start','other']);release();await Promise.all([one,three]);assert.deepEqual(order,['a-start','other','a-end','third'])
})

test('大文件并发分段、完整哈希、Range回退及取消不影响共享文件等待者',{timeout:15000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-range-'));const data=crypto.randomBytes(8*1024*1024),hash=crypto.createHash('sha1').update(data).digest('hex')
 let active=0,maxActive=0,ranges=0
 const server=http.createServer((req,res)=>{
  const range=req.headers.range?.match(/^bytes=(\d+)-(\d+)$/);let start=0,end=data.length-1
  if(range&&req.url!=='/ignore'){start=Number(range[1]);end=Number(range[2]);ranges++;res.writeHead(206,{'content-range':`bytes ${req.url==='/bad'?start+1:start}-${end}/${data.length}`,'content-length':end-start+1})}
  else res.writeHead(200,{'content-length':data.length})
  active++;maxActive=Math.max(active,maxActive);let offset=start
  const timer=setInterval(()=>{if(offset>end){res.end();return}const next=Math.min(end+1,offset+65536);res.write(data.subarray(offset,next));offset=next},4)
  res.on('close',()=>{active--;clearInterval(timer)})
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${(server.address() as any).port}`
 try{
  downloadLimiter.configure({downloadThreads:1,downloadSpeedKBps:0});let time=Date.now();await downloadFile(url+'/file',path.join(root,'single.jar'),undefined,hash,'official',undefined,[],{size:data.length});const single=Date.now()-time
  downloadLimiter.configure({downloadThreads:8,downloadSpeedKBps:0});time=Date.now();await downloadFile(url+'/file',path.join(root,'parallel.jar'),undefined,hash,'official',undefined,[],{size:data.length});const parallel=Date.now()-time
  assert(maxActive>=4 && maxActive<=8);assert(ranges>=4);assert(fs.readFileSync(path.join(root,'parallel.jar')).equals(data));console.log(JSON.stringify({singleMs:single,parallelMs:parallel,maxActive}))
  for(const route of ['ignore','bad']){await downloadFile(url+'/'+route,path.join(root,route+'.jar'),undefined,hash,'official',undefined,[],{size:data.length});assert(fs.readFileSync(path.join(root,route+'.jar')).equals(data))}
  const dest=path.join(root,'shared.jar'),ctrl=new AbortController();const first=downloadFile(url+'/file',dest,undefined,hash,'official',ctrl.signal,[],{size:data.length});const rejected=assert.rejects(first)
  await wait(20);const second=downloadFile(url+'/file',dest,undefined,hash,'official',undefined,[],{size:data.length});ctrl.abort();await rejected;await second
  assert(fs.readFileSync(dest).equals(data));assert(!fs.readdirSync(root).some(x=>x.includes('.segments-')||x.endsWith('.part')))
 }finally{downloadLimiter.configure({downloadThreads:8,downloadSpeedKBps:0});server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(root,{recursive:true,force:true})}
})
