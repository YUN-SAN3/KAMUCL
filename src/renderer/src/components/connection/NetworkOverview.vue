<script setup lang="ts">
import { computed } from 'vue'
import type { DirectOverview, DirectHostState } from '@shared/directConnect'
import ConnectionStatus from './ConnectionStatus.vue'
const props = defineProps<{ overview: DirectOverview | null; state: DirectHostState; scanning: boolean }>()
defineEmits<{ refresh: [] }>()
const publicCount = computed(() => props.overview?.network.addresses.filter(a => a.kind !== 'lan').length ?? 0)
</script>
<template>
  <section class="network-overview" aria-label="网络状态">
    <div class="network-summary">
      <span class="connection-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0m-9 4a4 4 0 0 1 6 0"/><circle cx="12" cy="20" r="1"/></svg></span>
      <div><span class="connection-eyebrow">NETWORK / 本机网络</span><h2>{{ scanning ? '正在了解你的网络…' : overview ? '网络检测完成' : '等待网络检测' }}</h2><p>公网地址仅为候选，实际连通性需由好友验证。</p></div>
      <button class="btn btn-ghost" :disabled="scanning" @click="$emit('refresh')">{{ scanning ? '检测中…' : '重新检测' }}</button>
    </div>
    <div class="network-metrics" aria-live="polite">
      <div><span>房间状态</span><ConnectionStatus :tone="state.active ? 'success' : 'neutral'" :label="state.active ? '房间已开放' : '尚未创建'" /></div>
      <div><span>公网候选</span><strong>{{ overview ? publicCount + ' 个地址' : '—' }}</strong></div>
      <div><span>世界端口</span><strong>{{ state.localPort || overview?.detectedPort || '等待局域网开放' }}</strong></div>
      <div><span>当前连接</span><strong>{{ state.connections }}<small> 个连接</small></strong></div>
    </div>
    <details v-if="overview" class="connection-details network-details"><summary>查看网络诊断与地址</summary>
      <div class="connection-detail-content">
        <p v-if="!overview.network.addresses.length">未发现可用地址，请检查网络连接后重新检测。</p>
        <p v-for="item in overview.network.addresses" :key="item.name + item.address"><span>{{ item.kind === 'ipv6' ? '公网 IPv6 候选' : item.kind === 'ipv4' ? '公网 IPv4 候选' : '局域网 IPv4' }} · {{ item.name }}</span><code>{{ item.address }}</code></p>
        <p v-for="item in overview.network.gateways" :key="item.address">网关 {{ item.address }} · WAN {{ item.externalAddress }}：{{ item.diagnosis }}</p>
        <p v-for="message in overview.network.messages" :key="message">{{ message }}</p>
      </div>
    </details>
  </section>
</template>
