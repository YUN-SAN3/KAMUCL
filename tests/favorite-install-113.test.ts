import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { effectScope, nextTick, reactive, ref } from 'vue'
import { validateFavoriteInstallIntent, type FavoriteInstallIntent } from '../src/shared/modFavorites'
import { FavoriteVersionQueue } from '../src/main/core/favoriteVersionQueue'
const req=createRequire(path.resolve('package.json'))
const later=<T>()=>{let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
const wait=()=>new Promise(resolve=>setTimeout(resolve,0))
async function until(predicate:()=>boolean){for(let n=0;n<100;n++){await nextTick();if(predicate())return;await wait()}assert.fail('actual component state did not settle')}

test('native favorites observer uses Mac editing command and verifies full selection and final input without changing DOM values',async()=>{
 const {replaceNativeInput}=req(path.resolve('scripts/verify-favorites-113.cjs'))
 for(const platform of ['darwin','win32']){
  const input={value:'Reese',selectionStart:5,selectionEnd:5},document={activeElement:null as any,querySelector:()=>input},calls:any[]=[]
  const click=async()=>{document.activeElement=input}
  const call=async(method:string,params:any)=>{calls.push({method,params});if(method==='Input.dispatchKeyEvent'&&params.type==='keyDown'&&(platform==='darwin'?params.modifiers===4&&params.commands?.includes('selectAll'):params.modifiers===2)){input.selectionStart=0;input.selectionEnd=input.value.length}if(method==='Input.insertText'){input.value=input.value.slice(0,input.selectionStart)+params.text+input.value.slice(input.selectionEnd);input.selectionStart=input.selectionEnd=input.value.length}}
  const evaluate=async(expression:string)=>new Function('document','return '+expression)(document)
  const state=await replaceNativeInput(click,call,evaluate,'.search input','Cloth Config',platform)
  assert.equal(state.selection.value,'Reese');assert.equal(state.selection.start,0);assert.equal(state.selection.end,5);assert.equal(state.value,'Cloth Config')
  assert.deepEqual(calls.map(c=>c.method),['Input.dispatchKeyEvent','Input.dispatchKeyEvent','Input.insertText'])
  assert.equal(calls[0].params.modifiers,platform==='darwin'?4:2);assert.deepEqual(calls[0].params.commands,platform==='darwin'?['selectAll']:undefined)
 }
 const input={value:'Reese',selectionStart:5,selectionEnd:5},document={activeElement:input,querySelector:()=>input},evaluate=async(expression:string)=>new Function('document','return '+expression)(document),calls:string[]=[]
 await assert.rejects(replaceNativeInput(async()=>{},async(method:string)=>{calls.push(method)},evaluate,'.search input','Cloth Config','darwin'),/select from the beginning/)
 assert(!calls.includes('Input.insertText'),'failed selection must not concatenate the replacement')
 input.selectionStart=0;input.selectionEnd=5
 await assert.rejects(replaceNativeInput(async()=>{},async(method:string,params:any)=>{if(method==='Input.insertText')input.value+=params.text},evaluate,'.search input','Cloth Config','darwin'),/ReeseCloth Config/)
})

test('extension GUI fixture preserves modern and legacy favorite query contracts, late loader responses, and valid renderer expressions',async()=>{
 const parser=req('@babel/parser'),vm=req('node:vm'),source=fs.readFileSync('scripts/verify-extension-ui.cjs','utf8'),ast=parser.parse(source),expressions:string[]=[]
 function visit(value:any){
  if(!value||typeof value!=='object')return
  if(value.type==='CallExpression'&&value.callee.type==='Identifier'){
   const name=value.callee.name
   if(['evaluate','main','ready'].includes(name))for(const argument of name==='ready'?value.arguments.slice(1):value.arguments.slice(0,1))if(argument.type==='StringLiteral'){
    parser.parse(argument.value,{allowAwaitOutsideFunction:true});expressions.push(argument.value)
   }
  }
  for(const child of Object.values(value))if(Array.isArray(child))child.forEach(visit);else if(child&&typeof child==='object')visit(child)
 }
 visit(ast)
 const fixtureExpression=expressions.find(expression=>expression.startsWith('globalThis.extensionFavoriteRequests=[];'))
 assert(fixtureExpression);const handlers=new Map<string,Function>(),context:any={Date,Promise,setTimeout,testElectron:{ipcMain:{removeHandler:(key:string)=>handlers.delete(key),handle:(key:string,fn:Function)=>handlers.set(key,fn)}}}
 vm.runInNewContext(fixtureExpression,context)
 const query=handlers.get('mods:favoriteVersions')!,fabric=query(null,'modrinth','fixtureProject','26.3','fabric','native-ticket-fabric'),forge=query(null,'modrinth','fixtureProject','26.3','forge','native-ticket-forge')
 const forgeResult=await forge,fabricResult=await fabric
 assert.equal(forgeResult.status,'available');assert.equal(forgeResult.files[0].fileId,'forge-file');assert.equal(fabricResult.files[0].fileId,'fabric-file')
 const requests=context.extensionFavoriteRequests
 assert.deepEqual(Array.from(requests,(r:any)=>[r.source,r.project,r.mc,r.loader]),[['modrinth','fixtureProject','26.3','fabric'],['modrinth','fixtureProject','26.3','forge']])
 assert(requests.find((r:any)=>r.loader==='forge').finishedAt<requests.find((r:any)=>r.loader==='fabric').finishedAt,'the original late Fabric response remains observable')
 const legacy=await query(null,'modrinth','fixtureProject','26.3','forge');assert(Array.isArray(legacy));assert.equal(legacy[0].fileId,'forge-file')
})
function nativeFixtureExpressions(file:string){
 const parser=req('@babel/parser'),source=fs.readFileSync(file,'utf8'),ast=parser.parse(source),expressions:string[]=[]
 function visit(value:any){
  if(!value||typeof value!=='object')return
  if(value.type==='CallExpression'&&value.callee.type==='Identifier'&&['evaluate','main','ready'].includes(value.callee.name)){
   const args=value.callee.name==='ready'?value.arguments.slice(1):value.arguments.slice(0,1)
   for(const argument of args){const expression=argument.type==='StringLiteral'?argument.value:argument.type==='TemplateLiteral'&&argument.expressions.length===0?argument.quasis[0].value.cooked:undefined;if(typeof expression==='string'){parser.parse(expression,{allowAwaitOutsideFunction:true});expressions.push(expression)}}
  }
  for(const child of Object.values(value))if(Array.isArray(child))child.forEach(visit);else if(child&&typeof child==='object')visit(child)
 }
 visit(ast);return{source,expressions}
}
test('gallery favorites GUI uses reliable synthetic ticket metadata and legacy array, and requires both actual selected rows before success',async()=>{
 const vm=req('node:vm'),{source,expressions}=nativeFixtureExpressions('scripts/verify-gallery-favorites-ui.cjs'),fixtureExpression=expressions.find(expression=>expression.startsWith('globalThis.galleryFavoriteRequests=[];'))
 assert(fixtureExpression);const handlers=new Map<string,Function>(),context:any={Date,testElectron:{ipcMain:{removeHandler:(key:string)=>handlers.delete(key),handle:(key:string,fn:Function)=>handlers.set(key,fn)}}}
 vm.runInNewContext(fixtureExpression,context);const query=handlers.get('mods:favoriteVersions')!
 for(const[source,project]of[['modrinth','galleryMr'],['curseforge','987654']]){
  const result=await query(null,source,project,'26.3','fabric','ticket-'+source)
  assert.equal(result.status,'available');assert.equal(result.files.length,1);const file=result.files[0]
  assert.equal(file.source,source);assert.equal(file.projectId,project);assert.equal(file.gameVersions[0],'26.3');assert.equal(file.loaders[0],'fabric');assert.equal(file.fileName,'fixture.jar');assert.equal(file.url,'https://fixture.invalid/fixture.jar');assert.match(file.sha1,/^[a-f0-9]{40}$/);assert.equal(file.sha1,'1'.repeat(40),'synthetic hash belongs to an explicitly never-downloaded fixture')
 }
 const legacy=await query(null,'modrinth','galleryMr','26.3','fabric');assert(Array.isArray(legacy));assert.equal(legacy[0].fileId,'fixture')
 assert.deepEqual(Array.from(context.galleryFavoriteRequests,(row:any)=>[row.source,row.project,row.mc,row.loader,row.ticket]),[['modrinth','galleryMr','26.3','fabric','ticket-modrinth'],['curseforge','987654','26.3','fabric','ticket-curseforge'],['modrinth','galleryMr','26.3','fabric',undefined]])
 assert(context.galleryFavoriteRequests.every((row:any)=>row.finishedAt>=row.startedAt))
 assert(source.includes('targetRows.length===2')&&source.includes('new Set(targetRows.map(row=>row.key)).size===2')&&source.includes('row.checked===true&&row.disabled===false')&&source.includes('renderer.rows.every(row=>selectedRows.includes(row)||skippedRows.includes(row))')&&source.includes("'将安装 '+selectedRows.length+' 项收藏模组，跳过 '+skippedRows.length+' 项'")&&source.includes('request.ticket&&request.finishedAt'),'success requires both actual settled target rows, retained prior fixture favorites, exact summary and ticket requests, not names alone')
 assert(source.includes('no real downloads or game installation in this module.'))
})
test('selection GUI fixture classifies incompatible modern tickets, preserves legacy and failure, and requires explicit zero-selection decisions',()=>{
 const vm=req('node:vm'),{source,expressions}=nativeFixtureExpressions('scripts/verify-selection-ui-119.cjs'),fixtureExpression=expressions.find(expression=>expression.startsWith('globalThis.selection119Originals=new Map();'))
 assert(fixtureExpression);const handlers=new Map<string,Function>(),context:any={Date,testElectron:{ipcMain:{_invokeHandlers:handlers,removeHandler:(key:string)=>handlers.delete(key),handle:(key:string,fn:Function)=>handlers.set(key,fn)}}}
 vm.runInNewContext(fixtureExpression,context);const query=handlers.get('mods:favoriteVersions')!,modern=query(null,'modrinth','selection119','1.20.1','forge','selection-ticket')
 assert.equal(modern.status,'incompatible');assert(Array.isArray(modern.files));assert.equal(modern.files.length,0);assert(Array.isArray(query(null,'modrinth','selection119','1.20.1','forge')))
 context.selection119Reject=true;assert.throws(()=>query(null,'modrinth','selection119','1.20.1','forge','retry-ticket'),/隔离验证：兼容查询失败/);assert.throws(()=>query(null,'modrinth','selection119','1.20.1','forge'),/隔离验证：兼容查询失败/)
 assert(source.includes('没有此 Minecraft 版本与加载器的兼容文件，本次跳过'));assert(source.includes('query failure cannot silently install'));assert(source.includes('skipping the last failed favorite still requires explicit base-only confirmation'));assert(source.includes('explicit base-only restores install readiness'));assert(source.includes('no actual fixture installation'))
})
test('native game observer retains original event payloads and timestamps, removes old subscriptions, and never exposes account identifiers or credentials',()=>{
 const vm=req('node:vm'),{installFavoriteEventObserver,safeQaAccount}=req(path.resolve('scripts/verify-favorites-113.cjs')),listeners=new Map<string,Function>(),removed:string[]=[],context:any={Date,performance:{timeOrigin:1000,now:()=>12},window:{__favorite113:{off:[()=>removed.push('old')]},kamucl:{on:(channel:string,callback:Function)=>{listeners.set(channel,callback);return()=>{listeners.delete(channel);removed.push(channel)}}}}}
 vm.runInNewContext('('+installFavoriteEventObserver.toString()+')()',context);assert.deepEqual(removed,['old']);assert.equal(listeners.size,4)
 const state={status:'running',versionId:'owned-instance',launchId:'owned-test-launch'},progress={stage:'launch',progress:1,text:'fixture progress'}
 listeners.get('event:launchState')!(state);listeners.get('event:launchLog')!('fixture player joined the game');listeners.get('event:progress')!(progress)
 const observed=context.window.__favorite113;assert.equal(observed.states[0],state);assert.equal(observed.logs[0],'fixture player joined the game');assert.equal(observed.progress[0],progress);assert.equal(observed.timeline.length,3);assert.equal(observed.timeline[0].value,state);assert.equal(observed.timeline[0].rendererMs,12);assert(Number.isFinite(observed.timeline[0].receivedAt))
 vm.runInNewContext('('+installFavoriteEventObserver.toString()+')()',context);assert.equal(listeners.size,4);assert.equal(removed.length,5);assert.equal(context.window.__favorite113.states.length,0)
 assert.deepEqual(safeQaAccount({type:'offline',username:'FavoriteNativeQA',id:'private-id',uuid:'private-uuid',accessToken:'do-not-copy',refreshToken:'do-not-copy',profile:{private:'do-not-copy'}}),{type:'offline',username:'FavoriteNativeQA'});assert.equal(safeQaAccount(null),null);assert.throws(()=>safeQaAccount({type:'microsoft',username:'private-user'}),/Refuse account projection/)
 const source=fs.readFileSync('scripts/verify-favorites-113.cjs','utf8');assert(source.includes("observeGame,v=>v.joined,240000"),'actual world event and original deadline remain mandatory');assert(source.includes('selectedMatchesAdded'));assert(source.includes('launchReturn??null'));assert(source.includes('lastObservedStates'));assert(source.includes("'game:launch','game:kill'"))
})
test('native game diagnostic archives exact isolated log bytes with hashes, excludes profile and world data, rejects secrets and never overwrites evidence',(t)=>{
 const {archivePrivateGameLogs}=req(path.resolve('scripts/verify-favorites-113.cjs')),root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-qa-logs-113-'))),profile=path.join(root,'profile'),games=path.join(root,'games'),output=path.join(root,'output'),instance='test §',launch='00000000-0000-0000-0000-000000000113'
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));for(const dir of [path.join(profile,'logs'),path.join(games,'versions',instance,'logs'),path.join(games,'versions',instance,'saves'),path.join(games,'kamucl-logs',launch),output])fs.mkdirSync(dir,{recursive:true})
 fs.writeFileSync(path.join(profile,'accounts.json'),'private fixture account: never copied');fs.writeFileSync(path.join(games,'versions',instance,'saves','level.dat'),'private fixture world: never copied');fs.writeFileSync(path.join(profile,'logs','launcher-current.log'),'original fixture launcher log\n');fs.writeFileSync(path.join(games,'versions',instance,'logs','latest.log'),'FavoriteNativeQA logged in with entity\nSaving worlds\n');fs.writeFileSync(path.join(games,'kamucl-logs',launch,'stdout.log'),'original fixture stdout\n')
 const options={output,profile,games,instanceId:instance,label:'first-game-test'},records=archivePrivateGameLogs(options);assert.equal(records.length,3);assert.equal(fs.readdirSync(output).length,3)
 for(const row of records){const original=fs.readFileSync(row.originalPath),copied=fs.readFileSync(path.join(output,row.file));assert.deepEqual(copied,original);assert.equal(row.bytes,original.length);assert.equal(row.sha256,crypto.createHash('sha256').update(original).digest('hex'));assert.equal(row.sourceStableDuringRead,true);assert(!row.file.includes('accounts')&&!row.file.includes('level.dat'))}
 assert.throws(()=>archivePrivateGameLogs(options),/EEXIST/);assert.throws(()=>archivePrivateGameLogs({...options,instanceId:'../outside',label:'unsafe'}));fs.writeFileSync(path.join(profile,'logs','launcher-current.log'),'ghp_'+'a'.repeat(30));assert.throws(()=>archivePrivateGameLogs({...options,label:'secret-check'}),/possible secret/);assert(!fs.readdirSync(output).some(name=>name.startsWith('secret-check')))
})
test('gallery resource observer retains all eight logical keys and accepts only exact current next outgoing decoded layers',()=>{
 const {verifyRetainedCarousel}=req(path.resolve('scripts/verify-gallery-favorites-ui.cjs')),expected=Array.from({length:8},(_,index)=>'fixture:'+index),banners=expected.map(path=>({path,src:'https://fixture.invalid/'+path})),snapshot={banners,current:2,upcoming:3,outgoing:1,layerIndices:[1,2,3],images:[1,2,3].map(index=>({src:banners[index].src,active:index===2,complete:true,naturalWidth:16}))}
 assert.deepEqual(verifyRetainedCarousel(snapshot,expected),{current:2,path:'fixture:2',layers:3});assert.throws(()=>verifyRetainedCarousel({...snapshot,banners:[banners[1],banners[0],...banners.slice(2)]},expected),/exact saved order/);assert.throws(()=>verifyRetainedCarousel({...snapshot,images:banners.map((item,index)=>({src:item.src,active:index===2,complete:true,naturalWidth:16}))},expected),/three decoded DOM|current\/next\/outgoing decoded/);assert.throws(()=>verifyRetainedCarousel({...snapshot,layerIndices:[1,2]},expected),/precisely current\/next\/outgoing/);assert.throws(()=>verifyRetainedCarousel({...snapshot,images:snapshot.images.map(image=>({...image,active:false}))},expected));assert.throws(()=>verifyRetainedCarousel({...snapshot,images:snapshot.images.map(image=>({...image,naturalWidth:0}))},expected),/actually decode/)
 const {source}=nativeFixtureExpressions('scripts/verify-gallery-favorites-ui.cjs');assert(source.includes('expectedKeys.length,6+images.length'));assert(source.includes('observed.current,(rotation.at(-1).current+1)%expectedKeys.length'));assert(source.includes('rotation.length>=expectedKeys.length+1'));assert(source.includes('fixtureDurationsSeconds:1'))
})
const favorite=(id='one',source='modrinth')=>({key:source+':'+id,name:id,source,projectId:id,added:1})
const selection=(id='one',source='modrinth')=>({source,projectId:id,fileId:id+'-v'}) as any
const intent=(ids=['one']):FavoriteInstallIntent=>({enabled:true,expected:ids.map(id=>({key:'modrinth:'+id,name:id})),approvedSkips:[]})
const file=(id='one',source='modrinth')=>({source,projectId:id,fileId:id+'-v',fileName:id+'.jar',version:'v',url:'https://fixture.invalid/'+id+'.jar',sha1:'a'.repeat(40),size:1,releaseType:'release',gameVersions:['1.20.1'],loaders:['fabric'],date:'2026-01-01'}) as any

test('checked favorites require a complete accepted snapshot and explicit zero-selection decision; legacy arrays remain compatible',()=>{
 assert.equal(validateFavoriteInstallIntent([],undefined).selected,0)
 assert.throws(()=>validateFavoriteInstallIntent([],intent()),/没有已确认/)
 assert.throws(()=>validateFavoriteInstallIntent([selection()],intent(['one','two'])),/尚未确认/)
 assert.throws(()=>validateFavoriteInstallIntent([selection(),selection()],intent()),/重复/)
 assert.throws(()=>validateFavoriteInstallIntent([selection('other')],intent()),/快照/)
 const skipped={key:'modrinth:two',name:'not trusted',reason:'query-error' as const,message:'429'}
 const value=validateFavoriteInstallIntent([selection()],{...intent(['one','two']),approvedSkips:[skipped]})
 assert.deepEqual(value,{requested:2,selected:1,skipped:[{...skipped,name:'two'}],baseOnly:false})
 assert.throws(()=>validateFavoriteInstallIntent([selection()],{...intent(),baseOnly:true}),/冲突/)
 assert.throws(()=>validateFavoriteInstallIntent([],{...intent(),baseOnly:true}),/尚未确认/)
 assert.equal(validateFavoriteInstallIntent([],{...intent(),baseOnly:true,approvedSkips:[{key:'modrinth:one',name:'one',reason:'base-only'}]}).baseOnly,true)
 assert.throws(()=>validateFavoriteInstallIntent([selection()],{...intent(['one','two']),approvedSkips:[{...skipped,message:'x'.repeat(1001)}]}),/无效/)
})
test('actual favorites and supplemental UI templates compile with visible status, skip and retry controls',()=>{
 for(const component of ['FavoriteModsPicker','SupplementalModsResult']){const filename='src/renderer/src/components/'+component+'.vue',descriptor=parse(fs.readFileSync(filename,'utf8')).descriptor,script=compileScript(descriptor,{id:component}),template=compileTemplate({source:descriptor.template!.content,filename,id:component,compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[])}
})

test('metadata queue limits real concurrent work to four and shares duplicate keys while cancelling subscribers independently',async()=>{
 const queue=new FavoriteVersionQueue<number>(4),gates=Array.from({length:7},()=>later<number>()),started:number[]=[],signals:AbortSignal[]=[]
 const requests=gates.map((gate,i)=>queue.request('key'+i,async signal=>{started.push(i);signals[i]=signal;return gate.promise}))
 await until(()=>started.length===4);assert.deepEqual(started,[0,1,2,3])
 const controller=new AbortController(),duplicate=queue.request('key0',async()=>{throw Error('dedup failed')},controller.signal)
 controller.abort(Error('obsolete'));await assert.rejects(duplicate,/obsolete/);assert.equal(signals[0].aborted,false)
 gates[0].resolve(0);await requests[0];await until(()=>started.length===5);assert.deepEqual(started,[0,1,2,3,4])
 for(let i=1;i<7;i++)gates[i].resolve(i)
 assert.deepEqual(await Promise.all(requests),[0,1,2,3,4,5,6])
})
test('last subscriber cancellation aborts work, removes queued jobs, and completed/failing keys can be requested immediately again',async()=>{
 const queue=new FavoriteVersionQueue<number>(1),controller=new AbortController(),entered=later<AbortSignal>(),gate=later<number>()
 const active=queue.request('active',async signal=>{entered.resolve(signal);return gate.promise},controller.signal)
 const signal=await entered.promise,cancelQueued=new AbortController();let ran=false
 const queued=queue.request('queued',async()=>{ran=true;return 2},cancelQueued.signal)
 cancelQueued.abort(Error('queued obsolete'));await assert.rejects(queued,/queued obsolete/)
 controller.abort(Error('active obsolete'));await assert.rejects(active,/active obsolete/);assert.equal(signal.aborted,true);gate.resolve(1)
 await wait();assert.equal(ran,false)
 await assert.rejects(queue.request('retry',async()=>{throw Error('network')}),/network/)
 assert.equal(await queue.request('retry',async()=>3).then(()=>queue.request('retry',async()=>4)),4)
})

let pickerCompiled:Promise<string>|undefined
async function picker(t:TestContext,records:any[],query:(...args:any[])=>Promise<any>,read?:()=>Promise<void>){
 pickerCompiled??=(async()=>{const descriptor=parse(fs.readFileSync('src/renderer/src/components/FavoriteModsPicker.vue','utf8')).descriptor
  const script=compileScript(descriptor,{id:'favorite-113'}).content
  return(await build({stdin:{contents:script,loader:'ts',resolveDir:path.resolve('src/renderer/src/components')},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',logLevel:'silent',plugins:[{name:'actual-SFC-fixtures',setup(b){
   b.onResolve({filter:/^(\.\.\/api|\.\.\/modFavorites|\.\/SelectMenu\.vue)$/},args=>({path:args.path,namespace:'favorite-fixture'}))
   b.onLoad({filter:/.*/,namespace:'favorite-fixture'},args=>({loader:'js',contents:args.path==='../api'?`export const requestFavoriteVersions=(...a)=>globalThis.fixture.query(...a);export const cancelFavoriteVersions=t=>globalThis.fixture.cancel(t);export const errText=e=>e.message||String(e)`:args.path==='../modFavorites'?`export const favorites=globalThis.fixture.favorites;export const loadFavorites=()=>globalThis.fixture.read()`:`export default {}` }))
  }}]})).outputFiles[0].text})()
 const favorites=ref(records),cancelled:string[]=[],events=new Map<string,any>(),fixture={favorites,query,cancel:async(ticket:string)=>{cancelled.push(ticket)},read:read??(async()=>{})},module={exports:{} as any}
 new Function('require','module','exports','globalThis',await pickerCompiled)(req,module,module.exports,{fixture})
 const props=reactive({mc:'1.20.1',loader:'fabric'}),scope=effectScope(),state=scope.run(()=>module.exports.default.setup(props,{emit:(name:string,value:any)=>events.set(name,value),expose:()=>{}}))
 t.after(()=>scope.stop());state.enabled.value=true
 await until(()=>!state.loadingFavorites.value&&(state.rows.value.length===records.length||!!state.error.value))
 return{state,props,events,cancelled,favorites,stop:()=>scope.stop()}
}
test('actual picker SFC blocks all-network-fail and all-unreliable instead of emitting a ready empty install',async t=>{
 const p=await picker(t,[favorite()],async()=>{throw Error('429')});await until(()=>p.state.rows.value[0]?.status==='query-error')
 assert.equal(p.events.get('ready'),false);assert.deepEqual(p.events.get('update:modelValue'),[])
 p.state.approveSkip(p.state.rows.value[0]);assert.equal(p.events.get('ready'),false)
 p.state.continueWithoutFavorites();assert.equal(p.events.get('ready'),true);validateFavoriteInstallIntent(p.events.get('update:modelValue'),p.events.get('update:intent'))
 p.state.resumeSelection();assert.equal(p.events.get('ready'),false)
 const u=await picker(t,[favorite()],async()=>({files:[],status:'unreliable'}));await until(()=>u.state.rows.value[0]?.status==='unreliable');assert.equal(u.events.get('ready'),false);assert.equal(u.state.rows.value[0].approvedSkip,false)
})
test('actual picker defaults compatible rows on, lists known skips, and requires query error handling; retry restores failed selection',async t=>{
 let fails=true
 const p=await picker(t,[favorite('one'),favorite('two'),favorite('old'),{key:'sha1:'+'b'.repeat(40),name:'local',added:1}],async(_source,id)=>{if(id==='two'&&fails)throw Error('offline');return id==='old'?{files:[],status:'incompatible'}:{files:[file(id)],status:'available'}})
 await until(()=>!p.state.busy.value);assert.equal(p.events.get('ready'),false);assert.equal(p.state.selectedCount.value,1);assert.equal(p.state.skippedCount.value,2)
 const row=p.state.rows.value.find((r:any)=>r.favorite.projectId==='two');p.state.approveSkip(row);assert.equal(p.events.get('ready'),true)
 validateFavoriteInstallIntent(p.events.get('update:modelValue'),p.events.get('update:intent'))
 fails=false;await p.state.queryRow(row);assert.equal(p.state.selectedCount.value,2);assert.equal(p.events.get('ready'),true);assert.equal(row.approvedSkip,false)
 for(const r of p.state.rows.value.filter((r:any)=>r.status==='available')){r.checked=false;p.state.changeChecked(r)}
 assert.equal(p.events.get('ready'),false);p.state.continueWithoutFavorites();assert.equal(p.events.get('ready'),true)
})
test('actual picker invalidates stale loader requests, cancels subscriptions on disable/unmount, and settles loaded cache updates',async t=>{
 const pending=later<any>();let calls=0
 const p=await picker(t,[favorite()],async(_s,id,_mc,loader)=>{calls++;return loader==='fabric'?pending.promise:{files:[{...file(id),loaders:['forge']}],status:'available'}})
 p.props.loader='forge';await until(()=>p.state.rows.value[0]?.status==='available');assert.equal(p.events.get('ready'),true);assert(p.cancelled.length>0)
 pending.resolve({files:[],status:'incompatible'});await wait();assert.equal(p.state.rows.value[0].status,'available')
 p.state.enabled.value=false;await nextTick();assert.equal(p.events.get('ready'),true);assert.equal(p.events.get('update:intent'),undefined)
 p.stop();assert(calls>=2)
 let q:any
 q=await picker(t,[],async(_s,id)=>({files:[file(id)],status:'available'}),async()=>{if(q)q.favorites.value=[favorite('loaded')]})
 q.favorites.value=[favorite('loaded')];await until(()=>q.state.rows.value[0]?.status==='available');assert.equal(q.events.get('ready'),true)
})
test('actual picker refuses a failed favorites read even with old cache and retries before accepting selection',async t=>{
 let fail=true
 const p=await picker(t,[favorite()],async()=>({files:[file()],status:'available'}),async()=>{if(fail)throw Error('records unavailable')})
 assert.match(p.state.error.value,/records unavailable/);assert.equal(p.events.get('ready'),false);assert.deepEqual(p.events.get('update:modelValue'),[])
 fail=false;p.state.retry.value++;await until(()=>p.state.rows.value[0]?.status==='available');assert.equal(p.state.error.value,'');assert.equal(p.events.get('ready'),true)
})

let backendCompiled:Promise<string>|undefined
async function backend(t:TestContext){
 const root=fs.realpathSync.native(fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'KAMUCL favorite113 ')))
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const fixtures:any[]=[file('one'),file('two','curseforge'),file('dep'),file('extra')]
 fixtures[0].dependencies=[{projectId:'dep',required:true}]
 const bytes=new Map(fixtures.map(f=>[f.fileName,Buffer.from('synthetic '+f.projectId)]))
 for(const f of fixtures){f.sha1=crypto.createHash('sha1').update(bytes.get(f.fileName)!).digest('hex');f.size=bytes.get(f.fileName)!.length}
 let failHash=false,hold:ReturnType<typeof later<void>>|undefined
 const reached=later<void>(),requests:string[]=[]
 const server=http.createServer(async(req,res)=>{const name=decodeURIComponent(req.url!.slice(1));requests.push(name);reached.resolve();if(hold)await hold.promise;res.end(failHash?Buffer.from('corrupt'):bytes.get(name))})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as any).port
 t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))})
 backendCompiled??=build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`export {saveSettings,getSettings} from './src/main/core/settings';export {withDownloadFolder,gameDir,registerVersionFolder} from './src/main/core/paths';export {setDownloadGameFolder} from './src/main/core/gameFolders';export {installVersion,readVersionJson} from './src/main/core/versions';export {favoriteVersions,favoriteVersionResult,favoriteInstallResult,registerModFavoritesIpc} from './src/main/core/modFavorites';export {closeHttpClient} from './src/main/core/httpClient';export {registerSupplementalModsIpc} from './src/main/core/supplementalMods';`},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',logLevel:'silent',plugins:[{name:'metadata-loader-fixture-only',setup(b){
 b.onResolve({filter:/^\.\/(community|loaders|gameDirectoryUse)$/},args=>({path:args.path,namespace:'favorite-backend'}))
 b.onResolve({filter:/^[A-Za-z]:[\\/].*paths\.ts$|^\/.*paths\.ts$/},args=>({path:args.path,namespace:'file'}))
  b.onLoad({filter:/.*/,namespace:'favorite-backend'},args=>({loader:'js',contents:args.path==='./community'?`import {AsyncLocalStorage} from 'node:async_hooks';const context=new AsyncLocalStorage();export const withCommunitySignal=(s,run)=>context.run(s,run);export async function communityFavoriteCandidates(s,p,mc,l){context.getStore()?.throwIfAborted();return globalThis.fixture.files.filter(f=>f.source===s&&f.projectId===p)};export const communityFiles=communityFavoriteCandidates;export async function communityExactFile(s,p,id){return globalThis.fixture.files.find(f=>f.source===s&&f.fileId===id)};export async function communitySearch(){return[]};export function cfChannel(){return{base:'',key:'',official:false}};export async function communityModProject(){throw Error('not used')}`:args.path==='./loaders'?`import fs from 'node:fs';import path from 'node:path';import {gameDir,registerVersionFolder} from ${JSON.stringify(path.resolve('src/main/core/paths.ts'))};export async function listLoaderVersions(){return['fixture-loader']};export async function installLoader(loader,mc,v,emit,name){const id=name||'fixture-instance',dir=path.join(gameDir(),'versions',id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify({id,_mcVersion:mc,_loader:loader,mainClass:'fixture.Main',libraries:[]}));fs.writeFileSync(path.join(dir,id+'.jar'),'fixture shell; never launched');registerVersionFolder(id,gameDir());return id};export async function installFabricApi(){throw Error('not used')};export async function repairNeoRuntime(){}`:`export async function externalGameUsesDirectory(){return false}` }))
 }}]}).then(result=>result.outputFiles[0].text)
 const handlers=new Map<string,Function>(),electron={app:{getPath:(name:string)=>path.join(root,name),getVersion:()=> 'fixture-113',getName:()=> 'KAMUCL fixture',isPackaged:false},ipcMain:{handle:(name:string,fn:Function)=>handlers.set(name,fn)},BrowserWindow:{getAllWindows:()=>[]},nativeImage:{}}
 const output={exports:{} as any}
 new Function('require','module','exports','globalThis',await backendCompiled)((name:string)=>name==='electron'?electron:name==='undici'?{...req(name),fetch:(url:string,options:unknown)=>req(name).fetch(String(url).replace('https://fixture.invalid',`http://127.0.0.1:${port}`),options)}:req(name),output,output.exports,{fixture:{files:fixtures}})
 const api=output.exports;t.after(()=>api.closeHttpClient())
 const old=path.join(root,'旧游戏'),target=path.join(root,'下载目标 §'),laterFolder=path.join(root,'后续目标');for(const f of [old,target,laterFolder])fs.mkdirSync(f)
 api.saveSettings({gameDir:target,activeFolder:target,folders:[{path:old,name:'old',isDefault:false},{path:target,name:'target',isDefault:true},{path:laterFolder,name:'later',isDefault:false}],mirror:'official',defaultIsolation:false})
 api.registerModFavoritesIpc();api.registerSupplementalModsIpc(()=>({webContents:{send:()=>{}}}))
 const options={loader:'fabric',loaderVersion:'fixture-loader',instanceName:'favorite-instance',favoriteMods:[selection(),selection('two','curseforge')],favoriteInstallIntent:{enabled:true,expected:[{key:'modrinth:one',name:'one'},{key:'curseforge:two',name:'two'},{key:'sha1:'+'b'.repeat(40),name:'unlinked'}],approvedSkips:[{key:'sha1:'+'b'.repeat(40),name:'unlinked',reason:'unlinked'}]}} as any
 return{api,root,old,target,laterFolder,fixtures,bytes,requests,handlers,options,reached,corrupt:()=>{failHash=true},repair:()=>{failHash=false},pause:()=>{hold=later<void>();return hold}}
}
test('actual backend installs selected two-platform favorites and required dependency to accepted isolated directory, readback summary survives default change',async t=>{
 const b=await backend(t),oldInstance=path.join(b.old,'versions','favorite-instance');fs.mkdirSync(oldInstance,{recursive:true});fs.writeFileSync(path.join(oldInstance,'keep.txt'),'old private data untouched')
 const pause=b.pause();let result:any
 const task=b.api.withDownloadFolder(undefined,()=>b.api.installVersion('1.20.1',b.options,()=>{},undefined,(r:any)=>{result=r}))
 await b.reached.promise;b.api.setDownloadGameFolder(b.laterFolder);pause.resolve();assert.equal(await task,'favorite-instance')
 const mods=path.join(b.target,'versions','favorite-instance','mods');assert.equal(result.modsDirectory,mods);assert.equal(result.folder,b.target);assert.equal(result.installed,2);assert.equal(result.dependencies,1);assert.equal(result.skipped.length,1);assert.equal(result.verifiedFiles.length,3)
 for(const f of b.fixtures.slice(0,3))assert.deepEqual(fs.readFileSync(path.join(mods,f.fileName)),b.bytes.get(f.fileName))
 fs.writeFileSync(path.join(mods,b.fixtures[3].fileName),b.bytes.get(b.fixtures[3].fileName)!)
 const withExtra=await b.api.favoriteInstallResult(b.options,b.fixtures,mods,b.target,'favorite-instance');assert.equal(withExtra.installed,2);assert.equal(withExtra.dependencies,1,'a separately chosen recording or API root is not a favorite dependency');assert.equal(withExtra.verifiedFiles.length,4)
 const cancelled=new AbortController();cancelled.abort(Error('cancelled readback'));await assert.rejects(b.api.favoriteInstallResult(b.options,b.fixtures,mods,b.target,'favorite-instance',cancelled.signal),/cancelled readback/)
 assert.equal(fs.readFileSync(path.join(oldInstance,'keep.txt'),'utf8'),'old private data untouched');assert(!fs.existsSync(path.join(b.laterFolder,'versions','favorite-instance')))
 assert.equal(b.api.getSettings().gameDir,b.laterFolder);assert.equal(b.api.readVersionJson('favorite-instance')._gameDir,true)
 t.diagnostic(JSON.stringify({classification:'Synthetic repository metadata and loader shell; actual socket download/hash/transactions/instance binding/readback',files:result.verifiedFiles,accepted:b.target,latest:b.laterFolder}))
})
test('actual favorite installation accepts uppercase SHA1 metadata while readback still rejects different content',async t=>{
 const b=await backend(t)
 for(const file of b.fixtures)file.sha1=file.sha1!.toUpperCase()
 let result:any
 assert.equal(await b.api.installVersion('1.20.1',b.options,()=>{},undefined,(r:any)=>{result=r}),'favorite-instance')
 assert.equal(result.installed,2);assert.equal(result.dependencies,1);assert.equal(result.verifiedFiles.length,3)
 for(const file of result.verifiedFiles){assert.equal(file.sha1,file.sha1.toLowerCase());assert.equal(file.sha1,crypto.createHash('sha1').update(b.bytes.get(file.fileName)!).digest('hex'))}
 const mods=path.join(b.target,'versions','favorite-instance','mods')
 fs.writeFileSync(path.join(mods,b.fixtures[0].fileName),'different content')
 await assert.rejects(b.api.favoriteInstallResult(b.options,b.fixtures.slice(0,3),mods,b.target,'favorite-instance'),/哈希不符/)
})
test('real Modrinth mapping preserves unavailable compatible candidates only for the diagnostic favorites query',async()=>{
 const result=await build({entryPoints:['src/main/core/community.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',logLevel:'silent',plugins:[{name:'isolated-service',setup(b){
  b.onResolve({filter:/^\.\/(download|versions|instances|settings|launcherLog|curseforgeKey)$/},args=>/[\\/](?:community|curseforgeChannel)\.ts$/.test(args.importer)?{path:args.path,namespace:'favorite-service'}:undefined)
  b.onLoad({filter:/.*/,namespace:'favorite-service'},()=>({loader:'js',contents:`export function downloadAll(){};export function readVersionJson(){};export function instanceDirectoryState(){};export function getSettings(){return {}};export function getCurseforgeApiKey(){return ''};export function logScope(){return{info(){},warn(){},error(){}}};export const CF_BUILTIN_KEY='';`}))
 }}]})
 const module={exports:{} as any},payload=[{id:'missing-url',project_id:'one',version_number:'1',game_versions:['1.20.1'],loaders:['fabric'],files:[{filename:'one.jar',hashes:{sha1:'a'.repeat(40)}}]},{id:'missing-file',project_id:'one',game_versions:['1.20.1'],loaders:['fabric'],files:[]}]
 new Function('require','module','exports','fetch',result.outputFiles[0].text)(req,module,module.exports,async()=>({ok:true,json:async()=>payload}))
 assert.deepEqual(await module.exports.communityFiles('modrinth','one',{kind:'mod',mcVersion:'1.20.1',loader:'fabric'}),[])
 const candidates=await module.exports.communityFavoriteCandidates('modrinth','one','1.20.1','fabric');assert.equal(candidates.length,2);assert.equal(candidates[0].url,'');assert.equal(candidates[1].fileName,'')
})
test('actual backend rejects modern empty request before base creation, classifies unverifiable metadata separately, and legacy IPC stays array',async t=>{
 const b=await backend(t)
 await assert.rejects(b.api.installVersion('1.20.1',{...b.options,favoriteMods:[]},()=>{}),/没有已确认/)
 assert(!fs.existsSync(path.join(b.target,'versions','favorite-instance')))
 b.fixtures[0].sha1=undefined;assert.equal((await b.api.favoriteVersionResult('modrinth','one','1.20.1','fabric')).status,'unreliable')
 assert.equal((await b.api.favoriteVersionResult('modrinth','missing','1.20.1','fabric')).status,'incompatible')
 const legacy=await b.handlers.get('mods:favoriteVersions')!({},'curseforge','two','1.20.1','fabric');assert(Array.isArray(legacy));assert.equal(legacy.length,1)
})
test('hash failure keeps base and explicit retry state, never reports success; successful retry verifies files and removes pending record',async t=>{
 const b=await backend(t);b.corrupt();let completed=false
 await assert.rejects(b.api.installVersion('1.20.1',b.options,()=>{},undefined,()=>{completed=true}),/基础实例已保留.*附加模组安装失败/)
 assert.equal(completed,false);const instance=path.join(b.target,'versions','favorite-instance');assert(fs.existsSync(path.join(instance,'favorite-instance.json')))
 assert.equal(fs.readdirSync(path.join(instance,'mods')).filter((name:string)=>name.endsWith('.jar')).length,0)
 const pending=b.handlers.get('mods:supplementalList')!();assert.equal(pending.length,1)
 b.repair();const response=await b.handlers.get('mods:supplementalRetry')!({},pending[0].id,true);assert.deepEqual(response.pending,[]);assert.equal(response.result.installed,2);assert.equal(response.result.dependencies,1);assert.equal(response.result.verifiedFiles.length,3)
 const installed=b.fixtures[0];fs.writeFileSync(path.join(instance,'mods',installed.fileName),'outside tamper');await assert.rejects(b.api.favoriteInstallResult(b.options,b.fixtures.slice(0,3),path.join(instance,'mods'),b.target,'favorite-instance'),/哈希不符/)
})
