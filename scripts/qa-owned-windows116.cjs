// Windows QA process family snapshots; never reads command lines or signals any process.
const assert=require('node:assert/strict'),{execFile}=require('node:child_process'),{promisify}=require('node:util')
function selectOwned(rows,rootPid,seen=new Map()){
 assert(Number.isSafeInteger(rootPid)&&rootPid>0);assert(Array.isArray(rows));const key=row=>row.pid+':'+row.createdAtUnixMs,byPid=new Map(),owned=new Set(),current=[]
 for(const row of rows){assert(Number.isSafeInteger(row.pid)&&row.pid>0);assert(Number.isSafeInteger(row.ppid)&&row.ppid>=0);assert(Number.isFinite(row.createdAtUnixMs));assert(!byPid.has(row.pid));byPid.set(row.pid,row);if(seen.has(key(row)))owned.add(key(row))}
 const root=byPid.get(rootPid);if(seen.rootIdentity===undefined){assert(root,'Actual spawned root must be observed alive before claiming descendants');seen.rootIdentity=key(root)}
 if(root&&key(root)===seen.rootIdentity)owned.add(key(root))
 let changed=true;while(changed){changed=false;for(const row of rows){const parent=byPid.get(row.ppid);if(parent&&owned.has(key(parent))&&!owned.has(key(row))){owned.add(key(row));changed=true}}}
 const reused=[];for(const row of rows){const prior=[...seen.values()].filter(value=>value.pid===row.pid&&key(value)!==key(row));if(prior.length)reused.push({pid:row.pid,previousCreationTimes:prior.map(value=>value.createdAtUnixMs),currentCreationTime:row.createdAtUnixMs,currentParentPid:row.ppid,currentGenerationOwned:owned.has(key(row))})}
 for(const row of rows)if(owned.has(key(row))){if(!seen.has(key(row)))seen.set(key(row),{...row,identity:key(row),linkedBy:key(row)===seen.rootIdentity?'Actually spawned QA Node driver root with original creation time':'Observed live parent identity belonging to the original own process family'});current.push(row)}
 return{rows:current,seen:[...seen.values()],pidReuseObservations:reused,rootPid,rootIdentity:seen.rootIdentity,available:true,classification:'Original Windows Win32_Process PID/parent/creation-time snapshot. Each generation is a separate identity, descendants require an actual live owned parent; PID reuse alone never grants ownership. Previously seen exact identities remain tracked after parents exit. No name/command-line matching or signals.'}
}
async function snapshot(rootPid,seen){
 assert.equal(process.platform,'win32');const script="$ErrorActionPreference='Stop';$r=@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -gt 0 -and $_.CreationDate } | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;ppid=[int]$_.ParentProcessId;createdAtUnixMs=([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()} });ConvertTo-Json -Compress -Depth 4 -InputObject $r"
 const startedAt=new Date().toISOString(),{stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:15000,maxBuffer:1024*1024}),rows=JSON.parse(stdout);return{startedAt,finishedAt:new Date().toISOString(),...selectOwned(rows,rootPid,seen)}
}
module.exports={selectOwned,snapshot}
