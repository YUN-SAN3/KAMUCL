<script setup lang="ts">
import UpdateDialogShell from './UpdateDialogShell.vue'
import notices from '../../../../THIRD_PARTY_NOTICES.md?raw'
const emit = defineEmits<{ dismiss: [] }>()
const files = import.meta.glob('../../../../licenses/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
</script>

<template>
  <UpdateDialogShell label="第三方许可与声明" @dismiss="emit('dismiss')">
    <template #header><h2>第三方许可与声明</h2></template>
    <pre class="license-text">{{ notices }}</pre>
    <details v-for="(text, file) in files" :key="file">
      <summary>{{ file.split('/').at(-1) }}</summary>
      <pre class="license-text">{{ text }}</pre>
    </details>
    <template #footer><button class="btn btn-ghost" @click="emit('dismiss')">关闭</button></template>
  </UpdateDialogShell>
</template>

<style scoped>
.license-text { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 13px; user-select: text; }
summary { cursor: pointer; padding: 12px 0; }
h2 { margin: 0; }
</style>
