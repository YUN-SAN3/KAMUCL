import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

test('FRP 实际控制器会话独立：日志分别归属、密钥打码、单条停止、安装期间取消',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'frp-workers-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const processes:any[]=[];let release!:()=>void;let downloads=0
  const result=await build({entryPoints:['src/main/core/frp.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'download',setup(b){b.onResolve({filter:/^\.\/download$/},()=>({path:'download',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const downloadAll=(...args)=>globalThis.__frpWorkerDownload(...args)'}))}}]})
  const require=createRequire(path.resolve('package.json')),mod={exports:{} as any}
  ;(globalThis as any).__frpWorkerDownload=async()=>{downloads++;await new Promise<void>(r=>release=r)}
  t.after(()=>delete (globalThis as any).__frpWorkerDownload)
  new Function('require','module','exports',result.outputFiles[0].text)((name:string)=>{
    if(name==='electron')return {app:{getPath:()=>root}}
    if(name==='node:child_process')return {spawn:(target:string)=>{
      if(target==='taskkill')return new EventEmitter()
      const p:any=new EventEmitter();p.pid=100+processes.length;p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.kill=()=>{p.killed=true;setImmediate(()=>p.emit('exit',0,null));return true};processes.push(p);return p
    }}
    return require(name)
  },mod,mod.exports)
  const {FrpController,frpcPath}=mod.exports
  fs.mkdirSync(path.dirname(frpcPath()),{recursive:true});fs.writeFileSync(frpcPath(),'test stub')
  const a=new FrpController(),b=new FrpController();const events:any[]=[];a.setSink((e:any)=>events.push(e))
  await Promise.all([a.start({accessKey:'secret-alpha',tunnelId:'11',localPort:25565}),b.start({accessKey:'secret-beta',tunnelId:'22',localPort:25566})])
  for (const byte of Buffer.from('secret-alpha 需要输 IP:端口 的地方，写 frp-hub.com:36238\n隧道启动成功\n')) processes[0].stdout.emit('data',Buffer.from([byte]));processes[1].stdout.emit('data','start proxy success\n')
  assert.equal(a.status().remoteAddress,'frp-hub.com:36238');assert.equal(a.status().status,'running');assert.equal(b.status().status,'running');assert(!JSON.stringify(events).includes('secret-alpha'))
  await a.stop();assert.equal(processes[1].killed,undefined);assert.equal(b.status().status,'running');await b.stop()
  fs.unlinkSync(frpcPath());const c=new FrpController(),d=new FrpController()
  const pending=c.start({accessKey:'secret-c',tunnelId:'33',localPort:1}),other=d.start({accessKey:'secret-d',tunnelId:'44',localPort:1})
  await c.stop();await d.stop();release();await assert.rejects(pending,/取消/);await assert.rejects(other,/取消/)
  assert.equal(downloads,1);assert.equal(processes.length,2)
})
