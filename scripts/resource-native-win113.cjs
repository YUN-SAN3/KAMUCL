// Independent resource observer. Read-only native counters for explicitly seeded
// processes and descendants, bound by creation time. Never signals a process.
const {spawn}=require('node:child_process'),{EventEmitter}=require('node:events'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const ps=String.raw`
$ErrorActionPreference='Stop'
$source=@'
using System;using System.Collections.Generic;using System.Collections.Concurrent;using System.Runtime.InteropServices;using System.Diagnostics;using System.Threading;using System.Management;
public sealed class ResourceIdentityAfter113 {public uint pid;public uint? ppid;public bool? exists;public bool snapshotComplete;public long startedAtUnixMs,finishedAtUnixMs;public long? creationUnixMs;public string error;}
public sealed class ResourceRow113 {public uint pid,ppid;public string name,error;public int? lastError;public long? creationUnixMs,cpu100ns,readBytes,writeBytes;public ulong? privateCommitBytes,peakPrivateCommitBytes,workingSetBytes,peakWorkingSetBytes,pageFaultCount;public bool openedHandle,retainedOwnedHandle;public long? lifetimeHandleCreationUnixMs;public uint? exitWaitResult,exitCode;public int? exitWaitError;public long? handleStatusAtUnixMs;public string handleStatusError;public ResourceIdentityAfter113 identityAfter;}
public sealed class ResourceGPU113 {public long atUnixMs;public double queryMs;public bool available;public string error;public List<ResourceGPUEntry113> entries=new List<ResourceGPUEntry113>();}
public sealed class ResourceGPUEntry113 {public uint pid;public string instance;public ulong? dedicatedBytes,sharedBytes,totalCommittedBytes;}
public static class ResourceNative113 {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct PE {public uint size,usage,pid;public UIntPtr heap;public uint module,threads,ppid;public int priority;public uint flags;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)]public string name;}
 [StructLayout(LayoutKind.Sequential)]struct FT {public uint low,high;public long Value {get{return ((long)high<<32)|low;}}}
 [StructLayout(LayoutKind.Sequential)]struct PMC {public uint size,faults;public UIntPtr peakWS,ws,peakPaged,paged,peakNonPaged,nonPaged,pageFile,peakPageFile,privateUsage;}
 [StructLayout(LayoutKind.Sequential)]struct IO {public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes;}
 [DllImport("kernel32.dll",SetLastError=true)]static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool Process32FirstW(IntPtr h,ref PE e);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool Process32NextW(IntPtr h,ref PE e);
 [DllImport("kernel32.dll",SetLastError=true)]static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetProcessTimes(IntPtr h,out FT create,out FT exit,out FT kernel,out FT user);
 [DllImport("psapi.dll",SetLastError=true)]static extern bool GetProcessMemoryInfo(IntPtr h,ref PMC memory,uint size);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetProcessIoCounters(IntPtr h,out IO io);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetExitCodeProcess(IntPtr h,out uint code);
 [DllImport("kernel32.dll",SetLastError=true)]static extern uint WaitForSingleObject(IntPtr h,uint milliseconds);
 [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 sealed class BoundHandle {public uint pid,ppid;public string name;public long creationUnixMs;public IntPtr handle;}
 static Dictionary<uint,BoundHandle> handles=new Dictionary<uint,BoundHandle>();
 public static List<string> closedHandles=new List<string>();
 static void Release(BoundHandle bound,string reason){handles.Remove(bound.pid);CloseHandle(bound.handle);closedHandles.Add(bound.pid+":"+bound.creationUnixMs+":"+reason);}
 public static uint ForegroundPid(){uint pid;GetWindowThreadProcessId(GetForegroundWindow(),out pid);return pid;}
 public static List<ResourceRow113> Table(){var result=new List<ResourceRow113>();var h=CreateToolhelp32Snapshot(2,0);if(h==new IntPtr(-1))throw new Exception("process snapshot "+Marshal.GetLastWin32Error());try{var e=new PE();e.size=(uint)Marshal.SizeOf(typeof(PE));if(!Process32FirstW(h,ref e)){var error=Marshal.GetLastWin32Error();if(error==18)return result;throw new Exception("Process32FirstW "+error);}do{result.Add(new ResourceRow113{pid=e.pid,ppid=e.ppid,name=e.name});if(!Process32NextW(h,ref e)){var error=Marshal.GetLastWin32Error();if(error==18)break;throw new Exception("Process32NextW "+error);}}while(true);}finally{CloseHandle(h);}return result;}
 public static ResourceIdentityAfter113 IdentityAfter(uint pid){var result=new ResourceIdentityAfter113{pid=pid,startedAtUnixMs=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()};try{var found=Table().Find(r=>r.pid==pid);result.snapshotComplete=true;result.exists=found!=null;if(found!=null){result.ppid=found.ppid;var h=OpenProcess(0x1000,false,pid);if(h==IntPtr.Zero)result.error="identity OpenProcess "+Marshal.GetLastWin32Error();else try{FT c,e,k,u;if(GetProcessTimes(h,out c,out e,out k,out u))result.creationUnixMs=(c.Value-116444736000000000L)/10000;else result.error="identity GetProcessTimes "+Marshal.GetLastWin32Error();}finally{CloseHandle(h);}}}catch(Exception ex){result.error=ex.GetType().Name+": "+ex.Message;}finally{result.finishedAtUnixMs=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();}return result;}
 public static ResourceRow113 Counter(ResourceRow113 row,long? expectedCreation,long? minimumCreation){
  BoundHandle bound;handles.TryGetValue(row.pid,out bound);
  if(expectedCreation.HasValue&&(bound==null||bound.creationUnixMs!=expectedCreation)){row.error="PriorOwnedHandleUnavailable";return row;}
  var h=bound==null?OpenProcess(0x101010,false,row.pid):bound.handle;
  if(h==IntPtr.Zero)h=OpenProcess(0x101000,false,row.pid);
  if(h==IntPtr.Zero){row.lastError=Marshal.GetLastWin32Error();row.error="OpenProcess "+row.lastError;row.identityAfter=IdentityAfter(row.pid);return row;}
  row.openedHandle=true;row.retainedOwnedHandle=bound!=null;
  if(bound!=null){row.ppid=bound.ppid;row.name=bound.name;row.lifetimeHandleCreationUnixMs=bound.creationUnixMs;}
  try{
   if(bound!=null&&WaitForSingleObject(h,0)==0){row.creationUnixMs=bound.creationUnixMs;row.error="OwnedHandleSignaledExit";return row;}
   FT c,e,k,u;if(!GetProcessTimes(h,out c,out e,out k,out u)){row.lastError=Marshal.GetLastWin32Error();row.error="GetProcessTimes "+row.lastError;return row;}
   row.creationUnixMs=(c.Value-116444736000000000L)/10000;
   if(expectedCreation.HasValue&&row.creationUnixMs!=expectedCreation){row.error="OwnedIdentityCreationChanged";return row;}
   if(minimumCreation.HasValue&&row.creationUnixMs<minimumCreation){row.error="PredatesMinimumOwnedCreation";return row;}
   row.cpu100ns=k.Value+u.Value;var m=new PMC();m.size=(uint)Marshal.SizeOf(typeof(PMC));
   if(!GetProcessMemoryInfo(h,ref m,m.size)){row.lastError=Marshal.GetLastWin32Error();row.error="GetProcessMemoryInfo "+row.lastError;return row;}
   row.privateCommitBytes=m.privateUsage.ToUInt64();row.peakPrivateCommitBytes=m.peakPageFile.ToUInt64();row.workingSetBytes=m.ws.ToUInt64();row.peakWorkingSetBytes=m.peakWS.ToUInt64();row.pageFaultCount=m.faults;
   IO io;if(GetProcessIoCounters(h,out io)){row.readBytes=(long)io.readBytes;row.writeBytes=(long)io.writeBytes;}else{row.lastError=Marshal.GetLastWin32Error();row.error="GetProcessIoCounters "+row.lastError;}
   if(row.error==null&&bound==null){bound=new BoundHandle{pid=row.pid,ppid=row.ppid,name=row.name,creationUnixMs=row.creationUnixMs.Value,handle=h};handles[row.pid]=bound;row.lifetimeHandleCreationUnixMs=bound.creationUnixMs;}
   return row;
  }finally{
   uint code;row.exitWaitResult=WaitForSingleObject(h,0);if(row.exitWaitResult==0xffffffff)row.exitWaitError=Marshal.GetLastWin32Error();
   if(GetExitCodeProcess(h,out code))row.exitCode=code;else row.handleStatusError="GetExitCodeProcess "+Marshal.GetLastWin32Error();
   row.handleStatusAtUnixMs=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();if(row.exitWaitResult==0xffffffff)row.handleStatusError="WaitForSingleObject "+row.exitWaitError;
   if(bound!=null&&row.exitWaitResult==0){if(row.error==null)row.error="OwnedHandleExitedDuringCounterRead";Release(bound,"actual-signaled-exit");}else if(bound==null)CloseHandle(h);
  }
 }
 public static List<ResourceRow113> EndedHandles(uint[] attempted){var result=new List<ResourceRow113>();foreach(var bound in new List<BoundHandle>(handles.Values)){if(Array.IndexOf(attempted,bound.pid)>=0)continue;var wait=WaitForSingleObject(bound.handle,0);if(wait==258)continue;result.Add(Counter(new ResourceRow113{pid=bound.pid,ppid=bound.ppid,name=bound.name},bound.creationUnixMs,null));}return result;}
 public static ConcurrentQueue<string> commands=new ConcurrentQueue<string>();static bool stopping;static readonly object gpuLock=new object();static HashSet<uint> owned=new HashSet<uint>();static ResourceGPU113 gpu;public static void Own(uint[] pids){lock(gpuLock){owned=new HashSet<uint>(pids);}}
 public static ResourceGPU113 GPU(){lock(gpuLock){return gpu;}}
 static ulong? Num(ManagementBaseObject row,string key){return row[key]==null?(ulong?)null:Convert.ToUInt64(row[key]);}
 public static void Begin(){new Thread(()=>{while(!stopping){var timer=Stopwatch.StartNew();var result=new ResourceGPU113{atUnixMs=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()};try{HashSet<uint> ids;lock(gpuLock){ids=new HashSet<uint>(owned);}if(ids.Count>0){using(var search=new ManagementObjectSearcher("SELECT Name,DedicatedUsage,SharedUsage,TotalCommitted FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory")){search.Options.Timeout=TimeSpan.FromSeconds(3);foreach(ManagementObject row in search.Get()){var name=Convert.ToString(row["Name"]);var match=System.Text.RegularExpressions.Regex.Match(name,@"(?:^|_)pid_(\d+)(?:_|$)");uint id;if(!match.Success||!uint.TryParse(match.Groups[1].Value,out id)||!ids.Contains(id))continue;result.entries.Add(new ResourceGPUEntry113{pid=id,instance=name,dedicatedBytes=Num(row,"DedicatedUsage"),sharedBytes=Num(row,"SharedUsage"),totalCommittedBytes=Num(row,"TotalCommitted")});}}result.available=true;}else result.error="No owned processes yet";}catch(Exception ex){result.error=ex.GetType().Name+": "+ex.Message;}result.queryMs=timer.Elapsed.TotalMilliseconds;lock(gpuLock){gpu=result;}for(int i=0;i<10&&!stopping;i++)Thread.Sleep(100);}}){IsBackground=true}.Start();}
 public static void Stop(){stopping=true;foreach(var bound in new List<BoundHandle>(handles.Values))Release(bound,"observer-stop");}
}
'@
Add-Type -TypeDefinition $source -ReferencedAssemblies System.dll,System.Core.dll,System.Management.dll
[ResourceNative113]::Begin()
$known=@{};$seeds=@{};$roles=@{};$retired=@{};$phase='observer-ready';$lastGPU=0;$clock=[Diagnostics.Stopwatch]::StartNew();$generation=-1;$controlPath=$env:KAMUCL_RESOURCE_CONTROL;$ownerPid=[uint32]$env:KAMUCL_RESOURCE_OWNER
@{event='ready';observerPid=$PID;counter='PROCESS_MEMORY_COUNTERS_EX + GetProcessTimes + GetProcessIoCounters';intervalRequestedMs=100} | ConvertTo-Json -Compress | ForEach-Object { [Console]::WriteLine($_) }
$stop=$false
try{
while(-not $stop){
 try { $command=Get-Content -LiteralPath $controlPath -Raw | ConvertFrom-Json; if($command.generation -ne $generation){$generation=$command.generation;$phase=[string]$command.phase;foreach($seed in $command.seeds){if(-not $retired.ContainsKey([string]$seed.pid)){$seeds[[string]$seed.pid]=[double]$seed.startedAt;$roles[[string]$seed.pid]=[string]$seed.role}};foreach($role in $command.roles){if(-not $retired.ContainsKey([string]$role.pid)){$roles[[string]$role.pid]=[string]$role.role}};$stop=$command.stop -eq $true} } catch { }
 if($clock.Elapsed.TotalMilliseconds -gt 900000){$stop=$true}
 try {$owner=[Diagnostics.Process]::GetProcessById($ownerPid);$owner.Dispose()}catch{$stop=$true}
 if($stop){break}
 $sampleStart=$clock.Elapsed.TotalMilliseconds;$table=[ResourceNative113]::Table();$rows=@();$observed=@{};$counterErrors=@();$failedRows=@();$attempted=@{}
 function CounterFailure($counter,$stage){
  $taskKey=[string]$counter.pid;$prior=$(if($known.ContainsKey($taskKey)){@{pid=$counter.pid;creationUnixMs=$known[$taskKey]}}else{$null});$classification='unresolved-counter-failure';$lineage=$null;$retirement=$null
  if($prior -and $counter.error -eq 'OwnedIdentityCreationChanged' -and $counter.creationUnixMs -ne $prior.creationUnixMs){
   $taskParent=[string]$counter.ppid;$parentIdentities=@($known.Keys | Where-Object {-not $retired.ContainsKey($_)} | ForEach-Object {@{pid=[uint32]$_;creationUnixMs=$known[$_]}});$potentialOwned=$observed.ContainsKey($taskParent) -or ($known.ContainsKey($taskParent) -and -not $retired.ContainsKey($taskParent));$lineage=@{replacementParentPid=$counter.ppid;potentialOwnedLineage=$potentialOwned;originalNonRetiredOwnedIdentities=$parentIdentities}
   if($potentialOwned){$classification='replacement-with-potential-owned-lineage-unmeasured'}else{
    $classification='confirmed-prior-owned-pid-reused';$retirement=@{pid=$counter.pid;beforeCreationUnixMs=$prior.creationUnixMs;afterCreationUnixMs=$counter.creationUnixMs;atUnixMs=$counter.handleStatusAtUnixMs;replacementExcluded=$true;seedRetired=$true;roleRetired=$true};$retired[$taskKey]=$retirement;$seeds.Remove($taskKey);$roles.Remove($taskKey)
   }
  }
  if($classification -eq 'unresolved-counter-failure' -and $prior -and $counter.openedHandle -and $counter.creationUnixMs -eq $prior.creationUnixMs -and $counter.exitWaitResult -eq 0 -and -not $counter.handleStatusError){
   $after=[ResourceNative113]::IdentityAfter($counter.pid);$taskParent=[string]$after.ppid;$parentIdentities=@($known.Keys | Where-Object {-not $retired.ContainsKey($_)} | ForEach-Object {@{pid=[uint32]$_;creationUnixMs=$known[$_]}});$potentialOwned=$after.exists -eq $true -and ($observed.ContainsKey($taskParent) -or ($known.ContainsKey($taskParent) -and -not $retired.ContainsKey($taskParent)));$lineage=@{replacementParentPid=$after.ppid;potentialOwnedLineage=$potentialOwned;originalNonRetiredOwnedIdentities=$parentIdentities;afterOriginalExit=$after}
   if(-not $after.snapshotComplete -or $null -eq $after.exists){$classification='original-exit-followup-snapshot-unavailable'}elseif($potentialOwned){$classification='replacement-with-potential-owned-lineage-unmeasured'}else{$classification='confirmed-owned-handle-exit';$retirement=@{pid=$counter.pid;kind='original-owned-handle-signaled-exit';beforeCreationUnixMs=$prior.creationUnixMs;afterCreationUnixMs=$after.creationUnixMs;atUnixMs=$counter.handleStatusAtUnixMs;replacementExcluded=$true;seedRetired=$true;roleRetired=$true};$retired[$taskKey]=$retirement;$seeds.Remove($taskKey);$roles.Remove($taskKey)}
  }
  elseif($classification -eq 'unresolved-counter-failure' -and $prior -and $counter.error -eq 'OpenProcess 87' -and $counter.identityAfter.snapshotComplete -eq $true -and $counter.identityAfter.exists -eq $false -and -not $counter.identityAfter.error){$classification='confirmed-prior-owned-pid-absent'}
  return @{pid=$counter.pid;stage=$stage;error=$counter.error;phase=$phase;observedAtUnixMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();identityBefore=$prior;classification=$classification;rawCounter=$counter;ownershipAtObservation=$lineage;retirement=$retirement}
 }
 foreach($row in $table){$key=[string]$row.pid;if($seeds.ContainsKey($key)){$attempted[$key]=$true;$counter=[ResourceNative113]::Counter($row,$(if($known.ContainsKey($key)){[long]$known[$key]}else{$null}),[long]($seeds[$key]-2000));if($counter.error){$counterErrors+=CounterFailure $counter 'seed';$failedRows+=@($counter);continue};if($known.ContainsKey($key)){if($counter.creationUnixMs -ne $known[$key]){$counterErrors+=@{pid=$row.pid;stage='identity';error='seed PID reused; refusing to rebind';classification='owned-identity-invalidated';identityBefore=@{pid=$row.pid;creationUnixMs=$known[$key]};rawCounter=$counter;observedAtUnixMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();phase=$phase};$failedRows+=@($counter);continue}}elseif($counter.creationUnixMs -lt $seeds[$key]-2000){$counterErrors+=@{pid=$row.pid;stage='identity';error='seed predates this owned launch';classification='owned-identity-invalidated';rawCounter=$counter;phase=$phase};$failedRows+=@($counter);continue};$known[$key]=$counter.creationUnixMs;$observed[$key]=$counter}}
 $changed=$true
 while($changed){$changed=$false;foreach($row in $table){$key=[string]$row.pid;$parent=[string]$row.ppid;if($observed.ContainsKey($key) -or $attempted.ContainsKey($key)){continue};if($retired.ContainsKey($key)){
 if($observed.ContainsKey($parent) -or ($known.ContainsKey($parent) -and -not $retired.ContainsKey($parent))){$attempted[$key]=$true;$counter=[ResourceNative113]::Counter($row,[long]$retired[$key].beforeCreationUnixMs,$null);$counterErrors+=@{pid=$row.pid;stage='identity';error='retired PID has potential owned lineage; lifecycle unmeasured';classification='replacement-with-potential-owned-lineage-unmeasured';rawCounter=$counter;phase=$phase};$failedRows+=@($counter)};continue
 };if($known.ContainsKey($key) -or $observed.ContainsKey($parent)){$attempted[$key]=$true;$counter=[ResourceNative113]::Counter($row,$(if($known.ContainsKey($key)){[long]$known[$key]}else{$null}),$(if($observed.ContainsKey($parent)){[long]$observed[$parent].creationUnixMs}else{$null}));if($counter.error){$counterErrors+=CounterFailure $counter 'descendant';$failedRows+=@($counter);continue};if($known.ContainsKey($key)){if($counter.creationUnixMs -ne $known[$key]){$counterErrors+=@{pid=$row.pid;stage='identity';error='known descendant PID reused; replacement rejected';classification='owned-identity-invalidated';identityBefore=@{pid=$row.pid;creationUnixMs=$known[$key]};rawCounter=$counter;observedAtUnixMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();phase=$phase};$failedRows+=@($counter);continue}}elseif($counter.creationUnixMs -lt $observed[$parent].creationUnixMs){continue}else{$known[$key]=$counter.creationUnixMs;$changed=$true};$observed[$key]=$counter}}}
 foreach($ended in [ResourceNative113]::EndedHandles([uint32[]]@($attempted.Keys|ForEach-Object{[uint32]$_}))){$counterErrors+=CounterFailure $ended 'retained-handle-exit';$failedRows+=@($ended)}
 foreach($key in $observed.Keys){$row=$observed[$key];$rows+=@{pid=$row.pid;ppid=$row.ppid;name=$row.name;creationUnixMs=$row.creationUnixMs;role=$(if($roles.ContainsKey($key)){$roles[$key]}else{'unclassified-owned-descendant'});privateCommitBytes=$row.privateCommitBytes;peakPrivateCommitBytes=$row.peakPrivateCommitBytes;workingSetBytes=$row.workingSetBytes;peakWorkingSetBytes=$row.peakWorkingSetBytes;pageFaultCount=$row.pageFaultCount;cpu100ns=$row.cpu100ns;readBytes=$row.readBytes;writeBytes=$row.writeBytes;handleStatusAtUnixMs=$row.handleStatusAtUnixMs;exitWaitResult=$row.exitWaitResult;exitCode=$row.exitCode;openedHandle=$row.openedHandle;retainedOwnedHandle=$row.retainedOwnedHandle;lifetimeHandleCreationUnixMs=$row.lifetimeHandleCreationUnixMs}}
 [ResourceNative113]::Own([uint32[]]@($observed.Keys|ForEach-Object{[uint32]$_}))
 $foregroundPid=[ResourceNative113]::ForegroundPid()
 @{event='sample';atUnixMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();monoMs=$clock.Elapsed.TotalMilliseconds;phase=$phase;collectionMs=$clock.Elapsed.TotalMilliseconds-$sampleStart;foregroundPid=$foregroundPid;foregroundOwned=$observed.ContainsKey([string]$foregroundPid);rows=@($(if($counterErrors.Count -eq 0){$rows}));partialRows=@($(if($counterErrors.Count -gt 0){$rows;$failedRows}));wholeTreeCountersComplete=$($counterErrors.Count -eq 0);wholeTreeCounterTotals=$(if($counterErrors.Count -gt 0){@{privateCommitBytes=$null;workingSetBytes=$null;cpu100ns=$null;readBytes=$null;writeBytes=$null}}else{$null});counterErrors=@($counterErrors)}|ConvertTo-Json -Depth 8 -Compress|ForEach-Object { [Console]::WriteLine($_) }
 $gpu=[ResourceNative113]::GPU();if($gpu -and $gpu.atUnixMs -ne $lastGPU){$lastGPU=$gpu.atUnixMs;@{event='gpu';phase=$phase;data=$gpu}|ConvertTo-Json -Depth 5 -Compress|ForEach-Object { [Console]::WriteLine($_) }}
 Start-Sleep -Milliseconds 100
}
}finally{
[ResourceNative113]::Stop()
@{event='stopped';ownedIdentities=$known;retiredIdentities=$retired;closedOwnedQueryHandles=@([ResourceNative113]::closedHandles);observerPid=$PID}|ConvertTo-Json -Depth 6 -Compress|ForEach-Object { [Console]::WriteLine($_) }
}
`
function startWindowsSampler(onRecord){
 assert.equal(process.platform,'win32');const events=new EventEmitter(),controlRoot=path.resolve('out/resource113/native-observer-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex'));fs.mkdirSync(controlRoot,{recursive:true});const controlFile=path.join(controlRoot,'control.json'),control={generation:0,phase:'observer-ready',seeds:[],roles:[],stop:false};fs.writeFileSync(controlFile,JSON.stringify(control));const observerFile=path.join(controlRoot,'observer.ps1');fs.writeFileSync(observerFile,ps);const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',observerFile],{stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,KAMUCL_RESOURCE_CONTROL:controlFile,KAMUCL_RESOURCE_OWNER:String(process.pid)}});let carry='',errorText='',settled=false
 const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('native sampler readiness timed out: '+errorText)),20000);child.stdout.on('data',buf=>{carry+=buf.toString();let at;while((at=carry.indexOf('\n'))>=0){const line=carry.slice(0,at).trim();carry=carry.slice(at+1);if(!line)continue;let row;try{row=JSON.parse(line)}catch{reject(Error('native sampler non-JSON output: '+line));continue}onRecord?.(row);events.emit(row.event,row);if(row.event==='ready'){settled=true;clearTimeout(timer);resolve(row)}}});child.stderr.on('data',buf=>{errorText+=buf.toString()});child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('exit',(code,signal)=>{clearTimeout(timer);if(!settled)reject(Error('native sampler early exit '+code+': '+errorText));events.emit('exit',{code,signal,errorText})})})
 const send=value=>{if(value.op==='seed')control.seeds.push(value);if(value.op==='role')control.roles.push(value);if(value.op==='mark')control.phase=value.phase;if(value.op==='stop')control.stop=true;control.generation++;fs.writeFileSync(controlFile,JSON.stringify(control));return true}
 return{child,ready,events,send,controlRoot,async stop(){const done=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('owned sampler exit timed out')),10000);child.once('close',(code,signal)=>{clearTimeout(timer);code===0?resolve({code,signal,errorText}):reject(Error('native sampler exit '+code+': '+errorText))})});send({op:'stop'});return done}}
}
module.exports={startWindowsSampler}
if(require.main===module){(async()=>{const rows=[],sampler=startWindowsSampler(row=>rows.push(row));await sampler.ready;sampler.send({op:'seed',pid:process.pid,startedAt:Date.now()-1000,role:'owned-observer-selftest'});await new Promise(resolve=>setTimeout(resolve,1300));const hold=Buffer.alloc(16*1024*1024,3);await new Promise(resolve=>setTimeout(resolve,1300));await sampler.stop();const samples=rows.filter(r=>r.event==='sample'&&r.rows.length);assert(samples.length>=5);const identities=new Map(samples.flatMap(s=>s.rows).map(r=>[r.pid,r]));const linked=new Set([process.pid]);let expanded=true;while(expanded){expanded=false;for(const row of identities.values())if(linked.has(row.ppid)&&!linked.has(row.pid)){linked.add(row.pid);expanded=true}}assert([...identities.keys()].every(pid=>linked.has(pid)),JSON.stringify([...identities.values()]));;assert(samples.at(-1).rows.find(r=>r.pid===process.pid).privateCommitBytes>0);assert(samples.at(-1).rows.find(r=>r.pid===process.pid).workingSetBytes>0);assert(hold[0]===3);console.log(JSON.stringify({passed:true,scope:'native counters for own observer test process only; not launcher performance acceptance',samples:samples.length,first:samples[0],last:samples.at(-1),gpu:rows.filter(r=>r.event==='gpu').slice(-1)}))})().catch(error=>{console.error(error);process.exitCode=1})}

