import fs from 'node:fs'
import path from 'node:path'

/** 存在时解析 junction/符号链接；路径不存在时仍返回绝对规范形式。 */
export function canonicalPath(input: string): string {
  const resolved = path.resolve(input.trim())
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

/** Windows 文件系统身份不区分大小写，并统一去掉根目录以外的尾部分隔符。 */
export function pathIdentity(input: string): string {
  let value = canonicalPath(input)
  const root = path.parse(value).root
  while (value.length > root.length && /[\\/]$/.test(value)) value = value.slice(0, -1)
  return process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value
}

export function samePath(a: string, b: string): boolean {
  return pathIdentity(a) === pathIdentity(b)
}

/**
 * 把用户选择定位到 Minecraft 根目录：支持直接选根目录、选 versions 目录，
 * 或选择一个包含 .minecraft 子目录的上级文件夹。
 */
export function resolveMinecraftRoot(input: string): {
  path: string
  structure: 'minecraft' | 'kamucl' | 'empty'
} {
  if (!input.trim()) throw new Error('文件夹路径不能为空')
  let selected = canonicalPath(input)
  // 先检查存在性再给友好错误；否则 statSync 会把 ENOENT 系统报错直接抛给用户
  if (!fs.existsSync(selected)) throw new Error('文件夹不存在，请检查路径是否正确')
  const stat = fs.statSync(selected)
  if (!stat.isDirectory()) throw new Error('选择的路径不是文件夹')

  if (path.basename(selected).toLowerCase() === 'versions') {
    selected = canonicalPath(path.dirname(selected))
  } else {
    const nestedMinecraft = path.join(selected, '.minecraft')
    if (!fs.existsSync(path.join(selected, 'versions')) && fs.existsSync(path.join(nestedMinecraft, 'versions'))) {
      selected = canonicalPath(nestedMinecraft)
    }
  }

  const hasVersions = fs.existsSync(path.join(selected, 'versions'))
  const hasKamuclData = fs.existsSync(path.join(selected, '.kamucl'))
  const structure = hasKamuclData ? 'kamucl' : hasVersions ? 'minecraft' : 'empty'
  return { path: selected, structure }
}
