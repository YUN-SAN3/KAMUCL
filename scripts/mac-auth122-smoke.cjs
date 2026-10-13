// Actual signed APP startup only. CI owns this empty profile and the spawned root process.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), net = require('node:net')
const { spawn } = require('node:child_process'), { trackOwnedChild, finishOwnedChild } = require('./qa-owned-process-119.cjs')
assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64'); assert.equal(process.env.GITHUB_ACTIONS, 'true')
const [appPath, directory] = process.argv.slice(2); fs.mkdirSync(directory, { recursive: true })
const receipt = { complete: false, classification: 'Actual signed original APP in disposable empty native runner; launch smoke only, no real login or game', startedAt: new Date().toISOString() }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
;(async () => {
  const reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve)); const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve))
  const fd = fs.openSync(path.join(directory, 'process.log'), 'w'), env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.GH_TOKEN; delete env.GITHUB_TOKEN
  const child = spawn(path.join(appPath, 'Contents/MacOS/KAMUCL'), ['--remote-debugging-port=' + port], { env, stdio: ['ignore', fd, fd] }), owned = trackOwnedChild(child, 'signed-auth122-smoke'); fs.closeSync(fd)
  let ws, original
  try {
    let page
    for (let i = 0; i < 75; i++) {
      assert.equal(child.exitCode, null, 'Signed APP exited before renderer readiness')
      try { const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) }); page = (await response.json()).find(row => row.url.includes('/renderer/index.html')) } catch {}
      if (page) break; await wait(500)
    }
    assert(page, 'Original signed APP renderer did not become ready')
    ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
    let id = 0
    const call = (method, params) => new Promise((resolve, reject) => {
      const requestId = ++id, timeout = setTimeout(() => { ws.removeEventListener('message', listener); reject(Error('Owned smoke protocol timeout: ' + method)) }, 10000)
      const listener = event => { const response = JSON.parse(event.data); if (response.id !== requestId) return; clearTimeout(timeout); ws.removeEventListener('message', listener); response.error ? reject(Error('Owned smoke protocol failed: ' + method)) : resolve(response.result) }
      ws.addEventListener('message', listener); ws.send(JSON.stringify({ id: requestId, method, params }))
    })
    let ready = false
    for (let i = 0; i < 80; i++) {
      const result = await call('Runtime.evaluate', { expression: `document.body.innerText.includes('首页')&&document.body.innerText.includes('1.1.22')&&!!window.kamucl`, returnByValue: true })
      if (result.result?.value === true) { ready = true; break }; await wait(250)
    }
    assert(ready, 'Actual signed APP never reached complete initial navigation readiness')
    const observed = await call('Runtime.evaluate', { expression: `(async()=>({title:document.title,content:document.body.innerText,platform:document.documentElement.dataset.platform,userAgent:navigator.userAgent,accountsCount:(await window.kamucl.invoke('accounts:list')).length,configured:(await window.kamucl.invoke('accounts:msStatus')).clientId}))()`, awaitPromise: true, returnByValue: true })
    assert(!observed.exceptionDetails, 'Original APP backend startup failed'); const value = observed.result.value
    assert(value.content.includes('首页') && value.content.includes('1.1.22')); assert.equal(value.platform, 'darwin'); assert(value.userAgent.includes('Electron/44.3.0'))
    assert.equal(value.accountsCount, 0, 'Disposable native smoke cannot use an existing account'); assert.equal(value.configured, '06cc8cf6-4b8f-4631-8459-b2bd828808f8')
    const image = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }); fs.writeFileSync(path.join(directory, 'original-startup.png'), Buffer.from(image.data, 'base64'))
    receipt.observed = { platform: value.platform, runtime: '44.3.0', sourceVersion: '1.1.22', freshAccounts: true, ownApplicationIdentity: true, rootPid: child.pid }; receipt.complete = true
  } catch (error) { original = error; receipt.error = { name: error.name, message: error.message }; console.error(error) }
  finally {
    ws?.close(); try { await finishOwnedChild(owned, { terminate: true, timeoutMs: 10000 }); receipt.ownedCleanup = owned.ledger } catch (error) { receipt.complete = false; receipt.cleanupError = error.message; original ??= error }
    receipt.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
  }
  if (original) process.exitCode = 1
})().catch(error => { console.error(error); process.exitCode = 1 })
