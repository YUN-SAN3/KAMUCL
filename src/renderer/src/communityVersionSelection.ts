import type { CommunityQuery, InstalledVersion, LoaderName } from '@shared/types'
import { instanceKey } from '@shared/modCompatibility'

export type CommunityVersionSource = 'all' | 'installed' | 'custom'
export type CommunityLoaderSource = 'all' | 'instance' | 'manual'
export interface CommunityVersionSelection {
  source: CommunityVersionSource
  instance: string
  loaderSource: CommunityLoaderSource
}
/** Browsing is independent of the launcher selection. Only an explicit action
 * may narrow the first query; a route-local snapshot always takes precedence. */
export function initialCommunityQuery(previous?: { query: Omit<CommunityQuery, 'offset' | 'limit'> }) {
  return { keyword: '', kind: 'mod' as const, source: 'all' as const, mcVersion: '', loader: '' as '' | LoaderName, sort: 'relevance' as const, ...previous?.query }
}
export function initialCommunityVersionSelection(previous?: { query: { mcVersion?: string; loader?: string }; versionSelection?: CommunityVersionSelection }): CommunityVersionSelection {
  return previous?.versionSelection ? { ...previous.versionSelection } : {
    source: previous?.query.mcVersion ? 'custom' : 'all', instance: '', loaderSource: previous?.query.loader ? 'manual' : 'all'
  }
}
export function usableCommunityInstance(v: InstalledVersion): boolean {
  return !v.failed && !v.incomplete && !!v.mcVersion?.trim() && v.mcVersion !== '未知'
}
export function chooseCommunityInstance(v: InstalledVersion, selection: CommunityVersionSelection, currentLoader: '' | LoaderName) {
  if (!usableCommunityInstance(v)) return undefined
  const keepManualLoader = selection.loaderSource === 'manual'
  return { mcVersion: v.mcVersion, loader: keepManualLoader ? currentLoader : v.loader ?? '',
    selection: { source: 'installed' as const, instance: instanceKey(v), loaderSource: keepManualLoader ? 'manual' as const : 'instance' as const } }
}
