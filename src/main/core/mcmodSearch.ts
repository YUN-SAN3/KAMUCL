import type { CommunitySource } from '../../shared/types'
import { normalizeChineseModKeyword } from './community-zh'
import { runCommunityRequest, sharedCommunityRequest } from './communitySearchBudget'

/** MC百科 exposes public HTML, not a documented JSON download API. We read only
 * result titles and the entry's explicit related-project links. No page code is
 * executed; neither a translated title nor a fuzzy match becomes a download ID. */
export interface McmodProjectLink { source: CommunitySource; slug: string }
export interface McmodEntry { id: string; title: string; url: string; projects: McmodProjectLink[] }
export interface McmodSearchResult { entries: McmodEntry[]; warnings: string[] }
interface Candidate { id: string; title: string; url: string }
const MAX_BYTES = 2 * 1024 * 1024
const MAX_ENTRIES = 5
const cache = new Map<string, { at: number; result: McmodSearchResult }>()
const pending = new Map<string, Promise<McmodSearchResult>>()
/** Electron's Chromium transport uses the desktop session's proxy/PAC and
 * certificate store. Standalone validation keeps a replaceable standard fetch. */
const desktopHtmlFetch: typeof fetch = (input, init) => process.versions.electron
  ? import('electron').then(({ net }) => net.fetch(String(input), init))
  : fetch(input, init)
let activeRequests = 0
const requestWaiters: Array<() => void> = []
async function requestSlot(signal: AbortSignal): Promise<() => void> {
  let reserved = false
  if (activeRequests >= 2) await new Promise<void>((resolve, reject) => {
    const wake = () => { signal.removeEventListener('abort', cancel); activeRequests++; reserved = true; resolve() }
    const cancel = () => { const index = requestWaiters.indexOf(wake); if (index >= 0) requestWaiters.splice(index, 1); reject(signal.reason) }
    signal.addEventListener('abort', cancel, { once: true }); requestWaiters.push(wake)
    if (signal.aborted) cancel()
  })
  const release = () => { activeRequests--; requestWaiters.shift()?.() }
  if (signal.aborted) { if (reserved) release(); signal.throwIfAborted() }
  if (!reserved) activeRequests++
  return release
}

function text(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&#(x[0-9a-f]+|\d+);/gi, (_m, value: string) => {
    const point = value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value)
    return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
  }).replace(/&(?:amp|quot|apos|lt|gt|nbsp);/gi, entity => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' })[entity.toLowerCase()] ?? '').replace(/\s+/g, ' ').trim()
}
function anchors(html: string): Array<{ href: string; title: string }> {
  return [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi)].map(match => ({ href: text(match[2]), title: text(match[3]) }))
}
/** Slash-separated names are explicit names in an encyclopedia heading, not
 * fuzzy synonyms inferred from article text. Keep similarly named editions
 * separate, and do not use an English subtitle as a Chinese download identity. */
export function mcmodNameRank(title: string, keyword: string): number {
  const name = title.replace(/^\[[^\]]+\]\s*/, '').replace(/\s+\([^\p{Script=Han}]*\)\s*$/u, '').trim()
  const key = normalizeChineseModKeyword(keyword), main = normalizeChineseModKeyword(name)
  if (!key) return Infinity
  if (main === key) return 0
  if (name.split(/[／/]/).some(part => normalizeChineseModKeyword(part) === key)) return 1
  return main.startsWith(key) ? 2 : main.includes(key) ? 3 : Infinity
}
export function parseMcmodEntryTitle(html: string): string | undefined {
  const heading = html.match(/<div\b[^>]*class=["'][^"']*\bclass-title\b[^"']*["'][^>]*>([\s\S]*?)<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[2]
  return heading ? text(heading) : undefined
}
export function parseMcmodSearch(html: string, keyword: string): Candidate[] {
  // Limit parsing to the result list. Navigation, article bodies and unrelated
  // "recommended" entries cannot contribute project identities.
  const list = html.match(/<div\b[^>]*class=["'][^"']*\bsearch-result-list\b[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*search-result-pages|<footer\b|$)/i)?.[1]
  if (list == null) throw new Error('MC百科搜索页面格式变化或访问受限')
  const key = normalizeChineseModKeyword(keyword)
  const found: Candidate[] = []
  for (const item of list.split(/<div\b[^>]*class=["']result-item["'][^>]*>/i).slice(1)) {
    const head = item.split(/<div\b[^>]*class=["']body["']/i)[0]
    for (const anchor of anchors(head)) {
      let url: URL
      try { url = new URL(anchor.href, 'https://www.mcmod.cn') } catch { continue }
      const id = url.pathname.match(/^\/class\/(\d+)\.html$/)?.[1]
      if (url.protocol !== 'https:' || url.hostname !== 'www.mcmod.cn' || url.username || url.password || !id || !anchor.title) continue
      // The English subtitle is useful for display only. Exact Chinese title
      // wins over similarly named add-ons, editions and unrelated body matches.
      const name = anchor.title.replace(/^\[[^\]]+\]\s*/, '').replace(/\s+\([^\p{Script=Han}]*\)\s*$/u, '')
      if (!Number.isFinite(mcmodNameRank(name, key))) continue
      found.push({ id, title: name, url: `https://www.mcmod.cn/class/${id}.html` })
    }
  }
  const unique = [...new Map(found.map(item => [item.id, item])).values()]
  return unique.sort((a, b) => mcmodNameRank(a.title, key) - mcmodNameRank(b.title, key) || a.title.length - b.title.length || a.id.localeCompare(b.id))
}
export function parseMcmodProjects(html: string): McmodProjectLink[] {
  // Project links are in the entry's related-link list, before version/author
  // and description sections. Links in the prose may refer to dependencies.
  const links = html.match(/<ul\b[^>]*class=["'][^"']*\bcommon-link-icon-frame\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1]
  if (!links) return []
  const result: McmodProjectLink[] = []
  for (const anchor of anchors(links)) {
    let url: URL
    try {
      url = new URL(anchor.href, 'https://www.mcmod.cn')
      if (url.protocol !== 'https:' || url.username || url.password) continue
      if (url.hostname === 'link.mcmod.cn' && url.pathname.startsWith('/target/')) {
        const encoded = url.pathname.slice('/target/'.length)
        if (encoded.length > 2048 || !/^[A-Za-z0-9+/_=-]+$/.test(encoded)) continue
        url = new URL(Buffer.from(encoded, 'base64').toString('utf8'))
      }
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) continue
    } catch { continue }
    const source = url.hostname === 'modrinth.com' || url.hostname === 'www.modrinth.com' ? 'modrinth'
      : url.hostname === 'curseforge.com' || url.hostname === 'www.curseforge.com' ? 'curseforge' : undefined
    const slug = source === 'modrinth' ? url.pathname.match(/^\/mod\/([a-zA-Z0-9_-]+)\/?$/)?.[1]
      : source === 'curseforge' ? url.pathname.match(/^\/minecraft\/(?:mc-mods|mods)\/([a-zA-Z0-9_-]+)\/?$/)?.[1] : undefined
    if (source && slug) result.push({ source, slug: slug.toLowerCase() })
  }
  return [...new Map(result.map(link => [`${link.source}:${link.slug}`, link])).values()].slice(0, 8)
}
async function readHtml(url: string, fetcher: typeof fetch, signal: AbortSignal): Promise<string> {
  if (fetcher === desktopHtmlFetch) return sharedCommunityRequest('mcmod:' + url, 'mcmod', signal,
    owned => readHtmlWithSlot(url, fetcher, AbortSignal.any([owned, AbortSignal.timeout(10_000)])))
  const release = await requestSlot(signal)
  try { return await runCommunityRequest('mcmod', signal, () => readHtmlWithSlot(url, fetcher, signal)) } finally { release() }
}
async function readHtmlWithSlot(url: string, fetcher: typeof fetch, signal: AbortSignal): Promise<string> {
  const response = await fetcher(url, { signal, redirect: 'error', headers: { 'User-Agent': 'KAMUCL (+https://github.com/kamubaba-i/KAMUCL)', Accept: 'text/html' } })
  if (!response.ok) throw new Error(`MC百科 HTTP ${response.status}`)
  if (!(response.headers.get('content-type') ?? '').includes('text/html')) throw new Error('MC百科未返回可识别的搜索页面')
  if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw new Error('MC百科页面超出读取限制') }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('MC百科返回了空页面')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BYTES) throw new Error('MC百科页面超出读取限制')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  return Buffer.concat(chunks).toString('utf8')
}
/** One search + at most one additional result page and five entry pages, two
 * requests at a time, a shared 10-second deadline, 64 successful cache entries. */
export async function lookupMcmod(keyword: string, fetcher: typeof fetch = desktopHtmlFetch): Promise<McmodSearchResult> {
  const key = normalizeChineseModKeyword(keyword)
  if (!/\p{Script=Han}/u.test(key) || key.length < 2 || key.length > 80) return { entries: [], warnings: [] }
  if (fetcher === desktopHtmlFetch) {
    const stored = cache.get(key)
    if (stored && Date.now() - stored.at < 6 * 60 * 60_000) return structuredClone(stored.result)
    if (pending.has(key)) return structuredClone(await pending.get(key)!)
    if (pending.size >= 16) return { entries: [], warnings: ['MC百科查询较多，已保留原中文关键词和内置别名；请稍后重试。'] }
  }
  const run = async (): Promise<McmodSearchResult> => {
    const signal = AbortSignal.timeout(10_000)
    const params = new URLSearchParams({ key: keyword.trim().replace(/\s*(?:模组|模組|mod)$/i, ''), filter: '1' })
    try {
      const html = await readHtml(`https://search.mcmod.cn/s?${params}`, fetcher, signal)
      let candidates = parseMcmodSearch(html, keyword)
      let limited = false
      if (/data-page=["']2["']/.test(html)) {
        params.set('page', '2')
        const next = await readHtml(`https://search.mcmod.cn/s?${params}`, fetcher, signal)
        candidates = [...new Map([...candidates, ...parseMcmodSearch(next, keyword)].map(item => [item.id, item])).values()]
        limited = /data-page=["']3["']/.test(next)
      }
      candidates.sort((a, b) => mcmodNameRank(a.title, key) - mcmodNameRank(b.title, key) || a.title.length - b.title.length || a.id.localeCompare(b.id))
      limited ||= candidates.length > MAX_ENTRIES
      candidates = candidates.slice(0, MAX_ENTRIES)
      const entries: McmodEntry[] = [], warnings: string[] = []
      let cursor = 0
      await Promise.all(Array.from({ length: Math.min(2, candidates.length) }, async () => {
        while (cursor < candidates.length) {
          const index = cursor++, candidate = candidates[index]
          try {
            const page = await readHtml(candidate.url, fetcher, signal), title = parseMcmodEntryTitle(page)
            // A changed entry title must still match the requested name. Never
            // link a stale search result to an unrelated, renamed entry page.
            if (title && (!Number.isFinite(mcmodNameRank(title, key)) || (mcmodNameRank(candidate.title, key) < 2 && mcmodNameRank(title, key) >= 2))) {
              warnings.push(`MC百科“${candidate.title}”的条目名称已变化，未关联其他同名项目；请核对完整名称。`)
              continue
            }
            entries[index] = { ...candidate, ...(title ? { title } : {}), projects: parseMcmodProjects(page) }
          }
          catch { warnings.push(`MC百科“${candidate.title}”的来源链接读取失败，未自动关联项目；可重试。`) }
        }
      }))
      if (limited) warnings.push('MC百科本批已核对最多 5 个条目；更多相关条目尚未核对。')
      const result = { entries: entries.filter(Boolean), warnings }
      // Empty results and failed lookups are not negative-cache hits. They can
      // be retried immediately when the network or site recovers.
      if (fetcher === desktopHtmlFetch && result.entries.length && !warnings.length) {
        if (cache.size >= 64) cache.delete(cache.keys().next().value!)
        cache.set(key, { at: Date.now(), result: structuredClone(result) })
      }
      return result
    } catch { return { entries: [], warnings: ['MC百科中文检索暂不可用，已保留原中文关键词和内置别名检索；可稍后重试。'] } }
  }
  const promise = run()
  if (fetcher === desktopHtmlFetch) pending.set(key, promise)
  try { return await promise } finally { if (fetcher === desktopHtmlFetch) pending.delete(key) }
}

export interface McmodDiscoveryState { candidates: Candidate[]; done: string[]; nextPage: number; exhausted: boolean }
export const initialMcmodDiscoveryState = (): McmodDiscoveryState => ({ candidates: [], done: [], nextPage: 1, exhausted: false })
export interface McmodDiscoveryBatch extends McmodSearchResult { hasMore: boolean; failed: boolean }
/** Incremental discovery: two search pages and five entry pages at most in one
 * caller-owned deadline. State belongs to the shared search, not a renderer;
 * unread/failed candidates remain available for the explicit next batch. */
export async function lookupMcmodBatch(keyword: string, state: McmodDiscoveryState, signal: AbortSignal,
  onEntry?: (entry: McmodEntry) => void, fetcher: typeof fetch = desktopHtmlFetch): Promise<McmodDiscoveryBatch> {
  const key = normalizeChineseModKeyword(keyword), warnings: string[] = [], entries: McmodEntry[] = []
  if (!/\p{Script=Han}/u.test(key) || key.length < 2 || key.length > 80) {
    state.exhausted = true
    return { entries, warnings, hasMore: false, failed: false }
  }
  let failed = false
  const pendingCandidates = () => state.candidates.filter(candidate => !state.done.includes(candidate.id))
  // Initial two pages discover exact entries beyond page one without throwing
  // away the already confirmed related editions. Later batches read ahead only
  // when the pending title queue no longer fills the entry budget.
  const pagesToRead = state.nextPage === 1 ? 2 : pendingCandidates().length < MAX_ENTRIES ? 2 : 0
  for (let read = 0; read < pagesToRead && !state.exhausted; read++) {
    try {
      const params = new URLSearchParams({ key: keyword.trim().replace(/\s*(?:模组|模組|mod)$/i, ''), filter: '1' })
      if (state.nextPage > 1) params.set('page', String(state.nextPage))
      const html = await readHtml(`https://search.mcmod.cn/s?${params}`, fetcher, signal)
      const found = parseMcmodSearch(html, keyword)
      state.candidates = [...new Map([...state.candidates, ...found].map(candidate => [candidate.id, candidate])).values()]
      const next = state.nextPage + 1
      state.exhausted = !new RegExp(`data-page=["']${next}["']`).test(html)
      state.nextPage = next
    } catch {
      failed = true; warnings.push('MC百科中文检索暂不可用，已保留其他已确认结果；可继续查找重试。'); break
    }
  }
  state.candidates.sort((a, b) => mcmodNameRank(a.title, key) - mcmodNameRank(b.title, key) || a.title.length - b.title.length || a.id.localeCompare(b.id))
  const batch = pendingCandidates().slice(0, MAX_ENTRIES)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(2, batch.length) }, async () => {
    while (cursor < batch.length) {
      const candidate = batch[cursor++]
      try {
        const html = await readHtml(candidate.url, fetcher, signal), title = parseMcmodEntryTitle(html)
        if (title && (!Number.isFinite(mcmodNameRank(title, key)) ||
          (mcmodNameRank(candidate.title, key) < 2 && mcmodNameRank(title, key) >= 2))) {
          state.done.push(candidate.id)
          warnings.push(`MC百科“${candidate.title}”的条目名称已变化，未自动关联项目；请核对来源。`)
          continue
        }
        const item = { ...candidate, ...(title ? { title } : {}), projects: parseMcmodProjects(html) }
        state.done.push(candidate.id); entries.push(item); onEntry?.(item)
      } catch {
        failed = true; warnings.push(`MC百科“${candidate.title}”的来源链接读取失败，未自动关联项目；可继续查找重试。`)
      }
    }
  }))
  const hasMore = !state.exhausted || pendingCandidates().length > 0
  if (hasMore && !failed) warnings.push('还有相关百科条目未核对，可继续查找；当前数量只统计已确认项目。')
  return { entries, warnings, hasMore, failed }
}
