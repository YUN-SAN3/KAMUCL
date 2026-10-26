import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '../shared/types'
import * as settings from './core/settings'
import * as appearance from './core/appearanceAssets'
import { createAppearanceAssetActions } from './core/appearanceAssetActions'

/** Asset dialogs and settings are kept independent from the launch and download IPC router. */
export function registerAppearanceAssetHandlers(getWin: () => BrowserWindow | null) {
  const actions = createAppearanceAssetActions({ getSettings: settings.getSettings, saveSettings: settings.saveSettings, importImage: appearance.importGlobalImage, removeImage: appearance.removeGlobalImage })
  async function pick(title: string, multiple = false) {
    const options = { title, properties: multiple ? ['openFile' as const, 'multiSelections' as const] : ['openFile' as const], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }
    const window = getWin()
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  }
  ipcMain.handle(IPC.appearanceImportBackground, async () => {
    const sources = await pick('导入单张背景（替换切换列表）')
    return sources[0] ? actions.singleBackground(sources[0]) : null
  })
  ipcMain.handle(IPC.appearanceImportBackgroundMulti, async () => {
    const sources = await pick('添加背景图片（可多选）', true)
    return sources.length ? actions.multipleImages(sources, 'background') : null
  })
  ipcMain.handle(IPC.appearanceResetBackground, () => actions.resetBackground())
  ipcMain.handle(IPC.appearanceImportLaunchThumbnail, async () => {
    const sources = await pick('添加首页轮播图片（可多选）', true)
    return sources.length ? actions.multipleImages(sources, 'launch-thumbnail') : null
  })
  ipcMain.handle(IPC.appearanceResetLaunchThumbnail, () => actions.resetLaunchThumbnail())
}
