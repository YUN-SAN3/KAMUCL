import fs from 'node:fs'
import path from 'node:path'
import { PACK_RESOURCE_DIRS } from './modpackBundledFiles'
import { modpackCachedFile } from './modpackDownloads'
import { verifyFile } from './download'
import { waitIfTaskPaused } from './tasks'

/** Optional sources, read-only. Index known resource folders once per import,
 * including renamed files, instead of rescanning every instance for every mod.
 */
export class LocalModpackFiles {
  private index?: Promise<Map<number, string[]>>
  constructor(private readonly roots: string[]) {}

  private async scan(signal?: AbortSignal): Promise<Map<number, string[]>> {
    const files = new Map<number, string[]>()
    const entries = async (dir: string) => fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const root of new Set(this.roots.map(root => path.resolve(root)))) {
      await waitIfTaskPaused(signal)
      const versions = path.join(root, 'versions')
      const instances = (await entries(versions)).filter(e => e.isDirectory() && !e.name.startsWith('.'))
      for (const base of [root, ...instances.map(e => path.join(versions, e.name))]) {
        for (const rel of PACK_RESOURCE_DIRS) {
          await waitIfTaskPaused(signal)
          let dir = base, regular = true
          for (const segment of rel.split('/')) {
            dir = path.join(dir, segment)
            const stat = await fs.promises.lstat(dir).catch(() => null)
            if (!stat?.isDirectory() || stat.isSymbolicLink()) { regular = false; break }
          }
          if (!regular) continue
          for (const entry of await entries(dir)) {
            if (!entry.isFile() || !/\.(?:jar|zip)(?:\.disabled)?$/i.test(entry.name)) continue
            const file = path.join(dir, entry.name), stat = await fs.promises.lstat(file).catch(() => null)
            if (!stat?.isFile() || stat.isSymbolicLink()) continue
            const group = files.get(stat.size) ?? []
            group.push(file); files.set(stat.size, group)
          }
        }
      }
    }
    return files
  }

  async find(file: { fileName: string; size: number; sha1: string }, signal?: AbortSignal): Promise<string | null> {
    const exact = async (candidate: string) => {
      await waitIfTaskPaused(signal)
      try {
        const stat = await fs.promises.lstat(candidate)
        return stat.isFile() && !stat.isSymbolicLink() && !await verifyFile(candidate, file, signal)
      } catch { signal?.throwIfAborted(); return false }
    }
    // Verified cache may already exist after a previous cancelled installation.
    for (const root of this.roots) {
      const cached = modpackCachedFile(file, path.join(root, '.kamucl', 'modpack-cache'))
      if (await exact(cached)) return cached
    }
    this.index ??= this.scan(signal)
    for (const candidate of (await this.index).get(file.size) ?? []) if (await exact(candidate)) return candidate
    return null
  }
}
