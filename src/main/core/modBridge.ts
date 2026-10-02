/**
 * 桥接 MOD 客户端：发现（读游戏目录 .kamucl-bridge.json）+ 身份校验调用。
 * 仅连接 127.0.0.1；token 来自游戏目录发现文件（本机可读即授权）。
 * 任何失败都以错误/断开状态返回，绝不影响游戏进程。
 */
import fs from 'node:fs'
import path from 'node:path'
import { instanceDirectoryState } from './instances'
import { readVersionJson } from './versions'
import { parseModFile } from './modinfo'
import { join } from 'node:path'

/** 内置桥接 MOD jar（构建时复制进 out/main，打包时 asarUnpack） */
function bundledBridgeJar(): string {
  return join(__dirname, 'kamucl-bridge.jar').replace('app.asar', 'app.asar.unpacked')
}

/** 桥接 MOD 是否已安装到该实例的 mods 目录（按 fabric mod id 识别） */
export function bridgeInstalled(versionId: string): boolean {
  const modsDir = path.join(gameDirOf(versionId), 'mods')
  try {
    for (const name of fs.readdirSync(modsDir)) {
      if (!name.toLowerCase().endsWith('.jar')) continue
      const info = parseModFile(path.join(modsDir, name))
      if (info.id === 'kamucl-bridge') return true
    }
  } catch { /* mods 目录不存在视为未安装 */ }
  return false
}

/** 把内置桥接 MOD 安装到实例 mods 目录（幂等：已安装则跳过） */
export function installBridge(versionId: string): { ok: boolean; already?: boolean; error?: string } {
  try {
    if (bridgeInstalled(versionId)) return { ok: true, already: true }
    const src = bundledBridgeJar()
    if (!fs.existsSync(src)) return { ok: false, error: '内置桥接 MOD 文件缺失，请重新安装启动器' }
    const modsDir = path.join(gameDirOf(versionId), 'mods')
    fs.mkdirSync(modsDir, { recursive: true })
    fs.copyFileSync(src, path.join(modsDir, 'kamucl-bridge-1.0.1.jar'))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export interface BridgeDiscovery {
  protocol: number
  port: number
  token: string
  modVersion: string
  pid: number
  startedAt: number
}

export interface BridgeParam {
  id: string
  modId: string
  label: string
  description: string
  group: string
  kind: 'SWITCH' | 'SLIDER' | 'TEXT' | 'SELECT'
  apply: 'INSTANT' | 'RELOAD_RESOURCES' | 'REJOIN_WORLD' | 'RESTART_GAME'
  scope: 'CLIENT' | 'SERVER'
  defaultValue: unknown
  value: unknown
  min?: number
  max?: number
  step?: number
  options?: string[]
  visible: boolean
}

export interface BridgeStatus {
  connected: boolean
  reason?: string
  modVersion?: string
  protocol?: number
}

function gameDirOf(versionId: string): string {
  return instanceDirectoryState(versionId, readVersionJson(versionId)).path
}

function discoveryFile(versionId: string): string {
  return path.join(gameDirOf(versionId), '.kamucl-bridge.json')
}

/** 读取发现文件；不存在或损坏返回 null */
export function readDiscovery(versionId: string): BridgeDiscovery | null {
  try {
    const raw = JSON.parse(fs.readFileSync(discoveryFile(versionId), 'utf-8'))
    if (raw?.protocol !== 1) return null
    const port = Number(raw.port)
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
    if (typeof raw.token !== 'string' || raw.token.length < 16) return null
    return { protocol: 1, port, token: raw.token, modVersion: String(raw.modVersion ?? ''), pid: Number(raw.pid ?? 0), startedAt: Number(raw.startedAt ?? 0) }
  } catch {
    return null
  }
}

async function call(discovery: BridgeDiscovery, pathname: string, body?: unknown, timeoutMs = 3000): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${discovery.port}/kamucl/v1/${pathname}`, {
    method: body === undefined ? 'GET' : 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Kamucl-Token': discovery.token },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** 连接状态：发现文件存在且 ping 通（游戏退出后端口关闭，ping 失败即断开） */
export async function bridgeStatus(versionId: string): Promise<BridgeStatus> {
  const discovery = readDiscovery(versionId)
  if (!discovery) return { connected: false, reason: '未发现桥接服务：请使用内置 KAMUCL Bridge 的实例启动游戏' }
  // 发现文件可能来自上次异常退出的残留：校验进程仍在运行
  try {
    process.kill(discovery.pid, 0)
  } catch {
    return { connected: false, reason: '检测到上次的桥接记录，但游戏已退出' }
  }
  try {
    const pong = (await call(discovery, 'ping', undefined, 1500)) as { ok?: boolean }
    if (pong?.ok) return { connected: true, modVersion: discovery.modVersion, protocol: discovery.protocol }
    return { connected: false, reason: '桥接服务响应异常' }
  } catch {
    return { connected: false, reason: '桥接服务无响应（游戏可能正在加载或已退出）' }
  }
}

export async function bridgeManifest(versionId: string): Promise<{ protocol: number; params: BridgeParam[] }> {
  const discovery = readDiscovery(versionId)
  if (!discovery) throw new Error('未发现桥接服务')
  const manifest = (await call(discovery, 'manifest')) as { protocol?: number; params?: BridgeParam[] }
  if (manifest?.protocol !== 1 || !Array.isArray(manifest.params)) throw new Error('桥接服务协议不兼容')
  return { protocol: 1, params: manifest.params }
}

/** 修改参数：以 MOD 返回的实际结果为准（value 回读自 MOD 端校验后的值）。 */
export async function bridgeSet(versionId: string, id: string, value: unknown): Promise<{ ok: boolean; value?: unknown; notice?: string; error?: string }> {
  const discovery = readDiscovery(versionId)
  if (!discovery) return { ok: false, error: '未发现桥接服务：游戏未运行或未安装桥接 MOD' }
  try {
    return (await call(discovery, 'set', { id: String(id ?? ''), value })) as { ok: boolean; value?: unknown; notice?: string; error?: string }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function bridgeReset(versionId: string, id?: string): Promise<{ ok: boolean; error?: string }> {
  const discovery = readDiscovery(versionId)
  if (!discovery) return { ok: false, error: '未发现桥接服务' }
  try {
    return (await call(discovery, 'reset', id ? { id: String(id) } : {})) as { ok: boolean; error?: string }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
