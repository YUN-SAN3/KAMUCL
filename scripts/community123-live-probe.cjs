// Actual application IPC only. No service credentials are extracted, no fixture
// handler is substituted, and no game/file-install transaction is submitted.
const assert = require('node:assert/strict'), crypto = require('node:crypto')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const digest = (bytes, algorithm = 'sha256') => crypto.createHash(algorithm).update(bytes).digest('hex')
const key = row => row.source + ':' + row.projectId
const TARGETS = [
  { family: 'base', source: 'curseforge', projectId: '233785', slug: 'avaritia' },
  { family: 'variant', source: 'curseforge', projectId: '624491', slug: 'avaritia-endless' },
  { family: 'rebirth', source: 'curseforge', projectId: '623969', slug: 're-avaritia' },
  { family: 'rebirth', source: 'modrinth', projectId: 'QeB3NRC5', slug: 're-avaritia' },
]
function targetFamily(row) {
  return TARGETS.find(target => row.source === target.source && String(row.projectId) === target.projectId && row.slug === target.slug)?.family
}
function families(rows) {
  return Object.fromEntries(['base', 'variant', 'rebirth'].map(family => [family, rows.some(row => targetFamily(row) === family)]))
}
function validateSnapshot(snapshot, requestId, source) {
  assert.equal(snapshot.requestId, requestId); assert.equal(snapshot.query.keyword, '无尽')
  assert.equal(snapshot.query.source, source); assert.equal(snapshot.query.kind, 'mod')
  assert(!snapshot.query.mcVersion && !snapshot.query.loader, 'Target search must remain unfiltered')
  assert.equal(snapshot.totalKind, 'confirmed'); assert(Number.isSafeInteger(snapshot.revision))
  assert.equal(new Set(snapshot.items.map(key)).size, snapshot.items.length)
  assert(snapshot.total >= snapshot.items.length)
  for (const row of snapshot.items) {
    assert(['modrinth', 'curseforge'].includes(row.source)); assert(String(row.projectId).length > 0)
    if (source !== 'all') assert.equal(row.source, source)
  }
  return snapshot
}
function publicFile(file) {
  let url
  try { const parsed = new URL(file.url); url = { protocol: parsed.protocol, host: parsed.hostname, pathnameSHA256: digest(parsed.pathname) } } catch { url = null }
  return { source: file.source, projectId: file.projectId, fileId: file.fileId, fileName: file.fileName, size: file.size, sha1: file.sha1 || null, gameVersions: file.gameVersions, loaders: file.loaders, url }
}
async function probe(inspector, receipt, save, { searchBudgetMs = 180000 } = {}) {
  const evalIPC = (channel, ...args) => inspector.evaluate(`window.kamucl.invoke(${[channel, ...args].map(value => JSON.stringify(value)).join(',')})`)
  const ids = []
  await inspector.evaluate(`globalThis.__community123Live={events:[],off:window.kamucl.on('event:communitySearchUpdate',value=>{if(globalThis.__community123Live.events.length<3000)globalThis.__community123Live.events.push(value)})}`)
  receipt.live = { classification: 'Actual original application IPC and production progressive backend against live services; unfiltered user target 无尽. File metadata does not prove game installation or full authentication.', searches: [], projects: [], downloads: [] }; save()
  try {
    for (const source of ['modrinth', 'curseforge', 'all']) {
      const requestId = 'native123-' + source + '-' + crypto.randomUUID(); ids.push(requestId)
      const row = { source, requestId, query: { keyword: '无尽', kind: 'mod', source, mcVersion: '', loader: '', sort: 'relevance', offset: 0, limit: 100 }, startedAt: new Date().toISOString(), snapshots: [], continuations: [] }
      receipt.live.searches.push(row); save()
      let snapshot = validateSnapshot(await evalIPC('community:searchStart', requestId, row.query), requestId, source), deadline = Date.now() + searchBudgetMs
      const record = value => { validateSnapshot(value, requestId, source); if (!row.snapshots.some(previous => previous.revision === value.revision)) row.snapshots.push(value); save() }
      record(snapshot)
      for (;;) {
        const updates = await inspector.evaluate(`globalThis.__community123Live.events.filter(value=>value.requestId===${JSON.stringify(requestId)})`)
        for (const update of updates.sort((a, b) => a.revision - b.revision)) { record(update); if (update.revision > snapshot.revision) snapshot = update }
        if (snapshot.phase === 'failed') throw Error('Live ' + source + ' progressive search failed; raw public search error remains in receipt')
        assert(Date.now() < deadline, 'Live ' + source + ' search budget exhausted before target coverage or real exhaustion')
        if (snapshot.phase !== 'ready') { await wait(200); continue }
        if (snapshot.total > snapshot.items.length) {
          const continuation = { mode: 'page', cursor: snapshot.cursor }; row.continuations.push(continuation); save()
          snapshot = validateSnapshot(await evalIPC('community:searchContinue', requestId, continuation), requestId, source); record(snapshot); continue
        }
        const seen = families(snapshot.items)
        const covered = source === 'modrinth' ? seen.rebirth : seen.base && seen.variant && seen.rebirth
        if (covered || !snapshot.discoveryHasMore) { row.final = snapshot; row.families = seen; row.actualExhaustion = !snapshot.discoveryHasMore; row.targetCovered = covered; save(); break }
        assert(row.continuations.filter(item => item.mode === 'discover').length < 30, 'Target family not covered within 30 real discovery batches')
        const continuation = { mode: 'discover', cursor: snapshot.cursor }; row.continuations.push(continuation); save()
        snapshot = validateSnapshot(await evalIPC('community:searchContinue', requestId, continuation), requestId, source); record(snapshot)
      }
      if (source !== 'modrinth') assert(row.targetCovered, 'Real ' + source + ' search exhausted without required base/rebirth/variant identities')
      else assert(row.targetCovered, 'Real Modrinth search lacks required independently identified rebirth project')
      const selected = row.final.items.filter(item => targetFamily(item))
      for (const item of selected) {
        if (receipt.live.projects.some(project => project.key === key(item))) continue
        const detail = await evalIPC('community:project', item.source, String(item.projectId), 'mod')
        assert.equal(detail.source, item.source); assert.equal(String(detail.projectId), String(item.projectId)); assert.equal(detail.kind, 'mod'); if (detail.slug) assert.equal(detail.slug, item.slug)
        const files = await evalIPC('community:files', item.source, String(item.projectId), { kind: 'mod' })
        assert(Array.isArray(files) && files.length > 0, 'Target identity must provide actual source files')
        for (const file of files) { assert.equal(file.source, item.source); assert.equal(String(file.projectId), String(item.projectId)); assert(file.fileId && file.fileName) }
        assert(files.some(file => /^[a-f0-9]{40}$/i.test(file.sha1 || '')), 'At least one target file must carry a reliable download hash')
        receipt.live.projects.push({ key: key(item), search: item, detail, files: files.map(publicFile), downloaded: false }); save()
      }
    }
    // Small supplemental byte/hash check. It does not replace the 无尽 identity
    // checks and never calls the installation or game's download IPC.
    const supplemental = await evalIPC('community:search', { keyword: 'appleskin', kind: 'mod', source: 'modrinth', mcVersion: '', loader: '', sort: 'relevance', offset: 0, limit: 20 })
    const apple = supplemental.items.find(item => item.slug === 'appleskin'); assert(apple, 'Live supplemental source did not return exact AppleSkin project')
    const files = await evalIPC('community:files', 'modrinth', String(apple.projectId), { kind: 'mod' })
    const file = files.find(item => item.size > 0 && item.size <= 2 * 1024 * 1024 && /^[a-f0-9]{40}$/i.test(item.sha1 || '') && new URL(item.url).hostname === 'cdn.modrinth.com')
    assert(file, 'No reliable small supplemental download was available')
    let dispatcher
    if (process.env.KAMUCL_QA_PROXY) { const proxy = new URL(process.env.KAMUCL_QA_PROXY); assert(['http:', 'https:'].includes(proxy.protocol)); assert(['127.0.0.1', 'localhost', '[::1]'].includes(proxy.hostname)); const { ProxyAgent } = require('undici'); dispatcher = new ProxyAgent(proxy.href) }
    try {
      const response = await fetch(file.url, { signal: AbortSignal.timeout(60000), redirect: 'error', ...(dispatcher ? { dispatcher } : {}) }); assert.equal(response.status, 200)
      const hasher = crypto.createHash('sha1'), sha256 = crypto.createHash('sha256'); let bytes = 0
      for await (const chunk of response.body) { bytes += chunk.length; assert(bytes <= 2 * 1024 * 1024); hasher.update(chunk); sha256.update(chunk) }
      const actualSHA1 = hasher.digest('hex'); assert.equal(bytes, file.size); assert.equal(actualSHA1, file.sha1.toLowerCase())
      receipt.live.downloads.push({ classification: 'Independent full network-byte SHA1/SHA256 check of production-IPC metadata, not product installer or game launch', project: apple, file: publicFile(file), bytes, sha1: actualSHA1, sha256: sha256.digest('hex') }); receipt.live.complete = true; save()
    } finally { await dispatcher?.close() }
  } finally {
    for (const requestId of ids) { try { await evalIPC('community:searchCancel', requestId) } catch { receipt.live.cancelFailure = true } }
    try { await inspector.evaluate('globalThis.__community123Live.off();delete globalThis.__community123Live') } catch { receipt.live.unsubscribeFailure = true }
    save()
  }
}
module.exports = { probe, families, targetFamily, TARGETS, validateSnapshot, publicFile }
