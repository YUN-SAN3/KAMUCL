import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { app, nativeTheme, type BrowserWindow } from 'electron'
import { launcherLog } from './core/launcherLog'

/** 只清理原生启动淡入残留。Electron 44 负责 DWM、裁剪和窗口边框；
 * 禁止继续使用旧内核的边框修补，否则会破坏新版的原生还原尺寸。
 * 原生错误隔离于主进程；helper 只接受属于当前 Electron PID 的 HWND。
 */
export function createDwmFrameRestorer(window: BrowserWindow): (finishStartupOpacity?: boolean) => void {
  let helper: ChildProcessWithoutNullStreams | null = null
  let unavailable = false
  const close = () => { helper?.stdin.end(); helper = null }
  window.once('closed', close)
  app.once('before-quit', close)
  return (finishStartupOpacity = false) => {
    if (!finishStartupOpacity || unavailable || window.isDestroyed() || process.platform !== 'win32') return
    if (!helper) {
      const executable = join(__dirname.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'), 'WindowMaterial.exe')
      helper = spawn(executable, [String(process.pid)], { windowsHide: true, stdio: 'pipe' })
      const fail = (error: unknown) => {
        unavailable = true
        launcherLog(`DWM frame helper unavailable: ${String(error)}`)
      }
      helper.on('error', fail)
      helper.stdin.on('error', fail)
      helper.stderr.on('data', data => launcherLog(`DWM helper: ${String(data).slice(0, 300)}`))
      helper.stdout.on('data', data => {
        for (const line of String(data).trim().split(/\r?\n/)) if (line !== '0') launcherLog(`DWM frame result: ${line}`)
      })
      helper.once('exit', () => { helper = null; unavailable = true })
    }
    const handle = window.getNativeWindowHandle()
    const value = handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE())
    helper.stdin.write(`${value} ${nativeTheme.shouldUseDarkColors ? 'dark' : 'light'} ${finishStartupOpacity ? 'finish-opacity' : 'repair'}\n`)
  }
}
