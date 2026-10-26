export interface DesignNavigationScroll {
  nav: HTMLElement
  top: number
  left: number
}

/** The same nav node is teleported into the editor; its scroll range can shrink. */
export function captureDesignNavigationScroll(nav: HTMLElement | null): DesignNavigationScroll | undefined {
  return nav ? { nav, top: nav.scrollTop, left: nav.scrollLeft } : undefined
}

/** Restore the original viewport, then reveal the current page if preview navigation changed it. */
export function restoreDesignNavigationScroll(snapshot: DesignNavigationScroll | undefined): void {
  if (!snapshot?.nav.isConnected) return
  const { nav } = snapshot
  nav.scrollTop = snapshot.top
  nav.scrollLeft = snapshot.left
  const active = nav.querySelector<HTMLElement>('[aria-current="page"]')
  if (!active?.getClientRects().length || active.closest('[inert]')) return
  const clip = nav.getBoundingClientRect(), item = active.getBoundingClientRect()
  const scale = nav.offsetHeight ? clip.height / nav.offsetHeight : 1
  if (!(scale > 0)) return
  const top = clip.top + nav.clientTop * scale, bottom = top + nav.clientHeight * scale
  const delta = item.top < top || item.height > bottom - top ? item.top - top : item.bottom > bottom ? item.bottom - bottom : 0
  if (delta) nav.scrollTop += delta / scale
}
