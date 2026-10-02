const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict')
const {execFileSync,spawn}=require('child_process'),{promisify}=require('util')
const exec=promisify(require('child_process').execFile)
const wait=ms=>new Promise(r=>setTimeout(r,ms))
module.exports=async function(appPath,arch){
  assert.equal(process.env.GITHUB_ACTIONS,'true')
  const proof=path.resolve(`release/mac-proof-${arch}/extra`);fs.mkdirSync(proof,{recursive:true})
  const runtime=execFileSync('find',[path.join(os.homedir(),'Library/Caches/electron'),'-name',`electron-v33.4.11-darwin-${arch}.zip`,'-print','-quit'],{encoding:'utf8'}).trim()
  assert(runtime,'electron-builder runtime archive missing')
  const runtimeDir=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-runtime-'))
  execFileSync('/usr/bin/ditto',['-x','-k',runtime,runtimeDir])
  const electron=path.join(runtimeDir,'Electron.app/Contents/MacOS/Electron')
  const failures=[]
  try { for(const args of [['scripts/verify-glass-startup.cjs'],['scripts/verify-glass-startup.cjs','--reduced'],['scripts/verify-mac-tools.cjs']]){
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
    const child=spawn(electron,args,{stdio:'inherit',env})
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
    if(code!==0)failures.push(`native verification failed (${code}): ${args.join(' ')}`)
  } } finally {
  for(const name of fs.readdirSync('out').filter(x=>x.startsWith('glass-startup-'))) fs.cpSync(path.join('out',name),path.join(proof,name),{recursive:true})
  if(fs.existsSync(`release/mac-tools-proof-${arch}`))fs.cpSync(`release/mac-tools-proof-${arch}`,path.join(proof,'network-tools'),{recursive:true})
  }
  try{await require('./verify-mac-update.cjs')(appPath,arch,proof)}catch(e){console.error(e);failures.push(e.message)}
  assert.deepEqual(failures,[],'native integration checks failed')
}
