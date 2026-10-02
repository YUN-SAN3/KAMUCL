// Real packaged-app installation, isolated from all user profiles and games.
// Uses the real loader installer Java process; never launches Minecraft.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net')
const assert = require('node:assert/strict'), crypto = require('node:crypto'), { spawn } = require('node:child_process')
const version = require('../package.json').version, pack = process.argv[2], label = process.argv[3] || version
assert(pack && fs.existsSync(pack), 'Usage: node scripts/benchmark-modpack-gui.cjs <CurseForge pack.zip> [label]')
const mc = JSON.parse(new (require('adm-zip'))(pack).readAsText('manifest.json')).minecraft.version
const reusedRoot = process.env.KAMUCL_BENCH_REUSE_ROOT
if (reusedRoot) assert(path.dirname(path.resolve(reusedRoot)) === path.resolve(os.tmpdir()) && path.basename(reusedRoot).startsWith('KAMUCL pack GUI '), 'Reuse only an isolated benchmark root')
const root = reusedRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL pack GUI ')), profile = path.join(root, 'profile'), game = path.join(root, 'game')
fs.mkdirSync(profile, {recursive:true}); fs.mkdirSync(game, {recursive:true})
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ gameDir: game, activeFolder: game, folders: [{ path: game, name: '下载验证目录', isDefault: true }], autoUpdate: false, mirror: 'bmclapi', downloadThreads: 16, downloadSpeedKBps: 0, theme: 'black-orange' }))
const exe = path.join(root, `KAMUCL-${version}.exe`)
if(!process.env.KAMUCL_GUI_DEV) fs.copyFileSync(`release/KAMUCL-${version}.exe`, exe)
const wait = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
  const socket = net.createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r))
  const port = socket.address().port; await new Promise(r => socket.close(r))
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const log = fs.openSync(path.join(root, 'process.log'), 'w')
  const child = spawn(process.env.KAMUCL_GUI_DEV ? path.resolve('node_modules/electron/dist/electron.exe') : exe, [...(process.env.KAMUCL_GUI_DEV ? ['.'] : []), `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--disable-renderer-backgrounding', '--disable-background-timer-throttling'], { env, stdio: ['ignore', log, log] })
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
    await evaluate(`window.kamucl.invoke('modpack:install',${JSON.stringify(pack)},{targetFolder:${JSON.stringify(game)}})`)
    await wait(1500)
    await evaluate("document.querySelector('.dl-toggle').click()")
    await wait(200); assert(await evaluate("!!document.querySelector('.dl-panel')"), 'download panel did not open')
    const capture = async name => fs.writeFileSync(path.join(root, name + '.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    let result, paused = false
    for (let i = 0; i < 1200; i++) {
      result = await evaluate('({done:downloadProof.done,last:downloadProof.events.at(-1)})')
      taskId = result.last?.taskId || taskId
      if (result.done) break
      if (process.env.KAMUCL_TEST_PAUSE && !paused && taskId && i >= 8) {
        await evaluate("[...document.querySelectorAll('.dl-actions button')].find(b=>b.textContent==='暂停').click()")
        await wait(800); await capture('download-paused')
        assert(await evaluate("document.querySelector('.dl-panel').innerText.includes('已暂停')"))
        await evaluate("[...document.querySelectorAll('.dl-actions button')].find(b=>b.textContent==='继续').click()")
        paused = true
      }
      if (i === 20 || i === 60) await capture('download-' + i)
      fs.writeFileSync(`out/modpack-live-${label}.json`,JSON.stringify({root,started,...result}));
      if (i % 20 === 0) console.log(JSON.stringify({ seconds: (Date.now() - started) / 1000, progress: result.last?.overall ?? result.last?.progress, text: result.last?.text }))
      await wait(1000)
    }
    fs.writeFileSync(`out/modpack-events-${label}.json`,JSON.stringify({root,started,finished:Date.now(),...result,events:await evaluate('downloadProof.events')},null,2))
    assert(result?.done?.ok, JSON.stringify(result))
    const installed = await evaluate("window.kamucl.invoke('versions:installed',true)")
    assert(installed.some(v => v.id === result.done.versionId && !v.incomplete && !v.failed))
    const installSeconds = (Date.now()-started)/1000
    const id = result.done.versionId
    const json = JSON.parse(fs.readFileSync(path.join(game, 'versions', id, id + '.json')))
    const verify = (file, expected) => { const data = fs.readFileSync(file); assert.equal(data.length, expected.size); assert.equal(crypto.createHash('sha1').update(data).digest('hex'), expected.sha1) }
    verify(path.join(game, 'versions', id, id + '.jar'), json.downloads.client)
    verify(path.join(game, 'assets', 'indexes', json.assetIndex.id + '.json'), json.assetIndex)
    const assets = JSON.parse(fs.readFileSync(path.join(game, 'assets', 'indexes', json.assetIndex.id + '.json'))).objects
    for (const asset of Object.values(assets)) verify(path.join(game, 'assets', 'objects', asset.hash.slice(0, 2), asset.hash), { size: asset.size, sha1: asset.hash })
    await capture('download-complete')
    const report = { version, mc, pack, label, startedAt: started, installSeconds, packSHA256: crypto.createHash('sha256').update(fs.readFileSync(pack)).digest('hex'), root, game, complete: true, instanceId: id, emptyDirectory: !reusedRoot, elapsedSeconds: (Date.now() - started) / 1000, pausedAndResumed: paused, verifiedAssets: Object.keys(assets).length, exeSHA256: process.env.KAMUCL_GUI_DEV ? null : crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex'), events: await evaluate('downloadProof.events') }
    fs.writeFileSync(`out/modpack-gui-${label}.json`, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ root, installSeconds, elapsedSeconds: report.elapsedSeconds, verifiedAssets: report.verifiedAssets, pausedAndResumed: paused }))
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
