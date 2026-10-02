<script setup lang="ts">
defineProps<{ links: { label: string; url: string }[] }>()
</script>
<template>
  <nav class="reference-links" aria-label="相关链接" data-ui="connection:reference-links">
    <a v-for="link in links" :key="link.url" :href="link.url" target="_blank" rel="noopener noreferrer" :title="link.url">
      {{ link.label }}<span aria-hidden="true">↗</span>
    </a>
    <slot />
  </nav>
</template>
<style scoped>
.reference-links { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
.reference-links a,.reference-links :deep(button) { display:inline-flex; align-items:center; justify-content:center; gap:10px; min-height:36px; padding:7px 13px; border:1px solid var(--border-strong); border-radius:10px; background:var(--card-2); color:var(--text); font:inherit; font-size:13px; font-weight:500; line-height:20px; text-decoration:none; cursor:pointer; transition:background .18s,border-color .18s; }
.reference-links a span { color:var(--text-dim); }
.reference-links a:hover,.reference-links :deep(button:hover) { background:color-mix(in srgb,var(--accent) 14%,var(--card-2)); border-color:var(--accent); }
.reference-links a:focus-visible,.reference-links :deep(button:focus-visible) { outline:2px solid var(--accent); outline-offset:3px; }
</style>
