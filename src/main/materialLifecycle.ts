/** Coalesce visibility transitions to finish the fade without resetting Acrylic. */
export function trackMaterialLifecycle(
  window: { on(event: string, listener: () => void): unknown; isDestroyed(): boolean; isMinimized?(): boolean; isVisible?(): boolean },
  report: (message: string) => void,
  restoreFrame: (finishStartupOpacity?: boolean) => void = () => {}
): () => void {
  let pending: ReturnType<typeof setTimeout> | undefined
  let closed = false
  let lastRefresh = 0
  let startupRevealed = false
  const refresh = () => {
    if (closed) return
    clearTimeout(pending)
    pending = setTimeout(() => {
      pending = undefined
      if (closed || window.isDestroyed() || window.isMinimized?.() || window.isVisible?.() === false) return
      try {
        // Electron owns native Acrylic and geometry. The helper only releases
        // a completed startup fade; it must never reassign material or bounds.
        restoreFrame(startupRevealed)
        lastRefresh = Date.now()
      } catch (error) { report(`Desktop acrylic refresh failed: ${String(error)}`) }
    }, 120)
  }
  for (const event of ['maximize', 'unmaximize', 'restore', 'show', 'leave-full-screen']) window.on(event, refresh)
  // Electron's setOpacity(1) leaves WS_EX_LAYERED behind. Release it only
  // after our own native fade has finished, never in the middle of the fade.
  window.on('kamucl:startup-opacity-complete', () => { startupRevealed = true; refresh() })

  // Alt+Tab/Win+D can need a frame repair, but focus belongs to the same queue
  // as maximize/show/restore. Never schedule a second independent compositor pass.
  window.on('focus', () => {
    if (!pending && Date.now() - lastRefresh < 1000) return
    refresh()
  })
  window.on('closed', () => { closed = true; clearTimeout(pending); pending = undefined })
  return refresh
}
