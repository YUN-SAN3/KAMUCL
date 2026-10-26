/**
 * 社区资源：Modrinth / CurseForge（MCIM 镜像免 key）的搜索、文件列表与下载
 * - Modrinth 主备双域名互备（官方 api + MCIM 镜像）
 * - 下载落盘：实例隔离版本 → 版本目录，否则全局游戏目录；modpack 走整合包安装流程
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {AsyncLocalStorage} from 'node:async_hooks'
import type {
  CommunityFile,
  CommunityKind,
  CommunityModProject,
  CommunityQuery,
  CommunityResult,
  CommunitySearchPage,
  CommunitySource,
  LoaderName,
  ProgressEvent
} from '../../shared/types'
import { downloadAll } from './download'
import { readVersionJson } from './versions'
import { instanceDirectoryState } from './instances'
import { getSettings } from './settings'
import { chineseModDisplayName, chineseModSearchTerms, hasExactChineseModName } from './community-zh'
import { lookupMcmod } from './mcmodSearch'
import { effectiveCommunityFilter, matchesCommunityFilter, usesCommunityLoader, MODRINTH_RESOURCE_LOADERS, type CommunityFileFilter } from '../../shared/communityPolicy'
import { communityPageSlots } from './communityPaging'
import { logScope } from './launcherLog'
import { downloadFileName } from './downloadFileName'
import { defaultFolderPath, folderOfVersion, withGameFolder } from './paths'
import { canonicalPath, samePath } from './folderPaths'
import { runCommunityRequest, sharedCommunityRequest } from './communitySearchBudget'
export { startCommunitySearch, continueCommunitySearch, cancelCommunitySearch } from './communitySearchSession'

const communityLog = logScope('community')

export type ProgressEmit = (e: ProgressEvent) => void

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const UA = { 'User-Agent': 'KAMUCL/0.4.0' }
const TIMEOUT = 30000
const requestSignal=new AsyncLocalStorage<AbortSignal>()
export const withCommunitySignal=<T>(signal:AbortSignal|undefined,run:()=>Promise<T>):Promise<T>=>signal?requestSignal.run(signal,run):run()

// ---------------- 基础请求 ----------------

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const signal=requestSignal.getStore();signal?.throwIfAborted()
  const deadline = signal?AbortSignal.any([signal,AbortSignal.timeout(TIMEOUT)]):AbortSignal.timeout(TIMEOUT)
  const requestKey = createHash('sha256').update(JSON.stringify([url, Object.entries(headers).sort(([a], [b]) => a.localeCompare(b))])).digest('hex')
  const read = async (owned: AbortSignal) => {
    const res = await fetch(url, { signal: AbortSignal.any([owned, AbortSignal.timeout(TIMEOUT)]), headers: { ...UA, ...headers } })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
    return res.json()
  }
  // Explicit legacy refreshes retain their independent count revision. New
  // cancellable searches/transactions deduplicate transport subscriptions.
  return signal ? sharedCommunityRequest(requestKey, 'provider', deadline, read)
    : runCommunityRequest('provider', deadline, () => read(deadline))
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

async function mrFiles(projectId: string, filter?: CommunityFileFilter, retainUnavailable = false): Promise<CommunityFile[]> {
  const query = new URLSearchParams()
  if (filter?.mcVersion) query.set('game_versions', JSON.stringify([filter.mcVersion]))
  const loaders = (filter?.kind && MODRINTH_RESOURCE_LOADERS[filter.kind]) || (filter?.loader ? [filter.loader] : undefined)
  if (loaders) query.set('loaders', JSON.stringify(loaders))
  const arr = (await mrFetch(`/project/${encodeURIComponent(projectId)}/version?${query}`)) as MrVersion[]
  return mapMrVersions(arr, projectId, retainUnavailable)
}

function mapMrVersions(arr: MrVersion[], projectId?: string, retainUnavailable = false): CommunityFile[] {
  const out: CommunityFile[] = []
  for (const v of arr ?? []) {
    const files = v.files ?? []
    const f = files.find((x) => x.primary) ?? files[0]
    if ((!f?.url || !f.filename) && !retainUnavailable) continue
    const sha1 = f?.hashes?.sha1
    out.push({
      source: 'modrinth',
      projectId: v.project_id ?? projectId,
      dependencies: v.dependencies?.map(d => ({ projectId: d.project_id ?? undefined, fileId: d.version_id ?? undefined, required: d.dependency_type === 'required' })),
      fileId: String(v.id ?? f?.filename ?? ''),
      fileName: f?.filename ?? '',
      version: v.version_number ?? f?.filename ?? '',
      url: f?.url ?? '',
      sha1,
      size: f?.size ?? 0,
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

import { cfChannel, CF_MIRROR } from './curseforgeChannel'
export { cfChannel } from './curseforgeChannel'

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
  gameId?: number
  classId?: number
  links?: { websiteUrl?: string }
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

/** 给搜索结果标题加中文名前缀（slug 命中映射表时） */
function withZhTitle(list: CommunityResult[]): CommunityResult[] {
  return list.map((r) => {
    const originalTitle = r.originalTitle ?? r.title
    const zh = chineseModDisplayName(r.slug, r.source)
    if (zh && !r.title.startsWith(zh) && !(r.originalTitle && r.title !== r.originalTitle)) {
      return { ...r, originalTitle, title: `${zh} | ${r.title}` }
    }
    return { ...r, originalTitle }
  })
}

interface SourceCount { total: number; time: number; revision: object }
const sourceCounts = new Map<string, SourceCount>()
// Only the most recently started read for a key owns its cache mutation. A
// response from an older request must neither restore a stale count nor erase
// a newer successful refresh. Entries here exist only while reads are pending.
const sourceCountReads = new Map<string, object>()
export const rawProviderSearch = (source: CommunitySource, q: CommunityQuery) => source === 'modrinth' ? mrSearch(q) : cfSearch(q)
const aliasCatalogs = new Map<string, { time: number; items: CommunityResult[]; warnings: string[] }>()
async function providerSearch(source: CommunitySource, q: CommunityQuery): Promise<CommunitySearchPage> {
  let builtin: CommunitySearchPage | undefined
  const chinese = q.kind === 'mod' && /\p{Script=Han}/u.test(q.keyword)
  if (chinese && hasExactChineseModName(q.keyword)) {
    builtin = await builtinProviderSearch(source, q)
    if (builtin.total) return builtin
    // Repository slugs can differ by platform. A known local name with no
    // exact identity may still be resolved through explicit encyclopedia links.
  }
  if (chinese) {
    const key = JSON.stringify({ ...q, source, offset: 0, limit: 0, mcmod: true })
    let catalog = aliasCatalogs.get(key)
    if (!catalog || Date.now() - catalog.time >= 60_000) {
      const encyclopedia = await lookupMcmod(q.keyword)
      if (!encyclopedia.entries.length) {
        const page = builtin ?? await builtinProviderSearch(source, q)
        return { ...page, warnings: [...(page.warnings ?? []), ...encyclopedia.warnings] }
      }
      // Keep domestic projects returned for the user's original query. MC百科
      // provides an identity bridge, never a replacement download repository.
      let original: CommunitySearchPage | undefined, originalError: unknown
      try { original = await rawProviderSearch(source, { ...q, offset: 0, limit: 50 }) }
      catch (error) { originalError = error }
      const items = [...(original?.items ?? [])], warnings = [...(original?.warnings ?? []), ...encyclopedia.warnings]
      if (!original) warnings.push('原中文关键词查询失败，当前仅显示已核对来源标识的百科关联项目；可重试。')
      const linkedIdentities = [...new Map(encyclopedia.entries.flatMap(entry => entry.projects.filter(link => link.source === source).map(link => [link.slug, { ...link, title: entry.title } ] as const))).values()]
      const identities = linkedIdentities.slice(0, 10)
      if (linkedIdentities.length > 10) warnings.push('百科条目关联的来源项目较多，本次仅核对前 10 项；请使用完整中文名缩小范围。')
      if (!identities.length) warnings.push(`MC百科条目未提供 ${source === 'modrinth' ? 'Modrinth' : 'CurseForge'} 项目链接，已保留原中文结果；可切换来源。`)
      let cursor = 0, providerSucceeded = !!original
      await Promise.all(Array.from({ length: Math.min(2, identities.length) }, async () => {
        while (cursor < identities.length) {
          const index = cursor++, identity = identities[index]
          try {
            const page = await rawProviderSearch(source, { ...q, keyword: identity.slug, offset: 0, limit: 50 })
            providerSucceeded = true
            // Do not pick similarly named forks, add-ons or the first search hit.
            for (const item of page.items.filter(item => item.slug.toLowerCase() === identity.slug)) {
              const originalTitle = item.originalTitle ?? item.title
              items.push({ ...item, originalTitle, title: `${identity.title} | ${originalTitle}` })
            }
          } catch { warnings.push(`“${identity.title}”的 ${source === 'modrinth' ? 'Modrinth' : 'CurseForge'} 项目查询失败，可重试；未使用同名项目替代。`) }
        }
      }))
      if (!providerSucceeded) throw originalError ?? new Error('社区来源查询失败，请稍后重试')
      if (encyclopedia.entries.length) warnings.push('MC百科中文名称关联：仅使用百科条目明确链接且当前版本／加载器筛选匹配的来源项目。')
      if ((original?.total ?? 0) > 50) warnings.push('原中文关键词匹配较多，本次百科关联合并前 50 项；请缩小关键词查看其他结果。')
      // On an encyclopedia outage preserve the existing alias path and its full
      // provider pagination; a failure must not turn into a cached empty match.
      catalog = { time: Date.now(), items: [...new Map(items.map(item => [`${item.source}:${item.projectId}`, item])).values()], warnings: [...new Set(warnings)] }
      if (aliasCatalogs.size >= 12) aliasCatalogs.delete(aliasCatalogs.keys().next().value!)
      if (!encyclopedia.warnings.length && !warnings.some(warning => warning.includes('查询失败'))) aliasCatalogs.set(key, catalog)
    }
    return { items: catalog.items.slice(q.offset, q.offset + q.limit), total: catalog.items.length, offset: q.offset, limit: q.limit, warnings: catalog.warnings }
  }
  return builtinProviderSearch(source, q)
}
async function builtinProviderSearch(source: CommunitySource, q: CommunityQuery): Promise<CommunitySearchPage> {
  const terms = q.kind === 'mod' ? chineseModSearchTerms(q.keyword) : []
  if (!terms.length) return rawProviderSearch(source, q)
  // Keep the user's original Chinese matches even when an alias succeeds.
  // Alias searches contribute only their explicit slug; a first hit or similarly
  // named fork is never promoted to the intended project's identity.
  const key = JSON.stringify({ ...q, source, offset: 0, limit: 0 })
  let catalog = aliasCatalogs.get(key)
  if (!catalog || Date.now() - catalog.time >= 60_000) {
    const searches = [...new Set([q.keyword, ...terms])]
    const pages: CommunitySearchPage[] = []
    let cursor = 0, successes = 0
    const failures: unknown[] = []
    await Promise.all(Array.from({ length: Math.min(2, searches.length) }, async () => {
      while (cursor < searches.length) {
        const index = cursor++, keyword = searches[index]
        try {
          const first = await rawProviderSearch(source, { ...q, keyword, offset: 0, limit: 50 })
          successes++
          let second: CommunitySearchPage | undefined
          const warnings: string[] = []
          if (first.total > 50) {
            try { second = await rawProviderSearch(source, { ...q, keyword, offset: 50, limit: 50 }) }
            catch { warnings.push(`“${keyword}”的后续结果查询失败，已保留已读取项目；可重试。`) }
          }
          const items = [...first.items, ...(second?.items ?? [])]
          if (first.total > 100) warnings.push(`“${keyword}”匹配较多，本次中文别名检索仅核对前 100 项；可用具体英文名搜索完整结果。`)
          pages[index] = { ...first, items: keyword === q.keyword ? items : items.filter(item => item.slug.toLowerCase() === keyword.toLowerCase()), warnings }
        } catch (error) {
          failures.push(error)
          pages[index] = { items: [], total: 0, offset: 0, limit: 0, warnings: [keyword === q.keyword ? '原中文关键词查询失败，当前仅显示已核对来源标识的别名项目；可重试。' : `中文别名“${keyword}”查询失败，已保留其他已读取结果；可重试。`] }
        }
      }
    }))
    if (!successes) throw failures[0] ?? new Error('社区来源查询失败，请稍后重试')
    const items = [...new Map(pages.flatMap(page => page.items).map(item => [`${item.source}:${item.projectId}`, item])).values()]
    catalog = { time: Date.now(), items, warnings: [...new Set([`中文别名检索：${q.keyword} → ${terms.join('、')}；保留原中文结果，仅补充来源标识完全匹配的项目。`, ...pages.flatMap(page => page.warnings ?? [])])] }
    if (aliasCatalogs.size >= 12) aliasCatalogs.delete(aliasCatalogs.keys().next().value!)
    if (!catalog.warnings.some(warning => warning.includes('查询失败'))) aliasCatalogs.set(key, catalog)
  }
  return { items: catalog.items.slice(q.offset, q.offset + q.limit), total: catalog.items.length, offset: q.offset, limit: q.limit, warnings: catalog.warnings }
}

/** 分页总数来自源站；中文别名也走相同筛选请求，禁止把未筛选项目塞回结果。 */
export async function communitySearchPage(input: CommunityQuery): Promise<CommunitySearchPage> {
  const q: CommunityQuery = {
    ...input, ...effectiveCommunityFilter(input),
    keyword: input.keyword.trim(),
    offset: Math.max(0, Math.floor(input.offset || 0)),
    limit: Math.max(1, Math.min(50, Math.floor(input.limit || 20)))
  }
  if (q.source !== 'all') {
    const page = await providerSearch(q.source, q)
    return { ...page, items: withZhTitle(page.items) }
  }
  const sources: CommunitySource[] = ['modrinth', 'curseforge']
  const warnings: string[] = []
  const countKey = (source: CommunitySource) => JSON.stringify({ ...q, source, offset: 0, limit: 1 })
  const counts = await Promise.allSettled(sources.map(async source => {
    const key = countKey(source)
    const cached = sourceCounts.get(key)
    if (q.offset > 0 && cached && Date.now() - cached.time < 60_000) return cached
    const revision = {}
    sourceCountReads.set(key, revision)
    // Invalidate before awaiting: a concurrent page must not reuse the prior
    // healthy snapshot while this explicit refresh is still unresolved.
    sourceCounts.delete(key)
    try {
      const page = await providerSearch(source, { ...q, source, offset: 0, limit: 1 })
      warnings.push(...(page.warnings ?? []))
      const value = { total: page.total, time: Date.now(), revision }
      if (sourceCountReads.get(key) === revision) {
        if (sourceCounts.size > 100) sourceCounts.clear()
        if (!page.warnings?.length) sourceCounts.set(key, value)
        else sourceCounts.delete(key)
      }
      return value
    } catch (error) {
      if (sourceCountReads.get(key) === revision) sourceCounts.delete(key)
      throw error
    } finally {
      if (sourceCountReads.get(key) === revision) sourceCountReads.delete(key)
    }
  }))
  if (counts.every(r => r.status === 'rejected')) throw (counts[0] as PromiseRejectedResult).reason
  const totals = { modrinth: 0, curseforge: 0 }
  counts.forEach((result, i) => {
    if (result.status === 'fulfilled') totals[sources[i]] = result.value.total
    else warnings.push(`${sources[i] === 'modrinth' ? 'Modrinth' : 'CurseForge'} 暂不可用，当前仅统计另一来源；可重试或切换来源。`)
  })
  const invalidateObservedCount = (source: CommunitySource) => {
    const observed = counts[sources.indexOf(source)]
    if (observed.status === 'fulfilled' && sourceCounts.get(countKey(source))?.revision === observed.value.revision) sourceCounts.delete(countKey(source))
  }
  const failures = new Map<CommunitySource, unknown>()
  counts.forEach((result, i) => { if (result.status === 'rejected') failures.set(sources[i], result.reason) })
  const pages = new Map<CommunitySource, { offset: number; limit: number; items: CommunityResult[] }>()
  const covers = (source: CommunitySource, own: Array<{ index: number }>) => {
    const page = pages.get(source)
    return !own.length || !!page && own[0].index >= page.offset && own.at(-1)!.index < page.offset + page.limit
  }
  // A provider can fail after its count succeeded. Keep the other provider's
  // results, then replan against the actual available totals. Fetch a different
  // surviving range when necessary; never fill a new page with old offsets.
  for (let round = 0; round <= sources.length; round++) {
    const planned = communityPageSlots(totals, q.offset, q.limit)
    const needed = sources.map(source => ({ source, own: planned.filter(slot => slot.source === source) })).filter(row => !covers(row.source, row.own))
    if (!needed.length) break
    const fetched = await Promise.allSettled(needed.map(async ({ source, own }) => {
      try {
        const page = await providerSearch(source, { ...q, source, offset: own[0].index, limit: own.length })
        warnings.push(...(page.warnings ?? []))
        if (page.warnings?.length || page.total !== totals[source]) invalidateObservedCount(source)
        return page
      } catch (error) { invalidateObservedCount(source); throw error }
    }))
    fetched.forEach((result, index) => {
      const { source, own } = needed[index]
      if (result.status === 'fulfilled') {
        totals[source] = result.value.total
        pages.set(source, { offset: own[0].index, limit: own.length, items: result.value.items })
      } else {
        totals[source] = 0; pages.delete(source); failures.set(source, result.reason)
        warnings.push(`${source === 'modrinth' ? 'Modrinth' : 'CurseForge'} 结果读取失败，当前仅统计另一来源；可重试或切换来源。`)
      }
    })
    if (failures.size === sources.length) throw failures.values().next().value
  }
  const slots = communityPageSlots(totals, q.offset, q.limit)
  if (sources.some(source => !covers(source, slots.filter(slot => slot.source === source)))) throw new Error('社区来源结果在翻页时持续变化，请重新搜索后重试。')
  const items = slots.flatMap(slot => {
    const page = pages.get(slot.source)!
    const item = page.items[slot.index - page.offset]
    return item ? [item] : []
  })
  return { items: withZhTitle(items), total: totals.modrinth + totals.curseforge, offset: q.offset, limit: q.limit, warnings: [...new Set(warnings)] }
}

import { favoriteIconUrl } from '../../shared/modFavorites'

const projectText = (value: unknown, limit: number): string | undefined => typeof value === 'string' && value.trim() ? value.slice(0, limit) : undefined
const projectCount = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
function projectWebpage(value: unknown, source: CommunitySource): string | undefined {
  if (typeof value !== 'string') return
  try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    (source === 'modrinth' ? ['modrinth.com', 'www.modrinth.com'] : ['curseforge.com', 'www.curseforge.com']).includes(url.hostname)) return url.href } catch { /* Missing or unsafe source links stay hidden. */ }
  return undefined
}

/** Metadata is verified against the platform's MOD type before it reaches a dialog or a favorite link. */
export async function communityProject(source: CommunitySource, projectId: string, kind: CommunityKind): Promise<CommunityModProject> {
  if (kind !== 'mod') throw new Error('收藏详情仅支持 MOD 项目')
  if (typeof projectId !== 'string') throw new Error('请填写有效的来源项目 ID')
  if (source === 'modrinth' && /^[a-zA-Z0-9_-]{1,100}$/.test(projectId)) {
    const project = await mrFetch(`/project/${encodeURIComponent(projectId)}`) as { id?: string; project_type?: string; title?: string; slug?: string; description?: string; license?: { id?: string; name?: string }; categories?: string[]; downloads?: number; followers?: number; updated?: string; icon_url?: string }
    if (project.project_type !== 'mod' || typeof project.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(project.id) || typeof project.title !== 'string' || !project.title) throw new Error('该 Modrinth 项目不是有效模组')
    const slug = projectText(project.slug, 100)
    return { kind: 'mod', source, projectId: project.id, title: project.title.slice(0, 200), slug, iconUrl: favoriteIconUrl(project.icon_url),
      description: projectText(project.description, 4000), license: projectText(project.license?.name || project.license?.id, 200),
      categories: Array.isArray(project.categories) ? project.categories.flatMap(c => projectText(c, 100) ?? []).slice(0, 30) : [],
      downloads: projectCount(project.downloads), followers: projectCount(project.followers), updatedAt: projectText(project.updated, 100),
      webpage: projectWebpage(`https://modrinth.com/mod/${encodeURIComponent(slug || project.id)}`, source) }
  }
  if (source === 'curseforge' && /^\d{1,20}$/.test(projectId)) {
    const result = await cfFetch(`/mods/${projectId}`) as { data?: CfMod }, project = result.data
    if (String(project?.id) !== projectId || project?.gameId !== 432 || project?.classId !== CF_CLASS_ID.mod || typeof project?.name !== 'string' || !project.name) throw new Error('该 CurseForge 项目不是有效 Minecraft 模组')
    return { kind: 'mod', source, projectId, title: project.name.slice(0, 200), iconUrl: favoriteIconUrl(project.logo?.thumbnailUrl), slug: projectText(project.slug, 100),
      description: projectText(project.summary, 4000), author: Array.isArray(project.authors) ? projectText(project.authors.map(author => projectText(author.name, 100)).filter(Boolean).join(', '), 500) : undefined,
      categories: Array.isArray(project.categories) ? project.categories.flatMap(c => projectText(c.name, 100) ?? []).slice(0, 30) : [],
      downloads: projectCount(project.downloadCount), updatedAt: projectText(project.dateModified, 100), webpage: projectWebpage(project.links?.websiteUrl, source) }
  }
  throw new Error('请填写有效的来源项目 ID')
}

export async function communityModProject(source: CommunitySource, projectId: string): Promise<{ source: CommunitySource; projectId: string; name: string; iconUrl?: string }> {
  const project = await communityProject(source, projectId, 'mod')
  return { source: project.source, projectId: project.projectId, name: project.title, ...(project.iconUrl ? {iconUrl: project.iconUrl} : {}) }
}

export async function curseForgeFilePage(projectID: number, fileID: number): Promise<string> {
  if (![projectID, fileID].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('CurseForge 文件标识无效')
  const { httpFetch } = await import('./httpClient')
  const channel = cfChannel()
  const sources = [{ base: CF_MIRROR, headers: undefined as Record<string, string> | undefined },
    { base: channel.base, headers: channel.official ? { 'x-api-key': channel.key } : undefined }]
  for (const source of sources) {
    try {
      const res = await httpFetch(`${source.base}/mods/${projectID}`, { headers: source.headers, signal: AbortSignal.timeout(6000) })
      if (!res.ok) { await res.body?.cancel(); continue }
      const data = await res.json() as { data?: { id?: number; links?: { websiteUrl?: string } } }
      if (data.data?.id !== projectID || !data.data.links?.websiteUrl) continue
      const url = new URL(data.data.links.websiteUrl)
      if (url.protocol !== 'https:' || !['curseforge.com', 'www.curseforge.com'].includes(url.hostname)) continue
      url.pathname = url.pathname.replace(/\/+$/, '') + '/download/' + fileID
      url.search = ''; url.hash = ''
      return url.href
    } catch { /* Try the other public metadata source. */ }
  }
  throw new Error('无法读取 CurseForge 文件页面，请稍后重试')
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

/** Favorites need to distinguish compatibility from missing verifiable downloads. Other file lists retain their existing behavior. */
export async function communityFavoriteCandidates(source: CommunitySource, projectId: string, mcVersion: string, loader: LoaderName): Promise<CommunityFile[]> {
  const filter = { kind: 'mod' as const, mcVersion, loader }
  const files = source === 'modrinth' ? await mrFiles(projectId, filter, true) : await cfFiles(projectId, filter)
  return files.filter(file => matchesCommunityFilter(file, filter)).sort((a, b) => b.date.localeCompare(a.date))
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
  target: { versionId: string; kind: CommunityKind; folder?: string },
  emit: ProgressEmit,
  onDone?: (r: { versionId: string; ok: boolean; error?: string }) => void,
  signal?: AbortSignal
): Promise<string> {
  // Freeze both the instance and shared directory before the first network await.
  const requested = target.folder === undefined
    ? target.kind === 'modpack' ? defaultFolderPath() : folderOfVersion(target.versionId)
    : String(target.folder).trim()
  if (!requested) throw new Error('目标游戏文件夹不能为空')
  const registered = getSettings().folders.find(folder => samePath(folder.path, requested))
  if (!registered && (target.kind === 'modpack' || target.folder !== undefined)) throw new Error('目标游戏文件夹未在 KAMUCL 中登记')
  const folder = canonicalPath(registered?.path ?? requested)
  return withGameFolder(folder, () => communityDownloadInFolder(file, { ...target, folder }, emit, onDone, signal))
}

async function communityDownloadInFolder(
  file: CommunityFile,
  target: { versionId: string; kind: CommunityKind; folder?: string },
  emit: ProgressEmit,
  onDone?: (r: { versionId: string; ok: boolean; error?: string }) => void,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()
  const fileName = downloadFileName(String(file.fileName ?? ''))
  const displayName = String(file.fileName ?? '') || fileName
  communityLog.info(`开始下载 ${target.kind} 资源 ${displayName} → 实例 ${target.versionId}`)
  const dlProgress = (d: number, t: number, speed: number, eta: number | null) =>
    emit({
      stage: 'download',
      progress: t ? d / t : 0,
      // 压缩包只是整合包任务的第一步；不能先报 100% 再开始安装。
      overall: target.kind === 'modpack' ? (t ? d / t : 0) * 0.1 : (t ? d / t : 0),
      speed, etaSeconds: eta ?? undefined,
      bytesDone: d,
      bytesTotal: t || undefined,
      indeterminate: !t,
      text: `下载 ${displayName} ${(d / 1024 / 1024).toFixed(1)}MB${t ? '/' + (t / 1024 / 1024).toFixed(1) + 'MB' : ''}`
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

  const transfer = (dest: string) => downloadAll([{url: file.url, dest, sha1: file.sha1, size: file.size || undefined}],
    (_done,_total,speed,detail) => dlProgress(detail.bytesDone,detail.bytesTotal ?? 0,speed,detail.etaSeconds),
    getSettings().downloadThreads, getSettings().mirror, signal)

  if (target.kind === 'modpack') {
    // An owned, atomically allocated directory avoids simultaneous-download collisions
    // and confines cleanup of .part/range caches to this one accepted task.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-pack-'))
    const tmpPath = path.join(tmpRoot, fileName)
    const cleanup = (): void => {
      try { fs.rmSync(tmpRoot, { recursive: true, force: true }) }
      catch (err) { communityLog.warn(`整合包临时文件清理失败：${tmpRoot}`, err) }
    }
    try {
      await transfer(tmpPath)
      signal?.throwIfAborted()
      // 动态 import 避免与 modpacks.ts 的循环依赖；后台异步安装，进度走 event:progress
      const { installModpack } = await import('./modpacks')
      const installProgress: ProgressEmit = (event) => emit({
        ...event,
        overall: 0.1 + (event.overall ?? event.progress) * 0.9
      })
      void (async () => {
        let outcome: { versionId: string; ok: boolean; error?: string }
        try {
          const id = await installModpack(tmpPath, installProgress, { signal, nameSource: 'inner', targetFolder: target.folder })
          outcome = { versionId: id, ok: true }
        } catch (err) {
          outcome = { versionId: '', ok: false, error: errText(err) }
          communityLog.error(`整合包 ${displayName} 后台安装失败`, err)
        } finally { cleanup() }
        if (!outcome.ok) emit({ stage: 'error', progress: 0, text: `整合包安装失败: ${outcome.error}` })
        onDone?.(outcome)
      })().catch(err => communityLog.error('整合包完成通知失败', err))
      return '整合包已开始安装'
    } catch (err) {
      cleanup()
      throw err
    }
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
      await transfer(dest)
      return dest
    }
    const dest = path.join(base, 'datapacks', fileName)
    await transfer(dest)
    return `${dest}（提示：请将文件移入存档 saves/<世界>/datapacks 后生效）`
  }

  const sub = KIND_SUBDIR[target.kind]
  if (!sub) throw new Error(`不支持的资源类型: ${target.kind}`)
  const dest = path.join(base, sub, fileName)
  await transfer(dest)
  return dest
}
