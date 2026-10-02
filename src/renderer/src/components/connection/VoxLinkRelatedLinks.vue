<script setup lang="ts">
import { ref } from 'vue'
import { VOXLINK_LINKS } from '@shared/voxlinkLinks'
import UpdateDialogShell from '../UpdateDialogShell.vue'
const open = ref(false)
</script>
<template>
  <div data-ui="voxlink:related-links">
    <button class="btn btn-ghost" @click="open = true">相关链接 ↗</button>
    <UpdateDialogShell v-if="open" label="VoxLink 相关链接" @dismiss="open = false">
      <template #header><h2>VoxLink · 相关链接</h2><p class="muted">项目主页、下载与社区</p></template>
      <nav class="links-list" aria-label="VoxLink 相关链接清单">
        <a v-for="link in VOXLINK_LINKS" :key="link.label" :href="link.url" target="_blank" rel="noopener noreferrer"><strong>{{ link.label }} <span aria-hidden="true">↗</span></strong><small>{{ link.url }}</small></a>
      </nav>
      <template #footer><button class="btn btn-gold" @click="open = false">关闭</button></template>
    </UpdateDialogShell>
  </div>
</template>
<style scoped>
.links-list{display:grid;gap:10px}.links-list a{display:grid;gap:5px;padding:14px 16px;border-radius:12px;background:var(--card-2);color:var(--text);text-decoration:none;transition:background .18s}.links-list a:hover{background:color-mix(in srgb,var(--accent) 15%,var(--card-2))}.links-list strong{display:flex;justify-content:space-between}.links-list small{color:var(--text-dim);overflow-wrap:anywhere;font-size:12px}
</style>
