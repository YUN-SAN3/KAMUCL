import { downloadAll, type AllProgressFn } from './download'
import { isolatedUpdateTest } from './updateTrust'
import { rankUpdateSources, type UpdateProbeOptions } from './updateSources'

/** Update-only adapter. The shared engine owns all useful bytes, resume, low-speed
 * switching, progress, cancellation and integrity; probes only reorder inputs.
 */
export async function downloadUpdatePayload(input: { urls: string[]; dest: string; sha256: string; size?: number }, progress?: AllProgressFn, signal?: AbortSignal, probeOptions: UpdateProbeOptions = {}): Promise<void> {
  if (!/^[a-f\d]{64}$/i.test(input.sha256)) throw new Error('更新包缺少有效的 SHA256 校验值')
  const [url, ...urls] = await rankUpdateSources(input.urls, input.size, signal, { allowLoopback: isolatedUpdateTest(), ...probeOptions })
  if (!url) throw new Error('没有可用的更新下载源')
  signal?.throwIfAborted()
  await downloadAll([{ url, urls, dest: input.dest, sha256: input.sha256, size: input.size }], progress, 8, 'official', signal)
}
