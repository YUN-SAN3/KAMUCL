// Mandatory cases when the owning UX driver enables this suite. Actual owned
// renderer input and production MOD IPC; synthetic metadata/loopback files only.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict')
module.exports = async function (h, binding) {
  const approvedOut = fs.realpathSync.native(path.resolve('out')), directory = path.join(approvedOut, 'qa-mod-progress117-' + crypto.randomUUID())
  fs.mkdirSync(directory, { recursive: true })
  const proof = { complete: false, directory, classification: 'Actual foreground-checked Windows portable GUI, original production modsPrepare/Commit, streamed files, hash, cancellation and disk transaction. Repository metadata and loopback files are synthetic. No live provider or game launch claim.', cases: [], screenshots: [] }
  proof.platform=process.platform;if(process.platform==='darwin')proof.classification=proof.classification.replace('Windows portable GUI','signed Mac package GUI')
  const save = () => fs.writeFileSync(path.join(directory, 'live.json'), JSON.stringify(proof, null, 2))
  const fixturePath = path.resolve('scripts/qa-mod-progress-fixture117.cjs'), config = { ...binding, profile: h.profile, root: path.join(directory, 'fixture'), approvedOut }
  const inspect = () => h.main('__qaModProgress117.inspect()')
  const viewport = async (width, height, zoom) => {
    await h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${binding.windowId});w.setSize(${width},${height});w.webContents.setZoomFactor(${zoom});return true})()`)
    const observation = await h.until('actual MOD viewport ' + width + ' / ' + zoom, async () => ({ native: await h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${binding.windowId});return{bounds:w.getBounds(),content:w.getContentSize(),zoom:w.webContents.getZoomFactor()}})()`), renderer: await h.evaluate('({width:innerWidth,height:innerHeight,focus:document.hasFocus(),hidden:document.hidden})') }), v => v.native.zoom === zoom && Math.abs(v.renderer.width - v.native.content[0] / zoom) < 1 && Math.abs(v.renderer.height - v.native.content[1] / zoom) < 1 && v.renderer.focus && !v.renderer.hidden)
    ;(proof.viewports ??= []).push({ requested: { width, height, zoom }, observation }); save(); return observation
  }
  const menuClosed = () => h.until('actual select popover transition unmounted', () => h.evaluate("!!document.querySelector('.select-menu-float')"), v => !v)
  const key = async (key, code, vk, modifiers = 0) => { await h.foreground(); for (const type of ['keyDown', 'keyUp']) await h.call('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, modifiers }); await h.wait(80) }
  const text = async (selector, value) => { await h.click(selector); await key('a', 'KeyA', 65, process.platform==='darwin'?4:2); await h.call('Input.insertText', { text: value }) }
  const shot = async name => { const receipt = await h.screenshot('mod-progress117-' + name); proof.screenshots.push({ name, receipt }); save(); return receipt }
  const captureDialog = () => h.evaluate("(()=>{globalThis.__closedMod117=document.querySelector('.modinstall-modal');if(!__closedMod117||!__closedMod117.isConnected)throw Error('No actual connected MOD dialog');return{present:true,connected:__closedMod117.isConnected}})()")
  const closeDialog = async () => {
    if (await h.evaluate("!!document.querySelector('.modinstall-modal')")) await h.click('.modinstall-modal .modal-actions .btn:nth-child(1)')
    proof.closeObservation = await h.until('actual MOD dialog element detached', () => h.evaluate("({present:!!document.querySelector('.modinstall-modal'),captured:!!globalThis.__closedMod117,connected:globalThis.__closedMod117?.isConnected})"), v => !v.present && v.captured && v.connected === false)
    proof.closeObservation.qualification = 'Actual production DOM detachment; subscription and effect scope disposal are independently verified by the compiled SFC real Vue mount/unmount test, not production debug properties.'
    await h.evaluate('delete globalThis.__closedMod117')
    if (await h.evaluate("!!document.querySelector('.download-modal')")) { await h.click('[data-ui="CommunityView:989d28842ec5"]'); await h.until('actual download chooser closed', () => h.evaluate("!!document.querySelector('.download-modal')"), v => !v) }
  }
  const waitPlan = () => h.until('real metadata and predownload produce consent plan', () => h.evaluate("(()=>{const e=document.querySelector('.modinstall-modal');return{exists:!!e,busy:!!e?.querySelector('.modal-loading'),rows:e?.querySelectorAll('.dependency-row').length,checked:e?.querySelector('.dependency-choice input')?.checked,error:e?.querySelector('.modal-error')?.textContent,text:e?.textContent}})()"), v => v.exists && !v.busy && v.rows === 2 && v.checked && !v.error)
  const closeDownloadPanel = async () => {
    // The real download mask covers the header toggle while the panel is open.
    // Click its exposed bottom-left corner with the same strict hit/focus guards;
    // this invokes the original mask close handler without changing route state.
    const target = await h.until('actual download mask coordinate', () => h.evaluate("(()=>{const e=document.querySelector('[data-ui=\"App:32e6a4482be2\"]'),r=e?.getBoundingClientRect(),x=r&&r.left+Math.min(8,r.width/2),y=r&&r.bottom-Math.min(8,r.height/2);return{exists:!!e,x,y,hit:!!e&&document.elementFromPoint(x,y)===e,viewport:!!r&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight,inert:!!e?.closest('[inert]')}})()"), v => v.exists && v.hit && v.viewport && !v.inert)
    await h.foreground()
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await h.call('Input.dispatchMouseEvent', { type, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1, x: target.x, y: target.y })
    await h.foreground()
    await h.until('actual download panel and mask removed', () => h.evaluate("!!document.querySelector('.dl-panel,[data-ui=\"App:32e6a4482be2\"]')"), v => !v)
  }
  const showTask = async (id, expectedClass, label) => {
    if (!await h.evaluate("!!document.querySelector('.dl-panel')")) await h.click('.dl-toggle')
    const selector = '.dl-item[data-task-id="' + id + '"]'
    const observation = await h.until('exact real task ' + id, () => h.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e&&{text:e.textContent,status:e.className,id:e.dataset.taskId}})()`), v => v?.id === id && v.status.includes('dl-' + expectedClass))
    await h.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`)
    await shot(label)
    await h.click(selector + ' .dl-dismiss')
    await h.until('exact task record removed ' + id, () => h.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), v => !v)
    await closeDownloadPanel()
    return observation
  }
  const openCase = async options => {
    const row = await h.main(`__qaModProgress117.useCase(${JSON.stringify(options)})`); proof.cases.push(row); save()
    row.registration = await h.evaluate(`window.kamucl.invoke('folders:add',${JSON.stringify(row.folder)})`)
    assert.equal(row.registration.folder.path, row.folder)
    row.targets = await h.evaluate("window.kamucl.invoke('mods:targets')")
    assert(row.targets.versions.some(v => v.id === row.instance && v.folder === row.folder && v.mcVersion === '1.20.1' && v.loader === 'fabric'))
    // Public controls retain the original metadata fetch/download selection path.
    await text('[data-ui="CommunityView:bc0450fd9c8f"]', row.rootId); await key('Enter', 'Enter', 13)
    await h.until('owned synthetic project from production search', () => h.evaluate("({busy:!!document.querySelector('.result-list[aria-busy=true]'),titles:[...document.querySelectorAll('.result-title')].map(e=>e.textContent)})"), v => !v.busy && v.titles.some(title => title.includes('社区 MOD 下载进度 ' + row.name)))
    await h.click('.result-card .result-dl')
    await h.until('real compatible file and target', () => h.evaluate("({selected:document.querySelector('.download-modal .file-list button.active')?.textContent,enabled:document.querySelector('[data-ui=\"CommunityView:cade5c4fc83a\"]')?.disabled===false})"), v => v.enabled && v.selected?.includes(row.name))
    const targetButton = '.download-modal > .select-menu-btn'
    await h.click(targetButton)
    const index = await h.evaluate(`[...document.querySelectorAll('.select-menu-float .select-menu-option')].findIndex(e=>e.textContent.includes(${JSON.stringify(row.instance)})&&e.textContent.includes(${JSON.stringify(row.folder)}))`)
    assert(index >= 0, 'Synthetic target must be found by the unchanged production scanner')
    await h.click('.select-menu-float .select-menu-option:nth-child(' + (index + 1) + ')')
    await menuClosed()
    row.selectedTarget = await h.evaluate(`document.querySelector(${JSON.stringify(targetButton)}).textContent`)
    assert(row.selectedTarget.includes(row.instance) && row.selectedTarget.includes(row.folder))
    await h.click('[data-ui="CommunityView:cade5c4fc83a"]')
    row.partial = await h.until('actual partial streamed bytes ' + row.name, async () => ({ backend: await inspect(), ui: await h.evaluate("(()=>{const e=document.querySelector('[data-ui=\"mod-install:progress\"]'),bar=e?.querySelector('[role=progressbar]');return{exists:!!e,text:e?.textContent,now:bar?.getAttribute('aria-valuenow'),indeterminate:bar?.classList.contains('indeterminate')}})()") }), v => v.ui.exists && v.backend.events.slice(row.eventStart).some(e => e.channel === 'event:progress' && e.payload.bytesDone > 0 && (options.unknown ? e.payload.indeterminate && e.payload.bytesTotal == null : e.payload.bytesDone < e.payload.bytesTotal)))
    assert.equal(row.partial.backend.files.length, 0, 'Confirmation has not occurred: no actual instance MOD may be written')
    assert.equal(row.partial.backend.productionHandlersUnchanged, true)
    if (options.unknown) { assert.equal(row.partial.ui.now, null); assert.equal(row.partial.ui.indeterminate, true); assert(row.partial.ui.text.includes('总大小未知')) }
    else assert(Number(row.partial.ui.now) >= 0 && Number(row.partial.ui.now) < 100)
    row.partialScreenshot = await shot(row.name + '-partial')
    return row
  }
  const finishInstall = async row => {
    row.plan = await waitPlan(); row.beforeConsent = await inspect(); assert.equal(row.beforeConsent.files.length, 0)
    assert(!row.beforeConsent.requests.slice(row.requestStart).some(r => r.id === row.depId), 'Necessary dependency must not download before consent')
    await h.click('.modinstall-modal .btn-gold')
    await h.until('actual committed UI closes ' + row.name, () => h.evaluate("!!document.querySelector('.modinstall-modal')"), v => !v)
    row.afterCommit = await inspect(); assert.equal(row.afterCommit.files.length, 2)
    for (const expected of row.expected) { const actual = row.afterCommit.files.find(f => f.name === expected.name); assert(actual); assert.equal(actual.sha1, expected.sha1); assert.equal(actual.sha256, expected.sha256); assert.equal(actual.size, expected.size) }
    const events = row.afterCommit.events.slice(row.eventStart), ids = [...new Set(events.filter(e => e.channel === 'event:progress').map(e => e.payload.taskId))]
    assert.equal(ids.length, row.name === 'hash_retry' ? 3 : 2)
    const installId = ids.at(-1), installEvents = events.filter(e => e.payload.taskId === installId)
    assert(installEvents.some(e => e.channel === 'event:progress' && e.payload.stage === 'download' && e.payload.bytesDone > 0))
    assert(installEvents.some(e => e.channel === 'event:progress' && e.payload.stage === 'mod-commit'))
    assert(installEvents.some(e => e.channel === 'event:taskDone' && e.payload.ok))
    row.downloadRecords = []
    for (const id of ids) { const terminal = events.findLast(e => e.payload.taskId === id && e.channel === 'event:taskDone'); assert(terminal); row.downloadRecords.push(await showTask(id, terminal.payload.ok ? 'done' : 'error', row.name + '-task-' + row.downloadRecords.length)) }
    assert.equal(await h.evaluate("!!document.querySelector('.modinstall-modal')"), false, 'Late completed events must not resurrect a closed dialog')
    row.complete = true; save()
  }
  let error
  try {
    proof.setup = await h.main(`(async()=>{if(globalThis.__qaModProgress117)throw Error('Duplicate MOD fixture');globalThis.__qaModProgress117=await process.mainModule.require(${JSON.stringify(fixturePath)})(${JSON.stringify(config)});return{classification:__qaModProgress117.classification}})()`)
    await viewport(1360, 860, 1)
    await h.nav('community')
    // Limit the real provider selection to the source owned by the loopback fixture.
    await h.click('[aria-label="资源来源"]'); await h.click('.select-menu-float .select-menu-option:nth-child(2)')
    await menuClosed()
    await text('[aria-label="Minecraft 版本"]', '1.20.1'); await key('Enter', 'Enter', 13)
    await h.until('actual version popup closed', () => h.evaluate("!!document.querySelector('#community-version-options')"), v => !v)
    proof.downloadRecording = await h.recordScreencast('mod-progress117-production-' + crypto.randomUUID(), async () => {
      const known = await openCase({ name: 'known', delayMs: 50 })
      await waitPlan(); await h.click('.dependency-choice input')
      known.optOut = await h.evaluate("({disabled:document.querySelector('.modinstall-modal .btn-gold').disabled,text:document.querySelector('.modinstall-modal').textContent})")
      assert(known.optOut.disabled && known.optOut.text.includes('暂不写入')); assert.equal((await inspect()).files.length, 0)
      await shot('known-explicit-opt-out'); await h.click('.dependency-choice input'); await finishInstall(known)
    }, 500)
    await viewport(960, 620, 1.25)
    const unknown = await openCase({ name: 'unknown', unknown: true, delayMs: 50 }); await finishInstall(unknown)
    await viewport(1360, 860, 1)
    const cancelled = await openCase({ name: 'cancel', unknown: true, delayMs: 100 })
    cancelled.dialogBeforeCancellation = await captureDialog()
    await h.click('.modinstall-modal .modal-actions .btn:nth-child(1)')
    cancelled.cancelState = await h.until('production task cancellation settles', async () => ({ ui: await h.evaluate("({busy:!!document.querySelector('.modinstall-modal .modal-loading'),text:document.querySelector('.modinstall-modal')?.textContent})"), backend: await inspect() }), v => !v.ui.busy && v.backend.events.slice(cancelled.eventStart).some(e => e.channel === 'event:taskDone' && e.payload.cancelled))
    assert.equal(cancelled.cancelState.backend.files.length, 0); assert(!cancelled.cancelState.backend.events.slice(cancelled.eventStart).some(e => e.channel === 'event:taskDone' && e.payload.ok))
    const cancelledId = cancelled.cancelState.backend.events.findLast(e => e.channel === 'event:taskDone').payload.taskId
    await shot('cancel-settled'); await closeDialog(); cancelled.downloadRecord = await showTask(cancelledId, 'cancelled', 'cancel-record'); cancelled.complete = true
    const failure = await openCase({ name: 'hash_retry', failHash: true, delayMs: 15 })
    failure.failure = await h.until('actual SHA mismatch fails rather than installs', async () => ({ ui: await h.evaluate("({busy:!!document.querySelector('.modinstall-modal .modal-loading'),text:document.querySelector('.modinstall-modal')?.textContent})"), backend: await inspect() }), v => !v.ui.busy && /校验|哈希|hash/i.test(v.ui.text || '') && v.backend.events.slice(failure.eventStart).some(e => e.channel === 'event:taskDone' && !e.payload.ok))
    assert.equal(failure.failure.backend.files.length, 0); await shot('hash-failure')
    await h.main('__qaModProgress117.setHashFailure(false)'); await h.click('.modinstall-modal .modal-actions .btn:nth-child(2)'); await finishInstall(failure)
    proof.final = await inspect(); assert(proof.final.productionHandlersUnchanged)
    assert.equal(proof.cases.filter(row => row.complete).length, 4)
    proof.recording = await h.recordScreencast('mod-progress117-reopen-' + crypto.randomUUID(), async () => { await h.nav('mods'); await h.nav('community'); await h.wait(500); assert.equal(await h.evaluate("!!document.querySelector('.modinstall-modal')"), false) }, 1000)
    proof.complete = true
  } catch (caught) { error = caught; proof.error = { name: caught.name, message: caught.message, stack: caught.stack }; throw caught }
  finally {
    try { proof.restored = await h.main('globalThis.__qaModProgress117?(async()=>{const r=await __qaModProgress117.close();delete globalThis.__qaModProgress117;return r})():({complete:true,absent:true})'); assert(proof.restored.complete && proof.restored.productionHandlersUnchanged !== false) } catch (caught) { proof.restoreError = caught.message; if (!error) throw caught }
    proof.finishedAt = new Date().toISOString(); save(); fs.writeFileSync(path.join(directory, proof.complete ? 'summary.json' : 'failure.json'), JSON.stringify(proof, null, 2))
  }
  return proof
}
