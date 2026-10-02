<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
defineProps<{ label: string }>()
const emit = defineEmits<{ dismiss: [] }>()
const panel = ref<HTMLElement | null>(null)
let previous: HTMLElement | null = null
function keys(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('dismiss') }
  if (event.key !== 'Tab' || !panel.value) return
  const items = Array.from(panel.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href], [tabindex="0"]')).filter(e => e.getClientRects().length)
  const first = items[0], last = items.at(-1)
  if (!first) { event.preventDefault(); panel.value.focus(); return }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last!.focus() }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.value)) { event.preventDefault(); first.focus() }
}
onMounted(async () => { previous = document.activeElement as HTMLElement | null; await nextTick(); panel.value?.focus() })
onUnmounted(() => { if (previous?.isConnected) previous.focus({ preventScroll: true }) })
</script>

<template>
  <Teleport to="body">
    <div class="update-dialog-backdrop" @click.self="emit('dismiss')" @keydown="keys">
      <section ref="panel" class="update-dialog" role="dialog" aria-modal="true" :aria-label="label" tabindex="-1">
        <header class="update-dialog-header"><slot name="header" /></header>
        <div class="update-dialog-content"><slot /></div>
        <footer class="update-dialog-footer"><slot name="footer" /></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.update-dialog-backdrop{position:fixed;inset:0;z-index:9500;display:grid;place-items:center;padding:24px;background:var(--mask,rgba(20,27,40,.48));backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);animation:mask-in var(--motion-fast) var(--ease-out);-webkit-app-region:no-drag}
.update-dialog{width:min(620px,100%);max-height:min(760px,calc(100dvh - 48px));min-height:0;display:flex;flex-direction:column;background:var(--card-solid,var(--bg,#161c24));color:var(--text);border:1px solid var(--border-strong);border-radius:20px;box-shadow:var(--shadow-lg);overflow:hidden;outline:none;animation:modal-in var(--motion-enter) var(--ease-out)}
.update-dialog-header{padding:24px 26px 18px;border-bottom:1px solid var(--border);flex-shrink:0}
.update-dialog-content{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:22px 26px;line-height:1.65;overflow-wrap:anywhere}
.update-dialog-footer{padding:18px 26px;border-top:1px solid var(--border);flex-shrink:0}
@media(max-width:600px),(max-height:600px){.update-dialog-backdrop{padding:12px}.update-dialog{max-height:calc(100dvh - 24px);border-radius:16px}.update-dialog-header,.update-dialog-content,.update-dialog-footer{padding:16px 18px}}
</style>
