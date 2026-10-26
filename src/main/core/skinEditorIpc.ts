import { dialog, ipcMain, nativeImage, type BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { selectedAccount } from './accounts'
import { applyOfflineSkinBytes, uploadSkin } from './skins'
import { isBasePixel } from '../../shared/skinPixels'
function png(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length > 200000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)) throw new Error('无效的皮肤 PNG')
  const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64')
  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty() || image.getSize().width !== 64 || image.getSize().height !== 64) throw new Error('皮肤必须为 64×64 PNG')
  const bitmap=image.toBitmap();for(let y=0;y<64;y++)for(let x=0;x<64;x++)if(isBasePixel(x,y)&&bitmap[(y*64+x)*4+3]!==255)throw new Error('皮肤基础层存在透明像素，请重新载入编辑器修复')
  return image.toPNG()
}
export function registerSkinEditorIpc(getWin: () => BrowserWindow | null) {
  ipcMain.handle('skin:editorSave', async (_e, value: unknown) => {
    const bytes = png(value), win = getWin()
    const options = { title: '保存皮肤 PNG', defaultPath: 'skin.png', filters: [{ name: 'Minecraft 皮肤', extensions: ['png'] }] }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    await fs.writeFile(result.filePath, bytes); return true
  })
  ipcMain.handle('skin:editorUpload', async (_e, value: unknown, variant: unknown, accountId: unknown) => {
    if (!selectedAccount() || selectedAccount()?.id !== accountId) throw new Error('账号已变更，请重新确认上传账号')
    if (variant !== 'classic' && variant !== 'slim') throw new Error('无效的皮肤模型')
    const account = { ...selectedAccount()! }, bytes = png(value)
    if (account.type === 'offline') return applyOfflineSkinBytes(bytes, variant, account.id, '绘制皮肤.png')
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kamucl-skin-'))
    const file = path.join(dir, 'skin.png')
    try { await fs.writeFile(file, bytes); return await uploadSkin(file, variant, account.id) }
    finally { await fs.rm(dir, { recursive: true, force: true }) }
  })
}
