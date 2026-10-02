<script setup lang="ts">
/** 通用二次确认模态框（删除等危险操作） */
defineProps<{
  open: boolean
  title: string
  message: string
  confirmText?: string
  busy?: boolean
  error?: string
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-mask" @pointerdown.self="!busy && emit('cancel')">
      <div class="modal">
        <h3 class="modal-title">{{ title }}</h3>
        <p class="confirm-text">{{ message }}</p>
        <p v-if="error" class="confirm-error" role="alert">{{ error }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" :disabled="busy" @click="emit('cancel')">取消</button>
          <button class="btn btn-danger" :disabled="busy" @click="emit('confirm')">
            {{ busy ? '处理中…' : (confirmText ?? '确认删除') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-text {
  font-size: var(--text-md);
  line-height: 1.7;
  word-break: break-all;
}
.confirm-error { color:var(--danger);font-size:var(--text-sm);line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0; }
</style>
