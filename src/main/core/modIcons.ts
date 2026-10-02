import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { app } from 'electron'
import { resolveResourceDirectory } from './resourceDirectory'
import { scanModDirectory } from './modScan'
import { cfChannel } from './community'
import { httpFetch } from './httpClient'

type Identity = { fileName: string; sha1: string; fingerprint?: number; iconDataUrl?: string }
type JsonRequest = (url: string, body?: unknown, headers?: Record<string, string>) => Promise<any>
const MR = 'https://api.modrinth.com/v2'
const UA = { 'User-Agent': 'KAMUCL (github.com/kamubaba-i/KAMUCL)' }
async function request(url: string, body?: unknown, headers = {}): Promise<any> {
  const response = await httpFetch(url, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
    headers: { ...UA, 'Content-Type': 'application/json', ...headers }, signal: AbortSignal.timeout(8000) })
  if (!response.ok) { await response.body?.cancel(); throw new Error('HTTP ' + response.status) }
  return response.json()
}
/** Exact file identity only: never choose an unrelated project by fuzzy filename search. */
export async function matchModIcons(items: Identity[], json: JsonRequest = request, channel = cfChannel()): Promise<Record<string, string>> {
  const icons: Record<string, string> = Object.create(null)
  try {
    const versions = await json(MR + '/version_files', { hashes: items.map(i => i.sha1), algorithm: 'sha1' })
    const ids = [...new Set(items.map(i => versions[i.sha1]?.project_id).filter(Boolean))]
    if (ids.length) {
      const projects = await json(MR + '/projects?ids=' + encodeURIComponent(JSON.stringify(ids)))
      for (const item of items) {
        const project = projects.find((p: any) => p.id === versions[item.sha1]?.project_id)
        if (project?.icon_url) icons[item.fileName] = project.icon_url
      }
    }
  } catch { /* Offline/API failure must not prevent local resource browsing. */ }
  const missing = items.filter(i => !icons[i.fileName] && i.fingerprint != null)
  if (missing.length) try {
    const headers: Record<string, string> = channel.key ? { 'x-api-key': channel.key } : {}
    const matches = await json(channel.base + '/fingerprints', { fingerprints: missing.map(i => i.fingerprint) }, headers)
    const exact = (matches.data?.exactMatches ?? []).filter((m: any) => missing.some(i =>
      i.fingerprint === m.file?.fileFingerprint && m.file?.hashes?.some((h: any) => h.algo === 1 && h.value?.toLowerCase() === i.sha1)))
    const ids = [...new Set(exact.map((m: any) => m.file.modId ?? m.id))]
    if (ids.length) {
      const projects = await json(channel.base + '/mods', { modIds: ids }, headers)
      for (const item of missing) {
        const match = exact.find((m: any) => m.file.hashes.some((h: any) => h.algo === 1 && h.value?.toLowerCase() === item.sha1))
        const project = projects.data?.find((p: any) => p.id === (match?.file.modId ?? match?.id))
        if (project?.logo?.thumbnailUrl) icons[item.fileName] = project.logo.thumbnailUrl
      }
    }
  } catch { /* Fall back to embedded icon. */ }
  return icons
}
async function imageData(url: string): Promise<string> {
  const u = new URL(url)
  if (u.protocol !== 'https:' || !['cdn.modrinth.com', 'cdn-raw.modrinth.com', 'media.forgecdn.net', 'mediafilez.forgecdn.net'].includes(u.hostname)) return ''
  const response = await httpFetch(url, { signal: AbortSignal.timeout(8000), headers: UA })
  const type = response.headers.get('content-type')?.split(';')[0] || ''
  if (!response.ok || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) { await response.body?.cancel(); return '' }
  const reader = response.body!.getReader(), chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 512 * 1024) return ''; chunks.push(value) }
    return 'data:' + type + ';base64,' + Buffer.concat(chunks).toString('base64')
  } finally { await reader.cancel().catch(() => undefined) }
}
let queue: Promise<unknown> = Promise.resolve()
export function getModIcons(version: string, folder: string, requested: string[], kind = 'mods'): Promise<Record<string, string>> {
  const names = [...new Set(requested)].filter(n => typeof n === 'string' && path.basename(n) === n && !/[\\/:\0]/.test(n) && /\.(?:jar(?:\.disabled)?|zip)$/i.test(n)).slice(0, 100)
  const job = queue.catch(() => undefined).then(async () => {
    const dir = await resolveResourceDirectory(folder, version, kind)
    const cacheDir = path.join(app.getPath('userData'), 'cache', 'mod-icons-v1')
    await fs.promises.mkdir(cacheDir, { recursive: true })
    const result: Record<string, string> = Object.create(null), todo: string[] = [], keys = new Map<string, string>()
    for (const name of names) try {
      const stat = await fs.promises.lstat(path.join(dir, name)); if (!stat.isFile()) continue
      const key = crypto.createHash('sha256').update(JSON.stringify([dir, name, stat.size, stat.mtimeMs, stat.ctimeMs])).digest('hex')
      keys.set(name, path.join(cacheDir, key + '.json'))
      let cache: any; try { cache = JSON.parse(await fs.promises.readFile(keys.get(name)!, 'utf8')) } catch {}
      if (cache?.expires > Date.now()) result[name] = cache.icon || ''
      else todo.push(name)
    } catch { /* file removed */ }
    if (!todo.length) return result
    const identities = (await scanModDirectory(dir, true, todo)).filter(i => i.sha1)
    const matches = await matchModIcons(identities)
    let next = 0
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < identities.length) {
        const info = identities[next++]; let icon = ''
        if (matches[info.fileName]) try { icon = await imageData(matches[info.fileName]) } catch {}
        const remote = !!icon
        icon ||= info.iconDataUrl || ''
        result[info.fileName] = icon
        await fs.promises.writeFile(keys.get(info.fileName)!, JSON.stringify({ icon, expires: Date.now() + (remote ? 7 * 86400000 : 60000) })).catch(() => undefined)
      }
    }))
    return result
  })
  queue = job
  return job
}
