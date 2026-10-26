// Read-only observations for a private Linux update fixture. They do not change
// product APIs, restart a command, or replace a rejected IPC with a retry.
const assert = require('node:assert/strict'), crypto = require('node:crypto')
const digest = value => crypto.createHash('sha256').update(value).digest('hex')

function observeTamperedRejection({ staged, failed, actualSize, actualSHA256, targetSHA256, baselineSHA256, previousLog, currentLog, flag }) {
  assert.deepEqual(failed, staged, 'The persistent failed transaction must identify the exact approved request')
  assert(Number.isSafeInteger(actualSize) && actualSize > staged.size, 'The fixture must actually enlarge its approved payload')
  assert.match(actualSHA256, /^[a-f0-9]{64}$/); assert.notEqual(actualSHA256, staged.sha256, 'The actual tampered payload hash must change')
  assert.equal(targetSHA256, baselineSHA256, 'Rejecting a tampered payload must preserve the original application bytes')
  assert(Buffer.isBuffer(previousLog) && Buffer.isBuffer(currentLog))
  assert(currentLog.subarray(0, previousLog.length).equals(previousLog), 'The original updater log must remain an append-only prefix')
  const appended = currentLog.subarray(previousLog.length), text = appended.toString('utf8')
  const rejection = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z Error: 更新包大小或文件类型已变化，请重新下载\r?$/m.exec(text)
  assert(rejection, 'The original appended updater log must explicitly report this payload-size rejection')
  const offset = previousLog.length + Buffer.byteLength(text.slice(0, rejection.index)), bytes = Buffer.from(rejection[0])
  assert(currentLog.subarray(offset, offset + bytes.length).equals(bytes))
  assert(flag && ['present', 'absent', 'consumed-during-observation'].includes(flag.state), 'The transient notification flag is observed separately')
  return { id: staged.id, approved: staged, failed, approvedSize: staged.size, actualSize, approvedSHA256: staged.sha256, actualSHA256, targetSHA256,
    rejectionLog: { file: 'actual-updater.log', offset, length: bytes.length, sha256: digest(bytes), originalText: rejection[0] }, flag }
}

async function openOwnedInspector({ url, port, role, ownedPid, ownedChild, rendererURL, deadline, observe = () => {}, WebSocketClass = WebSocket }) {
  const parsed = new URL(url)
  assert.equal(parsed.protocol, 'ws:'); assert.equal(parsed.hostname, '127.0.0.1'); assert.equal(Number(parsed.port), port)
  assert(['main', 'renderer'].includes(role)); assert(Number.isSafeInteger(ownedPid) && ownedPid > 0)
  if (role === 'renderer') assert(typeof rendererURL === 'string' && rendererURL.length > 0)
  const alive = () => { assert.equal(ownedChild.pid, ownedPid); assert.equal(ownedChild.exitCode, null, 'The original owned launcher exited'); assert.equal(ownedChild.signalCode, null, 'The original owned launcher was signalled') }
  alive()
  const remaining = () => { const time = deadline - Date.now(); assert(time > 0, 'Original 30-second startup observation deadline expired'); return time }
  const socket = new WebSocketClass(url), pending = new Map(), contexts = new Map(), waiters = new Set()
  let id = 0, frameId, frameURL, selected, selectedInvalid = false, disposed = false
  const record = (name, value) => observe({ at: new Date().toISOString(), role, ownedPid, rendererURL, name, value: structuredClone(value) })
  const findContext = () => {
    if (role === 'renderer' && frameURL !== rendererURL) return
    const candidates = [...contexts.values()].filter(context => role === 'renderer'
      ? context.auxData?.isDefault === true && context.auxData.frameId === frameId
      : context.auxData?.isDefault === true || /^node\[\d+\]$/.test(context.name ?? ''))
    assert(candidates.length <= 1, 'Ambiguous default execution context for the original target')
    return candidates[0]
  }
  const wake = () => { for (const waiter of waiters) waiter() }
  const originalFrame = (frame, snapshot = false) => {
    if (frame.parentId) return
    if (selected && (frame.id !== frameId || frame.url !== rendererURL)) selectedInvalid = true
    if (frame.url && frame.url !== 'about:blank') assert.equal(frame.url, rendererURL, 'The original renderer URL changed before observation')
    // A target URL is advertised before the initial frame commits. An empty
    // snapshot is not evidence of readiness, and cannot erase a real commit.
    if (!snapshot || frameURL !== rendererURL || frame.url) { frameId = frame.id; frameURL = frame.url }
    record(snapshot ? 'original-frame-snapshot' : 'Page.frameNavigated', frame); wake()
  }
  const failure = error => { for (const request of pending.values()) request.reject(error); pending.clear(); for (const waiter of waiters) waiter(error) }
  socket.addEventListener('message', event => {
    let message
    try {
      message = JSON.parse(event.data)
      if (message.id) { const request = pending.get(message.id); if (request) { pending.delete(message.id); message.error ? request.reject(Object.assign(Error(JSON.stringify(message.error)), { cdpError: message.error })) : request.resolve(message.result) } return }
      if (message.method === 'Runtime.executionContextCreated') { contexts.set(message.params.context.id, message.params.context); record(message.method, message.params); wake() }
      if (message.method === 'Runtime.executionContextDestroyed') { if (message.params.executionContextId === selected?.id) selectedInvalid = true; contexts.delete(message.params.executionContextId); record(message.method, message.params); wake() }
      if (message.method === 'Runtime.executionContextsCleared') { if (selected) selectedInvalid = true; contexts.clear(); record(message.method, message.params ?? {}); wake() }
      if (message.method === 'Page.frameNavigated') originalFrame(message.params.frame)
    } catch (error) { failure(error) }
  })
  socket.addEventListener('close', () => { disposed = true; failure(Error('Original owned inspector closed')) })
  socket.addEventListener('error', () => failure(Error('Original owned inspector transport failed')))
  const call = (method, params = {}, timeoutMs = 30000) => new Promise((resolve, reject) => {
    try { alive(); assert(!disposed && socket.readyState === WebSocketClass.OPEN, 'Original owned inspector is unavailable') } catch (error) { reject(error); return }
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error('Owned update observation timed out: ' + method)) }, timeoutMs)
    pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
    try { socket.send(JSON.stringify({ id: requestId, method, params })); record('command-sent', { id: requestId, method, params }) }
    catch (error) { pending.get(requestId)?.reject(error); pending.delete(requestId) }
  })
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Owned inspector socket did not open')), Math.min(6000, remaining()))
      const finish = action => value => { clearTimeout(timer); action(value) }
      socket.addEventListener('open', finish(resolve), { once: true }); socket.addEventListener('error', finish(reject), { once: true }); socket.addEventListener('close', finish(() => reject(Error('Owned inspector closed before opening'))), { once: true })
    })
    alive(); await call('Runtime.enable', {}, remaining())
    if (role === 'renderer') {
      await call('Page.enable', {}, remaining())
      const tree = await call('Page.getFrameTree', {}, remaining())
      originalFrame(tree.frameTree.frame, true)
    }
    await new Promise((resolve, reject) => {
      let timer
      const finish = error => {
        try { alive(); if (error) throw error; const context = findContext(); if (!context) return; selected = context; clearTimeout(timer); waiters.delete(finish); resolve() }
        catch (failure) { clearTimeout(timer); waiters.delete(finish); reject(failure) }
      }
      timer = setTimeout(() => { waiters.delete(finish); reject(Error('Original default execution context was not observed within the startup deadline')) }, remaining())
      waiters.add(finish); finish()
    })
    record('original-default-context-ready', selected)
    const originalContextAlive = () => assert(!selectedInvalid && contexts.get(selected.id) === selected, 'The observed original default execution context was destroyed; IPC will not be retried')
    return { socket, readiness: { role, ownedPid, rendererURL, frameId, context: structuredClone(selected) }, evaluate: async (expression, { startupDeadline = false } = {}) => {
      alive(); originalContextAlive()
      const result = await call('Runtime.evaluate', { expression, contextId: selected.id, returnByValue: true, awaitPromise: true }, startupDeadline ? remaining() : 30000)
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
      alive(); originalContextAlive()
      return result.result.value
    } }
  } catch (error) { socket.close(); throw error }
}

module.exports = { observeTamperedRejection, openOwnedInspector }
