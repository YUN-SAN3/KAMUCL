import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import AdmZip from 'adm-zip'
import { build } from 'esbuild'

async function load(file: string, root: string): Promise<any> {
  const built=await build({entryPoints:[file],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'})
  const req=createRequire(path.resolve('package.json')),mod={exports:{}}
  new Function('require','module','exports',built.outputFiles[0].text)((name:string)=>name==='electron'?{app:{getPath:()=>root,getVersion:()=> '1.1.5',isPackaged:true}}:req(name),mod,mod.exports)
  return mod.exports
}
test('Mac updater rejects foreign roots and escaping symlinks before extraction',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mac-update-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const {validateMacArchive}=await load('src/main/core/macUpdate.ts',root)
  function archive(name:string,link?:string){const z=new AdmZip();z.addFile('KAMUCL.app/Contents/Resources/app.asar',Buffer.from('test'));z.addFile(name,Buffer.from(link??'x'));if(link)z.getEntry(name)!.attr=0xa1ff0000;const file=path.join(root,'test.zip');z.writeZip(file);return file}
  assert.doesNotThrow(()=>validateMacArchive(archive('KAMUCL.app/Contents/Frameworks/Versions/Current','A')))
  assert.throws(()=>validateMacArchive(archive('Other.app/Contents/MacOS/Other')),/越界/)
  assert.throws(()=>validateMacArchive(archive('KAMUCL.app/Contents/escape','../../../outside')),/越界/)
  assert.throws(()=>validateMacArchive(archive('KAMUCL.app/Contents/escape','/tmp/outside')),/越界/)
  const empty=new AdmZip();empty.addFile('KAMUCL.app/Contents/Info.plist',Buffer.from('x'));const file=path.join(root,'empty.zip');empty.writeZip(file);assert.throws(()=>validateMacArchive(file),/缺少/)
})
test('Mac update assets select architecture-specific ZIP while preserving Windows EXE',async()=>{
  const {updateAssetName}=await load('src/main/core/updateTrust.ts',os.tmpdir())
  assert.equal(updateAssetName('1.1.5','darwin','arm64'),'KAMUCL-1.1.5-mac-arm64.zip')
  assert.equal(updateAssetName('1.1.5','darwin','x64'),'KAMUCL-1.1.5-mac-x64.zip')
  assert.equal(updateAssetName('1.1.5','win32','x64'),'KAMUCL-1.1.5.exe')
})
