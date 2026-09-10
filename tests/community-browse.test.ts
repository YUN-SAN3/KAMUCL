import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { versionInstallHarness } from './helpers/version-install-harness'
import type { CommunityQuery, CommunityKind } from '../src/shared/types'

const query: CommunityQuery = { keyword: '', source: 'all', kind: 'resourcepack', mcVersion: '26.2', loader: 'fabric', offset: 0, limit: 20 }
async function fixture(t: any, totals = { modrinth: 45, curseforge: 7 }, failCf = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-browse-'))
  const urls: URL[] = []
  const runtime = await versionInstallHarness(root, async input => {
    const url = new URL(String(input)); urls.push(url)
    const mr = url.pathname.startsWith('/v2') || url.pathname.includes('/modrinth/')
    if (!mr && failCf) return new Response('', { status: 503 })
    const search = url.searchParams
    if (url.pathname.endsWith('/search')) {
      const total = mr ? totals.modrinth : totals.curseforge
      const offset = Number(search.get(mr ? 'offset' : 'index'))
      const limit = Number(search.get(mr ? 'limit' : 'pageSize'))
      const items = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, j) => mr
        ? { project_id: 'mr-' + (offset + j), title: 'MR ' + (offset + j) }
        : { id: offset + j, name: 'CF ' + (offset + j) })
      return Response.json(mr ? { hits: items, total_hits: total } : { data: items, pagination: { totalCount: total } })
    }
    // Deliberately return incompatible files too: final local filtering must reject them.
    const resourceLoader = JSON.parse(search.get('loaders') || '[]')[0]
    const files = [ ['fabric', '26.2'], ['forge', '26.2'], ['fabric', '1.20.1'], [resourceLoader === 'fabric' ? '' : resourceLoader || '', '26.2'] ].map(([loader, mc], i) => mr
      ? { id: String(i), game_versions: [mc], loaders: loader ? [loader] : [], files: [{ filename: i + '.zip', url: 'https://example.invalid/' + i }] }
      : { id: i, gameVersions: [mc, loader], fileName: i + '.zip', downloadUrl: 'https://example.invalid/' + i })
    return Response.json(mr ? files : { data: files, pagination: { totalCount: files.length } })
  })
  t.after(async () => { await runtime.closeHttpClient(); fs.rmSync(root, { recursive: true, force: true }) })
  return { runtime, urls }
}

test('community numbered pages cover uneven source totals without gaps or duplicates', async t => {
  for (const totals of [{ modrinth: 45, curseforge: 7 }, { modrinth: 3, curseforge: 44 }, { modrinth: 0, curseforge: 22 }, { modrinth: 0, curseforge: 0 }]) {
    const { runtime } = await fixture(t, totals)
    const all: string[] = []
    for (let offset = 0; offset <= totals.modrinth + totals.curseforge; offset += 20) {
      const page = await runtime.communitySearchPage({ ...query, offset })
      assert.equal(page.total, totals.modrinth + totals.curseforge)
      assert.equal(page.items.length, Math.max(0, Math.min(20, page.total - offset)))
      all.push(...page.items.map(i => i.source + ':' + i.projectId))
    }
    assert.equal(all.length, totals.modrinth + totals.curseforge)
    assert.equal(new Set(all).size, all.length)
    assert.deepEqual(all.filter(i => i.startsWith('modrinth')), Array.from({ length: totals.modrinth }, (_, i) => 'modrinth:mr-' + i))
    assert.deepEqual(all.filter(i => i.startsWith('curseforge')), Array.from({ length: totals.curseforge }, (_, i) => 'curseforge:' + i))
  }
})

test('all resource kinds retain version/source/sort filters; only mods and modpacks send loader', async t => {
  const { runtime, urls } = await fixture(t)
  for (const kind of ['mod', 'modpack', 'resourcepack', 'shader', 'datapack'] as CommunityKind[]) {
    for (const source of ['modrinth', 'curseforge'] as const) {
      await runtime.communitySearchPage({ ...query, kind, source, sort: 'downloads' })
      const params = urls.at(-1)!.searchParams
      const loader = kind === 'mod' || kind === 'modpack'
      if (source === 'modrinth') {
        const facets = JSON.parse(params.get('facets')!) as string[][]
        assert(facets.flat().includes('project_type:' + kind))
        assert(facets.flat().includes('versions:26.2'))
        assert.equal(facets.flat().includes('categories:fabric'), loader)
        assert.equal(params.get('index'), 'downloads')
      } else {
        assert.equal(params.get('classId'), String({ mod: 6, modpack: 4471, resourcepack: 12, shader: 6552, datapack: 6945 }[kind]))
        assert.equal(params.get('gameVersion'), '26.2')
        assert.equal(params.get('modLoaderType'), loader ? '4' : null)
        assert.equal(params.get('sortField'), '6')
      }
      const files = await runtime.communityFiles(source, 'fixture', { kind, mcVersion: '26.2', loader: 'fabric' })
      assert.deepEqual(files.map(f => f.fileId), loader ? ['0'] : source === 'modrinth' ? ['3'] : ['0', '1', '3'])
      const fileParams = urls.at(-1)!.searchParams
      if (source === 'curseforge') assert.equal(fileParams.has('modLoaderType'), loader)
      else assert.equal(JSON.parse(fileParams.get('loaders')!)[0], loader ? 'fabric' : { resourcepack: 'minecraft', shader: 'iris', datapack: 'datapack' }[kind])
    }
  }
})

test('Chinese mod aliases keep Fabric and Minecraft filters instead of injecting unfiltered projects', async t => {
  const { runtime, urls } = await fixture(t)
  await runtime.communitySearchPage({ ...query, keyword: '钠', kind: 'mod', source: 'modrinth' })
  assert.equal(urls.length, 1)
  assert.equal(urls[0].searchParams.get('query'), 'sodium')
  assert(JSON.parse(urls[0].searchParams.get('facets')!).flat().includes('categories:fabric'))
})

test('partial provider outage reports honest totals and an explicit warning', async t => {
  const { runtime } = await fixture(t, { modrinth: 25, curseforge: 80 }, true)
  const page = await runtime.communitySearchPage(query)
  assert.equal(page.total, 25)
  assert.equal(page.items.length, 20)
  assert(page.warnings?.[0].includes('CurseForge'))
})
