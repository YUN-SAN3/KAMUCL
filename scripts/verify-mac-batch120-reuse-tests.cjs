const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const {SOURCE,ASSETS,validateQaPaths,proveReuseSource,verifyManifest,originalPackageFiles}=require('./verify-mac-batch120-reuse.cjs'),{bindRenderer,DOWNLOAD_BUTTON,DOWNLOAD_MASK,backdropExpression,backdropReady}=require('./verify-mac-batch120.cjs')
const qa='a'.repeat(40)
function executor({paths='',dirty='',head=qa}={}){return(_file,args)=>args[0]==='rev-parse'?head:args[0]==='status'?dirty:args[0]==='diff'?paths:assert.fail('Unexpected git action')}
test('QA-only comparison accepts exact declared QA files and records distinct original/QA sources',()=>{
 const result=proveReuseSource(SOURCE,qa,{execute:executor({paths:'scripts/verify-mac-batch120.cjs\0scripts/qa-download-status120.cjs\0'})});assert.equal(result.artifactSourceCommit,SOURCE);assert.equal(result.qaSourceCommit,qa);assert.equal(result.changedPaths.length,2)
})
test('any production, version, runtime, renderer, native or unrelated QA path rejects reuse',()=>{
 for(const file of ['src/main/core/download.ts','src/renderer/src/App.vue','native/game.swift','package.json','package-lock.json','electron.vite.config.ts','.github/workflows/mac-build.yml','docs/other.md'])assert.throws(()=>validateQaPaths([file]),/forbidden path/)
 assert.throws(()=>validateQaPaths(['scripts/verify-mac-batch120.cjs','scripts/verify-mac-batch120.cjs']),/Duplicate/)
})
test('dirty tracked checkout, a changed QA HEAD or another artifact source rejects before native execution',()=>{
 assert.throws(()=>proveReuseSource(SOURCE,qa,{execute:executor({dirty:' M src/main/index.ts'})}),/Tracked checkout/)
 assert.throws(()=>proveReuseSource(SOURCE,qa,{execute:executor({head:'b'.repeat(40)})}),/QA HEAD/)
 assert.throws(()=>proveReuseSource('b'.repeat(40),qa,{execute:executor()}))
})
function originalManifest(){const identity={schemaVersion:1,product:'KAMUCL',platform:'darwin',version:'1.1.20',arch:'arm64',sourceCommit:SOURCE,runtimeVersion:'44.3.0',minimumSystemVersion:'13.0.0',appAsarSHA256:'75eb10c3394ee2bc1f8578dc2572ffa979c120a8369f92ebc4251b68de652ecf',signing:'ad-hoc; not Developer ID or notarized'};return{version:'1.1.20',arch:'arm64',commit:SOURCE,runtimeVersion:'44.3.0',frameworkVersion:'44.3.0',minimum:'13.0.0',signing:'ad-hoc; not Developer ID or notarized',packageIntegrity:true,nativeAcceptance:'separate required native APP/DMG/game/tools/update jobs',appAsarSHA256:identity.appAsarSHA256,buildIdentity:identity,buildIdentitySHA256:'9bb2d5deb580ac69c710486984b119eedb61b013651f24a22969adb00e38cc52',assets:ASSETS}}
test('original native package manifest preserves exact raw SHA, source, runtime, ABI and ZIP/DMG hashes',()=>{const original=originalManifest();assert.deepEqual(verifyManifest(Buffer.from(JSON.stringify(original,null,2))),original)})
test('actual artifact-ids directory layout locates the original manifest and both assets; flat unrelated files cannot replace it',()=>{
 const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'mac-reuse120-')))
 try{fs.writeFileSync(path.join(root,'mac-package-arm64.json'),'unrelated flat manifest');assert.throws(()=>originalPackageFiles(root),/ENOENT/);const directory=path.join(root,'mac-packages-arm64');fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'mac-package-arm64.json'),JSON.stringify(originalManifest(),null,2));for(const a of ASSETS)fs.writeFileSync(path.join(directory,a.name),'artifact layout fixture; not package bytes')
  const files=originalPackageFiles(root);assert.equal(files.manifest,path.join(directory,'mac-package-arm64.json'));assert.deepEqual(verifyManifest(fs.readFileSync(files.manifest)),originalManifest());assert.equal(files.zip,path.join(directory,ASSETS[0].name));assert.equal(files.dmg,path.join(directory,ASSETS[1].name));fs.unlinkSync(files.dmg);assert.throws(()=>originalPackageFiles(root),/ENOENT/)
 }finally{assert.equal(path.dirname(root),fs.realpathSync.native(os.tmpdir()));assert(path.basename(root).startsWith('mac-reuse120-'));fs.rmSync(root,{recursive:true,force:true})}
})
test('semantically similar or modified manifest cannot authorize altered/rebuilt artifacts',()=>{
 const value=originalManifest();assert.throws(()=>verifyManifest(Buffer.from(JSON.stringify(value))),/manifest SHA/)
 value.assets=[{...value.assets[0],sha256:'0'.repeat(64)},value.assets[1]];assert.throws(()=>verifyManifest(Buffer.from(JSON.stringify(value,null,2))),/manifest SHA/)
})
test('actual QA binding waits for committed URL and captures original uncommitted inventory',async()=>{
 const rows=[];let next=0;const expected={pid:12,windowId:13,webContentsId:14};assert.deepEqual(await bindRenderer(async()=>++next===1?{appReady:true,windows:[{windowId:13,url:'',role:'uncommitted',opacity:0}],matches:0,binding:null}:{appReady:true,windows:[{windowId:13,url:'file:///owned/renderer/index.html',role:'main-renderer',visible:true,opacity:1}],matches:1,binding:expected},row=>rows.push(row),async()=>{}),expected);assert.equal(rows.length,2);assert.equal(rows[0].windows[0].role,'uncommitted')
})
test('native batch binding observes natural visibility and splash removal before a focus request',async()=>{
 const rows=[],binding={pid:12},main={role:'main-renderer',visible:true,opacity:1};let next=0
 assert.equal(await bindRenderer(async()=>({appReady:true,matches:1,binding,windows:++next===1?[{...main,visible:false}]:next===2?[main,{role:'startup-splash',visible:true,opacity:1}]:[main]}),row=>rows.push(row),async()=>{}),binding);assert.equal(rows.length,3)
})
test('download QA addresses semantic home button and observes the uncovered real backdrop point',()=>{
 assert.equal(DOWNLOAD_BUTTON,'[data-ui="App:50549c4d6612"][title="下载中心"]');assert.equal(DOWNLOAD_MASK,'[data-ui="App:32e6a4482be2"]');assert(backdropExpression(DOWNLOAD_MASK).includes('x=r.x+r.width*.05,y=r.y+r.height*.9'))
 const expected={pid:1,windowId:2,webContentsId:3,timeOrigin:10,url:'file:///renderer/index.html'},row={native:{...expected,visible:true,minimized:false,focused:true,appHidden:false,bounds:{x:0,y:0,width:960,height:620},contentBounds:{x:0,y:0,width:960,height:600},zoom:1.25},coordinate:{hit:true,x:768*.05,y:480*.9,bounds:{x:0,y:0,width:768,height:480},ancestorsVisible:true,runningAnimations:0,absent:true,renderer:{width:768,height:480,hasFocus:true,hidden:false,ready:'complete',pixelRatio:2,timeOrigin:10,url:expected.url}}}
 assert.equal(backdropReady(row,row,expected),true);assert.equal(backdropReady({...row,coordinate:{...row.coordinate,hit:false}},row,expected),false);assert.equal(backdropReady({...row,coordinate:{...row.coordinate,x:384,y:240}},row,expected),false)
})
test('duplicate renderer fails immediately; absent renderer rejects within unchanged bounded readiness',async()=>{
 let waits=0;await assert.rejects(bindRenderer(async()=>({appReady:true,windows:[],matches:2}),()=>{},async()=>{waits++}),/More than one/);assert.equal(waits,0)
 await assert.rejects(bindRenderer(async()=>({appReady:true,windows:[],matches:0}),()=>{},async()=>new Promise(resolve=>setTimeout(resolve,3)),5),/did not become ready/)
})
test('read-only boot instrumentation cannot restart or extend the original ten-second binding budget',async()=>{let reads=0;await assert.rejects(bindRenderer(async()=>{reads++;return{appReady:true,matches:1,windows:[{role:'main-renderer',visible:true,opacity:1}],binding:{pid:12}}},()=>{},async()=>{},10000,Date.now()-10001),/within 10000 ms/);assert.equal(reads,0)})
test('native batch navigation opens the actual closed resource group through the same trusted coordinate before its child',async()=>{const{createBatchNavigation}=require('./verify-mac-batch120.cjs'),clicks=[],checks=[];let foreground=0;const nav=createBatchNavigation({click:async selector=>clicks.push(selector),evaluate:async()=>true,until:async(label,expression,predicate)=>{checks.push({label,expression});assert(predicate(require('./verify-mac-parity-ui.cjs').ROUTE_COMPONENTS.mods))},foreground:async()=>{foreground++}});await nav('mods');assert.deepEqual(clicks,['[data-nav=resources]','[data-nav=mods]']);assert.equal(checks[0].label,'actual route mods');assert.equal(foreground,1)})
test('native batch navigation preserves an already-expanded resource group and refuses a failed parent coordinate',async()=>{const{createBatchNavigation}=require('./verify-mac-batch120.cjs'),clicks=[];const ready={evaluate:async()=>false,until:async()=>{},foreground:async()=>{}};await createBatchNavigation({...ready,click:async selector=>clicks.push(selector)})('mods');assert.deepEqual(clicks,['[data-nav=mods]']);clicks.length=0;await assert.rejects(createBatchNavigation({...ready,evaluate:async()=>true,click:async selector=>{clicks.push(selector);throw Error('Original trusted parent coordinate rejected')}})('mods'),/Original trusted parent/);assert.deepEqual(clicks,['[data-nav=resources]']);await assert.rejects(createBatchNavigation({...ready,click:async()=>assert.fail('no unknown input')})('foreign'),/Unknown native QA route/)})
