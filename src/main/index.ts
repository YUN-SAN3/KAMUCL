import { app, BrowserWindow, crashReporter, shell, ipcMain, net, protocol } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createStartupSplash } from './startupSplash'
import { authorizeManagedImage } from './core/appearanceAssets'
import {
  initializeLauncherLog,
  launcherLogError,
  launcherLogInfo,
  launcherLogWarn,
  flushLauncherLog,
  flushLauncherLogSync,
  logScope
} from './core/launcherLog'
import { getSettings, migrateLegacyAppearanceAssets } from './core/settings'
import { windowAppearance } from './windowAppearance'
import { applyNativeAppearance } from './nativeAppearance'
import { loadWindowState, trackWindowState } from './windowState'
import { stopDirectHost } from './core/directConnect'
import { stopVoxlinkOnQuit } from './core/voxlink'
import { stopTerracottaOnQuit } from './core/terracotta'
import { frpController } from './core/frp'

// 启动日志尽 earliest 初始化：闪退发生在 app.whenReady 之前时也有据可查
try {
  initializeLauncherLog()
  launcherLogInfo('main', '主进程模块加载完成，开始初始化')
} catch {
  /* 日志不可影响启动 */
}

// 崩溃取证：minidump 落到 userData/Crashpad（不上传），配合 launcher-current.log 定位闪退
try {
  crashReporter.start({ uploadToServer: false, compress: false })
  launcherLogInfo('main', '崩溃报告器已启动（仅本地留存 minidump）')
} catch (error) {
  launcherLogWarn('main', 'crashReporter 初始化失败，不阻断启动', error)
}

launcherLogInfo('main', '注册特权协议方案：kamucl-asset / kamucl-plugin')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'kamucl-asset',
    // 仅供 <img>/CSS 读取，不开放 renderer fetch，缩小本地资源协议的攻击面。
    privileges: { standard: true, secure: true, stream: true }
  },
  {
    scheme: 'kamucl-plugin',
    // 插件脚本协议：仅服务已启用插件的 main.js（见 core/plugins.ts registerPluginProtocol）。
    privileges: { standard: true, secure: true, stream: true }
  }
])

let win: BrowserWindow | null = null

function createWindow(startup?: ReturnType<typeof createStartupSplash>): void {
  logScope('window').debug('开始创建主窗口')
  applyNativeAppearance(null, getSettings())
  const windowState = loadWindowState()
  win = new BrowserWindow({
    ...windowAppearance(),
    ...(windowState
      ? { width: windowState.width, height: windowState.height, x: windowState.x, y: windowState.y }
      : {}),
    icon: join(__dirname, '../../build/icon.png'),
    show: false,
    title: 'KAMUCL',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  if (startup) startup.attach(win)
  else   win.on('ready-to-show', () => win?.show())
  applyNativeAppearance(win, getSettings())
  if (windowState?.maximized) win.maximize()
  trackWindowState(win)
  const mainWindow = win
  if (process.platform === 'win32') {
    // Native draggable regions do not dispatch DOM clicks. Observe, never consume.
    mainWindow.hookWindowMessage(0x00A1, (wParam) => {
      if (wParam.readUInt32LE(0) === 2 && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('window:caption-pointerdown')
      }
    })
  }
  mainWindow.on('will-move', () => {
    if (!mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('window:caption-pointerdown')
  })
  // 渲染进程崩溃/无响应取证（25h2 GPU 崩溃常见前兆），现有 splash 处理只覆盖初始化期
  win.webContents.on('render-process-gone', (_event, details) => {
    launcherLogWarn('window', `渲染进程退出：reason=${details.reason} exitCode=${details.exitCode}`)
  })
  win.webContents.on('unresponsive', () => {
    launcherLogWarn('window', '渲染进程无响应')
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  initializeLauncherLog()
  launcherLogInfo('main', `Electron 就绪（版本 ${app.getVersion()}）`)
  const startup = createStartupSplash()
  launcherLogInfo('main', '启动闪屏已创建')
  const { registerIpc } = await import('./ipc')
  try {
    await migrateLegacyAppearanceAssets()
  } catch (error) {
    launcherLogWarn('appearance', '旧版外观资源迁移失败，不阻断启动', error)
  }
  protocol.handle('kamucl-asset', (request) => {
    if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 })
    try {
      const candidate = new URL(request.url).searchParams.get('path') ?? ''
      const authorized = authorizeManagedImage(
        candidate,
        getSettings().folders.map((folder) => folder.path)
      )
      if (!authorized) return new Response('Not Found', { status: 404 })
      return net.fetch(pathToFileURL(authorized).toString())
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
  const { registerPluginProtocol } = await import('./core/plugins')
  registerPluginProtocol()
  registerIpc(() => win)
  launcherLogInfo('main', 'IPC 通道与插件协议注册完成')

  // 存量实例自包含迁移（老式 inheritsFrom 继承 → 合并进实例，幂等）：基础版本改名/删除不再波及已装实例
  void import('./core/versions').then(({ migrateFlattenedInstances }) =>
    migrateFlattenedInstances((m) => launcherLogInfo('migrate', m)).then((n) => {
      if (n > 0) launcherLogInfo('migrate', `共 ${n} 个旧式继承实例已合并为自包含实例`)
      launcherLogInfo('migrate', '存量实例迁移检查完成')
    })
  )

  ipcMain.on('window:minimize', () => win?.minimize())
  ipcMain.on('window:maximize', () => (win?.isMaximized() ? win?.unmaximize() : win?.maximize()))
  ipcMain.on('window:close', () => win?.close())

  createWindow(startup)
  launcherLogInfo('main', '主窗口创建完成')

  // 重开启动器时恢复运行中游戏：主窗口加载完成后推送 running 状态 + 日志尾部
  win?.webContents.once('did-finish-load', () => {
    void import('./core/launch').then(({ restoreRunningGame }) => {
      const record = restoreRunningGame((s) => win?.webContents.send('event:launchState', s))
      if (record) launcherLogInfo('main', `检测到运行中游戏已恢复：pid=${record.pid} 实例=${record.versionId}`)
    })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      launcherLogInfo('window', 'macOS 激活事件：重新创建主窗口')
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // 仅清理联机相关子进程/监听器；不影响 Minecraft 生命周期。
  void stopDirectHost()
  void stopVoxlinkOnQuit()
  void stopTerracottaOnQuit()
  frpController.dispose()
  launcherLogInfo('main', '所有窗口已关闭，开始清理联机相关资源')
  if (process.platform !== 'darwin') app.quit()
})

// ---------------- 崩溃取证（win11 25h2 概率闪退排查） ----------------
// 主进程未捕获异常：记录完整堆栈并保持进程存活（活着 > 闪退；日志可回溯）
process.on('uncaughtException', (error) => {
  launcherLogError('crash', '主进程未捕获异常（进程保持存活）', error)
})
process.on('unhandledRejection', (reason) => {
  launcherLogError('crash', '未处理的 Promise 拒绝', reason)
})
// 子进程（GPU/渲染/网络等）异常退出记录：25h2 上 GPU 进程崩溃是常见闪退前兆
app.on('child-process-gone', (_event, details) => {
  launcherLogWarn(
    'crash',
    `子进程异常退出：type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`
  )
})
app.on('before-quit', () => {
  // 尽早异步刷盘；quit 事件里还有同步兜底
  void flushLauncherLog()
})
app.on('quit', (_event, exitCode) => {
  try {
    launcherLogInfo('main', `应用退出，退出码 ${exitCode ?? process.exitCode ?? 0}`)
  } catch {
    /* 忽略 */
  }
  flushLauncherLogSync()
})
