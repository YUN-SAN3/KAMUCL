import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { build } from 'esbuild'
import AdmZip from 'adm-zip'
import type { ProgressEvent } from '../src/shared/types'

test('Actual Forge pack pipeline reports Java readiness, drains the installer and commits overrides before completion', {timeout:15000}, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl installer116 中文 ')), game=path.join(root,'games'), base=path.join(game,'versions','1.20.1')
  fs.mkdirSync(base,{recursive:true});fs.mkdirSync(path.join(root,'userData'))
  fs.writeFileSync(path.join(base,'1.20.1.json'),JSON.stringify({id:'1.20.1',libraries:[],mainClass:'net.minecraft.client.main.Main'}));fs.writeFileSync(path.join(base,'1.20.1.jar'),'synthetic client; never launched')
  const jar=new AdmZip();jar.addFile('install_profile.json',Buffer.from('{"libraries":[]}'));const archive=jar.toBuffer(), hash=crypto.createHash('sha1').update(archive).digest('hex')
  const server=http.createServer((req,res)=>{if(req.url?.endsWith('.sha1'))return res.end(hash);res.writeHead(200,{'content-length':archive.length});res.end(archive)})
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  const events:ProgressEvent[]=[],javaStarted=Promise.withResolvers<void>(),javaReady=Promise.withResolvers<void>(),require=createRequire(path.resolve('package.json'))
  let spawned=0,closed=0, runtime:any,work:Promise<string>|undefined
  const source=await build({stdin:{contents:"export {installModpack} from './src/main/core/modpacks';export {getSettings} from './src/main/core/settings';export {closeHttpClient} from './src/main/core/httpClient'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',logLevel:'silent',plugins:[{name:'fixture-java-only',setup(b){b.onLoad({filter:/[\\/]core[\\/]java\.ts$/},a=>({loader:'ts',contents:fs.readFileSync(a.path,'utf8').replace('export function ensureJava(', 'function originalEnsureJava(')+"\nexport async function ensureJava(_v,emit){emit({stage:'java-scan',progress:0,indeterminate:true,text:'Fixture Java inspection active'});globalThis.__installerFixture116.started();await globalThis.__installerFixture116.ready;return 'fixture-java116';}"}))}}]})
  ;(globalThis as any).__installerFixture116={started:()=>javaStarted.resolve(),ready:javaReady.promise}
  const fakeSpawn=(exe:string,args:string[],options:any)=>{
    if(exe!=='fixture-java116')return require('node:child_process').spawn(exe,args,options)
    spawned++;const proc:any=new EventEmitter();proc.stdout=new PassThrough();proc.stderr=new PassThrough();let stopped=false
    proc.kill=()=>{stopped=true;setImmediate(()=>{closed++;proc.emit('close',null)});return true}
    setImmediate(()=>{if(stopped)return;proc.stdout.write('Fixture processor running\n');const dest=path.join(options.cwd,'versions','fixture-forge116');fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(path.join(dest,'fixture-forge116.json'),JSON.stringify({id:'fixture-forge116',inheritsFrom:'1.20.1',_mcVersion:'1.20.1',_loader:'forge',_loaderVersion:'47.4.23',libraries:[],mainClass:'fixture.Main'}));proc.stdout.end();proc.stderr.end();closed++;proc.emit('close',0)})
    return proc
  }
  try{
    const module={exports:{}};new Function('require','module','exports',source.outputFiles[0].text)((name:string)=>name==='electron'?{app:{getPath:(n:string)=>path.join(root,n),getVersion:()=> 'test',isPackaged:false}}:name==='node:child_process'?{...require(name),spawn:fakeSpawn}:name==='undici'?{...require(name),fetch:(input:string,init:any)=>require(name).fetch(String(input).replace('https://maven.minecraftforge.net',url),init)}:require(name),module,module.exports);runtime=module.exports
    Object.assign(runtime.getSettings(),{gameDir:game,activeFolder:game,folders:[{path:game,name:'Fixture',isDefault:true}],mirror:'official'})
    const pack=new AdmZip();pack.addFile('modrinth.index.json',Buffer.from(JSON.stringify({formatVersion:1,game:'minecraft',name:'Forge fixture116',versionId:'test',dependencies:{minecraft:'1.20.1',forge:'47.4.23'},files:[]})));pack.addFile('overrides/config/fixture.txt',Buffer.from('committed after runtime'));const file=path.join(root,'fixture.mrpack');pack.writeZip(file)
    work=runtime.installModpack(file,(e:ProgressEvent)=>{events.push(e);if(e.stage==='done'){assert.equal(closed,1);assert.equal(fs.readFileSync(path.join(game,'versions','Forge fixture116','config/fixture.txt'),'utf8'),'committed after runtime')}},{instanceName:'Forge fixture116'})
    await Promise.race([javaStarted.promise,work!.then(()=>{throw Error('Installer completed without Java readiness')})])
    const processor=events.at(-1)!.parallelStages!.find(e=>e.id.endsWith('/processor'))!
    assert.equal(processor.state,'running');assert.equal(processor.indeterminate,true);assert.match(processor.text,/Java/);assert.equal(spawned,0);assert(events.at(-1)!.overall!<1)
    javaReady.resolve();assert.equal(await work,'Forge fixture116');assert.equal(spawned,1);assert.equal(closed,1);assert.equal(events.filter(e=>e.stage==='done').length,1)
    assert.equal(fs.readFileSync(path.join(base,'1.20.1.jar'),'utf8'),'synthetic client; never launched')
    if(process.env.KAMUCL_CAPTURE_PIPELINE116==='1'){
      const target=path.resolve('out','installer-pipeline116-events-'+crypto.randomUUID()+'.json')
      fs.writeFileSync(target,JSON.stringify({classification:'Original current production Forge pack orchestration events; only Java readiness and installer child are synthetic, no real JVM or game launch',events,spawned,closed,committedConfig:true,sourceHashes:['src/main/core/modpacks.ts','src/main/core/loaders.ts','src/main/core/parallelProgress.ts'].map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}))},null,2),{flag:'wx'})
      console.log(JSON.stringify({pipelineCapture:target}))
    }
  }finally{javaReady.resolve();await work?.catch(()=>{});delete (globalThis as any).__installerFixture116;await runtime?.closeHttpClient();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(root,{recursive:true,force:true})}
})
