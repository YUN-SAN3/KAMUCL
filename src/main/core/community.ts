/**
 * 社区资源：Modrinth / CurseForge（MCIM 镜像免 key）的搜索、文件列表与下载
 * - Modrinth 主备双域名互备（官方 api + MCIM 镜像）
 * - 下载落盘：实例隔离版本 → 版本目录，否则全局游戏目录；modpack 走整合包安装流程
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  CommunityFile,
  CommunityKind,
  CommunityQuery,
  CommunityResult,
  CommunitySearchPage,
  CommunitySource,
  LoaderName,
  ProgressEvent
} from '../../shared/types'
import { downloadFile } from './download'
import { readVersionJson } from './versions'
import { instanceDirectoryState } from './instances'
import { getSettings } from './settings'
import { MOD_ZH, ZH_TO_SLUGS } from './community-zh'
import { effectiveCommunityFilter, matchesCommunityFilter, usesCommunityLoader, MODRINTH_RESOURCE_LOADERS, type CommunityFileFilter } from '../../shared/communityPolicy'
import { communityPageSlots } from './communityPaging'
import { logScope } from './launcherLog'

const communityLog = logScope('community')

export type ProgressEmit = (e: ProgressEvent) => void

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const UA = { 'User-Agent': 'KAMUCL/0.4.0' }
const TIMEOUT = 30000

// ---------------- 基础请求 ----------------

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { ...UA, ...headers } })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return res.json()
}

// ---------------- Modrinth ----------------

const MR_BASES = ['https://api.modrinth.com/v2', 'https://mod.mcimirror.top/modrinth/v2']

/** 主备互备请求 Modrinth */
async function mrFetch(p: string): Promise<unknown> {
  let lastErr: unknown = null
  for (const base of MR_BASES) {
    try {
      return await fetchJson(base + p)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

const MR_PROJECT_TYPE: Record<CommunityKind, string> = {
  mod: 'mod',
  modpack: 'modpack',
  resourcepack: 'resourcepack',
  shader: 'shader',
  datapack: 'datapack'
}

/** Modrinth 搜索排序索引 */
const MR_SORT_INDEX: Record<string, string> = {
  relevance: 'relevance',
  downloads: 'downloads',
  newest: 'newest'
}

/** CurseForge 搜索 sortField（1=精选 2=人气 3=更新时间 4=名称 6=总下载） */
const CF_SORT_FIELD: Record<string, number> = {
  relevance: 2,
  downloads: 6,
  newest: 3
}

interface MrHit {
  project_id?: string
  slug?: string
  title?: string
  description?: string
  author?: string
  icon_url?: string | null
  downloads?: number
  date_modified?: string
  categories?: string[]
}

async function mrSearch(q: CommunityQuery): Promise<CommunitySearchPage> {
  const facets: string[][] = [[`project_type:${MR_PROJECT_TYPE[q.kind]}`]]
  if (q.mcVersion) facets.push([`versions:${q.mcVersion}`])
  if (q.loader && usesCommunityLoader(q.kind)) facets.push([`categories:${q.loader}`])
  const params = new URLSearchParams({
    query: q.keyword,
    limit: String(q.limit),
    offset: String(q.offset),
    index: MR_SORT_INDEX[q.sort ?? 'relevance'] ?? 'relevance',
    facets: JSON.stringify(facets)
  })
  const data = (await mrFetch(`/search?${params.toString()}`)) as { hits?: MrHit[]; total_hits: number }
  if (!Number.isFinite(data.total_hits)) throw new Error('Modrinth 未返回结果总数，请重试')
  const items = (data.hits ?? []).map((h) => ({
    source: 'modrinth' as const,
    projectId: String(h.project_id ?? ''),
    slug: h.slug ?? '',
    title: h.title ?? '',
    author: h.author ?? '',
    description: h.description ?? '',
    iconUrl: h.icon_url ?? '',
    downloads: h.downloads ?? 0,
    updatedAt: h.date_modified ?? '',
    categories: h.categories ?? []
  }))
  return { items, total: data.total_hits, offset: q.offset, limit: q.limit }
}

interface MrVersionFile {
  filename?: string
  url?: string
  hashes?: { sha1?: string }
  size?: number
  primary?: boolean
}

interface MrVersion {
  project_id?: string
  dependencies?: Array<{ project_id?: string; version_id?: string; dependency_type: string }>
  id?: string
  version_number?: string
  version_type?: string
  game_versions?: string[]
  loaders?: string[]
  date_published?: string
  files?: MrVersionFile[]
}

async function mrFiles(projectId: string, filter?: CommunityFileFilter): Promise<CommunityFile[]> {
  const query = new URLSearchParams()
  if (filter?.mcVersion) query.set('game_versions', JSON.stringify([filter.mcVersion]))
  const loaders = (filter?.kind && MODRINTH_RESOURCE_LOADERS[filter.kind]) || (filter?.loader ? [filter.loader] : undefined)
  if (loaders) query.set('loaders', JSON.stringify(loaders))
  const arr = (await mrFetch(`/project/${encodeURIComponent(projectId)}/version?${query}`)) as MrVersion[]
  return mapMrVersions(arr, projectId)
}

function mapMrVersions(arr: MrVersion[], projectId?: string): CommunityFile[] {
  const out: CommunityFile[] = []
  for (const v of arr ?? []) {
    const files = v.files ?? []
    const f = files.find((x) => x.primary) ?? files[0]
    if (!f?.url || !f.filename) continue
    const sha1 = f.hashes?.sha1
    out.push({
      source: 'modrinth',
      projectId: v.project_id ?? projectId,
      dependencies: v.dependencies?.map(d => ({ projectId: d.project_id ?? undefined, fileId: d.version_id ?? undefined, required: d.dependency_type === 'required' })),
      fileId: String(v.id ?? f.filename),
      fileName: f.filename,
      version: v.version_number ?? f.filename,
      url: f.url,
      sha1,
      size: f.size ?? 0,
      releaseType:
        v.version_type === 'beta' ? 'beta' : v.version_type === 'alpha' ? 'alpha' : 'release',
      gameVersions: v.game_versions ?? [],
      loaders: v.loaders ?? [],
      date: v.date_published ?? ''
    })
  }
  return out
}

// ---------------- CurseForge（官方 API 优先，MCIM 镜像兜底） ----------------

/** 官方 API（需 x-api-key，免费申请见设置页提示）；镜像为无 key 时的降级通道 */
const CF_OFFICIAL = 'https://api.curseforge.com/v1'
const CF_MIRROR = 'https://mod.mcimirror.top/curseforge/v1'
/** 内置默认 Key（卡慕注册的 KAMUCL 官方应用 Key，开箱即用；用户可在设置页换成自己的） */
const CF_BUILTIN_KEY = '$2a$10$m36VLjTaHEqxr/hO3kMDE.XCDEG90rSu3iGKkoPsj0KdCPWXOASXG'

/** 当前生效的 CurseForge 通道：有 key（用户设置 > 内置默认）走官方；仅内置失效时才落镜像 */
export function cfChannel(): { base: string; official: boolean; key: string } {
  const key = (process.env.KAMUCL_CF_API_KEY || getSettings().curseforgeApiKey?.trim() || CF_BUILTIN_KEY).trim()
  return key ? { base: CF_OFFICIAL, official: true, key } : { base: CF_MIRROR, official: false, key: '' }
}

const CF_CLASS_ID: Record<CommunityKind, number> = {
  mod: 6,
  modpack: 4471,
  resourcepack: 12,
  shader: 6552,
  datapack: 6945
}

const CF_LOADER_TYPE: Record<LoaderName, number> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6
}

const LOADER_NAMES = new Set(['forge', 'fabric', 'quilt', 'neoforge'])

async function cfFetch(p: string): Promise<unknown> {
  const ch = cfChannel()
  if (ch.official) {
    return fetchJson(ch.base + p, { 'x-api-key': ch.key })
  }
  return fetchJson(ch.base + p)
}

interface CfMod {
  id?: number
  slug?: string
  name?: string
  summary?: string
  authors?: { name?: string }[]
  logo?: { thumbnailUrl?: string }
  downloadCount?: number
  dateModified?: string
  categories?: { name?: string }[]
}

async function cfSearch(q: CommunityQuery): Promise<CommunitySearchPage> {
  const params = new URLSearchParams({
    gameId: '432',
    classId: String(CF_CLASS_ID[q.kind]),
    searchFilter: q.keyword,
    index: String(q.offset),
    pageSize: String(q.limit),
    sortField: String(CF_SORT_FIELD[q.sort ?? 'relevance'] ?? 2),
    sortOrder: 'desc'
  })
  if (q.mcVersion) params.set('gameVersion', q.mcVersion)
  if (q.loader && usesCommunityLoader(q.kind)) params.set('modLoaderType', String(CF_LOADER_TYPE[q.loader]))
  const data = (await cfFetch(`/mods/search?${params.toString()}`)) as { data?: CfMod[]; pagination?: { totalCount: number } }
  if (!Number.isFinite(data.pagination?.totalCount)) throw new Error('CurseForge 未返回结果总数，请重试')
  const items = (data.data ?? []).map((m) => ({
    source: 'curseforge' as const,
    projectId: String(m.id ?? ''),
    slug: m.slug ?? '',
    title: m.name ?? '',
    author: m.authors?.[0]?.name ?? '',
    description: m.summary ?? '',
    iconUrl: m.logo?.thumbnailUrl ?? '',
    downloads: m.downloadCount ?? 0,
    updatedAt: m.dateModified ?? '',
    categories: (m.categories ?? [])
      .map((c) => c.name)
      .filter((n): n is string => !!n)
  }))
  // CurseForge 只允许访问前 10,000 个结果。
  const total = Math.min(10000, data.pagination!.totalCount)
  return { items, total, offset: q.offset, limit: q.limit }
}

interface CfFile {
  modId?: number
  dependencies?: Array<{ modId: number; relationType: number }>
  id?: number
  fileName?: string
  displayName?: string
  downloadUrl?: string | null
  hashes?: { algo?: number; value?: string }[]
  fileLength?: number
  releaseType?: number
  gameVersions?: string[]
  fileDate?: string
}

async function cfFiles(
  projectId: string,
  filter?: { mcVersion?: string; loader?: LoaderName | '' }
): Promise<CommunityFile[]> {
  const params = new URLSearchParams({ pageSize: '50' })
  if (filter?.mcVersion) params.set('gameVersion', filter.mcVersion)
  if (filter?.loader) params.set('modLoaderType', String(CF_LOADER_TYPE[filter.loader]))
  const all: CfFile[] = []
  for (let index = 0; ; index += 50) {
    params.set('index', String(index))
    const data = await cfFetch(`/mods/${encodeURIComponent(projectId)}/files?${params}`) as { data?: CfFile[]; pagination?: { totalCount: number } }
    const page = data.data ?? []
    all.push(...page)
    if (page.length < 50 || all.length >= (data.pagination?.totalCount ?? Infinity)) break
    if (index >= 9950) throw new Error('项目版本过多，请先选择 Minecraft 版本 / Loader 后重试')
  }
  return mapCfFiles(all, projectId)
}

function mapCfFiles(files: CfFile[], projectId: string): CommunityFile[] {
  return files.map((f) => {
    const id = String(f.id ?? '')
    const numId = Number(f.id ?? 0)
    const gameVersions = f.gameVersions ?? []
    // downloadUrl 缺失时按 ForgeCDN 规则拼地址（media 403 / edge 可用）
    const fallbackUrl =
      Number.isFinite(numId) && numId > 0 && f.fileName
        ? `https://edge.forgecdn.net/files/${Math.floor(numId / 1000)}/${numId % 1000}/${encodeURIComponent(f.fileName)}`
        : undefined
    return {
      source: 'curseforge' as const,
      projectId: String(f.modId ?? projectId),
      dependencies: f.dependencies?.map(d => ({ projectId: String(d.modId), required: d.relationType === 3 })),
      fileId: id,
      fileName: f.fileName ?? id,
      version: f.displayName ?? f.fileName ?? id,
      url: f.downloadUrl ?? fallbackUrl ?? '',
      sha1: f.hashes?.find((h) => h.algo === 1)?.value,
      size: f.fileLength ?? 0,
      releaseType:
        f.releaseType === 2 ? 'beta' : f.releaseType === 3 ? 'alpha' : ('release' as const),
      gameVersions,
      loaders: gameVersions
        .map((g) => g.toLowerCase())
        .filter((g) => LOADER_NAMES.has(g)),
      date: f.fileDate ?? ''
    }
  })
}

// ---------------- 对外：搜索 / 文件列表 ----------------

const hasChinese = (s: string): boolean => /[一-鿿]/.test(s)

// ---------------- 中文名检索（community-zh 映射表） ----------------

/** 中文关键词反查 slug：中文名包含关键词的映射项（取前 5 个 slug） */
function zhKeywordToSlugs(keyword: string): string[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw || !hasChinese(kw)) return []
  const out: string[] = []
  for (const [zh, slugs] of Object.entries(ZH_TO_SLUGS)) {
    if (zh.includes(kw)) out.push(...slugs)
    if (out.length >= 5) break
  }
  return [...new Set(out)].slice(0, 5)
}

/** 给搜索结果标题加中文名前缀（slug 命中映射表时） */
function withZhTitle(list: CommunityResult[]): CommunityResult[] {
  return list.map((r) => {
    const originalTitle = r.originalTitle ?? r.title
    const zh = MOD_ZH[r.slug]
    if (zh && !r.title.startsWith(zh)) {
      return { ...r, originalTitle, title: `${zh} | ${r.title}` }
    }
    return { ...r, originalTitle }
  })
}

const sourceCounts = new Map<string, { total: number; time: number }>()
const providerSearch = (source: CommunitySource, q: CommunityQuery) => source === 'modrinth' ? mrSearch(q) : cfSearch(q)

/** 分页总数来自源站；中文别名也走相同筛选请求，禁止把未筛选项目塞回结果。 */
export async function communitySearchPage(input: CommunityQuery): Promise<CommunitySearchPage> {
  const q: CommunityQuery = {
    ...input, ...effectiveCommunityFilter(input),
    keyword: (input.kind === 'mod' ? zhKeywordToSlugs(input.keyword)[0] : undefined) ?? input.keyword.trim(),
    offset: Math.max(0, Math.floor(input.offset || 0)),
    limit: Math.max(1, Math.min(50, Math.floor(input.limit || 20)))
  }
  if (q.source !== 'all') {
    const page = await providerSearch(q.source, q)
    return { ...page, items: withZhTitle(page.items) }
  }
  const sources: CommunitySource[] = ['modrinth', 'curseforge']
  const counts = await Promise.allSettled(sources.map(async source => {
    const key = JSON.stringify({ ...q, source, offset: 0, limit: 1 })
    const cached = sourceCounts.get(key)
    if (q.offset > 0 && cached && Date.now() - cached.time < 60_000) return cached.total
    const page = await providerSearch(source, { ...q, source, offset: 0, limit: 1 })
    if (sourceCounts.size > 100) sourceCounts.clear()
    sourceCounts.set(key, { total: page.total, time: Date.now() })
    return page.total
  }))
  if (counts.every(r => r.status === 'rejected')) throw (counts[0] as PromiseRejectedResult).reason
  const warnings: string[] = []
  const totals = { modrinth: 0, curseforge: 0 }
  counts.forEach((result, i) => {
    if (result.status === 'fulfilled') totals[sources[i]] = result.value
    else warnings.push(`${sources[i] === 'modrinth' ? 'Modrinth' : 'CurseForge'} 暂不可用，当前仅统计另一来源；可重试或切换来源。`)
  })
  const slots = communityPageSlots(totals, q.offset, q.limit)
  const pages = await Promise.all(sources.map(async source => {
    const own = slots.filter(slot => slot.source === source)
    if (!own.length) return { source, offset: 0, items: [] as CommunityResult[] }
    const page = await providerSearch(source, { ...q, source, offset: own[0].index, limit: own.length })
    return { source, offset: own[0].index, items: page.items }
  }))
  const items = slots.flatMap(slot => {
    const page = pages.find(p => p.source === slot.source)!
    const item = page.items[slot.index - page.offset]
    return item ? [item] : []
  })
  return { items: withZhTitle(items), total: totals.modrinth + totals.curseforge, offset: q.offset, limit: q.limit, warnings }
}

/** 依赖查找保留数组接口；界面使用含总数的分页接口。 */
export async function communitySearch(q: CommunityQuery): Promise<CommunityResult[]> {
  return (await communitySearchPage(q)).items
}

/** 项目文件列表（新→旧） */
export async function communityFiles(
  source: CommunitySource,
  projectId: string,
  filter?: CommunityFileFilter
): Promise<CommunityFile[]> {
  const id = String(projectId ?? '')
  filter = effectiveCommunityFilter(filter ?? {})
  const files = source === 'modrinth' ? await mrFiles(id, filter) : await cfFiles(id, filter)
  return files.filter(f => matchesCommunityFilter(f, filter ?? {})).sort((a, b) => b.date.localeCompare(a.date))
}

/** Exact repository identities are retained throughout dependency resolution. */
export async function communityExactFile(source: CommunitySource, projectId: string | undefined, fileId: string): Promise<CommunityFile> {
  const files = source === 'modrinth'
    ? mapMrVersions([await mrFetch(`/version/${encodeURIComponent(fileId)}`) as MrVersion], projectId)
    : mapCfFiles([(await cfFetch(`/mods/${encodeURIComponent(projectId ?? '')}/files/${encodeURIComponent(fileId)}`) as { data: CfFile }).data], projectId ?? '')
  if (!files[0]) throw new Error('依赖版本没有可下载文件')
  return files[0]
}

// ---------------- 对外：下载 ----------------

/** kind → 游戏目录下的子目录 */
const KIND_SUBDIR: Partial<Record<CommunityKind, string>> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
  datapack: 'datapacks'
}

/**
 * 下载社区资源文件。
 * - 普通资源：落到目标版本目录（实例隔离 _gameDir=true 时）或全局游戏目录对应子目录，返回绝对路径
 * - modpack：先下载到临时目录，随后后台启动整合包安装流程，立即返回 '整合包已开始安装'
 * - signal：任务取消信号（下载中心取消按钮）
 */
export async function communityDownload(
  file: CommunityFile,
  target: { versionId: string; kind: CommunityKind },
  emit: ProgressEmit,
  onDone?: (r: { versionId: string; ok: boolean; error?: string }) => void,
  signal?: AbortSignal
): Promise<string> {
  const fileName = path.basename(String(file.fileName ?? '')) || 'download.bin'
  communityLog.info(`开始下载 ${target.kind} 资源 ${fileName} → 实例 ${target.versionId}`)
  const dlProgress = (d: number, t: number) =>
    emit({
      stage: 'download',
      progress: t ? d / t : 0,
      // 压缩包只是整合包任务的第一步；不能先报 100% 再开始安装。
      overall: target.kind === 'modpack' ? (t ? d / t : 0) * 0.1 : (t ? d / t : 0),
      bytesDone: d,
      bytesTotal: t || undefined,
      indeterminate: !t,
      text: `下载 ${fileName} ${(d / 1024 / 1024).toFixed(1)}MB${t ? '/' + (t / 1024 / 1024).toFixed(1) + 'MB' : ''}`
    })

  // CurseForge 受限文件（作者禁止直链，downloadUrl 为 null）：官方 API 现场解析真实下载地址
  if (file.source === 'curseforge' && !file.url) {
    if (!file.projectId) throw new Error('缺少 CurseForge 项目 ID，请重新选择下载文件')
    const ch = cfChannel()
    if (!ch.official) throw new Error('该文件作者限制了直链下载，需要在设置页填入 CurseForge API Key 后才能下载')
    const data = (await fetchJson(
      `${ch.base}/mods/${encodeURIComponent(file.projectId)}/files/${encodeURIComponent(file.fileId)}/download-url`,
      { 'x-api-key': ch.key }
    )) as { data?: string }
    if (!data.data) throw new Error('CurseForge 未返回下载地址')
    file = { ...file, url: data.data }
  }

  if (target.kind === 'modpack') {
    const tmpPath = path.join(os.tmpdir(), `kamucl-pack-${Date.now()}-${fileName}`)
    await downloadFile(file.url, tmpPath, dlProgress, file.sha1, undefined, signal)
    // 动态 import 避免与 modpacks.ts 的循环依赖；后台异步安装，进度走 event:progress
    const { installModpack } = await import('./modpacks')
    const installProgress: ProgressEmit = (event) => emit({
      ...event,
      overall: 0.1 + (event.overall ?? event.progress) * 0.9
    })
    void installModpack(tmpPath, installProgress, { signal, nameSource: 'inner' })
      .then((id) => {
        fs.rmSync(tmpPath, { force: true })
        onDone?.({ versionId: id, ok: true })
      })
      .catch((err) => {
        fs.rmSync(tmpPath, { force: true })
        const text = errText(err)
        communityLog.error(`整合包 ${fileName} 后台安装失败`, err)
        emit({ stage: 'error', progress: 0, text: `整合包安装失败: ${text}` })
        onDone?.({ versionId: '', ok: false, error: text })
      })
    return '整合包已开始安装'
  }

  // 与最终启动使用同一个目录解析器，避免资源被装进未参与启动的目录。
  const base = instanceDirectoryState(target.versionId, readVersionJson(target.versionId)).path

  // 数据包：MC 只从 saves/<世界>/datapacks 加载——唯一存档直接投入，否则落 gameDir/datapacks 并提示
  if (target.kind === 'datapack') {
    const savesDir = path.join(base, 'saves')
    let worlds: string[] = []
    try {
      worlds = fs
        .readdirSync(savesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(savesDir, d.name, 'level.dat')))
        .map((d) => d.name)
    } catch {
      /* 无存档目录 */
    }
    if (worlds.length === 1) {
      const dest = path.join(savesDir, worlds[0], 'datapacks', fileName)
      await downloadFile(file.url, dest, dlProgress, file.sha1, undefined, signal)
      return dest
    }
    const dest = path.join(base, 'datapacks', fileName)
    await downloadFile(file.url, dest, dlProgress, file.sha1, undefined, signal)
    return `${dest}（提示：请将文件移入存档 saves/<世界>/datapacks 后生效）`
  }

  const sub = KIND_SUBDIR[target.kind]
  if (!sub) throw new Error(`不支持的资源类型: ${target.kind}`)
  const dest = path.join(base, sub, fileName)
  await downloadFile(file.url, dest, dlProgress, file.sha1, undefined, signal)
  return dest
}
