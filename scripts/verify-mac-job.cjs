// Every native job consumes one exact signed package; no cross-run proof stitching.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const {execFileSync}=require('node:child_process')
const {readMacPackageIdentity}=require('./mac-package-identity.cjs')
const [group,arch,stage='app']=process.argv.slice(2),pkg=require('../package.json')
assert.equal(process.platform,'darwin');assert.equal(process.arch,arch)
assert.equal(process.env.GITHUB_ACTIONS,'true','native job driver requires a disposable runner')
fs.mkdirSync(path.resolve('out'),{recursive:true})
assert(['ui','parity','game','startup','tools','update','gpu-diagnostic','download-location','favorites','batch120'].includes(group));assert(['app','dmg'].includes(stage))
const proof=path.resolve(`release/mac-job-${arch}-${stage}-${group}`);fs.mkdirSync(proof,{recursive:true})
const receipt={version:pkg.version,arch,stage,group,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),complete:false,steps:[]}
const save=()=>fs.writeFileSync(path.join(proof,'job.json'),JSON.stringify(receipt,null,2))
const run=(cmd,args,options={})=>execFileSync(cmd,args,{stdio:'inherit',...options})
const sha=async file=>{const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex')}
let mount,attached=false,nativeDisplay
;(async()=>{
 save()
 const manifest=JSON.parse(fs.readFileSync(`release/mac-package-${arch}.json`,'utf8'))
 assert.equal(manifest.version,pkg.version);assert.equal(manifest.arch,arch);assert.equal(manifest.commit,receipt.commit,'package and verification source must be the same commit')
 assert.equal(manifest.runtimeVersion,pkg.devDependencies.electron);assert.equal(Number(manifest.minimum.split('.')[0]),13)
 assert.equal(manifest.packageIntegrity,true);assert.equal(manifest.assets.length,2)
 for(const asset of manifest.assets){
  assert.equal(path.basename(asset.name),asset.name);assert([`KAMUCL-${pkg.version}-mac-${arch}.zip`,`KAMUCL-${pkg.version}-mac-${arch}.dmg`].includes(asset.name))
  const file=path.resolve('release',asset.name);assert.equal(fs.statSync(file).size,asset.bytes);assert.equal(await sha(file),asset.sha256)
 }
 receipt.package=manifest;receipt.steps.push('original ZIP/DMG size, SHA256, commit and locked runtime verified');save()
 const clean=fs.mkdtempSync(path.join(os.tmpdir(),'KAMUCL 原生验证 '))
 let appPath
 if(stage==='dmg'){
  mount=fs.mkdtempSync(path.join(os.tmpdir(),'KAMUCL DMG mount '))
  run('hdiutil',['verify',`release/KAMUCL-${pkg.version}-mac-${arch}.dmg`])
  run('hdiutil',['attach',`release/KAMUCL-${pkg.version}-mac-${arch}.dmg`,'-readonly','-nobrowse','-mountpoint',mount]);attached=true
  appPath=path.join(mount,'KAMUCL.app')
 }else{
  run('ditto',['-x','-k',`release/KAMUCL-${pkg.version}-mac-${arch}.zip`,clean]);appPath=path.join(clean,'KAMUCL.app')
 }
 const packageIdentity=readMacPackageIdentity(appPath,{version:pkg.version,arch,sourceCommit:receipt.commit,runtimeVersion:pkg.devDependencies.electron,minimumSystemVersion:manifest.minimum})
 assert.deepEqual(packageIdentity.identity,manifest.buildIdentity);assert.equal(packageIdentity.identitySHA256,manifest.buildIdentitySHA256)
 assert.equal(packageIdentity.identity.appAsarSHA256,manifest.appAsarSHA256);receipt.packageIdentity=packageIdentity
 const embedded=JSON.parse(require('asar').extractFile(path.join(appPath,'Contents/Resources/app.asar'),'package.json').toString())
 assert.equal(embedded.version,pkg.version)
 receipt.steps.push('clean native extraction or readonly mounted DMG, executable arch, ad-hoc signature and ASAR bytes verified');receipt.application=appPath;save()
 if(['ui','parity','favorites','batch120'].includes(group)){
  receipt.nativeDisplayProof=path.join(proof,'native-display113','display-proof.json');save()
  nativeDisplay=await require('./mac-native-display113.cjs').prepareNativeDisplay({outputDirectory:proof})
  assert.equal(nativeDisplay.proofFile,receipt.nativeDisplayProof)
  receipt.steps.push('actual native display inventory and requested layout capacity observed before navigation');save()
 }
 if(group==='ui')run(process.execPath,['scripts/verify-mac.cjs',appPath,arch,stage],{timeout:29*60*1000})
 else if(group==='parity')run(process.execPath,['scripts/verify-mac-parity.cjs',appPath,arch,stage],{timeout:22*60*1000})
 else if(group==='game')run(process.execPath,['scripts/verify-mac-game.cjs',appPath,arch],{timeout:28*60*1000})
 else if(group==='gpu-diagnostic')run(process.execPath,['scripts/verify-mac-gpu-diagnostic.cjs',appPath,arch],{timeout:5*60*1000})
 else if(group==='download-location')run(process.execPath,['scripts/verify-download-location-112.cjs',appPath,arch,stage],{timeout:15*60*1000})
 else if(group==='favorites')run(process.execPath,['scripts/verify-favorites-113.cjs',appPath,arch,stage],{timeout:29*60*1000})
 else if(group==='batch120')run(process.execPath,['scripts/verify-mac-batch120.cjs',appPath,arch,stage],{timeout:25*60*1000})
 else await require('./verify-mac-extra.cjs')(appPath,arch,group)
 receipt.steps.push(group==='gpu-diagnostic'?'isolated GPU diagnostic completed; no formal acceptance result is changed':'current native '+group+' checks completed');receipt.complete=true
 if(group==='gpu-diagnostic')receipt.classification='Diagnostic only; not GUI, motion or frame-rate acceptance'
})().catch(error=>{
 receipt.error={name:error.name,message:error.message,status:error.status??null,signal:error.signal??null};console.error(error);process.exitCode=1
 for(const [name,cmd,args] of [['system.txt','/usr/bin/sw_vers',[]],['graphics.txt','/usr/sbin/system_profiler',['SPDisplaysDataType']]]){
  try{fs.writeFileSync(path.join(proof,name),execFileSync(cmd,args,{timeout:20000,maxBuffer:4*1024*1024}))}catch(diagnosticError){receipt[name+'Error']=String(diagnosticError)}
 }
 // Only this disposable runner's current KAMUCL reports, never a player's files.
 const crashRoot=path.join(os.homedir(),'Library/Logs/DiagnosticReports')
 if(fs.existsSync(crashRoot))for(const name of fs.readdirSync(crashRoot)){
  const file=path.join(crashRoot,name)
  if(/^KAMUCL.*\.(?:ips|crash)$/.test(name)&&fs.statSync(file).mtimeMs>=Date.parse(receipt.startedAt))fs.copyFileSync(file,path.join(proof,name))
 }
}).finally(async()=>{
 if(nativeDisplay)try{await nativeDisplay.restore();receipt.nativeDisplayRestored=true}catch(error){receipt.complete=false;(receipt.cleanupErrors??=[]).push({stage:'native display restore',name:error.name,message:error.message});console.error(error);process.exitCode=1}
 if(attached)try{run('hdiutil',['detach',mount]);receipt.mountDetached=true}catch(error){receipt.complete=false;receipt.detachError=String(error);process.exitCode=1}
 receipt.finishedAt=new Date().toISOString();save()
})
