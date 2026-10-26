import type { VersionJson } from './versions'
import { normalizeLoader, normalizeLoaderVersion } from '../../shared/modCompatibility'
import type { LoaderName } from '../../shared/types'

/** Reject loader mapping placeholders; accept exact MC IDs, including pre-semver releases. */
export function isMinecraftVersionId(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value === '0.0.0') return false
  return /^(?:[1-9]\d*\.\d+(?:\.\d+)?(?:-(?:pre|rc)-?\d+|-snapshot-\d+| Pre-Release \d+)?|\d{2}w\d{2}[a-z](?:[\w.-]*)|[ab]\d+(?:\.\d+)+[a-z]?(?:_\d+|-pre\d+)?|c\d+(?:\.\d+)+[a-z]?(?:_[\w-]+)?|rd-\d+|inf-\d+|1\.RV-Pre1|3D Shareware v1\.34)$/i.test(value)
}

/** Read actual launch metadata. Folder/display names are deliberately not an input.
 * A caller may supply local client/cache evidence only when profile metadata cannot identify MC. */
export function resolveInstanceMetadata(json: VersionJson, readParent: (id: string) => VersionJson | undefined,
  readClientVersion?: (chain: readonly VersionJson[]) => string | undefined): {
  mcVersion: string; loader?: LoaderName; loaderVersion?: string; broken: boolean
} {
  const chain: VersionJson[] = [json]
  const seen = new Set<string>([json.id])
  let broken = false
  while (chain.at(-1)?.inheritsFrom) {
    const id = chain.at(-1)!.inheritsFrom!
    if (seen.has(id) || chain.length >= 16 || /[\\/:\0]/.test(id) || id === '.' || id === '..') { broken = true; break }
    seen.add(id)
    const parent = readParent(id)
    if (!parent) { broken = true; break }
    chain.push(parent)
  }
  const args = chain.flatMap(j => [
    ...(j.arguments?.game ?? []).flatMap(a => typeof a === 'string' ? [a] : typeof a.value === 'string' ? [a.value] : a.value),
    ...(j.minecraftArguments?.match(/"[^"]*"|\S+/g) ?? []).map(a => a.replace(/^"|"$/g, ''))
  ])
  const arg = (name: string): string | undefined => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : args.find(a => a.startsWith(name + '='))?.slice(name.length + 1)
  }
  const libraries = chain.flatMap(j => (j.libraries ?? []).map(l => (l.name ?? '').split(':')))
  const lib = (group: string, artifact: string) => libraries.find(l => l[0] === group && l[1] === artifact)?.[2]
  // Modern third-party profiles often contain only fmlloader / FML arguments,
  // not the forge:forge artifact. BootstrapLauncher itself is loader-neutral.
  const detected = arg('--fml.neoForgeVersion') || lib('net.neoforged', 'neoforge') || lib('net.neoforged.fancymodloader', 'loader') ? 'neoforge' : arg('--fml.forgeVersion') || lib('net.minecraftforge', 'forge') || lib('net.minecraftforge', 'fmlloader') ? 'forge'
    : lib('net.fabricmc', 'fabric-loader') ? 'fabric' : lib('org.quiltmc', 'quilt-loader') ? 'quilt' : undefined
  const main = chain.map(j => j.mainClass ?? '').join(' ').toLowerCase()
  const loader = detected ?? normalizeLoader(chain.find(j => j._loader)?._loader) ?? (main.includes('neoforged') ? 'neoforge' : main.includes('minecraftforge') ? 'forge' : main.includes('fabricmc') ? 'fabric' : main.includes('quiltmc') ? 'quilt' : undefined)
  const forge = lib('net.minecraftforge', 'forge') ?? lib('net.minecraftforge', 'fmlloader')
  const base = chain.at(-1)!
  // Mojang's id in a vanilla profile is metadata; an opaque flattened modpack id is not an MC version.
  const vanillaId = !base.inheritsFrom && (!loader || chain.length > 1) ? base.id : undefined
  // Mapping coordinates may be 0.0.0 on unobfuscated clients, and fmlloader can carry
  // only a loader version. Neither is allowed to override explicit game metadata.
  const candidates = [arg('--fml.mcVersion'), ...chain.map(j => j.clientVersion), ...chain.map(j => j._mcVersion),
    vanillaId, ...chain.map(j => j.inheritsFrom), lib('net.fabricmc', 'intermediary'), lib('org.quiltmc', 'hashed'),
    forge?.includes('-') ? forge.split('-')[0] : undefined]
  let mcVersion = candidates.find(isMinecraftVersionId)
  if (!mcVersion && readClientVersion) {
    try { const evidence = readClientVersion(chain); if (isMinecraftVersionId(evidence)) mcVersion = evidence } catch { /* Unknown remains unknown. */ }
  }
  mcVersion ??= '未知'
  const rawLoader = (loader === 'neoforge' ? arg('--fml.neoForgeVersion') ?? lib('net.neoforged', 'neoforge') : loader === 'forge' ? arg('--fml.forgeVersion') ?? forge : loader === 'fabric' ? lib('net.fabricmc', 'fabric-loader') : loader === 'quilt' ? lib('org.quiltmc', 'quilt-loader') : undefined) ?? chain.find(j => j._loaderVersion)?._loaderVersion
  return { mcVersion, loader, loaderVersion: rawLoader ? normalizeLoaderVersion(rawLoader, loader, mcVersion) : undefined, broken }
}
