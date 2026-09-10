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
import { loadWindowState, trackWindowState, applyMaximized, toggleMaximize, normalizeRealMaximize } from './windowState'
import { stopDirectHost } from './core/directConnect'
import { stopVoxlinkOnQuit } from './core/voxlink'
import { stopTerracottaOnQuit } from './core/terracotta'
import { frpController } from './core/frp'
import { applyPendingIfAny, getPendingUpdate } from './core/applyUpdate'
import { startMemoryTrim } from './core/memTrim'
import type { MemoryTrimController } from './core/memTrim'
import { getRunningGamePids } from './core/launch'

// ---------------- 内存极限压榨（任务A）：Chromium/V8 开关（必须 app ready 前注册） ----------------
app.commandLine.appendSwitch(
  'js-flags',
  [
    // 渲染层持有轮播图/皮肤/列表等图片型大对象，512MB 老生代上限防 OOM（上限≠预留，按需分配，主进程实际占用远低于此）
    '--max-old-space-size=512',
    // 年轻生代半空间 16MB→8MB：压低静默期年轻代常驻，代价是 Minor GC 稍频繁
    '--max-semi-space-size=8',
    // 暴露 window.gc()：idleTrim 瘦身时主动回收
    '--expose-gc'
  ].join(' ')
)
// 单窗口应用：限制渲染进程数量为 1，防止额外渲染进程常驻
app.commandLine.appendSwitch('renderer-process-limit', '1')
// 同站点共享渲染进程，避免按站点膨胀进程数
app.commandLine.appendSwitch('process-per-site')

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
/** 内存压榨控制器：whenReady 时初始化；createWindow 的窗口事件经此转发（静默瘦身） */
let memTrim: MemoryTrimController | null = null

function createWindow(startup?: Awaited<ReturnType<typeof createStartupSplash>>): void {
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
      nodeIntegration: false
      // backgroundThrottling 保持默认开启（不设 false）：窗口隐藏/最小化时定时器与 rAF 自动节流，
      // 静默期渲染层近零功耗；IPC 推送（进度/日志事件）不受节流影响。
    }
  })
  if (startup) startup.attach(win)
  else   win.on('ready-to-show', () => win?.show())
  applyNativeAppearance(win, getSettings())
  if (windowState?.maximized) applyMaximized(win)
  trackWindowState(win)
  // 系统吸附（Win+↑/拖到顶部）走真实最大化，会溢出相邻屏——收编为假最大化
  win.on('maximize', () => win && normalizeRealMaximize(win))
  const mainWindow = win
  // 静默瘦身钩子：最小化/隐藏触发工作集整理 + 渲染层瘦身广播；恢复不做处理（自然回涨）
  mainWindow.on('minimize', () => memTrim?.noteHidden())
  mainWindow.on('hide', () => memTrim?.noteHidden())
  mainWindow.on('restore', () => memTrim?.noteVisible())
  mainWindow.on('show', () => memTrim?.noteVisible())
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
  const startup = await createStartupSplash()
  launcherLogInfo('main', '启动闪屏已创建')
  // 内存压榨控制器：指标日志 + 静默期工作集整理（trim 进程清单来自 getAppMetrics，绝不触碰游戏进程）
  memTrim = await startMemoryTrim(() => win, (message) => launcherLogInfo('memory', message))
  launcherLogInfo('memory', '内存压榨控制器已启动（指标日志 5 分钟/条；静默 10 分钟后低频整理）')
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
  ipcMain.on('window:maximize', () => win && toggleMaximize(win))
  ipcMain.on('window:close', () => win?.close())

  createWindow(startup)
  launcherLogInfo('main', '主窗口创建完成')

  // 重开启动器时恢复运行中游戏：主窗口加载完成后推送 running 状态 + 日志尾部
  win?.webContents.once('did-finish-load', () => {
    void import('./core/launch').then(({ restoreRunningGame }) => {
      const record = restoreRunningGame((s) => win?.webContents.send('event:launchState', s))
      if (record) launcherLogInfo('main', `检测到运行中游戏已恢复：pid=${record.pid} 实例=${record.versionId}`)
    })
    // 更新：启动自动检查（自动安装模式静默下载；弹窗模式才提示）；已有就绪更新则通知
    const runUpdateCheck = async () => {
      try {
        const { checkLatest, decideUpdateAction } = await import('./core/selfUpdate')
        const applyMod = await import('./core/applyUpdate')
        const { getSettings } = await import('./core/settings')
        if (applyMod.consumeUpdateFailedFlag()) {
          win?.webContents.send('event:updatePrompt', { rollbackNotice: true })
        }
        // 已有就绪待装的更新（上次下载完成后未关闭安装）：提醒一次
        const pending = applyMod.getPendingUpdate()
        if (pending) win?.webContents.send('event:updateReady', { version: pending.release.version })
        const result = await checkLatest(false)
        if (!result.ok || !result.release) return
        const s = getSettings()
        const action = decideUpdateAction({
          release: result.release,
          skipVersion: s.skipUpdateVersion,
          current: app.getVersion(),
          autoUpdate: s.autoUpdate !== false,
          supported: applyMod.updateSupported(),
          downloading: applyMod.isUpdateDownloading(),
          pendingVersion: pending?.release.version
        })
        if (action === 'auto-download') {
          launcherLogInfo('main', `自动安装模式：静默下载更新 v${result.release.version}`)
          applyMod.startAutoUpdate(result.release, s)
        } else if (action === 'prompt') {
          win?.webContents.send('event:updatePrompt', result.release)
        }
      } catch (e) {
        launcherLogInfo('main', `启动自动检查更新失败（静默降级）：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    void runUpdateCheck()
    // 运行中每 6 小时复查一次（与缓存 TTL 对齐；自动模式全程静默）
    setInterval(() => void runUpdateCheck(), 6 * 3600_000)
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

// ---------------- 关闭时自动安装更新（小白零操作） ----------------
// 已有就绪更新包时：拦截退出 → 校验/备份/替换/重启由旁路脚本完成；游戏进程不受影响（detached）。
let applyingPendingUpdate = false
app.on('before-quit', (e) => {
  if (applyingPendingUpdate) return
  // 同步检查（preventDefault 必须同步调用才生效）
  let hasPending = false
  try {
    hasPending = !!getPendingUpdate()
  } catch { /* 读失败按无待装处理 */ }
  if (!hasPending) return
  e.preventDefault()
  applyingPendingUpdate = true
  launcherLogInfo('main', '检测到已就绪更新，退出时自动安装')
  applyPendingIfAny()
    .then((willApply) => {
      if (!willApply) {
        applyingPendingUpdate = false
        app.quit()
      }
      // willApply=true：applyDownloadedUpdate 已安排 app.quit()，再次进入本钩子时直接放行
    })
    .catch((error) => {
      applyingPendingUpdate = false
      launcherLogInfo('main', `退出时自动安装失败（继续正常退出）：${error instanceof Error ? error.message : String(error)}`)
      app.quit()
    })
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
  // 任务B：任何正常退出路径都不终止游戏——游戏进程以脱离方式创建（gracefulClose.spawnGameProcess），
  // 这里只记录「游戏继续运行」，绝无 taskkill/树杀。
  const gamePids = getRunningGamePids()
  if (gamePids.length) launcherLogInfo('exit', `启动器已退出，游戏(进程 PID ${gamePids.join('、')})继续运行`)
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
