// SPDX-License-Identifier: MIT
// KAMUCL HTTP adapter. Endpoint/envelope contract: VoxLink SignalingClient.java 6b11d93.
import { version } from '../../../../package.json'
export const APP_VERSION = version
export const DEFAULT_SERVER_URL = 'https://p2p.wuhui.icu'
export const HTTP_TIMEOUT_MS = 10_000
export const MAX_RESPONSE_LEN = 4 << 20
export const CLIENT_TAG = 'kamucl'
export type QueryValue = string | number | boolean | undefined | null
export interface Envelope { success: boolean; data?: unknown; error?: string; message?: string }
export interface ApiClientOptions { userAgent?: string; timeoutMs?: number }
export class APIError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) { super(`${code}: ${message}`); this.name = 'APIError' }
}
export function validateServerURL(value: string): boolean {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !!u.hostname && !u.username && !u.password } catch { return false }
}
export const validateRoomCode = (value: string) => /^[A-HJ-NP-Z2-9]{6}$/.test(value)
export class ApiClient {
  readonly userAgent: string
  readonly timeoutMs: number
  private deadlines = new Map<string, number>()
  constructor(options: ApiClientOptions = {}) { this.userAgent = options.userAgent ?? `KAMUCL-App/${APP_VERSION}`; this.timeoutMs = options.timeoutMs ?? HTTP_TIMEOUT_MS }
  async do(base: string, method: 'GET' | 'POST', route: string, query: Record<string, QueryValue | QueryValue[]>, body: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!validateServerURL(base)) throw new APIError('NETWORK', '服务器地址无效')
    const key = route === '/room/update' ? `${base}|${String((body as { code?: string })?.code ?? '')}` : ''
    if (key && (this.deadlines.get(key) ?? 0) > Date.now()) throw new APIError('RATE_LIMITED', '请稍后再修改房间', 429)
    const url = new URL(base); url.searchParams.set('route', route)
    for (const [name, values] of Object.entries(query)) for (const value of Array.isArray(values) ? values : [values]) if (value != null) url.searchParams.append(name, String(value))
    try {
      const response = await fetch(url, { method, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs), headers: { 'User-Agent': this.userAgent, 'X-VoxLink-Version': APP_VERSION, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}) })
      const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0
      try {
        if (reader) while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_RESPONSE_LEN) throw new APIError('RESPONSE_LIMIT', '服务器响应过大', response.status); chunks.push(part.value) }
      } finally { await reader?.cancel().catch(() => {}) }
      let envelope: Envelope
      try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new APIError(`HTTP_${response.status}`, '服务器未返回有效 JSON', response.status) }
      if (response.status === 429 && key) {
        const retry = response.headers.get('retry-after'); const seconds = Number(retry)
        const delay = retry && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry ?? '') - Date.now()
        this.deadlines.set(key, Date.now() + Math.max(1000, Number.isFinite(delay) ? delay : 30000))
      }
      if (!response.ok || envelope.success !== true) throw new APIError(envelope.error ?? (response.status === 429 ? 'RATE_LIMITED' : `HTTP_${response.status}`), envelope.message ?? '请求失败', response.status)
      return envelope.data ?? null
    } catch (error) { if (error instanceof APIError) throw error; throw new APIError('NETWORK', (error as Error).message) }
  }
  async post(base: string, route: string, body: unknown, target?: unknown, signal?: AbortSignal): Promise<unknown> { const result = await this.do(base, 'POST', route, {}, body, signal); if (target && result) Object.assign(target, result); return result }
  async get(base: string, route: string, query: Record<string, QueryValue | QueryValue[]>, target?: unknown, signal?: AbortSignal): Promise<unknown> { const result = await this.do(base, 'GET', route, query, null, signal); if (target && result) Object.assign(target, result); return result }
}
export const newAPIClient = () => new ApiClient()
