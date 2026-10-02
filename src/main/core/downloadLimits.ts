import { abortableDelay } from './tasks'

export interface DownloadLimits { downloadThreads: number; downloadSpeedKBps: number }
export const DEFAULT_DOWNLOAD_LIMITS: DownloadLimits = { downloadThreads: 16, downloadSpeedKBps: 0 }
export function validateDownloadLimits(value: DownloadLimits): void {
  if (!Number.isInteger(value.downloadThreads) || value.downloadThreads < 1 || value.downloadThreads > 64)
    throw new Error('最大线程数必须是 1–64 的整数')
  if (!Number.isInteger(value.downloadSpeedKBps) || value.downloadSpeedKBps < 0 || value.downloadSpeedKBps > 1048576)
    throw new Error('速度限制必须是 0–1048576 KiB/s 的整数，0 表示不限速')
}

/** 所有下载共用一个并发闸门与字节预算，跨安装任务也不会叠加突破限制。 */
export class DownloadLimiter {
  private limits = { ...DEFAULT_DOWNLOAD_LIMITS }
  private active = 0
  private queue: Array<() => void> = []
  private tokens = 0
  private sampledAt = performance.now()
  /** 当前是否启用了限速（慢速连接检测在限速时跳过：慢是限速的预期行为） */
  get isThrottling(): boolean {
    return this.limits.downloadSpeedKBps > 0
  }
  get maxConcurrent(): number { return this.limits.downloadThreads }
  configure(limits: DownloadLimits): void {
    validateDownloadLimits(limits)
    this.limits = { ...limits }
    this.tokens = 0
    this.sampledAt = performance.now()
    this.wake()
  }
  private wake(): void {
    while (this.active < this.limits.downloadThreads && this.queue.length) this.queue.shift()!()
  }
  async acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
      const cancel = () => {
        this.queue = this.queue.filter(item => item !== start)
        reject(signal?.reason ?? new Error('已取消'))
      }
      const start = () => {
        signal?.removeEventListener('abort', cancel)
        this.active++
        let released = false
        resolve(() => {
          if (released) return
          released = true
          this.active--
          this.wake()
        })
      }
      signal?.addEventListener('abort', cancel, { once: true })
      this.queue.push(start)
      this.wake()
    })
  }
  async consume(bytes: number, signal?: AbortSignal): Promise<void> {
    let remaining = bytes
    while (remaining > 0) {
      signal?.throwIfAborted()
      const rate = this.limits.downloadSpeedKBps * 1024
      if (!rate) return
      const now = performance.now()
      this.tokens = Math.min(rate * .15, this.tokens + (now - this.sampledAt) * rate / 1000)
      this.sampledAt = now
      const take = Math.min(remaining, Math.floor(this.tokens))
      this.tokens -= take
      remaining -= take
      if (remaining > 0) await abortableDelay(Math.min(100, Math.max(5, remaining / rate * 1000)), signal)
    }
  }
}
export const downloadLimiter = new DownloadLimiter()
