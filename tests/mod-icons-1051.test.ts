import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'
import { Worker } from 'node:worker_threads'
import Zip from 'adm-zip'
import { curseFingerprint } from '../src/main/core/modIconIdentity'
const req=createRequire(path.resolve('package.json'))
function api(root:string){const b=buildSync({entryPoints:['src/main/core/modIcons.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});const m={exports:{} as any};new Function('require','module','exports','__dirname',b.outputFiles[0].text)((id:string)=>id==='electron'?{app:{getPath:()=>root,isPackaged:false}}:req(id),m,m.exports,root);return m.exports}
test('图标按哈希匹配 Modrinth 项目，CF 指纹必须同时符合 SHA1；不按文件名猜测',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mod-icons-'));try{
 const {matchModIcons}=api(root),items=[{fileName:'renamed.jar',sha1:'a',fingerprint:1},{fileName:'only-cf.jar.disabled',sha1:'b',fingerprint:2},{fileName:'same-name.jar',sha1:'c',fingerprint:3}]
 const calls:string[]=[];const result=await matchModIcons(items,async(url:string,body:any)=>{calls.push(url);if(url.endsWith('version_files'))return {a:{project_id:'p'}};if(url.includes('/projects?'))return [{id:'p',icon_url:'https://cdn.modrinth.com/p.png'}];if(url.endsWith('/fingerprints')){assert.deepEqual(body.fingerprints,[2,3]);return {data:{exactMatches:[{id:5,file:{modId:5,fileFingerprint:2,hashes:[{algo:1,value:'b'}]}},{id:6,file:{modId:6,fileFingerprint:3,hashes:[{algo:1,value:'WRONG'}]}}]}}};if(url.endsWith('/mods')){assert.deepEqual(body.modIds,[5]);return {data:[{id:5,logo:{thumbnailUrl:'https://media.forgecdn.net/cf.png'}}]}};throw Error(url)},{base:'https://fixture',key:'',official:false});assert.equal(result['renamed.jar'],'https://cdn.modrinth.com/p.png');assert.equal(result['only-cf.jar.disabled'],'https://media.forgecdn.net/cf.png');assert(!result['same-name.jar']);assert.equal(calls.length,4)
 assert.deepEqual(Object.keys(await matchModIcons(items,async()=>{throw Error('offline')},{base:'https://fixture',key:'',official:false})),[])
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
test('图标后台扫描只读取当前页指定常规 JAR，支持禁用文件并保留包内图标',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mod-icons-worker-'));try{
 const icon=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'),zip=new Zip();zip.addFile('fabric.mod.json',Buffer.from(JSON.stringify({schemaVersion:1,id:'fixture',version:'1',name:'Fixture',icon:'icon.png'})));zip.addFile('icon.png',icon);const data=zip.toBuffer();fs.writeFileSync(path.join(root,'yes.jar.disabled'),data);fs.writeFileSync(path.join(root,'not-requested.jar'),data)
 const workerFile=path.join(root,'worker.cjs');buildSync({entryPoints:['src/main/core/modScanWorker.ts'],bundle:true,platform:'node',format:'cjs',outfile:workerFile})
 const result:any=await new Promise((resolve,reject)=>{const w=new Worker(workerFile,{workerData:{dir:root,hash:true,names:['yes.jar.disabled','../outside.jar']}});w.once('message',r=>{void w.terminate();resolve(r)});w.once('error',reject)})
 assert.equal(result.result.length,1);assert.equal(result.result[0].fileName,'yes.jar.disabled');assert.match(result.result[0].sha1,/^[a-f0-9]{40}$/);assert.equal(result.result[0].fingerprint,curseFingerprint(data));assert(result.result[0].iconDataUrl.endsWith(icon.toString('base64')))
 assert.equal(curseFingerprint(Buffer.from('a \n\rb\tc')),curseFingerprint(Buffer.from('abc')))
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
