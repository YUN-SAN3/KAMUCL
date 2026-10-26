// QA contract tests only: synthetic IPC/DOM scheduling, not native acceptance.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const helper=require('../scripts/skin-upload-readiness-119.cjs');
const source=fs.readFileSync(path.resolve(__dirname,'../scripts/verify-extension-ui.cjs'),'utf8');
const block=source.slice(source.indexOf(" const uploadQA=require('./skin-upload-readiness-119.cjs')"),source.indexOf(" await clickText('.skin-editor','背面')"));
const readySource=source.slice(source.indexOf(' const ready=async('),source.indexOf(' const clickText='));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function syntheticFlow(mode='success') {
 let now=1000,pending,secondStarted,clockSamples=[];
 const state={modal:false,busy:false,error:'',profileRefreshAt:null},readiness=[];
 const ipc=new EventEmitter();ipc._invokeHandlers=new Map();ipc.handle=(name,handler)=>{if(ipc._invokeHandlers.has(name))throw Error('duplicate handler');ipc._invokeHandlers.set(name,handler)};ipc.removeHandler=name=>ipc._invokeHandlers.delete(name);
 // Execute the actual project's handle wrapper, not an unwrapped fake registry.
 const wrapperSource=fs.readFileSync(path.resolve(__dirname,'../src/main/ipc.ts'),'utf8'),wrapperStart=wrapperSource.indexOf('  patchedMain.handle = (channel, listener) => {'),wrapperEnd=wrapperSource.indexOf('  // 联机三通道',wrapperStart);
 assert(wrapperStart>=0&&wrapperEnd>wrapperStart,'actual project IPC logging wrapper must be modeled');
 const logging=[],originalCalls=[],originalResult={production:true},originalError=Error('original handler rejection');
 const wrapperContext=vm.createContext({patchedMain:ipc,rawHandle:ipc.handle.bind(ipc),isCancelError:()=>false,errText:String,launcherLogDebug:(...args)=>logging.push(args),launcherLogError:(...args)=>logging.push(args)});
 vm.runInContext(wrapperSource.slice(wrapperStart,wrapperEnd),wrapperContext);
 const originalUploadHandler=(event,...args)=>{originalCalls.push({channel:'upload',event,args});if(args[0]==='reject')throw originalError;return originalResult},originalProfileHandler=(event,...args)=>{originalCalls.push({channel:'profile',event,args});if(args[0]==='reject')throw originalError;return originalResult};
 ipc.handle('skin:editorUpload',originalUploadHandler);ipc.handle('skin:profile',originalProfileHandler);
 const originalUpload=ipc._invokeHandlers.get('skin:editorUpload'),originalProfile=ipc._invokeHandlers.get('skin:profile');
 const wc={},productionBusy=[];const productionListener=(event,value)=>{productionBusy.push(value)};ipc.on('window:skinEditorBusy',productionListener);
 const context=vm.createContext({globalThis:null,Date:{now:()=>now},testElectron:{ipcMain:ipc,BrowserWindow:{getAllWindows:()=>[{webContents:wc}]}},uiAccount:{username:'synthetic fixture'},uiSkin:'synthetic fixture'});context.globalThis=context;
 let foreignUpload,foreignProfile,foreignBusy;
 const main=async expression=>{
  if(expression.includes('function cleanupUploadFixture')&&mode.startsWith('foreign-')){
   if(mode==='foreign-upload'||mode==='foreign-both'){foreignUpload=()=>({foreign:'upload'});ipc._invokeHandlers.set('skin:editorUpload',foreignUpload)}
   if(mode==='foreign-profile'||mode==='foreign-both'){foreignProfile=()=>({foreign:'profile'});ipc._invokeHandlers.set('skin:profile',foreignProfile)}
   if(mode==='foreign-busy'){foreignBusy=()=>{};ipc.on('window:skinEditorBusy',foreignBusy)}
  }
  return vm.runInContext(expression,context);
 };
 const button=(text,disabled=false,inert=false)=>({textContent:text,disabled,closest:()=>inert?{}:null,getClientRects:()=>[{}]});
 const dom={body:{get innerText(){return state.error}},visibilityState:'visible',querySelector(selector){
  if(selector==='.skin-editor')return {inert:state.modal,querySelector:sel=>sel==='.editor-content'?{inert:state.busy}:sel==='.editor-upload'?button('上传',state.busy,state.modal):null,querySelectorAll:()=>[button('保存 PNG…',state.busy,state.modal)]};
  if(selector==='.skin-upload-dialog')return state.modal?{querySelectorAll:()=>[button(state.busy?'正在上传…':'确认上传',state.busy)]}:null;
  return null;
 },querySelectorAll(selector){if(selector==='[data-nav][aria-current=page]')return [{dataset:{nav:'skins'}}];if(selector.includes('.editor-operation-error'))return state.error?[{textContent:state.error}]:[];return []}};
 const rendererContext=vm.createContext({document:dom});
 const evaluate=async expression=>vm.runInContext(expression,rendererContext);
 const wait=async ms=>{now+=ms;if(pending&&now>=pending.at){const action=pending.action;pending=null;action()}clockSamples.push({now,busy:state.busy,profileCalls:context.editorProfileCalls??0})};
 const click=async selector=>{assert.equal(selector,'.editor-upload');state.modal=true};
 const clickText=async(scope,text)=>{
  assert.equal(scope,'.skin-upload-dialog');assert.equal(text,'确认上传');assert(!state.busy);state.busy=true;state.error='';
  ipc.emit('window:skinEditorBusy',{sender:wc},{ownerId:'qa-owner',pending:true});
  if(mode==='reject-success'&&context.editorUploadCalls===1)context.editorUploadFail=true;
  let outcome='success',error;try{await ipc._invokeHandlers.get('skin:editorUpload')()}catch(e){outcome='error';error=String(e)}
  const call=context.editorUploadCalls;if(call===2)secondStarted=now;
  pending={at:now+(call===2?420:80),action:()=>{
   if(outcome==='error'){state.error=error;state.modal=true}else{state.modal=false;if(mode!=='no-refresh'){ipc._invokeHandlers.get('skin:profile')();state.profileRefreshAt=now}if(mode==='new-error')state.error='synthetic new upload error'}
   state.busy=false;ipc.emit('window:skinEditorBusy',{sender:wc},{ownerId:'qa-owner',pending:false});
  }};
 };
 let writes=0;const writeReadiness=()=>{writes++};
 const ready=Function('evaluate','main','wait','readiness','writeReadiness','Date','assert','console',readySource+';return ready')(evaluate,main,wait,readiness,writeReadiness,{now:()=>now},assert,{error:()=>{}});
 let error;try{await new AsyncFunction('require','main','click','clickText','ready','assert','evaluate','readiness','writeReadiness','Date','console',block)(()=>helper,main,click,clickText,ready,assert,evaluate,readiness,writeReadiness,{now:()=>now},{error:()=>{}})}catch(e){error=e}
 return {error,readiness,writes,now,secondStarted,state,clockSamples,context,ipc,originalUpload,originalProfile,productionListener,productionBusy,logging,originalCalls,originalResult,originalError,foreignUpload,foreignProfile,foreignBusy};
}
function assertRestored(r) {
 assert.equal(r.ipc._invokeHandlers.get('skin:editorUpload'),r.originalUpload);assert.equal(r.ipc._invokeHandlers.get('skin:profile'),r.originalProfile);
 assert.deepEqual(r.ipc.listeners('window:skinEditorBusy'),[r.productionListener]);assert(r.productionBusy.length>=2,'read-only observer must leave production listener active');
 assert.equal(r.context.editorUploadObservation.installed,false);assert(r.readiness.some(p=>p.label.includes('finally restores')&&p.samples.at(-1).ready));
}
test('virtual delayed upload IPC completion beyond 300 ms must refresh and become actionable before strict success',async()=>{
 const r=await syntheticFlow();assert.ifError(r.error);assert.equal(r.context.editorUploadCalls,2);assert.equal(r.context.editorProfileCalls,1);assert(r.state.profileRefreshAt-r.secondStarted>=420);
 const samples=r.readiness.find(p=>p.label.startsWith('successful upload')).samples;
 assert(samples.some(s=>!s.ready&&s.main?.uploads[1]?.returned&&s.main.profileCalls===0&&s.busy),'returned main fixture cannot pretend renderer IPC has completed');
 assert(samples.at(-1).ready);assertRestored(r);
});
test('retry rejection never qualifies as success and retains original refresh assertion plus timeout samples',async()=>{
 const r=await syntheticFlow('reject-success');assert.match(String(r.error),/successful upload refreshes profile/);assert.equal(r.context.editorUploadCalls,2);assert.equal(r.context.editorProfileCalls,0);
 const samples=r.readiness.find(p=>p.label.startsWith('successful upload')).samples;assert.equal(samples.at(-1).ready,false);assert.equal(samples.at(-1).main.uploads[1].outcome,'error');assertRestored(r);
});
test('returned upload and dismissed dialog without profile refresh cannot pass',async()=>{
 const r=await syntheticFlow('no-refresh');assert.match(String(r.error),/successful upload refreshes profile/);
 const samples=r.readiness.find(p=>p.label.startsWith('successful upload')).samples;assert(samples.at(-1).confirmMounted===false);assert(samples.at(-1).uploadActionable);assert.equal(samples.at(-1).ready,false);assertRestored(r);
});
test('profile refresh cannot conceal a new renderer error and cleanup still runs on readiness failure',async()=>{
 const r=await syntheticFlow('new-error');assert.match(String(r.error),/actual UI\/IPC readiness was not reached/);assert.equal(r.context.editorProfileCalls,1);
 const samples=r.readiness.find(p=>p.label.startsWith('successful upload')).samples;assert.equal(samples.at(-1).ready,false);assert(samples.at(-1).errors.includes('synthetic new upload error'));assertRestored(r);
});
test('main gate requires returned success, later profile call and completed actual renderer busy cycle',async()=>{
 const r=await syntheticFlow();const s=r.context.editorUploadObservation;
 assert.equal(vm.runInContext(`(${helper.uploadMainState.toString()})('success',0)`,r.context).ready,true);
 s.uploads[1].returned=false;assert.equal(vm.runInContext(`(${helper.uploadMainState.toString()})('success',0)`,r.context).ready,false);s.uploads[1].returned=true;
 s.pendingOwners['still-busy']=true;assert.equal(vm.runInContext(`(${helper.uploadMainState.toString()})('success',0)`,r.context).ready,false);delete s.pendingOwners['still-busy'];
 s.profiles[0].order=s.uploads[1].startedOrder;assert.equal(vm.runInContext(`(${helper.uploadMainState.toString()})('success',0)`,r.context).ready,false);
});

test('wrapped original entries retain event/args/result/rejection and exactly one error-log wrapper after cleanup',async()=>{
 const r=await syntheticFlow();assert.ifError(r.error);assertRestored(r);
 const event={sender:'original event identity'},args=['success',{value:42}],before=r.logging.length;
 assert.equal(await r.ipc._invokeHandlers.get('skin:editorUpload')(event,...args),r.originalResult);
 assert.equal(r.originalCalls.at(-1).event,event);assert.deepEqual(r.originalCalls.at(-1).args,args);assert.equal(r.logging.length,before);
 await assert.rejects(r.ipc._invokeHandlers.get('skin:editorUpload')(event,'reject'),error=>error===r.originalError);
 assert.equal(r.logging.length,before+1,'exact original wrapper logs a rejection once, not twice');
 assert.equal(await r.ipc._invokeHandlers.get('skin:profile')(event,...args),r.originalResult);
 assert.equal(r.originalCalls.at(-1).channel,'profile');assert.equal(r.originalCalls.at(-1).event,event);assert.deepEqual(r.originalCalls.at(-1).args,args);
 await assert.rejects(r.ipc._invokeHandlers.get('skin:profile')(event,'reject'),error=>error===r.originalError);assert.equal(r.logging.length,before+2);
});
for(const mode of ['foreign-upload','foreign-profile','foreign-both'])test('cleanup restores only owned entries and never overwrites '+mode,async()=>{
 const r=await syntheticFlow(mode);assert.match(String(r.error),/upload QA observers\/handlers must be restored/);
 const sample=r.readiness.find(x=>x.label.includes('finally restores')).samples.at(-1),uploadForeign=mode!=='foreign-profile',profileForeign=mode!=='foreign-upload';
 assert.equal(sample.ready,false);assert.equal(sample.uploadEntryOwned,!uploadForeign);assert.equal(sample.profileEntryOwned,!profileForeign);
 assert.equal(sample.uploadHandlerRestored,!uploadForeign);assert.equal(sample.profileHandlerRestored,!profileForeign);
 assert.equal(r.ipc._invokeHandlers.get('skin:editorUpload'),uploadForeign?r.foreignUpload:r.originalUpload);
 assert.equal(r.ipc._invokeHandlers.get('skin:profile'),profileForeign?r.foreignProfile:r.originalProfile);
 assert(sample.observerRemoved);assert(sample.originalBusyListenersPreserved);assert.deepEqual(r.ipc.listeners('window:skinEditorBusy'),[r.productionListener]);
});
test('cleanup preserves a later foreign busy listener and cannot silently claim exact listener restoration',async()=>{
 const r=await syntheticFlow('foreign-busy');assert.match(String(r.error),/upload QA observers\/handlers must be restored/);
 const sample=r.readiness.find(x=>x.label.includes('finally restores')).samples.at(-1);
 assert.equal(sample.ready,false);assert(sample.uploadEntryOwned&&sample.profileEntryOwned&&sample.uploadHandlerRestored&&sample.profileHandlerRestored);
 assert(sample.observerRemoved&&sample.originalBusyListenersPreserved);assert.equal(sample.busyListenerCountBefore,1);assert.equal(sample.busyListenerCountAfter,2);
 assert.deepEqual(r.ipc.listeners('window:skinEditorBusy'),[r.productionListener,r.foreignBusy]);
});
