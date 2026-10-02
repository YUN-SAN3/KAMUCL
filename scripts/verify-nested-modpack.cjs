// Run against a supplied distribution ZIP. Only network/runtime installation is stubbed;
// parsing, instance creation and all override extraction use the production importer.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{build}=require('esbuild'),AdmZip=require('adm-zip');
(async()=>{
 const input=process.argv[2];assert(input,'Pass the distribution ZIP path')
 const root=fs.mkdtempSync(path.resolve('out/nested-pack-')),game=path.join(root,'game');let downloads=[]
 global.__nestedPackFixture={game,downloads}
 const output=await build({stdin:{contents:"export * from './src/main/core/modpacks'; export {saveSettings} from './src/main/core/settings'",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'isolated-runtime-network',setup(b){
  b.onResolve({filter:/^\.\/versions$/},a=>a.importer.endsWith('modpacks.ts')?({path:'versions',namespace:'fixture'}):undefined)
  b.onResolve({filter:/^\.\/download$/},a=>/modpack(?:s|Downloads)\.ts$/.test(a.importer)?({path:'download',namespace:'fixture'}):undefined)
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='versions'?`
   import fs from 'node:fs';import path from 'node:path';
   export const listAllInstalled=()=>[];export const flattenInstance=()=>{};
   export const readVersionJson=id=>JSON.parse(fs.readFileSync(path.join(global.__nestedPackFixture.game,'versions',id,id+'.json'),'utf8'));
   export async function installVersion(mc,opts){const id=opts.instanceName,dir=path.join(global.__nestedPackFixture.game,'versions',id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify({id,_mcVersion:mc,mainClass:'net.fabricmc.loader.impl.launch.knot.KnotClient',libraries:[]}));return id}
  `:`import fs from 'node:fs';import path from 'node:path';export const fetchSignal=()=>{throw Error('Unexpected network')};export async function downloadAll(tasks){global.__nestedPackFixture.downloads.push(...tasks);for(const t of tasks){fs.mkdirSync(path.dirname(t.dest),{recursive:true});fs.writeFileSync(t.dest,'network fixture')}}`}))
 }}]})
 const mod={exports:{}};new Function('require','module','exports','__dirname',output.outputFiles[0].text)(id=>id==='electron'?{app:{getPath:()=>root,isPackaged:false},BrowserWindow:{getAllWindows:()=>[]}}:require(id),mod,mod.exports,root)
 const api=mod.exports;fs.mkdirSync(game,{recursive:true});api.saveSettings({gameDir:game,activeFolder:game,folders:[{path:game,name:'Verification',isDefault:true}]})
 const info=await api.probeModpack(input),id=await api.installModpack(input,()=>{},{targetFolder:game});assert.equal(info.mcVersion,'1.21.11');assert.equal(info.loaderVersion,'0.19.2');assert.equal(downloads.length,59)
 const inner=new AdmZip(new AdmZip(input).getEntry('modpack.mrpack').getData());let verified=0
 for(const e of inner.getEntries()){if(e.isDirectory||!e.entryName.startsWith('overrides/'))continue;const dest=path.join(game,'versions',id,e.entryName.slice(10));assert(fs.readFileSync(dest).equals(e.getData()),e.entryName);verified++}
 assert(!fs.existsSync(path.join(game,'versions',id,'Plain Craft Launcher.exe')))
 const report={input,sha256:crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'),info,id,verifiedOverrideFiles:verified,downloadManifestFiles:downloads.length,limitations:'Minecraft runtime and 59 network downloads stubbed; real production parsing and all overrides extracted and compared byte-for-byte.'}
 fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,report:path.join(root,'report.json')},null,2));delete global.__nestedPackFixture
})().catch(e=>{console.error(e);process.exitCode=1})
