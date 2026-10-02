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
    tag: '公网隧道',
    scene: '适合愿意配置隧道的玩家',
    desc: '注册樱花穿透（natfrp.com）并创建隧道，用官方 frpc 把本地世界映射到公网。填写访问密钥后选择或创建隧道；可用性取决于节点、账号权限和网络。',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V9m5 11V5m5 15v-8m5 8V8"/></svg>'
  },
  {
    key: 'voxlink',
    name: 'VoxLink 联机',
    tag: '6 位房间码 · 免公网 IP',
    scene: '适合所有普通玩家的连接方式',
    desc: '创建房间，把 6 位房间码发给好友即可开始连接。直连尝试 20 秒后，可由玩家主动选择 TURN 中继；连接成功后，按页面指引在游戏内输入地址。',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="7" width="19" height="10" rx="5"/><path d="M8 12h2m4 0h2"/><circle cx="9" cy="12" r="0.8" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="0.8" fill="currentColor" stroke="none"/></svg>'
  },
  {
    key: 'terracotta',
    name: '陶瓦联机',
    tag: '独立开源 · 开箱即用',
    scene: '适合使用官方工具和房间码联机的玩家',
    desc: '独立开源联机项目（GitHub burningtnt/Terracotta，基于 EasyTier，AGPL-3.0）：手动下载官方工具并校验，创建/加入房间开箱即用，连接效果取决于双方网络。',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z"/><path d="M4 7l8 4 8-4M12 11v10"/></svg>'
  }
]

const currentCard = computed(() => methodCards.find((c) => c.key === page.value))
function pick(key: ConnectPage) {
  if (key !== 'choose') page.value = key
}
</script>

<template>
  <div data-ui="FriendConnectView:69eba3f628bf" class="page friend-connect-page" :data-design-page="page">
    <div data-ui="FriendConnectView:67caa1fbb509" class="connect-page">
      <Transition name="subpage" :duration="200">
      <div :key="page" class="connect-stage">
      <!-- 方式选择页（landing） -->
      <template v-if="page === 'choose'">
        <header data-ui="FriendConnectView:dc6bf3ba90d8" class="connection-header pick-head">
          <div data-ui="FriendConnectView:2d3d09104fce">

            <h1>选择联机方式</h1>
            <p>选择适合自己的方式，按指引与好友一起游玩。</p>
          </div>
        </header>

        <div data-ui="FriendConnectView:d9ae847bc410" class="pick-list" role="list" aria-label="联机方式列表">
          <button data-ui="FriendConnectView:52b385769542"
            v-for="card in methodCards"
            :key="card.key"
            class="pick-card"

            role="listitem"
            @click="pick(card.key)"
          >
            <span data-ui="FriendConnectView:31825c41753f" class="pick-icon" aria-hidden="true" v-html="card.icon"></span>
            <span data-ui="FriendConnectView:515ae59ff746" class="pick-copy">
              <span data-ui="FriendConnectView:5f129609c578" class="pick-name">{{ card.name }}<em data-ui="FriendConnectView:b5849fc40d88">{{ card.tag }}</em></span>
              <span data-ui="FriendConnectView:848773450d5a" class="pick-desc">{{ card.desc }}</span>
              <span data-ui="FriendConnectView:cbb6f3a39040" class="pick-scene">{{ card.scene }}</span>
            </span>
            <span data-ui="FriendConnectView:3ff11405f5c7" class="pick-go" aria-hidden="true">→</span>
          </button>
        </div>
      </template>

      <!-- 各方式独立页面（切换过渡：右滑渐入，与全局面切换同节奏） -->
      <template v-else>

          <div data-ui="FriendConnectView:23040345b003" :key="page" class="method-page">
            <header data-ui="FriendConnectView:d294772458fe" class="connection-header method-header">
              <div data-ui="FriendConnectView:0eeacbd88403" class="header-copy">

                <h1>{{ currentCard?.name ?? '联机' }}</h1>
                <p>{{ currentCard?.desc ?? '' }}</p>
              </div>
              <div data-ui="FriendConnectView:f84d848f6a7f" class="header-side">
                <button data-ui="FriendConnectView:8c7ad785d0c7" class="btn btn-ghost" @click="page = 'choose'">← 更换方式</button>
              </div>
            </header>

            <FrpPanel v-if="page === 'frp'" />
            <VoxLinkPanel v-else-if="page === 'voxlink'" />
            <TerracottaPanel v-else-if="page === 'terracotta'" />
          </div>

      </template>
      </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.friend-connect-page { max-width: 1120px; margin: 0 auto; }
.method-header { flex-wrap: nowrap; }
.header-copy { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.header-side { display: flex; align-items: center; gap: var(--space-2); flex: none; margin-left: auto; white-space: nowrap; }
@media (max-width: 560px) {
  .method-header { flex-wrap: wrap; }
  .header-copy { flex-basis: 100%; }
  .header-side { justify-content: flex-end; }
}

/* 方式选择页：三张横向大卡片，宽松排布 */
.pick-head { padding: var(--space-2) 0 var(--space-3); }
.pick-head h1 { font-size: var(--text-2xl); font-weight: 700; letter-spacing: -.5px; margin: var(--space-1) 0 var(--space-2); }
.pick-head p { color: var(--text-dim); font-size: var(--text-xs); line-height: 1.7; }
.pick-list { display: flex; flex-direction: column; gap: var(--sec-gap); }
.pick-card {
  display: flex; align-items: flex-start; gap: var(--space-5);
  padding: var(--card-pad); text-align: left; width: 100%;
  border-radius: var(--radius-lg); border: 1px solid var(--border-strong);
  background: var(--surface-content);
  backdrop-filter: blur(24px) saturate(130%); -webkit-backdrop-filter: blur(24px) saturate(130%);
  color: var(--text); cursor: pointer;
  transition: transform .18s ease, border-color .18s ease, box-shadow .22s ease;
  /* 入场：自下而上渐入 + 按序错落 */
  animation: pick-card-in var(--motion-enter) var(--ease-out) backwards;
}
.pick-card:nth-child(1) { animation-delay: 0ms; }
.pick-card:nth-child(2) { animation-delay: 60ms; }
.pick-card:nth-child(3) { animation-delay: 120ms; }
.pick-card:nth-child(4) { animation-delay: 180ms; }
@keyframes pick-card-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
.pick-card:hover { transform: none; border-color: color-mix(in srgb, var(--accent) 55%, var(--border-strong)); box-shadow: 0 14px 34px color-mix(in srgb, var(--accent) 15%, transparent); }
.pick-card:active { transform: none; }
.pick-card:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 3px; }
.pick-card.primary { border-color: color-mix(in srgb, var(--accent) 55%, var(--border-strong)); }
.pick-icon {
  width: 42px; height: 42px; flex: none; color: var(--accent); margin-top: 2px;
  display: grid; place-items: center; border-radius: var(--radius-md);
  background: var(--accent-soft); transition: transform .2s cubic-bezier(0.22, 0.9, 0.32, 1.2);
}
.pick-card:hover .pick-icon { transform: scale(1.08); }
.pick-icon :deep(svg) { width: 22px; height: 22px; }
.pick-copy { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; flex: 1; }
.pick-name { display: inline-flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); font-size: var(--text-lg); font-weight: 700; }
.pick-name em { display: inline-flex; align-items: center; font-style: normal; font-size: var(--text-xs); font-weight: 500; padding: 2px var(--space-2); border-radius: 999px; border: 1px solid var(--border-strong); color: var(--text-dim); }
.pick-desc { font-size: var(--text-xs); line-height: 1.8; color: var(--text-dim); }
.pick-scene { font-size: var(--text-xs); color: var(--accent-2); line-height: 1.7; }
/* 箭头悬浮滑入 */
.pick-go { align-self: center; flex: none; color: var(--text-dim); font-size: var(--text-lg); opacity: 0.4; transform: translateX(-4px); transition: opacity .18s ease, transform .22s cubic-bezier(0.22, 0.9, 0.32, 1.2), color .18s ease; }
.pick-card:hover .pick-go { color: var(--accent-2); opacity: 1; transform: translateX(0); }
.friend-connect-page{max-width:1200px;container-type:inline-size}.pick-list{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}.pick-card{padding:20px;animation:none;box-shadow:none}.pick-card:hover{box-shadow:none}.pick-desc{font-size:14px;line-height:1.65}.pick-name{font-size:18px}.pick-card:hover .pick-icon{transform:none}.method-header{margin-bottom:16px}.method-header p{font-size:13px;line-height:1.6;max-width:800px}.method-header h1{margin:0 0 6px}.pick-head{padding:0}.pick-head h1{font-size:24px}@container(min-width:960px){.pick-list{grid-template-columns:repeat(3,minmax(0,1fr))}.pick-card{flex-direction:column;gap:14px}.pick-go{align-self:flex-end}.pick-copy{gap:12px}.pick-name{display:grid;gap:8px}.pick-name em{justify-self:start}}
</style>
