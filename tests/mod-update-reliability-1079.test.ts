import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { build } from 'esbuild'
import { createRequire } from 'node:module'

const hash=(bytes:Buffer|string)=>crypto.createHash('sha1').update(bytes).digest('hex')
async function harness(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'KAMUCL 模组更新 1079 ')),dir=path.join(root,'games','mods')
 fs.mkdirSync(dir,{recursive:true})
 const h:any={root,dir,requests:[] as string[],errors:[] as string[],settings:{mirror:'bmclapi',downloadThreads:4},broken:false,running:false}
 const latest={id:'new-version',project_id:'project',version_number:'2',files:[{filename:'new.jar',url:'https://cdn.modrinth.com/data/project/versions/new/new.jar',primary:true,size:3,hashes:{sha1:hash('new')}}]}
 const server=http.createServer((req,res)=>{
  h.requests.push(req.url)
  if(req.method==='POST'){let body='';req.on('data',b=>body+=b);req.on('end',()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(Object.fromEntries(JSON.parse(body).hashes.map((sha:string)=>[sha,latest]))))});return}
  if(req.url?.startsWith('/official')||h.broken){res.writeHead(503);res.end('unavailable');return}
  res.writeHead(200,{'Content-Length':3});res.end('new')
 })
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const endpoint=`http://127.0.0.1:${(server.address() as any).port}`
 h.fetch=(url:string,init:any)=>fetch(endpoint+(url.includes('mcimirror.top')?'/mirror':'/official')+new URL(url).pathname,init)
 const mocks:Record<string,string>={
  electron:`export const app={getPath:()=>h.root,getVersion:()=> 'test'}`,
  settings:'export const getSettings=()=>h.settings',
  community:"export const cfChannel=()=>({key:''})",
  httpClient:'export const httpFetch=(...args)=>h.fetch(...args)',
  modScan:`export const scanManagedModDirectory=async()=>fs.readdirSync(h.dir).filter(n=>/\.jar(?:\.disabled)?$/.test(n)).map(n=>({fileName:n,name:'Fabric API',version:'1',id:'fabric-api',sha1:crypto.createHash('sha1').update(fs.readFileSync(path.join(h.dir,n))).digest('hex')}))`,
  resourceDirectory:'export const resolveResourceDirectory=async()=>h.dir',
  paths:'export const folderOfVersion=()=>path.dirname(h.dir)',
  versions:'export const readVersionJson=()=>({})',
  instanceMetadata:"export const resolveInstanceMetadata=()=>({mcVersion:'26.2',loader:'fabric'})",
  modManagement:"export const assertModsIdle=async()=>{if(h.running)throw Error('游戏正在运行')}",
  launcherLog:'export const logScope=()=>({info:()=>{},error:(text,error)=>h.errors.push(text+error.message)})'
 }
 const result=await build({stdin:{contents:`export * from './src/main/core/modUpdates';export * from './src/main/core/modState';`,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'private-mod-test',setup(b){
  b.onResolve({filter:/^(\.\/|electron$)/},a=>{const key=a.path.replace('./','');if(mocks[key])return{path:key,namespace:'mock'}})
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:`import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';const h=globalThis.__mod1079;`+mocks[a.path],loader:'js'}))
 }}]})
 ;(globalThis as any).__mod1079=h;const m={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),m,m.exports)
 const write=(name:string,body='old')=>fs.writeFileSync(path.join(dir,name),body)
 return{h,root,dir,api:m.exports,write,latest,close:async()=>{delete(globalThis as any).__mod1079;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));assert(path.dirname(root)===os.tmpdir());fs.rmSync(root,{recursive:true,force:true})}}
}
test('mod updater uses selected mirror when official CDN fails; verifies backup and preserves disabled state',async()=>{
 const t=await harness();try{
  t.write('原名.jar.disabled');const report=await t.api.checkModUpdates('fabric')
  assert.equal(report.entries[0].update.versionId,'new-version');assert(t.h.requests[0].startsWith('/mirror/'))
  const update=report.entries[0].update
  const r=await t.api.applyModUpdates('fabric',[{fileName:'原名.jar.disabled',oldSha1:hash('old'),targetName:update.fileName,url:update.url,sha1:update.sha1,size:update.size}])
  assert.equal(r[0].ok,true,JSON.stringify(r));assert.equal(fs.readFileSync(path.join(t.dir,'new.jar.disabled'),'utf8'),'new');assert(!fs.existsSync(path.join(t.dir,'原名.jar.disabled')))
  assert(!t.h.requests.some((p:string)=>p.startsWith('/official')))
  const backups=path.join(t.root,'instance-backups'),key=fs.readdirSync(backups)[0],record=fs.readdirSync(path.join(backups,key)).find(n=>!n.startsWith('.'))!
  assert.equal(fs.readFileSync(path.join(backups,key,record,'files/mods/原名.jar.disabled'),'utf8'),'old')
 }finally{await t.close()}
})
test('failed mod download is logged with its phase, preserves original and can be retried; locked mods stay untouched',async()=>{
 const t=await harness();try{
  t.write('old.jar');const item={fileName:'old.jar',oldSha1:hash('old'),targetName:'new.jar',url:t.latest.files[0].url,sha1:hash('new'),size:3}
  t.h.broken=true;let r=await t.api.applyModUpdates('fabric',[item]);assert.equal(r[0].ok,false);assert.match(r[0].error,/下载新模组失败/);assert.match(r[0].error,/new.jar/);assert(t.h.errors.some((e:string)=>e.includes('old.jar')&&e.includes('下载新模组失败')));assert.equal(fs.readFileSync(path.join(t.dir,'old.jar'),'utf8'),'old')
  t.h.broken=false;r=await t.api.applyModUpdates('fabric',[item]);assert(r[0].ok,JSON.stringify(r))
  t.write('locked.jar');t.api.setModLocked(t.dir,hash('old'),true);const before=t.h.requests.length;r=await t.api.applyModUpdates('fabric',[{...item,fileName:'locked.jar'}]);assert.match(r[0].error,/锁定/);assert.equal(t.h.requests.length,before);assert.equal(fs.readFileSync(path.join(t.dir,'locked.jar'),'utf8'),'old')
 }finally{await t.close()}
})
