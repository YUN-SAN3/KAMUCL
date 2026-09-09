import { app, screen, BrowserWindow, type Display } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

export interface NormalBounds {
  x: number
  y: number
  width: number
  height: number
}

const stateFile = () => join(app.getPath('userData'), 'window-state.json')

/** Windows 会把最小化窗口的还原位置移到幻影坐标（约 -32000），视为无效位置 */
const PHANTOM_MIN = -30000

export function isPhantomBounds(b: { x?: number; y?: number }): boolean {
  return typeof b.x === 'number' && typeof b.y === 'number' && (b.x < PHANTOM_MIN || b.y < PHANTOM_MIN)
}

/** 在全部显示器中找出与矩形相交面积最大的一块（无任何相交返回 null） */
export function dominantDisplay(displays: Display[], b: NormalBounds): Display | null {
  let best: Display | null = null
  let bestArea = 0
  for (const d of displays) {
    const wa = d.workArea
    const ix = Math.max(0, Math.min(b.x + b.width, wa.x + wa.width) - Math.max(b.x, wa.x))
    const iy = Math.max(0, Math.min(b.y + b.height, wa.y + wa.height) - Math.max(b.y, wa.y))
    const area = ix * iy
    if (area > bestArea) {
      bestArea = area
      best = d
    }
  }
  return best
}

/** 把窗口位置夹进指定显示器工作区，保证完整可见（窗口比工作区还大时对齐左上角） */
export function clampToWorkArea(
  b: NormalBounds,
  wa: { x: number; y: number; width: number; height: number }
): { x: number; y: number } {
  const x = b.width >= wa.width ? wa.x : Math.min(Math.max(b.x, wa.x), wa.x + wa.width - b.width)
  const y = b.height >= wa.height ? wa.y : Math.min(Math.max(b.y, wa.y), wa.y + wa.height - b.height)
  return { x, y }
}

/**
 * 上次关闭时的窗口状态。
 * 位置有效性按「与某显示器工作区相交面积最大」判定，并把位置夹进该屏工作区：
 * - 避免骑缝窗口（一条边在另一块屏）被原样恢复后最大化时行为不可控；
 * - 避免最小化时关闭留下的幻影坐标 (-32000) 把窗口打回主屏默认位置。
 * 完全离屏/无有效位置时返回 null x/y（回落默认居中），尺寸与最大化标记保留。
 */
export function loadWindowState(): WindowState | null {
  try {
    const raw = readFileSync(stateFile(), 'utf-8')
    const s = JSON.parse(raw) as WindowState
    if (typeof s?.width !== 'number' || typeof s?.height !== 'number') return null
    const fallback: WindowState = { width: s.width, height: s.height, maximized: s.maximized }
    if (typeof s.x !== 'number' || typeof s.y !== 'number' || isPhantomBounds(s)) return fallback
    const d = dominantDisplay(screen.getAllDisplays(), s as NormalBounds)
    if (!d) return fallback
    return { ...s, ...clampToWorkArea(s as NormalBounds, d.workArea) }
  } catch {
    return null
  }
}

/** 防抖持久化窗口 bounds（resize/move/最大化变化），关闭时立即写一次 */
export function trackWindowState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  /** 最后一次有效（非最小化、非幻影坐标）的正常位置；最小化中关闭时用它兜底 */
  let lastGood: NormalBounds | null = null
  const capture = (): NormalBounds | null => {
    if (win.isDestroyed() || win.isMinimized()) return lastGood
    const b = win.getNormalBounds()
    if (isPhantomBounds(b)) return lastGood
    lastGood = b
    return b
  }
  const save = () => {
    if (win.isDestroyed()) return
    try {
      const b = capture()
      const payload = b
        ? { ...b, maximized: isEffectivelyMaximized(win) }
        : {
            width: win.getBounds().width,
            height: win.getBounds().height,
            maximized: isEffectivelyMaximized(win)
          }
      writeFileSync(stateFile(), JSON.stringify(payload))
    } catch {
      /* 用户数据目录不可写时忽略 */
    }
  }
  const debounce = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      save()
    }, 500)
  }
  win.on('resize', debounce)
  win.on('move', debounce)
  win.on('maximize', debounce)
  win.on('unmaximize', debounce)
  win.on('close', save)
}

/* ------------------------------------------------------------------ */
/* 假最大化：frame:false + thickFrame 的窗口被真实最大化时，Windows 会把   */
/* 不可见缩放边框（约 7-8px/边）扩出工作区——单屏时正好贴边不可见，多屏     */
/* 并排时这圈边框（连同 Acrylic 材质与阴影）就溢出到相邻显示器，表现为      */
/* 「启动器的边边跑到另一个屏幕」。因此最大化改为手动 setBounds(工作区)，   */
/* 窗口矩形绝不越过本屏工作区。                                           */
/* ------------------------------------------------------------------ */

let fakeMaximized = false
let preMaxBounds: NormalBounds | null = null

export function isEffectivelyMaximized(win: BrowserWindow): boolean {
  return !win.isDestroyed() && (fakeMaximized || win.isMaximized())
}

/** 最大化/还原切换（渲染层标题栏按钮唯一入口） */
export function toggleMaximize(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMaximized()) {
    // 理论上不会走到（真实最大化已被 normalizeRealMaximize 收编），兜底还原
    win.unmaximize()
    fakeMaximized = false
    return
  }
  if (fakeMaximized) {
    if (preMaxBounds) win.setBounds(preMaxBounds)
    fakeMaximized = false
    preMaxBounds = null
    return
  }
  preMaxBounds = win.getNormalBounds()
  const display = screen.getDisplayMatching(preMaxBounds)
  win.setBounds(display.workArea)
  fakeMaximized = true
}

/** 启动时按持久化状态恢复最大化（显示器失效时 getDisplayMatching 自动回落主屏） */
export function applyMaximized(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isMaximized() || fakeMaximized) return
  const display = screen.getDisplayMatching(win.getBounds())
  preMaxBounds = win.getNormalBounds()
  win.setBounds(display.workArea)
  fakeMaximized = true
}

/** 系统吸附（Win+↑ / 拖到屏幕顶）触发的真实最大化 → 收编为假最大化 */
export function normalizeRealMaximize(win: BrowserWindow): void {
  if (win.isDestroyed() || !win.isMaximized()) return
  const display = screen.getDisplayMatching(win.getBounds())
  win.unmaximize()
  preMaxBounds = win.getNormalBounds()
  win.setBounds(display.workArea)
  fakeMaximized = true
}
