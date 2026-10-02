<script setup lang="ts">
import { store, dismissToast } from '../store'
</script>

<template>
  <TransitionGroup name="toast" tag="div" class="toasts" aria-live="polite" aria-relevant="additions text">
    <div v-for="t in store.toasts.slice(-3)" :key="t.id" class="toast" :class="`toast-${t.type}`">
      <span class="toast-dot"></span>
      <span class="toast-text">{{ t.text }}</span><button class="icon-btn toast-close" aria-label="关闭通知" @click="dismissToast(t.id)">×</button>
    </div>
  </TransitionGroup>
</template>

<style scoped>
.toasts {
  position: fixed;
  top: 76px;
  right: var(--space-5);
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  max-width: 360px;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-left-width: 3px;
  box-shadow: var(--shadow-lg);
  font-size: var(--text-sm);
  line-height: 1.5;
  user-select: text;
}

.toast-close { pointer-events:auto; width:28px; height:28px; }
.toast-text { overflow-wrap:anywhere; }
.toast-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* 成功绿边 */
.toast-success {
  border-left-color: var(--ok);
}
.toast-success .toast-dot {
  background: var(--ok);
}
/* 错误红边 */
.toast-error {
  border-left-color: var(--danger);
}
.toast-error .toast-dot {
  background: var(--danger);
}
/* 信息 accent 边 */
.toast-info {
  border-left-color: var(--accent);
}
.toast-info .toast-dot {
  background: var(--accent);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(24px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
.toast-move {
  transition: transform 0.22s ease;
}
</style>
