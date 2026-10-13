import { randomUUID } from 'node:crypto'
import type { CommunityQuery, CommunityResult, CommunitySource, CommunitySearchPage, CommunitySearchSnapshot, CommunitySearchContinuation } from '../../shared/types'
import { effectiveCommunityFilter } from '../../shared/communityPolicy'
import { chineseModSearchMatches, chineseModFamilyTerms, chineseModDisplayName } from './community-zh'
import { initialMcmodDiscoveryState, lookupMcmodBatch, mcmodNameRank, type McmodDiscoveryState, type McmodEntry } from './mcmodSearch'
import { rawProviderSearch, withCommunitySignal } from './community'

interface Task { key: string; source: CommunitySource; keyword: string; kind: 'original' | 'identity' | 'family'; offset: number; name?: string; afterBatch: number }
interface Confirmed { item: CommunityResult; rank: number }
interface Work {
  key: string; query: CommunityQuery; controller: AbortController; subscribers: Set<Session>; items: Map<string, Confirmed>;
  tasks: Map<string, Task>; pages: Map<string, CommunitySearchPage>; mcmod: McmodDiscoveryState; warnings: Set<string>; phase: CommunitySearchSnapshot['phase'];
  batch: number; busy: boolean; failed: boolean; at: number; error?: string
}
interface Session { owner: number; requestId: string; query: CommunityQuery; work: Work; visible: number; revision: number; cursor: string; onUpdate: (snapshot: CommunitySearchSnapshot) => void; at: number }
const sessions = new Map<number, Session>()
const shared = new Map<string, Work>()
const SESSION_TTL = 10 * 60_000, WORK_TTL = 60_000, MAX_WORK = 64, PROVIDER_BATCH = 12
const sourceLabel = (source: CommunitySource) => source === 'modrinth' ? 'Modrinth' : 'CurseForge'
const textOrder = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const english = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '')
function rankName(name: string, keyword: string): number {
  const rank = mcmodNameRank(name.split(' | ')[0], keyword)
  return Number.isFinite(rank) ? rank : 5
}
function sources(query: CommunityQuery): CommunitySource[] { return query.source === 'all' ? ['modrinth', 'curseforge'] : [query.source] }
function queryOf(input: CommunityQuery): CommunityQuery {
  if (!input || input.kind !== 'mod' || !['all', 'modrinth', 'curseforge'].includes(input.source) ||
    typeof input.keyword !== 'string' || !input.keyword.trim() || input.keyword.trim().length > 80 || !/\p{Script=Han}/u.test(input.keyword) ||
    input.sort !== undefined && !['relevance', 'downloads', 'newest'].includes(input.sort) ||
    !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000 || !Number.isSafeInteger(input.offset) || input.offset < 0 ||
    input.mcVersion !== undefined && (typeof input.mcVersion !== 'string' || input.mcVersion.length > 80) ||
    input.loader !== undefined && !['', 'forge', 'fabric', 'quilt', 'neoforge'].includes(input.loader)) throw new Error('无效的中文 MOD 查询条件')
  return { ...input, ...effectiveCommunityFilter(input), keyword: input.keyword.trim(), offset: 0, sort: input.sort ?? 'relevance' }
}
function sorted(work: Work): CommunityResult[] {
  if (work.busy || work.phase === 'initial' || work.phase === 'enriching') return [...work.items.values()].map(row => row.item)
  return [...work.items.values()].sort((a, b) => {
    const metric = work.query.sort === 'downloads' ? b.item.downloads - a.item.downloads
      : work.query.sort === 'newest' ? (Date.parse(b.item.updatedAt ?? '') || 0) - (Date.parse(a.item.updatedAt ?? '') || 0) : a.rank - b.rank
    return metric || a.rank - b.rank || b.item.downloads - a.item.downloads ||
      textOrder(a.item.title.normalize('NFKC').toLowerCase(), b.item.title.normalize('NFKC').toLowerCase()) ||
      textOrder(a.item.source, b.item.source) || textOrder(a.item.projectId, b.item.projectId)
  }).map(row => row.item)
}
function more(work: Work): boolean {
  return work.tasks.size > 0 || !work.mcmod.exhausted || work.mcmod.candidates.some(row => !work.mcmod.done.includes(row.id))
}
function snapshot(session: Session): CommunitySearchSnapshot {
  const work = session.work, all = sorted(work)
  return structuredClone({ requestId: session.requestId, revision: session.revision, query: session.query,
    phase: work.phase, items: all.slice(0, session.visible), total: all.length, offset: 0, limit: session.visible,
    warnings: [...work.warnings], discoveryHasMore: more(work), totalKind: 'confirmed',
    ...(!work.busy && (all.length > session.visible || more(work)) ? { cursor: session.cursor } : {}), ...(work.error ? { error: work.error } : {}) })
}
function changed(work: Work): void {
  work.at = Date.now()
  for (const session of work.subscribers) {
    if (sessions.get(session.owner) !== session) continue
    session.revision++; session.cursor = randomUUID()
    try { session.onUpdate(snapshot(session)) } catch { /* A disposed window cannot cancel another subscriber. */ }
  }
}
function addTask(work: Work, task: Omit<Task, 'key'>): void {
  const key = JSON.stringify([task.source, task.keyword, task.offset]), existing = work.tasks.get(key)
  if (!existing) work.tasks.set(key, { ...task, key })
  else if (task.kind === 'identity') { existing.kind = 'identity'; existing.name = task.name }
}
function validItem(item: CommunityResult, source: CommunitySource): boolean {
  return item.source === source && (source === 'curseforge' ? /^[1-9]\d{0,19}$/.test(item.projectId) : /^[a-zA-Z0-9_-]{1,128}$/.test(item.projectId)) && /^[a-zA-Z0-9_-]{1,128}$/.test(item.slug)
}
function confirm(work: Work, row: CommunityResult, name?: string): void {
  const originalTitle = row.originalTitle ?? row.title, display = name ?? chineseModDisplayName(row.slug, row.source)
  const item = { ...row, originalTitle, ...(display ? { title: `${display} | ${originalTitle}` } : {}) }
  const rank = name ? rankName(name, work.query.keyword) : rankName(display ?? originalTitle, work.query.keyword)
  const key = `${item.source}:${item.projectId}`, prior = work.items.get(key)
  // An unrelated broad English hit is never assigned the queried base's name.
  // A later exact identity may add its own verified Chinese label to that ID.
  if (!prior || rank < prior.rank || name && !prior.item.title.includes(' | ')) work.items.set(key, { item, rank })
}
function seed(work: Work): void {
  const selected = sources(work.query)
  for (const source of selected)
    addTask(work, { source, keyword: work.query.keyword, kind: 'original', offset: 0, afterBatch: 0 })
  for (const source of selected)
    for (const keyword of chineseModFamilyTerms(work.query.keyword)) addTask(work, { source, keyword, kind: 'family', offset: 0, afterBatch: 0 })
  for (const match of chineseModSearchMatches(work.query.keyword)) for (const source of selected)
    if (!match.source || match.source === source) addTask(work, { source, keyword: match.slug, name: match.name, kind: 'identity', offset: 0, afterBatch: 0 })
}
function addEntry(work: Work, entry: McmodEntry): void {
  for (const project of entry.projects.filter(project => sources(work.query).includes(project.source)))
    addTask(work, { source: project.source, keyword: project.slug, name: entry.title, kind: 'identity', offset: 0, afterBatch: work.batch })
  if (!entry.projects.some(project => sources(work.query).includes(project.source)))
    work.warnings.add(`“${entry.title}”未提供所选来源的 MOD 项目链接，未自动关联下载。`)
}
async function runBatch(work: Work): Promise<void> {
  if (work.busy || work.controller.signal.aborted || !work.subscribers.size) return
  work.busy = true; work.batch++; work.phase = 'enriching'; work.error = undefined; work.warnings.clear()
  changed(work)
  const signal = AbortSignal.any([work.controller.signal, AbortSignal.timeout(10_000)])
  const attempted = new Set<string>()
  let reads = 0, successes = 0, failures = 0, producerDone = false
  const waiting: Array<() => void> = []
  const wake = () => { for (const resolve of waiting.splice(0)) resolve() }
  const aborted = () => { producerDone = true; wake() }
  signal.addEventListener('abort', aborted, { once: true })
  const take = async (): Promise<Task | undefined> => {
    while (!signal.aborted && reads < PROVIDER_BATCH) {
      const task = [...work.tasks.values()].find(row => row.afterBatch <= work.batch && !attempted.has(row.key))
      if (task) { attempted.add(task.key); reads++; return task }
      if (producerDone) return
      await new Promise<void>(resolve => waiting.push(resolve))
    }
  }
  const read = async (task: Task) => {
    try {
      const page = work.pages.get(task.key) ?? await withCommunitySignal(signal, () => rawProviderSearch(task.source, { ...work.query, source: task.source, keyword: task.keyword, offset: task.offset, limit: 50 }))
      signal.throwIfAborted(); successes++; work.tasks.delete(task.key)
      work.pages.set(task.key, page)
      for (const item of page.items.filter(item => validItem(item, task.source))) {
        if (task.kind === 'original') confirm(work, item)
        else if (task.kind === 'identity' && item.slug.toLowerCase() === task.keyword.toLowerCase()) confirm(work, item, task.name)
        else if (english(item.slug).includes(english(task.keyword)) || english(item.originalTitle ?? item.title).includes(english(task.keyword))) {
          // Independent related project; keep its own title/source/ID. Matching
          // a provider search never turns this into the queried base identity.
          const key = `${item.source}:${item.projectId}`
          if (!work.items.has(key)) work.items.set(key, { item: { ...item, originalTitle: item.originalTitle ?? item.title }, rank: 4 })
        }
      }
      if (task.offset + page.items.length < page.total && page.items.length)
        addTask(work, { ...task, offset: task.offset + page.items.length, afterBatch: work.batch + 1 })
      changed(work)
    } catch {
      if (work.controller.signal.aborted) return
      failures++; work.warnings.add(`${sourceLabel(task.source)} 的“${task.name ?? task.keyword}”查询未完成，已保留已确认结果；可继续查找重试。`)
    }
  }
  const encyclopedia = lookupMcmodBatch(work.query.keyword, work.mcmod, signal, entry => { addEntry(work, entry); wake() }).then(result => {
    for (const warning of result.warnings) work.warnings.add(warning)
    if (result.failed) failures++
  }).finally(() => { producerDone = true; wake() })
  const workers = Array.from({ length: 4 }, async () => { let task: Task | undefined; while ((task = await take())) await read(task) })
  try { await Promise.all([encyclopedia, ...workers]) } finally {
    signal.removeEventListener('abort', aborted)
    work.busy = false
    if (work.controller.signal.aborted || !work.subscribers.size) return
    work.failed = failures > 0
    work.phase = !successes && failures && !work.items.size ? 'failed' : 'ready'
    // Commit sorting once per batch. During enrichment Map insertion order
    // preserves the prefix that the player is already reading; new confirmed
    // projects append instead of repeatedly jumping above it.
    work.items = new Map(sorted(work).map(item => [`${item.source}:${item.projectId}`, work.items.get(`${item.source}:${item.projectId}`)!]))
    if (work.phase === 'failed') work.error = '搜索来源暂不可用，可重试；未把查询失败当作没有匹配模组。'
    if (signal.aborted) work.warnings.add('本批检索达到 10 秒期限，已保留快结果；尚未完成的项目可继续查找。')
    if (more(work)) work.warnings.add('当前数量仅统计已确认项目，仍有相关项目待查找。')
    changed(work)
  }
}
function cleanup(): void {
  const now = Date.now()
  for (const [owner, session] of sessions) if (now - session.at > SESSION_TTL) cancelCommunitySearch(owner, session.requestId)
  for (const [key, work] of shared) if (!work.subscribers.size && (work.failed || now - work.at > WORK_TTL)) shared.delete(key)
}
const cleaner = setInterval(cleanup, 30_000); cleaner.unref()

/** Immediate return; every asynchronous update is scoped to the initiating
 * owner/request. Equal active queries share work and cancellation is refcounted. */
export function startCommunitySearch(owner: number, requestId: string, input: CommunityQuery,
  onUpdate: (snapshot: CommunitySearchSnapshot) => void): CommunitySearchSnapshot {
  cleanup()
  if (!Number.isSafeInteger(owner) || owner < 0 || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) throw new Error('无效的社区搜索操作')
  const query = queryOf(input)
  cancelCommunitySearch(owner)
  const key = JSON.stringify({ ...query, offset: 0, limit: 0 })
  let work = shared.get(key)
  if (!work || work.controller.signal.aborted || !work.subscribers.size && (work.failed || Date.now() - work.at > WORK_TTL)) {
    if (shared.size >= MAX_WORK) {
      const evict = [...shared].find(([, candidate]) => !candidate.subscribers.size)
      if (evict) shared.delete(evict[0]); else throw new Error('当前社区查询较多，请关闭其他查询后重试。')
    }
    work = { key, query, controller: new AbortController(), subscribers: new Set(), items: new Map(), tasks: new Map(), pages: new Map(), mcmod: initialMcmodDiscoveryState(),
      warnings: new Set(), phase: 'initial', batch: 0, busy: false, failed: false, at: Date.now() }
    seed(work); shared.set(key, work)
  }
  const session: Session = { owner, requestId, query, work, visible: query.limit, revision: 1, cursor: randomUUID(), onUpdate, at: Date.now() }
  sessions.set(owner, session); work.subscribers.add(session)
  const result = snapshot(session)
  if (work.phase === 'initial' || work.failed) queueMicrotask(() => { void runBatch(work!) })
  return result
}

export function continueCommunitySearch(owner: number, requestId: string, continuation: CommunitySearchContinuation): CommunitySearchSnapshot {
  cleanup()
  const session = sessions.get(owner)
  if (!session || session.requestId !== requestId) throw new Error('搜索已关闭或已被新的查询替换，请重新搜索。')
  if (!continuation || !['page', 'discover'].includes(continuation.mode) || typeof continuation.cursor !== 'string') throw new Error('无效的社区搜索续查类型')
  // A click can race an update from another subscriber. Refresh the caller
  // without replaying an old page/discovery operation or losing its results.
  if (continuation.cursor !== session.cursor || session.work.busy) return snapshot(session)
  session.at = Date.now(); session.cursor = randomUUID(); session.revision++
  if (continuation.mode === 'page') {
    if (session.visible >= session.work.items.size) throw new Error('没有尚未显示的已确认项目，请继续查找相关模组。')
    session.visible += Math.min(50, session.query.limit)
  } else if (continuation.mode === 'discover') {
    if (!more(session.work)) throw new Error('当前已确认检索完成，没有待续查项目。')
    // Consume the cursor synchronously, before the first network await. The
    // caller gets enriching immediately and cannot replay it to spawn a batch.
    session.work.phase = 'enriching'
    void runBatch(session.work)
  } else throw new Error('无效的社区搜索续查类型')
  return snapshot(session)
}

export function cancelCommunitySearch(owner: number, requestId?: string): boolean {
  const session = sessions.get(owner)
  if (!session || requestId !== undefined && session.requestId !== requestId) return false
  sessions.delete(owner); session.work.subscribers.delete(session)
  if (!session.work.subscribers.size && session.work.busy) {
    session.work.controller.abort(new DOMException('搜索窗口已取消', 'AbortError'))
    if (shared.get(session.work.key) === session.work) shared.delete(session.work.key)
  }
  return true
}
