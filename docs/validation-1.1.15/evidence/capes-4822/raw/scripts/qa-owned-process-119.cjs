// QA lifecycle evidence only. Never enumerate command lines or kill by name/group.
const assert=require('node:assert/strict'),{execFile}=require('node:child_process'),{promisify}=require('node:util')
const now=()=>Number(process.hrtime.bigint())/1e6
const trackedChildren=new Set()
function trackOwnedChild(child,label){
 assert(Number.isSafeInteger(child.pid)&&child.pid>0,'only an actually spawned owned child may be tracked')
 const ledger={label,pid:child.pid,startedAt:new Date().toISOString(),events:[]};let resolveClose
 const closed=new Promise(resolve=>{resolveClose=resolve})
 child.once('exit',(code,signal)=>ledger.events.push({event:'exit',at:now(),code,signal}))
 child.once('close',(code,signal)=>{ledger.events.push({event:'close',at:now(),code,signal});ledger.closed=true;ledger.code=code;ledger.signal=signal;resolveClose({code,signal})})
 child.once('error',error=>ledger.events.push({event:'error',at:now(),name:error.name}))
 const track={child,pid:child.pid,ledger,closed};trackedChildren.add(track);return track
}
function selectOwnedInventory(text,pids){
 const rows=text.trim().split(/\r?\n/).flatMap(line=>{const [pid,ppid,state,cpu,rss]=line.trim().split(/\s+/);return /^\d+$/.test(pid)&&/^\d+$/.test(ppid)?[{pid:Number(pid),ppid:Number(ppid),state,cpuPercent:Number(cpu),rssKiB:Number(rss)}]:[]})
 const owned=new Set(pids);let changed=true
 while(changed){changed=false;for(const row of rows)if(owned.has(row.ppid)&&!owned.has(row.pid)){owned.add(row.pid);changed=true}}
 return rows.filter(row=>owned.has(row.pid))
}
async function ownedInventory(tracks,previouslyLinked=[]){
 const pids=[...new Set([...tracks.map(t=>t.pid),...previouslyLinked])],at=now()
 if(process.platform!=='darwin')return{at,ownedPids:pids,available:false,reason:'native ps inventory only on Darwin'}
 try{const r=await promisify(execFile)('/bin/ps',['-axo','pid=,ppid=,stat=,pcpu=,rss='],{timeout:2000,maxBuffer:1024*1024});return{at,ownedPids:pids,available:true,rows:selectOwnedInventory(r.stdout,pids),scope:'owned roots, currently linked descendants and previously linked PIDs observed again only; command lines never read; no PID-reuse identity or absence claim for unobserved detached descendants; descendants are never signalled'}}
 catch(error){return{at,ownedPids:pids,available:false,error:error.name}}
}
async function finishOwnedChild(track,{terminate=false,timeoutMs=5000}={}){
 const {child,pid,ledger}=track
 assert(child.pid===pid,'owned child identity changed; refuse signal')
 let timer
 try{
  if(terminate&&!ledger.closed&&child.exitCode===null&&child.signalCode===null){ledger.events.push({event:'SIGTERM-request',at:now()});ledger.signalAccepted=child.kill('SIGTERM')}
  const result=await Promise.race([track.closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('owned '+ledger.label+' close timed out')),timeoutMs)})])
  ledger.awaitedClose=true;return result
 }catch(error){ledger.failure={name:error.name,message:error.message};throw error}
 finally{clearTimeout(timer);ledger.finishedAt=new Date().toISOString()}
}
async function preservingCleanup(action,cleanup){
 let value,original
 try{value=await action()}catch(error){original=error}
 try{await cleanup()}catch(error){if(original)throw new AggregateError([original,error],'original QA failure and owned cleanup failure');throw error}
 if(original)throw original
 return value
}
async function measuredStateQuery(query,ledger,clock=now){
 const row={index:ledger.length,requestAt:clock()};ledger.push(row)
 try{const value=await query();row.rendererNow=value?.now??null;row.returned=true;return value}
 catch(error){row.returned=false;row.error=error.name;throw error}
 finally{row.returnAt=clock();row.durationMs=row.returnAt-row.requestAt}
}
function installOwnedCancellation(emitter,onCancel){
 const original=emitter.listeners('SIGTERM'),listener=()=>onCancel();emitter.once('SIGTERM',listener)
 return()=>{emitter.removeListener('SIGTERM',listener);const actual=emitter.listeners('SIGTERM');return{observerRemoved:!actual.includes(listener),originalListenersPreserved:actual.length===original.length&&original.every((fn,index)=>actual[index]===fn)}}
}
module.exports={trackOwnedChild,selectOwnedInventory,ownedInventory,finishOwnedChild,preservingCleanup,measuredStateQuery,trackedChildren,installOwnedCancellation}
