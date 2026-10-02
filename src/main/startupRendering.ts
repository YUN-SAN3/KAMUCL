import { ipcMain, type BrowserWindow } from 'electron'
import { launcherLogWarn } from './core/launcherLog'

/** Windows can schedule an initially hidden compositor at ~1fps even with throttling disabled.
 * A tiny, discarded capture requests real frames while boot resources settle. It does not show
 * the window, store pixels or bypass the renderer/compositor/animation readiness gates.
 */
export function prepareStartupFrames(window: BrowserWindow): void {
  const contents = window.webContents
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    if (stopped) return
    stopped = true
    clearTimeout(timer)
    clearTimeout(watchdog)
    ipcMain.removeListener('boot:renderer-ready', ready)
    contents.removeListener('dom-ready', pump)
    window.removeListener('closed', stop)
    if (!window.isDestroyed() && !contents.isDestroyed()) contents.setBackgroundThrottling(true)
  }
  const ready = (event: Electron.IpcMainEvent) => { if (event.sender === contents) stop() }
  const pump = async () => {
    if (stopped || window.isDestroyed() || contents.isDestroyed()) { stop(); return }
    try {
      // Electron owns/relinquishes the capturer count; only one request may be in flight.
      await contents.capturePage({ x: 0, y: 0, width: 1, height: 1 })
    } catch (error) {
      launcherLogWarn('startup', '首帧预绘制不可用，继续使用默认绘制流程', error)
      stop()
      return
    }
    if (!stopped) timer = setTimeout(pump, 16)
  }
  // A slow network/resource must not keep requesting frames forever. This only stops warmup;
  // the normal startup gate still waits for actual resources, never a fabricated ready signal.
  const watchdog = setTimeout(stop, 10_000)
  watchdog.unref()
  window.once('closed', stop)
  ipcMain.on('boot:renderer-ready', ready)
  contents.once('dom-ready', pump)
}
