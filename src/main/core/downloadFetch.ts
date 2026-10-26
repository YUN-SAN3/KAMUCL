import { httpFetch } from './httpClient'
import { CF_BUILTIN_KEY } from './curseforgeKey'
import { usesSystemProxy } from './systemDownload'
import { waitIfTaskPaused } from './tasks'

export function needsCurseForgeKey(url: string): boolean {
  const u = new URL(url)
  return u.protocol === 'https:' && u.hostname === 'edge.forgecdn.net' && /^\/files\/\d+\/\d+\//.test(u.pathname)
}

/** Recompute credentials at every redirect; an application key never reaches a mirror. */
export async function downloadFetch(url: string, init: Parameters<typeof httpFetch>[1],
  getKey = async () => process.versions.electron ? (await import('./curseforgeChannel')).cfChannel().key : (process.env.KAMUCL_CF_API_KEY || CF_BUILTIN_KEY),
  fetcher = httpFetch, beforeRequest?: (url: string) => Promise<void>): Promise<Response> {
  let suppliedHeaders = { ...init?.headers }
  for (let hop = 0; hop < 10; hop++) {
    const target = new URL(url)
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) throw new Error('下载地址不安全')
    init?.signal?.throwIfAborted()
    await beforeRequest?.(url)
    init?.signal?.throwIfAborted()
    // Use the player's configured proxy/PAC immediately; keep direct transfer
    // when this URL resolves to DIRECT. Re-evaluate after every redirect.
    const requestInit = { ...init, systemProxy: init?.systemProxy || (fetcher === httpFetch && await usesSystemProxy(url, init?.signal)) }
    init?.signal?.throwIfAborted()
    const headers = { ...suppliedHeaders }
    if (needsCurseForgeKey(url)) headers['x-api-key'] = await getKey()
    // PAC and credential lookup can finish after the user pauses the task.
    // Recheck at the actual dispatch boundary, including system fallback.
    await waitIfTaskPaused(init?.signal)
    init?.signal?.throwIfAborted()
    let response: Response
    try { response = await fetcher(url, { ...requestInit, headers, redirect: 'manual' }) }
    catch (error) {
      init?.signal?.throwIfAborted()
      // Node does not use the desktop's PAC/proxy/certificate store. Retry a failed
      // connection through Electron's system transport, retaining Range + validation.
      if (fetcher !== httpFetch || !process.versions.electron || requestInit.systemProxy || !(error instanceof TypeError)) throw error
      await waitIfTaskPaused(init?.signal)
      init?.signal?.throwIfAborted()
      response = await httpFetch(url, { ...init, headers, redirect: 'manual', systemProxy: true })
    }
    if (![301,302,303,307,308].includes(response.status)) return response
    const location = response.headers.get('location'); await response.body?.cancel()
    if (!location) throw new Error('下载跳转缺少地址')
    const next = new URL(location, url)
    if (!['https:', 'http:'].includes(next.protocol) || next.username || next.password || (target.protocol === 'https:' && next.protocol !== 'https:')) throw new Error('下载跳转地址不安全')
    if (next.origin !== target.origin) {
      // Preserve Range and representation headers, including signed CDN URLs;
      // never forward source credentials to a different origin. CF credentials
      // are recomputed above only for the official endpoint on each request.
      suppliedHeaders = Object.fromEntries(Object.entries(suppliedHeaders).filter(([name]) => !/^(?:authorization|proxy-authorization|cookie|x-api-key)$/i.test(name)))
    }
    url = next.href
  }
  throw new Error('下载跳转次数过多')
}
