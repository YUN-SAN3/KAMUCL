// Windows-owned JVM probes only; never attaches to or ends an existing game.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),koffi=require('koffi'),{transformSync}=require('esbuild')
const mod={exports:{}};new Function('require','module','exports',transformSync(fs.readFileSync('src/main/core/javaScanUtils.ts','utf8'),{loader:'ts',format:'cjs'}).code)(require,mod,mod.exports)
const {JAVA_PROBE_VM_ARGS,parseJavaProbeOutput,javaHomeExecutable}=mod.exports
const kernel=koffi.load('kernel32.dll'),psapi=koffi.load('psapi.dll'),open=kernel.func('OpenProcess','uintptr',['uint32','bool','uint32']),close=kernel.func('CloseHandle','bool',['uintptr'])
const counterType=koffi.struct('ResourceProbe113',{cb:'uint32',faults:'uint32',peakWS:'uint64',ws:'uint64',peakPaged:'uint64',paged:'uint64',peakNonPaged:'uint64',nonPaged:'uint64',pageFile:'uint64',peakPageFile:'uint64',privateUsage:'uint64'})
const counter=psapi.func('GetProcessMemoryInfo','bool',['uintptr',koffi.out(koffi.pointer(counterType)),'uint32'])
const times=kernel.func('GetProcessTimes','bool',['uintptr',...Array(4).fill(koffi.out(koffi.pointer('uint64')))])
async function probe(exe,mode){
 const args=[...(mode==='candidate'?JAVA_PROBE_VM_ARGS:[]),'-XshowSettings:properties','-version'],start=performance.now(),child=spawn(exe,args,{windowsHide:true}),handle=open(0x1010,false,child.pid);assert(handle,'Unable to open newly owned probe '+child.pid)
 let text='';child.stdout.on('data',v=>text+=v);child.stderr.on('data',v=>text+=v)
 const memory=[],read=()=>{const result={cb:koffi.sizeof(counterType)};assert(counter(handle,result,result.cb));memory.push({atMs:performance.now()-start,...result})};read();const timer=setInterval(read,10)
 try{await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('Probe failed '+code+': '+text)))})
  read();const creation=[0n],exit=[0n],kernelTime=[0n],user=[0n];assert(times(handle,creation,exit,kernelTime,user));const identity={parsed:parseJavaProbeOutput(text),home:javaHomeExecutable(text)};assert(identity.parsed&&identity.home)
  return{mode,executable:exe,args,pid:child.pid,creation100ns:String(creation[0]),elapsedMs:performance.now()-start,cpuMs:Number(BigInt(kernelTime[0])+BigInt(user[0]))/10000,peakPrivateCommitBytes:Number(memory.at(-1).peakPageFile),peakWorkingSetBytes:Number(memory.at(-1).peakWS),identity,samples:memory}
 }finally{clearInterval(timer);close(handle)}
}
async function main(){assert.equal(process.platform,'win32');const root=path.resolve('out/resource113/java-probe-'+Date.now());fs.mkdirSync(root,{recursive:true});const executables=fs.readdirSync('C:/Program Files/Java',{withFileTypes:true}).filter(d=>d.isDirectory()&&/^jdk-/.test(d.name)).map(d=>path.join('C:/Program Files/Java',d.name,'bin/java.exe'));assert(executables.length>=1)
 const proof={classification:'Actual owned Windows JDK version/path probes with native lifetime peak counters; game heap unchanged; not full launcher acceptance',executables,baseline:[],pairs:[],complete:false};const save=()=>fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify(proof,(_,v)=>typeof v==='bigint'?String(v):v,2));save()
 try{for(let i=0;i<10;i++){const rows=[];for(const exe of executables)rows.push(await probe(exe,'old'));proof.baseline.push({i,rows});save()}
  for(let i=0;i<10;i++){const rows=[];for(const exe of executables){const pair={exe};for(const mode of i%2?['candidate','old']:['old','candidate'])pair[mode]=await probe(exe,mode);assert.deepEqual(pair.old.identity,pair.candidate.identity);rows.push(pair)}proof.pairs.push({i,rows});save()}
  proof.complete=true;save();console.log('JAVA_PROBE_PROOF '+path.join(root,'summary.json'))
 }catch(error){proof.failure={message:error.message,stack:error.stack};save();throw error}
}
main().catch(error=>{console.error(error);process.exitCode=1})
