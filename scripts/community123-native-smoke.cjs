// Exercise the original packaged executable, its production renderer and actual
// community IPC. Only the owned fresh instance is controlled or terminated.
const fs = require('node:fs'), path = require('node:path'), net = require('node:net')
const assert = require('node:assert/strict'), crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { trackOwnedChild, finishOwnedChild } = require('./qa-owned-process-119.cjs')
const { openOwnedInspector } = require('./linux-update-observer.cjs')
const { probe } = require('./community123-live-probe.cjs')
const observers = require('./community123-dom-observers.cjs')
const VERSION = '1.1.23', wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main() {
  assert(['win32', 'darwin'].includes(process.platform))
  assert.equal(process.arch, process.platform === 'win32' ? 'x64' : 'arm64')
  if (process.platform === 'darwin') assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Mac smoke requires its disposable native runner')
  const [executable, destination] = process.argv.slice(2)
  assert(executable && destination); fs.mkdirSync(destination, { recursive: true })
  const privateRoot = fs.mkdtempSync(path.resolve('out/community123-native-private-'))
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.GH_TOKEN; delete env.GITHUB_TOKEN
  const profile = path.join(privateRoot, 'profile'); fs.mkdirSync(profile)
  if (process.platform === 'win32') {
    env.APPDATA = path.join(privateRoot, 'roaming'); env.LOCALAPPDATA = path.join(privateRoot, 'local')
    fs.mkdirSync(env.APPDATA); fs.mkdirSync(env.LOCALAPPDATA)
  }
  const receipt = { version: VERSION, complete: false, platform: process.platform, arch: process.arch,
    classification: 'Original packaged APP/EXE in an owned empty profile; actual renderer coordinate search and production IPC against real public services. Not game installation, authentication, motion or whole-platform acceptance.',
    startedAt: new Date().toISOString(), actions: [], images: [], contextEvents: [], errors: [] }
  const save = () => fs.writeFileSync(path.join(destination, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
  save()
  const reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve))
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve))
  const fd = fs.openSync(path.join(destination, 'process.log'), 'w')
  const args = ['--user-data-dir=' + profile, '--remote-debugging-port=' + port]
  if (process.env.KAMUCL_QA_PROXY) args.push('--proxy-server=' + process.env.KAMUCL_QA_PROXY)
  const child = spawn(path.resolve(executable), args, { env, stdio: ['ignore', fd, fd] })
  const owned = trackOwnedChild(child, 'community123-original-native'); fs.closeSync(fd)
  let inspector, socket, original
  try {
    const deadline = Date.now() + 90000; let page
    while (Date.now() < deadline) {
      assert.equal(child.exitCode, null, 'Original packaged launcher exited before renderer readiness')
      try { const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) }); page = (await response.json()).find(row => row.url.includes('/renderer/index.html')) } catch {}
      if (page) break; await wait(100)
    }
    assert(page, 'Original packaged renderer was not advertised within the startup budget')
    inspector = await openOwnedInspector({ url: page.webSocketDebuggerUrl, port, role: 'renderer', ownedPid: child.pid, ownedChild: child,
      rendererURL: page.url, deadline, observe: event => receipt.contextEvents.push(event) })
    socket = inspector.socket; receipt.contextReadiness = inspector.readiness
    const until = async (expression, budget = 20000) => {
      const end = Date.now() + budget
      while (Date.now() < end) { if (await inspector.evaluate(expression)) return; await wait(75) }
      throw Error('Actual renderer observation deadline: ' + expression)
    }
    await until(`!!window.kamucl&&document.body.innerText.includes('首页')&&document.body.innerText.includes('${VERSION}')`)
    const startup = await inspector.evaluate(`(async()=>({platform:document.documentElement.dataset.platform,userAgent:navigator.userAgent,version:document.querySelector('.logo-version')?.textContent,accountsCount:(await window.kamucl.invoke('accounts:list')).length}))()`)
    assert.equal(startup.platform, process.platform); assert.equal(startup.accountsCount, 0)
    assert.equal(startup.version.trim(), 'v' + VERSION); assert(startup.userAgent.includes('Electron/44.3.0'))
    receipt.startup = startup
    receipt.observed = { platform: process.platform, arch: process.arch, sourceVersion: VERSION, runtime: '44.3.0', freshAccounts: true, rootPid: child.pid }
    save()
    let commandId = 1000000000
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++commandId, timer = setTimeout(() => { socket.removeEventListener('message', listener); reject(Error('Owned original protocol timeout: ' + method)) }, 15000)
      const listener = event => { const value = JSON.parse(event.data); if (value.id !== id) return; clearTimeout(timer); socket.removeEventListener('message', listener); value.error ? reject(Error('Owned original protocol error: ' + method)) : resolve(value.result) }
      socket.addEventListener('message', listener); socket.send(JSON.stringify({ id, method, params }))
    })
    const shot = async name => {
      const result = await command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
      const bytes = Buffer.from(result.data, 'base64'), file = name + '.png'; fs.writeFileSync(path.join(destination, file), bytes)
      receipt.images.push({ file, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), at: new Date().toISOString() }); save()
    }
    const click = async selector => {
      await inspector.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center'})`)
      await inspector.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      const point = await inspector.evaluate(observers.expression(observers.point, selector))
      if (point.missing || point.blocked || point.disabled) {
        receipt.coordinateFailure = { selector, point, at: new Date().toISOString() }; save()
        await shot('coordinate-failure')
        throw Error('Actual coordinate target is missing, blocked or disabled: ' + selector)
      }
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await command('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, ...(type === 'mouseMoved' ? {} : { button: 'left', clickCount: 1 }) })
      receipt.actions.push({ type: 'real-coordinate-click', selector, point, at: new Date().toISOString() }); save(); await wait(100)
    }
    await shot('original-startup')
    await click('[data-nav=community]'); await until(`!!document.querySelector('[data-search123=keyword]')`)
    await click('[data-ui="community:versions-all"]')
    // Choosing the version filter may submit the original empty browse query.
    // Wait for its actual disabled state to end before the next coordinate input;
    // a fixed delay would mistake real startup work for a blocked control.
    await until(`document.querySelector('[data-search123=submit]')?.disabled===false`, 45000)
    await click('[data-search123=keyword]'); await command('Input.insertText', { text: '无尽' })
    assert.equal(await inspector.evaluate(`document.querySelector('[data-search123=keyword]').value`), '无尽')
    await click('[data-search123=submit]')
    await until(`document.querySelector('[data-search123=status]')?.dataset.phase==='ready'&&document.querySelectorAll('.result-title').length>0`, 30000)
    receipt.gui = await inspector.evaluate(observers.expression(observers.state))
    assert.equal(receipt.gui.keyword, '无尽'); assert.equal(receipt.gui.phase, 'ready')
    await shot('original-live-wujin'); save()
    await probe(inspector, receipt, save)
    assert.equal(receipt.live.complete, true); assert(!receipt.live.cancelFailure && !receipt.live.unsubscribeFailure)
    receipt.complete = true
  } catch (error) { original = error; receipt.errors.push({ name: error.name, message: error.message }); console.error(error.message) }
  finally {
    socket?.close()
    try { await finishOwnedChild(owned, { terminate: true, timeoutMs: 15000 }); receipt.ownedCleanup = owned.ledger }
    catch (error) { receipt.complete = false; receipt.errors.push({ phase: 'owned-cleanup', name: error.name, message: error.message }); original ??= error }
    receipt.privateDataUploaded = false; receipt.finishedAt = new Date().toISOString(); save()
  }
  if (original) process.exitCode = 1
  console.log(JSON.stringify({ destination, complete: receipt.complete, platform: receipt.platform, arch: receipt.arch }))
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { main }
