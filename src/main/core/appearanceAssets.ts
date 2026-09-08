import { app, nativeImage } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  ALLOWED_IMAGE_EXTENSIONS,
  isPathInside,
  type ManagedImagePurpose
} from './imageAssetPolicy'
import { encodeManagedImage, inspectImageFile } from './imageAssetProcessor'
import { sniffImageFormat } from './imageAssetPolicy'

export interface ManagedImage {
  path: string
  width: number
  height: number
  bytes: number
}

export function globalAppearanceDir(purpose: 'background' | 'launch-thumbnail'): string {
  return path.join(
    app.getPath('userData'),
    'appearance',
    purpose === 'background' ? 'backgrounds' : 'launch-thumbnails'
  )
}

export function instanceThumbnailDir(folder: string): string {
  return path.join(path.resolve(folder), '.kamucl', 'thumbnails')
}

async function importImage(
  sourcePath: string,
  purpose: ManagedImagePurpose,
  destinationDirectory: string
): Promise<ManagedImage> {
  const encoded = await encodeManagedImage(sourcePath, purpose)

  await fs.promises.mkdir(destinationDirectory, { recursive: true })
  const destinationStat = await fs.promises.lstat(destinationDirectory)
  if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
    throw new Error('KAMUCL 图片缓存目录不安全')
  }
  const name = `${crypto.randomUUID()}${encoded.extension}`
  const destination = path.join(destinationDirectory, name)
  const temporary = path.join(destinationDirectory, `.${name}.tmp`)
  try {
    await fs.promises.writeFile(temporary, encoded.data, { flag: 'wx' })
    await fs.promises.rename(temporary, destination)
  } catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  return {
    path: destination,
    width: encoded.width,
    height: encoded.height,
    bytes: encoded.data.length
  }
}

export async function importGlobalImage(
  sourcePath: string,
  purpose: 'background' | 'launch-thumbnail'
): Promise<ManagedImage> {
  return importImage(sourcePath, purpose, globalAppearanceDir(purpose))
}

export async function importInstanceThumbnail(
  sourcePath: string,
  folder: string
): Promise<ManagedImage> {
  return importImage(sourcePath, 'instance-thumbnail', instanceThumbnailDir(folder))
}

/** WebP 无主进程解码器（nativeImage 会报空）：以魔数头校验完整性。 */
function hasWebpHeader(candidate: string): boolean {
  try {
    const fd = fs.openSync(candidate, 'r')
    try {
      const header = Buffer.alloc(12)
      const read = fs.readSync(fd, header, 0, 12, 0)
      return sniffImageFormat(header.subarray(0, read)) === 'webp'
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return false
  }
}

function validateManagedPath(candidate: string, directory: string): string {
  if (!candidate || !isPathInside(candidate, directory)) return ''
  const directoryStat = fs.lstatSync(directory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return ''
  const resolvedDirectory = fs.existsSync(directory) ? fs.realpathSync(directory) : path.resolve(directory)
  const resolved = inspectImageFile(candidate).path
  if (!isPathInside(resolved, resolvedDirectory)) return ''
  if (nativeImage.createFromPath(resolved).isEmpty() && !hasWebpHeader(resolved)) return ''
  return resolved
}

/**
 * 校验当前全局资源；allowLegacyExternal 只供启动迁移保留旧版外部路径。
 */
export function ensureGlobalImage(
  candidate: string,
  purpose: 'background' | 'launch-thumbnail',
  allowLegacyExternal = false
): string {
  if (!candidate) return ''
  const directory = globalAppearanceDir(purpose)
  try {
    const managed = validateManagedPath(candidate, directory)
    if (managed) return managed
    // 旧版曾直接保存外部路径；仅设置加载阶段暂存该路径，随后异步迁入受管目录。
    if (!isPathInside(candidate, directory) && allowLegacyExternal) {
      return inspectImageFile(candidate).path
    }
  } catch {
    // 缺失、损坏、格式不符时由调用方回退到内置资源。
  }
  return ''
}

export function ensureInstanceThumbnail(candidate: string, folder: string): string {
  if (!candidate) return ''
  try {
    return validateManagedPath(candidate, instanceThumbnailDir(folder))
  } catch {
    return ''
  }
}

function removeManagedImage(candidate: string, directory: string): void {
  if (!candidate || !isPathInside(candidate, directory)) return
  try {
    const directoryStat = fs.lstatSync(directory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return
    const stat = fs.lstatSync(candidate)
    if (stat.isSymbolicLink() || !stat.isFile()) return
    const realDirectory = fs.realpathSync(directory)
    const realFile = fs.realpathSync(candidate)
    if (!isPathInside(realFile, realDirectory)) return
    fs.rmSync(realFile, { force: true })
  } catch {
    // 已不存在即视作完成；恢复默认不能被孤立缓存清理阻断。
  }
}

export function removeGlobalImage(
  candidate: string,
  purpose: 'background' | 'launch-thumbnail'
): void {
  removeManagedImage(candidate, globalAppearanceDir(purpose))
}

export function removeInstanceThumbnail(candidate: string, folder: string): void {
  removeManagedImage(candidate, instanceThumbnailDir(folder))
}

/** 自定义协议的最终访问边界：仅允许全局外观目录及已登记游戏文件夹的缩略图。 */
export function authorizeManagedImage(candidate: string, gameFolders: string[]): string {
  if (!candidate) return ''
  const directories = [
    globalAppearanceDir('background'),
    globalAppearanceDir('launch-thumbnail'),
    ...gameFolders.map(instanceThumbnailDir)
  ]
  for (const directory of directories) {
    if (!isPathInside(candidate, directory)) continue
    try {
      const directoryStat = fs.lstatSync(directory)
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return ''
      const stat = fs.lstatSync(candidate)
      if (!stat.isFile() || stat.isSymbolicLink()) return ''
      const realDirectory = fs.realpathSync(directory)
      const realFile = fs.realpathSync(candidate)
      if (!isPathInside(realFile, realDirectory)) return ''
      if (!ALLOWED_IMAGE_EXTENSIONS.has(path.extname(realFile).toLowerCase())) return ''
      return realFile
    } catch {
      return ''
    }
  }
  return ''
}
