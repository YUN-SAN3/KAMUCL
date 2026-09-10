/**
 * 共享 HTTP/2 客户端：undici Agent（allowH2 自动协商，服务端不支持则回退 HTTP/1.1），
 * keepAlive 连接复用。多文件并行下载时 h2 多路复用明显更稳。
 * 用法与全局 fetch 一致（httpFetch 内部带共享 dispatcher）。
 *
 * bodyTimeoutMs（可选增量参数，仅下载路径使用）：undici 的 bodyTimeout 监测「socket 层
 * 相邻两次收到响应数据的间隔」。共享 Agent 默认 30s；下载在读循环里做限速/暂停时，
 * TCP 背压会让服务端合法停发数据，低档限速（如 1KiB/s 放行一个 64KB 读块需 ~64s）
 * 会被 30s 默认值误判为死链而反复中止（表现为「下载总是被取消」），因此下载路径显式
 * 传更长的 bodyTimeoutMs，其余调用方（frp 等）行为不变。
 */
import { Agent, fetch as undiciFetch } from 'undici'

/** 共享 Agent 与按 bodyTimeout 派生 Agent 的公共参数；调整时两者保持一致。 */
const AGENT_BASE_OPTIONS = {
  allowH2: true,
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 60_000,
  connections: 32,
  headersTimeout: 30_000
}

const sharedAgent = new Agent({ ...AGENT_BASE_OPTIONS, bodyTimeout: 30_000 })

/** bodyTimeoutMs → 派生 Agent 缓存。键空间恒定（下载路径只用一个常量值），不会无限增长。 */
const bodyTimeoutAgents = new Map<number, Agent>()

function agentWithBodyTimeout(bodyTimeoutMs: number): Agent {
  let agent = bodyTimeoutAgents.get(bodyTimeoutMs)
  if (!agent) {
    agent = new Agent({ ...AGENT_BASE_OPTIONS, bodyTimeout: bodyTimeoutMs })
    bodyTimeoutAgents.set(bodyTimeoutMs, agent)
  }
  return agent
}

/** 与全局 fetch 同签名；signal/headers/redirect 等透传，dispatcher 固定共享 h2 Agent。
 *  bodyTimeoutMs 为可选增量参数：不传时行为与旧版完全一致。 */
export function httpFetch(
  url: string,
  init: { signal?: AbortSignal; headers?: Record<string, string>; redirect?: 'follow' | 'manual' | 'error'; method?: string; body?: string; bodyTimeoutMs?: number } = {}
): Promise<Response> {
  if (init.bodyTimeoutMs != null) {
    const { bodyTimeoutMs, ...rest } = init
    return undiciFetch(url, { ...rest, dispatcher: agentWithBodyTimeout(bodyTimeoutMs) }) as unknown as Promise<Response>
  }
  return undiciFetch(url, { ...init, dispatcher: sharedAgent }) as unknown as Promise<Response>
}

/** 进程退出时关闭连接池（Electron 退出由主进程生命周期管理，这里仅防御性提供）。 */
export async function closeHttpClient(): Promise<void> {
  await Promise.all([sharedAgent.close(), ...[...bodyTimeoutAgents.values()].map((agent) => agent.close())])
}
