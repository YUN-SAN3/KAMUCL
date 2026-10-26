import path from 'node:path'

const tails = new Map<string, Promise<void>>()

/** Only the lock identity is canonicalized; never rewrite a user's path.
 * APFS can alias Unicode normalization and case. Conservative case folding
 * may serialize distinct names on a sensitive volume, but cannot merge files. */
export function fileJobKey(dest: string): string {
  const resolved = path.resolve(dest)
  return process.platform === 'darwin' ? resolved.normalize('NFC').toUpperCase()
    : process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** Serialize only the same destination. Cancelling a waiter must never release an active writer. */
export async function withFileJob<T>(dest: string, signal: AbortSignal | undefined, action: () => Promise<T>): Promise<T> {
  signal?.throwIfAborted()
  const key = fileJobKey(dest)
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
