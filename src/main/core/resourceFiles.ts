import fs from 'node:fs'
import path from 'node:path'
import type { InstalledVersion } from '../../shared/types'

/** The validated scanner target carries the actual --gameDir, including isolation. */
export function importResourceFiles(files: string[], target: InstalledVersion, kind: string): number {
  if (!['mods', 'resourcepacks', 'shaderpacks'].includes(kind) || !target.gameDirectory) throw new Error('无效资源目录')
  if (!files.length) throw new Error('请拖入资源文件')
  const dir = path.join(target.gameDirectory, kind)
  const names = new Set<string>()
  const copies = files.map(file => {
    const name = path.basename(file), stat = fs.statSync(file), dest = path.join(dir, name)
    if (stat.isDirectory() ? kind === 'mods' : !(kind === 'mods' ? /\.jar(?:\.disabled)?$/i : /\.zip$/i).test(name)) throw new Error(`此页面不支持 ${name}`)
    if (!stat.isDirectory() && !stat.isFile()) throw new Error('不支持此文件类型')
    if (names.has(name.toLowerCase()) || fs.existsSync(dest)) throw new Error(`同名文件已存在，未覆盖：${name}`)
    names.add(name.toLowerCase())
    return { file, dest, directory: stat.isDirectory() }
  })
  fs.mkdirSync(dir, { recursive: true })
  for (const item of copies) {
    if (item.directory) fs.cpSync(item.file, item.dest, { recursive: true, force: false, errorOnExist: true })
    else fs.copyFileSync(item.file, item.dest, fs.constants.COPYFILE_EXCL)
  }
  return copies.length
}
