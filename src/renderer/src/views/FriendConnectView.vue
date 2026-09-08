<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import ConnectionStatus from '../components/connection/ConnectionStatus.vue'
import '../components/connection/connection.css'

const FrpPanel = defineAsyncComponent(() => import('../components/connection/FrpPanel.vue'))
const VoxLinkPanel = defineAsyncComponent(() => import('../components/connection/VoxLinkPanel.vue'))
const TerracottaPanel = defineAsyncComponent(() => import('../components/connection/TerracottaPanel.vue'))

/** 联机模块多页结构：landing=方式选择页，其余为各方式的独立页面 */
type ConnectPage = 'choose' | 'frp' | 'voxlink' | 'terracotta'
const page = ref<ConnectPage>('choose')

/** 三种联机方式：一句准确介绍 + 适用场景标签 */
const methodCards: Array<{ key: Exclude<ConnectPage, 'choose'>; name: string; tag: string; scene: string; desc: string; icon: string }> = [
  {
    key: 'frp',
    name: 'FRP 内网穿透',
    tag: '公网隧道 · 最稳',
    scene: '适合追求稳定、任何网络环境都要能开局',
    desc: '注册樱花穿透（natfrp.com）并创建隧道，用官方 frpc 把本地世界映射到公网。任何网络环境都能稳定开局，需要访问密钥与隧道 ID。',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V9m5 11V5m5 15v-8m5 8V8"/></svg>'
  },
  {
    key: 'voxlink',
    name: 'VoxLink 联机',
    tag: '6 位房间码 · 免公网 IP',
    scene: '适合双方网络尚可、想输个房间码就开玩',
    desc: '创建房间得到 6 位房间码，好友输码后自动进行 UDP 打洞 + STUN 的 P2P 直连，游戏数据不经服务器；打洞约 20 秒未成功可转玩家中继或直连。打通后仍需在游戏内「直接连接」填入地址。',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="7" width="19" height="10" rx="5"/><path d="M8 12h2m4 0h2"/><circle cx="9" cy="12" r="0.8" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="0.8" fill="currentColor" stroke="none"/></svg>'
  },
  {
    key: 'terracotta',
    name: '陶瓦联机',
    tag: '独立开源 · 开箱即用',
    scene: '适合不想配置任何参数、极端 NAT 环境',
    desc: '独立开源联机项目（GitHub burningtnt/Terracotta，基于 EasyTier，AGPL-3.0）：自动下载官方二进制并校验，创建/加入房间开箱即用，极端 NAT 下成功率较高。',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z"/><path d="M4 7l8 4 8-4M12 11v10"/></svg>'
  }
]

const currentCard = computed(() => methodCards.find((c) => c.key === page.value))
function pick(key: ConnectPage) {
  if (key !== 'choose') page.value = key
}
</script>

<template>
  <div class="page friend-connect-page">
    <div class="connect-page">
      <!-- 方式选择页（landing） -->
      <template v-if="page === 'choose'">
        <header class="connection-header pick-head">
          <div>
            <span class="connection-eyebrow">PLAY TOGETHER</span>
            <h1>选择联机方式</h1>
            <p>三种方式各配一处场景：追求稳定选 FRP，房间码方便选 VoxLink，开箱即用选陶瓦。</p>
          </div>
        </header>

        <div class="pick-list" role="list" aria-label="联机方式列表">
          <button
            v-for="card in methodCards"
            :key="card.key"
            class="pick-card"
            :class="{ primary: card.key === 'frp' }"
            role="listitem"
            @click="pick(card.key)"
          >
            <span class="pick-icon" aria-hidden="true" v-html="card.icon"></span>
            <span class="pick-copy">
              <span class="pick-name">{{ card.name }}<em>{{ card.tag }}</em></span>
              <span class="pick-desc">{{ card.desc }}</span>
              <span class="pick-scene">{{ card.scene }}</span>
            </span>
            <span class="pick-go" aria-hidden="true">→</span>
          </button>
        </div>
      </template>

      <!-- 各方式独立页面 -->
      <template v-else>
        <header class="connection-header">
          <div>
            <span class="connection-eyebrow">PLAY TOGETHER</span>
            <h1>{{ currentCard?.name ?? '联机' }}</h1>
            <p>{{ currentCard?.desc ?? '' }}</p>
          </div>
          <div class="header-side">
            <ConnectionStatus tone="neutral" :label="page === 'frp' ? 'FRP 隧道' : page === 'voxlink' ? 'VoxLink 房间' : '陶瓦房间'" />
            <button class="btn btn-ghost" @click="page = 'choose'">← 更换方式</button>
          </div>
        </header>

        <FrpPanel v-if="page === 'frp'" />
        <VoxLinkPanel v-else-if="page === 'voxlink'" />
        <TerracottaPanel v-else-if="page === 'terracotta'" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.friend-connect-page { max-width: 1120px; margin: 0 auto; }
.header-side { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }

/* 方式选择页：三张横向大卡片，宽松排布 */
.pick-head { padding: var(--space-2) 0 var(--space-3); }
.pick-head h1 { font-size: var(--text-2xl); font-weight: 700; letter-spacing: -.5px; margin: var(--space-1) 0 var(--space-2); }
.pick-head p { color: var(--text-dim); font-size: var(--text-xs); line-height: 1.7; }
.pick-list { display: flex; flex-direction: column; gap: var(--sec-gap); }
.pick-card {
  display: flex; align-items: flex-start; gap: var(--space-5);
  padding: var(--card-pad); text-align: left; width: 100%;
  border-radius: var(--radius-lg); border: 1px solid var(--border-strong);
  background: color-mix(in srgb, var(--card) 82%, transparent);
  backdrop-filter: blur(24px) saturate(130%); -webkit-backdrop-filter: blur(24px) saturate(130%);
  color: var(--text); cursor: pointer;
  transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease;
}
.pick-card:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--accent) 55%, var(--border-strong)); box-shadow: var(--shadow); }
.pick-card:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 3px; }
.pick-card.primary { border-color: color-mix(in srgb, var(--accent) 55%, var(--border-strong)); }
.pick-icon { width: 34px; height: 34px; flex: none; color: var(--accent); margin-top: 2px; }
.pick-icon :deep(svg) { width: 100%; height: 100%; }
.pick-copy { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; flex: 1; }
.pick-name { display: inline-flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); font-size: var(--text-lg); font-weight: 700; }
.pick-name em { display: inline-flex; align-items: center; font-style: normal; font-size: var(--text-xs); font-weight: 500; padding: 2px var(--space-2); border-radius: 999px; border: 1px solid var(--border-strong); color: var(--text-dim); }
.pick-desc { font-size: var(--text-xs); line-height: 1.8; color: var(--text-dim); }
.pick-scene { font-size: var(--text-xs); color: var(--accent-2); line-height: 1.7; }
.pick-go { align-self: center; flex: none; color: var(--text-dim); font-size: var(--text-lg); }
.pick-card:hover .pick-go { color: var(--accent-2); }
</style>
