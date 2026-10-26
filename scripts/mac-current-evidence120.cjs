// Read-only retention from explicitly created disposable QA sessions. Never
// recurse into a profile or collect historical/outside-owned evidence.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const UX=/^qa-ux116-(?:black-orange|blue-white|transparent|custom)-[0-9a-f-]{36}$/
const OWNED=/^qa-owned-process-119-[0-9a-f-]{36}\.json$/
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
const inside=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep)}
function regular(file){assert(fs.lstatSync(file).isFile(),'Original evidence must be a regular file: '+file)}
function copy(file,target){regular(file);const bytes=fs.readFileSync(file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});return{file:path.basename(file),bytes:bytes.length,sha256:digest(bytes)}}
function snapshot(root){return new Set(fs.readdirSync(root).filter(name=>UX.test(name)||OWNED.test(name)))}
function retainLauncherLogs({root,profile,target,startedAt,endedAt=Date.now()}){
 const result={root,profile,startedAt,endedAt,classification:'Original launcher-session log bytes only, from this explicitly owned disposable profile',files:[],available:false}
 assert(Number.isFinite(startedAt)&&Number.isFinite(endedAt)&&endedAt>=startedAt)
 assert.equal(fs.realpathSync.native(root),root,'Owned root must be canonical')
 assert.equal(fs.realpathSync.native(profile),profile,'Owned profile must be canonical')
 assert(inside(root,profile),'Owned profile must remain inside its created root')
 const directory=path.join(profile,'logs')
 if(!fs.existsSync(directory)){result.absence='The actual owned profile has no logs directory';return result}
 assert(fs.lstatSync(directory).isDirectory(),'Owned logs directory must not be a link')
 for(const name of fs.readdirSync(directory)){
  if(!/^launcher-(?:current|\d{8}-\d{6}(?:-\d+)?)\.log$/.test(name))continue
  const file=path.join(directory,name);regular(file)
  const bytes=fs.readFileSync(file),header=/^\[(.*?)\] KAMUCL .* session started \(/m.exec(bytes.toString('utf8')),sessionStartedAt=header?Date.parse(header[1]):NaN
  // Track registration follows spawn; allow only the small launch interval,
  // not archives from an earlier profile/session. Retain original bytes.
  if(!Number.isFinite(sessionStartedAt)||sessionStartedAt<startedAt-5000||sessionStartedAt>endedAt)continue
  result.files.push({...copy(file,path.join(target,name)),sessionStartedAt})
 }
 result.available=result.files.length>0
 if(!result.available)result.absence='No log header belongs to the current owned launch interval'
 return result
}
function retainCurrent({out,target,before,startedAt,endedAt=Date.now()}){
 assert(before instanceof Set);const result={startedAt,endedAt,classification:'Current owned UUID evidence only; original bytes, not native acceptance',ledgers:[],modules:[],logs:[],errors:[]},owned=[]
 for(const name of fs.readdirSync(out)){
  if(before.has(name)||!OWNED.test(name))continue
  try{const file=path.join(out,name);regular(file);const value=JSON.parse(fs.readFileSync(file)),child=value.child,at=Date.parse(child?.startedAt)
   if(child?.label!=='refinement-app'||!Number.isInteger(child.pid)||at<startedAt||at>endedAt||!Number.isFinite(at))continue
   assert(value.root&&value.profile,'Current owned lifecycle receipt must record its exact root/profile')
   const binding={pid:child.pid,root:value.root,profile:value.profile,startedAt:at};owned.push(binding)
   result.ledgers.push({binding,...copy(file,path.join(target,'owned-process-ledgers',name))})
   result.logs.push(retainLauncherLogs({...binding,target:path.join(target,'launcher-sessions',String(child.pid)+'-'+at),endedAt}))
  }catch(error){result.errors.push({file:name,name:error.name,message:error.message})}
 }
 for(const name of fs.readdirSync(out)){
  if(before.has(name)||!UX.test(name))continue
  try{const directory=path.join(out,name);assert(fs.lstatSync(directory).isDirectory(),'Current UUID evidence must not be a link');const live=path.join(directory,'live.json');regular(live)
   const value=JSON.parse(fs.readFileSync(live)),identity=value.identity,matching=owned.filter(row=>(identity?.pid===row.pid||identity?.ppid===row.pid)&&identity?.profile===row.profile)
   assert.equal(matching.length,1,'Current module must bind to exactly one current owned app/profile')
   assert.equal(path.resolve(value.directory),directory,'Current UUID ledger must identify its own directory')
   const row={directory:name,binding:matching[0],files:[]};result.modules.push(row)
   for(const file of fs.readdirSync(directory))if(/^(?:live|failure|summary)\.json$/.test(file)||/^[a-zA-Z0-9_-]+\.png$/.test(file))row.files.push(copy(path.join(directory,file),path.join(target,'current-modules',name,file)))
   const namespace=value.macNativeAdapter?.receiptNamespace
   for(const receipt of value.macNativeRawReceipts??[]){assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(namespace),'Native receipts must identify their exact bridge UUID');assert(receipt.file.startsWith('native-action-'+namespace+'-')&&/^native-action-[0-9a-f-]{36}-\d+-(?:request|stdout)\.json$|^native-action-[0-9a-f-]{36}-\d+-(?:stdout|stderr)-error\.log$/.test(receipt.file),'Only explicit original native action receipts may be collected');const retained=copy(path.join(directory,receipt.file),path.join(target,'current-modules',name,receipt.file));assert.equal(retained.bytes,receipt.bytes);assert.equal(retained.sha256,receipt.sha256);row.files.push(retained)}
   // Do not copy the compiled helper, its temporary root or profile data.
  }catch(error){result.errors.push({file:name,name:error.name,message:error.message})}
 }
 result.complete=result.errors.length===0;return result
}
module.exports={snapshot,retainCurrent,retainLauncherLogs}
