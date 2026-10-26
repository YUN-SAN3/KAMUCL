// Qualifies the fixture/observer contract only; native screenshots remain separate.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const{installCapeFixture,cleanupCapeFixture,installCapeUploadObserver,assertCapePresentation,assertCapeViewport,assertCapeMinimum,assertCapeDrag,assertCapeRestoration,decodeCapeReferences,restoreOwnedWinRectangle,makeCapeFixtures,assertCapeForeground}=require('./qa-capes115.cjs')
const channels=['accounts:list','accounts:selected','accounts:select','skin:profile','skin:cape','skin:avatar','skin:history','skin:editorUpload']
function fixture(){
 const originals=new Map(channels.map(channel=>[channel,()=>({original:channel})])),entries=new Map(originals)
 const ipc={_invokeHandlers:entries,removeHandler:channel=>entries.delete(channel),handle:(channel,handler)=>entries.set(channel,(...args)=>handler(...args))}
 const config={profile:'/owned/profile',pid:73,windowId:2,webContentsId:3,token:'owned-token',accounts:[{id:'qa-capes115-A',username:'Synthetic A'},{id:'qa-capes115-B',username:'Synthetic B'}],
  capes:['aurora','hero','twisted','pan','common'].map(name=>({id:'cape-'+name,alias:name,dataUrl:'data:image/png;base64,fixture-'+name,url:'https://public.invalid/'+name+'.png'}))}
 const context=vm.createContext({Date,Map,Promise,uiSkin:'data:image/png;base64,skin',process:{pid:73,mainModule:{require:name=>{assert.equal(name,'node:fs');return{realpathSync:{native:value=>value}}}}},
  testElectron:{app:{getPath:()=>'/owned/profile'},BrowserWindow:{fromId:id=>id===2?{webContents:{id:3}}:null},ipcMain:ipc}})
 const install=value=>vm.runInContext(`(${installCapeFixture.toString()})(${JSON.stringify(value)})`,context)
 return{context,config,entries,originals,install,cleanup:token=>vm.runInContext(`(${cleanupCapeFixture.toString()})(${JSON.stringify(token)})`,context)}
}
test('synthetic initial failure and refresh are explicit IPC observations; activation retains original request account',async()=>{
 const f=fixture();const installed=f.install(f.config);assert.equal(installed.installed,true)
 const failed=f.entries.get('skin:profile')({},false);assert.equal(failed.capes.length,5);assert.equal(failed.capes.filter(c=>c.textureError).length,3)
 const repaired=f.entries.get('skin:profile')({},true);assert(repaired.capes.every(c=>c.dataUrl&&!c.textureError))
 const activated=await f.entries.get('skin:cape')({},'cape-hero');assert.equal(activated.capes.find(c=>c.active).id,'cape-hero')
 const removed=await f.entries.get('skin:cape')({},null);assert(removed.capes.every(c=>!c.active))
 const state=f.context.__qaCapeFixture115;assert.deepEqual(Array.from(state.profiles,row=>row.refresh),[false,true]);assert.equal(state.uploads.length,0)
 const clean=await f.cleanup(f.config.token);assert.equal(clean.complete,true);assert.equal(f.context.__qaCapeFixture115,undefined)
 for(const[channel,original]of f.originals)assert.equal(f.entries.get(channel),original)
})
test('held original response finishes after actual account selection and cleanup cannot swallow pending state',async()=>{
 const f=fixture();f.install(f.config);const state=f.context.__qaCapeFixture115;state.recovered=true;state.deferNext=true
 const request=f.entries.get('skin:cape')({},'cape-aurora');assert.equal(state.snapshot().pending,true)
 f.entries.get('accounts:select')({},f.config.accounts[1].id);assert.equal(f.entries.get('skin:profile')({},false).username,'Synthetic B')
 state.release();const old=await request;assert.equal(old.username,'Synthetic A');assert.equal(state.selected,f.config.accounts[1].id)
 assert(state.changes[0].order<state.selections[0].order&&state.changes[0].returnedOrder>state.selections[0].order)
 state.deferNext=true;const pending=f.entries.get('skin:cape')({},'cape-hero');const cleanup=await f.cleanup(f.config.token);await pending
 assert.equal(cleanup.complete,true);assert.equal(cleanup.final.pending,false)
})
test('foreign profile, native identity, cleanup token and externally changed handler cannot be claimed or overwritten',async()=>{
 for(const change of [{profile:'/foreign/profile'},{pid:74},{windowId:7},{webContentsId:4}]){const f=fixture();assert.throws(()=>f.install({...f.config,...change}),/disposable|another native/);assert.equal(f.entries.size,8)}
 const f=fixture();f.install(f.config);await assert.rejects(f.cleanup('foreign'),/Foreign/)
 const outsider=()=>({foreign:true});f.entries.set('skin:cape',outsider);const cleanup=await f.cleanup(f.config.token)
 assert.equal(cleanup.complete,false);assert.equal(f.entries.get('skin:cape'),outsider);assert.equal(cleanup.rows.find(row=>row.channel==='skin:cape').owned,false)
})
function glFixture(){
 let calls=0,clock=0
 class Canvas{constructor(owned=true){this.width=64;this.height=32;this.owned=owned}closest(){return this.owned?{}:null}getContext(){return{getImageData:()=>({data:new Uint8ClampedArray(64*32*4).fill(87)})}}}
 class GL{constructor(owned=true){this.canvas=new Canvas(owned)}texImage2D(...args){calls++;if(args[0]==='fail')throw Error('original native upload failure');return 'actual return'}texSubImage2D(...args){calls++;return args.length}}
 const originalImage=GL.prototype.texImage2D,originalSub=GL.prototype.texSubImage2D,window={WebGL2RenderingContext:GL}
 const context=vm.createContext({window,HTMLCanvasElement:Canvas,Uint8Array,Set,Promise,performance:{timeOrigin:1,now:()=>++clock},location:{href:'file:///owned/index.html'},document:{hasFocus:()=>true,hidden:false},
  crypto:{subtle:{digest:async(_algorithm,bytes)=>Uint8Array.from(crypto.createHash('sha256').update(bytes).digest()).buffer}}})
 vm.runInContext(`(${installCapeUploadObserver.toString()})()`,context)
 return{context,window,GL,Canvas,originalImage,originalSub,calls:()=>calls}
}
test('GPU observer forwards original call result/error and only records real owned cape sources with original clocks',async()=>{
 const f=glFixture(),owned=new f.GL(),foreign=new f.GL(false),source=new f.Canvas()
 assert.equal(owned.texImage2D('ok',source),'actual return');assert.equal(foreign.texImage2D('ok',source),'actual return');assert.equal(owned.texSubImage2D(1,source),2)
 assert.throws(()=>owned.texImage2D('fail',source),/original native upload failure/)
 const state=await f.window.__qaCapeUploads115.snapshot();assert.equal(f.calls(),4);assert.equal(state.rows.length,3)
 assert.deepEqual(Array.from(state.rows,row=>row.ordinal),[1,2,3]);assert.deepEqual(Array.from(state.rows,row=>row.at),[1,2,3])
 assert(state.rows.every(row=>row.rgbaSha256===crypto.createHash('sha256').update(new Uint8ClampedArray(64*32*4).fill(87)).digest('hex')))
 assert.match(state.rows[2].originalError,/original native upload failure/)
 const restored=await f.window.__qaCapeUploads115.restore();assert.equal(restored.complete,true);assert.equal(f.GL.prototype.texImage2D,f.originalImage);assert.equal(f.GL.prototype.texSubImage2D,f.originalSub)
 assert.equal(f.window.__qaCapeUploads115,undefined)
})
test('GPU observer preserves a foreign replacement and records overflow as failure, without filling original rows',async()=>{
 const foreign=glFixture(),replacement=()=>{};foreign.GL.prototype.texImage2D=replacement
 const cleanup=await foreign.window.__qaCapeUploads115.restore();assert.equal(cleanup.complete,false);assert.equal(foreign.GL.prototype.texImage2D,replacement)
 const f=glFixture(),gl=new f.GL(),image=new f.Canvas();for(let i=0;i<257;i++)gl.texImage2D('ok',image)
 const raw=await f.window.__qaCapeUploads115.snapshot();assert.equal(raw.rows.length,256);assert.match(raw.errors[0],/overflowed/);assert.equal(f.calls(),257)
 const restored=await f.window.__qaCapeUploads115.restore();assert.equal(restored.complete,false)
})
function presentation(){
 const cape={id:'cape-pan',alias:'Pan',dataUrlSha256:'original-data-url-sha',atlas:{width:64,height:32,rgbaSha256:'original-rgba-sha'},thumbnail:{rgbaSha256:'independent-crop-sha'}},expected={theme:'transparent',timeOrigin:123,url:'file:///owned/index.html',username:'Synthetic A',activeId:cape.id,capes:[cape]}
 const state={mounted:true,theme:expected.theme,timeOrigin:123,url:expected.url,focus:true,hidden:false,readyState:'complete',username:expected.username,
  rows:[{alias:'Pan',active:true,image:{complete:true,width:100,height:160,rgbaSha256:'independent-crop-sha'},error:''}],viewer:{count:1,fallback:false,empty:false,capeSha256:cape.dataUrlSha256,canvas:{width:100,height:100,lost:false}},
  uploads:{errors:[],rows:[{ordinal:2,width:64,height:32,rgbaSha256:cape.atlas.rgbaSha256,originalError:null,timeOrigin:123,url:expected.url,focus:true,hidden:false}]}}
 return{state,expected}
}
test('presentation requires decoded thumbnails, actual viewer source and fresh matching RGBA upload under the same document',()=>{
 const{state,expected}=presentation();assert.equal(assertCapePresentation(state,expected,{uploadAfter:1}),true)
 for(const corrupt of [value=>value.rows[0].image.complete=false,value=>value.rows[0].image.width=0,value=>value.rows[0].image.rgbaSha256='other-crop',value=>value.viewer.capeSha256='stale',
  value=>value.uploads.rows[0].rgbaSha256='other',value=>value.uploads.rows[0].ordinal=1,value=>value.uploads.rows[0].timeOrigin=999,
  value=>value.uploads.rows[0].originalError='native error',value=>value.viewer.canvas.lost=true,value=>value.theme='other',value=>value.focus=false]){
  const invalid=structuredClone(state);corrupt(invalid);assert.throws(()=>assertCapePresentation(invalid,expected,{uploadAfter:1}))
 }
 const empty=structuredClone(state);empty.rows[0].active=false;empty.viewer.empty=true;assert.equal(assertCapePresentation(empty,{...expected,activeId:null}),true)
})
test('independent browser reference decodes the frozen source before any product or GL ledger and records pixel differences',async()=>{
 const drawCalls=[],source='data:image/png;base64,synthetic',thumbnail='data:image/png;base64,thumbnail'
 class Image{async decode(){this.width=this.src===thumbnail?100:64;this.height=this.src===thumbnail?160:32}}
 class Canvas{getContext(){return{drawImage:(...args)=>drawCalls.push(args),getImageData:()=>({data:new Uint8ClampedArray(this.width*this.height*4).fill(87)})}}toDataURL(){return thumbnail}}
 const context=vm.createContext({Image,document:{createElement:tag=>{assert.equal(tag,'canvas');return new Canvas()}},Uint8Array,Uint8ClampedArray,TextEncoder,atob,performance:{timeOrigin:7,now:()=>123},location:{href:'file:///owned'},crypto:{subtle:{digest:async(_algorithm,bytes)=>Uint8Array.from(crypto.createHash('sha256').update(bytes).digest()).buffer}}})
 const cape={id:'public-fixture',dataUrl:source,width:64,height:32,sharpRgbaBase64:Buffer.alloc(64*32*4,87).toString('base64'),sharpAtlasSha256:'frozen-sharp-sha'}
 const run=config=>vm.runInContext(`(${decodeCapeReferences.toString()})(${JSON.stringify(config)})`,context),rows=await run([cape])
 assert.equal(rows.length,1);assert.equal(rows[0].sourceDataUrlSha256,crypto.createHash('sha256').update(source).digest('hex'));assert.equal(rows[0].differences.differentPixels,0)
 assert.equal(rows[0].atlas.width,64);assert.equal(rows[0].atlas.height,32);assert.equal(rows[0].thumbnail.rgbaSha256,crypto.createHash('sha256').update(Buffer.alloc(100*160*4,87)).digest('hex'))
 assert.deepEqual(Array.from(drawCalls[1]).slice(1),[1,1,10,16,0,0,100,160]);assert.equal(rows[0].timeOrigin,7);assert.match(rows[0].classification,/before product activation/)
 await assert.rejects(run([{...cape,width:65}]),/dimensions changed/);await assert.rejects(run([{...cape,sharpRgbaBase64:'AA=='}]),/byte count changed/)
})
test('Win32 restoration uses only the exact owned HWND and original AsReported rectangle in an unchanged query context',()=>{
 const original={handleBytes:'0700000000000000',pid:73,queryDpiContext:'same-context',queryDpiAwareness:0,windowRectAsReported:{left:10,top:20,right:900,bottom:600}},calls=[]
 const current=()=>({...original,windowRectAsReported:{left:30,top:40,right:500,bottom:400}})
 const context=vm.createContext({assert,Buffer,winRestoreAPI:undefined,require:name=>{if(name==='./qa-privacy-categories115.cjs')return{readOwnedWinClient:(handle,pid)=>{assert.equal(handle,original.handleBytes);assert.equal(pid,73);return current()}};assert.equal(name,'koffi');return{load:()=>({func:()=>{return(...args)=>{calls.push(args);return true}}})}}})
 const run=value=>vm.runInContext(`(${restoreOwnedWinRectangle.toString()})(${JSON.stringify(value)})`,context)
 const result=run(original);assert.equal(result.flags,0x14);assert.deepEqual(Array.from(calls[0]),[7n,0,10,20,890,580,0x14]);assert.match(result.classification,/not claimed physical pixels/)
 assert.throws(()=>run({...original,queryDpiContext:'foreign-context'}));assert.equal(calls.length,1)
 assert.throws(()=>run({...original,pid:74}));assert.equal(calls.length,1)
})
test('explicit preserved public fixture mode refuses changed original bytes and never silently falls back to network',async()=>{
 const temp=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'KAMUCL-cape-fixture-contract-'))),output=path.join(temp,'output'),previous=process.env.KAMUCL_CAPE_PUBLIC_FIXTURE_ROOT,originalFetch=global.fetch;let requests=0
 fs.mkdirSync(output);fs.writeFileSync(path.join(temp,'mojang_cape.png'),Buffer.from('changed public original'))
 process.env.KAMUCL_CAPE_PUBLIC_FIXTURE_ROOT=temp;global.fetch=()=>{requests++;throw Error('Unexpected network fallback')}
 try{await assert.rejects(makeCapeFixtures(output),/Preserved public original bytes changed/);assert.equal(requests,0);assert.equal(fs.readdirSync(output).length,0)}
 finally{global.fetch=originalFetch;if(previous===undefined)delete process.env.KAMUCL_CAPE_PUBLIC_FIXTURE_ROOT;else process.env.KAMUCL_CAPE_PUBLIC_FIXTURE_ROOT=previous;const checked=fs.realpathSync.native(temp);assert.equal(checked,temp);assert(path.basename(checked).startsWith('KAMUCL-cape-fixture-contract-'));assert.equal(path.dirname(checked),fs.realpathSync.native(os.tmpdir()));fs.rmSync(checked,{recursive:true,force:true})}
})
test('real viewer drag requires the original trusted pointer sequence under the exact document and actual canvas bounds',()=>{
 const expected={selector:'.owned-viewer',timeOrigin:123,url:'file:///owned'},bounds={x:10,y:20,width:300,height:200},observation={...expected,overflow:false,records:['pointerdown','pointerup'].map((type,index)=>({type,isTrusted:true,matchesSelector:true,timeOrigin:123,url:'file:///owned',at:10+index,x:30+index*200,y:100,renderer:{hasFocus:true,hidden:false}}))}
 assert.equal(assertCapeDrag(observation,expected,bounds),true)
 for(const corrupt of [o=>o.records.pop(),o=>o.records[0].isTrusted=false,o=>o.records[0].matchesSelector=false,o=>o.records[1].timeOrigin=124,o=>o.records[1].x=999,o=>o.records[1].renderer.hasFocus=false,o=>o.overflow=true]){const invalid=structuredClone(observation);corrupt(invalid);assert.throws(()=>assertCapeDrag(invalid,expected,bounds))}
})
test('restoration requires the exact original native, renderer and Win32 AsReported snapshots, including an original quantized mapping difference',()=>{
 const native={pid:7,windowId:2,webContentsId:3,zoom:1,maximized:false,minimumSize:[960,620],focused:true,visible:true,minimized:false,appHidden:false,bounds:{x:10,y:20,width:1362,height:863},contentBounds:{x:10,y:20,width:1361,height:862}},renderer={width:1362,height:862,pixelRatio:1.25,url:'file:///owned',theme:'transparent',readyState:'complete',focus:true,hidden:false},win32={pid:7,queryDpiContext:'original-context',queryDpiAwareness:0,dpi:120,windowRectAsReported:{left:5,top:20,right:1380,bottom:889},clientRectAsReported:{left:0,top:0,right:1360,bottom:861}}
 const value={native:structuredClone(native),renderer:{...renderer},win32:structuredClone(win32)};assert.equal(assertCapeRestoration(value,native,renderer,win32),true)
 for(const corrupt of [v=>v.native.contentBounds.width=1362,v=>v.renderer.width=1361,v=>v.renderer.pixelRatio=1,v=>v.win32.windowRectAsReported.right++,v=>v.win32.clientRectAsReported.bottom++,v=>v.win32.queryDpiContext='foreign',v=>v.native.focused=false]){const invalid=structuredClone(value);corrupt(invalid);assert.throws(()=>assertCapeRestoration(invalid,native,renderer,win32))}
})
test('original minimum must remain unchanged and actual native content must exactly map to renderer, without requested-size substitution',()=>{
 const minimum=[960,620],native={pid:7,windowId:2,webContentsId:3,bounds:{x:10,y:20,width:962,height:623},contentBounds:{x:10,y:20,width:961,height:622},minimumSize:minimum,zoom:1.25,visible:true,minimized:false,focused:true,appHidden:false}
 const renderer={timeOrigin:123,url:'file:///owned',width:769,height:498,theme:'transparent',focus:true,hidden:false}
 assert.equal(assertCapeViewport(native,renderer,'transparent',minimum),true)
 const scene={originalMinimumSize:minimum,requestedContent:{width:2,height:2},repeatRequestedContent:{width:1,height:1},first:{native,renderer},second:{native:structuredClone(native),renderer:{...renderer}}}
 assert.equal(assertCapeMinimum(scene,'transparent'),true)
 for(const corrupt of [n=>n.contentBounds.width=959,n=>n.contentBounds.height=619,n=>n.zoom=1,n=>n.focused=false,n=>n.visible=false,n=>n.appHidden=true,n=>n.bounds.width=959,n=>n.minimumSize=[962,620]]){
  const invalid=structuredClone(native);corrupt(invalid);assert.throws(()=>assertCapeViewport(invalid,renderer,'transparent',minimum))
 }
 for(const corrupt of [r=>r.width=768,r=>r.height=496,r=>r.focus=false,r=>r.hidden=true,r=>r.theme='other']){
  const invalid={...renderer};corrupt(invalid);assert.throws(()=>assertCapeViewport(native,invalid,'transparent',minimum))
 }
 for(const corrupt of [s=>s.second.native.pid=8,s=>s.second.native.bounds.x=11,s=>s.second.native.contentBounds.width=962,s=>s.second.renderer.timeOrigin=124,s=>s.repeatRequestedContent.width=2]){const invalid=structuredClone(scene);corrupt(invalid);assert.throws(()=>assertCapeMinimum(invalid,'transparent'))}
})

test('native foreground requires exact real HWND/PID, visibility and per-monitor context, rather than emulated logical focus',()=>{
 const binding={pid:73},sample={hwnd:7,foreground:7,ownerPid:73,foregroundPid:73,visible:true,minimized:false,focused:true,dpiAwareness:2,observedAt:123}
 assert.equal(assertCapeForeground(sample,binding),true)
 for(const patch of [{foreground:8},{foregroundPid:74},{ownerPid:74},{visible:false},{minimized:true},{focused:false},{dpiAwareness:0},{hwnd:0},{observedAt:NaN}])assert.throws(()=>assertCapeForeground({...sample,...patch},binding))
})

test('shared native observation preserves a foreign foreground and hidden state without focusing or modifying windows',()=>{
 const {observeOwned}=require('./qa-native-window115.cjs'),binding={pid:73,windowId:2,webContentsId:3},queries=[]
 const api={
  'uintptr __stdcall GetForegroundWindow()':()=>8,
  GetWindowThreadProcessId:(hwnd,out)=>{queries.push(hwnd);out[0]=hwnd===7?73:74;return 3},
  'uint32 __stdcall GetDpiForWindow(uintptr)':()=>120,
  'intptr __stdcall GetThreadDpiAwarenessContext()':()=>-4,
  'int __stdcall GetAwarenessFromDpiAwarenessContext(intptr)':()=>2
 },k={out:value=>value,pointer:value=>value,load:()=>({func:name=>{assert(Object.hasOwn(api,name),'No focus/mutation Win32 function allowed');return api[name]}})},w={webContents:{id:3},getNativeWindowHandle:()=>Buffer.from('0700000000000000','hex'),isVisible:()=>false,isMinimized:()=>true,isFocused:()=>true}
 const context=vm.createContext({Buffer,Date,process:{pid:73,mainModule:{require:file=>{assert.equal(file,'owned-koffi');return k}}},testElectron:{BrowserWindow:{fromId:id=>id===2?w:null}}})
 const observe=value=>vm.runInContext(`(${observeOwned.toString()})(${JSON.stringify(value)},'owned-koffi')`,context),result=observe(binding)
 assert.equal(result.hwnd,7);assert.equal(result.foreground,8);assert.equal(result.ownerPid,73);assert.equal(result.foregroundPid,74);assert.equal(result.visible,false);assert.equal(result.minimized,true);assert.equal(result.focused,true);assert.equal(result.dpiContext,'-4');assert.deepEqual(queries,[7,8]);assert.throws(()=>assertCapeForeground(result,binding))
 for(const patch of [{pid:74},{windowId:4},{webContentsId:4}])assert.throws(()=>observe({...binding,...patch}),/unowned/)
})
