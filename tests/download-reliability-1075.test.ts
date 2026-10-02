import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { downloadLoaderInstaller } from '../src/main/core/installerDownload'
import { resolveCurseForgeDownload } from '../src/main/core/curseforgeDownload'
import { downloadCandidates, downloadFile, resetHostHealthForTest } from '../src/main/core/download'
import { downloadModpackFiles } from '../src/main/core/modpackDownloads'

const sha = (data: Buffer) => crypto.createHash('sha1').update(data).digest('hex')
async function fixture(handler: http.RequestListener) {
  const server=http.createServer(handler);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-transfer-1075-'))
  return {root,base:`http://127.0.0.1:${(server.address() as {port:number}).port}`,close:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(root,{recursive:true,force:true})}}
}
function sendRange(req: http.IncomingMessage,res: http.ServerResponse,bytes: Buffer) {
  const range=req.headers.range?.match(/bytes=(\d+)-(\d*)/),start=Number(range?.[1]??0),end=Number(range?.[2]||bytes.length-1)
  res.writeHead(range?206:200,{'content-length':end-start+1,...(range?{'content-range':`bytes ${start}-${end}/${bytes.length}`}:{})});res.end(bytes.subarray(start,end+1))
}
test('installer obtains Maven identity and downloads concurrent independent ranges',async()=>{
  const bytes=crypto.randomBytes(5*1024*1024),ranges:string[]=[],sockets=new Set<unknown>()
  const f=await fixture((req,res)=>{if(req.url?.endsWith('.sha1'))return void res.end(sha(bytes));if(req.method==='HEAD'){res.writeHead(200,{'content-length':bytes.length});return void res.end()};ranges.push(req.headers.range??'');sockets.add(req.socket);setTimeout(()=>sendRange(req,res,bytes),30)})
  try{const dest=path.join(f.root,'installer.jar');await downloadLoaderInstaller(f.base+'/installer.jar',dest,'official');assert(ranges.length>=2);assert(ranges.every(r=>r.startsWith('bytes=')));assert(sockets.size>=2);assert.equal(sha(fs.readFileSync(dest)),sha(bytes))}finally{await f.close()}
})
test('CurseForge exact metadata preserves hash and size; malformed identity is rejected',async()=>{
  const data={id:5637596,modId:1018692,isAvailable:true,fileName:'reforgedplaymod-1.20.1-0.3.1.jar',fileLength:16661938,downloadUrl:'https://edge.forgecdn.net/files/5637/596/reforgedplaymod-1.20.1-0.3.1.jar',hashes:[{algo:1,value:'37b714750d0e5487b488b29ff1e1623e5bb18ed6'}]}
  const f=await fixture((_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({data}))})
  try{const file=await resolveCurseForgeDownload(data.modId,data.id,[{base:f.base}]);assert.equal(file.sha1,data.hashes[0].value);assert.equal(file.size,data.fileLength);const urls=downloadCandidates([file.url],'bmclapi');assert(urls[0].startsWith('https://mod.mcimirror.top/files/'));assert(urls[1].startsWith('https://mediafilez.forgecdn.net/files/'));assert(urls.includes(data.downloadUrl));await assert.rejects(resolveCurseForgeDownload(123,data.id,[{base:f.base}]),/不匹配/);data.downloadUrl='';await assert.rejects(resolveCurseForgeDownload(data.modId,data.id,[{base:f.base}]),/未提供/)}finally{await f.close()}
})
test('404 switches to exact alternate; verified pack files survive failed import and need no redownload',async()=>{
  resetHostHealthForTest();const bytes=crypto.randomBytes(2*1024*1024);let requests=0
  const f=await fixture((req,res)=>{requests++;if(req.url==='/404'){res.writeHead(404);return void res.end()};sendRange(req,res,bytes)})
  try{await downloadFile(f.base+'/404',path.join(f.root,'fallback.jar'),undefined,sha(bytes),'official',undefined,[f.base+'/ok'],{size:bytes.length});assert.equal(sha(fs.readFileSync(path.join(f.root,'fallback.jar'))),sha(bytes));
  const cache=path.join(f.root,'cache'),task={url:f.base+'/ok',dest:path.join(f.root,'first','file.jar'),size:bytes.length,sha1:sha(bytes)};await downloadModpackFiles([task],()=>{},'official',undefined,cache);const previous=requests;await downloadModpackFiles([{...task,dest:path.join(f.root,'retry','file.jar')}],()=>{},'official',undefined,cache);assert.equal(requests,previous);assert.equal(sha(fs.readFileSync(path.join(f.root,'retry','file.jar'))),sha(bytes))}finally{await f.close()}
})
import { downloadFetch, needsCurseForgeKey } from '../src/main/core/downloadFetch'
test('CDN Range 404 falls back to a verified ordinary GET, not a missing-file error',async()=>{
 const bytes=crypto.randomBytes(2*1024*1024);let plain=0
 const f=await fixture((req,res)=>{if(req.headers.range){res.writeHead(404);return void res.end()};plain++;sendRange(req,res,bytes)})
 try{const dest=path.join(f.root,'range-rejected.jar');await downloadFile(f.base+'/file',dest,undefined,sha(bytes),'official',undefined,[],{size:bytes.length});assert.equal(plain,1);assert.equal(sha(fs.readFileSync(dest)),sha(bytes))}finally{await f.close()}
})
test('CurseForge application key is sent only to the official authenticated CDN, never through redirects',async()=>{
 const edge='https://edge.forgecdn.net/files/5637/596/file.jar',calls:Array<{url:string;key?:string}>=[]
 assert(needsCurseForgeKey(edge));assert(!needsCurseForgeKey('https://edge.forgecdn.net.evil.test/files/5637/596/file.jar'));assert(!needsCurseForgeKey(edge.replace('https:','http:')))
 const response=await downloadFetch(edge,{headers:{Range:'bytes=0-2'}},async()=> 'fixture-key',async(url,init)=>{calls.push({url,key:init?.headers?.['x-api-key']});return calls.length===1?new Response(null,{status:302,headers:{location:'https://mirror.example/file.jar'}}):new Response('abc')})
 assert.equal(await response.text(),'abc');assert.equal(calls[0].key,'fixture-key');assert.equal(calls[1].key,undefined)
})
