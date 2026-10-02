import path from 'node:path'

const tails = new Map<string, Promise<void>>()

/** Serialize only the same destination. Cancelling a waiter must never release an active writer. */
export async function withFileJob<T>(dest: string, signal: AbortSignal | undefined, action: () => Promise<T>): Promise<T> {
  signal?.throwIfAborted()
  const resolved = path.resolve(dest)
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
  const previous = tails.get(key) ?? Promise.resolve()
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const tail = previous.then(() => held)
  tails.set(key, tail)
  let cancel = () => {}
  try {
    await new Promise<void>((resolve, reject) => {
      cancel = () => reject(signal?.reason ?? new Error('已取消'))
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) cancel()
      previous.then(resolve)
    })
    signal?.throwIfAborted()
    return await action()
  } finally {
    signal?.removeEventListener('abort', cancel)
    void previous.then(release)
    void tail.then(() => { if (tails.get(key) === tail) tails.delete(key) })
  }
}
