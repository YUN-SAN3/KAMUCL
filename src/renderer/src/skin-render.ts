/**
 * 皮肤渲染工具：用 canvas 把 64×64 皮肤 PNG 渲染为 2D 人偶正面图。
 * 含外层 hat/装甲层叠加，最近邻缩放保持像素风；失败返回空字符串由 UI 兜底。
 * 另含旧版 64×32 皮肤 → 64×64 自动迁移（HMCL SkinHelper 分区镜像拷贝法）
 * 与 slim/classic 模型自动检测，供 3D 查看器与 2D 渲染共用。
 */

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // textures.minecraft.net 带 CORS *，dataUrl 本地加载，均可安全绘制
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

// ---------------- 旧版皮肤迁移（HMCL SkinHelper.x32Tox64 等价实现） ----------------

/**
 * 旧版皮肤判定：宽为 64 的整数倍且高为宽的一半（如 64×32 / 128×64 HD）。
 */
export function isLegacySkin(width: number, height: number): boolean {
  return width > 0 && width % 64 === 0 && height === width / 2
}

/**
 * 把源图上一个矩形区域水平镜像后绘制到目标位置。
 * 坐标均为已换算到目标画布的像素值。
 */
function copyMirrored(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number
): void {
  ctx.save()
  ctx.translate(dx + sw, dy)
  ctx.scale(-1, 1)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
  ctx.restore()
}

/**
 * 迁移一个肢体：把旧版右肢（源块起点 sx,sy）镜像复制为新版左肢（目标块起点 dx,dy）。
 * 盒体 w×h×d（皮肤像素）。镜像时内外侧面互换（outer↔inner），与 HMCL 一致。
 */
function migrateLimb(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  w: number,
  h: number,
  d: number
): void {
  // 顶 / 底（水平镜像）
  copyMirrored(ctx, img, sx + d, sy, w, d, dx + d, dy)
  copyMirrored(ctx, img, sx + d + w, sy, w, d, dx + d + w, dy)
  // 外侧 ← 源内侧（镜像）；内侧 ← 源外侧（镜像）
  copyMirrored(ctx, img, sx, sy + d, d, h, dx, dy + d)
  copyMirrored(ctx, img, sx + d + w, sy + d, d, h, dx + w + d, dy + d)
  // 正面 / 背面（水平镜像）
  copyMirrored(ctx, img, sx + d, sy + d, w, h, dx + d, dy + d)
  copyMirrored(ctx, img, sx + w + d * 2, sy + d, w, h, dx + w + d * 2, dy + d)
}

/**
 * 旧版 64×32（或 HD 等比）皮肤迁移为 64×64 布局。
 * 头/帽/身体/右肢位于上半区原样保留，左肢由右肢分区镜像拷贝生成。
 * 新版皮肤原样返回。
 */
export function migrateLegacySkin(img: HTMLImageElement): HTMLImageElement | HTMLCanvasElement {
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  if (!isLegacySkin(w, h)) return img
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) return img
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, 0)
  const k = w / 64
  migrateLimb(ctx, img, 0, 16 * k, 16 * k, 48 * k, 4 * k, 12 * k, 4 * k) // 左腿 ← 右腿
  migrateLimb(ctx, img, 40 * k, 16 * k, 32 * k, 48 * k, 4 * k, 12 * k, 4 * k) // 左臂 ← 右臂
  return canvas
}

/**
 * slim（Alex）/classic（Steve）自动检测：
 * classic 右臂背面右缘一列（x=54, y=20..32）有像素内容，slim 该列落在手臂之外、全透明。
 * 检测失败返回 null，由调用方回退到档案提供的 variant。
 */
export function detectSkinVariant(
  source: HTMLImageElement | HTMLCanvasElement
): 'slim' | 'classic' | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(source, 0, 0, 64, 64)
    const data = ctx.getImageData(54, 20, 1, 12).data
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return 'classic'
    }
    return 'slim'
  } catch {
    return null
  }
}

// ---------------- 2D 正面人偶 / 头像 / 披风渲染 ----------------

/** 部件：[源x, 源y, 宽, 高, 目标x, 目标y]，单位均为皮肤像素 */
type Part = [number, number, number, number, number, number]

/** 人偶画布为 16×32 皮肤像素（头 8 + 躯干 12 + 腿 12；臂 4 + 躯干 8 + 臂 4） */
const BASE_PARTS: Part[] = [
  [8, 8, 8, 8, 4, 0], // 头
  [20, 20, 8, 12, 4, 8], // 躯干
  [44, 20, 4, 12, 0, 8], // 右臂
  [36, 52, 4, 12, 12, 8], // 左臂
  [4, 20, 4, 12, 4, 20], // 右腿
  [20, 52, 4, 12, 8, 20] // 左腿
]

/** 外层（hat / 衣袖 / 裤腿 / 外套），叠加在对应基础层之上 */
const OVERLAY_PARTS: Part[] = [
  [40, 8, 8, 8, 4, 0], // 头外层
  [20, 36, 8, 12, 4, 8], // 躯干外层
  [44, 36, 4, 12, 0, 8], // 右臂外层
  [52, 52, 4, 12, 12, 8], // 左臂外层
  [4, 36, 4, 12, 4, 20], // 右腿外层
  [4, 52, 4, 12, 8, 20] // 左腿外层
]

function drawParts(
  img: CanvasImageSource,
  parts: Part[],
  ctx: CanvasRenderingContext2D,
  scale: number
) {
  for (const [sx, sy, sw, sh, dx, dy] of parts) {
    ctx.drawImage(img, sx, sy, sw, sh, dx * scale, dy * scale, sw * scale, sh * scale)
  }
}

/**
 * 渲染 64×64 皮肤正面人偶，返回 dataURL；失败返回 ''。
 * 旧版 64×32 皮肤会先迁移再渲染（否则左肢区域为空）。
 * source 可为 https url（textures.minecraft.net）/ dataUrl / 已加载的 HTMLImageElement。
 */
export async function renderSkinFront(
  source: HTMLImageElement | string,
  scale = 10
): Promise<string> {
  try {
    const img = typeof source === 'string' ? await loadImage(source) : source
    const skin = migrateLegacySkin(img)
    const canvas = document.createElement('canvas')
    canvas.width = 16 * scale
    canvas.height = 32 * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.imageSmoothingEnabled = false
    drawParts(skin, BASE_PARTS, ctx, scale)
    drawParts(skin, OVERLAY_PARTS, ctx, scale)
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}

/**
 * 渲染皮肤方块头像：裁头部基础层 (8,8) 8×8 + 外层 hat (40,8) 8×8 叠加，
 * 最近邻放大到 scale，返回 dataURL；失败返回 ''。
 */
export async function renderSkinHead(
  source: HTMLImageElement | string,
  scale = 64
): Promise<string> {
  try {
    const img = typeof source === 'string' ? await loadImage(source) : source
    const canvas = document.createElement('canvas')
    canvas.width = scale
    canvas.height = scale
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, 8, 8, 8, 8, 0, 0, scale, scale)
    ctx.drawImage(img, 40, 8, 8, 8, 0, 0, scale, scale)
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}

/**
 * 渲染披风正面外观图，返回 dataURL；失败返回 ''。
 * 标准披风纹理为 64×32，正面区域 (1,1) 10×16；源尺寸比例不同则按 10:16 裁剪中央区域。
 * 最近邻放大到 w×h，保持像素风。
 */
export async function renderCape(
  source: HTMLImageElement | string,
  w = 100,
  h = 160
): Promise<string> {
  try {
    const img = typeof source === 'string' ? await loadImage(source) : source
    const iw = img.naturalWidth || img.width
    const ih = img.naturalHeight || img.height
    if (!iw || !ih) return ''
    let sx = 1
    let sy = 1
    let sw = 10
    let sh = 16
    if (iw !== 64 || ih !== 32) {
      // 非标准尺寸：按 10:16 比例从中央裁剪
      const target = 10 / 16
      if (iw / ih > target) {
        sh = ih
        sw = ih * target
        sx = (iw - sw) / 2
        sy = 0
      } else {
        sw = iw
        sh = iw / target
        sx = 0
        sy = (ih - sh) / 2
      }
    }
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}
