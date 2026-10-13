import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import { build, transform } from 'esbuild'
import AdmZip from 'adm-zip'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createRequire } from 'node:module'
import { lookupMcmod, parseMcmodProjects, parseMcmodSearch } from '../src/main/core/mcmodSearch'
import { prepareModInstall, executeModPlan, discardModPlan } from '../src/main/core/modInstallPlan'
import { ProgressEventGuard } from '../src/main/core/progress'
import { versionInstallHarness } from './helpers/version-install-harness'
import type { CommunityFile, CommunityQuery, InstalledVersion, ProgressEvent } from '../src/shared/types'
import { matchingModProgress, modProgressPercent, modProgressBytes } from '../src/renderer/src/modInstallProgress'

const searchPage = (entries: Array<[string, string]>, nextPage = '') => `<div class="search-result-list">${entries.map(([id, title]) => `<div class="result-item"><div class="head"><a href="https://www.mcmod.cn/class/${id}.html">${title}</a></div><div class="body">正文中的名字不能关联</div><div class="foot"><a href="https://www.mcmod.cn/class/999.html">脚注</a></div></div>`).join('')}</div><div class="search-result-pages">${nextPage}</div>`
const related = (...urls: string[]) => `<ul class="common-link-icon-frame common-link-icon-frame-style-3">${urls.map(url => `<li><a href="${url}">相关链接</a></li>`).join('')}</ul>`
const html = (text: string) => new Response(text, { headers: { 'content-type': 'text/html; charset=utf-8' } })

test('MC百科 exact Chinese titles precede independently identified related add-ons; body, foot and off-site links cannot provide identities', () => {
  const page = searchPage([['21', '深海研究：附加 (Ocean Addon)'], ['22', '[OR] <em>深海研究</em> (Ocean Research)']])
  assert.deepEqual(parseMcmodSearch(page, '深海研究').map(item => [item.id, item.title]), [['22', '深海研究'], ['21', '深海研究：附加']])
  assert.deepEqual(parseMcmodSearch(searchPage([['30', '起源 (Origins (Fabric))'], ['31', '起源：附属 (Addon)']]), '起源').map(item => item.id), ['30', '31'])
  assert.throws(() => parseMcmodSearch('<html>验证访问者</html>', '深海研究'), /格式变化|受限/)
  assert.deepEqual(parseMcmodSearch('<div class="search-result-list"><div class="result-item"><div class="head"><a href="https://evil.invalid/class/22.html">深海研究</a></div></div></div>', '深海研究'), [])
})
test('MC百科 related project links require exact HTTPS provider host and mod route, and never follow a redirect', () => {
  const base64 = 'https://www.curseforge.com/minecraft/mc-mods/ocean-research'
  const page = related('//link.mcmod.cn/target/' + Buffer.from(base64).toString('base64'), 'https://modrinth.com/mod/ocean-research',
    'https://modrinth.com/mod/ocean-research', 'https://modrinth.com/modpack/ocean-pack', 'https://evil.invalid/mod/ocean-research',
    'https://modrinth.com.evil.invalid/mod/ocean-research', 'https://user@modrinth.com/mod/ocean-research',
    '//link.mcmod.cn/target/' + Buffer.from('file:///C:/secret').toString('base64')) + '<p><a href="https://modrinth.com/mod/dependency">正文中的前置</a></p>'
  assert.deepEqual(parseMcmodProjects(page), [{ source: 'curseforge', slug: 'ocean-research' }, { source: 'modrinth', slug: 'ocean-research' }])
})
test('MC百科 second page may contain the exact main project; no first-hit or fuzzy download association', async () => {
  const requests: string[] = []
  const result = await lookupMcmod('深海研究', async input => {
    const url = new URL(String(input)); requests.push(url.href)
    if (url.hostname === 'search.mcmod.cn') return html(url.searchParams.has('page')
      ? searchPage([['22', '深海研究 (Ocean Research)']]) : searchPage([['21', '深海研究：附加 (Ocean Addon)']], '<a data-page="2">2</a>'))
    assert(['/class/22.html', '/class/21.html'].includes(url.pathname))
    return html(related('https://modrinth.com/mod/' + (url.pathname === '/class/22.html' ? 'ocean-research' : 'ocean-addon')))
  })
  assert.equal(requests.length, 4)
  assert.deepEqual(result.entries.map(entry => [entry.id, entry.projects]), [['22', [{ source: 'modrinth', slug: 'ocean-research' }]], ['21', [{ source: 'modrinth', slug: 'ocean-addon' }]]])
})
test('MC百科 caps entry reads and concurrency, ignores unrecognized pages and oversized streams honestly', async () => {
  let active = 0, peak = 0, entries = 0
  const result = await lookupMcmod('研究组', async input => {
    if (new URL(String(input)).hostname === 'search.mcmod.cn') return html(searchPage(Array.from({ length: 9 }, (_, index) => [String(index), `研究组${index} (Study ${index})`] as [string, string])))
    entries++; active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 4)); active--
    return html(related('https://modrinth.com/mod/example-' + entries))
  })
  assert.equal(entries, 5); assert.equal(peak, 2)
  assert(result.warnings.some(warning => warning.includes('最多 5')))
  for (const fetcher of [async () => html('<html>challenge</html>'), async () => new Response('large', { headers: { 'content-type': 'text/html', 'content-length': String(3 * 1024 * 1024) } }), async () => html('x'.repeat(2 * 1024 * 1024 + 1))]) {
    const failed = await lookupMcmod('未知模组', fetcher)
    assert.equal(failed.entries.length, 0)
    assert(failed.warnings[0].includes('保留原中文关键词'))
  }
})
test('separate simultaneous MC百科 searches share a global two-request limit', async () => {
  let active = 0, peak = 0
  await Promise.all(['森林研究', '山地研究', '海洋研究', '冰原研究'].map(keyword => lookupMcmod(keyword, async input => {
    active++; peak = Math.max(active, peak)
    await new Promise(resolve => setTimeout(resolve, 3))
    active--
    const url = new URL(String(input))
    return html(url.hostname === 'search.mcmod.cn' ? searchPage([['25', `${keyword} (Research)`]]) : related('https://modrinth.com/mod/research'))
  })))
  assert.equal(peak, 2)
})
test('a newly arriving MC百科 request cannot steal the permit reserved for a queued request before its await resumes', async () => {
  const source = fs.readFileSync('src/main/core/mcmodSearch.ts', 'utf8')
  const block = source.slice(source.indexOf('let activeRequests = 0'), source.indexOf('\nfunction text('))
  const code = (await transform(block, { loader: 'ts', target: 'es2022' })).code
  const runtime = new Function(code + '\nreturn {requestSlot, active:()=>activeRequests, waiting:()=>requestWaiters.length}')() as { requestSlot(signal: AbortSignal): Promise<() => void>; active(): number; waiting(): number }
  const signal = new AbortController().signal
  const releaseFirst = await runtime.requestSlot(signal), releaseSecond = await runtime.requestSlot(signal)
  const queued = runtime.requestSlot(signal)
  assert.equal(runtime.active(), 2); assert.equal(runtime.waiting(), 1)
  // The queued promise has been resolved, but its continuation has not run.
  releaseFirst()
  let incomingResolved = false
  const arriving = runtime.requestSlot(signal).then(release => { incomingResolved = true; return release })
  assert.equal(runtime.active(), 2, 'release reserves the permit synchronously before resolving the old waiter')
  assert.equal(runtime.waiting(), 1, 'the newly arriving request must wait behind the reserved queued request')
  const releaseQueued = await queued
  assert.equal(incomingResolved, false); assert.equal(runtime.active(), 2)
  releaseSecond(); const releaseArriving = await arriving
  assert.equal(runtime.active(), 2); releaseQueued(); releaseArriving(); assert.equal(runtime.active(), 0)
})

test('the Electron MC百科 path actually uses session net.fetch, preserving deadline, redirect policy and no-provider credential headers', async () => {
  const code = (await build({ entryPoints: ['src/main/core/mcmodSearch.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'only-electron-transport-fixture', setup(build) {
    build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }))
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const net={fetch:(...args)=>globalThis.electronNetFetch(...args)}', loader: 'js' }))
  } }] })).outputFiles[0].text
  const calls: Array<{ url: string; init: RequestInit }> = [], module = { exports: {} as any }
  const netFetch = async (url: string, init: RequestInit) => { calls.push({ url, init }); return html(url.includes('search.mcmod.cn') ? searchPage([['13', '桌面代理研究 (Desktop Proxy)']]) : related('https://modrinth.com/mod/desktop-proxy')) }
  new Function('require', 'module', 'exports', 'process', 'fetch', 'globalThis', code)(
    () => { throw new Error('unexpected external dependency') }, module, module.exports, { versions: { electron: '44.3.0' } }, () => { throw new Error('native Node fetch must not be used on the desktop path') }, { electronNetFetch: netFetch })
  const result = await module.exports.lookupMcmod('桌面代理研究')
  assert.equal(result.entries[0].projects[0].slug, 'desktop-proxy'); assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.equal(call.init.redirect, 'error'); assert(call.init.signal instanceof AbortSignal)
    assert.equal((call.init.headers as Record<string, string>)['x-api-key'], undefined)
    assert.equal((call.init.headers as Record<string, string>).Authorization, undefined)
  }
})

const query: CommunityQuery = { keyword: '深海研究', source: 'modrinth', kind: 'mod', mcVersion: '1.20.1', loader: 'fabric', offset: 0, limit: 1 }
test('real community orchestration retains original Chinese hits and all filters, confirms the explicit linked provider slug, and paginates the union', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-mcmod117-')), requests: URL[] = []
  const runtime = await versionInstallHarness(root, async input => {
    const url = new URL(String(input)); requests.push(url)
    if (url.hostname === 'search.mcmod.cn') return html(searchPage([['22', '深海研究 (Ocean Research)']]))
    if (url.hostname === 'www.mcmod.cn') return html(related('https://modrinth.com/mod/ocean-research', 'https://www.curseforge.com/minecraft/mc-mods/ocean-research'))
    const kw = url.searchParams.get('query') ?? url.searchParams.get('searchFilter')
    const ids = kw === '深海研究' ? ['domestic'] : ['different-addon', 'ocean-research']
    return url.hostname.includes('curseforge') ? Response.json({ data: ids.map((id, index) => ({ id: 700 + index, slug: id, name: id })), pagination: { totalCount: ids.length } })
      : Response.json({ hits: ids.map(id => ({ project_id: id, slug: id, title: id })), total_hits: ids.length })
  })
  t.after(async () => { await runtime.closeHttpClient(); fs.rmSync(root, { recursive: true, force: true }) })
  for (const source of ['modrinth', 'curseforge'] as const) {
    const first = await runtime.communitySearchPage({ ...query, source }), second = await runtime.communitySearchPage({ ...query, source, offset: 1 })
    assert.equal(first.total, 2); assert.equal(second.items[0].slug, 'ocean-research')
    assert.equal(second.items[0].title, '深海研究 | ocean-research')
    assert(![...first.items, ...second.items].some(item => item.slug === 'different-addon'))
  }
  assert.equal(requests.filter(url => url.hostname === 'search.mcmod.cn').length, 1, 'source lookup is shared and successful metadata is cached')
  for (const url of requests.filter(url => url.pathname.endsWith('/search'))) {
    if (url.hostname.includes('curseforge')) {
      assert.equal(url.searchParams.get('gameVersion'), '1.20.1'); assert.equal(url.searchParams.get('modLoaderType'), '4'); assert.equal(url.searchParams.get('classId'), '6')
    } else {
      const facets: string[] = JSON.parse(url.searchParams.get('facets')!).flat()
      assert(facets.includes('versions:1.20.1') && facets.includes('categories:fabric') && facets.includes('project_type:mod'))
    }
  }
})
test('MC百科 failure is not cached as no compatible project, retry preserves original query and empty all-source failure is visible', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-mcmod-retry117-'))
  let encyclopediaCalls = 0, failing = true
  const runtime = await versionInstallHarness(root, async input => {
    const url = new URL(String(input))
    if (url.hostname === 'search.mcmod.cn') { encyclopediaCalls++; return failing ? new Response('', { status: 503 }) : html(searchPage([['28', '水中花园 (Aquatic Garden)']])) }
    if (url.hostname === 'www.mcmod.cn') return html(related('https://modrinth.com/mod/aquatic-garden'))
    const mr = url.hostname.includes('modrinth')
    const kw = url.searchParams.get('query') ?? url.searchParams.get('searchFilter')
    return mr ? Response.json({ hits: kw === 'aquatic-garden' ? [{ project_id: 'valid', slug: 'aquatic-garden', title: 'Garden' }] : [], total_hits: kw === 'aquatic-garden' ? 1 : 0 }) : Response.json({ data: [], pagination: { totalCount: 0 } })
  })
  t.after(async () => { await runtime.closeHttpClient(); fs.rmSync(root, { recursive: true, force: true }) })
  const fail = await runtime.communitySearchPage({ ...query, keyword: '水中花园', source: 'all' })
  assert.equal(fail.total, 0); assert(fail.warnings?.some(warning => warning.includes('暂不可用')))
  failing = false
  const recovered = await runtime.communitySearchPage({ ...query, keyword: '水中花园', source: 'all' })
  assert.equal(recovered.items[0].projectId, 'valid'); assert(encyclopediaCalls >= 2)
})

async function downloadFixture(t: any, unknown = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-mod-progress117-'))
  const jar = new AdmZip()
  jar.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'community_progress', version: '1.0.0', depends: { minecraft: '1.20.1', fabricloader: '>=0.15' } })))
  jar.addFile('large-test.bin', crypto.randomBytes(3 * 1024 * 1024))
  const bytes = jar.toBuffer()
  const server = http.createServer((_request, response) => {
    response.writeHead(200, unknown ? {} : { 'content-length': bytes.length })
    let index = 0
    const timer = setInterval(() => { const next = Math.min(bytes.length, index + 32 * 1024); response.write(bytes.subarray(index, next)); index = next; if (index === bytes.length) { clearInterval(timer); response.end() } }, 8)
    response.once('close', () => clearInterval(timer))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(root, { recursive: true, force: true }) })
  const file: CommunityFile = { source: 'modrinth', projectId: 'progress-project', fileId: 'progress-version', fileName: '模组 测试.jar', version: '1.0.0', url: `http://127.0.0.1:${(server.address() as any).port}/mod.jar`, sha1: crypto.createHash('sha1').update(bytes).digest('hex'), size: unknown ? 0 : bytes.length, gameVersions: ['1.20.1'], loaders: ['fabric'], date: '', releaseType: 'release' }
  const target: InstalledVersion = { id: 'progress-fixture', folder: root, gameDirectory: path.join(root, '游戏 实例'), isolated: true, mcVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.16.0' }
  const repo = { files: async () => [file], exact: async () => file, find: async () => undefined }
  return { root, file, target, repo }
}
for (const unknown of [false, true]) test(`community root pre-download has real byte progress (${unknown ? 'unknown size' : 'known size'}), remains a preparation until consent`, async t => {
  const fixture = await downloadFixture(t, unknown), events: ProgressEvent[] = []
  const plan = await prepareModInstall(fixture.target, { file: fixture.file }, event => events.push(event), undefined, fixture.repo)
  const transfer = events.filter(event => event.stage === 'download' && (event.bytesDone ?? 0) > 0 && (event.overall ?? 0) < 0.85)
  assert(transfer.length, 'actual partial durable byte events, not an invented percentage timer')
  if (unknown) assert(transfer.some(event => event.indeterminate && event.bytesTotal == null))
  else assert(transfer.some(event => !event.indeterminate && event.bytesTotal === fixture.file.size && event.progress > 0 && event.progress < 1))
  assert.equal(events.at(-1)?.stage, 'done'); assert.match(events.at(-1)!.text, /等待确认安装.*尚未写入实例/)
  assert(!fs.existsSync(fixture.target.gameDirectory!))
  const installEvents: ProgressEvent[] = []
  await executeModPlan(plan.id, true, () => fixture.target, event => installEvents.push(event))
  assert.equal(installEvents.at(-1)?.stage, 'done'); assert(installEvents.some(event => event.stage === 'mod-commit'))
  assert.deepEqual(fs.readdirSync(path.join(fixture.target.gameDirectory!, 'mods')), [fixture.file.fileName])
})
test('cancelled mod preparation discards only its temporary data and never publishes a completed plan', async t => {
  const fixture = await downloadFixture(t), controller = new AbortController(), events: ProgressEvent[] = []
  await assert.rejects(prepareModInstall(fixture.target, { file: fixture.file }, event => { events.push(event); if ((event.bytesDone ?? 0) > 0) controller.abort(new DOMException('cancel fixture', 'AbortError')) }, controller.signal, fixture.repo), /cancel fixture|取消/)
  assert(!events.some(event => event.stage === 'done')); assert(!fs.existsSync(fixture.target.gameDirectory!))
})
test('actual mods prepare/commit IPC routes every phase to one tagged download task and reports error/cancel without a success', async () => {
  const source = fs.readFileSync('src/main/ipc.ts', 'utf8')
  const block = source.slice(source.indexOf('  ipcMain.handle(IPC.modsPrepare,'), source.indexOf('  ipcMain.handle(IPC.modsInstall,'))
  const code = (await transform(block, { loader: 'ts', target: 'es2022' })).code
  const handlers = new Map<string, Function>(), events: any[] = [], finished: string[] = [], tasks: any[] = []
  let failure: Error | undefined
  const registerTask = (title: string) => { const record = { title, id: 'task-' + tasks.length, controller: new AbortController() }; tasks.push(record); return record }
  const input = { file: { fileName: 'fixture.jar' } }, target = { id: 'fixture', folder: 'fixture', gameDirectory: 'fixture/mods' }
  const prepare = async (_target: unknown, _input: unknown, emit: (e: ProgressEvent) => void) => { emit({ stage: 'download', progress: 0.25, bytesDone: 25, bytesTotal: 100, text: '真实回调夹具' }); if (failure) throw failure; emit({ stage: 'done', progress: 1, text: '等待确认安装（尚未写入实例）' }); return { id: 'plan' } }
  const commit = async (_id: string, _include: boolean, _target: unknown, emit: (e: ProgressEvent) => void) => { emit({ stage: 'mod-commit', progress: 0.95, text: '写入 MOD' }); if (failure) throw failure; return 'fixture-installed' }
  new Function('ipcMain', 'IPC', 'IPC_EVENT', 'modTargets', 'selectModTarget', 'registerTask', 'ProgressEventGuard', 'emit', 'send', 'community', 'prepareModInstall', 'discardModPlan', 'executeModPlan', 'launch', 'finishTask', 'errText', 'isCancelError', code)(
    { handle: (key: string, handler: Function) => handlers.set(key, handler) }, { modsPrepare: 'prepare', modsDiscard: 'discard', modsCommit: 'commit' }, { taskDone: 'done' }, () => ({ versions: [target] }), () => target,
    registerTask, ProgressEventGuard, (event: unknown) => events.push({ channel: 'progress', event }), (channel: string, event: unknown) => events.push({ channel, event }), { withCommunitySignal: (_signal: unknown, run: Function) => run() }, prepare, discardModPlan, commit, { getRunningVersionIds: () => new Set() }, (id: string) => finished.push(id), String, (error: Error) => error.name === 'AbortError')
  assert.deepEqual(await handlers.get('prepare')!({}, target, input, 'owned-operation'), { id: 'plan' })
  assert.equal(events[0].event.indeterminate, true)
  assert(events.filter(record => record.channel === 'progress').every(record => record.event.taskId === 'task-0'))
  assert(events.filter(record => record.channel === 'progress').every(record => record.event.operationId === 'owned-operation'))
  assert.match(events[0].event.taskTitle, /尚未安装/); assert.equal(events.at(-1).event.ok, true)
  events.length = 0; failure = new DOMException('cancelled', 'AbortError')
  await assert.rejects(handlers.get('prepare')!({}, target, input), /cancelled/)
  assert.equal(events[0].event.operationId, undefined, 'older API callers remain compatible without a correlation ID')
  assert.equal(events.at(-1).event.cancelled, true); assert.equal(events.at(-1).event.ok, false)
  events.length = 0; failure = new Error('hash failure')
  await assert.rejects(handlers.get('commit')!({}, 'plan', true, '<bad-operation>'), /hash failure/)
  assert.equal(events[0].event.operationId, undefined, 'invalid IDs cannot be reflected into progress events')
  assert.equal(events.at(-1).event.stage, 'mod-commit'); assert.equal(events.at(-1).event.ok, false)
  assert.equal(events.filter(record => record.channel === 'done' && record.event.ok).length, 0)
  assert.deepEqual(finished, ['task-0', 'task-1', 'task-2'])
})
test('MOD dialog progress filters unrelated and late replies, unknown totals omit percentages, and running 99.9% never appears as completed', () => {
  const event: ProgressEvent = { operationId: 'owned', stage: 'download', progress: 0.9999, text: 'test', bytesDone: 512 }
  assert.equal(matchingModProgress(event, 'different', true), undefined)
  assert.equal(matchingModProgress(event, 'owned', false), undefined)
  const matched = matchingModProgress(event, 'owned', true)!
  assert.notEqual(matched, event); assert.equal(modProgressPercent(matched), 99)
  assert.equal(modProgressPercent({ ...event, indeterminate: true }), undefined)
  assert.equal(modProgressPercent({ ...event, stage: 'done' }), 100)
  assert.equal(modProgressBytes(1536), '1.5 KB'); assert.equal(modProgressBytes(Infinity), '')
})
test('actual ModInstallDialog script subscribes by operation ID, cancels only its own real task, and releases the subscription when unmounted', async () => {
  const descriptor = parse(fs.readFileSync('src/renderer/src/components/ModInstallDialog.vue', 'utf8')).descriptor
  const script = compileScript(descriptor, { id: 'mod-progress-117-fixture' }).content
  const code = (await build({ stdin: { contents: script, loader: 'ts', resolveDir: path.resolve('src/renderer/src/components') }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'only-ui-hooks-and-ipc-fixture', setup(build) {
    build.onResolve({ filter: /^(vue|\.\.\/api|\.\.\/store)$|\.vue$/ }, args => ({ path: args.path, namespace: 'fixture' }))
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'vue'
      ? "export const computed=globalThis.vue.computed,ref=globalThis.vue.ref,defineComponent=globalThis.vue.defineComponent;export const onMounted=fn=>globalThis.fixture.mounted.push(fn),onUnmounted=fn=>globalThis.fixture.unmounted.push(fn)"
      : args.path === '../api' ? 'export const prepareModInstall=(...a)=>globalThis.fixture.prepare(...a),commitModInstall=(...a)=>globalThis.fixture.commit(...a),discardModInstall=(...a)=>globalThis.fixture.discard(...a),cancelTask=(...a)=>globalThis.fixture.cancel(...a),onProgress=fn=>{globalThis.fixture.progress=fn;return()=>globalThis.fixture.unsubscribe++},errText=String,formatSpeed=String'
      : args.path === '../store' ? 'export const store=globalThis.fixture.store;export const toast=()=>{}' : 'export default {}' }))
  } }] })).outputFiles[0].text
  const require = createRequire(path.resolve('package.json')), module = { exports: {} as any }
  let resolvePlan: (value: any) => void = () => {}
  const fixture: any = { mounted: [], unmounted: [], unsubscribe: 0, store: { fsRefreshTick: 0 }, args: [], cancelled: [], discarded: [], prepare: (...args: any[]) => { fixture.args = args; return new Promise(resolve => { resolvePlan = resolve }) }, commit: () => 'installed', discard: (id: string) => { fixture.discarded.push(id) }, cancel: (id: string) => { fixture.cancelled.push(id); return true } }
  new Function('require', 'module', 'exports', 'globalThis', code)(require, module, module.exports, { fixture, vue: require('vue') })
  const component = module.exports.default, target = { id: 'fixture', folder: 'fixture', mcVersion: '1.20.1', loader: 'fabric' }
  const state = component.setup({ target, input: { file: { fileName: 'fixture.jar' } } }, { expose: () => {}, emit: () => {} })
  fixture.mounted[0]()
  const operation = fixture.args[2]; assert.match(operation, /^[0-9a-f-]{36}$/)
  fixture.progress({ operationId: 'unrelated', taskId: 'another-task', stage: 'download', progress: .5, text: 'unrelated' })
  assert.equal(state.progress.value, undefined)
  fixture.progress({ operationId: operation, taskId: 'owned-task', stage: 'download', progress: .5, indeterminate: true, text: 'owned' })
  assert.equal(state.progress.value.text, 'owned'); assert.equal(state.progressPercent.value, undefined)
  await state.cancelDownload(); assert.deepEqual(fixture.cancelled, ['owned-task'])
  resolvePlan({ id: 'owned-plan', files: [], warnings: [], missing: [] })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.busy.value, false)
  fixture.unmounted[0]()
  assert.equal(fixture.unsubscribe, 1); assert.deepEqual(fixture.discarded, ['owned-plan'])
  fixture.progress({ operationId: operation, taskId: 'late-task', stage: 'download', progress: .9, text: 'late' })
  assert.equal(state.progress.value.taskId, 'owned-task', 'unmounted dialog never accepts a late callback')
})

test('compiled MOD dialog real Vue mount and unmount dispose the actual API progress subscription and component scope', async () => {
  const descriptor = parse(fs.readFileSync('src/renderer/src/components/ModInstallDialog.vue', 'utf8')).descriptor
  const script = compileScript(descriptor, { id: 'mod-progress-real-lifecycle117' }).content
  const code = (await build({ stdin: { contents: script, loader: 'ts', resolveDir: path.resolve('src/renderer/src/components') }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', alias: { '@shared': path.resolve('src/shared') }, logLevel: 'silent', plugins: [{ name: 'only-store-and-child-components', setup(build) {
    build.onResolve({ filter: /^\.\.\/store$|\.vue$/ }, args => ({ path: args.path, namespace: 'fixture' }))
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === '../store' ? 'export const store=globalThis.fixture.store;export const toast=()=>{}' : 'export default {}' }))
  } }] })).outputFiles[0].text
  const require = createRequire(path.resolve('package.json')), vue = require('vue'), module = { exports: {} as any }
  const listeners = new Set<Function>(), cancelled: string[] = [], discarded: string[] = []
  let resolvePlan: (plan: any) => void = () => {}, operation = '', offCount = 0
  const fixture: any = { store: { fsRefreshTick: 0 } }
  const window = { kamucl: {
    on(channel: string, callback: Function) { assert.equal(channel, 'event:progress'); listeners.add(callback); return () => { assert(listeners.delete(callback)); offCount++ } },
    invoke(channel: string, ...args: any[]) {
      if (channel === 'mods:prepare') { operation = args[2]; return new Promise(resolve => { resolvePlan = resolve }) }
      if (channel === 'tasks:cancel') { cancelled.push(args[0]); return Promise.resolve(true) }
      if (channel === 'mods:discard') { discarded.push(args[0]); return Promise.resolve(true) }
      throw Error('Unexpected fixture transport channel: ' + channel)
    }
  } }
  // The compiled component uses real Vue hooks and the unchanged renderer API.
  // Only the preload transport and renderer host are fixtures, with no manual
  // invocation of lifecycle callbacks and no production devtools dependence.
  new Function('require', 'module', 'exports', 'globalThis', 'window', code)(require, module, module.exports, { fixture }, window)
  const component = module.exports.default, setup = component.setup
  component.setup = (props: any, context: any) => { fixture.state = setup(props, context); return fixture.state }
  component.render = () => vue.h('div', 'lifecycle host')
  const makeNode = (text = ''): any => ({ text, children: [], parent: null })
  const renderer = vue.createRenderer({
    createElement: makeNode, createText: makeNode, createComment: makeNode,
    setText(node: any, text: string) { node.text = text }, setElementText(node: any, text: string) { node.text = text }, patchProp() {},
    parentNode: (node: any) => node.parent,
    nextSibling: (node: any) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
    insert(node: any, parent: any, anchor: any = null) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = parent; const at = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(at < 0 ? parent.children.length : at, 0, node) },
    remove(node: any) { node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null }
  })
  const host = makeNode(), app = renderer.createApp(component, { target: { id: 'fixture-lifecycle', folder: 'fixture', mcVersion: '1.20.1', loader: 'fabric' }, input: { file: { fileName: 'fixture.jar' } } })
  app.mount(host); await vue.nextTick()
  const instance = host._vnode.component, callback = [...listeners][0]
  assert.equal(instance.scope.active, true); assert.equal(listeners.size, 1); assert.match(operation, /^[0-9a-f-]{36}$/)
  callback({ operationId: operation, taskId: 'owned-lifecycle-task', stage: 'download', progress: .4, text: 'actual subscription' })
  assert.equal(fixture.state.progress.value.taskId, 'owned-lifecycle-task')
  await fixture.state.cancelDownload(); assert.deepEqual(cancelled, ['owned-lifecycle-task'])
  resolvePlan({ id: 'lifecycle-plan', files: [], warnings: [], missing: [] }); await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.state.busy.value, false)
  app.unmount(); await vue.nextTick()
  assert.equal(instance.isUnmounted, true); assert.equal(instance.scope.active, false)
  assert.equal(listeners.size, 0); assert.equal(offCount, 1); assert.deepEqual(discarded, ['lifecycle-plan'])
  callback({ operationId: operation, taskId: 'late-lifecycle-task', stage: 'download', progress: .9, text: 'late callback already queued before unsubscribe' })
  assert.equal(fixture.state.progress.value.taskId, 'owned-lifecycle-task')
})

test('actual compiled version combobox click reopens after Escape and scroll while focus remains, and resets a stale keyboard selection', async () => {
  const descriptor = parse(fs.readFileSync('src/renderer/src/components/CommunityVersionFilter.vue', 'utf8')).descriptor
  const script = compileScript(descriptor, { id: 'community-version-click117', inlineTemplate: true }).content
  const code = (await build({ stdin: { contents: script, loader: 'ts', resolveDir: path.resolve('src/renderer/src/components') }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' })).outputFiles[0].text
  const require = createRequire(path.resolve('package.json')), vue = require('vue'), module = { exports: {} as any }, hooks: Function[] = [], listeners = new Map<string, Set<Function>>(), emitted: any[] = []
  new Function('require', 'module', 'exports', 'innerWidth', 'innerHeight', 'addEventListener', 'removeEventListener', code)(
    (id: string) => id === 'vue' ? { ...vue, onBeforeUnmount: (fn: Function) => hooks.push(fn), withDirectives: (vnode: unknown) => vnode } : require(id), module, module.exports, 1280, 720,
    (type: string, fn: Function) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn) },
    (type: string, fn: Function) => listeners.get(type)?.delete(fn))
  const scope = vue.effectScope(), cache: any[] = []
  const render = scope.run(() => module.exports.default.setup({ modelValue: '1.20.1', versions: ['1.20.1', '1.21.1'] }, { expose: () => {}, emit: (...args: any[]) => emitted.push(args) }))
  const input = () => render({}, cache).children[0]
  const dom: any = { getBoundingClientRect: () => ({ left: 200, right: 500, top: 120, bottom: 160, width: 300 }), contains: (value: unknown) => value === dom, focus: () => {} }
  input().props.ref.value = dom
  const event = (key: string) => ({ key, preventDefault() {}, stopPropagation() {} })
  input().props.onFocus(); assert.equal(input().props['aria-expanded'], true)
  input().props.onKeydown(event('Escape')); assert.equal(input().props['aria-expanded'], false)
  assert.equal(typeof input().props.onClick, 'function', 'The compiled template must bind an actual pointer-click handler')
  input().props.onClick(); assert.equal(input().props['aria-expanded'], true, 'A click must reopen without requiring a second focus event')
  for (const fn of listeners.get('scroll') ?? []) fn({ target: {} })
  assert.equal(input().props['aria-expanded'], false)
  input().props.onClick(); assert.equal(input().props['aria-expanded'], true)
  input().props.onKeydown(event('Home')); assert.equal(input().props['aria-activedescendant'], 'community-version-option-0')
  input().props.onClick(); assert.equal(input().props['aria-activedescendant'], undefined)
  input().props.onKeydown(event('Enter')); assert.equal(input().props['aria-expanded'], false)
  assert.equal(emitted.findLast(args => args[0] === 'update:modelValue')[1], '1.20.1', 'Clicking returns Enter to the typed version rather than the stale all-versions keyboard row')
  input().props.onClick(); hooks.forEach(fn => fn()); assert.equal(input().props['aria-expanded'], false)
  assert([...listeners.values()].every(set => set.size === 0)); scope.stop()
})
