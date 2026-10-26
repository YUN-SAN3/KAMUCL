/**
 * 版本管理：版本清单缓存、rules 评估、原版安装、已装列表、删除
 */
import { fetchVersionCatalog } from './versionCatalog'
import { minecraftRuleOs } from '../../shared/platform'
import { nativeLibraryForHost } from './platformNatives'
import { resolveInstanceMetadata } from './instanceMetadata'
import { cachedClientVersionEvidence, readClientVersionEvidence } from './instanceVersionEvidence'
import { mavenIdentity } from './mavenIdentity'
import { withFileJob } from './fileJobs'
import { downloadLimiter } from './downloadLimits'
import { app, shell } from 'electron'
import { recycleVersion } from './versionRemoval'
import { samePath } from './folderPaths'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
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
  downloadAll,
  downloadFile,
  type DownloadTask,
  type MirrorPref
} from './download'
import { getSettings } from './settings'
import { throwIfCancelled } from './tasks'
import { createWeightedProgressEmit, VERSION_INSTALL_STAGE_RANGES } from './progress'
import { runParallelTasks } from './parallelTasks'
import { ParallelProgress } from './parallelProgress'
import { applyIsolation, instanceDirectoryState, setNewInstanceIsolation } from './instances'
import { assertValidResolution, normalizeStoredResolution } from './gameWindow'
import {
  allVersionsDirs,
  allFolders,
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
  librariesDir,
  registerVersionFolder,
  versionDir,
  versionJarPath,
  versionJsonPath,
  versionsDir,
  virtualLegacyDir,
  withGameFolder
} from './paths'
import { ensureInstanceThumbnail, removeInstanceThumbnail } from './appearanceAssets'
import { assetDownloadStatus } from '../../shared/assetDownloadStatus'

export type ProgressEmit = (e: ProgressEvent) => void

// ---------------- Mojang 版本 json 的内部结构（只取需要的字段） ----------------

export interface VersionRule {
  action: 'allow' | 'disallow'
  os?: { name?: 'windows' | 'linux' | 'osx'; arch?: string }
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
export const OS_NAME = minecraftRuleOs(process.platform)

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
      if (rule.os.arch && !ruleArchitectureMatches(rule.os.arch, process.arch)) continue
    }
    allowed = rule.action === 'allow'
  }
  return allowed
}

export function ruleArchitectureMatches(rule: string, arch: string): boolean {
  const aliases: Record<string, string[]> = { ia32: ['x86', 'ia32', 'i386'], x64: ['x86_64', 'amd64', 'x64'], arm64: ['aarch64', 'arm64'] }
  try { const matcher = new RegExp(`^(?:${rule})$`); return (aliases[arch] ?? [arch]).some(value => matcher.test(value)) } catch { return false }
}

// ---------------- 版本清单 ----------------

export async function getVersionCatalog(refresh = false, signal?: AbortSignal) {
  return fetchVersionCatalog(path.join(app.getPath('userData'), 'version_manifest.json'), refresh, signal)
}

export async function fetchVersionManifest(_mirror: MirrorPref, refresh = false, signal?: AbortSignal): Promise<RemoteVersion[]> {
  return (await getVersionCatalog(refresh, signal)).versions
}

// ---------------- 版本 json ----------------

/** 同步读取本地版本 json（容错 BOM 头）；versions/ 没有时回退到 .kamucl/base 依赖原版区 */
export function readVersionJson(id: string): VersionJson {
  if(typeof id!=='string'||!id||id==='.'||id==='..'||/[\\/:\x00]/.test(id))throw new Error('无效的版本 ID')
  let p = versionJsonPath(id)
  if (!fs.existsSync(p) && fs.existsSync(baseVersionJsonPath(id))) p = baseVersionJsonPath(id)
  if(fs.lstatSync(p).isSymbolicLink()||fs.lstatSync(path.dirname(p)).isSymbolicLink())throw new Error('版本文件不能使用符号链接')
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
  nativeChecksumUrl?: string
}

/** 遍历通过 rules 的 libraries，收集 artifact 与 natives classifiers（去重） */
function collectLibraries(vj: VersionJson): LibEntry[] {
  const out: LibEntry[] = []
  const seen = new Set<string>()
  const coordinates = new Set<string>()
  const push = (art: (Pick<LibraryArtifact, 'path'> & Partial<LibraryArtifact>) | undefined, isNative: boolean, coordinate?: string, nativeChecksumUrl?: string): void => {
    if (!art?.path) return
    const dest = libraryPath(art.path)
    // Retain installer-generated entries even when missing, so launch validation
    // can report them instead of silently constructing an incomplete classpath.
    if (coordinate && coordinates.has(coordinate)) return
    if (coordinate) coordinates.add(coordinate)
    if (seen.has(dest)) return
    seen.add(dest)
    out.push({ path: dest, url: art.url, sha1: art.sha1, size: art.size, isNative, nativeChecksumUrl })
  }
  /** maven 坐标（group:artifact:version[:classifier]）→ 仓库相对路径 */
  const mavenPath = (name: string): string | null => {
    const [coordinate, extension = 'jar'] = name.split('@')
    const p = coordinate.split(':')
    if (p.length < 3) return null
    const [g, a, v, classifier] = p
    const file = `${a}-${v}${classifier ? `-${classifier}` : ''}.${extension}`
    return `${g.replace(/\./g, '/')}/${a}/${v}/${file}`
  }
  /** 仅声明 maven 坐标（无 downloads/url，典型为安装器注入的 forge 语言提供器）时按组织推断下载源 */
  const mavenRepoBase = (name: string): string | null => {
    if (name.startsWith('net.minecraftforge:')) return 'https://maven.minecraftforge.net/'
    if (name.startsWith('net.neoforged:')) return 'https://maven.neoforged.net/releases/'
    return null
  }
  for (const source of vj.libraries ?? []) {
    if (!rulesAllow(source.rules)) continue
    const lib = nativeLibraryForHost(source)
    if (lib.downloads?.artifact) {
      push(lib.downloads.artifact, false, mavenIdentity(lib.name), lib.nativeChecksumUrl)
    } else if (!lib.downloads?.classifiers && lib.name && lib.url) {
      // Fabric/Quilt 等 profile 的 maven 坐标形式：无内联 downloads，需按仓库基址拼接
      const rel = mavenPath(lib.name)
      if (rel) {
        const base = lib.url.endsWith('/') ? lib.url : lib.url + '/'
        push({ path: rel, url: base + rel }, false, mavenIdentity(lib.name))
      }
    } else if (!lib.downloads?.classifiers && lib.name) {
      // Mojang 的 classifiers-only 库明确没有普通 artifact；不能推断一个
      // 不存在的 base JAR，否则安装成功后仍会在启动校验时缺少下载地址。
      // forge 安装器注入库（fmlcore/javafmllanguage/mclanguage/lowcodelanguage 等）：
      // json 仅给 maven 坐标，本地有则直接收编，缺失按组织推断 maven 源下载
      const rel = mavenPath(lib.name)
      if (rel) {
        const base = mavenRepoBase(lib.name)
        push({ path: rel, url: base ? base + rel : undefined }, false, mavenIdentity(lib.name))
      }
    }
    const nativesKey = lib.natives?.[OS_NAME]?.replace(
      '${arch}',
      process.arch === 'ia32' ? '32' : '64'
    )
    if (nativesKey) push(lib.downloads?.classifiers?.[nativesKey], true, mavenIdentity(lib.name, nativesKey), lib.nativeChecksumUrl)
  }
  return out
}

/** 依赖库下载任务（供 installVersion 与 loaders 复用） */
export function libraryTasks(vj: VersionJson): DownloadTask[] {
  const folders = allFolders()
  return collectLibraries(vj)
    .filter((e) => e.url)
    .map((e) => {
      const relative = path.relative(librariesDir(), e.path)
      return { url: e.url as string, dest: e.path, sha1: e.sha1, size: e.size, nativeChecksumUrl: e.nativeChecksumUrl,
        reuseFiles: !relative.startsWith('..') && !path.isAbsolute(relative)
          ? folders.map(folder => path.join(folder, 'libraries', relative)) : [] }
    })
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
  ...args: Parameters<typeof installVanillaUnlocked>
): Promise<string> {
  const [id, , dest = 'versions', name, signal] = args
  const dir = dest === 'base' ? baseVersionDir(id) : versionDir(name?.trim() || id)
  return withFileJob(dir, signal, () => installVanillaUnlocked(...args))
}

async function installVanillaUnlocked(
  versionId: string,
  emit: ProgressEmit,
  dest: 'versions' | 'base' = 'versions',
  instanceName?: string,
  signal?: AbortSignal,
  finalEvent = true,
  runtimeReady?: (signal: AbortSignal) => Promise<void>
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

    const parallel = new ParallelProgress([
      { id: 'libraries', label: '依赖库', weight: 0.34 },
      { id: 'client', label: '游戏本体', weight: 0.17 },
      { id: 'assets', label: '资源文件', weight: 0.27 }
    ], emit, '同步下载游戏本体、依赖库与资源', [0.04, 0.82])
    await runParallelTasks([
      async signal => {
        await runParallelTasks([
          async (signal) => {
            const emit: ProgressEmit = event => parallel.update('libraries', event)
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
              downloadLimiter.maxConcurrent,
              mirror,
              signal
            )

            parallel.done('libraries')
          },
          async (signal) => {
            const emit: ProgressEmit = event => parallel.update('client', event)
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
              await downloadAll(
                [{ url: client.url, dest: jarPath, sha1: client.sha1, size: client.size, reuseDirs }],
                (_done, _total, speed, detail) => emit({stage:'client', progress:detail.fraction ?? 0,
                  bytesDone:detail.bytesDone, bytesTotal:detail.bytesTotal ?? undefined, indeterminate:detail.indeterminate,
                  speed, etaSeconds:detail.etaSeconds ?? undefined, text:'下载游戏本体 '+fmtMB(detail.bytesDone), source:sourceText}),
                getSettings().downloadThreads, mirror, signal
              )
          }

            parallel.done('client')
          }
            ], signal)
        // Installer processors only need client/libraries; assets keep downloading.
        await runtimeReady?.(signal)
      },
      async (signal) => {
        const emit: ProgressEmit = event => parallel.update('assets', event)
        emit({ stage: 'assets', progress: 0, text: '获取资源索引' })
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
            { size: vj.assetIndex.size, reuseFiles: allFolders().map(folder => path.join(folder, 'assets', 'indexes', `${vj.assetIndex!.id}.json`)) }
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
          const resourceFolders = allFolders()
          for (const [name, o] of Object.entries(objects)) {
            if (!o?.hash || seen.has(o.hash)) continue
            seen.add(o.hash)
            tasks.push({
              label: name,
              url: `https://resources.download.minecraft.net/${o.hash.slice(0, 2)}/${o.hash}`,
              dest: assetObjectPath(o.hash),
              sha1: o.hash,
              size: o.size,
              reuseFiles: resourceFolders.map(folder => path.join(folder, 'assets', 'objects', o.hash.slice(0, 2), o.hash))
            })
          }
          await downloadAll(
            tasks,
            (d, t, speed, detail) =>
              emit({
                stage: 'assets',
                progress: detail.fraction ?? 0,
                text: assetDownloadStatus(d, t, detail),
                speed,
                etaSeconds: detail.etaSeconds ?? undefined,
                bytesDone: detail.bytesDone,
                bytesTotal: detail.bytesTotal ?? undefined,
                indeterminate: detail.indeterminate,
                source: sourceText
              }),
            downloadLimiter.maxConcurrent,
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

        parallel.done('assets')
      }
    ], signal)

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
  signal?: AbortSignal,
  onFavoriteResult?: (result: import('../../shared/modFavorites').FavoriteInstallResult) => void
): Promise<string> {
  // 安装期间切换活动文件夹或默认隔离设置，不能改变本次任务的落盘目标。
  const isolated = !!opts.recordingMod || !!opts.favoriteMods?.length || getSettings().defaultIsolation
  return withGameFolder(gameDir(), () => installVersionInFolder(versionId, opts, emit, signal, isolated, onFavoriteResult))
}

export function launchLibraryFiles(vj: VersionJson) {
  return collectLibraries(vj).map(e => ({ dest: e.path, url: e.url, sha1: e.sha1, size: e.size, nativeChecksumUrl: e.nativeChecksumUrl }))
}

async function installVersionInFolder(
  versionId: string,
  opts: InstallOptions,
  emit: ProgressEmit,
  signal: AbortSignal | undefined,
  isolated: boolean,
  onFavoriteResult?: (result: import('../../shared/modFavorites').FavoriteInstallResult) => void
): Promise<string> {
  const { installRecordingMods } = await import("./recordingMods")
  const { prepareInstallMods, favoriteInstallResult } = await import('./modFavorites')
  const recordingFiles = await prepareInstallMods(versionId, opts,signal)
  const finishFavorites = async (installedId: string) => {
    if (!opts.favoriteInstallIntent && !opts.favoriteMods?.length) return
    const modsDirectory = path.join(instanceDirectoryState(installedId, readVersionJson(installedId)).path, 'mods')
    const result = await favoriteInstallResult(opts, recordingFiles, modsDirectory, gameDir(), installedId, signal)
    if (result) onFavoriteResult?.(result)
  }
  signal?.throwIfAborted()
  const report = createWeightedProgressEmit(emit, VERSION_INSTALL_STAGE_RANGES)
  // 子安装器完成并不代表整个任务完成，Fabric API 仍可能在下载。
  const prepareReport: ProgressEmit = (event) => {
    if (event.stage !== 'done') report(event)
  }
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
      prepareReport,
      opts.instanceName,
      signal
    )
    // 必须先确定最终游戏目录，再安装附加模组；失败时直接报错，不能写入共享目录兜底。
    if (isolated) setNewInstanceIsolation(installedId, true)
    // Fabric：可选同时安装 Fabric API 到 mods 文件夹
    if (opts.loader === 'fabric' && opts.fabricApi && !recordingFiles.length) {
      // 目标目录必须跟随实例隔离状态：隔离实例 → versions/<id>/mods；共享 → <folder>/mods
      const j = readVersionJson(installedId)
      const modsDir = path.join(instanceDirectoryState(installedId, j).path, 'mods')
      await installFabricApi(versionId, opts.fabricApi, report, signal, modsDir)
    }
    if (recordingFiles.length) {
      const mods = path.join(instanceDirectoryState(installedId, readVersionJson(installedId)).path, 'mods')
      try { await installRecordingMods(mods, recordingFiles, signal, fraction => report({ stage: 'download', progress: fraction, text: '下载并校验所选模组与必要前置' })); await finishFavorites(installedId) }
      catch(e) { if(signal?.aborted)throw e;const {recordSupplementalFailure}=await import('./supplementalMods');recordSupplementalFailure({folder:gameDir(),id:installedId},versionId,opts,e);throw new Error(`${installedId} 基础实例已保留；附加模组安装失败，请选择重试或保留基础实例：${e instanceof Error ? e.message : e}`) }
    }
    else await finishFavorites(installedId)
    report({ stage: 'done', progress: 1, text: `${installedId} 安装完成` })
    return installedId
  }
  const installedId = await installVanilla(versionId, prepareReport, 'versions', opts.instanceName, signal)
  if (isolated) setNewInstanceIsolation(installedId, true)
  await finishFavorites(installedId)
  report({ stage: 'done', progress: 1, text: `${installedId} 安装完成` })
  return installedId
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
  const seen = new Set<string>()
  while (cur) {
    if (seen.has(cur.id) || chain.length >= 32) throw new Error('版本继承链循环或过长')
    seen.add(cur.id)
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
export async function installClientJarOnly(id: string, emit: ProgressEmit, signal?: AbortSignal): Promise<void> {
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
    mirror,
    signal,
    [],
    { size: client.size }
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
export function scanInstalledFolder(folder: string, onlyId?: string): {
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
    entries = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && (!onlyId || entry.name === onlyId))
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
      const localParent = (id: string): VersionJson | undefined => {
        try {
          const local = versionJsonInFolder(root, id)
          const localBase = path.join(root, '.kamucl', 'base', id, `${id}.json`)
          return parseVersionFile(fs.existsSync(local) ? local : fs.existsSync(localBase) ? localBase : baseVersionJsonPath(id))
        } catch { return undefined }
      }
      const resolved = resolveInstanceMetadata(j, localParent, chain => {
        // Only unresolved metadata reads the client manifest/cache; listing never contacts a service.
        const id = chain.length === 1 ? name : chain.at(-2)!.inheritsFrom!
        const jar = chain.length === 1 ? path.join(dir, name, `${name}.jar`)
          : fs.existsSync(versionJsonInFolder(root, id)) ? path.join(dir, id, `${id}.jar`)
          : fs.existsSync(path.join(root, '.kamucl', 'base', id, `${id}.json`)) ? path.join(root, '.kamucl', 'base', id, `${id}.jar`)
          : baseVersionJarPath(id)
        return readClientVersionEvidence(jar) ?? cachedClientVersionEvidence(chain, [dir, path.join(root, '.kamucl', 'base'), path.dirname(baseVersionDir('_'))])
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
export async function removeVersion(id: string, requestedFolder?: string): Promise<void> {
  const folder = requestedFolder || folderOfVersion(id)
  if (!getSettings().folders.some(f => samePath(f.path, folder))) throw new Error('游戏文件夹尚未登记')
  await withGameFolder(folder, async () => {
    const { assertInstanceIdle } = await import('./instanceCenter')
    const { getRunningVersionIds } = await import('./launch')
    // Also cover a preparing JVM and shared/custom game directories.
    if (getRunningVersionIds().has(id)) throw new Error('该版本的游戏仍在运行或正在退出，请等待结束后重试')
    let json: VersionJson | undefined
    try { json = readVersionJson(id) } catch { /* Incomplete installations can also be removed. */ }
    await recycleVersion(folder, id, {
      assertIdle: async target => {
        await assertInstanceIdle(target)
        if (json) await assertInstanceIdle(instanceDirectoryState(id, json, folder).path)
      },
      trash: target => shell.trashItem(target)
    })
  })
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
export async function cleanupPartialInstall(id: string): Promise<boolean> {
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
  const temporary = `${jp}.window-size-${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, JSON.stringify(version, null, 2), { encoding: 'utf-8', flag: 'wx' })
    fs.renameSync(temporary, jp)
  } finally {
    try { fs.unlinkSync(temporary) } catch { /* Missing temporary file or failed cleanup never replaces the original. */ }
  }
}

// ---------------- 版本隔离 ----------------

/** 用户确认后的事务式隔离迁移；实际目录判定统一由 instances.ts 提供。 */
export async function setIsolation(id: string, isolated: boolean): Promise<void> {
  await applyIsolation(id, isolated)
}
