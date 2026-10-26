import AdmZip from 'adm-zip'

export interface PreparedResourcePack {
  /** Original archives stay in the content-addressed cache; only this copy is used by Minecraft. */
  data: Buffer
  metadata: Record<string, unknown>
  wrapped: boolean
}

function entryPath(raw: string, directory: boolean): string {
  if (!raw || /[\x00-\x1f]/.test(raw)) throw new Error('材质包包含无效文件名')
  const slash = raw.replace(/\\/g, '/')
  if (/^(?:\/|[A-Za-z]:)/.test(slash)) throw new Error('材质包包含绝对路径')
  const clean = slash.replace(/^(?:\.\/)+/, '').replace(/\/$/, '')
  if (!clean || clean.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) throw new Error('材质包包含不安全或含糊的路径')
  return clean + (directory ? '/' : '')
}

function metadata(entry: AdmZip.IZipEntry, name: string): Record<string, unknown> {
  try {
    if (!Number.isSafeInteger(entry.header.size) || entry.header.size <= 0 || entry.header.size > 1024 * 1024 || entry.header.compressedSize > 2 * 1024 * 1024) throw new Error('pack.mcmeta 大小无效')
    const data = entry.getData()
    if (data.length !== entry.header.size) throw new Error('pack.mcmeta 大小不符')
    const json = JSON.parse(data.toString('utf8').replace(/^\uFEFF/, ''))
    // Minecraft text components and major/minor-only metadata are intentional:
    // never require a plain string description or the deprecated pack_format.
    if (!json?.pack || typeof json.pack !== 'object' || Array.isArray(json.pack)) throw new Error('pack 对象无效')
    return json.pack
  } catch { throw new Error(`${name} 缺少有效或可读取的 pack.mcmeta`) }
}

/** Accept a unique directory-wrapped pack without dropping any payload files.
 * Prefix removal rewrites ZIP headers while retaining compressed asset bytes;
 * ordinary root ZIPs remain byte-for-byte unchanged. Distribution bundles with
 * several packs or files outside the sole pack are not guessed or merged.
 */
export function prepareResourcePackArchive(data: Buffer, name: string): PreparedResourcePack {
  let zip: AdmZip
  try { zip = new AdmZip(data) } catch { throw new Error(`${name} 不是可读取的 ZIP 材质包`) }
  const entries = zip.getEntries(), seen = new Set<string>()
  const files = entries.map(entry => {
    const relative = entryPath(entry.entryName, entry.isDirectory), key = relative.replace(/\/$/, '')
    if (seen.has(key)) throw new Error(`${name} 包含重复或冲突的文件路径：${relative}`)
    seen.add(key)
    const mode = (entry.attr >>> 16) & 0o170000
    if (mode === 0o120000 || (mode && mode !== 0o100000 && mode !== 0o040000)) throw new Error(`${name} 包含符号链接或特殊文件`)
    if (entry.header.flags & 0x41) throw new Error(`${name} 是加密材质包，请先解密后导入`)
    if (![0, 8].includes(entry.header.method)) throw new Error(`${name} 使用不支持的 ZIP 压缩方式`)
    if (!Number.isSafeInteger(entry.header.size) || entry.header.size < 0 || entry.getCompressedData().length !== entry.header.compressedSize) throw new Error(`${name} 的 ZIP 数据不完整`)
    if (entry.isDirectory && entry.header.size !== 0) throw new Error(`${name} 的目录条目含有文件数据`)
    return { entry, relative }
  })
  const candidates = files.filter(file => !file.entry.isDirectory && (file.relative === 'pack.mcmeta' || file.relative.endsWith('/pack.mcmeta')))
  // A pack can legitimately carry nested metadata as ordinary assets or overlays.
  // Only mutually independent outermost roots identify separate bundled packs.
  const roots = candidates.filter(candidate => !candidates.some(ancestor => ancestor !== candidate && candidate.relative.startsWith(ancestor.relative.slice(0, -'pack.mcmeta'.length))))
  if (!roots.length) throw new Error(`${name} 缺少有效或可读取的 pack.mcmeta`)
  if (roots.length !== 1) throw new Error(`${name} 包含多个材质包，请解压后分别导入需要的 ZIP`)
  const root = roots[0], pack = metadata(root.entry, name), prefix = root.relative.slice(0, -'pack.mcmeta'.length)
  if (prefix && files.some(file => !file.relative.startsWith(prefix) && !(file.entry.isDirectory && prefix.startsWith(file.relative))))
    throw new Error(`${name} 在材质包目录以外还包含文件，请解压后选择实际材质包；未丢弃其他内容`)
  const changed = !!prefix || files.some(file => file.relative !== file.entry.entryName)
  if (!changed) return { data, metadata: pack, wrapped: false }
  for (const file of files) {
    if (file.entry.isDirectory && prefix.startsWith(file.relative)) zip.deleteEntry(file.entry.entryName)
    else file.entry.entryName = file.relative.slice(prefix.length)
  }
  const normalized = zip.toBuffer()
  // Re-read through the same ZIP parser before a normalized copy can be staged.
  const check = new AdmZip(normalized), normalizedEntries = check.getEntries()
  if (normalizedEntries.filter(entry => !entry.isDirectory).length !== files.filter(file => !file.entry.isDirectory).length || !check.getEntry('pack.mcmeta'))
    throw new Error(`${name} 的目录包装转换未保留全部文件`)
  return { data: normalized, metadata: pack, wrapped: !!prefix }
}
