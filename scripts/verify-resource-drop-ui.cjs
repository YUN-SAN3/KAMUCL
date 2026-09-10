// Mount real resource pages under the actual App capture handlers in isolated Electron.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript')
const {app,BrowserWindow}=require('electron'),{build}=require('esbuild'),{parse,compileScript}=require('@vue/compiler-sfc')
const root=fs.mkdtempSync(path.resolve('out/resource-drop-ui-'));app.setPath('userData',path.join(root,'userData'))
app.whenReady().then(async()=>{
 const appScript=parse(fs.readFileSync('src/renderer/src/App.vue','utf8')).descriptor.scriptSetup.content
 const ast=ts.createSourceFile('App.ts',appScript,ts.ScriptTarget.Latest,true)
 const handlers=ast.statements.filter(s=>ts.isFunctionDeclaration(s)&&['onDragEnter','onDragOver','onDrop'].includes(s.name?.text)).map(s=>s.getText(ast)).join('\n')
 const apiText=fs.readFileSync('src/renderer/src/api.ts','utf8'),names=[...apiText.matchAll(/export (?:const|(?:async )?function) (\w+)/g)].map(m=>m[1])
 const custom={errText:'String',getDefaultKeys:'async()=>({})',getDefaultResourcePacks:'async()=>[]',saveSettings:'async p=>({...qa.store.settings,...p})',getSettings:'async()=>qa.store.settings',importDefaultResourcePacks:'async files=>{qa.defaults.push(files);return []}',listFs:'async (...args)=>{qa.lists.push(args);return []}',importResources:'async (...args)=>{qa.imports.push(args);return args[0].length}'}
 const mockApi=names.map(n=>`export const ${n}=${custom[n]||'async()=>[]'};`).join('\n')
 const mockStore=`import {reactive} from 'vue';export const store=reactive({currentView:'keys',settings:{activeFolder:'B',gameDir:'A'},installed:[{id:'same',folder:'A',isolated:true},{id:'same',folder:'B',isolated:true},{id:'shared',folder:'B',isolated:false}],resourceVersionId:'same',searchKeyword:'',fsRefreshTick:0});qa.store=store;export const toast=(...a)=>qa.toasts.push(a);export const refreshInstalled=async()=>{};`
 const entry=`import {createApp,h,reactive} from 'vue';import {store} from './src/renderer/src/store';import Keys from './src/renderer/src/views/KeysView.vue';import Manager from './src/renderer/src/components/FileManager.vue';
 const dragActive={value:false},dlOpen={value:false},noticeOpen={value:false};let dragDepth=0,internalDrag=false,lastDragoverAt=0;
 const endDrag=()=>{dragActive.value=false;dragDepth=0},dragHasFiles=e=>Array.from(e.dataTransfer?.types||[]).includes('Files'),dragHasSupportedData=dragHasFiles,showsImportOverlay=()=>true;
 const resourceDropPage=()=>['keys','mods','packs','shaders'].includes(store.currentView),toast=(...a)=>qa.toasts.push(a),routeSingleImport=()=>qa.global++,routeYggdrasilImport=()=>qa.global++,looksLikeYggdrasilProvider=()=>false,modDrop={};
 ${handlers}
 for(const [type,fn] of [['dragenter',onDragEnter],['dragover',onDragOver],['drop',onDrop]])window.addEventListener(type,fn,true);
 qa.dragActive=dragActive;qa.view=reactive({kind:'keys'});createApp({render:()=>qa.view.kind==='keys'?h(Keys):h(Manager,{key:qa.view.kind,title:qa.view.kind,rel:qa.view.kind,openLabel:'open',emptyText:'empty',icon:''})}).mount('#app');`
 const bundle=await build({stdin:{contents:entry,loader:'ts',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',define:{__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false','process.env.NODE_ENV':'"development"'},plugins:[{name:'qa',setup(b){
 b.onResolve({filter:/(?:^|\/)(api|store)$/},a=>({path:a.path.endsWith('api')?'api':'store',namespace:'mock'}))
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='api'?mockApi:mockStore,loader:'js',resolveDir:process.cwd()}))
 b.onResolve({filter:/^@shared\//},a=>({path:path.resolve('src/shared',a.path.slice(8)+'.ts')}))
 b.onLoad({filter:/\.vue$/},a=>({contents:/KeysView|FileManager/.test(a.path)?compileScript(parse(fs.readFileSync(a.path,'utf8')).descriptor,{id:path.basename(a.path),inlineTemplate:true}).content:'export default {render:()=>null}',loader:'ts',resolveDir:path.dirname(a.path)}))
 }}]});fs.writeFileSync(path.join(root,'ui.js'),bundle.outputFiles[0].text)
 fs.writeFileSync(path.join(root,'index.html'),`<div id="app"></div><script>window.qa={imports:[],defaults:[],lists:[],toasts:[],global:0,errors:[]};window.kamucl={getFilePath:f=>f.name};window.addEventListener('error',e=>qa.errors.push(e.message))</script><script src="ui.js"></script>`)
 const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true}}),run=s=>win.webContents.executeJavaScript(s),wait=()=>new Promise(r=>setTimeout(r,100))
 await win.loadFile(path.join(root,'index.html'));await wait()
 async function drop(name){await run(`(()=>{const dt=new DataTransfer();dt.items.add(new File(['test'],${JSON.stringify(name)}));for(const type of ['dragenter','dragover','drop'])document.querySelector('#app .page')?.dispatchEvent(new DragEvent(type,{dataTransfer:dt,bubbles:true,cancelable:true}))})()`);await wait()}
 // Drop outside the material card: the complete default configuration page owns the gesture.
 await drop('default.zip');assert.deepEqual(await run('qa.defaults'),[['default.zip']]);assert.equal(await run('qa.global'),0)
 for(const [view,kind,name] of [['mods','mods','test.jar'],['packs','resourcepacks','pack.zip'],['shaders','shaderpacks','shader.zip']]){
 await run(`qa.store.currentView=${JSON.stringify(view)};qa.view.kind=${JSON.stringify(kind)}`);await wait();await drop(name)
 const call=await run('qa.imports.at(-1)');assert.deepEqual(call,[[name],'same','B',kind])
 assert.deepEqual(await run('qa.lists.at(-1)'),['versions/same/'+kind,'B'])
 }
 await run("qa.store.resourceVersionId='shared'");await wait();await drop('shared.zip');assert.deepEqual(await run('qa.imports.at(-1)'),[['shared.zip'],'shared','B','shaderpacks'])
 assert.deepEqual(await run('qa.lists.at(-1)'),['shaderpacks','B'])
 assert.equal(await run('qa.imports.length'),4);assert.equal(await run('qa.defaults.length'),1);assert.equal(await run('qa.global'),0);assert.equal(await run('qa.dragActive.value'),false);assert.deepEqual(await run('qa.errors'),[])
 fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(await run('({imports:qa.imports,defaults:qa.defaults,global:qa.global})'),null,2))
 console.log('PASS real page drops: exclusive capture, four resource destinations, selected folder and shared/isolated lists: '+root);win.destroy();app.quit()
}).catch(e=>{console.error(e);app.exit(1)})
