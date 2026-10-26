import https from 'node:https'
import http from 'node:http'
import net from 'node:net'
import tls from 'node:tls'
import { checkServerIdentity } from 'node:tls'
import { execFileSync } from 'node:child_process'

const MICROSOFT_HOSTS = new Set([
  'login.microsoftonline.com', 'user.auth.xboxlive.com',
  'xsts.auth.xboxlive.com', 'api.minecraftservices.com'
])

export function microsoftEndpoint(input: string): URL {
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      (url.port && url.port !== '443') || !MICROSOFT_HOSTS.has(url.hostname))
    throw new Error('正版登录只允许连接受信任的 Microsoft / Xbox / Minecraft HTTPS 地址')
  return url
}

export function certificateError(error: NodeJS.ErrnoException): Error {
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|TLS/i.test(error.code ?? ''))
    return new Error(`SSL 证书验证失败（${error.code}）。请检查系统时间、代理或网络证书；登录已中止。`)
  return new Error(`正版登录连接失败：${error.code ?? error.message}`)
}

/** 读取 Windows 系统代理（HKCU Internet Settings）。未启用或非 Windows 返回 null。 */
export function systemProxyAddress(): string | null {
  if (process.platform !== 'win32') return null
  try {
    const query = (name: string) =>
      execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', name], { encoding: 'utf-8', timeout: 5000, windowsHide: true })
    const enabled = /ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(query('ProxyEnable'))
    if (!enabled) return null
    const server = /ProxyServer\s+REG_SZ\s+(\S+)/i.exec(query('ProxyServer'))?.[1]?.trim()
    if (!server) return null
    // 形如 127.0.0.1:7897 或 http=host:port;https=... 的分协议串
    const first = server.includes('=') ? (server.split(';').find((s) => s.startsWith('http='))?.slice(5) ?? server.split(';')[0].split('=')[1]) : server
    return first ?? null
  } catch {
    return null
  }
}

/**
 * 经系统代理建立 CONNECT 隧道，隧道内端到端 TLS（servername + 证书链校验保持，
 * 代理只是传输层，无法解密内容）。
 */
async function proxiedTlsSocket(proxyAddress: string, target: URL, timeoutMs: number, signal?: AbortSignal): Promise<tls.TLSSocket> {
  signal?.throwIfAborted()
  const [host, portText] = proxyAddress.split(':')
  const port = Number(portText) || 7897
  const raw = await new Promise<net.Socket>((resolve, reject) => {
    const req = http.request({
      host, port, method: 'CONNECT', path: `${target.hostname}:443`, timeout: timeoutMs, signal
    })
    req.once('connect', (res, socket) => {
      if (res.statusCode === 200) resolve(socket)
      else {
        socket.destroy()
        reject(new Error(`代理 CONNECT 失败：HTTP ${res.statusCode}`))
      }
    })
    req.once('error', reject)
    req.once('timeout', () => req.destroy(new Error('代理连接超时')))
    req.end()
  })
  if (signal?.aborted) { raw.destroy(); signal.throwIfAborted() }
  const tlsSocket = tls.connect({
    socket: raw,
    servername: target.hostname,
    checkServerIdentity,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    ALPNProtocols: ['http/1.1']
  })
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', aborted)
    const aborted = () => { cleanup(); tlsSocket.destroy(); reject(new DOMException('Cancelled', 'AbortError')) }
    tlsSocket.once('secureConnect', () => { cleanup(); resolve() })
    tlsSocket.once('error', (error) => { cleanup(); tlsSocket.destroy(); reject(certificateError(error as NodeJS.ErrnoException)) })
    signal?.addEventListener('abort', aborted, { once: true })
    if (signal?.aborted) aborted()
  })
  return tlsSocket
}

/** 校验真实认证连接的证书链、主机名和有效期；不跟随重定向发送凭据。
 * 单独使用 HTTPS Agent，避免外部全局 fetch dispatcher 或 TLS 环境变量绕过验证。
 * useProxy 开启时走系统代理 CONNECT 隧道，端到端 TLS 校验保持不变。
 */
export function microsoftFetch(input: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal; useProxy?: boolean } = {}): Promise<Response> {
  const url = microsoftEndpoint(input)
  const proxy = init.useProxy ? systemProxyAddress() : null
  return new Promise((resolve, reject) => {
    const start = (socket?: tls.TLSSocket) => {
      if (init.signal?.aborted) { socket?.destroy(); reject(new DOMException('Cancelled', 'AbortError')); return }
      const fail = (error: unknown) => { socket?.destroy(); reject(error) }
      let req: http.ClientRequest
      try { req = https.request(url, {
        method: init.method ?? 'GET', headers: init.headers, signal: init.signal,
        rejectUnauthorized: true, checkServerIdentity, minVersion: 'TLSv1.2',
        // Node 24 agent:false creates a new Agent, which ignores createConnection.
        // With no Agent, the request must consume the already authenticated tunnel socket.
        ...(socket ? { agent: undefined, createConnection: () => socket } : { agent: false })
      }, res => {
        const status = res.statusCode ?? 500
        if (status >= 300 && status < 400) {
          res.destroy(); fail(new Error('正版认证端点返回了重定向，已阻止发送登录凭据')); return
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 2 * 1024 * 1024) res.destroy(new Error('正版认证响应超过大小限制'))
          else chunks.push(chunk)
        })
        res.once('error', fail)
        res.once('aborted', () => fail(new Error('正版认证响应提前中止')))
        res.once('end', () => {
          try { resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status })) }
          catch (error) { fail(error) }
          finally { socket?.destroy() }
        })
      }) } catch (error) { fail(error); return }
      req.setTimeout(30000, () => req.destroy(new Error('正版认证连接超时')))
      req.once('error', error => fail(certificateError(error)))
      req.once('close', () => socket?.destroy())
      req.end(init.body)
    }
    if (!proxy) {
      start()
      return
    }
    proxiedTlsSocket(proxy, url, 30000, init.signal).then(start, (error) => reject(new Error(`系统代理连接失败：${error instanceof Error ? error.message : String(error)}`)))
  })
}
