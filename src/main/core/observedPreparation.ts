/** Share one preparation while forwarding live progress to every active caller.
 * An observer cannot abort or break work still needed by another caller. */
export class ObservedPreparation<T, E> {
  private pending = new Map<string, { promise: Promise<T>; listeners: Set<(event: E) => void>; last?: E }>()
  run(key: string, observe: (event: E) => void, work: (emit: (event: E) => void) => Promise<T>): Promise<T> {
    let record = this.pending.get(key)
    if (!record) {
      record = { promise: Promise.resolve(undefined as T), listeners: new Set() }
      const owned = record
      owned.promise = Promise.resolve().then(() => work(event => {
        owned.last = event
        for (const listener of owned.listeners) { try { listener(event) } catch { /* A disconnected UI must not stop another caller. */ } }
      })).finally(() => { if (this.pending.get(key) === owned) this.pending.delete(key) })
      this.pending.set(key, owned)
    }
    record.listeners.add(observe)
    if (record.last !== undefined) { try { observe(record.last) } catch { /* Replayed observer only. */ } }
    const owned = record
    return owned.promise.finally(() => owned.listeners.delete(observe))
  }
}
