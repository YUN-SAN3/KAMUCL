// QA-only state observations in the disposable fixture harness; no real upload.
function installUploadFixture() {
 const ipc=globalThis.testElectron.ipcMain,window=globalThis.testElectron.BrowserWindow.getAllWindows()[0];
 if(globalThis.editorUploadObservation?.installed)throw Error('Upload QA observer already installed');
 const originalUpload=ipc._invokeHandlers.get('skin:editorUpload'),originalProfile=ipc._invokeHandlers.get('skin:profile');
 if(typeof originalUpload!=='function'||typeof originalProfile!=='function')throw Error('Upload QA original handlers missing');
 const state=globalThis.editorUploadObservation={installed:true,sequence:0,uploads:[],profiles:[],busyEvents:[],pendingOwners:{},originalUpload,originalProfile,originalBusyListeners:ipc.listeners('window:skinEditorBusy')};
 globalThis.editorUploadCalls=0;globalThis.editorUploadFail=true;globalThis.editorProfileCalls=0;
 state.busyListener=(event,value)=>{
  if(event.sender!==window.webContents||!value||typeof value.ownerId!=='string'||typeof value.pending!=='boolean')return;
  const operation=globalThis.editorUploadCalls+(value.pending?1:0);
  state.busyEvents.push({order:++state.sequence,at:Date.now(),operation,ownerId:value.ownerId,pending:value.pending});
  if(value.pending)state.pendingOwners[value.ownerId]=true;else delete state.pendingOwners[value.ownerId];
 };
 ipc.on('window:skinEditorBusy',state.busyListener);
 ipc.removeHandler('skin:editorUpload');ipc.handle('skin:editorUpload',()=>{
  const request={call:++globalThis.editorUploadCalls,startedAt:Date.now(),startedOrder:++state.sequence,returned:false};state.uploads.push(request);
  try{if(globalThis.editorUploadFail)throw Error('隔离测试：上传失败');request.outcome='success';return {ok:true}}
  catch(error){request.outcome='error';request.error=String(error);throw error}
  finally{request.returned=true;request.returnedAt=Date.now();request.returnedOrder=++state.sequence}
 });
 state.fixtureUploadEntry=ipc._invokeHandlers.get('skin:editorUpload');
 ipc.removeHandler('skin:profile');ipc.handle('skin:profile',()=>{
  state.profiles.push({call:++globalThis.editorProfileCalls,at:Date.now(),order:++state.sequence});
  // This is the existing isolated fixture account. Ledger never includes it.
  return {username:globalThis.uiAccount.username,skins:[{id:'fixture',variant:'classic',dataUrl:globalThis.uiSkin,url:''}],capes:[]};
 });
 state.fixtureProfileEntry=ipc._invokeHandlers.get('skin:profile');
 return {installed:true,originalBusyListeners:state.originalBusyListeners.length};
}
function uploadMainState(stage,profileBefore=0) {
 const s=globalThis.editorUploadObservation;
 if(!s)return {ready:false,error:'Upload QA observer missing'};
 const calls=globalThis.editorUploadCalls,profileCalls=globalThis.editorProfileCalls,expected=stage==='failure'?1:2,request=s.uploads[expected-1];
 const pending=s.busyEvents.find(e=>e.operation===expected&&e.pending),idle=pending&&s.busyEvents.find(e=>e.operation===expected&&!e.pending&&e.order>pending.order);
 const settled=request?.returned===true&&!!request.returnedAt&&request.returnedOrder>request.startedOrder&&calls===expected&&s.uploads.length===expected&&!!idle&&Object.keys(s.pendingOwners).length===0;
 const success=stage==='success'&&settled&&request.outcome==='success'&&!request.error&&s.uploads[0]?.outcome==='error'&&profileCalls>profileBefore&&s.profiles.some(p=>p.call>profileBefore&&p.order>request.returnedOrder);
 const failure=stage==='failure'&&settled&&request.outcome==='error'&&request.error?.includes('上传失败');
 return {ready:!!(success||failure),stage,calls,profileCalls,profileBefore,uploads:s.uploads,profiles:s.profiles,busyEvents:s.busyEvents,pendingOwners:Object.keys(s.pendingOwners)};
}
function uploadRendererState(stage) {
 const editor=document.querySelector('.skin-editor'),dialog=document.querySelector('.skin-upload-dialog'),content=editor?.querySelector('.editor-content');
 const button=[...dialog?.querySelectorAll('button')||[]].find(e=>['确认上传','正在上传…'].includes(e.textContent.trim()));
 const upload=editor?.querySelector('.editor-upload'),save=[...editor?.querySelectorAll('.editor-footer button')||[]].find(e=>e.textContent.trim()==='保存 PNG…');
 const actionable=e=>!!e&&!e.disabled&&!e.closest('[inert]')&&e.getClientRects().length>0;
 const errors=[...document.querySelectorAll('.skin-editor .editor-operation-error,.skin-upload-dialog .editor-operation-error')].map(e=>e.textContent.trim()).filter(Boolean);
 const busy=!!content?.inert||button?.textContent.trim()==='正在上传…';
 const state={stage,editorMounted:!!editor,confirmMounted:!!dialog,confirmActionable:actionable(button),confirmText:button?.textContent.trim()||'',uploadActionable:actionable(upload),saveActionable:actionable(save),contentInert:!!content?.inert,editorInert:!!editor?.inert,busy,errors};
 state.ready=stage==='failure'?state.editorMounted&&state.confirmMounted&&state.confirmActionable&&!state.busy&&errors.some(e=>e.includes('上传失败')):
  state.editorMounted&&!state.confirmMounted&&!state.busy&&!state.contentInert&&!state.editorInert&&state.uploadActionable&&state.saveActionable&&errors.length===0;
 return state;
}
function cleanupUploadFixture() {
 const s=globalThis.editorUploadObservation,ipc=globalThis.testElectron.ipcMain;
 if(!s?.installed)throw Error('Upload QA observer was not installed');
 ipc.removeListener('window:skinEditorBusy',s.busyListener);
 const uploadEntryOwned=ipc._invokeHandlers.get('skin:editorUpload')===s.fixtureUploadEntry,profileEntryOwned=ipc._invokeHandlers.get('skin:profile')===s.fixtureProfileEntry;
 // The product's patched handle() wraps listeners. Restore the exact saved Map
 // entries in this disposable QA scope; do not wrap again or replace outsiders.
 if(uploadEntryOwned)ipc._invokeHandlers.set('skin:editorUpload',s.originalUpload);
 if(profileEntryOwned)ipc._invokeHandlers.set('skin:profile',s.originalProfile);
 s.installed=false;
 const current=ipc.listeners('window:skinEditorBusy');
 return {ready:uploadEntryOwned&&profileEntryOwned&&!current.includes(s.busyListener)&&s.originalBusyListeners.every(fn=>current.includes(fn))&&current.length===s.originalBusyListeners.length&&ipc._invokeHandlers.get('skin:editorUpload')===s.originalUpload&&ipc._invokeHandlers.get('skin:profile')===s.originalProfile,
  uploadEntryOwned,profileEntryOwned,observerRemoved:!current.includes(s.busyListener),originalBusyListenersPreserved:s.originalBusyListeners.every(fn=>current.includes(fn)),busyListenerCountBefore:s.originalBusyListeners.length,busyListenerCountAfter:current.length,uploadHandlerRestored:ipc._invokeHandlers.get('skin:editorUpload')===s.originalUpload,profileHandlerRestored:ipc._invokeHandlers.get('skin:profile')===s.originalProfile};
}
module.exports={installUploadFixture,uploadMainState,uploadRendererState,cleanupUploadFixture};
