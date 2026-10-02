import fs from 'node:fs'
import path from 'node:path'
import type { FsEntry } from '../../shared/types'
import type { VersionJson } from './versions'
import { instanceDirectoryState } from './instances'
import { logScope } from './launcherLog'

export const SELECT_RESOURCE_VERSION = '请先安装或选择一个游戏版本'
export function requireResourceVersion(id: string): void {
  if (!id?.trim()) throw new Error(SELECT_RESOURCE_VERSION)
  if (id === '.' || id === '..' || /[\\/:\0]/.test(id)) throw new Error('游戏版本名称无效，请重新选择')
}

/** Read exactly one selected instance; never enumerate other roots or fall back to a shared directory. */
export async function resolveResourceDirectory(folder: string, id: string, kind: string): Promise<string> {
  requireResourceVersion(id)
  if (!folder || !['mods', 'resourcepacks', 'shaderpacks'].includes(kind)) throw new Error('资源目录无效，请重新选择游戏版本')
  let json: VersionJson
  try { json = JSON.parse((await fs.promises.readFile(path.join(folder, 'versions', id, `${id}.json`), 'utf8')).replace(/^\uFEFF/, '')) }
  catch { throw new Error('所选游戏版本已移除或版本描述损坏，请到「游戏版本」页刷新或修复') }
  const gameDirectory = instanceDirectoryState(id, json, folder).path
  const dir = path.join(gameDirectory, kind)
  // Junctions/symlinks must not turn a single resource page into a view of another disk or directory.
  try {
    const [base, target] = await Promise.all([fs.promises.realpath(gameDirectory), fs.promises.realpath(dir)])
    const rel = path.relative(base, target)
    if (rel.startsWith('..') || path.isAbsolute(rel) || !rel) throw new Error('资源目录链接指向实例外部，请检查游戏目录')
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  return dir
}

/** Non-recursive, bounded asynchronous metadata reads. Rendering is paged separately. */
export async function listResourceEntries(dir: string): Promise<FsEntry[]> {
  const start = performance.now()
  let names: fs.Dirent[]
  try { names = await fs.promises.readdir(dir, { withFileTypes: true }) }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error('无法读取资源目录，请检查文件夹权限后重试')
  }
  const entries: FsEntry[] = []
  let index = 0
  await Promise.all(Array.from({ length: Math.min(16, names.length) }, async () => {
    while (index < names.length) {
      const name = names[index++]
      if (name.isSymbolicLink()) continue
      try {
        const stat = await fs.promises.lstat(path.join(dir, name.name))
        if (stat.isSymbolicLink()) continue
        entries.push({ name: name.name, size: stat.size, isDir: stat.isDirectory(), mtime: stat.mtimeMs })
      } catch { /* A file may be removed while listing. */ }
    }
  }))
  entries.sort((a,b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
  logScope('resources').info(`读取 ${dir}：${entries.length} 项，${Math.round(performance.now() - start)} ms（仅当前目录）`)
  return entries
}
