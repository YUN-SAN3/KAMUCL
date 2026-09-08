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

let app: VoxlinkApp | null = null

function vapp(): VoxlinkApp {
  if (!app) app = new VoxlinkApp()
  return app
}

/** 引擎事件转发：session:state（状态/人数变化）额外携带一份完整快照，驱动面板实时刷新。 */
function forwardEvent(ev: string, data: unknown): void {
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
    settings: a.settings
  }
}

export function registerVoxlinkIpc(ipcMain: IpcMain): void {
  ipcMain.handle('voxlink:start', async (_e, payload: { mode?: 'host' | 'join'; code?: string; roomName?: string; isPublic?: boolean; category?: string; hostPort?: number; loader?: string; gameVersion?: string }) => {
    const a = vapp()
    a.emit = (ev, data) => forwardEvent(ev, data)
    a.netLog = (level, msg) => push('log', { level, msg })
    if (payload.mode === 'join') {
      const r = await a.joinRoom({ code: String(payload.code ?? '').trim() })
      push('state', snapshot())
      return { ok: true, ...r }
    }
    // hostPort 必填：未传则自动探测本机 MC 局域网端口
    let hostPort = Number(payload.hostPort ?? 0)
    if (!(hostPort >= 1024 && hostPort <= 65535)) {
      const ports = await a.detectMcPortsJSON()
      hostPort = ports.ports[0]?.port ?? 0
    }
    const req: CreateRoomParams = {
      name: payload.roomName || 'KAMUCL 房间',
      visible: payload.isPublic !== false,
      category: payload.category || '',
      hostPort,
      loader: payload.loader,
      gameVersion: payload.gameVersion
    }
    const r = await a.createRoom(req)
    push('state', snapshot())
    return { ok: true, ...r }
  })

  ipcMain.handle('voxlink:stop', async () => {
    try { await vapp().leaveRoom() } catch { /* 已经不在房间 */ }
    push('state', snapshot())
    return snapshot()
  })

  ipcMain.handle('voxlink:status', () => snapshot())

  ipcMain.handle('voxlink:lobby', (_e, query: { page?: number; size?: number; category?: string; loader?: string; search?: string } = {}) =>
    vapp().listRooms(query) as Promise<{ rooms: LobbyRoom[]; total: number; page: number; size: number }>)

  ipcMain.handle('voxlink:settings', (_e, partial: Partial<VoxlinkSettings>) => {
    const a = vapp()
    if (typeof partial.allowRelay === 'boolean') a.setAllowRelay(partial.allowRelay)
    if (typeof partial.theme === 'string' && partial.theme) a.saveSettingsJSON({ theme: partial.theme })
    return a.settings
  })

  // 手动后备（app-desktop 同名能力）：打洞约 20 秒未成功时由用户触发
  ipcMain.handle('voxlink:tryDirect', () => vapp().tryDirect())
  ipcMain.handle('voxlink:usePlayerRelay', () => vapp().usePlayerRelay())
}

/** 应用退出时停掉会话（gracefulClose 里调用）。 */
export async function stopVoxlinkOnQuit(): Promise<void> {
  if (!app) return
  try { await app.leaveRoom() } catch { /* 忽略 */ }
}
