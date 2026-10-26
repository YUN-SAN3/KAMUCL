/** The owned window only; no global flags, focus changes, timers or size changes. */
interface RestoreContents {
  isDestroyed(): boolean
  getBackgroundThrottling(): boolean
  setBackgroundThrottling(allowed: boolean): void
  on(event: string, listener: () => void): unknown
  removeListener(event: string, listener: () => void): unknown
}

interface RestoreWindow {
  webContents: RestoreContents
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
  isFocused(): boolean
  on(event: string, listener: () => void): unknown
  removeListener(event: string, listener: () => void): unknown
}

type RestoreFailurePhase = 'native-state' | 'read-throttling' | 'pulse' | 'restore-throttling'

/**
 * Some Windows restores leave Chromium's Page Visibility state hidden even
 * though the native window is visible and focused. Reapply its existing
 * throttling policy once per eligible restore so Chromium resynchronizes.
 * Startup deliberately uses false until its first frames are ready; preserve it.
 */
export function resynchronizeWindowsRestore(
  window: RestoreWindow,
  platform: string,
  reportError: (phase: RestoreFailurePhase, error: unknown) => void = () => {}
): { dispose(): void } {
  if (platform !== 'win32') return { dispose() {} }

  const contents = window.webContents
  let pending = false, disposed = false, pulsing = false
  const warn = (phase: RestoreFailurePhase, error: unknown) => {
    try { reportError(phase, error) } catch { /* Logging must not affect window lifecycle. */ }
  }
  const clear = () => { pending = false }
  const dispose = () => {
    if (disposed) return
    disposed = true
    clear()
    window.removeListener('restore', restore)
    window.removeListener('focus', retry)
    window.removeListener('hide', clear)
    window.removeListener('minimize', clear)
    window.removeListener('closed', dispose)
    contents.removeListener('destroyed', dispose)
  }
  const retry = () => {
    if (!pending || disposed || pulsing) return
    try {
      if (window.isDestroyed() || contents.isDestroyed()) { dispose(); return }
      if (!window.isVisible() || window.isMinimized() || !window.isFocused()) return
    } catch (error) {
      clear()
      warn('native-state', error)
      return
    }
    // Consume before calling Electron, including a failed attempt. Focus alone
    // must never create a new attempt or repeatedly toggle a failing contents.
    clear()
    try {
      if (contents.getBackgroundThrottling() !== true) return
    } catch (error) {
      warn('read-throttling', error)
      return
    }
    pulsing = true
    try {
      contents.setBackgroundThrottling(false)
    } catch (error) {
      warn('pulse', error)
    } finally {
      // Attempt restoration even when disabling threw or the window closed
      // during the call. Electron may then reject; isolate that failure too.
      try { contents.setBackgroundThrottling(true) }
      catch (error) { warn('restore-throttling', error) }
      pulsing = false
    }
  }
  const restore = () => {
    if (disposed || pulsing) return
    pending = true
    retry()
  }
  window.on('restore', restore)
  window.on('focus', retry)
  window.on('hide', clear)
  window.on('minimize', clear)
  window.on('closed', dispose)
  contents.on('destroyed', dispose)
  return { dispose }
}
