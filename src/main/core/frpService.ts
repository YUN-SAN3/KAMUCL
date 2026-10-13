import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { FrpController, loadFrpConfig } from './frp'
import { FrpManager, readFrpRegistry, writeFrpRegistry } from './frpManager'
import { getRunnableFrpTunnel, deleteFrpTunnel } from './frpNodes'
import { FrpSecureStore } from './frpSecureStore'

const file = () => path.join(app.getPath('userData'), 'frp-tunnels.json')
const secureStore = new FrpSecureStore(safeStorage)
let legacyNotice = ''
export const frpManager = new FrpManager({
  read: () => {
    let legacy
    try { legacy = loadFrpConfig(); legacyNotice = '' }
    catch { if (!fs.existsSync(file())) throw new Error('旧隧道配置损坏，原文件已保留。'); legacyNotice = '旧版独立隧道配置无法安全迁移，原文件已保留；当前隧道记录仍可使用。' }
    return readFrpRegistry(file(), fs.existsSync(file()) ? undefined : legacy, secureStore)
  },
  save: (data, clear) => {
    if (clear) secureStore.clearCredentials(file(), data, path.join(app.getPath('userData'), 'frp-config.json'))
    else writeFrpRegistry(file(), data, secureStore)
  },
  credentialAvailable: () => secureStore.available(),
  notice: () => legacyNotice,
  worker: () => new FrpController(),
  validate: getRunnableFrpTunnel,
  deleteRemote: deleteFrpTunnel
})
