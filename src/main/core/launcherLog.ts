/**
 * 启动器日志核心：
 * - 级别（debug/info/warn/error）+ 作用域（logScope('launch').info(...)）+ Error 序列化
 * - 异步队列批量刷盘（fs.promises.appendFile），日志自身任何错误静默吞掉，绝不影响业务
 * - 每次会话把旧 launcher-current.log 归档为 launcher-YYYYMMDD-HHMMSS.log，保留最近 7 份
 * - flushLauncherLog / flushLauncherLogSync 供退出路径确保写完
 * 纯函数（归档命名/修剪选择/行格式/错误序列化/级别过滤）单独导出，可在测试中直接验证。
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { redactDiagnosticText } from './diagnostics'

export type LauncherLogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LauncherLogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const ARCHIVE_KEEP = 7
/** 批量刷盘间隔：日志高频场景下合并写，降低 I/O 次数 */
const FLUSH_INTERVAL_MS = 150
const FLUSH_MAX_PENDING = 256

const ARCHIVE_PATTERN = /^launcher-(\d{8}-\d{6})(?:-(\d+))?\.log$/

// ---------------- 可纯测核心 ----------------

/** 级别过滤：达到最低级别才写。环境变量 KAMUCL_LOG_LEVEL 可调，默认 debug 全量。 */
export function levelAtLeast(level: LauncherLogLevel, minimum: LauncherLogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minimum]
}

export function minimumLevelFromEnv(env: Record<string, string | undefined> = process.env): LauncherLogLevel {
  const raw = (env.KAMUCL_LOG_LEVEL ?? '').trim().toLowerCase()
  return raw === 'info' || raw === 'warn' || raw === 'error' ? raw : 'debug'
}

/** 归档文件名：launcher-YYYYMMDD-HHMMSS.log */
export function archivedLogFileName(date: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp =
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  return `launcher-${stamp}.log`
}

/**
 * 从归档文件名列表中选出应删除的文件：按文件名内时间戳倒序保留最近 keep 份。
 * 仅认 launcher-YYYYMMDD-HHMMSS[-n].log 命名，其他文件一律不动。
 */
export function selectPrunableArchives(names: string[], keep: number = ARCHIVE_KEEP): string[] {
  const matched = names
    .map((name) => ({ name, stamp: ARCHIVE_PATTERN.exec(name)?.[1] }))
    .filter((item): item is { name: string; stamp: string } => !!item.stamp)
  matched.sort((a, b) => b.stamp.localeCompare(a.stamp))
  return matched.slice(Math.max(0, keep)).map((item) => item.name)
}

/** 删除目录中超量的历史归档，返回删除数量；纯 fs 操作，可注入目录测试。 */
export function pruneArchivedLogs(dir: string, keep: number = ARCHIVE_KEEP): number {
  const names = fs.readdirSync(dir).filter((name) => ARCHIVE_PATTERN.test(name))
  let removed = 0
  for (const name of selectPrunableArchives(names, keep)) {
    try {
      fs.rmSync(path.join(dir, name), { force: true })
      removed++
    } catch {
      /* 删除失败下次会话再试 */
    }
  }
  return removed
}

/** Error 序列化：name/message/stack 全保留，经 redactDiagnosticText 脱敏后压成单行。 */
export function formatErrorText(error: unknown): string {
  if (error instanceof Error) {
    const text = error.stack?.trim() || `${error.name}: ${error.message}`
    return redactDiagnosticText(text).replace(/[\r\n]+/g, ' | ')
  }
  return redactDiagnosticText(String(error)).replace(/[\r\n]+/g, ' ')
}

/** 统一行格式：[ISO] [LEVEL] [scope] message；scope 为空时省略。 */
export function formatLauncherLogLine(
  timestamp: Date,
  level: LauncherLogLevel,
  scope: string,
  message: string
): string {
  const safe = redactDiagnosticText(message).replace(/[\r\n]+/g, ' ').trim()
  const tag = scope.trim() ? ` [${scope.trim()}]` : ''
  return `[${timestamp.toISOString()}] [${level.toUpperCase()}]${tag} ${safe}`
}

// ---------------- 会话状态 ----------------

let currentLogPath = ''
let initialized = false
let pending: string[] = []
let flushTimer: NodeJS.Timeout | undefined
let writeChain: Promise<void> = Promise.resolve()
let minimumLevel: LauncherLogLevel = minimumLevelFromEnv()
let exitHookRegistered = false

export function launcherLogPath(): string {
  return currentLogPath || path.join(app.getPath('userData'), 'logs', 'launcher-current.log')
}

/**
 * 每次启动器会话单独一份日志：旧 current 归档、修剪历史、写会话头。
 * 幂等：同会话内重复调用直接返回现有路径（index.ts 在模块加载与 whenReady 各调一次）。
 */
export function initializeLauncherLog(): string {
  if (initialized && currentLogPath) return currentLogPath
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    currentLogPath = path.join(dir, 'launcher-current.log')
    // 归档上一次会话：导出诊断包时 current 永远只对应“本次启动器运行”
    if (fs.existsSync(currentLogPath)) {
      let archive = path.join(dir, archivedLogFileName())
      if (fs.existsSync(archive)) archive = path.join(dir, archivedLogFileName().replace(/\.log$/, `-${Date.now()}.log`))
      try {
        fs.renameSync(currentLogPath, archive)
      } catch {
        /* 归档失败则本次继续覆盖写 current，不影响启动 */
      }
    }
    pruneArchivedLogs(dir, ARCHIVE_KEEP)
    const now = new Date()
    const divider = '-'.repeat(60)
    fs.writeFileSync(
      currentLogPath,
      [
        divider,
        `[${now.toISOString()}] KAMUCL ${app.getVersion()} session started (${process.platform} ${process.arch})`,
        `Electron ${process.versions.electron ?? '?'} / Node ${process.versions.node ?? '?'} / 日志级别下限 ${minimumLevel}`,
        divider
      ].join('\n') + '\n',
      'utf-8'
    )
    initialized = true
    pending = []
    registerExitHook()
  } catch {
    /* 日志不可影响启动；launcherLogPath() 仍有兜底路径 */
  }
  return currentLogPath
}

function registerExitHook(): void {
  if (exitHookRegistered) return
  exitHookRegistered = true
  // 进程退出前最后兜底：剩余缓冲同步落盘（quit 事件之后不再有事件轮询机会）
  process.once('exit', () => flushLauncherLogSync())
}

// ---------------- 写入队列 ----------------

function appendToQueue(line: string): void {
  pending.push(line)
  if (pending.length >= FLUSH_MAX_PENDING) {
    void drainQueue()
    return
  }
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = undefined
    void drainQueue()
  }, FLUSH_INTERVAL_MS)
  // 不阻止进程自然退出；真正的兜底是 flushLauncherLogSync
  flushTimer.unref?.()
}

async function drainQueue(): Promise<void> {
  if (!currentLogPath) return
  const target = currentLogPath
  while (pending.length) {
    const batch = pending.splice(0).join('\n') + '\n'
    writeChain = writeChain.then(async () => {
      try {
        await fs.promises.appendFile(target, batch, 'utf-8')
      } catch {
        /* 磁盘故障等场景静默：日志自身不能影响启动器业务 */
      }
    })
    await writeChain
  }
}

/** 异步刷盘：把缓冲与在途写入全部写完（before-quit 等退出路径调用）。 */
export async function flushLauncherLog(): Promise<void> {
  try {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = undefined
    }
    await drainQueue()
    await writeChain
  } catch {
    /* 静默 */
  }
}

/** 同步兜底刷盘：quit/exit 时事件循环已不值得等待，直接 appendFileSync。 */
export function flushLauncherLogSync(): void {
  try {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = undefined
    }
    if (!currentLogPath || !pending.length) return
    const batch = pending.splice(0).join('\n') + '\n'
    fs.appendFileSync(currentLogPath, batch, 'utf-8')
  } catch {
    /* 静默 */
  }
}

// ---------------- 记录入口 ----------------

function shouldRecord(level: LauncherLogLevel): boolean {
  return levelAtLeast(level, minimumLevel)
}

function record(level: LauncherLogLevel, scope: string, message: string, error?: unknown): void {
  try {
    if (!initialized) initializeLauncherLog()
    // 初始化彻底失败（如 userData 不可用）时静默丢弃，避免缓冲无限增长
    if (!currentLogPath || !shouldRecord(level)) return
    const text =
      error === undefined
        ? message
        : `${message} << ${formatErrorText(error)}`
    appendToQueue(formatLauncherLogLine(new Date(), level, scope, text))
    // warn/error 同时镜像到控制台，开发期 DevTools 可见
    if (level === 'error') console.error(`[${scope || 'launcher'}]`, text)
    else if (level === 'warn') console.warn(`[${scope || 'launcher'}]`, text)
  } catch {
    /* 日志自身不能影响启动器业务 */
  }
}

/** 兼容旧 API：等价 info 级别、无作用域。 */
export function launcherLog(message: string): void {
  record('info', '', message)
}

export function launcherLogDebug(scope: string, message: string): void {
  record('debug', scope, message)
}

export function launcherLogInfo(scope: string, message: string): void {
  record('info', scope, message)
}

export function launcherLogWarn(scope: string, message: string, error?: unknown): void {
  record('warn', scope, message, error)
}

export function launcherLogError(scope: string, message: string, error?: unknown): void {
  record('error', scope, message, error)
}

export interface ScopedLauncherLog {
  debug(message: string, error?: unknown): void
  info(message: string, error?: unknown): void
  warn(message: string, error?: unknown): void
  error(message: string, error?: unknown): void
}

/** 带作用域的便捷入口：const log = logScope('launch') → log.info('...') */
export function logScope(scope: string): ScopedLauncherLog {
  return {
    debug: (message: string, error?: unknown) => record('debug', scope, message, error),
    info: (message: string, error?: unknown) => record('info', scope, message, error),
    warn: (message: string, error?: unknown) => record('warn', scope, message, error),
    error: (message: string, error?: unknown) => record('error', scope, message, error)
  }
}
