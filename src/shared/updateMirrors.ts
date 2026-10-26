/** Update mirrors rewrite only public release URLs; credentials never belong in a source. */
export const UPDATE_MIRRORS = [
  { label: 'ghproxy.net', url: 'https://ghproxy.net/' },
  { label: 'gh-proxy.com', url: 'https://gh-proxy.com/' },
  { label: 'ghfast.top', url: 'https://ghfast.top/' }
] as const
export const UPDATE_MIRROR_PRESETS: readonly string[] = UPDATE_MIRRORS.map(source => source.url)
export const MAX_CUSTOM_UPDATE_MIRRORS = 8

export function normalizeUpdateMirrorUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) return null
    url.pathname = url.pathname.replace(/\/+$/, '') + '/'
    return url.href
  } catch { return null }
}

/** Invalid legacy values are ignored on read; new writes must report validation errors. */
export function storedUpdateMirrorUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(normalizeUpdateMirrorUrl).filter((url): url is string => url !== null))].slice(0, MAX_CUSTOM_UPDATE_MIRRORS)
}

export function validateUpdateMirrorUrls(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_UPDATE_MIRRORS) throw new Error('最多追加 8 个更新镜像')
  const urls = value.map(normalizeUpdateMirrorUrl)
  if (urls.some(url => url === null)) throw new Error('更新镜像须为不含账号、密码、查询参数及片段的 HTTPS 地址')
  return [...new Set(urls as string[])]
}
