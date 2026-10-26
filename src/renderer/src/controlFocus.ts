/** Async disabling can make Chromium drop the focused control to the body.
 * Restore only that lost focus; never override a user's new focused control. */
export function restoreLostControlFocus(control: HTMLElement | null, scope: string): void {
  if (!control?.isConnected || !control.closest(scope) || control.matches(':disabled') || !control.getClientRects().length) return
  const document = control.ownerDocument
  if (document.activeElement !== document.body && document.activeElement !== document.documentElement) return
  control.focus({ preventScroll: true })
}
