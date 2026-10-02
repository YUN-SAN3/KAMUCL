// Runs after the legacy extension checks in the isolated real-Electron harness.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), sharp = require('sharp')
module.exports = async ({ evaluate, call, main, nav, wait, root, screenshot, version }) => {
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
  const paint = async () => {
    await evaluate(`(()=>{document.activeElement.blur();document.querySelector('.skin-editor').scrollTop=0})()`)
    const r = await evaluate(`(()=>{const r=document.querySelector('.skin-editor canvas').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`), x = r.x+r.w*.5, y = r.y+r.h*.19
    for (const [type, buttons] of [['mouseMoved', 0], ['mousePressed', 1], ['mouseReleased', 0]]) await call('Input.dispatchMouseEvent', {type, x, y, button: type==='mouseMoved'?'none':'left', buttons, clickCount:type==='mouseMoved'?0:1})
  }
  const save = async () => { await button('保存 PNG…'); await wait(300); assert(fs.existsSync(output)); return sharp(output).ensureAlpha().raw().toBuffer({resolveWithObject:true}) }
  // Canvas2D's premultiplied storage can round half-transparent channels by one; PNG alpha must be exact.
  const matchFace = (data, x, alpha) => { const pixels=[];for(let y=8;y<16;y++)for(let px=x;px<x+8;px++){const i=(y*64+px)*4,tolerance=alpha===255?0:1;if(Math.abs(data[i]-17)<=tolerance&&Math.abs(data[i+1]-119)<=tolerance&&Math.abs(data[i+2]-238)<=tolerance&&data[i+3]===alpha)pixels.push([px,y])}return pixels }
  await main('testElectron.BrowserWindow.getAllWindows()[0].setSize(1280,900);testElectron.BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)')
  await nav('skins'); await button('绘制皮肤'); await wait(400); await button('正面'); await wait(650)
  await main(`testElectron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(output)}})`)
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
  await paint(); let png = await save(); assert.equal(png.info.width, 64); assert.equal(png.info.height, 64); const inner = matchFace(png.data, 8, 255); assert(inner.length, 'base brush exports an opaque pixel')
  await layer('outer'); await edit('.palette-alpha-number input', '50'); await paint(); png = await save(); const outer = matchFace(png.data, 40, 128); assert(outer.length, 'outer alpha survives actual exported PNG')
  const outerOffset=(outer[0][1]*64+outer[0][0])*4,outerRgba=Array.from(png.data.subarray(outerOffset,outerOffset+4)),pickedHex='#'+outerRgba.slice(0,3).map(c=>c.toString(16).padStart(2,'0')).join('')
  await paint();assert(await clean(),'repeating the same half-transparent pixel does not dirty unchanged canvas data')
  const beforeUndo = await evaluate(`[...document.querySelectorAll('.skin-editor button')].find(e=>e.textContent.trim()==='重做').disabled`)
  const nativeUndo = await evaluate(`(()=>{const e=document.querySelector('.palette-hex');e.focus();return e.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))})()`)
  assert(nativeUndo, 'text Ctrl+Z is not prevented by skin undo'); assert.equal(await evaluate(`[...document.querySelectorAll('.skin-editor button')].find(e=>e.textContent.trim()==='重做').disabled`), beforeUndo)
  await edit('.palette-hex', '#ff0000'); await edit('.palette-alpha-number input', '100'); await button('吸色'); await paint(); await wait(50)
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
  fs.writeFileSync('out/skin-palette-ui-'+(process.env.KAMUCL_TEST_THEME||'black-orange')+'.json', JSON.stringify({ version, synchronizedFields:true, invalidDrafts:true, noColourDirty:true, sameHalfTransparentPixelClean:true, textUndoPreserved:true, basePixels:inner, outerPixels:outer, outerRgba, pickedHex, pickAlpha:128/255, preferenceReadback:true, reopen:true, customDelete:true }, null, 2))
  console.log('PASS flexible palette, real PNG alpha, pick synchronization, text undo and persisted swatches')
}
