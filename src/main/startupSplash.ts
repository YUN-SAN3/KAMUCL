import { BrowserWindow, ipcMain, screen, dialog } from 'electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { BOOT_STAGES, StartupGate, type BootStage } from '../shared/startup'
import { launcherLog } from './core/launcherLog'
import { awaitNativeStartup, createNativeStartup, showStartupWindow } from './nativeStartup'

/** Startup-only window coordination. This does not own or terminate Minecraft processes. */
export async function createStartupSplash() {
  const signal = process.env.KAMUCL_BOOT_SIGNAL
  if (signal) {
    const pid = await awaitNativeStartup(signal)
    if (pid) return createNativeStartup(signal, pid)
    try { writeFileSync(signal, 'fallback') } catch {}
  }
  return createElectronStartupSplash()
}

function createElectronStartupSplash() {
  const gate = new StartupGate()
  const bounds = screen.getPrimaryDisplay().bounds
  let main: BrowserWindow | null = null
  let splash: BrowserWindow | null = new BrowserWindow({
    ...bounds, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    hasShadow: false, thickFrame: false, resizable: false, movable: false, focusable: false,
    skipTaskbar: true, alwaysOnTop: true, title: 'KAMUCL · 正在启动',
    webPreferences: { preload: join(__dirname, '../preload/splash.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  })
  splash.setIgnoreMouseEvents(true)
  splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  let revealed = false, disposed = false, fallback = false
  const listeners: Array<[string, (event: Electron.IpcMainEvent, ...args: any[]) => void]> = []
  const listen = (channel: string, fn: (event: Electron.IpcMainEvent, ...args: any[]) => void) => { listeners.push([channel, fn]); ipcMain.on(channel, fn) }
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const [channel, listener] of listeners) ipcMain.removeListener(channel, listener)
    if (splash && !splash.isDestroyed()) splash.destroy()
    splash = null
  }
  const publish = () => { if (splash && !splash.isDestroyed()) splash.webContents.send('boot:state', gate.state) }
  const reveal = () => {
    if (revealed || !main || main.isDestroyed() || !gate.state.ready || !(gate.assembled || fallback)) return
    revealed = true
    showStartupWindow(main)
    launcherLog('Startup: main window revealed after renderer + compositor + avatar ready')
    if (splash && !splash.isDestroyed()) {
      splash.webContents.send('boot:reveal')
      // Only an overlay cleanup watchdog, never a timer that pretends initialization completed.
      const cleanup = setTimeout(dispose, 1500)
      cleanup.unref()
    } else dispose()
  }
  const animationFailure = (message: string) => {
    launcherLog(`Startup animation fallback: ${message}`)
    fallback = true
    if (splash && !splash.isDestroyed()) splash.destroy()
    splash = null
    reveal()
  }
  listen('boot:splash-ready', event => {
    if (event.sender !== splash?.webContents) return
    splash.showInactive()
    splash.setAlwaysOnTop(true, 'floating')
    splash.moveTop()
    publish()
    launcherLog('Startup: desktop pixels visible')
  })
  listen('boot:stage', (event, stage: BootStage) => {
    if (event.sender !== main?.webContents || !BOOT_STAGES.includes(stage)) return
    gate.completed.add(stage); publish()
    launcherLog(`Startup: ${stage} complete`)
  })
  listen('boot:renderer-ready', event => {
    if (event.sender !== main?.webContents) return
    gate.rendererReady = true; publish(); reveal()
    launcherLog('Startup: renderer resources settled')
  })
  listen('boot:assembled', event => {
    if (event.sender !== splash?.webContents || !gate.state.ready) return
    gate.assembled = true; reveal()
  })
  listen('boot:finished', event => { if (event.sender === splash?.webContents && revealed) dispose() })
  listen('boot:splash-failed', event => { if (event.sender === splash?.webContents) animationFailure('renderer failed') })
  splash.webContents.on('render-process-gone', () => animationFailure('renderer process exited'))
  const load = process.env.ELECTRON_RENDERER_URL
    ? splash.loadURL(new URL('splash.html', process.env.ELECTRON_RENDERER_URL).toString())
    : splash.loadFile(join(__dirname, '../renderer/splash.html'))
  void load.catch(error => animationFailure(String(error)))
  return {
    attach(window: BrowserWindow) {
      main = window
      window.once('ready-to-show', () => { gate.painted = true; publish(); reveal() })
      window.once('closed', dispose)
      window.webContents.once('render-process-gone', (_event, details) => {
        if (revealed) return
        dispose()
        void dialog.showMessageBox({ type: 'error', title: 'KAMUCL 初始化失败', message: `主界面进程退出：${details.reason}。请重新启动并查看启动器日志。` })
        window.close()
      })
      window.webContents.once('did-fail-load', (_event, code, description, _url, isMainFrame) => {
        if (!isMainFrame || code === -3 || revealed) return
        dispose()
        void dialog.showMessageBox({ type: 'error', title: 'KAMUCL 初始化失败', message: `无法加载主界面（${code}）：${description}` })
        window.close()
      })
    }
  }
}
