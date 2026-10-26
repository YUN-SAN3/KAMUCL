import { Readable } from 'node:stream'
import { isTaskPaused, waitIfTaskPaused } from './tasks'

type RequestOptions = { signal?: AbortSignal; headers?: Record<string, string>; method?: string; body?: string }

/** net.fetch rejects manual redirects. Expose one hop through net.request so
 * downloadFetch can validate the next URL and recompute credentials itself.
 * Electron's IncomingMessage is a Node Readable (net-client-request.ts); using
 * toWeb preserves backpressure during a paused or speed-limited download.
 */
export async function systemDownload(url: string, init: RequestOptions): Promise<Response> {
  const { net } = await import('electron')
  await waitIfTaskPaused(init.signal)
  init.signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method: init.method ?? 'GET', redirect: 'manual',
      headers: init.headers, useSessionCookies: false, cache: 'no-store' })
    let settled = false
    let incoming: Readable | undefined
    const clean = () => init.signal?.removeEventListener('abort', abort)
    const abort = () => {
      const reason = init.signal?.reason ?? new DOMException('Aborted', 'AbortError')
      incoming?.destroy(reason); request.abort(); clean()
      if (!settled) { settled = true; reject(reason) }
    }
    const headersOf = (values: Record<string, string | string[]>) => {
      const headers = new Headers()
      for (const [key, value] of Object.entries(values)) {
        for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v)
      }
      return headers
    }
    request.on('error', error => {
      clean()
      const failure = new TypeError('系统下载连接失败', { cause: error })
      incoming?.destroy(failure)
      if (!settled) { settled = true; reject(failure) }
    })
    request.on('redirect', (status, _method, location, values) => {
      const headers = headersOf(values); headers.set('location', location)
      settled = true; clean()
      resolve(new Response(null, { status, headers }))
      request.abort() // No followRedirect: the caller owns the next hop.
    })
    request.on('response', response => {
      incoming = response as unknown as Readable
      const stream = incoming
      stream.on('error', () => {}) // The web stream also observes this failure.
      stream.once('close', () => { clean(); if (!stream.readableEnded) request.abort() })
      stream.once('end', clean)
      const noBody = init.method === 'HEAD' || [204, 205, 304].includes(response.statusCode)
      const body = noBody ? null : Readable.toWeb(stream) as ReadableStream<Uint8Array>
      const result = new Response(body, { status: response.statusCode, headers: headersOf(response.headers) })
      Object.defineProperty(result, 'url', { value: url })
      settled = true; resolve(result)
      if (noBody) { stream.resume(); clean() }
    })
    init.signal?.addEventListener('abort', abort, { once: true })
    if (init.signal?.aborted) { abort(); return }
    request.end(init.body)
  })
}

/** Honor the current OS/PAC route instead of waiting for a direct connection to
 * fail on every file. resolveProxy is cached by Chromium and rechecks PAC paths. */
export const proxyResolutionTimeouts = { maxWaitMs: 15_000 }
export async function usesSystemProxy(url: string, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted()
  if (!process.versions.electron) return false
  let timer: ReturnType<typeof setInterval> | undefined
  let onAbort = () => {}
  const timeoutError = new DOMException('系统代理解析超时，请检查代理设置后重试', 'TimeoutError')
  try {
    // Chromium cannot cancel a PAC lookup. Cancel this subscriber instead, and
    // observe the eventual result without allowing it to start a late request.
    const route = await new Promise<string>((resolve, reject) => {
      let activeMs = 0, sampledAt = performance.now()
      onAbort = () => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) { onAbort(); return }
      timer = setInterval(() => {
        const now = performance.now(), elapsed = now - sampledAt; sampledAt = now
        if (!isTaskPaused(signal)) activeMs += elapsed
        if (activeMs >= proxyResolutionTimeouts.maxWaitMs) reject(timeoutError)
      }, Math.max(10, Math.min(100, proxyResolutionTimeouts.maxWaitMs / 4)))
      void import('electron').then(({ session }) => {
        signal?.throwIfAborted()
        return session.defaultSession.resolveProxy(url)
      }).then(resolve, reject)
    })
    signal?.throwIfAborted()
    return route.split(';').some(part => part.trim() && part.trim() !== 'DIRECT')
  } catch (error) {
    signal?.throwIfAborted()
    if (error === timeoutError) throw error
    return false
  } finally {
    clearInterval(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
