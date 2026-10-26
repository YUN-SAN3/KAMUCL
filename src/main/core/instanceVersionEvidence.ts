import fs from 'node:fs'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'
import type { VersionJson } from './versions'
import { isMinecraftVersionId } from './instanceMetadata'

const cached = new Map<string, { identity: string; version?: string }>()
const MAX_METADATA = 64 * 1024
function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Read only ZIP directory headers and the small client version.json, never the whole client JAR.
 * Missing/old/ZIP64/malformed metadata is not grounds to invent a Minecraft version. */
export function readClientVersionEvidence(file: string): string | undefined {
  let handle: number | undefined
  try {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink()) return undefined
    const identity = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
    const previous = cached.get(file)
    if (previous?.identity === identity) return previous.version
    handle = fs.openSync(file, 'r')
    const read = (offset: number, size: number): Buffer => {
      if (offset < 0 || size < 0 || offset + size > stat.size) throw new Error('Invalid ZIP boundary')
      const bytes = Buffer.alloc(size)
      if (fs.readSync(handle!, bytes, 0, size, offset) !== size) throw new Error('Truncated ZIP')
      return bytes
    }
    const tail = read(Math.max(0, stat.size - 65557), Math.min(stat.size, 65557))
    let end = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break }
    }
    if (end < 0 || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6)) return undefined
    const count = tail.readUInt16LE(end + 10), length = tail.readUInt32LE(end + 12)
    let cursor = tail.readUInt32LE(end + 16)
    if (count === 0xffff || length === 0xffffffff || cursor === 0xffffffff || cursor + length > stat.size) return undefined
    const limit = cursor + length
    let version: string | undefined
    for (let index = 0; index < count; index++) {
      const central = read(cursor, 46)
      if (central.readUInt32LE(0) !== 0x02014b50) throw new Error('Invalid ZIP directory')
      const nameSize = central.readUInt16LE(28)
      const next = cursor + 46 + nameSize + central.readUInt16LE(30) + central.readUInt16LE(32)
      if (next > limit) throw new Error('Invalid ZIP entry')
      const name = read(cursor + 46, nameSize).toString('utf8')
      cursor = next
      if (name !== 'version.json') continue
      const compressed = central.readUInt32LE(20), expanded = central.readUInt32LE(24), method = central.readUInt16LE(10)
      if (central.readUInt16LE(8) & 1 || compressed > MAX_METADATA || expanded > MAX_METADATA || ![0, 8].includes(method)) break
      const offset = central.readUInt32LE(42), local = read(offset, 30)
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(8) !== method) break
      const localNameSize = local.readUInt16LE(26)
      if (read(offset + 30, localNameSize).toString('utf8') !== name) break
      const body = read(offset + 30 + localNameSize + local.readUInt16LE(28), compressed)
      const data = method === 8 ? inflateRawSync(body, { maxOutputLength: MAX_METADATA }) : body
      if (data.length !== expanded || crc32(data) !== central.readUInt32LE(16)) break
      const id = JSON.parse(data.toString('utf8').replace(/^\uFEFF/, '')).id
      if (isMinecraftVersionId(id)) version = id
      break
    }
    cached.set(file, { identity, version })
    if (cached.size > 32) cached.delete(cached.keys().next().value!)
    return version
  } catch { return undefined }
  finally { if (handle !== undefined) fs.closeSync(handle) }
}

/** Match an installed flattened profile against local vanilla descriptors by exact client hash.
 * Asset index IDs and version display names are not unique game-version evidence. */
export function cachedClientVersionEvidence(chain: readonly VersionJson[], roots: readonly string[]): string | undefined {
  const hash = chain.find(json => /^[a-f\d]{40}$/i.test(json.downloads?.client?.sha1 ?? ''))?.downloads?.client?.sha1?.toLowerCase()
  if (!hash) return undefined
  const matches = new Set<string>()
  for (const root of new Set(roots)) {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      try {
        const file = path.join(root, entry.name, `${entry.name}.json`)
        if (fs.lstatSync(file).isSymbolicLink()) continue
        const json = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as VersionJson
        if (!json.inheritsFrom && !json._loader && isMinecraftVersionId(json.id) && json.downloads?.client?.sha1?.toLowerCase() === hash) matches.add(json.id)
      } catch { /* Missing/corrupt cached descriptors do not change instance files. */ }
    }
  }
  return matches.size === 1 ? [...matches][0] : undefined
}
