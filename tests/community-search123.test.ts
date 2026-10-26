import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import type { CommunityQuery, CommunitySearchSnapshot } from '../src/shared/types'
import { chineseModSearchMatches } from '../src/main/core/community-zh'
import { runCommunityRequest, sharedCommunityRequest } from '../src/main/core/communitySearchBudget'
import { initialMcmodDiscoveryState, lookupMcmodBatch, parseMcmodSearch } from '../src/main/core/mcmodSearch'

const query: CommunityQuery = { keyword: '无尽', kind: 'mod', source: 'modrinth', offset: 0, limit: 2, sort: 'relevance' }
const html = (value: string) => new Response(value, { headers: { 'content-type': 'text/html; charset=utf-8' } })
const search = (rows: Array<[string, string]>, next = '') => `<div class="search-result-list">${rows.map(([id, title]) => `<div class="result-item"><div class="head"><a href="https://www.mcmod.cn/class/${id}.html">${title}</a></div><div class="body">正文中的前置不能成为身份</div></div>`).join('')}</div><div class="search-result-pages">${next}</div>`
const entry = (title: string, slug: string) => `<div class="class-title"><h3>${title}</h3></div><ul class="common-link-icon-frame"><li><a href="https://modrinth.com/mod/${slug}">Modrinth</a></li></ul>`
const row = (id: string, slug: string, title = slug, downloads = 1, date = '2026-01-01') => ({ project_id: id, slug, title, downloads, date_modified: date })
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
let bundle: Promise<string> | undefined
async function fixture(t: any, fetcher: typeof fetch) {
  bundle ??= build({ stdin: { contents: `export { startCommunitySearch, continueCommunitySearch, cancelCommunitySearch } from './src/main/core/community';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' }).then(result => result.outputFiles[0].text)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-search123-')), require = createRequire(path.resolve('package.json')), module = { exports: {} as any }
  const electron = { app: { getPath: (name: string) => path.join(root, name), getVersion: () => '1.1.23-test', getName: () => 'KAMUCL-test', isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false } }
  new Function('require', 'module', 'exports', 'fetch', await bundle)(name => name === 'electron' ? electron : require(name), module, module.exports, fetcher)
  const runtime = module.exports as typeof import('../src/main/core/community')
  const updates: CommunitySearchSnapshot[] = [], owners = new Set<number>(), waiters: Array<() => void> = []
  const start = (owner: number, input: CommunityQuery = query, requestId = 'query-' + owner) => {
    owners.add(owner)
    return runtime.startCommunitySearch(owner, requestId, input, snapshot => { updates.push(snapshot); for (const wake of waiters.splice(0)) wake() })
  }
  const wait = async (predicate: (snapshot: CommunitySearchSnapshot) => boolean, timeout = 6000) => {
    const controller = new AbortController(), timer = setTimeout(() => { controller.abort(new Error('未收到预期搜索状态')); for (const wake of waiters.splice(0)) wake() }, timeout)
    try {
      while (!updates.some(predicate)) { controller.signal.throwIfAborted(); await new Promise<void>(resolve => waiters.push(resolve)) }
      return updates.findLast(predicate)!
    } finally { clearTimeout(timer) }
  }
  t.after(() => { for (const owner of owners) runtime.cancelCommunitySearch(owner); fs.rmSync(root, { recursive: true, force: true }) })
  return { runtime, start, wait, updates }
}

test('123 partial and exact Chinese discovery retains the verified related editions, with source-specific identities', () => {
  const names = chineseModSearchMatches('无尽')
  assert(names.some(item => item.slug === 'avaritia' && item.source === 'curseforge'))
  assert(names.some(item => item.slug === 're-avaritia' && item.source === 'modrinth'))
  assert(names.some(item => item.slug === 'avaritia-endless' && item.source === 'curseforge'))
  const sodium = chineseModSearchMatches('钠')
  assert.equal(sodium[0].slug, 'sodium'); assert(sodium.some(item => item.slug === 'sodium-extra'))
  assert(chineseModSearchMatches('机械').some(item => item.slug === 'create'))
  assert.deepEqual(chineseModSearchMatches('不存在登记的中文词'), [])
  const page = search([['1', '无尽贪婪'], ['2', '无尽贪婪：重生'], ['3', '无尽贪婪·伪']])
  assert.deepEqual(parseMcmodSearch(page, '无尽贪婪').map(item => item.id), ['1', '3', '2'])
})

test('123 a slow encyclopedia cannot block original/local/English quick results, and identities and every filter stay exact', async t => {
  let release!: (response: Response) => void
  const pending = new Promise<Response>(resolve => { release = resolve }), requests: URL[] = []
  const h = await fixture(t, async input => {
    const url = new URL(String(input)); requests.push(url)
    if (url.hostname === 'search.mcmod.cn') return pending
    const keyword = url.searchParams.get('query')
    const hits = keyword === '无尽' ? [row('domestic', 'native-endless', '无尽国内项目')]
      : keyword === 're-avaritia' ? [row('wrong', 'other-project', 'Other Project'), row('reborn', 're-avaritia', 'Re:Avaritia')]
      : [row('reborn', 're-avaritia', 'Re:Avaritia'), row('fork', 'avaritia-reforge', 'Avaritia Reforge')]
    return Response.json({ hits, total_hits: hits.length })
  })
  const first = h.start(1, { ...query, mcVersion: '1.20.1', loader: 'forge', limit: 20 })
  assert.equal(first.phase, 'initial'); assert.equal(first.total, 0)
  const quick = await h.wait(snapshot => snapshot.total >= 3 && snapshot.phase === 'enriching')
  assert(quick.items.some(item => item.projectId === 'domestic'))
  assert.equal(quick.items.find(item => item.projectId === 'reborn')!.title, '无尽贪婪：重生 | Re:Avaritia')
  assert.equal(quick.items.find(item => item.projectId === 'fork')!.title, 'Avaritia Reforge')
  assert(!quick.items.some(item => item.projectId === 'wrong'))
  release(html(search([])))
  const complete = await h.wait(snapshot => snapshot.phase === 'ready')
  assert.equal(complete.totalKind, 'confirmed'); assert.equal(complete.discoveryHasMore, false)
  for (const url of requests.filter(url => url.pathname.endsWith('/search'))) {
    const facets = JSON.parse(url.searchParams.get('facets')!).flat()
    assert(facets.includes('versions:1.20.1')); assert(facets.includes('categories:forge')); assert(facets.includes('project_type:mod'))
    assert.equal(url.searchParams.get('limit'), '50')
  }
})

test('123 generic English aliases expose genuine related projects without borrowing the base Chinese label', async t => {
  const h = await fixture(t, async input => {
    const url = new URL(String(input)); if (url.hostname === 'search.mcmod.cn') return html(search([]))
    const hits = url.searchParams.get('query') === 'create' ? [row('main', 'create', 'Create'), row('addon', 'create-addition', 'Create Addition'), row('other', 'unrelated', 'Unrelated')] : []
    return Response.json({ hits, total_hits: hits.length })
  })
  h.start(1, { ...query, keyword: '机械' })
  const ready = await h.wait(snapshot => snapshot.phase === 'ready')
  assert.equal(ready.total, 2); assert.equal(ready.items[0].projectId, 'main')
  assert.equal(ready.items.find(item => item.projectId === 'addon')!.title, 'Create Addition')
})

test('123 complete visible prefix paging and progressive batches do not replay cursors or claim undiscovered totals', async t => {
  let entryReads = 0
  const titles = Array.from({ length: 8 }, (_, i) => [String(10 + i), '未知系列' + i] as [string, string])
  const h = await fixture(t, async input => {
    const url = new URL(String(input))
    if (url.hostname === 'search.mcmod.cn') return html(search(titles))
    if (url.hostname === 'www.mcmod.cn') { entryReads++; const id = url.pathname.match(/\d+/)![0]; return html(entry('未知系列' + (Number(id) - 10), 'series-' + id)) }
    const keyword = url.searchParams.get('query'), hits = keyword?.startsWith('series-') ? [row(keyword, keyword, 'Series ' + keyword)] : []
    return Response.json({ hits, total_hits: hits.length })
  })
  h.start(1, { ...query, keyword: '未知系列' })
  const first = await h.wait(snapshot => snapshot.phase === 'ready')
  assert.equal(entryReads, 5); assert.equal(first.total, 5); assert.equal(first.items.length, 2); assert(first.discoveryHasMore)
  const page = h.runtime.continueCommunitySearch(1, first.requestId, { mode: 'page', cursor: first.cursor! })
  assert.equal(page.items.length, 4); assert.equal(page.total, 5); assert.deepEqual(page.items.slice(0, 2), first.items)
  const replay = h.runtime.continueCommunitySearch(1, first.requestId, { mode: 'page', cursor: first.cursor! })
  assert.equal(replay.revision, page.revision); assert.equal(replay.items.length, 4)
  const discovering = h.runtime.continueCommunitySearch(1, page.requestId, { mode: 'discover', cursor: page.cursor! })
  assert.equal(discovering.phase, 'enriching')
  const second = await h.wait(snapshot => snapshot.phase === 'ready' && snapshot.total === 8)
  assert.equal(entryReads, 8); assert.equal(second.items.length, 4); assert.equal(second.discoveryHasMore, false)
  const after = h.runtime.continueCommunitySearch(1, second.requestId, { mode: 'discover', cursor: page.cursor! })
  assert.equal(after.revision, second.revision); assert.equal(entryReads, 8)
})

test('123 equal owner-independent searches share work; cancellation releases only the last subscription', async t => {
  let release!: (response: Response) => void, calls = 0, aborted = 0
  const pending = new Promise<Response>(resolve => { release = resolve })
  const h = await fixture(t, async (input, init) => {
    if (String(input).includes('search.mcmod.cn')) return html(search([]))
    calls++; init?.signal?.addEventListener('abort', () => { aborted++ }, { once: true }); return pending
  })
  const input = { ...query, keyword: '唯一共享', limit: 20 }
  h.start(1, input); h.start(2, input); await tick()
  assert.equal(calls, 1); assert(h.runtime.cancelCommunitySearch(1)); assert.equal(aborted, 0)
  release(Response.json({ hits: [row('kept', 'kept', '唯一共享项目')], total_hits: 1 }))
  const ready = await h.wait(snapshot => snapshot.requestId === 'query-2' && snapshot.phase === 'ready')
  assert.equal(ready.items[0].projectId, 'kept'); assert(!h.updates.some(snapshot => snapshot.requestId === 'query-1' && snapshot.phase === 'ready'))
  const resume = h.start(3, { ...input, limit: 1000 })
  assert.equal(resume.query.limit, 1000); assert.equal(resume.items.length, 1); assert.equal(resume.phase, 'ready'); assert.equal(calls, 1)
})

test('123 source restriction, failed query retry, and downloads/newest order apply to the whole confirmed union', async t => {
  let fail = true, providerCalls = 0
  const h = await fixture(t, async input => {
    const url = new URL(String(input)); if (url.hostname === 'search.mcmod.cn') return html(search([]))
    assert(url.hostname !== 'api.modrinth.com'); providerCalls++
    if (fail) return new Response('', { status: 503 })
    const keyword = url.searchParams.get('searchFilter'), rows = keyword === '无尽' ? [{ id: 71, slug: 'native', name: '无尽国内项目', downloadCount: 5, dateModified: '2026-02-01' }]
      : keyword === 'avaritia' ? [{ id: 72, slug: 'avaritia', name: 'Avaritia', downloadCount: 200, dateModified: '2026-01-01' }, { id: 73, slug: 'avaritia-new', name: 'Avaritia New', downloadCount: 100, dateModified: '2026-03-01' }] : []
    return Response.json({ data: rows, pagination: { totalCount: rows.length } })
  })
  const q = { ...query, source: 'curseforge' as const, sort: 'downloads' as const, limit: 20 }
  h.start(1, q)
  const failed = await h.wait(snapshot => snapshot.phase === 'failed')
  assert.equal(failed.total, 0); assert(failed.error); assert(failed.discoveryHasMore)
  const before = providerCalls; h.runtime.cancelCommunitySearch(1); fail = false; h.start(2, q)
  const ready = await h.wait(snapshot => snapshot.requestId === 'query-2' && snapshot.phase === 'ready')
  assert(providerCalls > before); assert.deepEqual(ready.items.map(item => item.projectId), ['72', '73', '71'])
  h.start(3, { ...q, sort: 'newest' })
  const newest = await h.wait(snapshot => snapshot.requestId === 'query-3' && snapshot.phase === 'ready')
  assert.deepEqual(newest.items.map(item => item.projectId), ['73', '71', '72'])
})

test('123 the shared transport budget covers providers and encyclopedia with fair queued cancellation', async () => {
  let active = 0, mc = 0, peak = 0, mcPeak = 0
  const releases: Array<() => void> = [], controllers = Array.from({ length: 12 }, () => new AbortController())
  const jobs = controllers.map((controller, i) => runCommunityRequest(i < 6 ? 'mcmod' : 'provider', controller.signal, async () => {
    active++; if (i < 6) mc++; peak = Math.max(peak, active); mcPeak = Math.max(mcPeak, mc)
    await new Promise<void>(resolve => releases.push(resolve))
    active--; if (i < 6) mc--
  }))
  // Attach rejection handlers before deliberately cancelling queued work.
  const settled = Promise.allSettled(jobs)
  await tick(); assert.equal(peak, 4); assert.equal(mcPeak, 2)
  controllers[5].abort(new Error('取消排队')); controllers[11].abort(new Error('取消排队'))
  while (active || releases.length) { for (const release of releases.splice(0)) release(); await tick() }
  const results = await settled
  assert.equal(results.filter(result => result.status === 'rejected').length, 2)
  assert.equal(peak, 4); assert.equal(mcPeak, 2)
})

test('123 failed encyclopedia entries remain retryable, titles/off-site/body cannot invent a provider identity', async () => {
  const state = initialMcmodDiscoveryState(); let fail = true
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input)); if (url.hostname === 'search.mcmod.cn') return html(search([['1', '网络研究'], ['2', '网络研究：附属']]))
    if (url.pathname.includes('/1.') && fail) return new Response('', { status: 503 })
    if (url.pathname.includes('/2.')) return html('<div class="class-title"><h3>网络研究：附属</h3></div><ul class="common-link-icon-frame"><a href="https://modrinth.com.evil.invalid/mod/other">假来源</a></ul><p><a href="https://modrinth.com/mod/body">正文前置</a></p>')
    return html(entry('网络研究', 'research'))
  }
  const first = await lookupMcmodBatch('网络研究', state, AbortSignal.timeout(1000), undefined, fetcher)
  assert(first.failed); assert(first.hasMore); assert.deepEqual(first.entries.flatMap(item => item.projects), [])
  fail = false
  const second = await lookupMcmodBatch('网络研究', state, AbortSignal.timeout(1000), undefined, fetcher)
  assert.equal(second.entries[0].projects[0].slug, 'research'); assert.equal(second.hasMore, false)
})

test('123 replacing the sole owner aborts old network reads and never emits the old ready state', async t => {
  let oldAborted = false
  const h = await fixture(t, async (input, init) => {
    const url = new URL(String(input)); if (url.hostname === 'search.mcmod.cn') return html(search([]))
    if (url.searchParams.get('query') === '旧关键词') return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { oldAborted = true; reject(init.signal!.reason) }, { once: true })
    })
    return Response.json({ hits: [row('new', 'new', '新关键词')], total_hits: 1 })
  })
  h.start(1, { ...query, keyword: '旧关键词' }, 'old'); await tick()
  h.start(1, { ...query, keyword: '新关键词' }, 'new')
  const ready = await h.wait(snapshot => snapshot.requestId === 'new' && snapshot.phase === 'ready')
  assert(oldAborted); assert.equal(ready.items[0].projectId, 'new')
  assert(!h.updates.some(snapshot => snapshot.requestId === 'old' && snapshot.phase === 'ready'))
  assert.equal(h.runtime.cancelCommunitySearch(1, 'old'), false)
})

test('123 relevance ties use downloads then title and real identity; source-specific names never leak to an unverified source', async t => {
  const h = await fixture(t, async input => {
    const url = new URL(String(input)); if (url.hostname === 'search.mcmod.cn') return html(search([]))
    const hits = url.searchParams.get('query') === '无尽' ? [row('c', 'c', '无尽C', 9), row('b', 'b', '无尽B', 20), row('a2', 'a2', '无尽A', 20), row('a1', 'a1', '无尽A', 20), row('foreign', 'avaritia', 'An unrelated project', 999)] : []
    return Response.json({ hits, total_hits: hits.length })
  })
  h.start(1, { ...query, limit: 20 })
  const ready = await h.wait(snapshot => snapshot.phase === 'ready')
  assert.deepEqual(ready.items.map(item => item.projectId), ['a1', 'a2', 'b', 'c', 'foreign'])
  assert.equal(ready.items.find(item => item.projectId === 'foreign')!.title, 'An unrelated project')
  for (const override of [{ source: 'wrong' }, { sort: 'wrong' }, { keyword: '无'.repeat(81) }, { kind: 'modpack' }, { limit: 1001 }, { loader: 'wrong' }])
    assert.throws(() => h.start(2, { ...query, ...override } as CommunityQuery), /无效/)
  assert.equal(h.runtime.cancelCommunitySearch(1), true, 'Invalid replacement queries do not cancel the valid owner')
})

test('123 an explicit new start retries a failed shared search without cancelling the other owner or dropping confirmed results', async t => {
  let fail = true, calls = 0
  const h = await fixture(t, async input => {
    if (String(input).includes('search.mcmod.cn')) return html(search([]))
    calls++; if (fail) return new Response('', { status: 503 })
    return Response.json({ hits: [row('recovered', 'recovered', '重试共享')], total_hits: 1 })
  })
  const q = { ...query, keyword: '重试共享' }
  h.start(1, q)
  await h.wait(snapshot => snapshot.phase === 'failed'); const prior = calls
  fail = false; h.start(2, q)
  const ready = await h.wait(snapshot => snapshot.requestId === 'query-2' && snapshot.phase === 'ready')
  assert.equal(ready.items[0].projectId, 'recovered'); assert(calls > prior)
  assert(h.updates.some(snapshot => snapshot.requestId === 'query-1' && snapshot.phase === 'ready' && snapshot.total === 1))
})

test('123 explicit encyclopedia slash aliases rank before prefixes while preserving each real project', async t => {
  const h = await fixture(t, async input => {
    const url = new URL(String(input))
    if (url.hostname === 'search.mcmod.cn') return html(search([['1', '远方/旷野'], ['2', '旷野：附加']]))
    if (url.hostname === 'www.mcmod.cn') return html(entry(url.pathname.includes('/1.') ? '远方/旷野' : '旷野：附加', url.pathname.includes('/1.') ? 'wild' : 'wild-addon'))
    const keyword = url.searchParams.get('query'), hits = keyword === 'wild' ? [row('main', 'wild', 'Wild', 1)] : keyword === 'wild-addon' ? [row('addon', 'wild-addon', 'Wild Addon', 999)] : []
    return Response.json({ hits, total_hits: hits.length })
  })
  h.start(1, { ...query, keyword: '旷野', limit: 20 })
  const ready = await h.wait(snapshot => snapshot.phase === 'ready')
  assert.deepEqual(ready.items.map(item => item.projectId), ['main', 'addon'])
  assert.equal(ready.items[0].title, '远方/旷野 | Wild')
})

test('123 identical transport reads across distinct searches share one body and cancel by subscription', async () => {
  const a = new AbortController(), b = new AbortController(), c = new AbortController()
  let calls = 0, actualAborted = false, release!: (value: { count: number }) => void
  const transport = async (signal: AbortSignal) => { calls++; signal.addEventListener('abort', () => { actualAborted = true }, { once: true }); return new Promise<{ count: number }>(resolve => { release = resolve }) }
  const first = sharedCommunityRequest('fixture-cross-search', 'provider', a.signal, transport)
  const second = sharedCommunityRequest('fixture-cross-search', 'provider', b.signal, transport)
  const handled = first.catch(error => error.message)
  await tick(); assert.equal(calls, 1)
  a.abort(new Error('仅取消第一个')); assert.equal(await handled, '仅取消第一个'); assert.equal(actualAborted, false)
  release({ count: 3 }); const result = await second; assert.equal(result.count, 3)
  result.count = 9
  let retryCalls = 0
  const retry = await sharedCommunityRequest('fixture-cross-search', 'provider', c.signal, async () => { retryCalls++; return { count: 4 } })
  assert.equal(retryCalls, 1); assert.equal(retry.count, 4, 'completed results and failures are not retained by the pending transport dedup map')
})

test('123 all-source sorting and totals use the confirmed union and retain equal numeric IDs from different providers', async t => {
  const h = await fixture(t, async input => {
    const url = new URL(String(input)); if (url.hostname === 'search.mcmod.cn') return html(search([]))
    const mr = url.hostname === 'api.modrinth.com'
    return Response.json(mr ? { hits: [row('123', 'mr-cross', '跨源 Modrinth', 5)], total_hits: 1 }
      : { data: [{ id: 123, slug: 'cf-cross', name: '跨源 CurseForge', downloadCount: 99 }], pagination: { totalCount: 1 } })
  })
  h.start(1, { ...query, keyword: '跨源', source: 'all', sort: 'downloads', limit: 20 })
  const ready = await h.wait(snapshot => snapshot.phase === 'ready')
  assert.equal(ready.total, 2); assert.deepEqual(ready.items.map(item => item.source), ['curseforge', 'modrinth'])
  assert.deepEqual(ready.items.map(item => item.projectId), ['123', '123'])
})

test('123 the real ten-second batch deadline preserves fast results and leaves slow discovery retryable', { timeout: 15_000 }, async t => {
  const before = Date.now(), h = await fixture(t, async (input, init) => {
    if (String(input).includes('search.mcmod.cn')) return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    })
    return Response.json({ hits: [row('fast', 'fast', '期限测试快结果')], total_hits: 1 })
  })
  h.start(1, { ...query, keyword: '期限测试', limit: 20 })
  const quick = await h.wait(snapshot => snapshot.total === 1 && snapshot.phase === 'enriching')
  assert.equal(quick.items[0].projectId, 'fast'); assert(Date.now() - before < 3000)
  const ready = await h.wait(snapshot => snapshot.phase === 'ready', 11_500)
  assert(Date.now() - before >= 9900); assert(Date.now() - before < 12_000)
  assert.equal(ready.total, 1); assert(ready.discoveryHasMore); assert(ready.warnings!.some(warning => warning.includes('10 秒')))
})

test('123 enrichment preserves the readable prefix and commits whole-set order only when the batch is ready', async t => {
  let release!: (response: Response) => void
  const pending = new Promise<Response>(resolve => { release = resolve })
  const h = await fixture(t, async input => {
    const url = new URL(String(input)); if (url.hostname === 'search.mcmod.cn') return pending
    if (url.hostname === 'www.mcmod.cn') return html(entry('排序过程 A', 'sort-high'))
    const hits = url.searchParams.get('query') === '排序过程' ? [row('low', 'sort-low', '排序过程 Z', 1)] : [row('high', 'sort-high', 'High', 100)]
    return Response.json({ hits, total_hits: hits.length })
  })
  h.start(1, { ...query, keyword: '排序过程', limit: 20 })
  const first = await h.wait(snapshot => snapshot.phase === 'enriching' && snapshot.total === 1)
  assert.equal(first.items[0].projectId, 'low')
  release(html(search([['1', '排序过程 A']])))
  const partial = await h.wait(snapshot => snapshot.phase === 'enriching' && snapshot.total === 2)
  assert.deepEqual(partial.items.map(item => item.projectId), ['low', 'high'])
  const ready = await h.wait(snapshot => snapshot.phase === 'ready')
  assert.deepEqual(ready.items.map(item => item.projectId), ['high', 'low'])
})

test('123 supplementary Han characters are accepted by backend discovery and are not mistaken for an English subtitle', async t => {
  const keyword = '𠀀矿'
  assert.equal(parseMcmodSearch(search([['1', '𠀀矿研究 (Research)']]), keyword)[0].title, '𠀀矿研究')
  const h = await fixture(t, async input => {
    const url = new URL(String(input)); if (url.hostname === 'search.mcmod.cn') return html(search([]))
    assert.equal(url.searchParams.get('query'), keyword)
    return Response.json({ hits: [row('han', 'han', '𠀀矿研究')], total_hits: 1 })
  })
  h.start(1, { ...query, keyword })
  const ready = await h.wait(snapshot => snapshot.phase === 'ready')
  assert.equal(ready.items[0].projectId, 'han'); assert.equal(ready.query.keyword, keyword)
})
