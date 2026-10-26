import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import type { VersionJson } from './versions'

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
type Read = (url: string, signal?: AbortSignal) => Promise<string>
interface Entry { id: string; url: string; sha1: string }
function validEntry(entry: Entry, id: string): boolean {
  try { const url = new URL(entry.url); return entry.id === id && /^[a-f0-9]{40}$/i.test(entry.sha1) && url.protocol === 'https:' && ['piston-meta.mojang.com', 'launchermeta.mojang.com'].includes(url.hostname) }
  catch { return false }
}
function parseOfficial(entry: Entry, text: string): VersionJson {
  if (crypto.createHash('sha1').update(text).digest('hex') !== entry.sha1.toLowerCase()) throw new Error('官方 Java 元数据 SHA1 校验失败')
  const json = JSON.parse(text) as VersionJson
  if (json.id !== entry.id) throw new Error('官方 Java 元数据版本不一致')
  return json
}

/** Official snapshots cannot be inferred from a year/week or inherited folder
 * name. Cache the verified Mojang document for offline launches without changing
 * any player-owned version JSON. Network failures never become Java 21. */
export function createOfficialJavaReader(cacheRoot: () => string, read: Read) {
  let manifest: Entry[] | undefined
  return async function officialJava(id: string, signal?: AbortSignal): Promise<VersionJson> {
    signal?.throwIfAborted()
    const file = path.join(cacheRoot(), crypto.createHash('sha256').update(id).digest('hex') + '.json')
    try {
      const cache = JSON.parse(await fs.readFile(file, 'utf8')) as { entry: Entry; text: string }
      signal?.throwIfAborted()
      if (validEntry(cache.entry, id)) return parseOfficial(cache.entry, cache.text)
    } catch { signal?.throwIfAborted() }
    if (!manifest || !manifest.some(v => v.id === id)) {
      const raw = JSON.parse(await read(MANIFEST, signal)) as { versions: Entry[] }
      if (!Array.isArray(raw.versions)) throw new Error('官方版本清单无效')
      manifest = raw.versions
    }
    const entry = manifest.find(v => validEntry(v, id))
    if (!entry) throw new Error(`官方版本清单找不到 ${id}，无法确认 Java 需求`)
    const text = await read(entry.url, signal), json = parseOfficial(entry, text)
    signal?.throwIfAborted()
    const temporary = file + '.' + crypto.randomUUID() + '.tmp'
    try {
      await fs.mkdir(cacheRoot(), { recursive: true })
      await fs.writeFile(temporary, JSON.stringify({ entry, text })); signal?.throwIfAborted(); await fs.rename(temporary, file)
    } catch { signal?.throwIfAborted() /* An optional cache cannot block a verified runtime selection. */ }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
    return json
  }
}
