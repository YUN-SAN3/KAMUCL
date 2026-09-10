// Isolated real Vue/WebGL rendering: explicit key clearing, pack controls and default framing.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {app,BrowserWindow}=require('electron'),{build}=require('esbuild'),{parse,compileScript}=require('@vue/compiler-sfc')
const root=fs.mkdtempSync(path.resolve('out/default-config-ui-'))
app.setPath('userData',path.join(root,'userData'))
app.commandLine.appendSwitch('enable-unsafe-swiftshader')
app.whenReady().then(async()=>{
  const sources=['src/renderer/src/views/KeysView.vue','src/renderer/src/components/SkinViewer3D.vue']
  const mockApi=`export const errText=String;
    export const getSettings=async()=>qa.store.settings;
    export const saveSettings=async p=>({...qa.store.settings,...p});
    export const getDefaultKeys=async()=>({'key_key.forward':'key.keyboard.w'});
    export const setDefaultKey=async(id,bind)=>{qa.binds.push({id,bind});return {[id]:bind}};
    export const resetDefaultKeys=async()=>({});
    export const getDefaultResourcePacks=async()=>qa.packs;
    export const importDefaultResourcePacks=async files=>{qa.imports.push(files);return qa.packs=files.map((name,i)=>({name,id:String(i),size:10}))};
    export const pickDefaultResourcePacks=async()=>qa.packs;
    export const removeDefaultResourcePack=async id=>qa.packs=qa.packs.filter(p=>p.id!==id);
    export const moveDefaultResourcePack=async(id,d)=>{const a=[...qa.packs],i=a.findIndex(p=>p.id===id);[a[i],a[i+d]]=[a[i+d],a[i]];return qa.packs=a};`
  const compiled=await build({stdin:{contents:`import {createApp,h} from 'vue';import Keys from './${sources[0]}';import Skin from './${sources[1]}';createApp(Keys).mount('#keys');createApp({render:()=>h('div',{class:'previews'},[h('div',{style:'width:300px'},[h(Skin,{paused:true})]),h('div',{style:'width:420px'},[h(Skin,{paused:true})])])}).mount('#skins')`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',define:{__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false','process.env.NODE_ENV':'"development"'},plugins:[{name:'sfc',setup(b){
    b.onResolve({filter:/^[.]{1,2}\/(api|store)$/},args=>({path:args.path.endsWith('api')?'api':'store',namespace:'mock'}))
    b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='api'?mockApi:`import {reactive} from 'vue';export const store=reactive({settings:{keySync:true,resourcePackSync:false}});qa.store=store;export const toast=(text,type)=>qa.toasts.push({text,type})`,loader:'js',resolveDir:process.cwd()}))
    b.onResolve({filter:/^@shared\//},args=>({path:path.resolve('src/shared',args.path.slice(8)+'.ts')}))
    b.onLoad({filter:/\.vue$/},args=>({contents:compileScript(parse(fs.readFileSync(args.path,'utf8')).descriptor,{id:'qa-'+path.basename(args.path),inlineTemplate:true}).content,loader:'ts',resolveDir:path.dirname(args.path)}))
  }}]})
  fs.writeFileSync(path.join(root,'ui.js'),compiled.outputFiles[0].text)
  const css=fs.readFileSync('src/renderer/src/styles.css','utf8')+sources.map(s=>parse(fs.readFileSync(s,'utf8')).descriptor.styles[0].content).join('\n')
  fs.writeFileSync(path.join(root,'index.html'),`<meta charset="utf-8"><style>${css}html,body,#app{height:auto;overflow:visible}body{padding:20px;background:var(--bg)}#keys{max-width:760px;margin:auto}#skins{max-width:760px;margin:30px auto}.previews{display:flex;gap:20px}.viewer3d{--sv3d-height:374px}</style><div id="keys"></div><div id="skins"></div><script>window.qa={binds:[],packs:[],imports:[],toasts:[],errors:[]};window.kamucl={getFilePath:f=>f.name};window.addEventListener('error',e=>qa.errors.push(e.message))</script><script src="ui.js"></script>`)
  const win=new BrowserWindow({show:false,width:1100,height:900,webPreferences:{contextIsolation:true,backgroundThrottling:false,offscreen:true}})
  const run=code=>win.webContents.executeJavaScript(code).catch(error=>{throw new Error(error.message+'\nCommand: '+code)}),wait=ms=>new Promise(r=>setTimeout(r,ms))
  async function click(selector){
    await run(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);await wait(80)
    const p=await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);return {x,y,hit:e.contains(document.elementFromPoint(x,y))}})()`)
    assert(p.hit,'Button is covered: '+selector)
    win.webContents.sendInputEvent({type:'mouseDown',x:p.x,y:p.y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x:p.x,y:p.y,button:'left',clickCount:1});await wait(120)
  }
  await win.loadFile(path.join(root,'index.html'));await wait(600)
  await click('.cfg-bind');assert.equal(await run('document.querySelectorAll("[data-key-clear]").length'),1)
  await click('[data-key-clear]');assert.deepEqual(await run('qa.binds'),[{id:'key_key.forward',bind:'key.keyboard.unknown'}])
  assert.equal(await run('document.querySelector(".cfg-bind").textContent.trim()'),'未指定')
  await click('.cfg-bind');win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait(100)
  assert.equal(await run('qa.binds.length'),1)
  await run(`const dt=new DataTransfer();dt.items.add(new File(['a'],'A.zip'));dt.items.add(new File(['b'],'B.zip'));document.querySelector('.default-packs').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true}))`);await wait(150)
  assert.deepEqual(await run('qa.imports'),[['A.zip','B.zip']]);assert.equal(await run('qa.store.settings.resourcePackSync'),true)
  assert.equal(await run('document.querySelectorAll(".default-packs .cfg-row").length'),2)
  await click('.default-packs .cfg-row button[title="提高优先级"]')
  assert.equal(await run('qa.packs[1].name'),'A.zip')
  await run('window.scrollTo(0,0)');await wait(150)
  fs.writeFileSync(path.join(root,'defaults.png'),(await win.webContents.capturePage()).toPNG())
  await run('document.querySelector("#skins").scrollIntoView({block:"center",behavior:"instant"})');await wait(200)
  assert.equal(await run('document.querySelectorAll(".viewer3d canvas").length'),2)
  // Capture individual canvases; pixels on opaque geometry must leave top/bottom breathing room.
  const captures=[]
  for(let i=0;i<2;i++){
    const rect=await run(`(()=>{const r=document.querySelectorAll('.viewer3d')[${i}].getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}})()`)
    const picture=await win.webContents.capturePage(rect);const file=path.join(root,'skin-'+i+'.png');fs.writeFileSync(file,picture.toPNG());captures.push({file,rect})
  }
  assert.deepEqual(await run('qa.errors'),[])
  fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({pass:true,binds:await run('qa.binds'),packs:await run('qa.packs'),captures},null,2))
  console.log('PASS key clear, multiple pack drop/order/sync and both WebGL previews: '+root)
  win.destroy();app.quit()
}).catch(e=>{fs.writeFileSync(path.join(root,'error.txt'),e.stack||String(e));console.error(e);app.exit(1)})
