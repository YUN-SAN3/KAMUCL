import { BrowserWindow, ipcMain, dialog } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { StartupGate, BOOT_STAGES, type BootStage } from '../shared/startup'
import { launcherLog } from './core/launcherLog'

export function showStartupWindow(window: BrowserWindow, animated = true) {
  if (animated) window.setOpacity(0)
  window.show(); window.webContents.setBackgroundThrottling(true)
  if (!animated) return
  const started = Date.now()
  const fade = setInterval(() => {
    if (window.isDestroyed()) { clearInterval(fade); return }
    const p = Math.min(1, (Date.now() - started) / 260)
    window.setOpacity(p * p * (3 - 2 * p)); if (p === 1) clearInterval(fade)
  }, 16)
}

/** Keep the original native scene alive through readiness, assembly and reveal. No renderer swap. */
export function createNativeStartup(signal: string, pid: number) {
  const gate = new StartupGate()
  let main: BrowserWindow | null = null, disposed = false, revealed = false, readySent = false, last = ''
  const send = (text: string) => { if (text === last) return; try { writeFileSync(signal, text); last = text } catch {} }
  const labels = ['读取配置…', '加载账户…', '扫描游戏实例…', '准备主界面…', '准备首帧…']
  const listeners: Array<[string, (...args: any[]) => void]> = []
  const on = (name: string, fn: (...args: any[]) => void) => { listeners.push([name, fn]); ipcMain.on(name, fn) }
  const cleanup = () => { if (disposed) return; disposed = true; clearInterval(poll); for (const [name, fn] of listeners) ipcMain.removeListener(name, fn); send('closed') }
  const update = () => {
    if (disposed || revealed) return
    if (gate.state.ready) { readySent = true; send('ready') }
    else if (!readySent) send('loading\n' + labels[Math.min(4, gate.completed.size)])
  }
  const reveal = (animated: boolean) => {
    if (revealed || !main || main.isDestroyed() || !gate.state.ready) return
    revealed = true
    showStartupWindow(main, animated); send('reveal')
    launcherLog('Startup: unified native scene reveals fully painted main window')
    const timeout = setTimeout(cleanup, 1500); timeout.unref()
  }
  const poll = setInterval(() => {
    if (disposed) return
    if (existsSync(signal + '.finished')) { cleanup(); return }
    let alive = true; try { process.kill(pid, 0) } catch { alive = false }
    if (!alive) { if (gate.state.ready) { reveal(false); cleanup() }; return }
    if (readySent && existsSync(signal + '.assembled')) {
      let status = ''; try { status = readFileSync(signal + '.assembled', 'utf8') } catch { return }
      if (status !== 'ready' && status !== 'reduced') return
      gate.assembled = true; if (gate.canReveal) reveal(status !== 'reduced')
    }
  }, 20)
  on('boot:stage', (event, stage: BootStage) => { if (event.sender !== main?.webContents || !BOOT_STAGES.includes(stage)) return; gate.completed.add(stage); update() })
  on('boot:renderer-ready', event => { if (event.sender !== main?.webContents) return; gate.rendererReady = true; update() })
  return {
    attach(window: BrowserWindow) {
      main = window
      window.once('ready-to-show', () => { gate.painted = true; update() })
      window.once('closed', cleanup)
      const fail = (message: string) => { if (revealed) return; cleanup(); void dialog.showMessageBox({ type: 'error', title: 'KAMUCL 初始化失败', message }); window.close() }
      window.webContents.once('render-process-gone', (_e, details) => fail(`主界面进程退出：${details.reason}`))
      window.webContents.once('did-fail-load', (_e, code, description, _url, isMainFrame) => { if (isMainFrame && code !== -3) fail(`无法加载主界面：${description}`) })
      update()
    }
  }
}

export async function awaitNativeStartup(signal: string): Promise<number | null> {
  const until = Date.now() + 700
  do {
    try {
      const pid = Number(readFileSync(signal + '.visible', 'utf8'))
      if (Number.isInteger(pid) && pid > 0) { process.kill(pid, 0); return pid }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 15))
  } while (Date.now() < until)
  return null
}
