import type { VersionCategory } from './types'

export const VERSION_CATEGORY_ALL = '@all'
export const VERSION_CATEGORY_FAVORITES = '@favorites'
export const VERSION_CATEGORY_UNCLASSIFIED = '@unclassified'
export const MAX_VERSION_CATEGORIES = 100
const reservedNames = new Set(['全部', '全部版本', '收藏', '收藏版本', '未分类'])
const nameIdentity = (name: string) => name.normalize('NFKC').toLocaleLowerCase('en-US')

export interface VersionCategoryState {
  versionCategories: VersionCategory[]
  versionCategoryAssignments: Record<string, string>
}
export function versionCategoryKey(folder: string, id: string, platform: string): string {
  let root = folder.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  if (platform === 'win32') root = root.toLocaleLowerCase('en-US')
  return JSON.stringify([root, id])
}
export function categoryName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('请输入分类名称')
  const name = value.trim()
  if (!name || [...name].length > 40 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('分类名称须为 1–40 个字符，且不能包含控制字符')
  if (reservedNames.has(nameIdentity(name))) throw new Error('此名称用于内置分类，请换一个名称')
  return name
}
/** Old settings have no labels. Damaged labels never change instances/favorites. */
export function normalizeVersionCategoryState(value: { versionCategories?: unknown; versionCategoryAssignments?: unknown }): VersionCategoryState {
  const categories: VersionCategory[] = [], ids = new Set<string>(), names = new Set<string>()
  if (Array.isArray(value.versionCategories)) for (const row of value.versionCategories) {
    if (categories.length >= MAX_VERSION_CATEGORIES) break
    if (!row || typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(row.id) || ids.has(row.id)) continue
    try {
      const name = categoryName(row.name), key = nameIdentity(name)
      if (names.has(key)) continue
      categories.push({ id: row.id, name }); ids.add(row.id); names.add(key)
    } catch { /* Omit only the invalid label. */ }
  }
  const assignments: Array<[string, string]> = []
  if (value.versionCategoryAssignments && typeof value.versionCategoryAssignments === 'object' && !Array.isArray(value.versionCategoryAssignments)) for (const [key, category] of Object.entries(value.versionCategoryAssignments)) {
    if (typeof category !== 'string' || !ids.has(category)) continue
    try { const target = JSON.parse(key); if (Array.isArray(target) && target.length === 2 && target.every(v => typeof v === 'string' && v.length > 0)) assignments.push([key, category]) } catch { /* An invalid link is unclassified. */ }
  }
  return { versionCategories: categories, versionCategoryAssignments: Object.fromEntries(assignments) }
}
export function assertAvailableCategoryName(categories: VersionCategory[], name: unknown, exceptId?: string): string {
  const valid = categoryName(name)
  if (categories.some(row => row.id !== exceptId && nameIdentity(row.name) === nameIdentity(valid))) throw new Error('已存在同名分类')
  return valid
}
export function versionCategoryOf(state: { versionCategories?: VersionCategory[]; versionCategoryAssignments?: Record<string, string> } | null | undefined, folder: string, id: string, platform: string): string {
  const value = state?.versionCategoryAssignments?.[versionCategoryKey(folder, id, platform)]
  return value && state?.versionCategories?.some(row => row.id === value) ? value : ''
}
export function versionMatchesCategory(category: string, assigned: string, favorite: boolean): boolean {
  return category === VERSION_CATEGORY_ALL || (category === VERSION_CATEGORY_FAVORITES ? favorite : category === VERSION_CATEGORY_UNCLASSIFIED ? !assigned : assigned === category)
}
export function renameCategoryAssignment(state: VersionCategoryState, folder: string, id: string, nextId: string, platform: string): Record<string, string> {
  const before = versionCategoryKey(folder, id, platform), after = versionCategoryKey(folder, nextId, platform), next = { ...state.versionCategoryAssignments }
  if (Object.hasOwn(next, before) && before !== after) { next[after] = next[before]; delete next[before] }
  return next
}
