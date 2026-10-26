// Additional native GUI coverage. This never upgrades a partial matrix to a
// complete platform result, and never copies profiles, credentials or games.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const {execFileSync}=require('node:child_process')
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const MARKER='mac-parity-owner.json'
function parityRoot(env,platform=process.platform){
 assert.equal(platform,'darwin','persistent GUI profile is Mac-only')
 assert.equal(env.GITHUB_ACTIONS,'true','only a disposable native runner is authorized')
 assert(['first','restart'].includes(env.KAMUCL_PARITY_PHASE),'unknown persistent profile phase')
 assert.match(env.KAMUCL_PARITY_TOKEN||'',/^[a-f0-9]{32}$/)
 const root=fs.realpathSync.native(env.KAMUCL_PARITY_ROOT),base=fs.realpathSync.native(os.tmpdir())
 assert(root.startsWith(base+path.sep),'QA root must be a private native temporary directory')
 const marker=path.join(root,MARKER),stat=fs.lstatSync(marker)
 assert(stat.isFile()&&!stat.isSymbolicLink(),'QA ownership marker must be a real file')
 const owner=JSON.parse(fs.readFileSync(marker,'utf8'))
 assert.equal(owner.token,env.KAMUCL_PARITY_TOKEN);assert.equal(owner.root,root)
 assert.equal(owner.schemaVersion,1)
 for(const name of ['profile','games','second-games'])if(fs.existsSync(path.join(root,name))){
  const row=fs.lstatSync(path.join(root,name));assert(row.isDirectory()&&!row.isSymbolicLink(),'no linked QA profile or game directory')
  assert.equal(fs.realpathSync.native(path.join(root,name)),path.join(root,name))
 }
 if(env.KAMUCL_PARITY_PHASE==='first')assert(!fs.existsSync(path.join(root,'profile')),'first phase must use a fresh profile')
 else assert(fs.existsSync(path.join(root,'profile','settings.json')),'restart must retain first phase settings')
 return root
}
function assertRestartIdentity(first,restart){
 for(const field of ['version','sourceCommit','runtimeVersion','arch','executable','profile'])assert.equal(restart[field],first[field],'restart identity '+field)
 assert.notEqual(restart.pid,first.pid,'restart must be a new actual process')
 assert.equal(restart.publicAccountsPersisted,true);assert.equal(restart.mascotCountsPersisted,true)
 assert.equal(restart.settingsPersisted,true);assert.equal(restart.favoritePersisted,true)
 assert.equal(restart.actualUserData,restart.profile)
}
function assertNaturalOwnedClose(observation,pid){
 assert.equal(observation.child.pid,pid);assert.equal(observation.complete,true)
 assert.equal(observation.child.closed,true);assert.equal(observation.child.awaitedClose,true)
 assert.equal(observation.child.code,0);assert.equal(observation.child.signal,null)
 assert(!observation.child.events.some(row=>row.event==='SIGTERM-request'),'restart evidence requires a natural exit without forced signal')
 assert(observation.child.events.some(row=>row.event==='close'&&row.code===0&&row.signal===null),'observe the actual owned process close event')
}
function safeEvidence(directory,name,destination,expected){
 assert.equal(path.basename(name),name)
 const input=path.join(directory,name),row=fs.lstatSync(input)
 assert(row.isFile()&&!row.isSymbolicLink(),'evidence must be a real non-linked file')
 if(expected){assert.equal(row.size,expected.bytes);assert.equal(hash(input),expected.sha256,'current declared evidence bytes must match')}
 fs.copyFileSync(input,destination,fs.constants.COPYFILE_EXCL)
 return{file:path.basename(destination),bytes:row.size,sha256:hash(destination)}
}
async function run(){
 assert.equal(process.platform,'darwin');assert.equal(process.env.GITHUB_ACTIONS,'true')
 const [appArgument,arch,stage='app']=process.argv.slice(2),appPath=path.resolve(appArgument),pkg=require('../package.json')
 assert.equal(process.arch,arch);assert(['app','dmg'].includes(stage))
 const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
 const identity=require('./mac-package-identity.cjs').readMacPackageIdentity(appPath,{version:pkg.version,arch,sourceCommit,runtimeVersion:pkg.devDependencies.electron,minimumSystemVersion:'13.0.0'})
 const proof=path.resolve(`release/mac-parity-proof-${arch}-${stage}`);fs.mkdirSync(proof,{recursive:true})
 const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'KAMUCL Mac parity 中文 '))),token=crypto.randomBytes(16).toString('hex')
 fs.writeFileSync(path.join(root,MARKER),JSON.stringify({schemaVersion:1,root,token}),{flag:'wx'})
 const result={schemaVersion:1,version:pkg.version,sourceCommit,arch,stage,packageIdentity:identity,startedAt:new Date().toISOString(),complete:false,nativeDesktop:false,fullParityAcceptance:false,classification:'Additional actual signed Mac GUI with synthetic disposable instance metadata; actual offline-account/settings/counters and real public Modrinth install. No Microsoft/Ygg authentication, multiplayer or physical listening claim.',phases:[],files:[]}
 const save=()=>fs.writeFileSync(path.join(proof,'summary.json'),JSON.stringify(result,null,2))
 fs.mkdirSync('out',{recursive:true})
 assert(!fs.existsSync(path.join(proof,'summary.json')),'native parity output must be fresh')
 for(const phase of ['first','restart'])assert(!fs.existsSync(`out/mac-parity-${phase}.json`),'refuse stale phase evidence')
 save();let originalError
 try{
  for(const phase of ['first','restart']){
   const log=path.join(proof,phase+'-process.log'),fd=fs.openSync(log,'wx')
   try{
    execFileSync(process.execPath,['scripts/verify-ui-refinement.cjs','black-orange'],{timeout:phase==='first'?15*60*1000:3*60*1000,stdio:['ignore',fd,fd],env:{...process.env,KAMUCL_GUI_APP:path.join(appPath,'Contents/MacOS/KAMUCL'),KAMUCL_EXTENSION_GUI:'1',KAMUCL_EXTENSION_ONLY:'1',KAMUCL_SKIP_EXTENSION_BASE:'1',KAMUCL_UI_MODULE:'mac-parity',KAMUCL_PARITY_PHASE:phase,KAMUCL_PARITY_ROOT:root,KAMUCL_PARITY_TOKEN:token,KAMUCL_OBSERVER_TRACE_CONTROL119:'1'}})
   }finally{fs.closeSync(fd)}
   const input=path.resolve(`out/mac-parity-${phase}.json`);assert(fs.existsSync(input),'phase must write its own actual receipt')
   const receipt=JSON.parse(fs.readFileSync(input,'utf8'));assert.equal(receipt.phase,phase);assert.equal(receipt.identity.sourceCommit,sourceCommit);assert.equal(receipt.complete,true)
   const observed=fs.readdirSync('out').filter(name=>/^qa-owned-process-119-[a-f0-9-]+\.json$/.test(name)).map(name=>({name,value:JSON.parse(fs.readFileSync(path.join('out',name),'utf8'))})).filter(row=>row.value.child?.pid===receipt.identity.pid&&Date.parse(row.value.child.startedAt)>=Date.parse(result.startedAt))
   assert.equal(observed.length,1,'one current actual owned closure receipt per phase');assertNaturalOwnedClose(observed[0].value,receipt.identity.pid)
   receipt.ownedNaturalClose={...observed[0].value,file:phase+'-owned-process.json'}
   result.files.push(safeEvidence('out',observed[0].name,path.join(proof,phase+'-owned-process.json')))
   result.phases.push(receipt);result.files.push(safeEvidence(path.dirname(input),path.basename(input),path.join(proof,phase+'.json')));save()
  }
  assertRestartIdentity(result.phases[0].identity,{...result.phases[1].identity,...result.phases[1].restart})
  result.complete=true;result.nativeDesktop=true
 }catch(error){originalError=error;result.error={name:error.name,message:error.message};process.exitCode=1;throw error}
 finally{
  try{
  // Copy only explicit screenshots/JSON and the current burst's own declared
  // compositor frames. Never recurse through the temporary profile or games.
  const shots=path.resolve('release/ui-refinement-black-orange'),currentReceipts=[]
  if(fs.existsSync(shots)){const row=fs.lstatSync(shots);assert(row.isDirectory()&&!row.isSymbolicLink(),'screenshots directory cannot be linked')}
  for(const phase of ['first','restart']){
   const input=path.resolve(`out/mac-parity-${phase}.json`),dest=path.join(proof,phase+'.json')
   if(fs.existsSync(input)){
    const receipt=JSON.parse(fs.readFileSync(input,'utf8'));assert.equal(receipt.phase,phase);assert.equal(receipt.sourceCommit,sourceCommit);assert.equal(receipt.identity.profile,path.join(root,'profile'));currentReceipts.push(receipt)
    const names=new Set()
    for(const row of receipt.screenshots){assert.match(row.screenshot,new RegExp('^mac-parity-'+phase+'-[a-z0-9-]+\\.png$'));assert(!names.has(row.screenshot),'duplicate screenshot declaration');names.add(row.screenshot);result.files.push(safeEvidence(shots,row.screenshot,path.join(proof,row.screenshot),row))}
    if(!fs.existsSync(dest))result.files.push(safeEvidence(path.dirname(input),path.basename(input),dest))
   }
  }
  const recordingRoot=path.resolve('out/mac-parity-queue-burst-black-orange')
  const declaredRecording=currentReceipts.find(receipt=>receipt.phase==='first')?.queueRecording
  if(declaredRecording){
   const directoryStat=fs.lstatSync(recordingRoot);assert(directoryStat.isDirectory()&&!directoryStat.isSymbolicLink(),'original recording directory cannot be linked')
   const recording=JSON.parse(fs.readFileSync(path.join(recordingRoot,'recording.json'),'utf8')),destination=path.join(proof,'queue-compositor-original');fs.mkdirSync(destination)
   assert.deepEqual(recording,declaredRecording,'collect only this native attempt\'s exact declared original recording');assert(Date.parse(recording.startedAt)>=Date.parse(result.startedAt))
   const names=['recording.json',...recording.frames.map(frame=>frame.file)]
   assert.equal(new Set(names).size,names.length,'recording cannot repeat a target')
   for(const name of names){assert(name==='recording.json'||/^frame-\d{4}\.jpg$/.test(name));const row=safeEvidence(recordingRoot,name,path.join(destination,name));result.files.push({...row,file:'queue-compositor-original/'+row.file})}
  }
  }catch(error){result.complete=false;result.nativeDesktop=false;result.collectionError={name:error.name,message:error.message};if(!originalError)throw error}
  finally{result.finishedAt=new Date().toISOString();save()}
 }
}
module.exports={parityRoot,assertRestartIdentity,assertNaturalOwnedClose,safeEvidence}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1})
