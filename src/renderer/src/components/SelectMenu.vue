<script setup lang="ts">
/**
 * 通用自定义下拉：替代原生 <select>（原生展开列表是 Windows 外观，与主题不符）。
 * 浮层 Teleport 到 body 避免卡片 overflow 裁切；点击外部 / Esc 关闭。
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  modelValue: string
  options: Array<{ value: string; label: string; description?: string }>
  disabled?: boolean
  placeholder?: string
  /** 浮层最大高度（超出滚动） */
  maxHeight?: number
}>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void; (e: 'change', value: string): void }>()

const open = ref(false)
const menuEl=ref<HTMLElement>(), active=ref(0)
const buttonEl = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

const currentOption = computed(() => props.options.find(o => o.value === props.modelValue))
const currentLabel = computed(() =>
  props.options.find((o) => o.value === props.modelValue)?.label ?? props.placeholder ?? '请选择'
)

function toggle() {
  if (props.disabled) return
  if (open.value) { close(); return }
  const rect = buttonEl.value?.getBoundingClientRect()
  if (rect) {
    const maxH = Math.min(props.maxHeight ?? 320,innerHeight-24)
    const below = innerHeight - rect.bottom
    const up = below < Math.min(maxH, 220) && rect.top > below
    menuStyle.value = up
      ? { left: rect.left + 'px', bottom: innerHeight - rect.top + 6 + 'px', minWidth: rect.width + 'px', maxHeight: maxH + 'px' }
      : { left: rect.left + 'px', top: rect.bottom + 6 + 'px', minWidth: rect.width + 'px', maxHeight: maxH + 'px' }
  }
  active.value = Math.max(0, props.options.findIndex(o => o.value === props.modelValue))
  open.value = true
  void nextTick(() => menuEl.value?.querySelector<HTMLElement>('[data-focused=true]')?.scrollIntoView({block:'nearest'}))
  addEventListener('pointerdown', onPointerDown, true)
  addEventListener('keydown', onKeydown, true)
}
function close() {
  open.value = false
  removeEventListener('pointerdown', onPointerDown, true)
  removeEventListener('keydown', onKeydown, true)
}
function onPointerDown(e: PointerEvent) {
  if(!menuEl.value?.contains(e.target as Node)&&!buttonEl.value?.contains(e.target as Node))close()
}
function onKeydown(e: KeyboardEvent) {
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();buttonEl.value?.focus()}
  if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();active.value=e.key==='Home'?0:e.key==='End'?props.options.length-1:Math.max(0,Math.min(props.options.length-1,active.value+(e.key==='ArrowDown'?1:-1)));void nextTick(()=>menuEl.value?.querySelector<HTMLElement>('[data-focused=true]')?.scrollIntoView({block:'nearest'}))}
  if(e.key==='Enter'&&props.options[active.value]){e.preventDefault();e.stopImmediatePropagation();choose(props.options[active.value].value)}
}
function choose(value: string) {
  emit('update:modelValue', value)
  emit('change', value)
  close()
}
onBeforeUnmount(close)
</script>

<template>
  <button data-ui="SelectMenu:cad40d2db882"
    v-bind="$attrs"
    ref="buttonEl"
    type="button"
    class="select-menu-btn"
    :class="{ open, disabled: props.disabled }"
    :disabled="props.disabled"
    :aria-expanded="open"
    :title="[currentLabel, currentOption?.description].filter(Boolean).join('\n')"
    @click="toggle"
  >
    <span data-ui="SelectMenu:bbb0a3638540" class="select-menu-label"><span>{{ currentLabel }}</span><small v-if="currentOption?.description">{{ currentOption.description }}</small></span>
    <svg class="select-menu-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
  </button>
  <Teleport to="body">
    <Transition name="popover">
    <div data-ui="SelectMenu:3ebdff14f591" v-if="open" ref="menuEl" class="select-menu-float" @wheel.stop :style="menuStyle" role="listbox">
      <button data-ui="SelectMenu:439e3aacaaa9"
        v-for="(o,i) in props.options"
        :data-focused="active===i"
        :key="o.value"
        type="button"
        class="select-menu-option"
        :class="{ active: o.value === props.modelValue }"
        role="option"
        :aria-selected="o.value === props.modelValue"
        :title="[o.label, o.description].filter(Boolean).join('\n')"
        @click="choose(o.value)"
      >
        <span data-ui="SelectMenu:cd6bf191d88f" class="select-menu-option-label"><span>{{ o.label }}</span><small v-if="o.description">{{ o.description }}</small></span>
        <svg v-if="o.value === props.modelValue" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      </button>
      <div data-ui="SelectMenu:1d0ad7174b00" v-if="!props.options.length" class="select-menu-empty">无可选项</div>
    </div>
      </Transition>
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
  transition: border-color 180ms ease, background 180ms ease, box-shadow 220ms ease;
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
  background: color-mix(in srgb, var(--card-solid, var(--card)) 96%, transparent);
  backdrop-filter: blur(24px) saturate(130%);
  -webkit-backdrop-filter: blur(24px) saturate(130%);
  box-shadow: var(--shadow);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.select-menu-option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
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
.select-menu-option:hover,.select-menu-option[data-focused=true] { background: var(--hover); }
.select-menu-option.active { background: var(--accent-soft); color: color-mix(in srgb, var(--text) 86%, var(--accent)); font-weight: 600; }
.select-menu-option-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.select-menu-empty { display: flex; align-items: center; justify-content: center; min-height: var(--row-h); padding: var(--space-3); color: var(--text-dim); font-size: var(--text-xs); text-align: center; }
@media (prefers-reduced-motion: reduce) { .select-menu-btn, .select-menu-chevron, .select-menu-option { transition: none; } }
.select-menu-label,.select-menu-option-label{display:grid;gap:3px}.select-menu-label>span,.select-menu-option-label>span,.select-menu-label small,.select-menu-option-label small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.select-menu-label small,.select-menu-option-label small{font-size:12px;color:var(--text-dim);font-weight:400}.select-menu-float{max-width:calc(100vw - 24px)}
</style>
