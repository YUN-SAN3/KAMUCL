/** Electron screen/window sizes are device-independent pixels. Never apply DPI
 * again or multiply the previous fitted zoom when a resize arrives. */
export interface UiRectangle { x: number; y: number; width: number; height: number }
export const UI_COMFORT_SIZE = { width: 1120, height: 740 } as const

export function fittedUiScale(content: { width: number; height: number }): number {
  if (!Number.isFinite(content.width) || !Number.isFinite(content.height) || content.width <= 0 || content.height <= 0) return 1
  return Math.max(.5, Math.min(1, content.width / UI_COMFORT_SIZE.width, content.height / UI_COMFORT_SIZE.height))
}

/** Only enabled adaptive mode may shrink a restored/default window. Margins
 * leave the taskbar and native resize borders visible, including fractional DPI. */
export function fitUiWindowBounds(bounds: UiRectangle, workArea: UiRectangle): UiRectangle {
  const width = Math.min(bounds.width, Math.max(1, Math.floor(workArea.width * .92)))
  const height = Math.min(bounds.height, Math.max(1, Math.floor(workArea.height * .92)))
  return {
    width, height,
    x: Math.round(Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width)),
    y: Math.round(Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height))
  }
}

export function uiWindowMinimum(workArea: UiRectangle): [number, number] {
  return [Math.min(960, Math.max(1, Math.floor(workArea.width * .92))), Math.min(620, Math.max(1, Math.floor(workArea.height * .92)))]
}

export class UiZoomState {
  private manual = 1
  private fitted = 1
  enabled = false
  constructor(initialManual = 1) { this.manual = this.validManual(initialManual) }
  private validManual(value: number) { return Number.isFinite(value) && value > 0 ? value : 1 }
  configure(enabled: boolean, currentZoom: number): void {
    // Repeated settings saves must not reinterpret an already fitted zoom as
    // the user's preferred zoom. Disabling restores that independent value.
    if (this.enabled === enabled) return
    if (enabled) this.manual = this.validManual(currentZoom)
    this.enabled = enabled
  }
  fit(content: { width: number; height: number }): number {
    this.fitted = fittedUiScale(content)
    return this.zoom
  }
  userZoom(direction: 'in' | 'out'): number {
    const next = this.manual * (direction === 'in' ? 1.1 : 1 / 1.1)
    // Explicit zoom keys are bounded, while pre-existing preferences outside
    // that range are preserved and can move back gradually without a jump.
    this.manual = direction === 'in' ? Math.max(this.manual, Math.min(5, next)) : Math.min(this.manual, Math.max(.25, next))
    return this.zoom
  }
  resetUserZoom(): number { this.manual = 1; return this.zoom }
  /** Observe direct user/host zoom changes; own setZoomFactor calls are excluded. */
  observe(value: number): void { this.manual = this.validManual(value / (this.enabled ? this.fitted : 1)) }
  get zoom(): number { return this.manual * (this.enabled ? this.fitted : 1) }
}
