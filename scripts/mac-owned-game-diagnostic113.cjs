// QA diagnostics only. Acceptance remains the original favorite MOD hashes and
// 240-second real generated world assertion. Never signal the game, enumerate
// command lines, request elevated access or attach a native debugger.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFile}=require('node:child_process')
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
const inside=(root,file)=>{const r=path.relative(root,file);return r!==''&&!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r)}
const real=file=>fs.realpathSync.native(file)

// Self-contained for the disposable application's existing main inspector.
// Capture safe launch properties at the actual original spawn; args/env and
// account values are never retained. ESM exports need explicit synchronization.
function installOwnedGameSpawnObserver(expectedCwd){
 const cp=process.mainModule.require('node:child_process'),fs=process.mainModule.require('node:fs'),p=process.mainModule.require('node:path'),mod=process.mainModule.require('node:module')
 if(globalThis.favorite113SpawnObserver)throw Error('Existing spawn observer must be restored')
 const cwd=fs.realpathSync.native(expectedCwd),original=cp.spawn,events=[]
 const wrapper=function(...input){
  const options=input[2],args=input[1],exe=input[0];let matching=false
  let javaPath=null
  try{matching=typeof exe==='string'&&p.basename(exe)==='java'&&Array.isArray(args)&&typeof options?.cwd==='string'&&fs.realpathSync.native(options.cwd)===cwd;if(matching)javaPath=fs.realpathSync.native(exe)}catch{matching=false}
  const startedAt=Date.now(),child=original.apply(this,input)
  if(matching){
   const nativeProperties={};for(const name of ['java.library.path','org.lwjgl.librarypath','org.lwjgl.opengl.libname','org.lwjgl.glfw.libname','org.lwjgl.system.SharedLibraryExtractPath']){const value=args.filter(a=>typeof a==='string'&&a.startsWith('-D'+name+'='));if(value.length)nativeProperties[name]=value.map(a=>a.slice(name.length+3))}
   const graphicsEnvironment={},environment=options.env??process.env
   for(const name of ['MVK_CONFIG_USE_METAL_ARGUMENT_BUFFERS','MVK_CONFIG_USE_MTLHEAP','MESA_GL_VERSION_OVERRIDE','MESA_GLSL_VERSION_OVERRIDE','LIBGL_ALWAYS_SOFTWARE']){const value=environment[name];graphicsEnvironment[name]=value===undefined?{present:false}:{present:true,value:/^[0-9A-Za-z_.-]{1,64}$/.test(value)?value:null,valueWithheld:!/^[0-9A-Za-z_.-]{1,64}$/.test(value)}}
   const row={kind:'original-owned-java-spawn',pid:child.pid??null,javaPath,effectiveGameDir:cwd,startedAt,returnedAt:Date.now(),startOnFirstThread:args.includes('-XstartOnFirstThread'),nativeProperties,graphicsEnvironment};events.push(row)
   child.once('spawn',()=>{row.spawnedAt=Date.now()});child.once('error',error=>{row.spawnError={name:error.name,code:error.code??null}});child.once('exit',(code,signal)=>{row.exit={at:Date.now(),code,signal}})
  }
  return child
 }
 cp.spawn=wrapper;mod.syncBuiltinESMExports()
 const observer={cwd,events,original,wrapper,readyAt:Date.now()};globalThis.favorite113SpawnObserver=observer
 return{ready:true,cwd,readyAt:observer.readyAt,esmExportsSynchronized:true}
}
function restoreOwnedGameSpawnObserver(){
 const cp=process.mainModule.require('node:child_process'),mod=process.mainModule.require('node:module'),o=globalThis.favorite113SpawnObserver
 if(!o)return{complete:true,installed:false}
 if(cp.spawn!==o.wrapper)throw Error('Spawn observer identity changed; refuse to overwrite foreign wrapper')
 cp.spawn=o.original;mod.syncBuiltinESMExports();delete globalThis.favorite113SpawnObserver
 return{complete:true,installed:true,exactOriginalRestored:true,esmExportsSynchronized:true}
}
function ownedGameBinding({context,record,spawns,states,timeline,launchTrace,native}){
 const {instanceId,games,effectiveGameDir,launchStartedAt,launcherPID}=context
 assert(Number.isSafeInteger(launcherPID)&&launcherPID>0,'owned launcher PID required')
 assert(Number.isFinite(launchStartedAt),'original launch request time required')
 const calls=launchTrace.filter(x=>x.channel==='game:launch'&&x.startedAt>=launchStartedAt&&x.arguments?.[0]===instanceId&&x.arguments?.[1]===null&&x.arguments?.[2]===games&&x.arguments?.[3]===true)
 assert.equal(calls.length,1,'exactly one original accepted generated-world launch required');const call=calls[0]
 assert(call.completedAt>=call.startedAt&&!call.error,'original game:launch must complete without error')
 const relevant=states.filter(x=>x.versionId===instanceId&&x.folder===games),ids=[...new Set(relevant.filter(x=>x.status==='launching').map(x=>x.launchId))]
 assert.equal(ids.length,1,'exactly one generated instance launchId required');const launchId=ids[0];assert.equal(typeof launchId,'string');assert(launchId)
 const launching=timeline.filter(x=>x.channel==='event:launchState'&&x.value?.status==='launching'&&x.value.versionId===instanceId&&x.value.folder===games&&x.value.launchId===launchId),running=timeline.filter(x=>x.channel==='event:launchState'&&x.value?.status==='running'&&x.value.versionId===instanceId&&x.value.folder===games&&x.value.launchId===launchId)
 assert.equal(launching.length,1,'one original launching event required');assert.equal(running.length,1,'one original running event required')
 assert(launching[0].receivedAt>=call.startedAt&&running[0].receivedAt>=launching[0].receivedAt,'original launch event times must bind the accepted call')
 assert(!relevant.some(x=>['exited','error'].includes(x.status)),'refuse an exited/failed generated game')
 assert.equal(record.versionId,instanceId);assert.equal(record.effectiveGameDir,effectiveGameDir);assert(Number.isSafeInteger(record.pid)&&record.pid>0)
 const selected=spawns.filter(x=>x.kind==='original-owned-java-spawn'&&x.effectiveGameDir===effectiveGameDir&&x.startedAt>=call.startedAt)
 assert.equal(selected.length,1,'one actually observed original Java spawn required');const spawn=selected[0]
 assert.equal(spawn.pid,record.pid,'original running record and observed launch PID must agree')
 assert(!spawn.spawnError&&!spawn.exit,'spawn must be alive without error');assert(spawn.spawnedAt>=spawn.startedAt&&spawn.returnedAt>=spawn.startedAt)
 assert(running[0].receivedAt>=spawn.spawnedAt,'running event must follow observed original spawn')
 const persistedAt=Date.parse(record.startedAt);assert(Number.isFinite(persistedAt)&&persistedAt>=spawn.startedAt&&persistedAt<=running[0].receivedAt,'raw running record timestamp must match original launch bracket')
 if(native){
  assert.equal(native.pid,spawn.pid);assert.equal(native.ppid,launcherPID);assert.equal(native.executable,spawn.javaPath);assert.match(native.creationUnixUS,/^[1-9]\d*$/)
  const creationMs=Number(BigInt(native.creationUnixUS))/1000
  assert(creationMs>=spawn.startedAt-1&&creationMs<=spawn.spawnedAt+1,'exact native creation must fall in actual spawn bracket')
 }
 return{pid:record.pid,launchId,instanceId,games,effectiveGameDir,javaPath:spawn.javaPath,creationUnixUS:native?.creationUnixUS??null,launcherPID,spawn,acceptedCallIndex:call.index,recordStartedAt:record.startedAt}
}
function sameNativeIdentity(actual,bound){assert.equal(actual.pid,bound.pid);assert.equal(actual.ppid,bound.launcherPID);assert.equal(actual.creationUnixUS,bound.creationUnixUS,'refuse reused PID');assert.equal(actual.executable,bound.javaPath);return true}
function machoArchitectures(bytes){
 assert(Buffer.isBuffer(bytes)&&bytes.length>=8,'Mach-O header required')
 const magic=bytes.readUInt32BE(0),cpu=n=>n===0x0100000c?'arm64':n===0x01000007?'x86_64':n===12?'arm':n===7?'x86':'cpu-'+n
 if(magic===0xfeedfacf||magic===0xfeedface)return[cpu(bytes.readUInt32BE(4))]
 if(magic===0xcffaedfe||magic===0xcefaedfe)return[cpu(bytes.readUInt32LE(4))]
 const fat64=magic===0xcafebabf||magic===0xbfbafeca,little=magic===0xbebafeca||magic===0xbfbafeca
 assert(fat64||magic===0xcafebabe||magic===0xbebafeca,'not a Mach-O binary')
 const read=at=>little?bytes.readUInt32LE(at):bytes.readUInt32BE(at),count=read(4),stride=fat64?32:20;assert(count>0&&count<=64&&bytes.length>=8+count*stride,'invalid fat Mach-O header')
 return Array.from({length:count},(_,i)=>cpu(read(8+i*stride)))
}
function binaryReadback(file){const bytes=fs.readFileSync(file);return{file,bytes:bytes.length,sha256:sha(bytes),architectures:machoArchitectures(bytes)}}
function generatedNativeReadback(binding,context){
 const roots=[...new Set(Object.entries(binding.spawn.nativeProperties).filter(([name])=>['java.library.path','org.lwjgl.librarypath','org.lwjgl.system.SharedLibraryExtractPath'].includes(name)).flatMap(([,values])=>values.flatMap(value=>value.split(path.delimiter))))]
 const files=[],errors=[]
 for(const root of roots){try{const physical=real(root);assert(inside(context.generatedRoot,physical),'native root must stay inside generated QA root');const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){assert(files.length<1000,'native readback file limit');const file=path.join(dir,entry.name);if(entry.isSymbolicLink()){errors.push({file,error:'symlink not followed'});continue}if(entry.isDirectory())walk(file);else if(entry.isFile()&&/\.(dylib|jnilib)$/.test(file))files.push(binaryReadback(file))}};walk(physical)}catch(error){errors.push({root,error:error.message})}}
 return{java:binaryReadback(binding.javaPath),roots,files,errors,scope:'Exact Java executable and extracted generated native file SHA256/Mach-O headers; this is file readback, not proof those files loaded or GL initialized'}
}
function rawRunner({directory,execute=execFile}){
 let serial=0
 return async function run(label,exe,args,{timeoutMs=10000,maxBuffer=16*1024*1024}={}){
  assert(/^[a-z0-9-]+$/.test(label));assert(path.isAbsolute(exe));assert(Array.isArray(args)&&args.every(x=>typeof x==='string'));const prefix=String(++serial).padStart(3,'0')+'-'+label,receipt={label,exe,args,timeoutMs,startedAt:new Date().toISOString(),classification:'Original tool result on exact bound QA PID; read-only diagnostic, no acceptance or absence claim'}
  // timeout applies only to the actually spawned diagnostic tool child. A hard
  // close avoids a wedged sample/jcmd keeping failure cleanup pending forever;
  // the observed Java game is never signalled by this helper.
  const result=await new Promise(resolve=>{const child=execute(exe,args,{encoding:null,timeout:timeoutMs,killSignal:'SIGKILL',maxBuffer,windowsHide:true},(error,stdout,stderr)=>resolve({error,stdout:Buffer.from(stdout??''),stderr:Buffer.from(stderr??'')}));receipt.toolPID=Number.isSafeInteger(child?.pid)&&child.pid>0?child.pid:null})
  receipt.finishedAt=new Date().toISOString();receipt.exit={code:result.error?(result.error.code??null):0,signal:result.error?.signal??null,killed:!!result.error?.killed};receipt.complete=!result.error
  if(result.error)receipt.error={name:result.error.name,code:result.error.code??null,message:result.error.message}
  for(const kind of ['stdout','stderr']){const file=prefix+'.'+kind+'.log',bytes=result[kind];fs.writeFileSync(path.join(directory,file),bytes,{flag:'wx'});receipt[kind]={file,bytes:bytes.length,sha256:sha(bytes)}}
  fs.writeFileSync(path.join(directory,prefix+'.receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'})
  return{receipt,stdout:result.stdout,stderr:result.stderr}
 }
}
async function createMacOwnedGameDiagnostics({root,profile,games,instanceId,output,phase,launcherPID,inspect,onChange=()=>{},execute}){
 assert.equal(process.platform,'darwin','native Mac QA diagnostic only');assert.equal(process.arch,'arm64','native ARM64 diagnostic only')
 assert(/^[a-z0-9-]+$/.test(phase));assert.equal(path.basename(instanceId),instanceId)
 const generatedRoot=real(root);assert(path.basename(generatedRoot).startsWith('KAMUCL favorites113 中文 '),'only verifier-generated disposable QA root allowed')
 assert.equal(real(profile),path.join(generatedRoot,'profile'));assert.equal(real(games),path.join(generatedRoot,'games §'))
 const effectiveGameDir=real(path.join(games,'versions',instanceId));assert(inside(generatedRoot,effectiveGameDir))
 const directory=path.join(output,phase+'-owned-game-diagnostic');assert(!fs.existsSync(directory),'preserve prior diagnostic attempt');fs.mkdirSync(directory)
 const report={schemaVersion:1,platform:process.platform,arch:process.arch,generatedRoot,profile,games,instanceId,launcherPID,readOnly:true,acceptanceUnchanged:true,captures:[],toolReceipts:[],complete:false,limitations:'sample and jcmd have observer overhead. No global processes, command lines, signal/force cleanup, graphics option changes, MOD changes or runtime downgrade. AX is exact-owned-PID read-only, without permission requests. Desktop screenshots are of the disposable CI desktop and are not wholly attributed to the game; missing evidence remains unknown.'},run=rawRunner({directory,execute})
 const save=()=>{fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify(report,null,2)+'\n');onChange(report)};save()
 const source=path.join(__dirname,'mac-owned-game-diagnostic113.swift'),header=path.join(directory,'OwnedGame113-Bridging.h'),helper=path.join(directory,'owned-game-observer113')
 fs.writeFileSync(header,'#include <libproc.h>\n',{flag:'wx'});report.compiler={swiftSourceSHA256:sha(fs.readFileSync(source)),headerSHA256:sha(fs.readFileSync(header))}
 const compile=await run('compile','/usr/bin/xcrun',['swiftc','-O','-target','arm64-apple-macosx13.0','-import-objc-header',header,source,'-o',helper],{timeoutMs:60000});report.toolReceipts.push(compile.receipt);report.compiler.complete=compile.receipt.complete
 if(compile.receipt.complete)report.compiler.executable=binaryReadback(helper);save()
 let pending=null,launchStartedAt=null,triggered=false
 const context=()=>({generatedRoot,profile,games,instanceId,effectiveGameDir,launcherPID,launchStartedAt})
 async function inputSnapshot(label,remainingMs=4000){
  const recordFile=path.join(profile,'running-game.json');assert(fs.lstatSync(recordFile).isFile()&&!fs.lstatSync(recordFile).isSymbolicLink());assert.equal(real(recordFile),recordFile)
  const bytes=fs.readFileSync(recordFile),file=label+'-running-game.original.json';fs.writeFileSync(path.join(directory,file),bytes,{flag:'wx'})
  let timer
  const observations=await Promise.race([inspect(`({spawns:globalThis.favorite113SpawnObserver?.events||[],launchTrace:favorite113Trace.calls.filter(row=>row.channel==='game:launch'),readyAt:globalThis.favorite113SpawnObserver?.readyAt})`),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('original launch observation timed out')),Math.max(1,Math.min(1000,remainingMs)))})]).finally(()=>clearTimeout(timer))
  return{record:JSON.parse(bytes),originalRecord:{file,bytes:bytes.length,sha256:sha(bytes)},...observations}
 }
 async function identity(label,pid,remainingMs=1000){const result=await run(label,helper,['--identity',String(pid)],{timeoutMs:Math.max(1,Math.min(1000,remainingMs))});report.toolReceipts.push(result.receipt);assert(result.receipt.complete,'native identity unavailable; inspect original receipt');return JSON.parse(result.stdout.toString('utf8'))}
 async function capture(label,snapshot){
  assert(/^[a-z0-9-]+$/.test(label));const capturedAt=Date.now(),deadline=capturedAt+9000,left=()=>{const value=deadline-Date.now();assert(value>0,'9-second diagnostic collection deadline reached');return value},row={label,startedAt:new Date(capturedAt).toISOString(),maximumMs:9000,complete:false,tools:[]};report.captures.push(row);save()
  try{
   assert(report.compiler.complete,'native compiler unavailable; no PID tools permitted')
   const input=await inputSnapshot(label,left());fs.writeFileSync(path.join(directory,label+'-observed-launch.original.json'),JSON.stringify({spawns:input.spawns,launchTrace:input.launchTrace,states:snapshot.states,timeline:snapshot.timeline},null,2)+'\n',{flag:'wx'})
   const pre=ownedGameBinding({context:context(),...input,...snapshot});const native=await identity(label+'-bind-identity',pre.pid,left()),bound=ownedGameBinding({context:context(),...input,...snapshot,native});row.binding=bound;row.originalRecord=input.originalRecord
   const readbackFile=path.join(directory,label+'-native-readback.input.json');fs.writeFileSync(readbackFile,JSON.stringify({binding:bound,context:context()},null,2)+'\n',{flag:'wx'});save()
   async function tool(name,exe,args,timeoutMs){
    const item={name,complete:false};row.tools.push(item)
    try{
     const fresh=await inputSnapshot(label+'-'+name,left()),before=await identity(label+'-'+name+'-before',bound.pid,left());ownedGameBinding({context:context(),...fresh,...snapshot,native:before});sameNativeIdentity(before,bound)
     const result=await run(label+'-'+name,exe,args,{timeoutMs:Math.min(timeoutMs,left())});report.toolReceipts.push(result.receipt);item.receipt=result.receipt
     const after=await identity(label+'-'+name+'-after',bound.pid,left());sameNativeIdentity(after,bound);item.identityAfter=after;item.complete=result.receipt.complete
     if(name==='windows'&&result.receipt.complete){item.observation=JSON.parse(result.stdout.toString('utf8'));assert.equal(item.observation.identityStable,true);assert.equal(item.observation.complete,true,'native window list unavailable; observation incomplete');assert(item.observation.windows.every(w=>w.ownerPID===bound.pid))}
     if(name==='native-files'&&result.receipt.complete){row.nativeReadback=JSON.parse(result.stdout.toString('utf8'));assert.equal(row.nativeReadback.errors.length,0,'generated native file readback incomplete; inspect original result')}
     if(name==='alerts'&&result.receipt.complete){item.observation=JSON.parse(result.stdout.toString('utf8'));assert.equal(item.observation.identityStable,true);assert.equal(item.observation.complete,true)}
    }catch(error){item.complete=false;item.error={name:error.name,message:error.message}}
    finally{save()}
   }
   const jcmd=path.join(path.dirname(bound.javaPath),'jcmd')
   // Full binary readback runs in an owned QA tool child so filesystem stalls
   // cannot block the original verifier's asynchronous 240s world observation.
   const desktopFile=path.join(directory,label+'-desktop.original.png');assert(!fs.existsSync(desktopFile),'preserve earlier desktop evidence')
   const tasks=[tool('windows',helper,['--observe',String(bound.pid),bound.creationUnixUS,bound.javaPath],2000),tool('alerts',helper,['--alerts',String(bound.pid),bound.creationUnixUS,bound.javaPath],2000),tool('desktop','/usr/sbin/screencapture',['-x',desktopFile],2000),tool('loaded-images','/usr/sbin/lsof',['-n','-P','-a','-p',String(bound.pid),'-d','txt,mem','-F','pn'],2000),tool('native-files',process.execPath,[__filename,'--native-readback',readbackFile],5000),tool('sample','/usr/bin/sample',[String(bound.pid),'3','-file',path.join(directory,label+'-sample.original.txt')],5000)]
   if(fs.existsSync(jcmd))tasks.push(tool('threads',jcmd,[String(bound.pid),'Thread.print'],5000));else row.tools.push({name:'threads',complete:false,error:{message:'same selected Java runtime has no jcmd; no alternate runtime substituted'}})
   await Promise.allSettled(tasks)
   const sampleFile=path.join(directory,label+'-sample.original.txt');if(fs.existsSync(sampleFile)){const b=fs.readFileSync(sampleFile);row.sampleOriginal={file:path.basename(sampleFile),bytes:b.length,sha256:sha(b)}}
   if(fs.existsSync(desktopFile)){const bytes=fs.readFileSync(desktopFile);row.desktopOriginal={file:path.basename(desktopFile),bytes:bytes.length,sha256:sha(bytes),classification:'Original disposable CI desktop readback, without focus changes. Includes system/other windows; not an owned-game-only image and not a game-rendering pass.'}}
   row.complete=row.tools.every(t=>t.complete);report.complete=row.complete
  }catch(error){row.error={name:error.name,message:error.message}}
  finally{row.finishedAt=new Date().toISOString();row.elapsedMs=Date.now()-capturedAt;row.exceededMaximum=row.elapsedMs>row.maximumMs;save()}
  return row
 }
 const inventory=()=>{report.files=fs.readdirSync(directory,{withFileTypes:true}).filter(e=>e.isFile()&&e.name!=='summary.json').map(e=>{const b=fs.readFileSync(path.join(directory,e.name));return{file:e.name,bytes:b.length,sha256:sha(b)}});save()}
 return{report,directory,async install(){report.observer=await inspect(`(${installOwnedGameSpawnObserver.toString()})(${JSON.stringify(effectiveGameDir)})`);save();return report.observer},setLaunchStartedAt(value){assert.equal(launchStartedAt,null);assert(Number.isFinite(value));launchStartedAt=value},poll(snapshot){if(!triggered&&launchStartedAt!==null&&Date.now()-launchStartedAt>=90000){triggered=true;pending=capture('stall-90s',snapshot);return pending}return null},async beforeFailure(snapshot){if(pending)await pending;pending=capture('before-failure',snapshot);await pending;inventory();return report},async finish(){if(pending)await pending;inventory();return report},async restore(){report.restoration=await inspect(`(${restoreOwnedGameSpawnObserver.toString()})()`);inventory();return report.restoration}}
}
module.exports={installOwnedGameSpawnObserver,restoreOwnedGameSpawnObserver,ownedGameBinding,sameNativeIdentity,machoArchitectures,binaryReadback,generatedNativeReadback,rawRunner,createMacOwnedGameDiagnostics}
if(require.main===module){
 try{assert.equal(process.argv[2],'--native-readback');assert.equal(process.argv.length,4);const input=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));process.stdout.write(JSON.stringify(generatedNativeReadback(input.binding,input.context))+'\n')}
 catch(error){process.stderr.write(JSON.stringify({name:error.name,message:error.message})+'\n');process.exitCode=1}
}
