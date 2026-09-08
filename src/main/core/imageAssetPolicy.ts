import path from 'node:path'

export type ManagedImagePurpose = 'background' | 'launch-thumbnail' | 'instance-thumbnail'

export interface ImageDimensions {
  width: number
  height: number
}

export const MAX_IMAGE_FILE_BYTES = 32 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 80_000_000
export const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

function u24le(buffer: Buffer, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 从魔数判断真实容器格式；用于导入前校验扩展名与实际编码一致。 */
export function sniffImageFormat(buffer: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_MAGIC)) return 'png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg'
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF') {
    if (buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  }
  return null
}

/**
 * 从文件头读取尺寸，先于 Chromium/Electron 解码拒绝超大像素图片。
 * 支持本功能允许导入的 PNG、JPEG、WebP（VP8/VP8L/VP8X）。
 */
export function readImageDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }
      while (buffer[offset] === 0xff) offset += 1
      const marker = buffer[offset++]
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue
      if (offset + 2 > buffer.length) return null
      const length = buffer.readUInt16BE(offset)
      if (length < 2 || offset + length > buffer.length) return null
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      if (isSof && length >= 7) {
        return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) }
      }
      offset += length
    }
    return null
  }

  if (
    buffer.length >= 30 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const kind = buffer.toString('ascii', 12, 16)
    if (kind === 'VP8X') {
      return { width: u24le(buffer, 24) + 1, height: u24le(buffer, 27) + 1 }
    }
    if (kind === 'VP8 ' && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff
      }
    }
    if (kind === 'VP8L' && buffer[20] === 0x2f) {
      const b1 = buffer[21]
      const b2 = buffer[22]
      const b3 = buffer[23]
      const b4 = buffer[24]
      return {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10)
      }
    }
  }
  return null
}

export function validateImageInput(
  filePath: string,
  bytes: number,
  dimensions: ImageDimensions | null
): ImageDimensions {
  if (!ALLOWED_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    throw new Error('仅支持 PNG、JPG、JPEG 或 WebP 图片')
  }
  if (!Number.isFinite(bytes) || bytes <= 0) throw new Error('图片文件为空')
  if (bytes > MAX_IMAGE_FILE_BYTES) throw new Error('图片过大（最大 32MB）')
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
    throw new Error('无法识别图片格式或尺寸')
  }
  if (
    dimensions.width > 32_768 ||
    dimensions.height > 32_768 ||
    dimensions.width * dimensions.height > MAX_IMAGE_PIXELS
  ) {
    throw new Error('图片像素尺寸过大（最多 8000 万像素）')
  }
  return dimensions
}

/** 按用途给出解码后的缓存尺寸，始终保持原始宽高比且不放大。 */
export function boundedImageSize(
  dimensions: ImageDimensions,
  purpose: ManagedImagePurpose
): ImageDimensions {
  const bounds = purpose === 'background' ? { width: 3840, height: 2160 } : { width: 1920, height: 1080 }
  const scale = Math.min(1, bounds.width / dimensions.width, bounds.height / dimensions.height)
  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale))
  }
}

export function isPathInside(candidate: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate))
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}
