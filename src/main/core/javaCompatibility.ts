import type { VersionJson } from './versions'
import { isMinecraftVersionId, resolveInstanceMetadata } from './instanceMetadata'
import { compareVersions, matchesVersionRange } from '../../shared/modCompatibility'

export interface JavaConstraint { source: string; range: string; exclude?: boolean }
export interface JavaRequirement {
  recommendedMajor: number
  minimumMajor: number
  maximumMajor?: number
  mcVersion?: string
  source: string
  constraints: JavaConstraint[]
}

export function javaRangeMatches(range: string, version: string): boolean {
  if (range.includes('||')) return range.split('||').some(r => javaRangeMatches(r.trim(), version))
  if (range.includes(' && ')) return range.split(' && ').every(r => javaRangeMatches(r.trim(), version))
  // Java bounds must stay strict. Minecraft's existing range helper deliberately
  // tolerates certain patch-boundary typos, which is inappropriate for JVM limits.
  if (/^[[(]/.test(range)) {
    const intervals = range.match(/[[(][^()[\]]*[)\]]/g)
    if (!intervals || intervals.join(',').replace(/\s/g, '') !== range.replace(/\s/g, '')) return false
    return intervals.some(interval => {
      const bounds = interval.slice(1, -1).split(',').map(s => s.trim())
      if (bounds.length === 1) return interval[0] === '[' && interval.endsWith(']') && compareVersions(version, bounds[0]) === 0
      if (bounds.length !== 2 || !bounds.some(Boolean)) return false
      const [lo, hi] = bounds
      if (lo && hi && compareVersions(lo, hi) > 0) return false
      return (!lo || compareVersions(version, lo) > 0 || interval[0] === '[' && compareVersions(version, lo) === 0)
        && (!hi || compareVersions(version, hi) < 0 || interval.endsWith(']') && compareVersions(version, hi) === 0)
    })
  }
  return matchesVersionRange(range, version)
}

function javaMajorCandidates(ranges: string[], major: number): string[] {
  const versions = [String(major), `${major}.0.0`, `${major}.999999.999999`]
  for (const value of ranges.flatMap(range => range.match(/\d+(?:\.\d+)*/g) ?? [])) {
    const parts = value.split('.').map(Number)
    if (parts[0] !== major) continue
    versions.push(value)
    versions.push(value + '.1')
    const upper = [...parts], lower = [...parts]
    upper[upper.length - 1]++; lower[lower.length - 1]--
    if (upper[0] === major) versions.push(upper.join('.'))
    if (lower[0] === major && lower.at(-1)! >= 0) versions.push(lower.join('.'), lower.join('.') + '.999999')
  }
  return versions
}

/** Exact release bands documented by Mojang. Snapshots and future release bands
 * must use their own official javaVersion, never the digits in a display name. */
export function releaseJavaMajor(id: string): number | undefined {
  if (/^26\.1(?:\.\d+)?$/.test(id)) return 25
  if (/^(?:[ab]\d|c\d|rd-|inf-)/.test(id)) return 8
  const m = /^1\.(\d+)(?:\.(\d+))?$/.exec(id)
  if (!m) return undefined
  const minor = Number(m[1]), patch = Number(m[2] ?? 0)
  if (minor > 21) return undefined
  if (minor === 21 || minor === 20 && patch >= 5) return 21
  if (minor >= 18) return 17
  return minor === 17 ? 16 : 8
}

export function javaMinecraftVersion(json: VersionJson, verified?: string): string | undefined {
  const resolved = resolveInstanceMetadata(json, () => undefined).mcVersion
  return isMinecraftVersionId(verified) ? verified : resolved === '未知' ? undefined : resolved
}

export function declaredJavaMajor(json: VersionJson): number | undefined {
  const n = json.javaVersion?.majorVersion
  return Number.isSafeInteger(n) && n! >= 8 && n! <= 99 ? n : undefined
}

/** Forge's transformers use the ASM bundled in this profile. For example,
 * Forge added Java 25 support by upgrading ASM to 9.8 (#10664). Use actual
 * library metadata so a recent Forge build keeps its legitimate manual support.
 * https://asm.ow2.io/versions.html */
function loaderJavaConstraints(json: VersionJson, loader?: string): JavaConstraint[] {
  if (loader !== 'forge' && loader !== 'neoforge') return []
  const versions = (json.libraries ?? []).flatMap(l => {
    const m = /^org\.ow2\.asm:asm:([\d.]+)(?:$|:)/.exec(l.name ?? '')
    return m ? [m[1]] : []
  })
  if (!versions.length) return []
  const version = versions.sort(compareVersions).at(-1)!
  if (compareVersions(version, '9.11') > 0) return [] // Future ASM support is unknown.
  const bands: Array<[string, number]> = [['9.11', 28], ['9.10', 27], ['9.9', 26], ['9.8', 25], ['9.7.1', 24], ['9.7', 23], ['9.6', 22], ['9.5', 21], ['9.4', 20], ['9.3', 19], ['9.2', 18], ['9.1', 17], ['9.0', 16]]
  const support = bands.find(([minimum]) => compareVersions(version, minimum) >= 0)?.[1]
  return support ? [{ source: `加载器 ASM ${version}`, range: `<${support + 1}` }] : []
}

export function buildJavaRequirement(json: VersionJson, verified?: string, official?: VersionJson,
  constraints: JavaConstraint[] = []): JavaRequirement {
  const mcVersion = javaMinecraftVersion(json, verified)
  const canonical = official && declaredJavaMajor(official)
  const officialTime = Date.parse((official as (VersionJson & { releaseTime?: string }) | undefined)?.releaseTime ?? '')
  // Mojang profiles before 21w19a predate the javaVersion field and use the
  // legacy Java 8 runtime. The date comes only from the verified official JSON.
  const officialLegacy = official && Number.isFinite(officialTime) && officialTime < Date.parse('2021-05-12T00:00:00Z') ? 8 : undefined
  const release = mcVersion && releaseJavaMajor(mcVersion)
  // A custom profile may declare a JVM requirement when its game identity is
  // unknown. Do not let an inherited/copied javaVersion override a known release.
  const major = canonical || release || officialLegacy || (!mcVersion ? declaredJavaMajor(json) : undefined)
  if (!major) throw new Error(`无法确认 ${mcVersion ?? json.id} 的 Java 需求；请补全官方版本元数据或在实例元数据中声明 Java 版本。`)
  const loader = resolveInstanceMetadata(json, () => undefined).loader
  const allConstraints = [...loaderJavaConstraints(json, loader), ...constraints]
  // Standard legacy Forge/LaunchWrapper casts the system class loader to
  // URLClassLoader, which Java 9 removed. Do not invent an upper limit for
  // ModLauncher-era Forge or modern loaders supporting manually chosen JVMs.
  const replacementBootstrap = (json.libraries ?? []).some(l => /(?:cleanroom|lwjgl3ify)/i.test(l.name ?? '')) || /cleanroom/i.test(json.mainClass ?? '')
  const oldForge = loader === 'forge' && !replacementBootstrap && major === 8 && !!mcVersion && /^1\.(?:[0-9]|1[0-2])(?:\.|$)/.test(mcVersion)
  const requirement: JavaRequirement = { recommendedMajor: major, minimumMajor: major,
    maximumMajor: oldForge ? 8 : undefined, mcVersion, source: canonical || officialLegacy ? 'Mojang javaVersion' : release ? 'Mojang release requirements' : 'profile javaVersion', constraints: allConstraints }
  // Mods can explicitly require a different major. Search only within a bounded
  // supported Java generation set; never fall back to an arbitrary installed JVM.
  if (!javaMajorAllowed(major, requirement)) {
    const supported = [8, 11, 16, 17, 21, 25]
    const compatible = supported.find(n => n >= major && javaMajorAllowed(n, requirement))
    if (!compatible) throw new Error(`Java 需求冲突：游戏推荐 Java ${major}${oldForge ? '，旧版 Forge 需要 Java 8' : ''}；${allConstraints.map(c => `${c.source}: ${c.range}`).join('；')}`)
    requirement.recommendedMajor = compatible
  }
  return requirement
}

/** Hard limits apply to manual selection too. A modern loader is not given an
 * invented upper bound: a user's explicitly chosen higher JVM remains usable. */
export function javaMajorAllowed(major: number, requirement: JavaRequirement): boolean {
  return major >= requirement.minimumMajor && (requirement.maximumMajor === undefined || major <= requirement.maximumMajor)
    && javaMajorCandidates(requirement.constraints.map(c => c.range), major).some(version => requirement.constraints.every(c =>
      c.exclude ? !javaRangeMatches(c.range, version) : javaRangeMatches(c.range, version)))
}

export function javaCompatibilityError(info: { major: number; version?: string; is64Bit: boolean; architecture?: string },
  requirement: JavaRequirement, architecture?: string, automatic = false): string | undefined {
  if (!info.is64Bit || architecture && info.architecture !== architecture) return `需要 64 位${architecture ? ' ' + architecture : ''} Java`
  if (info.major < requirement.minimumMajor) return `至少需要 Java ${requirement.minimumMajor}，当前为 Java ${info.major}`
  if (requirement.maximumMajor !== undefined && info.major > requirement.maximumMajor) return `旧版 Forge 需要 Java ${requirement.maximumMajor}，当前为 Java ${info.major}`
  const version = info.version?.replace(/^1\.(?=8(?:\.|$))/, '').replace(/_/g, '.') ?? String(info.major)
  const bad = requirement.constraints.find(c => c.exclude ? javaRangeMatches(c.range, version) : !javaRangeMatches(c.range, version))
  if (bad) return `${bad.source} ${bad.exclude ? '不支持' : '要求'} Java ${bad.range}，当前为 Java ${info.major}`
  if (automatic && info.major !== requirement.recommendedMajor) return `自动管理需要推荐的 Java ${requirement.recommendedMajor}，当前为 Java ${info.major}`
  return undefined
}

export function selectJavaByMajor<T extends { major: number; is64Bit: boolean; architecture?: string }>(available: T[], need: number, architecture?: string): T | null {
  return available.find(j => j.major === need && j.is64Bit && (!architecture || j.architecture === architecture)) ?? null
}

/** Separate selection from discovery so failure/cancellation/download decisions
 * are exercised with real orchestration tests and no Electron process. */
export async function prepareCompatibleJava<T extends { major: number; is64Bit: boolean; architecture?: string }>(
  requirement: JavaRequirement, available: T[], validate: (candidate: T) => Promise<T>,
  install: (major: number) => Promise<T>, architecture?: string, signal?: AbortSignal): Promise<T> {
  for (const candidate of available) {
    signal?.throwIfAborted()
    if (javaCompatibilityError(candidate, requirement, architecture, true)) continue
    try {
      const checked = await validate(candidate)
      signal?.throwIfAborted()
      if (!javaCompatibilityError(checked, requirement, architecture, true)) return checked
    } catch (error) { signal?.throwIfAborted() }
  }
  signal?.throwIfAborted()
  const installed = await install(requirement.recommendedMajor)
  signal?.throwIfAborted()
  const error = javaCompatibilityError(installed, requirement, architecture, true)
  if (error) throw new Error('自动安装的 Java 校验失败：' + error)
  return installed
}
