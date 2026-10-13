/** Shared by provider JSON and encyclopedia HTML, including legacy callers.
 * Reserve permits before waking a waiter so new arrivals cannot jump the queue. */
type RequestKind = 'provider' | 'mcmod'
interface Waiter { kind: RequestKind; signal?: AbortSignal; resolve: (release: () => void) => void; reject: (error: unknown) => void; cancel: () => void }
let active = 0, encyclopedia = 0
const waiting: Waiter[] = []
const abortError = (signal?: AbortSignal) => signal?.reason ?? new DOMException('查询已取消', 'AbortError')
function drain(): void {
  while (active < 4) {
    const index = waiting.findIndex(row => row.kind !== 'mcmod' || encyclopedia < 2)
    if (index < 0) break
    const row = waiting.splice(index, 1)[0]
    row.signal?.removeEventListener('abort', row.cancel)
    if (row.signal?.aborted) { row.reject(abortError(row.signal)); continue }
    active++; if (row.kind === 'mcmod') encyclopedia++
    let released = false
    row.resolve(() => {
      if (released) return
      released = true; active--; if (row.kind === 'mcmod') encyclopedia--
      drain()
    })
  }
}
export async function runCommunityRequest<T>(kind: RequestKind, signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  signal?.throwIfAborted()
  const release = await new Promise<() => void>((resolve, reject) => {
    const row: Waiter = { kind, signal, resolve, reject, cancel: () => {
      const index = waiting.indexOf(row)
      if (index >= 0) { waiting.splice(index, 1); reject(abortError(signal)); drain() }
    } }
    waiting.push(row); signal?.addEventListener('abort', row.cancel, { once: true })
    if (signal?.aborted) row.cancel(); else drain()
  })
  try { signal?.throwIfAborted(); return await run() } finally { release() }
}

interface SharedRequest { controller: AbortController; promise: Promise<unknown>; subscribers: Set<symbol> }
const sharedRequests = new Map<string, SharedRequest>()
/** Identical transport reads share one permit and one body, even when callers
 * have different search-source selections. A caller's cancellation only detaches
 * that subscription; the last subscriber aborts the actual queued/inflight read.
 * Only pending reads are retained, so failures never become negative cache hits. */
export function sharedCommunityRequest<T>(key: string, kind: RequestKind, signal: AbortSignal,
  run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  let job = sharedRequests.get(key)
  if (!job || job.controller.signal.aborted) {
    const controller = new AbortController(), created: SharedRequest = { controller, subscribers: new Set(), promise: Promise.resolve(undefined) }
    created.promise = runCommunityRequest(kind, controller.signal, () => run(controller.signal)).finally(() => {
      if (sharedRequests.get(key) === created) sharedRequests.delete(key)
    })
    sharedRequests.set(key, created); job = created
  }
  const owned = job, token = Symbol('community-read')
  owned.subscribers.add(token)
  return new Promise<T>((resolve, reject) => {
    let finished = false
    const detach = () => { signal.removeEventListener('abort', cancel); owned.subscribers.delete(token) }
    const cancel = () => {
      if (finished) return
      finished = true; detach(); reject(abortError(signal))
      if (!owned.subscribers.size) owned.controller.abort(abortError(signal))
    }
    signal.addEventListener('abort', cancel, { once: true })
    owned.promise.then(value => { if (!finished) { finished = true; detach(); resolve(structuredClone(value) as T) } }, error => {
      if (!finished) { finished = true; detach(); reject(error) }
    })
    if (signal.aborted) cancel()
  })
}
