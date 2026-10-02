<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
withDefaults(defineProps<{ label?: string; rows?: number; retry?: boolean }>(), { label: '正在加载…', rows: 5, retry: false })
defineEmits<{ retry: [] }>()
const delayed = ref(false)
let timer: ReturnType<typeof setTimeout>
onMounted(() => { timer = setTimeout(() => { delayed.value = true }, 8000) })
onUnmounted(() => clearTimeout(timer))
</script>
<template>
  <div class="content-skeleton" role="status" aria-busy="true">
    <span class="muted">{{ label }}</span>
    <p v-if="delayed" class="muted">数据仍未返回，请检查网络或目录是否可用。<button v-if="retry" class="btn btn-ghost btn-sm" @click="$emit('retry')">重新读取</button></p>
    <div v-for="row in rows" :key="row" class="skeleton-row" aria-hidden="true"><i/><span/><b/></div>
  </div>
</template>
<style scoped>
.content-skeleton { display:grid; gap:12px; padding:16px 0; }
.skeleton-row { display:flex; align-items:center; gap:16px; height:48px; }
.skeleton-row i,.skeleton-row span,.skeleton-row b { background:color-mix(in srgb,var(--text) 9%,var(--card)); border-radius:var(--radius-sm); }
.skeleton-row i { width:36px; height:36px; }
.skeleton-row span { flex:1; height:18px; max-width:65%; }
.skeleton-row b { margin-left:auto; width:76px; height:32px; }
</style>
