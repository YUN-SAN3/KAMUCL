<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { store } from '../store'

const visible = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
function cancelTimer() { clearTimeout(timer); timer = undefined }
function dismiss() { cancelTimer(); visible.value = false }
watch(() => store.launchState, state => {
  cancelTimer()
  // Only a real JVM spawn event produces running; never triggered by a button click.
  // Single-direction writes only: never flip false->true within one tick, or the
  // Transition state machine wedges (enter-from/leave-active stuck, element lingers).
  if (state?.status === 'running') {
    if (!visible.value) visible.value = true
    timer = setTimeout(() => { visible.value = false; timer = undefined }, 3200)
  } else {
    visible.value = false
  }
})
onUnmounted(dismiss)
</script>

<template>
  <Teleport to="body">
    <Transition name="launch-notice">
      <div v-if="visible" class="launch-success" role="status" aria-live="polite">
        <span class="launch-success-icon" aria-hidden="true">✓</span>
        <div><strong>游戏已启动</strong><small>游戏进程已运行，窗口正在加载，请稍候</small></div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.launch-success { position: fixed; top: 100px; left: 50%; transform: translateX(-50%); z-index: 12000; display: flex; gap: var(--space-4); align-items: center; width: max-content; max-width: calc(100vw - 32px); padding: var(--space-5); border: 1px solid var(--border); border-radius: var(--radius-lg); color: var(--text); background: color-mix(in srgb, var(--bg) 94%, var(--accent)); box-shadow: var(--shadow); backdrop-filter: blur(24px) saturate(130%); -webkit-backdrop-filter: blur(24px) saturate(130%); pointer-events: none; }
.launch-success-icon { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 50%; color: var(--accent); background: var(--accent-soft); font-size: var(--text-xl); }
.launch-success strong { display: block; font-size: var(--text-lg); }
.launch-success small { display: block; margin-top: var(--space-1); color: var(--text-dim); font-size: var(--text-xs); }
.launch-notice-enter-active, .launch-notice-leave-active { transition: opacity 180ms ease, transform 180ms ease; }
.launch-notice-enter-from, .launch-notice-leave-to { opacity: 0; transform: translate(-50%, -6px); }
@media (prefers-reduced-motion: reduce) { .launch-notice-enter-active, .launch-notice-leave-active { transition: none; } }
</style>
