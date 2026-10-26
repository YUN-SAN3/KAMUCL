import type { CommunitySource } from './types'
export interface ModFavorite { key: string; name: string; iconUrl?: string; source?: CommunitySource; projectId?: string; sha1?: string; sha1s?: string[]; added: number }
/** Remote artwork only: never load local files or credentials from a favorite. */
export function favoriteIconUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return
  try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password) return url.href } catch {}
}
export interface FavoriteSelection { source: CommunitySource; projectId: string; fileId: string }
export type FavoriteSkipReason = 'incompatible' | 'unlinked' | 'unreliable' | 'query-error' | 'deselected' | 'base-only'
export interface FavoriteVersionResult { files: import('./types').CommunityFile[]; status: 'available' | 'incompatible' | 'unreliable' }
export interface FavoriteInstallSkip { key: string; name: string; reason: FavoriteSkipReason; message?: string }
export interface FavoriteInstallIntent {
  enabled: true
  /** Snapshot the projects shown when this task was accepted; later favorite changes do not retarget it. */
  expected: Array<{ key: string; name: string }>
  approvedSkips: FavoriteInstallSkip[]
  /** The user explicitly chose to continue without any favorite MODs. Other installation options remain independent. */
  baseOnly?: boolean
}
export interface FavoriteInstallResult {
  requested: number
  selected: number
  installed: number
  dependencies: number
  skipped: FavoriteInstallSkip[]
  baseOnly: boolean
  folder: string
  instanceId: string
  modsDirectory: string
  verifiedFiles: Array<{ fileName: string; sha1: string; source?: CommunitySource; projectId?: string }>
}

/** A checked feature must not silently become an empty request after a failed query. Legacy selections remain supported. */
export function validateFavoriteInstallIntent(selections: readonly FavoriteSelection[], intent?: FavoriteInstallIntent) {
  if (!Array.isArray(selections) || selections.length > 100) throw new Error('收藏模组过多（每次最多 100 项）')
  const selected = new Set<string>()
  for (const selection of selections) {
    if (!selection || typeof selection !== 'object') throw new Error('收藏模组选择已失效，请重新检查')
    const key = favoriteKey(selection)
    if (typeof selection.fileId !== 'string' || !selection.fileId || selection.fileId.length > 300 || selected.has(key)) throw new Error('收藏模组选择重复或已失效，请重新检查')
    selected.add(key)
  }
  if (intent === undefined) return { requested: selected.size, selected: selected.size, skipped: [] as FavoriteInstallSkip[], baseOnly: false }
  if (!intent || intent.enabled !== true || !Array.isArray(intent.expected) || intent.expected.length > 1000 || !Array.isArray(intent.approvedSkips) || intent.approvedSkips.length > 1000 || (intent.baseOnly !== undefined && typeof intent.baseOnly !== 'boolean')) throw new Error('收藏安装意图无效，请重新选择')
  const expected = new Map<string, string>()
  for (const item of intent.expected) {
    if (!item || typeof item.key !== 'string' || !/^(?:(?:modrinth|curseforge):[a-zA-Z0-9_-]{1,100}|sha1:[a-f0-9]{40})$/.test(item.key) || typeof item.name !== 'string' || item.name.length > 200 || expected.has(item.key)) throw new Error('收藏项目快照无效，请重新检查')
    expected.set(item.key, item.name)
  }
  for (const key of selected) if (!expected.has(key)) throw new Error('所选模组不在本次收藏快照中')
  const skipped = new Map<string, FavoriteInstallSkip>()
  for (const item of intent.approvedSkips) {
    if (!item || !expected.has(item.key) || selected.has(item.key) || skipped.has(item.key) || !['incompatible', 'unlinked', 'unreliable', 'query-error', 'deselected', 'base-only'].includes(item.reason) || (item.message !== undefined && (typeof item.message !== 'string' || item.message.length > 1000))) throw new Error('收藏跳过决定无效，请重新检查')
    if (item.reason === 'base-only' && intent.baseOnly !== true) throw new Error('尚未确认不安装收藏模组')
    skipped.set(item.key, { key: item.key, name: expected.get(item.key)!, reason: item.reason, ...(item.message ? { message: item.message } : {}) })
  }
  if (intent.baseOnly === true && selected.size) throw new Error('仅安装基础实例与收藏模组选择冲突')
  if (!selected.size && intent.baseOnly !== true) throw new Error('没有已确认的收藏模组；请重试、逐项跳过并选择不安装收藏模组，或关闭此选项')
  if ([...expected.keys()].some(key => !selected.has(key) && !skipped.has(key))) throw new Error('部分收藏模组尚未确认，请重试或明确跳过每一项')
  return { requested: expected.size, selected: selected.size, skipped: [...skipped.values()], baseOnly: intent.baseOnly === true }
}
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
export function linkFavoriteRecords(list: readonly ModFavorite[], oldKey: string, project: {source: CommunitySource; projectId: string; name: string; iconUrl?: string}): ModFavorite[] {
  const original = list.find(f => f.key === oldKey)
  if (!original) throw new Error('该收藏已被取消，请刷新列表')
  const key = favoriteKey(project), existing = list.find(f => f.key === key)
  const hashes = [...new Set([original.sha1, ...(original.sha1s ?? []), existing?.sha1, ...(existing?.sha1s ?? [])]
    .filter((hash): hash is string => !!hash && /^[a-f0-9]{40}$/i.test(hash)).map(hash => hash.toLowerCase()))]
  const merged: ModFavorite = { key, source: project.source, projectId: project.projectId, name: project.name.slice(0, 200),
    added: Math.min(original.added, existing?.added ?? original.added), ...(hashes.length ? {sha1: hashes[0], sha1s: hashes} : {}),
    ...(favoriteIconUrl(project.iconUrl || existing?.iconUrl) ? {iconUrl: favoriteIconUrl(project.iconUrl || existing?.iconUrl)} : {}) }
  return [...list.filter(f => f.key !== oldKey && f.key !== key), merged]
}

export function removeFavoriteRecords(list: readonly ModFavorite[], keys: readonly string[]): ModFavorite[] {
  if (!Array.isArray(keys) || !keys.length || keys.length > 1000 || keys.some(key => typeof key !== 'string' || !list.some(f => f.key === key))) {
    throw new Error('收藏选择已失效，请刷新后重试')
  }
  const removed = new Set(keys)
  return list.filter(f => !removed.has(f.key))
}
