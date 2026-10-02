import { inheritTaskControl, throwIfCancelled } from './tasks'

/** Cancel siblings on failure, but drain every writer before the caller can roll back. */
export async function runParallelTasks<T extends readonly unknown[]>(
  tasks: { [K in keyof T]: (signal: AbortSignal) => Promise<T[K]> },
  signal?: AbortSignal
): Promise<T> {
  throwIfCancelled(signal)
  const controller = new AbortController()
  inheritTaskControl(signal, controller.signal)
  const abort = (): void => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  let failed = false
  let failure: unknown
  try {
    const results = await Promise.allSettled(tasks.map(async task => {
      try {
        throwIfCancelled(controller.signal)
        return await task(controller.signal)
      } catch (error) {
        if (!failed) { failed = true; failure = error }
        controller.abort(error)
        throw error
      }
    }))
    if (failed) throw failure
    throwIfCancelled(signal)
    return results.map(result => (result as PromiseFulfilledResult<unknown>).value) as unknown as T
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}
