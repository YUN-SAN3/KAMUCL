<script setup lang="ts">
/**
 * Minecraft 玩家 3D 查看器（Three.js / WebGL）
 * 参考成熟启动器实现：
 * - HMCL SkinCanvas：部件/UV 全表、外层放大倍率（帽 1.125、其余 1.0625）、拖拽与缩放体验
 * - FCL SkinRenderer：FOV 45° 透视、NEAREST 像素过滤、背面剔除、行走摆臂参数（三角波）
 * - skinview3d v3.4.2（bs-community，MIT）：底面 UV 顶点序（setUVs uvBottom）、
 *   行走手臂仅 X 轴摆动 + 0.02π 外张底角（animation.ts WalkAnimation）。
 *   参考源码：参考/skinview3d-master（仅对照数值与顶点约定，未整段移植）
 * - 64×64 标准 UV；旧版 64×32 皮肤先经 skin-render 迁移再上 GPU
 * - 按需渲染循环：无动画（暂停）且无交互平滑且 document.hidden 时停止 rAF；
 *   卸载时释放全部几何体/材质/纹理/GL 上下文与监听
 */
import { beginBootTask } from '../bootTasks'
import { loadImage, migrateLegacySkin } from '../skin-render'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as THREE from 'three'

const props = withDefaults(
  defineProps<{
    src?: string
    variant?: 'classic' | 'slim'
    /** 动画模式：walk = 行走摆臂（FCL 参数），idle = 待机呼吸。默认 walk 保持既有观感 */
    animation?: 'walk' | 'idle'
    /** 暂停动画（冻结在当前帧，交互仍可平滑响应） */
    paused?: boolean
    /** 可选披风纹理（64×32 标准披风图），空串/未传则不渲染披风 */
    cape?: string
  }>(),
  { src: '', variant: 'classic', animation: 'walk', paused: false, cape: '' }
)

const container = ref<HTMLDivElement | null>(null)
/** WebGL 初始化失败 → 显示兜底提示 */
const supported = ref(true)
/** 拖动中（切换 cursor: grabbing） */
const dragging = ref(false)

let renderer: THREE.WebGLRenderer | null = null
let scene!: THREE.Scene
let camera!: THREE.PerspectiveCamera
let root: THREE.Group | null = null
/** 参与骨骼动画的关节组（枢轴在肢体顶端） */
let joints: {
  head: THREE.Group
  armL: THREE.Group
  armR: THREE.Group
  legL: THREE.Group
  legR: THREE.Group
} | null = null
/** 当前模型占用的几何体/材质，重建或卸载时统一 dispose（纹理单独管理） */
let disposables: { dispose(): void }[] = []
let skinTex: THREE.Texture | null = null
let capeTex: THREE.Texture | null = null
/** 无皮肤或远端纹理不可用时使用本地生成的像素角色，外层/披风需关闭以免遮住基础层 */
let fallbackActive = false
/** 皮肤/披风加载的过期令牌（src 变化后忽略旧回调） */
let loadToken = 0
let capeToken = 0
let observer: ResizeObserver | null = null
let disposed = false

// ---------------- 相机 / 视角 ----------------

const FOV = 45 // FCL：透视 45°
const PITCH_MAX = (75 * Math.PI) / 180
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
/** 模型几何中心：标准 MC 全身 0~32（头 24~32 / 身 12~24 / 腿 0~12），取景以 y=16 居中 */
const MODEL_CENTER_Y = 16
/** 取景半幅：模型半高 16 + 余量（帽层放大 0.5、行走/呼吸起伏 0.3、头部摆动与落地间隙） */
const FIT_HALF_HEIGHT = 18
/** 初始朝向：微侧三分之二视角（经典启动器观感） */
const INITIAL_YAW = -0.35
let baseDist = 48
let yaw = INITIAL_YAW
let pitch = 0
let zoom = 1
let yawTarget = INITIAL_YAW
let pitchTarget = 0
let zoomTarget = 1

// ---------------- 行走动画（FCL 三角波参数：每帧步进 × 60fps → 度/秒） ----------------

const D2R = Math.PI / 180
/** 行走余弦节奏（rad/s）：与 MC 行走视觉周期一致 */
const WALK_RATE = 4.71
/** 手臂恒定外张底角（skinview3d WalkAnimation/IdleAnimation 的 basicArmRotationZ = 0.02π ≈ 3.6°），
 *  让垂落的手臂自然离开躯干侧壁，行走/待机共用 */
const ARM_BASE_TILT = Math.PI * 0.02
interface Osc {
  a: number
  dir: 1 | -1
}
interface WalkJoint {
  main: Osc
  sub: Osc
  mainRate: number
  mainAmp: number
  subRate: number
  subAmp: number
}
/** 对角肢体同相：左臂+右腿一组、右臂+左腿一组；所有肢体均只绕 X 轴前后摆（对齐 skinview3d） */
let walkJoints: Record<'armL' | 'armR' | 'legL' | 'legR', WalkJoint> | null = null
let walkBlend = 0
let animT = 0

function makeWalkJoints(): Record<'armL' | 'armR' | 'legL' | 'legR', WalkJoint> {
  return {
    // 主摆：臂 ±10°@30°/s，腿 ±30°@90°/s（FCL 参数，保留用户要过的手感）。
    // 手臂 Y 轴副摆已移除（原 FCL ±20°@20°/s）：臂内缘与躯干侧壁齐平（classic x=±4 贴 ±4），
    // 任何绕 Y 的内摆都会把手臂内前/内后角切进躯干（20° 时穿透约 0.56px、slim 约 0.63px）；
    // skinview3d WalkAnimation 手臂同样只有 X 轴摆动，改用 0.02π 恒定外张底角（见 applyPose）。
    // 腿的副摆 amp/rate 必须为 0：双腿绕 Y 轴镜像扭转就是「内八/外八」的根源。
    armL: { main: { a: 0, dir: -1 }, sub: { a: 0, dir: 1 }, mainRate: 0, mainAmp: 45, subRate: 0, subAmp: 0 },
    armR: { main: { a: 0, dir: 1 }, sub: { a: 0, dir: -1 }, mainRate: 0, mainAmp: 45, subRate: 0, subAmp: 0 },
    legL: { main: { a: 0, dir: 1 }, sub: { a: 0, dir: -1 }, mainRate: 0, mainAmp: 45, subRate: 0, subAmp: 0 },
    legR: { main: { a: 0, dir: -1 }, sub: { a: 0, dir: 1 }, mainRate: 0, mainAmp: 45, subRate: 0, subAmp: 0 }
  }
}

function stepWalk(): void {
  if (!walkJoints) return
  // MC 原版公式（HumanoidModel.setupAnim）：rotation.x = cos(limbSwing × 0.6662) × 1.4 × amount。
  // 行走 amount≈0.56 → 幅度 ±45°；四肢同幅、对角反相（左腿+右臂 / 右腿+左臂）；余弦在极值平滑转向。
  for (const j of Object.values(walkJoints)) {
    j.main.a = j.main.dir * Math.cos(animT * WALK_RATE) * j.mainAmp
    j.sub.a = 0
  }
}

// ---------------- UV / 建模 ----------------

/** 盒体六面在皮肤图上的区域 [x, y, w, h]（64×64 皮肤像素），顺序 = BoxGeometry 面 [+x,-x,+y,-y,+z,-z]。
 *  (fx, fy) 为正面区域左上角；约定角色正面朝 +z、角色左侧朝 +x。 */
function faceRegions(fx: number, fy: number, w: number, h: number, d: number) {
  return [
    [fx + w, fy, d, h], // +x 左侧
    [fx - d, fy, d, h], // -x 右侧
    [fx, fy - d, w, d], // +y 顶
    [fx + w, fy - d, w, d], // -y 底
    [fx, fy, w, h], // +z 正面
    [fx + w + d, fy, w, h] // -z 背面
  ] as const
}

/** 原版 Minecraft 面明暗：顶 1.0 / 底 0.5 / 前后 0.8 / 左右 0.6 */
const FACE_SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8]

/** 把六面 UV 区域直接写入 BoxGeometry 的 uv 属性（单纹理，免克隆），并写入顶点色明暗 */
function mapBoxUVs(
  geo: THREE.BoxGeometry,
  fx: number,
  fy: number,
  w: number,
  h: number,
  d: number
): void {
  const regions = faceRegions(fx, fy, w, h, d)
  const uv = geo.attributes.uv as THREE.BufferAttribute
  const colors: number[] = []
  for (let f = 0; f < 6; f++) {
    const [rx, ry, rw, rh] = regions[f]
    const u0 = rx / 64
    const u1 = (rx + rw) / 64
    const vTop = 1 - ry / 64 // 纹理 flipY，皮肤 y 向下 → v 向上翻转
    const vBot = 1 - (ry + rh) / 64
    const o = f * 4
    // BoxGeometry 每面 4 顶点 uv 顺序 (0,1) (1,1) (0,0) (1,0) = 左上/右上/左下/右下。
    // 但 -y 底面（ny）由 vdir=-1 构建，几何顶点序是 前左/前右/后左/后右（与其他面相反）。
    // 对齐 skinview3d setUVs 的 uvBottom = [下左, 下右, 上左, 上右]：
    // 前缘贴区域下边、后缘贴区域上边、u 方向不镜像 —— 若后缘 u 反接（旧「下巴修复」），
    // 底面前后边 u 相互反转呈蝶形扭曲，下巴/脚底等不对称纹理左右错位。
    if (f === 3) {
      uv.setXY(o + 0, u0, vBot)
      uv.setXY(o + 1, u1, vBot)
      uv.setXY(o + 2, u0, vTop)
      uv.setXY(o + 3, u1, vTop)
    } else {
      uv.setXY(o + 0, u0, vTop)
      uv.setXY(o + 1, u1, vTop)
      uv.setXY(o + 2, u0, vBot)
      uv.setXY(o + 3, u1, vBot)
    }
    const s = FACE_SHADE[f]
    for (let v = 0; v < 4; v++) colors.push(s, s, s)
  }
  uv.needsUpdate = true
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
}

/** 建一个部件盒（尺寸=皮肤像素）。inflate：外层放大倍率；centerY：盒心相对关节枢轴的偏移。 */
function buildPart(
  w: number,
  h: number,
  d: number,
  fx: number,
  fy: number,
  inflate: number,
  centerY: number,
  overlay: boolean
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w * inflate, h * inflate, d * inflate)
  geo.translate(0, centerY, 0)
  mapBoxUVs(geo, fx, fy, w, h, d)
  const mat = new THREE.MeshBasicMaterial({
    map: skinTex!,
    vertexColors: true,
    // 原版为 alpha cutout：透明像素剔除（阈值 0.1），外层不写半透明混合
    alphaTest: 0.1,
    transparent: overlay
  })
  disposables.push(geo, mat)
  return new THREE.Mesh(geo, mat)
}

/** 普通外层放大 1.0625，帽层 1.125（HMCL SkinCanvas） */
const INFLATE_OVERLAY = 1.0625
const INFLATE_HAT = 1.125

/**
 * slim（Alex）像素级自动检测：classic 臂 4 宽，右臂背面 (52..56,20..32) 含 x=54 列；
 * slim 臂仅 3 宽（52..55），x=54 列全透明。有像素 → classic（false），全透明 → slim（true），
 * 读取失败 → null（回退 variant prop）。检测结果优先于 props 传递链。
 */
function detectSlimFromTexture(tex: HTMLImageElement | HTMLCanvasElement): boolean | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(tex, 0, 0, 64, 64)
    const data = ctx.getImageData(54, 20, 1, 12).data
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return false // classic：右臂背面铺满 4 宽
    }
    return true
  } catch {
    return null
  }
}

/** 像素检测结果：true=slim / false=classic / null=未知（回退 variant prop） */
let autoSlim: boolean | null = null

function buildModel(): void {
  disposeModel()
  if (!skinTex) return
  const slim = props.variant === 'slim' || autoSlim === true
  const armW = slim ? 3 : 4
  const armX = slim ? 5.5 : 6 // 经典臂贴±6、纤细臂贴±5.5（FCL 部件偏移表）

  walkJoints = makeWalkJoints()
  const g = new THREE.Group()
  g.rotation.order = 'YXZ' // 先 yaw 后 pitch：任意朝向下垂直拖动都「朝自己倾倒」（HMCL 体验）

  const head = new THREE.Group()
  head.position.set(0, 24, 0) // 颈部枢轴
  head.add(buildPart(8, 8, 8, 8, 8, 1, 4, false))
  if (!fallbackActive) head.add(buildPart(8, 8, 8, 40, 8, INFLATE_HAT, 4, true)) // 帽层

  const body = new THREE.Group()
  body.position.set(0, 18, 0)
  body.add(buildPart(8, 12, 4, 20, 20, 1, 0, false))
  if (!fallbackActive) body.add(buildPart(8, 12, 4, 20, 36, INFLATE_OVERLAY, 0, true)) // 外套

  const armL = new THREE.Group()
  armL.position.set(armX, 24, 0) // 左肩枢轴
  armL.add(buildPart(armW, 12, 4, 36, 52, 1, -6, false))
  if (!fallbackActive) armL.add(buildPart(armW, 12, 4, 52, 52, INFLATE_OVERLAY, -6, true)) // 左袖

  const armR = new THREE.Group()
  armR.position.set(-armX, 24, 0) // 右肩枢轴
  armR.add(buildPart(armW, 12, 4, 44, 20, 1, -6, false))
  if (!fallbackActive) armR.add(buildPart(armW, 12, 4, 44, 36, INFLATE_OVERLAY, -6, true)) // 右袖

  const legL = new THREE.Group()
  legL.position.set(2, 12, 0) // 左髋枢轴
  legL.add(buildPart(4, 12, 4, 20, 52, 1, -6, false))
  if (!fallbackActive) legL.add(buildPart(4, 12, 4, 4, 52, INFLATE_OVERLAY, -6, true)) // 左裤腿

  const legR = new THREE.Group()
  legR.position.set(-2, 12, 0) // 右髋枢轴
  legR.add(buildPart(4, 12, 4, 4, 20, 1, -6, false))
  if (!fallbackActive) legR.add(buildPart(4, 12, 4, 4, 36, INFLATE_OVERLAY, -6, true)) // 右裤腿

  g.add(head, body, armL, armR, legL, legR)
  attachCapeMesh(g)
  g.rotation.y = yaw
  g.rotation.x = pitch
  root = g
  joints = { head, armL, armR, legL, legR }
  scene.add(g)
}

/** 披风：10×16×1，正面 UV (1,1)，枢轴在顶端，翻转朝后并外倾 10°（HMCL 披风参数） */
function attachCapeMesh(parent: THREE.Group): void {
  if (!capeTex || fallbackActive) return
  const geo = new THREE.BoxGeometry(10, 16, 1)
  geo.translate(0, -8, 0) // 枢轴在披风顶端
  const regions = faceRegions(1, 1, 10, 16, 1)
  const uv = geo.attributes.uv as THREE.BufferAttribute
  const colors: number[] = []
  for (let f = 0; f < 6; f++) {
    const [rx, ry, rw, rh] = regions[f]
    const u0 = rx / 64
    const u1 = (rx + rw) / 64
    const vTop = 1 - ry / 32 // 披风纹理 64×32
    const vBot = 1 - (ry + rh) / 32
    const o = f * 4
    // 与 mapBoxUVs 相同的 -y 底面约定（skinview3d uvBottom 顶点序），修复披风下摆 UV 蝶形扭曲
    if (f === 3) {
      uv.setXY(o + 0, u0, vBot)
      uv.setXY(o + 1, u1, vBot)
      uv.setXY(o + 2, u0, vTop)
      uv.setXY(o + 3, u1, vTop)
    } else {
      uv.setXY(o + 0, u0, vTop)
      uv.setXY(o + 1, u1, vTop)
      uv.setXY(o + 2, u0, vBot)
      uv.setXY(o + 3, u1, vBot)
    }
    const s = FACE_SHADE[f]
    for (let v = 0; v < 4; v++) colors.push(s, s, s)
  }
  uv.needsUpdate = true
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  const mat = new THREE.MeshBasicMaterial({ map: capeTex, vertexColors: true, alphaTest: 0.1 })
  disposables.push(geo, mat)
  const mesh = new THREE.Mesh(geo, mat)
  const joint = new THREE.Group()
  joint.position.set(0, 24, -2.7) // 挂在背部
  joint.rotation.order = 'YXZ'
  joint.rotation.y = Math.PI // 正面纹理翻向观察者（HMCL 同款 180° 翻转）
  joint.rotation.x = -10 * D2R // 下摆外倾
  joint.add(mesh)
  parent.add(joint)
}

/**
 * 生成一张完整的 64×64 本地皮肤纹理。它只用于没有账号皮肤或网络加载失败时，
 * 让可拖动/动画的 3D 组件仍可工作；有真实档案后会立即替换。
 */
function createFallbackTexture(): THREE.DataTexture {
  const size = 64
  const pixels = new Uint8Array(size * size * 4)
  const paint = (x: number, y: number, w: number, h: number, rgba: [number, number, number, number]) => {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        const index = (py * size + px) * 4
        pixels[index] = rgba[0]
        pixels[index + 1] = rgba[1]
        pixels[index + 2] = rgba[2]
        pixels[index + 3] = rgba[3]
      }
    }
  }

  // 基础层全部不透明，按原版 64×64 UV 区域绘制克制的绿色外套角色。
  paint(0, 0, 64, 64, [190, 139, 98, 255])
  paint(16, 16, 24, 16, [61, 116, 78, 255]) // 躯干
  paint(40, 16, 16, 16, [54, 105, 70, 255]) // 右臂
  paint(32, 48, 16, 16, [54, 105, 70, 255]) // 左臂
  paint(0, 16, 16, 16, [43, 50, 58, 255]) // 右腿
  paint(16, 48, 16, 16, [43, 50, 58, 255]) // 左腿
  paint(0, 0, 32, 8, [73, 48, 36, 255]) // 发顶和头部侧面
  paint(8, 8, 8, 3, [78, 50, 37, 255]) // 刘海
  paint(8, 11, 8, 5, [201, 151, 107, 255]) // 脸
  paint(9, 12, 2, 1, [49, 42, 38, 255])
  paint(13, 12, 2, 1, [49, 42, 38, 255])
  paint(11, 15, 2, 1, [139, 78, 66, 255])

  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat)
  texture.flipY = true
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function makeTexture(src: HTMLImageElement | HTMLCanvasElement): THREE.Texture {
  const t = new THREE.Texture(src)
  // 像素风关键：最近邻采样 + 关闭 mipmap；sRGB 保证颜色不发灰
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

function useFallbackTexture(): void {
  const old = skinTex
  skinTex = createFallbackTexture()
  fallbackActive = true
  autoSlim = null
  buildModel()
  old?.dispose()
}

function disposeModel(): void {
  if (root) {
    scene.remove(root)
    root = null
    joints = null
    walkJoints = null
  }
  for (const d of disposables) d.dispose()
  disposables = []
}

// ---------------- 纹理加载 ----------------

let finishBootTexture = () => {}

/** 加载皮肤纹理并重建人偶；src / variant 变化时调用 */
function rebuild(): void {
  finishBootTexture()
  finishBootTexture = beginBootTask()
  const src = props.src
  const token = ++loadToken
  if (!renderer) {
    finishBootTexture()
    return
  }
  if (!src) {
    useFallbackTexture()
    finishBootTexture()
    requestFrame()
    return
  }
  loadImage(src)
    .then((img) => {
      if (token !== loadToken || disposed) return
      // 旧版 64×32 皮肤先迁移为 64×64（HMCL 镜像拷贝法），再做 slim 像素检测
      const tex = migrateLegacySkin(img)
      autoSlim = detectSlimFromTexture(tex)
      const old = skinTex
      skinTex = makeTexture(tex)
      fallbackActive = false
      buildModel()
      old?.dispose()
      finishBootTexture()
      requestFrame()
    })
    .catch(() => {
      if (token !== loadToken || disposed) return
      useFallbackTexture()
      finishBootTexture()
      requestFrame()
    })
}

/** 加载披风纹理并挂到模型；cape 变化时调用 */
function rebuildCape(): void {
  const src = props.cape
  const token = ++capeToken
  if (!renderer) return
  if (!src) {
    const old = capeTex
    capeTex = null
    if (root) buildModel() // 重建以移除披风
    old?.dispose()
    requestFrame()
    return
  }
  loadImage(src)
    .then((img) => {
      if (token !== capeToken || disposed) return
      const old = capeTex
      capeTex = makeTexture(img)
      if (root) buildModel() // 重建以挂载新披风
      old?.dispose()
      requestFrame()
    })
    .catch(() => {
      if (token !== capeToken || disposed) return
    })
}

// ---------------- 交互：拖动旋转 / 滚轮缩放 / 双击回正 ----------------

let lastX = 0
let lastY = 0

function onPointerDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  dragging.value = true
  lastX = e.clientX
  lastY = e.clientY
  try {
    container.value?.setPointerCapture(e.pointerId)
  } catch {
    /* 指针已释放时忽略 */
  }
  requestFrame()
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  const dx = e.clientX - lastX
  const dy = e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
  // 水平拖 → yaw 无限旋转；垂直拖 → pitch 夹紧。模型 rotation 用 YXZ 欧拉序，
  // 等价于 HMCL 象限分配公式：任意朝向下垂直拖动都朝观察者方向倾倒。
  yawTarget += dx * 0.01
  pitchTarget = clamp(pitchTarget + dy * 0.01, -PITCH_MAX, PITCH_MAX)
  requestFrame()
}

function onPointerUp(e: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  try {
    container.value?.releasePointerCapture(e.pointerId)
  } catch {
    /* 已释放时忽略 */
  }
  requestFrame() // 让残余的平滑过程播完
}

function onWheel(e: WheelEvent) {
  const step = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1)
  zoomTarget = clamp(zoomTarget * Math.exp(-step * 0.0012), ZOOM_MIN, ZOOM_MAX)
  requestFrame()
}

/** 双击回正：视角与缩放缓动回初始状态 */
function resetView(): void {
  yawTarget = INITIAL_YAW
  pitchTarget = 0
  zoomTarget = 1
  requestFrame()
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

// ---------------- 渲染循环（按需） ----------------

let rafId = 0
let lastFrame = 0

/** 有任何渲染理由时唤醒循环；循环自己判断何时停 */
function requestFrame(): void {
  if (disposed || rafId) return
  lastFrame = performance.now()
  rafId = requestAnimationFrame(tick)
}

function tick(now: number): void {
  rafId = 0
  if (disposed) return
  const dt = clamp((now - lastFrame) / 1000, 0, 0.05)
  lastFrame = now

  // 动画时钟：暂停或页面隐藏时不推进（冻结当前帧）
  const animating = !props.paused && !document.hidden
  if (animating) {
    animT += dt
    if (props.animation === 'walk') stepWalk()
    const bt = props.animation === 'walk' ? 1 : 0
    walkBlend += (bt - walkBlend) * Math.min(1, dt * 6)
  }

  // 交互平滑：即使动画暂停也保持跟手
  const k = 1 - Math.exp(-dt * 14)
  yaw += (yawTarget - yaw) * k
  pitch += (pitchTarget - pitch) * k
  zoom += (zoomTarget - zoom) * k
  const settled =
    Math.abs(yaw - yawTarget) < 1e-4 &&
    Math.abs(pitch - pitchTarget) < 1e-4 &&
    Math.abs(zoom - zoomTarget) < 1e-3 &&
    (!animating || Math.abs(walkBlend - (props.animation === 'walk' ? 1 : 0)) < 1e-3)

  applyPose()
  applyCamera()
  renderer?.render(scene, camera)

  // 按需渲染：动画播放中 / 交互中 / 平滑未收敛才继续，否则停止 rAF
  if (animating || dragging.value || !settled) requestFrame()
}

function applyPose(): void {
  if (!root || !joints) return
  const b = walkBlend
  const j = walkJoints
  if (j) {
    // 对角同相：左臂+右腿、右臂+左腿（方向符号在 makeWalkJoints 中配置）；
    // 手臂只绕 X 轴摆动（Y 副摆穿模已移除），Z 轴恒定外张（skinview3d basicArmRotationZ）
    joints.armL.rotation.x = j.armL.main.a * D2R * b
    joints.armL.rotation.y = 0
    joints.armL.rotation.z = ARM_BASE_TILT
    joints.armR.rotation.x = j.armR.main.a * D2R * b
    joints.armR.rotation.y = 0
    joints.armR.rotation.z = -ARM_BASE_TILT
    // 腿：只有 X 轴前后主摆（FCL 无 Y 轴副摆），rotation.y/z 恒为 0。
    // 待机（b→0）时双腿垂直并拢在 x=±2；行走时仅前后摆，绝无内外八。
    joints.legL.rotation.x = j.legL.main.a * D2R * b
    joints.legR.rotation.x = j.legR.main.a * D2R * b
  }
  // 头部保持正直：无点头/环顾（用户要求「走就走」——除四肢摆动外一切微动画移除）
  joints.head.rotation.x = 0
  joints.head.rotation.y = 0
  // 躯干零位移：行走弹跳与待机呼吸起伏是「上下抖动」的根源，彻底移除；模型恒定立于原地
  root.position.y = 0
  root.rotation.y = yaw
  // pitch 不再翻倒模型（绕脚部倾倒不符合直觉）；俯仰由相机环绕实现（applyCamera）
}

function applyCamera(): void {
  if (!camera) return
  // 相机平视模型几何中心 y=16：全身 0~32 恒定居中，帽层/起伏不会被上缘裁切
  // 俯仰=相机绕模型几何中心环绕（脚部保持原地，符合直觉；原先把模型绕脚部翻倒）
  const dist = baseDist / zoom
  camera.position.set(0, MODEL_CENTER_Y + Math.sin(pitch) * dist, Math.cos(pitch) * dist)
  camera.lookAt(0, MODEL_CENTER_Y, 0)
}

function updateCamera(): void {
  const el = container.value
  if (!el || !renderer || !camera) return
  const w = el.clientWidth
  const h = el.clientHeight
  if (!w || !h) return
  renderer.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  // FCL 取景法：距离 = 半幅 / tan(fov/2)。垂直覆盖半幅 18（全身 32 + 余量）；
  // 窄容器再保证 ±8 臂展可见；24 为极窄画布下限，避免模型缩得过小。
  const halfTan = Math.tan(((FOV / 2) * Math.PI) / 180)
  baseDist = Math.max(FIT_HALF_HEIGHT / halfTan, 10 / (halfTan * camera.aspect), 24)
}

function onVisibilityChange(): void {
  if (document.hidden) {
    // 页面隐藏立即停 rAF，恢复时由 requestFrame 重新唤醒
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  } else {
    requestFrame()
  }
}

// ---------------- 生命周期 ----------------

onMounted(() => {
  const el = container.value
  if (!el) return
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
  } catch {
    supported.value = false
    return
  }
  // 高 DPI 保持清晰，同时限制像素比，避免大窗口动画造成不必要的 GPU 压力。
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x000000, 0) // 透明背景，透出卡片底色
  el.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 500)

  updateCamera()
  observer = new ResizeObserver(() => {
    updateCamera()
    requestFrame()
  })
  observer.observe(el)
  document.addEventListener('visibilitychange', onVisibilityChange)

  rebuild()
  rebuildCape()
  requestFrame()
})

onUnmounted(() => {
  disposed = true
  finishBootTexture()
  loadToken++ // 丢弃已卸载后才完成的纹理请求，避免重新创建 GPU 资源
  capeToken++
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
  observer?.disconnect()
  observer = null
  document.removeEventListener('visibilitychange', onVisibilityChange)
  disposeModel()
  skinTex?.dispose()
  skinTex = null
  capeTex?.dispose()
  capeTex = null
  if (renderer) {
    renderer.dispose()
    try {
      renderer.forceContextLoss() // 立即归还 GL 上下文，压榨显存
    } catch {
      /* 部分环境无此实现 */
    }
    renderer.domElement.remove()
    renderer = null
  }
})

watch([() => props.src, () => props.variant], () => {
  if (renderer) rebuild()
})
watch(
  () => props.cape,
  () => {
    if (renderer) rebuildCape()
  }
)
watch([() => props.paused, () => props.animation], () => requestFrame())

defineExpose({
  /** 视角与缩放回正（双击同样触发） */
  resetView
})
</script>

<template>
  <div
    ref="container"
    class="viewer3d"
    :class="{ dragging }"
    @pointerdown.prevent="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel.prevent="onWheel"
    @dblclick="resetView"
  >
    <p v-if="!supported" class="muted viewer3d-fallback">当前环境不支持 3D 预览</p>
  </div>
</template>

<style scoped>
.viewer3d {
  position: relative;
  width: 100%;
  height: var(--sv3d-height, 340px);
  border-radius: var(--radius-md, 10px);
  background: var(--sv3d-surface, var(--card-2));
  overflow: hidden;
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.viewer3d.dragging {
  cursor: grabbing;
}
.viewer3d :deep(canvas) {
  display: block;
}
.viewer3d-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-sm, 13px);
}
</style>
