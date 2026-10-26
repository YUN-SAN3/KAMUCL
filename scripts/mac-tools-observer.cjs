// Read-only, job-owned diagnostics. All original process/IPC calls are forwarded.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const errorValue=error=>error?{name:error.name,message:error.message,code:error.code??null,signal:error.signal??null,stack:error.stack}:null
function createMacToolsObserver(proof,identity,now=()=>Date.now(),writer=(file,text)=>fs.writeFileSync(file,text)){
 const file=path.join(proof,'tools-stages.json');assert(!fs.existsSync(file),'refuse old diagnostic evidence')
 const trace={schemaVersion:1,classification:'Actual bounded native coordinator diagnostics; not GUI, public room or multiplayer acceptance',identity,startedAt:new Date(now()).toISOString(),complete:false,stages:[],status:[],events:[],processes:[],clients:[],applicationLogs:[],primaryError:null,diagnosticErrors:[]}
 // Runtime observation failure must not prevent an original spawn from being
 // returned or an original callback from running. The coordinator fails closed
 // afterwards, and retains these errors separately from its primary assertion.
 const save=()=>{try{writer(file,JSON.stringify(trace,null,2));return true}catch(error){trace.diagnosticErrors.push({at:now(),operation:'write',error:errorValue(error)});return false}}
 const clone=value=>{try{return structuredClone(value)}catch(error){trace.diagnosticErrors.push({at:now(),operation:'clone',error:errorValue(error)});return{observationError:errorValue(error)}}}
 const stage=(name,value={})=>{trace.stages.push({at:now(),name,value:clone(value)});save()}
 const status=value=>{trace.status.push({at:now(),value:clone(value)});save()}
 const event=value=>{trace.events.push({at:now(),value:clone(value)});save()}
 const failure=error=>{trace.primaryError??=errorValue(error);save()}
 let closed=false
 const assertOpen=()=>{if(closed)throw Error('Owned tools observation closed; no new operation or process may start')}
 const close=()=>{if(closed)return;closed=true;stage('owned teardown fence closed')}
 function childProcesses(original,origin='product'){return{...original,
  spawn(...args){assertOpen();const child=original.spawn.apply(original,args),row={at:now(),origin,pid:child.pid,executable:args[0],argv:args[1],ownedEnv:{HOME:args[2]?.env?.HOME,TMPDIR:args[2]?.env?.TMPDIR},detached:args[2]?.detached,stdout:[],stderr:[],events:[]};trace.processes.push(row);save()
   for(const stream of ['stdout','stderr'])child[stream]?.on('data',data=>{row[stream].push({at:now(),text:data.toString()});save()})
   child.on('error',error=>{row.events.push({at:now(),type:'error',error:errorValue(error)});save()})
   for(const type of ['exit','close'])child.on(type,(code,signal)=>{row.events.push({at:now(),type,code,signal});save()})
   return child
  },
  execFile(...args){assertOpen();const callback=args.at(-1);assert.equal(typeof callback,'function');const row={at:now(),origin,executable:args[0],argv:args[1],timeout:args[2]?.timeout};trace.clients.push(row);save()
   return original.execFile(...args.slice(0,-1),function(error,stdout,stderr){Object.assign(row,{finishedAt:now(),error:errorValue(error),stdout,stderr});save();return callback.apply(this,arguments)})
  }
 }}
 function observeSender(contents){const original=contents.send;const wrapper=function(channel,...args){if(channel==='tc:event')event(args[0]);return original.call(this,channel,...args)};contents.send=wrapper;return()=>{assert.equal(contents.send,wrapper,'owned sender observation changed');contents.send=original}}
 function collectApplicationLogs(root,extraOutput=''){
  const canonical=fs.realpathSync.native(root),text=[extraOutput,...trace.processes.flatMap(row=>[row.stdout.map(chunk=>chunk.text).join(''),row.stderr.map(chunk=>chunk.text).join('')])].join('\n')
  const declared=[...new Set([...text.matchAll(/Logs will be saved to ([^\r\n]*application\.log)/g)].map(match=>match[1]))]
  for(const source of declared){
   const row={reportedPath:source,at:now()};trace.applicationLogs.push(row)
   try{let resolved=path.resolve(source);assert(resolved.startsWith(canonical+path.sep),'reported log outside owned tool root');assert.equal(path.basename(resolved),'application.log')
    if(!fs.existsSync(resolved)){
     const relative=path.relative(path.join(canonical,'terracotta'),resolved),parts=relative.split(path.sep)
     assert(/^mac-session-[A-Za-z0-9]+$/.test(parts[0])&&parts.length>1&&!parts.includes('..'),'missing log must belong to an owned Mac session')
     resolved=path.join(canonical,'terracotta','session-history',...parts);row.archivedPath=resolved
    }
    let ancestor=canonical;for(const part of path.relative(canonical,resolved).split(path.sep)){ancestor=path.join(ancestor,part);assert(!fs.lstatSync(ancestor).isSymbolicLink(),'reported log path cannot contain a link')}
    const stat=fs.lstatSync(resolved);assert(stat.isFile()&&stat.size<=8*1024*1024,'reported application log must be a bounded regular file');assert.equal(fs.realpathSync.native(resolved),resolved)
    const name=`application-${trace.applicationLogs.length}.log`,target=path.join(proof,name);fs.copyFileSync(resolved,target,fs.constants.COPYFILE_EXCL)
    const copied=fs.lstatSync(target);assert(copied.isFile()&&!copied.isSymbolicLink()&&copied.size<=8*1024*1024,'copied application log must be a bounded regular snapshot')
    Object.assign(row,{file:name,observedSourceBytes:stat.size,bytes:copied.size,sha256:crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')})
   }catch(error){row.diagnosticError=errorValue(error);trace.diagnosticErrors.push({at:now(),operation:'collect-application-log',reportedPath:source,error:row.diagnosticError})}save()
  }
 }
 if(!save())throw Error('Initial owned diagnostics could not be saved; no product operation started')
 return{trace,save,stage,status,event,failure,childProcesses,observeSender,collectApplicationLogs,assertOpen,close}
}
module.exports={createMacToolsObserver,errorValue}
