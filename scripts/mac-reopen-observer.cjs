// Observation only: never replay state, focus a control or change the tested UI.
function dockReopenReady(sample, expected) {
  const { main, renderer, gameAlive } = sample
  const window = main?.window
  return Boolean(gameAlive === true && main?.runningRecord?.pid === expected.pid &&
    main.runningRecord.versionId === expected.versionId && window?.visible === true &&
    window.minimized === false && window.bounds?.width > 0 && window.bounds.height > 0 &&
    main.events?.some(e => e.kind === 'renderer-ready' && e.sender === window.webContentsId) &&
    main.events.some(e => e.kind === 'launch-state' && e.sender === window.webContentsId &&
      e.state?.status === 'running' && e.state.versionId === expected.versionId) &&
    renderer?.documentReady === 'complete' && renderer.visible === true &&
    renderer.runningText === '游戏运行中' && renderer.bounds?.width > 0 && renderer.bounds.height > 0)
}

async function observeDockReopen({ snapshot, expected, record, timeoutMs = 10000, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const started = now(), proof = { maximumMs: timeoutMs, samples: [], ready: false, timedOut: false }
  while (now() - started < timeoutMs) {
    const remaining = timeoutMs - (now() - started)
    let timer
    try {
      const sample = await Promise.race([snapshot(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Dock observation timed out')), remaining) })])
      const elapsedMs = now() - started
      const ready = elapsedMs <= timeoutMs && dockReopenReady(sample, expected)
      proof.samples.push({ ...sample, elapsedMs, ready }); proof.ready = ready
      record(proof)
      if (ready || sample.gameAlive === false) break
    } catch (error) {
      proof.samples.push({ elapsedMs: now() - started, error: String(error) }); record(proof)
    } finally { clearTimeout(timer) }
    await sleep(Math.min(100, Math.max(0, timeoutMs - (now() - started))))
  }
  proof.elapsedMs = now() - started; proof.timedOut = !proof.ready && proof.elapsedMs >= timeoutMs
  record(proof)
  return proof
}
module.exports = { dockReopenReady, observeDockReopen }
