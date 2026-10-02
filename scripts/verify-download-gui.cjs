// Real packaged-app installation, isolated from all user profiles and games.
// No mocked transport, IPC handlers, progress or game files; never launches Java.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net')
const assert = require('node:assert/strict'), crypto = require('node:crypto'), { spawn } = require('node:child_process')
const version = require('../package.json').version, mc = process.argv[2] || '26.3'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL download GUI ')), profile = path.join(root, 'profile'), game = path.join(root, 'game')
fs.mkdirSync(profile); fs.mkdirSync(game)
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ gameDir: game, activeFolder: game, folders: [{ path: game, name: '下载验证目录', isDefault: true }], autoUpdate: false, mirror: 'bmclapi', downloadThreads: 16, downloadSpeedKBps: 0, theme: 'black-orange' }))
const exe = path.join(root, `KAMUCL-${version}.exe`)
fs.copyFileSync(`release/KAMUCL-${version}.exe`, exe)
const wait = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
  const socket = net.createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r))
  const port = socket.address().port; await new Promise(r => socket.close(r))
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const log = fs.openSync(path.join(root, 'process.log'), 'w')
  const child = spawn(exe, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--disable-renderer-backgrounding', '--disable-background-timer-throttling'], { env, stdio: ['ignore', log, log] })
  let ws, evaluate, taskId
  try {
    let page
    for (let i = 0; i < 90; i++) {
      assert.equal(child.exitCode, null, 'app exited before renderer ready')
      try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p => p.url.includes('/renderer/index.html')); if (page) break } catch {}
      await wait(1000)
    }
    assert(page, 'renderer missing')
    ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }) })
    let seq = 0; const pending = new Map()
    ws.addEventListener('message', event => { const message = JSON.parse(event.data); pending.get(message.id)?.(message) })
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timeout')) }, 30_000)
      pending.set(id, m => { clearTimeout(timer); pending.delete(id); m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result) })
      ws.send(JSON.stringify({ id, method, params }))
    })
    evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value }
    for (let i = 0; i < 60; i++) { if (await evaluate("!!document.querySelector('[data-nav=game]')")) break; await wait(500) }
    await call('Page.bringToFront')
    await evaluate("document.querySelector('[data-nav=game]').click()")
    for (let i = 0; i < 60; i++) { if (await evaluate("!!document.querySelector('[data-tab=download]')")) break; await wait(250) }
    await evaluate("document.querySelector('[data-tab=download]').click()")
    // Finish the page's initial directory scan before starting an installation.
    await wait(2000)
    await evaluate("globalThis.downloadProof={events:[],done:null};window.kamucl.on('event:progress',e=>{downloadProof.events.push({...e,at:Date.now()})});window.kamucl.on('event:installDone',e=>{downloadProof.done=e})")
    const started = Date.now()
    await evaluate(`window.kamucl.invoke('versions:install',${JSON.stringify(mc)},{},${JSON.stringify(game)})`)
    await wait(1500)
    await evaluate("document.querySelector('.dl-toggle').click()")
    await wait(200); assert(await evaluate("!!document.querySelector('.dl-panel')"), 'download panel did not open')
    const capture = async name => fs.writeFileSync(path.join(root, name + '.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    let result, paused = false
    for (let i = 0; i < 600; i++) {
      result = await evaluate('({done:downloadProof.done,last:downloadProof.events.at(-1)})')
      taskId = result.last?.taskId || taskId
      if (result.done) break
      if (!paused && taskId && i >= 8) {
        await evaluate("[...document.querySelectorAll('.dl-actions button')].find(b=>b.textContent==='暂停').click()")
        await wait(800); await capture('download-paused')
        assert(await evaluate("document.querySelector('.dl-panel').innerText.includes('已暂停')"))
        await evaluate("[...document.querySelectorAll('.dl-actions button')].find(b=>b.textContent==='继续').click()")
        paused = true
      }
      if (i === 20 || i === 60) await capture('download-' + i)
      if (i % 20 === 0) console.log(JSON.stringify({ seconds: (Date.now() - started) / 1000, progress: result.last?.overall ?? result.last?.progress, text: result.last?.text }))
      await wait(1000)
    }
    assert(result?.done?.ok, JSON.stringify(result))
    const installed = await evaluate("window.kamucl.invoke('versions:installed',true)")
    assert(installed.some(v => v.id === mc && !v.incomplete && !v.failed))
    const json = JSON.parse(fs.readFileSync(path.join(game, 'versions', mc, mc + '.json')))
    const verify = (file, expected) => { const data = fs.readFileSync(file); assert.equal(data.length, expected.size); assert.equal(crypto.createHash('sha1').update(data).digest('hex'), expected.sha1) }
    verify(path.join(game, 'versions', mc, mc + '.jar'), json.downloads.client)
    verify(path.join(game, 'assets', 'indexes', json.assetIndex.id + '.json'), json.assetIndex)
    const assets = JSON.parse(fs.readFileSync(path.join(game, 'assets', 'indexes', json.assetIndex.id + '.json'))).objects
    for (const asset of Object.values(assets)) verify(path.join(game, 'assets', 'objects', asset.hash.slice(0, 2), asset.hash), { size: asset.size, sha1: asset.hash })
    await capture('download-complete')
    const report = { version, mc, root, game, complete: true, emptyDirectory: true, elapsedSeconds: (Date.now() - started) / 1000, pausedAndResumed: paused, verifiedAssets: Object.keys(assets).length, exeSHA256: crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex'), events: await evaluate('downloadProof.events') }
    fs.writeFileSync(`out/download-gui-${version}.json`, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ root, elapsedSeconds: report.elapsedSeconds, verifiedAssets: report.verifiedAssets, pausedAndResumed: paused }))
  } finally {
    if (evaluate) {
      if (taskId) await evaluate(`window.kamucl.invoke('tasks:cancel',${JSON.stringify(taskId)})`).catch(() => {})
      await evaluate("window.kamucl.send('window:close')").catch(() => {})
    }
    ws?.close(); fs.closeSync(log)
    for (let i = 0; i < 50 && child.exitCode === null; i++) await wait(100)
    assert.equal(child.exitCode, 0, 'isolated app did not close cleanly')
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
