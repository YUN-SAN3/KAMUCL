/**
 * 共享 HTTP/2 客户端：undici Agent（allowH2 自动协商，服务端不支持则回退 HTTP/1.1），
 * keepAlive 连接复用。多文件并行下载时 h2 多路复用明显更稳。
 * 用法与全局 fetch 一致（httpFetch 内部带共享 dispatcher）。
 */
import { Agent, fetch as undiciFetch } from 'undici'

const sharedAgent = new Agent({
  allowH2: true,
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 60_000,
  connections: 32,
  headersTimeout: 30_000,
  bodyTimeout: 30_000
})

/** 与全局 fetch 同签名；signal/headers/redirect 等透传，dispatcher 固定共享 h2 Agent。 */
export function httpFetch(
  url: string,
  init: { signal?: AbortSignal; headers?: Record<string, string>; redirect?: 'follow' | 'manual' | 'error'; method?: string; body?: string } = {}
): Promise<Response> {
  return undiciFetch(url, { ...init, dispatcher: sharedAgent }) as unknown as Promise<Response>
}

/** 进程退出时关闭连接池（Electron 退出由主进程生命周期管理，这里仅防御性提供）。 */
export async function closeHttpClient(): Promise<void> {
  await sharedAgent.close()
}
