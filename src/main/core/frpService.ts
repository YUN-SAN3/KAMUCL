import { app } from 'electron'
import path from 'node:path'
import { FrpController, loadFrpConfig } from './frp'
import { FrpManager, readFrpRegistry, writeFrpRegistry } from './frpManager'
import { getRunnableFrpTunnel, deleteFrpTunnel } from './frpNodes'

const file = () => path.join(app.getPath('userData'), 'frp-tunnels.json')
export const frpManager = new FrpManager({
  read: () => readFrpRegistry(file(), loadFrpConfig()),
  save: data => writeFrpRegistry(file(), data),
  worker: () => new FrpController(),
  validate: getRunnableFrpTunnel,
  deleteRemote: deleteFrpTunnel
})
