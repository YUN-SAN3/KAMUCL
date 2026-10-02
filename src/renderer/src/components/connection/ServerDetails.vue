<script setup lang="ts">
import type { ServerEntry, ServerPingResult, InstalledVersion } from '@shared/types'
import ConnectionPanel from './ConnectionPanel.vue'
import ConnectionStatus from './ConnectionStatus.vue'
defineProps<{
  server: ServerEntry; ping: ServerPingResult | null; pending: boolean; busy: boolean; running?: boolean; binding: boolean;
  targets: InstalledVersion[]; bound: string; missing: boolean; lastUsed: string;
  targetToken: (target: InstalledVersion) => string; targetLabel: (target: InstalledVersion) => string
}>()
defineEmits<{ bind: [value: string]; connect: []; refresh: []; edit: []; remove: []; relink: []; versions: []; copy: [] }>()
</script>
<template>
  <ConnectionPanel title="连接服务器" class="server-detail">
    <template #action><button class="btn btn-ghost btn-sm" :disabled="pending" @click="$emit('refresh')">{{ pending ? '检测中…' : '刷新' }}</button><ConnectionStatus :tone="pending ? 'pending' : ping?.online ? 'success' : 'neutral'" :label="pending ? '检测中' : ping?.online ? '在线' : ping ? '未连通' : '未检测'" /></template>
    <div data-ui="ServerDetails:bcfe4bdd0062" class="server-detail-title"><span data-ui="ServerDetails:d5eb9cf8090b" class="server-monogram large" aria-hidden="true">{{ server.name.slice(0,1).toUpperCase() }}</span><div><h3 data-ui="ServerDetails:30996065a917">{{ server.name }}</h3><button class="server-address mono" :title="server.address + '（点击复制）'" @click="$emit('copy')">{{ server.address }} ⧉</button></div></div>
    <div data-ui="ServerDetails:8c10b252815e" v-if="ping?.motd && !pending" class="server-description" aria-live="polite">{{ ping.motd }}</div>
    <div data-ui="ServerDetails:9358a88a51a0" class="server-facts"><div><span>在线玩家</span><strong>{{ ping?.online && !pending ? ping.players : '—' }}</strong></div><div><span>网络延迟</span><strong>{{ ping?.online && !pending ? ping.latencyMs + ' ms' : '—' }}</strong></div></div>
    <p data-ui="ServerDetails:8faafdb2bb97" v-if="ping?.online && !pending" class="connection-muted">服务器版本：{{ ping.version }}</p>
    <label data-ui="ServerDetails:59f1e2f8c71a" class="connection-field">使用此实例连接<select data-ui="ServerDetails:0a9558147a76" class="select" :value="bound" :disabled="busy || binding" @change="$emit('bind', ($event.target as HTMLSelectElement).value)"><option value="">未关联实例 · 连接时选择</option><option v-for="v in targets" :key="targetToken(v)" :value="targetToken(v)">{{ targetLabel(v) }}{{ v.isolated ? '（隔离）' : '' }}</option></select></label>
    <div data-ui="ServerDetails:49a9cb995a70" v-if="missing" class="connection-result"><ConnectionStatus tone="danger" label="关联实例缺失" /><p>原实例可能已移动或所在磁盘不可用。</p><div data-ui="ServerDetails:5a115acf33b4" class="connection-actions"><button data-ui="ServerDetails:cc40b80410ef" class="btn btn-ghost" @click="$emit('relink')">重新关联</button><button data-ui="ServerDetails:172ad57da113" class="btn btn-ghost" @click="$emit('versions')">前往版本页</button></div></div>
    <p data-ui="ServerDetails:d3a016071ead" v-else-if="server.candidateVersionIds?.length" class="connection-muted">共享目录记录，请选择并确认具体实例。</p>
    <div data-ui="ServerDetails:1e93687b1aac" class="connection-muted"><p data-ui="ServerDetails:1399ead01b1a" v-if="server.minecraftVersion">Minecraft {{ server.minecraftVersion }}<span data-ui="ServerDetails:2f795b8f4707" v-if="server.loader"> · {{ server.loader }} {{ server.loaderVersion }}</span></p><p>{{ lastUsed }}</p></div>
    <button data-ui="ServerDetails:1081b0ad3610" class="btn btn-gold server-connect" :disabled="busy || binding" @click="$emit('connect')">{{ running ? '游戏已运行' : busy ? '正在启动…' : server.versionId && !missing ? '启动并连接' : '选择实例并连接' }}<span data-ui="ServerDetails:82645c79195b" aria-hidden="true">↗</span></button>
    <div data-ui="ServerDetails:afa5660e1f9f" class="connection-actions server-secondary"><button data-ui="ServerDetails:5d680c5d54c5" class="btn btn-ghost" :disabled="busy || binding" @click="$emit('edit')">编辑服务器</button><details class="server-more" @keydown.esc="($event.currentTarget as HTMLDetailsElement).open=false"><summary class="btn btn-ghost">更多</summary><div><button class="btn btn-danger" :disabled="busy || binding" @click="$emit('remove')">删除服务器</button></div></details></div>
    <p data-ui="ServerDetails:571a6e757999" v-if="ping && !ping.online && !pending" class="connection-muted server-footnote">状态检测失败不一定代表无法进入游戏，仍可尝试连接。</p>
  </ConnectionPanel>
</template>

<style scoped>
.server-address{background:none;border:0;color:var(--text-dim);font:inherit;font-size:13px;padding:0;text-align:left;overflow-wrap:anywhere;cursor:copy}.server-more{position:relative}.server-more summary{list-style:none}.server-more>div{position:absolute;right:0;z-index:4;background:var(--surface-solid);padding:8px;border:1px solid var(--border);border-radius:var(--radius-md)}.server-connect{min-height:44px}.server-secondary{justify-content:flex-end}.server-detail :deep(.connection-panel-head){padding:12px 20px}.server-detail-title{gap:12px}
</style>
