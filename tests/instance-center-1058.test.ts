import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { analyzeDiagnosticText } from '../src/main/core/diagnosticRules'
import { selectDiagnosticSession } from '../src/main/core/diagnosticSession'
async function harness(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-center-')),folder=path.join(root,'game'),other=path.join(root,'other'),user=path.join(root,'user')
 for(const d of [folder,other,user])fs.mkdirSync(d,{recursive:true})
 const dir=path.join(folder,'versions','source');fs.mkdirSync(path.join(dir,'mods'),{recursive:true});fs.mkdirSync(path.join(dir,'saves','world'),{recursive:true})
 fs.writeFileSync(path.join(dir,'source.json'),JSON.stringify({id:'source',_gameDir:true,_mcVersion:'1.21.1',mainClass:'net.minecraft.client.Main',downloads:{client:{url:'https://example.invalid/client.jar'}}}))
 fs.writeFileSync(path.join(dir,'source.jar'),'client');fs.writeFileSync(path.join(dir,'mods','a.jar.disabled'),'original');fs.writeFileSync(path.join(dir,'options.txt'),'lang:zh_cn');fs.writeFileSync(path.join(dir,'saves','world','region.mca'),'worlddata')
 const h:any={root,folder,other,user,dir,running:false,settings:{folders:[{path:folder,isDefault:true},{path:other}],activeFolder:folder,gameDir:folder}}
 const mocks:Record<string,string>={electron:'export const nativeImage={};export const app={getPath:(kind)=>kind==="temp"?h.root:h.user}',settings:'export const getSettings=()=>h.settings',launch:'export const getRunningVersionIds=()=>new Set(h.running?["source"]:[])',versions:`export const readVersionJson=id=>JSON.parse(fs.readFileSync(p.join(h.folder,'versions',id,id+'.json'),'utf8'));export const resolveVersionChain=id=>({merged:readVersionJson(id),baseId:id});export const clientJarPath=id=>p.join(h.folder,'versions',id,id+'.jar');export const listAllInstalled=()=>[{id:'source',folder:h.folder}]`}
 mocks.gameDirectoryUse='export const externalGameUsesDirectory=async()=>false'
 const result=await build({stdin:{contents:`export * from './src/main/core/instanceCenter';export * from './src/main/core/backupStore';export * from './src/main/core/changeProtection';export * from './src/main/core/modState';`,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^(\.\/|electron$)/},a=>{const k=a.path.replace('./','');if(mocks[k])return {path:k,namespace:'fixture'}});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:`import fs from 'node:fs';import p from 'node:path';const h=globalThis.__centerFixture;${mocks[a.path]}`}))}}]})
 ;(globalThis as any).__centerFixture=h
 const module={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(path.resolve('package.json')),module,module.exports)
 return {...h,api:module.exports,cleanup:()=>{fs.rmSync(root,{recursive:true,force:true});delete (globalThis as any).__centerFixture}}
}
test('1058 backup roundtrip checks hashes, absent roots and tampering before restore',async()=>{
 const h=await harness();try{const b=new h.api.BackupStore(path.join(h.root,'backups')),m=await b.create(h.dir,['mods/a.jar.disabled','mods/new.jar'],'before',true)
 assert.equal(m.files.length,1);assert.equal(m.files[0].sha256.length,64)
 const out=path.join(h.root,'restore');fs.mkdirSync(out);await b.materialize(m.id,out);assert.equal(fs.readFileSync(path.join(out,'mods/a.jar.disabled'),'utf8'),'original');assert.equal(fs.existsSync(path.join(out,'mods/new.jar')),false)
 fs.writeFileSync(path.join(b.directory,m.id,'files','mods','a.jar.disabled'),'tampered');await assert.rejects(()=>b.verify(m.id),/校验/)
 }finally{h.cleanup()}
})
test('1058 automatic retention leaves five records and never removes manual backups',async()=>{
 const h=await harness();try{const b=new h.api.BackupStore(path.join(h.root,'backups'));await b.create(h.dir,['options.txt'],'manual');for(let i=0;i<7;i++)await b.create(h.dir,['options.txt'],'auto'+i,true);const list=await b.list();assert.equal(list.filter((m:any)=>m.automatic).length,5);assert.equal(list.filter((m:any)=>!m.automatic).length,1)}finally{h.cleanup()}
})
test('1058 cancellation, traversal and source edits never publish a partial backup',async()=>{
 const h=await harness();try{const b=new h.api.BackupStore(path.join(h.root,'backups'));await assert.rejects(()=>b.create(h.dir,['../outside'],'bad'),/路径/);const ctrl=new AbortController();await assert.rejects(()=>b.create(h.dir,['mods','options.txt'],'cancel',false,undefined,ctrl.signal,()=>ctrl.abort()));assert.equal((await b.list()).length,0);await assert.rejects(()=>b.create(h.dir,['options.txt'],'changed',false,undefined,undefined,()=>fs.writeFileSync(path.join(h.dir,'options.txt'),'changed-source')),/发生变化/);assert.equal((await b.list()).length,0)}finally{h.cleanup()}
})
test('1058 clone is independently editable, preserves disabled mods and locks across target folders',async()=>{
 const h=await harness();try{const hash='a'.repeat(40);h.api.setModLocked(path.join(h.dir,'mods'),hash,true);const result=await h.api.cloneInstance({folder:h.folder,id:'source'},'copy',h.other,true,false);const dest=path.join(h.other,'versions','copy');assert.equal(result.folder,h.other);assert.equal(JSON.parse(fs.readFileSync(path.join(dest,'copy.json'),'utf8')).id,'copy');assert.equal(fs.readFileSync(path.join(dest,'copy.jar'),'utf8'),'client');assert.equal(fs.existsSync(path.join(dest,'saves/world/region.mca')),true);assert.equal(h.api.isModLocked(path.join(dest,'mods'),hash),true);fs.writeFileSync(path.join(dest,'mods/a.jar.disabled'),'changed');assert.equal(fs.readFileSync(path.join(h.dir,'mods/a.jar.disabled'),'utf8'),'original');await assert.rejects(()=>h.api.cloneInstance({folder:h.folder,id:'source'},'copy',h.other),/已存在/)}finally{h.cleanup()}
})
test('1058 full snapshot and change protection restore as a new independent instance',async()=>{
 const h=await harness();try{const t={folder:h.folder,id:'source'},b=await h.api.backupInstance(t);fs.writeFileSync(path.join(h.dir,'options.txt'),'changed');await h.api.cloneInstance(t,'restored',h.other,true,true,undefined,undefined,b.id);assert.equal(fs.readFileSync(path.join(h.other,'versions/restored/options.txt'),'utf8'),'lang:zh_cn');const p=await h.api.protectModChange(path.join(h.dir,'mods'),['a.jar.disabled','new.jar'],'before');fs.unlinkSync(path.join(h.dir,'mods/a.jar.disabled'));fs.writeFileSync(path.join(h.dir,'mods/new.jar'),'new');await h.api.cloneInstance(t,'rollback',h.other,true,true,undefined,undefined,p.id);assert.equal(fs.existsSync(path.join(h.other,'versions/rollback/mods/new.jar')),false);assert.equal(fs.readFileSync(path.join(h.other,'versions/rollback/mods/a.jar.disabled'),'utf8'),'original');assert.equal(fs.readFileSync(path.join(h.dir,'mods/new.jar'),'utf8'),'new')}finally{h.cleanup()}
})
test('1058 diagnostics require explicit evidence and redact secret values',()=>{
 assert.equal(analyzeDiagnosticText('at example.mods.sodium.Renderer.render(Renderer.java:4)')[0].confidence,'unknown')
 const cases=[['java-version','java.lang.UnsupportedClassVersionError: class file version 65'],['java-argument','Unrecognized VM option bad'],['memory','java.lang.OutOfMemoryError: Java heap space'],['dependency','Missing mandatory dependencies: example'],['duplicate','Found duplicate mods'],['graphics','GLFW error 65542'],['disk','ENOSPC'],['native-arch','incompatible architecture (have x86_64, need arm64)']]
 for(const[rule,log]of cases)assert.equal(analyzeDiagnosticText(log)[0].rule,rule)
 const r=analyzeDiagnosticText('access_token=secret-token\nPermission denied');assert.ok(!JSON.stringify(r).includes('secret-token'))
})

test('1058 diagnostics separate same-name instances, select newest session and reject old shared logs',()=>{
 const make=(dir:string,date:string,log:string)=>({versionId:'same',effectiveGameDir:dir,startedAt:date,logDir:log})
 const uuid='12345678-1234-1234-1234-123456789abc',own=make('/games/one','2026-09-11T12:00:00Z','/logs/'+uuid)
 assert.equal(selectDiagnosticSession('same','/games/one',[make('/games/two','2026-09-12T12:00:00Z','/logs/'+uuid),make('/games/one','2026-09-13T12:00:00Z','/logs'),own]),own)
 assert.equal(selectDiagnosticSession('other','/games/one',[own]),undefined)
})

test('1058 overwrite restore preserves a manual recovery record and rejects changed source',async()=>{
 const h=await harness();try{const t={folder:h.folder,id:'source'},b=await h.api.backupInstance(t);fs.writeFileSync(path.join(h.dir,'options.txt'),'new-settings');await h.api.restoreInstanceInPlace(t,b.id);assert.equal(fs.readFileSync(path.join(h.dir,'options.txt'),'utf8'),'lang:zh_cn');const records=await h.api.instanceBackups(h.dir).list();assert.ok(records.some((r:any)=>r.title==='实例覆盖恢复前'));await assert.rejects(()=>h.api.restoreInstanceInPlace(t,b.id,undefined,()=>fs.writeFileSync(path.join(h.dir,'options.txt'),'changed-during-restore')),/发生变化/);assert.equal(fs.readFileSync(path.join(h.dir,'options.txt'),'utf8'),'changed-during-restore');assert.ok(!fs.readdirSync(path.dirname(h.dir)).some(n=>n.startsWith('.kamucl-restore-old-')))}finally{h.cleanup()}
})

test('1058 world restore defaults to a new copy and protects explicit overwrite',async()=>{
 const h=await harness();try{const t={folder:h.folder,id:'source'},b=await h.api.backupInstance(t,'world',false,'world');fs.writeFileSync(path.join(h.dir,'saves/world/region.mca'),'new-world');await h.api.restoreWorld(t,b.id,'世界副本',false);assert.equal(fs.readFileSync(path.join(h.dir,'saves/世界副本/region.mca'),'utf8'),'worlddata');await assert.rejects(()=>h.api.restoreWorld(t,b.id,'world',false),/已存在/);await h.api.restoreWorld(t,b.id,'world',true);assert.equal(fs.readFileSync(path.join(h.dir,'saves/world/region.mca'),'utf8'),'worlddata');assert.ok((await h.api.instanceBackups(h.dir).list()).some((r:any)=>r.title==='存档覆盖恢复前'))}finally{h.cleanup()}
})

test('1058 running games and links outside an instance prevent backup without changing files',async()=>{
 const h=await harness();try{(globalThis as any).__centerFixture.running=true;await assert.rejects(()=>h.api.backupInstance({folder:h.folder,id:'source'}),/正在运行/);(globalThis as any).__centerFixture.running=false;const outside=path.join(h.root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'private.txt'),'untouched');fs.symlinkSync(outside,path.join(h.dir,'external'),process.platform==='win32'?'junction':'dir');await assert.rejects(()=>h.api.backupInstance({folder:h.folder,id:'source'}),/符号链接/);assert.equal(fs.readFileSync(path.join(outside,'private.txt'),'utf8'),'untouched');fs.unlinkSync(path.join(h.dir,'external'));assert.equal((await h.api.instanceBackups(h.dir).list()).length,0)}finally{h.cleanup()}
})
