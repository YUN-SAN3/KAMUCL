import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { RemoteVersion } from '../../shared/types'

export interface VersionCatalog {
  versions: RemoteVersion[]
  checkedAt: number
  stale: boolean
}
const TTL = 5 * 60_000
export const VERSION_SOURCES = [
  'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  'https://bmclapi2.bangbang93.com/mc/game/version_manifest.json'
]

const systemFetch: typeof fetch = async (input, init) => {
  if (process.versions.electron) {
    const { net } = await import('electron')
    return net.fetch(input as string, init)
  }
  return fetch(input, init)
}

export function parseVersionCatalog(data: unknown): RemoteVersion[] {
  const entries = (data as { versions?: unknown[] })?.versions
  if (!Array.isArray(entries)) throw new Error('版本清单格式无效')
  const versions = entries.flatMap(value => {
    const v = value as RemoteVersion
    if (!v || typeof v.id !== 'string' || !v.id || !['release','snapshot','old_beta','old_alpha'].includes(v.type)
      || !Number.isFinite(Date.parse(v.releaseTime))) return []
    try { if (!['https:', 'http:'].includes(new URL(v.url).protocol)) return [] } catch { return [] }
    return [{ id: v.id, type: v.type, url: v.url, releaseTime: v.releaseTime }]
  })
  if (!versions.length) throw new Error('版本清单为空或损坏')
  return versions
}

/** Prefer official metadata for identical IDs; retain releases that a lagging mirror lacks. */
export function mergeVersionCatalogs(catalogs: RemoteVersion[][]): RemoteVersion[] {
  const versions = new Map<string, RemoteVersion>()
  for (const list of catalogs) for (const version of list) if (!versions.has(version.id)) versions.set(version.id, version)
  return [...versions.values()].sort((a,b) => Date.parse(b.releaseTime) - Date.parse(a.releaseTime) || b.id.localeCompare(a.id))
}

export async function fetchVersionCatalog(cacheFile: string, refresh = false, signal?: AbortSignal,
  fetcher: typeof fetch = systemFetch, now = Date.now()): Promise<VersionCatalog> {
  signal?.throwIfAborted()
  let cached: VersionCatalog | undefined
  let schema: number | undefined
  try {
    const raw = JSON.parse(await fs.promises.readFile(cacheFile, 'utf8'))
    cached = { versions: mergeVersionCatalogs([parseVersionCatalog(raw)]), checkedAt: Number(raw.checkedAt ?? raw.fetchedAt) || 0, stale: raw.stale === true }
    schema = raw.schema
  } catch { /* Re-fetch missing or invalid cache. */ }
  signal?.throwIfAborted()
  if (!refresh && schema === 2 && cached && now >= cached.checkedAt && now - cached.checkedAt < TTL) return cached
  const results = await Promise.allSettled(VERSION_SOURCES.map(async url => {
    const timeout = AbortSignal.timeout(8000)
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    const response = await fetcher(url, { signal: requestSignal, headers: { 'Cache-Control': 'no-cache' } })
    if (!response.ok) { await response.body?.cancel(); throw new Error(`清单 HTTP ${response.status}`) }
    return parseVersionCatalog(await response.json())
  }))
  signal?.throwIfAborted()
  const valid = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  if (!valid.length) {
    if (cached) return { ...cached, stale: true }
    throw new Error('无法获取版本清单，请检查网络后重试')
  }
  // Keep known versions during mirror outages, but newer live official data wins duplicates.
  const versions = mergeVersionCatalogs([...valid, ...(cached ? [cached.versions] : [])])
  const catalog = { versions, checkedAt: now, stale: results[0].status !== 'fulfilled' }
  await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true })
  const temporary = cacheFile + '.' + crypto.randomUUID() + '.tmp'
  try {
    await fs.promises.writeFile(temporary, JSON.stringify({ schema: 2, ...catalog }))
    signal?.throwIfAborted()
    await fs.promises.rename(temporary, cacheFile)
  } finally { await fs.promises.rm(temporary, { force: true }) }
  return catalog
}
