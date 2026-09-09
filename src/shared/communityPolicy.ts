import type { CommunityFile, CommunityKind, InstalledVersion, LoaderName } from './types'
import { compareVersions, normalizeLoader } from './modCompatibility'

export interface CommunityFileFilter { mcVersion?: string; loader?: LoaderName | ''; kind?: CommunityKind }

/** Modrinth 用 loaders 同时标记模组加载器与资源文件类型。 */
export const MODRINTH_RESOURCE_LOADERS: Partial<Record<CommunityKind, string[]>> = {
  resourcepack: ['minecraft'], shader: ['iris', 'optifine', 'canvas', 'vanilla'], datapack: ['datapack']
}

export function usesCommunityLoader(kind?: CommunityKind): boolean {
  return !kind || kind === 'mod' || kind === 'modpack'
}

export function effectiveCommunityFilter(filter: CommunityFileFilter): CommunityFileFilter {
  return { ...filter, mcVersion: filter.mcVersion?.trim() || undefined, loader: usesCommunityLoader(filter.kind) ? filter.loader || undefined : undefined }
}

export function matchesCommunityFilter(file: CommunityFile, filter: CommunityFileFilter): boolean {
  filter = effectiveCommunityFilter(filter)
  const resourceLoaders = filter.kind && MODRINTH_RESOURCE_LOADERS[filter.kind]
  if (file.source === 'modrinth' && resourceLoaders && !file.loaders.some(l => resourceLoaders.includes(l))) return false
  return (!filter.mcVersion || file.gameVersions.some(v => compareVersions(v, filter.mcVersion!) === 0)) &&
    (!filter.loader || file.loaders.some(l => normalizeLoader(l) === normalizeLoader(filter.loader)))
}

export function communityFileMatchesInstance(file: CommunityFile, instance: InstalledVersion): boolean {
  return !instance.failed && !instance.incomplete && !!instance.loader &&
    matchesCommunityFilter(file, { mcVersion: instance.mcVersion, loader: instance.loader })
}
