import type { CommunitySource } from './types'
export interface ModFavorite { key: string; name: string; source?: CommunitySource; projectId?: string; sha1?: string; sha1s?: string[]; added: number }
export interface FavoriteSelection { source: CommunitySource; projectId: string; fileId: string }
export function favoriteKey(value: {source?: string;projectId?: string;sha1?: string}): string {
  if ((value.source === 'modrinth' || value.source === 'curseforge') && /^[a-zA-Z0-9_-]{1,100}$/.test(value.projectId || '')) return `${value.source}:${value.projectId}`
  if (/^[a-f0-9]{40}$/i.test(value.sha1 || '')) return `sha1:${value.sha1!.toLowerCase()}`
  throw new Error('收藏缺少可信项目或文件标识')
}

export interface FavoriteFilter { keyword: string; source: 'all' | CommunitySource | 'unlinked'; sort: 'newest' | 'oldest' | 'name' }
export function filterFavorites(list: readonly ModFavorite[], filter: FavoriteFilter): ModFavorite[] {
  const keyword = filter.keyword.trim().toLocaleLowerCase()
  return list.filter(f => (filter.source === 'all' || (filter.source === 'unlinked' ? !f.source || !f.projectId : f.source === filter.source)) &&
    (!keyword || [f.name, f.source, f.projectId, f.sha1, ...(f.sha1s ?? [])].some(value => value?.toLocaleLowerCase().includes(keyword))))
    .sort((a, b) => filter.sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') || a.key.localeCompare(b.key) :
      (filter.sort === 'oldest' ? a.added - b.added : b.added - a.added) || a.key.localeCompare(b.key))
}

/** Linking is a merge: older local records and every known file hash remain represented. */
export function linkFavoriteRecords(list: readonly ModFavorite[], oldKey: string, project: {source: CommunitySource; projectId: string; name: string}): ModFavorite[] {
  const original = list.find(f => f.key === oldKey)
  if (!original) throw new Error('该收藏已被取消，请刷新列表')
  const key = favoriteKey(project), existing = list.find(f => f.key === key)
  const hashes = [...new Set([original.sha1, ...(original.sha1s ?? []), existing?.sha1, ...(existing?.sha1s ?? [])]
    .filter((hash): hash is string => !!hash && /^[a-f0-9]{40}$/i.test(hash)).map(hash => hash.toLowerCase()))]
  const merged: ModFavorite = { key, source: project.source, projectId: project.projectId, name: project.name.slice(0, 200),
    added: Math.min(original.added, existing?.added ?? original.added), ...(hashes.length ? {sha1: hashes[0], sha1s: hashes} : {}) }
  return [...list.filter(f => f.key !== oldKey && f.key !== key), merged]
}

export function removeFavoriteRecords(list: readonly ModFavorite[], keys: readonly string[]): ModFavorite[] {
  if (!Array.isArray(keys) || !keys.length || keys.length > 1000 || keys.some(key => typeof key !== 'string' || !list.some(f => f.key === key))) {
    throw new Error('收藏选择已失效，请刷新后重试')
  }
  const removed = new Set(keys)
  return list.filter(f => !removed.has(f.key))
}
