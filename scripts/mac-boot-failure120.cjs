const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict')

// This sampler runs only after the original binding deadline has failed. Its
// separate RAF chain records callback availability, never the splash's frame ack.
async function sampleBootRenderer(sampleMs) {
 const read = () => ({ at: Date.now(), readyState: document.readyState, hidden: document.hidden, visibilityState: document.visibilityState, caption: document.querySelector('#stage')?.textContent ?? null, motion: document.body?.dataset.motion ?? null, canvases: Array.from(document.querySelectorAll('canvas'), c => ({ id: c.id, width: c.width, height: c.height, clientWidth: c.clientWidth, clientHeight: c.clientHeight })), viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio } })
 const before = read(), timestamps = []; let frame = null, stopped = false
 const available = typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function'
 const tick = timestamp => { if (stopped) return; timestamps.push(timestamp); if (timestamps.length < 12) frame = requestAnimationFrame(tick) }
 if (sampleMs > 0 && available) frame = requestAnimationFrame(tick)
 try { if (sampleMs > 0) await new Promise(resolve => setTimeout(resolve, sampleMs)); return { before, after: read(), parallelRaf: { available, sampleMs, timestamps: timestamps.slice(), classification: 'Independent read-only RAF sampler; not a production animation frame acknowledgement' } } }
 finally { stopped = true; if (frame !== null && available) cancelAnimationFrame(frame) }
}

async function readFailedBoot(expected, sampleMs, captures) {
 const electron = process.mainModule.require('electron'), fs = process.mainModule.require('node:fs')
 if (process.pid !== expected.pid || fs.realpathSync.native(electron.app.getPath('userData')) !== expected.profile || fs.realpathSync.native(process.execPath) !== expected.executable) throw Error('Failure diagnostic belongs to a foreign app/profile/executable')
 const role = w => { const u = w.webContents.getURL(); return u.includes('/renderer/index.html') ? 'main-renderer' : u.includes('/renderer/splash.html') ? 'startup-splash' : 'other' }
 const current = electron.BrowserWindow.getAllWindows().filter(w => !w.isDestroyed())
 for (const w of current.filter(w => role(w) !== 'other')) if (!expected.windows.some(e => e.windowId === w.id && e.webContentsId === w.webContents.id && e.role === role(w) && e.url === w.webContents.getURL())) throw Error('Owned startup window identity changed')
 const inventory = () => current.map(w => w.isDestroyed() ? { windowId: w.id, destroyed: true } : ({ windowId: w.id, webContentsId: w.webContents.id, role: role(w), url: w.webContents.getURL(), visible: w.isVisible(), opacity: w.getOpacity(), loadingMainFrame: w.webContents.isLoadingMainFrame(), bounds: w.getBounds(), contentBounds: w.getContentBounds() }))
 const result = { pid: process.pid, profile: expected.profile, executable: expected.executable, initialInventory: inventory(), renderers: [], images: [] }
 for (const e of expected.windows) {
  const w = current.find(w => w.id === e.windowId && !w.isDestroyed()); if (!w) { result.renderers.push({ ...e, disappeared: true }); continue }
  try {
   const value = await w.webContents.executeJavaScript(`(${expected.sampler})(${e.role === 'startup-splash' ? sampleMs : 0})`)
   result.renderers.push({ ...e, value })
   if (captures && !w.isDestroyed()) result.images.push({ ...e, png: (await w.webContents.capturePage()).toPNG().toString('base64'), classification: 'Actual Electron compositor Page capture, not a native desktop screenshot' })
  } catch (error) { result.renderers.push({ ...e, unavailable: { name: error.name, message: error.message } }) }
 }
 result.finalInventory = inventory(); return result
}

async function observeFailedBoot({ evaluate, expected, trigger, output, captureDesktop, now = () => performance.now(), budgetMs = 5000 }) {
 assert.equal(trigger.code, 'QA_RENDERER_BIND_DEADLINE', 'Only an already-failed original renderer deadline can start this diagnostic')
 assert.equal(trigger.bindingBudgetMs, 10000); assert(Number.isFinite(trigger.failedAt) && Number.isFinite(trigger.bindingStartedAt) && trigger.failedAt >= trigger.bindingStartedAt + trigger.bindingBudgetMs)
 assert(Number.isFinite(budgetMs) && budgetMs > 0 && budgetMs <= 5000, 'Failure-only diagnostic budget may not exceed 5000 ms')
 assert(Number.isInteger(expected.pid) && expected.pid > 0); assert(path.isAbsolute(expected.profile) && path.isAbsolute(expected.executable))
 assert(expected.windows.length > 0 && expected.windows.length <= 2)
 assert(new Set(expected.windows.map(w => w.role)).size === expected.windows.length)
 for (const w of expected.windows) assert(Number.isInteger(w.windowId) && w.windowId > 0 && Number.isInteger(w.webContentsId) && w.webContentsId > 0 && ['main-renderer', 'startup-splash'].includes(w.role) && typeof w.url === 'string')
 const root = fs.realpathSync.native(output), target = path.join(root, 'boot-failure-' + crypto.randomUUID()); fs.mkdirSync(target)
 const started = now(), deadline = started + budgetMs, receipt = { startedAt: Date.now(), budgetMs, trigger: { ...trigger }, complete: false, originalBindingPassed: false, classification: 'Separate failure-only observation; does not extend or replace original 10000 ms binding acceptance', screenshots: [] }
 const remaining = () => { const left = deadline - now(); if (left <= 0) throw Error('Failure-only diagnostic deadline elapsed'); return left }
 const bounded = async fn => { const left = remaining(); let timer; try { const value = await Promise.race([Promise.resolve().then(() => fn(left)), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Failure-only diagnostic deadline elapsed')), Math.max(1, left)) })]); remaining(); return value } finally { clearTimeout(timer) } }
 const runRead = (left, sampleMs, captures) => evaluate(`(${readFailedBoot})(${JSON.stringify({ ...expected, sampler: sampleBootRenderer.toString() })},${sampleMs},${captures})`, left)
 const retain = (file, classification) => { const stat = fs.lstatSync(file); assert(stat.isFile() && !stat.isSymbolicLink()); const bytes = fs.readFileSync(file); assert(bytes.length <= 20 * 1024 * 1024); return { file: path.relative(root, file), bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), classification } }
 try {
  const observed = await bounded(left => runRead(left, Math.min(250, Math.floor(left / 4)), true)); receipt.observation = { ...observed, images: undefined }
  for (const image of observed.images ?? []) { remaining(); assert(expected.windows.some(w => w.windowId === image.windowId && w.webContentsId === image.webContentsId && w.role === image.role)); assert(/^[A-Za-z0-9+/]*={0,2}$/.test(image.png)); const bytes = Buffer.from(image.png, 'base64'); assert(bytes.length > 0 && bytes.length <= 20 * 1024 * 1024); const file = path.join(target, image.role + '-page.original.png'); fs.writeFileSync(file, bytes, { flag: 'wx' }); receipt.screenshots.push(retain(file, image.classification)) }
  if (captureDesktop) { const file = path.join(target, 'desktop.original.png'); await bounded(left => captureDesktop(file, left)); receipt.screenshots.push(retain(file, 'Original native disposable CI desktop screenshot; not an isolated game or renderer capture')); receipt.afterDesktopIdentity = await bounded(left => runRead(left, 0, false)) }
  receipt.complete = true
 } catch (error) { receipt.error = { name: error.name, message: error.message }; receipt.complete = false }
 finally { receipt.finishedAt = Date.now(); receipt.elapsedMs = now() - started; if (receipt.elapsedMs > budgetMs) receipt.complete = false; fs.writeFileSync(path.join(target, 'receipt.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' }) }
 return { ...receipt, receipt: retain(path.join(target, 'receipt.json'), receipt.classification) }
}
module.exports = { sampleBootRenderer, readFailedBoot, observeFailedBoot }
