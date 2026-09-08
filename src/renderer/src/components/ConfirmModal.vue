<script setup lang="ts">
/** 通用二次确认模态框（删除等危险操作） */
defineProps<{
  open: boolean
  title: string
  message: string
  confirmText?: string
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-mask" @pointerdown.self="emit('cancel')">
      <div class="modal">
        <h3 class="modal-title">{{ title }}</h3>
        <p class="confirm-text">{{ message }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="emit('cancel')">取消</button>
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
</style>
