<script setup lang="ts">
/**
 * 右下角悬浮启动球（FAB）：
 * - 状态机：圆形态（默认）⇄ 胶囊展开态（鼠标悬浮）；拖动态为按压的子状态
 * - 展开态唯一收起依据是「指针真的离开了按钮区域」：mouseleave 先经 relatedTarget /
 *   elementFromPoint 复核，宽度过渡期间再按最终胶囊几何矩形兜底（过渡中元素 bounds 是变化的）
 * - 点击（按下后 ≤300ms 且位移 <6px）→ emit('launch')，复用 HomeView 既有启动链路；
 *   点击与启动本身不收起——指针仍悬停在按钮上就保持展开显示进度，指针离开才收回
 * - 长按 ≥300ms 或位移 ≥6px → 拖动：跟随指针、半透明、禁用悬浮展开，松手夹紧视口安全边距并持久化
 *   （松手时指针停在按钮上则恢复展开态）
 * - 无常驻 rAF；pointermove 监听仅按压期间挂载（setPointerCapture 保证移出球体仍持续派发）
 * - 启动中沿用横幅大按钮的既有反馈：进度条 + 实时进度文本，禁用重复点击
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps<{
  /** 主文案：闲置「开始游戏」，启动中为实时进度文本（与横幅时代同一 computed） */
  label: string
  /** 副文本：当前实例名 · MC 版本；无实例时为引导文案 */
  sub: string
  /** 启动中：胶囊内显示进度条 */
  busy: boolean
  /** 启动进度 0-100 */
  percent: number
  /** 禁用启动点击（无实例或正在启动） */
  disabled: boolean
}>()

const emit = defineEmits<{ (event: 'launch'): void }>()

const FAB_SIZE = 56 // 圆形态直径
const EXPANDED_W = 224 // 展开胶囊宽度（与 <style> 中 .expanded .fab-btn 宽度保持一致）
const SAFE_MARGIN = 16 // 视口安全边距
const DEFAULT_MARGIN = 24 // 默认停靠右下角的边距
const STORAGE_KEY = 'kamucl.launchFab'
const PRESS_MS = 300 // 长按判定阈值
const DRAG_THRESHOLD = 6 // 位移判定阈值（px）

const rootEl = ref<HTMLElement | null>(null)
const pos = ref({ x: 0, y: 0 })
const expanded = ref(false)
const dragging = ref(false)

const rootStyle = computed(() => ({
  transform: `translate3d(${Math.round(pos.value.x)}px, ${Math.round(pos.value.y)}px, 0)`
}))

/** 夹紧到视口安全边距内（拖动跟随 / 拖动结束 / 窗口 resize / 启动还原共用） */
function clampPos(x: number, y: number, viewportW = window.innerWidth, viewportH = window.innerHeight) {
  const maxX = Math.max(SAFE_MARGIN, viewportW - FAB_SIZE - SAFE_MARGIN)
  const maxY = Math.max(SAFE_MARGIN, viewportH - FAB_SIZE - SAFE_MARGIN)
  return { x: Math.min(Math.max(x, SAFE_MARGIN), maxX), y: Math.min(Math.max(y, SAFE_MARGIN), maxY) }
}

function defaultPos() {
  return clampPos(window.innerWidth - FAB_SIZE - DEFAULT_MARGIN, window.innerHeight - FAB_SIZE - DEFAULT_MARGIN)
}

/** 还原上次位置；损坏 / 越界数据夹紧兜底 */
function restorePos() {
  let saved: { x?: unknown; y?: unknown } | null = null
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') } catch { /* 数据损坏走默认位 */ }
  pos.value = saved && typeof saved.x === 'number' && typeof saved.y === 'number' ? clampPos(saved.x, saved.y) : defaultPos()
}

function persistPos() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: Math.round(pos.value.x), y: Math.round(pos.value.y) })) } catch { /* 只读存储静默跳过 */ }
}

function onViewportResize() { pos.value = clampPos(pos.value.x, pos.value.y) }

// ---------------- 悬浮展开 / 收起 ----------------
function onEnter() {
  if (pressed || dragging.value) return
  // 胶囊向左生长：贴近左缘时先平移到能容纳展开体的位置，避免展开部分出屏
  if (pos.value.x + FAB_SIZE - EXPANDED_W < SAFE_MARGIN) {
    pos.value = clampPos(SAFE_MARGIN + EXPANDED_W - FAB_SIZE, pos.value.y)
  }
  expanded.value = true
}

/** 展开胶囊的最终几何矩形：.fab-btn 锚定根节点右缘向左生长（根节点恒 56px，展开体溢出在外） */
function expandedRect() {
  const el = rootEl.value
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.right - EXPANDED_W, right: r.right, top: r.top, bottom: r.bottom }
}

/** 指针是否真的还在按钮上：优先 elementFromPoint 精确命中；宽度过渡中元素 bounds 不断变化，
 *  只要坐标落在最终胶囊矩形内就不算离开（避免过渡期误收起） */
function isPointerInside(x: number, y: number): boolean {
  const el = rootEl.value
  if (!el) return false
  const hit = document.elementFromPoint(x, y)
  if (hit && (hit === el || el.contains(hit))) return true
  const r = expandedRect()
  return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

function onLeave(event: MouseEvent) {
  if (pressed || dragging.value) return
  // relatedTarget 仍在按钮子树内（胶囊内部子元素间移动）→ 并未离开
  if (event.relatedTarget instanceof Node && rootEl.value?.contains(event.relatedTarget)) return
  // 展开态唯一收起依据：复核后指针确实在按钮区域外
  if (isPointerInside(event.clientX, event.clientY)) return
  expanded.value = false
}

// ---------------- 点击 / 长按拖动判定 ----------------
let pressed = false // 指针按压中（含尚未判定为拖动的阶段）
let enteredDrag = false
let downAt = 0
let downX = 0
let downY = 0
let grabX = 0 // 按下点相对球体左上角的偏移（拖动跟随用）
let grabY = 0
let longPressTimer: ReturnType<typeof setTimeout> | undefined

/** 进入拖动：半透明、禁止悬浮展开；pointermove 监听仅在此挂载、endPress 时卸载 */
function enterDrag() {
  if (enteredDrag) return
  clearTimeout(longPressTimer)
  enteredDrag = true
  dragging.value = true
  expanded.value = false
  rootEl.value?.addEventListener('pointermove', onPointerMove)
}

function endPress() {
  clearTimeout(longPressTimer)
  pressed = false
  enteredDrag = false
  dragging.value = false
  rootEl.value?.removeEventListener('pointermove', onPointerMove)
  rootEl.value?.removeEventListener('pointerup', onPointerUp)
  rootEl.value?.removeEventListener('pointercancel', onPointerCancel)
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  pressed = true
  enteredDrag = false
  downAt = Date.now()
  downX = event.clientX
  downY = event.clientY
  grabX = downX - pos.value.x
  grabY = downY - pos.value.y
  // 按压不收起：展开态交由悬浮判定管理，点击/启动中指针仍悬停就保持展开显示进度
  longPressTimer = setTimeout(enterDrag, PRESS_MS)
  try { rootEl.value?.setPointerCapture(event.pointerId) } catch { /* 指针已失效时忽略 */ }
  rootEl.value?.addEventListener('pointerup', onPointerUp)
  rootEl.value?.addEventListener('pointercancel', onPointerCancel)
}

function onPointerMove(event: PointerEvent) {
  if (!pressed) return
  if (!enteredDrag) {
    if (Math.hypot(event.clientX - downX, event.clientY - downY) < DRAG_THRESHOLD) return
    enterDrag()
  }
  pos.value = clampPos(event.clientX - grabX, event.clientY - grabY)
}

function onPointerUp(event: PointerEvent) {
  const wasDrag = enteredDrag
  endPress()
  if (wasDrag) {
    persistPos() // 拖动结束：位置已实时夹紧，落盘
    // 指针仍停在按钮上则恢复悬浮展开态，只有指针不在按钮上才保持收起
    expanded.value = isPointerInside(event.clientX, event.clientY)
    return
  }
  // 点击判定：按下后 ≤300ms 且位移 <6px → 启动；否则一律视为拖动结束
  if (Date.now() - downAt <= PRESS_MS && Math.hypot(event.clientX - downX, event.clientY - downY) < DRAG_THRESHOLD) {
    onActivate()
  }
}

function onPointerCancel(event: PointerEvent) {
  const wasDrag = enteredDrag
  endPress()
  if (wasDrag) {
    persistPos()
    expanded.value = isPointerInside(event.clientX, event.clientY)
  }
}

/** 点击（含键盘 Enter / Space）：复用 HomeView 启动链路；不强制收起——
 *  启动后指针仍悬停在按钮上就保持展开态显示进度，指针离开时由 onLeave 收回 */
function onActivate() {
  if (!props.disabled) emit('launch')
}

onMounted(() => {
  restorePos()
  window.addEventListener('resize', onViewportResize)
})

onUnmounted(() => {
  endPress()
  window.removeEventListener('resize', onViewportResize)
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="rootEl"
      class="launch-fab"
      :class="{ expanded: expanded && !dragging, dragging, disabled, busy }"
      :style="rootStyle"
      :title="busy ? label : disabled ? '请先选择游戏实例' : ''"
      @mouseenter="onEnter"
      @mouseleave="onLeave"
      @pointerdown="onPointerDown"
    >
      <button
        class="fab-btn"
        type="button"
        :aria-disabled="disabled"
        :aria-label="`${label}${sub ? '：' + sub : ''}`"
        @keydown.enter.prevent="onActivate"
        @keydown.space.prevent="onActivate"
      >
        <span v-if="busy" class="fab-progress" :style="{ width: percent + '%' }" aria-hidden="true"></span>
        <span class="fab-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13" /><path d="m12 6 6 6-6 6" /></svg>
        </span>
        <span class="fab-text">
          <strong>{{ label }}</strong>
          <small v-if="sub">{{ sub }}</small>
        </span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
/* z-index 80：低于 .menu-overlay(90) / .float-menu(95) / .modal-mask(100) 与顶栏下拉，避免盖住弹窗 */
.launch-fab {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 80;
  width: 56px;
  height: 56px;
  touch-action: none;
  transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease;
}
.launch-fab.dragging { opacity: 0.6; transition: none; cursor: grabbing; }
.fab-btn {
  /* 锚定右缘：展开时胶囊向左生长，圆形态的坐标语义不漂移 */
  position: absolute;
  top: 0;
  right: 0;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0;
  width: 56px;
  height: 56px;
  padding: 0 var(--space-4);
  overflow: hidden;
  border: 0;
  border-radius: 999px;
  background: var(--accent-grad);
  color: var(--on-accent);
  font-family: inherit;
  box-shadow: var(--shadow-lg);
  cursor: pointer;
  transition: width 200ms cubic-bezier(0.22, 1, 0.36, 1), gap 200ms cubic-bezier(0.22, 1, 0.36, 1), filter 0.18s ease;
}
.expanded .fab-btn { width: 224px; gap: var(--space-3); }
.launch-fab:not(.dragging):hover .fab-btn { filter: brightness(1.08); }
.fab-btn:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.fab-glyph { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex: none; }
.fab-glyph svg { width: 100%; height: 100%; }
.fab-text { display: flex; min-width: 0; max-width: 156px; flex-direction: column; gap: 2px; overflow: hidden; opacity: 0; text-align: left; transition: opacity 180ms ease; }
.expanded .fab-text { opacity: 1; }
.fab-text strong { overflow: hidden; font-size: var(--text-md); font-weight: 700; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
.fab-text small { overflow: hidden; color: color-mix(in srgb, var(--on-accent) 78%, transparent); font-size: var(--text-xs); line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
.fab-progress { position: absolute; inset: 0 auto 0 0; background: color-mix(in srgb, white 25%, transparent); transition: width 0.25s ease; }
/* 禁用（无实例）：灰色 + 悬浮提示；启动中保留 accent 底但降饱和（与原横幅大按钮一致） */
.launch-fab.disabled:not(.busy) .fab-btn { border: 1px solid var(--border); background: var(--card-2); color: var(--text-dim); box-shadow: var(--shadow); cursor: not-allowed; }
.launch-fab.disabled:not(.busy):hover .fab-btn { filter: none; }
.launch-fab.busy .fab-btn { cursor: progress; filter: saturate(0.75); }
@media (prefers-reduced-motion: reduce) {
  .launch-fab, .fab-btn, .fab-text, .fab-progress { transition: none; }
}
</style>
