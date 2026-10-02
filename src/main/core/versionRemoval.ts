import fs from 'node:fs/promises'
import path from 'node:path'
import { withFileJob } from './fileJobs'

/** Use the native recycle operation instead of deleting children before discovering a locked parent. */
export async function recycleVersion(folder: string, id: string, deps: {
  assertIdle(directory: string): Promise<void>
  trash(directory: string): Promise<void>
}): Promise<void> {
  if (typeof id !== 'string' || !id || id === '.' || id === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(id) || /[. ]$/.test(id)) {
    throw new Error('版本名称无效，未删除任何文件')
  }
  const parent = path.resolve(folder, 'versions'), target = path.resolve(parent, id)
  if (path.dirname(target) !== parent) throw new Error('版本路径超出游戏目录')
  return withFileJob(target, undefined, async () => {
    let stat
    try { stat = await fs.lstat(target) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('版本目录是链接或不是文件夹，请在文件管理器中确认其实际位置')
    if ((await fs.lstat(parent)).isSymbolicLink()) throw new Error('versions 目录是链接，请先确认实际游戏目录')
    await deps.assertIdle(target)
    // Recheck after asynchronous process inspection; no traversal into child links.
    const current = await fs.lstat(target)
    if (current.isSymbolicLink() || current.ino !== stat.ino || current.dev !== stat.dev) throw new Error('版本目录已变化，请刷新后重试')
    try {
      await deps.trash(target)
      try { await fs.lstat(target) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e }
      throw new Error('系统未移除该目录')
    } catch (error) {
      throw new Error(`无法将版本移入回收站：请关闭使用该目录的游戏或文件窗口，并检查目录权限及磁盘的回收站支持。目录：${target}；${error instanceof Error ? error.message : String(error)}`)
    }
  })
}
