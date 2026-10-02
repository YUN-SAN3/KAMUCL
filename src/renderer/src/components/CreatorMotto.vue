<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { useMotion } from '../motion'
const { decorativeActive } = useMotion()
watch(decorativeActive, reset)
const props = defineProps<{ disabled?: boolean }>()
const sentence = '尝试打造一个方便UP主高频使用的启动器'
const host = ref<HTMLElement>()
let slots: HTMLElement[] = [], glyphs: HTMLElement[] = []
let centers: Array<{ x: number; y: number }> = []
let frame = 0, pointer: { x: number; y: number } | undefined
let observer: ResizeObserver | undefined
let reduced: MediaQueryList | undefined

function measure() {
  centers = slots.map(slot => { const r = slot.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
}
function reset() {
  cancelAnimationFrame(frame); frame = 0; pointer = undefined
  for (const glyph of glyphs) glyph.style.transform = ''
}
function move(event: PointerEvent) {
  if (props.disabled || !decorativeActive.value || reduced?.matches || event.pointerType === 'touch') return
  pointer = { x: event.clientX, y: event.clientY }
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    if (!pointer) return
    glyphs.forEach((glyph, i) => {
      const c = centers[i]; if (!c) return
      const dx = c.x - pointer!.x, dy = c.y - pointer!.y, distance = Math.hypot(dx, dy)
      const force = Math.max(0, 1 - distance / 54) ** 2 * 18
      const x = distance > 0.1 ? dx / distance * force : 0
      const y = distance > 0.1 ? dy / distance * force : -force
      glyph.style.transform = force ? `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${(x / 7).toFixed(2)}deg)` : ''
    })
  })
}
function maximize() { if (!props.disabled) window.kamucl.send('window:maximize') }
watch(() => props.disabled, reset)
onMounted(() => {
  slots = [...host.value!.querySelectorAll<HTMLElement>('.motto-slot')]
  glyphs = [...host.value!.querySelectorAll<HTMLElement>('.motto-glyph')]
  reduced = matchMedia('(prefers-reduced-motion: reduce)'); reduced.addEventListener('change', reset)
  observer = new ResizeObserver(() => { reset(); measure() }); observer.observe(host.value!)
  document.addEventListener('visibilitychange', reset)
  measure()
})
onUnmounted(() => { reset(); observer?.disconnect(); reduced?.removeEventListener('change', reset); document.removeEventListener('visibilitychange', reset) })
</script>

<template>
  <div ref="host" class="creator-motto" data-ui="topbar:creator-motto">
    <span class="sr-only">{{ sentence }}</span>
    <span class="motto-line" aria-hidden="true" @pointerenter="measure" @pointermove="move" @pointerleave="reset" @pointercancel="reset" @dblclick="maximize">
      <span v-for="(letter, index) in sentence" :key="index" class="motto-slot"><span class="motto-glyph" :class="{ accent: letter === 'U' || letter === 'P' }">{{ letter }}</span></span>
    </span>
  </div>
</template>

<style scoped>
.creator-motto { min-width:0; width:100%; height:100%; display:flex; align-items:center; justify-content:center; container-type:inline-size; }
.motto-line { display:inline-flex; align-items:center; justify-content:center; white-space:nowrap; padding:15px 3px; -webkit-app-region:no-drag; user-select:none; font-family:'Segoe UI Variable Text','Microsoft YaHei',sans-serif; font-size:clamp(9px,2.8cqw,12px); font-weight:500; letter-spacing:.055em; color:var(--text-dim); line-height:1.5; }
.motto-slot { display:inline-block; }
.motto-glyph { display:inline-block; transition:transform 360ms cubic-bezier(.2,.9,.25,1.3),color 180ms ease; }
.motto-line:hover .motto-glyph { color:var(--text); }
.motto-glyph.accent { color:var(--accent-2,var(--accent)); font-weight:650; }
.sr-only { position:absolute; width:1px; height:1px; padding:0; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
@media(prefers-reduced-motion:reduce) { .motto-glyph { transform:none !important; transition:none; } }
</style>
