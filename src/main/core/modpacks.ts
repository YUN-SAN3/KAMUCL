import { backupInstance } from './instanceCenter'
/**
 * 整合包安装：Modrinth .mrpack、CurseForge .zip 与「解压即玩」全量包（含 .minecraft/versions）
 * 流程：探测格式 → 解析清单 → 同步准备运行环境与整合包文件 → 创建隔离实例 → 提交文件 → 解压 overrides
 * 全量包：注册包内游戏版本（versions/<vid>）→ 游戏文件解压到实例目录（过滤启动器/垃圾文件）
 * 入口 installModpack(filePath, emit, opts?) 返回实例版本 id；probeModpack(filePath) 只解析不安装；
 * 失败抛出友好中文错误
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import type {
  LoaderName,
  ModpackInfo,
  ModpackInstallRequest,
  ManualModpackFile,
  ManualModpackRequest,
  ProgressEvent
} from '../../shared/types'
import type { DownloadTask } from './download'
import { prepareModpackFiles } from './modpackDownloads'
import { runParallelTasks } from './parallelTasks'
import { ParallelProgress } from './parallelProgress'
import { resolveCurseForgeMetadata, resolveCurseForgeFileUrl, constructCurseForgeCdnUrl, probeCurseForgeCdnUrl, curseForgeInstallDir, exactModrinthDownload } from './curseforgeDownload'
import { BundledModpackFiles } from './modpackBundledFiles'
import { LocalModpackFiles } from './modpackLocalFiles'
import { prepareCurseMavenFile } from './modpackAlternateDownload'
import { waitForModpackFiles } from './modpackManualFiles'
import { getSettings } from './settings'
import { registerVersionFolder, versionDir, versionJsonPath, versionsDir } from './paths'
import { allFolders, gameDir, withGameFolder } from './paths'
import { installVersion, listAllInstalled, readVersionJson, flattenInstance } from './versions'
import { packRuntimeProfile } from './packRuntime'
import { throwIfCancelled, waitIfTaskPaused } from './tasks'
import { listGameFolders, setActiveGameFolder } from './gameFolders'
import { canonicalPath, samePath } from './folderPaths'
import { logScope } from './launcherLog'

const packLog = logScope('modpack')

export type ProgressEmit = (e: ProgressEvent) => void

/** 实例命名来源：file = 压缩包文件名；inner = 包内名称 */
export interface ModpackInstallOpts extends ModpackInstallRequest {
  /** 任务取消信号（下载中心取消按钮） */
  signal?: AbortSignal
}

// ---------------- 清单结构（只取需要的字段） ----------------

interface MrpackFile {
  path?: string
  hashes?: { sha1?: string; sha512?: string }
  downloads?: string[]
  fileSize?: number
  env?: { client?: string; server?: string }
}

interface MrpackIndex {
  formatVersion?: number
  game?: string
  name?: string
  versionId?: string
  dependencies?: Record<string, string>
  files?: MrpackFile[]
}

interface CfManifest {
  name?: string
  version?: string
  overrides?: string
  minecraft?: {
    version?: string
    modLoaders?: { id?: string; primary?: boolean }[]
  }
  files?: { projectID?: number; fileID?: number; required?: boolean }[]
}

/** 解析后的公共信息 */
interface PackMeta {
  name: string
  packVersion: string
  mcVersion: string
  loader?: LoaderName
  loaderVersion?: string
  /** overrides 目录前缀（zip 条目名，无尾斜杠），null = 无 */
  overridesPrefix: string | null
  clientOverridesPrefix?: string | null
}

interface PendingFile {
  /** 实例目录内的相对路径（正斜杠） */
  rel: string
  url: string
  urls?: string[]
  reuseFiles?: string[]
  sha1?: string
  sha512?: string
  size: number
}

type Parsed =
  | { kind: 'mrpack'; meta: PackMeta; files: PendingFile[] }
  | { kind: 'curseforge'; meta: PackMeta; files: { projectID: number; fileID: number }[] }

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const PACK_MAX_ENTRIES = 250_000
const PACK_MAX_UNCOMPRESSED = 32 * 1024 * 1024 * 1024
const PACK_MAX_RATIO = 500
const ILLEGAL_WINDOWS_SEGMENT = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** 防目录穿越、绝对路径、Windows 设备名与目标根逃逸。 */
function safeJoin(base: string, rel: string): string | null {
  if (!rel || rel.includes('\0') || /^(?:[\\/]|[A-Za-z]:)/.test(rel)) return null
  const parts = rel.split(/[\\/]+/).filter(Boolean)
  if (
    !parts.length ||
    parts.includes('..') ||
    parts.some((part) => part === '.' || ILLEGAL_WINDOWS_SEGMENT.test(part) || /[:*?"<>|]/.test(part))
  ) return null
  const root = path.resolve(base)
  const target = path.resolve(root, ...parts)
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  return target !== root && target.startsWith(prefix) ? target : null
}

/** 清洗实例 id：去 \\/:*?"<>| 与首尾空格点 */
function sanitizeId(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|]/g, '').replace(/^[\s.]+|[\s.]+$/g, '')
  return clean || '整合包'
}

/** 实例 id 冲突时追加 -2、-3…；reserved 中的 id 同样跳过（如全量包注册的游戏版本 id） */
function uniqueInstanceId(name: string, reserved?: ReadonlySet<string>): string {
  const base = sanitizeId(name)
  let id = base
  let n = 2
  while (fs.existsSync(versionDir(id)) || reserved?.has(id)) id = `${base}-${n++}`
  return id
}

function readEntryJson(zip: AdmZip, name: string): unknown {
  const entry = zip.getEntry(name) ?? zip.getEntry('./' + name)
  if (!entry) return null
  return JSON.parse(entry.getData().toString('utf-8'))
}

// ---------------- 压缩包打开与格式探测（install / probe 共用） ----------------

/** 归一化 zip 条目名：\ → /，去开头 ./ */
const normEntry = (name: string): string => name.replace(/\\/g, '/').replace(/^\.\//, '')

/** 压缩包文件名（去扩展名），作为实例命名来源之一 */
const packFileName = (filePath: string): string => path.basename(filePath).replace(/\.[^.]+$/, '')

function openPackZip(filePath: string, nested?: Buffer): AdmZip {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('整合包文件不存在，请重新选择')
  try {
    const zip = new AdmZip(nested ?? filePath)
    const entries = zip.getEntries()
    if (entries.length > PACK_MAX_ENTRIES) throw new Error('整合包文件数量超过安全上限')
    let unpacked = 0
    let packed = 0
    for (const entry of entries) {
      unpacked += entry.header.size
      packed += entry.header.compressedSize
      if (!entry.isDirectory && !safeJoin(path.parse(filePath).root, normEntry(entry.entryName))) {
        throw new Error(`整合包包含不安全路径：${entry.entryName}`)
      }
      if (((entry.attr >>> 16) & 0o170000) === 0o120000) {
        throw new Error(`整合包包含不允许的符号链接：${entry.entryName}`)
      }
      if (
        entry.header.size > 64 * 1024 * 1024 &&
        entry.header.size / Math.max(1, entry.header.compressedSize) > PACK_MAX_RATIO
      ) throw new Error(`整合包条目压缩比异常：${entry.entryName}`)
    }
    if (unpacked > PACK_MAX_UNCOMPRESSED) throw new Error('整合包解压后超过 32 GB 安全上限')
    if (unpacked > 64 * 1024 * 1024 && unpacked / Math.max(1, packed) > PACK_MAX_RATIO) {
      throw new Error('整合包整体压缩比异常，疑似解压炸弹')
    }
    // PCL 分发包在外层放启动器，真正的清单位于独立 mrpack 中；仅读取清单包，不执行/导入外层 EXE。
    const names = new Set(entries.map(entry => normEntry(entry.entryName)))
    if (!nested && !names.has('modrinth.index.json') && !names.has('manifest.json') && !detectFullpackEntry(zip)) {
      const packs = entries.filter(entry => !entry.isDirectory && /\.mrpack$/i.test(entry.entryName))
      if (packs.length > 1) throw new Error('整合包包含多个 mrpack，请解压后选择要导入的那个 mrpack')
      if (packs.length === 1) {
        if (packs[0].header.size > 512 * 1024 * 1024) throw new Error('整合包内层 mrpack 超过 512 MB，请解压后直接导入')
        return openPackZip(filePath, packs[0].getData())
      }
    }
    return zip
  } catch (error) {
    if (error instanceof Error && /^整合包(?:文件数量|解压后|条目|整体|包含|内层)/.test(error.message)) {
      throw error
    }
    throw new Error('整合包文件损坏或不是有效的压缩包')
  }
}

/** 全量包探测结果 */
interface FullpackDetected {
  /** 包内游戏版本 id（versions/<vid>/<vid>.json） */
  vid: string
  /** 版本 json 条目名（归一化后） */
  jsonEntry: string
  /** 游戏根目录前缀（zip 条目名，含尾斜杠；'' = zip 根，如 'xxx/.minecraft/'） */
  prefix: string
}

/** 探测 zip 内 versions/<vid>/<vid>.json（任意嵌套前缀）；多版本时选继承链顶端的加载器版本 */
function detectFullpackEntry(zip: AdmZip): FullpackDetected | null {
  const all: FullpackDetected[] = []
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue
    const name = normEntry(e.entryName)
    const m = /(?:^|\/)versions\/([^/]+)\/\1\.json$/.exec(name)
    if (!m) continue
    const tail = `versions/${m[1]}/${m[1]}.json`
    all.push({ vid: m[1], jsonEntry: name, prefix: name.slice(0, name.length - tail.length) })
  }
  if (!all.length) return null

  // 同一游戏根前缀成组：.minecraft/ 下优先，其次 zip 根
  const prefScore = (p: string): number => (/\.minecraft\/$/i.test(p) ? 2 : p === '' ? 1 : 0)
  let group = all.filter((c) => c.prefix === all[0].prefix)
  let groupScore = prefScore(all[0].prefix)
  for (const c of all) {
    const s = prefScore(c.prefix)
    if (s > groupScore) {
      groupScore = s
      group = all.filter((x) => x.prefix === c.prefix)
    }
  }

  // 继承链顶端 = 没有被其他版本 inheritsFrom 指向的 vid（全量包常同时携带原版基础版本）
  const inherited = new Set<string>()
  for (const c of group) {
    try {
      const j = JSON.parse(zip.getEntry(c.jsonEntry)?.getData().toString('utf-8') ?? '{}') as {
        inheritsFrom?: unknown
      }
      if (typeof j.inheritsFrom === 'string' && j.inheritsFrom) inherited.add(j.inheritsFrom)
    } catch {
      /* 单个 json 损坏不阻断探测；若恰好被选中，parseFullpack 会报友好错误 */
    }
  }
  const leaves = group.filter((c) => !inherited.has(c.vid))
  const pool = leaves.length ? leaves : group
  return pool.find((c) => /fabric|forge|quilt|neoforge/i.test(c.vid)) ?? pool[0]
}

type Detected =
  | { format: 'mrpack' | 'curseforge' }
  | { format: 'fullpack'; full: FullpackDetected }

/** 三格式探测：mrpack → curseforge → fullpack，均不命中抛错 */
function detectPack(zip: AdmZip): Detected {
  const names = new Set(zip.getEntries().map((e) => normEntry(e.entryName)))
  if (names.has('modrinth.index.json')) return { format: 'mrpack' }
  if (names.has('manifest.json')) return { format: 'curseforge' }
  const full = detectFullpackEntry(zip)
  if (full) return { format: 'fullpack', full }
  throw new Error(
    '无法识别的整合包格式（支持 Modrinth .mrpack、CurseForge .zip 与含 versions 目录的完整客户端包）'
  )
}

// ---------------- Modrinth .mrpack ----------------

/** mrpack dependencies → 加载器（取第一个命中的） */
const MR_LOADERS: Array<[string, LoaderName]> = [
  ['fabric-loader', 'fabric'],
  ['quilt-loader', 'quilt'],
  ['neoforge', 'neoforge'],
  ['forge', 'forge']
]

function parseMrpack(zip: AdmZip): Parsed {
  let idx: MrpackIndex | null = null
  try {
    idx = readEntryJson(zip, 'modrinth.index.json') as MrpackIndex | null
  } catch {
    throw new Error('modrinth.index.json 已损坏，整合包无法解析')
  }
  if (idx?.formatVersion !== 1) {
    throw new Error(`不支持的 Modrinth 整合包格式版本：${idx?.formatVersion ?? '缺失'}（当前支持 1）`)
  }
  if (idx.game !== 'minecraft') {
    throw new Error(`该 Modrinth 包不是 Minecraft 整合包：${idx.game || 'game 字段缺失'}`)
  }
  const mcVersion = idx?.dependencies?.minecraft
  if (!mcVersion) throw new Error('整合包清单缺少 Minecraft 版本，文件可能损坏')

  let loader: LoaderName | undefined
  let loaderVersion: string | undefined
  for (const [key, l] of MR_LOADERS) {
    const v = idx?.dependencies?.[key]
    if (v) {
      loader = l
      loaderVersion = v
      break
    }
  }

  const files: PendingFile[] = []
  const seenPaths = new Set<string>()
  for (const f of idx?.files ?? []) {
    if (!f?.path) throw new Error('modrinth.index.json 包含缺少 path 的文件项')
    // 客户端明确 unsupported 即服务端专用；optional / required 均可装入客户端。
    if (f.env?.client === 'unsupported') continue
    const rel = f.path.replace(/\\/g, '/').replace(/^\.\//, '')
    if (!safeJoin(path.join(process.cwd(), '.mrpack-path-check'), rel)) {
      throw new Error(`Modrinth 文件路径不安全：${f.path}`)
    }
    const identity = process.platform === 'win32' ? rel.toLowerCase() : rel
    if (seenPaths.has(identity)) throw new Error(`Modrinth 清单包含重复目标路径：${rel}`)
    seenPaths.add(identity)
    const urls = (f.downloads ?? []).filter((value) => {
      try {
        return new URL(value).protocol === 'https:'
      } catch {
        return false
      }
    })
    if (!urls.length) throw new Error(`Modrinth 文件没有可信 HTTPS 下载地址：${rel}`)
    const sha1 = f.hashes?.sha1?.toLowerCase()
    const sha512 = f.hashes?.sha512?.toLowerCase()
    if (!sha1 && !sha512) throw new Error(`Modrinth 文件缺少 SHA1/SHA512：${rel}`)
    if (sha1 && !/^[a-f0-9]{40}$/.test(sha1)) throw new Error(`Modrinth 文件 SHA1 无效：${rel}`)
    if (sha512 && !/^[a-f0-9]{128}$/.test(sha512)) throw new Error(`Modrinth 文件 SHA512 无效：${rel}`)
    files.push({
      rel,
      url: urls[0],
      urls: urls.slice(1),
      sha1,
      sha512,
      size: f.fileSize ?? 0
    })
  }

  return {
    kind: 'mrpack',
    meta: {
      name: (idx?.name ?? '').trim() || '未命名整合包',
      packVersion: idx?.versionId ?? '',
      mcVersion,
      loader,
      loaderVersion,
      overridesPrefix: 'overrides',
      clientOverridesPrefix: 'client-overrides'
    },
    files
  }
}

// ---------------- CurseForge .zip ----------------

const CF_LOADER_IDS = new Set(['fabric', 'forge', 'quilt', 'neoforge'])

function parseCurseForge(zip: AdmZip): Parsed {
  let mf: CfManifest | null = null
  try {
    mf = readEntryJson(zip, 'manifest.json') as CfManifest | null
  } catch {
    throw new Error('manifest.json 已损坏，整合包无法解析')
  }
  const mcVersion = mf?.minecraft?.version
  if (!mcVersion) throw new Error('整合包清单缺少 Minecraft 版本，文件可能损坏')

  let loader: LoaderName | undefined
  let loaderVersion: string | undefined
  const modLoaders = mf?.minecraft?.modLoaders ?? []
  const primary = modLoaders.find((l) => l.primary) ?? modLoaders[0]
  if (primary?.id) {
    // id 形如 forge-47.2.0 / fabric-0.16.9
    const m = /^([A-Za-z]+)-(.+)$/.exec(primary.id)
    const name = (m?.[1] ?? '').toLowerCase()
    if (!m || !CF_LOADER_IDS.has(name)) {
      throw new Error(`暂不支持该整合包使用的加载器：${primary.id}`)
    }
    loader = name as LoaderName
    loaderVersion = m[2]
  }

  return {
    kind: 'curseforge',
    meta: {
      name: (mf?.name ?? '').trim() || '未命名整合包',
      packVersion: mf?.version ?? '',
      mcVersion,
      loader,
      loaderVersion,
      overridesPrefix: mf?.overrides ?? 'overrides'
    },
    files: (mf?.files ?? [])
      .filter((f) => !!f?.projectID && !!f?.fileID)
      .map((f) => ({ projectID: f.projectID as number, fileID: f.fileID as number }))
  }
}

// ---------------- 全量包（解压即玩） ----------------

interface FullpackMeta {
  vid: string
  prefix: string
  mcVersion: string
  loader?: LoaderName
  loaderVersion?: string
}

/** id 关键词 → 加载器与版本号猜测（顺序敏感：neoforge 先于 forge） */
const FULL_LOADER_GUESS: Array<[LoaderName, RegExp]> = [
  ['neoforge', /neoforge[-_]([0-9][\w.]*)/],
  ['fabric', /fabric-loader[-_]([0-9][\w.]*)/],
  ['quilt', /quilt-loader[-_]([0-9][\w.]*)/],
  ['forge', /forge[-_]([0-9][\w.]*)/]
]

/** 解析全量包版本 json：mcVersion 取 inheritsFrom（无则 id）；loader 由 _loader 或 id 关键词推断 */
function parseFullpack(zip: AdmZip, det: FullpackDetected): FullpackMeta {
  let json: {
    id?: unknown
    inheritsFrom?: unknown
    _loader?: unknown
    _loaderVersion?: unknown
  } | null = null
  try {
    json = JSON.parse(zip.getEntry(det.jsonEntry)?.getData().toString('utf-8') ?? '')
  } catch {
    throw new Error('包内版本描述文件已损坏，整合包无法解析')
  }
  const id = typeof json?.id === 'string' && json.id ? json.id : det.vid
  const mcVersion =
    typeof json?.inheritsFrom === 'string' && json.inheritsFrom ? json.inheritsFrom : id

  let loader: LoaderName | undefined
  let loaderVersion: string | undefined
  const declared = typeof json?._loader === 'string' ? json._loader.toLowerCase() : ''
  if (CF_LOADER_IDS.has(declared)) {
    loader = declared as LoaderName
    loaderVersion = typeof json?._loaderVersion === 'string' ? json._loaderVersion : undefined
  } else {
    const text = id.toLowerCase()
    for (const [l, re] of FULL_LOADER_GUESS) {
      const m = re.exec(text)
      if (m) {
        loader = l
        loaderVersion = m[1]
        break
      }
    }
    if (!loader) {
      if (text.includes('neoforge')) loader = 'neoforge'
      else if (text.includes('fabric')) loader = 'fabric'
      else if (text.includes('quilt')) loader = 'quilt'
      else if (text.includes('forge')) loader = 'forge'
    }
  }
  return { vid: det.vid, prefix: det.prefix, mcVersion, loader, loaderVersion }
}

// ---- 全量包解压：无用文件过滤 ----

/** Windows 非法设备名（含带扩展名形式，如 nul.txt） */
const ILLEGAL_NAME = /^(nul|aux|con|prn|com[1-9]|lpt[1-9])(\..*)?$/i
/** 系统垃圾文件 */
const JUNK_FILE = /^(\.ds_store|thumbs\.db|desktop\.ini)$/i
/** 整目录跳过：macOS 元数据 / 日志 / 崩溃报告 */
const SKIP_DIR = new Set(['__macosx', 'logs', 'crash-reports'])

/** 全量包条目是否跳过：目录穿越 / 启动器与脚本(*.exe|*.bat|*.cmd) / 系统垃圾 / 日志崩溃 / 非法名 */
function skipFullEntry(rel: string): boolean {
  const parts = rel.split('/').filter(Boolean)
  if (!parts.length || parts.includes('..')) return true
  const file = parts[parts.length - 1]
  if (/\.(exe|bat|cmd)$/i.test(file)) return true
  if (JUNK_FILE.test(file)) return true
  for (const seg of parts) {
    if (SKIP_DIR.has(seg.toLowerCase())) return true
    if (ILLEGAL_NAME.test(seg)) return true
  }
  return false
}

/** 已知游戏根内容（无 .minecraft 前缀时判定 zip 根游戏文件用） */
const GAME_ROOT_HINTS = new Set([
  'mods',
  'config',
  'defaultconfigs',
  'saves',
  'resourcepacks',
  'shaderpacks',
  'screenshots',
  'schematics',
  'datapacks',
  'kubejs',
  'scripts',
  'libraries',
  'assets',
  'cache',
  'backups',
  'journeymap',
  'options.txt',
  'optionsof.txt',
  'servers.dat',
  'servers.dat_old'
])

/**
 * 计算全量包普通条目相对游戏根的路径与来源优先级。
 * score 2 = 来自 .minecraft/ 下（多处前缀冲突时优先）；1 = 游戏根前缀 / zip 根；null = 与游戏无关跳过
 */
function fullpackGameRel(
  name: string,
  det: FullpackDetected
): { rel: string; score: number } | null {
  if (det.prefix && name.startsWith(det.prefix)) {
    const rel = name.slice(det.prefix.length)
    if (!rel) return null
    return { rel, score: /\.minecraft\/$/i.test(det.prefix) ? 2 : 1 }
  }
  const mi = name.toLowerCase().indexOf('.minecraft/')
  if (mi >= 0) {
    const rel = name.slice(mi + '.minecraft/'.length)
    return rel ? { rel, score: 2 } : null
  }
  const first = name.split('/')[0]?.toLowerCase() ?? ''
  if (GAME_ROOT_HINTS.has(first)) return { rel: name, score: 1 }
  return null
}

type ZipEntry = ReturnType<AdmZip['getEntries']>[number]

interface ExtractOp {
  entry: ZipEntry
  dest: string
  /** 目标已存在时跳过（保护已安装的游戏版本） */
  skipIfExists: boolean
}

/** 汇总全量包解压计划：versions/** → 全局 versions 目录；其余游戏文件 → 实例目录（去重） */
function planFullpackExtract(zip: AdmZip, det: FullpackDetected, instDir: string): ExtractOp[] {
  const ops: ExtractOp[] = []
  const vpre = det.prefix + 'versions/'

  // a) 包内 versions/** 注册为全局游戏版本（zip 自带 <vid>.json/.jar 与可能的原版基础版本）
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const name = normEntry(entry.entryName)
    if (!name.startsWith(vpre)) continue
    const rel = name.slice(vpre.length)
    if (rel.split('/').filter(Boolean).length < 2) continue // 必须形如 <vid>/<file>
    if (skipFullEntry(rel)) continue
    const dest = safeJoin(versionsDir(), rel)
    if (!dest) continue
    ops.push({ entry, dest, skipIfExists: true })
  }

  // b) 其余游戏文件 → 实例目录；同名冲突以 .minecraft/ 下来源为准
  const picked = new Map<string, { entry: ZipEntry; dest: string; score: number }>()
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const name = normEntry(entry.entryName)
    if (name.startsWith(vpre)) continue
    const g = fullpackGameRel(name, det)
    if (!g || skipFullEntry(g.rel)) continue
    const dest = safeJoin(instDir, g.rel)
    if (!dest) continue
    const key = g.rel.toLowerCase()
    const old = picked.get(key)
    if (!old || g.score > old.score) picked.set(key, { entry, dest, score: g.score })
  }
  for (const p of picked.values()) ops.push({ entry: p.entry, dest: p.dest, skipIfExists: false })
  return ops
}

/** 全量包安装：注册游戏版本 + 游戏文件入实例目录 + 写实例 json */
async function installFullpack(
  zip: AdmZip,
  det: FullpackDetected,
  fileName: string,
  nameSource: 'file' | 'inner',
  emit: ProgressEmit,
  signal?: AbortSignal
): Promise<string> {
  emit({ stage: 'modpack', progress: 0, text: '解析整合包信息…' })
  const meta = parseFullpack(zip, det)
  const name = (nameSource === 'inner' ? meta.vid : fileName) || meta.vid
  const loaderText = meta.loader ? ` + ${meta.loader} ${meta.loaderVersion ?? ''}` : ''
  emit({ stage: 'modpack', progress: 0.02, text: `${name}（MC ${meta.mcVersion}${loaderText}）` })

  // 实例 id 不能撞包内注册的游戏版本 id（否则实例 json 会覆盖版本 json）
  const shippedVids = new Set<string>()
  const vpre = det.prefix + 'versions/'
  for (const e of zip.getEntries()) {
    const n = normEntry(e.entryName)
    if (!n.startsWith(vpre)) continue
    const seg = n.slice(vpre.length).split('/')[0]
    if (seg) shippedVids.add(seg)
  }
  const id = uniqueInstanceId(name, shippedVids)
  const instDir = versionDir(id)
  fs.mkdirSync(instDir, { recursive: true })

  const ops = planFullpackExtract(zip, det, instDir)
  const total = ops.length
  let done = 0
  const createdFiles: string[] = []
  try {
    for (const op of ops) {
      throwIfCancelled(signal)
      done++
      if (!(op.skipIfExists && fs.existsSync(op.dest))) {
        fs.mkdirSync(path.dirname(op.dest), { recursive: true })
        fs.writeFileSync(op.dest, op.entry.getData())
        createdFiles.push(op.dest)
      }
      if (done % 8 === 0 || done === total) {
        emit({
          stage: 'modpack',
          progress: 0.05 + (total ? (done / total) * 0.9 : 0.9),
          text: `解压游戏文件 ${done}/${total}`
        })
        // 让主进程有机会处理“取消”IPC，避免大量同步 ZIP 条目饿死事件循环。
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }

    // 版本注册校验：版本 json 必须就位（zip 内必有，除非被意外跳过）
    if (!fs.existsSync(versionJsonPath(meta.vid))) {
      throw new Error('游戏版本注册失败：包内缺少有效的版本描述文件')
    }

    throwIfCancelled(signal)
    emit({ stage: 'modpack', progress: 0.97, text: '创建游戏实例…' })
    const instanceJson = {
      id,
      inheritsFrom: meta.vid,
      ...(meta.loader ? { _loader: meta.loader, _loaderVersion: meta.loaderVersion } : {}),
      _gameDir: true,
      _modpackName: name,
      _modpackVersion: meta.vid
    }
    fs.writeFileSync(versionJsonPath(id), JSON.stringify(instanceJson, null, 2), 'utf-8')
    registerVersionFolder(id, gameDir())
    // 自包含化：把包内/继承的运行时内容合并进实例（基础版本改名/删除不再影响本实例）
    try {
      flattenInstance(id)
    } catch {
      /* flatten 失败保留旧式继承，不影响启动 */
    }

    emit({ stage: 'done', progress: 1, text: `${name} 安装完成` })
    return id
  } catch (e) {
    // 只回滚本次新建文件；skipIfExists 的用户既有版本文件绝不删除。
    for (const file of createdFiles.reverse()) fs.rmSync(file, { force: true })
    fs.rmSync(instDir, { recursive: true, force: true })
    throw e
  }
}

// ---------------- CurseForge 文件地址解析（MCIM 国内镜像，免 key） ----------------

const MCIM_CF = 'https://mod.mcimirror.top/curseforge/v1'

async function cfSources() {
  const { cfChannel } = await import('./community')
  const channel = cfChannel()
  const official = { base: channel.base, headers: channel.official ? { 'x-api-key': channel.key } : undefined }
  const mirror = { base: MCIM_CF }
  const sources = channel.official ? (getSettings().mirror === 'bmclapi' ? [mirror, official] : [official, mirror]) : [mirror]
  return sources
}

/** 简单并发池（保序写入结果数组） */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let idx = 0
  const worker = async (signal: AbortSignal): Promise<void> => {
    while (idx < items.length) {
      throwIfCancelled(signal)
      const i = idx++
      out[i] = await fn(items[i], i, signal)
    }
  }
  await runParallelTasks(Array.from({ length: Math.min(limit, items.length) }, () => worker), signal)
  return out
}

/** 只解压 overrides 前缀下的普通文件；不安全路径或符号链接直接拒绝。 */
export async function extractOverrides(
  zip: AdmZip,
  prefix: string | null,
  destDir: string,
  signal?: AbortSignal,
  progress?: (done: number, total: number, name: string) => void
): Promise<string[]> {
  if (!prefix) return []
  const pre = normEntry(prefix).replace(/\/+$/, '') + '/'
  const extracted: string[] = []
  const files = zip.getEntries().filter(entry => !entry.isDirectory && normEntry(entry.entryName).startsWith(pre)).map(entry => {
    throwIfCancelled(signal)
    const name = normEntry(entry.entryName)
    const rel = name.slice(pre.length)
    const dest = safeJoin(destDir, rel)
    if (!dest) throw new Error(`overrides 包含不安全路径：${rel}`)
    if (((entry.attr >>> 16) & 0o170000) === 0o120000) {
      throw new Error(`overrides 不允许符号链接：${rel}`)
    }
    if (entry.header.size > 512 * 1024 * 1024) throw new Error(`overrides 单文件超过 512 MB：${rel}`)
    return { entry, dest, rel: rel.replace(/\\/g, '/') }
  })
  const directories = new Map<string, Promise<unknown>>()
  let lastReported = 0
  for (let cursor = 0; cursor < files.length;) {
    // Bound both memory and writes. Large entries run alone; aliases never write
    // concurrently. Preserve ZIP order and drain all writers before rollback.
    const batch: typeof files = [], destinations = new Set<string>()
    let bytes = 0
    while (cursor < files.length && batch.length < 4) {
      const item = files[cursor], key = process.platform === 'win32' ? item.dest.toLowerCase() : item.dest
      if (batch.length && (bytes + item.entry.header.size > 16 * 1024 * 1024 || destinations.has(key))) break
      batch.push(item); destinations.add(key); bytes += item.entry.header.size; cursor++
    }
    await runParallelTasks(batch.map(item => async signal => {
      await waitIfTaskPaused(signal); throwIfCancelled(signal)
      const dir = path.dirname(item.dest)
      if (!directories.has(dir)) directories.set(dir, fs.promises.mkdir(dir, { recursive: true }))
      await directories.get(dir)
      const data = item.entry.getData()
      throwIfCancelled(signal)
      await fs.promises.writeFile(item.dest, data, { signal })
    }), signal)
    extracted.push(...batch.map(item => item.rel))
    if (extracted.length === files.length || performance.now() - lastReported >= 100) {
      lastReported = performance.now()
      progress?.(extracted.length, files.length, batch.at(-1)!.rel)
    }
  }
  return extracted
}

const fmtMB = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1) + 'MB'

const normalizedInstanceName = (value: string): string =>
  sanitizeId(value).normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('en-US')

function existingPackInstances(meta: PackMeta, fileName: string): ModpackInfo['existingInstances'] {
  const names = new Set([normalizedInstanceName(meta.name), normalizedInstanceName(fileName)])
  try {
    return listAllInstalled()
      .map((item) => ({
        id: item.id,
        folder: item.folder,
        sameNormalizedName:
          names.has(normalizedInstanceName(item.id)) ||
          (!!item.modpackName && names.has(normalizedInstanceName(item.modpackName))),
        samePackVersion:
          !!item.modpackName &&
          normalizedInstanceName(item.modpackName) === normalizedInstanceName(meta.name) &&
          item.modpackVersion === meta.packVersion
      }))
  } catch {
    return []
  }
}

interface PackTransactionManifest {
  schemaVersion: 1
  name: string
  version: string
  managedFiles: string[]
  installedAt: string
}

const PACK_MANIFEST = '.kamucl-modpack.json'
const PRESERVE_ROOTS = new Set([
  'saves',
  'mods',
  'config',
  'resourcepacks',
  'shaderpacks',
  'screenshots',
  'options.txt',
  'servers.dat'
])

function readManagedFiles(instanceDir: string): Set<string> {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(instanceDir, PACK_MANIFEST), 'utf-8')) as {
      managedFiles?: unknown
    }
    return new Set(
      Array.isArray(value.managedFiles)
        ? value.managedFiles.filter((item): item is string => typeof item === 'string')
        : []
    )
  } catch {
    return new Set()
  }
}

export async function restoreModpackUserFiles(
  backup: string,
  destination: string,
  action: 'update' | 'overwrite',
  oldManaged: ReadonlySet<string>,
  signal?: AbortSignal
): Promise<void> {
  const queue: Array<{ source: string; destination: string; rel: string }> = [
    { source: backup, destination, rel: '' }
  ]
  while (queue.length) {
    throwIfCancelled(signal)
    const current = queue.pop()!
    for (const entry of await fs.promises.readdir(current.source, { withFileTypes: true })) {
      const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name
      const top = rel.split('/')[0]
      if (rel === PACK_MANIFEST || /^\.installing$/i.test(rel) || /\.json$|\.jar$/i.test(rel) && !current.rel) continue
      if (action === 'overwrite' && !PRESERVE_ROOTS.has(top)) continue
      if (oldManaged.has(rel)) continue
      const source = path.join(current.source, entry.name)
      const target = path.join(current.destination, entry.name)
      const stat = await fs.promises.lstat(source)
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) {
        await fs.promises.mkdir(target, { recursive: true })
        queue.push({ source, destination: target, rel })
        continue
      }
      await fs.promises.mkdir(path.dirname(target), { recursive: true })
      const userWins = top === 'saves' || top === 'config' || top === 'screenshots' || top === 'options.txt' || top === 'servers.dat'
      if (!fs.existsSync(target) || userWins) await fs.promises.copyFile(source, target)
    }
  }
}

function requestedGameFolder(input?: string): string {
  const state = listGameFolders()
  if (!input) return state.active
  const target = canonicalPath(input)
  const registered = state.folders.find((folder) => samePath(folder.path, target))
  if (!registered) throw new Error('目标游戏文件夹未在 KAMUCL 中登记')
  return registered.path
}

/** 只解析整合包元信息（不解压不下载），供导入确认弹窗展示 */
export async function probeModpack(filePath: string): Promise<ModpackInfo> {
  packLog.debug(`解析整合包元信息：${path.basename(filePath)}`)
  const zip = openPackZip(filePath)
  return modpackInfo(zip, filePath)
}

/** A recognized pack must never fall through to its bundled worlds, even when malformed. */
export async function probeRecognizedModpack(filePath: string): Promise<ModpackInfo | null> {
  const zip = openPackZip(filePath)
  const names = new Set(zip.getEntries().map(entry => normEntry(entry.entryName)))
  if (!names.has('modrinth.index.json') && !names.has('manifest.json') && !detectFullpackEntry(zip)) return null
  return modpackInfo(zip, filePath)
}

function modpackInfo(zip: AdmZip, filePath: string): ModpackInfo {
  const detected = detectPack(zip)
  const fileName = packFileName(filePath)
  if (detected.format === 'fullpack') {
    const meta = parseFullpack(zip, detected.full)
    const entries = zip.getEntries().filter((entry) => !entry.isDirectory)
    return {
      format: 'fullpack',
      innerName: meta.vid,
      fileName,
      version: meta.vid,
      mcVersion: meta.mcVersion,
      loader: meta.loader,
      loaderVersion: meta.loaderVersion,
      fileCount: entries.length,
      downloadBytes: entries.reduce((sum, entry) => sum + entry.header.size, 0),
      hasOverrides: false,
      hasClientOverrides: false,
      existingInstances: []
    }
  }
  const parsed = detected.format === 'mrpack' ? parseMrpack(zip) : parseCurseForge(zip)
  const { meta } = parsed
  const files = parsed.files
  return {
    format: detected.format,
    innerName: meta.name,
    fileName,
    version: meta.packVersion,
    mcVersion: meta.mcVersion,
    loader: meta.loader,
    loaderVersion: meta.loaderVersion,
    fileCount: files.length,
    downloadBytes:
      parsed.kind === 'mrpack' ? parsed.files.reduce((sum, file) => sum + file.size, 0) : 0,
    hasOverrides: !!meta.overridesPrefix && zip.getEntries().some((entry) => normEntry(entry.entryName).startsWith(`${meta.overridesPrefix}/`)),
    hasClientOverrides:
      !!meta.clientOverridesPrefix &&
      zip.getEntries().some((entry) => normEntry(entry.entryName).startsWith(`${meta.clientOverridesPrefix}/`)),
    hasPresetKeys: zip.getEntries().some((entry) => {
      const name = normEntry(entry.entryName)
      return name === `${meta.overridesPrefix}/options.txt` ||
        (!!meta.clientOverridesPrefix && name === `${meta.clientOverridesPrefix}/options.txt`)
    }),
    existingInstances: existingPackInstances(meta, fileName)
  }
}

/**
 * 安装整合包，返回实例版本 id。
 * 实例版本 json 带 _gameDir: true（启动时游戏目录隔离到 versions/<id>）。
 * opts.nameSource：'file'（默认）以压缩包文件名命名实例；'inner' 以包内名称命名
 */
export async function installModpack(
  filePath: string,
  emit: ProgressEmit,
  opts?: ModpackInstallOpts
): Promise<string> {
  const started = Date.now()
  packLog.info(`开始安装整合包 ${path.basename(filePath)} → 文件夹 ${opts?.targetFolder || '当前活动文件夹'}`)
  try {
    const id = await (async () => {
      const folder = requestedGameFolder(opts?.targetFolder)
      return withGameFolder(folder, () => installModpackInFolder(filePath, emit, { ...opts, targetFolder: folder }))
    })()
    packLog.info(`整合包 ${path.basename(filePath)} 安装完成：实例 ${id}（耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）`)
    return id
  } catch (error) {
    if (error instanceof Error && /已取消|取消/.test(error.message)) {
      packLog.info(`整合包 ${path.basename(filePath)} 安装已取消`)
    } else {
      packLog.error(`整合包 ${path.basename(filePath)} 安装失败`, error)
    }
    throw error
  }
}

async function installModpackInFolder(filePath: string, emit: ProgressEmit, opts?: ModpackInstallOpts): Promise<string> {
  let manualFiles: ManualModpackRequest | null = null
  const report: ProgressEmit = (event) =>
    emit({ ...event, manualFiles, overall: event.overall ?? event.progress })
  const targetFolder = requestedGameFolder(opts?.targetFolder)
  setActiveGameFolder(targetFolder)
  // 1) 校验存在性与 zip 可读、探测格式
  const zip = openPackZip(filePath)
  const nameSource = opts?.nameSource === 'inner' ? 'inner' : 'file'
  const fileName = packFileName(filePath)
  const detected = detectPack(zip)

  // 全量包：解压即玩，无需下载
  if (detected.format === 'fullpack') {
    return await installFullpack(zip, detected.full, fileName, nameSource, report, opts?.signal)
  }

  // 2) 解析清单
  report({ stage: 'modpack', progress: 0, text: '解析整合包信息…' })
  const parsed = detected.format === 'mrpack' ? parseMrpack(zip) : parseCurseForge(zip)
  throwIfCancelled(opts?.signal)
  const { meta } = parsed
  const loaderText = meta.loader ? ` + ${meta.loader} ${meta.loaderVersion ?? ''}` : ''
  report({
    stage: 'modpack',
    progress: 0.02,
    text: `${meta.name}（MC ${meta.mcVersion}${loaderText}）`
  })

  // 3) 实例命名与冲突动作。更新/覆盖必须携带确认页的显式确认。
  const requestedName = sanitizeId(
    opts?.instanceName?.trim() || (nameSource === 'inner' ? meta.name : fileName)
  )
  const action = opts?.conflictAction ?? 'new'
  let id: string
  let backupDir = ''
  let oldManaged = new Set<string>()
  if (action === 'update' || action === 'overwrite') {
    if (!opts?.confirmReplace) throw new Error(`${action === 'update' ? '更新' : '覆盖'}现有实例前必须在确认页明确确认`)
    id = sanitizeId(opts.existingId ?? '')
    if (!opts.existingId || id !== opts.existingId.trim()) throw new Error('需要选择有效的现有实例')
    const existing = listAllInstalled().find((item) => item.id === id && samePath(item.folder, targetFolder))
    if (!existing) throw new Error(`目标文件夹中找不到待${action === 'update' ? '更新' : '覆盖'}实例：${id}`)
    registerVersionFolder(id, targetFolder)
    const currentDir = versionDir(id)
    await backupInstance({folder:targetFolder,id},'整合包覆盖前',true,undefined,opts?.signal)
    oldManaged = readManagedFiles(currentDir)
    backupDir = path.join(path.dirname(currentDir), `.${path.basename(currentDir)}.kamucl-backup-${crypto.randomUUID()}`)
    fs.renameSync(currentDir, backupDir)
  } else if (action === 'rename') {
    id = requestedName
    if (fs.existsSync(path.join(targetFolder, 'versions', id))) throw new Error(`实例名称已存在：${id}`)
  } else {
    id = uniqueInstanceId(requestedName)
  }
  registerVersionFolder(id, targetFolder)
  const instDir = versionDir(id)
  let prepared: Awaited<ReturnType<typeof prepareModpackFiles>> | undefined

  try {
    // Download immutable pack files while preparing the runtime; commit only after both succeed.
    const parallel = new ParallelProgress([
      { id: 'runtime', label: '游戏环境与加载器', weight: 0.44 },
      { id: 'pack', label: '整合包文件', weight: 0.47 }
    ], report, '同步准备游戏环境与整合包文件', [0.04, 0.95])
    let pending: PendingFile[] = []
    const manual: ManualModpackFile[] = []
    const [installedId] = await runParallelTasks([
      async (signal) => {
        const installedId = await installVersion(
          meta.mcVersion,
          { instanceName: id, ...(meta.loader ? { loader: meta.loader, loaderVersion: meta.loaderVersion } : {}) },
          event => parallel.update('runtime', event), signal
        )
        parallel.done('runtime')
        return installedId
      },
      async (signal) => {
        parallel.update('pack', { stage: 'modpack', progress: 0, text: '准备整合包文件清单' })
        if (parsed.kind === 'mrpack') {
          pending = parsed.files
        } else {
          // Match immutable identity before requesting a URL. Preserve bundled paths;
          // otherwise copy verified local files or download the exact manifest version.
          const cfFiles = parsed.files
          const bundled = new BundledModpackFiles(zip, meta.overridesPrefix)
          const localFiles = new LocalModpackFiles([...allFolders(), targetFolder])
          const sources = await cfSources()
          let resolved = 0, reused = 0, reusedLocal = 0, alternate = 0
          const infos = await mapPool(
            cfFiles,
            8,
            async (f, _index, signal) => {
              const info = await resolveCurseForgeMetadata(f.projectID, f.fileID, sources, signal)
              const local = await bundled.find(info, signal)
              let existing: string | null = null
              if (local) reused++
              else if (!info.isAvailable || !info.url) {
                existing = await localFiles.find(info, signal)
                if (existing) reusedLocal++
                else {
                  info.url = info.isAvailable ? await resolveCurseForgeFileUrl(f.projectID, f.fileID, sources, signal) : null
                  if (!info.url && info.isAvailable) {
                    const cdn = constructCurseForgeCdnUrl(f.fileID, info.fileName)
                    if (await probeCurseForgeCdnUrl(cdn, signal)) info.url = cdn
                  }
                  info.url ??= await exactModrinthDownload(info, signal)
                  if (!info.url) {
                    existing = await prepareCurseMavenFile(f.projectID, f.fileID, info, getSettings().mirror, signal)
                    if (existing) alternate++
                    else manual.push({ ...f, fileName: info.fileName, size: info.size, sha1: info.sha1 })
                  }
                }
              }
              resolved++
              parallel.update('pack', {
                stage: 'modpack',
                progress: cfFiles.length ? (resolved / cfFiles.length) * 0.04 : 0,
                text: `校验整合包文件 ${resolved}/${cfFiles.length} · 包内 ${reused} 个 · 本地 ${reusedLocal} 个 · 自动补全 ${alternate} 个`
              })
              return local ? null : {
                rel: `${await curseForgeInstallDir(f.projectID, info.fileName, sources, signal)}/${info.fileName}`,
                url: info.url ?? '', size: info.size, sha1: info.sha1,
                reuseFiles: existing ? [existing] : undefined
              }
            },
            signal
          )
          pending = infos.filter((info): info is NonNullable<typeof info> => info !== null)
          packLog.info(`CurseForge 清单 ${cfFiles.length} 个文件：复用包内 ${reused} 个、本地 ${reusedLocal} 个，备用源补全 ${alternate} 个，自动下载 ${pending.length - manual.length - reusedLocal - alternate} 个，待补充 ${manual.length} 个`)
        }

        const tasks: DownloadTask[] = []
        for (const f of pending) {
          const dest = safeJoin(instDir, f.rel)
          if (!dest) throw new Error(`整合包文件路径不安全：${f.rel}`)
          tasks.push({
            label: f.rel,
            url: f.url,
            urls: f.urls,
            reuseFiles: f.reuseFiles,
            dest,
            sha1: f.sha1,
            sha512: f.sha512,
            size: f.size || undefined
          })
        }

        try {
          const automatic = tasks.filter(task => !!task.url || !!task.reuseFiles?.length)
          const localTasks = tasks.filter(task => !task.url && !task.reuseFiles?.length)
          const downloadProgress: Parameters<typeof prepareModpackFiles>[1] = (d, t, speed, detail) => {
            const doneBytes = detail.bytesDone
            const ratio = detail.fraction ?? 0
            parallel.update('pack', {
              stage: 'modpack',
              progress: 0.04 + ratio * 0.96,
              text:
                detail.bytesTotal != null
                  ? `下载整合包文件 ${d}/${t}（${fmtMB(doneBytes)}/${fmtMB(detail.bytesTotal)}）${detail.activeFiles?.length && detail.activeFiles.length <= 2 ? ' · ' + detail.activeFiles.join('、') : ''}`
                  : `下载整合包文件 ${d}/${t}`,
              speed,
              etaSeconds: detail.etaSeconds ?? undefined,
              bytesDone: detail.bytesDone,
              bytesTotal: detail.bytesTotal ?? undefined,
              indeterminate: detail.indeterminate
            })
          }
          const pieces: Array<Awaited<ReturnType<typeof prepareModpackFiles>>> = []
          try {
            await runParallelTasks([
              async signal => {
                pieces.push(await prepareModpackFiles(automatic, downloadProgress, getSettings().mirror, signal))
              },
              async signal => {
                if (!manual.length) return
                await waitForModpackFiles(manual, request => {
                  manualFiles = request
                  report({ stage: 'modpack', progress: 0.04, text: request ? `等待补充 ${request.files.length} 个文件；其他下载继续进行` : '补充文件已全部校验' })
                }, signal)
                pieces.push(await prepareModpackFiles(localTasks, () => {}, getSettings().mirror, signal))
              }
            ], signal)
          } catch (error) { await Promise.all(pieces.map(piece => piece.dispose())); throw error }
          prepared = {
            install: async signal => { for (const piece of pieces) await piece.install(signal) },
            dispose: async () => { await Promise.all(pieces.map(piece => piece.dispose())) }
          }
        } catch (e) {
          throw new Error(`整合包文件下载失败：${errText(e)}`)
        }
        parallel.done('pack')
      }
    ], opts?.signal)
    throwIfCancelled(opts?.signal)
    // 5) 创建实例版本
    fs.mkdirSync(instDir, { recursive: true })
    if (installedId !== id) throw new Error('整合包运行配置未安装到目标实例')
    const instanceJson = packRuntimeProfile(readVersionJson(installedId), id, meta)
    fs.writeFileSync(versionJsonPath(id), JSON.stringify(instanceJson, null, 2), 'utf-8')
    registerVersionFolder(id, gameDir())
    // 自包含化：实例不再依赖基础运行时实例
    try {
      flattenInstance(id)
    } catch {
      /* flatten 失败保留旧式继承，不影响启动 */
    }

    report({ stage: 'modpack', progress: 0.95, text: '写入已校验的整合包文件…' })
    await prepared!.install(opts?.signal)

    // 7) 解压 overrides 覆盖到实例目录
    report({ stage: 'modpack', progress: 0.96, text: '解压覆盖文件…' })
    throwIfCancelled(opts?.signal)
    const extractionProgress = (start: number, span: number) => (done: number, total: number, name: string) =>
      report({ stage: 'modpack', progress: start + span * done / Math.max(1, total), text: `正在写入整合包配置 ${done}/${total} · ${name}` })
    const overrideFiles = await extractOverrides(zip, meta.overridesPrefix, instDir, opts?.signal, extractionProgress(0.96, 0.02))
    const clientOverrideFiles = await extractOverrides(
      zip,
      meta.clientOverridesPrefix ?? null,
      instDir,
      opts?.signal,
      extractionProgress(0.98, 0.005)
    )

    // 默认按键替换：用户选择时用启动器默认键位覆盖整合包 options.txt 的 key_* 项
    if (opts?.keySyncOverride) {
      try {
        const { mergeKeysIntoOptions, getDefaultKeys } = await import('./keybindings')
        const optionsFile = path.join(instDir, 'options.txt')
        const before = fs.existsSync(optionsFile) ? fs.readFileSync(optionsFile, 'utf-8') : ''
        fs.writeFileSync(optionsFile, mergeKeysIntoOptions(before, getDefaultKeys()), 'utf-8')
      } catch (error) {
        console.warn('[KAMUCL] 整合包键位替换失败（不影响安装）:', error)
      }
    }

    if (backupDir) {
      report({ stage: 'modpack', progress: 0.985, text: '恢复存档、配置和用户文件…' })
      await restoreModpackUserFiles(backupDir, instDir, action as 'update' | 'overwrite', oldManaged, opts?.signal)
    }
    const manifest: PackTransactionManifest = {
      schemaVersion: 1,
      name: meta.name,
      version: meta.packVersion,
      managedFiles: [...new Set([...pending.map((file) => file.rel), ...overrideFiles, ...clientOverrideFiles])].sort(),
      installedAt: new Date().toISOString()
    }
    fs.writeFileSync(path.join(instDir, PACK_MANIFEST), JSON.stringify(manifest, null, 2), 'utf-8')
    if (backupDir) {
      fs.rmSync(backupDir, { recursive: true, force: true })
      backupDir = ''
    }

    // 8) 完成
    report({ stage: 'done', progress: 1, text: `${meta.name} 安装完成` })
    return id
  } catch (e) {
    // 新装整目录清理；更新/覆盖则恢复开始前原子改名的完整实例备份。
    fs.rmSync(instDir, { recursive: true, force: true })
    if (backupDir && fs.existsSync(backupDir)) fs.renameSync(backupDir, instDir)
    throw e
  } finally {
    await prepared?.dispose()
  }
}
