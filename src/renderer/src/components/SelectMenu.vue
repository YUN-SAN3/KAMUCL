<script setup lang="ts">
/**
 * 通用自定义下拉：替代原生 <select>（原生展开列表是 Windows 外观，与主题不符）。
 * 浮层 Teleport 到 body 避免卡片 overflow 裁切；点击外部 / Esc 关闭。
 */
import { computed, onBeforeUnmount, ref } from 'vue'

const props = defineProps<{
  modelValue: string
  options: Array<{ value: string; label: string }>
  disabled?: boolean
  placeholder?: string
  /** 浮层最大高度（超出滚动） */
  maxHeight?: number
}>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void; (e: 'change', value: string): void }>()

const open = ref(false)
const buttonEl = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

const currentLabel = computed(() =>
  props.options.find((o) => o.value === props.modelValue)?.label ?? props.placeholder ?? '请选择'
)

function toggle() {
  if (props.disabled) return
  if (open.value) { close(); return }
  const rect = buttonEl.value?.getBoundingClientRect()
  if (rect) {
    const maxH = props.maxHeight ?? 320
    const below = innerHeight - rect.bottom
    const up = below < Math.min(maxH, 220) && rect.top > below
    menuStyle.value = up
      ? { left: rect.left + 'px', bottom: innerHeight - rect.top + 6 + 'px', minWidth: rect.width + 'px', maxHeight: maxH + 'px' }
      : { left: rect.left + 'px', top: rect.bottom + 6 + 'px', minWidth: rect.width + 'px', maxHeight: maxH + 'px' }
  }
  open.value = true
  addEventListener('pointerdown', onPointerDown, true)
  addEventListener('keydown', onKeydown, true)
}
function close() {
  open.value = false
  removeEventListener('pointerdown', onPointerDown, true)
  removeEventListener('keydown', onKeydown, true)
}
function onPointerDown(e: PointerEvent) {
  if (!(e.target as HTMLElement).closest('.select-menu-float, .select-menu-btn')) close()
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}
function choose(value: string) {
  emit('update:modelValue', value)
  emit('change', value)
  close()
}
onBeforeUnmount(close)
</script>

<template>
  <button
    ref="buttonEl"
    type="button"
    class="select-menu-btn"
    :class="{ open, disabled: props.disabled }"
    :disabled="props.disabled"
    :aria-expanded="open"
    @click="toggle"
  >
    <span class="select-menu-label">{{ currentLabel }}</span>
    <svg class="select-menu-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
  </button>
  <Teleport to="body">
    <div v-if="open" class="select-menu-float" :style="menuStyle" role="listbox">
      <button
        v-for="o in props.options"
        :key="o.value"
        type="button"
        class="select-menu-option"
        :class="{ active: o.value === props.modelValue }"
        role="option"
        :aria-selected="o.value === props.modelValue"
        @click="choose(o.value)"
      >
        <span class="select-menu-option-label">{{ o.label }}</span>
        <svg v-if="o.value === props.modelValue" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      </button>
      <div v-if="!props.options.length" class="select-menu-empty">无可选项</div>
    </div>
  </Teleport>
</template>

<style scoped>
.select-menu-btn {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: var(--ctl-h);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-2);
  color: var(--text);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.select-menu-btn:hover:not(.disabled) { border-color: var(--accent-deep, var(--accent)); }
.select-menu-btn.open { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.select-menu-btn.disabled { opacity: 0.55; cursor: not-allowed; }
.select-menu-label { flex: 1; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.select-menu-chevron { width: 14px; height: 14px; flex-shrink: 0; color: var(--text-dim); transition: transform 0.18s ease; }
.select-menu-btn.open .select-menu-chevron { transform: rotate(180deg); }
.select-menu-float {
  position: fixed;
  z-index: 11000;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--card) 92%, transparent);
  backdrop-filter: blur(24px) saturate(130%);
  -webkit-backdrop-filter: blur(24px) saturate(130%);
  box-shadow: var(--shadow);
  overflow-y: auto;
}
.select-menu-option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--row-h);
  padding: 4px 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font-size: var(--text-sm);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease;
}
.select-menu-option svg { width: 14px; height: 14px; flex-shrink: 0; color: var(--accent); }
.select-menu-option:hover { background: var(--hover); }
.select-menu-option.active { background: var(--accent-soft); color: color-mix(in srgb, var(--text) 86%, var(--accent)); font-weight: 600; }
.select-menu-option-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.select-menu-empty { display: flex; align-items: center; justify-content: center; min-height: var(--row-h); padding: var(--space-3); color: var(--text-dim); font-size: var(--text-xs); text-align: center; }
@media (prefers-reduced-motion: reduce) { .select-menu-btn, .select-menu-chevron, .select-menu-option { transition: none; } }
</style>
