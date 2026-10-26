/** Describe real asset work without replacing byte progress or guessing completion. */
export function assetDownloadStatus(
  done: number,
  total: number,
  detail: {
    activeFiles?: string[]
    paused?: boolean
    waits?: Array<{ reason: 'rate-limit'; retryAt: number; action: 'waiting' | 'switching'; file?: string }>
  },
  now = Date.now()
): string {
  const base = `下载资源文件 ${done}/${total}`
  if (done >= total || detail.paused) return base
  const waits = detail.waits ?? []
  const switching = waits.find(wait => wait.action === 'switching')
  const waiting = waits.filter(wait => wait.action === 'waiting' && wait.retryAt > now)
  if (switching) return `${base} · 下载源限流，切换备用来源`
  if (waiting.length) {
    const seconds = Math.ceil((Math.min(...waiting.map(wait => wait.retryAt)) - now) / 1000)
    return `${base} · 下载源限流，${seconds} 秒后重试`
  }
  if (total - done <= 2 && detail.activeFiles?.length) {
    const names = detail.activeFiles.slice(0, 2).map(name => name.replace(/[\r\n\t]/g, ' ').slice(0, 180))
    return `${base} · 正在处理 ${names.join('、')}`
  }
  return base
}
