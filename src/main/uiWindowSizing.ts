import { screen, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { fitUiWindowBounds, uiWindowMinimum, UiZoomState } from '../shared/uiSizing'

const controllers = new WeakMap<BrowserWindow, { configure: (enabled: boolean) => void }>()
type DisplayApi = Pick<typeof screen, 'getDisplayMatching' | 'getPrimaryDisplay' | 'on' | 'removeListener'>

export function adaptiveWindowOptions(options: BrowserWindowConstructorOptions, displays: DisplayApi = screen): BrowserWindowConstructorOptions {
  const display = options.x !== undefined && options.y !== undefined
    ? displays.getDisplayMatching({ x: options.x, y: options.y, width: options.width ?? 1360, height: options.height ?? 860 })
    : displays.getPrimaryDisplay()
  const workArea = display.workArea
  const bounds = fitUiWindowBounds({ x: options.x ?? workArea.x + (workArea.width - (options.width ?? 1360)) / 2,
    y: options.y ?? workArea.y + (workArea.height - (options.height ?? 860)) / 2,
    width: options.width ?? 1360, height: options.height ?? 860 }, workArea)
  const [minWidth, minHeight] = uiWindowMinimum(workArea)
  return { ...options, ...bounds, minWidth, minHeight }
}

/** Own only the current launcher window; never change desktop DPI, resolution,
 * other applications or native maximize/restore state. */
export function attachUiWindowSizing(win: BrowserWindow, enabled: boolean, displays: DisplayApi = screen): void {
  const zoom = new UiZoomState(win.webContents.getZoomFactor())
  let timer: ReturnType<typeof setTimeout> | undefined, applying = false, disposed = false, lastApplied = win.webContents.getZoomFactor()
  const available = () => !disposed && !win.isDestroyed() && !win.webContents.isDestroyed()
  const apply = (constrain = false, restoreManual = false) => {
    if (!available() || (win.isMinimized() && !restoreManual) || (!zoom.enabled && !restoreManual)) return
    if (zoom.enabled) {
      const bounds = win.getBounds(), area = displays.getDisplayMatching(bounds).workArea
      win.setMinimumSize(...uiWindowMinimum(area))
      // Enabling and a disconnected/smaller monitor may constrain the window.
      // Ordinary resize remains the user's choice; do not fight maximization.
      const outside = bounds.x + bounds.width <= area.x || bounds.y + bounds.height <= area.y || bounds.x >= area.x + area.width || bounds.y >= area.y + area.height
      if (!win.isMaximized() && !win.isFullScreen() && (constrain || outside || bounds.width > area.width || bounds.height > area.height)) {
        const fitted = fitUiWindowBounds(bounds, area)
        if (Object.keys(fitted).some(key => fitted[key as keyof typeof fitted] !== bounds[key as keyof typeof bounds])) win.setBounds(fitted)
      }
    }
    const actualZoom = win.webContents.getZoomFactor()
    if (Math.abs(actualZoom - lastApplied) > .0001) zoom.observe(actualZoom)
    const [width, height] = win.getContentSize()
    const factor = zoom.fit({ width, height })
    if (Math.abs(actualZoom - factor) > .0001) {
      applying = true
      try { win.webContents.setZoomFactor(factor) } finally { applying = false }
    }
    lastApplied = factor
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = undefined; apply() }, 60)
  }
  const configure = (value: boolean) => {
    if (!available() || zoom.enabled === value) return
    const actualZoom = win.webContents.getZoomFactor()
    if (zoom.enabled && Math.abs(actualZoom - lastApplied) > .0001) zoom.observe(actualZoom)
    zoom.configure(value, actualZoom)
    lastApplied = actualZoom
    if (!value) win.setMinimumSize(960, 620)
    apply(value, !value)
  }
  const userZoom = (_event: Electron.Event, direction: 'in' | 'out') => {
    if (!available() || applying || !zoom.enabled) return
    const factor = zoom.userZoom(direction)
    applying = true
    try { win.webContents.setZoomFactor(factor); lastApplied = factor } finally { applying = false }
  }
  const keyZoom = (event: Electron.Event, input: Electron.Input) => {
    if (!available() || !zoom.enabled || input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return
    if (!['+', '=', '-', '0'].includes(input.key)) return
    event.preventDefault()
    const factor = input.key === '0' ? zoom.resetUserZoom() : zoom.userZoom(input.key === '-' ? 'out' : 'in')
    applying = true
    try { win.webContents.setZoomFactor(factor); lastApplied = factor } finally { applying = false }
  }
  const displayChanged = () => { if (available() && zoom.enabled) apply() }
  win.on('resize', schedule); win.on('move', schedule)
  win.on('maximize', schedule); win.on('unmaximize', schedule); win.on('restore', schedule)
  win.webContents.on('did-finish-load', schedule)
  win.webContents.on('zoom-changed', userZoom)
  win.webContents.on('before-input-event', keyZoom)
  displays.on('display-metrics-changed', displayChanged)
  displays.on('display-removed', displayChanged)
  displays.on('display-added', displayChanged)
  controllers.set(win, { configure })
  win.once('closed', () => {
    disposed = true; if (timer) clearTimeout(timer)
    displays.removeListener('display-metrics-changed', displayChanged)
    displays.removeListener('display-removed', displayChanged)
    displays.removeListener('display-added', displayChanged)
    controllers.delete(win)
  })
  configure(enabled)
}

export function applyUiWindowAutoFit(win: BrowserWindow | null, enabled: boolean): void {
  if (win && !win.isDestroyed()) controllers.get(win)?.configure(enabled)
}
