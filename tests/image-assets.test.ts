import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import {
  MAX_IMAGE_FILE_BYTES,
  boundedImageSize,
  isPathInside,
  readImageDimensions,
  sniffImageFormat,
  validateImageInput
} from '../src/main/core/imageAssetPolicy'
import {
  encodeManagedImageBuffer,
  type DecodedImage,
  type ImageCodec
} from '../src/main/core/imageAssetProcessor'

function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer)
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

test('图片头读取支持 PNG、JPEG 与 WebP VP8X', () => {
  assert.deepEqual(readImageDimensions(pngHeader(3840, 2160)), { width: 3840, height: 2160 })

  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00
  ])
  assert.deepEqual(readImageDimensions(jpeg), { width: 1920, height: 1080 })

  const webp = Buffer.alloc(30)
  webp.write('RIFF', 0, 'ascii')
  webp.write('WEBP', 8, 'ascii')
  webp.write('VP8X', 12, 'ascii')
  webp[24] = 0xff
  webp[25] = 0x07
  webp[27] = 0x37
  webp[28] = 0x04
  assert.deepEqual(readImageDimensions(webp), { width: 2048, height: 1080 })
})

test('魔数嗅探区分 PNG、JPEG、WebP 并拒绝未知格式', async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).png().toBuffer()
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).jpeg().toBuffer()
  const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).webp().toBuffer()
  assert.equal(sniffImageFormat(png), 'png')
  assert.equal(sniffImageFormat(jpeg), 'jpeg')
  assert.equal(sniffImageFormat(webp), 'webp')
  assert.equal(sniffImageFormat(Buffer.from('not an image')), null)
})

test('导入策略拒绝伪装格式、空文件、超大文件与解压像素炸弹', () => {
  assert.throws(() => validateImageInput('wallpaper.exe', 100, { width: 1, height: 1 }), /仅支持/)
  assert.throws(() => validateImageInput('wallpaper.png', 0, { width: 1, height: 1 }), /为空/)
  assert.throws(
    () => validateImageInput('wallpaper.png', MAX_IMAGE_FILE_BYTES + 1, { width: 1, height: 1 }),
    /最大 32MB/
  )
  assert.throws(() => validateImageInput('wallpaper.png', 100, null), /无法识别/)
  assert.throws(
    () => validateImageInput('wallpaper.png', 100, { width: 20_000, height: 20_000 }),
    /像素尺寸过大/
  )
})

test('背景与缩略图缓存按各自上限等比缩小且不放大小图', () => {
  assert.deepEqual(boundedImageSize({ width: 7680, height: 4320 }, 'background'), {
    width: 3840,
    height: 2160
  })
  assert.deepEqual(boundedImageSize({ width: 4000, height: 3000 }, 'launch-thumbnail'), {
    width: 1440,
    height: 1080
  })
  assert.deepEqual(boundedImageSize({ width: 800, height: 600 }, 'instance-thumbnail'), {
    width: 800,
    height: 600
  })
})

test('受管文件删除边界拒绝父目录、同前缀目录与目录本身', () => {
  const root = path.resolve('C:/KAMUCL/appearance/backgrounds')
  assert.equal(isPathInside(path.join(root, 'safe.jpg'), root), true)
  assert.equal(isPathInside(root, root), false)
  assert.equal(isPathInside(path.resolve(root, '..', 'settings.json'), root), false)
  assert.equal(isPathInside(`${root}-other/unsafe.jpg`, root), false)
})

// 测试期编解码器：与生产 createNativeImageCodec 同一接口，用 sharp 实现真实解码/缩放/编码。
function sharpDecoded(data: Buffer, width: number, height: number, alpha: boolean): DecodedImage {
  return {
    width,
    height,
    hasAlpha: () => alpha,
    async resize(w: number, h: number): Promise<DecodedImage> {
      const resized = await sharp(data).resize(w, h, { fit: 'fill' }).png().toBuffer()
      return sharpDecoded(resized, w, h, alpha)
    },
    async toPNG(): Promise<Buffer> {
      return sharp(data).png().toBuffer()
    },
    async toJPEG(quality: number): Promise<Buffer> {
      return sharp(data).flatten().jpeg({ quality }).toBuffer()
    }
  }
}

const sharpCodec: ImageCodec = {
  async decode(data) {
    try {
      const metadata = await sharp(data, { limitInputPixels: 80_000_000 }).metadata()
      if (!metadata.width || !metadata.height) return null
      return sharpDecoded(data, metadata.width, metadata.height, metadata.hasAlpha === true)
    } catch {
      return null
    }
  }
}

test('大图导入会等比缩小并转为 JPEG 缓存（编码走注入 codec）', async () => {
  const source = await sharp({
    create: { width: 2000, height: 1500, channels: 3, background: { r: 36, g: 160, b: 92 } }
  }).png().toBuffer()

  const encoded = await encodeManagedImageBuffer(source, 'large.png', 'launch-thumbnail', sharpCodec)
  assert.equal(encoded.extension, '.jpg')
  assert.equal(encoded.width, 1440)
  assert.equal(encoded.height, 1080)
  const metadata = await sharp(encoded.data).metadata()
  assert.equal(metadata.format, 'jpeg')
  assert.equal(metadata.width, 1440)
  assert.equal(metadata.height, 1080)
})

test('带透明通道的图片保留为 PNG 缓存', async () => {
  const source = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 20, g: 30, b: 40, alpha: 0.5 } }
  }).png().toBuffer()

  const encoded = await encodeManagedImageBuffer(source, 'alpha.png', 'instance-thumbnail', sharpCodec)
  assert.equal(encoded.extension, '.png')
  const metadata = await sharp(encoded.data).metadata()
  assert.equal(metadata.format, 'png')
  assert.equal(metadata.hasAlpha, true)
})

test('WebP 导入保留原始字节并按头校验尺寸上限', async () => {
  const source = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 12, g: 34, b: 56 } }
  }).webp({ quality: 80 }).toBuffer()

  const encoded = await encodeManagedImageBuffer(source, 'wide.webp', 'launch-thumbnail', sharpCodec)
  assert.equal(encoded.extension, '.webp')
  assert.equal(encoded.data, source)
  assert.equal(encoded.width, 800)
  assert.equal(encoded.height, 600)
})

test('超上限的 WebP 引导改用可缩放的 PNG/JPG', async () => {
  const source = await sharp({
    create: { width: 2000, height: 1500, channels: 3, background: { r: 36, g: 160, b: 92 } }
  }).webp({ quality: 80 }).toBuffer()
  await assert.rejects(
    () => encodeManagedImageBuffer(source, 'large.webp', 'launch-thumbnail', sharpCodec),
    /PNG 或 JPG/
  )
})

test('图片扩展名与真实编码不一致时拒绝导入', async () => {
  const source = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 20, g: 30, b: 40 } }
  }).webp().toBuffer()
  await assert.rejects(
    () => encodeManagedImageBuffer(source, 'fake.png', 'background', sharpCodec),
    /扩展名与实际格式不一致/
  )
})

test('头合法但内容损坏的图片在解码阶段拒绝导入', async () => {
  const corrupted = Buffer.concat([pngHeader(16, 16), Buffer.from('this is not pixel data')])
  await assert.rejects(
    () => encodeManagedImageBuffer(corrupted, 'broken.png', 'background', sharpCodec),
    /解码失败/
  )
})
