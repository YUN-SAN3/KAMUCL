import { Readable } from 'node:stream'

type RequestOptions = { signal?: AbortSignal; headers?: Record<string, string>; method?: string; body?: string }

/** net.fetch rejects manual redirects. Expose one hop through net.request so
 * downloadFetch can validate the next URL and recompute credentials itself.
 * Electron's IncomingMessage is a Node Readable (net-client-request.ts); using
 * toWeb preserves backpressure during a paused or speed-limited download.
 */
export async function systemDownload(url: string, init: RequestOptions): Promise<Response> {
  const { net } = await import('electron')
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
export async function usesSystemProxy(url: string): Promise<boolean> {
  if (!process.versions.electron) return false
  try {
    const { session } = await import('electron')
    const route = await session.defaultSession.resolveProxy(url)
    return route.split(';').some(part => part.trim() && part.trim() !== 'DIRECT')
  } catch { return false }
}
