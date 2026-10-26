// Actual Win32 client size/visibility read against one disposable owned process.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn,execFileSync}=require('node:child_process'),{buildSync}=require('esbuild'),k=require('koffi')
async function run(){
 assert.equal(process.platform,'win32')
 const directory=path.resolve('out','game-window-size117-'+crypto.randomUUID());fs.mkdirSync(directory,{recursive:true})
 const exe=path.join(directory,'GameWindowSize117.exe'),compiler=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
 execFileSync(compiler,['/nologo','/target:exe','/platform:anycpu','/optimize+','/out:'+exe,path.resolve('tests/fixtures/GameWindowSize117.cs')],{windowsHide:true})
 const result=buildSync({entryPoints:['src/main/core/gameWindowSize.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',logLevel:'silent'}),module={exports:{}}
 new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports)
 const dpi=k.load('user32.dll').func('intptr __stdcall SetThreadDpiAwarenessContext(intptr)'),old=dpi(-4)
 const proc=spawn(exe,[],{windowsHide:true,stdio:['pipe','pipe','pipe']}),events=[],waiting=new Map();let buffer='',stderr='',exit
 proc.stderr.on('data',x=>stderr+=x);proc.stdout.on('data',x=>{buffer+=x;for(let p;(p=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,p).trim();buffer=buffer.slice(p+1);if(line){const row=JSON.parse(line);events.push(row);waiting.get(row.command)?.(row)}}})
 const closed=new Promise(resolve=>proc.once('close',(code,signal)=>{exit={code,signal};resolve()}))
 async function ready(command){const previous=events.findLast(e=>e.command===command);if(previous)return previous;return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Fixture readiness '+command)),5000);waiting.set(command,e=>{clearTimeout(t);waiting.delete(command);resolve(e)})})}
 const samples=[]
 try{
  let receipt=await ready('ready');assert.equal(receipt.pid,proc.pid)
  let observed=await module.exports.readOwnedGameWindow(proc.pid);assert.deepEqual(observed,{pid:proc.pid,width:1000,height:600,windowed:true});samples.push({receipt,observed})
  assert.equal(await module.exports.readOwnedGameWindow(process.pid),undefined,'reader cannot confuse observer with fixture')
  for(const command of ['resize','hide','show','borderless']){proc.stdin.write(command+'\n');receipt=await ready(command);observed=await module.exports.readOwnedGameWindow(proc.pid);if(command==='resize'||command==='show')assert.deepEqual(observed,{pid:proc.pid,width:1280,height:720,windowed:true});else assert.equal(observed,undefined);samples.push({receipt,observed:observed??null})}
  proc.stdin.write('close\n');proc.stdin.end();await closed;assert.deepEqual(exit,{code:0,signal:null});assert.equal(await module.exports.readOwnedGameWindow(proc.pid),undefined)
  const proof={complete:true,classification:'Actual disposable Win32 GLFW-class fixture, not Minecraft gameplay; exact child PID, read-only client rectangles, visibility, borderless rejection, clean close. Observer per-monitor DPI-aware; no other process input/focus/size changes.',directory,pid:proc.pid,samples,exit,stderr,sourceSha256:crypto.createHash('sha256').update(fs.readFileSync('src/main/core/gameWindowSize.ts')).digest('hex')}
  fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof))
 }finally{dpi(old);if(exit===undefined){proc.stdin.write('close\n');proc.stdin.end();await closed}}
}
run().catch(e=>{console.error(e);process.exitCode=1})
