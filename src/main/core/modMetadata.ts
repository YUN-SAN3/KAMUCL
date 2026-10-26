import AdmZip from 'adm-zip'
import { parse as parseToml } from '@iarna/toml'
import { dependencyRange } from '../../shared/modCompatibility'
import type { LoaderName, ModInfo, ModRequirement } from '../../shared/types'

const builtins = new Set(['minecraft', 'forge', 'neoforge', 'fabricloader', 'quilt_loader', 'java'])
type RecordValue = Record<string, any>

/** Real TOML parser: comments, single quotes, multiline descriptions and quoted table names
 * must not become part of a Maven version range. Never evaluate metadata expressions. */
export function parseModArchive(zip: AdmZip, filePath: string, fileName: string, depth = 0, includeIcons = true): ModInfo {
  const info: ModInfo = { filePath, fileName, id: '', name: '', version: '', loader: null, mcRange: '', dependencies: [] }
  const read = (name: string) => {
    const entry = zip.getEntry(name)
    if (!entry) return undefined
    if (entry.header.size > 2 * 1024 * 1024) throw new Error(`${name} 元数据过大`)
    return zip.readAsText(entry).replace(/^\uFEFF/, '')
  }
  const records: Array<{ loader: LoaderName; id: string; name: string; version: string; mcRange: string; loaderRange: string; requirements: ModRequirement[]; icon?: string }> = []
  const provides: Array<{ id: string; version: string }> = []
  const nested: string[] = []
  const javaRequirements: NonNullable<ModInfo['javaRequirements']> = []
  const requirements = (deps: RecordValue, dialect: 'fabric' | 'quilt' = 'fabric'): ModRequirement[] => Object.entries(deps)
    .filter(([id]) => !builtins.has(id)).map(([id, range]) => ({ id, range: dependencyRange(range, dialect) }))
  try {
    const fabric = read('fabric.mod.json')
    if (fabric) {
      const j = JSON.parse(fabric), dep = j.depends ?? {}
      if (j.environment !== 'server') {
        if (dep.java !== undefined) javaRequirements.push({ loader: 'fabric', source: `${fileName}: ${j.id}`, range: dependencyRange(dep.java) })
        if (j.breaks?.java !== undefined) javaRequirements.push({ loader: 'fabric', source: `${fileName}: ${j.id}`, range: dependencyRange(j.breaks.java), exclude: true })
      }
      records.push({ loader: 'fabric', id: j.id, name: j.name ?? j.id, version: String(j.version ?? ''), mcRange: dependencyRange(dep.minecraft), loaderRange: dependencyRange(dep.fabricloader), requirements: requirements(dep), icon: typeof j.icon === 'string' ? j.icon : Object.values(j.icon ?? {})[0] as string })
      for (const id of j.provides ?? []) if (typeof id === 'string') provides.push({ id, version: String(j.version ?? '') })
      nested.push(...(j.jars ?? []).map((v: { file: string }) => v.file))
    }
    const quilt = read('quilt.mod.json')
    if (quilt) {
      const j = JSON.parse(quilt).quilt_loader ?? {}
      const deps: RecordValue = {}
      for (const raw of j.depends ?? []) {
        const d = typeof raw === 'string' ? { id: raw, versions: '*' } : raw
        // Do not silently treat unsupported conditional dependencies as satisfied.
        if (Array.isArray(d) || d?.unless) throw new Error('Quilt 条件前置需要手动检查；未自动安装')
        if (d && typeof d.id === 'string' && !d.optional && d.environment !== 'server') {
          const id = d.id.split(':').pop()!
          deps[id] = deps[id] === undefined ? d.versions ?? '*' : { all: [deps[id], d.versions ?? '*'] }
        }
      }
      records.push({ loader: 'quilt', id: j.id, name: j.metadata?.name ?? j.id, version: String(j.version ?? ''), mcRange: dependencyRange(deps.minecraft, 'quilt'), loaderRange: dependencyRange(deps.quilt_loader, 'quilt'), requirements: requirements(deps, 'quilt'), icon: j.metadata?.icon })
      if (deps.java !== undefined) javaRequirements.push({ loader: 'quilt', source: `${fileName}: ${j.id}`, range: dependencyRange(deps.java, 'quilt') })
      for (const p of j.provides ?? []) provides.push({ id: (typeof p === 'string' ? p : p.id).split(':').pop(), version: String(p.version ?? j.version ?? '') })
      nested.push(...(j.jars ?? []).map((v: string | { file: string }) => typeof v === 'string' ? v : v.file))
    }
    for (const file of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
      const text = read(file)
      if (!text) continue
      const j = parseToml(text) as RecordValue
      if (!Array.isArray(j.mods) || !j.mods.length) throw new Error(`${file} 缺少 [[mods]]`)
      const deps = Object.values(j.dependencies ?? {}).flat() as RecordValue[]
      const loader: LoaderName = file.includes('neoforge') || deps.some(d => d.modId === 'neoforge') ? 'neoforge' : 'forge'
      const required = deps.filter(d => d.mandatory !== false && (!d.type || d.type === 'required') && String(d.side ?? 'BOTH').toUpperCase() !== 'SERVER')
      const manifest = read('META-INF/MANIFEST.MF') ?? ''
      const jarVersion = /^Implementation-Version:\s*(.+)$/mi.exec(manifest)?.[1].trim() ?? ''
      for (const m of j.mods) {
        const own = (j.dependencies?.[m.modId] ?? []).filter((d: RecordValue) => required.includes(d)) as RecordValue[]
        const version = String(m.version ?? '').replace(/\$\{file.jarVersion\}/g, jarVersion)
        provides.push({ id: m.modId, version })
        const javaRange = j.features?.[m.modId]?.java_version
        if (typeof javaRange === 'string') javaRequirements.push({ loader, source: `${fileName}: ${m.modId}`, range: javaRange })
        for (const d of own.filter(d => d.modId === 'java')) javaRequirements.push({ loader, source: `${fileName}: ${m.modId}`, range: d.versionRange ?? '*' })
        records.push({ loader, id: m.modId, name: m.displayName ?? m.modId, version,
          mcRange: own.filter(d => d.modId === 'minecraft').map(d => d.versionRange ?? '*').join(' && '),
          loaderRange: own.filter(d => d.modId === loader).map(d => d.versionRange ?? '*').join(' && ') || (loader === 'forge' && /^(javafml|lowcodefml)$/.test(j.modLoader ?? '') ? j.loaderVersion ?? '' : ''),
          requirements: own.filter(d => !builtins.has(d.modId)).map(d => ({ id: d.modId, range: d.versionRange ?? '*' })), icon: m.logoFile ?? j.logoFile })
      }
    }
    if (!records.length) {
      const legacy = read('mcmod.info')
      if (legacy) {
        const j = JSON.parse(legacy), mods = Array.isArray(j) ? j : j.modList
        for (const m of mods ?? []) {
          const req = (m.requiredMods ?? m.dependencies ?? []).filter((s: unknown) => typeof s === 'string').map((s: string) => {
            const [id, range = '*'] = s.replace(/^required-(?:after|before):/, '').split('@')
            return { id, range }
          }).filter((d: ModRequirement) => !builtins.has(d.id))
          records.push({ loader: 'forge', id: m.modid, name: m.name ?? m.modid, version: String(m.version ?? ''), mcRange: m.mcversion ?? '', loaderRange: '', requirements: req })
          provides.push({ id: m.modid, version: String(m.version ?? '') })
        }
      }
    }
    if (!records.length || !records[0].id) throw new Error('未找到有效的 MOD 元数据 / mod id')
    const first = records[0]
    Object.assign(info, first, { dependencies: first.requirements.map(d => d.id) })
    info.variants = records.map(r => ({ loader: r.loader, mcRange: r.mcRange, loaderRange: r.loaderRange, requirements: r.requirements }))
    provides.push(...records.map(r => ({ id: r.id, version: r.version })))
    const jarjar = read('META-INF/jarjar/metadata.json')
    if (jarjar) nested.push(...(JSON.parse(jarjar).jars ?? []).map((j: RecordValue) => j.path))
    if (depth < 3) for (const name of [...new Set(nested)].slice(0, 64)) {
      const e = zip.getEntry(name)
      if (!e || e.header.size > 64 * 1024 * 1024) continue
      try {
        // Nested archives only contribute dependency identities, never icons.
        const child = parseModArchive(new AdmZip(zip.readFile(e)!), filePath, name, depth + 1, false)
        provides.push(...child.provides ?? [])
        javaRequirements.push(...(child.javaRequirements ?? []).map(r => ({ ...r, source: `${fileName} > ${r.source}` })))
      } catch { /* Invalid optional nested content cannot supply a prerequisite. */ }
    }
    info.provides = [...new Map(provides.filter(p => p.id).map(p => [p.id, p])).values()]
    if (javaRequirements.length) info.javaRequirements = javaRequirements
    if (includeIcons && typeof first.icon === 'string') {
      const e = zip.getEntry(first.icon)
      if (e && e.header.size <= 512 * 1024) info.iconDataUrl = `data:image/png;base64,${zip.readFile(e)?.toString('base64')}`
    }
  } catch (error) { info.error = error instanceof Error ? error.message : String(error) }
  return info
}
