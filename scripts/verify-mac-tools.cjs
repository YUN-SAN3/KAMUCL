// Production download and installation paths on a disposable native Mac runner.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),http=require('http')
const {app}=require('electron'),{build}=require('esbuild'),{spawn,execFileSync}=require('child_process')
assert.equal(process.platform,'darwin');assert.equal(process.env.GITHUB_ACTIONS,'true')
const root=fs.mkdtempSync(path.resolve('out/mac-tools-')),proof=path.resolve(`release/mac-tools-proof-${process.arch}`)
fs.mkdirSync(proof,{recursive:true});app.setPath('userData',root)
const wait=ms=>new Promise(r=>setTimeout(r,ms));let tc,cleanupTools=async()=>{}
async function load(file){const b=await build({entryPoints:[file],bundle:true,platform:'node',format:'cjs',packages:'external',write:false});const m={exports:{}};new Function('require','module','exports','__dirname',b.outputFiles[0].text)(require,m,m.exports,path.resolve('out/main'));return m.exports}
async function get(port,p){return new Promise((resolve,reject)=>{const r=http.get(`http://127.0.0.1:${port}${p}`,res=>{let s='';res.on('data',b=>s+=b);res.on('end',()=>resolve(s))});r.on('error',reject);r.setTimeout(5000,()=>r.destroy(Error('timeout')))})}
app.whenReady().then(async()=>{
  const frp=await load('src/main/core/frp.ts'),frpc=await frp.ensureFrpcInstalled(console.log)
  const frpVersion=execFileSync(frpc,['-v'],{encoding:'utf8',timeout:10000});assert.match(frpVersion,/0\.51\.0/)
  const terracotta=await load('src/main/core/terracotta.ts'),handlers={}
  cleanupTools=terracotta.stopTerracottaOnQuit
  terracotta.registerTerracottaIpc({handle:(name,fn)=>handlers[name]=fn})
  await handlers['tc:install']();const status=await handlers['tc:status']();assert(status.binaryReady)
  const portFile=path.join(root,'port.json'),log=fs.openSync(path.join(proof,'terracotta-output.txt'),'w')
  const env={...process.env,HOME:path.join(root,'terracotta')}
  tc=spawn(status.binaryPath,['--daemon'],{env,stdio:['ignore',log,log]});fs.closeSync(log)
  let port;for(let n=0;n<120;n++){assert.equal(tc.exitCode,null,'Terracotta exited early');await wait(500);try{execFileSync(status.binaryPath,['--hmcl',portFile],{env,timeout:5000});port=JSON.parse(fs.readFileSync(portFile,'utf8')).port;if(port)break}catch{}}
  assert(port,'Terracotta did not initialize its HTTP API');const state=await get(port,'/state');assert.doesNotThrow(()=>JSON.parse(state))
  // The daemon closes its listener before this shutdown request always receives
  // a response. Require the owned process to exit, not an HTTP response from it.
  await get(port,'/panic?peaceful=true').catch(e=>{if(e.code!=='ECONNRESET')throw e})
  for(let n=0;n<40&&tc.exitCode===null;n++)await wait(100)
  assert.notEqual(tc.exitCode,null,'Terracotta did not stop after peaceful shutdown')
  // Exercise the product IPC path too, including cancellation and its private group.
  const starting=handlers['tc:start'](null,{mode:'host',playerName:'NativeMacTest'})
  let started
  for(let n=0;n<60;n++){started=await handlers['tc:status']();if(['hosting','ready'].includes(started.phase))break;await wait(250)}
  assert(['hosting','ready'].includes(started.phase),'product Terracotta daemon did not reach its API')
  const rows=execFileSync('/bin/ps',['-axo','pid=,pgid=,command='],{encoding:'utf8'}).split('\n')
  const row=rows.find(r=>r.includes(status.binaryPath+' --daemon'));assert(row,'owned daemon missing')
  const [pid,group]=row.trim().split(/\s+/).map(Number);assert.equal(pid,group,'daemon group must be isolated')
  await handlers['tc:stop']();await starting
  let groupStopped=false
  for(let n=0;n<40;n++){try{process.kill(-group,0)}catch{groupStopped=true;break}await wait(100)}
  assert(groupStopped,'owned Terracotta process group did not stop')
  fs.writeFileSync(path.join(proof,'verification.json'),JSON.stringify({arch:process.arch,frpVersion,terracotta:status,apiState:JSON.parse(state),privateDaemonIpc:true,groupStopped},null,2))
  console.log('PASS native Mac FRP and Terracotta download, hashes, permissions and execution')
}).then(async()=>{await cleanupTools();if(tc&&tc.exitCode===null)tc.kill();app.exit(0)}).catch(async e=>{console.error(e);await cleanupTools();if(tc&&tc.exitCode===null)tc.kill();app.exit(1)})
