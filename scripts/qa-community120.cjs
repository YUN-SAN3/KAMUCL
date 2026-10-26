// Packaged production renderer, trusted inputs and actual route lifecycle.
// Only source/manifest metadata is synthetic. This helper does not replace an
// installation handler, select a launcher instance, launch a process or qualify
// the placeholder profiles as runnable Minecraft installations.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { replaceNativeInput } = require('./verify-favorites-113.cjs')
const SYNTHETIC = [
  { id: 'qa120-fabric', mcVersion: '1.20.1', loader: 'fabric' },
  { id: 'qa120-forge', mcVersion: '1.21.1', loader: 'forge' },
  { id: 'qa120-fabric-other', mcVersion: '1.20.1', loader: 'fabric' }
]
function contained(root, target) {
  const relative = path.relative(root, target)
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)
}
function prepareCommunityProfile(config) {
  const root = fs.realpathSync.native(config.root), profile = fs.realpathSync.native(config.profile), game = fs.realpathSync.native(config.game)
  assert(contained(root, profile) && contained(profile, game), 'Only the approved private profile/game root may receive fixtures')
  const versions = path.join(game, 'versions')
  if (fs.existsSync(versions)) assert.equal(fs.lstatSync(versions).isSymbolicLink(), false, 'Fixture versions directory must not redirect outside the approved game root')
  const files = []
  for (const row of SYNTHETIC) {
    const directory = path.join(game, 'versions', row.id)
    assert(!fs.existsSync(directory), 'Never overwrite an existing instance, including another QA attempt')
    fs.mkdirSync(directory, { recursive: true })
    const json = path.join(directory, row.id + '.json'), jar = path.join(directory, row.id + '.jar')
    fs.writeFileSync(json, JSON.stringify({ id: row.id, _mcVersion: row.mcVersion, _loader: row.loader, _loaderVersion: 'QA-only', _isolated: true, mainClass: 'qa120.not.runnable.Main', libraries: [] }), { flag: 'wx' })
    // Empty ZIP, not a runnable game. Exact MC/loader metadata is read by the
    // original installed-version scan rather than replaced IPC/store data.
    fs.writeFileSync(jar, Buffer.from('504b0506000000000000000000000000000000000000', 'hex'), { flag: 'wx' })
    files.push(...[json, jar].map(file => ({ file: path.relative(root, file), bytes: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') })))
  }
  const unknown = path.join(game, 'versions', 'qa120-unknown-incomplete')
  assert(!fs.existsSync(unknown)); fs.mkdirSync(unknown)
  return { complete: true, files, incompleteDirectory: path.relative(root, unknown), classification: 'Synthetic non-runnable profile metadata; original versions:installed scan, no game/network/install claim' }
}
function installCommunityFixture(config) {
  const electron = globalThis.testElectron, fs = process.mainModule.require('node:fs'), path = process.mainModule.require('node:path')
  if (!electron || process.pid !== config.pid || fs.realpathSync.native(electron.app.getPath('userData')) !== config.profile) throw Error('Community fixture requires the exact owned process/profile')
  const relative = path.relative(config.root, config.profile)
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error('Profile is outside the approved disposable root')
  const window = electron.BrowserWindow.fromId(config.windowId)
  if (!window || window.webContents.id !== config.webContentsId || globalThis.__qaCommunity120) throw Error('Community fixture window identity mismatch or duplicate fixture')
  const channels = ['versions:manifest', 'community:search', 'community:files']
  const originals = new Map(channels.map(channel => [channel, electron.ipcMain._invokeHandlers.get(channel)]))
  if ([...originals.values()].some(handler => typeof handler !== 'function')) throw Error('Required original metadata IPC handler missing')
  const state = { records: [], holdNext: false, held: [], next: 0 }
  function result(q, stale = false) {
    return { total: 20, offset: q.offset, limit: q.limit, warnings: [], items: Array.from({ length: 20 }, (_, index) => ({ source: 'modrinth', projectId: 'community120-' + index, slug: 'fixture120-' + index, title: `${stale ? 'OLD-RESPONSE-120' : '公开合成元数据'} ${q.keyword || '全部'} · ${q.mcVersion || '全部版本'} / ${q.loader || '全部加载器'} ${index}`, originalTitle: 'Synthetic community metadata', description: '仅用于真实界面版本选择、搜索保留和遮挡验收；没有下载或安装。', downloads: 120, author: 'KAMUCL QA' })) }
  }
  const respond = (channel, callback) => {
    electron.ipcMain.removeHandler(channel)
    electron.ipcMain.handle(channel, async (event, ...args) => {
      if (event.sender.id !== config.webContentsId) throw Error('Community fixture rejects another renderer')
      const record = { index: ++state.next, channel, args, startedAt: Date.now() }; state.records.push(record)
      try { const value = await callback(record, ...args); record.completedAt = Date.now(); return value }
      catch (error) { record.error = error.message; record.completedAt = Date.now(); throw error }
    })
  }
  respond('versions:manifest', () => ['26.3', '26.2', '1.21.1', '1.20.1'].map(id => ({ id, type: 'release', url: 'https://example.invalid/' + id + '.json', releaseTime: '2026-10-07T00:00:00Z', time: '2026-10-07T00:00:00Z' })))
  respond('community:search', (record, q) => {
    if (state.holdNext) { state.holdNext = false; return new Promise(resolve => state.held.push({ record, q, resolve })) }
    return result(q)
  })
  respond('community:files', (_record, source, projectId, filter) => [{ source, projectId, fileId: 'community120-file', fileName: 'community120-not-downloaded.jar', version: 'QA metadata only', gameVersions: [filter.mcVersion || '1.20.1'], loaders: filter.loader ? [filter.loader] : ['fabric', 'forge'], url: 'https://example.invalid/community120-not-downloaded.jar', size: 1024, date: '2026-10-07T00:00:00Z', releaseType: 'release' }])
  globalThis.__qaCommunity120 = {
    holdNextSearch() { state.holdNext = true },
    releaseHeld() { const rows = state.held.splice(0); for (const row of rows) { row.record.releasedAt = Date.now(); row.resolve(result(row.q, true)) }; return rows.length },
    inspect() { return { records: state.records, held: state.held.map(row => row.record.index) } },
    restore() {
      for (const row of state.held.splice(0)) row.resolve(result(row.q, true))
      for (const [channel, original] of originals) { electron.ipcMain.removeHandler(channel); electron.ipcMain._invokeHandlers.set(channel, original) }
      const value = { complete: channels.every(channel => electron.ipcMain._invokeHandlers.get(channel) === originals.get(channel)), channels, records: state.records, classification: 'Metadata-only fixture removed; exact original Electron handler identities restored; installation IPC was never replaced' }
      delete globalThis.__qaCommunity120; return value
    }
  }
  return { channels, classification: 'Owned-profile-only synthetic metadata, original production renderer and installed-instance scanning' }
}
function readCommunityState() {
  const page = document.querySelector('.community-page'), content = page?.closest('.content')
  const source = page?.querySelector('.version-source-option[aria-pressed=true]')
  return { present: !!page, source: source?.dataset.ui, keyword: page?.querySelector('[data-ui="CommunityView:bc0450fd9c8f"]')?.value, version: page?.querySelector('[aria-label="Minecraft 版本"]')?.value, summary: page?.querySelector('.version-filter-heading')?.innerText, loader: page?.querySelector('[aria-label="加载器"]')?.innerText.trim(), installed: page?.querySelector('[aria-label="选择已安装版本"]')?.innerText, mismatch: page?.querySelector('.version-loader-note')?.innerText, results: [...(page?.querySelectorAll('.result-title') ?? [])].map(row => row.innerText), busy: !!page?.querySelector('.result-list[aria-busy=true]'), scrollTop: content?.scrollTop ?? 0, horizontalOverflow: !!content && content.scrollWidth > content.clientWidth + 2, focus: document.hasFocus(), viewport: { width: innerWidth, height: innerHeight } }
}
// Read-only receiver observation. Editing remains a real Chromium editing
// command/insertText; this observer never assigns a value, focus or selection.
function installCommunityInputObserver(config) {
  if (performance.timeOrigin !== config.timeOrigin || location.href !== config.url || globalThis.__qaCommunityInput120) throw Error('Community input document changed or observer already installed')
  const input = document.querySelector(config.selector)
  if (!input || document.activeElement !== input || !document.hasFocus() || document.hidden || document.readyState !== 'complete') throw Error('Community editing requires the actual focused input in the bound document')
  const snapshot = () => ({ timeOrigin: performance.timeOrigin, url: location.href, focused: document.activeElement === input, documentFocused: document.hasFocus(), hidden: document.hidden, ready: document.readyState, present: document.querySelector(config.selector) === input, value: input.value, start: input.selectionStart, end: input.selectionEnd })
  const events = []; let dropped = 0
  const receive = event => {
    if (event.target !== input) return
    if (events.length === 128) { dropped++; return }
    events.push({ type: event.type, isTrusted: event.isTrusted, key: event.key, code: event.code, metaKey: event.metaKey, ctrlKey: event.ctrlKey, inputType: event.inputType, data: event.data, receivedAt: Date.now(), eventTimeStamp: event.timeStamp, state: snapshot() })
  }
  const types = ['keydown', 'keyup', 'beforeinput', 'input']
  for (const type of types) document.addEventListener(type, receive, true)
  globalThis.__qaCommunityInput120 = { token: config.token, inspect() { return { token: config.token, state: snapshot(), events: events.slice(), dropped } }, restore() { for (const type of types) document.removeEventListener(type, receive, true); const receipt = this.inspect(); delete globalThis.__qaCommunityInput120; return receipt } }
  return globalThis.__qaCommunityInput120.inspect()
}
function readCommunityInputObserver(token, restore = false) {
  const observer = globalThis.__qaCommunityInput120
  if (!observer || observer.token !== token) throw Error('Community input observer identity changed')
  return restore ? observer.restore() : observer.inspect()
}
async function replaceCommunityText(h, binding, selector, value, options = {}) {
  const platform = options.platform ?? process.platform, token = crypto.randomUUID()
  const row = { token, selector, requestedValue: value, complete: false, commands: [], classification: 'Trusted coordinate focus, real Chromium key/edit commands, actual selection checks and read-only DOM receiver ledger; no DOM value/selection assignment and no native OS key-post claim' }
  const record = () => options.record?.(row)
  record()
  let originalError, observerInstalled = false
  const check = snapshot => {
    assert.equal(snapshot.token, token)
    for (const key of ['timeOrigin', 'url']) assert.equal(snapshot.state[key], binding[key], 'Community input bound document changed: ' + key)
    for (const key of ['focused', 'documentFocused', 'present']) assert.equal(snapshot.state[key], true, 'Community input lost actual focus/identity: ' + key)
    assert.equal(snapshot.state.hidden, false); assert.equal(snapshot.state.ready, 'complete')
    return snapshot
  }
  try {
    const actual = await h.main(`(()=>{const e=globalThis.testElectron,w=e?.BrowserWindow.fromId(${binding.windowId}),fs=process.mainModule.require('node:fs');return{pid:process.pid,profile:fs.realpathSync.native(e.app.getPath('userData')),executable:fs.realpathSync.native(process.execPath),windowId:w?.id,webContentsId:w?.webContents.id,url:w?.webContents.getURL()}})()`)
    for (const key of ['pid', 'profile', 'executable', 'windowId', 'webContentsId', 'url']) assert.equal(actual[key], binding[key], 'Community editing rejects a changed owned process/window: ' + key)
    const click = async target => {
      await h.foreground(); await h.click(target); await h.foreground()
      const installed = await h.evaluate(`(${installCommunityInputObserver})(${JSON.stringify({ token, selector, timeOrigin: binding.timeOrigin, url: binding.url })})`)
      observerInstalled = true; row.before = check(installed); record()
    }
    const call = async (method, params) => {
      await h.foreground(); const before = check(await h.evaluate(`(${readCommunityInputObserver})(${JSON.stringify(token)})`))
      const entry = { method, params, startedAt: Date.now(), before }; row.commands.push(entry); record()
      await h.call(method, params)
      await h.foreground(); entry.after = check(await h.evaluate(`(${readCommunityInputObserver})(${JSON.stringify(token)})`)); entry.finishedAt = Date.now(); record()
    }
    row.result = await replaceNativeInput(click, call, h.evaluate, selector, value, platform)
    row.complete = true
  } catch (error) { originalError = error; row.error = { name: error.name, message: error.message } }
  finally {
    if (observerInstalled) try { row.receiver = await h.evaluate(`(${readCommunityInputObserver})(${JSON.stringify(token)},true)`) }
    catch (error) { row.complete = false; row.cleanupError = { name: error.name, message: error.message }; if (!originalError) originalError = error }
    row.finishedAt = Date.now(); record()
  }
  if (originalError) throw originalError
  return row
}
async function run(h, binding) {
  const { evaluate, main, click, nav, call, wait, until, screenshot, foreground } = h
  for (const [name, fn] of Object.entries({ evaluate, main, click, nav, call, wait, until, screenshot, foreground })) assert.equal(typeof fn, 'function', 'Missing owner driver API ' + name)
  const root = fs.realpathSync.native(h.root), profile = fs.realpathSync.native(h.profile)
  assert(contained(root, profile)); assert.equal(fs.realpathSync.native(binding.profile), profile)
  const actualProcess = await main('({pid:process.pid,ppid:process.ppid,executable:process.execPath})')
  assert.equal(actualProcess.pid, binding.pid)
  assert.equal(fs.realpathSync.native(actualProcess.executable), fs.realpathSync.native(binding.executable))
  // A portable Windows SFX owns an Electron child; on macOS the directly
  // spawned process is the main PID. The relationship is observed from the
  // actual main process, never fabricated by changing the tracked child's PID.
  if (h.ownedTrack) assert(h.ownedTrack.pid === actualProcess.pid || h.ownedTrack.pid === actualProcess.ppid, 'Owned process must be the exact spawned main or its observed portable wrapper parent')
  const proof = { complete: false, binding, actualProcess, trackedOwnerPID: h.ownedTrack?.pid, startedAt: new Date().toISOString(), operations: [], screenshots: [], layouts: [], inputs: [], classification: 'Actual packaged production Vue/IPC, trusted coordinate and keyboard inputs, native foreground owner checks. Source/manifest metadata and non-runnable installed profiles are synthetic; no real service, MOD install or game claim.' }
  const live = path.join(h.output, 'community120-' + h.theme + '-live.json')
  fs.writeFileSync(live, JSON.stringify(proof, null, 2), { flag: 'wx' })
  const save = () => fs.writeFileSync(live, JSON.stringify(proof, null, 2))
  const observe = async (label, read, predicate = Boolean) => { const value = await until(label, read, predicate); proof.operations.push({ label, at: Date.now(), value }); save(); return value }
  const state = () => evaluate(`(${readCommunityState})()`)
  const key = async (key, code, vk, modifiers = 0) => { await foreground(); for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, modifiers }) }
  const documentBinding = await evaluate('({timeOrigin:performance.timeOrigin,url:location.href})')
  const inputBinding = { ...binding, profile, executable: fs.realpathSync.native(binding.executable), ...documentBinding }
  proof.documentBinding = documentBinding; save()
  const text = (selector, value) => replaceCommunityText(h, inputBinding, selector, value, { record(row) { if (!proof.inputs.includes(row)) proof.inputs.push(row); save() } })
  const shot = async label => { await foreground(); const result = await screenshot('community120-' + label); proof.screenshots.push({ label, result }); save(); return result }
  const inspect = () => main('__qaCommunity120.inspect()')
  const lastQuery = async () => (await inspect()).records.filter(row => row.channel === 'community:search').at(-1)?.args[0]
  const ready = label => observe(label, state, value => value.present && value.results.length === 20 && !value.busy)
  const choose = async (selector, optionSelector) => { await click(selector); await observe('actual select menu opened', "!!document.querySelector('.select-menu-float')"); await click(optionSelector); await observe('actual select menu dismissed', "!!document.querySelector('.select-menu-float')", value => !value) }
  const keyword = '[data-ui="CommunityView:bc0450fd9c8f"]', version = '[data-ui="community:custom-version"] input'
  let originalError
  try {
    assert.equal(await evaluate("!!document.querySelector('.community-page')"), false, 'Default evidence requires first entry in a fresh session')
    proof.fixture = await main(`(${installCommunityFixture})(${JSON.stringify({ ...binding, root, profile })})`)
    const installed = await evaluate("window.kamucl.invoke('versions:installed')")
    for (const row of SYNTHETIC) assert(installed.some(value => value.id === row.id && value.mcVersion === row.mcVersion && value.loader === row.loader && !value.incomplete && !value.failed), 'Original scan must recognize synthetic metadata ' + row.id)
    proof.installedScan = { items: installed, classification: 'Original production directory scan of explicit synthetic non-runnable profiles' }; save()
    await nav('community'); const first = await ready('fresh community results ready')
    const firstQuery = await lastQuery()
    assert.equal(first.source, 'community:versions-all'); assert.equal(first.loader, '全部加载器'); assert.equal(firstQuery.mcVersion, undefined); assert.equal(firstQuery.loader, undefined)
    proof.firstEntry = { state: first, query: firstQuery }; save()
    for (const [width, height, zoom] of [[960, 620, 1], [960, 620, 1.25], [1280, 900, 1.25]]) {
      const native = await main(`(()=>{const w=testElectron.BrowserWindow.fromId(${binding.windowId});if(w.webContents.id!==${binding.webContentsId})throw Error('Owned renderer changed');w.unmaximize();w.setSize(${width},${height});w.webContents.setZoomFactor(${zoom});return{bounds:w.getBounds(),content:w.getContentBounds(),zoom:w.webContents.getZoomFactor()}})()`)
      // Use actual native content/zoom, including DPI rounding; do not silently
      // assume setSize(960) produces precisely 960 CSS pixels on every platform.
      await observe('actual native content and renderer viewport agree', async () => ({ native: await main(`(()=>{const w=testElectron.BrowserWindow.fromId(${binding.windowId});return{content:w.getContentBounds(),zoom:w.webContents.getZoomFactor()}})()`), page: await state() }), value => value.native.zoom === zoom && Math.abs(value.page.viewport.width - value.native.content.width / zoom) <= 1.5 && Math.abs(value.page.viewport.height - value.native.content.height / zoom) <= 1.5)
      const layout = { requested: { width, height, zoom }, native, states: [] }; proof.layouts.push(layout); save()
      for (const mode of ['all', 'installed', 'custom']) {
        await click(`[data-ui="community:versions-${mode}"]`)
        await observe('actual version mode ' + mode, state, value => value.source === 'community:versions-' + mode && !value.horizontalOverflow && value.focus)
        if (mode === 'installed') {
          await click('[aria-label="选择已安装版本"]')
          const options = await observe('installed popup is on body and actual visible option receives hit', "(()=>{const m=document.querySelector('.select-menu-float'),rows=[...(m?.querySelectorAll('button')||[])],r=rows[0]?.getBoundingClientRect();return{open:!!m,onBody:m?.parentElement===document.body,unknown:rows.some(e=>e.innerText.includes('unknown-incomplete')),hits:r&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.select-menu-float')===m,rect:r?.toJSON(),height:innerHeight}})()", value => value.open && value.onBody && value.hits && !value.unknown && value.rect.top >= 0 && value.rect.bottom <= value.height)
          layout.states.push({ mode, popup: options, screenshot: await shot(`${width}-${zoom}-${mode}`) })
          await key('Escape', 'Escape', 27); await observe('Escape closes installed menu', "!!document.querySelector('.select-menu-float')", value => !value)
        } else if (mode === 'custom') {
          await click(version)
          const popup = await observe('custom popup escapes card and is not occluded', "(()=>{const m=document.querySelector('#community-version-options'),row=m?.querySelector('button'),r=row?.getBoundingClientRect();return{open:!!m,onBody:m?.parentElement===document.body,hits:r&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('#community-version-options')===m,rect:r?.toJSON(),height:innerHeight}})()", value => value.open && value.onBody && value.hits && value.rect.top >= 0 && value.rect.bottom <= value.height)
          layout.states.push({ mode, popup, screenshot: await shot(`${width}-${zoom}-${mode}`) })
          await key('Escape', 'Escape', 27); await observe('Escape closes custom popup', "!!document.querySelector('#community-version-options')", value => !value)
          await click(version); await observe('same focused custom input click reopens popup', "!!document.querySelector('#community-version-options')")
          await key('Tab', 'Tab', 9); await observe('Tab closes custom popup', "!!document.querySelector('#community-version-options')", value => !value)
        } else layout.states.push({ mode, state: await state(), screenshot: await shot(`${width}-${zoom}-${mode}`) })
        save()
      }
    }
    await click('[data-ui="community:versions-installed"]')
    await choose('[aria-label="选择已安装版本"]', '.select-menu-float button[title*="qa120-fabric"]')
    await ready('explicit installed version results ready')
    const installedQuery = await lastQuery(); assert.equal(installedQuery.mcVersion, '1.20.1'); assert.equal(installedQuery.loader, 'fabric')
    await choose('[aria-label="加载器"]', '.select-menu-float button[title="Forge"]')
    await ready('manual Forge filter results ready')
    await choose('[aria-label="选择已安装版本"]', '.select-menu-float button[title*="qa120-fabric"]')
    const mismatch = await observe('independent loader choice remains explicit', state, value => value.mismatch?.includes('手选的 Forge') && value.mismatch.includes('fabric') && !value.busy)
    assert.equal((await lastQuery()).loader, 'forge'); await shot('manual-loader-preserved')
    await click('.version-loader-note button'); await ready('explicit instance loader action results ready'); assert.equal((await lastQuery()).loader, 'fabric')
    await click('[data-ui="community:versions-all"]'); await ready('all versions removes only instance-derived loader')
    assert.equal((await lastQuery()).mcVersion, undefined); assert.equal((await lastQuery()).loader, undefined)
    await choose('[aria-label="加载器"]', '.select-menu-float button[title="Forge"]'); await ready('manual loader selected separately')
    await click('[data-ui="community:versions-custom"]'); await text(version, '24w14potato'); await key('Enter', 'Enter', 13)
    await ready('exact custom snapshot results ready'); assert.equal((await lastQuery()).mcVersion, '24w14potato'); assert.equal((await lastQuery()).loader, 'forge')
    await text(keyword, '悠然一派中文120'); await key('Enter', 'Enter', 13); await ready('Chinese keyword remains original on the actual IPC')
    assert.equal((await lastQuery()).keyword, '悠然一派中文120')
    await choose('[aria-label="资源来源"]', '.select-menu-float button[title="Modrinth"]'); await ready('source filter results ready')
    assert.equal((await lastQuery()).source, 'modrinth')
    const before = await state(), queriesBefore = (await inspect()).records.filter(row => row.channel === 'community:search').length
    await nav('mods'); await nav('community')
    const restored = await observe('route return retains exact custom version, loader, keyword and rows', state, value => value.source === before.source && value.version === before.version && value.keyword === before.keyword && value.loader === before.loader && value.results.join('\n') === before.results.join('\n') && !value.busy)
    const queriesAfter = (await inspect()).records.filter(row => row.channel === 'community:search').length
    assert.equal(queriesAfter, queriesBefore, 'Route return must not implicitly repeat the query')
    proof.history = { before, restored, queriesBefore, queriesAfter }; proof.manualLoader = { mismatch, installedQuery }; await shot('custom-exact-route-return')
    await click('.result-card .result-dl'); await observe('actual file chooser metadata loaded', "!!document.querySelector('.download-modal .file-list button.active')")
    const files = (await inspect()).records.filter(row => row.channel === 'community:files').at(-1)
    assert.equal(files.args[2].mcVersion, '24w14potato'); assert.equal(files.args[2].loader, 'forge'); assert.equal(files.args[2].kind, 'mod')
    proof.fileQuery = files; await shot('exact-version-download-chooser')
    await click('[data-ui="CommunityView:989d28842ec5"]'); await observe('file chooser closed through its real cancel control', "!!document.querySelector('.download-modal')", value => !value)
    await main('__qaCommunity120.holdNextSearch()'); await text(keyword, 'slow120'); await key('Enter', 'Enter', 13)
    await observe('old metadata request is actually pending', async () => (await inspect()).held.length, value => value === 1)
    await text(version, '1.21.1'); await key('Enter', 'Enter', 13); await ready('new exact-version response replaces old query')
    const newer = await state(); assert(newer.results.every(value => value.includes('1.21.1') && !value.includes('OLD-RESPONSE-120')))
    assert.equal(await main('__qaCommunity120.releaseHeld()'), 1)
    await observe('old metadata request really completed', async () => (await inspect()).records.filter(row => row.releasedAt).every(row => !!row.completedAt))
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
    const final = await state(); assert.deepEqual(final.results, newer.results); assert.equal(final.version, '1.21.1')
    proof.staleResponse = { newer, final, classification: 'Controlled synthetic IPC response order; actual production renderer generation check' }
    await click('[data-ui="community:versions-all"]'); await ready('all versions keeps independently selected loader')
    const allQuery = await lastQuery(); assert.equal(allQuery.mcVersion, undefined); assert.equal(allQuery.loader, 'forge')
    await shot('all-versions-manual-loader-explicit')
    // Cover the actual download-target SelectMenu path which previously called
    // an undefined, removed global-selection handler. No install IPC is mocked
    // or invoked here; compiled handler tests separately verify exact IPC args.
    const selectionBefore = await evaluate("({id:localStorage.getItem('kamucl.lastVersion')})")
    assert(installed.some(row => row.id === selectionBefore.id), 'Actual persisted launcher selection must identify an observed instance')
    const folderBefore = await evaluate("window.kamucl.invoke('settings:get').then(s=>s.activeFolder)")
    await choose('[aria-label="加载器"]', '.select-menu-float button[title="Fabric"]'); await ready('Fabric target query ready')
    await click('.result-card .result-dl'); await observe('compatible download chooser ready', "!!document.querySelector('.download-modal .file-list button.active')")
    await click('[aria-label="下载目标实例"]')
    await observe('compatible second target is an actual visible option', "[...document.querySelectorAll('.select-menu-float button')].some(e=>e.title.startsWith('qa120-fabric-other ·'))")
    await click('.select-menu-float button[title^="qa120-fabric-other ·"]')
    const targetSelection = await observe('exact second target remains selected without global instance change', "(()=>{const e=document.querySelector('[aria-label=\"下载目标实例\"]');return {label:e?.innerText,confirmDisabled:document.querySelector('[data-ui=\"CommunityView:cade5c4fc83a\"]')?.disabled,selected:localStorage.getItem('kamucl.lastVersion')}})()", value => value.label?.includes('qa120-fabric-other') && value.confirmDisabled === false)
    assert.equal(targetSelection.selected, selectionBefore.id)
    assert.equal(await evaluate("window.kamucl.invoke('settings:get').then(s=>s.activeFolder)"), folderBefore)
    proof.downloadTarget = { selectionBefore, targetSelection, classification: 'Actual trusted SelectMenu choice and production v-model; installation was not invoked. Same-name/different-folder IPC target matching is covered by compiled product handler tests.' }; await shot('download-target-second-instance')
    await click('[data-ui="CommunityView:989d28842ec5"]'); await observe('second target chooser cancels normally', "!!document.querySelector('.download-modal')", value => !value)
    proof.ledger = await inspect(); proof.complete = true
  } catch (error) { originalError = error; proof.error = { name: error.name, message: error.message, stack: error.stack }; save() }
  finally {
    try { if (await main('!!globalThis.__qaCommunity120')) { proof.restoration = await main('__qaCommunity120.restore()'); assert.equal(proof.restoration.complete, true) } }
    catch (error) { proof.complete = false; proof.cleanupError = { name: error.name, message: error.message }; if (!originalError) originalError = error }
    proof.finishedAt = new Date().toISOString(); save()
  }
  if (originalError) throw originalError
  assert.equal(proof.complete, true); return proof
}
module.exports = run
Object.assign(module.exports, { prepareCommunityProfile, installCommunityFixture, readCommunityState, installCommunityInputObserver, readCommunityInputObserver, replaceCommunityText })
