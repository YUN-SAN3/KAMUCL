import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import crypto from 'node:crypto'
import { downloadFile, mirrorUrl } from '../src/main/core/download'
import { downloadModpackFiles } from '../src/main/core/modpackDownloads'
import { downloadLimiter } from '../src/main/core/downloadLimits'

test('模组镜像只转换文档明确支持的 CDN 文件路径，官方模式保持原地址',()=>{
 for(const url of ['https://cdn.modrinth.com/data/abcd/versions/efgh/a%2Bb.jar','https://edge.forgecdn.net/files/1234/56/a.jar','https://mediafilez.forgecdn.net/files/1234/56/a.jar']){
  assert.equal(mirrorUrl(url,'bmclapi'),'https://mod.mcimirror.top'+new URL(url).pathname);assert.equal(mirrorUrl(url,'official'),url)
 }
 for(const url of ['https://cdn.modrinth.com/user/avatar.png','https://cdn.modrinth.com.evil.example/data/a/versions/b/c','https://example.com/files/1/2/a.jar'])assert.equal(mirrorUrl(url,'bmclapi'),url)
})

test('分段取消保留已接收字节，重新下载从每段断点恢复并通过完整哈希',{timeout:10000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-resume-')),data=crypto.randomBytes(8*1024*1024),hash=crypto.createHash('sha1').update(data).digest('hex'),starts:number[]=[]
 const server=http.createServer((req,res)=>{const m=req.headers.range!.match(/bytes=(\d+)-(\d+)/)!;let at=Number(m[1]),end=Number(m[2]);starts.push(at);res.writeHead(206,{'content-range':`bytes ${at}-${end}/${data.length}`,'content-length':end-at+1});const timer=setInterval(()=>{if(at>end){res.end();return}const next=Math.min(end+1,at+32768);res.write(data.subarray(at,next));at=next},5);res.on('close',()=>clearInterval(timer))})
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${(server.address() as any).port}/large`,dest=path.join(root,'large.jar')
 try{
  downloadLimiter.configure({downloadThreads:8,downloadSpeedKBps:0});const ctrl=new AbortController()
  await assert.rejects(downloadFile(url,dest,n=>{if(n>=512*1024)ctrl.abort()},hash,'official',ctrl.signal,[],{size:data.length}))
  const segments=dest+'.segments-cache';assert(fs.existsSync(segments));assert(fs.readdirSync(segments).filter(x=>x.endsWith('.part')).some(x=>fs.statSync(path.join(segments,x)).size>0));starts.length=0
  await downloadFile(url,dest,undefined,hash,'official',undefined,[],{size:data.length});assert(starts.some(n=>n%(2*1024*1024)!==0),'请求必须从已保存的段内偏移继续');assert(fs.readFileSync(dest).equals(data));assert(!fs.existsSync(segments))
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(root,{recursive:true,force:true})}
})

test('整合包失败后重试复用已校验缓存；实例修改不污染缓存；损坏缓存重新下载',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-pack-cache-')),a=Buffer.from('first mod'),b=Buffer.from('second mod');let fail=true,aRequests=0
 const server=http.createServer((req,res)=>{if(req.url==='/a'){aRequests++;res.end(a)}else setTimeout(()=>{res.statusCode=fail?404:200;res.end(b)},50)})
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${(server.address() as any).port}`,cache=path.join(root,'cache'),instance=path.join(root,'instance')
 const tasks=[a,b].map((data,i)=>({url:url+'/'+(i?'b':'a'),dest:path.join(instance,i+'.jar'),size:data.length,sha1:crypto.createHash('sha1').update(data).digest('hex')}))
 try{
  await assert.rejects(downloadModpackFiles(tasks,()=>{},'official',undefined,cache));assert.equal(aRequests,1)
  fail=false;await downloadModpackFiles(tasks,()=>{},'official',undefined,cache);assert.equal(aRequests,1);assert(fs.readFileSync(tasks[0].dest).equals(a))
  fs.writeFileSync(tasks[0].dest,'changed by game');await downloadModpackFiles(tasks,()=>{},'official',undefined,cache);assert(fs.readFileSync(tasks[0].dest).equals(a));assert.equal(aRequests,1)
  const cachedA=fs.readdirSync(cache).find(n=>fs.readFileSync(path.join(cache,n)).equals(a))!;fs.writeFileSync(path.join(cache,cachedA),'corrupted');await downloadModpackFiles(tasks,()=>{},'official',undefined,cache);assert.equal(aRequests,2)
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(root,{recursive:true,force:true})}
})

test('corrupt assembled ranges are discarded before whole-file fallback', {timeout:15000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-range-hash-')),data=Buffer.alloc(8*1024*1024,42),hash=crypto.createHash('sha1').update(data).digest('hex'),dest=path.join(root,'verified.jar');let full=0
 const server=http.createServer((req,res)=>{const range=req.headers.range?.match(/^bytes=(\d+)-(\d+)$/);if(range){const start=Number(range[1]),end=Number(range[2]);res.writeHead(206,{'content-range':`bytes ${start}-${end}/${data.length}`,'content-length':end-start+1});res.end(Buffer.alloc(end-start+1,17))}else{assert.equal(req.headers.range,undefined,'fallback must start from byte zero');full++;res.writeHead(200,{'content-length':data.length});res.end(data)}})
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
 try{downloadLimiter.configure({downloadThreads:8,downloadSpeedKBps:0});await downloadFile(`http://127.0.0.1:${(server.address() as any).port}/file`,dest,undefined,hash,'official',undefined,[],{size:data.length});assert.equal(full,1);assert(fs.readFileSync(dest).equals(data))}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(root,{recursive:true,force:true})}
})
