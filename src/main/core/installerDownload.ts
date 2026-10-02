import { downloadCandidates, downloadFile, type MirrorPref, type ProgressFn } from './download'
import { httpFetch } from './httpClient'
import { downloadLimiter } from './downloadLimits'

/** Maven sidecar checksum establishes identity before parallel range transfers. */
export async function downloadLoaderInstaller(url: string, dest: string, mirror: MirrorPref, progress?: ProgressFn, signal?: AbortSignal): Promise<void> {
  const candidates = downloadCandidates([url], mirror)
  let sha1: string | undefined, size: number | undefined
  // Resolve metadata from the preferred source, then fall back without long retries.
  for (const source of candidates) {
    signal?.throwIfAborted()
    const timeout = AbortSignal.timeout(4000), requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    const read = async (checksum: boolean) => {
      const release = await downloadLimiter.acquire(requestSignal)
      try {
        const res = await httpFetch(checksum ? source + '.sha1' : source, { method: checksum ? 'GET' : 'HEAD', signal: requestSignal })
        if (!res.ok) { await res.body?.cancel(); return undefined }
        if (checksum) return (await res.text()).trim().match(/^([a-f\d]{40})(?:\s|$)/i)?.[1]
        const length = Number(res.headers.get('content-length')); await res.body?.cancel()
        return Number.isSafeInteger(length) && length > 0 ? length : undefined
      } finally { release() }
    }
    const result = await Promise.allSettled([read(true), read(false)])
    signal?.throwIfAborted()
    if (result[0].status === 'fulfilled' && typeof result[0].value === 'string') {
      sha1 = result[0].value
      size = result[1].status === 'fulfilled' && typeof result[1].value === 'number' ? result[1].value : undefined
      break
    }
  }
  await downloadFile(url, dest, progress, sha1, mirror, signal, [], { size })
}
