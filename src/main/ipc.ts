/**
 * IPC 注册：types.ts 中 IPC 常量的全部通道
 * 事件统一通过 getWin()?.webContents.send(IPC_EVENT.xxx, payload) 推送
 */
import { ipcMain, dialog, shell, Menu, type BrowserWindow } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_BACKGROUND, DEFAULT_LAUNCH_THUMBNAIL, IPC, IPC_EVENT } from '../shared/types'
import type {
  CommunityFile,
  CommunityKind,
  CommunityQuery,
  CommunitySource,
  FsEntry,
  GameResolution,
  ImageFit,
  InstallOptions,
  LaunchState,
  LoaderName,
  ModpackInstallRequest,
  ProgressEvent,
  Settings,
  SkinVariant,
  WorldImportOptions,
  YggdrasilProviderCandidate,
  YggdrasilProviderInput
} from '../shared/types'
import * as settings from './core/settings'
import * as accounts from './core/accounts'
import * as versions from './core/versions'
import * as loaders from './core/loaders'
import * as java from './core/java'
import * as launch from './core/launch'
import * as servers from './core/servers'
import { scanModTargets, selectModTarget, copyCompatibleMods } from './core/modTargets'
import { prepareModInstall, executeModPlan, discardModPlan } from './core/modInstallPlan'
import * as modinfo from './core/modinfo'
import * as modUpdates from './core/modUpdates'
import * as plugins from './core/plugins'
import * as keybindings from './core/keybindings'
import * as modBridge from './core/modBridge'
import * as gamedir from './core/gamedir'
import { folderOfVersion, instanceIconsDir, withGameFolder } from './core/paths'
import * as modpacks from './core/modpacks'
import * as skins from './core/skins'
import * as community from './core/community'
import {
  registerTask,
  cancelTaskAndWait,
  finishTask,
  isCancelError,
  pauseTask,
  resumeTask
} from './core/tasks'
import { exportLaunchLogs } from './core/exportLogs'
import { ProgressEventGuard } from './core/progress'
import { launcherLogDebug, launcherLogError, launcherLogInfo, launcherLogWarn } from './core/launcherLog'
import * as gameFolders from './core/gameFolders'
import * as instances from './core/instances'
import * as worlds from './core/worlds'
import * as yggdrasil from './core/yggdrasil'
import * as appearance from './core/appearanceAssets'
import { applyNativeAppearance } from './nativeAppearance'
import { carouselImages, MAX_CAROUSEL_IMAGES } from '../shared/appearancePolicy'
import { pathIdentity } from './core/folderPaths'
import * as direct from './core/directConnect'
import type { DirectHostRequest } from '../shared/directConnect'
import { registerVoxlinkIpc } from './core/voxlink'
import { registerTerracottaIpc } from './core/terracotta'
import { registerFrpIpc, installFrpEventBridge } from './core/frpIpc'

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function registerIpc(getWin: () => BrowserWindow | null): void {
  // IPC 失败兜底：注册期统一包装 ipcMain.handle，handler 抛错时记录通道名与脱敏错误，
  // 再原样抛回渲染端（渲染端收到的错误与原行为一致）；取消类错误属常规路径只记 debug。
  type IpcInvokeListener = (event: unknown, ...args: unknown[]) => unknown
  const rawHandle = ipcMain.handle.bind(ipcMain) as unknown as (
    channel: string,
    listener: IpcInvokeListener
  ) => void
  const patchedMain = ipcMain as unknown as {
    handle: (channel: string, listener: IpcInvokeListener) => void
  }
  patchedMain.handle = (channel, listener) => {
    rawHandle(channel, async (event, ...args) => {
      try {
        return await listener(event, ...args)
      } catch (error) {
        if (isCancelError(error)) launcherLogDebug('ipc', `通道 ${channel} 已取消：${errText(error)}`)
        else launcherLogError('ipc', `IPC 通道 ${channel} 处理失败`, error)
        throw error
      }
    })
  }
  // 联机三通道：VoxLink（TS 引擎）/ 陶瓦联机（Terracotta 官方工具）/ FRP（樱花穿透）
  registerVoxlinkIpc(ipcMain)
  registerTerracottaIpc(ipcMain)
  registerFrpIpc(ipcMain)
  installFrpEventBridge(getWin)
  const send = (channel: string, payload: unknown): void => {
    getWin()?.webContents.send(channel, payload)
  }
  /** 统一进度回调 */
  const emit = (e: ProgressEvent): void => send(IPC_EVENT.progress, e)
  const sendState = (s: LaunchState): void => send(IPC_EVENT.launchState, s)
  let activeJavaScanTaskId: string | null = null
  const pickImage = async (title: string): Promise<string | null> => {
    const win = getWin()
    const opts = {
      properties: ['openFile' as const],
      title,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }

  // ---------------- 设置 ----------------
  ipcMain.handle(IPC.settingsGet, () => settings.getSettings())
  ipcMain.handle(IPC.appSystemInfo, () => ({ totalMemMB: Math.floor(os.totalmem() / 1024 / 1024) }))
  ipcMain.handle(IPC.directOverview, () => direct.directOverview())
  ipcMain.handle(IPC.directHost, (_e, request: DirectHostRequest) => direct.startDirectHost(request))
  ipcMain.handle(IPC.directStop, () => direct.stopDirectHost())
  ipcMain.handle(IPC.directState, () => direct.directState())
  ipcMain.handle(IPC.directResolve, (_e, invitation: string) => direct.resolveDirectInvitation(invitation))
  ipcMain.handle(IPC.directPrepareJoin, (_e, invitation: string, versionId: string, folder: string) => direct.prepareDirectJoin(invitation, versionId, folder))
  ipcMain.handle(IPC.foldersContextMenu, (_e, folder: string, versionId?: string) => {
    const registered = settings.getSettings().folders.find(item => pathIdentity(item.path) === pathIdentity(String(folder)))
    if (!registered) throw new Error('文件夹未登记')
    if (versionId && (!/^[^\\/]+$/.test(versionId) || versionId === '.' || versionId === '..')) throw new Error('无效版本 ID')
    const target = versionId ? path.join(registered.path, 'versions', versionId) : registered.path
    Menu.buildFromTemplate([{ label: '打开对应文件夹', click: () => {
      void shell.openPath(target).then(error => { if (error) dialog.showErrorBox('无法打开文件夹', error) })
    } }]).popup({ window: getWin() ?? undefined })
  })
  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<Settings>) => {
    const saved = settings.saveSettings(patch)
    applyNativeAppearance(getWin(), saved)
    return saved
  })
  ipcMain.handle(IPC.appSelectImage, async () => {
    return pickImage('选择图片')
  })
  ipcMain.handle(IPC.appearanceImportBackground, async () => {
    const source = await pickImage('导入自定义背景')
    if (!source) return null
    const previous = settings.getSettings()
    const imported = await appearance.importGlobalImage(source, 'background')
    try {
      const next = settings.saveSettings({
        background: { ...previous.background, image: imported.path, mode: 'image' }
      })
      if (previous.background.image !== imported.path) {
        appearance.removeGlobalImage(previous.background.image, 'background')
      }
      return next
    } catch (error) {
      appearance.removeGlobalImage(imported.path, 'background')
      throw error
    }
  })
  ipcMain.handle(IPC.appearanceImportBackgroundMulti, async () => {
    const win = getWin()
    const options = { title: '导入背景图片（可多选）', properties: ['openFile' as const, 'multiSelections' as const],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }
    const selection = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (selection.canceled || !selection.filePaths.length) return null
    const imported: string[] = []
    try {
      for (const source of selection.filePaths) imported.push((await appearance.importGlobalImage(source, 'background')).path)
      const current = settings.getSettings().background
      const images = [...new Set([...(current.images ?? []), ...imported])]
      return settings.saveSettings({ background: { ...current, images, image: images[0] ?? current.image, mode: 'image' } })
    } catch (error) {
      for (const image of imported) appearance.removeGlobalImage(image, 'background')
      throw error
    }
  })
  ipcMain.handle(IPC.appearanceResetBackground, () => {
    const previous = settings.getSettings().background
    const next = settings.saveSettings({ background: structuredClone(DEFAULT_BACKGROUND) })
    appearance.removeGlobalImage(previous.image, 'background')
    for (const image of previous.images ?? []) appearance.removeGlobalImage(image, 'background')
    return next
  })
  ipcMain.handle(IPC.appearanceImportLaunchThumbnail, async () => {
    const win = getWin()
    const options = { title: '添加首页轮播图片（可多选）', properties: ['openFile' as const, 'multiSelections' as const],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }
    const selection = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (selection.canceled || !selection.filePaths.length) return null
    if (carouselImages(settings.getSettings().launchThumbnail).length + selection.filePaths.length > MAX_CAROUSEL_IMAGES) {
      throw new Error(`首页轮播最多 ${MAX_CAROUSEL_IMAGES} 张图片，请先移除部分图片`)
    }
    const imported: string[] = []
    try {
      for (const source of selection.filePaths) imported.push((await appearance.importGlobalImage(source, 'launch-thumbnail')).path)
      const current = settings.getSettings().launchThumbnail
      const images = [...carouselImages(current), ...imported]
      if (images.length > MAX_CAROUSEL_IMAGES) throw new Error(`首页轮播最多 ${MAX_CAROUSEL_IMAGES} 张图片`)
      return settings.saveSettings({ launchThumbnail: { ...current, images, image: images[0] ?? '' } })
    } catch (error) {
      for (const image of imported) appearance.removeGlobalImage(image, 'launch-thumbnail')
      throw error
    }
  })
  ipcMain.handle(IPC.appearanceResetLaunchThumbnail, () => {
    const previous = carouselImages(settings.getSettings().launchThumbnail)
    const next = settings.saveSettings({ launchThumbnail: structuredClone(DEFAULT_LAUNCH_THUMBNAIL) })
    for (const image of previous) appearance.removeGlobalImage(image, 'launch-thumbnail')
    return next
  })
  ipcMain.handle(IPC.appSelectDir, async () => {
    const win = getWin()
    const opts = { properties: ['openDirectory' as const], title: '选择游戏目录' }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC.appSelectFile, async () => {
    const win = getWin()
    const opts = {
      properties: ['openFile' as const],
      title: '选择整合包',
      filters: [{ name: '整合包', extensions: ['mrpack', 'zip'] }]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  // ---------------- 账号 ----------------
  ipcMain.handle(IPC.accountsList, () => accounts.listAccounts())
  ipcMain.handle(IPC.accountsAddOffline, (_e, username: string) =>
    accounts.addOffline(String(username ?? ''))
  )
  ipcMain.handle(IPC.accountsRemove, (_e, id: string) => accounts.removeAccount(id))
  ipcMain.handle(IPC.accountsSelect, (_e, id: string) => accounts.selectAccount(id))
  ipcMain.handle(IPC.accountsSelected, () => accounts.selectedAccountPublic())
  ipcMain.handle(IPC.accountsMsBegin, () =>
    accounts.beginMsDeviceCode((account, error) =>
      send(IPC_EVENT.msLoginDone, account ? { account: accounts.publicAccount(account) } : { account: null, error: error ?? null })
    )
  )
  ipcMain.handle(IPC.accountsMsCancel, () => accounts.cancelMsLogin())
  ipcMain.handle(IPC.accountsYggProviders, () => yggdrasil.listProviders())
  ipcMain.handle(
    IPC.accountsYggProbe,
    (_e, input: YggdrasilProviderInput, allowInsecure?: boolean) =>
      yggdrasil.probeProvider(input, allowInsecure === true)
  )
  ipcMain.handle(
    IPC.accountsYggSaveProvider,
    (_e, candidate: YggdrasilProviderCandidate, allowInsecure?: boolean) =>
      yggdrasil.saveProvider(candidate, allowInsecure === true)
  )
  ipcMain.handle(IPC.accountsYggRemoveProvider, (_e, id: string) => {
    const providerId = String(id ?? '')
    return yggdrasil.removeProvider(providerId, accounts.hasProviderAccounts(providerId))
  })
  ipcMain.handle(
    IPC.accountsYggLogin,
    async (_e, providerId: string, identifier: string, password: string) => {
      const result = await yggdrasil.authenticate(
        String(providerId ?? ''),
        String(identifier ?? ''),
        String(password ?? '')
      )
      return result.status === 'complete'
        ? { status: 'complete' as const, account: accounts.saveYggdrasilAccount(result.account) }
        : result
    }
  )
  ipcMain.handle(
    IPC.accountsYggSelectProfile,
    async (_e, challengeId: string, profileId: string) =>
      accounts.saveYggdrasilAccount(
        await yggdrasil.completeProfileSelection(
          String(challengeId ?? ''),
          String(profileId ?? '')
        )
      )
  )
  ipcMain.handle(IPC.accountsYggRuntime, () => yggdrasil.runtimeInfo())
  ipcMain.handle(IPC.accountsRefresh, (_e, id: string) =>
    accounts.refreshAccountById(String(id ?? ''))
  )

  // ---------------- 版本 ----------------
  ipcMain.handle(IPC.versionsManifest, (_e, refresh?: boolean) =>
    versions.fetchVersionManifest(settings.getSettings().mirror, refresh === true)
  )
  ipcMain.handle(IPC.versionsInstalled, () => versions.listInstalled())
  // 异步执行，不阻塞返回；进度经 event:progress（带 taskId）推送，结束经 event:installDone 推送
  ipcMain.handle(IPC.versionsInstall, (_e, versionId: string, opts?: InstallOptions) => {
    const vid = String(versionId ?? '')
    const task = registerTask(`安装版本 ${vid}${opts?.loader ? ` + ${opts.loader}` : ''}`, 'version')
    const progressGuard = new ProgressEventGuard()
    let lastStage = ''
    const taskEmit = (e: ProgressEvent): void => {
      const normalized = progressGuard.normalize(e)
      lastStage = normalized.stage
      emit({ ...normalized, taskId: task.id, taskTitle: task.title })
    }
    const taskDone = (ok: boolean, error?: string, cancelled = false): void =>
      send(IPC_EVENT.taskDone, {
        taskId: task.id,
        ok,
        error,
        cancelled,
        stage: ok ? undefined : lastStage
      })
    void versions
        .installVersion(vid, opts ?? {}, taskEmit, task.controller.signal)
        .then((installedId) => {
          // 设置项生效：新版本默认开启版本隔离（整合包实例本身强制隔离，无需处理）
          try {
            if (settings.getSettings().defaultIsolation) {
              instances.setNewInstanceIsolation(installedId, true)
            }
          } catch (e) {
            console.error('[KAMUCL] 默认隔离设置失败:', e)
            launcherLogWarn('install', '按默认设置开启新实例隔离失败，不影响安装结果', e)
          }
          taskDone(true)
          send(IPC_EVENT.installDone, { versionId: vid, installedId, ok: true, taskId: task.id })
        })
        .catch((err) => {
          const cancelled = isCancelError(err)
          const text = cancelled ? '已取消' : errText(err)
          if (!cancelled) taskEmit({ stage: 'error', progress: 0, text: `安装失败: ${text}` })
          // 事务清理：删除安装失败产生的文件（.installing 标记在则目录是失败产物）
          try {
            versions.cleanupPartialInstall(vid)
            // 加载器实例目录（若已生成）一并清理
            const installed = versions.listInstalled()
            for (const v of installed) {
              if (v.failed) versions.cleanupPartialInstall(v.id)
            }
          } catch {
            /* 清理失败不阻断错误上报 */
          }
          taskDone(false, text, cancelled)
          send(IPC_EVENT.installDone, {
            versionId: vid,
            ok: false,
            error: text,
            taskId: task.id,
            cancelled,
            stage: lastStage
          })
        })
        .finally(() => finishTask(task.id))
    })
  // 取消进行中的后台任务（版本安装/整合包导入/资源下载）
  ipcMain.handle(IPC.tasksCancel, (_e, taskId: string) =>
    cancelTaskAndWait(String(taskId ?? ''))
  )
  ipcMain.handle(IPC.tasksPause, (_e, taskId: string) => pauseTask(String(taskId ?? '')))
  ipcMain.handle(IPC.tasksResume, (_e, taskId: string) => resumeTask(String(taskId ?? '')))
  ipcMain.handle(IPC.versionsRemove, (_e, versionId: string) => versions.removeVersion(versionId))
  ipcMain.handle(IPC.versionsRename, (_e, id: string, newName: string) => {
    const vid = String(id ?? '')
    const name = String(newName ?? '').trim()
    // 前置校验：游戏运行中禁止改名（文件夹句柄被占用，且引用会错乱）
    if (launch.getRunningVersionIds().has(vid)) {
      throw new Error('该版本正在运行中，请先退出游戏再改名')
    }
    versions.renameVersion(vid, name)
    // 引用同步：收藏列表
    const s = settings.getSettings()
    if (s.favoriteVersions.includes(vid)) {
      settings.saveSettings({
        favoriteVersions: s.favoriteVersions.map((x) => (x === vid ? name : x))
      })
    }
    // 引用同步：服务器绑定（隔离实例的 servers.dat 随目录迁移，无需额外处理）
    servers.renameBinding(vid, name)
  })
  ipcMain.handle(IPC.versionsCleanup, (_e, id: string) =>
    versions.cleanupPartialInstall(String(id ?? ''))
  )

  // ---------------- 游戏文件夹管理 ----------------
  ipcMain.handle(IPC.foldersList, () => gameFolders.listGameFolders())
  ipcMain.handle(IPC.foldersAdd, (_e, p: string) =>
    gameFolders.addGameFolder(String(p ?? ''))
  )
  ipcMain.handle(IPC.foldersRemove, (_e, p: string) =>
    gameFolders.removeGameFolder(String(p ?? ''))
  )
  ipcMain.handle(IPC.foldersRename, (_e, p: string, name: string) =>
    gameFolders.renameGameFolder(String(p ?? ''), String(name ?? ''))
  )
  ipcMain.handle(IPC.foldersSetDefault, (_e, p: string) =>
    gameFolders.setDefaultGameFolder(String(p ?? ''))
  )
  ipcMain.handle(IPC.foldersSetActive, (_e, p: string) =>
    gameFolders.setActiveGameFolder(String(p ?? ''))
  )
  ipcMain.handle(IPC.foldersScan, (_e, p: string) =>
    gameFolders.scanGameFolder(String(p ?? ''))
  )
  ipcMain.handle(IPC.foldersOpen, async (_e, p: string) => {
    const state = gameFolders.listGameFolders()
    const target = state.folders.find((folder) => folder.path === String(p ?? ''))
    if (!target) throw new Error('文件夹未登记')
    const error = await shell.openPath(target.path)
    if (error) throw new Error(error)
  })
  ipcMain.handle(IPC.versionsSetJava, (_e, id: string, javaPath: string, automatic?: boolean, folder?: string) =>
    withGameFolder(folder || folderOfVersion(String(id ?? '')), () => versions.setVersionJava(String(id ?? ''), String(javaPath ?? ''), automatic === true))
  )
  ipcMain.handle(
    IPC.versionsSetResolution,
    (_e, id: string, resolution: GameResolution | null) =>
      versions.setVersionResolution(String(id ?? ''), resolution ?? null)
  )
  ipcMain.handle(IPC.versionsSetIcon, (_e, id: string, icon: string) =>
    versions.setVersionIcon(String(id ?? ''), String(icon ?? ''))
  )
  // 上传自定义图标：弹窗选图 → 校验类型/大小 → 复制进 .kamucl/icons 并写入版本 json
  ipcMain.handle(IPC.versionsUploadIcon, async (_e, id: string) => {
    const vid = String(id ?? '')
    const win = getWin()
    const opts = {
      title: '选择实例图标',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      properties: ['openFile' as const]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    const src = r.filePaths[0]
    const st = fs.statSync(src)
    if (st.size > 5 * 1024 * 1024) throw new Error('图片过大（最大 5MB）')
    const ext = path.extname(src).toLowerCase() || '.png'
    const name = `${crypto.randomUUID()}${ext}`
    fs.mkdirSync(instanceIconsDir(), { recursive: true })
    fs.copyFileSync(src, path.join(instanceIconsDir(), name))
    const icon = `file:${name}`
    versions.setVersionIcon(vid, icon)
    return icon
  })
  ipcMain.handle(IPC.versionsUploadThumbnail, async (_e, id: string) => {
    const versionId = String(id ?? '')
    const version = versions.readVersionJson(versionId)
    const source = await pickImage('导入实例启动卡缩略图')
    if (!source) return null
    const folder = folderOfVersion(versionId)
    const imported = await appearance.importInstanceThumbnail(source, folder)
    try {
      versions.setVersionThumbnail(
        versionId,
        imported.path,
        version._thumbnailFit ?? 'crop'
      )
      return imported.path
    } catch (error) {
      appearance.removeInstanceThumbnail(imported.path, folder)
      throw error
    }
  })
  ipcMain.handle(IPC.versionsSetThumbnailFit, (_e, id: string, fit: ImageFit) =>
    versions.setVersionThumbnailFit(String(id ?? ''), fit)
  )
  ipcMain.handle(IPC.versionsResetThumbnail, (_e, id: string) =>
    versions.resetVersionThumbnail(String(id ?? ''))
  )
  ipcMain.handle(IPC.versionsSetIsolation, (_e, versionId: string, isolated: boolean) =>
    versions.setIsolation(String(versionId ?? ''), isolated === true)
  )
  ipcMain.handle(IPC.versionsIsolationPlan, (_e, versionId: string) =>
    instances.isolationMigrationPlan(String(versionId ?? ''))
  )
  ipcMain.handle(IPC.loadersList, (_e, loader: LoaderName, mcVersion: string) =>
    loaders.listLoaderVersions(loader, mcVersion)
  )
  ipcMain.handle(IPC.fabricApiList, (_e, mcVersion: string) =>
    loaders.listFabricApiVersions(String(mcVersion ?? ''))
  )

  // ---------------- 整合包 ----------------
  // 只解析不安装：导入确认弹窗展示包信息用
  ipcMain.handle(IPC.modpackProbe, (_e, filePath: string) =>
    modpacks.probeModpack(String(filePath ?? ''))
  )
  // 异步执行，不阻塞返回；进度经 event:progress（带 taskId）推送，结束经 event:installDone 推送（versionId = 实例 id）
  ipcMain.handle(
    IPC.modpackInstall,
    (_e, filePath: string, opts?: ModpackInstallRequest) => {
      const fp = String(filePath ?? '')
      const clean: modpacks.ModpackInstallOpts = {
        nameSource: opts?.nameSource === 'inner' ? 'inner' : 'file',
        instanceName: typeof opts?.instanceName === 'string' ? opts.instanceName : undefined,
        targetFolder: typeof opts?.targetFolder === 'string' ? opts.targetFolder : undefined,
        conflictAction: opts?.conflictAction,
        existingId: typeof opts?.existingId === 'string' ? opts.existingId : undefined,
        confirmReplace: opts?.confirmReplace === true
      }
      const task = registerTask(`导入整合包 ${path.basename(fp)}`, 'modpack')
      clean.signal = task.controller.signal
      const progressGuard = new ProgressEventGuard()
      let lastStage = ''
      const taskEmit = (e: ProgressEvent): void => {
        const normalized = progressGuard.normalize(e)
        lastStage = normalized.stage
        emit({ ...normalized, taskId: task.id, taskTitle: task.title })
      }
      void modpacks
        .installModpack(fp, taskEmit, clean)
        .then((id) => {
          send(IPC_EVENT.taskDone, { taskId: task.id, ok: true })
          send(IPC_EVENT.installDone, { versionId: id, ok: true, taskId: task.id })
        })
        .catch((err) => {
          const cancelled = isCancelError(err)
          const text = cancelled ? '已取消' : errText(err)
          if (!cancelled) taskEmit({ stage: 'error', progress: 0, text: `整合包安装失败: ${text}` })
          send(IPC_EVENT.taskDone, { taskId: task.id, ok: false, error: text, cancelled, stage: lastStage })
          send(IPC_EVENT.installDone, {
            versionId: '',
            ok: false,
            error: text,
            taskId: task.id,
            cancelled,
            stage: lastStage
          })
        })
        .finally(() => finishTask(task.id))
    }
  )

  // ---------------- 世界存档 ----------------
  ipcMain.handle(IPC.worldProbe, (_e, inputPath: string) =>
    worlds.probeWorld(String(inputPath ?? ''))
  )
  ipcMain.handle(
    IPC.worldImport,
    async (_e, inputPath: string, options: WorldImportOptions) => {
      const source = String(inputPath ?? '')
      const task = registerTask(`导入存档 ${path.basename(source)}`, 'world')
      const progressGuard = new ProgressEventGuard()
      let lastStage = ''
      const taskEmit = (event: ProgressEvent): void => {
        const normalized = progressGuard.normalize(event)
        lastStage = normalized.stage
        emit({ ...normalized, taskId: task.id, taskTitle: task.title })
      }
      try {
        const result = await worlds.importWorld(source, options, taskEmit, task.controller.signal)
        send(IPC_EVENT.taskDone, { taskId: task.id, ok: true })
        return result
      } catch (error) {
        const cancelled = isCancelError(error)
        const message = cancelled ? '已取消' : errText(error)
        if (!cancelled) taskEmit({ stage: 'error', progress: 0, text: message })
        send(IPC_EVENT.taskDone, {
          taskId: task.id,
          ok: false,
          error: message,
          cancelled,
          stage: lastStage
        })
        throw error
      } finally {
        finishTask(task.id)
      }
    }
  )

  // ---------------- 社区资源（同步 await 返回，错误 reject 给前端） ----------------
  ipcMain.handle(IPC.communitySearch, (_e, q: CommunityQuery) => community.communitySearch(q))
  ipcMain.handle(
    IPC.communityFiles,
    (_e, source: CommunitySource, projectId: string, filter?: { mcVersion?: string; loader?: LoaderName | '' }) =>
      community.communityFiles(source, String(projectId ?? ''), filter)
  )
  ipcMain.handle(
    IPC.communityDownload,
    async (_e, file: CommunityFile, target: { versionId: string; kind: CommunityKind }) => {
      const task = registerTask(`下载 ${file.fileName ?? '资源'}`, 'download')
      const progressGuard = new ProgressEventGuard()
      let lastStage = ''
      const taskEmit = (e: ProgressEvent): void => {
        const normalized = progressGuard.normalize(e)
        lastStage = normalized.stage
        emit({ ...normalized, taskId: task.id, taskTitle: task.title })
      }
      try {
        const r = await community.communityDownload(file, target, taskEmit, (done) => {
          const cancelled = done.error === '已取消'
          send(IPC_EVENT.taskDone, {
            taskId: task.id,
            ok: done.ok,
            error: done.error,
            cancelled,
            stage: done.ok ? undefined : lastStage
          })
          send(IPC_EVENT.installDone, {
            ...done,
            taskId: task.id,
            cancelled,
            stage: done.ok ? undefined : lastStage
          })
          finishTask(task.id)
        }, task.controller.signal)
        // 非整合包：invoke 返回即完成；整合包：完成回调在后台安装结束时触发
        if (target.kind === 'modpack') return r
        send(IPC_EVENT.taskDone, { taskId: task.id, ok: true })
        finishTask(task.id)
        return r
      } catch (err) {
        const cancelled = isCancelError(err)
        send(IPC_EVENT.taskDone, {
          taskId: task.id,
          ok: false,
          error: cancelled ? '已取消' : errText(err),
          cancelled,
          stage: lastStage
        })
        finishTask(task.id)
        throw err
      }
    }
  )

  // ---------------- Java ----------------
  ipcMain.handle(IPC.javaList, () => java.listJavaSummary())
  ipcMain.handle(IPC.javaAddCustom, (_e, p: string) => java.addCustomJava(String(p ?? '')))
  // 文件选择器添加 Java：选完即真实执行 -version 校验，通过则入库并返回最新列表
  ipcMain.handle(IPC.javaPickAdd, async () => {
    const win = getWin()
    const isWin = process.platform === 'win32'
    const opts = {
      title: '选择 Java 可执行文件（java.exe / java）',
      filters: isWin
        ? [
            { name: 'Java 可执行文件', extensions: ['exe'] },
            { name: '所有文件', extensions: ['*'] }
          ]
        : [{ name: '所有文件', extensions: ['*'] }],
      properties: ['openFile' as const]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    java.addCustomJava(r.filePaths[0]) // 校验失败会抛出「这不是有效的 Java…」
    return java.scanJava()
  })
  ipcMain.handle(IPC.javaHide, (_e, p: string) => java.hideJava(String(p ?? '')))
  ipcMain.handle(IPC.javaRefresh, async (_event, refresh?: boolean) => {
    if (activeJavaScanTaskId) throw new Error('Java 扫描已在进行中')
    const task = registerTask('扫描本机 Java', 'java')
    activeJavaScanTaskId = task.id
    const progressGuard = new ProgressEventGuard()
    const taskEmit = (event: ProgressEvent): void => {
      const normalized = progressGuard.normalize(event)
      emit({ ...normalized, taskId: task.id, taskTitle: task.title })
    }
    try {
      const result = await java.scanJavaInstallations({
        refresh: refresh !== false,
        signal: task.controller.signal,
        emit: taskEmit
      })
      send(IPC_EVENT.taskDone, { taskId: task.id, ok: true })
      return result
    } catch (error) {
      const cancelled = isCancelError(error)
      send(IPC_EVENT.taskDone, {
        taskId: task.id,
        ok: false,
        cancelled,
        error: cancelled ? '已取消' : errText(error),
        stage: 'java-scan'
      })
      throw error
    } finally {
      activeJavaScanTaskId = null
      finishTask(task.id)
    }
  })
  ipcMain.handle(IPC.javaCancelScan, () =>
    activeJavaScanTaskId ? cancelTaskAndWait(activeJavaScanTaskId) : false
  )

  // ---------------- 皮肤/披风（同步 await 返回，错误经 invoke reject 给前端） ----------------
  ipcMain.handle(IPC.skinProfile, (_event, refresh?: boolean) => skins.getProfile(refresh === true))
  ipcMain.handle(IPC.skinUpload, (_e, filePath: string, variant: SkinVariant) =>
    skins.uploadSkin(String(filePath ?? ''), variant)
  )
  ipcMain.handle(IPC.skinCape, (_e, capeId: string | null) => skins.changeCape(capeId ?? null))
  ipcMain.handle(IPC.skinHistory, () => skins.history())
  ipcMain.handle(IPC.skinHistoryDelete, (_e, id: string) =>
    skins.historyDelete(String(id ?? ''))
  )
  ipcMain.handle(IPC.skinHistoryRename, (_e, id: string, name: string) =>
    skins.historyRename(String(id ?? ''), String(name ?? ''))
  )
  ipcMain.handle(IPC.skinUploadHistory, (_e, id: string) =>
    skins.uploadHistory(String(id ?? ''))
  )
  ipcMain.handle(IPC.skinAvatar, (_e, accountId?: string) => skins.getAvatar(accountId ? String(accountId) : undefined))

  // ---------------- 游戏 ----------------
  // 异步执行；开始发 launching，退出/错误经 event:launchState 推送
  ipcMain.handle(IPC.gameLaunch, (_e, versionId: string, serverAddress?: string, requestedFolder?: string, createCommandWorld = false) => {
    // 多开支持：不再因已有游戏运行而拒绝新启动
    if (typeof versionId !== 'string' || !versionId.trim()) throw new Error('请选择有效的游戏实例')
    const config = settings.getSettings()
    const folder = requestedFolder || config.activeFolder || config.gameDir
    if (!config.folders.some(f => pathIdentity(f.path) === pathIdentity(folder))) throw new Error('目标游戏文件夹未注册')
    if (!versions.scanInstalledFolder(folder).versions.some(v => v.id === versionId && !v.failed && !v.incomplete)) throw new Error('目标实例不存在或不完整，请刷新版本列表')
    launcherLogInfo('game', `收到启动请求：version=${String(versionId ?? '')}`)
    sendState({ status: 'launching', text: '正在准备启动…' })
    void withGameFolder(folder, () => launch
      .launch(
        versionId,
        emit,
        (line) => send(IPC_EVENT.launchLog, line),
        (s) => {
          if (s.status === 'error') launcherLogError('game', `启动状态异常：${s.text}`)
          else if (s.status === 'exited') {
            const code = s.code ?? 0
            if (code === 0) launcherLogInfo('game', `游戏正常退出（code=0）：${s.text}`)
            else launcherLogWarn('game', `游戏异常退出（code=${code}）：${s.text}`)
          } else launcherLogInfo('game', `启动状态 ${s.status}：${s.text}`)
          sendState(s)
          // 设置项生效：游戏成功进入运行状态后关闭启动器窗口
          if (s.status === 'running' && settings.getSettings().closeAfterLaunch) {
            setTimeout(() => getWin()?.close(), 1500)
          }
        },
        serverAddress ? String(serverAddress) : undefined,
        { createCommandWorld: createCommandWorld === true }
      )
      .catch((err) => {
        launch.recordLaunchPreparationError(String(versionId ?? ''), errText(err))
        launcherLogError('game', '启动准备失败', err)
        sendState({ status: 'error', text: errText(err) })
      }))
  })
  ipcMain.handle(IPC.gameKill, (_e, forceToken?: string) => launch.killGame(forceToken))
  ipcMain.handle(IPC.gameRestart, (_e, versionId: string, folder: string, forceToken?: string) => launch.restartGame(versionId, folder, forceToken))
  ipcMain.handle(IPC.gameRestartCancel, () => launch.cancelRestart())
  // 导出启动失败日志包（保存对话框在 main 弹出）
  ipcMain.handle(IPC.launchExportLogs, (_e, versionId: string) =>
    exportLaunchLogs(getWin(), String(versionId ?? ''))
  )

  // ---------------- 游戏目录迁移 ----------------
  ipcMain.handle(IPC.gameDirMigrate, (_e, newDir: string, migrate: boolean) => {
    void gamedir
      .migrateGameDir(String(newDir ?? ''), migrate === true, emit)
      .then((dir) => send(IPC_EVENT.gameDirDone, { ok: true, gameDir: dir }))
      .catch((err) => send(IPC_EVENT.gameDirDone, { ok: false, error: errText(err) }))
  })

  // ---------------- 服务器 ----------------
  ipcMain.handle(IPC.serversList, () => servers.listServers())
  ipcMain.handle(IPC.serversAdd, (_e, name: string, address: string) =>
    servers.addServer(String(name ?? ''), String(address ?? ''))
  )
  ipcMain.handle(IPC.serversRemove, (_e, id: string) => servers.removeServer(String(id ?? '')))
  ipcMain.handle(IPC.serversEdit, (_e, id: string, name: string, address: string) =>
    servers.editServer(String(id ?? ''), String(name ?? ''), String(address ?? ''))
  )
  ipcMain.handle(IPC.serversPing, (_e, address: string) =>
    servers.pingServer(String(address ?? ''))
  )
  ipcMain.handle(IPC.serversBind, (_e, id: string, versionId: string, folder?: string) =>
    servers.bindServer(String(id ?? ''), String(versionId ?? ''), folder ? String(folder) : undefined)
  )
  ipcMain.handle(IPC.serversSyncFromDat, (_e, versionId?: string, folder?: string) =>
    servers.syncFromServersDat(
      versionId ? String(versionId) : undefined,
      folder ? String(folder) : undefined
    )
  )
  ipcMain.handle(
    IPC.serversPrepareLaunch,
    (_e, id: string, versionId?: string, folder?: string) =>
      servers.prepareServerLaunch(
        String(id ?? ''),
        versionId ? String(versionId) : undefined,
        folder ? String(folder) : undefined
      )
  )

  // ---------------- MOD 拖入即装 ----------------
  ipcMain.handle(IPC.modsParse, (_e, paths: string[]) => {
    const { files, skipped } = modinfo.expandJarPaths(
      Array.isArray(paths) ? paths.map(String) : []
    )
    const list = files.map((f) => modinfo.parseModFile(f))
    // 非 jar 文件逐个给出原因，不静默吞掉
    for (const s of skipped) {
      list.push({
        filePath: s,
        fileName: s,
        id: '',
        name: '',
        version: '',
        loader: null,
        mcRange: '',
        dependencies: [],
        error: '不支持的文件类型（仅支持 .jar 或包含 .jar 的文件夹）'
      })
    }
    return list
  })
  ipcMain.handle(IPC.modsDuplicates, (_e, versionId: string) =>
    modinfo.findDuplicates(String(versionId ?? ''))
  )
  ipcMain.handle(IPC.modsCrossDuplicates, (_e, versionIds: string[]) =>
    modinfo.findCrossDuplicates(Array.isArray(versionIds) ? versionIds.map(String) : [])
  )
  ipcMain.handle(IPC.modsCheckUpdates, (_e, versionId: string, folder?: string) =>
    withGameFolder(folder || folderOfVersion(String(versionId ?? '')), () =>
      modUpdates.checkModUpdates(String(versionId ?? ''))
    )
  )
  ipcMain.handle(IPC.modsApplyUpdates, (_e, versionId: string, items: unknown, folder?: string) =>
    withGameFolder(folder || folderOfVersion(String(versionId ?? '')), () =>
      modUpdates.applyModUpdates(String(versionId ?? ''), Array.isArray(items) ? items : [])
    )
  )

  // ---------------- 插件系统 ----------------
  ipcMain.handle(IPC.pluginsList, () => plugins.listPlugins())
  ipcMain.handle(IPC.pluginsInstall, async () => {
    const win = getWin()
    const opts = {
      properties: ['openFile' as const],
      title: '选择插件（.js 文件）',
      filters: [{ name: 'KAMUCL 插件', extensions: ['js'] }]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return plugins.listPlugins()
    plugins.installPlugin(r.filePaths[0])
    return plugins.listPlugins()
  })
  ipcMain.handle(IPC.pluginsSetEnabled, (_e, id: string, enabled: boolean) =>
    plugins.setPluginEnabled(String(id ?? ''), enabled === true)
  )
  ipcMain.handle(IPC.pluginsRemove, (_e, id: string) => plugins.removePlugin(String(id ?? '')))
  ipcMain.handle(IPC.pluginsReadCode, (_e, id: string) => plugins.readPluginCode(String(id ?? '')))
  ipcMain.handle(IPC.pluginsOpenDir, () => {
    const dir = plugins.pluginsRoot()
    fs.mkdirSync(dir, { recursive: true })
    void shell.openPath(dir)
  })

  // ---------------- 默认按键 ----------------
  ipcMain.handle(IPC.keysGetDefault, () => keybindings.getDefaultKeys())
  ipcMain.handle(IPC.keysSetDefault, (_e, id: string, bind: string) =>
    keybindings.setDefaultKey(String(id ?? ''), String(bind ?? ''))
  )
  ipcMain.handle(IPC.keysReset, () => keybindings.resetDefaultKeys())
  ipcMain.handle(IPC.optionsGetDefault, () => keybindings.getDefaultOptions())
  ipcMain.handle(IPC.optionsSetDefault, (_e, id: string, value: string) =>
    keybindings.setDefaultOption(String(id ?? ''), String(value ?? ''))
  )
  ipcMain.handle(IPC.optionsReset, () => keybindings.resetDefaultOptions())
  ipcMain.handle(IPC.optionsImportPacks, (_e, paths: string[]) =>
    keybindings.importDefaultResourcePacks(Array.isArray(paths) ? paths.map(String) : [])
  )
  ipcMain.handle(IPC.optionsRemovePack, (_e, name: string) =>
    keybindings.removeDefaultResourcePack(String(name ?? ''))
  )

  // ---------------- 桥接 MOD 实时配置面板 ----------------
  ipcMain.handle(IPC.bridgeStatus, (_e, versionId: string) => modBridge.bridgeStatus(String(versionId ?? '')))
  ipcMain.handle(IPC.bridgeManifest, (_e, versionId: string) => modBridge.bridgeManifest(String(versionId ?? '')))
  ipcMain.handle(IPC.bridgeSet, (_e, versionId: string, id: string, value: unknown) =>
    modBridge.bridgeSet(String(versionId ?? ''), String(id ?? ''), value)
  )
  ipcMain.handle(IPC.bridgeReset, (_e, versionId: string, id?: string) =>
    modBridge.bridgeReset(String(versionId ?? ''), id ? String(id) : undefined)
  )
  ipcMain.handle(IPC.bridgeInstalled, (_e, versionId: string) => modBridge.bridgeInstalled(String(versionId ?? '')))
  ipcMain.handle(IPC.bridgeInstall, (_e, versionId: string) => modBridge.installBridge(String(versionId ?? '')))

  const modTargets = () => scanModTargets(settings.getSettings().folders.map(f => f.path), versions.scanInstalledFolder)
  ipcMain.handle(IPC.modsTargets, () => modTargets())
  ipcMain.handle(IPC.modsPrepare, async (_e, ref: { id: string; folder: string }, input: { paths?: string[]; file?: CommunityFile }) => {
    const target = selectModTarget(modTargets().versions, ref.id, ref.folder)
    return prepareModInstall(target, input, emit)
  })
  ipcMain.handle(IPC.modsDiscard, (_e, id: string) => discardModPlan(String(id)))
  ipcMain.handle(IPC.modsCommit, async (_e, id: string, includeDependencies: boolean) => {
    const task = registerTask('安装 MOD 与前置依赖', 'download')
    try {
      const result = await executeModPlan(id, includeDependencies === true,
        ref => {
          // 多开时代：仅禁止向正在运行的目标实例装 MOD
          if (launch.getRunningVersionIds().has(ref.id)) throw new Error('目标实例正在运行，未安装任何 MOD；请退出该游戏后重试')
          return selectModTarget(modTargets().versions, ref.id, ref.folder!)
        },
        e => emit({ ...e, taskId: task.id, taskTitle: task.title }), task.controller.signal)
      send(IPC_EVENT.taskDone, { taskId: task.id, ok: true })
      return result
    } catch (error) {
      send(IPC_EVENT.taskDone, { taskId: task.id, ok: false, error: errText(error), cancelled: isCancelError(error) })
      throw error
    } finally { finishTask(task.id) }
  })
  ipcMain.handle(IPC.modsInstall, async (_e, files: string[], targetVersionId: string, folder?: string) => {
    const target = selectModTarget(modTargets().versions, String(targetVersionId ?? ''), folder ?? folderOfVersion(targetVersionId))
    return copyCompatibleMods(Array.isArray(files) ? files.map(String) : [], target, modinfo.parseModFile)
  })

  // ---------------- 文件/目录 ----------------
  const safeDir = (rel: string): string => {
    // 允许 gameDir 下单级子目录（mods 等）或 versions/<id>/<sub> 三级（版本实例目录），防目录穿越
    const parts = String(rel ?? '')
      .split(/[\\/]+/)
      .filter((s) => s && s !== '.')
    if (parts.some((s) => s === '..')) throw new Error('非法目录')
    const isVersionPath = parts[0] === 'versions'
    if (parts.length > (isVersionPath ? 3 : 2)) throw new Error('非法目录')
    // versions/<id> 前缀按版本所属文件夹寻址（多文件夹体系）；其余按当前活动文件夹
    const base = isVersionPath && parts.length >= 2 ? folderOfVersion(parts[1]) : settings.getSettings().gameDir
    const dir = parts.length ? path.join(base, ...parts) : base
    if (!path.resolve(dir).startsWith(path.resolve(base))) throw new Error('非法目录')
    return dir
  }
  const listDir = (rel: string): FsEntry[] => {
    const dir = safeDir(rel)
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .map((d) => {
          try {
            const st = fs.statSync(path.join(dir, d.name))
            return { name: d.name, size: st.size, isDir: d.isDirectory(), mtime: st.mtimeMs }
          } catch {
            return { name: d.name, size: 0, isDir: d.isDirectory(), mtime: 0 }
          }
        })
        .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
    } catch {
      return []
    }
  }
  ipcMain.handle(IPC.appOpenDir, (_e, rel?: string) => {
    const dir = safeDir(String(rel ?? ''))
    fs.mkdirSync(dir, { recursive: true })
    void shell.openPath(dir)
  })
  ipcMain.handle(IPC.fsList, (_e, rel: string) => listDir(String(rel ?? '')))
  ipcMain.handle(IPC.fsRemove, (_e, rel: string, name: string) => {
    const dir = safeDir(String(rel ?? ''))
    const target = path.join(dir, path.basename(String(name ?? '')))
    fs.rmSync(target, { recursive: true, force: true })
    return listDir(String(rel ?? ''))
  })
}
