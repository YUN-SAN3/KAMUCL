// After Intel APP six-case ABA and DMG formal collection; attribution only.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),{createHash}=require('node:crypto'),assert=require('node:assert/strict')
const allowedFile=name=>!name.toLowerCase().includes('private')&&/\.(?:json|bgra|png|log)$/.test(name)
function eligible({version,arch,stage,ci}){return version===require('../package.json').version&&require('./ui-capabilities.cjs').singleLogo&&arch==='x64'&&stage==='dmg'&&ci==='true'}
function copySafe(from,to,receipt,root=to){
 fs.mkdirSync(to,{recursive:true})
 for(const entry of fs.readdirSync(from,{withFileTypes:true})){
  assert(!entry.isSymbolicLink(),'no symlink in independent diagnostic evidence')
  if(entry.name.toLowerCase().includes('private'))continue
  const source=path.join(from,entry.name),target=path.join(to,entry.name)
  if(entry.isDirectory())copySafe(source,target,receipt,root)
  else if(allowedFile(entry.name)){fs.copyFileSync(source,target);receipt.push({file:path.relative(root,target),bytes:fs.statSync(target).size,sha256:createHash('sha256').update(fs.readFileSync(target)).digest('hex')})}
 }
}
function run(options,dependencies={}){
 if(!eligible(options))return{enabled:false}
 const {env,exe,extensionProof}=options,outRoot=options.outRoot||'out',began=Date.now(),proof={classification:'Independent control/trace/control attribution after original formal collection; cannot replace original six cases, false FPS or failures',normalAcceptanceChanged:false,startedAt:new Date(began).toISOString(),deadlineMs:90000,executionBudgetMs:85000,ownedCleanupBudgetMs:5000,complete:false,directories:[],copied:[]}
 const invoke=dependencies.invoke||execFileSync
 try{
  const appRoot=options.appRoot||path.resolve('release/mac-proof-x64-app/extensions'),prior=JSON.parse(fs.readFileSync(path.join(appRoot,'observer-aba-preflight.json')))
  assert(prior.complete===true&&prior.processExitCode===0&&prior.directories.length===1,'original independent six-case ABA must finish before trace controls')
  const original=JSON.parse(fs.readFileSync(path.join(appRoot,prior.directories[0].name,'observer-aba.json')))
  assert(original.complete===true&&original.cases.length===6&&original.cases.every(c=>c.complete),'all original six cases must remain complete')
  proof.priorABA={source:prior.directories[0].name,startedAt:original.startedAt,finishedAt:original.finishedAt,sourceSHA256:original.sourceSHA256??null}
  invoke(process.execPath,['scripts/verify-ui-refinement.cjs'],{env:{...env,KAMUCL_GUI_APP:exe,KAMUCL_EXTENSION_GUI:'1',KAMUCL_EXTENSION_ONLY:'1',KAMUCL_SKIP_EXTENSION_BASE:'1',KAMUCL_UI_MODULE:'native-compositor',KAMUCL_OBSERVER_TRACE_CONTROL119:'1',KAMUCL_TEST_THEME:'black-orange'},stdio:'inherit',timeout:proof.executionBudgetMs,killSignal:'SIGTERM'})
  proof.processExitCode=0
 }catch(error){proof.error={name:error.name,code:error.code??null,status:error.status??null,signal:error.signal??null};console.warn('DIAGNOSTIC trace controls failed; original formal result unchanged',proof.error)}
 finally{
  try{
   for(const name of fs.readdirSync(outRoot).filter(n=>/^kamu-observer-trace-control-119-[0-9a-f-]{36}-black-orange$/.test(n))){
    const source=path.join(outRoot,name),file=path.join(source,'observer-aba.json'),result=JSON.parse(fs.readFileSync(file));if(Date.parse(result.startedAt)<began)continue
    const files=[];copySafe(source,path.join(extensionProof,name),files);proof.directories.push({name,complete:result.complete===true,files,sourceSHA256:result.sourceSHA256??null})
   }
   for(const name of fs.readdirSync(outRoot).filter(n=>/^qa-owned-process-119-[0-9a-f-]{36}\.json$/.test(n)))if(fs.statSync(path.join(outRoot,name)).mtimeMs>=began){const target=path.join(extensionProof,'owned-process-ledgers',name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(outRoot,name),target);proof.copied.push('owned-process-ledgers/'+name)}
  }catch(error){proof.collectionError=error.name;console.warn('DIAGNOSTIC trace collection failure retained',error.name)}
  proof.finishedAt=new Date().toISOString();proof.elapsedMs=Date.now()-began;proof.complete=proof.processExitCode===0&&!proof.collectionError&&proof.directories.length===1&&proof.directories.every(d=>d.complete)&&proof.elapsedMs<=proof.deadlineMs
  try{fs.writeFileSync(path.join(extensionProof,'trace-control-preflight.json'),JSON.stringify(proof,null,2))}catch(error){console.warn('DIAGNOSTIC trace receipt failure retained',error.name)}
 }
 return proof
}
module.exports={run,eligible,allowedFile,copySafe}
