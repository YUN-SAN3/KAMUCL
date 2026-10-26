// Synthetic parser/acceptance guards only. These never count as Mac native API
// qualification, reproduce original CI bytes, or upgrade an old failed run.
const test=require('node:test'),assert=require('node:assert/strict')
const {assertZombieIdentityEvidence,assertNativeZombieQualification,assertConfirmedLifecycleInvalidation,summarizeMac}=require('./resource-mac113-native.cjs')
const {isCompleteEmptyNativeSample}=require('./resource-sample113.cjs')
const counterFields=['physicalFootprintBytes','residentSizeBytes','residentSizeMaxBytes','virtualSizeBytes','cpuNs','pageFaultCount','pageins','readBytes','writeBytes']
const identity=(pid=2,creation='1700000000123456')=>({pid,ppid:50,name:'synthetic-owned-child',creationUnixUS:creation})
function probe(id=identity(),overrides={}){
 const seconds=(BigInt(id.creationUnixUS)/1000000n).toString(),useconds=(BigInt(id.creationUnixUS)%1000000n).toString()
 const p={source:'Actual proc_pidinfo PROC_PIDTBSDINFO identity observation',api:'proc_pidinfo',flavor:3,argument:1,requestedPID:id.pid,expectedCreationUnixUS:id.creationUnixUS,result:136,systemErrno:0,bufferSize:136,probeStartUnixMs:102,probeEndUnixMs:103,zombieStatusConstant:5,qualified:true,identity:{pid:id.pid,ppid:id.ppid,creationUnixUS:id.creationUnixUS,startTimeSeconds:seconds,startTimeMicroseconds:useconds,status:5},bufferLayout:{size:136,pid:12,ppid:16,status:4,startTimeSeconds:120,startTimeMicroseconds:128,byteOrder:'little-endian'},...overrides}
 return rawBuffer(p)
}
function rawBuffer(p){const bytes=Buffer.alloc(p.bufferSize);const id=p.identity,l=p.bufferLayout;if(id){bytes.writeUInt32LE(id.pid,l.pid);bytes.writeUInt32LE(id.ppid,l.ppid);bytes.writeUInt32LE(id.status,l.status);bytes.writeBigUInt64LE(BigInt(id.startTimeSeconds),l.startTimeSeconds);bytes.writeBigUInt64LE(BigInt(id.startTimeMicroseconds),l.startTimeMicroseconds)}p.originalBufferBase64=bytes.toString('base64');return p}
function invalidation(){
 const id=identity(),error={pid:id.pid,stage:'identity before counters',beforeCreationUnixUS:id.creationUnixUS,afterIdentity:null,existenceProbe:{result:0,errno:0,signal:0},atUnixMs:104,collectionStartUnixMs:100,lifecycleInvalidation:true,required:false,originalCounterErrors:[],zombieIdentityProbe:probe(id)}
 const row={...id,role:'unclassified-owned-descendant',invalidated:true,collectionStartUnixMs:100,...Object.fromEntries(counterFields.map(k=>[k,null])),identityInvalidation:error}
 return{row,error}
}
function nativeQualificationFixture(){
 const{row,error}=invalidation(),own=identity(),control=identity(3,'1700000000223456'),controlProbe=probe(control,{qualified:false,probeStartUnixMs:90,probeEndUnixMs:91});controlProbe.identity.status=3;rawBuffer(controlProbe)
 const liveRow={...control,physicalFootprintBytes:1234,residentSizeBytes:2345},wrongCreation=(BigInt(own.creationUnixUS)+1n).toString(),wrongProbe=probe(own,{qualified:false,expectedCreationUnixUS:wrongCreation,probeStartUnixMs:106,probeEndUnixMs:107}),wrongError={...error,beforeCreationUnixUS:wrongCreation,collectionStartUnixMs:105,atUnixMs:108,lifecycleInvalidation:false,required:true,zombieIdentityProbe:wrongProbe},wrongRow={...row,creationUnixUS:wrongCreation,collectionStartUnixMs:105,identityInvalidation:wrongError}
 const ordinary=probe(own,{argument:0,qualified:false,result:0,systemErrno:3,identity:null,probeStartUnixMs:98,probeEndUnixMs:99}),wait=probe(own,{probeStartUnixMs:96,probeEndUnixMs:97})
 return{event:'owned-zombie-qualification',passed:true,parentPID:50,startedAtUnixMs:80,finishedAtUnixMs:112,originalOwnedIdentity:own,originalControlIdentity:control,liveControl:{probe:controlProbe,row:liveRow,errors:[{stage:'task_for_pid',required:false}]},naturalExitRelease:{pid:own.pid,pipeCloseResult:0,systemErrno:0,atUnixMs:95,signalDelivered:false},ordinaryIdentityAtZombie:ordinary,zombieWaitObservations:[wait],zombieCounters:{row,errors:[error],noteExitObserverSupplied:false},mismatchedCreationDiagnostic:{row:wrongRow,errors:[wrongError]},controlAliveBeforeReap:{...control},controlAliveAfterReap:{...control},naturalReaps:[own,control].map((id,i)=>({pid:id.pid,closeAttempted:i===1,releasePipeCloseResult:i===1?0:null,releasePipeErrno:i===1?0:null,waitPIDResult:id.pid,systemErrno:0,originalWaitStatusBuffer:0,waitStatusValidated:true,rawWaitStatus:0,naturalExitCode:0,atUnixMs:110+i}))}
}
test('Only current same-creation native SZOMB with original struct bytes can classify the unknown-alive race',()=>{const{row,error}=invalidation(),original=JSON.stringify({row,error});assertZombieIdentityEvidence(error.zombieIdentityProbe,row,100,104);assertConfirmedLifecycleInvalidation(error,row);assert.equal(JSON.stringify({row,error}),original);assert.equal(error.kernelExitEvidence,undefined);assert.equal(error.existenceProbe.result,0)})
const negativeProbes=[
 ['normal arg=0',p=>{p.argument=0}],
 ['wrong API flavor',p=>{p.flavor=13}],
 ['permission error',p=>{p.result=0;p.systemErrno=1;p.identity=null}],
 ['short result',p=>{p.result--}],
 ['unqualified result',p=>{p.qualified=false}],
 ['different returned PID',p=>{p.identity.pid++;rawBuffer(p)}],
 ['different expected creation',p=>{p.expectedCreationUnixUS=(BigInt(p.expectedCreationUnixUS)+1n).toString()}],
 ['different returned creation',p=>{p.identity.creationUnixUS=(BigInt(p.identity.creationUnixUS)+1n).toString()}],
 ['live sleeping process',p=>{p.identity.status=3;rawBuffer(p)}],
 ['unknown process state',p=>{p.identity.status=0;rawBuffer(p)}],
 ['future exit evidence',p=>{p.probeEndUnixMs=104.1}],
 ['prior collection evidence',p=>{p.probeStartUnixMs=99}],
 ['reversed query clock',p=>{p.probeEndUnixMs=101}],
 ['missing original native buffer',p=>{delete p.originalBufferBase64}],
 ['truncated original buffer',p=>{p.originalBufferBase64=Buffer.alloc(135).toString('base64')}],
 ['raw status disagrees with JSON fields',p=>{const bytes=Buffer.from(p.originalBufferBase64,'base64');bytes.writeUInt32LE(3,p.bufferLayout.status);p.originalBufferBase64=bytes.toString('base64')}],
 ['raw creation disagrees with JSON fields',p=>{const bytes=Buffer.from(p.originalBufferBase64,'base64');bytes.writeBigUInt64LE(123457n,p.bufferLayout.startTimeMicroseconds);p.originalBufferBase64=bytes.toString('base64')}],
 ['invalid original struct field offset',p=>{p.bufferLayout.pid=136}],
 ['noncanonical base64',p=>{p.originalBufferBase64+='\n'}],
 ['invalid native microseconds',p=>{p.identity.startTimeMicroseconds='1000000'}],
 ['missing identity',p=>{p.identity=null}]
]
for(const[name,mutate]of negativeProbes)test('Reject zombie proof: '+name,()=>{const{row,error}=invalidation();mutate(error.zombieIdentityProbe);assert.throws(()=>assertZombieIdentityEvidence(error.zombieIdentityProbe,row,100,104));assert.throws(()=>assertConfirmedLifecycleInvalidation(error,row))})
test('Historical missing identity and kill0 success remains a required failure without the original contemporaneous probe',()=>{const{row,error}=invalidation();delete error.zombieIdentityProbe;assert.throws(()=>assertConfirmedLifecycleInvalidation(error,row),/live or unknown/);error.lifecycleInvalidation=false;error.required=true;const sample={event:'sample',phase:'warm/exit',atUnixMs:104,monoMs:4,collectionMs:4,rows:[],invalidatedRows:[row],counterErrors:[error],lifecycleInvalidations:[],wholeTreeCountersComplete:false},original=JSON.stringify(sample),summary=summarizeMac([sample])['warm/exit'];assert.equal(JSON.stringify(sample),original);assert.equal(summary.counterErrors.length,1);assert.equal(summary.validFullFootprintSamples,0);assert.equal(summary.physicalFootprintBytes.sampledPeak,null);assert(!isCompleteEmptyNativeSample(sample))})
test('A zombie partial observation cannot count as complete empty tree or terminal memory/CPU credit',()=>{const{row,error}=invalidation(),valid={...identity(1,'1700000000000000'),role:'native-app-main',physicalFootprintBytes:1000,residentSizeBytes:2000,cpuNs:100,cpuSource:'PROC_PIDTASKINFO Mach absolute ticks converted with mach_timebase_info',cpuTimebase:{numer:1,denom:1},procTaskInfo:{totalUserMachTicks:100,totalSystemMachTicks:0},pageFaultCount:0,readBytes:0,writeBytes:0},sample={event:'sample',phase:'warm/exit',atUnixMs:104,monoMs:4,collectionMs:4,rows:[valid],invalidatedRows:[row],counterErrors:[],lifecycleInvalidations:[error],wholeTreeCountersComplete:false},summary=summarizeMac([sample])['warm/exit'];assert.equal(summary.validFullFootprintSamples,0);assert.equal(summary.physicalFootprintBytes.sampledPeak,null);assert.equal(summary.invalidatedSampleCount,1);assert.equal(summary.lifecycleInvalidations.length,1);assert.equal(summary.unobservedExitCounterTails[0].terminalCPUObserved,false);assert.equal(summary.cpuMs,0);assert(!isCompleteEmptyNativeSample({...sample,rows:[]}));assert(!Object.hasOwn(summary.identities,row.pid+':'+row.creationUnixUS))})
test('Existing partial counter errors remain byte-equivalent when an immediate zombie proves identity invalidation',()=>{const{row,error}=invalidation();error.stage='identity after counters';error.originalCounterErrors=[{pid:row.pid,stage:'proc_pid_rusage primary footprint/resident/IO',errno:3}];row.cpuNs=99999;row.physicalFootprintBytes=88888;const original=JSON.stringify({row,error});assertConfirmedLifecycleInvalidation(error,row);assert.equal(JSON.stringify({row,error}),original);assert.equal(error.originalCounterErrors.length,1)})
test('Native qualification parser requires original zombie/normal lookup/live control/mismatch and two actual natural reaps',()=>{const proof=nativeQualificationFixture(),original=JSON.stringify(proof);assertNativeZombieQualification(proof);assert.equal(JSON.stringify(proof),original)})
const badQualifications=[
 ['reported failure',p=>{p.passed=false}],
 ['no actual ordinary lookup failure',p=>{p.ordinaryIdentityAtZombie.result=136}],
 ['ordinary lookup permission error',p=>{p.ordinaryIdentityAtZombie.systemErrno=1}],
 ['zombie inferred from NOTE_EXIT instead',p=>{p.zombieCounters.noteExitObserverSupplied=true}],
 ['zombie fixture only ESRCH',p=>{p.zombieCounters.row.identityInvalidation.existenceProbe={result:-1,errno:3,signal:0}}],
 ['invented CPU zero',p=>{p.zombieCounters.row.cpuNs=0}],
 ['primary live-control error',p=>{p.liveControl.errors.push({required:true,stage:'proc_pid_rusage'})}],
 ['live control incorrectly retired',p=>{p.liveControl.row.invalidated=true}],
 ['live control zombie',p=>{p.liveControl.probe.identity.status=5}],
 ['wrong creation granted exit',p=>{p.mismatchedCreationDiagnostic.row.identityInvalidation.lifecycleInvalidation=true}],
 ['wrong creation error omitted',p=>{p.mismatchedCreationDiagnostic.errors=[]}],
 ['control replaced before reap',p=>{p.controlAliveBeforeReap.creationUnixUS='1'}],
 ['control disappeared after reap',p=>{p.controlAliveAfterReap=null}],
 ['unrelated process reaped',p=>{p.naturalReaps[0].pid=99}],
 ['forced exit instead of natural zero',p=>{p.naturalReaps[0].naturalExitCode=-1}],
 ['missing natural reap',p=>{p.naturalReaps.pop()}],
 ['fabricated no-op close result',p=>{p.naturalReaps[0].releasePipeCloseResult=0}],
 ['fabricated no-op close errno',p=>{p.naturalReaps[0].releasePipeErrno=0}],
 ['zombie close falsely repeated',p=>{p.naturalReaps[0].closeAttempted=true}],
 ['control close omitted',p=>{p.naturalReaps[1].closeAttempted=false;p.naturalReaps[1].releasePipeCloseResult=null;p.naturalReaps[1].releasePipeErrno=null}],
 ['actual close without result',p=>{p.naturalReaps[1].releasePipeCloseResult=null}],
 ['failed wait misread as natural zero',p=>{p.naturalReaps[0].waitPIDResult=-1;p.naturalReaps[0].systemErrno=10}],
 ['unvalidated initial wait status',p=>{p.naturalReaps[0].waitStatusValidated=false}],
 ['raw status differs from original buffer',p=>{p.naturalReaps[0].originalWaitStatusBuffer=256}],
 ['zombie counters obtained after reap',p=>{p.naturalReaps[0].atUnixMs=103}],
 ['signal delivered',p=>{p.naturalExitRelease.signalDelivered=true}]
]
for(const[name,mutate]of badQualifications)test('Reject native qualification: '+name,()=>{const proof=nativeQualificationFixture();mutate(proof);assert.throws(()=>assertNativeZombieQualification(proof))})
