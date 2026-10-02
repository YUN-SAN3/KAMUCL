// Update and rollback the real signed .app via real IPC in an isolated CI user session.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict')
const {spawn,execFileSync}=require('child_process'),crypto=require('crypto')
const wait=ms=>new Promise(r=>setTimeout(r,ms))
module.exports=async function(source,arch,proof){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"KAMUCL 更新 O'Neil ")),target=path.join(root,'KAMUCL.app')
  const version=require('../package.json').version,zip=path.join(root,`KAMUCL-${version}-mac-${arch}.zip`)
  execFileSync('/usr/bin/ditto',[source,target]);execFileSync('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',source,zip])
  let data,marker,claim
  const children=[],sockets=[];let relaunchedPid
  async function connect(){
    let page;for(let i=0;i<60;i++){try{page=(await(await fetch('http://127.0.0.1:9238/json')).json()).find(p=>p.url.includes('/renderer/index.html'));if(page)break}catch{}await wait(500)}assert(page,'update renderer unavailable')
    const ws=new WebSocket(page.webSocketDebuggerUrl);sockets.push(ws);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})})
    let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id)})
    const evaluate=expression=>new Promise((resolve,reject)=>{const n=++id,t=setTimeout(()=>reject(Error('update IPC timeout')),90000);pending.set(n,m=>{clearTimeout(t);const r=m.result;m.error||r?.exceptionDetails?reject(Error(JSON.stringify(m.error||r.exceptionDetails))):resolve(r.result.value)});ws.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}))})
    await wait(4500);return {evaluate,ws}
  }
  const start=()=>{const child=spawn(path.join(target,'Contents/MacOS/KAMUCL'),['--remote-debugging-port=9238','--inspect=9239'],{stdio:'inherit'});children.push(child);return child}
  const stop=async child=>{const ended=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await ended;await wait(1000)}
  function read(file){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return null}}
  async function waitReceipt(){
    for(let i=0;i<100;i++){const t=read(claim+'.completed'),state=read(path.join(data,'update-state.json'));if(t&&state?.result==='ok'&&state.to===version)return {t,state};if(!fs.existsSync(marker)&&read(claim+'.failed')?.id===expectedTransaction)break;await wait(1000)}
    throw Error('update receipt missing: '+(fs.existsSync(path.join(data,'mac-updater.log'))?fs.readFileSync(path.join(data,'mac-updater.log'),'utf8'):'no helper log'))
  }
  // open(1) relaunch has no debug switches. Find and stop only the executable at our private target.
  function ownPid(){const rows=execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n');const row=rows.find(x=>x.trim().split(/\s+/,1)[0]!==String(process.pid)&&x.includes(path.join(target,'Contents/MacOS/KAMUCL'))&&!x.includes('Helper'));return row?Number(row.trim().split(/\s+/)[0]):null}
  let expectedTransaction
  try {
    let child=start(),c=await connect()
    const main=(await(await fetch('http://127.0.0.1:9239/json')).json())[0],debug=new WebSocket(main.webSocketDebuggerUrl)
    await new Promise((r,j)=>{debug.addEventListener('open',r,{once:true});debug.addEventListener('error',j,{once:true})})
    data=await new Promise((r,j)=>{debug.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id===1)m.result?.exceptionDetails?j(Error(JSON.stringify(m.result.exceptionDetails))):r(m.result.result.value)});debug.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:`process.mainModule.require('electron').app.getPath('userData')`,returnByValue:true}}))})
    debug.close();marker=path.join(data,'mac-update.json');claim=marker+'.applying'
    await c.evaluate(`window.kamucl.invoke('settings:set',{autoUpdate:false})`)
    // A staged payload modified after approval must leave the original app usable.
    await c.evaluate(`window.kamucl.invoke('update:applyLocal',{filePath:${JSON.stringify(zip)}})`)
    fs.appendFileSync(read(marker).file,'corrupted-after-staging')
    c.ws.close();await stop(child);child=start();c=await connect()
    assert(fs.existsSync(claim+'.failed'),'tampered update was not rejected')
    execFileSync('codesign',['--verify','--deep','--strict',target])
    await c.evaluate(`window.kamucl.invoke('update:applyLocal',{filePath:${JSON.stringify(zip)}})`)
    assert.equal(read(marker)?.release.assetName,path.basename(zip));expectedTransaction=read(marker).id;c.ws.close();await stop(child)
    start();const installed=await waitReceipt();assert(fs.existsSync(installed.state.backupPath));execFileSync('codesign',['--verify','--deep','--strict',target])
    relaunchedPid=ownPid();assert(relaunchedPid);process.kill(relaunchedPid,'SIGTERM');relaunchedPid=null;await wait(2000)
    // Explicit rollback uses the retained signed backup and the same startup transaction.
    child=start();c=await connect();await c.evaluate(`window.kamucl.invoke('update:restoreBackup')`)
    assert.equal(read(marker)?.mode,'rollback');expectedTransaction=read(marker).id;c.ws.close();await stop(child)
    fs.renameSync(claim+'.completed',claim+'.upgrade-proof')
    start();const rollback=await waitReceipt();assert.equal(rollback.t.mode,'rollback');execFileSync('codesign',['--verify','--deep','--strict',target])
    relaunchedPid=ownPid();assert(relaunchedPid)
    fs.writeFileSync(path.join(proof,'update.json'),JSON.stringify({arch,version,upgrade:installed,rollback,pathWithSpacesAndApostrophe:true,signedBundles:true,tamperRejectedWithoutBreakingStartup:true},null,2))
    console.log('PASS real Mac packaged update and rollback receipt')
  } finally {
    sockets.forEach(ws=>ws.close());for(const child of children)if(child.exitCode===null)child.kill('SIGTERM')
    if(relaunchedPid)try{process.kill(relaunchedPid,'SIGTERM')}catch{}
    if(data&&fs.existsSync(path.join(data,'mac-updater.log')))fs.copyFileSync(path.join(data,'mac-updater.log'),path.join(proof,'updater-log.txt'))
    if(data)for(const name of ['mac-update.json','mac-update.json.applying','mac-update.json.applying.failed','update-state.json','update-failed.flag'])if(fs.existsSync(path.join(data,name)))fs.copyFileSync(path.join(data,name),path.join(proof,name))
  }
}
