import fs from 'node:fs/promises'
import path from 'node:path'

/** Recycle one direct child. A failed native operation must never fall back to permanent deletion. */
export async function recycleFile(directory: string, name: string, trash?: (target: string) => Promise<void>): Promise<void> {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name)) {
    throw new Error('文件名称无效，未删除任何文件')
  }
  const parent = path.resolve(directory), target = path.resolve(parent, name)
  if (path.dirname(target) !== parent) throw new Error('文件路径越界')
  const parentStat = await fs.lstat(parent)
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error('资源目录是链接或不是文件夹，请先确认实际位置')
  const stat = await fs.lstat(target)
  if (stat.isSymbolicLink()) throw new Error('文件是链接，请在系统文件管理器中确认实际位置')
  const realParent = await fs.realpath(parent)
  const realTarget = await fs.realpath(target)
  if (path.dirname(realTarget) !== realParent) throw new Error('文件实际路径越界')
  const current = await fs.lstat(target)
  if (current.isSymbolicLink() || current.ino !== stat.ino || current.dev !== stat.dev) throw new Error('文件已变化，请刷新后重试')
  try {
    if (trash) await trash(realTarget)
    else await (await import('electron')).shell.trashItem(realTarget)
    try { await fs.lstat(realTarget) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e }
    throw new Error('系统未移除该文件')
  } catch (error) {
    throw new Error(`无法移入系统回收站，未执行永久删除。请检查文件占用、权限及磁盘的回收站支持：${name}；${error instanceof Error ? error.message : String(error)}`)
  }
}
