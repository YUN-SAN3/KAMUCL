/** Deduplicate downloads per runtime target while each caller owns cancellation.
 * Work aborts only after the last observer leaves; a new caller never joins an
 * abandoned preparation that is still draining its extraction/download. */
export class JavaPreparation<T, E> {
  private pending = new Map<string, { promise: Promise<T>; controller: AbortController; listeners: Set<(event: E) => void>; last?: E }>()
  run(key: string, observe: (event: E) => void, work: (emit: (event: E) => void, signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    let record = this.pending.get(key)
    if (!record || record.controller.signal.aborted) {
      const owned: NonNullable<typeof record> = { promise: Promise.resolve(undefined as T), controller: new AbortController(), listeners: new Set<(event: E) => void>() }
      owned.promise = Promise.resolve().then(() => { owned.controller.signal.throwIfAborted(); return work(event => {
        owned.last = event
        for (const listener of owned.listeners) try { listener(event) } catch { /* UI observer only. */ }
      }, owned.controller.signal) }).finally(() => { if (this.pending.get(key) === owned) this.pending.delete(key) })
      record = owned
      this.pending.set(key, record)
    }
    const owned = record
    // Use a unique observer even if two callers pass the same callback.
    const listener = (event: E) => observe(event)
    owned.listeners.add(listener)
    if (owned.last !== undefined) try { listener(owned.last) } catch { /* UI observer only. */ }
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => { signal?.removeEventListener('abort', abort); owned.listeners.delete(listener) }
      const abort = () => {
        cleanup()
        if (!owned.listeners.size) owned.controller.abort(signal?.reason)
        reject(signal?.reason ?? new DOMException('已取消', 'AbortError'))
      }
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      owned.promise.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
    })
  }
}
