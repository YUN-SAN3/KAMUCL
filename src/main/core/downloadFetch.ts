import { httpFetch } from './httpClient'
import { CF_BUILTIN_KEY } from './curseforgeKey'
import { usesSystemProxy } from './systemDownload'

export function needsCurseForgeKey(url: string): boolean {
  const u = new URL(url)
  return u.protocol === 'https:' && u.hostname === 'edge.forgecdn.net' && /^\/files\/\d+\/\d+\//.test(u.pathname)
}

/** Recompute credentials at every redirect; an application key never reaches a mirror. */
export async function downloadFetch(url: string, init: Parameters<typeof httpFetch>[1],
  getKey = async () => process.versions.electron ? (await import('./community')).cfChannel().key : (process.env.KAMUCL_CF_API_KEY || CF_BUILTIN_KEY),
  fetcher = httpFetch): Promise<Response> {
  for (let hop = 0; hop < 10; hop++) {
    // Use the player's configured proxy/PAC immediately; keep direct transfer
    // when this URL resolves to DIRECT. Re-evaluate after every redirect.
    const requestInit = { ...init, systemProxy: init?.systemProxy || (fetcher === httpFetch && await usesSystemProxy(url)) }
    const headers = { ...init?.headers }
    if (needsCurseForgeKey(url)) headers['x-api-key'] = await getKey()
    let response: Response
    try { response = await fetcher(url, { ...requestInit, headers, redirect: 'manual' }) }
    catch (error) {
      init?.signal?.throwIfAborted()
      // Node does not use the desktop's PAC/proxy/certificate store. Retry a failed
      // connection through Electron's system transport, retaining Range + validation.
      if (fetcher !== httpFetch || !process.versions.electron || requestInit.systemProxy || !(error instanceof TypeError)) throw error
      response = await httpFetch(url, { ...init, headers, redirect: 'manual', systemProxy: true })
    }
    if (![301,302,303,307,308].includes(response.status)) return response
    const location = response.headers.get('location'); await response.body?.cancel()
    if (!location) throw new Error('下载跳转缺少地址')
    const next = new URL(location, url)
    if (!['https:', 'http:'].includes(next.protocol) || (new URL(url).protocol === 'https:' && next.protocol !== 'https:')) throw new Error('下载跳转地址不安全')
    url = next.href
  }
  throw new Error('下载跳转次数过多')
}
