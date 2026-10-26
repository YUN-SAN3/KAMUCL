import type { InstalledVersion, LoaderName, ModInfo } from './types'

export function normalizeLoader(value: unknown): LoaderName | undefined {
  const key = String(value ?? '').trim().toLowerCase().replace(/[-_\s]/g, '')
  return ({ neoforge: 'neoforge', neoforged: 'neoforge', forge: 'forge', fabric: 'fabric', fabricloader: 'fabric', quilt: 'quilt', quiltloader: 'quilt' } as Record<string, LoaderName>)[key]
}

export function normalizeLoaderVersion(value: string, loader?: LoaderName, mc?: string): string {
  let version = value.trim().replace(/^(?:neoforge|forge|fabric(?:-loader)?|quilt(?:-loader)?)[\s:_-]+/i, '').replace(/^v(?=\d)/i, '')
  if (loader === 'forge' && mc && version.startsWith(mc + '-')) version = version.slice(mc.length + 1)
  return version
}

/** Numeric components are not limited to semver's three fields (e.g. NeoForge 26.2.0.66).
 * Unknown/non-numeric versions remain distinct, never coerced to zero. */
export function compareVersions(a: string, b: string): number {
  // Fabric's empty prerelease (`1.21-`) is the earliest version in that series.
  const parse = (v: string) => /^(\d+(?:\.\d+)*)(?:-([^+]*))?(?:\+.*)?$/.exec(v.trim())
  const x = parse(a), y = parse(b)
  if (!x || !y) return a === b ? 0 : a < b ? -1 : 1
  const xs = x[1].split('.').map(Number), ys = y[1].split('.').map(Number)
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    const d = (xs[i] ?? 0) - (ys[i] ?? 0)
    if (d) return Math.sign(d)
  }
  if (x[2] === undefined || y[2] === undefined) return x[2] === y[2] ? 0 : x[2] === undefined ? 1 : -1
  if (!x[2] || !y[2]) return x[2] === y[2] ? 0 : !x[2] ? -1 : 1
  const xp = x[2].split(/[.-]/), yp = y[2].split(/[.-]/)
  for (let i = 0; i < Math.max(xp.length, yp.length); i++) {
    const p = xp[i], q = yp[i]
    if (p === q) continue
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q)
    if (pn && qn) return Math.sign(Number(p) - Number(q))
    if (pn !== qn) return pn ? -1 : 1
    return p < q ? -1 : 1
  }
  return 0
}

function predicate(range: string, version: string): boolean {
  if (range === '*') return true
  const m = /^(>=|<=|>|<|=|~|\^)?([^\s,()[\]]+)$/.exec(range)
  if (!m) return false
  const op = m[1] ?? '=', base = m[2]
  const parts = base.split('.')
  const wild = parts.findIndex(p => /^(x|\*)$/i.test(p))
  if (wild >= 0) return op === '=' && parts.slice(wild).every(p => /^(x|\*)$/i.test(p)) && parts.slice(0, wild).every((p, i) => p === version.split('.')[i])
  const c = compareVersions(version, base)
  if (op === '=') return c === 0
  if (op === '>') return c > 0
  if (op === '>=') return c >= 0
  if (op === '<') return c < 0
  if (op === '<=') return c <= 0
  if (!/^\d+(?:\.\d+)*(?:-[\w.-]+)?$/.test(base)) return false
  const nums = base.split('-')[0].split('.').map(Number)
  const index = op === '~' ? Math.min(1, nums.length - 1) : Math.max(0, nums.findIndex(n => n !== 0) < 0 ? nums.length - 1 : nums.findIndex(n => n !== 0))
  const upper = nums.slice(0, index + 1)
  upper[index]++
  return c >= 0 && compareVersions(version, upper.join('.')) < 0
}

/** CurseForge-style hyphen ranges: `1.20.1-1.20.4` / `1.20.1 - 1.20.4`, inclusive on both ends.
 * The right side must start with a digit so prerelease tags (`26.1.2.65-beta`) never match. */
const HYPHEN_RANGE = /^(\d+(?:\.\d+)*)\s*-\s*(\d+(?:\.\d+)*)$/

/** A hyphen range written INSIDE a Maven interval bound (`[1.20.1-1.20.4,)`):
 * lower bound takes the low end, upper bound takes the high end. */
function expandBound(value: string, pick: 'lo' | 'hi'): string {
  const m = HYPHEN_RANGE.exec(value)
  return m ? (pick === 'lo' ? m[1] : m[2]) : value
}

/** Maven interval unions, Fabric/Quilt OR alternatives and AND predicates.
 * A comma inside an interval is NEVER an alternative separator. Malformed ranges fail closed. */
export function matchesVersionRange(range: string, version: string): boolean {
  const r = (range ?? '').trim()
  if (!version || version === '未知') return false
  if (!r || r === '*') return true
  if (r.includes('||')) return r.split('||').some(part => !!part.trim() && matchesVersionRange(part, version))
  if (r.includes(' && ')) return r.split(' && ').every(part => !!part.trim() && matchesVersionRange(part, version))
  const hyphen = HYPHEN_RANGE.exec(r)
  if (hyphen) return compareVersions(version, hyphen[1]) >= 0 && compareVersions(version, hyphen[2]) <= 0
  if (/^[[(]/.test(r)) {
    const intervals = r.match(/[[(][^()[\]]*[)\]]/g)
    if (!intervals || intervals.join(',').replace(/\s/g, '') !== r.replace(/\s/g, '')) return false
    return intervals.some(interval => {
      const body = interval.slice(1, -1).trim()
      if (!body.includes(',')) return interval[0] === '[' && interval.endsWith(']') && !!body && compareVersions(version, expandBound(body, 'lo')) === 0
      const bounds = body.split(',').map(s => s.trim())
      if (bounds.length !== 2 || (!bounds[0] && !bounds[1])) return false
      const [lo, hi] = [expandBound(bounds[0], 'lo'), expandBound(bounds[1], 'hi')]
      if (lo && hi && compareVersions(lo, hi) > 0) return false
      const low = lo ? compareVersions(version, lo) : 1
      const high = hi ? compareVersions(version, hi) : -1
      // 开区间上界「补丁延伸」宽容：上界是下界补一段补丁段的延伸（如 [1.21,1.21.1)
      // 下界 1.21 是上界 1.21.1 的前缀截断）时纳入上界——社区 mods.toml 常见笔误，
      // 作者意图为整个 1.21.x 系列。次版本截止（[26.2.0.57,26.3)）不受影响。
      const extendsByPatch = (() => {
        if (!lo || !hi) return false
        const lp = lo.split('.')
        const hp = hi.split('.')
        return hp.length > lp.length && hp.slice(0, lp.length).join('.') === lp.join('.')
      })()
      return (low > 0 || low === 0 && interval[0] === '[') &&
        (high < 0 || high === 0 && (interval.endsWith(']') || extendsByPatch))
    })
  }
  return r.replace(/(>=|<=|>|<|=|~|\^)\s+/g, '$1').split(/\s+/).every(part => predicate(part, version))
}

/** Metadata arrays express OR, not comma-delimited Maven intervals. */
export function dependencyRange(value: unknown, dialect: 'fabric' | 'quilt' = 'fabric'): string {
  // Fabric ^ always advances the major, including 0.x; generic/Quilt semver
  // predicates retain their own behavior. Upper bounds exclude the next prereleases.
  const fabricPredicate = (part: string): string => {
    const m = /^(\^|~)(\d+(?:\.\d+)*)(?:-[^+]*)?(?:\+.*)?$/.exec(part)
    if (m) {
      const nums = m[2].split('.').map(Number), index = m[1] === '^' ? 0 : Math.min(1, nums.length - 1)
      const upper = nums.slice(0, index + 1); upper[index]++
      return `>=${part.slice(1)} <${upper.join('.')}-`
    }
    const wildcard = /^(\d+(?:\.\d+)*)\.(?:x|\*)(?:\.(?:x|\*))*$/i.exec(part)
    if (wildcard) {
      const upper = wildcard[1].split('.').map(Number); upper[upper.length - 1]++
      return `>=${wildcard[1]}- <${upper.join('.')}-`
    }
    return part
  }
  // Normalize nested any/all to bounded disjunctive normal form. Flattening with
  // join alone changes (A OR B) AND C into A OR (B AND C).
  const terms = (v: unknown, depth = 0): string[][] => {
    if (depth > 16) throw new Error('range too deep')
    if (typeof v === 'string') {
      const range = dialect === 'fabric' ? v.trim().replace(/(>=|<=|>|<|=|~|\^)\s+/g, '$1').split(/\s+/).map(fabricPredicate).join(' ') : v.trim()
      const normalized = dialect === 'quilt' && /^\d+(?:\.\d+)*(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(range) ? '^' + range : range
      return normalized.split('||').map(part => part.trim().split(' && '))
    }
    if (v == null) return [['*']]
    const obj = v as { any?: unknown[]; all?: unknown[] }
    const any = Array.isArray(v) ? v : obj.any
    if (Array.isArray(any)) {
      if (!any.length || any.length > 128) throw new Error('invalid alternatives')
      const result = any.flatMap(part => terms(part, depth + 1))
      if (result.length > 128) throw new Error('range too large')
      return result
    }
    if (Array.isArray(obj.all) && obj.all.length && obj.all.length <= 128) {
      let result: string[][] = [[]]
      for (const part of obj.all) {
        const next = terms(part, depth + 1)
        if (result.length * next.length > 128) throw new Error('range too large')
        result = result.flatMap(a => next.map(b => [...a, ...b]))
      }
      return result
    }
    throw new Error('unsupported range')
  }
  if (value == null) return ''
  try { return terms(value).map(term => term.join(' && ')).join(' || ') }
  catch { return '!unsupported-range!' }
}

export function modMatchesInstance(mod: Pick<ModInfo, 'loader' | 'mcRange' | 'loaderRange' | 'error' | 'variants'>, instance: InstalledVersion): boolean {
  const loader = normalizeLoader(instance.loader)
  if (mod.error || instance.failed || instance.incomplete || !loader) return false
  const specs = (mod.variants?.length ? mod.variants : [mod]).filter(spec => loader === normalizeLoader(spec.loader))
  return specs.length > 0 && specs.every(spec =>
    matchesVersionRange(spec.mcRange, instance.mcVersion) &&
    (!spec.loaderRange || matchesVersionRange(spec.loaderRange, normalizeLoaderVersion(instance.loaderVersion ?? '', loader, instance.mcVersion))))
}

/** A version ID is only unique INSIDE one registered game folder. */
export const instanceKey = (instance: Pick<InstalledVersion, 'id' | 'folder'>): string => JSON.stringify([instance.folder ?? '', instance.id])

/** Explain the same semantic checks used for installation; never guess from labels. */
export function modMismatchReasons(mod: ModInfo, instance: InstalledVersion): string[] {
  if (mod.error) return [mod.error]
  if (instance.failed || instance.incomplete) return ['实例安装不完整或元数据无法读取']
  const loader = normalizeLoader(instance.loader)
  const specs = (mod.variants?.length ? mod.variants : [mod]).filter(s => loader && loader === normalizeLoader(s.loader))
  if (!specs.length) return [`需要 ${mod.loader ?? '已声明的加载器'}，实例为 ${loader ?? '纯净版/未知'}`]
  const reasons = specs.flatMap(s => [
    ...(!matchesVersionRange(s.mcRange, instance.mcVersion) ? [`Minecraft ${instance.mcVersion} 不满足 ${s.mcRange}（方括号含边界，圆括号不含边界）`] : []),
    ...(s.loaderRange && !matchesVersionRange(s.loaderRange, normalizeLoaderVersion(instance.loaderVersion ?? '', loader, instance.mcVersion)) ? [`${loader} ${instance.loaderVersion || '版本未知'} 不满足 ${s.loaderRange}`] : [])
  ])
  return [...new Set(reasons)]
}
