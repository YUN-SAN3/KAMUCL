// Production download and installation paths on a disposable native Mac runner.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),http=require('http')
const {app,BrowserWindow}=require('electron'),{build}=require('esbuild'),{execFileSync}=require('child_process')
assert.equal(process.platform,'darwin');assert.equal(process.env.GITHUB_ACTIONS,'true')
const root=fs.mkdtempSync(path.resolve('out/mac-tools-')),proof=path.resolve(`release/mac-tools-proof-${process.arch}`)
fs.mkdirSync(proof,{recursive:true});app.setPath('userData',root)
const observer=require('./mac-tools-observer.cjs').createMacToolsObserver(proof,{platform:process.platform,arch:process.arch,runtimeVersion:process.versions.electron,version:require('../package.json').version,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),ownedRoot:root})
const wait=ms=>new Promise(r=>setTimeout(r,ms));let tc,cleanupTools=async()=>{},diagnosticWindow,restoreSender=()=>{},finishing=false
// Preserve diagnostics before the workflow's 20-minute job termination even if
// a public download or native callback never settles. The original product API
// 60 x 250ms assertion and the product's 120s startup deadline remain unchanged.
const overallDeadline=setTimeout(()=>{void finish(1,Error('Native tools coordinator exceeded its 15-minute overall deadline'))},15*60*1000)
async function load(file){observer.assertOpen();const b=await build({entryPoints:[file],bundle:true,platform:'node',format:'cjs',packages:'external',write:false});observer.assertOpen();const m={exports:{}};const observedRequire=name=>file==='src/main/core/terracotta.ts'&&(name==='node:child_process'||name==='child_process')?observer.childProcesses(require(name)):require(name);new Function('require','module','exports','__dirname',b.outputFiles[0].text)(observedRequire,m,m.exports,path.resolve('out/main'));return m.exports}
async function get(port,p){return new Promise((resolve,reject)=>{const r=http.get(`http://127.0.0.1:${port}${p}`,res=>{let s='';res.on('data',b=>s+=b);res.on('end',()=>resolve(s))});r.on('error',reject);r.setTimeout(5000,()=>r.destroy(Error('timeout')))})}
app.whenReady().then(async()=>{
  observer.assertOpen()
  // A job-owned hidden native sender exposes the product's original tc:event
  // messages. It is never presented as actual launcher GUI evidence.
  diagnosticWindow=new BrowserWindow({show:false,webPreferences:{sandbox:true}});restoreSender=observer.observeSender(diagnosticWindow.webContents)
  observer.stage('public tool downloads begin')
  const frp=await load('src/main/core/frp.ts');observer.assertOpen();const frpc=await frp.ensureFrpcInstalled(console.log);observer.assertOpen()
  const frpVersion=execFileSync(frpc,['-v'],{encoding:'utf8',timeout:10000});assert.match(frpVersion,/0\.51\.0/)
  const terracotta=await load('src/main/core/terracotta.ts'),handlers={}
  observer.assertOpen()
  cleanupTools=terracotta.stopTerracottaOnQuit
  terracotta.registerTerracottaIpc({handle:(name,fn)=>handlers[name]=fn})
  await handlers['tc:install']();observer.assertOpen();const status=await handlers['tc:status']();observer.assertOpen();assert(status.binaryReady)
  observer.stage('public tool downloads verified',{frpVersion,status})
  const portFile=path.join(root,'port.json'),log=fs.openSync(path.join(proof,'terracotta-output.txt'),'w')
  const rawHome=path.join(root,'raw-native-home');fs.mkdirSync(rawHome,{mode:0o700})
  const env={...process.env,HOME:rawHome}
  observer.assertOpen();try{tc=observer.childProcesses(require('child_process'),'raw-native-daemon').spawn(status.binaryPath,['--daemon'],{env,stdio:['ignore',log,log]})}finally{fs.closeSync(log)}
  observer.stage('raw owned daemon spawned',{pid:tc.pid,executable:status.binaryPath})
  let port;for(let n=0;n<120;n++){observer.assertOpen();assert.equal(tc.exitCode,null,'Terracotta exited early');await wait(500);observer.assertOpen();try{const bytes=fs.readFileSync(path.join(rawHome,'terracotta','terracotta.lock'));if(bytes.length===2){port=bytes.readUInt16BE(0);if(port)break}}catch{}}
  assert(port,'Terracotta did not initialize its HTTP API');const state=await get(port,'/state');observer.assertOpen();assert.doesNotThrow(()=>JSON.parse(state))
  observer.stage('raw owned daemon HTTP state',{port,state:JSON.parse(state)})
  // The daemon closes its listener before this shutdown request always receives
  // a response. Require the owned process to exit, not an HTTP response from it.
  await get(port,'/panic?peaceful=true').catch(e=>{if(e.code!=='ECONNRESET')throw e})
  observer.assertOpen();for(let n=0;n<40&&tc.exitCode===null;n++){await wait(100);observer.assertOpen()}
  assert.notEqual(tc.exitCode,null,'Terracotta did not stop after peaceful shutdown')
  observer.stage('raw owned daemon peaceful exit',{pid:tc.pid,code:tc.exitCode})
  // Exercise the product IPC path too, including cancellation and its private group.
  observer.stage('product tc:start begin',{payload:{mode:'host',playerName:'NativeMacTest'},pollLimit:60,pollWaitMs:250,productStartupDeadlineMs:120000})
  observer.assertOpen()
  const starting=handlers['tc:start'](null,{mode:'host',playerName:'NativeMacTest'}).then(value=>{observer.stage('product tc:start resolved',{value});return value},error=>{observer.stage('product tc:start rejected',{error:require('./mac-tools-observer.cjs').errorValue(error)});throw error})
  void starting.catch(()=>{})
  let started
  for(let n=0;n<60;n++){observer.assertOpen();started=await handlers['tc:status']();observer.assertOpen();observer.status(started);if(['hosting','ready'].includes(started.phase))break;await wait(250);observer.assertOpen()}
  observer.stage('product tc:start API assertion',{lastObserved:started})
  assert(['hosting','ready'].includes(started.phase),'product Terracotta daemon did not reach its API')
  const own=observer.trace.processes.filter(row=>row.origin==='product'&&row.executable===status.binaryPath&&JSON.stringify(row.argv)==='["--daemon"]');assert.equal(own.length,1,'one original product-owned daemon spawn required')
  const pid=own[0].pid;assert(Number.isInteger(pid)&&pid>0)
  const productHome=own[0].ownedEnv.HOME;assert.equal(path.dirname(productHome),path.join(root,'terracotta'));assert.match(path.basename(productHome),/^mac-session-/);assert.notEqual(productHome,env.HOME)
  assert.equal(observer.trace.clients.filter(row=>row.origin==='product').length,0,'product must never race --hmcl or invoke a system service')
  const persistentIdentity=fs.readFileSync(path.join(root,'terracotta','terracotta','machine-id'));assert.equal(persistentIdentity.length,16);assert.deepEqual(fs.readFileSync(path.join(productHome,'terracotta','machine-id')),persistentIdentity)
  const row=execFileSync('/bin/ps',['-p',String(pid),'-o','pid=,pgid='],{encoding:'utf8'}).trim()
  const [observedPid,group]=row.split(/\s+/).map(Number);assert.equal(observedPid,pid);assert.equal(pid,group,'daemon group must be isolated')
  await handlers['tc:stop']();observer.assertOpen();await starting;observer.assertOpen()
  let groupStopped=false
  for(let n=0;n<40;n++){observer.assertOpen();try{process.kill(-group,0)}catch{groupStopped=true;break}await wait(100);observer.assertOpen()}
  assert(groupStopped,'owned Terracotta process group did not stop')
  assert(!fs.existsSync(productHome),'closed session must leave active directory');const archived=path.join(root,'terracotta','session-history',path.basename(productHome));assert(fs.statSync(archived).isDirectory());assert.deepEqual(fs.readFileSync(path.join(archived,'terracotta','machine-id')),persistentIdentity)
  observer.stage('product owned group cleanup verified',{pid,group,groupStopped})
  // Restart through the same unmodified IPC: identity is durable, the new HOME
  // must be distinct, and stopping it must retain the earlier diagnostic archive.
  const restarting=handlers['tc:start'](null,{mode:'host',playerName:'NativeMacTest'});void restarting.catch(()=>{})
  for(let n=0;n<60;n++){observer.assertOpen();started=await handlers['tc:status']();observer.status(started);if(['hosting','ready'].includes(started.phase))break;await wait(250)}
  assert(['hosting','ready'].includes(started.phase),'restarted original product must reach its API')
  const second=observer.trace.processes.filter(row=>row.origin==='product'&&row.executable===status.binaryPath&&JSON.stringify(row.argv)==='["--daemon"]');assert.equal(second.length,2);assert.notEqual(second[1].ownedEnv.HOME,productHome);assert.deepEqual(fs.readFileSync(path.join(second[1].ownedEnv.HOME,'terracotta','machine-id')),persistentIdentity)
  await handlers['tc:stop']();await restarting;assert(!fs.existsSync(second[1].ownedEnv.HOME));assert(fs.statSync(archived).isDirectory());assert.deepEqual(fs.readFileSync(path.join(root,'terracotta','terracotta','machine-id')),persistentIdentity)
  assert.equal(observer.trace.clients.filter(row=>row.origin==='product').length,0)
  observer.stage('product isolated restart and durable identity verified',{firstHome:productHome,secondHome:second[1].ownedEnv.HOME,archived,identityBytes:persistentIdentity.length})
  fs.writeFileSync(path.join(proof,'verification.json'),JSON.stringify({arch:process.arch,frpVersion,terracotta:status,apiState:JSON.parse(state),privateDaemonIpc:true,groupStopped},null,2))
  console.log('PASS native Mac FRP and Terracotta download, hashes, permissions and execution')
}).then(()=>finish(0)).catch(error=>finish(1,error))
async function finish(code,error){
 if(finishing)return;finishing=true;observer.close();clearTimeout(overallDeadline)
 if(error){observer.failure(error);console.error(error)}
 const cleanupDeadline=setTimeout(()=>{observer.stage('owned cleanup exceeded 5-second diagnostic bound');finishDiagnostics();app.exit(1)},5000)
 try{await cleanupTools();if(tc&&tc.exitCode===null)tc.kill();observer.stage(code===0?'native tools completed':'owned cleanup after original failure');observer.trace.complete=code===0}
 catch(cleanupError){observer.failure(cleanupError);observer.stage('owned cleanup error',{error:require('./mac-tools-observer.cjs').errorValue(cleanupError)});code=1}
 finally{clearTimeout(cleanupDeadline);finishDiagnostics();if(observer.trace.diagnosticErrors.length){code=1;observer.trace.complete=false;observer.save();console.error('Native tools diagnostic I/O failed; original callbacks and primary error retained')}app.exit(code)}
}
function finishDiagnostics(){try{const output=path.join(proof,'terracotta-output.txt');observer.collectApplicationLogs(root,fs.existsSync(output)?fs.readFileSync(output,'utf8'):'')}catch(error){observer.stage('diagnostic collection error',{error:require('./mac-tools-observer.cjs').errorValue(error)})}finally{try{restoreSender();if(diagnosticWindow&&!diagnosticWindow.isDestroyed())diagnosticWindow.destroy()}catch(error){observer.stage('owned sender cleanup error',{error:require('./mac-tools-observer.cjs').errorValue(error)})}observer.save()}}
