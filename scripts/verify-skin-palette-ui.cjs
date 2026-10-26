// Runs after the legacy extension checks in the isolated real-Electron harness.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), sharp = require('sharp'), crypto = require('node:crypto'), {execFileSync}=require('node:child_process')
const {installSkinFixtureDiagnostic}=require('./verify-skin-editor-ui.cjs')
function paletteRgbaDelta(before,after){
  assert.equal(before.length,64*64*4);assert.equal(after.length,before.length)
  const changedTexels=[];let changedBytes=0
  for(let i=0;i<before.length;i+=4){let changed=false;for(let k=0;k<4;k++)if(before[i+k]!==after[i+k]){changed=true;changedBytes++}if(changed)changedTexels.push({x:(i/4)%64,y:Math.floor(i/256),before:Array.from(before.slice(i,i+4)),after:Array.from(after.slice(i,i+4))})}
  return{changedBytes,changedTexels}
}
function paletteSaveReady(s){
  return !!(s.request?.returned===true&&s.request.result===true&&!s.request.error&&
    s.document?.header?.includes('已保存')&&s.document.viewer?.editDisabled===false&&
    s.controls?.editorExists&&s.controls.viewerCanvasVisible&&!s.controls.contentInert&&
    s.controls.saveDisabled===false&&s.controls.drawDisabled===false&&!s.controls.error)
}
module.exports = async ({ evaluate, call, main, nav, wait, root, screenshot, version }) => {
  const theme=process.env.KAMUCL_TEST_THEME||'black-orange',ledgerFile='out/skin-palette-state-119-'+theme+'.json'
  const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
  const ledger={version,theme,schemaVersion:1,complete:false,startedAt:new Date().toISOString(),maximumSaveMs:6000,classification:'original single-coordinate palette strokes; read-only real document, UV, input and save completion observations; no paint retries',source:{observer:'scripts/verify-skin-editor-ui.cjs:installSkinFixtureDiagnostic',observerSHA256:sha(fs.readFileSync(require.resolve('./verify-skin-editor-ui.cjs'))),paletteScriptSHA256:sha(fs.readFileSync(__filename))},paints:[],saves:[],observations:[]}
  const persist=()=>fs.writeFileSync(ledgerFile,JSON.stringify({...ledger,recordedAt:new Date().toISOString()},null,2))
  const stateExpression=`(()=>{const documentState=window.__skinFixtureDiagnostic.snapshot(),editor=document.querySelector('.skin-editor'),content=editor?.querySelector('.editor-content'),save=[...document.querySelectorAll('.editor-footer button')].find(e=>e.textContent.trim()==='保存 PNG…'),draw=document.querySelector('.editor-tool[aria-pressed="true"]'),canvas=document.querySelector('.skin-editor .viewer3d canvas'),r=canvas?.getBoundingClientRect();return{document:documentState,controls:{editorExists:!!editor,viewerCanvasVisible:!!r&&r.width>0&&r.height>0,contentInert:!!content?.inert||!!content?.closest('[inert]'),saveDisabled:save?!!save.disabled:null,drawDisabled:draw?!!draw.disabled:null,busy:document.querySelector('.editor-operation-status')?.textContent,error:document.querySelector('.editor-operation-error')?.textContent||'',closeDialog:!!document.querySelector('.skin-close-dialog')}}})()`
  const documentState=async(label,records=ledger.observations)=>{const state=await evaluate(stateExpression),rgba=state.document.rgba;assert(Array.isArray(rgba)&&rgba.length===16384,'palette diagnostic must read actual skin document');state.document.rgbaSHA256=sha(Buffer.from(rgba));delete state.document.rgba;records.push({label,...state});persist();return{state,rgba}}
  let saveObserverInstalled=false,primaryFailure
  const button = async text => evaluate(`(()=>{const b=[...document.querySelectorAll('.skins-page button,.page-head button,.skin-editor button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing palette button: '+${JSON.stringify(text)});b.click()})()`)
  const edit = async (selector, value) => { await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing palette field');e.focus();e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`); await wait(50) }
  const field = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).value`)
  const hex = () => field('.palette-hex')
  const clean = () => evaluate(`document.querySelector('.skin-editor header p').textContent.includes('已保存')`)
  const preferenceReadiness={version,maximumMs:6000,checks:[]}
  const preferencesReady=async(label,predicate)=>{
    const started=Date.now(),check={label,samples:[],ready:false};preferenceReadiness.checks.push(check)
    while(Date.now()-started<preferenceReadiness.maximumMs){
      let timer
      const settings=await Promise.race([
        evaluate("window.kamucl.invoke('settings:get')"),
        new Promise(resolve=>{timer=setTimeout(()=>resolve(null),Math.max(1,preferenceReadiness.maximumMs-(Date.now()-started)))})
      ]).finally(()=>clearTimeout(timer))
      if(!settings)break
      const elapsedMs=Date.now()-started,actual=settings.skinEditorPalette
      check.ready=elapsedMs<=preferenceReadiness.maximumMs&&predicate(actual)
      check.samples.push({elapsedMs,actual,ready:check.ready})
      fs.writeFileSync('out/skin-palette-preference-live.json',JSON.stringify(preferenceReadiness,null,2))
      if(check.ready)return settings
      await wait(Math.max(0,Math.min(50,preferenceReadiness.maximumMs-(Date.now()-started))))
    }
    check.elapsedMs=Date.now()-started;check.timedOut=true
    fs.writeFileSync('out/skin-palette-preference-live.json',JSON.stringify(preferenceReadiness,null,2))
    assert.fail(label+' did not reach real persisted preferences within 6 seconds: '+JSON.stringify(check.samples.at(-1)))
  }
  const layer = async value => { await evaluate(`(()=>{const e=document.querySelector('.skin-editor [aria-label=皮肤图层]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`); await wait(50) }
  const output = path.join(root, 'palette-opacity.png')
  const paint = async label => {
    const record={sequence:ledger.paints.length+1,label,snapshots:[]};ledger.paints.push(record);persist()
    let installed=false,paintFailure
    try{
    await evaluate(`(()=>{document.activeElement.blur();document.querySelector('.skin-editor').scrollTop=0})()`)
    await evaluate('('+installSkinFixtureDiagnostic.toString()+')()');installed=true
    await evaluate(`(()=>{const events=[],types=['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture'],observer=e=>{if(!e.target?.closest?.('.skin-editor .viewer3d'))return;events.push({type:e.type,at:performance.now(),trusted:e.isTrusted,x:e.clientX,y:e.clientY,button:e.button,buttons:e.buttons,pointerId:e.pointerId,pointerType:e.pointerType,documentFocus:document.hasFocus(),hidden:document.hidden,canvas:e.target===document.querySelector('.skin-editor canvas')})};for(const type of types)document.addEventListener(type,observer,true);window.__palettePointerDiagnostic={events,finish(){for(const type of types)document.removeEventListener(type,observer,true);return events}}})()`)
    const before=await documentState('before original single coordinate',record.snapshots)
    const r = await evaluate(`(()=>{const r=document.querySelector('.skin-editor canvas').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`), x = r.x+r.w*.5, y = r.y+r.h*.19
    record.target={rect:r,x,y,domHit:await evaluate(`(()=>{const e=document.elementFromPoint(${x},${y});return{tag:e?.tagName,classes:e?.className,canvas:e===document.querySelector('.skin-editor canvas')}})()`)};persist()
    for (const [type, buttons] of [['mouseMoved', 0], ['mousePressed', 1], ['mouseReleased', 0]]) await call('Input.dispatchMouseEvent', {type, x, y, button: type==='mouseMoved'?'none':'left', buttons, clickCount:type==='mouseMoved'?0:1})
    const after=await documentState('after original single coordinate',record.snapshots);Object.assign(record,paletteRgbaDelta(before.rgba,after.rgba));return record
    }catch(error){paintFailure=error;record.failure={message:error.message,stack:error.stack};throw error}
    finally{
      let cleanupFailure
      if(installed){
        try{record.pointerEvents=await evaluate('window.__palettePointerDiagnostic?.finish()')}catch(error){record.pointerCleanupError=error.message;cleanupFailure=error}
        try{const trace=await evaluate('window.__skinFixtureDiagnostic.finish()');record.events=trace.events;record.restoredListeners=trace.restoredListeners}catch(error){record.listenerCleanupError=error.message;cleanupFailure??=error}
      }
      persist();if(cleanupFailure&&!paintFailure)throw cleanupFailure
    }
  }
  const save = async () => {
    const record={sequence:ledger.saves.length+1,startedAt:new Date().toISOString(),samples:[],snapshots:[]};ledger.saves.push(record)
    await documentState('before original save',record.snapshots)
    const ordinal=await main('globalThis.palette119SaveRequests.length'),started=Date.now()
    const sample=async label=>{const actual=await documentState(label,record.samples),request=await main(`globalThis.palette119SaveRequests[${ordinal}]||null`),fileExists=fs.existsSync(output);Object.assign(actual.state,{elapsedMs:Date.now()-started,request,fileExists,pngSHA256:fileExists?sha(fs.readFileSync(output)):null});Object.assign(record.samples.at(-1),actual.state);persist();return actual.state}
    await button('保存 PNG…');await wait(300);let actual=await sample('original 300ms save sample')
    while(true){
      if(actual.request?.returned&&actual.request.result!==true)assert.fail('actual skin save canceled or failed: '+JSON.stringify(actual.request))
      if(actual.request?.error)assert.fail('actual skin save failed: '+JSON.stringify(actual.request))
      if(actual.elapsedMs<=ledger.maximumSaveMs&&paletteSaveReady(actual)){
        record.ready=true;record.elapsedMs=actual.elapsedMs;record.pngSHA256=actual.pngSHA256;persist();assert(actual.fileExists,'successful original save must produce a PNG')
        const bytes=fs.readFileSync(output),file=path.resolve('out','skin-palette-export-119-'+theme+'-'+record.sequence+'.png');fs.writeFileSync(file,bytes)
        record.export={file,sha256:sha(bytes),bytes:bytes.length,classification:'unchanged original successful save PNG bytes'};persist()
        const png=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});record.export.dimensions={width:png.info.width,height:png.info.height};persist();return png
      }
      if(actual.elapsedMs>=ledger.maximumSaveMs){record.ready=false;record.elapsedMs=actual.elapsedMs;persist();assert.fail('actual skin save did not finish within 6 seconds: '+JSON.stringify(actual))}
      await wait(Math.min(50,ledger.maximumSaveMs-actual.elapsedMs));actual=await sample('pending actual renderer save completion')
    }
  }
  // Canvas2D's premultiplied storage can round half-transparent channels by one; PNG alpha must be exact.
  const matchFace = (data, x, alpha) => { const pixels=[];for(let y=8;y<16;y++)for(let px=x;px<x+8;px++){const i=(y*64+px)*4,tolerance=alpha===255?0:1;if(Math.abs(data[i]-17)<=tolerance&&Math.abs(data[i+1]-119)<=tolerance&&Math.abs(data[i+2]-238)<=tolerance&&data[i+3]===alpha)pixels.push([px,y])}return pixels }
  persist()
  try{
  await main('testElectron.BrowserWindow.getAllWindows()[0].setSize(1280,900);testElectron.BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)')
  await nav('skins'); await button('绘制皮肤'); await wait(400); await button('正面'); await wait(650)
  await main(`testElectron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(output)}})`)
  await main(`globalThis.palette119OriginalSaveHandler=testElectron.ipcMain._invokeHandlers.get('skin:editorSave');if(typeof palette119OriginalSaveHandler!=='function')throw Error('Actual skin save handler missing');globalThis.palette119SaveRequests=[];testElectron.ipcMain.removeHandler('skin:editorSave');testElectron.ipcMain.handle('skin:editorSave',async function(...args){const request={enteredAt:Date.now(),returned:false};palette119SaveRequests.push(request);try{const result=await palette119OriginalSaveHandler.apply(this,args);request.result=result;return result}catch(error){request.error=String(error);throw error}finally{request.returned=true;request.returnedAt=Date.now()}})`);saveObserverInstalled=true
  await evaluate('('+installSkinFixtureDiagnostic.toString()+')()');await evaluate('window.__skinFixtureDiagnostic.finish()');await documentState('initial palette document')
  assert(await clean(), 'new editor starts without skin changes')
  await edit('.palette-hue', '120')
  // Focusing the hue input can scroll the independent tools pane. Measure the
  // actual visible SV target again before dispatching trusted coordinates.
  let sv,previous=''
  const readiness={version,samples:[]},saveReadiness=()=>fs.writeFileSync('out/skin-palette-ready-live.json',JSON.stringify(readiness,null,2))
  for(let i=0;i<40;i++){
    await evaluate(`document.activeElement?.blur();document.querySelector('.palette-sv').scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`);await wait(80)
    const state=await evaluate(`(()=>{const e=document.querySelector('.palette-sv'),r=e.getBoundingClientRect(),x=r.x+r.width*.8,y=r.y+r.height*.4,hit=document.elementFromPoint(x,y);return{x,y,rect:{x:r.x,y:r.y,width:r.width,height:r.height},innerWidth,innerHeight,hit:hit?.className,visible:r.width>0&&r.height>0&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&!e.closest('[inert]')&&e.contains(hit)}})()`),signature=JSON.stringify(state)
    readiness.samples.push(state);saveReadiness();if(state.visible&&signature===previous){sv=state;break}previous=signature
  }
  if(!sv){await screenshot('skin-palette-target-failure');assert.fail('SV target not visible and stable: '+JSON.stringify(readiness.samples.at(-1)))}
  for (const [type, buttons] of [['mouseMoved',0],['mousePressed',1],['mouseReleased',0]]) await call('Input.dispatchMouseEvent',{type,x:sv.x,y:sv.y,button:type==='mouseMoved'?'none':'left',buttons,clickCount:type==='mouseMoved'?0:1})
  for(let i=0;i<30;i++){readiness.actual={s:Number(await field('[aria-label="HSV S"]')),v:Number(await field('[aria-label="HSV V"]'))};saveReadiness();if(Math.abs(readiness.actual.s-80)<1&&Math.abs(readiness.actual.v-60)<1)break;await wait(50)}
  await screenshot('skin-palette-sv-coordinate')
  assert(Math.abs(Number(await field('[aria-label="HSV S"]'))-80)<1); assert(Math.abs(Number(await field('[aria-label="HSV V"]'))-60)<1)
  assert(await clean(), 'SV and hue gestures never edit skin pixels')
  await edit('.palette-hex', '#1177ee')
  assert.equal(await field('[aria-label="RGB R"]'), '17'); assert.equal(await field('[aria-label="RGB G"]'), '119'); assert.equal(await field('[aria-label="RGB B"]'), '238')
  assert(await clean(), 'selecting a colour is not a skin edit')
  const preview = await evaluate('document.querySelector(".palette-color-label").textContent')
  await edit('.palette-hex', '#12'); assert.equal(await evaluate('document.querySelector(".palette-color-label").textContent'), preview); assert.equal(await evaluate('document.querySelector(".palette-hex").getAttribute("aria-invalid")'), 'true')
  await edit('.palette-hex', '#1177ee'); await edit('[aria-label="RGB R"]', '200'); await evaluate('document.activeElement.blur()'); assert.equal(await hex(), '#c877ee')
  await edit('[aria-label="HSV H"]', '120'); await evaluate('document.activeElement.blur()'); assert.equal(await field('[aria-label="HSV H"]'), '120')
  const last = await hex(); await edit('[aria-label="HSV S"]', '101'); assert.equal(await evaluate('document.querySelector(".palette-color-label").textContent.toLowerCase()'), last)
  await evaluate('document.activeElement.blur()'); await edit('.palette-hex', '#1177ee'); await evaluate('document.activeElement.blur()')
  assert(await clean(), 'numeric adjustments and invalid drafts never dirty the texture')
  await button('+ 加入当前颜色').catch(() => undefined)
  let settings = await preferencesReady('custom colour addition persisted',p=>p.custom.includes('#1177ee'))
  assert.equal(await evaluate('document.querySelector(".palette-alpha").disabled'), true)
  await paint('base opaque brush'); let png = await save(); assert.equal(png.info.width, 64); assert.equal(png.info.height, 64); const inner = matchFace(png.data, 8, 255); assert(inner.length, 'base brush exports an opaque pixel')
  await layer('outer'); await edit('.palette-alpha-number input', '50'); await paint('outer half-transparent brush'); png = await save(); const outer = matchFace(png.data, 40, 128); assert(outer.length, 'outer alpha survives actual exported PNG')
  const outerOffset=(outer[0][1]*64+outer[0][0])*4,outerRgba=Array.from(png.data.subarray(outerOffset,outerOffset+4)),pickedHex='#'+outerRgba.slice(0,3).map(c=>c.toString(16).padStart(2,'0')).join('')
  const repeated=await paint('repeat same half-transparent pixel');assert.equal(repeated.changedTexels.length,0,'repeated half-transparent click must not change actual document texels');assert(await clean(),'repeating the same half-transparent pixel does not dirty unchanged canvas data')
  const beforeUndo = await evaluate(`[...document.querySelectorAll('.skin-editor button')].find(e=>e.textContent.trim()==='重做').disabled`)
  const nativeUndo = await evaluate(`(()=>{const e=document.querySelector('.palette-hex');e.focus();return e.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))})()`)
  assert(nativeUndo, 'text Ctrl+Z is not prevented by skin undo'); assert.equal(await evaluate(`[...document.querySelectorAll('.skin-editor button')].find(e=>e.textContent.trim()==='重做').disabled`), beforeUndo)
  await edit('.palette-hex', '#ff0000'); await edit('.palette-alpha-number input', '100'); await button('吸色'); const picked=await paint('eyedropper original coordinate');assert.equal(picked.changedTexels.length,0,'eyedropper must not change actual document texels'); await wait(50)
  assert.equal(await hex(), pickedHex); assert.equal(await field('.palette-alpha-number input'), '50.2'); assert(await clean(), 'picking a pixel does not dirty the texture')
  settings = await preferencesReady('picked alpha and recent colour persisted',p=>p.recent[0]==='#1177ee'&&p.alpha===128/255)
  await screenshot('skin-palette-117'); await edit('.palette-hex', '#124488'); await evaluate(`document.querySelector('[aria-label="关闭绘制皮肤"]').click()`)
  for(let i=0;i<30&&await evaluate('!!document.querySelector(".skin-editor")');i++)await wait(20)
  settings=await evaluate("window.kamucl.invoke('settings:get')"); assert.equal(settings.skinEditorPalette.color,'#124488','immediate close flushes the latest colour')
  await button('绘制皮肤'); await wait(300)
  assert.equal(await hex(), '#124488'); assert(await evaluate(`!!document.querySelector('[aria-label="使用自定义颜色 #1177ee"]')`)); await layer('outer'); assert.equal(await field('.palette-alpha-number input'), '50.2')
  await evaluate(`document.querySelector('[aria-label="删除自定义颜色 #1177ee"]').click()`)
  assert(!await evaluate(`!!document.querySelector('[aria-label="使用自定义颜色 #1177ee"]')`),'custom colour is removed from the actual palette')
  settings = await preferencesReady('custom colour deletion persisted',p=>!p.custom.includes('#1177ee'))
  await edit('.palette-hex', '#d88c58'); await edit('.palette-alpha-number input', '100'); await evaluate(`document.querySelector('[aria-label="关闭绘制皮肤"]').click()`); await wait(500); await nav('home')
  fs.writeFileSync('out/skin-palette-ui-'+theme+'.json', JSON.stringify({ version, synchronizedFields:true, invalidDrafts:true, noColourDirty:true, sameHalfTransparentPixelClean:true, textUndoPreserved:true, basePixels:inner, outerPixels:outer, outerRgba, pickedHex, pickAlpha:128/255, preferenceReadback:true, reopen:true, customDelete:true,stateLedger:ledgerFile,stateObserverVersion:ledger.schemaVersion,stateObserverSource:ledger.source }, null, 2))
  ledger.complete=true;persist()
  console.log('PASS flexible palette, real PNG alpha, pick synchronization, text undo and persisted swatches')
  }catch(error){
    primaryFailure=error
    ledger.complete=false;ledger.failure={message:error.message,stack:error.stack,at:new Date().toISOString()};persist()
    try{await documentState('failed palette actual document')}catch(observationError){ledger.failure.observationError=observationError.message}
    if(process.platform==='darwin')try{
      const bounds=await main(`testElectron.BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL().includes('/renderer/index.html')).getBounds()`),region=[bounds.x,bounds.y,bounds.width,bounds.height].map(Math.round),file=path.resolve('out','extension-118-skin-palette-state-native-failure-'+theme+'.png')
      assert(region.every(Number.isFinite)&&region[2]>0&&region[3]>0);execFileSync('/usr/sbin/screencapture',['-x','-R'+region.join(','),file],{timeout:10000});const bytes=fs.readFileSync(file);assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));ledger.failure.nativeScreenshot={file,bounds,sha256:sha(bytes)}
    }catch(captureError){ledger.failure.nativeScreenshotError=captureError.message}
    try{const file=path.resolve('out','extension-118-skin-palette-state-compositor-failure-'+theme+'.png'),frame=await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false}),bytes=Buffer.from(frame.data,'base64');fs.writeFileSync(file,bytes);ledger.failure.compositorScreenshot={file,sha256:sha(bytes)}}catch(captureError){ledger.failure.compositorScreenshotError=captureError.message}
    persist();throw error
  }finally{
    let cleanupFailure
    if(!ledger.complete&&fs.existsSync(output))try{
      const bytes=fs.readFileSync(output),file=path.resolve('out','skin-palette-export-119-'+theme+'-latest-success.png');fs.writeFileSync(file,bytes)
      ledger.latestOutputAtFailure={file,sha256:sha(bytes),bytes:bytes.length,classification:'original output present at failed-run cleanup; filename does not assert a new save succeeded'}
      persist();const info=await sharp(bytes).metadata();ledger.latestOutputAtFailure.dimensions={width:info.width,height:info.height}
      ledger.latestOutputAtFailure.matchesSuccessfulExport=ledger.saves.filter(s=>s.export?.sha256===ledger.latestOutputAtFailure.sha256).map(s=>s.sequence)
    }catch(error){ledger.latestOutputCaptureError=error.message}
    if(saveObserverInstalled)try{await main(`testElectron.ipcMain.removeHandler('skin:editorSave');testElectron.ipcMain.handle('skin:editorSave',palette119OriginalSaveHandler)`);ledger.saveHandlerRestored=true}catch(error){ledger.cleanupError=error.message;ledger.complete=false;cleanupFailure=error}
    ledger.finishedAt=new Date().toISOString();persist()
    if(cleanupFailure&&!primaryFailure)throw cleanupFailure
  }
}
module.exports.paletteRgbaDelta=paletteRgbaDelta
module.exports.paletteSaveReady=paletteSaveReady
