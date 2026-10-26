/** Four metadata requests at most; subscribers share work but cancel independently. No completed response cache. */
export class FavoriteVersionQueue<T> {
  private active = 0
  private jobs = new Map<string, Job<T>>()
  private pending: Job<T>[] = []
  constructor(private readonly concurrency = 4) {}

  request(key: string, run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('收藏查询已取消'))
    let job = this.jobs.get(key)
    if (!job) {
      job = { key, run, controller: new AbortController(), clients: new Map(), started: false }
      this.jobs.set(key, job); this.pending.push(job)
    }
    const current = job
    const result = new Promise<T>((resolve, reject) => {
      const id = Symbol(), cancel = () => {
        if (!current.clients.delete(id)) return
        signal?.removeEventListener('abort', cancel)
        reject(signal?.reason ?? new Error('收藏查询已取消'))
        if (!current.clients.size) {
          if (this.jobs.get(key) === current) this.jobs.delete(key)
          current.controller.abort(new Error('收藏查询已无订阅者'))
        }
        this.pump()
      }
      current.clients.set(id, { resolve, reject, detach: () => signal?.removeEventListener('abort', cancel) })
      signal?.addEventListener('abort', cancel, { once: true })
    })
    this.pump()
    return result
  }

  private pump() {
    while (this.active < this.concurrency && this.pending.length) {
      const job = this.pending.shift()!
      if (!job.clients.size || job.controller.signal.aborted) continue
      job.started = true; this.active++
      void Promise.resolve().then(() => job.run(job.controller.signal)).then(value => {
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key)
        for (const client of job.clients.values()) { client.detach(); client.resolve(value) }
      }, error => {
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key)
        for (const client of job.clients.values()) { client.detach(); client.reject(error) }
      }).finally(() => {
        job.clients.clear()
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key)
        this.active--; this.pump()
      })
    }
  }
}
interface Job<T> {
  key: string
  run: (signal: AbortSignal) => Promise<T>
  controller: AbortController
  clients: Map<symbol, { resolve(value: T): void; reject(error: unknown): void; detach(): void }>
  started: boolean
}
