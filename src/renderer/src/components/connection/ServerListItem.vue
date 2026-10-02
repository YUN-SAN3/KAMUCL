<script setup lang="ts">
import type { ServerEntry, ServerPingResult } from '@shared/types'
import ConnectionStatus from './ConnectionStatus.vue'
defineProps<{ server: ServerEntry; ping: ServerPingResult | null; pending: boolean; active: boolean; selectMode: boolean; checked: boolean }>()
defineEmits<{ select: []; toggle: []; connect: []; favorite: [] }>()
</script>
<template>
  <div class="server-list-item" :class="{ active, checked }">
    <label v-if="selectMode" class="server-check"><input type="checkbox" :aria-label="'选择 ' + server.name" :checked="checked" @change="$emit('toggle')" /></label>
    <button class="btn btn-ghost server-favorite" :class="{ starred: server.favorite }" :aria-label="(server.favorite ? '取消收藏 ' : '收藏 ') + server.name" :aria-pressed="!!server.favorite" :title="server.favorite ? '取消收藏' : '收藏，优先显示'" @click="$emit('favorite')">{{ server.favorite ? '★' : '☆' }}</button>
    <button class="server-row-button" :aria-pressed="active" @click="selectMode ? $emit('toggle') : $emit('select')" @dblclick="!selectMode && $emit('connect')">
      <span class="server-monogram" aria-hidden="true">{{ server.name.slice(0, 1).toUpperCase() }}</span>
      <span class="server-row-copy"><strong :title="server.name">{{ server.name }}</strong><span class="mono" :title="server.address">{{ server.address }}</span><small :title="server.versionId">{{ server.minecraftVersion ? [server.minecraftVersion, server.loader, server.loaderVersion].filter(Boolean).join(' · ') : server.versionId || '尚未关联实例' }}</small></span>
      <span class="server-row-state"><ConnectionStatus :tone="pending ? 'pending' : ping?.online ? 'success' : 'neutral'" :label="pending ? '检测中' : ping?.online ? '在线' : ping ? '未连通' : '未检测'" /><small v-if="ping?.online && !pending">{{ ping.latencyMs }} ms</small></span>
    </button>
  </div>
</template>

<style scoped>
.server-favorite { align-self:center; flex:0 0 32px; width:32px; height:32px; min-height:32px; margin-left:12px; padding:0; font-size:22px; border:0; background:transparent; box-shadow:none; }
.server-favorite:hover, .server-favorite:focus-visible { background:var(--accent-soft); color:var(--accent); }
.server-favorite:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.server-favorite.starred { color:var(--accent); }
</style>
