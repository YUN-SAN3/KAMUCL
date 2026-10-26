import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import AdmZip from 'adm-zip'
import { reactive } from 'vue'
import { chineseModSearchTerms } from '../src/main/core/community-zh'
import { readCommunitySession, saveCommunitySession, clearCommunitySession, type CommunitySession } from '../src/renderer/src/communitySession'
import { versionInstallHarness } from './helpers/version-install-harness'
import { prepareModInstall, executeModPlan } from '../src/main/core/modInstallPlan'
import type { CommunityFile, CommunityQuery, InstalledVersion } from '../src/shared/types'

test('community session retains full filters, loaded pages and scroll; snapshots do not retain reactive proxies', () => {
  const value = reactive<CommunitySession>({ query: { keyword: '机械动力', kind: 'mod', source: 'curseforge', mcVersion: '1.20.1', loader: 'forge', sort: 'downloads' }, tab: 'browse', favoriteSearch: '玉', versionInput: '1.20.1', results: [{ source: 'curseforge', projectId: '1', slug: 'create', title: '机械动力', description: '', downloads: 1, iconUrl: '', author: '' }], searched: true, error: '', offset: 60, hasMore: true, page: 3, total: 82, warnings: ['查询别名'], scrollTop: 634, topKeyword: '', interrupted: false })
  clearCommunitySession(); saveCommunitySession(value)
  value.query.keyword = '其他'; value.results[0].title = '其他'
  const first = readCommunitySession()!
  assert.equal(first.query.keyword, '机械动力'); assert.equal(first.results[0].title, '机械动力')
  assert.equal(first.page, 3); assert.equal(first.offset, 60); assert.equal(first.scrollTop, 634)
  first.results.length = 0
  assert.equal(readCommunitySession()!.results.length, 1)
  clearCommunitySession(); assert.equal(readCommunitySession(), undefined)
})

test('Chinese exact names, common aliases and typed suffixes do not choose an unrelated longer name', () => {
  assert.deepEqual(chineseModSearchTerms('钠'), ['sodium'])
  assert.deepEqual(chineseModSearchTerms(' 钠 模组 '), ['sodium'])
  assert.deepEqual(chineseModSearchTerms('玉'), ['jade'])
  assert.deepEqual(chineseModSearchTerms('物品管理器'), ['jei', 'rei', 'emi'])
  assert.deepEqual(chineseModSearchTerms('万用皮肤'), ['customskinloader'])
  assert.deepEqual(chineseModSearchTerms('国内未登记新模组'), [])
})

const query: CommunityQuery = { keyword: '物品管理器', source: 'modrinth', kind: 'mod', mcVersion: '1.20.1', loader: 'fabric', sort: 'relevance', offset: 0, limit: 2 }
async function searchFixture(t: any, fetcher: typeof fetch) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-community116-'))
  const runtime = await versionInstallHarness(root, fetcher)
  t.after(async () => { await runtime.closeHttpClient(); fs.rmSync(root, { recursive: true, force: true }) })
  return runtime
}
test('Chinese multiple aliases merge original domestic-name results, keep every filter and paginate a stable deduplicated union', async t => {
  const urls: URL[] = []
  const runtime = await searchFixture(t, async input => {
    const url = new URL(String(input)); urls.push(url)
    const kw = url.searchParams.get('query')!
    const ids = ({ '物品管理器': ['domestic'], jei: ['shared', 'jei'], rei: ['shared', 'rei'], emi: ['emi'] } as Record<string, string[]>)[kw] ?? []
    return Response.json({ hits: ids.map(id => ({ project_id: id, slug: id, title: id })), total_hits: ids.length })
  })
  const a = await runtime.communitySearchPage(query), b = await runtime.communitySearchPage({ ...query, offset: 2 }), c = await runtime.communitySearchPage({ ...query, offset: 4 })
  assert.equal(a.total, 4)
  // The old expectation included "shared", an unrelated slug returned by an
  // alias search. An alias query is not proof of that project's identity.
  assert.deepEqual([...a.items, ...b.items, ...c.items].map(item => item.projectId), ['domestic', 'jei', 'rei', 'emi'])
  assert.equal(urls.length, 4, 'later pages slice the same catalog')
  for (const url of urls) {
    const facets: string[] = JSON.parse(url.searchParams.get('facets')!).flat()
    assert(facets.includes('versions:1.20.1') && facets.includes('categories:fabric') && facets.includes('project_type:mod'))
  }
})
test('an alias with no results retries the original Chinese name rather than hiding domestic projects', async t => {
  const terms: string[] = []
  const runtime = await searchFixture(t, async input => {
    const kw = new URL(String(input)).searchParams.get('query')!; terms.push(kw)
    return Response.json({ hits: kw === '万用皮肤' ? [{ project_id: 'native', title: '万用皮肤' }] : [], total_hits: kw === '万用皮肤' ? 1 : 0 })
  })
  const result = await runtime.communitySearchPage({ ...query, keyword: '万用皮肤' })
  assert.equal(result.items[0].projectId, 'native'); assert.deepEqual(terms, ['万用皮肤', 'customskinloader'])
})
test('broad Chinese alias unions disclose the retrieval cap instead of claiming complete provider totals', async t => {
  const runtime = await searchFixture(t, async input => {
    const p = new URL(String(input)).searchParams, keyword = p.get('query'), offset = Number(p.get('offset')), count = Number(p.get('limit'))
    return Response.json({ hits: Array.from({ length: count }, (_, i) => ({ project_id: `${keyword}-${offset + i}`, title: 'fixture' })), total_hits: 170 })
  })
  const result = await runtime.communitySearchPage(query)
  // Only the original Chinese query may contribute broad hits; synthetic
  // alias results have no verified matching slug and cannot inflate totals.
  assert.equal(result.total, 100)
  assert(result.warnings?.some(message => message.includes('前 100 项')))
})

test('dependency opt-out is checked by the real transaction; no missing dependency or root is silently installed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-dependency116-'))
  const jar = (id: string, depends = {}) => { const z = new AdmZip(); z.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id, version: '1.0.0', depends: { minecraft: '1.20.1', fabricloader: '>=0.15', ...depends } }))); return z.toBuffer() }
  const bytes = jar('library'), source = path.join(root, 'root.jar'); fs.writeFileSync(source, jar('root', { library: '*' }))
  let downloads = 0
  const server = http.createServer((_req, response) => { downloads++; response.writeHead(200, { 'content-length': bytes.length }); response.end(bytes) })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const file: CommunityFile = { source: 'modrinth', projectId: 'verified-library', fileId: 'verified-version', fileName: 'library.jar', version: '1.0.0', url: `http://127.0.0.1:${(server.address() as any).port}/library.jar`, sha1: crypto.createHash('sha1').update(bytes).digest('hex'), size: bytes.length, gameVersions: ['1.20.1'], loaders: ['fabric'], date: '', releaseType: 'release' }
  const target: InstalledVersion = { id: 'fixture', folder: root, gameDirectory: path.join(root, 'isolated'), isolated: true, mcVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.16.0' }
  const repo = { files: async () => [file], exact: async () => file, find: async () => file }
  try {
    const plan = await prepareModInstall(target, { paths: [source] }, () => {}, undefined, repo)
    assert.equal(plan.files.find(f => f.dependency)?.source, 'modrinth')
    assert.equal(plan.files.find(f => f.dependency)?.projectId, 'verified-library')
    await assert.rejects(executeModPlan(plan.id, false, () => target, () => {}), /未写入任何 MOD.*library/)
    assert.equal(downloads, 0); assert(!fs.existsSync(target.gameDirectory!))
    await assert.rejects(prepareModInstall(target, { paths: [source] }, () => {}, undefined, { ...repo, find: async () => { throw new Error('项目查询失败') } }), /项目查询失败/)
    assert(!fs.existsSync(target.gameDirectory!))
    const retry = await prepareModInstall(target, { paths: [source] }, () => {}, undefined, repo)
    await executeModPlan(retry.id, true, () => target, () => {})
    assert.equal(downloads, 1)
    assert.deepEqual(fs.readdirSync(path.join(target.gameDirectory!, 'mods')).sort(), ['library.jar', 'root.jar'])
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(root, { recursive: true, force: true }) }
})
