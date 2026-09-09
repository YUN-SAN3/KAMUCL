/**
 * 下载模块：流式写盘 + sha1 校验 + BMCLAPI 镜像回退 + 并发池
 * 移植 PCL2 下载引擎优化：
 * - 本地文件复用（CheckExistingFiles）：大小预筛 + sha1 校验，命中直接复制
 * - 大文件分块多线程下载：8MB/块、最多 8 连接、每块独立重试、可断点续传
 *   （块组失败保留已完成块的 .partN 断点；整体看门狗只在「有块传输中」停滞时才回退单连接，
 *    排队等并发名额不算停滞——否则并发闸门饥饿会误杀健康分块组）
 * - 慢速连接主动掐断：滑动窗口内字节过少即断开换源（限速时跳过）
 * - 会话级源健康度（NetSource.FailCount/IsFailed）：连续 transient 失败的 host 冷却沉底
 * - 磁盘空间预检：≥50MB 文件下载前检查剩余空间
 * 网络层经 httpClient（undici allowH2 共享连接池），文件/哈希用 node:fs / node:crypto
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { once } from 'node:events'
import { pipeline } from 'node:stream/promises'
import { downloadLimiter } from './downloadLimits'
import { launcherLog } from './launcherLog'
import { httpFetch } from './httpClient'
import {
  abortableDelay,
  inheritTaskControl,
  isTaskPaused,
  waitIfTaskPaused
} from './tasks'
import {
  DownloadProgressTracker,
  SmoothedSpeedEstimator,
  type DownloadProgressSnapshot
} from './downloadProgress'

export type MirrorPref = 'official' | 'bmclapi'
export type ProgressFn = (done: number, total: number) => void
export interface DownloadBatchProgress extends DownloadProgressSnapshot {
  speedBps: number
  etaSeconds: number | null
  paused: boolean
}
/** 前三个参数保留兼容；detail 提供真实字节进度、平滑 ETA 和不确定状态。 */
export type AllProgressFn = (
  done: number,
  total: number,
  speedBps: number,
  detail: DownloadBatchProgress
) => void

export interface DownloadTask {
  url: string
  /** 元数据声明的其他合法来源，按原顺序 fallback。 */
  urls?: string[]
  dest: string
  sha1?: string
  sha512?: string
  size?: number
}

const BMCLAPI_HOST = 'bmclapi2.bangbang93.com'
export const BMCL_MAVEN_ROOT = `https://${BMCLAPI_HOST}/maven/`

/** 这些域名在 BMCLAPI 下为透明镜像，直接换 host、路径不变 */
const PLAIN_MIRROR_HOSTS = new Set([
  'piston-meta.mojang.com',
  'piston-data.mojang.com',
  'launchermeta.mojang.com',
  'launcher.mojang.com'
])

/**
 * 按镜像偏好改写 URL。
 * maven 系仓库（libraries.minecraft.net / fabric / quilt / forge / neoforge）
 * 在 BMCLAPI 下对应 /maven 前缀，等价于 host 替换 + 路径前补 /maven。
 */
export function mirrorUrl(url: string, mirror: MirrorPref): string {
  if (mirror !== 'bmclapi') return url
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return url
    const host = u.hostname.toLowerCase()
    if (PLAIN_MIRROR_HOSTS.has(host)) {
      return `https://${BMCLAPI_HOST}${u.pathname}${u.search}`
    }
    // BMCLAPI 的 Assets 根比 Mojang 多一层 /assets。
    if (host === 'resources.download.minecraft.net') {
      return `https://${BMCLAPI_HOST}/assets${u.pathname}${u.search}`
    }
    if (host === 'libraries.minecraft.net' || host === 'maven.fabricmc.net' || host === 'maven.minecraftforge.net') {
      return `${BMCL_MAVEN_ROOT}${u.pathname.replace(/^\/+/, '')}${u.search}`
    }
    // 官方文档将 /releases 映射到 BMCL /maven 根，不能得到 /maven/releases/...。
    if (host === 'maven.neoforged.net' && u.pathname.startsWith('/releases/')) {
      return `${BMCL_MAVEN_ROOT}${u.pathname.slice('/releases/'.length)}${u.search}`
    }
    // files.minecraftforge.net 只有 /maven 子树有明确镜像规则。
    if (host === 'files.minecraftforge.net' && u.pathname.startsWith('/maven/')) {
      return `${BMCL_MAVEN_ROOT}${u.pathname.slice('/maven/'.length)}${u.search}`
    }
    // BMCL 文档目前把 Quilt 镜像标记为不可用，保留元数据原地址。
    return url
  } catch {
    return url
  }
}

export type HttpFailureKind = 'unavailable' | 'transient' | 'fatal'

/** 404/410 表示该地址永久不可用；仅临时状态允许对同一 URL 退避重试。 */
export function classifyHttpStatus(status: number): HttpFailureKind {
  if (status === 404 || status === 410) return 'unavailable'
  if (status === 408 || status === 425 || status === 429) return 'transient'
  if (status >= 500 && status <= 599 && status !== 501 && status !== 505) return 'transient'
  return 'fatal'
}

export class DownloadHttpError extends Error {
  readonly status: number
  readonly url: string

  constructor(status: number, url: string) {
    super(`HTTP ${status}: ${url}`)
    this.name = 'DownloadHttpError'
    this.status = status
    this.url = url
  }
}

class DownloadIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DownloadIntegrityError'
  }
}

function classifyTransferError(e: unknown): HttpFailureKind {
  if (e instanceof DownloadHttpError) return classifyHttpStatus(e.status)
  if (e instanceof DownloadIntegrityError) return 'fatal'
  // 服务端不支持 Range：重试无意义，直接回退单连接/换源
  if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'transient'
  return 'transient'
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + 'MB'
  if (n >= 1024) return (n / 1024).toFixed(1) + 'KB'
  return `${n}B`
}

// ---------------- 慢速连接检测（PCL2：包间隔过长且速度过低即主动掐断换源） ----------------

/** 单次传输的响应体超时（慢速/挂起兜底） */
const DOWNLOAD_BODY_TIMEOUT_MS = 120_000

/** 慢速检测阈值，模块级导出便于测试注入。 */
export const slowSpeedThresholds = {
  /** 滑动窗口时长 */
  windowMs: 15_000,
  /** 窗口内最少接收字节，低于该值视为慢速 */
  minWindowBytes: 16 * 1024,
  /** 累计接收达到该字节数后才开始判定，避免对正常慢启动误判 */
  warmupBytes: 1024 * 1024
}

/** 每个连接独立的滑动窗口；暂停恢复时 reset，限速时整体跳过检测。 */
class SlowWindow {
  private samples: Array<{ at: number; bytes: number }> = []
  private receivedTotal = 0

  add(bytes: number, now = Date.now()): void {
    this.receivedTotal += bytes
    this.samples.push({ at: now, bytes })
  }

  /** 暂停恢复后调用：丢弃暂停前的样本，避免暂停时间被计入窗口。 */
  reset(): void {
    this.samples = []
  }

  shouldAbort(now = Date.now()): boolean {
    if (downloadLimiter.isThrottling) return false
    if (this.receivedTotal < slowSpeedThresholds.warmupBytes) return false
    const first = this.samples[0]
    if (!first || now - first.at < slowSpeedThresholds.windowMs) return false
    while (this.samples.length > 1 && now - this.samples[0].at > slowSpeedThresholds.windowMs) {
      this.samples.shift()
    }
    let windowBytes = 0
    for (const sample of this.samples) windowBytes += sample.bytes
    return windowBytes < slowSpeedThresholds.minWindowBytes
  }
}

// ---------------- 会话级源健康度（PCL2 NetSource.FailCount/IsFailed） ----------------

interface HostHealthRecord {
  /** 连续 transient 失败次数（成功即清零） */
  fails: number
  cooldownUntil: number
}

const hostHealth = new Map<string, HostHealthRecord>()
const HOST_COOLDOWN_BASE_MS = 2 * 60_000
const HOST_COOLDOWN_MAX_MS = 10 * 60_000

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase() || null
  } catch {
    return null
  }
}

/** 记录一次 host 级 transient 失败（超时/5xx/429/网络中断）；404/410 等文件级错误不记账。 */
export function noteHostFailure(url: string): void {
  const host = hostOf(url)
  if (!host) return
  const rec = hostHealth.get(host) ?? { fails: 0, cooldownUntil: 0 }
  rec.fails += 1
  if (rec.fails >= 2) {
    const cooldown = Math.min(HOST_COOLDOWN_BASE_MS * 2 ** (rec.fails - 2), HOST_COOLDOWN_MAX_MS)
    rec.cooldownUntil = Date.now() + cooldown
  }
  hostHealth.set(host, rec)
}

/** host 下载成功：清零失败计数并解除冷却。 */
export function noteHostSuccess(url: string): void {
  const host = hostOf(url)
  if (host) hostHealth.delete(host)
}

/** 整体重试一轮时调用：网络波动恢复后解除所有 host 冷却，避免恢复的源仍被沉底。 */
export function noteHostsRecovered(): void {
  const now = Date.now()
  for (const rec of hostHealth.values()) {
    if (rec.cooldownUntil <= now) rec.cooldownUntil = 0
    rec.fails = 0
  }
}

/** 仅供测试：清空会话级健康度记录。 */
export function resetHostHealthForTest(): void {
  hostHealth.clear()
}

/** 稳定重排候选：冷却中的 host 沉底；全部冷却或全部正常时保持原序。 */
function reorderCandidatesByHostHealth(candidates: string[]): string[] {
  const now = Date.now()
  const healthy: string[] = []
  const cooling: string[] = []
  for (const candidate of candidates) {
    const rec = hostHealth.get(hostOf(candidate) ?? '')
    ;(rec && rec.cooldownUntil > now ? cooling : healthy).push(candidate)
  }
  return healthy.length > 0 && cooling.length > 0 ? [...healthy, ...cooling] : candidates
}

// ---------------- 磁盘空间预检（PCL2：对大文件下载前检查剩余空间） ----------------

const DISK_CHECK_MIN_BYTES = 50 * 1024 * 1024

/** statfs 探测可注入（statfsSync 不可用或测试场景）。 */
let statfsProbe: (dir: string) => { bavail: number; bsize: number } | null = (dir) => fs.statfsSync(dir)

/** 仅供测试：注入 statfs 实现；传 null 恢复默认。 */
export function setStatfsProbeForTest(probe: ((dir: string) => { bavail: number; bsize: number }) | null): void {
  statfsProbe = probe ?? ((dir) => fs.statfsSync(dir))
}

/**
 * 下载前磁盘空间预检：分块路径需 ≥2×size（.partN + 拼接用的 .part），
 * 单连接需 ≥size+16MB；不足时抛出不可重试的友好错误。statfs 失败则跳过检查。
 */
function assertDiskSpace(dest: string, size: number): void {
  if (size < DISK_CHECK_MIN_BYTES) return
  let stat: { bavail: number; bsize: number } | null
  try {
    stat = statfsProbe(path.dirname(dest))
  } catch {
    return
  }
  if (!stat) return
  const available = stat.bavail * stat.bsize
  // 单连接下载的产物需求：.part 续传缓存 + 目标文件
  const need = size + 16 * 1024 * 1024
  if (available >= need) return
  throw new Error(
    `磁盘空间不足：${path.parse(dest).root} 安装 ${path.basename(dest)} 需要约 ${fmtBytes(need)}，当前仅剩 ${fmtBytes(available)}`
  )
}

/** 元数据给出的真实地址始终优先；仅配置镜像且规则明确支持时追加 BMCL 备用地址。 */
export function downloadCandidates(urls: string[], mirror: MirrorPref): string[] {
  const out: string[] = []
  for (const url of urls) {
    if (url && !out.includes(url)) out.push(url)
    if (mirror === 'bmclapi') {
      const mirrored = mirrorUrl(url, mirror)
      if (mirrored && mirrored !== url && !out.includes(mirrored)) out.push(mirrored)
    }
  }
  return out
}

/** 合并 30s 超时与外部取消信号（版本清单等裸 fetch 调用点使用；取消立即中断） */
export function fetchSignal(extSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(30000)
  if (!extSignal) return timeout
  if (extSignal.aborted) return extSignal
  // Electron 33 / Node 20 支持 AbortSignal.any；组合信号会自行解除来源监听，
  // 避免每次 fetch 都把永久监听器挂在任务 signal 上。
  return AbortSignal.any([timeout, extSignal])
}

/** 一次流读取同时计算所需哈希，校验阶段也响应任务取消。 */
function hashesOf(
  file: string,
  algorithms: Array<'sha1' | 'sha512'>,
  signal?: AbortSignal
): Promise<Partial<Record<'sha1' | 'sha512', string>>> {
  return new Promise((resolve, reject) => {
    const hashes = new Map(algorithms.map((algorithm) => [algorithm, crypto.createHash(algorithm)]))
    const stream = fs.createReadStream(file)
    const onAbort = (): void => {
      stream.destroy(new DOMException('已取消', 'AbortError'))
    }
    stream
      .on('error', reject)
      .on('data', (data) => {
        for (const hash of hashes.values()) hash.update(data)
      })
      .on('end', () => {
        const result: Partial<Record<'sha1' | 'sha512', string>> = {}
        for (const [algorithm, hash] of hashes) result[algorithm] = hash.digest('hex')
        resolve(result)
      })
      .on('close', () => signal?.removeEventListener('abort', onAbort))
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function verifyFile(
  file: string,
  expected: { sha1?: string; sha512?: string; size?: number },
  signal?: AbortSignal
): Promise<string | null> {
  const stat = await fs.promises.stat(file)
  if (expected.size != null && stat.size !== expected.size) {
    return `大小校验失败：期望 ${expected.size}，实际 ${stat.size}`
  }
  const algorithms: Array<'sha1' | 'sha512'> = []
  if (expected.sha1) algorithms.push('sha1')
  if (expected.sha512) algorithms.push('sha512')
  if (!algorithms.length) return null
  const actual = await hashesOf(file, algorithms, signal)
  if (expected.sha1 && actual.sha1 !== expected.sha1.toLowerCase()) return 'sha1 校验失败'
  if (expected.sha512 && actual.sha512 !== expected.sha512.toLowerCase()) return 'sha512 校验失败'
  return null
}

interface TransferResult {
  tmp: string
  received: number
  total: number
}
/**
 * 单次下载到 .part；支持 HTTP Range 续传，最终校验与原子改名由 downloadFile 负责。
 * allowSizeProbe：大小未知时在首个请求携带 Range: bytes=0- 顺带探测总长，
 * 服务端支持 Range 且总长 ≥8MB 时升级为分块下载（不产生额外请求）。
 */
async function doDownload(
  url: string,
  dest: string,
  onProgress?: ProgressFn,
  extSignal?: AbortSignal,
  expectedSize?: number,
  allowSizeProbe = false
): Promise<TransferResult> {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  if (extSignal?.aborted) throw new Error('已取消')
  const tmp = dest + '.part'
  let offset = 0
  try {
    offset = fs.statSync(tmp).size
    if (expectedSize != null && offset > expectedSize) {
      fs.rmSync(tmp, { force: true })
      offset = 0
    }
  } catch {
    offset = 0
  }

  const requestController = new AbortController()
  const onExternalAbort = (): void => requestController.abort(extSignal?.reason)
  extSignal?.addEventListener('abort', onExternalAbort, { once: true })
  let inactivityTimer: NodeJS.Timeout | undefined
  const clearInactivity = (): void => {
    if (inactivityTimer) clearTimeout(inactivityTimer)
    inactivityTimer = undefined
  }
  const armInactivity = (): void => {
    clearInactivity()
    inactivityTimer = setTimeout(
      () => requestController.abort(new DOMException('网络读取超时', 'TimeoutError')),
      30_000
    )
  }

  try {
    // 并发闸门覆盖连接的实际传输期；分块时每个连接各占一个名额，避免外层占槽导致饿死
    const releaseSlot = await downloadLimiter.acquire(extSignal)
    try {
      await waitIfTaskPaused(extSignal)
      armInactivity()
      const headers: Record<string, string> = {}
      if (offset > 0) headers.Range = `bytes=${offset}-`
      else if (allowSizeProbe) headers.Range = 'bytes=0-'
      const res = await httpFetch(url, {
        signal: requestController.signal,
        redirect: 'follow',
        headers,
        bodyTimeoutMs: DOWNLOAD_BODY_TIMEOUT_MS
      })
      if (res.status === 416 && expectedSize != null && offset === expectedSize) {
        await res.body?.cancel()
        clearInactivity()
        onProgress?.(offset, expectedSize)
        return { tmp, received: offset, total: expectedSize }
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel()
        throw new DownloadHttpError(res.status, url)
      }

      const append = offset > 0 && res.status === 206
      if (!append) offset = 0 // 服务端忽略 Range 并返回 200 时从头覆盖
      const contentRange = res.headers.get('content-range')
      const rangeMatch = contentRange?.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i)
      if (append && rangeMatch && Number(rangeMatch[1]) !== offset) {
        await res.body.cancel()
        fs.rmSync(tmp, { force: true })
        throw new DownloadIntegrityError(`断点位置不匹配：请求 ${offset}，响应 ${rangeMatch[1]}`)
      }
      const contentLength = Number(res.headers.get('content-length') ?? 0)
      const rangeTotal = rangeMatch?.[3] && rangeMatch[3] !== '*' ? Number(rangeMatch[3]) : 0
      const total = expectedSize ?? (rangeTotal || (contentLength > 0 ? offset + contentLength : 0))
      if (expectedSize != null && rangeTotal > 0 && rangeTotal !== expectedSize) {
        await res.body.cancel()
        throw new DownloadIntegrityError(`远端大小 ${rangeTotal} 与元数据 ${expectedSize} 不一致`)
      }

      const ws = fs.createWriteStream(tmp, { flags: append ? 'a' : 'w' })
      ws.on('error', () => undefined)
      const reader = res.body.getReader()
      const onAbort = (): void => {
        void reader.cancel(requestController.signal.reason).catch(() => undefined)
        ws.destroy(requestController.signal.reason as Error | undefined)
      }
      requestController.signal.addEventListener('abort', onAbort, { once: true })
      const slowWindow = new SlowWindow()
      let received = offset
      onProgress?.(received, total)
      try {
        for (;;) {
          if (extSignal?.aborted) throw new Error('已取消')
          if (isTaskPaused(extSignal)) {
            clearInactivity()
            await waitIfTaskPaused(extSignal)
            slowWindow.reset()
            armInactivity()
          }
          const { done, value } = await reader.read()
          if (done) break
          if (value && value.byteLength > 0) {
            clearInactivity()
            await downloadLimiter.consume(value.byteLength, extSignal)
            await waitIfTaskPaused(extSignal)
            extSignal?.throwIfAborted()
            received += value.byteLength
            if (!ws.write(value)) await once(ws, 'drain')
            slowWindow.add(value.byteLength)
            if (slowWindow.shouldAbort()) throw new Error('连接速度过慢，已主动断开')
            onProgress?.(received, total)
            armInactivity()
          }
        }
        ws.end()
        await once(ws, 'finish')
        if (extSignal?.aborted) throw new Error('已取消')
        if (total > 0 && received !== total) {
          throw new DownloadIntegrityError(`响应提前结束：期望 ${total} 字节，实际 ${received} 字节`)
        }
        return { tmp, received, total }
      } catch (e) {
        void reader.cancel().catch(() => undefined)
        ws.destroy()
        if (!ws.closed) await once(ws, 'close').catch(() => undefined)
        if (extSignal?.aborted) fs.rmSync(tmp, { force: true })
        if (extSignal?.aborted) throw new Error('已取消')
        throw e
      } finally {
        requestController.signal.removeEventListener('abort', onAbort)
      }
    } finally {
      releaseSlot()
    }
  } finally {
    clearInactivity()
    extSignal?.removeEventListener('abort', onExternalAbort)
  }
}

/** 按文件大小选择传输策略：已知大小 ≥8MB 直接分块；未知大小时由 doDownload 探测升级。 */
async function startTransfer(
  url: string,
  dest: string,
  onProgress: ProgressFn | undefined,
  extSignal: AbortSignal | undefined,
  expectedSize: number | undefined
): Promise<TransferResult> {
  return doDownload(url, dest, onProgress, extSignal, expectedSize, expectedSize == null)
}

// ---------------- 本地文件复用（PCL2 CheckExistingFiles） ----------------

/** 递归收集目录下文件（目录深度 ≤3，不跟随目录外符号链接）；目录不存在或不可读时静默跳过。 */
function walkFilesForReuse(root: string, depth: number, visit: (file: string) => void): void {
  if (depth > 3) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) walkFilesForReuse(full, depth + 1, visit)
    else if (entry.isFile()) visit(full)
  }
}

/**
 * PCL2 本地文件复用：在已知目录中按「扩展名 + 大小」预筛（stat 极快），
 * 再 sha1 校验，命中即复制到 dest 并返回来源路径；找不到返回 null（无副作用）。
 */
async function tryLocalReuse(
  dest: string,
  expected: { sha1?: string; size?: number },
  reuseDirs: string[] | undefined,
  extSignal?: AbortSignal
): Promise<string | null> {
  if (!reuseDirs?.length || !expected.sha1 || expected.size == null) return null
  const ext = path.extname(dest).toLowerCase()
  if (!ext) return null
  const ownDir = path.resolve(path.dirname(dest)).toLowerCase()
  for (const dir of reuseDirs) {
    // 先大小预筛，命中的候选再做 sha1 校验
    const sizedMatches: string[] = []
    walkFilesForReuse(dir, 0, (file) => {
      if (sizedMatches.length) return
      if (path.extname(file).toLowerCase() !== ext) return
      // 跳过 dest 自身所在目录（同目录文件不作为复用来源）
      if (path.resolve(path.dirname(file)).toLowerCase() === ownDir) return
      try {
        if (fs.statSync(file).size === expected.size) sizedMatches.push(file)
      } catch {
        // 文件可能正被占用或已删除，跳过
      }
    })
    for (const match of sizedMatches) {
      try {
        const actual = await hashesOf(match, ['sha1'], extSignal)
        if (actual.sha1 !== expected.sha1.toLowerCase()) continue
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        await fs.promises.copyFile(match, dest)
        return match
      } catch (e) {
        if (extSignal?.aborted) throw new Error('已取消')
        // 单个候选校验/复制失败不影响整体：继续尝试其余候选
      }
    }
  }
  return null
}

/**
 * 下载单个文件。
 * - 已存在且 sha1 校验通过（或未提供 sha1）则跳过
 * - 支持从 reuseDirs 本地复用（大小+sha1 双重校验后直接复制）
 * - 失败时自动在 官方/镜像 之间切换重试，最多 3 次
 * - extSignal 取消时立即抛出「已取消」，不重试
 */
export async function downloadFile(
  url: string,
  dest: string,
  onProgress?: ProgressFn,
  sha1?: string,
  mirror: MirrorPref = 'official',
  extSignal?: AbortSignal,
  alternateUrls: string[] = [],
  integrity: { sha512?: string; size?: number; reuseDirs?: string[] } = {}
): Promise<void> {
  const expected = { sha1, sha512: integrity.sha512, size: integrity.size }
  if (fs.existsSync(dest)) {
    const invalid = await verifyFile(dest, expected, extSignal)
    if (!invalid) {
      const size = fs.statSync(dest).size
      onProgress?.(size, expected.size ?? size)
      return
    }
    fs.rmSync(dest, { force: true })
  }

  // 上次网络中断后若 .part 已完整，直接校验并提交，不再发无意义 Range 请求。
  const tmp = dest + '.part'
  if (fs.existsSync(tmp) && expected.size != null && fs.statSync(tmp).size === expected.size) {
    const invalid = await verifyFile(tmp, expected, extSignal)
    if (!invalid) {
      fs.renameSync(tmp, dest)
      onProgress?.(expected.size, expected.size)
      return
    }
    fs.rmSync(tmp, { force: true })
  }

  // 本地复用：其他游戏文件夹/依赖原版区已有相同文件时直接复制，省去网络下载
  try {
    const reusedFrom = await tryLocalReuse(dest, expected, integrity.reuseDirs, extSignal)
    if (reusedFrom) {
      const invalid = await verifyFile(dest, expected, extSignal)
      if (!invalid) {
        const size = fs.statSync(dest).size
        launcherLog(`本地复用 ${path.basename(dest)} ← ${reusedFrom}（${fmtBytes(size)}）`)
        onProgress?.(size, expected.size ?? size)
        return
      }
      // 复用来源校验失败（如来源损坏）：删除后回退网络下载
      fs.rmSync(dest, { force: true })
    }
  } catch (e) {
    if (extSignal?.aborted) throw new Error('已取消')
    // 复用查找自身的意外错误不阻断下载，回退正常网络流程
  }

  // 磁盘空间预检：大文件下载前确认剩余空间充足（不可重试，直接失败）
  if (expected.size != null) assertDiskSpace(dest, expected.size)

  const candidates = reorderCandidatesByHostHealth(downloadCandidates([url, ...alternateUrls], mirror))
  const baseName = path.basename(dest)
  const startedAt = Date.now()
  // 避免刷屏：assets 等海量小文件（<1MB）的常规开始/完成不记日志，仅失败与重试才记
  const logTransfer = expected.size == null || expected.size >= 1024 * 1024
  if (logTransfer) {
    launcherLog(
      `下载开始 ${baseName}：候选 ${candidates.length} 个，预期 ${
        expected.size != null ? fmtBytes(expected.size) : '未知大小'
      }`
    )
  }

  // 单文件进度单调：官方/镜像重试时 received 不重置（防进度条回跳）
  let maxReceived = 0
  const monoOnProgress: ProgressFn | undefined = onProgress
    ? (received, total) => {
        maxReceived = Math.max(maxReceived, received)
        onProgress(maxReceived, total)
      }
    : undefined

  const failures: string[] = []
  let lastErr: unknown = null
  let transferTries = 0
  let hadTransient = false
  // 网络波动兜底：第一轮每源最多 3 次退避重试；存在 transient 失败（网络波动/超时/慢速）时，
  // 全部来源失败/换源后仍失败，等待 2s 后整体再试一轮（每源 1 次）。
  // 内容校验失败/404 等确定性失败不参与整体重试（重试无意义）。
for (let round = 0; round < 2; round++) {
    if (round > 0) {
      if (!hadTransient) break
      launcherLog(`所有来源均失败，等待 2s 后整体重试一轮：${baseName}`)
      await abortableDelay(2000, extSignal)
      noteHostsRecovered()
    }
    const maxAttempts = round === 0 ? 3 : 1
    for (const candidate of candidates) {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (extSignal?.aborted) throw new Error('已取消')
        transferTries++
        try {
          const transfer = await startTransfer(candidate, dest, monoOnProgress, extSignal, expected.size)
          // 探测/分块得出的总长只参与本次校验，不写回 expected：避免污染后续候选来源
          const verifyTarget = expected
          const invalid = await verifyFile(transfer.tmp, verifyTarget, extSignal)
          if (invalid) {
            fs.rmSync(transfer.tmp, { force: true })
            // 分块产物拼接后内容不符：断点不可信（可能含坏块），全部丢弃，
            // 防止后续候选/重试直接复用坏块导致校验永远失败。
                        launcherLog(`校验失败 ${baseName}：${invalid}（${candidate}）`)
            failures.push(`${candidate} -> ${invalid}`)
            lastErr = new DownloadIntegrityError(`${invalid}: ${path.basename(dest)}`)
            // 完整响应但内容错误：切换来源，不对同一地址无脑重试。
            break
          }
          fs.rmSync(dest, { force: true })
          fs.renameSync(transfer.tmp, dest)
          noteHostSuccess(candidate)
          if (logTransfer) {
            launcherLog(
              `下载完成 ${baseName}：${fmtBytes(fs.statSync(dest).size)}，耗时 ${Date.now() - startedAt}ms` +
                (transferTries > 1 ? `，传输 ${transferTries} 次` : '')
            )
          }
          return
        } catch (e) {
          if (extSignal?.aborted) {
            fs.rmSync(dest + '.part', { force: true })
            throw new Error('已取消')
          }
          lastErr = e
          const kind = classifyTransferError(e)
          const message = e instanceof Error ? e.message : String(e)
          failures.push(`${candidate} -> ${message}${attempt ? `（重试 ${attempt}）` : ''}`)
          if (kind === 'transient') hadTransient = true
          // 404/410 以及其他确定性 4xx 对同一地址不重试，立即尝试下一个合法来源。
          if (kind !== 'transient') break
          // 仅 transient 失败记 host 健康度（404/410 等文件级错误不算源的问题）
          noteHostFailure(candidate)
          if (attempt < maxAttempts - 1) {
            launcherLog(`重试 ${baseName}：${message}（第 ${attempt + 1}/${maxAttempts - 1} 次重试）`)
            await abortableDelay(350 * 2 ** attempt, extSignal)
          }
        }
      }
      if (candidate !== candidates[candidates.length - 1]) {
        launcherLog(`换源 ${baseName}：放弃 ${candidate}，尝试下一来源`)
      }
    }
  }
  const detail = failures.length ? `；已尝试：${failures.join('；')}` : ''
  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr)
  throw new Error(`下载失败：${path.basename(dest)}（${reason}）${detail}`)
}

/**
 * 并发下载池。
 * onProgress(doneCount, totalCount, speedBps)：每完成一个文件回调一次，
 * 且每 500ms 额外回调一次带实时速度（滑窗统计字节增量）。
 * 任一文件最终失败则整体 reject；extSignal 取消时在途文件尽快停止。
 */
export async function downloadAll(
  tasks: DownloadTask[],
  onProgress?: AllProgressFn,
  concurrency = 8,
  mirror: MirrorPref = 'official',
  extSignal?: AbortSignal
): Promise<void> {
  const total = tasks.length
  if (total === 0) {
    onProgress?.(0, 0, 0, {
      completedFiles: 0,
      totalFiles: 0,
      bytesDone: 0,
      bytesTotal: 0,
      fraction: 1,
      indeterminate: false,
      speedBps: 0,
      etaSeconds: null,
      paused: false
    })
    return
  }
  const tracker = new DownloadProgressTracker()
  const progressIds = tasks.map((task) => tracker.add(task.size))
  tracker.seal()
  let idx = 0
  const poolController = new AbortController()
  const poolSignal = extSignal
    ? AbortSignal.any([extSignal, poolController.signal])
    : poolController.signal
  inheritTaskControl(extSignal, poolSignal)
  let networkBytes = 0
  let speedState = { speedBps: 0, etaSeconds: null as number | null }
  let lastEmitAt = 0
  const speedEstimator = new SmoothedSpeedEstimator()
  const emitSnapshot = (force = false): void => {
    const now = Date.now()
    if (!force && now - lastEmitAt < 100) return
    lastEmitAt = now
    const snapshot = tracker.snapshot()
    const detail: DownloadBatchProgress = {
      ...snapshot,
      ...speedState,
      paused: isTaskPaused(poolSignal)
    }
    onProgress?.(
      snapshot.completedFiles,
      snapshot.totalFiles,
      speedState.speedBps,
      detail
    )
  }
  emitSnapshot(true)
  const timer = setInterval(() => {
    const snapshot = tracker.snapshot()
    const remaining =
      snapshot.bytesTotal == null
        ? null
        : Math.max(0, snapshot.bytesTotal - snapshot.bytesDone)
    speedState = speedEstimator.sample(
      networkBytes,
      remaining,
      Date.now(),
      isTaskPaused(poolSignal)
    )
    emitSnapshot(true)
  }, 500)
  timer.unref()
  let firstError: unknown = null
  const worker = async (): Promise<void> => {
    while (idx < tasks.length) {
      if (poolSignal.aborted) throw new Error('已取消')
      await waitIfTaskPaused(poolSignal)
      const taskIndex = idx++
      const t = tasks[taskIndex]
      let lastReceived = 0
      let hasReceivedSample = false
      try {
        await downloadFile(
          t.url,
          t.dest,
          (received, discoveredTotal) => {
            if (hasReceivedSample) networkBytes += Math.max(0, received - lastReceived)
            else hasReceivedSample = true
            lastReceived = received
            tracker.update(progressIds[taskIndex], received, discoveredTotal)
            emitSnapshot()
          },
          t.sha1,
          mirror,
          poolSignal,
          (t.urls ?? []).filter((url) => url !== t.url),
          { sha512: t.sha512, size: t.size }
        )
      } catch (e) {
        if (firstError == null) firstError = e
        poolController.abort(e)
        throw e
      }
      const actualSize = fs.statSync(t.dest).size
      tracker.complete(progressIds[taskIndex], actualSize)
      emitSnapshot(true)
    }
  }
  try {
    const workers = Array.from(
      { length: Math.min(Math.max(1, Math.floor(concurrency) || 1), total) },
      () => worker()
    )
    await Promise.allSettled(workers)
    if (firstError != null) {
      if (extSignal?.aborted) throw new Error('已取消')
      throw firstError
    }
    speedState = { speedBps: 0, etaSeconds: null }
    emitSnapshot(true)
  } finally {
    clearInterval(timer)
  }
}
