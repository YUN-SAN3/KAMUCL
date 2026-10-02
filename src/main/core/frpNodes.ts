/**
 * frpNodes.ts — 樱花穿透（natfrp / SakuraFrp）节点列表与用户隧道查询（KAMUCL）
 *
 * 【数据来源】（官方公开 API，OpenAPI 定义：https://github.com/natfrp/api，Swagger UI：https://api.natfrp.com/docs/）
 *   - GET https://api.natfrp.com/v4/nodes        列出所有节点（需访问密钥）
 *   - GET https://api.natfrp.com/v4/node/stats   节点在线状态/负载（需访问密钥）
 *   - GET https://api.natfrp.com/v4/tunnels      当前用户的隧道列表（需访问密钥）
 *
 * 【鉴权】访问密钥即 frpc 使用的 accessKey（`frpc -f <accessKey>:<tunnelId>` 中的前半段）。
 *   API v4 全局 security：`Authorization: Bearer <访问密钥>` 请求头，或 `?token=<访问密钥>` 查询参数。
 *   本模块统一用 Bearer 头，避免密钥进入 URL。
 *
 * 【字段含义】（对照 openapi.yaml，逐字段落名）
 *   /nodes 响应：以节点 ID 为键的对象，每个节点：
 *     - name        节点名称（如 "一个神奇的节点"）
 *     - host        节点地址/域名（如 "idea-leaper-1.natfrp.io"）
 *     - description 节点说明（含地区/运营商等文字描述，由官方维护）
 *     - vip         节点 VIP 等级。0 = 免费节点；>0 = 需要 VIP/专业版（Happy）的节点
 *                   （官方 FAQ https://doc.natfrp.com/faq/network.html 区分免费节点与 VIP 节点）
 *     - flag        位标志（bitfield）：
 *                     0b11      允许 HTTP 隧道
 *                     1 << 2    是否允许创建隧道（节点满载时为 0）
 *                     1 << 3    是否为内地节点
 *                     1 << 4    是否为无防节点（无 DDoS 防护）
 *                     1 << 5    允许 UDP 流量
 *                     1 << 6    是否为私有节点
 *                     1 << 7    tls_sucks
 *                     1 << 8    是否强制启用访问认证
 *                     1 << 9    是否离线
 *                     1 << 10   是否为 BETA 节点
 *   /node/stats 响应：{ time, nodes: [{ id, online, uptime, load }] }
 *     - id      节点 ID（对应 /nodes 的键）
 *     - online  -1 = 离线；>= 0 = 在线（通常为 0）
 *     - uptime  节点运行时间（秒）
 *     - load    节点负载（百分比整数）
 *   /tunnels 响应：隧道数组（schemas/Tunnel.yaml）：
 *     - id/name/type/node(节点 ID)/online(隧道是否在线)/status(0 正常 2 封禁)
 *     - local_ip/local_port/remote(远程端口或域名)/note/extra/export/locks
 *
 * 【缓存】结果缓存 10 分钟（≥ 任务要求的 10 分钟）；带 refresh 可强制刷新。
 *   失败时抛出真实错误（含 API 返回的 code/msg），绝不返回假数据。
 */
import { httpFetch } from './httpClient'

const API_BASE = 'https://api.natfrp.com/v4'
const CACHE_TTL_MS = 10 * 60 * 1000

/** 节点 flag 位定义（对照上方注释）。 */
export const NODE_FLAG = {
  HTTP: 0b11,
  CAN_CREATE: 1 << 2,
  MAINLAND: 1 << 3,
  NO_PROTECT: 1 << 4,
  UDP: 1 << 5,
  PRIVATE: 1 << 6,
  TLS_SUCKS: 1 << 7,
  FORCE_AUTH: 1 << 8,
  OFFLINE: 1 << 9,
  BETA: 1 << 10
} as const

/** 展示用节点信息（/nodes + /node/stats 合并结果）。 */
export interface FrpNodeInfo {
  /** 节点 ID（/nodes 响应的键） */
  id: number
  /** 节点名称 */
  name: string
  /** 节点域名 */
  host: string
  /** 官方节点说明（地区/运营商等） */
  description: string
  /** VIP 等级：0 = 免费，>0 = 需专业版（VIP） */
  vip: number
  /** 是否免费节点（vip === 0） */
  free: boolean
  /** 节点是否在线（stats.online >= 0；stats 缺失时回退 flag 离线位取反） */
  online: boolean
  /** 节点负载百分比（stats 缺失时为 null） */
  load: number | null
  /** 允许 UDP 流量 */
  udp: boolean
  /** 内地节点 */
  mainland: boolean
  /** 当前是否允许创建隧道（满载为 false） */
  canCreate: boolean
  /** 无 DDoS 防护节点 */
  noProtect: boolean
  /** BETA 节点 */
  beta: boolean
}

/** 用户隧道信息（/tunnels，仅展示所需字段）。 */
export interface FrpTunnelInfo {
  id: number
  name: string
  /** 隧道类型 tcp/udp/http/https/... */
  type: string
  /** 所在节点 ID */
  node: number
  /** 所在节点名称（与节点列表合并后回填；查不到为 null） */
  nodeName: string | null
  /** 隧道是否在线 */
  online: boolean
  /** 0 正常 / 2 封禁 */
  status: number
  localIp: string
  localPort: number
  /** 远程端口或绑定域名 */
  remote: string
}

export interface FrpNodesResult {
  /** 拉取时间（ISO） */
  fetchedAt: string
  /** 全部节点（已按 免费→专业版、在线优先、ID 升序 排序） */
  nodes: FrpNodeInfo[]
  /** 当前用户隧道列表；accessKey 无法查询隧道时为 null（不显示该区块，禁止假数据） */
  tunnels: FrpTunnelInfo[] | null
}

interface CacheEntry {
  accessKey: string
  result: FrpNodesResult
  expiresAt: number
}

let cache: CacheEntry | null = null

/** 免费节点筛选（纯函数，供 UI 与测试共用同一规则）。 */
export function filterFrpNodes(nodes: FrpNodeInfo[], onlyFree: boolean): FrpNodeInfo[] {
  return onlyFree ? nodes.filter((n) => n.free) : nodes.slice()
}

/** 统一错误：非 2xx 时 v4 API 返回 { code, msg }（HTTP 状态码可能是 500 但 body 里是真实错误码）。 */
async function apiGet(path: string, accessKey: string, body?: Record<string, unknown>): Promise<unknown> {
  let resp: Response
  try {
    resp = await httpFetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${accessKey}`, ...(body ? {'Content-Type': 'application/json'} : {}) },
      method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000)
    })
  } catch (e) {
    throw new Error('无法连接樱花穿透，请检查网络后重试')
  }
  const text = await resp.text()
  if (!resp.ok) {
    let detail = text.slice(0, 200)
    try {
      const body = JSON.parse(text) as { code?: number; msg?: string }
      if (body && typeof body.msg === 'string') detail = `${body.code ?? resp.status}: ${body.msg}`
    } catch {
      /* 保留原文 */
    }
    throw new Error(`natfrp API ${path} 请求失败（HTTP ${resp.status}）：${detail.split(accessKey).join('***')}`)
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`natfrp API ${path} 返回了无法解析的内容`)
  }
}

export interface FrpCreateTunnel { name: string; node: number; localPort: number; remotePort?: number }
/** Explicit, single-target deletion using the official /tunnel/delete contract.
 * A 200 response alone is insufficient; verify the account's uncached tunnel list. */
export async function deleteFrpTunnel(accessKey: string, id: string): Promise<{ remoteDisconnectPending: boolean }> {
  const key = String(accessKey ?? '').trim()
  if (!key || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('隧道或账号无效，无法删除')
  const exists = async () => {
    const rows = await apiGet('/tunnels', key)
    if (!Array.isArray(rows) || rows.some(r => !Number.isSafeInteger(r?.id))) throw new Error('无法确认远端隧道列表，请刷新后重试删除')
    return rows.some(r => r.id === Number(id))
  }
  cache = null
  try {
    if (!await exists()) return { remoteDisconnectPending: false }
    const result = await apiGet('/tunnel/delete', key, { ids: id }) as { deleted?: number[]; failed?: number[] }
    if (!Array.isArray(result?.deleted) || !Array.isArray(result.failed)) throw new Error('删除结果不完整，请重试确认远端状态')
    // Official `failed` means deleted but the online connection could not be kicked.
    if (!result.deleted.includes(Number(id)) && !result.failed.includes(Number(id))) throw new Error('樱花穿透未确认删除该隧道，请检查隧道是否被锁定')
    if (await exists()) throw new Error('远端仍存在该隧道，尚未确认删除成功，请稍后重试')
    return { remoteDisconnectPending: result.failed.includes(Number(id)) }
  } finally { cache = null }
}
/** Explicit user action only; no retries of POSTs, which might otherwise create duplicate tunnels. */
export async function createFrpTunnel(accessKey: string, input: FrpCreateTunnel): Promise<{id: number; name: string}> {
  const name = String(input?.name ?? '').trim()
  if (!name || name.length > 64) throw new Error('请填写 1–64 字符的隧道名称')
  if (!Number.isInteger(input.localPort) || input.localPort < 1 || input.localPort > 65535) throw new Error('请填写游戏中显示的局域网端口（1–65535）')
  if (input.remotePort && (!Number.isInteger(input.remotePort) || input.remotePort < 1 || input.remotePort > 65535)) throw new Error('远程端口无效')
  const result = await fetchFrpNodes(accessKey, {refresh:true})
  const node = result.nodes.find(n => n.id === input.node)
  if (!node?.online || !node.canCreate) throw new Error('所选节点离线或已满，请选择其他节点')
  const created = await apiGet('/tunnels', accessKey.trim(), {
    name, type:'tcp', node: node.id, local_ip:'127.0.0.1', local_port:input.localPort,
    ...(input.remotePort ? {remote:String(input.remotePort)} : {})
  }) as {id: number; name: string}
  cache = null
  if (!Number.isSafeInteger(created?.id) || created.id <= 0) throw new Error('创建结果不完整，请刷新隧道列表确认，勿重复创建')
  return created
}

export async function getRunnableFrpTunnel(accessKey: string, id: string): Promise<FrpTunnelInfo> {
  if (!/^\d+$/.test(id)) throw new Error('请先选择已创建的隧道')
  const result = await fetchFrpNodes(accessKey, {refresh:true})
  if (!result.tunnels) throw new Error('隧道列表获取失败，请检查访问密钥后重试')
  const tunnel = result.tunnels.find(t => String(t.id) === id)
  if (!tunnel || tunnel.status !== 0) throw new Error('隧道不存在或不可用，请刷新列表重新选择')
  if (tunnel.type !== 'tcp') throw new Error('Minecraft Java 版请选择 TCP 隧道')
  if (!result.nodes.find(n => n.id === tunnel.node)?.online) throw new Error('隧道所在节点已离线，请选择其他隧道')
  return tunnel
}

interface RawNode {
  name?: unknown
  host?: unknown
  description?: unknown
  vip?: unknown
  flag?: unknown
}

interface RawStat {
  id?: unknown
  online?: unknown
  load?: unknown
}

interface RawTunnel {
  id?: unknown
  name?: unknown
  type?: unknown
  node?: unknown
  online?: unknown
  status?: unknown
  local_ip?: unknown
  local_port?: unknown
  remote?: unknown
}

/** 拉取（或命中缓存）节点列表 + 节点状态 + 用户隧道。失败抛真实错误。 */
export async function fetchFrpNodes(accessKey: string, opts: { refresh?: boolean } = {}): Promise<FrpNodesResult> {
  const key = String(accessKey ?? '').trim()
  if (!key) throw new Error('请先填写访问密钥，再查询节点列表')
  if (!opts.refresh && cache && cache.accessKey === key && Date.now() < cache.expiresAt) {
    return cache.result
  }

  // /tunnels 失败不影响节点展示（tunnels = null → UI 不显示隧道区块）
  const [nodesRes, statsRes, tunnelsRes] = await Promise.allSettled([
    apiGet('/nodes', key),
    apiGet('/node/stats', key),
    apiGet('/tunnels', key)
  ])
  if (nodesRes.status === 'rejected') throw nodesRes.reason instanceof Error ? nodesRes.reason : new Error(String(nodesRes.reason))

  const rawNodes = (nodesRes.status === 'fulfilled' ? nodesRes.value : {}) as Record<string, RawNode>
  const stats = (statsRes.status === 'fulfilled' ? (statsRes.value as { nodes?: RawStat[] }) : null)?.nodes ?? []
  const statById = new Map<number, { online: boolean; load: number | null }>()
  for (const s of stats) {
    const id = typeof s.id === 'number' ? s.id : Number.NaN
    if (Number.isNaN(id)) continue
    statById.set(id, {
      online: typeof s.online === 'number' ? s.online >= 0 : true,
      load: typeof s.load === 'number' ? s.load : null
    })
  }

  const nodes: FrpNodeInfo[] = Object.entries(rawNodes)
    .map(([idStr, raw]) => {
      const id = Number.parseInt(idStr, 10)
      const flag = typeof raw.flag === 'number' ? raw.flag : 0
      const stat = statById.get(id)
      return {
        id,
        name: typeof raw.name === 'string' ? raw.name : `节点 ${idStr}`,
        host: typeof raw.host === 'string' ? raw.host : '',
        description: typeof raw.description === 'string' ? raw.description : '',
        vip: typeof raw.vip === 'number' ? raw.vip : 0,
        free: (typeof raw.vip === 'number' ? raw.vip : 0) === 0,
        // 优先用 /node/stats；缺失时回退 /nodes 的离线标志位
        online: stat ? stat.online : (flag & NODE_FLAG.OFFLINE) === 0,
        load: stat ? stat.load : null,
        udp: (flag & NODE_FLAG.UDP) !== 0,
        mainland: (flag & NODE_FLAG.MAINLAND) !== 0,
        canCreate: (flag & NODE_FLAG.CAN_CREATE) !== 0,
        noProtect: (flag & NODE_FLAG.NO_PROTECT) !== 0,
        beta: (flag & NODE_FLAG.BETA) !== 0
      }
    })
    // 免费→专业版，在线优先，负载低优先，ID 升序兜底
    .sort((a, b) => {
      if (a.free !== b.free) return a.free ? -1 : 1
      if (a.online !== b.online) return a.online ? -1 : 1
      if (a.load !== null && b.load !== null && a.load !== b.load) return a.load - b.load
      return a.id - b.id
    })

  let tunnels: FrpTunnelInfo[] | null = null
  if (tunnelsRes.status === 'fulfilled' && Array.isArray(tunnelsRes.value)) {
    const nameById = new Map(nodes.map((n) => [n.id, n.name]))
    tunnels = (tunnelsRes.value as RawTunnel[])
      .filter((t) => typeof t.id === 'number')
      .map((t) => ({
        id: t.id as number,
        name: typeof t.name === 'string' ? t.name : '',
        type: typeof t.type === 'string' ? t.type : '',
        node: typeof t.node === 'number' ? t.node : 0,
        nodeName: nameById.get(typeof t.node === 'number' ? t.node : Number.NaN) ?? null,
        online: t.online === true,
        status: typeof t.status === 'number' ? t.status : 0,
        localIp: typeof t.local_ip === 'string' ? t.local_ip : '',
        localPort: typeof t.local_port === 'number' ? t.local_port : 0,
        remote: typeof t.remote === 'string' ? t.remote : ''
      }))
  }

  const result: FrpNodesResult = { fetchedAt: new Date().toISOString(), nodes, tunnels }
  cache = { accessKey: key, result, expiresAt: Date.now() + CACHE_TTL_MS }
  return result
}
