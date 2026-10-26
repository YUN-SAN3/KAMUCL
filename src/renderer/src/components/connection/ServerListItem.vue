<script setup lang="ts">
import type { ServerEntry, ServerPingResult } from '@shared/types'
import { privateServerText } from '@shared/serverPrivacy'
import ConnectionStatus from './ConnectionStatus.vue'
import ServerAddress from './ServerAddress.vue'
defineProps<{ server: ServerEntry; ping: ServerPingResult | null; pending: boolean; active: boolean; selectMode: boolean; checked: boolean; addressRevealed: boolean }>()
defineEmits<{ select: []; toggle: []; connect: []; favorite: []; address: [] }>()
</script>
<template>
  <div class="server-list-item" :class="{ active, checked }">
    <label v-if="selectMode" class="server-check"><input type="checkbox" :aria-label="'选择 ' + privateServerText(server.name, server, addressRevealed)" :checked="checked" @change="$emit('toggle')" /></label>
    <button class="btn btn-ghost server-favorite" :class="{ starred: server.favorite }" :aria-label="(server.favorite ? '取消收藏 ' : '收藏 ') + privateServerText(server.name, server, addressRevealed)" :aria-pressed="!!server.favorite" :title="server.favorite ? '取消收藏' : '收藏，优先显示'" @click="$emit('favorite')">{{ server.favorite ? '★' : '☆' }}</button>
    <div class="server-row-button">
      <button type="button" class="server-select-hit" :aria-label="(selectMode ? '选择 ' : '查看 ') + privateServerText(server.name, server, addressRevealed)" :aria-pressed="selectMode ? checked : active" @click="selectMode ? $emit('toggle') : $emit('select')" @dblclick="!selectMode && $emit('connect')" />
      <span class="server-monogram" aria-hidden="true">{{ privateServerText(server.name, server, addressRevealed).slice(0, 1).toUpperCase() }}</span>
      <span class="server-row-copy"><strong :title="privateServerText(server.name, server, addressRevealed)">{{ privateServerText(server.name, server, addressRevealed) }}</strong><ServerAddress :address="server.address" :revealed="addressRevealed" @toggle="$emit('address')"/><small :title="privateServerText(server.versionId || '', server, addressRevealed)">{{ privateServerText(server.minecraftVersion ? [server.minecraftVersion, server.loader, server.loaderVersion].filter(Boolean).join(' · ') : server.versionId || '尚未关联实例', server, addressRevealed) }}</small></span>
      <span class="server-row-state"><ConnectionStatus :tone="pending ? 'pending' : ping?.online ? 'success' : 'neutral'" :label="pending ? '检测中' : ping?.online ? '在线' : ping ? '未连通' : '未检测'" /><small v-if="ping?.online && !pending">{{ ping.latencyMs }} ms</small></span>
    </div>
  </div>
</template>

<style scoped>
.server-favorite { align-self:center; flex:0 0 32px; width:32px; height:32px; min-height:32px; margin-left:12px; padding:0; font-size:22px; border:0; background:transparent; box-shadow:none; }
.server-favorite:hover, .server-favorite:focus-visible { background:var(--accent-soft); color:var(--accent); }
.server-favorite:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.server-favorite.starred { color:var(--accent); }
.server-row-button{position:relative}.server-row-button > .server-monogram,.server-row-state,.server-row-copy{pointer-events:none}
.server-select-hit{position:absolute;inset:0;width:100%;border:0;border-radius:var(--radius-sm);background:transparent;cursor:pointer}
.server-select-hit:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}.server-row-copy :deep(.server-address-line){overflow:visible;white-space:normal}
</style>
