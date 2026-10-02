// Run through verify-compact-windows-ui.cjs to test a copy of the final runtime.
// A packaged executable with resources/app.asar ignores the script argument.
// All settings, games, log output and windows belong to the test.
const { app, session } = require('electron')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict'), { createRequire } = require('node:module')
const { Worker } = require('node:worker_threads')
const archive = path.resolve(process.argv[2] || 'release/win-unpacked/resources/app.asar')
const packedRequire = createRequire(path.join(archive, 'package.json'))
const version = packedRequire('./package.json').version
const compact = !fs.existsSync(path.join(path.dirname(process.execPath), 'dxcompiler.dll'))
const mode = process.env.KAMUCL_TEST_SOFTWARE === '1' ? 'software' : 'hardware'
if (mode === 'software') {
  app.commandLine.appendSwitch('use-angle', 'swiftshader')
  app.commandLine.appendSwitch('enable-unsafe-swiftshader')
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL packaged UI '))
const games = path.join(root, 'games'); fs.mkdirSync(games)
app.setPath('userData', root)
app.setPath('appData', root)
fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ theme: 'transparent', autoUpdate: false,
  gameDir: games, activeFolder: games, folders: [{ path: games, isDefault: true }], startupAnimation: false }))
const report = { version, root, electron: process.versions.electron, compact, mode }
const wait = ms => new Promise(r => setTimeout(r, ms))
const deadline = setTimeout(() => { console.error('Packaged UI timed out', root); app.exit(2) }, 45000)
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => callback({ cancel: true }))
})
app.on('browser-window-created', (_event, window) => {
  window.show = () => {}; window.showInactive = () => {}
  if (window.getTitle() !== 'KAMUCL') return
  window.webContents.once('did-finish-load', async () => {
    try {
      let ui
      for (let i = 0; i < 100; i++) {
        ui = await window.webContents.executeJavaScript(`(()=>{const canvas=document.querySelector('.viewer3d canvas'),gl=canvas?.getContext('webgl2');return {text:document.body.innerText,images:[...document.images].filter(i=>i.src&&!i.src.startsWith('http')).map(i=>({src:i.src,ok:i.complete&&i.naturalWidth>0})),skin:gl&&!gl.isContextLost(),platform:document.documentElement.dataset.platform}})()`)
        if (ui.text.includes(version) && ui.text.includes('首页') && ui.skin) break
        await wait(200)
      }
      assert(ui.text.includes(version) && ui.text.includes('首页'), 'Main UI/version missing')
      assert(ui.skin, 'Packaged WebGL skin preview unavailable')
      assert.equal(ui.platform, 'win32')
      assert(ui.images.every(i => i.ok), 'Local image failed to load')
      const settings = await window.webContents.executeJavaScript("window.kamucl.invoke('settings:get')")
      assert.equal(settings.gameDir, games, 'IPC used another profile')
      const koffi = packedRequire('koffi')
      assert.equal(koffi.load('kernel32.dll').func('uint32_t __stdcall GetCurrentProcessId()')(), process.pid)
      assert.equal(typeof packedRequire('undici').fetch, 'function')
      const Zip = packedRequire('adm-zip'), zip = new Zip()
      zip.addFile('fabric.mod.json', Buffer.from('{"id":"package_test","name":"Package test","version":"1"}'))
      const mods = path.join(root, 'mods'); fs.mkdirSync(mods); zip.writeZip(path.join(mods, 'test.jar'))
      const scan = await new Promise((resolve, reject) => {
        const worker = new Worker(path.join(archive, 'out/main/modScanWorker.cjs'), { workerData: { dir: mods, hash: true } })
        worker.once('message', message => { worker.terminate(); resolve(message) }); worker.once('error', reject)
      })
      assert(!scan.error, scan.error); assert.equal(scan.result[0].id, 'package_test'); assert.equal(scan.result[0].sha1.length, 40)
      report.ui = { skin: ui.skin, localImages: ui.images.length, ipc: true, nativeModule: true, worker: true }
      report.gpu = app.getGPUFeatureStatus()
      report.renderer = await window.webContents.executeJavaScript(`(()=>{const gl=document.querySelector('.viewer3d canvas').getContext('webgl2');return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)})()`)
      assert.equal(/swiftshader|software/i.test(report.renderer), mode === 'software', 'Wrong WebGL backend')
      if (compact) {
        assert(app.commandLine.getSwitchValue('disable-features').split(',').includes('WebGPUService'))
        assert(app.commandLine.hasSwitch('disable-skia-graphite'))
        assert.notEqual(report.gpu.webgpu, 'enabled', 'Compact runtime must not advertise enabled WebGPU')
        assert.equal(await window.webContents.executeJavaScript('navigator.gpu ? navigator.gpu.requestAdapter().then(a => a === null) : true'), true, 'DXC-dependent WebGPU adapter available')
      }
      if (mode === 'hardware') assert.equal(report.gpu.gpu_compositing, 'enabled', 'GPU compositing disabled')
      fs.writeFileSync(path.join(root, 'main.png'), (await window.webContents.capturePage()).toPNG())
      fs.writeFileSync(`out/windows-ui-${version}-${mode}.json`, JSON.stringify(report, null, 2))
      console.log('PASS packaged Windows UI', JSON.stringify(report)); clearTimeout(deadline); app.exit(0)
    } catch (error) { console.error(error); clearTimeout(deadline); app.exit(1) }
  })
})
packedRequire('./out/main/index.js')
