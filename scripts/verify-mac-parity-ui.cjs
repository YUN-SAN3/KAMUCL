// Real coordinate operations in the exact signed Mac application's renderer.
// Read-only framework observations do not replace handlers or fabricate state.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const ROUTES=['home','game','mods','packs','shaders','recordings','projections','keys','bridge','skins','community','servers','friends','settings','accounts']
const THEMES=['transparent','black-orange','blue-white','custom']
const LAYOUTS=[[960,620,1],[1280,900,1.25],[1440,960,1.5],[960,620,1.5]]
const ROUTE_COMPONENTS={home:'HomeView',game:'GameView',mods:'ModsView',packs:'PacksView',shaders:'ShadersView',recordings:'RecordingsView',projections:'ProjectionsView',keys:'KeysView',bridge:'BridgeView',skins:'SkinsView',community:'CommunityView',servers:'ServersView',friends:'FriendConnectView',settings:'SettingsView',accounts:'AccountsView'}
function assertEditableNativeTextInput(field){
 assert.equal(field.exists,true,'An actual connected input must exist')
 assert.equal(field.tag,'INPUT','Native text replacement cannot replace another control')
 assert(['text','search','url','tel','email','password'].includes(field.type),'Native replacement requires a text input')
 assert.equal(field.disabled,false,'Native replacement cannot bypass a disabled input')
 assert.equal(field.readOnly,false,'Native replacement cannot bypass a read-only input')
 assert.equal(field.inert,false,'Native replacement cannot bypass an inert dialog')
 assert.equal(typeof field.value,'string')
}
function nativeInputLayoutReady(row,previous){
 try{assertEditableNativeTextInput(row.field)}catch{return false}
 if(row.native.visible!==true||row.native.minimized!==false||row.native.focused!==true||row.field.hit!==true||row.field.ancestorsVisible!==true||row.field.runningAnimations!==0||!previous)return false
 if(row.native.pid!==previous.native?.pid||row.native.windowId!==previous.native?.windowId||row.native.webContentsId!==previous.native?.webContentsId)return false
 return['x','y','width','height'].every(k=>['bounds','contentBounds'].every(name=>Number.isFinite(row.native[name]?.[k])&&Number.isFinite(previous.native?.[name]?.[k])&&Math.abs(row.native[name][k]-previous.native[name][k])<=.1)&&Number.isFinite(row.field.bounds[k])&&Number.isFinite(previous.field?.bounds?.[k])&&Math.abs(row.field.bounds[k]-previous.field.bounds[k])<=.1)
}
function nativeNavigationLayoutReady(row,previous,expected){
 const ready=value=>{
  const n=value?.native,c=value?.coordinate,r=c?.renderer
  return n&&c&&r&&['pid','windowId','webContentsId'].every(k=>n[k]===expected[k])&&n.visible===true&&n.minimized===false&&n.focused===true&&n.appHidden===false&&Number.isFinite(n.bounds?.width)&&n.bounds.width>0&&Number.isFinite(n.bounds?.height)&&n.bounds.height>0&&Number.isFinite(n.zoom)&&n.zoom>0&&Number.isFinite(n.contentBounds?.width)&&n.contentBounds.width>0&&Number.isFinite(n.contentBounds?.height)&&n.contentBounds.height>0&&r.width===Math.round(n.contentBounds.width/n.zoom)&&r.height===Math.round(n.contentBounds.height/n.zoom)&&r.hasFocus===true&&r.hidden===false&&Number.isFinite(r.pixelRatio)&&r.pixelRatio>0&&c.hit===true&&Number.isFinite(c.x)&&Number.isFinite(c.y)
 }
 if(!ready(row)||!ready(previous))return false
 return row.native.zoom===previous.native.zoom&&['x','y','width','height'].every(k=>['bounds','contentBounds'].every(name=>Number.isFinite(row.native[name]?.[k])&&row.native[name][k]===previous.native[name]?.[k])&&Number.isFinite(row.coordinate.bounds?.[k])&&row.coordinate.bounds[k]===previous.coordinate.bounds?.[k])&&row.coordinate.x===previous.coordinate.x&&row.coordinate.y===previous.coordinate.y&&['width','height','pixelRatio'].every(k=>row.coordinate.renderer[k]===previous.coordinate.renderer[k])
}
function installMacParityObserver(){
 const instances=()=>{
  const root=document.querySelector('#app')?.__vue_app__?._container?._vnode
  if(!root)throw Error('Actual mounted production VNode root unavailable')
  const seen=new WeakSet(),rows=[]
  const visit=node=>{if(!node||typeof node!=='object'||seen.has(node))return;seen.add(node);if(Array.isArray(node)){for(const child of node)visit(child);return}if(node.component){rows.push(node.component);visit(node.component.subTree)}if(Array.isArray(node.children))visit(node.children);visit(node.ssContent);visit(node.ssFallback);visit(node.suspense?.activeBranch)}
  visit(root);return rows.filter(row=>!row.isUnmounted)
 }
 const named=name=>instances().filter(row=>row.type?.__name===name)
 const one=name=>{const rows=named(name);if(rows.length!==1)throw Error('Expected one actual '+name+' instance, found '+rows.length);return rows[0]}
 const nodeForElement=(name,element)=>{
  const matches=[]
  const visit=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){for(const child of node)visit(child);return}if(node.el===element)matches.push(node);if(Array.isArray(node.children))visit(node.children);visit(node.ssContent);visit(node.ssFallback)}
  for(const row of named(name))visit(row.subTree)
  if(matches.length!==1)throw Error('Expected one actual '+name+' VNode for visible element, found '+matches.length)
  return matches[0]
 }
 const forElement=(name,element)=>{const node=nodeForElement(name,element);const rows=named(name).filter(row=>{let found=false;const visit=n=>{if(!n||typeof n!=='object')return;if(n===node)found=true;if(Array.isArray(n)){for(const c of n)visit(c);return}if(Array.isArray(n.children))visit(n.children);visit(n.ssContent);visit(n.ssFallback)};visit(row.subTree);return found});if(rows.length!==1)throw Error('Actual visible '+name+' props unavailable');return rows[0]}
 const route=name=>{
  const row=named(name).find(row=>{const el=row.subTree?.el,scope=el?.closest?.('.route-view')||el?.parentElement?.closest('.route-view');return scope?.isConnected&&!scope.classList.contains('fade-leave-active')})
  if(!row)return{component:null,componentChain:[],transition:null}
  const names=[];for(let current=row;current;current=current.parent)names.push(current.type?.__name||current.type?.name||null)
  const el=row.subTree.el,scope=el.closest?.('.route-view')||el.parentElement.closest('.route-view')
  return{component:row.type.__name,componentChain:names,transition:scope.className}
 }
 window.__macParityObserver={instances,one,route,nodeForElement,forElement,classification:'Read-only actual mounted production VNode tree and props; no DOM dev expandos, setupState or handler replacement'}
}
function readDownloadSelectionState(){
 const dialog=document.querySelector('.download-modal'),o=window.__macParityObserver
 if(!dialog)return{present:false}
 const loader=dialog.querySelector('.filter-row .select-menu-btn'),target=dialog.querySelector(':scope > .select-menu-btn'),file=dialog.querySelector('.file-row.active')
 const loaderProps=loader?o.forElement('SelectMenu',loader).props:null,targetProps=target?o.forElement('SelectMenu',target).props:null
 return{present:true,mcVersion:dialog.querySelector('input[list="mod-minecraft-versions"]')?.value,loader:loaderProps?.modelValue,loading:!!dialog.querySelector('.files-loading'),error:dialog.querySelector('.files-error')?.textContent||null,selectedFileId:file?o.nodeForElement('CommunityView',file).key:null,selectedFileName:file?.querySelector('.file-name')?.textContent,selectedFileDescription:file?.querySelector('.file-sub')?.textContent,target:{value:targetProps?.modelValue,options:targetProps?.options?.map(row=>({value:row.value,label:row.label}))||[]}}
}
function assertMatchingDownloadResponse(state,call){
 assert.equal(state.present,true);assert.equal(state.mcVersion,'1.20.1');assert.equal(state.loader,'fabric');assert.equal(state.loading,false);assert.equal(state.error,null)
 assert.equal(call?.channel,'community:files');assert(Number.isFinite(call.startedAt)&&Number.isFinite(call.completedAt)&&call.completedAt>=call.startedAt);assert(!call.error)
 assert.deepEqual(call.arguments,['modrinth','P7dR8mSH',{kind:'mod',mcVersion:'1.20.1',loader:'fabric'}])
 const selected=call.result?.find(row=>row.fileId===state.selectedFileId)
 assert(selected,'the actual selected VNode file belongs to the completed matching public response')
 assert.equal(selected.source,'modrinth');assert.equal(selected.projectId,'P7dR8mSH');assert(selected.gameVersions.includes('1.20.1')&&selected.loaders.includes('fabric'))
 assert.match(selected.sha1,/^[a-f0-9]{40}$/);assert.equal(state.selectedFileName,selected.fileName);assert(state.selectedFileDescription.includes('1.20.1'))
 return selected
}
function assertDownloadTargetSelection(state,expected){
 const label=expected.id+' · '+expected.mcVersion+' / '+expected.loader+' · '+expected.folder
 const options=state.target.options.filter(row=>row.label===label)
 assert.equal(options.length,1,'one actual compatible target option must identify the full instance and folder')
 assert(options[0].value);assert.equal(state.target.value,options[0].value,'the actual target SelectMenu props must select the intended instance')
 return options[0]
}
function readMountedInstallInput(){
 const rows=window.__macParityObserver.instances().filter(row=>row.type?.__name==='ModInstallDialog')
 if(!rows.length)return{}
 if(rows.length!==1)throw Error('Expected one actual ModInstallDialog instance, found '+rows.length)
 const row=rows[0]
 const p=row.props
 // CDP returnByValue represents V8 Proxy objects as empty objects. Serialize
 // within the renderer so the protocol receives a plain snapshot of the
 // actual reactive props, preserving every original field without setters.
 return JSON.parse(JSON.stringify({file:p.input.file,target:p.target}))
}
function readCommunityQueueState(){
 const observer=window.__macParityObserver
 return{route:document.querySelector('[data-nav][aria-current=page]')?.dataset.nav,blocked:!!document.querySelector('.download-modal,.community-confirm'),items:[...document.querySelectorAll('.community-queue .queue-item')].map(element=>({id:observer.nodeForElement('CommunityDownloadQueue',element).key,state:element.dataset.state,fileName:element.querySelector('.queue-name')?.textContent.trim(),target:element.querySelector('.queue-info small')?.textContent.trim(),status:element.querySelector('[role=status]')?.textContent.trim()}))}
}
function readCommunityConfirmation(){
 const rows=window.__macParityObserver.instances().filter(row=>row.type?.__name==='CommunityInstallConfirmation')
 if(!rows.length)return{}
 if(rows.length!==1)throw Error('Expected one actual CommunityInstallConfirmation, found '+rows.length)
 return JSON.parse(JSON.stringify(rows[0].props.item))
}
function assertCommunityQueuePrepare(state,call,file,target){
 assert.equal(state.blocked,false,'background preparation cannot retain a blocking install/file dialog')
 assert.equal(state.items.length,1,'one original queue item must survive browsing')
 const item=state.items[0];assert.match(item.id,/^[a-f0-9-]{36}$/);assert(['preparing','confirmation'].includes(item.state),item.status||'actual queue must prepare or await explicit confirmation')
 assert.equal(item.fileName,file.fileName);assert(item.target.includes(target.id)&&item.target.includes(target.folder))
 assert.equal(call?.channel,'mods:prepare');assert.equal(call.arguments.length,3);assert.deepEqual(call.arguments[0],{id:target.id,folder:target.folder});assert.deepEqual(call.arguments[1],{file});assert.match(call.arguments[2],/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
 assert(Number.isFinite(call.startedAt));assert(!call.error,'real prepare errors cannot be accepted as pending work')
 return item
}
function assertCommunityQueueConfirmation(item,call,file,target,queueId){
 assert.equal(item.id,queueId);assert.equal(item.state,'confirmation');assert.equal(item.operationId,call.arguments[2]);assert.equal(item.folder,target.folder);assert.deepEqual(item.file,file)
 for(const field of ['id','mcVersion','loader','folder'])assert.equal(item.target[field],target[field])
 assert(Number.isFinite(call.completedAt)&&call.completedAt>=call.startedAt);assert(!call.error);assert.deepEqual(item.plan,call.result,'visible confirmation must use the exact completed original plan')
 assert.equal(item.plan.warnings.length,0);assert.equal(item.plan.target.id,target.id);assert.equal(item.plan.target.folder,target.folder)
 return item.plan
}
function classifyPreparationBrowse(call,actions){
 assert.equal(call.channel,'mods:prepare');assert(Number.isFinite(call.startedAt)&&Number.isFinite(call.completedAt)&&call.completedAt>=call.startedAt)
 assert(actions.length&&actions.every(row=>Number.isFinite(row.at)&&row.at>=call.startedAt),'browsing must follow the actual accepted prepare')
 for(const row of actions){const click=row.originalTrustedClick;assert(click?.isTrusted===true&&click.type==='click'&&Number.isFinite(click.timeOrigin)&&click.timeOrigin>0&&Number.isFinite(click.at),'browsing timing requires the original trusted native click');assert.equal(row.at,click.timeOrigin+click.at);assert(Number.isFinite(row.observedAt)&&row.observedAt>=row.at,'later state observation cannot be presented as the original input time')}
 return{classification:'Original public-service timing; no handler delay or fabricated latency',duringPrepare:actions.some(row=>row.at<call.completedAt),actions}
}
function assertActualCommitTrace(call,plan,prepareOperationId,progress){
 assert.equal(call.channel,'mods:commit');assert(!call.error);assert.equal(call.arguments.length,3)
 const operationId=call.arguments[2];assert.match(operationId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);assert.notEqual(operationId,prepareOperationId,'commit has its own original operation')
 const events=progress.filter(row=>row.value.operationId===operationId);assert(events.length,'original production progress must correlate to the actual commit operation')
 assert(events.every(row=>row.receivedAt>=call.startedAt&&row.value.taskTitle==='安装 MOD 与前置依赖'&&typeof row.value.taskId==='string'&&row.value.taskId));assert.equal(new Set(events.map(row=>row.value.taskId)).size,1)
 assert(events.some(row=>row.value.stage==='mod-verify'),'original initial commit progress required');assert.deepEqual(call.arguments,[plan.id,true,events[0].value.operationId])
 return{operationId,taskId:events[0].value.taskId,progress:events}
}
// Chromium may perform a microtask checkpoint between separate native event
// listeners. Bind both observations to the original Event and read only after
// its target handler has run, in the document's real bubbling phase.
function createQueueClickObserver(queue,readDataset,now){
 const events=new WeakMap()
 const before=event=>{
  if(!event.target.closest('[data-hit=kamu]'))return
  if(events.has(event))throw Error('Duplicate capture observation for original click')
  const d=readDataset(),row={actionId:queue.clicks.length+1,at:now(),trusted:event.isTrusted,beforePhase:event.eventPhase,before:Number(d.queue),expectedLimit:32,acceptedBefore:Number(d.acceptedClicks||0),rejectedBefore:Number(d.rejectedClicks||0),contacts:Number(d.contacts)}
  events.set(event,row);queue.clicks.push(row)
 }
 const after=event=>{
  const row=events.get(event);if(!row)return
  if(row.afterAt!==undefined)throw Error('Duplicate bubble observation for original click')
  const d=readDataset();row.after=Number(d.queue);row.acceptedAfter=Number(d.acceptedClicks||0);row.rejectedAfter=Number(d.rejectedClicks||0);row.afterAt=now();row.afterPhase=event.eventPhase;row.accepted=row.acceptedAfter===row.acceptedBefore+1
 }
 return{before,after}
}
function assertNavigationCoverage(rows){
 assert.equal(rows.length,THEMES.length*LAYOUTS.length*ROUTES.length)
 const keys=rows.map(row=>`${row.theme}/${row.width}/${row.height}/${row.zoom}/${row.route}`)
 assert.equal(new Set(keys).size,keys.length,'navigation evidence cannot duplicate a scene')
 for(const theme of THEMES)for(const[width,height,zoom]of LAYOUTS)for(const route of ROUTES){
  const row=rows.find(r=>r.theme===theme&&r.width===width&&r.height===height&&r.zoom===zoom&&r.route===route)
  assert(row,'missing actual navigation scene '+[theme,width,height,zoom,route].join('/'))
  assert.equal(row.selectedRoute,route);assert.equal(row.actualTheme,theme);assert.equal(row.native.focused,true)
  assert.equal(row.component,ROUTE_COMPONENTS[route],'actual component must match selected route')
  assert(row.componentChain.includes(ROUTE_COMPONENTS[route]),'original component ancestry must identify the actual page')
  assert.equal(row.native.visible,true);assert.equal(row.native.minimized,false)
  assert.equal(row.native.platform,'darwin');assert.equal(row.native.zoom,zoom)
  assert.equal(row.native.bounds?.width,width,'Requested native width must actually be covered; original clamped geometry is retained')
  assert.equal(row.native.bounds?.height,height,'Requested native height must actually be covered; original clamped geometry is retained')
  assert.equal(row.renderer.width,Math.round(row.native.contentBounds?.width/row.native.zoom),'Original renderer width must match actual native content bounds and zoom')
  assert.equal(row.renderer.height,Math.round(row.native.contentBounds?.height/row.native.zoom),'Original renderer height must match actual native content bounds and zoom')
  assert.equal(row.coordinate.hit,true);assert.equal(row.renderer.hasFocus,true);assert.equal(row.renderer.hidden,false)
  assert.equal(row.layout.horizontalOverflow,false);assert.match(row.screenshot,/^mac-parity-first-[a-z0-9-]+\.png$/)
  assert.match(row.sha256,/^[a-f0-9]{64}$/);assert(row.bytes>0)
 }
}
function assertQueueLedger(ledger,before,after){
 assert.equal(ledger.clicks.length,40,'forty original trusted click events required')
 assert(ledger.clicks.every(row=>row.trusted===true&&Number.isFinite(row.at)&&Number.isFinite(row.afterAt)))
 for(const row of ledger.clicks){
  assert.equal(row.beforePhase,1,'observe the original click before its target handler in capture phase')
  assert.equal(row.afterPhase,3,'observe the same original click after its target handler in bubble phase')
  assert(row.afterAt>=row.at,'original event observations cannot run backwards')
  assert.equal(row.expectedLimit,32);assert(Number.isInteger(row.before)&&row.before>=0&&row.before<=32)
  assert(Number.isInteger(row.after)&&row.after>=0&&row.after<=32)
  assert.equal(row.after-row.before,row.accepted?1:0,'each real synchronous input either accepts once or preserves the full queue')
  assert.equal(row.acceptedAfter-row.acceptedBefore,row.accepted?1:0)
  assert.equal(row.rejectedAfter-row.rejectedBefore,row.accepted?0:1,'actual rejection counter advances only on rejected input')
 }
 assert(ledger.clicks.slice(0,32).every(row=>row.accepted),'first 32 clicks are accepted in the original burst')
 const accepted=ledger.clicks.filter(row=>row.accepted).length,rejected=ledger.clicks.length-accepted
 assert(accepted>=32&&rejected>0,'the actual burst must exercise the maximum and overflow')
 assert.equal(Math.max(...ledger.clicks.map(row=>row.after)),32)
 assert.equal(after.contacts-before.contacts,accepted);assert.equal(after.count-before.count,accepted)
 const sources=ledger.audio.filter(row=>row.role==='palm')
 assert.equal(sources.length,accepted,'one actual palm source per accepted input')
 const contacts=ledger.contacts.filter(row=>row.contacts>before.contacts)
 assert.equal(contacts.length,accepted,'one original contact observation per accepted click')
 for(let i=0;i<contacts.length;i++){
  assert.equal(contacts[i].contacts,before.contacts+i+1)
  assert(Math.abs(sources[i].at-contacts[i].contactAt)<=50,'actual source start shares the contact timeline')
  assert(sources[i].duration>0&&sources[i].peak>0&&sources[i].peak<1,'real palm buffer has finite unclipped nonzero samples')
 }
 assert.equal(after.phase,'front');assert.equal(after.queue,0);assert.equal(after.persistedCount,after.count)
 assert.equal(ledger.busyVisible,true,'the actual overflow message must be visible')
 return{accepted,rejected,maximumQueue:32}
}
function publicAccount(account){return{id:account.id,type:account.type,username:account.username,uuid:account.uuid}}
function stableHash(value){const canonical=input=>Array.isArray(input)?input.map(canonical):input&&typeof input==='object'?Object.fromEntries(Object.keys(input).sort().map(key=>[key,canonical(input[key])])):input;return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}
function createInstallHandlerObserver(ipc,channels){
 const p={calls:[],originals:new Map(),entries:new Map(),registration:[]}
 for(const channel of channels){
  const original=ipc._invokeHandlers.get(channel)
  if(typeof original!=='function')throw Error('Original install handler missing: '+channel)
  p.originals.set(channel,original)
  const wrapper=async function(...args){const row={index:p.calls.length,channel,startedAt:Date.now(),arguments:args.slice(1)};p.calls.push(row);try{row.result=await original.apply(this,args);row.completedAt=Date.now();return row.result}catch(error){row.error={name:error.name,message:error.message};row.completedAt=Date.now();throw error}}
  ipc.removeHandler(channel);ipc.handle(channel,wrapper)
  // Production handle registration may wrap listeners for IPC error logging.
  // Ownership belongs to the actual Map entry, not the supplied callback.
  const entry=ipc._invokeHandlers.get(channel)
  if(typeof entry!=='function')throw Error('Registered observation handler missing: '+channel)
  p.entries.set(channel,entry);p.registration.push({channel,actualEntryObserved:true,registeredEntryIsSuppliedWrapper:entry===wrapper})
 }
 return p
}
function restoreInstallHandlerObserver(ipc,p){
 const failures=[],restored=[]
 for(const[channel,original]of p.originals){
  if(ipc._invokeHandlers.get(channel)!==p.entries.get(channel)){failures.push(channel);continue}
  // Restore the exact original entry rather than registering it through the
  // production wrapper a second time. Foreign entries are never overwritten.
  ipc._invokeHandlers.set(channel,original)
  if(ipc._invokeHandlers.get(channel)!==original)throw Error('Original install handler restoration failed: '+channel)
  restored.push({channel,exactOriginalEntryRestored:true})
 }
 if(failures.length)throw Error('Install observation identity changed: '+failures.join(', '))
 return{complete:true,restored}
}
async function preserveInstallObservation(operation,restore,receipt,save){
 let value,primaryError,cleanupError,diagnosticError
 const checkpoint=()=>{try{save()}catch(error){diagnosticError??=error;(receipt.diagnosticErrors??=[]).push({name:error.name,message:error.message})}}
 try{value=await operation()}catch(error){primaryError=error;receipt.primaryError={name:error.name,message:error.message};checkpoint()}
 finally{checkpoint();try{receipt.handlerRestoration=await restore()}catch(error){cleanupError=error;receipt.cleanupError={name:error.name,message:error.message}}checkpoint()}
 if(primaryError)throw primaryError
 if(cleanupError)throw cleanupError
 if(diagnosticError)throw diagnosticError
 return value
}
async function collectAndRestoreInstallObserver(main,receipt){
 let traceError
 try{receipt.originalHandlerTrace=await main(`macParityInstallTrace.calls`)}
 catch(error){traceError=error;receipt.traceReadError={name:error.name,message:error.message}}
 let restored
 try{restored=await main(`(${restoreInstallHandlerObserver.toString()})(testElectron.ipcMain,macParityInstallTrace)`);receipt.handlerRestoration=restored}
 catch(error){receipt.restorationError={name:error.name,message:error.message};throw error}
 if(traceError)throw traceError
 return restored
}
async function collectAndRestoreCommitObservation(evaluate,main,receipt){
 let progressReadError,progressRestoreError,installRestoreError,restored
 try{receipt.originalCommitProgress=await evaluate('window.__macParityCommitProgress?.rows||[]')}
 catch(error){progressReadError=error;receipt.progressReadError={name:error.name,message:error.message}}
 // The trace read is diagnostic. Always remove the actual renderer listener,
 // then restore exact main handlers, even if either separate transport rejects.
 try{receipt.progressObserverRestoration=await evaluate("(()=>{const o=window.__macParityCommitProgress;if(o){o.off();delete window.__macParityCommitProgress}return{complete:true,wasInstalled:!!o}})()")}
 catch(error){progressRestoreError=error;receipt.progressObserverRestorationError={name:error.name,message:error.message}}
 try{restored=await collectAndRestoreInstallObserver(main,receipt)}catch(error){installRestoreError=error}
 if(installRestoreError)throw installRestoreError
 if(progressRestoreError)throw progressRestoreError
 if(progressReadError)throw progressReadError
 return restored
}
function preservePrimaryFailure(proof,error,save){
 proof.error={name:error.name,message:error.message}
 try{save()}catch(diagnosticError){(proof.diagnosticErrors??=[]).push({stage:'primary failure receipt',name:diagnosticError.name,message:diagnosticError.message})}
 return error
}
function assertParityTrustedTarget(trace,expected){
 assert(trace&&typeof trace==='object','original trusted-target receipt required')
 assert.equal(trace.selector,expected.selector);assert.equal(trace.token,expected.token)
 assert.equal(trace.timeOrigin,expected.timeOrigin);assert.equal(trace.url,expected.url);assert.equal(trace.overflow,false)
 assert.deepEqual(trace.records.map(row=>row.type),['pointerdown','mousedown','pointerup','mouseup','click'],'one original trusted pointer/mouse/click sequence must target the intended control')
 for(const row of trace.records){
  assert.equal(row.isTrusted,true);assert.equal(row.matchesSelector,true,'the original native event must hit the intended target, not stale coordinates')
  assert.equal(row.timeOrigin,expected.timeOrigin);assert.equal(row.url,expected.url)
  assert.equal(row.renderer.hasFocus,true);assert.equal(row.renderer.hidden,false)
  assert(Number.isFinite(row.at)&&Number.isFinite(row.x)&&Number.isFinite(row.y));assert(row.target&&typeof row.target.tag==='string')
 }
}
function assertParityPointerDismissal(trace,expected){
 assert.equal(expected.selector,'[data-ui="App:32e6a4482be2"]','Only the actual download backdrop uses this pointerdown dismissal contract')
 assert(Number.isInteger(expected.x)&&Number.isInteger(expected.y),'Dismissal must bind its actually dispatched integer coordinates')
 assert.equal(trace.selector,expected.selector);assert.equal(trace.token,expected.token);assert.equal(trace.timeOrigin,expected.timeOrigin);assert.equal(trace.url,expected.url);assert.equal(trace.overflow,false)
 assert.deepEqual(trace.records.map(row=>row.type),['pointerdown','mousedown','pointerup','mouseup'],'Original native down/up sequence must remain complete after the pointerdown target is unmounted')
 const down=trace.records[0];assert.equal(down.matchesSelector,true);assert.equal(down.target.tag,'DIV');assert.equal(down.target.ui,'App:32e6a4482be2')
 for(const row of trace.records){assert.equal(row.isTrusted,true);assert.equal(row.timeOrigin,expected.timeOrigin);assert.equal(row.url,expected.url);assert.equal(row.renderer.hasFocus,true);assert.equal(row.renderer.hidden,false);assert(Number.isFinite(row.at)&&Number.isFinite(row.x)&&Number.isFinite(row.y));assert.equal(row.x,expected.x);assert.equal(row.y,expected.y)}
 return true
}
function observePointerDismissInteger(selector,original,integer){
 const matches=document.querySelectorAll(selector),mask=matches.length===1?matches[0]:null,originalTarget=document.elementFromPoint(original.x,original.y),integerTarget=document.elementFromPoint(integer.x,integer.y)
 return{count:matches.length,connected:!!mask?.isConnected,sameTarget:!!mask&&integerTarget===mask&&originalTarget===mask,bounds:mask?.getBoundingClientRect().toJSON(),target:integerTarget?{tag:integerTarget.tagName,ui:integerTarget.getAttribute('data-ui')}:null,x:integer.x,y:integer.y,renderer:{width:innerWidth,height:innerHeight,hasFocus:document.hasFocus(),hidden:document.hidden,pixelRatio:devicePixelRatio,timeOrigin:performance.timeOrigin,url:location.href,ready:document.readyState}}
}
function assertPointerDismissNative(value,reference,identity){
 for(const key of ['pid','windowId','webContentsId'])assert.equal(value[key],identity[key])
 assert(value.visible&&value.focused&&!value.minimized&&!value.appHidden);assert.equal(value.frontmostPID,identity.pid);assert(reference.window?.id>0);assert.equal(value.window?.id,reference.window.id,'Actual native CGWindow must stay the same throughout dismissal')
 for(const key of ['x','y','width','height'])for(const name of ['bounds','contentBounds'])assert.equal(value[name][key],reference[name][key]);assert.equal(value.zoom,reference.zoom)
}
function createParityCoordinate({call,evaluate,native,wait,identity,documentBinding,proof,save,now=()=>performance.now(),pointerDismissal=false,geometry=require('./qa-coordinate-geometry114.cjs')}){
 return async(selector,{expectedLayout,deadline,absentSelectors=selector.startsWith('.download-modal')?['.download-modal .files-loading']:[]}={})=>{
  if(pointerDismissal)assert.equal(selector,'[data-ui="App:32e6a4482be2"]')
  // Capture this call's document before any asynchronous operation. A later
  // explicit reload may bind the next call, never this call or its old samples.
  const boundDocument={...(typeof documentBinding==='function'?documentBinding():documentBinding)}
  assert(Number.isFinite(boundDocument.timeOrigin)&&boundDocument.timeOrigin>0&&typeof boundDocument.url==='string'&&boundDocument.url.length>0,'Coordinate requires an actual bound document')
  const end=Math.min(deadline??Infinity,now()+10000),remaining=()=>Math.max(1,end-now())
  const operation={label:'stable owned coordinate '+selector,classification:'Actual owned native/renderer geometry, two stable hits, one original input dispatch and trusted event targets; no DOM click or retry',selector,absentSelectors,documentBinding:boundDocument,deadline:end,samples:[],complete:false}
  proof.operations.push(operation);save();let token,primaryError
  try{
   assert(now()<end,'Original coordinate deadline elapsed before observation')
   await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`,remaining())
   const expected={pid:identity.pid,windowId:identity.windowId,webContentsId:identity.webContentsId,...boundDocument,...(expectedLayout?{zoom:expectedLayout.zoom}:{})}
   const observed=await geometry.waitForStableCoordinate({expected,deadline:end,now,wait,onSample:row=>{operation.samples.push(row);save()},read:async()=>{
    const actualNative=await native(identity,remaining())
    assert(now()<end,'Original coordinate deadline elapsed before renderer observation')
    return{native:actualNative,coordinate:await evaluate(geometry.coordinateExpression(selector,{absentSelectors}),remaining())}
   }})
   if(expectedLayout)assert(nativeNavigationLayoutReady(observed,operation.samples.at(-2)?.value,{...expectedLayout,pid:identity.pid,windowId:identity.windowId,webContentsId:identity.webContentsId}),'original native navigation geometry condition must remain satisfied')
   assert(now()<end,'Original coordinate deadline elapsed before trusted-target observation')
   token=await evaluate(geometry.trustedTargetStartExpression(selector),remaining());operation.token=token;save()
   let point=observed.coordinate
   if(pointerDismissal){
    point={...point,x:Math.trunc(point.x),y:Math.trunc(point.y)}
    const actual=await evaluate(`(${observePointerDismissInteger.toString()})(${JSON.stringify(selector)},${JSON.stringify({x:observed.coordinate.x,y:observed.coordinate.y})},${JSON.stringify({x:point.x,y:point.y})})`,remaining())
    operation.integerDismissal={original:{x:observed.coordinate.x,y:observed.coordinate.y},dispatch:{x:point.x,y:point.y},actual};save()
    assert.equal(actual.count,1);assert.equal(actual.connected,true);assert.equal(actual.sameTarget,true,'The actual integer pixel must hit the same original download backdrop');assert.equal(actual.target.tag,'DIV');assert.equal(actual.target.ui,'App:32e6a4482be2');assert.equal(actual.x,point.x);assert.equal(actual.y,point.y)
    for(const key of ['x','y','width','height'])assert.equal(actual.bounds[key],observed.coordinate.bounds[key],'The original backdrop bounds must stay unchanged')
    for(const key of ['width','height','pixelRatio','timeOrigin','url','ready'])assert.equal(actual.renderer[key],observed.coordinate.renderer[key]);assert.equal(actual.renderer.hasFocus,true);assert.equal(actual.renderer.hidden,false)
    assert(now()<end,'Original coordinate deadline elapsed before integer pixel validation')
   }
   if(pointerDismissal){assertPointerDismissNative(observed.native,observed.native,identity);operation.trigger='pointerdown dismissal';operation.nativeSequence=[];assert.equal(await evaluate("!!document.querySelector('.dl-panel')",remaining()),true,'Actual download panel must exist before its backdrop dismissal')}
   for(const[type,buttons]of[['mouseMoved',0],['mousePressed',1],['mouseReleased',0]]){
    assert(now()<end,'Original coordinate deadline elapsed before input dispatch')
    if(pointerDismissal){const actual=await native(identity,remaining());assertPointerDismissNative(actual,observed.native,identity);operation.nativeSequence.push({type,phase:'before',at:now(),actual});save()}
    const input={type,x:point.x,y:point.y,button:type==='mouseMoved'?'none':'left',buttons,clickCount:type==='mouseMoved'?0:1}
    proof.inputEvents.push({method:'Input.dispatchMouseEvent',parameters:input,at:now()});save();await call('Input.dispatchMouseEvent',input,remaining())
    if(pointerDismissal){const actual=await native(identity,remaining());assertPointerDismissNative(actual,observed.native,identity);operation.nativeSequence.push({type,phase:'after',at:now(),actual});if(type==='mousePressed'){operation.actualDismissal=await evaluate("({panel:!!document.querySelector('.dl-panel'),backdrop:!!document.querySelector('[data-ui=\"App:32e6a4482be2\"]'),timeOrigin:performance.timeOrigin,url:location.href})",remaining());assert.equal(operation.actualDismissal.panel,false,'Production pointerdown must actually remove the download panel');assert.equal(operation.actualDismissal.backdrop,false);assert.equal(operation.actualDismissal.timeOrigin,boundDocument.timeOrigin);assert.equal(operation.actualDismissal.url,boundDocument.url)}save()}
    assert(now()<end,'Original coordinate deadline elapsed during input dispatch')
   }
   operation.observed=observed;operation.complete=true;return point
  }catch(error){primaryError=error;operation.error={name:error.name,message:error.message};throw error}
  finally{
   if(token!==undefined)try{
    operation.trustedTargets=await evaluate(geometry.trustedTargetStopExpression(token),remaining())
    if(pointerDismissal)assertParityPointerDismissal(operation.trustedTargets,{selector,token,...boundDocument,...operation.integerDismissal?.dispatch});else assertParityTrustedTarget(operation.trustedTargets,{selector,token,...boundDocument})
    assert(now()<end,'Original coordinate deadline elapsed during trusted-target observation')
   }catch(error){operation.complete=false;operation.trustedTargetError={name:error.name,message:error.message};if(!primaryError)throw error}
   finally{save()}
   save()
  }
 }
}
function parityReloadReady(row,before,theme){
 return Number.isFinite(row?.timeOrigin)&&row.timeOrigin>0&&row.timeOrigin!==before.timeOrigin&&row.url===before.url&&row.readyState==='complete'&&row.ready===true&&row.theme===theme
}
function createParityReload({call,evaluate,wait,proof,save,documentBinding=()=>proof.documentBinding,now=()=>performance.now()}){
 return async(theme,label)=>{
  const startedAt=now(),deadline=startedAt+10000,remaining=()=>Math.max(1,deadline-now())
  const boundBefore={...documentBinding()},lineage={label,requestedTheme:theme,classification:'Actual explicit Page.reload, original document observations and new-document binding; no old sample is rebound',boundBefore,startedAt,deadline,samples:[],complete:false}
  ;(proof.documentLineage??=[]).push(lineage);save()
  try{
   assert(now()<deadline,'Original reload deadline elapsed before observing the current document')
   lineage.before=await evaluate('({timeOrigin:performance.timeOrigin,url:location.href})',remaining());save()
   assert(now()<deadline,'Original reload deadline elapsed while observing the current document')
   assert.deepEqual(lineage.before,boundBefore,'Explicit reload must begin in the currently bound document')
   assert(Number.isFinite(lineage.before.timeOrigin)&&lineage.before.timeOrigin>0&&typeof lineage.before.url==='string'&&lineage.before.url.length>0,'Explicit reload requires an actual current document')
   await call('Page.reload',{},remaining())
   assert(now()<deadline,'Original reload deadline elapsed during Page.reload')
   while(now()<deadline){
    let value
    try{value=await evaluate(`({timeOrigin:performance.timeOrigin,url:location.href,readyState:document.readyState,theme:document.documentElement.dataset.theme,ready:!!document.querySelector('[data-nav=home]')&&!!document.querySelector('#app')?.__vue_app__?._container?._vnode})`,remaining())}
    catch(error){value={transitionError:{name:error.name,message:error.message}}}
    const at=now();lineage.samples.push({at,value});save()
    if(at>=deadline)break
    if(value.url!==undefined)assert.equal(value.url,lineage.before.url,'Reload must retain the actual owned renderer URL')
    if(parityReloadReady(value,lineage.before,theme)){
     const after={timeOrigin:value.timeOrigin,url:value.url}
     assert.deepEqual(documentBinding(),boundBefore,'Document binding cannot change during an explicit reload')
     lineage.after=after;lineage.readyObservation=value;lineage.finishedAt=at;lineage.complete=true
     proof.documentBinding={...after};save();return value
    }
    const left=deadline-now();if(left<=0)break;await wait(Math.min(75,left))
   }
   assert.fail(label+' did not reach its required new document and actual theme within the original reload deadline')
  }catch(error){lineage.error={name:error.name,message:error.message};lineage.finishedAt=now();save();throw error}
 }
}
module.exports=async function verifyMacParity(h){
 const{call,evaluate,main,wait,root,profile,games,version,phase,recordScreencast}=h
 assert.equal(process.platform,'darwin');assert(['first','restart'].includes(phase))
 const output=path.resolve(`out/mac-parity-${phase}.json`)
 assert(!fs.existsSync(output),'native phase receipt must be fresh; never replace old evidence')
 const sourceCommit=require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
 const native=(owned,timeoutMs)=>main(`(()=>{const w=testElectron.BrowserWindow.getAllWindows().find(w=>${owned?`w.id===${owned.windowId}&&w.webContents.id===${owned.webContentsId}`:"w.webContents.getURL().includes('/renderer/index.html')"});if(!w)throw Error('Owned parity window unavailable');return{pid:process.pid,platform:process.platform,arch:process.arch,runtimeVersion:process.versions.electron,version:testElectron.app.getVersion(),executable:process.execPath,actualUserData:process.mainModule.require('node:fs').realpathSync.native(testElectron.app.getPath('userData')),windowId:w.id,webContentsId:w.webContents.id,bounds:w.getBounds(),contentBounds:w.getContentBounds(),zoom:w.webContents.getZoomFactor(),focused:w.isFocused(),visible:w.isVisible(),minimized:w.isMinimized(),appHidden:testElectron.app.isHidden()}})()`,timeoutMs)
 const proof={schemaVersion:1,version,phase,sourceCommit,startedAt:new Date().toISOString(),complete:false,fullParityAcceptance:false,classification:'Actual native packaged UI and real persistence. Instance metadata is disposable synthetic data and is never launched. Real public-service downloads are separately labelled. No credential login or physical listening claim.',navigation:[],screenshots:[],operations:[],inputEvents:[],uncovered:['Microsoft authenticated login/refresh/license/game','Yggdrasil account login/refresh and server launch','physical audio listening','two-user multiplayer services','physical Intel hardware'],identity:{...(await native()),sourceCommit,profile:fs.realpathSync.native(profile)}}
 assert.equal(proof.identity.actualUserData,proof.identity.profile,'the observed native profile must equal the owned persistent profile')
 assert.equal(proof.identity.pid,h.ownedTrack.pid);assert.equal(proof.identity.arch,process.arch)
 assert.equal(proof.identity.runtimeVersion,require('../package.json').devDependencies.electron);assert.equal(proof.identity.version,version)
 assert.equal(fs.realpathSync.native(proof.identity.executable),fs.realpathSync.native(process.env.KAMUCL_GUI_APP))
 await evaluate(`(${installMacParityObserver.toString()})()`)
 const save=()=>fs.writeFileSync(output,JSON.stringify(proof,null,2))
 proof.documentBinding=await evaluate('({timeOrigin:performance.timeOrigin,url:location.href})')
 save()
 const until=async(label,read,accept,maximumMs=10000,deadline)=>{
  const started=performance.now(),samples=[];let value
  do{if(deadline!==undefined&&performance.now()>=deadline)break;value=await read();const at=performance.now();samples.push({at,value});if((deadline===undefined||at<deadline)&&accept(value)){proof.operations.push({label,classification:'actual observed state',samples,...(deadline===undefined?{}:{deadline})});save();return value}const remaining=deadline===undefined?75:deadline-performance.now();if(remaining<=0)break;await wait(Math.min(75,remaining))}while(performance.now()-started<maximumMs&&(deadline===undefined||performance.now()<deadline))
  proof.failure={label,samples,...(deadline===undefined?{}:{deadline,finishedAt:performance.now()})};save();assert.fail(label+' did not reach its required actual state')
 }
 const coordinate=createParityCoordinate({call,evaluate,native,wait,identity:proof.identity,documentBinding:()=>proof.documentBinding,proof,save})
 const reloadDocument=createParityReload({call,evaluate,wait,proof,save})
 const textCoordinate=async(scope,text)=>{
  const index=await evaluate(`(()=>{const list=[...document.querySelectorAll(${JSON.stringify(scope+' button')})];return list.findIndex(e=>e.textContent.trim()===${JSON.stringify(text)})})()`)
  assert(index>=0,'missing visible business control '+text)
  const selector=await evaluate(`(()=>{const e=document.querySelectorAll(${JSON.stringify(scope+' button')})[${index}];e.dataset.macParityTarget='current';return '[data-mac-parity-target="current"]'})()`)
  try{return await coordinate(selector)}finally{await evaluate(`document.querySelector(${JSON.stringify(selector)})?.removeAttribute('data-mac-parity-target')`)}
 }
 const recordedInput=async(method,parameters)=>{proof.inputEvents.push({method,parameters,at:performance.now()});save();return call(method,parameters)}
 const key=async(key,code,additional={})=>{for(const type of ['keyDown','keyUp'])await recordedInput('Input.dispatchKeyEvent',{type,key,code,...additional})}
 const type=async(selector,value)=>{
  let previous
  const prepared=await until('actual editable stable input '+selector,async()=>({native:await native(),field:await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e?.isConnected)return{exists:false};const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,ancestors=[];let runningAnimations=0;for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);ancestors.push(Number(s.opacity)>=.999&&s.visibility==='visible'&&s.display!=='none');runningAnimations+=n.getAnimations().filter(a=>a.playState==='running'||a.pending).length}return{exists:true,tag:e.tagName,type:e.type,disabled:e.disabled,readOnly:e.readOnly,inert:!!e.closest('[inert]'),value:e.value,focused:document.activeElement===e,selectionStart:e.selectionStart,selectionEnd:e.selectionEnd,bounds:r.toJSON(),hit:r.width>0&&r.height>0&&x>0&&y>0&&x<innerWidth&&y<innerHeight&&e.contains(document.elementFromPoint(x,y)),ancestorsVisible:ancestors.every(Boolean),runningAnimations}})()`)}),row=>{const ready=nativeInputLayoutReady(row,previous);previous=row;return ready})
  assertEditableNativeTextInput(prepared.field)
  // Reuse the real native editing command and observed focus/selection guard.
  // Every dispatched key and insert is retained; no DOM value is assigned.
  const replacement=await require('./verify-favorites-113.cjs').replaceNativeInput(coordinate,recordedInput,async expression=>{const observation=await evaluate(expression);(proof.inputObservations??=[]).push({selector,at:performance.now(),observation});save();return observation},selector,value,'darwin')
  proof.operations.push({label:'native text input replacement',selector,prepared,replacement});save()
  await key('Tab','Tab',{windowsVirtualKeyCode:9})
 }
 const route=async(id,expectedLayout,deadline=expectedLayout?performance.now()+10000:undefined)=>{
  let position
  const coordinateOptions={expectedLayout,deadline}
  if(id==='accounts'){
   await route('home',expectedLayout,deadline);position=await coordinate('.account-provider',coordinateOptions)
   await until('actual accounts page',()=>evaluate(`({ready:document.querySelector('.page-title')?.textContent.trim()==='账号',text:document.querySelector('.account-type-tabs')?.innerText})`),r=>r.ready,10000,deadline)
  }else{
   if(['mods','packs','shaders','recordings','projections','bridge','servers'].includes(id)&&!await evaluate(`document.querySelector('[data-nav=resources]')?.getAttribute('aria-expanded')==='true'`))await coordinate('[data-nav=resources]',coordinateOptions)
   position=await coordinate(`[data-nav=${id}]`,coordinateOptions)
   await until('actual route '+id,()=>evaluate(`({...window.__macParityObserver.route(${JSON.stringify(ROUTE_COMPONENTS[id])}),route:document.querySelector('[data-nav][aria-current=page]')?.dataset.nav})`),r=>r.route===id&&r.component===ROUTE_COMPONENTS[id]&&!r.transition.includes('fade-enter-active')&&!r.transition.includes('fade-leave-active'),10000,deadline)
  }
  return position
 }
 const screenshot=async name=>{
  const file=path.resolve('release/ui-refinement-black-orange',name+'.png')
  assert(!fs.existsSync(file),'new scene screenshots must not overwrite an earlier sample')
  const data=Buffer.from((await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data,'base64')
  fs.writeFileSync(file,data,{flag:'wx'});const row={screenshot:name+'.png',bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};proof.screenshots.push(row);save();return row
 }
 const accounts=()=>evaluate("window.kamucl.invoke('accounts:list')"),selected=()=>evaluate("window.kamucl.invoke('accounts:selected')"),state=()=>evaluate("window.kamucl.invoke('mascots:state')")
 const firstFile=path.resolve('out/mac-parity-first.json')
 try{
  if(phase==='restart'){
   const first=JSON.parse(fs.readFileSync(firstFile,'utf8'));assert.equal(first.complete,true)
   proof.restart={publicAccountsPersisted:false,mascotCountsPersisted:false,settingsPersisted:false,favoritePersisted:false}
   const actualAccounts=(await accounts()).map(publicAccount),actualSelected=publicAccount(await selected()),actualState=await state(),settings=await evaluate("window.kamucl.invoke('settings:get')"),favorites=await evaluate("window.kamucl.invoke('mods:favorites')")
   assert.deepEqual(actualAccounts,first.persisted.accounts);assert.deepEqual(actualSelected,first.persisted.selected)
   assert.deepEqual(actualState.counts,first.persisted.mascots.counts);assert.deepEqual(actualState.sound,first.persisted.mascots.sound)
   assert.equal(settings.theme,first.persisted.theme);assert.equal(stableHash(settings),first.persisted.settingsSHA256,'all actual settings must survive the native process restart');assert.deepEqual(favorites,first.persisted.favorites)
   Object.assign(proof.restart,{publicAccountsPersisted:true,mascotCountsPersisted:true,settingsPersisted:true,favoritePersisted:true,actualPublicAccounts:actualAccounts,actualSelectedAccount:actualSelected,actualMascotState:actualState,actualTheme:settings.theme})
   require('./verify-mac-parity.cjs').assertRestartIdentity(first.identity,{...proof.identity,...proof.restart})
   await route('accounts');await until('restart selected UI account',()=>evaluate(`({names:[...document.querySelectorAll('.account-name')].map(e=>e.textContent.trim()),selected:document.querySelector('.account-row.selected .account-name')?.textContent.trim()})`),r=>r.selected?.startsWith(first.persisted.selected.username))
   await coordinate('.account-row:not(.selected) .remove-btn')
   await until('native remove persists and retains selected account',accounts,r=>r.length===1&&r[0].id===first.persisted.selected.id)
   proof.restart.accountDeletion={actualAccounts:(await accounts()).map(publicAccount),selected:publicAccount(await selected())}
   Object.assign(proof.restart,await screenshot('mac-parity-restart-account-persistence'))
  }else{
   await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
   // No account handlers or service handlers are replaced in this module.
   assert.equal((await accounts()).length,0,'a new private profile has no player accounts')
   await route('accounts');await textCoordinate('.account-type-tabs','离线登录')
   await type('.add-input-wrap input','bad name')
   assert(await evaluate(`document.querySelector('.add-btn').disabled&&document.querySelector('.field-error').textContent.includes('3-16')`),'invalid username stays rejected in the actual form')
   for(const name of ['MacParity_A','MacParity_B']){
    await type('.add-input-wrap input',name);await coordinate('.add-btn')
    await until('native offline account '+name,accounts,list=>list.some(a=>a.username===name&&a.type==='offline'))
   }
   const ownedAccounts=await accounts();assert.equal(ownedAccounts.length,2)
   await until('both offline rows appear',()=>evaluate(`document.querySelectorAll('.account-row').length`),n=>n===2)
   await coordinate('.account-row:first-child')
   await until('coordinate account selection persisted',selected,a=>a?.id===ownedAccounts[0].id)
   proof.offlineAccounts={classification:'Actual offline UI and product IPC persistence; no authenticated-account substitute',accounts:ownedAccounts.map(publicAccount),selected:publicAccount(await selected()),storageStatus:await evaluate("window.kamucl.invoke('app:systemInfo').then(x=>x.credentialStorage)")}
   for(const account of ownedAccounts)assert(!Object.keys(account).some(key=>/token|password|secret/i.test(key)),'public accounts do not contain credentials')
   await screenshot('mac-parity-first-offline-accounts')
   for(const theme of THEMES){
    const custom={colors:{bg:'#171520',card:'#242232',accent:'#8759cd',text:'#f6f2ff',textDim:'#bcb7cc',border:'#4a455c',sidebarBg:'#201d2b',sidebarText:'#e5dff2',bannerText:'#ffffff'}}
    await evaluate(`window.kamucl.invoke('settings:set',{theme:${JSON.stringify(theme)},${theme==='custom'?'custom:'+JSON.stringify(custom):''}})`)
    await reloadDocument(theme,'saved real theme and mounted root '+theme)
    await evaluate(`(${installMacParityObserver.toString()})()`)
    for(const[width,height,zoom]of LAYOUTS){
     const expectedLayout={width,height,zoom},layoutStartedAt=performance.now(),layoutDeadline=layoutStartedAt+10000
     proof.operations.push({label:'request native navigation layout',classification:'Requested layout, not an actual geometry observation; renderer viewport comparison rounds original native contentBounds / original zoom to whole CSS pixels',requestedLayout:expectedLayout,startedAt:layoutStartedAt,deadline:layoutDeadline});save()
     await main(`(()=>{const w=testElectron.BrowserWindow.getAllWindows().find(w=>w.id===${proof.identity.windowId}&&w.webContents.id===${proof.identity.webContentsId});if(!w)throw Error('Owned parity window unavailable');w.setSize(${width},${height});w.webContents.setZoomFactor(${zoom})})()`)
     for(const id of ROUTES){
      const point=await route(id,expectedLayout,id===ROUTES[0]?layoutDeadline:performance.now()+10000)
      await until('settled page transition '+id,()=>evaluate(`({rows:document.querySelectorAll('.content>.route-view').length,running:document.querySelector('.content')?.getAnimations({subtree:true}).filter(a=>a.playState==='running'&&a.effect?.target?.classList?.contains('route-view')).length})`),v=>v.rows===1&&v.running===0)
      const observed=await evaluate(`(()=>{const c=document.querySelector('.content'),s=getComputedStyle(document.querySelector('.shell'));return{...window.__macParityObserver.route(${JSON.stringify(ROUTE_COMPONENTS[id])}),selectedRoute:${JSON.stringify(id)}==='accounts'&&document.querySelector('.page-title')?.textContent.trim()==='账号'?'accounts':document.querySelector('[data-nav][aria-current=page]')?.dataset.nav,actualTheme:document.documentElement.dataset.theme,renderer:{width:innerWidth,height:innerHeight,hasFocus:document.hasFocus(),hidden:document.hidden,pixelRatio:devicePixelRatio},layout:{horizontalOverflow:c.scrollWidth>c.clientWidth+3,scrollWidth:c.scrollWidth,clientWidth:c.clientWidth,pageTitle:c.querySelector('.page-title')?.textContent.trim(),surface:s.backgroundColor,colour:s.color,blur:s.backdropFilter,checkboxes:[...c.querySelectorAll('input[type=checkbox]')].slice(0,20).map(e=>({appearance:getComputedStyle(e).appearance,checked:e.checked,mixed:e.indeterminate,disabled:e.disabled}))},renderAvailability:{skinCanvas:!!document.querySelector('.viewer3d canvas'),fallback:document.querySelector('.viewer3d-fallback')?.textContent||null}}})()`)
      const currentNative=await native(proof.identity),layoutDifferences=['width','height','zoom'].map(field=>({field,requested:expectedLayout[field],actual:field==='zoom'?currentNative.zoom:currentNative.bounds[field]})).filter(row=>row.actual!==row.requested)
      const row={theme,width,height,zoom,requestedLayout:expectedLayout,layoutDifferences,route:id,coordinate:point,native:currentNative,...observed,...await screenshot('mac-parity-first-'+theme+'-'+id+'-'+width+'-'+String(zoom).replace('.','p'))}
      proof.navigation.push(row);save()
      assert.equal(row.selectedRoute,id);assert.equal(row.actualTheme,theme);assert(!row.layout.horizontalOverflow,'actual page has horizontal overflow: '+JSON.stringify(row))
     }
    }
   }
   assertNavigationCoverage(proof.navigation)
   await main(`(()=>{const w=testElectron.BrowserWindow.getAllWindows()[0];w.setSize(1280,900);w.webContents.setZoomFactor(1)})()`)
   await evaluate("window.kamucl.invoke('settings:set',{theme:'black-orange'})");await reloadDocument('black-orange','return theme and mounted root for restart')
   await evaluate(`(${installMacParityObserver.toString()})()`)
   await route('settings')
   proof.settingsCategories=[]
   for(const[scope,labels]of[['启动器设置',['外观','行为与登录','下载','功能与插件','关于与更新']],['游戏设置',['运行环境','游戏窗口','目录与隔离']]]){
    await textCoordinate('.settings-scopes',scope)
    for(const label of labels){await textCoordinate('.settings-categories',label);const actual=await until('actual settings category '+label,()=>evaluate(`({label:document.querySelector('.settings-categories [aria-current=page]')?.textContent.trim(),scope:document.querySelector('.settings-scopes [aria-current=page]')?.textContent.trim(),body:document.querySelector('.settings-body')?.innerText})`),r=>r.label===label&&r.scope===scope&&!!r.body);proof.settingsCategories.push({...actual,...await screenshot('mac-parity-first-settings-category-'+proof.settingsCategories.length)});save()}
   }
   await route('home')
   await evaluate("window.kamucl.invoke('mascots:sound',{muted:false,volume:.5})")
   const legacySeed={batchId:'mac-parity-history-'+crypto.randomUUID(),hits:['q3','qiqi','biyuehu','hongshu','milo','muchuanbei']};await evaluate(`window.kamucl.invoke('mascots:batch',${JSON.stringify(legacySeed)})`);proof.legacySeed={classification:'Disposable historical-data fixture via real product increment IPC, not retired characters rendered or clicked',batch:legacySeed}
   const baseline=await state();proof.mascotBaseline=baseline
   // Original sources and DOM contacts are observed, never delayed or changed.
   await evaluate(`(()=>{const p=window.__macParityQueue={clicks:[],contacts:[],audio:[],contexts:[],busyVisible:false};p.originalContext=window.AudioContext;p.originalStart=AudioBufferSourceNode.prototype.start;window.AudioContext=new Proxy(p.originalContext,{construct(t,a){const c=new t(...a);p.contexts.push(c);return c}});AudioBufferSourceNode.prototype.start=function(...args){const role=this.kamuclInitialization?.role==='silent-slap-buffer'?'initialization':'palm',values=this.buffer?.getChannelData(0);let peak=0;if(values)for(const value of values)peak=Math.max(peak,Math.abs(value));p.audio.push({at:performance.now(),audioTime:this.context.currentTime,scheduledAt:args[0]??0,role,duration:this.buffer?.duration,peak});return p.originalStart.apply(this,args)};p.clickObserver=(${createQueueClickObserver.toString()})(p,()=>document.querySelector('.mascot-stage').dataset,()=>performance.now());document.addEventListener('click',p.clickObserver.before,true);document.addEventListener('click',p.clickObserver.after,false);p.observer=new MutationObserver(()=>{const e=document.querySelector('.mascot-stage');if(e){const contacts=Number(e.dataset.contacts);if(contacts>0&&contacts!==p.contacts.at(-1)?.contacts)p.contacts.push({at:performance.now(),contacts,contactAt:Number(e.dataset.contactAt),cycleId:Number(e.dataset.cycleId)})}if(document.body.innerText.includes('拍打队列已满，请稍候'))p.busyVisible=true});p.observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-contacts','data-contact-at'],childList:true})})()`)
   try{
    await coordinate('.brand-avatar')
    const before=await until('model and feedback really ready',()=>evaluate(`(()=>{const e=document.querySelector('.mascot-stage'),b=document.querySelector('[data-hit=kamu]');return{ready:!!e&&!b.disabled&&Number(e.dataset.readyAt)>0&&e.dataset.feedbackPreparation==='decoded',phase:e?.dataset.phase,queue:Number(e?.dataset.queue),contacts:Number(e?.dataset.contacts),count:Number(b?.getAttribute('aria-label')?.match(/累计 (\\d+) 次/)?.[1]),accepted:Number(e?.dataset.acceptedClicks||0),rejected:Number(e?.dataset.rejectedClicks||0)}})()`),r=>r.ready&&r.phase==='front')
    assert.equal(before.count,baseline.counts.kamu||0,'first activation never counts')
    const position=await coordinatePosition(evaluate,'[data-hit=kamu]')
    proof.queueDispatches=[]
    assert(!fs.existsSync(path.resolve('out/mac-parity-queue-burst-black-orange')),'original queue recording directory must be new')
    let dispatchError
    const recording=await recordScreencast('mac-parity-queue-burst',async()=>{
     const pending=[]
     for(let i=0;i<40;i++)for(const[type,buttons]of[['mousePressed',1],['mouseReleased',0]]){const args={type,...position,button:'left',buttons,clickCount:1};proof.queueDispatches.push({index:proof.queueDispatches.length,at:performance.now(),args});pending.push(call('Input.dispatchMouseEvent',args))}
     try{await Promise.all(pending)}catch(error){dispatchError=error;proof.queueDispatchFailure={name:error.name,message:error.message}}
    },7000)
    proof.queueRecording=recording;save();if(dispatchError)throw dispatchError
    const after=await until('every accepted click contacts and persists then returns front',()=>evaluate(`(async()=>{const e=document.querySelector('.mascot-stage'),b=document.querySelector('[data-hit=kamu]'),saved=await window.kamucl.invoke('mascots:state');return{phase:e.dataset.phase,queue:Number(e.dataset.queue),contacts:Number(e.dataset.contacts),count:Number(b.getAttribute('aria-label').match(/累计 (\\d+) 次/)[1]),persistedCount:saved.counts.kamu}})()`),r=>r.phase==='front'&&r.queue===0&&r.persistedCount===r.count,20000)
    const ledger=await evaluate(`(()=>{const p=window.__macParityQueue;return{clicks:p.clicks,contacts:p.contacts,audio:p.audio,busyVisible:p.busyVisible}})()`)
    proof.queue={before,after,ledger,recording,classification:'Actual original trusted input queue and synchronous product acceptance/rejection counters, original contact/audio timeline. CDP wall-clock recording is retained diagnostically and is not used as formal presented-FPS evidence.'};save()
    proof.queue.result=assertQueueLedger(ledger,before,after)
    await coordinate('.menu-tool');await textCoordinate('.sound-panel','恢复 LOGO')
    await until('queue close actually releases contexts and renderer',()=>evaluate(`({stage:!!document.querySelector('.mascot-stage'),audio:window.__macParityQueue.contexts.map(c=>c.state),avatarFocused:document.activeElement===document.querySelector('.brand-avatar')})`),r=>!r.stage&&r.audio.length>0&&r.audio.every(x=>x==='closed')&&r.avatarFocused)
   }finally{await evaluate(`(()=>{const p=window.__macParityQueue;p.observer.disconnect();document.removeEventListener('click',p.clickObserver.before,true);document.removeEventListener('click',p.clickObserver.after,false);AudioBufferSourceNode.prototype.start=p.originalStart;window.AudioContext=p.originalContext})()`);save()}
   // A real project is fetched from the public service; no search/files/plan
   // handler is substituted. Only the target instance metadata is synthetic.
   proof.realService={source:'modrinth',projectId:'P7dR8mSH',classification:'Actual native UI / real public API and CDN / real prepared dependency plan and commit; synthetic MC1.20.1 Fabric target, not a game-launch claim',complete:false};save()
   const targetMetadata=path.join(games,'versions','联机验证实例','联机验证实例.json'),syntheticTarget=JSON.parse(fs.readFileSync(targetMetadata,'utf8'));syntheticTarget._loaderVersion='0.16.14';fs.writeFileSync(targetMetadata,JSON.stringify(syntheticTarget));proof.realService.syntheticTargetMetadata=syntheticTarget
   const project=await evaluate("window.kamucl.invoke('community:project','modrinth','P7dR8mSH','mod')")
   assert.equal(project.source,'modrinth');assert.equal(project.projectId,'P7dR8mSH');assert.equal(project.kind,'mod');assert(project.iconUrl?.startsWith('https://'))
   await evaluate(`window.kamucl.invoke('mods:favorite',${JSON.stringify({source:project.source,projectId:project.projectId,name:project.title,iconUrl:project.iconUrl})},true)`)
   await route('community');await coordinate('[data-ui="community:favorites"]')
   const icon=await until('real favorite icon actually decoded',()=>evaluate(`(()=>{const e=document.querySelector('[data-favorite-key="modrinth:P7dR8mSH"]'),i=e?.querySelector('.favorite-icon img');return{ready:!!i&&i.complete&&i.naturalWidth>0,width:i?.naturalWidth,height:i?.naturalHeight,url:i?.currentSrc,title:e?.innerText}})()`),r=>r.ready,20000)
   proof.realService.project=project;proof.realService.icon=icon;await screenshot('mac-parity-first-real-favorite-icon')
   await coordinate('[data-favorite-key="modrinth:P7dR8mSH"] .favorite-download')
   await until('real file dialog appears',()=>evaluate(`!!document.querySelector('.download-modal')`),v=>v)
   // Forward each original install handler exactly once. This observes real
   // prepared plans/commits without depending on production setup closures or
   // substituting network, dependency, compatibility or download responses.
   proof.realService.handlerRegistration=await main(`(()=>{globalThis.macParityInstallTrace=(${createInstallHandlerObserver.toString()})(testElectron.ipcMain,['community:files','mods:prepare','mods:commit']);return macParityInstallTrace.registration})()`)
   await preserveInstallObservation(async()=>{
   await evaluate("(()=>{if(window.__macParityCommitProgress)throw Error('Existing original progress observer');const rows=[],off=window.kamucl.on('event:progress',value=>rows.push({receivedAt:Date.now(),value}));window.__macParityCommitProgress={rows,off};return true})()")
   save()
   await type('.download-modal input[list="mod-minecraft-versions"]','1.20.1')
   await until('actual entered Minecraft filter',()=>evaluate(`document.querySelector('.download-modal input[list="mod-minecraft-versions"]')?.value`),value=>value==='1.20.1')
   // A real pointer focus change commits the input change. A Tab event alone
   // must not imply a new filter request or make pre-existing rows current.
   await coordinate('.download-modal .filter-row .select-menu-btn')
   await textCoordinate('.select-menu-float','Fabric')
   let matchingCall
   const filtered=await until('real compatible file response',async()=>{
    const selection=await evaluate(`(${readDownloadSelectionState.toString()})()`)
    const calls=await main(`macParityInstallTrace.calls`)
    matchingCall=calls.filter(row=>row.channel==='community:files'&&row.arguments?.[0]==='modrinth'&&row.arguments?.[1]==='P7dR8mSH'&&row.arguments?.[2]?.mcVersion==='1.20.1'&&row.arguments?.[2]?.loader==='fabric').at(-1)
    return{selection,response:matchingCall?{index:matchingCall.index,startedAt:matchingCall.startedAt,completedAt:matchingCall.completedAt,error:matchingCall.error,fileIds:matchingCall.result?.map(row=>row.fileId)}:null}
   },row=>{try{assertMatchingDownloadResponse(row.selection,matchingCall);return true}catch{return false}},30000)
   proof.realService.filterSelection=filtered;proof.realService.filteredFile=assertMatchingDownloadResponse(filtered.selection,matchingCall);proof.realService.completedFileResponse=matchingCall;save()
   const expectedTarget={id:'联机验证实例',mcVersion:'1.20.1',loader:'fabric',folder:fs.realpathSync.native(games)}
   const targetLabel=expectedTarget.id+' · '+expectedTarget.mcVersion+' / '+expectedTarget.loader+' · '+expectedTarget.folder
   await coordinate('.download-modal > .select-menu-btn')
   await textCoordinate('.select-menu-float',targetLabel)
   const selectedTarget=await until('real intended download target',()=>evaluate(`(${readDownloadSelectionState.toString()})()`),row=>{try{assertMatchingDownloadResponse(row,matchingCall);assertDownloadTargetSelection(row,expectedTarget);return true}catch{return false}})
   proof.realService.targetSelection=selectedTarget;proof.realService.targetOption=assertDownloadTargetSelection(selectedTarget,expectedTarget);save()
   await screenshot('mac-parity-first-real-file-target-selection')
   const modsDirectory=path.join(games,'versions',expectedTarget.id,'mods'),beforeFiles=fs.readdirSync(modsDirectory).sort(),beforeCommitCalls=await main("macParityInstallTrace.calls.filter(c=>c.channel==='mods:commit')");assert.equal(beforeCommitCalls.length,0)
   const browseActions=[],recordBrowse=async(label)=>{const click=proof.operations.filter(row=>row.complete&&row.trustedTargets).at(-1)?.trustedTargets.records.find(row=>row.type==='click');assert(click?.isTrusted&&Number.isFinite(click.timeOrigin)&&Number.isFinite(click.at),'browsing must retain its original trusted control click');const calls=await main('macParityInstallTrace.calls'),preparing=calls.find(c=>c.channel==='mods:prepare');browseActions.push({label,at:click.timeOrigin+click.at,originalTrustedClick:click,observedAt:Date.now(),prepareStartedAt:preparing?.startedAt,prepareCompletedAt:preparing?.completedAt,state:await evaluate(`(${readCommunityQueueState.toString()})()`),classification:'at binds the original native control click; state is a later read, and native search value is independently checked'});save()}
   await textCoordinate('.download-modal .modal-actions','加入队列并检测')
   const accepted=await until('real queue accepted and original prepare started',async()=>{const state=await evaluate(`(${readCommunityQueueState.toString()})()`),calls=await main('macParityInstallTrace.calls');const prepare=calls.find(c=>c.channel==='mods:prepare');if(prepare?.error)throw Error('Original preparation failed: '+prepare.error.message);return{state,prepare}},row=>{try{assertCommunityQueuePrepare(row.state,row.prepare,proof.realService.filteredFile,expectedTarget);return true}catch{return false}})
   const queueId=assertCommunityQueuePrepare(accepted.state,accepted.prepare,proof.realService.filteredFile,expectedTarget).id;proof.realService.queueAcceptance=accepted;save()
   // Use the original native editable control and routes immediately, before
   // waiting for the public plan. Natural service timing is recorded honestly.
   await type('input[aria-label="搜索收藏模组"]','P7dR8mSH');await recordBrowse('actual native favorite search while queue is active')
   assert.equal(await evaluate('document.querySelector(\'input[aria-label="搜索收藏模组"]\')?.value'),'P7dR8mSH');assert(await evaluate("!!document.querySelector('[data-favorite-key=\"modrinth:P7dR8mSH\"]')"))
   await route('home');await recordBrowse('actual home route while queue is active');assert.equal(browseActions.at(-1).state.route,'home');assert.equal(browseActions.at(-1).state.blocked,false)
   await route('community');await recordBrowse('actual community return preserves queued request')
   const returned=await main("macParityInstallTrace.calls.find(c=>c.channel==='mods:prepare')");assert.equal(assertCommunityQueuePrepare(browseActions.at(-1).state,returned,proof.realService.filteredFile,expectedTarget).id,queueId)
   const prepared=await until('real queue awaits explicit install confirmation',async()=>{const state=await evaluate(`(${readCommunityQueueState.toString()})()`),calls=await main('macParityInstallTrace.calls');assert.equal(calls.filter(c=>c.channel==='mods:commit').length,0,'prepare and browsing must never auto-commit');const prepare=calls.find(c=>c.channel==='mods:prepare');if(prepare?.error||state.items.some(item=>item.state==='failed'))throw Error(prepare?.error?.message||state.items[0].status);return{state,prepare}},row=>row.state.items.length===1&&row.state.items[0].id===queueId&&row.state.items[0].state==='confirmation'&&!!row.prepare?.completedAt,60000)
   assert.deepEqual(fs.readdirSync(modsDirectory).sort(),beforeFiles,'preparation must not write the target MOD directory before explicit confirmation')
   proof.realService.backgroundBrowse=classifyPreparationBrowse(prepared.prepare,browseActions);proof.realService.queuePrepared=prepared;save();await screenshot('mac-parity-first-real-background-queue')
   await coordinate('[data-ui="community:queue-shortcut"]');await textCoordinate('.community-queue .queue-actions','确认前置与安装')
   const confirmation=await until('actual visible completed queue plan',()=>evaluate(`(${readCommunityConfirmation.toString()})()`),r=>!!r.file&&!!r.target&&!!r.plan)
   const plan=assertCommunityQueueConfirmation(confirmation,prepared.prepare,proof.realService.filteredFile,expectedTarget,queueId),chosen={file:confirmation.file,target:confirmation.target};proof.realService.chosen=chosen;proof.realService.confirmation=confirmation;save()
   assert(chosen.file&&chosen.file.sha1&&chosen.file.projectId==='P7dR8mSH','actual visible queue confirmation receives selected public file with service hash')
   assert(chosen.file.gameVersions.includes('1.20.1')&&chosen.file.loaders.includes('fabric'),'the actual selected file is compatible')
   const visiblePlan=await evaluate("(()=>{const e=document.querySelector('.community-confirm'),button=e?.querySelector('.modal-actions .btn-gold'),choice=e?.querySelector('.dependency-choice input');return{present:!!e,enabled:!!button&&!button.disabled,rows:e?.querySelectorAll('.dependency-row').length,error:e?.querySelector('.modal-error')?.textContent,dependenciesChecked:choice?choice.checked:null}})()")
   assert(visiblePlan.present&&visiblePlan.enabled&&!visiblePlan.error);assert.equal(visiblePlan.rows,plan.files.length);if(plan.files.some(file=>file.dependency))assert.equal(visiblePlan.dependenciesChecked,true,'necessary dependencies require explicit included confirmation');proof.realService.visiblePlan=visiblePlan
   const observedPlans=await main(`macParityInstallTrace.calls.filter(c=>c.channel==='mods:prepare'&&c.completedAt)`);proof.realService.originalHandlerTrace=await main(`macParityInstallTrace.calls`);save()
   const observedPlan=observedPlans.filter(row=>row.arguments[0].id===expectedTarget.id&&row.arguments[0].folder===chosen.target.folder&&row.arguments[1]?.file?.fileId===chosen.file.fileId);assert.equal(observedPlan.length,1,'exactly one completed original prepare for the actual selected target and public file');assert(!observedPlan[0].error)
   assert.deepEqual(plan,observedPlan[0].result)
   proof.realService.plan=plan;save()
   assert(!plan.warnings.length,'real dependency plan has no compatibility warnings')
   assert.equal(plan.target.id,'联机验证实例');assert.equal(fs.realpathSync.native(plan.target.folder),fs.realpathSync.native(games));assert.deepEqual(observedPlan[0].arguments[0],{id:plan.target.id,folder:plan.target.folder})
   proof.realService.file=chosen.file;proof.realService.plan=plan;await screenshot('mac-parity-first-real-install-plan');save()
   assert.equal((await main("macParityInstallTrace.calls.filter(c=>c.channel==='mods:commit')")).length,0,'opening the prepared confirmation must not commit')
   await coordinate('.community-confirm .modal-actions .btn-gold')
   await until('real queued install completes without swallowing failure',async()=>{const state=await evaluate(`(${readCommunityQueueState.toString()})()`),calls=await main("macParityInstallTrace.calls.filter(c=>c.channel==='mods:commit')");if(state.items.some(item=>item.state==='failed')||calls.some(call=>call.error))throw Error(state.items.find(item=>item.state==='failed')?.status||calls.find(call=>call.error).error.message);return{state,calls}},r=>!r.state.blocked&&r.state.items.length===1&&r.state.items[0].id===queueId&&r.state.items[0].state==='completed'&&r.calls.length===1&&!!r.calls[0].completedAt,90000)
   const installed=path.join(games,'versions','联机验证实例','mods',chosen.file.fileName),stats=fs.statSync(installed)
   const bytes=fs.readFileSync(installed),actualSHA1=crypto.createHash('sha1').update(bytes).digest('hex')
   assert.equal(actualSHA1,chosen.file.sha1);assert.equal(stats.size,chosen.file.size)
   const observedCommit=await main(`macParityInstallTrace.calls.filter(c=>c.channel==='mods:commit'&&c.completedAt)`);assert.equal(observedCommit.length,1)
   proof.realService.commitOperation=assertActualCommitTrace(observedCommit[0],plan,observedPlan[0].arguments[2],await evaluate('window.__macParityCommitProgress.rows'));save()
   proof.realService.installed={relative:path.relative(games,installed),bytes:stats.size,sha1:actualSHA1,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),declaredSHA1:chosen.file.sha1,target:plan.target};proof.realService.complete=true
   await screenshot('mac-parity-first-real-install-complete')
   },()=>collectAndRestoreCommitObservation(evaluate,main,proof.realService),proof.realService,save)
   const finalSettings=await evaluate("window.kamucl.invoke('settings:get')")
   proof.persisted={accounts:(await accounts()).map(publicAccount),selected:publicAccount(await selected()),mascots:await state(),favorites:await evaluate("window.kamucl.invoke('mods:favorites')"),theme:finalSettings.theme,settingsSHA256:stableHash(finalSettings)}
   assert.equal(proof.persisted.accounts.length,2);assert.equal(proof.persisted.theme,'black-orange')
  }
  proof.complete=true;proof.finishedAt=new Date().toISOString();save()
 }catch(error){preservePrimaryFailure(proof,error,save);try{await screenshot('mac-parity-'+phase+'-failure')}catch{}throw error}
 finally{try{proof.trustedTargetObserverRestoration=await evaluate(require('./qa-coordinate-geometry114.cjs').trustedTargetRestoreExpression());save();assert.equal(proof.trustedTargetObserverRestoration.complete,true)}catch(error){proof.complete=false;proof.trustedTargetRestorationError={name:error.name,message:error.message};save();if(!proof.error){preservePrimaryFailure(proof,error,save);throw error}}}
}
async function coordinatePosition(evaluate,selector){return evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('actual queue hit target obscured');return{x,y}})()`)}
Object.assign(module.exports,{ROUTES,THEMES,LAYOUTS,ROUTE_COMPONENTS,assertEditableNativeTextInput,nativeInputLayoutReady,nativeNavigationLayoutReady,assertNavigationCoverage,assertQueueLedger,publicAccount,stableHash,installMacParityObserver,readDownloadSelectionState,assertMatchingDownloadResponse,assertDownloadTargetSelection,readMountedInstallInput,readCommunityQueueState,readCommunityConfirmation,assertCommunityQueuePrepare,assertCommunityQueueConfirmation,classifyPreparationBrowse,assertActualCommitTrace,createQueueClickObserver,createInstallHandlerObserver,restoreInstallHandlerObserver,preserveInstallObservation,collectAndRestoreInstallObserver,collectAndRestoreCommitObservation,preservePrimaryFailure,assertParityTrustedTarget,assertParityPointerDismissal,observePointerDismissInteger,assertPointerDismissNative,createParityCoordinate,parityReloadReady,createParityReload})
