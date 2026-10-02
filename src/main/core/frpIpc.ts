/**
 * 樱花穿透 IPC 注册：
 *   - invoke 'frp:start'  ({ accessKey, tunnelId, localPort })
 *   - invoke 'frp:stop'
 *   - invoke 'frp:status'
 *   - invoke 'frp:nodes'  ({ accessKey?, refresh? })  节点列表 + 用户隧道（api.natfrp.com/v4，缓存 10 分钟）
 *   - push   'frp:event'  ({ type:'log'|'ready'|'error'|'stopped'|'status', data })
 */
import type { IpcMain } from 'electron'
import { frpManager } from './frpService'
import { tunnelIdentity } from './frpManager'
import {

  loadFrpConfig,
  type FrpEvent,
  type FrpConfig,
  type FrpState
} from './frp'
import { fetchFrpNodes, createFrpTunnel, getRunnableFrpTunnel, type FrpCreateTunnel } from './frpNodes'

export interface FrpStartPayload {
  id?: string
  accessKey: string
  tunnelId: string
  /** 留 0 表示自动读取 MC 局域网日志拿端口 */
  localPort?: number
}

export const FRP_IPC = {
  start: 'frp:start',
  stop: 'frp:stop',
  status: 'frp:status',
  nodes: 'frp:nodes',
  event: 'frp:event'
} as const

export function registerFrpIpc(ipcMain: IpcMain): void {
  ipcMain.handle('frp:delete-tunnel', async (_event, payload: { id?: string; confirmed?: boolean }) => {
    if (!payload?.id || payload.confirmed !== true) throw new Error('请先确认删除该隧道')
    return frpManager.remove(String(payload.id))
  })
  ipcMain.handle('frp:create-tunnel', (_e, payload: {accessKey: string; tunnel: FrpCreateTunnel}) => createFrpTunnel(String(payload?.accessKey ?? ''), payload?.tunnel))
  ipcMain.handle(FRP_IPC.start, async (_event, payload: FrpStartPayload) => {
    if (!payload || typeof payload !== 'object') throw new Error('参数无效')
    if (payload.id) return frpManager.start(String(payload.id))
    const accessKey = String(payload.accessKey ?? '').trim()
    const tunnelId = String(payload.tunnelId ?? '').trim()
    if (!accessKey) throw new Error('请填写访问密钥')
    const tunnel = await getRunnableFrpTunnel(accessKey, tunnelId)
    frpManager.register(accessKey, [tunnel])
    return frpManager.start(tunnelIdentity(accessKey, tunnelId))
  })
  ipcMain.handle(FRP_IPC.stop, async (_event, payload: { id?: string }) => {
    if (!payload?.id) throw new Error('请选择要停止的隧道')
    await frpManager.stop(String(payload.id))
    return frpManager.list()
  })
  ipcMain.handle(FRP_IPC.status, () => frpManager.list())

  // 节点列表（natfrp v4 公开 API）。accessKey 缺省时回退持久化配置里的密钥。
  ipcMain.handle(FRP_IPC.nodes, async (_event, payload: { accessKey?: string; refresh?: boolean } | undefined) => {
    const key = String(payload?.accessKey ?? '').trim() || frpManager.list().accessKey || loadFrpConfig()?.accessKey || ''
    const result = await fetchFrpNodes(key, { refresh: !!payload?.refresh })
    if (result.tunnels) frpManager.register(key, result.tunnels)
    return result
  })

}

/**
 * 仅暴露给 main/ipc.ts 用于在拿到 BrowserWindow getter 后注入。
 * 渲染端一旦首次调用 frp:status，会自动接 sink；主进程可在 registerIpc 内调用一次 installFrpEventBridge(getWin)。
 */
export function installFrpEventBridge(getWin: () => Electron.BrowserWindow | null): void {
  frpManager.setSink((tunnel) => {
    const win = getWin()
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(FRP_IPC.event, { tunnel })
  })
}

export type { FrpEvent, FrpConfig, FrpState }
