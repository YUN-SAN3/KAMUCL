/** Transfer observations are scoped to a batch, not saved across networks or settings. */
interface SourceSample {
  trials: number
  samples: number
  headersMs: number
  bytesPerMs: number
  failures: number
}

function sourceKey(url: string): string {
  const u = new URL(url)
  // A mirror can route assets, Maven and mod files to different backends.
  return u.origin + (u.pathname.startsWith('/assets/') ? '/assets' : u.pathname.startsWith('/maven/') ? '/maven' : '')
}

/** Learn from useful downloads: no duplicate probes and no extra connections.
 * Sample each supplied source twice, then minimize predicted request time. Never
 * invent endpoints, alter credentials, or add mirrors in official-only mode.
 */
export class DownloadSourcePool {
  private readonly samples = new Map<string, SourceSample>()

  private sample(url: string): SourceSample {
    const key = sourceKey(url)
    let value = this.samples.get(key)
    if (!value) {
      value = { trials: 0, samples: 0, headersMs: 0, bytesPerMs: 0, failures: 0 }
      this.samples.set(key, value)
    }
    return value
  }

  order(urls: string[], size = 64 * 1024): string[] {
    if (urls.length < 2) return [...urls]
    const candidates = urls.map((url, index) => ({ url, index, sample: this.sample(url) }))
    const trial = candidates.find(c => c.sample.trials < 2 && !c.sample.failures)
    const cost = (s: SourceSample) => s.samples
      ? s.headersMs + size / Math.max(1, s.bytesPerMs) + s.failures * 15_000
      : 2500 + s.failures * 15_000
    candidates.sort((a, b) => Number(b === trial) - Number(a === trial) || cost(a.sample) - cost(b.sample) || a.index - b.index)
    candidates[0].sample.trials++
    return candidates.map(c => c.url)
  }

  observe(url: string, headersMs: number, bodyMs: number, bytes: number): void {
    if (!bytes) return
    const s = this.sample(url), weight = s.samples ? 0.25 : 1
    s.headersMs += (headersMs - s.headersMs) * weight
    s.bytesPerMs += (bytes / Math.max(1, bodyMs) - s.bytesPerMs) * weight
    s.samples++; s.failures = Math.max(0, s.failures - 1)
  }

  fail(url: string): void { this.sample(url).failures = Math.min(4, this.sample(url).failures + 1) }
}
