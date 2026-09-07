/**
 * 游戏启动：版本链合并、classpath/natives 处理、JVM/游戏参数组装、进程管理
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createCommandWorld } from './commandWorld'
import { requestGameWindowClose, focusGameWindow } from './gracefulClose'
import { logScope } from './launcherLog'

const launchLog = logScope('launch')
import { reuseExternalRuntimeLibraries } from './externalRuntime'
import { repairNeoRuntime } from './loaders'
import { pathIdentity } from './folderPaths'
import { spawn } from 'node:child_process'
import { GameSession } from './gameSession'
import { app, screen } from 'electron'
import AdmZip from 'adm-zip'
import type { LaunchState, ProgressEvent } from '../../shared/types'
import { getSettings } from './settings'
import { getValidAccount, selectedAccount } from './accounts'
import { ensureJava, requiredMajor, scanJava, resolveJavaExecutable } from './java'
import {
  assetIndexPath,
  assetsDir,
  baseVersionJarPath,
  gameDir,
  librariesDir,
  nativesDir,
  versionJarPath,
  versionJsonPath,
  virtualLegacyDir
} from './paths'
import { withGameFolder } from './paths'
import {
  clientJarPath,
  installClientJarOnly,
  installVanilla,
  libraryTasks,
  readVersionJson,
  resolveVersionChain,
  resolvedLibraries,
  rulesAllow,
  type ArgumentEntry,
  type VersionJson
} from './versions'
import { downloadAll } from './download'
import { instanceDirectoryState } from './instances'
import { buildGameWindowArguments, resolveGameResolution } from './gameWindow'
import { supportsQuickPlayMultiplayer } from './serverUtils'
import * as yggdrasil from './yggdrasil'
import { serializeYggdrasilUserProperties } from './yggdrasilProvider'

export type ProgressEmit = (e: ProgressEvent) => void
export type SendLog = (line: string) => void
export type OnState = (s: LaunchState) => void

const gameSession = new GameSession()
export const isBusy = () => gameSession.busy || !!restartPending
interface LaunchOptions { createCommandWorld?: boolean; singleplayerWorld?: string }
interface Invocation { versionId: string; folder: string; emit: ProgressEmit; sendLog: SendLog; onState: OnState; serverAddress?: string; options: LaunchOptions }
let invocation: Invocation | undefined
let restartPending: { invocation: Invocation; sessionToken?: symbol; forceToken?: string; waiting: boolean } | undefined

export function cancelRestart(): void {
  if (restartPending?.waiting) throw new Error('仍在等待游戏正常退出，请稍后取消')
  restartPending = undefined
}

/** Holds ownership across close -> relaunch so another click cannot race into the gap. */
export async function restartGame(versionId: string, folder: string, forceToken?: string): Promise<{ requiresForce: boolean; forceToken?: string }> {
  launchLog.info(`请求重启实例 ${versionId}${forceToken ? '（已带强杀确认）' : ''}`)
  const targetToken = gameSession.tokenOf(versionId)
  if (forceToken) {
    if (!restartPending || restartPending.waiting || restartPending.forceToken !== forceToken || restartPending.invocation.versionId !== versionId || pathIdentity(restartPending.invocation.folder) !== pathIdentity(folder)) throw new Error('重启确认已失效，请重新请求')
    restartPending.waiting = true
    try { if (targetToken) await gameSession.stop(8000, targetToken) }
    catch (error) { restartPending = undefined; launchLog.error(`重启确认后强制停止游戏失败：${versionId}`, error); throw error }
  } else {
    if (restartPending) throw new Error('已有重启请求正在处理')
    if (!invocation || !targetToken || invocation.versionId !== versionId || pathIdentity(invocation.folder) !== pathIdentity(folder)) throw new Error('此实例当前未运行；请选择启动实例')
    restartPending = { invocation, sessionToken: targetToken, waiting: true }
    try { await gameSession.stopGracefully(requestGameWindowClose, 30000, targetToken) }
    catch {
      launchLog.warn(`实例 ${versionId} 30 秒内未正常退出，需要用户确认强杀后重启`)
      restartPending.waiting = false
      restartPending.forceToken = crypto.randomUUID()
      return { requiresForce: true, forceToken: restartPending.forceToken }
    }
  }
  const previous = restartPending.invocation
  try {
    previous.onState({ status: 'launching', text: '游戏已确认退出，正在重新启动同一实例…' })
    const token = gameSession.reserve(previous.versionId)
    try {
      await withGameFolder(previous.folder, () => launchOwned(previous.versionId, previous.emit, previous.sendLog, previous.onState, previous.serverAddress, token, { ...previous.options, createCommandWorld: false }))
    } catch (error) { gameSession.release(token); previous.onState({ status: 'error', text: error instanceof Error ? error.message : String(error) }); throw error }
    return { requiresForce: false }
  } finally { restartPending = undefined }
}

/** 当前正在运行的全部游戏版本 id（多开支持；改名等写操作前校验） */
export function getRunningVersionIds(): Set<string> {
  return gameSession.runningIds()
}

/** 最近一次会话的版本 id（兼容旧调用） */
export function getRunningVersionId(): string | null {
  return gameSession.versionId
}

/** 最近一次启动的上下文（导出错误日志摘要用） */
export interface LastLaunchInfo {
  versionId: string
  javaPath: string
  startedAt: string
  effectiveGameDir?: string
  logDir?: string
  commandSummary?: string
  pid?: number
  exitCode?: number | null
  endedAt?: string
  spawnError?: string
  windowMode?: 'windowed' | 'maximized' | 'fullscreen'
  windowWidth?: number
  windowHeight?: number
}
let lastLaunch: LastLaunchInfo | null = null
export function getLastLaunch(): LastLaunchInfo | null {
  return lastLaunch
}

/** 记录 Java 进程创建前的准备失败，仅供诊断导出，不改变启动流程。 */
export function recordLaunchPreparationError(versionId: string, message: string): void {
  if (!lastLaunch || lastLaunch.versionId !== versionId) {
    lastLaunch = { versionId, javaPath: '', startedAt: new Date().toISOString() }
  }
  lastLaunch.spawnError = message
  lastLaunch.endedAt = new Date().toISOString()
}

/** 终止当前游戏进程 */
export const killGame = (forceToken?: string) => {
  launchLog.info('收到终止游戏进程请求')
  if (restartPending) throw new Error('正在处理重启，请先完成或取消重启请求')
  return gameSession.requestStop(requestGameWindowClose, forceToken)
}

/**
 * 沿 inheritsFrom 读取版本链并合并：
 * - libraries 合并（子在前）
 * - arguments 合并（父在前，子的 game/jvm 追加在后，兼容 forge/fabric）
 * - mainClass/type/assets/assetIndex/javaVersion/minecraftArguments 子缺省继承父
 * 返回合并结果与链条最底层原版 id（client jar 用它的）。
 * 实现复用 versions.resolveVersionChain（与 flatten 自包含语义一致）。
 */
function resolveChain(id: string): { merged: VersionJson; baseId: string } {
  return resolveVersionChain(id)
}

/** 按空格拆分用户 JVM 参数，支持简单双引号 */
function splitArgs(s: string): string[] {
  if (!s.trim()) return []
  return (s.match(/"[^"]*"|[^\s"]+/g) ?? []).map((x) => x.replace(/^"|"$/g, ''))
}

/** 把子进程输出按行切分转发 */
function makeLinePusher(sendLog: SendLog): (chunk: Buffer) => void {
  let buf = ''
  return (chunk: Buffer) => {
    buf += chunk.toString('utf-8')
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '')
      buf = buf.slice(idx + 1)
      if (line) sendLog(line)
    }
  }
}

/**
 * 启动游戏。
 * emit 进度 / sendLog 日志行 / onState 状态回调（running/exited/error）。
 */
export async function launch(
  versionId: string,
  emit: ProgressEmit,
  sendLog: SendLog,
  onState: OnState,
  serverAddress?: string,
  options: LaunchOptions = {}
): Promise<void> {
  if (restartPending) throw new Error('正在重启游戏，请稍后再启动')
  const token = gameSession.reserve(versionId)
  launchLog.info(`开始启动实例 ${versionId}${serverAddress ? `（直达服务器 ${serverAddress}）` : ''}`)
  invocation = { versionId, folder: gameDir(), emit, sendLog, onState, serverAddress, options: { ...options } }
  try { await launchOwned(versionId, emit, sendLog, onState, serverAddress, token, invocation.options) }
  catch (error) {
    gameSession.release(token)
    launchLog.error(`实例 ${versionId} 启动失败`, error)
    throw error
  }
}

async function launchOwned(
  versionId: string, emit: ProgressEmit, sendLog: SendLog, onState: OnState,
  serverAddress: string | undefined, token: symbol, options: LaunchOptions = {}
): Promise<void> {
  const settings = getSettings()

  // 日志落盘：gameDir/kamucl-logs/latest.log（每次启动覆盖）
  let logStream: fs.WriteStream | null = null
  let stdoutStream: fs.WriteStream | null = null
  let stderrStream: fs.WriteStream | null = null
  const launchLogDir = path.join(gameDir(), 'kamucl-logs')
  try {
    fs.mkdirSync(launchLogDir, { recursive: true })
    logStream = fs.createWriteStream(path.join(launchLogDir, 'latest.log'), { flags: 'w' })
    stdoutStream = fs.createWriteStream(path.join(launchLogDir, 'stdout.log'), { flags: 'w' })
    stderrStream = fs.createWriteStream(path.join(launchLogDir, 'stderr.log'), { flags: 'w' })
    logStream.on('error', () => undefined)
    stdoutStream.on('error', () => undefined)
    stderrStream.on('error', () => undefined)
  } catch {
    logStream = null
  }
  const log: SendLog = (line) => {
    sendLog(line)
    try {
      logStream?.write(line + '\n')
    } catch {
      /* 忽略写入失败 */
    }
  }

  let spawned = false
  const pipelineStarted = Date.now()
  try {
  launchLog.debug(`启动管线开始：实例 ${versionId}`)
  // a0) 自愈：版本链 json 缺失或链底客户端 jar 缺失时，自动补全下载原版文件
  let baseIdProbe = versionId
  let chainBroken = false
  try {
    let cur: VersionJson = readVersionJson(versionId)
    while (cur.inheritsFrom) {
      baseIdProbe = cur.inheritsFrom
      cur = readVersionJson(baseIdProbe)
    }
  } catch (e) {
    if (baseIdProbe === versionId) {
      // 连入口版本的 json 都丢了，无法推断链条，只能重装
      throw new Error(`版本 ${versionId} 文件丢失，请在游戏版本页重新安装`)
    }
    chainBroken = true
  }
  // 链底原版 json/jar 可能在 versions 区（独立原版）或 .kamucl/base 依赖区（加载器实例的内部依赖）
  const baseInVersions = fs.existsSync(versionJsonPath(baseIdProbe))
  const jarProbe = baseInVersions ? versionJarPath(baseIdProbe) : baseVersionJarPath(baseIdProbe)
  if (chainBroken || !fs.existsSync(jarProbe)) {
    launchLog.info(`检测到实例 ${versionId} 依赖的游戏文件缺失（chainBroken=${chainBroken}），开始自动补全`)
    // 自包含实例（flatten 后）：json 不缺，仅补客户端 jar，绝不重写合并后的 json
    let flattened = false
    try {
      flattened = readVersionJson(versionId)._flattenedAt !== undefined && !readVersionJson(versionId).inheritsFrom
    } catch {
      /* json 读取失败按旧链处理 */
    }
    if (flattened && !chainBroken) {
      emit({ stage: 'repair', progress: 0, text: `检测到游戏本体缺失，正在自动补全…` })
      await installClientJarOnly(versionId, emit)
      emit({ stage: 'repair', progress: 1, text: '文件补全完成' })
    } else {
      emit({
        stage: 'repair',
        progress: 0,
        text: `检测到游戏文件缺失，正在自动补全 ${baseIdProbe}…`
      })
      // installVanilla 内部：json 不在则下载，已存在文件校验跳过，只补缺失部分
      // 自定义命名的原版实例：真实 MC 版本 id 从 _mcVersion 取
      let realId = baseIdProbe
      try {
        realId = readVersionJson(baseIdProbe)._mcVersion ?? baseIdProbe
      } catch {
        /* json 缺失时用 probe（即真实 MC id） */
      }
      // 加载器实例的依赖原版补进 base 区；独立原版实例仍在 versions 区修复
      const dest = baseIdProbe !== versionId && !baseInVersions ? 'base' : 'versions'
      await installVanilla(realId, emit, dest, realId !== baseIdProbe ? baseIdProbe : undefined)
      emit({ stage: 'repair', progress: 1, text: '文件补全完成' })
    }
  }

  // a0.1) 启动与管理页面共用同一个目录判定，避免配置路径、整合包和已存在
  // 独立内容在 UI 与最终 --gameDir 之间出现分歧；assets 仍使用全局共享目录。
  const effectiveGameDir = instanceDirectoryState(versionId, readVersionJson(versionId)).path
  launchLog.debug(`实例 ${versionId} 游戏目录：${effectiveGameDir}`)
  fs.mkdirSync(effectiveGameDir, { recursive: true })

  // 默认中文：仅在 options.txt 不存在时写入（绝不覆盖玩家已有设置）
  try {
    const optFile = path.join(effectiveGameDir, 'options.txt')
    if (!fs.existsSync(optFile)) {
      fs.writeFileSync(optFile, 'lang:zh_cn\n', 'utf-8')
    }
  } catch {
    /* 写入失败不影响启动 */
  }

  // a) 版本链合并
  emit({ stage: 'launch', progress: 0, text: '解析版本信息' })
  const { merged, baseId } = resolveChain(versionId)
  launchLog.debug(`版本链解析完成：${versionId} → 底层 ${baseId}`)
  const instanceConfig = readVersionJson(versionId)
  const instanceMcVersion = instanceConfig._mcVersion ?? baseId

  // 默认按键同步（总开关开启时覆盖实例 options.txt 的 key_* 项，其余行原样保留）
  if (settings.keySync) {
    try {
      const { syncKeysToGameDir, keySyncSupportedForVersion } = await import('./keybindings')
      if (!keySyncSupportedForVersion(instanceMcVersion)) {
        log(`[KAMUCL] Minecraft ${instanceMcVersion} 的键位为数字 keycode 格式，跳过按键同步`)
      } else if (syncKeysToGameDir(effectiveGameDir)) log('[KAMUCL] 已同步默认按键到 options.txt')
    } catch (error) {
      log(`[KAMUCL] 默认按键同步失败（不影响启动）：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // 其他游戏配置同步（独立开关：FOV/灵敏度/亮度/视频/潜行疾跑方式/资源包；按版本适配字段与格式）
  if (settings.optionsSync) {
    try {
      const { syncOptionsToGameDir } = await import('./keybindings')
      if (syncOptionsToGameDir(effectiveGameDir, undefined, instanceMcVersion)) log('[KAMUCL] 已同步其他游戏配置到 options.txt')
    } catch (error) {
      log(`[KAMUCL] 其他游戏配置同步失败（不影响启动）：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const clientJar = clientJarPath(baseId)
  if (!fs.existsSync(clientJar)) {
    throw new Error(`客户端文件缺失（${baseId}.jar），请先完整安装版本 ${baseId}`)
  }
  if (!merged.mainClass) throw new Error('版本 json 缺少 mainClass，文件可能损坏')

  // a1) 依赖库完整性：缺失则自动补下（含 fabric/quilt 的 maven 坐标库）
  const libTasks = libraryTasks(merged)
  const reused = reuseExternalRuntimeLibraries(merged, settings.folders.map(f => f.path), librariesDir(), libTasks.map(t => t.dest))
  if (reused) log(`[KAMUCL] 已复用注册目录中 ${reused} 个运行库文件`)
  await repairNeoRuntime(merged, clientJar, readVersionJson(baseId), emit)
  const missingLibs = libTasks.filter((t) => !fs.existsSync(t.dest))
  if (missingLibs.length) {
    launchLog.info(`检测到 ${missingLibs.length} 个依赖库缺失，正在补全`)
    emit({
      stage: 'repair',
      progress: 0,
      text: `检测到 ${missingLibs.length} 个依赖库缺失，正在补全…`
    })
    await downloadAll(
      missingLibs,
      (d, t, speed) =>
        emit({ stage: 'repair', progress: t ? d / t : 1, text: `补全依赖库 ${d}/${t}`, speed }),
      8,
      settings.mirror
    )
  }

  // b) 账号
  const account = selectedAccount()
  if (!account) throw new Error('尚未选择账号，请先在账号页添加并选择一个账号')
  // 外置登录的会话验证、元数据预取与 agent 校验彼此独立，并行避免拉长启动准备。
  const [validAccount, externalAuthArgs] = await Promise.all([
    getValidAccount(account),
    yggdrasil.launchArguments(account)
  ])

  // c) Java：版本独立指定 > 手动指定 > 自动管理
  emit({ stage: 'java', progress: 0, text: '检查 Java 环境' })
  let javaPath: string
  const versionJava = instanceConfig._javaPath
  if (instanceConfig._javaAuto === true) {
    javaPath = await ensureJava(merged, emit)
  } else if (versionJava) {
    if (!fs.existsSync(versionJava)) {
      throw new Error(`该版本指定的 Java 不存在（${versionJava}），请在版本设置中重新选择`)
    }
    javaPath = versionJava
    emit({ stage: 'java', progress: 1, text: '使用该版本指定的 Java' })
  } else if (settings.javaAuto) {
    javaPath = await ensureJava(merged, emit)
  } else if (settings.javaPath) {
    if (!fs.existsSync(settings.javaPath)) {
      throw new Error('手动指定的 Java 路径不存在，请在设置中重新选择')
    }
    javaPath = settings.javaPath
    emit({ stage: 'java', progress: 1, text: '使用手动指定的 Java' })
  } else {
    const need = requiredMajor(merged)
    const found = scanJava().find((j) => j.major === need && j.is64Bit)
    if (!found) {
      throw new Error(
        `该版本需要 Java ${need} (64位)，但未找到（Java 自动管理已关闭）。请在设置中选择 Java 或开启自动管理`
      )
    }
    javaPath = found.path
    emit({ stage: 'java', progress: 1, text: `使用本机 Java ${found.version}` })
  }
  launchLog.info(`选定 Java（需要 major ${requiredMajor(merged)}）：${javaPath}`)

  // d) classpath 与 natives 解压
  emit({ stage: 'launch', progress: 0.5, text: '准备运行库与 natives' })
  const { artifacts, natives } = resolvedLibraries(merged)
  const nativesPath = nativesDir(versionId)
  fs.mkdirSync(nativesPath, { recursive: true })
  for (const jar of natives) {
    if (!fs.existsSync(jar)) continue
    try {
      const zip = new AdmZip(jar)
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory || entry.entryName.startsWith('META-INF/')) continue
        zip.extractEntryTo(entry, nativesPath, true, true)
      }
    } catch {
      // 单个 natives 解压失败不阻断启动
    }
  }
  const classpath = [...new Set([...artifacts, ...natives, clientJar])].join(path.delimiter)

  // assets（legacy 版本使用虚拟资源目录）
  const indexId = merged.assetIndex?.id ?? merged.assets ?? 'legacy'
  let assetsRoot = assetsDir()
  try {
    const idx = JSON.parse(fs.readFileSync(assetIndexPath(indexId), 'utf-8')) as {
      virtual?: boolean
      map_to_resources?: boolean
    }
    if (idx.virtual === true || idx.map_to_resources === true) assetsRoot = virtualLegacyDir()
  } catch {
    /* 索引缺失时使用默认 assets 根目录 */
  }

  // f) 变量替换表
  const selectedJavaPath = javaPath
  javaPath = await resolveJavaExecutable(javaPath)
  if (selectedJavaPath !== javaPath) log(`[KAMUCL] Java 转发入口已解析到真实运行时: ${javaPath}`)
  const userProperties = serializeYggdrasilUserProperties(validAccount.userProperties)
  const vars: Record<string, string> = {
    auth_player_name: validAccount.username,
    version_name: versionId,
    game_directory: effectiveGameDir,
    assets_root: assetsRoot,
    assets_index_name: merged.assets ?? indexId,
    auth_uuid:
      validAccount.type === 'yggdrasil'
        ? validAccount.uuid.replace(/-/g, '')
        : validAccount.uuid,
    auth_access_token: validAccount.accessToken ?? '',
    auth_session: validAccount.accessToken ?? '',
    clientid: '',
    auth_xuid: '',
    user_type: validAccount.type === 'microsoft' ? 'msa' : 'mojang',
    user_properties: userProperties,
    version_type: 'KAMUCL',
    natives_directory: nativesPath,
    launcher_name: 'KAMUCL',
    launcher_version: app.getVersion(),
    classpath,
    library_directory: librariesDir(),
    classpath_separator: path.delimiter
  }
  const sub = (s: string): string => s.replace(/\$\{([^}]+)\}/g, (m, k) => vars[k] ?? m)

  /** 展开新版 arguments 数组（字符串或带 rules 的对象） */
  const expandEntries = (entries?: (string | ArgumentEntry)[]): string[] => {
    const out: string[] = []
    for (const e of entries ?? []) {
      if (typeof e === 'string') {
        out.push(sub(e))
      } else if (e && rulesAllow(e.rules)) {
        const values = Array.isArray(e.value) ? e.value : [e.value]
        for (const v of values) out.push(sub(v))
      }
    }
    return out
  }

  // 游戏参数：新版 arguments.game / 旧版 minecraftArguments
  let gameArgs: string[]
  if ((merged.arguments?.game?.length ?? 0) > 0) {
    gameArgs = expandEntries(merged.arguments?.game)
  } else if (merged.minecraftArguments) {
    gameArgs = merged.minecraftArguments.split(/\s+/).filter(Boolean).map(sub)
  } else {
    throw new Error('版本 json 缺少游戏参数，文件可能损坏')
  }

  // e) JVM 参数
  // Xmx 按真实物理内存钳制：配置文件可能被手改或从大内存机器迁移过来，
  // 超出物理内存的分配会让 JVM 起不来或系统整卡死。
  const totalMemMB = Math.floor(os.totalmem() / 1024 / 1024)
  const mem = Math.min(Math.max(512, settings.memoryMB || 4096), totalMemMB)
  // forge ignoreList 需精确匹配 -cp 上的原版客户端 jar 文件名：实例自定义命名时
  // ${version_name}.jar 与实际 clientJar 不一致，原版 jar 会被模块系统当作自动模块
  // 与 fml 合成的 minecraft 模块重复导出包（ResolutionException 闪退），补写真实文件名
  const clientJarName = path.basename(clientJar)
  const jsonJvmArgs = expandEntries(merged.arguments?.jvm).map((a) =>
    a.startsWith('-DignoreList=') && !a.split(',').some((x) => x.trim() === clientJarName)
      ? `${a},${clientJarName}`
      : a
  )
  const jvmArgs: string[] = [
    `-Xmx${mem}M`,
    `-Xms${Math.min(mem, 1024)}M`,
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-Dfile.encoding=UTF-8',
    // macOS 上 LWJGL 必须在主线程启动 AWT
    ...(process.platform === 'darwin' ? ['-XstartOnFirstThread'] : []),
    `-Djava.library.path=${nativesPath}`,
    `-Djna.tmpdir=${nativesPath}`,
    // 外置登录 javaagent 与预取元数据必须位于主类之前。
    ...externalAuthArgs,
    // 版本 json 自带的 JVM 参数（forge 的 -p ${classpath} 等依赖它）
    ...jsonJvmArgs,
    ...splitArgs(settings.jvmArgs)
  ]

  // e2) 实例覆盖 > 全局设置。全屏不混入窗口尺寸；最大化使用当前显示器工作区。
  const resolution = resolveGameResolution(settings.resolution, instanceConfig._resolution)
  let workArea: { width: number; height: number } | undefined
  if (resolution.mode === 'maximized') {
    try {
      workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workAreaSize
    } catch {
      /* 无显示器上下文时回退到配置宽高，仍保持窗口模式。 */
    }
  }
  const windowArgs = buildGameWindowArguments(gameArgs, resolution, workArea)
  gameArgs = windowArgs.args

  // e3) 官方 Quick Play 自 Java 1.20 起支持；旧版只启动正确实例，不注入未知参数。
  const minecraftVersion = instanceConfig._mcVersion ?? baseId
  if (options.createCommandWorld) {
    const world = createCommandWorld(effectiveGameDir, clientJar)
    options.singleplayerWorld = world.id
    log(`[KAMUCL] 已新建允许命令的创造测试世界：${world.path}`)
  }
  if (options.singleplayerWorld) {
    if (!fs.existsSync(path.join(effectiveGameDir, 'saves', options.singleplayerWorld, 'level.dat'))) throw new Error('待进入的测试世界不存在，未创建重复世界')
    gameArgs.push('--quickPlaySingleplayer', options.singleplayerWorld)
  } else if (serverAddress && supportsQuickPlayMultiplayer(minecraftVersion)) {
    gameArgs.push('--quickPlayMultiplayer', serverAddress)
  } else if (serverAddress) {
    log(`[KAMUCL] Minecraft ${minecraftVersion} 不支持 Quick Play，已仅启动实例`)
  }

  // g) 启动进程
  const args = [...jvmArgs, '-cp', classpath, merged.mainClass, ...gameArgs]
  // 日志中隐藏 accessToken
  const privateLaunchValues = new Set(
    [validAccount.accessToken, validAccount.clientToken, userProperties].filter(
      (value): value is string => !!value
    )
  )
  const logArgs = args.map((argument) => {
    if (argument.startsWith('-Dauthlibinjector.yggdrasil.prefetched=')) {
      return '-Dauthlibinjector.yggdrasil.prefetched=<metadata>'
    }
    if (privateLaunchValues.has(argument)) return '***'
    if (validAccount.accessToken && argument.includes(validAccount.accessToken)) {
      return argument.replaceAll(validAccount.accessToken, '***')
    }
    return argument
  })
  const commandSummary = `${javaPath} ${logArgs.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`
  log(
    `[KAMUCL] 游戏窗口: mode=${windowArgs.mode}` +
      (windowArgs.width && windowArgs.height
        ? `, width=${windowArgs.width}, height=${windowArgs.height}`
        : ', fullscreen=true')
  )
  log(`[KAMUCL] 启动命令: ${commandSummary}`)
  launchLog.debug(`启动命令：${commandSummary}`)
  launchLog.info(`启动准备完成（耗时 ${Date.now() - pipelineStarted}ms），正在创建游戏进程`)

  emit({ stage: 'launch', progress: 1, text: '启动游戏进程' })
  const proc = spawn(javaPath, args, { cwd: effectiveGameDir })
  gameSession.attach(token, proc)
  spawned = true
  const spawnedAt = Date.now()
  lastLaunch = {
    versionId,
    javaPath,
    startedAt: new Date().toISOString(),
    effectiveGameDir,
    logDir: launchLogDir,
    commandSummary,
    windowMode: windowArgs.mode,
    windowWidth: windowArgs.width,
    windowHeight: windowArgs.height,
    pid: proc.pid
  }
  proc.once('spawn', () => {
    launchLog.info(`游戏进程已启动：pid=${proc.pid}`)
    onState({ status: 'running', text: '游戏进程已启动' })
  })
  // QuickPlay 直达（创建命令世界/进服）：游戏窗口出现后拉到前台，避免鼠标被锁在未聚焦窗口里
  if (options.singleplayerWorld || serverAddress) {
    void focusGameWindow(proc).then(() => log('[KAMUCL] 游戏窗口已聚焦')).catch(error => log(`[KAMUCL] 自动聚焦未完成：${error.message}；请点击任务栏中的 Minecraft 窗口`))
  }

  const pushStdout = makeLinePusher((line) => {
    stdoutStream?.write(line + '\n')
    log(line)
  })
  const pushStderr = makeLinePusher((line) => {
    stderrStream?.write(line + '\n')
    log(line)
  })
  proc.stdout?.on('data', pushStdout)
  proc.stderr?.on('data', pushStderr)
  proc.on('error', (err) => {
    // A failed kill can also emit 'error'; it is not evidence that the game exited.
    if (proc.pid && proc.exitCode === null && proc.signalCode === null) {
      launchLog.warn(`进程操作失败，仍在跟踪游戏：${err.message}`)
      log(`进程操作失败，仍在跟踪游戏: ${err.message}`)
      return
    }
    if (!gameSession.release(token)) return
    launchLog.error(`游戏进程启动失败：pid=${proc.pid ?? '未知'}`, err)
    logStream?.end()
    stdoutStream?.end()
    stderrStream?.end()
    if (lastLaunch) {
      lastLaunch.spawnError = err.message
      lastLaunch.endedAt = new Date().toISOString()
    }
    onState({ status: 'error', text: `进程启动失败: ${err.message}` })
  })
  proc.on('close', (code) => {
    if (!gameSession.release(token)) return
    const runS = spawnedAt ? Math.round((Date.now() - spawnedAt) / 1000) : null
    const intentional = restartPending?.sessionToken === token || gameSession.wasIntentionalStop(token)
    if (code === 0) launchLog.info(`实例 ${versionId} 游戏正常退出（code=0${runS !== null ? `，运行 ${runS}s` : ''}）`)
    else if (intentional) launchLog.info(`实例 ${versionId} 游戏按用户要求退出（code=${code ?? '未知'}）`)
    else launchLog.warn(`实例 ${versionId} 游戏异常退出（code=${code ?? '未知'}${runS !== null ? `，运行 ${runS}s` : ''}），如频繁出现请导出错误日志`)
    logStream?.end()
    stdoutStream?.end()
    stderrStream?.end()
    if (lastLaunch) {
      lastLaunch.exitCode = code
      lastLaunch.endedAt = new Date().toISOString()
    }
    onState({ status: 'exited', code: code ?? 0, intentionalRestart: restartPending?.sessionToken === token, intentionalStop: gameSession.wasIntentionalStop(token), text: `游戏已退出 (code=${code ?? 0})` })
  })
  } finally {
    if (!spawned) { logStream?.end(); stdoutStream?.end(); stderrStream?.end() }
  }
}
