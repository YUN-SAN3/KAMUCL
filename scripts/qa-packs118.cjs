// Actual owned Windows portable UI with production resource-pack imports and
// manual instance writes. All paths belong to the disposable driver root.
// One state-file rename failure is injected locally; no game is launched.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict'), AdmZip = require('adm-zip')
const native = require('./qa-native-window115.cjs')
module.exports = async function(h) {
  assert(['win32','darwin'].includes(process.platform)); const isMac = process.platform === 'darwin'
  const directory = path.resolve('out', 'qa-packs118-' + (process.env.KAMUCL_TEST_THEME || 'black-orange') + '-' + crypto.randomUUID())
  fs.mkdirSync(directory, { recursive: true })
  const proof = { complete: false, version: h.version, theme: process.env.KAMUCL_TEST_THEME, directory, observations: [], screenshots: [], clicks: [], classification: 'Actual owned Windows portable UI, foreground-checked coordinate input and real production ZIP/configuration writes. Private metadata-only client JAR fixtures are never launched. A single synthetic filesystem failure exercises production rollback and the real retry control; no game-screen acceptance.' }
  const save = () => fs.writeFileSync(path.join(directory, 'live.json'), JSON.stringify(proof, null, 2))
  const identity = await h.main(`(()=>{const f=process.mainModule.require('node:fs'),w=testElectron.BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('/renderer/index.html'));if(w.length!==1)throw Error('Ambiguous QA renderer');return{pid:process.pid,ppid:process.ppid,windowId:w[0].id,webContentsId:w[0].webContents.id,profile:f.realpathSync.native(testElectron.app.getPath('userData'))}})()`)
  assert(identity.pid === h.ownedTrack.pid || identity.ppid === h.ownedTrack.pid)
  assert.equal(identity.profile, fs.realpathSync.native(h.profile)); proof.identity = identity
  const privateRoot = fs.realpathSync.native(h.root)
  for (const dir of [h.profile, h.games]) { const relative = path.relative(privateRoot, fs.realpathSync.native(dir)); assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Fixture path must be within the driver-owned root') }
  const binding = { pid: identity.pid, windowId: identity.windowId, webContentsId: identity.webContentsId }, koffi = path.resolve('node_modules/koffi')
  const mac = isMac ? await require('./qa-native-mac120.cjs').create(h,proof,directory,binding) : null
  proof.platform=process.platform;if(isMac)proof.classification=proof.classification.replace('Windows portable UI','signed Mac package UI')
  const foreground = async () => {
    if(mac)return mac.observe()
    const state = await h.main(`(${native.observeOwned})(${JSON.stringify(binding)},${JSON.stringify(koffi)})`)
    assert.equal(state.foreground, state.hwnd); assert.equal(state.foregroundPid, binding.pid)
    assert(state.visible && state.focused && !state.minimized); return state
  }
  const until = async (label, read, predicate) => {
    const row = { label, samples: [] }; proof.observations.push(row); save()
    for (let i = 0; i < 125; i++) { const value = await read(); row.samples.push({ at: Date.now(), value }); if (predicate(value)) { row.complete = true; save(); return value }; await h.wait(80) }
    throw Error('UI state not ready: ' + label)
  }
  const element = selector => `document.querySelector(${JSON.stringify(selector)})`
  const clickElement = async (expression, label) => {
    await h.evaluate(`(()=>{const e=${expression};if(!e)throw Error('Missing coordinate target');e.scrollIntoView({block:'center',inline:'nearest'})})()`)
    const point = await until('coordinate ' + label, () => h.evaluate(`(()=>{const e=${expression},r=e?.getBoundingClientRect(),x=r&&r.x+r.width/2,y=r&&r.y+r.height/2,hit=r&&document.elementFromPoint(x,y);return{exists:!!e,disabled:!!e?.disabled,inert:!!e?.closest('[inert]'),x,y,width:r?.width,height:r?.height,hit:!!hit&&(hit===e||e.contains(hit)),viewport:!!r&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight}})()`), value => value.exists && !value.disabled && !value.inert && value.hit && value.viewport && value.width > 0 && value.height > 0)
    const before = await foreground()
    for (const [type, button] of [['mouseMoved', 'none'], ['mousePressed', 'left'], ['mouseReleased', 'left']]) await h.call('Input.dispatchMouseEvent', { type, button, clickCount: type === 'mouseMoved' ? 0 : 1, x: point.x, y: point.y })
    proof.clicks.push({ label, point, before, after: await foreground() }); save(); await h.wait(160)
  }
  const click = selector => clickElement(element(selector), selector)
  const invoke = (channel, ...args) => h.evaluate(`window.kamucl.invoke(${JSON.stringify(channel)},...${JSON.stringify(args)})`)
  const screenshot = async label => {
    await h.wait(300); const before = await foreground(), file = label + '.png'
    const bytes = Buffer.from((await h.call('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    fs.writeFileSync(path.join(directory, file), bytes, { flag: 'wx' })
    proof.screenshots.push({ file, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), before, after: await foreground() }); save()
  }
  const nav = async id => { await click('[data-nav=' + id + ']'); await until('navigation ' + id, () => h.evaluate(`document.querySelector('[data-nav=${id}]')?.getAttribute('aria-current')`), value => value === 'page'); await h.wait(350) }
  const selectTarget = async id => {
    await click('[data-ui="KeysView:packs-target"]')
    const expression = `Array.from(document.querySelectorAll('.select-menu-float [role=option]')).find(e=>e.querySelector('.select-menu-option-label > span')?.textContent.trim()===${JSON.stringify(id)})`
    await until('target popup ' + id, () => h.evaluate(`!!(${expression})`), Boolean)
    proof.popup = await h.evaluate("(()=>{const e=document.querySelector('.select-menu-float'),r=e?.getBoundingClientRect();return e&&{body:e.parentElement===document.body,top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:innerHeight,width:innerWidth}})()")
    assert(proof.popup.body && proof.popup.top >= 0 && proof.popup.bottom <= proof.popup.height + 1 && proof.popup.left >= 0 && proof.popup.right <= proof.popup.width + 1)
    await clickElement(expression, 'choose instance ' + id)
    await until('selected target ' + id, () => h.evaluate("document.querySelector('[data-ui=\"KeysView:packs-target\"] .select-menu-label > span')?.textContent.trim()"), value => value === id)
  }
  const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  const packsIn = (game, key = 'resourcePacks') => JSON.parse(fs.readFileSync(path.join(game, 'options.txt'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).find(line => line.startsWith(key + ':')).slice(key.length + 1))
  const disk = game => ({ options: fs.readFileSync(path.join(game, 'options.txt'), 'utf8'), state: fs.readFileSync(path.join(game, '.kamucl-default-resourcepacks.json'), 'utf8'), copied: fs.existsSync(path.join(game, 'resourcepacks')) ? fs.readdirSync(path.join(game, 'resourcepacks')).filter(n => n.endsWith('.zip')) : [] })
  const windowState = () => h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${identity.windowId});return{bounds:w.getBounds(),zoom:w.webContents.getZoomFactor(),maximized:w.isMaximized(),content:w.getContentSize()}})()`)
  let primary, initialWindow
  try {
    await h.call('Emulation.setFocusEmulationEnabled', { enabled: false })
    proof.nativeFocus = mac ? await mac.focus() : await h.main(`(${native.focusOwned})(${JSON.stringify(binding)},${JSON.stringify(koffi)})`)
    await until('actual focus', () => h.evaluate('document.hasFocus()&&!document.hidden'), Boolean)
    initialWindow = await windowState(); proof.initialWindow = initialWindow
    assert.deepEqual(await invoke('defaultPacks:get'), [], 'Packs QA requires fresh disposable global defaults')
    const fixtureRoot = path.join(privateRoot, 'packs118-fixtures-' + crypto.randomUUID()); fs.mkdirSync(fixtureRoot)
    const sources = ['§6中文 A 默认包.zip', 'B with spaces.zip'].map((filename, i) => {
      const zip = new AdmZip(), file = path.join(fixtureRoot, filename)
      zip.addFile('pack.mcmeta', Buffer.from('\uFEFF' + JSON.stringify({ pack: { pack_format: i ? 15 : 3, min_format: 1, max_format: [1000, 0], supported_formats: [1, 1000], description: filename } })))
      zip.addFile('assets/minecraft/qa118.txt', Buffer.from(filename)); fs.writeFileSync(file, zip.toBuffer(), { flag: 'wx' }); return file
    })
    const packs = await invoke('defaultPacks:import', sources), names = packs.map(p => 'KAMUCL-default-' + p.id + '-' + p.name)
    await invoke('settings:set', { resourcePackSync: true })
    const ids = ['材质包验证 § 中文 实例', '1.12.2 材质包备选实例'], games = []
    const personal = ['file/个人 中文 § 包.zip', 'Personal Legacy.zip']
    for (const [index, id] of ids.entries()) {
      const game = path.join(h.games, 'versions', id); fs.mkdirSync(game); games.push(game)
      fs.writeFileSync(path.join(game, id + '.json'), JSON.stringify({ id, _mcVersion: index ? '1.12.2' : '26.2', _gameDir: true, mainClass: 'net.minecraft.client.main.Main', libraries: [] }), { flag: 'wx' })
      const zip = new AdmZip(); zip.addFile('version.json', Buffer.from(JSON.stringify({ id: index ? '1.12.2' : '26.2', pack_version: index ? { resource: 3 } : { resource_major: 88, resource_minor: 0 } }))); fs.writeFileSync(path.join(game, id + '.jar'), zip.toBuffer(), { flag: 'wx' })
      const managed = names.map(n => index ? n : 'file/' + n)
      fs.writeFileSync(path.join(game, 'options.txt'), `\uFEFFlang:zh_cn\r\n\r\nresourcePacks:${JSON.stringify(['vanilla', personal[index], managed[0]])}\r\nincompatibleResourcePacks:${JSON.stringify([personal[index], managed[0]])}\r\ncustom:keep\r\n`, { flag: 'wx' })
      fs.writeFileSync(path.join(game, '.kamucl-default-resourcepacks.json'), JSON.stringify(managed), { flag: 'wx' })
    }
    proof.fixtures = { root: fixtureRoot, games, ids, sources: sources.map(file => ({ file, sha256: sha(file) })), names, personal }
    proof.before = games.map(disk); save()
    await h.reloadThemeReady('packs118-fixtures')
    await nav('keys'); await click('[data-ui="KeysView:d7d636f03de6"]')
    await until('instance priority text and default rows', () => h.evaluate("({hint:document.querySelector('[data-ui=\"KeysView:packs-instance-priority\"]')?.textContent,rows:document.querySelectorAll('.default-packs .cfg-row').length})"), value => value.hint?.includes('已有实例以游戏内选择为准') && value.rows === 2)
    await selectTarget(ids[0])
    // The real filesystem publication fails after options is written. Production
    // rollback restores options and the legacy state, then the actual UI retries.
    proof.failureSetup = await h.main(`(()=>{const f=process.mainModule.require('node:fs'),original=f.renameSync,expected=${JSON.stringify(path.join(games[0], '.kamucl-default-resourcepacks.json'))};if(globalThis.__qaPacks118)throw Error('Foreign packs failure boundary');const state={failed:false,records:[],restore(){if(f.renameSync!==wrapped)throw Error('Filesystem boundary identity changed');f.renameSync=original;delete globalThis.__qaPacks118;return{complete:f.renameSync===original,records:state.records}}};function wrapped(source,dest){if(!state.failed&&String(dest)===expected){state.failed=true;state.records.push({source:String(source),dest:String(dest),synthetic:true});throw Error('合成：默认材质包实例记录写入失败')}return original.apply(this,arguments)}f.renameSync=wrapped;globalThis.__qaPacks118=state;return{owned:true,target:expected}})()`)
    await click('[data-ui="KeysView:packs-reapply"]')
    proof.failureRecovery = await until('failed manual apply releases retry control', async () => ({ failed: await h.main('__qaPacks118.failed'), ui: await h.evaluate("({disabled:document.querySelector('[data-ui=\"KeysView:packs-reapply\"]')?.disabled,text:document.body.innerText})"), disk: disk(games[0]) }), value => value.failed && value.ui.disabled === false && value.ui.text.includes('重新应用失败') && value.disk.options === proof.before[0].options && value.disk.state === proof.before[0].state)
    assert.equal(proof.failureRecovery.disk.copied.length, 2); await screenshot('manual-failure-rollback')
    proof.failureRestored = await h.main('__qaPacks118.restore()'); assert(proof.failureRestored.complete)
    await click('[data-ui="KeysView:packs-reapply"]')
    proof.retry = await until('real retry applies current defaults', () => disk(games[0]), value => JSON.parse(value.state).version === 2 && value.options.includes('file/' + names[1]))
    assert.deepEqual(packsIn(games[0]), ['vanilla', personal[0], ...names.map(n => 'file/' + n)])
    assert.deepEqual(packsIn(games[0], 'incompatibleResourcePacks'), [personal[0]])
    proof.layouts = []
    for (const config of [{ width: 1360, height: 860, zoom: 1 }, { width: 960, height: 620, zoom: 1.25 }]) {
      await h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${identity.windowId});w.unmaximize();w.setSize(${config.width},${config.height});w.webContents.setZoomFactor(${config.zoom});return true})()`)
      const geometry = await until('actual window geometry ' + config.width, async () => ({ native: await windowState(), renderer: await h.evaluate('({width:innerWidth,height:innerHeight,visual:{width:visualViewport.width,height:visualViewport.height},theme:document.documentElement.dataset.theme})') }), value => Math.abs(value.native.bounds.width - config.width) <= 3 && Math.abs(value.native.bounds.height - config.height) <= 3 && value.native.zoom === config.zoom && Math.abs(value.renderer.visual.width - value.native.content[0] / config.zoom) < 1 && Math.abs(value.renderer.visual.height - value.native.content[1] / config.zoom) < 1 && value.renderer.width === Math.round(value.renderer.visual.width) && value.renderer.height === Math.round(value.renderer.visual.height))
      await selectTarget(ids[1])
      const layout = await h.evaluate("(()=>{const box=document.querySelector('.default-packs').getBoundingClientRect(),elements=['KeysView:packs-target','KeysView:packs-reapply'].map(id=>{const e=document.querySelector('[data-ui=\"'+id+'\"]'),r=e.getBoundingClientRect();return{id,left:r.left,right:r.right,width:r.width,height:r.height,visible:getComputedStyle(e).display!=='none'}});return{viewport:{width:innerWidth,height:innerHeight},box:{left:box.left,right:box.right},elements}})()")
      for (const e of layout.elements) assert(e.visible && e.width > 0 && e.height > 0 && e.left >= layout.box.left - 1 && e.right <= layout.box.right + 1, 'Manual controls must fit their card')
      proof.layouts.push({ config, geometry, layout }); await screenshot('manual-controls-' + config.width + '-zoom-' + config.zoom)
    }
    assert.equal(fs.readFileSync(path.join(games[1], 'options.txt'), 'utf8'), proof.before[1].options, 'Selecting a target must not apply it')
    await click('[data-ui="KeysView:packs-reapply"]')
    proof.legacy = await until('selected legacy instance receives old identifier format', () => disk(games[1]), value => JSON.parse(value.state).version === 2 && value.options.includes(names[1]))
    assert.deepEqual(packsIn(games[1]), ['vanilla', personal[1], ...names]); assert(!packsIn(games[1]).some(n => n.startsWith('file/KAMUCL-default-')))
    assert.deepEqual(packsIn(games[1], 'incompatibleResourcePacks'), [personal[1], names[1]])
    const beforeGlobalDisable = fs.readFileSync(path.join(games[0], 'options.txt'), 'utf8')
    proof.globalControls = await h.evaluate("Array.from(document.querySelectorAll('.default-packs .pack-enable input[type=checkbox]')).map(e=>({ariaLabel:e.getAttribute('aria-label'),checked:e.checked,disabled:e.disabled,labelId:e.closest('label')?.getAttribute('data-ui')}))")
    const enabledInput = `Array.from(document.querySelectorAll('.default-packs .pack-enable input[type=checkbox]')).find(e=>e.getAttribute('aria-label')===${JSON.stringify('启用材质包 ' + packs[0].name)})`
    assert.equal(proof.globalControls.filter(row => row.ariaLabel === '启用材质包 ' + packs[0].name).length, 1, 'Imported default has one accessible toggle')
    await clickElement(`(${enabledInput})?.closest('label')`, 'disable global default ' + packs[0].name)
    await until('global default disabled through real switch', () => invoke('defaultPacks:get'), value => value.find(p => p.id === packs[0].id)?.enabled === false)
    assert.equal(fs.readFileSync(path.join(games[0], 'options.txt'), 'utf8'), beforeGlobalDisable)
    await selectTarget(ids[0]); await click('[data-ui="KeysView:packs-reapply"]')
    proof.disabledReapply = await until('only enabled defaults selected after explicit reapply', () => packsIn(games[0]), value => value.length === 3 && !value.includes('file/' + names[0]) && value.includes('file/' + names[1]))
    assert.deepEqual(fs.readdirSync(path.join(games[0], 'resourcepacks')).sort(), [...names].sort())
    for (const source of proof.fixtures.sources) assert.equal(sha(source.file), source.sha256)
    await h.reloadThemeReady('packs118-persisted'); await nav('keys'); await click('[data-ui="KeysView:d7d636f03de6"]')
    proof.persistedDefaults = await until('disabled global default persists after real renderer reload', () => invoke('defaultPacks:get'), value => value.find(p => p.id === packs[0].id)?.enabled === false)
    assert.deepEqual(packsIn(games[0]), proof.disabledReapply)
    await screenshot('persisted-instance-priority')
    proof.final = games.map(disk); proof.ownedAppMetricsBeforeClose = await h.main('testElectron.app.getAppMetrics().map(row=>({pid:row.pid,type:row.type}))')
    proof.complete = true; fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(proof, null, 2), { flag: 'wx' }); console.log(JSON.stringify({ complete: true, directory, theme: proof.theme }))
  } catch (error) {
    primary = error; proof.error = { name: error.name, message: error.message, stack: error.stack }
    try { fs.writeFileSync(path.join(directory, 'failure.png'), Buffer.from((await h.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'), { flag: 'wx' }) } catch {}
    throw error
  } finally {
    try { const restored = await h.main('globalThis.__qaPacks118?__qaPacks118.restore():({complete:true,absent:true})'); assert(restored.complete); proof.boundaryRestored = restored } catch (error) { proof.boundaryRestorationError = error.message; if (!primary) throw error }
    if (initialWindow) await h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${identity.windowId});w.webContents.setZoomFactor(${initialWindow.zoom});w.setBounds(${JSON.stringify(initialWindow.bounds)});${initialWindow.maximized ? 'w.maximize();' : ''}return true})()`)
    proof.finishedAt = new Date().toISOString(); save(); if (primary) fs.writeFileSync(path.join(directory, 'failure.json'), JSON.stringify(proof, null, 2), { flag: 'wx' })
  }
}
