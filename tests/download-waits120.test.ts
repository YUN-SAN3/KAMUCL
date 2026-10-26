import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
const hash = (bytes: Buffer) => crypto.createHash('sha1').update(bytes).digest('hex')
const payload = Buffer.from('verified-resource-120')
let source: Promise<string> | undefined
async function runtime(root: string, resolveProxy = async (_url: string) => 'DIRECT') {
  source ??= build({stdin:{contents:`export {downloadAll,downloadFile,transferTimeouts,rateLimitTimeouts,DownloadRateLimitError} from './src/main/core/download';
    export {usesSystemProxy,proxyResolutionTimeouts} from './src/main/core/systemDownload';
    export {downloadLimiter} from './src/main/core/downloadLimits'; export {closeHttpClient} from './src/main/core/httpClient';
    export {registerTask,pauseTask,resumeTask,cancelTaskAndWait,finishTask} from './src/main/core/tasks';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node',packages:'external',logLevel:'silent',plugins:[{name:'local-electron',setup(b){b.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'wait-test'}));b.onLoad({filter:/.*/,namespace:'wait-test'},()=>({contents:'module.exports=__waitsElectron',loader:'js'}))}}]}).then(result=>result.outputFiles[0].text)
  const netCalls: string[]=[]
  const electron={app:{getPath:(name:string)=>path.join(root,name),getName:()=> 'waits-test',getVersion:()=> 'test',isPackaged:false},session:{defaultSession:{resolveProxy}},net:{request:(options:any)=>{
    netCalls.push(options.url)
    const event=new EventEmitter() as EventEmitter & {end:(body?:string)=>void;abort:()=>void}
    let request:http.ClientRequest|undefined
    event.end=body=>{request=http.request(options.url,{method:options.method,headers:options.headers},response=>{
      if([301,302,303,307,308].includes(response.statusCode!)) {event.emit('redirect',response.statusCode,options.method,response.headers.location,response.headers);response.resume()}
      else event.emit('response',response)
    });request.on('error',error=>event.emit('error',error));request.end(body)}
    event.abort=()=>request?.destroy()
    return event
  }}}
  const module={exports:{} as any}, require=createRequire(path.resolve('package.json'))
  // Lexical process/Electron injection: aggregate tests share the real process.
  new Function('require','module','exports','process','__waitsElectron',await source)(require,module,module.exports,{...process,versions:{...process.versions,electron:'wait-test'}},electron)
  module.exports.downloadLimiter.configure({downloadThreads:1,downloadSpeedKBps:0})
  return {...module.exports,netCalls}
}
async function fixture(handler:http.RequestListener) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-waits120-'))
  const requests:Array<{url:string;at:number;range?:string}>=[]
  const server=http.createServer((req,res)=>{requests.push({url:req.url!,at:Date.now(),range:req.headers.range});handler(req,res)})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  return {root,requests,url:`http://127.0.0.1:${(server.address() as {port:number}).port}`,close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(root,{recursive:true,force:true})}}
}
const task = (url:string,dest:string,urls?:string[]) => ({url,dest,urls,sha1:hash(payload),size:payload.length,label:'minecraft/测试资源.ogg'})

for (const routeName of ['DIRECT', 'PROXY 127.0.0.1:7897']) test(`PAC result ${routeName} finishing during pause dispatches no HTTP until resumed`, { timeout: 5000 }, async () => {
  const f = await fixture((_req, res) => res.end(payload))
  let release!: (route: string) => void, entered!: () => void
  const ready = new Promise<void>(resolve => entered = resolve), route = new Promise<string>(resolve => release = resolve)
  const api = await runtime(f.root, async () => { entered(); return route }), rec = api.registerTask('paused PAC', 'download')
  const dest = path.join(f.root, 'asset'), work = api.downloadAll([task(f.url, dest)], undefined, 1, 'official', rec.controller.signal).finally(() => api.finishTask(rec.id))
  try {
    await ready; assert(api.pauseTask(rec.id)); release(routeName); await wait(250)
    assert.equal(f.requests.length, 0); assert.equal(api.netCalls.length, 0); assert(!fs.existsSync(dest + '.part'))
    api.resumeTask(rec.id); await work; assert.equal(f.requests.length, 1); assert.deepEqual(fs.readFileSync(dest), payload)
  } finally {
    release(routeName); api.resumeTask(rec.id); await work.catch(() => {}); await f.close(); await api.closeHttpClient()
  }
})

test('PAC cancellation drains the actual download task; a late route starts no HTTP or writes', {timeout:5000}, async()=>{
  const f=await fixture((_req,res)=>res.end(payload));let release!:(route:string)=>void,entered!:()=>void
  const ready=new Promise<void>(resolve=>entered=resolve),route=new Promise<string>(resolve=>release=resolve)
  const api=await runtime(f.root,async()=>{entered();return route}),rec=api.registerTask('PAC','download')
  const dest=path.join(f.root,'asset'), work=api.downloadAll([task(f.url,dest)],undefined,1,'official',rec.controller.signal).then(()=>null,(e:unknown)=>e).finally(()=>api.finishTask(rec.id))
  try {
    await ready;const start=performance.now();await api.cancelTaskAndWait(rec.id,500)
    assert(performance.now()-start<400);assert.match(String(await work),/取消/)
    release('PROXY 127.0.0.1:12345');await wait(40)
    assert.equal(f.requests.length,0);assert.equal(api.netCalls.length,0);assert(!fs.existsSync(dest));assert(!fs.existsSync(dest+'.part'))
  } finally {release('DIRECT');await f.close();await api.closeHttpClient()}
})
for(const throttled of [false,true])test(`PAC obeys receive idle before headers, including speed-limit=${throttled}`, {timeout:4000},async()=>{
  const f=await fixture((_req,res)=>res.end(payload));let release!:(route:string)=>void
  const route=new Promise<string>(resolve=>release=resolve),api=await runtime(f.root,()=>route)
  api.transferTimeouts.inactivityMs=80;api.proxyResolutionTimeouts.maxWaitMs=1000
  if(throttled)api.downloadLimiter.configure({downloadThreads:1,downloadSpeedKBps:1})
  try {const start=performance.now();await assert.rejects(api.downloadFile(f.url,path.join(f.root,'asset'),undefined,hash(payload),'official',undefined,[],{size:payload.length,maxAttempts:1}),/网络停滞/);assert(performance.now()-start<500);release('DIRECT');await wait(30);assert.equal(f.requests.length,0)}
  finally {release('DIRECT');await f.close();await api.closeHttpClient()}
})
test('PAC has its own bounded wait without a caller signal; pre-abort does not resolve a route',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-proxy120-'));let hits=0,release!:(route:string)=>void
  const route=new Promise<string>(resolve=>release=resolve),api=await runtime(root,()=>{hits++;return route})
  api.proxyResolutionTimeouts.maxWaitMs=60
  try {const controller=new AbortController();controller.abort(Error('already stopped'));await assert.rejects(api.usesSystemProxy('http://example.invalid',controller.signal),/already stopped/);assert.equal(hits,0);await assert.rejects(api.usesSystemProxy('http://example.invalid'),/代理解析超时/);assert.equal(hits,1);release('DIRECT');await wait(20)}
  finally {release('DIRECT');await api.closeHttpClient();fs.rmSync(root,{recursive:true,force:true})}
})
for(const proxy of [false,true])test(`normal ${proxy?'PROXY':'DIRECT'} route preserves production transport and file integrity`,async()=>{
  const f=await fixture((_req,res)=>res.end(payload)),api=await runtime(f.root,async()=>proxy?'PROXY 127.0.0.1:8080; DIRECT':'DIRECT')
  try {assert.equal(await api.usesSystemProxy(f.url),proxy);const dest=path.join(f.root,'asset');await api.downloadFile(f.url,dest,undefined,hash(payload),'official',undefined,[],{size:payload.length});assert.deepEqual(fs.readFileSync(dest),payload);assert.equal(f.requests.length,1);assert.equal(api.netCalls.length,proxy?1:0)}
  finally {await f.close();await api.closeHttpClient()}
})
test('failed PAC keeps existing DIRECT fallback when not cancelled',async()=>{
  const f=await fixture((_req,res)=>res.end(payload)),api=await runtime(f.root,async()=>{throw Error('PAC unavailable')})
  try {await api.downloadFile(f.url,path.join(f.root,'asset'),undefined,hash(payload),'official',undefined,[],{size:payload.length});assert.equal(api.netCalls.length,0);assert.equal(f.requests.length,1)}
  finally {await f.close();await api.closeHttpClient()}
})
test('long Retry-After switches to an exact healthy origin and preserves the limited deadline',async()=>{
  const limited=await fixture((_req,res)=>{res.writeHead(429,{'retry-after':'86400'});res.end()}),healthy=await fixture((_req,res)=>res.end(payload)),api=await runtime(limited.root),events:any[]=[]
  api.rateLimitTimeouts.maxWaitMs=100
  try {
    const dest=path.join(limited.root,'asset');await api.downloadAll([task(limited.url,dest,[healthy.url])],(_d:number,_t:number,_s:number,detail:any)=>events.push(detail),1)
    assert.deepEqual(fs.readFileSync(dest),payload);assert.equal(limited.requests.length,1);assert.equal(healthy.requests.length,1)
    assert(events.some(e=>e.waits?.some((w:any)=>w.action==='switching'&&w.file==='minecraft/测试资源.ogg'&&w.retryAt>Date.now()+80000*1000)))
    assert.equal(events.at(-1).waits,undefined)
    await assert.rejects(api.downloadFile(limited.url,path.join(limited.root,'second'),undefined,hash(payload),'official',undefined,[],{size:payload.length}),/限流.*稍后重试/)
    assert.equal(limited.requests.length,1,'new task must not retry before the service deadline')
  } finally {await Promise.all([limited.close(),healthy.close()]);await api.closeHttpClient()}
})
for(const status of [429,503])test(`all sources ${status} long-limited fail promptly with label/cause, without early retries`,async()=>{
  const handler:http.RequestListener=(_req,res)=>{res.writeHead(status,{'retry-after':'86400'});res.end()}
  const a=await fixture(handler),b=await fixture(handler),api=await runtime(a.root);api.rateLimitTimeouts.maxWaitMs=100
  try {const start=performance.now();await assert.rejects(api.downloadAll([task(a.url,path.join(a.root,'asset'),[b.url])],undefined,1),(e:any)=>{assert.match(e.message,/minecraft\/测试资源.ogg/);assert.match(e.message,/限流.*稍后重试/);assert(e.cause.cause instanceof api.DownloadRateLimitError);assert.equal(e.cause.cause.retryable,true);return true});assert(performance.now()-start<1000);assert.equal(a.requests.length,1);assert.equal(b.requests.length,1);assert(!fs.existsSync(path.join(a.root,'asset.part')))}
  finally {await Promise.all([a.close(),b.close()]);await api.closeHttpClient()}
})
test('same-origin path alias and a redirected alternate cannot bypass rate limiting',async()=>{
  const limited=await fixture((_req,res)=>{res.writeHead(429,{'retry-after':'86400'});res.end()}),redirect=await fixture((_req,res)=>{res.writeHead(302,{location:limited.url+'/redirected'});res.end()}),api=await runtime(limited.root);api.rateLimitTimeouts.maxWaitMs=100
  try {
    await assert.rejects(api.downloadFile(limited.url+'/first',path.join(limited.root,'one'),undefined,hash(payload),'official',undefined,[limited.url+'/same-origin'],{size:payload.length}),/限流/)
    assert.equal(limited.requests.length,1)
    await assert.rejects(api.downloadFile(redirect.url,path.join(limited.root,'two'),undefined,hash(payload),'official',undefined,[],{size:payload.length}),/限流/)
    assert.equal(limited.requests.length,1,'redirect destination stays cold');assert.equal(redirect.requests.length,1)
  } finally {await Promise.all([limited.close(),redirect.close()]);await api.closeHttpClient()}
})
test('short Retry-After really waits then succeeds, with waiting progress cleared',async()=>{
  let attempts=0;const f=await fixture((_req,res)=>{if(!attempts++){res.writeHead(429,{'retry-after':'1'});res.end()}else res.end(payload)}),api=await runtime(f.root),events:any[]=[];api.rateLimitTimeouts.maxWaitMs=1600
  try {await api.downloadAll([task(f.url,path.join(f.root,'asset'))],(_d:number,_t:number,_s:number,detail:any)=>events.push(detail),1);assert.equal(f.requests.length,2);assert(f.requests[1].at-f.requests[0].at>=990);assert(events.some(e=>e.waits?.some((w:any)=>w.action==='waiting')));assert.equal(events.at(-1).waits,undefined)}
  finally {await f.close();await api.closeHttpClient()}
})
test('pause during cooldown spends no budget and sends no request until resumed',async()=>{
  let attempts=0;const f=await fixture((_req,res)=>{if(!attempts++){res.writeHead(429,{'retry-after':'1'});res.end()}else res.end(payload)}),api=await runtime(f.root),rec=api.registerTask('paused cooldown','download');api.rateLimitTimeouts.maxWaitMs=1600
  let paused=false,settled=false;const work=api.downloadAll([task(f.url,path.join(f.root,'asset'))],(_d:number,_t:number,_s:number,detail:any)=>{if(detail.waits?.length&&!paused){paused=true;api.pauseTask(rec.id)}},1,'official',rec.controller.signal).finally(()=>{settled=true;api.finishTask(rec.id)})
  try {while(!paused)await wait(10);await wait(1800);assert.equal(f.requests.length,1);api.resumeTask(rec.id);await work;assert.equal(f.requests.length,2);assert.deepEqual(fs.readFileSync(path.join(f.root,'asset')),payload)}
  finally {if(!settled)api.resumeTask(rec.id);await work.catch(()=>{});await f.close();await api.closeHttpClient()}
})
test('a pause inside an active cooldown does not consume a later retry waiting budget',async()=>{
  let attempts=0;const f=await fixture((_req,res)=>{if(attempts++<2){res.writeHead(429,{'retry-after':'1'});res.end()}else res.end(payload)}),api=await runtime(f.root),rec=api.registerTask('renewed cooldown','download');api.rateLimitTimeouts.maxWaitMs=1200
  let waitStarts=0,paused=false,settled=false
  const work=api.downloadAll([task(f.url,path.join(f.root,'asset'))],(_d:number,_t:number,_s:number,detail:any)=>{if(detail.waits?.length&&++waitStarts===2){paused=true;api.pauseTask(rec.id)}},1,'official',rec.controller.signal).finally(()=>{settled=true;api.finishTask(rec.id)})
  try {while(!paused)await wait(10);await wait(1300);assert.equal(f.requests.length,1);api.resumeTask(rec.id);await work;assert.equal(f.requests.length,3);assert(f.requests[2].at-f.requests[1].at>=990)}
  finally {if(!settled)api.resumeTask(rec.id);await work.catch(()=>{});await f.close();await api.closeHttpClient()}
})
test('cancel during cooldown drains and preserves the original cancellation, without label decoration',async()=>{
  const f=await fixture((_req,res)=>{res.writeHead(429,{'retry-after':'1'});res.end()}),api=await runtime(f.root),controller=new AbortController();api.rateLimitTimeouts.maxWaitMs=1600
  const reason=Error('stop cooldown now')
  try {await assert.rejects(api.downloadAll([task(f.url,path.join(f.root,'asset'))],(_d:number,_t:number,_s:number,detail:any)=>{if(detail.waits?.length)controller.abort(reason)},1,'official',controller.signal),(e:unknown)=>e===reason);assert.equal(f.requests.length,1);assert(!fs.existsSync(path.join(f.root,'asset.part')))}
  finally {await f.close();await api.closeHttpClient()}
})
test('segmented ranges share cooldown and move to verified alternate without re-requesting the limited origin',async()=>{
  const bytes=Buffer.alloc(2*1024*1024,120),limited=await fixture((_req,res)=>{res.writeHead(429,{'retry-after':'86400'});res.end()}),healthy=await fixture((req,res)=>{const m=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range!);assert(m);const start=+m[1],end=+m[2];res.writeHead(206,{'content-range':`bytes ${start}-${end}/${bytes.length}`,'content-length':end-start+1});res.end(bytes.subarray(start,end+1))}),api=await runtime(limited.root);api.rateLimitTimeouts.maxWaitMs=100;api.downloadLimiter.configure({downloadThreads:2,downloadSpeedKBps:0})
  try {const dest=path.join(limited.root,'large');await api.downloadFile(limited.url,dest,undefined,hash(bytes),'official',undefined,[healthy.url],{size:bytes.length,maxSegments:1});assert.equal(limited.requests.length,1);assert.equal(healthy.requests.length,2);assert.equal(hash(fs.readFileSync(dest)),hash(bytes));assert(!fs.existsSync(dest+'.part'))}
  finally {await Promise.all([limited.close(),healthy.close()]);await api.closeHttpClient()}
})
