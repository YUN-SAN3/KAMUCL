// Execute only after the parent hands over GUI ownership and provides the frozen EXE SHA.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process')
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),out=path.resolve('out'),binder=require('./receipt-capes115.cjs'),cim=require('./owned-cim115.cjs')
const args=process.argv.slice(2);assert.equal(args[0],'--execute','Explicit execution and GUI ownership are required');const expected=args[1];assert(/^[a-f0-9]{64}$/.test(expected),'Pass the parent-frozen executable SHA')
const application=path.resolve('release/KAMUCL-1.1.15.exe');assert.equal(hash(fs.readFileSync(application)),expected)
const sources=path.resolve('out/qa-capes115-black-orange-f8d2f35a-e14f-458f-9462-308067c2c4be'),themes=args.slice(2).length?args.slice(2):['black-orange','blue-white','transparent','custom']
assert(themes.every(theme=>['black-orange','blue-white','transparent','custom'].includes(theme)));assert.equal(new Set(themes).size,themes.length)
const id=crypto.randomUUID(),directory=path.join(out,'acceptance-1.1.15','capes-final-'+id);fs.mkdirSync(directory,{recursive:true})
const result={schema:'kamucl-capes115-sequential-native-driver',application:{file:application,sha256:expected},directory,startedAt:new Date().toISOString(),complete:false,runs:[],classification:'Sequential original portable application processes; public texture fixtures and synthetic account IPC only. No other apps are controlled.'},save=()=>fs.writeFileSync(path.join(directory,'driver.json'),JSON.stringify(result,null,2))
const receipt=file=>{const bytes=fs.readFileSync(file);return{file,bytes:bytes.length,sha256:hash(bytes)}}
const list=p=>fs.readdirSync(out).filter(p)
result.sources=['out/run-capes115-final.cjs','out/owned-cim115.cjs','out/receipt-capes115.cjs'].map(file=>receipt(path.resolve(file)))
;(async()=>{try{
 for(const theme of themes){
  assert.equal(hash(fs.readFileSync(application)),expected);const beforeDirs=new Set(list(name=>name.startsWith('qa-capes115-'+theme+'-'))),beforeOwned=new Set(list(name=>name.startsWith('qa-owned-process-119-')&&name.endsWith('.json'))),logFile=path.join(directory,theme+'.log'),log=fs.openSync(logFile,'wx')
  const env={...process.env,KAMUCL_GUI_APP:application,KAMUCL_EXTENSION_GUI:'1',KAMUCL_EXTENSION_ONLY:'1',KAMUCL_SKIP_EXTENSION_BASE:'1',KAMUCL_UI_MODULE:'capes115',KAMUCL_CAPE_PUBLIC_FIXTURE_ROOT:sources};delete env.KAMUCL_GUI_DEV;delete env.KAMUCL_GUI_SOFTWARE;delete env.ELECTRON_RUN_AS_NODE
  const run={theme,startedAt:new Date().toISOString(),complete:false,logFile};result.runs.push(run);save()
  const child=spawn(process.execPath,['scripts/verify-ui-refinement.cjs',theme],{cwd:path.resolve('.'),env,stdio:['ignore',log,log]});run.driverPid=child.pid;save()
  const seen=new Map();run.windowsOwnedSamples=[];let sampling=true
  const sampler=(async()=>{while(sampling){try{run.windowsOwnedSamples.push(await cim.snapshot(child.pid,seen));save()}catch(error){run.windowsSamplerError={name:error.name,message:error.message};save();break}await new Promise(resolve=>setTimeout(resolve,200))}})()
  const packet=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({pid:child.pid,code,signal,closedAt:new Date().toISOString()}))});sampling=false;await sampler;fs.closeSync(log);run.close=packet;run.log=receipt(logFile);run.windowsOwnedAfter=await cim.snapshot(child.pid,seen);save()
  const dirs=list(name=>name.startsWith('qa-capes115-'+theme+'-')&&!beforeDirs.has(name));assert.equal(dirs.length,1,'One actual fresh proof directory required');run.proofDirectory=path.join(out,dirs[0]);const proof=JSON.parse(fs.readFileSync(path.join(run.proofDirectory,'proof.json')))
  const owned=list(name=>name.startsWith('qa-owned-process-119-')&&name.endsWith('.json')&&!beforeOwned.has(name)).map(name=>({file:path.join(out,name),value:JSON.parse(fs.readFileSync(path.join(out,name)))})).filter(row=>row.value.child?.pid===proof.ownedProcess?.pid)
  assert.equal(owned.length,1,'One exact original owned process close packet required');run.ownedProcess=receipt(owned[0].file);run.ownedClose=owned[0].value.child.events.filter(row=>row.event==='close');run.afterOwnedInventory=owned[0].value.after
  save();assert.equal(packet.code,0);assert.equal(packet.signal,null);assert.equal(owned[0].value.complete,true);assert.equal(run.ownedClose.length,1);assert.equal(run.ownedClose[0].code,0);assert.equal(run.ownedClose[0].signal,null)
  assert.equal(run.windowsSamplerError,undefined);assert(run.windowsOwnedSamples.length>0);assert.equal(run.windowsOwnedAfter.available,true);assert.equal(run.windowsOwnedAfter.rows.length,0,'All observed own Windows process IDs/descendants must be absent after actual close')
  const ownedIdentities=[...seen.values()];assert(ownedIdentities.some(row=>row.pid===proof.ownedProcess.pid));assert(ownedIdentities.some(row=>row.pid===proof.identity.pid));assert(proof.ownedAppMetricsBeforeClose.length>0);for(const metric of proof.ownedAppMetricsBeforeClose){assert(Number.isSafeInteger(metric.pid)&&metric.pid>0);assert(ownedIdentities.some(row=>row.pid===metric.pid),'Original app.getAppMetrics PID must be linked by observed own parent/creation-time: '+metric.pid)}
  run.binding=binder.bind(run.proofDirectory,{requiredSuccess:true});run.complete=true;save();console.log(JSON.stringify({theme,complete:true,directory:run.proofDirectory}))
 }
 result.complete=true
 }catch(error){result.error={name:error.name,message:error.message};process.exitCode=1}
 finally{result.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({directory,complete:result.complete,receipt:receipt(path.join(directory,'driver.json'))}))}
})()
