// QA-only repair against the exact original signed ZIP/DMG, never a rebuilt app.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process')
const {readMacPackageIdentity}=require('./mac-package-identity.cjs')
const SOURCE='0649ed5c7035a0809b9e73117da2b4ff0ea378bd',RUN='37680785679',MANIFEST='023723680704fc9f486af0b04df2a3ccd6a1d8f0b81d00e262218fce4517635d'
const ASSETS=[{name:'KAMUCL-1.1.20-mac-arm64.zip',bytes:125935198,sha256:'0b06dd56486a6b0dbe76313a1e2124a4848efa919352f7efd7e3e69805ff4ebe'},{name:'KAMUCL-1.1.20-mac-arm64.dmg',bytes:135777035,sha256:'8c4ea12185ac0139e572bba7e9fcff9cd2782489865275f79b739c7b7449a7d1'}]
const ALLOWED=new Set(['scripts/verify-mac-batch120.cjs','scripts/verify-mac-batch120-reuse.cjs','scripts/verify-mac-batch120-reuse-tests.cjs','.github/workflows/mac-batch120-reuse.yml','scripts/qa-download-status120.cjs','scripts/qa-community120.cjs','scripts/qa-community-input120-tests.cjs','tests/all.test.ts'])
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
function validateQaPaths(names){assert.equal(new Set(names).size,names.length,'Duplicate diff paths');for(const file of names)assert(ALLOWED.has(file),'Reused production package differs at forbidden path: '+file);return names}
function proveReuseSource(artifactSourceCommit,qaSourceCommit,{execute=execFileSync}={}){
 assert.equal(artifactSourceCommit,SOURCE);assert.match(qaSourceCommit,/^[a-f0-9]{40}$/)
 const git=args=>execute('git',args,{encoding:'utf8',windowsHide:true}).trim()
 assert.equal(git(['rev-parse','HEAD']),qaSourceCommit,'Actual QA HEAD changed');assert.equal(git(['status','--porcelain','--untracked-files=no']),'','Tracked checkout must remain unchanged')
 const changedPaths=validateQaPaths(git(['diff','--no-ext-diff','--no-textconv','--no-renames','--name-only','-z',artifactSourceCommit,qaSourceCommit]).split('\0').filter(Boolean))
 return{mode:'exact original artifact with explicitly bounded QA-only source differences',artifactSourceCommit,qaSourceCommit,changedPaths,allowedQaPaths:[...ALLOWED],unchanged:'All other Git-tracked bytes/modes, including shared production, version, lock/runtime, native and renderer'}
}
function verifyManifest(bytes){assert.equal(sha(bytes),MANIFEST,'Original raw package manifest SHA differs');const value=JSON.parse(bytes.toString());assert.equal(value.commit,SOURCE);assert.equal(value.version,'1.1.20');assert.equal(value.arch,'arm64');assert.equal(value.runtimeVersion,'44.3.0');assert.equal(value.frameworkVersion,'44.3.0');assert.equal(value.minimum,'13.0.0');assert.equal(value.packageIntegrity,true);assert.equal(value.buildIdentity.sourceCommit,SOURCE);assert.equal(value.buildIdentity.appAsarSHA256,value.appAsarSHA256);assert.deepEqual(value.assets,ASSETS);return value}
function originalPackageFiles(releaseDirectory=path.resolve('release')){
 // download-artifact with artifact-ids retains the original artifact-name
 // directory. Never reinterpret another manifest or silently choose a file.
 const directory=path.join(releaseDirectory,'mac-packages-arm64');assert(fs.lstatSync(directory).isDirectory()&&!fs.lstatSync(directory).isSymbolicLink(),'Original artifact directory required')
 const names=['mac-package-arm64.json',...ASSETS.map(a=>a.name)],files=Object.fromEntries(names.map(name=>{const file=path.join(directory,name);assert(fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink(),'Original regular artifact file required: '+name);return[name,file]}))
 return{directory,manifest:files[names[0]],zip:files[ASSETS[0].name],dmg:files[ASSETS[1].name]}
}
async function fileSHA(file){const hash=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(file))hash.update(bytes);return hash.digest('hex')}
async function run(){
 assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');assert.equal(process.env.GITHUB_ACTIONS,'true')
 const stage=process.argv[2];assert(['app','dmg'].includes(stage));const qaSourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),comparison=proveReuseSource(SOURCE,qaSourceCommit)
 const output=path.resolve('release/mac-batch120-reuse-arm64-'+stage);fs.mkdirSync(output,{recursive:true});const receiptFile=path.join(output,'reuse.json');assert(!fs.existsSync(receiptFile),'Never overwrite an earlier native retry')
 const receipt={complete:false,artifactRunId:RUN,artifactSourceCommit:SOURCE,qaSourceCommit,stage,comparison,startedAt:new Date().toISOString(),classification:'Actual original signed application; distinct QA source. Original all-run failures remain failures. This retry qualifies only batch120.'},save=()=>fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2));save()
 let mount,nativeDisplay,attached=false
 try{
  const origin=JSON.parse(fs.readFileSync('release/artifact-origin120.json','utf8'));assert.equal(origin.run.id,Number(RUN));assert.equal(origin.run.head_sha,SOURCE);assert.equal(origin.run.event,'workflow_dispatch');assert.equal(origin.run.path,'.github/workflows/mac-build.yml');assert.equal(origin.packageJob.id,112995968503);assert.equal(origin.packageJob.conclusion,'success');assert.equal(origin.artifact.id,11509975002);assert.equal(origin.artifact.digest,'sha256:c9edd19db7211b0f5358828195417fffb3f18f537e4c85497b270e6bd51b9e0b');assert.equal(origin.artifact.name,'mac-packages-arm64');assert.equal(origin.artifact.expired,false);assert.equal(origin.artifact.workflow_run.head_sha,SOURCE);receipt.origin=origin
  const originalFiles=originalPackageFiles(),bytes=fs.readFileSync(originalFiles.manifest),manifest=verifyManifest(bytes);receipt.originalFiles=originalFiles;receipt.manifestSHA256=sha(bytes);receipt.package=manifest
  for(const [index,asset]of ASSETS.entries()){const file=index===0?originalFiles.zip:originalFiles.dmg;assert.equal(fs.statSync(file).size,asset.bytes);assert.equal(await fileSHA(file),asset.sha256)}save()
  let app
  if(stage==='dmg'){mount=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'KAMUCL retry120 mount ')));execFileSync('hdiutil',['verify',originalFiles.dmg],{stdio:'inherit'});execFileSync('hdiutil',['attach',originalFiles.dmg,'-readonly','-nobrowse','-mountpoint',mount],{stdio:'inherit'});attached=true;app=path.join(mount,'KAMUCL.app')}
  else{const clean=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'KAMUCL retry120 clean ')));execFileSync('ditto',['-x','-k',originalFiles.zip,clean]);app=path.join(clean,'KAMUCL.app')}
  receipt.application=app;receipt.packageIdentity=readMacPackageIdentity(app,{version:'1.1.20',arch:'arm64',sourceCommit:SOURCE,runtimeVersion:'44.3.0',minimumSystemVersion:'13.0.0'});assert.deepEqual(receipt.packageIdentity.identity,manifest.buildIdentity);assert.equal(receipt.packageIdentity.identitySHA256,manifest.buildIdentitySHA256);save()
  nativeDisplay=await require('./mac-native-display113.cjs').prepareNativeDisplay({outputDirectory:output});receipt.nativeDisplayProof=nativeDisplay.proofFile;save()
  execFileSync(process.execPath,['scripts/verify-mac-batch120.cjs',app,'arm64',stage,'--package-source-commit='+SOURCE],{stdio:'inherit',timeout:25*60*1000})
  receipt.batchProof=JSON.parse(fs.readFileSync('release/mac-batch120-proof-arm64-'+stage+'/proof.json','utf8'));assert.equal(receipt.batchProof.complete,true);assert.equal(receipt.batchProof.artifactSourceCommit,SOURCE);assert.equal(receipt.batchProof.qaSourceCommit,qaSourceCommit);receipt.complete=true
 }catch(error){receipt.error={name:error.name,message:error.message,status:error.status??null,signal:error.signal??null};console.error(error);process.exitCode=1}
 finally{if(nativeDisplay)try{await nativeDisplay.restore();receipt.displayRestored=true}catch(error){receipt.complete=false;(receipt.cleanupErrors??=[]).push({stage:'display',message:error.message});process.exitCode=1}if(attached)try{execFileSync('hdiutil',['detach',mount],{stdio:'inherit'});receipt.mountDetached=true}catch(error){receipt.complete=false;(receipt.cleanupErrors??=[]).push({stage:'dmg',message:error.message});process.exitCode=1}receipt.finishedAt=new Date().toISOString();save()}
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1})
module.exports={SOURCE,RUN,MANIFEST,ASSETS,validateQaPaths,proveReuseSource,verifyManifest,originalPackageFiles}
