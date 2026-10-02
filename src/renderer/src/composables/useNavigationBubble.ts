import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch, type Ref } from 'vue'

/** One shared surface moves between items; selection remains a separate semantic state. */
export function useNavigationBubble(selected: Ref<string>, layout: Ref<unknown>) {
  const navEl = ref<HTMLElement | null>(null)
  const target = ref<HTMLElement | null>(null)
  const bounds = reactive({ x: 0, y: 0, width: 0, height: 0, visible: false })
  const selection = reactive({ x: 0, y: 0, width: 0, height: 0, visible: false })
  let frame = 0
  let observer: ResizeObserver | undefined
  const measure = () => {
    const nav = navEl.value
    if (!nav) return
    const active = nav.querySelector<HTMLElement>(`[data-nav="${selected.value}"]`)
    const root = nav.getBoundingClientRect()
    const place = (element: HTMLElement | null | undefined, state: typeof bounds) => {
      if (!element?.isConnected || element.closest('[inert]')) { state.visible = false; return }
      const box = element.getBoundingClientRect()
      Object.assign(state, { x: box.left - root.left + nav.scrollLeft, y: box.top - root.top + nav.scrollTop, width: box.width, height: box.height, visible: true })
    }
    place(active, selection)
    let item = target.value ?? active
    if (item?.closest('[inert]') || !item?.isConnected) item = active
    if (item?.closest('[inert]')) item = nav.querySelector('[data-nav="resources"]')
    if (!item) { bounds.visible = false; return }
    place(item, bounds)
  }
  const retarget = (event: Event) => {
    const item = (event.target as Element).closest<HTMLElement>('[data-nav]')
    if (item && navEl.value?.contains(item) && target.value !== item) {
      target.value = item
      measure()
    }
  }
  const reset = () => { target.value = null; measure() }
  const focusOut = (event: FocusEvent) => {
    if (!navEl.value?.contains(event.relatedTarget as Node | null)) reset()
  }
  // Follow submenu geometry during expansion instead of using a stale offset.
  const refreshLayout = async () => {
    await nextTick()
    cancelAnimationFrame(frame)
    const until = performance.now() + 240
    const tick = () => { measure(); if (performance.now() < until) frame = requestAnimationFrame(tick) }
    tick()
  }
  watch([selected, layout], refreshLayout, { flush: 'post' })
  onMounted(() => {
    observer = new ResizeObserver(measure)
    if (navEl.value) {
      observer.observe(navEl.value)
      navEl.value.querySelectorAll('.nav-item, .nav-sub').forEach(item => observer!.observe(item))
    }
    measure()
  })
  onUnmounted(() => { cancelAnimationFrame(frame); observer?.disconnect() })
  const bubbleStyle = computed(() => ({
    transform: `translate3d(${bounds.x}px, ${bounds.y}px, 0)`,
    width: `${bounds.width}px`, height: `${bounds.height}px`, opacity: bounds.visible ? 1 : 0
  }))
  const selectionStyle = computed(() => ({
    transform: `translate3d(${selection.x}px, ${selection.y}px, 0)`,
    width: `${selection.width}px`, height: `${selection.height}px`, opacity: selection.visible ? 1 : 0
  }))
  return { navEl, bubbleStyle, selectionStyle, retarget, reset, focusOut, measure }
}
