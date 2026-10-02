import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { parse as parseJs } from '@babel/parser'
import { ref, reactive, isProxy } from 'vue'
import { filterFavorites, linkFavoriteRecords, removeFavoriteRecords, type ModFavorite } from '../src/shared/modFavorites'
import { reorderGallery } from '../src/shared/galleryOrder'

const shaA = 'a'.repeat(40), shaB = 'b'.repeat(40)
const records: ModFavorite[] = [
  {key:'modrinth:alpha',source:'modrinth',projectId:'alpha',name:'Alpha',added:30,sha1:shaA},
  {key:'curseforge:123',source:'curseforge',projectId:'123',name:'Beta',added:20},
  {key:'sha1:'+shaB,name:'未知本地模组',sha1:shaB,added:10}
]
test('gallery drag and keyboard reordering preserve stable mixed keys and never add unknown keys', () => {
  const keys = ['builtin:piston', 'C:/managed/a.webp', 'builtin:sunset', 'C:/managed/b.webp']
  assert.deepEqual(reorderGallery(keys, keys[0], keys[3]), [keys[1], keys[2], keys[3], keys[0]])
  assert.deepEqual(reorderGallery(keys, keys[3], keys[0]), [keys[3], keys[0], keys[1], keys[2]])
  assert.deepEqual(reorderGallery(keys, 'untrusted', keys[0]), keys)
  assert.deepEqual(reorderGallery(keys, keys[0], 'removed'), keys)
  assert.deepEqual(keys, ['builtin:piston', 'C:/managed/a.webp', 'builtin:sunset', 'C:/managed/b.webp'])
})
test('central favorites filter offline by platform, unlinked records, project IDs and retained hashes', () => {
  assert.deepEqual(filterFavorites(records,{keyword:'',source:'unlinked',sort:'newest'}).map(f=>f.key), ['sha1:'+shaB])
  assert.deepEqual(filterFavorites(records,{keyword:'123',source:'curseforge',sort:'name'}).map(f=>f.name), ['Beta'])
  assert.deepEqual(filterFavorites(records,{keyword:'ALPHA',source:'all',sort:'newest'}).map(f=>f.name), ['Alpha'])
  assert.deepEqual(filterFavorites(records,{keyword:'',source:'all',sort:'oldest'}).map(f=>f.added), [10,20,30])
  assert.equal(filterFavorites([{...records[0],sha1s:[shaB]}],{keyword:shaB,source:'all',sort:'name'}).length,1)
  assert.equal(records[0].added,30)
})
test('manual linking deduplicates projects while retaining the earliest date and every local SHA1', () => {
  const linked=linkFavoriteRecords(records,'sha1:'+shaB,{source:'modrinth',projectId:'alpha',name:'真实模组名称'})
  assert.equal(linked.length,2)
  const project=linked.find(f=>f.key==='modrinth:alpha')!
  assert.equal(project.name,'真实模组名称');assert.equal(project.added,10)
  assert.deepEqual(new Set(project.sha1s),new Set([shaA,shaB]))
  assert.equal(project.sha1,shaB)
  assert.equal(records.length,3)
  assert.throws(()=>linkFavoriteRecords(records,'removed',{source:'modrinth',projectId:'alpha',name:'Alpha'}),/已被取消/)
})
test('batch unfavorite is atomic for stale selections and preserves unrelated and unlinked records', () => {
  assert.deepEqual(removeFavoriteRecords(records,['modrinth:alpha','modrinth:alpha','curseforge:123']),[records[2]])
  assert.throws(()=>removeFavoriteRecords(records,['modrinth:alpha','removed']),/失效/)
  assert.throws(()=>removeFavoriteRecords(records,[]),/失效/)
  assert.equal(records.length,3)
})
test('actual centralized favorites, community and gallery templates compile', () => {
  for(const file of ['components/CommunityFavorites.vue','components/CommunityModDetails.vue','components/ConfirmModal.vue','views/CommunityView.vue','components/HomeLayoutEditor.vue','components/FileManager.vue','components/FavoriteModsPicker.vue']){
    const {descriptor,errors}=parse(fs.readFileSync('src/renderer/src/'+file,'utf8'));assert.deepEqual(errors,[])
    const script=compileScript(descriptor,{id:file})
    assert.deepEqual(compileTemplate({source:descriptor.template!.content,filename:file,id:file,compilerOptions:{bindingMetadata:script.bindings}}).errors,[])
  }
})
test('GUI harness browser and main-process expressions parse independently of the host script', () => {
  const file='scripts/verify-gallery-favorites-118-ui.cjs', source=fs.readFileSync(file,'utf8'), ast=parseJs(source)
  let checked=0
  function visit(value:any){
    if(!value||typeof value!=='object')return
    if(value.type==='CallExpression'&&value.callee.type==='Identifier'&&['evaluate','main','ready'].includes(value.callee.name)){
      const expression=value.arguments[value.callee.name==='ready'?1:0]
      const code=expression?.type==='StringLiteral'?expression.value:expression?.type==='TemplateLiteral'?expression.quasis.map((q:any)=>q.value.cooked).join('null'):undefined
      if(code){try{parseJs(code,{allowAwaitOutsideFunction:true})}catch(error){throw new Error(`${file}:${value.loc?.start.line}: ${code}`,{cause:error})}checked++}
    }
    for(const child of Object.values(value))if(Array.isArray(child))child.forEach(visit);else if(child&&typeof child==='object')visit(child)
  }
  visit(ast);assert(checked>=20)
})

const require=createRequire(path.resolve('package.json'))
let runtimeBundle:Promise<string>|undefined
async function runtime(invoke:(channel:string,...args:any[])=>Promise<any>){
  runtimeBundle??=build({entryPoints:['src/renderer/src/modFavorites.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'services',setup(plugin){
    plugin.onResolve({filter:/^\.\/(api|store)$/},args=>args.importer.endsWith('modFavorites.ts')?{path:args.path,namespace:'service'}:undefined)
    plugin.onLoad({filter:/.*/,namespace:'service'},args=>({contents:args.path==='./api'?'export function errText(e){return e.message}':'export function toast(message){window.errors.push(message)}',loader:'js'}))
  }}]}).then(result=>result.outputFiles[0].text)
  const module={exports:{} as any},window={kamucl:{invoke},errors:[] as string[]}
  new Function('require','module','exports','window',await runtimeBundle)(require,module,module.exports,window)
  return {...module.exports,errors:window.errors}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
test('queued Vue ref/reactive selections become stable plain structured-cloneable IPC arrays',async()=>{
  let list=[...records],release!:()=>void
  const gate=new Promise<void>(resolve=>{release=resolve}),payloads:string[][]=[]
  const r=await runtime(async(channel,...args)=>{
    if(channel==='mods:favorites')return [...list]
    if(channel==='mods:favorite'){await gate;return [...list]}
    if(channel==='mods:favoriteRemove'){
      assert.equal(isProxy(args[0]),false)
      const snapshot=structuredClone(args[0]);payloads.push(snapshot);list=removeFavoriteRecords(list,snapshot)
    }
    return [...list]
  })
  await r.loadFavorites()
  const selection=ref(['modrinth:alpha','curseforge:123','modrinth:alpha']);assert(isProxy(selection.value))
  assert.throws(()=>structuredClone(selection.value))
  const blocked=r.toggleProject('modrinth','queued','Queued'),removal=r.removeFavorites(selection.value)
  selection.value.splice(0,selection.value.length,'sha1:'+shaB)
  await tick();assert(r.favoriteBusy.value.has('modrinth:alpha'));assert(r.favoriteBusy.value.has('curseforge:123'));release()
  assert.equal(await blocked,true);assert.equal(await removal,true)
  assert.deepEqual(payloads,[['modrinth:alpha','curseforge:123']]);assert.deepEqual(r.favorites.value.map((f:ModFavorite)=>f.key),['sha1:'+shaB])
  assert.equal(await r.removeFavorites(reactive(['sha1:'+shaB])),true);assert.deepEqual(r.favorites.value,[])
})
test('optional local project associations are plain IPC objects even when callers pass Vue reactive values',async()=>{
  const link=reactive({source:'modrinth',projectId:'alpha'}),r=await runtime(async(channel,...args)=>{
    assert.equal(channel,'mods:favoriteLocal');assert.equal(isProxy(args[4]),false)
    assert.deepEqual(structuredClone(args[4]),{source:'modrinth',projectId:'alpha'})
    return [...records]
  })
  assert.equal(await r.setLocalFavorite('sha1:'+shaB,'version','folder','mod.jar',true,link),true)
})
test('shared queue serializes a bulk removal and another project toggle, blocks duplicate link/bulk writes and rolls back failure',async()=>{
  let list=[...records],release!:()=>void,fail=true,requests=0
  const blocked=new Promise<void>(resolve=>{release=resolve})
  const r=await runtime(async(channel,...args)=>{
    if(channel==='mods:favorites')return [...list]
    requests++
    if(channel==='mods:favoriteRemove'){await blocked;if(fail)throw Error('批量写入失败');list=removeFavoriteRecords(list,args[0])}
    else if(channel==='mods:favorite'){list=[...list,{key:args[0].source+':'+args[0].projectId,...args[0],added:50}]}
    return [...list]
  })
  await r.loadFavorites()
  const removal=r.removeFavorites(['modrinth:alpha','curseforge:123'])
  assert.equal(await r.linkFavorite('sha1:'+shaB,'modrinth','alpha'),false)
  assert.equal(await r.removeFavorites(['curseforge:123']),false)
  const other=r.toggleProject('modrinth','other','Other')
  await tick();assert.equal(requests,1);release()
  assert.equal(await removal,false);assert.equal(await other,true)
  assert.deepEqual(r.favorites.value.map((f:ModFavorite)=>f.key),[...records.map(f=>f.key),'modrinth:other'])
  assert.equal(r.favoriteBusy.value.size,0);assert.deepEqual(r.errors,['批量写入失败'])
  assert.equal(r.favoriteErrors.value.get('modrinth:alpha'),'批量写入失败');assert.equal(r.favoriteErrors.value.get('curseforge:123'),'批量写入失败')
  fail=false;const retry=r.removeFavorites(['modrinth:alpha','curseforge:123']);assert.equal(r.favoriteErrors.value.size,0);assert.equal(await retry,true)
  assert.deepEqual(r.favorites.value.map((f:ModFavorite)=>f.key),['sha1:'+shaB,'modrinth:other'])
})
test('exact project/link failures remain keyed for visible retry controls and unrelated mutations retain those errors',async()=>{
  const r=await runtime(async(channel)=>{if(channel==='mods:favoriteLink')throw Error('来源平台拒绝：项目不是 MOD');return [...records]})
  await r.loadFavorites();assert.equal(await r.linkFavorite('sha1:'+shaB,'modrinth','alpha'),false)
  assert.equal(r.favoriteErrors.value.get('sha1:'+shaB),'来源平台拒绝：项目不是 MOD')
  assert.equal(r.favoriteErrors.value.get('modrinth:alpha'),'来源平台拒绝：项目不是 MOD')
  await r.toggleProject('modrinth','other','Other');assert.equal(r.favoriteErrors.value.get('sha1:'+shaB),'来源平台拒绝：项目不是 MOD')
  r.clearFavoriteErrors(['sha1:'+shaB]);assert(!r.favoriteErrors.value.has('sha1:'+shaB));assert(r.favoriteErrors.value.has('modrinth:alpha'))
})

test('manual project validation accepts only verified Minecraft mods and resolves Modrinth slugs to canonical IDs',async()=>{
  const result=await build({entryPoints:['src/main/core/community.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'isolated-community',setup(plugin){
    plugin.onResolve({filter:/^\.\/(download|versions|instances|settings|launcherLog|curseforgeKey)$/},args=>args.importer.endsWith('/community.ts')||args.importer.endsWith('\\community.ts')?{path:args.path,namespace:'service'}:undefined)
    plugin.onLoad({filter:/.*/,namespace:'service'},()=>({contents:"export function downloadAll(){};export function readVersionJson(){};export function instanceDirectoryState(){};export function getSettings(){return{curseforgeApiKey:''}};export function logScope(){return{info(){},warn(){},error(){}}};export const CF_BUILTIN_KEY='';",loader:'js'}))
  }}]})
  const module={exports:{} as any};let payload:any,urls:string[]=[]
  const fetch=async(url:string)=>{urls.push(url);return{ok:true,json:async()=>payload}}
  new Function('require','module','exports','fetch',result.outputFiles[0].text)(require,module,module.exports,fetch)
  payload={id:'canonical',project_type:'mod',title:'Verified'}
  assert.deepEqual(await module.exports.communityModProject('modrinth','my-slug'),{source:'modrinth',projectId:'canonical',name:'Verified'})
  assert(urls[0].endsWith('/project/my-slug'))
  const missing=await module.exports.communityProject('modrinth','my-slug','mod')
  assert.equal(missing.downloads,undefined);assert.equal(missing.followers,undefined);assert.equal(missing.license,undefined)
  payload={...payload,description:'<script>plain text, never HTML</script>',slug:'verified',license:{id:'MIT',name:'MIT License'},downloads:0,followers:3,categories:['utility'],updated:'2026-10-02T10:00:00Z'}
  const details=await module.exports.communityProject('modrinth','my-slug','mod')
  assert.equal(details.kind,'mod');assert.equal(details.description,payload.description);assert.equal(details.license,'MIT License');assert.equal(details.downloads,0)
  assert.equal(details.webpage,'https://modrinth.com/mod/verified');assert.deepEqual(details.categories,['utility'])
  await assert.rejects(module.exports.communityProject('modrinth','my-slug','resourcepack'),/仅支持 MOD/)
  payload={id:'pack',project_type:'modpack',title:'Pack'};await assert.rejects(module.exports.communityModProject('modrinth','pack'),/不是有效模组/)
  payload={data:{id:123,gameId:432,classId:6,name:'CF Mod'}}
  assert.deepEqual(await module.exports.communityModProject('curseforge','123'),{source:'curseforge',projectId:'123',name:'CF Mod'})
  payload.data={...payload.data,summary:'Real CF summary',links:{websiteUrl:'javascript:alert(1)'},downloadCount:-1}
  const cf=await module.exports.communityProject('curseforge','123','mod');assert.equal(cf.description,'Real CF summary');assert.equal(cf.downloads,undefined);assert.equal(cf.license,undefined);assert.equal(cf.webpage,undefined)
  payload.data.links.websiteUrl='https://www.curseforge.com/minecraft/mc-mods/real-cf';assert.equal((await module.exports.communityProject('curseforge','123','mod')).webpage,payload.data.links.websiteUrl)
  payload.data.classId=12;await assert.rejects(module.exports.communityModProject('curseforge','123'),/不是有效 Minecraft 模组/)
  payload.data.classId=6;payload.data.gameId=1;await assert.rejects(module.exports.communityModProject('curseforge','123'),/不是有效 Minecraft 模组/)
  const before=urls.length;await assert.rejects(module.exports.communityModProject('curseforge','../123'),/有效的来源/);assert.equal(urls.length,before)
})
test('main IPC linking and cancellation persist merged SHA1s, keep old records on validation failure and reject stale bulk changes',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-favorites-118-'))
  try{
    fs.writeFileSync(path.join(directory,'mod-favorites.json'),JSON.stringify(records))
    const result=await build({entryPoints:['src/main/core/modFavorites.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'isolated-main',setup(plugin){
      plugin.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'service'}))
      plugin.onResolve({filter:/^\.\/(community|modManagement|resourceDirectory|modState|modTransaction|modInstallPlan)$/},args=>args.importer.endsWith('modFavorites.ts')?{path:args.path,namespace:'service'}:undefined)
      plugin.onLoad({filter:/.*/,namespace:'service'},args=>({contents:args.path==='electron'?'export const app={getPath:()=>globalThis.directory},ipcMain={handle:(key,fn)=>globalThis.handlers[key]=fn}':"export async function communityModProject(source,id){if(globalThis.fail)throw Error('验证失败');return{source,projectId:id,name:'Validated'}};export function communityFiles(){};export function withCommunitySignal(_s,run){return run()};export function modCatalog(){};export function identify(){};export function resolveResourceDirectory(){};export function modIdentity(){};export function rememberModIdentity(){};export function validateModFile(){};export function dependencyGraph(){};export const dependencyRepository={};",loader:'js'}))
    }}]})
    const context={directory,handlers:{} as Record<string,Function>,fail:false},module={exports:{} as any}
    new Function('require','module','exports','globalThis',result.outputFiles[0].text)(require,module,module.exports,context)
    module.exports.registerModFavoritesIpc()
    const before=fs.readFileSync(path.join(directory,'mod-favorites.json'),'utf8')
    context.fail=true;await assert.rejects(context.handlers['mods:favoriteLink']({},'sha1:'+shaB,'modrinth','alpha'),/验证失败/)
    assert.equal(fs.readFileSync(path.join(directory,'mod-favorites.json'),'utf8'),before)
    context.fail=false;await context.handlers['mods:favoriteLink']({},'sha1:'+shaB,'modrinth','alpha')
    const persisted=context.handlers['mods:favorites']();assert.equal(persisted.length,2)
    assert.deepEqual(new Set(persisted.find((f:ModFavorite)=>f.key==='modrinth:alpha').sha1s),new Set([shaA,shaB]))
    assert.throws(()=>context.handlers['mods:favoriteRemove']({},['modrinth:alpha','removed']),/失效/)
    assert.equal(context.handlers['mods:favorites']().length,2)
    context.handlers['mods:favoriteRemove']({},['curseforge:123']);assert.equal(context.handlers['mods:favorites']().length,1)
  }finally{fs.rmSync(directory,{recursive:true,force:true})}
})
