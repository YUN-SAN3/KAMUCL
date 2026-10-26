const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm')
const source=fs.readFileSync(path.join(__dirname,'qa-native-mac120.cjs'),'utf8')
function fixture(t,{platform='darwin',arch='arm64',ci='true'}={}){
 const temporary=fs.realpathSync.native(os.tmpdir()),root=fs.realpathSync.native(fs.mkdtempSync(path.join(temporary,'qa-native-mac120-'))),profile=path.join(root,'profile');assert.equal(path.dirname(root),temporary);assert(path.basename(root).startsWith('qa-native-mac120-'));fs.mkdirSync(profile);t.after(()=>{assert.equal(path.dirname(root),temporary);assert(path.basename(root).startsWith('qa-native-mac120-'));fs.rmSync(root,{recursive:true,force:true})})
 const calls=[],requests=[],binding={pid:402,windowId:2,webContentsId:3},proof={};let nativePatch={},throwNative=false
 const state={...binding,ppid:401,profile,executable:path.join(root,'Actual App','KAMUCL'),bounds:{x:5,y:10,width:960,height:620},contentBounds:{x:5,y:10,width:960,height:620},zoom:1.25,visible:true,focused:true,minimized:false,appHidden:false}
 const execFileSync=(command,args,options)=>{calls.push({command,args,options});if(command==='/usr/bin/xcrun'){fs.writeFileSync(args.at(-1),'contract-only compiled helper fixture');return ''}if(command==='/usr/bin/codesign')return '';const request=JSON.parse(fs.readFileSync(args[0]));requests.push(request);if(throwNative){const e=Error('Actual helper rejected request');e.stdout=Buffer.from('{"complete":false,"error":"owned identity changed"}');throw e}return JSON.stringify({complete:true,identityStable:true,ownerPID:402,frontmostPID:402,creationUnixUS:'1791395012345678',id:7,...nativePatch})}
 const module={exports:{}},context=vm.createContext({module,exports:module.exports,__dirname,process:{platform,arch,env:{GITHUB_ACTIONS:ci}},require:name=>name==='node:child_process'?{execFileSync}:require(name)})
 vm.runInContext(source,context,{filename:'qa-native-mac120.cjs'})
 const h={root,profile,ownedTrack:{pid:401},main:async expression=>expression.includes('contentBounds:')?structuredClone(state):true}
 return{api:module.exports,h,binding,proof,root,state,calls,requests,nativePatch:value=>nativePatch=value,throwNative:()=>throwNative=true,create:()=>module.exports.create(h,proof,root,binding)}
}
test('Mac native QA adapter compiles once and records exact owned helper identity without HWND substitution',async t=>{
 const f=fixture(t),a=await f.create(),b=await f.create();assert.equal(f.calls.filter(c=>c.command==='/usr/bin/xcrun').length,1)
 const compile=f.calls[0];assert(compile.args.includes('arm64-apple-macos13.0'));assert.equal(compile.options.timeout,60000);assert(f.calls.every(c=>c.options.windowsHide===true))
 const observed=await a.observe();assert.equal(observed.native.id,7);assert.equal(observed.pid,402);assert.equal(observed.foregroundPid,402);assert(!Object.hasOwn(observed,'hwnd'));assert(!Object.hasOwn(observed,'foreground'))
 await b.observe();assert.equal(f.requests[0].creationUnixUS,null);assert.equal(f.requests[1].creationUnixUS,'1791395012345678');assert.equal(f.proof.macNativeActions.length,2);assert(/^[a-f0-9]{64}$/.test(f.proof.macNativeAdapter.sourceSHA256));assert(f.calls.every(c=>c.options.windowsHide===true))
})
test('Mac native QA rejects foreign frontmost process rather than refocusing it',async t=>{const f=fixture(t),a=await f.create();f.nativePatch({frontmostPID:777});await assert.rejects(a.observe(),/frontmost process changed/);assert.deepEqual(f.requests.map(r=>r.kind),['observe'])})
test('Mac native QA pins actual process creation against later PID reuse',async t=>{const f=fixture(t),a=await f.create();await a.observe();f.nativePatch({creationUnixUS:'1791395012345679'});await assert.rejects(a.observe(),/PID creation must remain fixed/)})
test('Mac native QA rejects a different process owner from the original helper',async t=>{const f=fixture(t),a=await f.create();f.nativePatch({ownerPID:999});await assert.rejects(a.observe())})
test('Mac native QA rejects foreign profile and wrapper identity before native input',async t=>{
 const f=fixture(t),a=await f.create();f.state.profile=f.root;await assert.rejects(a.zoomKey('-'));assert.equal(f.requests.length,0)
 f.state.profile=f.h.profile;f.state.ppid=999;await assert.rejects(a.click({x:2,y:2}));assert.equal(f.requests.length,0)
})
test('Read-only hidden-window inspect stays distinct from foreground acceptance',async t=>{
 const f=fixture(t),a=await f.create();f.state.visible=false;f.state.focused=false;f.state.appHidden=true;f.nativePatch({frontmostPID:999,id:undefined,ownedWindowInventory:[]})
 const observation=await a.inspect();assert.equal(observation.kind,'inspect');assert.equal(observation.foregroundPid,999);assert.equal(observation.visible,false);assert.equal(f.requests[0].kind,'inspect');await assert.rejects(a.observe())
})
test('Owned native zoom request uses pinned PID and guards before and after delivery',async t=>{
 const f=fixture(t),a=await f.create();await a.zoomKey('-');assert.deepEqual(f.requests.map(r=>r.kind),['observe','key','observe']);assert.equal(f.requests[1].key,'-');assert.equal(f.requests[1].pid,402);assert.equal(f.requests[1].creationUnixUS,'1791395012345678');assert.equal(f.requests[1].zoom,1.25);assert.deepEqual(f.requests[1].contentBounds,f.state.contentBounds)
 await assert.rejects(a.zoomKey('+'));assert.equal(f.requests.length,3)
})
test('Owned native click receives measured CSS point and content mapping, never foreign global coordinates',async t=>{
 const f=fixture(t),a=await f.create();await a.click({x:400,y:200});assert.deepEqual(f.requests.map(r=>r.kind),['observe','click']);assert.deepEqual(f.requests[1].point,{x:400,y:200});assert.equal(f.requests[1].zoom,1.25);assert.deepEqual(f.requests[1].bounds,f.state.bounds);await assert.rejects(a.click({x:NaN,y:0}))
})
test('Native helper failure retains original stdout without accepting the action',async t=>{const f=fixture(t),a=await f.create();f.throwNative();await assert.rejects(a.observe(),/helper rejected/);assert.equal(f.proof.macNativeActions.length,1);assert.equal(JSON.parse(f.proof.macNativeActions[0].originalStdout).complete,false)})
test('Native successful helper stdout and exact request bytes survive independently of parsed proof',async t=>{const f=fixture(t),a=await f.create();await a.zoomKey('-');const receipts=f.proof.macNativeRawReceipts;assert.equal(receipts.length,6);const digest=require('node:crypto');for(const row of receipts){const bytes=fs.readFileSync(path.join(f.root,row.file));assert.equal(bytes.length,row.bytes);assert.equal(digest.createHash('sha256').update(bytes).digest('hex'),row.sha256)}const key=receipts.find(row=>row.kind==='key'&&row.file.endsWith('request.json'));assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,key.file))).key,'-');assert.equal(receipts.filter(r=>r.file.endsWith('stdout.json')).length,3)})
test('Native failed helper raw stdout is retained even when no parsed identity is accepted',async t=>{const f=fixture(t),a=await f.create();f.throwNative();await assert.rejects(a.observe());const raw=f.proof.macNativeRawReceipts.find(row=>row.file.endsWith('stdout-error.log'));assert(raw);assert.equal(fs.readFileSync(path.join(f.root,raw.file),'utf8'),'{"complete":false,"error":"owned identity changed"}');assert.equal(f.proof.macNativeActions[0].actual,undefined)})
test('independent native bridges sharing the actual screenshot directory retain distinct immutable receipt files',async t=>{const first=fixture(t),second=fixture(t),a=await first.create();await a.observe();const original=first.proof.macNativeRawReceipts.map(row=>({file:row.file,bytes:fs.readFileSync(path.join(first.root,row.file))}));const b=await second.api.create(second.h,second.proof,first.root,second.binding);await b.observe();assert.notEqual(first.proof.macNativeAdapter.receiptNamespace,second.proof.macNativeAdapter.receiptNamespace);for(const row of original){assert.deepEqual(fs.readFileSync(path.join(first.root,row.file)),row.bytes);assert(!second.proof.macNativeRawReceipts.some(r=>r.file===row.file))}assert.equal(first.proof.macNativeRawReceipts.length,2);assert.equal(second.proof.macNativeRawReceipts.length,2)})
test('Mac native adapter does not request permissions or run on a foreign platform/architecture',async t=>{
 for(const value of [{platform:'win32'},{arch:'x64'},{ci:'false'}]){const f=fixture(t,value);await assert.rejects(f.create());assert.equal(f.calls.length,0)}
})
