import type { CommunityQuery, CommunitySearchContinuation, CommunitySearchSnapshot } from '@shared/types'

/** Only Chinese MOD searches use discovery sessions; other resource queries keep
 * the existing repository pagination contract. */
export function usesProgressiveCommunitySearch(query: Pick<CommunityQuery, 'kind' | 'keyword'>): boolean {
  return query.kind === 'mod' && /\p{Script=Han}/u.test(query.keyword)
}

export function communityQueryKey(query: CommunityQuery): string {
  return JSON.stringify([query.keyword.trim(), query.kind, query.source, query.mcVersion?.trim() || '',
    query.loader || '', query.sort || 'relevance', query.limit])
}

export interface ProgressiveCommunityState {
  requestId: string | null
  revision: number
  query?: CommunityQuery
  snapshot?: CommunitySearchSnapshot
  pending: boolean
  paused: boolean
  error: string
}
export interface ProgressiveCommunityPort {
  uuid(): string
  start(requestId: string, query: CommunityQuery): Promise<CommunitySearchSnapshot>
  continue(requestId: string, continuation: CommunitySearchContinuation): Promise<CommunitySearchSnapshot>
  cancel(requestId: string): Promise<boolean>
  subscribe(callback: (snapshot: CommunitySearchSnapshot) => void): () => void
  changed(state: ProgressiveCommunityState): void
  errorText(error: unknown): string
}

/** A fresh ID is active before subscribing or invoking. Complete visible-prefix
 * snapshots replace one another; an early event always beats an older invoke
 * response. Leaving/replacing invalidates the ID before async cancellation. */
export function createProgressiveCommunitySearch(port: ProgressiveCommunityPort) {
  let state: ProgressiveCommunityState = { requestId: null, revision: -1, pending: false, paused: false, error: '' }
  let unsubscribe: (() => void) | undefined
  let disposed = false
  const notify = () => port.changed(state)
  function accept(snapshot: CommunitySearchSnapshot): boolean {
    if (disposed || !state.requestId || snapshot.requestId !== state.requestId || !state.query ||
      communityQueryKey(snapshot.query) !== communityQueryKey(state.query) ||
      !Number.isSafeInteger(snapshot.revision) || snapshot.revision <= state.revision) return false
    state = { ...state, revision: snapshot.revision, snapshot, paused: false, error: snapshot.error || '' }
    notify()
    return true
  }
  function pause(): Promise<boolean> {
    const oldId = state.requestId
    unsubscribe?.(); unsubscribe = undefined
    state = { ...state, requestId: null, pending: false, paused: !!oldId || !!state.snapshot, error: '' }
    notify()
    return oldId ? port.cancel(oldId).catch(() => false) : Promise.resolve(true)
  }
  async function start(query: CommunityQuery, retained?: CommunitySearchSnapshot): Promise<CommunitySearchSnapshot | undefined> {
    if (disposed) return
    void pause()
    const requestId = port.uuid()
    state = { requestId, revision: -1, query: { ...query, offset: 0 }, snapshot: retained,
      pending: true, paused: false, error: '' }
    notify()
    // A subscription is allowed to deliver synchronously here; identity is ready.
    unsubscribe = port.subscribe(accept)
    try { const initial = await port.start(requestId, state.query!); accept(initial); return initial }
    catch (error) {
      if (!disposed && state.requestId === requestId) { state = { ...state, error: port.errorText(error) }; notify() }
    } finally {
      if (!disposed && state.requestId === requestId) { state = { ...state, pending: false }; notify() }
    }
  }
  async function more(mode: CommunitySearchContinuation['mode']): Promise<boolean> {
    const requestId = state.requestId, snapshot = state.snapshot
    if (disposed || !requestId || state.pending || !snapshot || snapshot.requestId !== requestId || snapshot.phase !== 'ready' || !snapshot.cursor) return false
    if (mode === 'discover' ? !snapshot.discoveryHasMore : snapshot.items.length >= snapshot.total) return false
    state = { ...state, pending: true, error: '' }; notify()
    try { accept(await port.continue(requestId, { mode, cursor: snapshot.cursor })); return true }
    catch (error) {
      if (!disposed && state.requestId === requestId) { state = { ...state, error: port.errorText(error) }; notify() }
      return false
    } finally {
      if (!disposed && state.requestId === requestId) { state = { ...state, pending: false }; notify() }
    }
  }
  function restore(snapshot: CommunitySearchSnapshot): void {
    if (disposed) return
    void pause()
    state = { requestId: null, revision: snapshot.revision, query: { ...snapshot.query }, snapshot,
      pending: false, paused: true, error: snapshot.error || '' }
    notify()
  }
  return { start, more, pause, restore, current: () => state,
    dispose() { void pause(); disposed = true } }
}
