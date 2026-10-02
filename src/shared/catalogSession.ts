import type { RemoteVersion } from './types'
export interface CatalogSnapshot { versions: RemoteVersion[]; checkedAt: number; stale: boolean }
/** UI cache only: retain real results during refresh and share work across page mounts. */
export function createCatalogSession(fetcher: (refresh: boolean) => Promise<CatalogSnapshot>, now = Date.now) {
  let snapshot: CatalogSnapshot | undefined
  let pending: Promise<CatalogSnapshot> | undefined
  let fetchedAt = 0
  return {
    peek: () => snapshot,
    load(refresh = false): Promise<CatalogSnapshot> {
      if (pending) return pending
      if (!refresh && snapshot && now() >= fetchedAt && now() - fetchedAt < 300_000) return Promise.resolve(snapshot)
      pending = fetcher(refresh).then(result => { snapshot = result; fetchedAt = now(); return result }).finally(() => { pending = undefined })
      return pending
    }
  }
}
