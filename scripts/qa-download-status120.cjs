// Final portable, real owned foreground window and trusted coordinates.
// Only task progress/terminal messages are synthetic UI replays; no service claim.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net')
const crypto = require('node:crypto'), assert = require('node:assert/strict'), { spawn } = require('node:child_process')
const owned = require('./qa-owned-process-119.cjs'), native = require('./qa-native-window115.cjs')
const version = require('../package.json').version, source = path.resolve(`release/KAMUCL-${version}.exe`)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL download status120 ')), output = path.resolve('out/qa-download-status120-' + crypto.randomUUID())
fs.mkdirSync(output)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const proof = { complete: false, version, root, output, exeSHA256: hash(source), classification: 'Final portable production renderer/IPC receiver and real native foreground. Task messages are synthetic visual replays; no actual network, installation, cancellation or performance claim.', rows: [] }
const save = () => fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(proof, null, 2))
async function port() { const s = net.createServer(); await new Promise(resolve => s.listen(0, '127.0.0.1', resolve)); const p = s.address().port; await new Promise(resolve => s.close(resolve)); return p }
async function connect(p, main) {
  let entry
  for (let i = 0; i < 100; i++) { try { entry = (await (await fetch(`http://127.0.0.1:${p}/json`)).json()).find(v => v.webSocketDebuggerUrl && (main || v.url.includes('/renderer/index.html'))); if (entry) break } catch {} await sleep(300) }
  assert(entry, 'Inspector not ready')
  const ws = new WebSocket(entry.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let next = 0; const pending = new Map()
  ws.addEventListener('message', event => { const value = JSON.parse(event.data); pending.get(value.id)?.(value) })
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timed out')) }, 12000)
    pending.set(id, value => { clearTimeout(timer); pending.delete(id); value.error ? reject(Error(JSON.stringify(value.error))) : resolve(value.result) }); ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => { const value = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert(!value.exceptionDetails, JSON.stringify(value.exceptionDetails)); return value.result.value }
  return { ws, call, evaluate }
}
(async () => {
  for (const theme of ['black-orange', 'blue-white', 'transparent', 'custom']) {
    const profile = path.join(root, theme), game = path.join(profile, 'game'); fs.mkdirSync(game, { recursive: true })
    const settings = { gameDir: game, activeFolder: game, folders: [{ path: game, isDefault: true }], autoUpdate: false, theme }
    if (theme === 'custom') settings.custom = { colors: { bg: '#171520', card: '#242232', accent: '#8759cd', text: '#f6f2ff', textDim: '#bcb7cc', border: '#4a455c', sidebarBg: '#201d2b', sidebarText: '#e5dff2', bannerText: '#ffffff' } }
    fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings))
    const exe = path.join(profile, `KAMUCL-${version}.exe`); fs.copyFileSync(source, exe)
    const p = await port(), mp = await port(), log = fs.openSync(path.join(profile, 'process.log'), 'w'), env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(exe, [`--user-data-dir=${profile}`, `--inspect=127.0.0.1:${mp}`, `--remote-debugging-port=${p}`], { env, windowsHide: true, stdio: ['ignore', log, log] })
    const track = owned.trackOwnedChild(child, 'download-status120-' + theme)
    let r, m
    try {
      r = await connect(p, false); m = await connect(mp, true)
      const windowSelection = { theme, samples: [], complete: false }; (proof.windowSelections ??= []).push(windowSelection); save()
      let binding
      const deadline = performance.now() + 10000
      while (performance.now() < deadline) {
        const state = await m.evaluate("(()=>{globalThis.testElectron=process.mainModule.require('electron');const windows=testElectron.BrowserWindow.getAllWindows().map(w=>({windowId:w.id,webContentsId:w.webContents.id,url:w.webContents.getURL(),visible:w.isVisible(),opacity:w.getOpacity()}));return {pid:process.pid,ppid:process.ppid,exe:process.execPath,profile:testElectron.app.getPath('userData'),appReady:testElectron.app.isReady(),windows}})()")
        assert(state.pid === track.pid || state.ppid === track.pid); assert.equal(fs.realpathSync.native(state.profile), fs.realpathSync.native(profile))
        const matches = state.windows.filter(w => w.url.includes('/renderer/index.html'))
        windowSelection.samples.push({ at: Date.now(), ...state }); save()
        assert(matches.length <= 1, 'Multiple actual production renderers were observed')
        if (state.appReady && matches.length === 1) { binding = { ...state, ...matches[0] }; windowSelection.complete = true; save(); break }
        await sleep(100)
      }
      assert(binding, 'Actual production renderer did not commit its navigation before the deadline')
      assert(binding.pid === track.pid || binding.ppid === track.pid); assert.equal(fs.realpathSync.native(binding.profile), fs.realpathSync.native(profile))
      const koffi = path.resolve('node_modules/koffi'), observe = () => m.evaluate(`(${native.observeOwned})(${JSON.stringify(binding)},${JSON.stringify(koffi)})`)
      const focus = async () => { const s = await observe(); assert.equal(s.foreground, s.hwnd); assert.equal(s.foregroundPid, binding.pid); assert(s.visible && s.focused && !s.minimized); return s }
      const ready = async expression => { for (let i = 0; i < 100; i++) { const state = await r.evaluate(expression); if (state) return state; await sleep(100) } throw Error('UI not ready: ' + expression) }
      const click = async (selector, offset = { x: 0.5, y: 0.5 }) => {
        const point = await ready(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),b=e?.getBoundingClientRect();if(!b||e.disabled)return false;const x=b.x+b.width*${offset.x},y=b.y+b.height*${offset.y},hit=document.elementFromPoint(x,y);return (hit===e||e.contains(hit))&&x>0&&y>0&&x<innerWidth&&y<innerHeight?{x,y}:false})()`)
        await focus(); for (const [type, buttons] of [['mouseMoved', 0], ['mousePressed', 1], ['mouseReleased', 0]]) await r.call('Input.dispatchMouseEvent', { type, ...point, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 }); await sleep(100); await focus()
      }
      await ready("document.querySelector('.top-actions') && document.querySelector('.viewer3d canvas') && document.documentElement.dataset.theme === " + JSON.stringify(theme))
      // Renderer readiness precedes the portable wrapper's native fade. Observe
      // its real terminal marker; never hide feedback or infer completion from
      // a fixed delay, or native screenshots may still contain its face layer.
      const boot = await m.evaluate("(()=>{const fs=process.mainModule.require('node:fs'),signal=process.env.KAMUCL_BOOT_SIGNAL;if(!signal)throw Error('Portable startup signal is absent');return {signal,visible:fs.existsSync(signal+'.visible')?fs.readFileSync(signal+'.visible','utf8'):null}})()"); boot.samples = []; (proof.bootObservations ??= []).push({ theme, boot })
      rowBootWait: for (let i = 0; i <= 100; i++) {
        const sample = await m.evaluate(`(()=>{const fs=process.mainModule.require('node:fs'),s=${JSON.stringify(boot.signal)},w=testElectron.BrowserWindow.fromId(${binding.windowId});return {finished:fs.existsSync(s+'.finished')?fs.readFileSync(s+'.finished','utf8'):null,signalState:fs.existsSync(s)?fs.readFileSync(s,'utf8'):null,mainVisible:w.isVisible(),mainOpacity:w.getOpacity(),isLoading:w.webContents.isLoading()}})()`); boot.samples.push({ at: Date.now(), ...sample }); boot.finished = sample.finished; save()
        if (boot.finished === 'done') { boot.observedAt = Date.now(); break rowBootWait }
        assert(i < 100, 'Native portable startup feedback did not finish'); await sleep(200)
      }
      await r.call('Emulation.setFocusEmulationEnabled', { enabled: false })
      await m.evaluate(`(${native.focusOwned})(${JSON.stringify(binding)},${JSON.stringify(koffi)})`)
      const row = { theme, binding, boot, actualProcessExeSHA256: hash(binding.exe), layouts: [], ownedLedger: track.ledger }; proof.rows.push(row); save()
      let open = false
      for (const [width, height, zoom] of [[960, 620, 1], [960, 620, 1.25], [1280, 900, 1.25]]) {
        await m.evaluate(`(()=>{const w=testElectron.BrowserWindow.fromId(${binding.windowId});w.unmaximize();w.setSize(${width},${height});w.webContents.setZoomFactor(${zoom});return true})()`); await sleep(300); await focus()
        const layout = { requested: { width, height, zoom }, actual: await m.evaluate(`(()=>{const w=testElectron.BrowserWindow.fromId(${binding.windowId});return {bounds:w.getBounds(),contentBounds:w.getContentBounds(),zoom:w.webContents.getZoomFactor(),displayScale:testElectron.screen.getDisplayMatching(w.getBounds()).scaleFactor}})()`), states: [] }; row.layouts.push(layout)
        assert(Math.abs(layout.actual.bounds.width - width) <= 3 && Math.abs(layout.actual.bounds.height - height) <= 3); assert.equal(layout.actual.zoom, zoom)
        const texts = {
          tail: '下载资源文件 3574/3575 · 正在处理 minecraft/sounds/fixture120/very-long-folder-name/long-tail-resource-with-a-readable-name.ogg',
          wait: '下载资源文件 3574/3575 · 下载源限流，24 秒后重试',
          switching: '下载资源文件 3574/3575 · 下载源限流，切换备用来源'
        }
        for (const [state, text] of Object.entries(texts)) {
          const event = { taskId: `ui120-${theme}-${width}-${zoom}`, taskTitle: '导入整合包 · 合成界面验收', stage: 'assets', text, progress: 0.999, overall: 0.86, parallelStages: [{ id: 'assets', label: '资源文件', state: 'running', progress: 0.999, text }] }
          await m.evaluate(`testElectron.BrowserWindow.fromId(${binding.windowId}).webContents.send('event:progress',${JSON.stringify(event)});true`)
          if (!open || !await r.evaluate("!!document.querySelector('.dl-panel')")) { await click('[data-ui="App:50549c4d6612"][title="下载中心"]'); open = true }
          await ready(`document.querySelector('.dl-stage-detail')?.innerText === ${JSON.stringify(text)}`)
          const geometry = await r.evaluate("(()=>{const e=document.querySelector('.dl-stage-detail'),p=document.querySelector('.dl-panel'),b=e.getBoundingClientRect(),r=p.getBoundingClientRect();return {text:e.innerText,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,whiteSpace:getComputedStyle(e).whiteSpace,bodyOverflow:document.documentElement.scrollWidth>innerWidth,panel:{x:r.x,y:r.y,width:r.width,height:r.height},detail:{x:b.x,y:b.y,width:b.width,height:b.height},viewport:{width:innerWidth,height:innerHeight}}})()")
          assert.equal(geometry.whiteSpace, 'normal'); assert(geometry.scrollWidth <= geometry.clientWidth + 1); assert(!geometry.bodyOverflow)
          assert(geometry.detail.y >= geometry.panel.y && geometry.detail.y + geometry.detail.height <= Math.min(geometry.panel.y + geometry.panel.height, geometry.viewport.height) + 1)
          const focused = await focus(), name = `${theme}-${width}-${zoom}-${state}.png`, bytes = Buffer.from((await r.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'); fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx' })
          layout.states.push({ state, geometry, focused, screenshot: { file: name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') } }); save()
        }
        await m.evaluate(`testElectron.BrowserWindow.fromId(${binding.windowId}).webContents.send('event:installDone',{taskId:${JSON.stringify(`ui120-${theme}-${width}-${zoom}`)},ok:false,error:'下载源限流，可稍后重试：资源文件 minecraft/sounds/fixture120/test.ogg',stage:'assets'});true`)
        await ready("!!document.querySelector('.dl-error')"); await click('.dl-error .dl-dismiss')
        // Dismissing the last active task removes the home download button.
        // Close through the real backdrop, never the similarly styled log button.
        if (await r.evaluate("!!document.querySelector('.dl-panel')")) await click('[data-ui="App:32e6a4482be2"]', { x: 0.05, y: 0.9 })
        await ready("!document.querySelector('.dl-panel')"); open = false
        while (await r.evaluate("!!document.querySelector('.toast-close')")) await click('.toast-close')
        await ready("!document.querySelector('.toast')")
      }
      row.complete = true
    } catch (error) {
      proof.failure = { theme, message: error.message, stack: error.stack }
      if (r) try {
        proof.failure.visibleControls = await r.evaluate("Array.from(document.querySelectorAll('.dl-toggle,.notice-panel,.notice-mask,.toast-close')).map(e=>({tag:e.tagName,title:e.title,ui:e.dataset.ui,text:e.innerText,rect:JSON.parse(JSON.stringify(e.getBoundingClientRect()))}))")
        const bytes = Buffer.from((await r.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'); fs.writeFileSync(path.join(output, 'failure.png'), bytes, { flag: 'wx' })
        proof.failure.screenshotSHA256 = crypto.createHash('sha256').update(bytes).digest('hex')
      } catch (captureError) { proof.failure.captureError = captureError.message }
      save(); throw error
    }
    finally {
      if (m) await m.evaluate("testElectron.app.quit();true").catch(() => {})
      r?.ws.close(); m?.ws.close(); await owned.finishOwnedChild(track, { timeoutMs: 15000 }); fs.closeSync(log); save()
    }
  }
  proof.complete = true; save(); console.log(JSON.stringify({ complete: true, output, themes: proof.rows.length, layouts: proof.rows.reduce((n, row) => n + row.layouts.length, 0) }))
})().catch(error => { console.error(error); process.exitCode = 1 })
