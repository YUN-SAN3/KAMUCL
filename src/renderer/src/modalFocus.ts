/** Accessibility for legacy and shared dialogs, including nested teleported dialogs. */
export function installModalFocus() {
  const openers = new Map<HTMLElement, HTMLElement | null>()
  const selector = '.modal-mask .modal, [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'
  const visible = (el: HTMLElement) => !!el.getClientRects().length && !el.closest('[inert]')
  const controls = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"],summary')].filter(visible)
  const sync = () => {
    // Inert parent dialogs retain their opener while a nested confirmation is active.
    for (const [dialog, opener] of openers) if (!dialog.isConnected || !dialog.getClientRects().length) {
      openers.delete(dialog)
      const target = opener && !visible(opener) ? opener.closest('details')?.querySelector<HTMLElement>('summary') : opener
      if (target?.isConnected && visible(target)) target.focus({ preventScroll: true })
    }
    for (const dialog of document.querySelectorAll<HTMLElement>(selector)) {
      if (openers.has(dialog) || !visible(dialog)) continue
      openers.set(dialog, document.activeElement instanceof HTMLElement ? document.activeElement : null)
      if (dialog.getAttribute('role') !== 'alertdialog') dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true'); dialog.tabIndex = -1
      if (!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby')) dialog.setAttribute('aria-label', dialog.querySelector('h2,h3,.modal-title')?.textContent?.trim() || '对话框')
      if (!dialog.contains(document.activeElement)) (controls(dialog).find(el => el.hasAttribute('data-modal-initial-focus')) ?? controls(dialog).find(el => /取消|关闭/.test(el.textContent || '')) ?? controls(dialog)[0] ?? dialog).focus({ preventScroll: true })
    }
    const top = [...openers.keys()].filter(visible).at(-1), active = document.activeElement as HTMLElement | null
    if (top && (!active || !top.contains(active) || active.closest('[inert]') || active.matches(':disabled'))) {
      const items = controls(top)
      ;(items.find(el => el.hasAttribute('data-modal-initial-focus')) ?? items.find(el => el.hasAttribute('data-modal-dismiss')) ?? items[0] ?? top).focus({ preventScroll: true })
    }
  }
  const observer = new MutationObserver(sync); observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert', 'hidden', 'disabled'] })
  window.addEventListener('keydown', event => {
    if (event.defaultPrevented) return
    const dialogs = [...openers.keys()].filter(visible), dialog = dialogs[dialogs.length - 1]
    if (!dialog) return
    const items = controls(dialog)
    if (event.key === 'Tab') {
      const index = items.indexOf(document.activeElement as HTMLElement)
      if (!items.length) { event.preventDefault(); dialog.focus(); return }
      if (event.shiftKey ? index <= 0 : index < 0 || index === items.length - 1) {
        event.preventDefault(); (event.shiftKey ? items[items.length - 1] : items[0]).focus()
      }
    } else if (event.key === 'Escape') {
      const cancel = items.find(el => el.hasAttribute('data-modal-dismiss')) ?? items.find(el => el.tagName === 'BUTTON' && (/^(取消|关闭|返回)$/.test(el.textContent?.trim() || '') || /关闭/.test(el.getAttribute('aria-label') || el.title)))
      if (cancel) { event.preventDefault(); cancel.click() }
    }
  })
}
