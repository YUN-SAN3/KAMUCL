import fs from 'node:fs'
import path from 'node:path'
import { safeRelative } from './backupStore'

/** Native drag must begin in the IPC gesture callback, before releasing the mouse. */
export function dragPath(root: string, relative: string): string {
  safeRelative(relative)
  let file = path.resolve(root)
  const base = fs.lstatSync(file)
  if (!base.isDirectory() || base.isSymbolicLink()) throw new Error('目录不是普通目录')
  for (const part of relative.split('/')) {
    file = path.join(file, part)
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('不跟随符号链接')
  }
  const stat = fs.lstatSync(file)
  if (!stat.isFile() && !stat.isDirectory()) throw new Error('不支持拖出特殊文件')
  return file
}
export function dragResourceFilesSync(directory: string, names: unknown): string[] {
  if (!Array.isArray(names) || !names.length || names.length > 1000) throw new Error('每次可拖出 1–1000 个文件，请分批选择')
  return [...new Set(names)].map(name => {
    if (typeof name !== 'string' || name.includes('/') || name.includes('\\')) throw new Error('无效的文件名')
    return dragPath(directory, name)
  })
}
export async function dragResourceFiles(directory: string, names: unknown): Promise<string[]> {
  return dragResourceFilesSync(directory, names)
}
