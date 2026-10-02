/**
 * voxlink/index.ts — VoxLink 联机模块 IPC 接线（KAMUCL）
 *
 * 通道（与 src/shared/types.ts IPC 常量一致）：
 *   invoke 'voxlink:start'   {mode:'host'|'join', code?, roomName?, isPublic?, category?}
 *   invoke 'voxlink:stop'
 *   invoke 'voxlink:status'
 *   invoke 'voxlink:lobby'   {page?, size?, category?, loader?, search?}
 *   invoke 'voxlink:settings' partial（allowRelay/theme）
 *   push   'voxlink:event'   {type, data}  → state/log/phase/code/room
 */
import { ipcMain, BrowserWindow, type IpcMain } from 'electron'
import { VoxlinkApp, type CreateRoomParams, type LobbyRoom } from './engine'
import type { VoxlinkSettings } from './settings'
import { DEFAULT_VOXLINK_ROOM_NAME, normalizeVoxlinkRoomName } from '../../../shared/voxlinkRoom'

import { ConnectionLog } from './connectionLog'
import { saveSettings } from './settings'
import { ModSyncService } from './modsyncService'
import type { InstanceTarget } from '../../../shared/instanceCenter'
import { registerTicketIpc } from './ticketsIpc'
const modSync = new ModSyncService(vapp)
const connectionLog = new ConnectionLog(() => vapp().baseURL(), () => !!vapp().settings.uploadDiagnostics, () => [vapp().engine.token])
let app: VoxlinkApp | null = null
let requestGeneration=0
let requestPending=false

function vapp(): VoxlinkApp {
  if (!app) app = new VoxlinkApp()
  return app
}

/** 引擎事件转发：session:state（状态/人数变化）额外携带一份完整快照，驱动面板实时刷新。 */
function forwardEvent(ev: string, data: unknown): void {
  if (ev === 'conn:state') connectionLog.state((data as any).status, (data as any).detail)
  if (ev === 'stage') connectionLog.record('stage', `${(data as any).key}: ${(data as any).detail}`)
  if (ev === 'mods:request') { void modSync.answer(data as Record<string, unknown>); return }
  if (ev === 'session:state' && (data as any)?.state === 'closed') { modSync.stop(); connectionLog.state('failed', String((data as any).message || '信令会话已结束')); void connectionLog.stop() }
  push(ev, data)
  if (ev === 'session:state') push('state', snapshot())
}

/** 状态/日志/阶段变化统一 push 到主窗口（窗口销毁时静默）。 */
function push(type: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('voxlink:event', { type, data })
  }
}

function snapshot(): unknown {
  const a = vapp()
  return {
    state: a.state,
    room: a.room,
    session: a.getSessionStateJSON(),
    settings: a.settings,
    pending: requestPending, joinedAt:a.engine.joinedAt, connection:a.engine.lastConnection, stages:a.engine.stages
  }
}

export function registerVoxlinkIpc(ipcMain: IpcMain): void {
  registerTicketIpc(ipcMain,()=>vapp().baseURL())
  modSync.register(ipcMain)
  ipcMain.handle('voxlink:start', async (_e, payload: { mode?: 'host' | 'join'; code?: string; roomName?: string; isPublic?: boolean; category?: string; hostPort?: number; loader?: string; gameVersion?: string; target?: InstanceTarget }) => {
    if(requestPending)throw new Error('正在处理联机请求，请先取消')
    const generation=++requestGeneration;requestPending=true
    try {
    const a = vapp()
    a.emit = (ev, data) => forwardEvent(ev, data)
    a.netLog = (level, msg) => { connectionLog.record(level, msg); push('log', { level, msg }) }
    if (payload.mode === 'join') {
      const context=payload.target?await modSync.context(payload.target):undefined
      if(generation!==requestGeneration)throw new Error('操作已取消')
      const r = await a.joinRoom({ code: String(payload.code ?? '').trim(), loader:context?.loader, gameVersion:context?.mcVersion })
      connectionLog.start(r.room.code, false)
      push('state', snapshot())
      return { ok: true, ...r }
    }
    if (!payload.target) throw new Error('请先选择房主正在使用的游戏实例')
    const context = await modSync.context(payload.target)
    const name = normalizeVoxlinkRoomName(payload.roomName ?? DEFAULT_VOXLINK_ROOM_NAME)
    // hostPort 必填：未传则自动探测本机 MC 局域网端口
    let hostPort = Number(payload.hostPort ?? 0)
    if (!hostPort) {
      const ports = await a.detectMcPortsJSON().catch(() => ({ ports: [] }))
      hostPort = ports.ports[0]?.port ?? 0
    }
    if (!hostPort) throw new Error('请先启动游戏并对局域网开放世界')
    if(generation!==requestGeneration)throw new Error('操作已取消')
    const req: CreateRoomParams = {
      name,
      visible: payload.isPublic !== false,
      category: payload.category || '',
      hostPort,
      loader: context.loader,
      gameVersion: context.mcVersion
    }
    const r = await a.createRoom(req)
    connectionLog.start(r.code, true)
    modSync.startHost(context, r.code, r.hostToken)
    push('state', snapshot())
    return { ok: true, ...r }
    } finally {if(generation===requestGeneration)requestPending=false}
  })

  ipcMain.handle('voxlink:stop', async (_e,reason?:string) => {
    requestGeneration++;requestPending=false
    modSync.stop()
    try { await vapp().leaveRoom(typeof reason==='string'?reason:'用户退出房间') } catch { /* 已经不在房间 */ }
    void connectionLog.stop()
    push('state', snapshot())
    return snapshot()
  })

  ipcMain.handle('voxlink:status', () => snapshot())

  ipcMain.handle('voxlink:lobby', (_e, query: { page?: number; size?: number; category?: string; loader?: string; search?: string } = {}) =>
    vapp().listRooms(query) as Promise<{ rooms: LobbyRoom[]; total: number; page: number; size: number }>)

  ipcMain.handle('voxlink:settings', (_e, partial: Partial<VoxlinkSettings>) => {
    const a = vapp()
    if (typeof partial.uploadDiagnostics === 'boolean') { a.settings.uploadDiagnostics = partial.uploadDiagnostics; saveSettings(a.settings, a.settingsPath) }
    if (typeof partial.allowRelay === 'boolean') a.setAllowRelay(partial.allowRelay)
    if (typeof partial.theme === 'string' && partial.theme) a.saveSettingsJSON({ theme: partial.theme })
    return a.settings
  })

  // 手动后备（app-desktop 同名能力）：打洞约 20 秒未成功时由用户触发
  ipcMain.handle('voxlink:tryDirect', () => vapp().tryDirect())
  ipcMain.handle('voxlink:useTurnRelay', () => vapp().engine.useTurnRelay())
  ipcMain.handle('voxlink:usePlayerRelay', () => vapp().usePlayerRelay())
}

/** 应用退出时停掉会话（gracefulClose 里调用）。 */
export async function stopVoxlinkOnQuit(): Promise<void> {
  modSync.stop()
  if (!app) return
  try { await app.leaveRoom('启动器关闭') } catch { /* 忽略 */ }
  await connectionLog.stop(true)
}
