import { downloadFile, type MirrorPref } from './download'
import { modpackCachedFile } from './modpackDownloads'
import type { ResolvedCfFile } from './curseforgeDownload'

/** Public CurseMaven coordinates: curse.maven:<descriptor>-<projectID>:<fileID>.
 * https://cursemaven.com/#usage (also linked on CurseForge file pages).
 * Resolve by immutable IDs, never guessed CDN filenames. The service can fail or
 * return HTML: only publish the file after the original size AND SHA1 pass.
 */
export async function prepareCurseMavenFile(
  projectID: number, fileID: number, file: ResolvedCfFile, mirror: MirrorPref, signal?: AbortSignal
): Promise<string | null> {
  if (![projectID, fileID].every(n => Number.isSafeInteger(n) && n > 0) ||
    !/\.jar$/i.test(file.fileName) || !/^[a-f\d]{40}$/i.test(file.sha1) ||
    !Number.isSafeInteger(file.size) || file.size <= 0) return null
  const artifact = `mod-${projectID}`
  const url = `https://cursemaven.com/curse/maven/${artifact}/${fileID}/${artifact}-${fileID}.jar`
  const dest = modpackCachedFile(file)
  try {
    await downloadFile(url, dest, undefined, file.sha1, mirror, signal, [], {
      size: file.size, maxAttempts: 1, maxSegments: 1
    })
    return dest
  } catch { signal?.throwIfAborted(); return null }
}
