/**
 * Java 管理：本机扫描、版本需求推断、Adoptium 自动下载
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, execSync, spawnSync } from 'node:child_process'
import { app } from 'electron'
import AdmZip from 'adm-zip'
import type { JavaInfo, ProgressEvent } from '../../shared/types'
import { getSettings, saveSettings } from './settings'
import { runtimesDir } from './paths'
import { downloadFile } from './download'
import type { VersionJson } from './versions'
import { waitIfTaskPaused, isCancelError } from './tasks'
import { logScope } from './launcherLog'
import { JavaProbeCache } from './javaProbeCache'
import { mapLaunchFiles, SharedPreparation } from './launchPreparation'
import { macJavaArchitecture } from './javaArchitecture'
import { provisionJava, javaPackageSize } from './javaSources'
import { httpFetch } from './httpClient'
import { validateJavaRuntime } from './javaRuntimeHealth'
const probeCache = new JavaProbeCache(() => path.join(app.getPath('userData'), 'java-probe-cache.json'))

const javaLog = logScope('java')
import {
  parseJavaProbeOutput,
  javaHomeExecutable,
  parseRegistryJavaHomes,
  shouldPruneJavaDirectory
} from './javaScanUtils'

export type ProgressEmit = (e: ProgressEvent) => void

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
/** java 可执行文件名（Windows 为 java.exe，其他为 java） */
const JAVA_EXE = IS_WIN ? 'java.exe' : 'java'
const SCAN_TTL = 5 * 60 * 1000
const PERSISTENT_SCAN_TTL = 7 * 24 * 60 * 60 * 1000

interface JavaCandidate {
  executable: string
  sourceDetail: string
  /** 去重/探测可用真实路径，UI 与显式配置仍保留用户看到的入口路径。 */
  displayPath?: string
}

interface JavaScanCacheFile {
  version: 1
  scannedAt: number
  list: JavaInfo[]
}

export interface JavaScanOptions {
  refresh?: boolean
  signal?: AbortSignal
  emit?: ProgressEmit
}

function throwIfScanCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('已取消')
    error.name = 'AbortError'
    throw error
  }
}

function pathKey(value: string): string {
  let normalized = path.resolve(value).replace(/^\\\\\?\\/, '')
  if (IS_WIN) normalized = normalized.toLowerCase()
  return normalized.replace(/[\\/]+$/, '')
}

function realExecutable(value: string): string | null {
  try {
    if (!fs.statSync(value).isFile()) return null
    return fs.realpathSync.native(value).replace(/^\\\\\?\\/, '')
  } catch {
    return null
  }
}

/** 一个配置/注册表值既可能是 JAVA_HOME，也可能已经指向 java.exe。 */
function executablePaths(value?: string): string[] {
  if (!value) return []
  const clean = value.trim().replace(/^"|"$/g, '')
  if (!clean) return []
  const base = path.basename(clean).toLowerCase()
  if (base === JAVA_EXE.toLowerCase() || (!IS_WIN && base === 'java')) return [clean]
  const result = [
    base === 'bin' ? path.join(clean, JAVA_EXE) : path.join(clean, 'bin', JAVA_EXE)
  ]
  if (IS_MAC) result.push(path.join(clean, 'Contents', 'Home', 'bin', JAVA_EXE))
  return result
}

function addCandidate(
  candidates: Map<string, JavaCandidate>,
  value: string | undefined,
  sourceDetail: string
): void {
  for (const executable of executablePaths(value)) {
    const key = pathKey(executable)
    if (!candidates.has(key)) candidates.set(key, { executable, sourceDetail })
  }
}

/** 运行 Java 并解析版本、架构和发行版；失败返回 null。 */
function probeJava(exe: string): JavaInfo | null {
  const cached = probeCache.get(exe)
  if (cached) return cached
  try {
    const r = spawnSync(exe, ['-XshowSettings:properties', '-version'], {
      encoding: 'utf-8',
      timeout: 10000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    })
    if (r.error) return null
    const out = `${r.stderr ?? ''}\n${r.stdout ?? ''}`
    const parsed = parseJavaProbeOutput(out)
    return parsed ? probeCache.put(exe, { path: exe, ...parsed }) : null
  } catch {
    return null
  }
}

function runTextProcess(
  command: string,
  args: string[],
  signal?: AbortSignal,
  timeout = 15000
): Promise<string> {
  throwIfScanCancelled(signal)
  return new Promise((resolve, reject) => {
    let settled = false
    const child = execFile(
      command,
      args,
      { encoding: 'utf-8', timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        if (signal?.aborted) {
          const aborted = new Error('已取消')
          aborted.name = 'AbortError'
          reject(aborted)
          return
        }
        const output = `${stderr ?? ''}\n${stdout ?? ''}`
        if (error && !output.trim()) reject(error)
        else resolve(output)
      }
    )
    const onAbort = (): void => {
      if (settled) return
      child.kill()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function probeJavaAsync(exe: string, signal?: AbortSignal): Promise<JavaInfo | null> {
  const cached = probeCache.get(exe)
  if (cached) return cached
  try {
    const output = await runTextProcess(
      exe,
      ['-XshowSettings:properties', '-version'],
      signal,
      10000
    )
    const parsed = parseJavaProbeOutput(output)
    return parsed ? probeCache.put(exe, { path: exe, ...parsed }) : null
  } catch (error) {
    throwIfScanCancelled(signal)
    return null
  }
}

/** Resolve the JVM behind PATH shims before launching so the tracked PID owns the game. */
export async function resolveJavaExecutable(exe: string): Promise<string> {
  const probe = /javaw\.exe$/i.test(exe) ? path.join(path.dirname(exe), 'java.exe') : exe
  const output = await runBufferProcess(probe, ['-XshowSettings:properties', '-version'], 10000)
  // Java 17 及以下按平台默认编码输出属性（中文 Windows = GBK），Java 18+ 为 UTF-8；
  // 自动下载的 JRE 落在含中文的游戏目录时，UTF-8 直读会得到乱码路径。
  // 双编码尝试：UTF-8 优先，含替换字符或路径不存在时回退 GBK。
  const decoders: Array<(b: Buffer) => string> = [
    (b) => b.toString('utf-8'),
    (b) => new TextDecoder('gbk').decode(b)
  ]
  for (const decode of decoders) {
    const runtime = javaHomeExecutable(decode(output))
    const resolved = runtime && realExecutable(runtime)
    if (resolved) return resolved
  }
  throw new Error('无法解析真实 Java 运行时，请选择 JDK/JRE 的 bin/java 可执行文件')
}

/** execFile 以 Buffer 收输出（编码由调用方按 JVM 平台编码判定）。 */
function runBufferProcess(command: string, args: string[], timeout = 15000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'buffer', timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const output = Buffer.concat([stderr ?? Buffer.alloc(0), stdout ?? Buffer.alloc(0)])
      if (error && !output.length) reject(error)
      else resolve(output)
    })
  })
}

/** 启动流程使用的轻量候选，不遍历磁盘。 */
function quickCandidates(runWhere = true): JavaCandidate[] {
  const candidates = new Map<string, JavaCandidate>()
  const settings = getSettings()

  // 1. 用户指定
  addCandidate(candidates, settings.javaPath, '当前配置')
  for (const exe of settings.javaCustom ?? []) addCandidate(candidates, exe, '手动添加')

  // 2. JAVA_HOME
  addCandidate(candidates, process.env.JAVA_HOME, 'JAVA_HOME')

  // 3. PATH 中的 java
  for (const item of (process.env.Path ?? process.env.PATH ?? '').split(path.delimiter)) {
    if (item.trim()) addCandidate(candidates, item.trim(), 'PATH')
  }
  if (runWhere) try {
    const cmd = IS_WIN ? 'where java' : 'which java'
    const out = execSync(cmd, { encoding: 'utf-8', timeout: 10000, windowsHide: true })
    for (const line of out.split(/\r?\n/)) addCandidate(candidates, line.trim(), 'PATH')
  } catch {
    /* 找不到时返回非零，忽略 */
  }

  // 4. 当前系统盘的常见安装目录；全盘枚举由异步扫描负责。
  if (IS_WIN) {
    const dirNames = [
      'Java',
      'Eclipse Adoptium',
      'Microsoft',
      'Zulu',
      'Amazon Corretto',
      'BellSoft\\Liberica',
      'JavaSoft\\JRE'
    ]
    const systemDrive = process.env.SystemDrive || 'C:'
    for (const dn of dirNames) {
      const base = path.join(`${systemDrive}\\`, 'Program Files', dn)
      try {
        for (const sub of fs.readdirSync(base)) {
          addCandidate(candidates, path.join(base, sub), '常见安装目录')
        }
      } catch {
        /* 目录不存在 */
      }
    }
    // 官方启动器运行时目录（.minecraft/runtime/<name>/<arch>/<name>/bin/java.exe，两层结构）
    const rtBase = path.join(app.getPath('appData'), '.minecraft', 'runtime')
    try {
      for (const l1 of fs.readdirSync(rtBase)) {
        const l1p = path.join(rtBase, l1)
        try {
          for (const l2 of fs.readdirSync(l1p)) {
            addCandidate(candidates, path.join(l1p, l2, l1), 'Minecraft 官方 Runtime')
          }
        } catch {
          /* 非目录 */
        }
      }
    } catch {
      /* 无 runtime 目录 */
    }
  } else if (IS_MAC) {
    // macOS：系统 JDK 目录（*/Contents/Home/bin/java）与用户级目录
    const bases = [
      '/Library/Java/JavaVirtualMachines',
      path.join(os.homedir(), 'Library/Java/JavaVirtualMachines'),
      '/Library/Internet Plug-Ins/JavaAppletPlugin.plugin/Contents/Home'
    ]
    for (const base of bases) {
      try {
        if (base.endsWith('Home')) {
          addCandidate(candidates, base, 'macOS Java')
          continue
        }
        for (const sub of fs.readdirSync(base)) {
          addCandidate(candidates, path.join(base, sub), 'macOS Java')
        }
      } catch {
        /* 目录不存在 */
      }
    }
    addCandidate(candidates, '/usr/bin/java', '系统路径')
  } else {
    // Linux
    addCandidate(candidates, '/usr/bin/java', '系统路径')
    try {
      for (const sub of fs.readdirSync('/usr/lib/jvm')) {
        addCandidate(candidates, path.join('/usr/lib/jvm', sub), '系统 JVM 目录')
      }
    } catch {
      /* 目录不存在 */
    }
  }

  // 5. 启动器自管理的 runtimes 目录
  try {
    for (const sub of fs.readdirSync(runtimesDir())) {
      const home = path.join(runtimesDir(), sub)
      // Windows 结构 bin/java.exe；macOS 结构 Contents/Home/bin/java
      addCandidate(candidates, home, 'KAMUCL Runtime')
    }
  } catch {
    /* 目录不存在 */
  }

  return [...candidates.values()]
}

let scanCache: { time: number; list: JavaInfo[]; complete: boolean } | null = null

function cacheFile(): string {
  return path.join(app.getPath('userData'), 'java-scan-cache.json')
}

function readPersistentCache(): { time: number; list: JavaInfo[] } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile(), 'utf-8')) as Partial<JavaScanCacheFile>
    if (parsed.version !== 1 || !Number.isFinite(parsed.scannedAt) || !Array.isArray(parsed.list)) {
      return null
    }
    const list = parsed.list.filter(
      (item): item is JavaInfo =>
        !!item &&
        typeof item.path === 'string' &&
        typeof item.major === 'number' &&
        typeof item.version === 'string' &&
        typeof item.is64Bit === 'boolean' &&
        fs.existsSync(item.path)
    )
    return { time: parsed.scannedAt!, list }
  } catch {
    return null
  }
}

function writePersistentCache(list: JavaInfo[]): void {
  try {
    const file = cacheFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const payload: JavaScanCacheFile = { version: 1, scannedAt: Date.now(), list }
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8')
  } catch (error) {
    console.warn('[KAMUCL] Java 扫描缓存写入失败:', error)
  }
}

function cachedCompleteList(maxAge: number): JavaInfo[] | null {
  if (scanCache?.complete && Date.now() - scanCache.time < maxAge) return scanCache.list
  const persisted = readPersistentCache()
  if (!persisted || Date.now() - persisted.time >= maxAge) return null
  scanCache = { ...persisted, complete: true }
  return persisted.list
}

function sortJava(list: JavaInfo[]): JavaInfo[] {
  return [...list].sort(
    (a, b) => b.major - a.major || Number(b.is64Bit) - Number(a.is64Bit) || a.path.localeCompare(b.path)
  )
}

/**
 * 启动热路径使用同步快速扫描。完整固定磁盘扫描只由 scanJavaInstallations 异步执行，
 * 避免主进程事件循环因全盘 I/O 卡住。
 */
export function scanJava(refresh = false): JavaInfo[] {
  if (!refresh && scanCache && Date.now() - scanCache.time < SCAN_TTL) {
    return mergeCustom(scanCache.list)
  }
  if (!refresh) {
    const persisted = cachedCompleteList(PERSISTENT_SCAN_TTL)
    if (persisted) return mergeCustom(persisted)
  }
  const seen = new Set<string>()
  const out: JavaInfo[] = []
  for (const candidate of quickCandidates()) {
    const real = realExecutable(candidate.executable)
    if (!real || seen.has(pathKey(real))) continue
    seen.add(pathKey(real))
    const info = probeJava(real)
    if (info) {
      out.push({
        ...info,
        path: path.resolve(candidate.executable),
        source: 'auto',
        sourceDetail: candidate.sourceDetail
      })
    }
  }
  scanCache = { time: Date.now(), list: sortJava(out), complete: false }
  return mergeCustom(scanCache.list)
}

/** Same discovery/selection as scanJava, without serial child processes blocking
 * the renderer or the other launch preparation branches. */
export async function scanJavaForLaunch(): Promise<JavaInfo[]> {
  if (scanCache && Date.now() - scanCache.time < SCAN_TTL) return mergeCustom(scanCache.list)
  const persisted = cachedCompleteList(PERSISTENT_SCAN_TTL)
  if (persisted) return mergeCustom(persisted)
  const candidates = quickCandidates(false)
  try {
    const output = await runTextProcess(IS_WIN ? 'where.exe' : 'which', ['java'], undefined, 10000)
    for (const executable of output.split(/\r?\n/).filter(Boolean)) candidates.push({ executable: executable.trim(), sourceDetail: 'PATH' })
  } catch { /* PATH discovery may legitimately find no Java. */ }
  const seen = new Set<string>()
  const unique = candidates.filter(candidate => {
    const real = realExecutable(candidate.executable)
    if (!real || seen.has(pathKey(real))) return false
    seen.add(pathKey(real)); return true
  })
  const found = await mapLaunchFiles(unique, async candidate => {
    const info = await probeJavaAsync(realExecutable(candidate.executable) ?? candidate.executable)
    return info ? { ...info, path: path.resolve(candidate.executable), source: 'auto' as const, sourceDetail: candidate.sourceDetail } : null
  })
  const list = sortJava(found.filter((info): info is NonNullable<typeof info> => info !== null))
  scanCache = { time: Date.now(), list, complete: false }
  return mergeCustom(list)
}

let summaryPending: Promise<JavaInfo[]> | undefined
/** UI summary never runs spawnSync/where on Electron's event loop. */
export function listJavaSummary(): Promise<JavaInfo[]> {
  if (summaryPending) return summaryPending
  summaryPending = (async () => {
    const started = Date.now(), settings = getSettings()
    const candidates = quickCandidates(false)
    for (const info of readPersistentCache()?.list ?? []) candidates.push({ executable: info.path, sourceDetail: info.sourceDetail ?? '已缓存' })
    const unique = new Map<string, JavaCandidate>()
    for (const c of candidates) { const real = realExecutable(c.executable); if (real && !unique.has(pathKey(real))) unique.set(pathKey(real), { ...c, executable: real }) }
    const pending = [...unique.values()], found: JavaInfo[] = []
    let cursor = 0
    const worker = async () => {
      while (cursor < pending.length) {
        const c = pending[cursor++], info = await probeJavaAsync(c.executable)
        if (info) found.push({ ...info, source: c.sourceDetail === '手动添加' ? 'manual' : 'auto', sourceDetail: c.sourceDetail })
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker))
    const hidden = new Set((settings.javaHidden ?? []).map(pathKey))
    const list = sortJava(found.filter(j => !hidden.has(pathKey(j.path))))
    console.info(`[KAMUCL] Java summary: ${list.length} runtimes, ${Date.now() - started} ms (persistent probe cache enabled)`)
    javaLog.info(`Java 概览扫描完成：${list.length} 个运行时（耗时 ${Date.now() - started}ms）`)
    return list
  })().finally(() => { summaryPending = undefined })
  return summaryPending
}

async function fixedWindowsDrives(signal?: AbortSignal): Promise<string[]> {
  if (!IS_WIN) return []
  try {
    const output = await runTextProcess(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object -ExpandProperty DeviceID"
      ],
      signal,
      20000
    )
    const drives = output
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter((item) => /^[a-z]:$/i.test(item))
    if (drives.length) return [...new Set(drives.map((item) => item.toUpperCase()))]
  } catch {
    throwIfScanCancelled(signal)
  }
  return [(process.env.SystemDrive || 'C:').toUpperCase()]
}

const REGISTRY_JAVA_KEYS = [
  'HKLM\\SOFTWARE\\JavaSoft',
  'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft',
  'HKCU\\SOFTWARE\\JavaSoft',
  'HKLM\\SOFTWARE\\Eclipse Adoptium',
  'HKLM\\SOFTWARE\\WOW6432Node\\Eclipse Adoptium',
  'HKLM\\SOFTWARE\\Microsoft\\JDK',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\JDK',
  'HKLM\\SOFTWARE\\Azul Systems',
  'HKLM\\SOFTWARE\\BellSoft',
  'HKLM\\SOFTWARE\\Amazon Corretto'
]

async function registryJavaHomes(signal?: AbortSignal): Promise<string[]> {
  if (!IS_WIN) return []
  // 顺序查询可避免同一 AbortSignal 同时挂载大量 child_process 监听器。
  const outputs: string[] = []
  for (const key of REGISTRY_JAVA_KEYS) {
    try {
      outputs.push(await runTextProcess('reg.exe', ['query', key, '/s'], signal))
    } catch {
      throwIfScanCancelled(signal)
    }
  }
  return parseRegistryJavaHomes(outputs.join('\n'))
}

interface ScanRoot {
  directory: string
  label: string
  maxDepth: number
  maxDirectories: number
  /** 设置后先普查到此深度；遇到 Java/runtime 线索才继续到 maxDepth。 */
  shallowDepth?: number
}

function addScanRoot(roots: Map<string, ScanRoot>, root: ScanRoot): void {
  try {
    if (!fs.statSync(root.directory).isDirectory()) return
  } catch {
    return
  }
  const key = pathKey(root.directory)
  const existing = roots.get(key)
  if (!existing || existing.maxDepth < root.maxDepth) roots.set(key, root)
}

async function windowsScanRoots(drives: string[], signal?: AbortSignal): Promise<ScanRoot[]> {
  const roots = new Map<string, ScanRoot>()
  const vendorDirs = [
    'Java',
    'Eclipse Adoptium',
    'Microsoft',
    'Zulu',
    'Amazon Corretto',
    'BellSoft',
    'IBM',
    'Semeru',
    'JetBrains',
    'Android',
    'Minecraft Launcher',
    'PrismLauncher',
    'Modrinth App',
    'CurseForge'
  ]
  const rootHints = /^(?:java|jdk|jre)(?:[-_. ].*)?$|^(?:apps?|tools?|software|programs?|development|dev|minecraft|games?|launchers?|runtimes?)$/i

  for (const drive of drives) {
    throwIfScanCancelled(signal)
    // 每个固定磁盘都做有限浅扫；在浅层发现 java/jdk/jre/runtime/jbr 后再深挖。
    // 这样能覆盖 D:\自定义目录\runtime，同时不会递归遍历整块游戏盘。
    addScanRoot(roots, {
      directory: `${drive}\\`,
      label: `${drive} 固定磁盘浅层扫描`,
      shallowDepth: 2,
      maxDepth: 10,
      maxDirectories: 8000
    })
    for (const programDir of ['Program Files', 'Program Files (x86)']) {
      for (const vendor of vendorDirs) {
        addScanRoot(roots, {
          directory: path.join(`${drive}\\`, programDir, vendor),
          label: `${drive} 常见安装目录`,
          maxDepth: 7,
          maxDirectories: 12000
        })
      }
    }
    for (const name of ['Java', 'JDK', 'JRE', 'Apps', 'Tools', 'Software', 'Programs', 'Development', 'Dev', 'Minecraft', 'Games', 'Launchers', 'Runtimes']) {
      addScanRoot(roots, {
        directory: path.join(`${drive}\\`, name),
        label: `${drive} 本地磁盘`,
        maxDepth: 6,
        maxDirectories: 12000
      })
    }
    try {
      const top = await fs.promises.readdir(`${drive}\\`, { withFileTypes: true })
      for (const item of top) {
        if (!item.isDirectory() || item.isSymbolicLink() || !rootHints.test(item.name)) continue
        addScanRoot(roots, {
          directory: path.join(`${drive}\\`, item.name),
          label: `${drive} 本地磁盘`,
          maxDepth: 6,
          maxDirectories: 12000
        })
      }
    } catch {
      /* 无权读取磁盘根目录时跳过自动发现，已知目录仍会扫描。 */
    }
  }

  const userHome = os.homedir()
  const appData = app.getPath('appData')
  // Electron 没有 localAppData 这一 getPath 名称；Windows 使用系统环境值，
  // 缺失时从 Roaming 的同级 Local 目录推导。
  const localAppData =
    process.env.LOCALAPPDATA || path.join(path.dirname(appData), 'Local')
  const userRoots: Array<[string, string, number]> = [
    [path.join(appData, '.minecraft', 'runtime'), 'Minecraft 官方 Runtime', 8],
    [path.join(appData, 'PrismLauncher'), 'Prism Launcher Runtime', 7],
    [path.join(appData, 'ModrinthApp'), 'Modrinth Runtime', 7],
    [path.join(appData, 'com.modrinth.theseus'), 'Modrinth Runtime', 8],
    [path.join(localAppData, 'Programs'), '用户程序目录', 6],
    [path.join(userHome, '.jdks'), 'IDE JDK', 5],
    [path.join(userHome, '.gradle', 'jdks'), 'Gradle JDK', 5],
    [path.join(userHome, '.lunarclient'), 'Lunar Client Runtime', 7],
    [path.join(userHome, '.badlion'), 'Badlion Runtime', 7],
    [runtimesDir(), 'KAMUCL Runtime', 7]
  ]
  for (const [directory, label, maxDepth] of userRoots) {
    addScanRoot(roots, { directory, label, maxDepth, maxDirectories: 16000 })
  }
  // Microsoft Store 的 Packages 目录通常很大，只进入 Minecraft Launcher 对应包。
  try {
    const packages = path.join(localAppData, 'Packages')
    for (const item of fs.readdirSync(packages, { withFileTypes: true })) {
      if (!item.isDirectory() || !/^Microsoft\.4297127D64EC6_/i.test(item.name)) continue
      addScanRoot(roots, {
        directory: path.join(packages, item.name),
        label: 'Microsoft Store Minecraft Runtime',
        maxDepth: 9,
        maxDirectories: 16000
      })
    }
  } catch {
    /* 未安装 Store 版启动器。 */
  }
  return [...roots.values()]
}

async function platformScanRoots(drives: string[], signal?: AbortSignal): Promise<ScanRoot[]> {
  if (IS_WIN) return windowsScanRoots(drives, signal)
  const roots = new Map<string, ScanRoot>()
  const candidates = IS_MAC
    ? [
        '/Library/Java/JavaVirtualMachines',
        path.join(os.homedir(), 'Library/Java/JavaVirtualMachines'),
        path.join(os.homedir(), '.jdks'),
        runtimesDir()
      ]
    : ['/usr/lib/jvm', '/opt', path.join(os.homedir(), '.jdks'), path.join(os.homedir(), '.gradle/jdks'), runtimesDir()]
  for (const directory of candidates) {
    addScanRoot(roots, {
      directory,
      label: '本地 Runtime 目录',
      maxDepth: 7,
      maxDirectories: 16000
    })
  }
  return [...roots.values()]
}

async function discoverInRoot(
  root: ScanRoot,
  candidates: Map<string, JavaCandidate>,
  signal?: AbortSignal
): Promise<number> {
  const queue: Array<{ directory: string; depth: number; promoted: boolean }> = [
    { directory: root.directory, depth: 0, promoted: false }
  ]
  const deepHint = /^(?:java|jdk|jre|jbr|runtime)(?:[-_. ].*)?$/i
  let cursor = 0
  let visited = 0
  while (cursor < queue.length && visited < root.maxDirectories) {
    throwIfScanCancelled(signal)
    await waitIfTaskPaused(signal)
    const current = queue[cursor++]
    visited++
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(current.directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      throwIfScanCancelled(signal)
      const full = path.join(current.directory, entry.name)
      if (entry.isFile() && entry.name.toLowerCase() === JAVA_EXE.toLowerCase()) {
        addCandidate(candidates, full, root.label)
        continue
      }
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        shouldPruneJavaDirectory(entry.name)
      ) {
        continue
      }
      const promoted = current.promoted || deepHint.test(entry.name)
      const depth = current.depth + 1
      const depthLimit = promoted ? root.maxDepth : (root.shallowDepth ?? root.maxDepth)
      if (depth > depthLimit) continue
      queue.push({ directory: full, depth, promoted })
    }
  }
  return visited
}

function scanProgress(emit: ProgressEmit | undefined, progress: number, text: string): void {
  emit?.({
    stage: 'java-scan',
    progress,
    overall: progress,
    text,
    indeterminate: false
  })
}

/**
 * 后台完整扫描：注册表、环境变量、KAMUCL/其他启动器 Runtime，以及全部固定磁盘
 * 的常见 Java 目录。每个结果都通过实际启动目标 Java 验证。
 */
export async function scanJavaInstallations(options: JavaScanOptions = {}): Promise<JavaInfo[]> {
  const { refresh = false, signal, emit } = options
  const started = Date.now()
  javaLog.info(`开始完整扫描本机 Java（refresh=${refresh}）`)
  if (!refresh) {
    const cached = cachedCompleteList(PERSISTENT_SCAN_TTL)
    if (cached) {
      javaLog.info(`命中持久缓存，直接载入 ${cached.length} 个 Java（耗时 ${Date.now() - started}ms）`)
      scanProgress(emit, 1, `已从缓存载入 ${cached.length} 个 Java`)
      return mergeCustom(cached)
    }
  }

  throwIfScanCancelled(signal)
  scanProgress(emit, 0.02, '正在读取 Java 配置、PATH 与注册表…')
  const candidates = new Map<string, JavaCandidate>()
  for (const candidate of quickCandidates()) {
    addCandidate(candidates, candidate.executable, candidate.sourceDetail)
  }
  const [registeredHomes, drives] = await Promise.all([
    registryJavaHomes(signal),
    fixedWindowsDrives(signal)
  ])
  for (const home of registeredHomes) addCandidate(candidates, home, 'Windows 注册表')

  throwIfScanCancelled(signal)
  const roots = await platformScanRoots(drives, signal)
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i]
    scanProgress(
      emit,
      0.08 + (i / Math.max(roots.length, 1)) * 0.52,
      `正在扫描 ${root.label}：${root.directory}`
    )
    await discoverInRoot(root, candidates, signal)
  }

  throwIfScanCancelled(signal)
  const unique = new Map<string, JavaCandidate>()
  for (const candidate of candidates.values()) {
    const real = realExecutable(candidate.executable)
    if (!real) continue
    const key = pathKey(real)
    if (!unique.has(key)) {
      unique.set(key, {
        ...candidate,
        executable: real,
        displayPath: path.resolve(candidate.executable)
      })
    }
  }

  const pending = [...unique.values()]
  const found: JavaInfo[] = []
  let cursor = 0
  let completed = 0
  const worker = async (): Promise<void> => {
    while (true) {
      throwIfScanCancelled(signal)
      await waitIfTaskPaused(signal)
      const index = cursor++
      if (index >= pending.length) return
      const candidate = pending[index]
      const info = await probeJavaAsync(candidate.executable, signal)
      if (info) {
        found.push({
          ...info,
          path: candidate.displayPath ?? candidate.executable,
          source: 'auto',
          sourceDetail: candidate.sourceDetail
        })
      }
      completed++
      scanProgress(
        emit,
        0.62 + (completed / Math.max(pending.length, 1)) * 0.37,
        `正在验证 Java ${completed}/${pending.length}${info ? `：Java ${info.major} ${info.architecture ?? ''}` : ''}`
      )
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, Math.max(1, pending.length)) }, worker))
  throwIfScanCancelled(signal)

  const list = sortJava(found)
  scanCache = { time: Date.now(), list, complete: true }
  writePersistentCache(list)
  // 用户点「重新扫描」= 要一份最新真相：曾被「隐藏/删除」但磁盘上真实存在的 Java 自动解除隐藏
  if (refresh) {
    const s = getSettings()
    const hidden = s.javaHidden ?? []
    if (hidden.length) {
      const foundKeys = new Set(found.map((j) => pathKey(j.path)))
      const restore = hidden.filter((p) => foundKeys.has(pathKey(p)))
      if (restore.length) {
        javaLog.info(`重扫恢复 ${restore.length} 个曾被隐藏的 Java：${restore.join('、')}`)
        saveSettings({ javaHidden: hidden.filter((p) => !foundKeys.has(pathKey(p))) })
      }
    }
  }
  javaLog.info(`本机 Java 扫描完成：共 ${list.length} 个可用（验证 ${pending.length} 个候选，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）`)
  scanProgress(emit, 1, `扫描完成，共找到 ${list.length} 个可用 Java`)
  return mergeCustom(list)
}

/** 合并手动添加的 Java，并过滤隐藏项 */
function mergeCustom(list: JavaInfo[]): JavaInfo[] {
  const s = getSettings()
  const hidden = new Set((s.javaHidden ?? []).flatMap(p => [pathKey(p), pathKey(realExecutable(p) ?? p)]))
  const auto = list.filter((j) => !hidden.has(pathKey(j.path)) && !hidden.has(pathKey(realExecutable(j.path) ?? j.path)))
  const manual: JavaInfo[] = []
  for (const p of s.javaCustom ?? []) {
    const real = realExecutable(p)
    if (!real || hidden.has(pathKey(real))) continue
    if (auto.some((j) => pathKey(j.path) === pathKey(real))) continue
    if (manual.some((j) => pathKey(j.path) === pathKey(real))) continue
    const info = probeJava(real)
    if (info) manual.push({ ...info, source: 'manual', sourceDetail: '手动添加' })
  }
  return sortJava([...manual, ...auto])
}

/** 手动添加一个 Java 路径（真实执行 -version 校验后加入 javaCustom） */
export function addCustomJava(javaPath: string): void {
  const real = realExecutable(javaPath)
  const info = real ? probeJava(real) : null
  if (!info) throw new Error('这不是有效的 Java（java -version 校验失败）')
  const s = getSettings()
  const list = [...(s.javaCustom ?? [])]
  if (!list.some((p) => pathKey(p) === pathKey(real!))) {
    list.push(real!)
  }
  // 若曾被隐藏则取消隐藏
  const hidden = (s.javaHidden ?? []).filter((p) => pathKey(p) !== pathKey(real!))
  saveSettings({ javaCustom: list, javaHidden: hidden })
}

/** 从列表隐藏一个 Java（手动/自动均可） */
export function hideJava(javaPath: string): void {
  const s = getSettings()
  const hidden = [...new Set([...(s.javaHidden ?? []), javaPath])]
  saveSettings({ javaHidden: hidden })
}

/** 推断运行该版本所需的 Java 主版本号 */
export function requiredMajor(versionJson: VersionJson): number {
  const declared = versionJson.javaVersion?.majorVersion
  if (declared && declared > 0) return declared
  // 按 MC 版本号推断（id 形如 1.20.5 / 1.18 / 1.8.9；自定义命名的原版取 _mcVersion）
  const verId = versionJson.inheritsFrom ?? versionJson._mcVersion ?? versionJson.id
  const m = /^1\.(\d+)(?:\.(\d+))?/.exec(verId)
  if (!m) {
    // 非 1.x 命名（如 26.2 新版号、24w14a 快照）：均为现代版本，需 Java 21
    return 21
  }
  const minor = parseInt(m[1], 10)
  const patch = parseInt(m[2] ?? '0', 10)
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21
  if (minor >= 18) return 17
  if (minor === 17) return 16
  return 8
}

/** 最低版本 + 向上兼容选择：优先推荐版本（==need），否则取满足条件的最高版本（纯函数，可测试）。 */
export function selectJavaByMajor<T extends { major: number; is64Bit: boolean; architecture?: string }>(available: T[], need: number, architecture?: string): T | null {
  const ok = available.filter((j) => j.major >= need && j.is64Bit && (!architecture || j.architecture === architecture))
  return ok.find((j) => j.major === need) ?? [...ok].sort((a, b) => b.major - a.major)[0] ?? null
}

/**
 * 确保有可用 Java：最低版本 + 向上兼容——游戏要求 Java N 时，所有 ≥N 的已安装
 * Java 均可用；优先推荐版本（==need），否则取满足条件的最高版本（如仅装 Java 21
 * 无 Java 17 时，1.20.1 直接用 Java 21 启动，与 PCL2/HMCL 一致）。
 * 完整扫描本机后仍无满足条件的 Java 时，才从 Adoptium 下载 JRE 到 gameDir/runtimes/jre-<major>/。
 * Windows 为 zip（adm-zip 解压）；macOS/Linux 为 tar.gz（系统 tar 解压）。
 * 返回 java 可执行文件绝对路径。
 */
const javaPreparations = new SharedPreparation<string>()
export function ensureJava(versionJson: VersionJson, emit: ProgressEmit): Promise<string> {
  // NeoForge repair and game launch may need the same JRE concurrently. Never
  // let two downloads/extractions replace the same runtime under one another.
  const key = `${pathKey(path.resolve(runtimesDir()))}:${requiredMajor(versionJson)}:${macJavaArchitecture(versionJson) ?? process.arch}`
  return javaPreparations.run(key, () => ensureJavaInternal(versionJson, emit))
}

export async function selectHealthyJava(available: JavaInfo[], need: number, architecture?: string): Promise<JavaInfo | null> {
  let remaining = [...available]
  while (remaining.length) {
    const candidate = selectJavaByMajor(remaining, need, architecture)
    if (!candidate) return null
    remaining = remaining.filter(item => item !== candidate)
    try {
      const exe = await resolveJavaExecutable(candidate.path)
      await validateJavaRuntime(exe, candidate.major)
      return { ...candidate, path: exe }
    } catch (error) { javaLog.warn('跳过不完整的 Java：' + candidate.path + '；' + String(error)) }
  }
  return null
}

async function ensureJavaInternal(versionJson: VersionJson, emit: ProgressEmit): Promise<string> {
  const need = requiredMajor(versionJson)
  const started = Date.now()
  const architecture = macJavaArchitecture(versionJson)
  const local = await selectHealthyJava(await scanJavaForLaunch(), need, architecture)
  if (local) {
    if (local.major === need) javaLog.debug(`本机已有 Java ${need}（64位）：${local.path}`)
    else javaLog.info(`本机没有 Java ${need}，向上兼容选用 Java ${local.major}（${local.version}，64位）：${local.path}`)
    return local.path
  }
  javaLog.info(`本机没有 Java ${need} 或更高版本（64位），开始从 Adoptium 自动下载`)
  try {
    const exe = await downloadAndExtractJava(need, emit, architecture)
    javaLog.info(`Java ${need} 自动下载完成：${exe}（耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）`)
    return exe
  } catch (error) {
    if (!isCancelError(error)) javaLog.error(`自动准备 Java ${need} 失败`, error)
    throw error
  }
}

async function downloadAndExtractJava(need: number, emit: ProgressEmit, architecture?: 'arm64' | 'x64'): Promise<string> {
  const arch = (architecture ?? process.arch) === 'arm64' ? 'aarch64' : 'x64'
  const report = (text: string): void => { javaLog.info(text); emit({ stage: 'java', progress: 0, text }) }
  const read = async (url: string): Promise<unknown> => {
    const response = await httpFetch(url, { systemProxy: true, signal: AbortSignal.timeout(12000) })
    if (!response.ok) { await response.body?.cancel(); throw new Error(`${new URL(url).hostname} HTTP ${response.status}`) }
    return response.json()
  }
  return provisionJava({ major: need, os: IS_WIN ? 'windows' : IS_MAC ? 'mac' : 'linux', arch }, read, async pkg => {
    const root = path.resolve(runtimesDir())
    fs.mkdirSync(root, { recursive: true })
    const staging = fs.mkdtempSync(path.join(root, '.java-'))
    const archive = path.join(staging, IS_WIN ? 'runtime.zip' : 'runtime.tar.gz')
    const extracted = path.join(staging, 'unpacked')
    try {
      const size = await javaPackageSize(pkg, url => httpFetch(url, { method: 'HEAD', systemProxy: true, signal: AbortSignal.timeout(10000) }))
      await downloadFile(pkg.url, archive, (done, total) => emit({ stage: 'java', progress: total ? done / total * .85 : 0, bytesDone: done, text: `下载 Java ${need} · ${pkg.provider} ${(done / 1048576).toFixed(1)}${total ? '/' + (total / 1048576).toFixed(1) : ''} MB` }), undefined, 'official', undefined, [], { sha256: pkg.sha256, size, systemProxy: true, maxAttempts: 2 })
      emit({ stage: 'java', progress: .9, text: `校验通过，正在解压 Java ${need} · ${pkg.provider}` })
      fs.mkdirSync(extracted)
      if (IS_WIN) new AdmZip(archive).extractAllTo(extracted, true)
      else await new Promise<void>((resolve, reject) => execFile('/usr/bin/tar', ['-xzf', archive, '-C', extracted], { timeout: 120000 }, error => error ? reject(error) : resolve()))
      const entries = fs.readdirSync(extracted)
      const source = entries.length === 1 && fs.statSync(path.join(extracted, entries[0])).isDirectory() ? path.join(extracted, entries[0]) : extracted
      const candidates = IS_MAC ? [path.join(source, 'Contents/Home/bin/java'), path.join(source, 'bin/java')] : [path.join(source, 'bin', JAVA_EXE)]
      const exe = candidates.find(file => fs.existsSync(file))
      if (!exe || !fs.realpathSync(exe).startsWith(fs.realpathSync(extracted) + path.sep)) throw new Error('Java 解压失败：未找到有效的 bin/java')
      if (!IS_WIN) fs.chmodSync(exe, 0o755)
      emit({ stage: 'java', progress: .95, text: `正在验证 Java ${need} · ${pkg.provider}（${arch}）` })
      const verified = await probeJavaAsync(exe)
      if (!verified || verified.major !== need || verified.architecture !== (arch === 'aarch64' ? 'arm64' : 'x64')) throw new Error(`Java ${need} 无法运行或架构不匹配${IS_MAC && process.arch === 'arm64' && arch === 'x64' ? '；旧版游戏需要 Intel Java，请确认系统已安装 Rosetta' : ''}`)
      await validateJavaRuntime(exe, verified.major)
      // Publish a fresh directory only after verification. Never remove or replace
      // a runtime that an already-running game may still be using.
      const target = path.join(root, `jre-${need}-${arch}-${path.basename(staging).slice(6)}`)
      const relativeExe = path.relative(source, exe)
      fs.renameSync(source, target)
      const installedPath = path.join(target, relativeExe)
      const info = probeCache.put(installedPath, { ...verified, path: installedPath, source: 'auto', sourceDetail: `KAMUCL Runtime · ${pkg.provider}` })
      const persisted = readPersistentCache()
      scanCache = { time: Date.now(), list: sortJava([...(scanCache?.list ?? persisted?.list ?? []), info]), complete: scanCache?.complete ?? !!persisted }
      if (persisted) writePersistentCache(sortJava([...persisted.list, info]))
      emit({ stage: 'java', progress: 1, text: `Java ${need} 就绪 · ${pkg.provider}（${arch}）` })
      return installedPath
    } finally {
      // staging is a unique mkdtemp child of the managed runtime root.
      await fs.promises.rm(staging, { recursive: true, force: true })
    }
  }, report)
}
