import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { reactive, ref } from 'vue'
import { chineseModSearchTerms } from '../src/main/core/community-zh'
import { lookupMcmod, mcmodNameRank, parseMcmodSearch } from '../src/main/core/mcmodSearch'
import { initialCommunityQuery, initialCommunityVersionSelection, chooseCommunityInstance } from '../src/renderer/src/communityVersionSelection'
import { versionInstallHarness } from './helpers/version-install-harness'
import type { CommunityQuery, InstalledVersion } from '../src/shared/types'
import { instanceKey } from '../src/shared/modCompatibility'

const target: InstalledVersion = { id: 'named-instance', folder: 'fixture/registered', mcVersion: '1.20.1', loader: 'fabric' }
const query: CommunityQuery = { keyword: '悠然一派', kind: 'mod', source: 'modrinth', mcVersion: '1.20.1', loader: 'forge', offset: 0, limit: 20 }
const html = (s: string) => new Response(s, { headers: { 'content-type': 'text/html; charset=utf-8' } })
const search = (rows: Array<[string, string]>) => `<div class="search-result-list">${rows.map(([id, name]) => `<div class="result-item"><div class="head"><a href="https://www.mcmod.cn/class/${id}.html">${name}</a></div><div class="body">描述中的关键词不能证明项目身份</div></div>`).join('')}</div><div class="search-result-pages"></div>`
const entry = (name: string, ...urls: string[]) => `<div class="class-title"><h3>${name}</h3><h4>English Name</h4></div><ul class="common-link-icon-frame">${urls.map(url => `<li><a href="${url}">来源项目</a></li>`).join('')}</ul>`
async function fixture(t: any, fetcher: typeof fetch) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-community120-')), runtime = await versionInstallHarness(root, fetcher)
  t.after(async () => { await runtime.closeHttpClient(); fs.rmSync(root, { recursive: true, force: true }) })
  return runtime
}

test('fresh community filters are unrestricted; legacy route snapshots retain exact manual conditions', () => {
  const first = initialCommunityQuery()
  assert.equal(first.mcVersion, ''); assert.equal(first.loader, '')
  const previous = { query: { ...query, keyword: '中文查询', mcVersion: '24w14potato', loader: 'quilt' as const } }
  const restored = initialCommunityQuery(previous)
  assert.equal(restored.mcVersion, '24w14potato'); assert.equal(restored.loader, 'quilt'); assert.equal(restored.keyword, '中文查询')
  assert.deepEqual(initialCommunityVersionSelection(previous), { source: 'custom', instance: '', loaderSource: 'manual' })
})

test('explicit installed selection uses precise Minecraft version, preserves independent loader choice and rejects unknown/unfinished instances', () => {
  const first = chooseCommunityInstance(target, initialCommunityVersionSelection(), '')!
  assert.equal(first.mcVersion, '1.20.1'); assert.equal(first.loader, 'fabric'); assert.equal(first.selection.loaderSource, 'instance')
  const manual = chooseCommunityInstance(target, { source: 'custom', instance: '', loaderSource: 'manual' }, 'forge')!
  assert.equal(manual.loader, 'forge'); assert.equal(manual.selection.loaderSource, 'manual')
  for (const v of [{ ...target, incomplete: true }, { ...target, failed: true }, { ...target, mcVersion: '未知' }]) assert.equal(chooseCommunityInstance(v, first.selection, 'fabric'), undefined)
  assert.equal(target.id, 'named-instance', 'filter selection never rewrites an installed instance')
})

test('official common names and previous launcher wording resolve to the same explicit source slug', () => {
  for (const [a, b, slug] of [['悠然一派', '大气', 'atmospheric'], ['秋原', '秋意', 'autumnity'], ['碧海新生', '升级水域', 'upgrade-aquatic'], ['末地拓展', '末地扩展', 'endergetic'], ['静谧季节', '静谧四季/季节', 'serene-seasons']]) {
    assert.deepEqual(chineseModSearchTerms(a), [slug]); assert.deepEqual(chineseModSearchTerms(b), [slug])
  }
  assert.deepEqual(chineseModSearchTerms('不存在的网络翻译结果'), [])
})

test('MC百科 explicit slash aliases outrank substrings; equal named entries remain separately identified', async () => {
  assert.equal(mcmodNameRank('静谧四季/季节 (Serene Seasons)', '季节'), 1)
  const page = search([['1', '季节：附加 (Addon)'], ['2', '静谧四季/季节 (Serene Seasons)'], ['3', '季节 (Another Season)']])
  assert.deepEqual(parseMcmodSearch(page, '季节').map(r => r.id), ['3', '2', '1'])
  const result = await lookupMcmod('山海之境', async input => {
    const url = new URL(String(input))
    return html(url.hostname === 'search.mcmod.cn' ? search([['71', '山海之境 (First)'], ['72', '山海之境 (Second)']]) : entry('山海之境', 'https://modrinth.com/mod/' + (url.pathname.includes('71') ? 'first-world' : 'second-world')))
  })
  assert.equal(result.entries.length, 2)
  assert.deepEqual(result.entries.flatMap(r => r.projects.map(p => p.slug)).sort(), ['first-world', 'second-world'])
})

test('changed MC百科 entry names cannot bind a stale search hit to unrelated project links', async () => {
  for (const changed of ['同名条目已更换', '山海之境：附加']) {
    const result = await lookupMcmod('山海之境', async input => html(String(input).includes('search.mcmod.cn') ? search([['71', '山海之境 (World)']]) : entry(changed, 'https://modrinth.com/mod/unrelated-project')))
    assert.deepEqual(result.entries, []); assert(result.warnings.some(w => w.includes('名称已变化')))
  }
})

test('single Chinese alias preserves domestic results, excludes similarly named addons, and keeps exact version/loader filters', async t => {
  const requests: URL[] = []
  const runtime = await fixture(t, async input => {
    const u = new URL(String(input)); requests.push(u)
    const k = u.searchParams.get('query'), hits = k === '悠然一派' ? [{ project_id: 'domestic', slug: 'domestic', title: '悠然一派中文项目' }]
      : [{ project_id: 'wrong-first', slug: 'atmospheric-addon', title: 'Atmospheric Addon' }, { project_id: 'correct', slug: 'atmospheric', title: 'Atmospheric' }]
    return Response.json({ hits, total_hits: hits.length })
  })
  const a = await runtime.communitySearchPage({ ...query, limit: 1 }), b = await runtime.communitySearchPage({ ...query, limit: 1, offset: 1 })
  assert.equal(a.total, 2); assert.deepEqual([...a.items, ...b.items].map(r => r.projectId), ['domestic', 'correct'])
  assert.equal(requests.length, 2, 'same catalog reused for the next page')
  for (const u of requests) { const facets = JSON.parse(u.searchParams.get('facets')!).flat(); assert(facets.includes('versions:1.20.1') && facets.includes('categories:forge') && facets.includes('project_type:mod')) }
})

test('failed alias lookup preserves original search and is retried instead of negative-cached', async t => {
  let fail = true, aliases = 0
  const runtime = await fixture(t, async input => {
    const k = new URL(String(input)).searchParams.get('query')
    if (k === 'autumnity') { aliases++; if (fail) return new Response('', { status: 503 }) }
    return Response.json({ hits: [{ project_id: k === '秋原' ? 'domestic' : 'official', slug: k === '秋原' ? 'native-autumn' : 'autumnity', title: String(k) }], total_hits: 1 })
  })
  const a = await runtime.communitySearchPage({ ...query, keyword: '秋原' })
  assert.deepEqual(a.items.map(r => r.projectId), ['domestic']); assert(a.warnings?.some(w => w.includes('查询失败')))
  fail = false
  const b = await runtime.communitySearchPage({ ...query, keyword: '秋原' })
  assert.deepEqual(b.items.map(r => r.projectId), ['domestic', 'official']); assert(aliases >= 2)
})

test('original Chinese service failure preserves verified alias success and remains uncached; all failed paths still fail', async t => {
  let failingOriginal = true, failingAlias = false, originals = 0
  const runtime = await fixture(t, async input => {
    const k = new URL(String(input)).searchParams.get('query')
    if (k === '钠') { originals++; if (failingOriginal) return new Response('', { status: 503 }) }
    if (k === 'sodium' && failingAlias) return new Response('', { status: 503 })
    return Response.json({ hits: [{ project_id: k === '钠' ? 'domestic' : 'official', slug: k === '钠' ? 'domestic-sodium' : 'sodium', title: String(k) }], total_hits: 1 })
  })
  const a = await runtime.communitySearchPage({ ...query, keyword: '钠' })
  assert.deepEqual(a.items.map(r => r.projectId), ['official']); assert(a.warnings?.some(w => w.includes('原中文关键词查询失败')))
  failingOriginal = false
  const b = await runtime.communitySearchPage({ ...query, keyword: '钠' })
  assert.deepEqual(b.items.map(r => r.projectId), ['domestic', 'official']); assert(originals >= 2)
  // A distinct query filter avoids the successful snapshot and probes real
  // failure behavior, without rewriting or clearing private product caches.
  failingOriginal = true; failingAlias = true
  await assert.rejects(runtime.communitySearchPage({ ...query, keyword: '钠', mcVersion: '1.21.1' }), /503/)
})

test('MC百科 explicit linked identity remains usable when the original Chinese provider query fails', async t => {
  const runtime = await fixture(t, async input => {
    const u = new URL(String(input))
    if (u.hostname === 'search.mcmod.cn') return html(search([['777', '山海之境 (World)']]))
    if (u.hostname === 'www.mcmod.cn') return html(entry('山海之境', 'https://modrinth.com/mod/world-of-mountains'))
    const k = u.searchParams.get('query')
    if (k === '山海之境') return new Response('', { status: 503 })
    return Response.json({ hits: [{ project_id: 'actual-linked', slug: 'world-of-mountains', title: 'Mountain World' }], total_hits: 1 })
  })
  const a = await runtime.communitySearchPage({ ...query, keyword: '山海之境' })
  assert.deepEqual(a.items.map(r => r.projectId), ['actual-linked']); assert(a.warnings?.some(w => w.includes('原中文关键词查询失败')))
})

test('all-source pagination retries a partial Chinese count after service recovery instead of caching failure or losing its warning', async t => {
  let recovered = false
  const requests: URL[] = []
  const runtime = await fixture(t, async input => {
    const url = new URL(String(input)); requests.push(url)
    if (!url.pathname.startsWith('/v2')) return new Response('synthetic source outage', { status: 503 })
    const keyword = url.searchParams.get('query')
    if (keyword === '钠' && !recovered) return new Response('synthetic original query outage', { status: 503 })
    const hits = keyword === '钠' ? [{ project_id: 'domestic', slug: 'domestic', title: '中文钠项目' }]
      : [{ project_id: 'sodium', slug: 'sodium', title: 'Sodium' }]
    return Response.json({ hits, total_hits: hits.length })
  })
  const q: CommunityQuery = { ...query, keyword: '钠', source: 'all', loader: 'fabric', limit: 1 }
  const first = await runtime.communitySearchPage(q)
  assert.equal(first.total, 1); assert.deepEqual(first.items.map(item => item.slug), ['sodium'])
  assert(first.warnings?.some(warning => warning.includes('原中文关键词查询失败')))
  recovered = true
  const index = requests.length, second = await runtime.communitySearchPage({ ...q, offset: 1 })
  assert.equal(second.total, 2); assert.deepEqual(second.items.map(item => item.slug), ['sodium'])
  assert(!second.warnings?.some(warning => warning.includes('原中文关键词查询失败')))
  assert(requests.slice(index).some(url => url.pathname.startsWith('/v2') && url.searchParams.get('query') === '钠'), 'Recovered Chinese metadata must be queried, rather than a cached partial count')
})

const isMrRequest = (url: URL) => url.hostname === 'api.modrinth.com' || url.pathname.includes('/modrinth/v2')
function providerRows(mr: boolean, total: number, offset: number, limit: number) {
  const rows = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => mr
    ? { project_id: 'mr' + (offset + i), slug: 'mr' + (offset + i), title: 'Synthetic MR ' + (offset + i) }
    : { id: 333 + offset + i, slug: 'cf' + (333 + offset + i), name: 'Synthetic CF ' + (offset + i) })
  return Response.json(mr ? { hits: rows, total_hits: total } : { data: rows, pagination: { totalCount: total } })
}

test('merged counts invalidate prior healthy data on refresh failure and recover every source without duplicate pagination', async t => {
  let outage = false
  const requests: URL[] = []
  const runtime = await fixture(t, async input => {
    const url = new URL(String(input)), mr = isMrRequest(url); requests.push(url)
    if (mr && outage) return new Response('synthetic primary and mirror outage', { status: 503 })
    return providerRows(mr, mr ? 2 : 1, Number(url.searchParams.get(mr ? 'offset' : 'index')), Number(url.searchParams.get(mr ? 'limit' : 'pageSize')))
  })
  const q: CommunityQuery = { keyword: 'generic-resource120', source: 'all', kind: 'mod', offset: 0, limit: 1 }
  assert.equal((await runtime.communitySearchPage(q)).total, 3)
  outage = true
  const refreshed = await runtime.communitySearchPage(q)
  assert.equal(refreshed.total, 1); assert.equal(refreshed.items[0].source, 'curseforge'); assert(refreshed.warnings?.some(w => w.includes('Modrinth 暂不可用')))
  const start = requests.length
  for (const offset of [1, 2]) {
    const page = await runtime.communitySearchPage({ ...q, offset })
    assert.equal(page.total, 1); assert.deepEqual(page.items, []); assert(page.warnings?.some(w => w.includes('Modrinth 暂不可用')))
  }
  assert(requests.slice(start).some(url => isMrRequest(url) && url.searchParams.get('offset') === '0'), 'Failure must remove the earlier healthy count, including mirror failure')
  outage = false
  const all: string[] = []
  // Recovery on a non-first page must also read the invalidated source count.
  assert.equal((await runtime.communitySearchPage({ ...q, offset: 1 })).total, 3)
  for (let offset = 0; offset < 3; offset++) {
    const page = await runtime.communitySearchPage({ ...q, offset })
    assert.equal(page.total, 3); assert.deepEqual(page.warnings, [])
    all.push(...page.items.map(item => item.source + ':' + item.projectId))
  }
  assert.deepEqual(all, ['modrinth:mr0', 'curseforge:333', 'modrinth:mr1']); assert.equal(new Set(all).size, 3)
})

test('a source failing after healthy counts preserves the other source, replans its exact range and invalidates the failed count', async t => {
  let outage = true
  const requests: URL[] = []
  const runtime = await fixture(t, async input => {
    const url = new URL(String(input)), mr = isMrRequest(url), offset = Number(url.searchParams.get(mr ? 'offset' : 'index')); requests.push(url)
    if (mr && outage && offset > 0) return new Response('synthetic data page outage', { status: 503 })
    return providerRows(mr, 8, offset, Number(url.searchParams.get(mr ? 'limit' : 'pageSize')))
  })
  const q: CommunityQuery = { keyword: 'data-page120', source: 'all', kind: 'mod', offset: 4, limit: 4 }
  const first = await runtime.communitySearchPage(q)
  assert.equal(first.total, 8); assert.deepEqual(first.items.map(item => item.projectId), ['337', '338', '339', '340'])
  assert(first.warnings?.some(w => w.includes('Modrinth 结果读取失败')))
  const cfOffsets = requests.filter(url => !isMrRequest(url)).map(url => url.searchParams.get('index'))
  assert.deepEqual(cfOffsets, ['0', '2', '4'], 'A successful old mixed range 2..3 cannot fill the replanned single-source range 4..7')
  const start = requests.length
  await runtime.communitySearchPage(q)
  assert(requests.slice(start).some(url => isMrRequest(url) && url.searchParams.get('offset') === '0'), 'A page failure must invalidate its observed healthy count')
  outage = false
  const recovered = await runtime.communitySearchPage(q)
  assert.equal(recovered.total, 16); assert.deepEqual(recovered.items.map(item => item.source + ':' + item.projectId), ['modrinth:mr2', 'curseforge:335', 'modrinth:mr3', 'curseforge:336'])
  assert.deepEqual(recovered.warnings, [])
})

test('concurrent count responses cannot revive invalidated healthy data or erase a newer successful refresh', async t => {
  for (const [oldFailure, newFailure] of [[false, true], [true, false], [false, false]]) {
    let first = true, oldMirrorFails = false
    let release!: (response: Response) => void, started!: () => void
    const pending = new Promise<Response>(resolve => { release = resolve }), observed = new Promise<void>(resolve => { started = resolve })
    const requests: URL[] = []
    const runtime = await fixture(t, async input => {
      const url = new URL(String(input)), mr = isMrRequest(url); requests.push(url)
      if (mr && first) { first = false; started(); return pending }
      if (mr && (newFailure || oldMirrorFails && url.pathname.includes('/modrinth/v2'))) return new Response('synthetic old/new provider failure', { status: 503 })
      return providerRows(mr, mr ? 3 : 1, Number(url.searchParams.get(mr ? 'offset' : 'index')), Number(url.searchParams.get(mr ? 'limit' : 'pageSize')))
    })
    const q: CommunityQuery = { keyword: 'concurrent120-' + oldFailure + '-' + newFailure, source: 'all', kind: 'mod', offset: 0, limit: 1 }
    const older = runtime.communitySearchPage(q)
    await observed
    try {
      const newer = await runtime.communitySearchPage(q)
      assert.equal(newer.total, newFailure ? 1 : 4)
      oldMirrorFails = oldFailure
      release(oldFailure ? new Response('synthetic delayed old failure', { status: 503 }) : providerRows(true, 2, 0, 1))
      await older
      const start = requests.length, next = await runtime.communitySearchPage({ ...q, offset: newFailure ? 1 : 3 })
      assert.equal(next.total, newFailure ? 1 : 4)
      assert.deepEqual(next.items.map(item => item.projectId), newFailure ? [] : ['mr2'])
      const countReads = requests.slice(start).filter(url => isMrRequest(url) && url.searchParams.get('offset') === '0')
      assert.equal(countReads.length > 0, newFailure, 'Late old success must not refill a failed cache; late old failure must not delete a newer healthy count')
      assert.equal(next.warnings?.some(w => w.includes('Modrinth 暂不可用')), newFailure)
    } finally { release(providerRows(true, 2, 0, 1)); await older.catch(() => undefined) }
  }
})

test('a delayed older data-page failure cannot invalidate a newer healthy count revision', async t => {
  let reads = 0, oldMirrorFails = false
  let release!: (response: Response) => void, started!: () => void
  const pending = new Promise<Response>(resolve => { release = resolve }), observed = new Promise<void>(resolve => { started = resolve })
  const requests: URL[] = []
  const runtime = await fixture(t, async input => {
    const url = new URL(String(input)), mr = isMrRequest(url); requests.push(url)
    if (mr && ++reads === 2) { started(); return pending }
    if (mr && oldMirrorFails && url.pathname.includes('/modrinth/v2')) return new Response('synthetic delayed old data failure', { status: 503 })
    return providerRows(mr, mr ? (reads === 1 ? 2 : 3) : 1, Number(url.searchParams.get(mr ? 'offset' : 'index')), Number(url.searchParams.get(mr ? 'limit' : 'pageSize')))
  })
  const q: CommunityQuery = { keyword: 'old-page-failure120', source: 'all', kind: 'mod', offset: 0, limit: 1 }
  const older = runtime.communitySearchPage(q)
  await observed
  try {
    assert.equal((await runtime.communitySearchPage(q)).total, 4)
    oldMirrorFails = true; release(new Response('synthetic older data-page failure', { status: 503 }))
    const previous = await older
    assert.equal(previous.total, 1); assert.equal(previous.items[0].source, 'curseforge'); assert(previous.warnings?.some(w => w.includes('Modrinth 结果读取失败')))
    const start = requests.length, newerPage = await runtime.communitySearchPage({ ...q, offset: 3 })
    assert.equal(newerPage.total, 4); assert.deepEqual(newerPage.items.map(item => item.projectId), ['mr2'])
    assert.deepEqual(newerPage.warnings, [])
    assert(!requests.slice(start).some(url => isMrRequest(url) && url.searchParams.get('offset') === '0'), 'An old failed page cannot delete the newer healthy cache')
  } finally { release(providerRows(true, 2, 0, 1)); await older.catch(() => undefined) }
})

test('both data sources failing after their counts succeeded remains an explicit failure', async t => {
  const seen = new Set<boolean>()
  const runtime = await fixture(t, async input => {
    const url = new URL(String(input)), mr = isMrRequest(url)
    if (seen.has(mr)) return new Response('synthetic data-page outage', { status: 503 })
    seen.add(mr)
    return providerRows(mr, mr ? 2 : 1, 0, 1)
  })
  await assert.rejects(runtime.communitySearchPage({ keyword: 'both-data-pages120', source: 'all', kind: 'mod', offset: 0, limit: 20 }), /503/)
})

test('known local alias with a different repository slug falls back to explicit MC百科 source identity, never a search first-hit', async t => {
  const runtime = await fixture(t, async input => {
    const u = new URL(String(input))
    if (u.hostname === 'search.mcmod.cn') return html(search([['260', '应用能源2 (Applied Energistics 2)']]))
    if (u.hostname === 'www.mcmod.cn') return html(entry('应用能源2', 'https://modrinth.com/mod/ae2'))
    const k = u.searchParams.get('query'), hits = k === 'ae2' ? [{ project_id: 'wrong', slug: 'ae2-addon', title: 'AE2 addon' }, { project_id: 'real', slug: 'ae2', title: 'Applied Energistics 2' }] : []
    return Response.json({ hits, total_hits: hits.length })
  })
  const a = await runtime.communitySearchPage({ ...query, keyword: '应用能源2' })
  assert.deepEqual(a.items.map(r => r.projectId), ['real']); assert(a.warnings?.some(w => w.includes('明确链接')))
})

/** Compile the actual product setup and mount it with real Vue lifecycle hooks.
 * Source metadata transport and DOM renderer host are synthetic; no GUI or live
 * service claim. Every transition below calls the compiled product handlers. */
async function mountedCommunity() {
  const descriptor = parse(fs.readFileSync('src/renderer/src/views/CommunityView.vue', 'utf8')).descriptor
  const script = compileScript(descriptor, { id: 'community-120-real-setup' }).content
  const requests: Array<{ query: any; requestId?: string; resolve: (v: any) => void; reject?: (e: Error) => void }> = [], fileRequests: any[] = [], downloads: any[] = [], state: any = {}
  const fixture = { state, store: reactive({ installed: [target], settings: { theme: 'black-orange', folders:[{path:'fixture/default-download',isDefault:true}],gameDir:'fixture/registered' }, searchKeyword: '' }), selected: ref(target), requests, fileRequests, downloads, subscriptions: new Set<(value: any) => void>(), progressiveSessions: new Map<string, any>(), cancelled: [] as string[], continuations: [] as any[], failNextContinue: false, sameNextContinue: false }
  const code = (await build({ stdin: { contents: script, loader: 'ts', resolveDir: path.resolve('src/renderer/src/views') }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'scoped-community-transport-and-child-host-fixtures', setup(b) {
    b.onResolve({ filter: /\.vue$/ }, () => ({ path: 'child-host', namespace: 'fixture' }))
    b.onResolve({ filter: /^\.\.?\/(api|store|modFavorites)$/ }, args => ({ path: args.path.split('/').at(-1)!, namespace: 'fixture' }))
    b.onResolve({ filter: /^@shared\// }, args => ({ path: path.resolve('src/shared', args.path.slice('@shared/'.length) + '.ts') }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'ts', contents: args.path === 'api' ? `const f=globalThis.fixture;
      export const communitySearch=q=>new Promise(resolve=>f.requests.push({query:{...q},resolve}));
      export const communitySearchStart=(requestId,q)=>new Promise((resolve,reject)=>f.requests.push({requestId,query:{...q},reject,resolve:value=>{
        const snapshot={...value,requestId,query:{...q},revision:1,phase:value.phase??'ready',discoveryHasMore:value.discoveryHasMore??false,totalKind:'confirmed',cursor:'fixture-ready-1'};
        f.progressiveSessions.set(requestId,snapshot); for(const callback of f.subscriptions)callback(snapshot); resolve(snapshot);
      }}));
      export const communitySearchContinue=(requestId,continuation)=>{f.continuations.push({requestId,continuation});const previous=f.progressiveSessions.get(requestId);if(!previous)return Promise.reject(new Error('Session expired'));
        if(f.failNextContinue){f.failNextContinue=false;return Promise.reject(new Error('Continuation failed'))} if(f.sameNextContinue){f.sameNextContinue=false;return Promise.resolve(previous)}
        const snapshot={...previous,revision:previous.revision+1,cursor:'fixture-next-'+(previous.revision+1)};f.progressiveSessions.set(requestId,snapshot);for(const callback of f.subscriptions)callback(snapshot);return Promise.resolve(snapshot)};
      export const communitySearchCancel=requestId=>{f.cancelled.push(requestId);return Promise.resolve(f.progressiveSessions.delete(requestId))};
      export const onCommunitySearchUpdate=callback=>{f.subscriptions.add(callback);return()=>f.subscriptions.delete(callback)};
      export const communityFiles=(...a)=>{f.fileRequests.push(a);return Promise.resolve([])}; export const getManifest=()=>Promise.resolve([{id:'1.21.1',type:'release'},{id:'1.20.1',type:'release'}]); export const getModTargets=()=>Promise.resolve({versions:f.store.installed,errors:[]}); export const errText=e=>String(e); export const communityDownload=(file,target)=>{f.downloads.push({file,target});return Promise.resolve('synthetic IPC result, no downloaded file')}; export const prepareModInstall=(target,input)=>Promise.resolve({id:'synthetic-plan',target,files:[{fileName:input.file.fileName,dependency:false}],missing:[],warnings:[]}); export const commitModInstall=()=>Promise.resolve('synthetic-commit'); export const discardModInstall=()=>Promise.resolve(); export const cancelTask=()=>Promise.resolve(); export const onProgress=()=>()=>{}; export const onTaskDone=()=>()=>{};`
      : args.path === 'store' ? `const f=globalThis.fixture; export const store=f.store,selectedInstance=f.selected;export const toast=()=>{};export const displayVersionName=v=>v.id;`
      : args.path === 'modFavorites' ? `export const favorites=[],favoriteBusy=new Set(); export const loadFavorites=async()=>{};export const toggleProject=()=>{};`
      : 'export default {}' }))
  } }] })).outputFiles[0].text
  const require = createRequire(path.resolve('package.json')), vue = require('vue'), module = { exports: {} as any }
  const content: any = { scrollTop: 0, getBoundingClientRect: () => ({ top: 0 }) }, document = { querySelector: (s: string) => s === '.content' ? content : null, activeElement: null, body: {} }
  class Observer { observe() {} disconnect() {} }
  new Function('require', 'module', 'exports', 'globalThis', 'document', 'ResizeObserver', 'IntersectionObserver', code)(require, module, module.exports, { fixture }, document, Observer, Observer)
  const component = module.exports.default, setup = component.setup
  component.setup = (props: any, context: any) => { fixture.state.current = setup(props, context); return fixture.state.current }
  component.render = () => vue.h('div', 'synthetic lifecycle host')
  const node = (text = ''): any => ({ text, children: [], parent: null })
  const renderer = vue.createRenderer({ createElement: node, createText: node, createComment: node, setText: (n: any, t: string) => n.text = t, setElementText: (n: any, t: string) => n.text = t, patchProp() {}, parentNode: (n: any) => n.parent, nextSibling: () => null,
    insert(n: any, p: any) { n.parent = p; p.children.push(n) }, remove(n: any) { n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = null } })
  const mount = async () => { const app = renderer.createApp(component); app.mount(node()); await vue.nextTick(); await new Promise(resolve => setImmediate(resolve)); return app }
  const resolveLast = async (title = 'Actual fixture response') => { const request = requests.at(-1)!; request.resolve({ items: [{ source: 'modrinth', projectId: title, slug: 'fixture', title, description: '', downloads: 0, author: '' }], total: 1, offset: 0, limit: 20 }); await new Promise(resolve => setImmediate(resolve)) }
  return { fixture, mount, resolveLast, requests, vue }
}

test('actual compiled community defaults to all, keeps exact explicit choices on route return, and does not select the launcher instance', async () => {
  const h = await mountedCommunity(), app = await h.mount(), s = h.fixture.state.current
  assert.equal(h.requests[0].query.mcVersion, undefined); assert.equal(h.requests[0].query.loader, undefined)
  await h.resolveLast(); s.useInstance(s.installedVersionOptions.value[0].value)
  assert.equal(h.requests.at(-1)!.query.mcVersion, '1.20.1'); assert.equal(h.requests.at(-1)!.query.loader, 'fabric')
  const selected = h.fixture.selected.value
  s.query.loader = 'forge'; s.loaderChanged(); s.useInstance(s.installedVersionOptions.value[0].value)
  assert.equal(s.query.loader, 'forge'); assert.equal(s.manualLoaderMismatch.value, true); assert.equal(h.fixture.selected.value, selected)
  s.chooseVersionSource('custom'); s.query.mcVersion = '24w14potato'; s.customVersionChanged(); s.query.keyword = '返回后保留'; s.onSearch(); await h.resolveLast('route-kept-result')
  const count = h.requests.length; app.unmount(); const returned = await h.mount(), restored = h.fixture.state.current
  assert.equal(restored.query.mcVersion, '24w14potato'); assert.equal(restored.query.loader, 'forge'); assert.equal(restored.query.keyword, '返回后保留')
  assert.equal(restored.versionSelection.source, 'custom'); assert.equal(restored.results.value[0].title, 'route-kept-result'); assert.equal(h.requests.length, count, 'route return retains results without implicitly searching again')
  restored.chooseVersionSource('all'); assert.equal(h.requests.at(-1)!.query.mcVersion, undefined); assert.equal(h.requests.at(-1)!.query.loader, 'forge', 'user independently selected loader is visibly retained')
  returned.unmount()
})

test('actual compiled community ignores old response after a new exact version query and after leaving the route', async () => {
  const h = await mountedCommunity(), app = await h.mount(), s = h.fixture.state.current, first = h.requests[0]
  s.chooseVersionSource('custom'); s.query.mcVersion = '26.3'; s.customVersionChanged(); const newer = h.requests.at(-1)!
  newer.resolve({ items: [], total: 0, offset: 0, limit: 20 }); await new Promise(resolve => setImmediate(resolve))
  first.resolve({ items: [{ title: 'stale old version' }], total: 1, offset: 0, limit: 20 }); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(s.results.value, []); assert.equal(s.query.mcVersion, '26.3')
  s.onSearch(); const late = h.requests.at(-1)!; app.unmount(); late.resolve({ items: [{ title: 'late after unmount' }], total: 1, offset: 0, limit: 20 }); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(s.results.value, [])
})

test('actual compiled Chinese search resumes with a new ID, keeps its known prefix across empty initial progress and ignores the cancelled operation', async () => {
  const h = await mountedCommunity(), app = await h.mount(), s = h.fixture.state.current
  await h.resolveLast()
  s.query.keyword = '季节'; s.onSearch(); await h.resolveLast('known-season')
  const old = h.requests.at(-1)!
  assert(old.requestId); assert.equal(s.progressiveMode.value, true)
  s.pauseDiscovery(); await h.vue.nextTick()
  assert.equal(s.progressivePaused.value, true); assert(h.fixture.cancelled.includes(old.requestId!))
  const resumed = s.continueDiscovery(), current = h.requests.at(-1)!
  assert(current.requestId && current.requestId !== old.requestId)
  const emit = (value: any) => { for (const callback of h.fixture.subscriptions) callback(value) }
  emit({ requestId: current.requestId, revision: 0, query: current.query, phase: 'initial', items: [], total: 0, offset: 0, limit: 20, totalKind: 'confirmed', discoveryHasMore: true })
  assert.equal(s.results.value[0].title, 'known-season', 'Empty new-session snapshot must not erase the known same-query prefix')
  emit({ requestId: old.requestId, revision: 100, query: old.query, phase: 'failed', items: [], total: 0, offset: 0, limit: 20, totalKind: 'confirmed', discoveryHasMore: false, error: 'cancelled old operation' })
  assert.equal(s.results.value[0].title, 'known-season'); assert.equal(s.loadError.value, '')
  await h.resolveLast('verified-season'); await resumed
  assert.equal(s.results.value[0].title, 'verified-season'); assert.equal(s.progressiveSnapshot.value.requestId, current.requestId)
  app.unmount(); assert.equal(h.fixture.subscriptions.size, 0)
})

test('actual compiled Chinese resume advances one cached discovery batch and clears a failed continuation on a repeated-revision response', async () => {
  const h = await mountedCommunity(), app = await h.mount(), s = h.fixture.state.current
  await h.resolveLast(); s.query.keyword = '季节'; s.onSearch()
  const page = { items: [{ source: 'modrinth', projectId: 'known-season', slug: 'known-season', title: 'known-season' }], total: 3, offset: 0, limit: 20, discoveryHasMore: true }
  h.requests.at(-1)!.resolve(page); await new Promise(resolve => setImmediate(resolve))
  s.pauseDiscovery(); const resumed = s.continueDiscovery(), current = h.requests.at(-1)!
  current.resolve(page); await resumed
  assert.equal(h.fixture.continuations.length, 1, 'One resume click must advance the ready cached discovery once')
  assert.equal(h.fixture.continuations[0].requestId, current.requestId); assert.equal(h.fixture.continuations[0].continuation.mode, 'discover')
  h.fixture.failNextContinue = true; await s.continueDiscovery()
  assert.equal(s.progressiveFailed.value, true); assert.match(s.loadError.value, /Continuation failed/)
  h.fixture.sameNextContinue = true; s.onLoadMore(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(s.progressiveFailed.value, false); assert.equal(s.loadError.value, '', 'A duplicate current snapshot must not leave the cleared controller error in the view')
  assert.equal(s.results.value[0].title, 'known-season'); app.unmount()
})

test('actual compiled Chinese Start rejection stops enrichment, preserves a visible retry path and recovers with a fresh request', async () => {
  const h = await mountedCommunity(), app = await h.mount(), s = h.fixture.state.current
  h.requests.at(-1)!.resolve({ items: [], total: 0, offset: 0, limit: 20 }); await new Promise(resolve => setImmediate(resolve))
  s.query.keyword = '季节'; s.onSearch(); const failed = h.requests.at(-1)!
  failed.reject!(new Error('Start channel failed')); await new Promise(resolve => setImmediate(resolve))
  assert.equal(s.progressiveFailed.value, true); assert.equal(s.progressiveEnriching.value, false); assert.equal(s.loading.value, false)
  assert.match(s.loadError.value, /Start channel failed/); assert.equal(s.progressiveSnapshot.value, undefined)
  const retry = s.continueDiscovery(), fresh = h.requests.at(-1)!
  assert(fresh.requestId && fresh.requestId !== failed.requestId)
  fresh.resolve({ items: [], total: 0, offset: 0, limit: 20 }); await retry
  assert.equal(s.progressiveFailed.value, false); assert.equal(s.progressiveEnriching.value, false); assert.equal(s.loadError.value, '')
  app.unmount()
})

test('actual compiled resource download keeps the exact folder for same-named targets and leaves launcher and browse selection unchanged', async () => {
  const h = await mountedCommunity(), app = await h.mount(), s = h.fixture.state.current
  await h.resolveLast()
  const second = { ...target, folder: 'fixture/other-registered-folder' }
  h.fixture.store.installed.push(second)
  s.allTargets.value = [...h.fixture.store.installed]
  const selected = h.fixture.selected.value, originalQuery = { ...s.query }
  const file = { source: 'modrinth', projectId: 'synthetic', fileId: 'resource-file', fileName: 'resource.zip', url: 'https://fixture.invalid/resource.zip', gameVersions: ['1.20.1'], loaders: [] }
  s.modal.open = true; s.modal.kind = 'resourcepack'; s.modal.files = [file]; s.modal.fileId = file.fileId
  s.modal.loadingFiles = false; s.modal.versionId = instanceKey(second)
  await h.vue.nextTick()
  assert.equal(s.canConfirm.value, true)
  await s.confirmDownload()
  assert.equal(h.fixture.downloads.length, 1)
  assert.deepEqual(h.fixture.downloads[0].target, { versionId: second.id, kind: 'resourcepack', folder: second.folder })
  assert.equal(h.fixture.selected.value, selected); assert.deepEqual({ ...s.query }, originalQuery)
  assert.equal(s.modal.open, false)
  app.unmount()
})

test('actual compiled MOD queue uses the exact selected instance without changing the launcher selection', async () => {
  const h = await mountedCommunity(), app = await h.mount(), s = h.fixture.state.current
  await h.resolveLast()
  const second = { ...target, folder: 'fixture/other-mod-folder' }
  const file = { source: 'modrinth', projectId: 'synthetic', fileId: 'mod-file', fileName: 'mod.jar', url: 'https://fixture.invalid/mod.jar', gameVersions: ['1.20.1'], loaders: ['fabric'] }
  s.allTargets.value = [target, second]; s.modal.open = true; s.modal.kind = 'mod'; s.modal.files = [file]; s.modal.fileId = file.fileId
  s.modal.loadingFiles = false; s.modal.versionId = instanceKey(second)
  await h.vue.nextTick()
  const selected = h.fixture.selected.value, originalQuery = { ...s.query }
  await s.confirmDownload()
  const queued = s.downloadQueue.items[0]
  assert.equal(queued.target.folder, second.folder); assert.equal(queued.target.id, second.id)
  assert.equal(h.fixture.selected.value, selected); assert.deepEqual({ ...s.query }, originalQuery)
  assert.equal(h.fixture.downloads.length, 0, 'MOD dependencies remain handled by the prepared transaction, only after explicit confirmation')
  assert.equal(s.modal.open, false, 'background preparation releases the browser immediately')
  app.unmount()
})

test('actual compiled pack queue freezes the accepted default, and stale incompatible target selections cannot be confirmed', async () => {
  const h = await mountedCommunity(), app = await h.mount(), s = h.fixture.state.current
  await h.resolveLast()
  const file = { source:'modrinth',projectId:'pack',fileId:'pack',fileName:'pack.mrpack',url:'https://fixture.invalid/pack',gameVersions:['1.21.1'],loaders:['fabric'] }
  s.allTargets.value = [target]; s.modal.open = true; s.modal.kind = 'modpack'; s.modal.files = [file]; s.modal.fileId = file.fileId
  s.modal.loadingFiles = false; s.modal.versionId = instanceKey(target)
  await s.confirmDownload()
  assert.deepEqual(h.fixture.downloads[0].target,{versionId:'',kind:'modpack',folder:'fixture/default-download'})
  s.modal.open = true; s.modal.kind = 'mod'; s.modal.fileId = file.fileId
  await h.vue.nextTick(); assert.equal(s.canConfirm.value,false,'a remembered 1.20.1 target cannot accept an incompatible 1.21.1 file')
  app.unmount()
})
