// Actual renderer controls with synthetic source metadata and plan responses.
// Backend transactions are separately exercised by tests/community-116.test.ts.
// This module never launches or focuses a process. The owner supplies native
// foreground-checked coordinates, keyboard input, snapshots and one private PID.
const assert = require('node:assert/strict')
function installCommunityFixture(config) {
  const electron = globalThis.testElectron, fs = process.mainModule.require('node:fs')
  if (process.pid !== config.pid || fs.realpathSync.native(electron.app.getPath('userData')) !== config.profile) throw Error('Community fixture requires the exact owned disposable process/profile')
  const window = electron.BrowserWindow.fromId(config.windowId)
  if (!window || window.webContents.id !== config.webContentsId || globalThis.__qaCommunity116) throw Error('Community fixture window identity mismatch or duplicate fixture')
  const channels = ['versions:manifest', 'community:search', 'community:files', 'community:project', 'mods:targets', 'mods:prepare', 'mods:commit', 'mods:discard']
  const originals = new Map(channels.map(channel => [channel, electron.ipcMain._invokeHandlers.get(channel)]))
  if ([...originals.values()].some(handler => typeof handler !== 'function')) throw Error('Required original community IPC handler missing')
  const state = { records: [], prepareFailure: false, plans: new Set(), next: 0 }
  const respond = (channel, callback) => {
    electron.ipcMain.removeHandler(channel)
    electron.ipcMain.handle(channel, async (event, ...args) => {
      if (event.sender.id !== config.webContentsId) throw Error('Community fixture rejects other renderer ownership')
      const record = { channel, args, startedAt: Date.now() }; state.records.push(record)
      try { const value = await callback(...args); record.completedAt = Date.now(); return value }
      catch (error) { record.error = error.message; record.completedAt = Date.now(); throw error }
    })
  }
  respond('versions:manifest', () => ['26.3','26.2','1.21.11','1.21.1','1.20.1'].map(id=>({id,type:'release',url:'https://example.invalid/'+id+'.json',releaseTime:'2026-10-06T00:00:00Z',time:'2026-10-06T00:00:00Z'})))
  respond('community:search', q => {
    const count = 55, items = Array.from({ length: Math.min(q.limit, Math.max(0, count - q.offset)) }, (_, index) => ({ source: 'modrinth', projectId: 'community116-' + (q.offset + index), slug: 'fixture-' + (q.offset + index), title: `GeckoLib 公开合成资源 ${q.keyword} ${q.offset + index}`, originalTitle: 'Synthetic source metadata', description: '用于下拉遮挡与返回搜索验收，不是真实平台项目。', downloads: 100, author: 'KAMUCL QA' }))
    return { items, total: count, offset: q.offset, limit: q.limit }
  })
  respond('mods:targets', () => ({ versions: [config.target], errors: [] }))
  respond('community:files', (_source, projectId) => [{ source: 'modrinth', projectId, fileId: 'community116-file', fileName: 'community116-root.jar', version: '1.0.0', gameVersions: [config.target.mcVersion], loaders: [config.target.loader], url: 'https://example.invalid/community116-root.jar', size: 1024, date: '2026-10-06T00:00:00Z', releaseType: 'release' }])
  respond('community:project', (source, projectId) => ({ source, projectId, slug: 'synthetic-dependency', title: '已关联的必要前置（合成）', description: '此处使用原详情组件显示已关联的来源和项目 ID；没有联系真实服务。', categories: [], webpage: 'https://modrinth.com/project/' + projectId }))
  respond('mods:prepare', target => {
    if (state.prepareFailure) { state.prepareFailure = false; throw Error('合成：前置项目查询失败，请重试') }
    const id = 'community116-plan-' + ++state.next; state.plans.add(id)
    return { id, target: config.target, missing: ['fixture_library >=1.0.0'], warnings: [], files: [{ name: 'root', fileName: 'community116-root.jar', version: '1.0.0', dependency: false }, { name: 'fixture_library', fileName: 'community116-library.jar', version: '1.0.0', dependency: true, source: 'modrinth', projectId: 'fixture-library' }] }
  })
  respond('mods:discard', id => { state.plans.delete(id) })
  respond('mods:commit', (id, dependencies) => { if (!state.plans.delete(id) || dependencies !== true) throw Error('Synthetic commit requires an accepted current plan and explicit dependency consent'); return '合成界面确认成功；未下载或写入任何文件' })
  globalThis.__qaCommunity116 = { failNextPrepare() { state.prepareFailure = true }, inspect() { return { records: state.records, plans: [...state.plans] } }, restore() {
    // Electron 44 wraps callbacks when handle() registers them. Re-registering
    // the saved internal listener would wrap it a second time and is not exact
    // restoration; these owned disposable channels restore their original Map
    // entries directly, after removing only the fixture entry.
    for (const [channel, original] of originals) { electron.ipcMain.removeHandler(channel); electron.ipcMain._invokeHandlers.set(channel, original) }
    const result = { complete: channels.every(channel => electron.ipcMain._invokeHandlers.get(channel) === originals.get(channel)), records: state.records, classification: 'Synthetic source and install-plan UI responses only; original IPC identity restored; no real download or disk commit' }
    delete globalThis.__qaCommunity116; return result
  } }
  return { channels, target: config.target, classification: 'Owned-profile-only synthetic metadata and plan fixture; original production renderer, selectors and inputs are unchanged' }
}
function readCommunityState() {
  const page = document.querySelector('.community-page'), content = page?.closest('.content')
  const input = page?.querySelector('[data-ui="CommunityView:bc0450fd9c8f"]')
  return { present: !!page, keyword: input?.value, version: page?.querySelector('[aria-label="Minecraft 版本"]')?.value, scrollTop: content?.scrollTop ?? 0, results: [...(page?.querySelectorAll('.result-title') ?? [])].map(row => row.textContent), busy: !!page?.querySelector('.result-list[aria-busy="true"]'), selectedSource: page?.querySelector('[aria-label="资源来源"]')?.textContent.trim(), selectedLoader: page?.querySelector('[aria-label="加载器"]')?.textContent.trim() }
}
async function runCommunityChecks(h) {
  const { evaluate, main, click, nav, call, wait, screenshot } = h
  const proof = { complete: false, operations: [], screenshots: [], classification: 'Actual packaged renderer coordinates/keyboard/route history with owned synthetic metadata; does not qualify real provider services or backend installation' }
  const until = async (label, expression, predicate) => {
    const row = { label, startedAt: Date.now(), samples: [] }; proof.operations.push(row)
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) { const value = await evaluate(expression); row.samples.push({ at: Date.now(), value }); if (predicate(value)) { row.complete = true; return value }; await wait(80) }
    throw Error(label + ' did not reach the required actual state')
  }
  const key = async (key, code, vk, modifiers = 0) => { for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, modifiers }) }
  const text = async (selector, value) => { await click(selector); await key('a', 'KeyA', 65, process.platform === 'darwin' ? 4 : 2); await call('Input.insertText', { text: value }) }
  const shot = async name => { const result = await screenshot('community116-' + name); proof.screenshots.push({ name, result, classification: 'Original Page screenshot; native capture must be recorded separately by the owning driver' }) }
  const version = '[aria-label="Minecraft 版本"]', keyword = '[data-ui="CommunityView:bc0450fd9c8f"]'
  await nav('community')
  await until('community actual result ready', `(${readCommunityState})()`, state => state.present && state.results.length >= 20 && !state.busy)
  await click('[data-ui="community:versions-custom"]')
  await until('explicit custom-version mode exposes the production version input', "document.querySelector('[data-ui=\"community:versions-custom\"]')?.getAttribute('aria-pressed')==='true'&&!!document.querySelector('[aria-label=\"Minecraft 版本\"]')", Boolean)
  await text(keyword, '中文搜索保持116'); await key('Enter', 'Enter', 13)
  await until('searched original keyword', `(${readCommunityState})()`, state => state.keyword === '中文搜索保持116' && state.results.some(row => row.includes('中文搜索保持116')) && !state.busy)
  await text(version, '')
  await until('version popup escaped its card', `(()=>{const menu=document.querySelector('#community-version-options'),row=menu?.querySelector('button'),r=row?.getBoundingClientRect();return{open:!!menu,parent:menu?.parentElement===document.body,position:menu&&getComputedStyle(menu).position,z:menu&&getComputedStyle(menu).zIndex,hit:r&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('#community-version-options')===menu,rect:r&&{top:r.top,bottom:r.bottom},height:innerHeight}})()`, state => state.open && state.parent && state.position === 'fixed' && state.hit && state.rect.top >= 0 && state.rect.bottom <= state.height)
  await shot('version-popup-uncovered')
  await key('ArrowDown', 'ArrowDown', 40); await key('Enter', 'Enter', 13)
  const selected = await until('keyboard version chosen', `(${readCommunityState})()`, state => !!state.version && !state.busy)
  assert.equal(await evaluate("!!document.querySelector('#community-version-options')"), false)
  await text(version, '1.20.1'); await key('Enter', 'Enter', 13)
  await until('typed Enter keeps custom version, never all-versions default', `(${readCommunityState})()`, state => state.version === '1.20.1' && !state.busy)
  await click(version); await key('Escape', 'Escape', 27)
  assert.equal(await evaluate("!!document.querySelector('#community-version-options')"), false)
  await click(version)
  const content = await evaluate("(()=>{const r=document.querySelector('.content').getBoundingClientRect();return{x:r.right-30,y:r.top+r.height*.7}})()")
  await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: content.x, y: content.y, deltaX: 0, deltaY: 320 })
  await until('scroll closes stale version popup', "!!document.querySelector('#community-version-options')", value => !value)
  await until('actual history scroll settled', `(${readCommunityState})()`, state => state.scrollTop > 0 && !state.busy)
  await wait(400)
  const before = await evaluate(`(${readCommunityState})()`)
  const queriesBefore = await main("__qaCommunity116.inspect().records.filter(row=>row.channel==='community:search').length")
  await nav('mods'); await nav('community')
  const restored = await until('return retains same condition and result rows', `(${readCommunityState})()`, state => state.keyword === before.keyword && state.version === before.version && state.results.join('\n') === before.results.join('\n') && Math.abs(state.scrollTop - before.scrollTop) <= 2 && !state.busy)
  const queriesAfter = await main("__qaCommunity116.inspect().records.filter(row=>row.channel==='community:search').length")
  assert.equal(queriesAfter, queriesBefore, 'route return must not silently rerun search')
  proof.history = { before, restored, queriesBefore, queriesAfter }; proof.keyboardVersion = selected.version
  await shot('route-history-retained')
  await click('.result-card .result-dl')
  await until('resource file loaded', "!!document.querySelector('.download-modal .file-list button.active')", Boolean)
  await click('[data-ui="CommunityView:cade5c4fc83a"]')
  await until('detected and selected missing dependency', "(()=>{const p=document.querySelector('.modinstall-modal');return{rows:p?.querySelectorAll('.dependency-row').length,checked:p?.querySelector('input[type=checkbox]')?.checked,busy:!!p?.querySelector('.modal-loading')}})()", state => state.rows === 2 && state.checked && !state.busy)
  await shot('necessary-dependency-default-selected')
  await click('.dependency-choice input')
  assert(await evaluate("document.querySelector('.modinstall-modal .btn-gold')?.disabled && document.querySelector('.modinstall-modal').textContent.includes('暂不写入')"))
  assert.equal(await main("__qaCommunity116.inspect().records.filter(row=>row.channel==='mods:commit').length"), 0)
  await shot('opt-out-honest-block')
  await click('.dependency-row .btn')
  await until('associated project details shown', "document.querySelector('.community-project-modal')?.textContent", value => value?.includes('fixture-library'))
  assert.equal(await evaluate("!!document.querySelector('.community-project-modal .project-download')"), false)
  await shot('dependency-associated-project')
  await click('.community-project-modal [data-modal-dismiss]')
  await main('__qaCommunity116.failNextPrepare()')
  await click('.modinstall-modal .modal-actions .btn:nth-child(2)')
  await until('query failure remains an explicit failure', "document.querySelector('.modinstall-modal')?.textContent", value => value?.includes('前置项目查询失败') && value?.includes('重试检测'))
  assert.equal(await evaluate("!!document.querySelector('.modinstall-modal .btn-gold')"), false)
  await shot('dependency-query-failure')
  await click('.modinstall-modal .modal-actions .btn:nth-child(2)')
  await until('whole retry restores dependency choice', "document.querySelector('.dependency-choice input')?.checked", Boolean)
  await click('.modinstall-modal .btn-gold')
  await until('accepted dependency consent reaches plan commit', "!!document.querySelector('.modinstall-modal')", value => !value)
  const ledger = await main('__qaCommunity116.inspect()')
  const commits = ledger.records.filter(row => row.channel === 'mods:commit')
  assert.equal(commits.length, 1); assert.equal(commits[0].args[1], true)
  proof.ledger = ledger; proof.complete = true; return proof
}
module.exports = { installCommunityFixture, readCommunityState, runCommunityChecks }
