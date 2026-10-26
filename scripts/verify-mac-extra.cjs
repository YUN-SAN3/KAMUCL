const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict')
const {execFileSync,spawn}=require('child_process'),{promisify}=require('util')
const exec=promisify(require('child_process').execFile)
const wait=ms=>new Promise(r=>setTimeout(r,ms))
module.exports=async function(appPath,arch,mode='all'){
  assert.equal(process.env.GITHUB_ACTIONS,'true')
  assert.equal(process.platform,'darwin');assert.equal(process.arch,arch)
  assert(['all','startup','tools','update'].includes(mode),'Unknown native integration group')
  const proof=path.resolve(`release/mac-extra-${arch}-${mode}`);fs.mkdirSync(proof,{recursive:true})
  const runtimeVersion=require('electron/package.json').version
  assert.equal(runtimeVersion,require('../package.json').devDependencies.electron,'native integration must use the shared locked runtime')
  const failures=[]
  const commands=[...(mode==='all'||mode==='startup'?[['scripts/verify-glass-startup.cjs'],['scripts/verify-glass-startup.cjs','--reduced']]:[]),...(mode==='all'||mode==='tools'?[['scripts/verify-mac-tools.cjs']]:[])]
  let electron
  if(commands.length){electron=require('electron');assert(fs.existsSync(electron),'installed native Electron executable missing')}
  const startedAt=Date.now(),runs=[]
  try { for(const args of commands){
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
    const child=spawn(electron,args,{stdio:'inherit',env})
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
    runs.push({args,code})
    if(code!==0)failures.push(`native verification failed (${code}): ${args.join(' ')}`)
  } } finally {
  for(const name of fs.readdirSync('out').filter(x=>x.startsWith('glass-startup-')&&fs.statSync(path.join('out',x)).mtimeMs>=startedAt)) fs.cpSync(path.join('out',name),path.join(proof,name),{recursive:true})
  if(fs.existsSync(`release/mac-tools-proof-${arch}`))fs.cpSync(`release/mac-tools-proof-${arch}`,path.join(proof,'network-tools'),{recursive:true})
  }
  if(mode==='all'||mode==='update')try{await require('./verify-mac-update.cjs')(appPath,arch,proof)}catch(e){console.error(e);failures.push(e.message)}
  fs.writeFileSync(path.join(proof,'integration.json'),JSON.stringify({version:require('../package.json').version,arch,mode,runtimeVersion,startedAt:new Date(startedAt).toISOString(),complete:failures.length===0,runs,failures},null,2))
  assert.deepEqual(failures,[],'native integration checks failed')
}
if(require.main===module)module.exports(path.resolve(process.argv[2]),process.argv[3],process.argv[4]||'all').catch(error=>{console.error(error);process.exitCode=1})
