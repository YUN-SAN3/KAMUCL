import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC } from '../../shared/types'
import type { Settings, VersionCategoryAction } from '../../shared/types'
import { assertAvailableCategoryName, MAX_VERSION_CATEGORIES, normalizeVersionCategoryState, versionCategoryKey } from '../../shared/versionCategories'
import { getSettings, saveSettings } from './settings'
import { samePath } from './folderPaths'
import { listAllInstalled } from './versions'

/** Synchronous read/validate/write: concurrent IPC actions never save stale lists. */
export function updateVersionCategories(action: VersionCategoryAction): Settings {
  if (!action || typeof action !== 'object') throw new Error('分类操作无效')
  const current = getSettings(), state = normalizeVersionCategoryState(current)
  if (action.type === 'create') {
    if (state.versionCategories.length >= MAX_VERSION_CATEGORIES) throw new Error(`最多可创建 ${MAX_VERSION_CATEGORIES} 个分类`)
    state.versionCategories.push({ id: randomUUID(), name: assertAvailableCategoryName(state.versionCategories, action.name) })
  } else if (action.type === 'rename' || action.type === 'remove') {
    const category = state.versionCategories.find(row => row.id === action.id)
    if (!category) throw new Error('分类已不存在，请刷新后重试')
    if (action.type === 'rename') category.name = assertAvailableCategoryName(state.versionCategories, action.name, category.id)
    else {
      state.versionCategories = state.versionCategories.filter(row => row.id !== category.id)
      state.versionCategoryAssignments = Object.fromEntries(Object.entries(state.versionCategoryAssignments).filter(([, id]) => id !== category.id))
    }
  } else if (action.type === 'assign') {
    if (!action.target || typeof action.target.id !== 'string' || !action.target.id || typeof action.target.folder !== 'string' || !action.target.folder) throw new Error('请选择有效实例')
    if (typeof action.categoryId !== 'string' || (action.categoryId && !state.versionCategories.some(row => row.id === action.categoryId))) throw new Error('分类已不存在，请刷新后重试')
    const root = current.folders.find(folder => samePath(folder.path, action.target.folder))
    if (!root) throw new Error('实例所在游戏文件夹尚未登记')
    const targetKey = versionCategoryKey(action.target.folder, action.target.id, process.platform)
    const instance = listAllInstalled().find(row => row.id === action.target.id && versionCategoryKey(row.folder, row.id, process.platform) === targetKey)
    if (!instance) throw new Error('实例已不存在，请刷新后重试')
    // Preserve the registered/scanned spelling used by the renderer, including
    // legacy symlink paths; never turn it into a different invisible key.
    const key = versionCategoryKey(instance.folder, instance.id, process.platform)
    if (action.categoryId) state.versionCategoryAssignments[key] = action.categoryId
    else delete state.versionCategoryAssignments[key]
  } else throw new Error('分类操作无效')
  return saveSettings(state)
}
export function registerVersionCategoriesIpc(): void {
  ipcMain.handle(IPC.versionCategoriesUpdate, (_event, action: VersionCategoryAction) => updateVersionCategories(action))
}
