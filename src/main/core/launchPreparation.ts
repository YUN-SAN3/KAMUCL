/** Drain every started task before reporting failure, so a failed launch cannot
 * leave preparation writes running into the next attempt. */
export async function waitForPreparation<T extends unknown[]>(
  tasks: [...{ [K in keyof T]: () => Promise<T[K]> }]
): Promise<T> {
  const results = await Promise.allSettled(tasks.map(task => Promise.resolve().then(task)))
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
  return results.map(result => (result as PromiseFulfilledResult<unknown>).value) as T
}

/** Bounded I/O; preserve input order and stop scheduling on failure. No integrity
 * results are cached: changed and same-size damaged files are checked every run. */
export async function mapLaunchFiles<T, R>(items: readonly T[], visit: (item: T, index: number) => Promise<R>, concurrency = 4): Promise<R[]> {
  const output: R[] = new Array(items.length)
  let cursor = 0, failed = false
  await waitForPreparation(Array.from({ length: Math.min(items.length, Math.max(1, Math.min(8, Math.floor(concurrency) || 1))) }, () => async () => {
    while (!failed && cursor < items.length) {
      const index = cursor++
      try { output[index] = await visit(items[index], index) }
      catch (error) { failed = true; throw error }
    }
  }))
  return output
}

/** Share preparation only while it is running; failures and completed work never
 * become stale cache entries. Keys must identify the actual destination. */
export class SharedPreparation<T> {
  private pending = new Map<string, Promise<T>>()
  run(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key)
    if (existing) return existing
    const result = Promise.resolve().then(work).finally(() => this.pending.delete(key))
    this.pending.set(key, result)
    return result
  }
}
