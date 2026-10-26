import { UPDATE_MIRROR_PRESETS, MAX_CUSTOM_UPDATE_MIRRORS, normalizeUpdateMirrorUrl } from '../../shared/updateMirrors'
import { downloadFetch } from './downloadFetch'
import { downloadLimiter } from './downloadLimits'
import { inheritTaskControl, isTaskPaused, waitIfTaskPaused } from './tasks'

export interface UpdateSourceSettings {
  updateSource?: 'auto' | 'direct' | 'mirror'
  updateMirrorUrl?: string
  updateMirrorUrls?: string[]
}

/** Old single-prefix configurations remain additional candidates after migration. */
export function updateDownloadCandidates(assetUrl: string, settings: UpdateSourceSettings): string[] {
  if (settings.updateSource === 'direct') return [assetUrl]
  const custom = [settings.updateMirrorUrl, ...(Array.isArray(settings.updateMirrorUrls) ? settings.updateMirrorUrls.slice(0, MAX_CUSTOM_UPDATE_MIRRORS) : [])]
    .map(value => normalizeUpdateMirrorUrl(value ?? '')).filter((value): value is string => !!value)
  const mirrors = [...new Set([...UPDATE_MIRROR_PRESETS, ...custom])].map(prefix => prefix + assetUrl)
  return [...new Set(settings.updateSource === 'mirror' ? mirrors : [assetUrl, ...mirrors])]
}

export const updateProbePolicy = { bytes: 64 * 1024, timeoutMs: 4000, concurrency: 3, cacheTtlMs: 5 * 60_000, maxCacheEntries: 128 }
export interface UpdateProbeSample { url: string; ok: boolean; headersMs: number; bodyMs: number; bytes: number }
interface CachedProbe { at: number; sample: UpdateProbeSample }

/** The cache is process-local, bounded and scoped to an exact asset + size.
 * Failed probes only lower priority: they never revoke the common engine's fallback.
 */
export class UpdateProbeCache {
  private readonly entries = new Map<string, CachedProbe>()
  constructor(private readonly clock = Date.now) {}
  private key(url: string, size?: number): string { return JSON.stringify([url, size ?? null]) }
  get(url: string, size?: number): UpdateProbeSample | undefined {
    const key = this.key(url, size), value = this.entries.get(key)
    if (!value) return
    if (this.clock() - value.at >= updateProbePolicy.cacheTtlMs) { this.entries.delete(key); return }
    this.entries.delete(key); this.entries.set(key, value)
    return { ...value.sample }
  }
  put(sample: UpdateProbeSample, size?: number): void {
    const key = this.key(sample.url, size)
    this.entries.delete(key)
    this.entries.set(key, { at: this.clock(), sample: { ...sample } })
    while (this.entries.size > updateProbePolicy.maxCacheEntries) this.entries.delete(this.entries.keys().next().value!)
  }
  clear(): void { this.entries.clear() }
  get size(): number { return this.entries.size }
}

export const updateProbeCache = new UpdateProbeCache()

/** Production update requests never carry embedded credentials or downgrade TLS.
 * Loopback HTTP is reserved for the already-isolated update fixture environment.
 */
export function validateUpdateDownloadUrl(value: string, allowLoopback = false): void {
  const url = new URL(value)
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(allowLoopback && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))))
    throw new Error('更新下载地址必须使用无认证信息的 HTTPS')
}

export interface UpdateProbeOptions {
  fetcher?: typeof downloadFetch
  cache?: UpdateProbeCache
  /** For isolated loopback fixtures only; production never enables it. */
  allowLoopback?: boolean
}

async function probeUpdateSource(url: string, size: number | undefined, signal: AbortSignal | undefined, options: UpdateProbeOptions): Promise<UpdateProbeSample> {
  const result: UpdateProbeSample = { url, ok: false, headersMs: 0, bodyMs: 0, bytes: 0 }
  validateUpdateDownloadUrl(url, options.allowLoopback)
  await waitIfTaskPaused(signal)
  const release = await downloadLimiter.acquire(signal)
  const controller = new AbortController(), abort = () => controller.abort(signal?.reason)
  inheritTaskControl(signal, controller.signal)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let elapsed = 0, last = performance.now()
  // Waiting for a slot or a user pause consumes no probe timeout.
  const tick = () => {
    const now = performance.now(), dt = now - last; last = now
    if (!isTaskPaused(signal) && !downloadLimiter.isThrottling) elapsed += dt
    if (elapsed >= updateProbePolicy.timeoutMs) controller.abort(new Error('镜像首块测速超时'))
  }
  const timer = setInterval(tick, 50)
  try {
    signal?.throwIfAborted()
    const length = Math.min(updateProbePolicy.bytes, size && size > 0 ? size : updateProbePolicy.bytes)
    const started = elapsed
    response = await (options.fetcher ?? downloadFetch)(url, {
      signal: controller.signal, headers: { Range: `bytes=0-${length - 1}`, 'accept-encoding': 'identity' }, separateConnection: true
    }, undefined, undefined, async next => validateUpdateDownloadUrl(next, options.allowLoopback))
    tick()
    result.headersMs = Math.max(1, elapsed - started)
    if (![200, 206].includes(response.status) || !response.body || /(?:text\/|json|xml)/i.test(response.headers.get('content-type') ?? '')) return result
    if (response.status === 206) {
      const range = /^bytes 0-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
      if (!range || Number(range[1]) !== length - 1 || (size && Number(range[2]) !== size) || Number(range[1]) >= Number(range[2])) return result
    } else {
      const advertised = Number(response.headers.get('content-length'))
      if (size && advertised && advertised !== size) return result
    }
    reader = response.body.getReader()
    while (result.bytes < length) {
      await waitIfTaskPaused(signal)
      controller.signal.throwIfAborted()
      const readAt = performance.now(), chunk = await reader.read()
      result.bodyMs += performance.now() - readAt
      if (chunk.done) break
      await downloadLimiter.consume(chunk.value.length, signal)
      result.bytes += Math.min(chunk.value.length, length - result.bytes)
    }
    result.ok = result.bytes === length
    return result
  } catch {
    signal?.throwIfAborted()
    return result
  } finally {
    clearInterval(timer)
    controller.abort()
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock() }
    else await response?.body?.cancel().catch(() => {})
    signal?.removeEventListener('abort', abort)
    release()
  }
}

/** A small parallel first-block probe ranks candidates before useful transfer.
 * Transfers themselves still use downloadAll's range retries, real-speed switching,
 * global limits and final checksum. Probe traffic never inflates file progress.
 */
export async function rankUpdateSources(urls: string[], size?: number, signal?: AbortSignal, options: UpdateProbeOptions = {}): Promise<string[]> {
  signal?.throwIfAborted()
  const candidates = [...new Set(urls)]
  if (candidates.length < 2 || downloadLimiter.isThrottling) return candidates
  const cache = options.cache ?? updateProbeCache, samples = new Map<string, UpdateProbeSample>()
  const pending = candidates.filter(url => { const sample = cache.get(url, size); if (sample) samples.set(url, sample); return !sample })
  let cursor = 0
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(pending.length, updateProbePolicy.concurrency) }, async () => {
    while (cursor < pending.length) {
      signal?.throwIfAborted()
      const url = pending[cursor++]
      let sample: UpdateProbeSample
      try { sample = await probeUpdateSource(url, size, signal, options) }
      catch { signal?.throwIfAborted(); sample = { url, ok: false, headersMs: 0, bodyMs: 0, bytes: 0 } }
      signal?.throwIfAborted()
      samples.set(url, sample); cache.put(sample, size)
    }
  }))
  signal?.throwIfAborted()
  const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
  if (failure) throw failure.reason
  const cost = (sample: UpdateProbeSample) => sample.ok ? sample.headersMs + (size ?? updateProbePolicy.bytes) * Math.max(1, sample.bodyMs) / sample.bytes : Infinity
  return candidates.map((url, index) => ({ url, index, sample: samples.get(url)! }))
    .sort((a, b) => cost(a.sample) - cost(b.sample) || a.index - b.index).map(item => item.url)
}
