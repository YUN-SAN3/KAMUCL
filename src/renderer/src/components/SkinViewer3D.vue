<script setup lang="ts">
/**
 * NameMC 风格 3D 皮肤查看器（Three.js）
 * - MC 人偶含 hat/外套/衣袖/裤腿外层（各大 0.5px + alphaTest 裁剪透明像素）
 * - 64×64 经典布局 UV：每面一个 MeshBasicMaterial + 克隆 texture 设 offset/repeat
 * - NearestFilter 保持像素风；走路动画（四肢绕顶部轴心摆动、头部微幅点头）
 * - 鼠标拖动旋转视角，松手后缓慢回到初始角度；WebGL 不可用时显示兜底提示
 */
import { beginBootTask } from '../bootTasks'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as THREE from 'three'

const props = withDefaults(defineProps<{ src?: string; variant?: 'classic' | 'slim'; cape?: string }>(), {
  src: '',
  variant: 'classic',
  cape: ''
})

const container = ref<HTMLDivElement | null>(null)
/** WebGL 初始化失败 → 显示兜底提示 */
const supported = ref(true)
/** 拖动中（切换 cursor: grabbing） */
const dragging = ref(false)

let renderer: THREE.WebGLRenderer | null = null
let scene!: THREE.Scene
let camera!: THREE.PerspectiveCamera
let model: THREE.Group | null = null
/** 参与走路动画的部件组（轴心即组原点） */
let parts: {
  head: THREE.Group
  armL: THREE.Group
  armR: THREE.Group
  legL: THREE.Group
  legR: THREE.Group
} | null = null
/** 当前模型占用的几何体/材质/纹理，重建或卸载时统一 dispose */
let disposables: { dispose(): void }[] = []
let baseTex: THREE.Texture | null = null
/** 披风纹理（装备时加载）与披风部件组 */
let capeTex: THREE.Texture | null = null
let capeGroup: THREE.Group | null = null
/** 披风纹理加载令牌（cape 变化后忽略旧回调） */
let capeToken = 0
/** 无皮肤或远端纹理不可用时使用本地生成的像素角色，外层需关闭以免遮住基础层 */
let fallbackTextureActive = false
/** 皮肤加载失败回调的过期令牌（src 变化后忽略旧回调） */
let loadToken = 0
let observer: ResizeObserver | null = null
let rafId = 0
let lastTime = 0
let walkT = 0

const INITIAL_ROT_Y = -0.35
let targetRotY = INITIAL_ROT_Y
let targetRotX = 0

// ---------------- 模型 ----------------

/**
 * 计算盒子六面在皮肤图上的区域 [x, y, w, h]（皮肤像素，64×64）。
 * 返回顺序 = BoxGeometry 材质顺序 [+x, -x, +y, -y, +z, -z]。
 * 约定角色正面朝 +z、左手边朝 +x（右臂在 -x 侧），故 +x 面取“左侧”区域、-x 面取“右侧”区域。
 * (fx, fy) 为正面区域左上角；slim 手臂传 w=3 时其余各区自然左移，与 MC 实际采样一致。
 */
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

/**
 * 建一个部件盒子（尺寸单位 = 皮肤像素）：
 * - pivot='top' 几何体下移半高（轴心在肩/髋）；'bottom' 上移半高（轴心在颈部）
 * - overlay=true 时盒子各大 0.5px，并 transparent + alphaTest 裁掉外层透明像素
 */
function buildPart(
  w: number,
  h: number,
  d: number,
  fx: number,
  fy: number,
  pivot: 'top' | 'bottom' | 'center',
  overlay: boolean
): THREE.Mesh {
  const inflate = overlay ? 0.5 : 0
  const geo = new THREE.BoxGeometry(w + inflate, h + inflate, d + inflate)
  if (pivot === 'top') geo.translate(0, -h / 2, 0)
  else if (pivot === 'bottom') geo.translate(0, h / 2, 0)
  const materials = faceRegions(fx, fy, w, h, d).map(([x, y, rw, rh]) => {
    const t = baseTex!.clone()
    // three.js 纹理 v 轴向上（贴图默认 flipY），皮肤坐标 y 向下 → offset.y 翻转
    t.offset.set(x / 64, 1 - (y + rh) / 64)
    t.repeat.set(rw / 64, rh / 64)
    const m = new THREE.MeshBasicMaterial({
      map: t,
      transparent: overlay,
      alphaTest: overlay ? 0.5 : 0
    })
    disposables.push(t, m)
    return m
  })
  disposables.push(geo)
  return new THREE.Mesh(geo, materials)
}

function at(mesh: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh {
  mesh.position.set(x, y, z)
  return mesh
}

/**
 * 披风六面在披风图上的区域 [x, y, w, h]（64×32 披风布局）。
 * 正面 [1,1]、背面 [12,1]、顶 [1,0]、底 [11,0]、左缘 [0,1]、右缘 [11,1]。
 */
function capeRegions() {
  return [
    [11, 1, 1, 16], // +x 右缘
    [0, 1, 1, 16], // -x 左缘
    [1, 0, 10, 1], // +y 顶
    [11, 0, 10, 1], // -y 底
    [1, 1, 10, 16], // +z 正面（朝向角色=被遮挡面）
    [12, 1, 10, 16] // -z 背面（外侧可见面）
  ] as const
}

/** 建披风薄板：10×16×1，顶部轴心（挂在肩部后方），摆动由动画驱动 */
function buildCape(): THREE.Group | null {
  if (!capeTex) return null
  const geo = new THREE.BoxGeometry(10, 16, 1)
  geo.translate(0, -8, 0) // 顶部轴心
  const materials = capeRegions().map(([x, y, rw, rh]) => {
    const t = capeTex!.clone()
    // 披风图 64×32：v 翻转与皮肤一致
    t.offset.set(x / 64, 1 - (y + rh) / 32)
    t.repeat.set(rw / 64, rh / 32)
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.NearestFilter
    t.generateMipmaps = false
    t.colorSpace = THREE.SRGBColorSpace
    t.needsUpdate = true
    const m = new THREE.MeshBasicMaterial({ map: t })
    disposables.push(t, m)
    return m
  })
  disposables.push(geo)
  const group = new THREE.Group()
  group.add(new THREE.Mesh(geo, materials))
  // 背部悬挂：肩部后缘（躯干背面 z=-2），微微后仰
  group.position.set(0, 24, -2.6)
  group.rotation.x = 0.08
  return group
}

/** 装备/卸下披风：立即重建披风部件 */
function rebuildCape() {
  if (capeGroup && model) {
    model.remove(capeGroup)
    capeGroup = null
  }
  if (!capeTex || !model) return
  capeGroup = buildCape()
  if (capeGroup) model.add(capeGroup)
}

/** 加载披风纹理（cape 变化时调用） */
function reloadCape() {
  const token = ++capeToken
  const src = props.cape
  if (!src) {
    capeTex = null
    rebuildCape()
    return
  }
  new THREE.TextureLoader().load(src, (tex) => {
    if (token !== capeToken) { tex.dispose(); return }
    const old = capeTex
    capeTex = tex
    rebuildCape()
    old?.dispose()
  }, undefined, () => {
    if (token !== capeToken) return
    capeTex = null
    rebuildCape()
  })
}

/**
 * 按 variant 重建人偶（64×64 经典布局；左臂/左腿用 1.16+ 第二套区域）。
 * 尺寸：头 8³ 中心 y=28；躯干 8×12×4 中心 y=18；臂 4(3)×12×4 肩 y=24；腿 4×12×4 髋 y=12。
 * slim 判定优先用皮肤图自动检测（Alex 手臂窄 1px，x=54 列全透明），不依赖档案传递链。
 */
let autoSlim = false

/** Alex（slim）检测：classic 右臂背面右缘列（x=54, y=20..32）有内容，slim 该列全透明。 */
function detectSlimFromTexture(tex: THREE.Texture): boolean {
  const image = tex.image as HTMLImageElement | ImageBitmap | undefined
  if (!image) return false
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return false
    ctx.drawImage(image as CanvasImageSource, 0, 0)
    const data = ctx.getImageData(54, 20, 1, 12).data
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return false // 有内容 → classic
    }
    return true // 全透明 → slim
  } catch {
    return false
  }
}

function buildModel() {
  disposeModel()
  if (!baseTex) return
  const slim = props.variant === 'slim' || autoSlim
  const armW = slim ? 3 : 4
  const armX = slim ? 5 : 5.5

  const root = new THREE.Group()

  const head = new THREE.Group()
  head.position.set(0, 24, 0) // 颈部
  head.add(buildPart(8, 8, 8, 8, 8, 'bottom', false))
  if (!fallbackTextureActive) head.add(buildPart(8, 8, 8, 40, 8, 'bottom', true)) // hat

  const body = new THREE.Group()
  body.add(at(buildPart(8, 12, 4, 20, 20, 'center', false), 0, 18, 0))
  if (!fallbackTextureActive) {
    body.add(at(buildPart(8, 12, 4, 20, 36, 'center', true), 0, 18, 0)) // jacket
  }

  const armR = new THREE.Group()
  armR.position.set(-armX, 24, 0) // 右肩（角色右手边 = -x）
  armR.add(buildPart(armW, 12, 4, 44, 20, 'top', false))
  if (!fallbackTextureActive) armR.add(buildPart(armW, 12, 4, 44, 36, 'top', true)) // 右袖

  const armL = new THREE.Group()
  armL.position.set(armX, 24, 0) // 左肩
  armL.add(buildPart(armW, 12, 4, 36, 52, 'top', false))
  if (!fallbackTextureActive) armL.add(buildPart(armW, 12, 4, 52, 52, 'top', true)) // 左袖

  const legR = new THREE.Group()
  legR.position.set(-2, 12, 0) // 右髋
  legR.add(buildPart(4, 12, 4, 4, 20, 'top', false))
  if (!fallbackTextureActive) legR.add(buildPart(4, 12, 4, 4, 36, 'top', true)) // 右裤腿

  const legL = new THREE.Group()
  legL.position.set(2, 12, 0) // 左髋
  legL.add(buildPart(4, 12, 4, 20, 52, 'top', false))
  if (!fallbackTextureActive) legL.add(buildPart(4, 12, 4, 4, 52, 'top', true)) // 左裤腿

  root.add(head, body, armR, armL, legR, legL)
  root.rotation.y = INITIAL_ROT_Y
  model = root
  parts = { head, armL, armR, legL, legR }
  scene.add(root)
  rebuildCape() // 装备的披风挂到模型背部（跟随模型重建）
}

/**
 * 生成一张完整的 64×64 本地皮肤纹理。它只用于没有账号皮肤或网络加载失败时，
 * 让首页的可拖动/行走 3D 组件仍可工作；有真实档案后会立即替换。
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

function useFallbackTexture() {
  const old = baseTex
  baseTex = createFallbackTexture()
  fallbackTextureActive = true
  buildModel()
  old?.dispose()
}

function disposeModel() {
  if (model) {
    scene.remove(model)
    model = null
    parts = null
  }
  for (const d of disposables) d.dispose()
  disposables = []
  // 注意：baseTex 不在此处 dispose——buildModel 开头会调用本函数，源纹理由调用方管理
}

/** 加载皮肤纹理并重建人偶；src / variant 变化时调用 */
let finishBootTexture = () => {}
function rebuild() {
  finishBootTexture()
  finishBootTexture = beginBootTask()
  const src = props.src
  const token = ++loadToken
  if (!renderer) { finishBootTexture(); return }
  if (!src) {
    useFallbackTexture()
    finishBootTexture()
    return
  }
  new THREE.TextureLoader().load(
    src,
    (tex) => {
      if (token !== loadToken) {
        tex.dispose()
        return
      }
      // 关键：必须在加载完成的回调里建模——提前克隆的空纹理不会随后续加载更新
      // 像素风关键：最近邻采样 + 关闭 mipmap；sRGB 保证颜色不发灰
      tex.magFilter = THREE.NearestFilter
      tex.minFilter = THREE.NearestFilter
      tex.generateMipmaps = false
      tex.colorSpace = THREE.SRGBColorSpace
      const old = baseTex
      baseTex = tex
      fallbackTextureActive = false
      // Alex/Steve 自动检测：皮肤图为准，不依赖档案 variant 传递是否准确
      autoSlim = detectSlimFromTexture(tex)
      buildModel()
      old?.dispose()
      renderer?.render(scene, camera)
      finishBootTexture()
    },
    undefined,
    () => {
      if (token !== loadToken) return
      useFallbackTexture()
      finishBootTexture()
    }
  )
}

// ---------------- 拖动旋转 ----------------

let lastX = 0
let lastY = 0

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  dragging.value = true
  lastX = e.clientX
  lastY = e.clientY
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove(e: PointerEvent) {
  const dx = e.clientX - lastX
  const dy = e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
  targetRotY += dx * 0.01
  targetRotX = THREE.MathUtils.clamp(targetRotX + dy * 0.01, -0.5, 0.5)
}

function onPointerUp() {
  dragging.value = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

// ---------------- 渲染循环 ----------------

function resize() {
  const el = container.value
  if (!el || !renderer || !camera) return
  const w = el.clientWidth
  const h = el.clientHeight
  if (!w || !h) return
  renderer.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

function animate(now: number) {
  rafId = requestAnimationFrame(animate)
  const dt = Math.min((now - lastTime) / 1000, 0.05)
  lastTime = now
  walkT += dt

  // 走路动画：左右臂反相摆动，左右腿与对侧臂同相，头部微幅点头
  if (parts) {
    const s = Math.sin(walkT * 4)
    parts.armL.rotation.x = s * 0.55
    parts.armR.rotation.x = -s * 0.55
    parts.legL.rotation.x = -s * 0.65
    parts.legR.rotation.x = s * 0.65
    parts.head.rotation.x = Math.sin(walkT * 8) * 0.03
    // 披风跟随走路摆动：基础后仰 + 四肢摆动节奏 + 拖尾感滞后
    if (capeGroup) {
      capeGroup.rotation.x = 0.08 + Math.abs(s) * 0.14 + Math.sin(walkT * 4 - 0.6) * 0.05
    }
  }

  // 视角：lerp 平滑趋近目标；未拖动时目标缓慢回到初始角度
  if (model) {
    if (!dragging.value) targetRotY += (INITIAL_ROT_Y - targetRotY) * 0.02
    model.rotation.y += (targetRotY - model.rotation.y) * 0.12
    model.rotation.x += (targetRotX - model.rotation.x) * 0.12
  }

  renderer?.render(scene, camera)
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
  renderer.setClearColor(0x000000, 0) // 透明背景，透出 --card-2 底色
  el.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(40, 1, 1, 200)
  camera.position.set(0, 20, 55)
  camera.lookAt(0, 15, 0) // 取景覆盖 0~32px 全身，略带俯视

  scene.add(new THREE.AmbientLight(0xffffff, 1.4))
  const dir = new THREE.DirectionalLight(0xffffff, 1.2)
  dir.position.set(20, 30, 40)
  scene.add(dir)

  resize()
  observer = new ResizeObserver(resize)
  observer.observe(el)

  rebuild()
  reloadCape()
  lastTime = performance.now()
  rafId = requestAnimationFrame(animate)
})

onUnmounted(() => {
  finishBootTexture()
  loadToken++ // 丢弃已卸载后才完成的纹理请求，避免重新创建 GPU 资源。
  capeToken++
  cancelAnimationFrame(rafId)
  observer?.disconnect()
  onPointerUp() // 防止拖动中卸载残留全局监听
  disposeModel()
  baseTex?.dispose()
  baseTex = null
  capeTex?.dispose()
  capeTex = null
  renderer?.dispose()
  renderer?.domElement.remove()
  renderer = null
})

watch([() => props.src, () => props.variant], rebuild)
watch(() => props.cape, reloadCape)
</script>

<template>
  <div
    ref="container"
    class="viewer3d"
    :class="{ dragging }"
    @pointerdown.prevent="onPointerDown"
  >
    <p v-if="!supported" class="muted viewer3d-fallback">当前环境不支持 3D 预览</p>
  </div>
</template>

<style scoped>
.viewer3d {
  position: relative;
  width: 100%;
  height: var(--sv3d-height, 340px);
  border-radius: 12px;
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
  font-size: 13px;
}
</style>
