// Real production renderer, isolated IPC fixtures: no accounts, games or downloads are touched.
// Run after build: node_modules/electron/dist/electron.exe scripts/verify-design-ui.cjs
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { app, BrowserWindow, ipcMain, session } = require('electron')
const { buildSync } = require('esbuild')
const root = fs.mkdtempSync(path.resolve('out/design-ui-'))
app.setPath('userData', path.join(root, 'userData'))
app.commandLine.appendSwitch('enable-unsafe-swiftshader')
buildSync({ entryPoints: ['src/shared/types.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(root, 'types.cjs') })
const types = require(path.join(root, 'types.cjs'))
buildSync({ entryPoints: ['src/main/core/defaultGameOptions.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(root, 'gameOptions.cjs') })
const gameOptions = require(path.join(root, 'gameOptions.cjs'))
buildSync({ entryPoints: ['src/main/core/exitJournal.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(root, 'exitJournal.cjs') })
const journal = new (require(path.join(root, 'exitJournal.cjs')).ExitJournal)(path.join(root, 'exit-history.json'))
journal.fault('launcher', '上次启动器未正常关闭，已保留异常退出记录。')
journal.fault('game', '游戏「测试实例」异常退出（代码 -1）。')
const folder = 'C:/Design fixture/.minecraft'
const versions = ['26.2-Fabric 0.19.5', '1.21.11-NeoForge Adventures', '1.21.10-Forge Survival', '26.2 Creative'].map((name, i) => ({ id: name, name, mcVersion: i === 1 ? '1.21.11' : '26.2', loader: i === 3 ? undefined : 'fabric', loaderVersion: '0.19.5', folder, isolated: true, modpackName: i === 3 ? 'Creative 整合包' : undefined }))
let settings = { gameDir: folder, activeFolder: folder, folders: [{ path: folder, name: '我的游戏', isDefault: true }], javaPath: '', javaAuto: true, javaCustom: [], javaHidden: [], memoryMB: 4096, memoryAuto: true, jvmArgs: '', resolution: { width: 854, height: 480, mode: 'windowed' }, mirror: 'bmclapi', theme: 'blue-white', custom: types.DEFAULT_CUSTOM_THEME, disabledFeatures: [], favoriteVersions: [], homeLayout: types.DEFAULT_HOME_LAYOUT, background: types.DEFAULT_BACKGROUND, launchThumbnail: types.DEFAULT_LAUNCH_THUMBNAIL, configVersion: 1 }
const account = { id: 'fixture', type: 'offline', username: 'KaMuaMua', uuid: '00000000000000000000000000000000' }
const calls = [], errors = []
const updateRelease = { version:'1.0.46', tag:'v1.0.46', publishedAt:'2026-09-10T14:04:00Z', assetSize:67616046, body:'KAMUCL v1.0.46\n\n- 修复：皮肤重命名后恢复默认名称的问题\n- 优化：默认配置的分组、数值输入和同步状态', assetUrl:'https://example.invalid/test.exe' }
ipcMain.handle('design:invoke', (_event, channel, ...args) => {
  calls.push(channel)
  switch (channel) {
    case 'update:check': return {ok:true,hasUpdate:true,release:updateRelease}
    case 'update:start': return {taskId:'fixture-update'}
    case 'update:pickLocalFile': return {fileName:'KAMUCL-1.0.46.exe',fileSize:67616046,version:'1.0.46',versionOk:true,sha256:'match'}
    case 'update:listReleases': return Array.from({length:18},(_,i)=>({...updateRelease,version:'1.0.'+(43-i),body:'KAMUCL v1.0.'+(43-i)+'\n\n- 改善下载体验，修复界面显示问题'}))
    case 'gameOptions:get': return gameOptions.getDefaultGameOptions()
    case 'gameOptions:set': return gameOptions.setDefaultGameOptions(args[0])
    case 'exitHistory:list': return journal.list()
    case 'exitHistory:ack': return journal.acknowledge()
    case 'exitHistory:clear': return journal.clearHistory()
    case 'settings:get': return settings
    case 'settings:set': return settings = { ...settings, ...args[0] }
    case 'accounts:list': return [account]
    case 'accounts:selected': return account
    case 'versions:installed': return versions
    case 'versions:manifest': return [{ id: '26.2', type: 'release', releaseTime: '2026-09-10' }]
    case 'folders:list': return { folders: settings.folders, active: folder }
    case 'folders:scan': return { folder: settings.folders[0], structure: 'minecraft', status: 'ready', versions, errors: [], durationMs: 12, scannedAt: '2026-09-10' }
    case 'mods:targets': return { versions, errors: [] }
    case 'skin:profile': return { skins: [], capes: [] }
    case 'skin:avatar': return null
    case 'update:getPending':
    case 'update:getState': return null
    case 'app:systemInfo': return { totalMemoryMB: 32768, freeMemoryMB: 16384, platform: 'win32' }
    case 'community:search': return { total: 44, offset: args[0].offset, limit: 20, items: Array.from({ length: 20 }, (_, i) => ({ projectId: String(i), source: i % 2 ? 'curseforge' : 'modrinth', slug: 'fixture', title: ['Sodium', 'Fresh Animations', 'Complementary Shaders', '高清材质与自然光影'][i % 4], author: 'Minecraft Community', description: '更流畅的冒险，更细腻的世界。支持当前游戏版本，轻松管理你的个性化体验。', downloads: 1250000, updatedAt: '2026-09-10', categories: [], iconUrl: '' })) }
    case 'community:files': return [{ fileId: 'fixture', fileName: 'example.jar', version: '1.0', gameVersions: ['26.2'], loaders: ['fabric'], date: '2026-09-10', size: 1024 }]
    default: return []
  }
})
fs.writeFileSync(path.join(root, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('kamucl',{invoke:(c,...a)=>ipcRenderer.invoke('design:invoke',c,...a),on:(c,fn)=>{const h=(_,p)=>fn(p);ipcRenderer.on(c,h);return ()=>ipcRenderer.removeListener(c,h)},send:()=>{},getFilePath:()=>'',platform:'win32'});`)
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_d, cb) => cb({ cancel: true }))
  const win = new BrowserWindow({ show: false, width: 1440, height: 960, backgroundColor: '#edf0f7', webPreferences: { preload: path.join(root, 'preload.cjs'), backgroundThrottling: false, offscreen: true } })
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message) })
  const run = code => win.webContents.executeJavaScript(code), wait = ms => new Promise(r => setTimeout(r, ms))
  const shot = async name => {
    await wait(450)
    const overflow = await run(`(()=>{const e=document.querySelector('.content');return {width:e.clientWidth,scroll:e.scrollWidth}})()`)
    assert(overflow.scroll <= overflow.width + 1, name + ': ' + JSON.stringify(overflow))
    fs.writeFileSync(path.join(root, name + '.png'), (await win.webContents.capturePage()).toPNG())
  }
  const navigate = async key => { await run(`document.querySelector('[data-nav="${key}"]').click()`); await wait(600) }
  const updateDialogs = async theme => {
    await navigate('settings')
    await run(`document.querySelector('.content').style.background='repeating-linear-gradient(35deg,#faa 0px,#faa 40px,#bde 40px,#bde 80px)'; const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='检查更新'); b.scrollIntoView({block:'center'}); b.click()`); await wait(300)
    const check = await run(`(()=>{const panel=document.querySelector('.update-dialog'),backdrop=panel.parentElement,r=panel.getBoundingClientRect(),f=panel.querySelector('footer').getBoundingClientRect();return {color:getComputedStyle(panel).backgroundColor,mask:getComputedStyle(backdrop).backgroundColor,portal:backdrop.parentElement===document.body,modal:panel.getAttribute('aria-modal'),inside:r.top>=0&&r.bottom<=innerHeight,footer:f.bottom<=innerHeight,repeat:[...document.querySelectorAll('.toast')].some(e=>e.textContent.includes('发现新版本'))}})()`)
    assert(check.portal && check.modal==='true' && check.inside && check.footer,JSON.stringify(check))
    assert(!check.color.includes('rgba') && check.color!=='transparent', 'Dialog must have a solid surface: '+check.color)
    assert.notEqual(check.mask,'rgba(0, 0, 0, 0)'); assert.equal(check.repeat,false)
    assert.equal(await run(`document.querySelector('.upd-help').open`),false)
    await shot('update-'+theme)
    assert(await run(`(()=>{const p=document.querySelector('.update-dialog'),buttons=p.querySelectorAll('button');buttons[buttons.length-1].focus();buttons[buttons.length-1].dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));return document.activeElement===buttons[0]})()`),'Tab wraps inside the dialog')
    await run(`document.querySelector('.update-dialog').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await wait(100)
    assert.equal(await run(`document.querySelectorAll('.update-dialog').length`),0)
    await run(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('版本回退')).click()`); await wait(250)
    assert.equal(await run(`document.querySelectorAll('.upd-release-item').length`),18)
    assert.equal(await run(`document.querySelector('.upd-release-summary').textContent`),'改善下载体验，修复界面显示问题')
    await run(`document.querySelectorAll('.upd-release-item')[1].click()`)
    assert.equal(await run(`document.querySelector('.upd-modal-actions .btn-gold').disabled`),false)
    const scroll = await run(`(()=>{const c=document.querySelector('.update-dialog-content'),f=document.querySelector('.update-dialog-footer').getBoundingClientRect();return {scroll:c.scrollHeight>c.clientHeight,footer:f.bottom<=innerHeight}})()`)
    assert(scroll.scroll && scroll.footer,JSON.stringify(scroll))
    await shot('rollback-'+theme)
    await run(`document.querySelector('.upd-modal-actions .btn-ghost').click()`)
    if(theme==='blue-white-compact') {
      const original=updateRelease.body
      updateRelease.body=Array.from({length:30},(_,i)=>'- 更新项目 '+(i+1)+'：检查长更新说明在小窗口下的滚动与底部按钮').join('\n')
      await run(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='检查更新').click()`);await wait(200)
      assert(await run(`(()=>{const c=document.querySelector('.update-dialog-content');return c.scrollHeight>c.clientHeight})()`))
      await shot('update-long-compact')
      await run(`document.querySelector('.upd-actions .btn-gold').click()`);await wait(200)
      win.webContents.send('event:updateSlowHint',{taskId:'fixture-update'});await wait(100)
      assert(await run(`document.querySelector('.upd-help').open`))
      await shot('update-downloading')
      win.webContents.send('event:taskDone',{taskId:'fixture-update',ok:true});await wait(150)
      assert(await run(`document.querySelector('.upd-title').textContent.includes('准备安装')`))
      await shot('update-ready')
      await run(`document.querySelector('.update-dialog').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
      updateRelease.body=original
      await run(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('从本地文件安装更新')).click()`);await wait(150)
      await shot('update-local')
      assert.equal(await run(`document.querySelector('.update-dialog').getAttribute('aria-label')`),'安装本地更新包')
      await run(`document.querySelector('.upd-modal-actions .btn-ghost').click()`)
    }
    await run(`document.querySelector('.content').style.background=''`)
  }
  await win.loadFile(path.resolve('out/renderer/index.html')); await wait(1800)
  assert(await run(`!!document.querySelector('.bell-dot')`), 'Previous abnormal exits have an unread indicator')
  await run(`document.querySelector('[title="通知"]').click()`); await wait(200)
  assert.equal(await run(`document.querySelectorAll('.notice-item').length`), 2)
  assert(journal.list().every(entry => entry.seen), 'Opening notification center persists acknowledgement')
  await shot('previous-exits')
  await win.reload(); await wait(1200)
  assert.equal(await run(`!!document.querySelector('.bell-dot')`), false)
  await run(`document.querySelector('[title="通知"]').click()`); await wait(200)
  assert.equal(await run(`document.querySelectorAll('.notice-item').length`), 2, 'History survives renderer reload')
  await run(`document.querySelector('.notice-panel button').click()`); await wait(150)
  assert.equal(journal.list().length, 0, 'Clear removes persisted history')
  await run(`document.querySelector('[title="通知"]').click()`)
  const hover = async key => {
    const point = await run(`(()=>{const r=document.querySelector('[data-nav="${key}"]').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`)
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point })
  }
  const bubble = () => run(`(()=>{const b=document.querySelector('.nav-bubble').getBoundingClientRect();return {top:b.top,height:b.height}})()`)
  const itemTop = key => run(`document.querySelector('[data-nav="${key}"]').getBoundingClientRect().top`)
  await hover('home'); await wait(350)
  const start = await itemTop('home'), end = await itemTop('game')
  await hover('game'); await wait(50)
  const mid = await bubble()
  assert(mid.top > start && mid.top < end, 'Shared bubble must interpolate rather than jump')
  await hover('skins'); await wait(35); await hover('settings'); await wait(350)
  assert(Math.abs((await bubble()).top - await itemTop('settings')) < 1, 'Rapid hover settles at the latest item')
  assert.equal(await run(`document.querySelector('[aria-current="page"]').dataset.nav`), 'home')
  await shot('navigation-hover')
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 500, y: 200 }); await wait(350)
  assert(Math.abs((await bubble()).top - start) < 1, 'Pointer exit returns bubble to selected page')
  await shot('home-wide')
  await navigate('game'); await run(`document.querySelectorAll('.game-tab')[1].click()`); await shot('versions-wide')
  assert(await run(`Array.from(document.querySelectorAll('.installed-row')).every(row => {
    const tags = Array.from(row.querySelectorAll('.tag')).filter(tag => tag.textContent.trim() === '已隔离');
    return row.querySelector('.iso-switch') ? tags.length === 0 : tags.length === 1;
  })`), 'Isolation status is shown once, including modpacks without a toggle')
  await navigate('community'); await shot('community-wide')
  await run(`document.querySelector('.result-dl').click()`); await shot('download-dialog')
  await run(`document.querySelector('.modal-actions button').click()`)
  win.setSize(1024, 760); await navigate('home'); await shot('home-compact')
  await navigate('game'); await run(`document.querySelectorAll('.game-tab')[1].click()`); await shot('versions-compact')
  await navigate('community'); await shot('community-compact')
  await navigate('keys'); await shot('defaults-compact')
  await run(`const input=document.querySelector('[aria-label="视场角数值"]'); input.value='91'; input.dispatchEvent(new Event('change',{bubbles:true}));`); await wait(150)
  assert.equal(gameOptions.getDefaultGameOptions().values.fov, 91)
  await shot('defaults-edited')
  await navigate('home'); await navigate('keys')
  assert.equal(await run(`document.querySelector('[aria-label="视场角数值"]').value`), '91')
  await navigate('community')
  const overflow = await run(`(()=>{const e=document.querySelector('.content');return {width:e.clientWidth,scroll:e.scrollWidth}})()`)
  assert(overflow.scroll <= overflow.width + 1, JSON.stringify(overflow))
  if (!process.argv.includes('--baseline')) {
    await run(`document.querySelector('[data-nav="game"]').dispatchEvent(new MouseEvent('mouseenter'));`)
    assert.equal(await run(`document.querySelector('[aria-current="page"]').dataset.nav`), 'community')
    await navigate('home')
    await run(`document.querySelector('.nav-parent').click()`); await wait(400)
    await hover('mods'); await wait(350)
    assert(Math.abs((await bubble()).top - await itemTop('mods')) < 1, 'Nested item uses nav-relative geometry')
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 500, y: 200 }); await wait(350)
    // Offscreen windows have no native focus; emulate it without stealing the user's window.
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    await run(`document.querySelector('[data-nav="shaders"]').focus(); document.querySelector('.nav').scrollTop = 40`); await wait(350)
    const focusGeometry = { bubble: await bubble(), target: await itemTop('shaders'), state: await run(`({active:document.activeElement?.dataset.nav,scroll:document.querySelector('.nav').scrollTop,style:document.querySelector('.nav-bubble').getAttribute('style')})`) }
    assert(Math.abs(focusGeometry.bubble.top - focusGeometry.target) < 1, 'Keyboard focus and scrolling retain bubble alignment: ' + JSON.stringify(focusGeometry))
    win.webContents.debugger.detach()
    await run(`document.querySelector('.nav-parent').click()`); await wait(400)
    assert(await run(`document.querySelector('.nav-sub').inert`), 'Collapsed navigation must not receive keyboard focus')
    await win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await navigate('community')
    assert.equal(await run(`getComputedStyle(document.querySelector('.result-card')).animationDuration`), '1e-05s')
    assert(parseFloat(await run(`getComputedStyle(document.querySelector('.nav-bubble')).transitionDuration`)) < 0.001)
    win.webContents.debugger.detach()
    await navigate('settings'); await shot('settings-compact')
    await updateDialogs('blue-white-compact')
    for (const theme of ['black-orange', 'white-pink', 'black-pink', 'transparent']) {
      settings.theme = theme
      win.setSize(1440, 960)
      win.setBackgroundColor(types.THEME_PRESETS[theme].colors.bg)
      await win.reload(); await wait(900)
      await navigate('community'); await shot('community-' + theme)
      if(theme==='white-pink'||theme==='black-orange'||theme==='transparent') await updateDialogs(theme)
    }
  }
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({ overflow, errors, calls: [...new Set(calls)] }, null, 2))
  assert.deepEqual(errors, [])
  console.log('PASS production design UI: ' + root)
  win.destroy(); app.quit()
}).catch(e => { console.error(e); fs.writeFileSync(path.join(root, 'error.txt'), e.stack); app.exit(1) })
