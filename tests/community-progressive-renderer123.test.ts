import test from 'node:test'
import assert from 'node:assert/strict'
import { createProgressiveCommunitySearch, usesProgressiveCommunitySearch, communityQueryKey, type ProgressiveCommunityPort, type ProgressiveCommunityState } from '../src/renderer/src/communityProgressiveSearch'
import { clearCommunitySession, readCommunitySession, saveCommunitySession } from '../src/renderer/src/communitySession'
import type { CommunityQuery, CommunityResult, CommunitySearchSnapshot } from '../src/shared/types'

const query: CommunityQuery = { keyword: '季节', kind: 'mod', source: 'all', mcVersion: '1.20.1', loader: 'forge', sort: 'relevance', offset: 0, limit: 20 }
const item = (id: string): CommunityResult => ({ source: 'modrinth', projectId: id, slug: id, title: id, author: '', description: '', iconUrl: '', downloads: 0, updatedAt: '', categories: [] })
function snapshot(requestId: string, revision: number, overrides: Partial<CommunitySearchSnapshot> = {}): CommunitySearchSnapshot {
  return { requestId, revision, query: { ...query }, items: [item('first')], total: 1, offset: 0, limit: 20,
    phase: 'ready', discoveryHasMore: false, cursor: 'cursor-' + revision, totalKind: 'confirmed', ...overrides }
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
function harness(overrides: Partial<ProgressiveCommunityPort> = {}) {
  const starts: Array<{ requestId: string; query: CommunityQuery; deferred: ReturnType<typeof Promise.withResolvers<CommunitySearchSnapshot>> }> = []
  const more: Array<{ requestId: string; continuation: { mode: string; cursor: string }; deferred: ReturnType<typeof Promise.withResolvers<CommunitySearchSnapshot>> }> = []
  const cancelled: string[] = [], states: ProgressiveCommunityState[] = [], subscriptions = new Set<(value: CommunitySearchSnapshot) => void>()
  let ids = 0
  const controller = createProgressiveCommunitySearch({ uuid: () => 'public-' + ++ids,
    start: (requestId, request) => { const deferred = Promise.withResolvers<CommunitySearchSnapshot>(); starts.push({ requestId, query: request, deferred }); return deferred.promise },
    continue: (requestId, continuation) => { const deferred = Promise.withResolvers<CommunitySearchSnapshot>(); more.push({ requestId, continuation, deferred }); return deferred.promise },
    cancel: async requestId => { cancelled.push(requestId); return true },
    subscribe: callback => { subscriptions.add(callback); return () => subscriptions.delete(callback) },
    changed: state => states.push(state), errorText: error => error instanceof Error ? error.message : String(error), ...overrides })
  return { controller, starts, more, cancelled, states, subscriptions, emit: (value: CommunitySearchSnapshot) => { for (const callback of subscriptions) callback(value) } }
}

test('123 progressive dispatch is limited to Chinese MOD names; matching freezes filters and visible limit', () => {
  assert(usesProgressiveCommunitySearch(query))
  assert(usesProgressiveCommunitySearch({ ...query, keyword: 'Serene 季节' }))
  for (const q of [{ ...query, keyword: 'sodium' }, { ...query, keyword: '123' }, { ...query, kind: 'modpack' as const }, { ...query, kind: 'resourcepack' as const }]) assert(!usesProgressiveCommunitySearch(q))
  assert.equal(communityQueryKey({ ...query, offset: 20 }), communityQueryKey(query), 'Snapshots represent a prefix, not a legacy offset page')
  for (const q of [{ ...query, mcVersion: '1.21.1' }, { ...query, loader: 'fabric' as const }, { ...query, sort: 'downloads' as const }, { ...query, source: 'modrinth' as const }, { ...query, limit: 40 }]) assert.notEqual(communityQueryKey(q), communityQueryKey(query))
})

test('123 current ID exists before synchronous subscription progress; late Start cannot overwrite its newer full prefix', async () => {
  let h: ReturnType<typeof harness>
  h = harness({ subscribe: callback => { const id = h.controller.current().requestId!; callback(snapshot(id, 2, { items: [item('first'), item('second')], total: 2, phase: 'enriching' })); h.subscriptions.add(callback); return () => h.subscriptions.delete(callback) } })
  const pending = h.controller.start(query)
  assert.equal(h.controller.current().requestId, h.starts[0].requestId)
  assert.equal(h.controller.current().revision, 2)
  assert.deepEqual(h.controller.current().snapshot!.items.map(value => value.projectId), ['first', 'second'])
  h.starts[0].deferred.resolve(snapshot(h.starts[0].requestId, 0, { items: [], total: 0, phase: 'initial' })); await pending
  assert.equal(h.controller.current().revision, 2); assert.equal(h.controller.current().pending, false)
  h.controller.dispose()
})

test('123 mismatched filters, foreign IDs, duplicate revisions and older events cannot replace current results', async () => {
  const h = harness(), pending = h.controller.start(query), id = h.starts[0].requestId
  h.emit(snapshot(id, 1))
  for (const bad of [snapshot('other', 10), snapshot(id, 10, { query: { ...query, mcVersion: '1.21.1' } }), snapshot(id, 10, { query: { ...query, limit: 40 } }), snapshot(id, 1, { items: [item('duplicate')] }), snapshot(id, 0, { items: [] })]) h.emit(bad)
  assert.equal(h.controller.current().revision, 1); assert.equal(h.controller.current().snapshot!.items[0].projectId, 'first')
  h.emit(snapshot(id, 2, { items: [item('second'), item('first')], total: 2 }))
  assert.deepEqual(h.controller.current().snapshot!.items.map(value => value.projectId), ['second', 'first'], 'Each snapshot replaces the complete prefix, rather than appending duplicates')
  h.starts[0].deferred.resolve(snapshot(id, 0)); await pending; h.controller.dispose()
})

test('123 replacing a query unsubscribes and cancels its old ID before late success or failure can reach the new results', async () => {
  const h = harness(), old = h.controller.start(query), oldCallback = [...h.subscriptions][0]
  const nextQuery = { ...query, keyword: '能源' }, current = h.controller.start(nextQuery), next = h.starts[1]
  assert.deepEqual(h.cancelled, [h.starts[0].requestId]); assert.equal(h.subscriptions.size, 1)
  oldCallback(snapshot(h.starts[0].requestId, 100, { error: 'old failure', phase: 'failed' }))
  h.starts[0].deferred.resolve(snapshot(h.starts[0].requestId, 101)); await old
  assert.equal(h.controller.current().requestId, next.requestId); assert.equal(h.controller.current().revision, -1)
  next.deferred.resolve(snapshot(next.requestId, 1, { query: nextQuery, items: [item('energy')] })); await current
  assert.equal(h.controller.current().snapshot!.items[0].projectId, 'energy'); assert.equal(h.controller.current().error, '')
  h.controller.dispose()
})

test('123 enrichment blocks paging; ready paging freezes one cursor and discovery accepts newer event ahead of its invoke return', async () => {
  const h = harness(), start = h.controller.start(query), id = h.starts[0].requestId
  h.emit(snapshot(id, 1, { phase: 'enriching', total: 3 }))
  assert.equal(await h.controller.more('page'), false); assert.equal(h.more.length, 0)
  h.starts[0].deferred.resolve(snapshot(id, 2, { total: 3, discoveryHasMore: true })); await start
  const page = h.controller.more('page'); assert.equal(await h.controller.more('page'), false)
  assert.deepEqual(h.more[0].continuation, { mode: 'page', cursor: 'cursor-2' })
  h.more[0].deferred.resolve(snapshot(id, 3, { items: [item('first'), item('second'), item('third')], total: 3, discoveryHasMore: true })); assert(await page)
  assert.equal(await h.controller.more('page'), false, 'No page request when the confirmed prefix is exhausted')
  const discovery = h.controller.more('discover')
  h.emit(snapshot(id, 5, { items: [item('third'), item('second'), item('first')], total: 3, discoveryHasMore: false }))
  h.more[1].deferred.resolve(snapshot(id, 4, { phase: 'enriching' })); assert(await discovery)
  assert.equal(h.controller.current().revision, 5); assert.equal(h.controller.current().pending, false)
  assert.equal(await h.controller.more('discover'), false); h.controller.dispose()
})

test('123 pause before first result and route disposal suppress late replies and remove every subscription', async () => {
  const h = harness(), pending = h.controller.start(query), callback = [...h.subscriptions][0], id = h.starts[0].requestId
  assert(await h.controller.pause()); assert.equal(h.controller.current().paused, true); assert.equal(h.subscriptions.size, 0)
  callback(snapshot(id, 100)); assert.equal(h.controller.current().snapshot, undefined)
  h.controller.dispose(); h.starts[0].deferred.resolve(snapshot(id, 101)); await pending
  assert.equal(h.controller.current().requestId, null); assert.equal(h.controller.current().snapshot, undefined)
})

test('123 return restores known prefix without an implicit request; resuming uses a new ID, never the old cursor', async () => {
  const h = harness(), retained = snapshot('previous-route', 7, { query: { ...query, limit: 40 }, items: [item('kept')], total: 7, phase: 'enriching', discoveryHasMore: true })
  h.controller.restore(retained)
  assert.equal(h.starts.length, 0); assert.equal(h.controller.current().paused, true); assert.equal(await h.controller.more('discover'), false)
  const resumed = h.controller.start({ ...query, limit: 40 }, retained)
  assert.notEqual(h.starts[0].requestId, retained.requestId); assert.equal(h.starts[0].query.limit, 40)
  assert.equal(h.controller.current().snapshot!.items[0].projectId, 'kept')
  h.starts[0].deferred.resolve(snapshot(h.starts[0].requestId, 1, { query: { ...query, limit: 40 }, items: [item('kept'), item('new')], total: 2 })); await resumed
  assert.deepEqual(h.controller.current().snapshot!.items.map(value => value.projectId), ['kept', 'new']); h.controller.dispose()
})

test('123 failed continuation retains known results and can retry with its current ID; request errors are not empty success', async () => {
  const h = harness(), first = h.controller.start(query), id = h.starts[0].requestId
  h.starts[0].deferred.resolve(snapshot(id, 1, { discoveryHasMore: true })); await first
  const failed = h.controller.more('discover'); h.more[0].deferred.reject(new Error('temporary failure')); assert.equal(await failed, false)
  assert.equal(h.controller.current().snapshot!.items[0].projectId, 'first'); assert.equal(h.controller.current().error, 'temporary failure')
  const retry = h.controller.more('discover'); h.more[1].deferred.resolve(snapshot(id, 1)); assert(await retry)
  assert.equal(h.controller.current().error, ''); h.controller.dispose()
  const failure = harness(), pending = failure.controller.start(query); failure.starts[0].deferred.reject(new Error('no source available')); await pending
  assert.equal(failure.controller.current().snapshot, undefined); assert.equal(failure.controller.current().error, 'no source available'); failure.controller.dispose()
})

test('123 a failed new Start cannot submit a retained old cursor, and exposes failure without an active pending state', async () => {
  const h = harness(), retained = snapshot('old-route', 7, { discoveryHasMore: true }), pending = h.controller.start(query, retained)
  h.starts[0].deferred.reject(new Error('Start channel failed')); assert.equal(await pending, undefined)
  assert.equal(h.controller.current().pending, false); assert.equal(h.controller.current().error, 'Start channel failed')
  assert.equal(await h.controller.more('discover'), false); assert.equal(h.more.length, 0)
  assert.equal(h.controller.current().snapshot!.items[0].projectId, 'first'); h.controller.dispose()
})

test('123 session history independently clones query, visible prefix, phase, cursor and remaining discovery', async () => {
  clearCommunitySession()
  const saved = { query, tab: 'browse' as const, favoriteSearch: '', versionInput: '1.20.1', results: [item('kept')], searched: true,
    error: '', offset: 1, hasMore: true, page: 1, total: 7, warnings: [], scrollTop: 456, topKeyword: '', interrupted: true,
    progressive: { snapshot: snapshot('route', 3, { phase: 'enriching', discoveryHasMore: true }), paused: true } }
  saveCommunitySession(saved)
  saved.results[0].title = 'outside mutation'; saved.progressive.snapshot.phase = 'failed'
  const restored = readCommunitySession()!
  assert.equal(restored.results[0].title, 'kept'); assert.equal(restored.progressive!.snapshot.phase, 'enriching')
  assert.equal(restored.scrollTop, 456); assert.equal(restored.progressive!.snapshot.cursor, 'cursor-3'); assert.equal(restored.progressive!.snapshot.discoveryHasMore, true)
  restored.query.keyword = 'mutated copy'; assert.equal(readCommunitySession()!.query.keyword, '季节'); clearCommunitySession()
  await tick()
})
