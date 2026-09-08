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
        ? { ...b, maximized: win.isMaximized() }
        : {
            width: win.getBounds().width,
            height: win.getBounds().height,
            maximized: win.isMaximized()
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
