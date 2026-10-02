import fs from 'node:fs'
import path from 'node:path'
import type { NativeImage } from 'electron'
import {
  MAX_IMAGE_FILE_BYTES,
  boundedImageSize,
  readImageDimensions,
  sniffImageFormat,
  validateImageInput,
  type ImageDimensions,
  type ManagedImagePurpose
} from './imageAssetPolicy'

const HEADER_LIMIT = 1024 * 1024

export interface InspectedImage {
  path: string
  bytes: number
  dimensions: ImageDimensions
}

export interface EncodedManagedImage {
  data: Buffer
  extension: '.png' | '.jpg' | '.webp'
  width: number
  height: number
}

/** 与底层解码器无关的位图句柄：生产环境由 Electron nativeImage 实现，测试可注入等价实现。 */
export interface DecodedImage {
  width: number
  height: number
  hasAlpha(): boolean
  resize(width: number, height: number): Promise<DecodedImage>
  toPNG(): Promise<Buffer>
  toJPEG(quality: number): Promise<Buffer>
}

export interface ImageCodec {
  decode(data: Buffer): Promise<DecodedImage | null>
}

async function loadNativeImage(): Promise<typeof import('electron').nativeImage> {
  const electron = (await import('electron')) as unknown as typeof import('electron')
  const nativeImage = electron?.nativeImage
  if (!nativeImage || typeof nativeImage.createFromBuffer !== 'function') {
    throw new Error('图片编解码仅在 Electron 主进程中可用')
  }
  return nativeImage
}

function wrapNativeImage(image: NativeImage): DecodedImage {
  const size = image.getSize()
  return {
    width: size.width,
    height: size.height,
    // nativeImage 未暴露 hasAlpha：扫描解码位图（BGRA）的 alpha 字节，任一非不透明即保留透明通道。
    hasAlpha() {
      const bitmap = image.toBitmap()
      for (let i = 3; i < bitmap.length; i += 4) {
        if (bitmap[i] !== 0xff) return true
      }
      return false
    },
    async resize(width: number, height: number) {
      return wrapNativeImage(image.resize({ width, height, quality: 'best' }))
    },
    async toPNG() {
      return image.toPNG()
    },
    async toJPEG(quality: number) {
      return image.toJPEG(quality)
    }
  }
}

/** 生产编解码器：Electron 内置图像解码（PNG/JPEG），零第三方原生依赖。 */
export function createNativeImageCodec(): ImageCodec {
  return {
    async decode(data: Buffer) {
      const nativeImage = await loadNativeImage()
      const image = nativeImage.createFromBuffer(data)
      if (image.isEmpty()) return null
      return wrapNativeImage(image)
    }
  }
}

let cachedDefaultCodec: ImageCodec | null = null
export function getDefaultImageCodec(): ImageCodec {
  if (!cachedDefaultCodec) cachedDefaultCodec = createNativeImageCodec()
  return cachedDefaultCodec
}

function expectedImageFormat(sourceName: string): 'png' | 'jpeg' | 'webp' | null {
  const extension = path.extname(sourceName).toLowerCase()
  if (extension === '.png') return 'png'
  if (extension === '.jpg' || extension === '.jpeg') return 'jpeg'
  if (extension === '.webp') return 'webp'
  return null
}

function readHeader(filePath: string, size: number): Buffer {
  const length = Math.min(size, HEADER_LIMIT)
  const buffer = Buffer.alloc(length)
  const fd = fs.openSync(filePath, 'r')
  try {
    const read = fs.readSync(fd, buffer, 0, length, 0)
    return buffer.subarray(0, read)
  } finally {
    fs.closeSync(fd)
  }
}

/** 在任何像素解码前校验路径、文件大小、格式头与声明尺寸。 */
export function inspectImageFile(sourcePath: string): InspectedImage {
  const source = fs.realpathSync(path.resolve(sourcePath))
  const stat = fs.statSync(source)
  if (!stat.isFile()) throw new Error('所选路径不是图片文件')
  const dimensions = validateImageInput(
    source,
    stat.size,
    readImageDimensions(readHeader(source, stat.size))
  )
  return { path: source, bytes: stat.size, dimensions }
}

/**
 * 校验真实格式、限像素解码并按用途等比缩小，输出 PNG（透明）/JPEG（不透明）跨平台缓存。
 * WebP 无主进程内置解码器：头校验通过且尺寸已在用途上限内时原样入缓存（渲染层 Chromium 原生支持），
 * 超上限则拒绝并引导改用可缩放的 PNG/JPG。
 */
export async function encodeManagedImage(
  sourcePath: string,
  purpose: ManagedImagePurpose
): Promise<EncodedManagedImage> {
  const inspected = inspectImageFile(sourcePath)
  const data = await fs.promises.readFile(inspected.path)
  return encodeManagedImageBuffer(data, inspected.path, purpose)
}

/** Theme assets are already optimized: validate a fixed snapshot without re-encoding or losing ICC. */
export async function validateManagedImageSnapshot(
  input: Buffer,
  purpose: ManagedImagePurpose,
  codec: ImageCodec = getDefaultImageCodec()
): Promise<EncodedManagedImage> {
  const data = Buffer.from(input)
  const format = sniffImageFormat(data)
  if (!format) throw new Error('主题图片格式无效')
  const extension: EncodedManagedImage['extension'] = format === 'jpeg' ? '.jpg' : format === 'png' ? '.png' : '.webp'
  const declared = validateImageInput('theme' + extension, data.length, readImageDimensions(data))
  const target = boundedImageSize(declared, purpose)
  if (target.width !== declared.width || target.height !== declared.height) {
    throw new Error('主题图片超过该用途的尺寸上限，请先在原启动器中重新导入图片')
  }
  if (format === 'webp') {
    // Electron's decoder does not support WebP; verify the complete bounded RIFF chunk container.
    if (data.length < 20 || data.readUInt32LE(4) !== data.length - 8) throw new Error('主题 WebP 文件已损坏')
    const chunks = (start: number, end: number, insideFrame = false): boolean => {
      let image = false
      while (start < end) {
        if (start + 8 > end) throw new Error('主题 WebP 数据块已损坏')
        const tag = data.toString('ascii', start, start + 4)
        const size = data.readUInt32LE(start + 4)
        const next = start + 8 + size + (size & 1)
        if (next > end) throw new Error('主题 WebP 数据块已截断')
        if (tag === 'VP8 ' || tag === 'VP8L') {
          if (size < (tag === 'VP8L' ? 5 : 10)) throw new Error('主题 WebP 图像数据已损坏')
          image = true
        } else if (tag === 'ANMF') {
          if (insideFrame || size < 16 || !chunks(start + 24, start + 8 + size, true)) throw new Error('主题 WebP 动画帧已损坏')
          image = true
        } else if (tag === 'VP8X' && size !== 10) throw new Error('主题 WebP 扩展头已损坏')
        start = next
      }
      return image
    }
    if (!chunks(12, data.length)) throw new Error('主题 WebP 缺少图像数据')
  } else {
    const decoded = await codec.decode(data)
    if (!decoded || decoded.width !== declared.width || decoded.height !== declared.height) {
      throw new Error('主题图片解码失败，文件可能已损坏')
    }
  }
  return { data, extension, width: declared.width, height: declared.height }
}

/** Buffer 入口用于把输入固定为一次快照，也便于在 Node 测试中注入编解码器验证真实编解码。 */
export async function encodeManagedImageBuffer(
  data: Buffer,
  sourceName: string,
  purpose: ManagedImagePurpose,
  codec: ImageCodec = getDefaultImageCodec()
): Promise<EncodedManagedImage> {
  const header = data.subarray(0, HEADER_LIMIT)
  const declared = validateImageInput(sourceName, data.length, readImageDimensions(header))
  const actualFormat = sniffImageFormat(header)
  if (!actualFormat || actualFormat !== expectedImageFormat(sourceName)) {
    throw new Error('图片扩展名与实际格式不一致')
  }

  if (actualFormat === 'webp') {
    const target = boundedImageSize(declared, purpose)
    if (target.width !== declared.width || target.height !== declared.height) {
      throw new Error('WebP 图片超过该用途的尺寸上限且无法缩小，请改用 PNG 或 JPG 导入')
    }
    return { data, extension: '.webp', width: declared.width, height: declared.height }
  }

  const decoded = await codec.decode(data)
  if (!decoded) throw new Error('图片解码失败，文件可能已损坏')
  const target = boundedImageSize({ width: decoded.width, height: decoded.height }, purpose)
  const scaled = await decoded.resize(target.width, target.height)

  // 保留透明通道；其余图片转 JPEG 并移除 EXIF/XMP，兼顾隐私、磁盘与解码内存。
  const preserveAlpha = scaled.hasAlpha()
  const encoded = preserveAlpha ? await scaled.toPNG() : await scaled.toJPEG(88)
  if (!encoded.length) throw new Error('图片缓存生成失败')
  if (encoded.length > MAX_IMAGE_FILE_BYTES) throw new Error('优化后的图片仍超过 32MB')
  return {
    data: encoded,
    extension: preserveAlpha ? '.png' : '.jpg',
    width: target.width,
    height: target.height
  }
}
