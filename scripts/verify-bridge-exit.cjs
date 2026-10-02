// Exercise the shipped bridge in a real JVM. Only this script's fixture can be
// terminated on timeout; no enumeration/signals to user games or profiles.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'KAMUCL bridge exit 中文 '));
const baseline=process.argv.includes('--baseline');
const jar=path.resolve(process.env.KAMUCL_BRIDGE_JAR||(baseline?'tests/fixtures/kamucl-bridge-1.0.0.jar':'bridge/dist/kamucl-bridge-1.0.1.jar'));
const tool=n=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',n+(process.platform==='win32'?'.exe':'')):n;
const cp=[root,jar,path.resolve('bridge/.cache/gson-2.14.0.jar')].join(path.delimiter);
const compile=spawnSync(tool('javac'),['-encoding','UTF-8','--release','17','-cp',cp,'-d',root,'tests/fixtures/BridgeExitFixture.java'],{encoding:'utf8',windowsHide:true});
assert.ifError(compile.error);assert.equal(compile.status,0,compile.stderr);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const results=[];
 for(const stalled of [false,true]){
  const dir=path.join(root,stalled?'stalled-request':'normal');fs.mkdirSync(dir);
  const mod=path.join(dir,'bridge.jar');fs.copyFileSync(jar,mod);
  const child=spawn(tool('java'),['-cp',[root,mod,path.resolve('bridge/.cache/gson-2.14.0.jar')].join(path.delimiter),'cn.kamucl.bridge.BridgeExitFixture',dir],{windowsHide:true});
  let output='',error='',socket,exited=false;
  child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>{exited=true;resolve({code,signal})})});
  try{
   const ready=Date.now()+8000;
   while(!output.includes('FIXTURE_READY')&&Date.now()<ready&&!exited)await sleep(20);
   assert(output.includes('FIXTURE_READY'),output+error);
   const d=JSON.parse(fs.readFileSync(path.join(dir,'.kamucl-bridge.json')));
   const base=`http://127.0.0.1:${d.port}/kamucl/v1/`;
   assert.equal((await(await fetch(base+'ping')).json()).ok,true);
   const manifest=await(await fetch(base+'manifest')).json();assert(manifest.params.length>0);
   assert.equal((await fetch(base+'set',{method:'POST',body:'{}'})).status,401);
   const p=manifest.params.find(p=>p.kind==='TEXT');assert(p);
   const changed=await(await fetch(base+'set',{method:'POST',headers:{'X-Kamucl-Token':d.token},body:JSON.stringify({id:p.id,value:'fixture'})})).json();assert.equal(changed.ok,true);
   if(stalled){socket=net.connect(d.port,'127.0.0.1');await new Promise(r=>socket.once('connect',r));socket.on('error',()=>{});socket.write(`POST /kamucl/v1/set HTTP/1.1\r\nHost: localhost\r\nX-Kamucl-Token: ${d.token}\r\nContent-Length: 100000\r\n\r\n{`);await sleep(100)}
   const start=Date.now();child.stdin.end('\n');
   let timer;const result=await Promise.race([done,new Promise(r=>{timer=setTimeout(()=>r(null),4000)})]);clearTimeout(timer);
   if(baseline){assert.equal(result,null,'Old bridge unexpectedly exited');results.push({stalled,baselineStuck:true});}
   else{assert.deepEqual(result,{code:0,signal:null},error);assert.equal(fs.readFileSync(path.join(dir,'saved.marker'),'utf8'),'save completed');fs.renameSync(mod,mod+'.released');fs.unlinkSync(mod+'.released');results.push({stalled,exitMs:Date.now()-start,saved:true,modReleased:true});}
  }finally{socket?.destroy();if(!exited){child.kill();await done;}}
 }
 fs.mkdirSync('out',{recursive:true});fs.writeFileSync(`out/bridge-exit-${baseline?'baseline':'fixed'}.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
