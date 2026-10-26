// Real packaged renderer and native inputs, with public textures and synthetic
// IPC accounts only. This does not qualify a user's Minecraft Services response.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const geometry=require('./qa-coordinate-geometry114.cjs')
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
let winRestoreAPI
function assertCapeForeground(value,binding){
 assert(value&&Number.isSafeInteger(value.hwnd)&&value.hwnd>0);assert.equal(value.ownerPid,binding.pid);assert.equal(value.foregroundPid,binding.pid);assert.equal(value.foreground,value.hwnd);assert.equal(value.visible,true);assert.equal(value.minimized,false);assert.equal(value.focused,true);assert.equal(value.dpiAwareness,2);assert(Number.isFinite(value.observedAt));return true
}
function restoreOwnedWinRectangle(original){
 const read=require('./qa-privacy-categories115.cjs').readOwnedWinClient,before=read(original.handleBytes,original.pid)
 assert.equal(before.queryDpiContext,original.queryDpiContext);assert.equal(before.queryDpiAwareness,original.queryDpiAwareness)
 const rect=original.windowRectAsReported;assert(['left','top','right','bottom'].every(key=>Number.isInteger(rect[key])));assert(rect.right>rect.left&&rect.bottom>rect.top)
 if(!winRestoreAPI){const k=require('koffi'),u=k.load('user32.dll');winRestoreAPI=u.func('SetWindowPos','bool',['uintptr','uintptr','int','int','int','int','uint'])}
 const hwnd=Buffer.from(original.handleBytes,'hex').readBigUInt64LE(0),flags=0x0004|0x0010
 assert.equal(winRestoreAPI(hwnd,0,rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top,flags),true,'Owned Win32 rectangle restore failed')
 const after=read(original.handleBytes,original.pid);assert.equal(after.queryDpiContext,original.queryDpiContext);assert.equal(after.queryDpiAwareness,original.queryDpiAwareness)
 return{before,after,flags,classification:'SetWindowPos of the exact owned HWND using its original GetWindowRect AsReported values in the same verified query DPI context; not claimed physical pixels'}
}

async function decodeCapeReferences(capes){
 const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',value))].map(byte=>byte.toString(16).padStart(2,'0')).join('')
 const decode=async source=>{const image=new Image();image.src=source;await image.decode();return image}
 const canvas=(width,height)=>{const element=document.createElement('canvas');element.width=width;element.height=height;return element}
 const rows=[]
 for(const cape of capes){
  const image=await decode(cape.dataUrl),scale=image.width/(image.width===image.height*2?64:22)
  if(image.width!==cape.width||image.height!==cape.height||!Number.isInteger(scale)||scale<1)throw Error('Independent public fixture dimensions changed')
  const atlas=canvas(64*scale,32*scale),context=atlas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,image.width,image.height)
  const rgba=context.getImageData(0,0,atlas.width,atlas.height).data,sharp=Uint8Array.from(atob(cape.sharpRgbaBase64),character=>character.charCodeAt(0))
  if(sharp.length!==rgba.length)throw Error('Independent reference byte count changed')
  const differences={differentPixels:0,differentRgbBytes:0,differentAlphaBytes:0,maximumRgbDifference:0,byAlpha:{}}
  for(let i=0;i<rgba.length;i+=4){let changed=false;for(let channel=0;channel<4;channel++)if(rgba[i+channel]!==sharp[i+channel]){changed=true;if(channel===3)differences.differentAlphaBytes++;else{differences.differentRgbBytes++;differences.maximumRgbDifference=Math.max(differences.maximumRgbDifference,Math.abs(rgba[i+channel]-sharp[i+channel]))}}
   if(changed){differences.differentPixels++;differences.byAlpha[rgba[i+3]]=(differences.byAlpha[rgba[i+3]]||0)+1}}
  const thumbnail=canvas(100,160),thumbContext=thumbnail.getContext('2d');thumbContext.imageSmoothingEnabled=false;thumbContext.drawImage(atlas,scale,scale,10*scale,16*scale,0,0,100,160)
  const thumbnailUrl=thumbnail.toDataURL('image/png'),decodedThumb=await decode(thumbnailUrl),readback=canvas(100,160),readContext=readback.getContext('2d',{willReadFrequently:true});readContext.drawImage(decodedThumb,0,0)
  rows.push({id:cape.id,at:performance.now(),timeOrigin:performance.timeOrigin,url:location.href,sourceDataUrlSha256:await digest(new TextEncoder().encode(cape.dataUrl)),
   image:{width:image.width,height:image.height},atlas:{width:atlas.width,height:atlas.height,rgbaSha256:await digest(rgba)},thumbnail:{width:100,height:160,srcSha256:await digest(new TextEncoder().encode(thumbnailUrl)),rgbaSha256:await digest(readContext.getImageData(0,0,100,160).data)},
   sharpAtlasSha256:cape.sharpAtlasSha256,differences,classification:'Independent browser decode of the frozen public PNG followed by standard transparent 64:32 atlas padding and front (1,1) 10x16 nearest crop; frozen before product activation, no GL ledger or product normalizer read'})
 }
 return rows
}

function installCapeFixture(config){
 const e=globalThis.testElectron,f=process.mainModule.require('node:fs')
 if(f.realpathSync.native(e.app.getPath('userData'))!==config.profile)throw Error('Cape fixture requires its exact disposable profile')
 const w=e.BrowserWindow.fromId(config.windowId)
 if(!w||w.webContents.id!==config.webContentsId||process.pid!==config.pid)throw Error('Cape fixture belongs to another native window')
 if(globalThis.__qaCapeFixture115)throw Error('Cape fixture already installed')
 const channels=['accounts:list','accounts:selected','accounts:select','skin:profile','skin:cape','skin:avatar','skin:history','skin:editorUpload']
 const originals=new Map(channels.map(channel=>[channel,e.ipcMain._invokeHandlers.get(channel)]))
 if([...originals.values()].some(entry=>typeof entry!=='function'))throw Error('Original cape/account handlers missing')
 const state={token:config.token,accounts:config.accounts,capes:config.capes,skin:globalThis.uiSkin,selected:config.accounts[0].id,
  recovered:false,active:{[config.accounts[0].id]:'cape-pan',[config.accounts[1].id]:'cape-common'},profiles:[],changes:[],selections:[],uploads:[],
  deferNext:false,held:null,originals,entries:new Map(),sequence:0,installed:true}
 const profileFor=(id,failed=false)=>({username:state.accounts.find(a=>a.id===id).username,skins:[{variant:'classic',url:'',dataUrl:state.skin}],
  capes:state.capes.filter(c=>id===state.accounts[0].id||c.id==='cape-common').map(c=>({id:c.id,alias:c.alias,active:state.active[id]===c.id,url:c.url,
   ...(failed&&!['cape-pan','cape-common'].includes(c.id)?{textureError:'隔离QA：一次材质下载失败，请刷新重试'}:{dataUrl:c.dataUrl})}))})
 const handlers={
  'accounts:list':()=>state.accounts,
  'accounts:selected':()=>state.accounts.find(a=>a.id===state.selected),
  'accounts:select':(_event,id)=>{const account=state.accounts.find(a=>a.id===id);if(!account)throw Error('Unknown synthetic account');state.selected=id;
   state.selections.push({order:++state.sequence,at:Date.now(),id});return account},
  'skin:profile':(_event,refresh)=>{const row={order:++state.sequence,at:Date.now(),accountId:state.selected,refresh:refresh===true};state.profiles.push(row);
   if(refresh===true)state.recovered=true;row.recovered=state.recovered;return profileFor(state.selected,!state.recovered)},
  'skin:cape':async(_event,id)=>{if(id!==null&&!state.capes.some(c=>c.id===id))throw Error('Unknown synthetic cape');
   const row={order:++state.sequence,startedAt:Date.now(),accountId:state.selected,capeId:id,returned:false};state.changes.push(row);
   if(state.deferNext){state.deferNext=false;await new Promise(resolve=>{state.held={resolve,row}})}
   state.active[row.accountId]=id;row.returned=true;row.returnedAt=Date.now();row.returnedOrder=++state.sequence;return profileFor(row.accountId,!state.recovered)},
  'skin:avatar':()=>state.skin,
  'skin:history':()=>[],
  'skin:editorUpload':()=>{state.uploads.push({order:++state.sequence,at:Date.now()});throw Error('Cancel QA must never submit a skin upload')}
 }
 for(const [channel,handler]of Object.entries(handlers)){e.ipcMain.removeHandler(channel);e.ipcMain.handle(channel,handler);state.entries.set(channel,e.ipcMain._invokeHandlers.get(channel))}
 state.snapshot=()=>({token:state.token,selected:state.selected,recovered:state.recovered,profiles:state.profiles,changes:state.changes,selections:state.selections,uploads:state.uploads,pending:!!state.held})
 state.release=()=>{if(!state.held)throw Error('No owned synthetic response is pending');const {resolve}=state.held;state.held=null;resolve();return true}
 globalThis.__qaCapeFixture115=state
 return{installed:true,token:state.token,channels,profile:config.profile,accounts:state.accounts.map(a=>({id:a.id,type:a.type,username:a.username})),classification:'Synthetic IPC response fixture; no Microsoft authentication or user account/cache accessed'}
}
async function cleanupCapeFixture(token){
 const state=globalThis.__qaCapeFixture115,ipc=globalThis.testElectron.ipcMain
 if(!state||state.token!==token)throw Error('Foreign cape fixture cleanup refused')
 if(state.held)state.release()
 await Promise.resolve()
 const rows=[]
 for(const[channel,original]of state.originals){const owned=ipc._invokeHandlers.get(channel)===state.entries.get(channel);if(owned)ipc._invokeHandlers.set(channel,original);
  rows.push({channel,owned,restored:ipc._invokeHandlers.get(channel)===original})}
 state.installed=false;delete globalThis.__qaCapeFixture115
 return{complete:rows.every(row=>row.owned&&row.restored)&&state.changes.every(row=>row.returned),rows,final:state.snapshot()}
}

function installCapeUploadObserver(){
 if(window.__qaCapeUploads115)throw Error('Cape GL observer already installed')
 const rows=[],pending=new Set(),errors=[],originals=[],origin=performance.timeOrigin,url=location.href,limit=256
 const observe=(context,args,method,originalError)=>{
  if(!context.canvas?.closest('.skins-page .preview-3d .viewer3d'))return
  const source=[...args].find(value=>value instanceof HTMLCanvasElement)
  if(!source||source.width!==source.height*2)return
  if(rows.length>=limit){errors.push('Original cape texture upload ledger overflowed');return}
  const row={ordinal:rows.length+1,at:performance.now(),timeOrigin:performance.timeOrigin,url:location.href,method,
   width:source.width,height:source.height,canvasWidth:context.canvas.width,canvasHeight:context.canvas.height,focus:document.hasFocus(),hidden:document.hidden,
   originalError:originalError?String(originalError):null};rows.push(row)
  try{
   if(source.width*source.height>4_194_304)throw Error('Owned cape source exceeded observation pixel bound')
   const bytes=source.getContext('2d').getImageData(0,0,source.width,source.height).data
   const work=crypto.subtle.digest('SHA-256',bytes).then(digest=>{row.rgbaSha256=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')}).catch(error=>{row.observationError=String(error);errors.push(String(error))})
   pending.add(work);work.finally(()=>pending.delete(work))
  }catch(error){row.observationError=String(error);errors.push(String(error))}
 }
 for(const Constructor of [window.WebGLRenderingContext,window.WebGL2RenderingContext].filter(Boolean))for(const method of ['texImage2D','texSubImage2D']){
  const prototype=Constructor.prototype,original=prototype[method]
  if(typeof original!=='function'||!Object.prototype.hasOwnProperty.call(prototype,method))continue
  const wrapped=function(...args){let error;try{return original.apply(this,args)}catch(caught){error=caught;throw caught}finally{observe(this,args,method,error)}}
  prototype[method]=wrapped;originals.push({prototype,method,original,wrapped})
 }
 const observer={async snapshot(){await Promise.all([...pending]);return{timeOrigin:origin,url,rows:rows.slice(),errors:errors.slice()}},async restore(){
  await Promise.all([...pending]);const hooks=originals.map(item=>{const owned=item.prototype[item.method]===item.wrapped;if(owned)item.prototype[item.method]=item.original;return{method:item.method,owned,restored:item.prototype[item.method]===item.original}})
  if(window.__qaCapeUploads115!==observer)throw Error('Cape GL observer changed');delete window.__qaCapeUploads115
  return{complete:hooks.every(hook=>hook.owned&&hook.restored)&&errors.length===0,hooks,final:{timeOrigin:origin,url,rows:rows.slice(),errors:errors.slice()}}
 }}
 window.__qaCapeUploads115=observer;return{installed:true,timeOrigin:origin,url}
}

async function rendererCapeState(){
 const page=document.querySelector('.skins-page'),root=document.querySelector('#app')?.__vue_app__?._container?._vnode,seen=new WeakSet(),instances=[]
 const visit=node=>{if(!node||typeof node!=='object'||seen.has(node))return;seen.add(node);if(Array.isArray(node)){node.forEach(visit);return}
  if(node.component){instances.push(node.component);visit(node.component.subTree)}if(Array.isArray(node.children))visit(node.children);visit(node.ssContent);visit(node.ssFallback);visit(node.suspense?.activeBranch)}
 visit(root)
 const viewers=instances.filter(instance=>instance.props&&typeof instance.props.cape==='string'&&instance.vnode?.el?.closest?.('.skins-page .preview-3d'))
 const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('')
 const canvas=page?.querySelector('.preview-3d .viewer3d canvas'),gl=canvas?.getContext('webgl2')||canvas?.getContext('webgl')
 const debug=gl?.getExtension('WEBGL_debug_renderer_info'),glInfo=gl?{version:gl.getParameter(gl.VERSION),vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),unmaskedVendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):null,unmaskedRenderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,attributes:gl.getContextAttributes()}:null
 const canvasBounds=canvas?.getBoundingClientRect()
 const rows=await Promise.all([...page?.querySelectorAll('.cape-item')||[]].map(async element=>{const image=element.querySelector('.cape-img');let rgbaSha256=null;if(image?.complete&&image.naturalWidth>0){const copy=document.createElement('canvas');copy.width=image.naturalWidth;copy.height=image.naturalHeight;const ctx=copy.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);rgbaSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',ctx.getImageData(0,0,copy.width,copy.height).data))].map(byte=>byte.toString(16).padStart(2,'0')).join('')}return{
  alias:element.querySelector('.cape-name')?.textContent.trim(),active:element.classList.contains('active'),disabled:element.disabled,
  error:element.querySelector('.cape-state [role=status]')?.textContent.trim()||'',image:image?{complete:image.complete,width:image.naturalWidth,height:image.naturalHeight,srcSha256:await digest(image.src),rgbaSha256}:null}}))
 return{at:performance.now(),timeOrigin:performance.timeOrigin,url:location.href,theme:document.documentElement.dataset.theme,readyState:document.readyState,
  focus:document.hasFocus(),hidden:document.hidden,width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio,selectedRoute:document.querySelector('[data-nav][aria-current=page]')?.dataset.nav,
  mounted:!!page,username:page?.querySelector('.skin-username')?.textContent.trim(),rows,viewer:{count:viewers.length,
   capeSha256:viewers.length===1?await digest(viewers[0].props.cape):null,empty:viewers.length===1?viewers[0].props.cape==='':null,
   canvas:canvas?{width:canvas.width,height:canvas.height,lost:gl?.isContextLost()??null,bounds:canvasBounds.toJSON(),hitVisible:document.elementFromPoint(canvasBounds.x+canvasBounds.width/2,canvasBounds.y+canvasBounds.height/2)===canvas,glInfo}:null,fallback:!!page?.querySelector('.viewer3d-fallback')},
  modal:{editor:!!document.querySelector('.skin-editor'),upload:!!document.querySelector('.skin-upload-dialog')},
  uploads:window.__qaCapeUploads115?await window.__qaCapeUploads115.snapshot():null}
}
function assertCapePresentation(state,expected,{incomplete=false,uploadAfter=0}={}){
 assert.equal(state.mounted,true);assert.equal(state.theme,expected.theme);assert.equal(state.timeOrigin,expected.timeOrigin);assert.equal(state.url,expected.url)
 assert.equal(state.focus,true);assert.equal(state.hidden,false);assert.equal(state.readyState,'complete');assert.equal(state.username,expected.username)
 assert.equal(state.rows.length,expected.capes.length)
 for(const cape of expected.capes){const row=state.rows.find(row=>row.alias===cape.alias);assert(row,'Missing actual cape '+cape.alias)
  if(incomplete&&cape.failed){assert.equal(row.image,null);assert.match(row.error,/一次材质下载失败/)}
  else{assert.equal(row.image?.complete,true);assert.equal(row.image.width,100);assert.equal(row.image.height,160);assert.equal(row.image.rgbaSha256,cape.thumbnail.rgbaSha256,'Original thumbnail pixels must equal the pre-activation independent public PNG crop');assert.equal(row.error,'')}
  assert.equal(row.active,cape.id===expected.activeId)
 }
 assert.equal(state.viewer.count,1);assert.equal(state.viewer.fallback,false);assert(state.viewer.canvas?.width>0&&state.viewer.canvas?.height>0);assert.equal(state.viewer.canvas.lost,false)
 if(expected.activeId===null){assert.equal(state.viewer.empty,true);return true}
 const active=expected.capes.find(cape=>cape.id===expected.activeId);assert(active)
 assert.equal(state.viewer.capeSha256,active.dataUrlSha256,'Actual mounted viewer must receive the selected cape pixels')
 assert.equal(state.uploads?.errors.length,0)
 const upload=state.uploads.rows.find(row=>row.ordinal>uploadAfter&&row.width===active.atlas.width&&row.height===active.atlas.height&&row.rgbaSha256===active.atlas.rgbaSha256)
 assert(upload,'Actual WebGL upload must contain the selected, normalized cape RGBA bytes');assert.equal(upload.originalError,null)
 assert.equal(upload.timeOrigin,expected.timeOrigin);assert.equal(upload.url,expected.url);assert.equal(upload.focus,true);assert.equal(upload.hidden,false)
 return true
}
function assertCapeViewport(native,renderer,theme,minimumSize){
 assert(Array.isArray(minimumSize)&&minimumSize.length===2&&minimumSize.every(value=>Number.isFinite(value)&&value>1))
 assert.deepEqual(native.minimumSize,minimumSize);assert(native.bounds.width>=minimumSize[0]&&native.bounds.height>=minimumSize[1]);assert.equal(native.zoom,1.25)
 assert.equal(renderer.width,Math.round(native.contentBounds.width/native.zoom));assert.equal(renderer.height,Math.round(native.contentBounds.height/native.zoom))
 assert.equal(native.visible,true);assert.equal(native.minimized,false);assert.equal(native.focused,true);assert.equal(native.appHidden,false)
 assert.equal(renderer.theme,theme);assert.equal(renderer.focus,true);assert.equal(renderer.hidden,false)
 return true
}
function assertCapeMinimum(scene,theme){
 assert.deepEqual(scene.requestedContent,{width:2,height:2});assert.deepEqual(scene.repeatRequestedContent,{width:1,height:1})
 assertCapeViewport(scene.first.native,scene.first.renderer,theme,scene.originalMinimumSize);assertCapeViewport(scene.second.native,scene.second.renderer,theme,scene.originalMinimumSize)
 for(const key of ['pid','windowId','webContentsId','zoom'])assert.equal(scene.first.native[key],scene.second.native[key])
 for(const name of ['bounds','contentBounds'])for(const key of ['x','y','width','height'])assert.equal(scene.first.native[name][key],scene.second.native[name][key],'Two smaller native requests must preserve the exact actual minimum geometry')
 assert.equal(scene.first.renderer.timeOrigin,scene.second.renderer.timeOrigin);assert.equal(scene.first.renderer.url,scene.second.renderer.url)
 return true
}
function assertCapeDrag(observation,expected,bounds){
 assert.equal(observation.selector,expected.selector);assert.equal(observation.timeOrigin,expected.timeOrigin);assert.equal(observation.url,expected.url);assert.equal(observation.overflow,false)
 for(const type of ['pointerdown','pointerup'])assert.equal(observation.records.filter(row=>row.type===type).length,1)
 for(const row of observation.records){assert.equal(row.isTrusted,true);assert.equal(row.matchesSelector,true);assert.equal(row.timeOrigin,expected.timeOrigin);assert.equal(row.url,expected.url);assert.equal(row.renderer.hasFocus,true);assert.equal(row.renderer.hidden,false);assert(Number.isFinite(row.at));assert(row.x>=bounds.x&&row.x<=bounds.x+bounds.width&&row.y>=bounds.y&&row.y<=bounds.y+bounds.height)}
 return true
}
function assertCapeRestoration(value,originalNative,originalRenderer,originalWin32){
 const n=value.native,r=value.renderer;for(const key of ['pid','windowId','webContentsId','zoom','maximized'])assert.equal(n[key],originalNative[key])
 for(const name of ['bounds','contentBounds'])for(const key of ['x','y','width','height'])assert.equal(n[name][key],originalNative[name][key])
 assert.deepEqual(n.minimumSize,originalNative.minimumSize);assert.equal(n.focused,true);assert.equal(n.visible,true);assert.equal(n.minimized,false);assert.equal(n.appHidden,false)
 for(const key of ['width','height','pixelRatio','url','theme'])assert.equal(r[key],originalRenderer[key]);assert.equal(r.readyState,'complete');assert.equal(r.focus,true);assert.equal(r.hidden,false)
 if(originalWin32){assert.deepEqual(value.win32.windowRectAsReported,originalWin32.windowRectAsReported);assert.deepEqual(value.win32.clientRectAsReported,originalWin32.clientRectAsReported);for(const key of ['pid','queryDpiContext','queryDpiAwareness','dpi'])assert.equal(value.win32[key],originalWin32[key])}
 return true
}

async function makeCapeFixtures(directory){
 const sharp=require('sharp'),sources=[],publicRoot=process.env.KAMUCL_CAPE_PUBLIC_FIXTURE_ROOT?fs.realpathSync.native(process.env.KAMUCL_CAPE_PUBLIC_FIXTURE_ROOT):null
 if(publicRoot)assert(fs.statSync(publicRoot).isDirectory())
 const approved={mojang_cape:'5786fe99be377dfb6858859f926c4dbc995751e91cee373468c5fbf4865e7151',legacy_cape:'51557146be1091c8eb20fffc963760168b225f2642fa861f5220df5595ef8e51',hd_cape:'6b224a49046b5a17e9f14e857eee2d33a1e33de02d2c3eb565fbb217b88fa928'}
 for(const name of ['mojang_cape','legacy_cape','hd_cape']){
  const url=`https://raw.githubusercontent.com/bs-community/skinview3d/v3.4.2/examples/public/img/${name}.png`;let bytes,transport
  if(publicRoot){const file=path.join(publicRoot,name+'.png'),stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink());bytes=fs.readFileSync(file);assert.equal(hash(bytes),approved[name],'Preserved public original bytes changed');transport={kind:'Explicit preserved public original; not a current network success',file,expectedSha256:approved[name]}}
  else{const response=await fetch(url,{signal:AbortSignal.timeout(8000)});assert.equal(response.status,200,'Public fixture download failed: '+name);bytes=Buffer.from(await response.arrayBuffer());transport={kind:'Actual public source HTTP 200 download'}}
  assert(bytes.length<1_490_000);assert.equal(hash(bytes),approved[name],'Public source must match the frozen v3.4.2 original')
  const metadata=await sharp(bytes).metadata();assert.equal(metadata.format,'png');assert(metadata.width>0&&metadata.height>0)
  fs.writeFileSync(path.join(directory,name+'.png'),bytes,{flag:'wx'});sources.push({name,url,transport,bytes,sha256:hash(bytes),width:metadata.width,height:metadata.height})
 }
 const definitions=[['cape-aurora','Aurora',2,1],['cape-hero','Hero',1,1],['cape-twisted','Twisted',0,2],['cape-pan','Pan',0,1],['cape-common','Common',1,2]],capes=[]
 for(const[id,alias,index,multiple]of definitions){const source=sources[index],bytes=multiple===1?source.bytes:await sharp(source.bytes).resize(source.width*multiple,source.height*multiple,{kernel:'nearest'}).png().toBuffer()
  const metadata=await sharp(bytes).metadata(),scale=metadata.width/(metadata.width===metadata.height*2?64:22),width=64*scale,height=32*scale
  const rgba=await sharp({create:{width,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:bytes,left:0,top:0}]).raw().toBuffer()
  const dataUrl='data:image/png;base64,'+bytes.toString('base64');fs.writeFileSync(path.join(directory,id+'.png'),bytes,{flag:'wx'})
  capes.push({id,alias,url:source.url,dataUrl,dataUrlSha256:hash(Buffer.from(dataUrl)),pngSha256:hash(bytes),failed:!['cape-pan','cape-common'].includes(id),
   source:source.name,multiple,width:metadata.width,height:metadata.height,sharpRgbaBase64:rgba.toString('base64'),atlas:{width,height,rgbaSha256:hash(rgba)}})
 }
 return{sources:sources.map(({bytes,...row})=>row),capes}
}

async function runCapes(harness){
 const{call,evaluate,main,wait,profile,root,ownedTrack,version}=harness,theme=process.env.KAMUCL_TEST_THEME||'black-orange'
 const directory=path.resolve('out','qa-capes115-'+theme+'-'+crypto.randomUUID());fs.mkdirSync(directory,{recursive:true})
 const proof={schema:'kamucl-capes115-real-ui',version,theme,root,profile,classification:'Actual packaged renderer, original trusted inputs and WebGL uploads; synthetic IPC accounts/public texture fixtures. No user account, Microsoft request, product-cache or game-world acceptance inferred',
  complete:false,operations:[],inputs:[],stages:[],captures:[],cleanup:[],startedAt:new Date().toISOString()},save=()=>fs.writeFileSync(path.join(directory,'proof.json'),JSON.stringify(proof,null,2))
 const nativeWindow=require('./qa-native-window115.cjs'),koffiPath=process.platform==='win32'?require.resolve('koffi'):null
 proof.qaSources=['qa-capes115.cjs','qa-capes115-tests.cjs','qa-coordinate-geometry114.cjs','qa-privacy-categories115.cjs','qa-owned-process-119.cjs','verify-ui-refinement.cjs','qa-native-window115.cjs'].map(name=>{const file=path.join(__dirname,name),bytes=fs.readFileSync(file);return{file,bytes:bytes.length,sha256:hash(bytes)}})
 proof.observerSources=[installCapeFixture,cleanupCapeFixture,installCapeUploadObserver,rendererCapeState,decodeCapeReferences,...process.platform==='win32'?[nativeWindow.focusOwned,nativeWindow.observeOwned,nativeWindow.captureOwned]:[]].map(fn=>({name:fn.name,sourceSha256:hash(Buffer.from(fn.toString()))}))
 proof.nativeForegroundObservations=[]
 proof.ownedProcess={pid:ownedTrack.pid,ledger:ownedTrack.ledger,classification:'Original disposable runner process ownership record; browser main PID is separately observed and bound below'}
 save();let installed=false,observer=false,failure,binding
 const remaining=(deadline)=>Math.max(1,deadline-performance.now())
 const until=async(label,read,predicate,maximumMs=10000)=>{const deadline=performance.now()+maximumMs,row={label,maximumMs,samples:[],complete:false};proof.stages.push(row);save()
  while(performance.now()<deadline){let value,matched=false;const sample={at:performance.now()}
   try{value=await read(remaining(deadline));sample.value=value;try{matched=!!predicate(value)}catch(error){sample.predicateError={name:error.name,message:error.message}}}
   catch(error){sample.readError={name:error.name,message:error.message}}
   sample.returnedAt=performance.now();row.samples.push(sample);save();if(performance.now()<deadline&&matched){row.complete=true;save();return value}await wait(Math.min(75,Math.max(0,deadline-performance.now())))}
  throw Error('Original '+label+' deadline elapsed')}
 const readNative=async(timeout=10000)=>{const value=await main(`(()=>{const e=testElectron,w=e.BrowserWindow.fromId(${proof.identity?.windowId});if(!w||w.webContents.id!==${proof.identity?.webContentsId})throw Error('Owned cape window changed');return{pid:process.pid,windowId:w.id,webContentsId:w.webContents.id,ownedAppMetrics:e.app.getAppMetrics().map(row=>({pid:row.pid,type:row.type,creationTime:row.creationTime})),bounds:w.getBounds(),contentBounds:w.getContentBounds(),minimumSize:w.getMinimumSize(),handleBytes:w.getNativeWindowHandle().toString('hex'),geometryUnits:'Original Electron getter values as reported in DIP; not claimed physical pixels',zoom:w.webContents.getZoomFactor(),maximized:w.isMaximized(),visible:w.isVisible(),minimized:w.isMinimized(),focused:w.isFocused(),appHidden:process.platform==='darwin'?e.app.isHidden():false,appHiddenApplicable:process.platform==='darwin'${process.platform==='win32'?`,nativeForeground:(${nativeWindow.observeOwned.toString()})(${JSON.stringify(proof.identity)},${JSON.stringify(koffiPath)})`:''}}})()`,timeout)
  if(value.nativeForeground){proof.nativeForegroundObservations.push({at:performance.now(),value:value.nativeForeground});save();assertCapeForeground(value.nativeForeground,proof.identity)}return value}
 const reload=async label=>{const before=await evaluate('({timeOrigin:performance.timeOrigin,url:location.href})');await call('Page.reload');const ready=await until(label,async timeout=>evaluate(`(${require('./verify-ui-refinement.cjs').readActualRendererTheme.toString()})(${before.timeOrigin})`,timeout),state=>state.timeOrigin!==before.timeOrigin&&state.url===before.url&&state.readyState==='complete'&&state.initialized===true&&state.storeTheme===theme&&state.domTheme===theme,12000)
  binding={timeOrigin:ready.timeOrigin,url:ready.url};proof.documents??=[];proof.documents.push({label,before,after:binding});save()}
 const point=async selector=>{const deadline=performance.now()+10000,operation={selector,deadline,samples:[],complete:false};proof.operations.push(operation);save();let token,error
  try{await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`,remaining(deadline))
   const actual=await geometry.waitForStableCoordinate({expected:{...proof.identity,...binding,zoom:1.25},deadline,wait,onSample:row=>{operation.samples.push(row);save()},read:async()=>({native:await readNative(remaining(deadline)),coordinate:await evaluate(geometry.coordinateExpression(selector),remaining(deadline))})})
   token=await evaluate(geometry.trustedTargetStartExpression(selector),remaining(deadline));operation.token=token
   for(const[type,buttons]of[['mouseMoved',0],['mousePressed',1],['mouseReleased',0]]){assert(performance.now()<deadline);const nativeBefore=await readNative(remaining(deadline)),parameters={type,x:actual.coordinate.x,y:actual.coordinate.y,button:type==='mouseMoved'?'none':'left',buttons,clickCount:type==='mouseMoved'?0:1};proof.inputs.push({method:'Input.dispatchMouseEvent',at:performance.now(),parameters,nativeBefore});save();await call('Input.dispatchMouseEvent',parameters,remaining(deadline));assert(performance.now()<deadline)}
   operation.actual=actual;operation.complete=true
  }catch(caught){error=caught;operation.error={name:caught.name,message:caught.message};throw caught}
  finally{if(token!==undefined)try{operation.targets=await evaluate(geometry.trustedTargetStopExpression(token),remaining(deadline));assert.equal(operation.targets.token,token);geometry.assertTrustedTargetObservation(operation.targets,{selector,...binding});assert(performance.now()<deadline)}catch(caught){operation.complete=false;operation.targetError={name:caught.name,message:caught.message};if(!error)throw caught}finally{save()}save()}
 }
 const nav=async id=>{await point(`[data-nav=${id}]`);await until('actual route '+id,timeout=>evaluate(`({selected:document.querySelector('[data-nav][aria-current=page]')?.dataset.nav})`,timeout),state=>state.selected===id)}
 const inspect=async(timeout=10000)=>{const deadline=performance.now()+timeout;await readNative(remaining(deadline));return evaluate(`(${rendererCapeState.toString()})()`,remaining(deadline))}
 const expect=(activeId,account=proof.accounts[0],incomplete=false)=>({theme,...binding,username:account.username,activeId,capes:proof.fixtures.capes.filter(cape=>account.id===proof.accounts[0].id||cape.id==='cape-common'),incomplete})
 const presentation=async(label,activeId,options={})=>until(label,inspect,state=>assertCapePresentation(state,expect(activeId,options.account),options))
 const capture=async(label,deadline)=>{if(deadline!==undefined)assert(performance.now()<deadline);const timeout=()=>deadline===undefined?10000:remaining(deadline),before={native:await readNative(timeout()),renderer:await inspect(timeout())};if(label!=='original-failure'){
   assertCapeViewport(before.native,before.renderer,theme,proof.originalNative.minimumSize)
   assert(proof.minimum?.complete,'Original two-request minimum observation must qualify before capture')
   for(const name of ['bounds','contentBounds'])for(const key of ['x','y','width','height'])assert.equal(before.native[name][key],proof.minimum.second.native[name][key])
  }const image=await call('Page.captureScreenshot',{format:'png'},timeout()),bytes=Buffer.from(image.data,'base64'),file=label+'.png';fs.writeFileSync(path.join(directory,file),bytes,{flag:'wx'});const capture={label,file,bytes:bytes.length,sha256:hash(bytes),before,deadline,returnedAt:performance.now()};proof.captures.push(capture);save();capture.afterNative=await readNative(timeout());
  if(process.platform==='win32'&&label.endsWith('-3d')){const sidebar=await evaluate("document.querySelector('.sidebar').getBoundingClientRect().toJSON()",timeout());capture.privateNative=await main(`(${nativeWindow.captureOwned.toString()})(${JSON.stringify(proof.identity)},${JSON.stringify(sidebar)},${JSON.stringify(directory)},${JSON.stringify(label)},${JSON.stringify(koffiPath)})`,timeout());capture.privateNativeClassification='Private native application/sidebar crops may contain another always-on-top window. Do not publish without separate pixel privacy review; no whole display file persisted.'}save();if(deadline!==undefined)assert(performance.now()<deadline)}
 const showViewer=async(label,{deadline=performance.now()+10000,clearToasts=true}={})=>{const selector='.skins-page .preview-3d .viewer3d',operation={label,deadline,clearToasts,classification:'Read-only actual presentation visibility and natural toast retirement; no input dispatch or toast dismissal',selector,samples:[],complete:false};proof.operations.push(operation);save()
  await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`,remaining(deadline))
  const actual=await geometry.waitForStableCoordinate({expected:{...proof.identity,...binding,zoom:1.25},deadline,wait,onSample:row=>{operation.samples.push(row);save()},read:async()=>({native:await readNative(remaining(deadline)),coordinate:await evaluate(geometry.coordinateExpression(selector,{absentSelectors:clearToasts?['.toasts .toast']:[]}),remaining(deadline))})})
  operation.actual=actual;operation.complete=true;save()
 }
 const rotateViewer=async(deadline=performance.now()+10000)=>{const selector='.skins-page .preview-3d .viewer3d',operation={label:'actual native drag turns the first cape for independent visual review',deadline,selector,samples:[],complete:false,classification:'Original native pointer gesture inside the real owned viewer, followed by original two scheduled presentation observations; no yaw/state assignment or visual pass inferred'};proof.operations.push(operation);save();let token,error
  try{const actual=await geometry.waitForStableCoordinate({expected:{...proof.identity,...binding,zoom:1.25},deadline,wait,onSample:row=>{operation.samples.push(row);save()},read:async()=>({native:await readNative(remaining(deadline)),coordinate:await evaluate(geometry.coordinateExpression(selector),remaining(deadline))})});const r=actual.coordinate.bounds,y=r.y+r.height*.5,start=r.x+r.width*.12,end=r.x+r.width*.90
   operation.actual=actual;operation.endpoints=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return{start:e.contains(document.elementFromPoint(${start},${y})),end:e.contains(document.elementFromPoint(${end},${y}))}})()`,remaining(deadline));assert.equal(operation.endpoints.start,true);assert.equal(operation.endpoints.end,true)
   token=await evaluate(geometry.trustedTargetStartExpression(selector),remaining(deadline));operation.token=token
   for(const[type,x,buttons]of[['mouseMoved',start,0],['mousePressed',start,1],['mouseMoved',start+(end-start)/3,1],['mouseMoved',start+2*(end-start)/3,1],['mouseMoved',end,1],['mouseReleased',end,0]]){assert(performance.now()<deadline);const nativeBefore=await readNative(remaining(deadline)),parameters={type,x,y,button:type==='mouseMoved'&&buttons===0?'none':'left',buttons,clickCount:type==='mouseMoved'?0:1};proof.inputs.push({method:'Input.dispatchMouseEvent',at:performance.now(),parameters,nativeBefore});save();await call('Input.dispatchMouseEvent',parameters,remaining(deadline));assert(performance.now()<deadline)}
   operation.presentation=await evaluate(`new Promise(resolve=>{const rows=[];const observe=at=>{rows.push({at,now:performance.now(),timeOrigin:performance.timeOrigin,url:location.href,focus:document.hasFocus(),hidden:document.hidden,pose:document.querySelector(${JSON.stringify(selector)})?.dataset.pose});if(rows.length===2)resolve(rows);else requestAnimationFrame(observe)};requestAnimationFrame(observe)})`,remaining(deadline));assert.equal(operation.presentation.length,2);assert(operation.presentation[1].at>operation.presentation[0].at);for(const row of operation.presentation){assert.equal(row.timeOrigin,binding.timeOrigin);assert.equal(row.url,binding.url);assert.equal(row.focus,true);assert.equal(row.hidden,false);assert(row.pose)}operation.complete=true
  }catch(caught){error=caught;operation.error={name:caught.name,message:caught.message};throw caught}
  finally{if(token!==undefined)try{operation.targets=await evaluate(geometry.trustedTargetStopExpression(token),remaining(deadline));assertCapeDrag(operation.targets,{selector,...binding},operation.actual.coordinate.bounds);assert(performance.now()<deadline)}catch(caught){operation.complete=false;operation.targetError={name:caught.name,message:caught.message};if(!error)throw caught}finally{save()}save()}
 }
 try{
  assert(process.env.KAMUCL_GUI_APP&&!process.env.KAMUCL_GUI_DEV&&process.env.KAMUCL_GUI_SOFTWARE!=='1','Cape native acceptance requires the explicit actual packaged application without a QA software override')
  const application=path.resolve(process.env.KAMUCL_GUI_APP),applicationBytes=fs.readFileSync(application);proof.application={path:application,bytes:applicationBytes.length,sha256:hash(applicationBytes)};save()
  proof.fixtures=await makeCapeFixtures(directory);proof.accounts=[{id:'qa-capes115-A',type:'microsoft',username:'合成披风 QA A',uuid:'00000000000000000000000000000115'},
   {id:'qa-capes115-B',type:'microsoft',username:'合成披风 QA B',uuid:'00000000000000000000000000000116'}]
  const url=await evaluate('location.href'),expectedProfile=fs.realpathSync.native(profile)
  const native=await main(`(()=>{const e=testElectron,f=process.mainModule.require('node:fs'),windows=e.BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL()===${JSON.stringify(url)});if(windows.length!==1)throw Error('Expected one owned renderer');const w=windows[0];return{pid:process.pid,ppid:process.ppid,windowId:w.id,webContentsId:w.webContents.id,profile:f.realpathSync.native(e.app.getPath('userData'))}})()`)
  assert(native.pid===ownedTrack.pid||native.ppid===ownedTrack.pid);assert.equal(native.profile,expectedProfile);proof.identity={pid:native.pid,windowId:native.windowId,webContentsId:native.webContentsId};proof.binding=native
  await call('Emulation.setFocusEmulationEnabled',{enabled:false});proof.focusEmulationDisabled=true
  if(process.platform==='win32'){proof.initialForegroundFocus=await main(`(${nativeWindow.focusOwned.toString()})(${JSON.stringify(proof.identity)},${JSON.stringify(koffiPath)})`);save()}
  proof.originalNative=await readNative()
  proof.originalRenderer=await inspect();proof.originalViewportMapping={widthDifference:proof.originalRenderer.width-Math.round(proof.originalNative.contentBounds.width/proof.originalNative.zoom),heightDifference:proof.originalRenderer.height-Math.round(proof.originalNative.contentBounds.height/proof.originalNative.zoom),classification:'Original independently reported native DIP getter and renderer CSS viewport; baseline differences are recorded, never used to relax the minimum-window input contract'}
  if(process.platform==='win32')proof.originalWin32=require('./qa-privacy-categories115.cjs').readOwnedWinClient(proof.originalNative.handleBytes,native.pid)
  proof.install=await main(`(${installCapeFixture.toString()})(${JSON.stringify({profile:expectedProfile,...proof.identity,token:crypto.randomUUID(),accounts:proof.accounts,capes:proof.fixtures.capes})})`);installed=true;save()
  proof.minimum={originalMinimumSize:proof.originalNative.minimumSize,requestedContent:{width:2,height:2},repeatRequestedContent:{width:1,height:1},zoom:1.25,complete:false,classification:'Two smaller native content requests constrained by the original minimumSize; actual stable outer/content sizes are recorded, no requested-size substitution or physical pixel claim'}
  await main(`(()=>{const w=testElectron.BrowserWindow.fromId(${native.windowId});w.unmaximize();w.setContentSize(2,2);w.webContents.setZoomFactor(1.25);if(process.platform==='darwin')testElectron.app.focus({steal:true});w.show();w.focus();return true})()`)
  await reload('synthetic fixture initialized in actual new document')
  const layout=async timeout=>({native:await readNative(timeout),renderer:await inspect(timeout)})
  proof.minimum.first=await until('actual first native minimum viewport',layout,state=>assertCapeViewport(state.native,state.renderer,theme,proof.minimum.originalMinimumSize))
  await main(`(()=>{const w=testElectron.BrowserWindow.fromId(${native.windowId});w.setContentSize(1,1);return true})()`)
  proof.minimum.second=await until('actual repeated smaller native minimum viewport',layout,state=>{assertCapeViewport(state.native,state.renderer,theme,proof.minimum.originalMinimumSize);for(const name of ['bounds','contentBounds'])for(const key of ['x','y','width','height'])assert.equal(state.native[name][key],proof.minimum.first.native[name][key]);return true})
  assertCapeMinimum(proof.minimum,theme);if(process.platform==='win32')proof.minimum.win32=require('./qa-privacy-categories115.cjs').readOwnedWinClient(proof.minimum.second.native.handleBytes,native.pid);proof.minimum.complete=true;save()
  proof.references=await evaluate(`(${decodeCapeReferences.toString()})(${JSON.stringify(proof.fixtures.capes.map(cape=>({id:cape.id,dataUrl:cape.dataUrl,width:cape.width,height:cape.height,sharpRgbaBase64:cape.sharpRgbaBase64,sharpAtlasSha256:cape.atlas.rgbaSha256})))})`)
  assert.equal(proof.references.length,proof.fixtures.capes.length);for(const cape of proof.fixtures.capes){const reference=proof.references.find(row=>row.id===cape.id);assert(reference);assert.equal(reference.timeOrigin,binding.timeOrigin);assert.equal(reference.url,binding.url);assert.equal(reference.sourceDataUrlSha256,cape.dataUrlSha256);cape.sharpAtlas=cape.atlas;cape.atlas=reference.atlas;cape.thumbnail=reference.thumbnail;delete cape.sharpRgbaBase64}save()
  proof.uploadObserver=await evaluate(`(${installCapeUploadObserver.toString()})()`);observer=true;save()
  await nav('skins');await presentation('initial three missing public texture fixture rows visible','cape-pan',{incomplete:true});await capture('01-incomplete-capes')
  await point('.pane-capes .pane-head button');await presentation('actual refresh repairs five thumbnail rows and keeps real viewer','cape-pan');proof.mainAfterRefresh=await main('__qaCapeFixture115.snapshot()');assert(proof.mainAfterRefresh.profiles.some(row=>row.refresh===true&&row.recovered));await capture('02-refreshed-five-capes')
  for(const[id,index]of [['cape-aurora',1],['cape-hero',2],['cape-twisted',3],['cape-common',5],['cape-pan',4]]){
   const prior=await inspect();await point(`.cape-item:nth-child(${index})`);await presentation('actual cape activation '+id,id,{uploadAfter:prior.uploads.rows.length});await capture('03-active-'+id+'-thumbnail');const deadline=performance.now()+10000;await showViewer('actual '+id+' 3D canvas visible',{deadline,clearToasts:id!=='cape-aurora'});if(id==='cape-aurora'){await rotateViewer(deadline);await showViewer('actual dragged cape after natural toast retirement',{deadline})}await capture('03-active-'+id+'-3d',deadline)
  }
  await point('.cape-item:nth-child(4)');await presentation('actual cape deactivation clears mounted viewer source',null);await showViewer('actual unworn viewer visible');await capture('04-unworn')
  await point('.cape-item:nth-child(4)');await presentation('actual reactivation restores public cape pixels','cape-pan')
  await point('.skin-editor-entry');await until('real skin editor mounts',inspect,state=>state.modal.editor)
  await point('.skin-editor .editor-upload');await until('real upload confirmation mounts',inspect,state=>state.modal.upload)
  await capture('05-confirm-before-cancel')
  const uploadsBefore=await main('__qaCapeFixture115.snapshot().uploads.length');await point('.skin-upload-dialog [data-modal-dismiss]');await until('real cancellation dismisses only upload confirmation',inspect,state=>state.modal.editor&&!state.modal.upload)
  assert.equal(await main('__qaCapeFixture115.snapshot().uploads.length'),uploadsBefore);await point('.skin-editor .editor-close');await until('actual editor close leaves cape presentation',inspect,state=>!state.modal.editor&&!state.modal.upload);await presentation('cancel kept original cape and thumbnails','cape-pan');await capture('05-cancel-zero-upload')
  await main('__qaCapeFixture115.deferNext=true;true');await point('.cape-item:nth-child(1)');await until('actual original account change is held',timeout=>main('__qaCapeFixture115.snapshot()',timeout),state=>state.pending&&state.changes.at(-1)?.accountId===proof.accounts[0].id)
  await nav('home');await point('.account-more');await until('actual account management view mounts',timeout=>evaluate("({title:document.querySelector('.acc-top .page-title')?.textContent.trim(),names:[...document.querySelectorAll('.account-row .account-name')].map(e=>e.textContent.trim())})",timeout),state=>state.title==='账号'&&state.names.length===2&&state.names.every((name,index)=>name.includes(proof.accounts[index].username)));await point('.account-row:nth-child(2)');await until('actual account selection handler completed',timeout=>main('__qaCapeFixture115.snapshot()',timeout),state=>state.selected===proof.accounts[1].id)
  await nav('skins');await presentation('new actual account owns only its own cape','cape-common',{account:proof.accounts[1]});await capture('06-account-B-before-old-response')
  await main('__qaCapeFixture115.release()');await until('old original response returned after new account selected',timeout=>main('__qaCapeFixture115.snapshot()',timeout),state=>!state.pending&&state.changes.at(-1).returned)
  await presentation('late original account response cannot replace current cape','cape-common',{account:proof.accounts[1]});await capture('07-account-B-after-old-response')
  proof.finalMain=await main('__qaCapeFixture115.snapshot()');assert.equal(proof.finalMain.uploads.length,0);const delayed=proof.finalMain.changes.at(-1),selected=proof.finalMain.selections.at(-1);assert(delayed.order<selected.order&&delayed.returnedOrder>selected.order)
  proof.ownedAppMetricsBeforeClose=(await readNative()).ownedAppMetrics
  if(process.platform==='win32'){assert(proof.nativeForegroundObservations.length>0);for(const row of proof.nativeForegroundObservations)assertCapeForeground(row.value,proof.identity)}
  proof.complete=true
 }catch(error){failure=error;proof.error={name:error.name,message:error.message};try{await capture('original-failure')}catch(caught){proof.failureCaptureError={name:caught.name,message:caught.message}}throw error}
 finally{
  if(observer)try{const result=await evaluate('window.__qaCapeUploads115.restore()');proof.cleanup.push({observer:result});assert.equal(result.complete,true)}catch(error){proof.complete=false;proof.cleanup.push({observerError:{name:error.name,message:error.message}});if(!failure)failure=error}
  try{const result=await evaluate(geometry.trustedTargetRestoreExpression());proof.cleanup.push({trustedTargets:result});assert.equal(result.complete,true)}catch(error){proof.complete=false;proof.cleanup.push({trustedTargetError:{name:error.name,message:error.message}});if(!failure)failure=error}
  if(installed)try{const result=await main(`(${cleanupCapeFixture.toString()})(${JSON.stringify(proof.install.token)})`);proof.cleanup.push({fixture:result});assert.equal(result.complete,true);await reload('original isolated harness handlers and new document restored')}
   catch(error){proof.complete=false;proof.cleanup.push({fixtureError:{name:error.name,message:error.message}});if(!failure)failure=error}
  if(proof.originalNative)try{
   const original=proof.originalNative;await main(`(()=>{const w=testElectron.BrowserWindow.fromId(${proof.identity.windowId});if(!w||w.webContents.id!==${proof.identity.webContentsId})throw Error('Owned restoration window changed');w.unmaximize();${process.platform==='win32'?'':`w.setBounds(${JSON.stringify(original.bounds)});`}w.webContents.setZoomFactor(${original.zoom});${original.maximized?'w.maximize();':''}return true})()`)
   if(proof.originalWin32)proof.win32Restore=restoreOwnedWinRectangle(proof.originalWin32)
   const restored=await until('actual original owned window geometry restored',async timeout=>({native:await readNative(timeout),renderer:await inspect(timeout),...(proof.originalWin32?{win32:require('./qa-privacy-categories115.cjs').readOwnedWinClient(proof.originalWin32.handleBytes,proof.identity.pid)}:{})}),value=>assertCapeRestoration(value,original,proof.originalRenderer,proof.originalWin32),5000)
   proof.cleanup.push({nativeRestore:{complete:true,after:restored,originalNativeGetter:proof.originalNative}})
  }catch(error){proof.complete=false;proof.cleanup.push({nativeRestoreError:{name:error.name,message:error.message}});if(!failure)failure=error}
  if(proof.focusEmulationDisabled)try{await call('Emulation.setFocusEmulationEnabled',{enabled:true});proof.cleanup.push({harnessFocusEmulationRestored:true,source:'Original refinement harness explicitly enables this before extension modules'})}
   catch(error){proof.complete=false;proof.cleanup.push({focusEmulationRestoreError:{name:error.name,message:error.message}});if(!failure)failure=error}
  proof.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({module:'capes115',complete:proof.complete,theme,directory,classification:proof.classification}));if(failure&&!proof.error)throw failure
 }
}
module.exports=runCapes
Object.assign(module.exports,{installCapeFixture,cleanupCapeFixture,installCapeUploadObserver,rendererCapeState,assertCapePresentation,assertCapeViewport,assertCapeMinimum,assertCapeDrag,assertCapeRestoration,makeCapeFixtures,decodeCapeReferences,restoreOwnedWinRectangle,assertCapeForeground})
