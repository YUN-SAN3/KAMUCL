type PlanEntry<T> = { value: T; expires: number; users: number; retired: boolean }
type PlanClock = {
  now(): number
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>
  clearTimeout(timer: ReturnType<typeof setTimeout>): void
}

/** A single expiry timer releases abandoned snapshots even without another IPC
 * request. Active file transactions hold a lease until their cleanup finishes. */
export class ModPlanStore<T> {
  private entries = new Map<string, PlanEntry<T>>()
  private timer?: ReturnType<typeof setTimeout>
  private timerAt?: number
  constructor(private ttl = 30 * 60_000, private clock: PlanClock = {
    now: Date.now, setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout
  }, private limit = 8) {}

  set(id: string, value: T): void {
    const expires = this.clock.now() + this.ttl
    this.entries.set(id, { value, expires, users: 0, retired: false })
    this.trimUnused()
    this.schedule(expires)
  }

  get(id: string): T | undefined {
    const entry = this.entries.get(id)
    if (!entry) return undefined
    if (entry.retired || entry.expires <= this.clock.now()) { this.delete(id); return undefined }
    return entry.value
  }

  lease(id: string): { value: T; release(): void } | undefined {
    if (this.get(id) === undefined) return undefined
    const entry = this.entries.get(id)!
    entry.users++
    let released = false
    return { value: entry.value, release: () => {
      if (released) return
      released = true; entry.users--
      if (!entry.users && (entry.retired || entry.expires <= this.clock.now())) this.entries.delete(id)
      this.trimUnused()
      this.schedule()
    } }
  }

  delete(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.retired = true
    if (!entry.users) this.entries.delete(id)
    this.schedule()
  }

  deleteMatching(matches: (value: T) => boolean): void {
    for (const [id, entry] of this.entries) if (matches(entry.value)) {
      entry.retired = true
      if (!entry.users) this.entries.delete(id)
    }
    this.schedule()
  }

  get size(): number { return this.entries.size }

  private trimUnused(): void {
    const unused = [...this.entries].filter(([, entry]) => !entry.users)
    // Running/queued file transactions are never candidates for eviction.
    for (let i = 0; i < unused.length - this.limit; i++) this.entries.delete(unused[i][0])
  }

  private schedule(addedExpiry?: number): void {
    // New plans normally expire after the already-armed earliest deadline.
    // Avoid scanning every snapshot or recreating its timer on that hot path.
    if (this.timer !== undefined && addedExpiry !== undefined && addedExpiry >= this.timerAt!) return
    let next = Infinity
    for (const entry of this.entries.values()) if (!entry.retired) next = Math.min(next, entry.expires)
    if (this.timer !== undefined && next >= this.timerAt! && Number.isFinite(next)) return
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer)
    this.timer = undefined; this.timerAt = undefined
    if (!Number.isFinite(next)) return
    this.timerAt = next
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined; this.timerAt = undefined
      for (const [id, entry] of this.entries) if (entry.expires <= this.clock.now()) {
        entry.retired = true
        if (!entry.users) this.entries.delete(id)
      }
      this.schedule()
    }, Math.max(1, next - this.clock.now()))
    this.timer.unref?.()
  }
}
