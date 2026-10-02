import { httpFetch } from './httpClient'

export interface CfMetadataSource { base: string; headers?: Record<string, string> }
export interface ResolvedCfDownload { url: string; fileName: string; sha1: string; size: number }
export interface ResolvedCfFile extends Omit<ResolvedCfDownload, 'url'> { url: string | null; isAvailable: boolean }

/** Public CDN layout uses the numeric file ID, with no padding on its remainder. */
export function constructCurseForgeCdnUrl(fileID: number, fileName: string): string {
  if (!Number.isSafeInteger(fileID) || fileID <= 0) throw new Error('CurseForge 文件标识无效')
  if (!fileName || /[/\\\x00-\x1f]/.test(fileName) || fileName === '.' || fileName === '..') throw new Error('文件名无效')
  return `https://edge.forgecdn.net/files/${Math.floor(fileID / 1000)}/${fileID % 1000}/${encodeURIComponent(fileName)}`
}

/** Edge redirects available files. Do not send Range or download the body while probing.
 * A failed probe leaves the existing alternate-source/manual-file flow in charge;
 * the eventual download must still match the metadata size and SHA1.
 */
export async function probeCurseForgeCdnUrl(url: string, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted()
  try {
    const timeout = AbortSignal.timeout(8000)
    const res = await httpFetch(url, {
      method: 'HEAD', redirect: 'manual', signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    })
    await res.body?.cancel()
    signal?.throwIfAborted()
    return res.status === 302
  } catch { signal?.throwIfAborted(); return false }
}

function downloadUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch { return null }
}

/** CurseForge REST: GET /v1/mods/{modId}/files/{fileId}/download-url.
 * A missing metadata URL is not proof of an author restriction. Only use a URL
 * actually returned by the service, with the original size/hash still required.
 */
export async function resolveCurseForgeFileUrl(projectID: number, fileID: number, sources: CfMetadataSource[], signal?: AbortSignal): Promise<string | null> {
  if (![projectID, fileID].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('CurseForge 文件标识无效')
  for (const source of sources) {
    signal?.throwIfAborted()
    try {
      const timeout = AbortSignal.timeout(6000)
      const res = await httpFetch(`${source.base}/mods/${projectID}/files/${fileID}/download-url`, {
        headers: source.headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout
      })
      if (!res.ok) { await res.body?.cancel(); continue }
      const data = await res.json() as { data?: unknown }
      const url = downloadUrl(data.data)
      if (url) return url
    } catch { signal?.throwIfAborted() }
  }
  return null
}

/** JARs are mods; ZIPs must use the project's declared class, not the mods folder. */
export async function curseForgeInstallDir(projectID: number, fileName: string, sources: CfMetadataSource[], signal?: AbortSignal): Promise<string> {
  if (/\.jar$/i.test(fileName)) return 'mods'
  for (const source of sources) {
    signal?.throwIfAborted()
    try {
      const timeout = AbortSignal.timeout(6000)
      const res = await httpFetch(`${source.base}/mods/${projectID}`, {
        headers: source.headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout
      })
      if (!res.ok) { await res.body?.cancel(); continue }
      const { data } = await res.json() as { data?: { id?: number; classId?: number } }
      if (data?.id !== projectID) continue
      const dir = ({ 6: 'mods', 12: 'resourcepacks', 6552: 'shaderpacks', 6945: 'datapacks' } as Record<number, string>)[data.classId ?? 0]
      if (dir) return dir
    } catch { signal?.throwIfAborted() }
  }
  throw new Error(`无法确定 ${fileName} 的资源类型，请稍后重试获取 CurseForge 项目信息`)
}

/** File identity remains useful when a pack bundles a file without an automatic download URL. */
export async function resolveCurseForgeMetadata(projectID: number, fileID: number, sources: CfMetadataSource[], signal?: AbortSignal): Promise<ResolvedCfFile> {
  if (![projectID, fileID].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('CurseForge 文件标识无效')
  let last: unknown
  let localOnly: ResolvedCfFile | undefined
  for (const source of sources) {
    signal?.throwIfAborted()
    const timeout = AbortSignal.timeout(6000)
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    try {
      const res = await httpFetch(`${source.base}/mods/${projectID}/files/${fileID}`, { signal: requestSignal, headers: source.headers })
      if (!res.ok) { await res.body?.cancel(); throw new Error(`文件信息 HTTP ${res.status}`) }
      const { data } = await res.json() as { data?: { id?: number; modId?: number; isAvailable?: boolean; fileName?: string; downloadUrl?: string | null; fileLength?: number; hashes?: { algo: number; value: string }[] } }
      if (data?.id !== fileID || data.modId !== projectID) throw new Error('文件信息与整合包清单不匹配')
      const name = data.fileName ?? '', sha1 = data.hashes?.find(h => h.algo === 1)?.value ?? ''
      if (!name || /[/\\\x00-\x1f]/.test(name) || name === '.' || name === '..') throw new Error('文件名无效')
      if (!Number.isSafeInteger(data.fileLength) || data.fileLength! <= 0 || !/^[a-f\d]{40}$/i.test(sha1)) throw new Error('文件缺少有效大小或 SHA1，无法安全下载')
      if (data.downloadUrl && new URL(data.downloadUrl).protocol !== 'https:') throw new Error('文件下载地址无效')
      const file = { fileName: name, url: data.downloadUrl || null, sha1: sha1.toLowerCase(), size: data.fileLength!, isAvailable: data.isAvailable !== false }
      if (file.isAvailable && file.url) return file
      // A mirror may have older availability data. Check the other configured source first.
      localOnly ??= file
    } catch (error) { signal?.throwIfAborted(); last = error }
  }
  if (localOnly) return localOnly
  throw new Error(`CurseForge ${projectID}/${fileID}：${last instanceof Error ? last.message : String(last)}`)
}

export function requireCurseForgeDownload(file: ResolvedCfFile, projectID: number, fileID: number): ResolvedCfDownload {
  if (!file.isAvailable || !file.url) {
    throw new Error(`CurseForge ${projectID}/${fileID}（${file.fileName}）：未提供可自动下载的文件，且整合包内没有大小和 SHA1 均匹配的副本。请从 CurseForge 文件页面取得该版本并补入整合包的 overrides/mods 后重试，或联系整合包作者补全文件。`)
  }
  return { fileName: file.fileName, url: file.url, sha1: file.sha1, size: file.size }
}

/** Resolve the manifest's exact downloadable file; never invent a URL for restricted files. */
export async function resolveCurseForgeDownload(projectID: number, fileID: number, sources: CfMetadataSource[], signal?: AbortSignal): Promise<ResolvedCfDownload> {
  return requireCurseForgeDownload(await resolveCurseForgeMetadata(projectID, fileID, sources, signal), projectID, fileID)
}

/** A second author-published source is usable only for the exact same bytes. */
export async function exactModrinthDownload(file: ResolvedCfFile, signal?: AbortSignal,
  bases = ['https://mod.mcimirror.top/modrinth/v2', 'https://api.modrinth.com/v2']): Promise<string | null> {
  for (const base of bases) {
    signal?.throwIfAborted()
    try {
      const timeout = AbortSignal.timeout(6000)
      const res = await httpFetch(`${base}/version_file/${file.sha1}?algorithm=sha1`, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { 'User-Agent': 'KAMUCL (github.com/kamubaba-i/KAMUCL)' }
      })
      if (!res.ok) { await res.body?.cancel(); continue }
      const data = await res.json() as { files?: Array<{ size?: number; hashes?: { sha1?: string }; url?: string }> }
      const exact = data.files?.find(f => f.size === file.size && f.hashes?.sha1?.toLowerCase() === file.sha1.toLowerCase())
      if (exact?.url) {
        const url = new URL(exact.url)
        if (url.protocol === 'https:' && url.hostname === 'cdn.modrinth.com') return exact.url
      }
    } catch { signal?.throwIfAborted() }
  }
  return null
}
