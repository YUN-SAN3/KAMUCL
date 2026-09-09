/**
 * 版本管理：版本清单缓存、rules 评估、原版安装、已装列表、删除
 */
import { resolveInstanceMetadata } from './instanceMetadata'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type {
  GameResolution,
  ImageFit,
  InstalledVersion,
  InstallOptions,
  ProgressEvent,
  RemoteVersion
} from '../../shared/types'
import {
  classifyHttpStatus,
  downloadAll,
  downloadCandidates,
  downloadFile,
  fetchSignal,
  type DownloadTask,
  type MirrorPref
} from './download'
import { getSettings } from './settings'
import { abortableDelay, throwIfCancelled } from './tasks'
import { createWeightedProgressEmit, VERSION_INSTALL_STAGE_RANGES } from './progress'
import { applyIsolation, instanceDirectoryState } from './instances'
import { assertValidResolution, normalizeStoredResolution } from './gameWindow'
import {
  allVersionsDirs,
  assetIndexPath,
  assetObjectPath,
  baseVersionDir,
  baseVersionJarPath,
  baseVersionJsonPath,
  folderOfVersion,
  gameDir,
  installMarkPath,
  instanceIconsDir,
  libraryPath,
  registerVersionFolder,
  versionDir,
  versionJarPath,
  versionJsonPath,
  versionsDir,
  virtualLegacyDir
} from './paths'
import { ensureInstanceThumbnail, removeInstanceThumbnail } from './appearanceAssets'

export type ProgressEmit = (e: ProgressEvent) => void

// ---------------- Mojang 版本 json 的内部结构（只取需要的字段） ----------------

export interface VersionRule {
  action: 'allow' | 'disallow'
  os?: { name?: 'windows' | 'linux' | 'osx'; arch?: 'x86' }
  features?: Record<string, boolean>
}

export interface LibraryArtifact {
  path: string
  url: string
  sha1?: string
  size?: number
}

export interface Library {
  name?: string
  /** maven 坐标形式（fabric/quilt profile）的仓库基址 */
  url?: string
  rules?: VersionRule[]
  natives?: Record<string, string>
  downloads?: {
    artifact?: LibraryArtifact
    classifiers?: Record<string, LibraryArtifact>
  }
}

export interface ArgumentEntry {
  rules?: VersionRule[]
  value: string | string[]
}

export interface AssetIndexRef {
  id: string
  url: string
  sha1?: string
  size?: number
  totalSize?: number
}

export interface VersionJson {
  id: string
  clientVersion?: string
  inheritsFrom?: string
  mainClass?: string
  minecraftArguments?: string
  arguments?: { game?: (string | ArgumentEntry)[]; jvm?: (string | ArgumentEntry)[] }
  type?: string
  assets?: string
  assetIndex?: AssetIndexRef
  javaVersion?: { majorVersion: number }
  libraries?: Library[]
  downloads?: { client?: LibraryArtifact }
  /** KAMUCL 自定义字段：加载器版本标记 */
  _loader?: 'forge' | 'fabric' | 'quilt' | 'neoforge'
  _loaderVersion?: string
  /** KAMUCL 自定义字段：实例隔离（启动时游戏目录 = 本版本目录） */
  _gameDir?: boolean
  /** 兼容已有实例描述的显式游戏目录。 */
  gameDirectory?: string
  _gameDirectory?: string
  /** KAMUCL 自定义字段：来源整合包名称/版本 */
  _modpackName?: string
  _modpackVersion?: string
  /** KAMUCL 自定义字段：版本独立指定 Java 路径 */
  _javaPath?: string
  _javaAuto?: boolean
  /** KAMUCL 自定义字段：实例级窗口设置覆盖。 */
  _resolution?: GameResolution
  /** KAMUCL 自定义字段：自定义命名的原版实例记录其真实 MC 版本 id（修复/推断用） */
  _mcVersion?: string
  /** KAMUCL 自定义字段：实例图标（'mob:<内置id>' / 'file:<自定义文件名>'） */
  _icon?: string
  /** KAMUCL 自定义字段：首页启动卡专属缩略图（受管绝对路径）。 */
  _thumbnail?: string
  _thumbnailFit?: ImageFit
  /** KAMUCL 自定义字段：已拍平为自包含实例（合并继承链完成时间），不再依赖基础原版 */
  _flattenedAt?: string
}

// ---------------- rules 评估 ----------------

/** 当前平台对应的 MC rules os 名（win32→windows / darwin→osx / linux→linux） */
export const OS_NAME: 'windows' | 'osx' | 'linux' =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'

/**
 * 评估 rules（Mojang 官方语义）：
 * 无 rules → 放行；有 rules 时，**仅当有 rule 的条件匹配当前环境**才按其 action 决定，
 * 全部不匹配 → 拒绝（默认 disallow）。
 * 带 features 的 rule 视为不匹配（quickPlay 等功能默认关闭）。
 */
export function rulesAllow(rules?: VersionRule[]): boolean {
  if (!rules || rules.length === 0) return true
  let allowed = false // 有规则但无一匹配 → 拒绝（如 macOS 专属参数 -XstartOnFirstThread）
  for (const rule of rules) {
    if (rule.features) continue
    if (rule.os) {
      if (rule.os.name && rule.os.name !== OS_NAME) continue
      if (rule.os.arch && !(rule.os.arch === 'x86' && process.arch === 'ia32')) continue
    }
    allowed = rule.action === 'allow'
  }
  return allowed
}

// ---------------- 版本清单 ----------------

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest.json'
const CACHE_TTL = 60 * 60 * 1000 // 缓存 1 小时

function manifestCacheFile(): string {
  return path.join(app.getPath('userData'), 'version_manifest.json')
}

function readManifestCache(): RemoteVersion[] | null {
  try {
    const c = JSON.parse(fs.readFileSync(manifestCacheFile(), 'utf-8'))
    return Array.isArray(c.versions) ? (c.versions as RemoteVersion[]) : null
  } catch {
    return null
  }
}

/** 拉取远程版本清单，带 1 小时本地缓存；refresh=true 强制刷新；signal 用于任务取消 */
export async function fetchVersionManifest(
  mirror: MirrorPref,
  refresh = false,
  signal?: AbortSignal
): Promise<RemoteVersion[]> {
  if (!refresh) {
    try {
      const c = JSON.parse(fs.readFileSync(manifestCacheFile(), 'utf-8'))
      if (Date.now() - c.fetchedAt < CACHE_TTL && Array.isArray(c.versions)) {
        return c.versions as RemoteVersion[]
      }
    } catch {
      /* 无缓存或损坏则联网拉取 */
    }
  }
  try {
    // 元数据官方地址优先，BMCL 仅作受支持的备用源；404/410 不重试同址。
    let data: { versions?: unknown[] } | null = null
    let lastErr: unknown = null
    sourceLoop: for (const source of downloadCandidates([MANIFEST_URL], mirror)) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (signal?.aborted) throw new Error('已取消')
        try {
          const res = await fetch(source, { signal: fetchSignal(signal) })
          if (!res.ok) {
            lastErr = new Error(`HTTP ${res.status}: ${source}`)
            if (classifyHttpStatus(res.status) !== 'transient') break
            throw lastErr
          }
          data = (await res.json()) as { versions?: unknown[] }
          break sourceLoop
        } catch (e) {
          if (signal?.aborted) throw new Error('已取消')
          lastErr = e
          if (attempt < 2) await abortableDelay(800 * (attempt + 1), signal)
        }
      }
    }
    if (!data) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
    const versions: RemoteVersion[] = (data.versions ?? []).map((v) => {
      const it = v as Record<string, string>
      return {
        id: it.id,
        type: it.type as RemoteVersion['type'],
        url: it.url,
        releaseTime: it.releaseTime
      }
    })
    fs.mkdirSync(path.dirname(manifestCacheFile()), { recursive: true })
    fs.writeFileSync(
      manifestCacheFile(),
      JSON.stringify({ fetchedAt: Date.now(), versions }),
      'utf-8'
    )
    return versions
  } catch (e) {
    // 网络失败时回退到过期缓存
    const stale = readManifestCache()
    if (stale) return stale
    throw e
  }
}

// ---------------- 版本 json ----------------

/** 同步读取本地版本 json（容错 BOM 头）；versions/ 没有时回退到 .kamucl/base 依赖原版区 */
export function readVersionJson(id: string): VersionJson {
  let p = versionJsonPath(id)
  if (!fs.existsSync(p) && fs.existsSync(baseVersionJsonPath(id))) p = baseVersionJsonPath(id)
  const raw = fs.readFileSync(p, 'utf-8')
  return JSON.parse(raw.replace(/^﻿/, '')) as VersionJson
}

/** 确保版本 json 存在并解析返回（不存在则按清单下载到 dest，默认 versions 区；signal 用于任务取消） */
export async function getVersionJson(
  versionId: string,
  dest?: string,
  signal?: AbortSignal
): Promise<VersionJson> {
  const jsonPath = dest ?? versionJsonPath(versionId)
  if (!fs.existsSync(jsonPath)) {
    const mirror = getSettings().mirror
    let manifest = await fetchVersionManifest(mirror, false, signal)
    let entry = manifest.find((v) => v.id === versionId)
    if (!entry) {
      // 可能是新发布的版本，强制刷新一次清单再找
      manifest = await fetchVersionManifest(mirror, true, signal)
      entry = manifest.find((v) => v.id === versionId)
    }
    if (!entry) throw new Error(`版本清单中找不到 ${versionId}`)
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
    await downloadFile(entry.url, jsonPath, undefined, undefined, mirror, signal)
  }
  return JSON.parse(fs.readFileSync(jsonPath, 'utf-8').replace(/^﻿/, '')) as VersionJson
}

// ---------------- 依赖库收集 ----------------

interface LibEntry {
  /** 本地绝对路径 */
  path: string
  url?: string
  sha1?: string
  size?: number
  isNative: boolean
}

/** 遍历通过 rules 的 libraries，收集 artifact 与 natives classifiers（去重） */
function collectLibraries(vj: VersionJson): LibEntry[] {
  const out: LibEntry[] = []
  const seen = new Set<string>()
  const push = (art: (Pick<LibraryArtifact, 'path'> & Partial<LibraryArtifact>) | undefined, isNative: boolean): void => {
    if (!art?.path) return
    const dest = libraryPath(art.path)
    // Installer-generated libraries have no download URL; keep a verified local
    // path on the classpath, but never create an impossible network task for it.
    if (!art.url && !fs.existsSync(dest)) return
    if (seen.has(dest)) return
    seen.add(dest)
    out.push({ path: dest, url: art.url, sha1: art.sha1, size: art.size, isNative })
  }
  /** maven 坐标（group:artifact:version[:classifier]）→ 仓库相对路径 */
  const mavenPath = (name: string): string | null => {
    const p = name.split(':')
    if (p.length < 3) return null
    const [g, a, v, classifier] = p
    const file = `${a}-${v}${classifier ? `-${classifier}` : ''}.jar`
    return `${g.replace(/\./g, '/')}/${a}/${v}/${file}`
  }
  /** 仅声明 maven 坐标（无 downloads/url，典型为安装器注入的 forge 语言提供器）时按组织推断下载源 */
  const mavenRepoBase = (name: string): string | null => {
    if (name.startsWith('net.minecraftforge:')) return 'https://maven.minecraftforge.net/'
    if (name.startsWith('net.neoforged:')) return 'https://maven.neoforged.net/releases/'
    return null
  }
  for (const lib of vj.libraries ?? []) {
    if (!rulesAllow(lib.rules)) continue
    if (lib.downloads?.artifact) {
      push(lib.downloads.artifact, false)
    } else if (lib.name && lib.url) {
      // Fabric/Quilt 等 profile 的 maven 坐标形式：无内联 downloads，需按仓库基址拼接
      const rel = mavenPath(lib.name)
      if (rel) {
        const base = lib.url.endsWith('/') ? lib.url : lib.url + '/'
        push({ path: rel, url: base + rel }, false)
      }
    } else if (lib.name) {
      // forge 安装器注入库（fmlcore/javafmllanguage/mclanguage/lowcodelanguage 等）：
      // json 仅给 maven 坐标，本地有则直接收编，缺失按组织推断 maven 源下载
      const rel = mavenPath(lib.name)
      if (rel && fs.existsSync(libraryPath(rel))) {
        push({ path: rel }, false)
      } else if (rel) {
        const base = mavenRepoBase(lib.name)
        if (base) push({ path: rel, url: base + rel }, false)
      }
    }
    const nativesKey = lib.natives?.[OS_NAME]?.replace(
      '${arch}',
      process.arch === 'ia32' ? '32' : '64'
    )
    if (nativesKey) push(lib.downloads?.classifiers?.[nativesKey], true)
  }
  return out
}

/** 依赖库下载任务（供 installVersion 与 loaders 复用） */
export function libraryTasks(vj: VersionJson): DownloadTask[] {
  return collectLibraries(vj)
    .filter((e) => e.url)
    .map((e) => ({ url: e.url as string, dest: e.path, sha1: e.sha1, size: e.size }))
}

/** 启动用：classpath 中的 artifact 路径与 natives jar 路径 */
export function resolvedLibraries(vj: VersionJson): { artifacts: string[]; natives: string[] } {
  const entries = collectLibraries(vj)
  return {
    artifacts: entries.filter((e) => !e.isNative).map((e) => e.path),
    natives: entries.filter((e) => e.isNative).map((e) => e.path)
  }
}

// ---------------- 安装 ----------------

function fmtMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + 'MB'
}

/**
 * 安装原版（不含加载器），返回最终版本 id。已下载的文件会自动跳过。
 * dest='versions'：作为独立版本安装进 versions/（用户主动安装，支持 instanceName 自定义实例名）
 * dest='base'：作为加载器实例的内部依赖装进 .kamucl/base/（不进版本列表，json/jar 仅供链解析）
 */
export async function installVanilla(
  versionId: string,
  emit: ProgressEmit,
  dest: 'versions' | 'base' = 'versions',
  instanceName?: string,
  signal?: AbortSignal,
  finalEvent = true
): Promise<string> {
  const finalId = dest === 'versions' ? instanceName?.trim() || versionId : versionId
  const dir = dest === 'base' ? baseVersionDir(versionId) : versionDir(finalId)
  const jsonPath = path.join(dir, `${finalId}.json`)
  const jarPath = path.join(dir, `${finalId}.jar`)
  const mark = path.join(dir, '.installing')
  const mirror = getSettings().mirror
  const sourceText = mirror === 'bmclapi' ? 'BMCLAPI 镜像' : '官方源'

  // 事务标记：安装开始打标，全部成功才移除；失败由 cleanupPartialInstall 清理
  fs.mkdirSync(dir, { recursive: true })
  if (dest === 'versions') registerVersionFolder(finalId, gameDir()) // 新版本注册到当前活动文件夹
  fs.writeFileSync(mark, new Date().toISOString(), 'utf-8')
  try {
    emit({ stage: 'version-json', progress: 0, text: `获取版本信息 ${versionId}`, source: sourceText })
    const vj = await getVersionJson(versionId, jsonPath, signal)
    // 自定义实例名：json id 同步改写，并记录真实 MC 版本供修复/Java 推断
    if (finalId !== versionId) {
      vj.id = finalId
      vj._mcVersion = versionId
      fs.writeFileSync(jsonPath, JSON.stringify(vj, null, 2), 'utf-8')
    }

    // 1. 依赖库（含 natives classifiers）
    const libTasks = libraryTasks(vj)
    await downloadAll(
      libTasks,
      (d, t, speed, detail) =>
        emit({
          stage: 'libraries',
          progress: detail.fraction ?? 0,
          text: `下载依赖库 ${d}/${t}`,
          speed,
          etaSeconds: detail.etaSeconds ?? undefined,
          bytesDone: detail.bytesDone,
          bytesTotal: detail.bytesTotal ?? undefined,
          indeterminate: detail.indeterminate,
          source: sourceText
        }),
      8,
      mirror,
      signal
    )

    // 2. 客户端 jar
    const client = vj.downloads?.client
    if (client?.url) {
      // PCL2 本地复用优化：客户端 jar 优先从其他游戏文件夹的 versions 与 .kamucl/base
      // 里按 大小+sha1 查找相同文件直接复制（多文件夹/加载器依赖原版间不再重复下载）
      const versionDirs = allVersionsDirs()
      const reuseDirs = versionDirs
        .map((v) => v.dir)
        .concat(versionDirs.map((v) => path.join(v.folder, '.kamucl', 'base')))
        .filter((dir) => path.resolve(dir) !== path.resolve(path.dirname(jarPath)))
      await downloadFile(
        client.url,
        jarPath,
        (d, t) =>
          emit({
            stage: 'client',
            progress: t ? d / t : 0,
            text: `下载游戏本体 ${fmtMB(d)}${t ? '/' + fmtMB(t) : ''}`,
            source: sourceText
          }),
        client.sha1,
        mirror,
        signal,
        [],
        { size: client.size, reuseDirs }
      )
    }

    // 3. 资源索引与资源文件
    if (vj.assetIndex?.url) {
      const idxPath = assetIndexPath(vj.assetIndex.id)
      await downloadFile(
        vj.assetIndex.url,
        idxPath,
        undefined,
        vj.assetIndex.sha1,
        mirror,
        signal,
        [],
        { size: vj.assetIndex.size }
      )

      const idx = JSON.parse(fs.readFileSync(idxPath, 'utf-8')) as {
        virtual?: boolean
        map_to_resources?: boolean
        objects?: Record<string, { hash: string; size?: number }>
      }
      const objects = idx.objects ?? {}

      // 按 hash 去重生成下载任务
      const seen = new Set<string>()
      const tasks: DownloadTask[] = []
      for (const o of Object.values(objects)) {
        if (!o?.hash || seen.has(o.hash)) continue
        seen.add(o.hash)
        tasks.push({
          url: `https://resources.download.minecraft.net/${o.hash.slice(0, 2)}/${o.hash}`,
          dest: assetObjectPath(o.hash),
          sha1: o.hash,
          size: o.size
        })
      }
      await downloadAll(
        tasks,
        (d, t, speed, detail) =>
          emit({
            stage: 'assets',
            progress: detail.fraction ?? 0,
            text: `下载资源文件 ${d}/${t}`,
            speed,
            etaSeconds: detail.etaSeconds ?? undefined,
            bytesDone: detail.bytesDone,
            bytesTotal: detail.bytesTotal ?? undefined,
            indeterminate: detail.indeterminate,
            source: sourceText
          }),
        8,
        mirror,
        signal
      )

      // legacy 版本需要把资源复制到 assets/virtual/legacy 下
      if (idx.virtual === true || idx.map_to_resources === true) {
        emit({ stage: 'assets', progress: 1, text: '复制 legacy 资源' })
        let copied = 0
        for (const [name, o] of Object.entries(objects)) {
          throwIfCancelled(signal)
          if (!o?.hash) continue
          const from = assetObjectPath(o.hash)
          const to = path.join(virtualLegacyDir(), ...name.split('/'))
          if (fs.existsSync(from) && !fs.existsSync(to)) {
            fs.mkdirSync(path.dirname(to), { recursive: true })
            fs.copyFileSync(from, to)
          }
          if (++copied % 64 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
        }
      }
    }

    emit(
      finalEvent
        ? { stage: 'done', progress: 1, text: `校验完成，${versionId} 安装成功` }
        : { stage: 'assets', progress: 1, text: `原版 ${versionId} 依赖准备完成` }
    )
    // 全部步骤成功：移除事务标记
    fs.rmSync(mark, { force: true })
  } catch (e) {
    // 失败时保留 .installing 标记（列表显示「安装失败」+ 清理残留入口）
    throw e
  }
  return finalId
}

/**
 * 安装版本。opts.loader 存在时先确保原版（作为内部依赖，不产生独立版本条目），
 * 再委托 loaders 模块安装加载器。返回最终安装完成的版本 id。
 */
export async function installVersion(
  versionId: string,
  opts: InstallOptions = {},
  emit: ProgressEmit,
  signal?: AbortSignal
): Promise<string> {
  const report = createWeightedProgressEmit(emit, VERSION_INSTALL_STAGE_RANGES)
  if (opts.loader) {
    // 动态 import 避免与 loaders.ts 的循环依赖
    const { installLoader, listLoaderVersions, installFabricApi } = await import('./loaders')
    let loaderVersion = opts.loaderVersion
    if (!loaderVersion) {
      const list = await listLoaderVersions(opts.loader, versionId, signal)
      loaderVersion = list[0]
      if (!loaderVersion) throw new Error(`${opts.loader} 没有适配 ${versionId} 的版本`)
    }
    const installedId = await installLoader(
      opts.loader,
      versionId,
      loaderVersion,
      report,
      opts.instanceName,
      signal
    )
    // Fabric：可选同时安装 Fabric API 到 mods 文件夹
    if (opts.loader === 'fabric' && opts.fabricApi) {
      // 目标目录必须跟随实例隔离状态：隔离实例 → versions/<id>/mods；共享 → <folder>/mods
      let modsDir: string | undefined
      try {
        const j = readVersionJson(installedId)
        modsDir = path.join(instanceDirectoryState(installedId, j).path, 'mods')
      } catch {
        modsDir = undefined // 读取失败时回落共享目录（installFabricApi 默认）
      }
      await installFabricApi(versionId, opts.fabricApi, report, signal, modsDir)
    }
    return installedId
  }
  return await installVanilla(versionId, report, 'versions', opts.instanceName, signal)
}

/** 链底客户端 jar 的实际位置（versions 区优先，缺省时取 .kamucl/base 依赖原版区） */
export function clientJarPath(id: string): string {
  return fs.existsSync(versionJsonPath(id)) ? versionJarPath(id) : baseVersionJarPath(id)
}

// ---------------- 自包含实例（flatten 继承链） ----------------

/**
 * 沿 inheritsFrom 读取版本链并合并（启动与 flatten 共用同一语义）：
 * - libraries 合并（子在前）
 * - arguments 合并（父在前，子的 game/jvm 追加在后，兼容 forge/fabric）
 * - mainClass/type/assets/assetIndex/javaVersion/minecraftArguments/downloads 子缺省继承父
 */
export function resolveVersionChain(id: string): { merged: VersionJson; baseId: string } {
  const chain: VersionJson[] = []
  let cur: VersionJson | null = readVersionJson(id)
  while (cur) {
    chain.push(cur)
    cur = cur.inheritsFrom ? readVersionJson(cur.inheritsFrom) : null
  }
  const baseId = chain[chain.length - 1].id ?? id

  const childFirst = <K extends keyof VersionJson>(key: K): VersionJson[K] | undefined => {
    for (const c of chain) {
      if (c[key] != null) return c[key]
    }
    return undefined
  }
  const parentFirst = [...chain].reverse()

  const merged: VersionJson = {
    id,
    mainClass: childFirst('mainClass'),
    type: childFirst('type'),
    assets: childFirst('assets'),
    assetIndex: childFirst('assetIndex'),
    javaVersion: childFirst('javaVersion'),
    minecraftArguments: childFirst('minecraftArguments'),
    downloads: childFirst('downloads'),
    libraries: chain.flatMap((c) => c.libraries ?? []),
    arguments: {
      game: parentFirst.flatMap((c) => c.arguments?.game ?? []),
      jvm: parentFirst.flatMap((c) => c.arguments?.jvm ?? [])
    }
  }
  return { merged, baseId }
}

/**
 * 把带 inheritsFrom 的实例拍平为自包含实例：
 * 合并链 json（含全部启动所需内容）写回实例 json，client jar 复制进实例目录；
 * 之后基础原版改名/删除均不再影响该实例。原 json 备份为 <id>.json.kamucl-bak。
 * 幂等：无 inheritsFrom 时直接返回 false。
 */
export function flattenInstance(id: string): boolean {
  const jp = versionJsonPath(id)
  if (!fs.existsSync(jp)) return false
  const own = readVersionJson(id)
  if (!own.inheritsFrom) return false

  const { merged, baseId } = resolveVersionChain(id)
  // 自定义字段（_loader/_gameDir/_modpackName…）以实例自身 json 为准保留
  for (const [k, v] of Object.entries(own)) {
    if (k.startsWith('_')) (merged as unknown as Record<string, unknown>)[k] = v
  }
  merged._mcVersion = own._mcVersion ?? (readVersionJson(baseId)._mcVersion ?? baseId)
  merged._flattenedAt = new Date().toISOString()
  delete merged.inheritsFrom

  // client jar 落地实例目录（拷走即用；源可能在 base 依赖区或旧 versions 区）
  const srcJar = clientJarPath(baseId)
  const destJar = versionJarPath(id)
  if (fs.existsSync(srcJar) && !fs.existsSync(destJar)) {
    fs.copyFileSync(srcJar, destJar)
  }

  fs.copyFileSync(jp, jp + '.kamucl-bak')
  fs.writeFileSync(jp, JSON.stringify(merged, null, 2), 'utf-8')
  return true
}

/**
 * 存量迁移：扫描全部游戏文件夹，把带 inheritsFrom 的实例逐个拍平为自包含实例。
 * 返回拍平数量；单个失败不阻断其余（launcherLog 记录）。
 */
export async function migrateFlattenedInstances(
  log: (msg: string) => void = () => undefined
): Promise<number> {
  let count = 0
  for (const { dir } of allVersionsDirs()) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      const jp = path.join(dir, name, `${name}.json`)
      if (!fs.existsSync(jp)) continue
      try {
        const j = JSON.parse(fs.readFileSync(jp, 'utf-8').replace(/^﻿/, '')) as VersionJson
        if (!j.inheritsFrom) continue
        if (flattenInstance(name)) {
          count++
          log(`实例「${name}」已合并为自包含实例（原依赖 ${j.inheritsFrom}）`)
        }
      } catch (e) {
        log(`实例「${name}」合并失败（保留旧式继承，不影响启动）：${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  return count
}

/** flatten 实例自愈：json 自包含不缺，仅补客户端 jar（不重写 json） */
export async function installClientJarOnly(id: string, emit: ProgressEmit): Promise<void> {
  const j = readVersionJson(id)
  const client = j.downloads?.client
  if (!client?.url) throw new Error('实例 json 缺少客户端下载信息，无法自动补全')
  const mirror = getSettings().mirror
  await downloadFile(
    client.url,
    versionJarPath(id),
    (d, t) =>
      emit({
        stage: 'client',
        progress: t ? d / t : 0,
        text: `下载游戏本体 ${(d / 1024 / 1024).toFixed(1)}MB${t ? '/' + (t / 1024 / 1024).toFixed(1) + 'MB' : ''}`
      }),
    client.sha1,
    mirror
  )
}

/**
 * 把「加载器安装时临时落地的原版条目」迁移进 .kamucl/base 依赖区：
 * versions/<mc>/ 下的 json+jar 移走并删除目录，版本列表不再出现多余的原版条目。
 * 安装不完整（.installing 标记在）时整个目录直接删除。
 */
export function migrateDependencyVanilla(mcId: string): void {
  const dir = versionDir(mcId)
  if (!fs.existsSync(dir)) return
  if (fs.existsSync(installMarkPath(mcId))) {
    fs.rmSync(dir, { recursive: true, force: true })
    return
  }
  const jp = versionJsonPath(mcId)
  if (!fs.existsSync(jp)) return
  const base = baseVersionDir(mcId)
  fs.mkdirSync(base, { recursive: true })
  const baseJson = baseVersionJsonPath(mcId)
  const baseJar = baseVersionJarPath(mcId)
  if (!fs.existsSync(baseJson)) fs.renameSync(jp, baseJson)
  const jar = versionJarPath(mcId)
  if (fs.existsSync(jar) && !fs.existsSync(baseJar)) fs.renameSync(jar, baseJar)
  fs.rmSync(dir, { recursive: true, force: true })
}

// ---------------- 已安装列表 / 删除 ----------------

function parseVersionFile(file: string): VersionJson {
  return JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^﻿/, '')) as VersionJson
}

function versionJsonInFolder(folder: string, id: string): string {
  return path.join(folder, 'versions', id, `${id}.json`)
}

/** 扫描指定 Minecraft 根目录；损坏条目不会静默消失，而以 incomplete + errors 返回。 */
export function scanInstalledFolder(folder: string): {
  versions: InstalledVersion[]
  errors: string[]
} {
  const out: InstalledVersion[] = []
  const errors: string[] = []
  const root = path.resolve(folder)
  const dir = path.join(root, 'versions')
  if (!fs.existsSync(dir)) return { versions: out, errors }
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  } catch (error) {
    return {
      versions: out,
      errors: [`无法读取 versions：${error instanceof Error ? error.message : String(error)}`]
    }
  }
  // 只有活动根目录写入运行时寻址表；全局诊断扫描不能污染当前实例映射。
  if (path.resolve(gameDir()) === root) {
    for (const entry of entries) registerVersionFolder(entry.name, root)
  }
  for (const entry of entries) {
    const name = entry.name
    const jp = versionJsonInFolder(root, name)
    if (!fs.existsSync(jp)) {
      out.push({ id: name, mcVersion: '未知', folder: root, incomplete: true })
      errors.push(`${name}：缺少版本描述 ${name}.json`)
      continue
    }
    try {
      const j = parseVersionFile(jp)
      const resolved = resolveInstanceMetadata(j, id => {
        try {
          const local = versionJsonInFolder(root, id)
          return parseVersionFile(fs.existsSync(local) ? local : baseVersionJsonPath(id))
        } catch { return undefined }
      })
      const item: InstalledVersion = { id: name, mcVersion: resolved.mcVersion, loader: resolved.loader, loaderVersion: resolved.loaderVersion, folder: root }
      if (j._modpackName) item.modpackName = j._modpackName
      if (j._modpackVersion) item.modpackVersion = j._modpackVersion
      if (j._javaPath) item.javaPath = j._javaPath
      if (j._javaAuto === true) item.javaAuto = true
      if (j._resolution) item.resolution = normalizeStoredResolution(j._resolution)
      if (j._icon) item.icon = j._icon
      if (j._thumbnail) {
        const thumbnail = ensureInstanceThumbnail(j._thumbnail, root)
        if (thumbnail) item.thumbnail = thumbnail
      }
      if (j._thumbnailFit && ['fill', 'fit', 'crop'].includes(j._thumbnailFit)) {
        item.thumbnailFit = j._thumbnailFit
      }
      const directory = instanceDirectoryState(name, j, root)
      item.isolated = directory.isolated
      item.gameDirectory = directory.path
      item.isolationReason = directory.reason
      if (resolved.broken) {
        item.incomplete = true
        errors.push(`${name}：继承的版本 ${j.inheritsFrom ?? '未知'} 缺失或损坏`)
      }
      if (!j.inheritsFrom) {
        const jar = path.join(dir, name, `${name}.jar`)
        if (!fs.existsSync(jar) || fs.existsSync(jar + '.part')) item.incomplete = true
      }
      if (fs.existsSync(path.join(dir, name, '.installing'))) item.failed = true
      out.push(item)
    } catch (error) {
      out.push({ id: name, mcVersion: '未知', folder: root, incomplete: true })
      errors.push(`${name}：版本描述损坏（${error instanceof Error ? error.message : String(error)}）`)
    }
  }
  return { versions: sortInstalled(out), errors }
}

function sortInstalled(out: InstalledVersion[]): InstalledVersion[] {
  // 实例排序：按 MC 版本分组（新→旧），同版本内纯净版在前、加载器实例按 id 字母序
  out.sort((a, b) => {
    if (a.mcVersion !== b.mcVersion) {
      return b.mcVersion.localeCompare(a.mcVersion, undefined, { numeric: true })
    }
    if (!!a.loader !== !!b.loader) return a.loader ? 1 : -1
    return a.id.localeCompare(b.id)
  })
  return out
}

/** 当前活动游戏文件夹中的版本；切换文件夹后 UI 只看到该根目录。 */
export function listInstalled(): InstalledVersion[] {
  return sortInstalled(scanInstalledFolder(gameDir()).versions)
}

/** 诊断与全局查重使用；常规 UI 不调用，避免混淆相同 id 的多目录版本。 */
export function listAllInstalled(): InstalledVersion[] {
  const out: InstalledVersion[] = []
  for (const { folder } of allVersionsDirs()) out.push(...scanInstalledFolder(folder).versions)
  return sortInstalled(out)
}

/** 实例名校验：非法字符与保留名（返回错误文案，合法返回 null） */
export function validateInstanceName(name: string, excludeId?: string): string | null {
  const n = name.trim()
  if (!n) return '实例名不能为空'
  if (n.length > 64) return '实例名过长（最多 64 字符）'
  if (/[\\/:*?"<>|]/.test(n)) return '实例名不能包含 \\ / : * ? " < > | 字符'
  if (/^[.\s]|[.\s]$/.test(n)) return '实例名不能以空格或点开头/结尾'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(n)) return '实例名为系统保留名'
  if (n !== excludeId) {
    // 跨所有游戏文件夹查重
    for (const { dir } of allVersionsDirs()) {
      if (fs.existsSync(path.join(dir, n))) return `实例「${n}」已存在，请换一个名字`
    }
  }
  return null
}

/** 重命名实例：目录、json id、原版 jar 文件名同步改名（校验冲突/非法/占用；运行中由调用方拦截） */
export function renameVersion(id: string, newName: string): void {
  const err = validateInstanceName(newName, id)
  if (err) throw new Error(err)
  const trimmed = newName.trim()
  const from = versionDir(id)
  const to = versionDir(trimmed)
  if (!fs.existsSync(from)) throw new Error('实例不存在')
  if (from === to) return
  // 更新 json 内 id 字段（先读改写，再移动目录，避免中间态）；
  // 原版实例改名前记录真实 MC 版本 id（_mcVersion），改名后修复/Java 推断仍可用
  const jp = versionJsonPath(id)
  if (fs.existsSync(jp)) {
    const j = readVersionJson(id)
    if (!j.inheritsFrom && !j._loader && !j._modpackName && !j._mcVersion) j._mcVersion = j.id
    j.id = trimmed
    fs.writeFileSync(jp, JSON.stringify(j, null, 2), 'utf-8')
  }
  // 重命名 json 文件名 <id>.json → <newName>.json
  try {
    fs.renameSync(jp, path.join(from, `${trimmed}.json`))
  } catch {
    /* json 文件名异常不阻断 */
  }
  // 原版实例的客户端 jar 文件名与 id 同名，同步改名
  const oldJar = path.join(from, `${id}.jar`)
  if (fs.existsSync(oldJar)) {
    try {
      fs.renameSync(oldJar, path.join(from, `${trimmed}.jar`))
    } catch {
      /* 同上 */
    }
  }
  try {
    fs.renameSync(from, to)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY') {
      throw new Error('文件夹正被占用（游戏运行中或被其他程序打开），请关闭后重试')
    }
    throw e
  }
}
export function removeVersion(id: string): void {
  // 自定义图标与启动卡缩略图随实例删除（内置资源无文件落地）。
  try {
    const j = readVersionJson(id)
    if (j._icon?.startsWith('file:')) {
      fs.rmSync(path.join(instanceIconsDir(), j._icon.slice(5)), { force: true })
    }
    if (j._thumbnail) removeInstanceThumbnail(j._thumbnail, folderOfVersion(id))
  } catch {
    /* 清理图标失败不阻断删除 */
  }
  fs.rmSync(versionDir(id), { recursive: true, force: true })
}

/** 设置实例图标：'mob:<内置id>' / 'file:<文件名>' / '' 恢复默认；更换时清理旧的自定义图标文件 */
export function setVersionIcon(id: string, icon: string): void {
  if (icon && !/^mob:[a-z0-9_]{1,32}$/.test(icon) && !/^file:[\w.-]{1,64}$/.test(icon)) {
    throw new Error('非法的图标标识')
  }
  const jp = versionJsonPath(id)
  const j = readVersionJson(id)
  const old = j._icon
  if (icon) j._icon = icon
  else delete j._icon
  fs.writeFileSync(jp, JSON.stringify(j, null, 2), 'utf-8')
  // 旧的自定义图标文件若不再使用则删除
  if (old?.startsWith('file:') && old !== icon) {
    try {
      fs.rmSync(path.join(instanceIconsDir(), old.slice(5)), { force: true })
    } catch {
      /* 清理失败不影响设置 */
    }
  }
}

/** 设置实例专属启动卡缩略图；只接受该游戏文件夹受管目录中的已验证图片。 */
export function setVersionThumbnail(id: string, imagePath: string, fit: ImageFit = 'crop'): void {
  if (!['fill', 'fit', 'crop'].includes(fit)) throw new Error('非法的缩略图显示方式')
  const folder = folderOfVersion(id)
  const managed = ensureInstanceThumbnail(imagePath, folder)
  if (!managed) throw new Error('缩略图不在 KAMUCL 受管目录中或图片已损坏')
  const jsonPath = versionJsonPath(id)
  const version = readVersionJson(id)
  const previous = version._thumbnail
  version._thumbnail = managed
  version._thumbnailFit = fit
  fs.writeFileSync(jsonPath, JSON.stringify(version, null, 2), 'utf-8')
  if (previous && previous !== managed) removeInstanceThumbnail(previous, folder)
}

export function setVersionThumbnailFit(id: string, fit: ImageFit): void {
  if (!['fill', 'fit', 'crop'].includes(fit)) throw new Error('非法的缩略图显示方式')
  const jsonPath = versionJsonPath(id)
  const version = readVersionJson(id)
  if (!version._thumbnail || !ensureInstanceThumbnail(version._thumbnail, folderOfVersion(id))) {
    throw new Error('该实例尚未设置有效缩略图')
  }
  version._thumbnailFit = fit
  fs.writeFileSync(jsonPath, JSON.stringify(version, null, 2), 'utf-8')
}

export function resetVersionThumbnail(id: string): void {
  const folder = folderOfVersion(id)
  const jsonPath = versionJsonPath(id)
  const version = readVersionJson(id)
  const previous = version._thumbnail
  delete version._thumbnail
  delete version._thumbnailFit
  fs.writeFileSync(jsonPath, JSON.stringify(version, null, 2), 'utf-8')
  if (previous) removeInstanceThumbnail(previous, folder)
}

/**
 * 清理安装失败的残留（.installing 标记存在时调用）：
 * 删除整个版本目录（该标记只在安装开始时创建，目录必然是不完整产物）
 */
export function cleanupPartialInstall(id: string): boolean {
  if (!fs.existsSync(installMarkPath(id))) return false
  fs.rmSync(versionDir(id), { recursive: true, force: true })
  return true
}

/** 版本独立指定 Java（写入 _javaPath；空串恢复自动匹配） */
export function setVersionJava(id: string, javaPath: string, automatic = false): void {
  const jp = versionJsonPath(id)
  const j = readVersionJson(id)
  const p = javaPath.trim()
  if (p && !automatic) j._javaPath = p
  else delete j._javaPath
  if (automatic) j._javaAuto = true
  else delete j._javaAuto
  fs.writeFileSync(jp, JSON.stringify(j, null, 2), 'utf-8')
}

/** 实例级窗口设置；null 表示删除覆盖并跟随全局。 */
export function setVersionResolution(id: string, resolution: GameResolution | null): void {
  const jp = versionJsonPath(id)
  const version = readVersionJson(id)
  if (resolution) {
    assertValidResolution(resolution)
    const normalized = normalizeStoredResolution(resolution)
    version._resolution = normalized
  } else {
    delete version._resolution
  }
  fs.writeFileSync(jp, JSON.stringify(version, null, 2), 'utf-8')
}

// ---------------- 版本隔离 ----------------

/** 用户确认后的事务式隔离迁移；实际目录判定统一由 instances.ts 提供。 */
export async function setIsolation(id: string, isolated: boolean): Promise<void> {
  await applyIsolation(id, isolated)
}
