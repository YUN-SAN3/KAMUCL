<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue'
import ConnectionPanel from './connection/ConnectionPanel.vue'
import ConnectionStatus from './connection/ConnectionStatus.vue'
import NetworkOverview from './connection/NetworkOverview.vue'
import './connection/connection.css'
import { copyText, errText, getDirectOverview, getDirectState, getSettings, launchGame, prepareDirectJoin, resolveDirectInvitation, startDirectHost, stopDirectHost } from '../api'
import { refreshInstalled, store, toast } from '../store'
import type { DirectHostState, DirectJoinResult, DirectOverview } from '@shared/directConnect'

const VoxLinkPanel = defineAsyncComponent(() => import('./connection/VoxLinkPanel.vue'))
const TerracottaPanel = defineAsyncComponent(() => import('./connection/TerracottaPanel.vue'))
const FrpPanel = defineAsyncComponent(() => import('./connection/FrpPanel.vue'))

/** 联机方式：choose=选择弹层，direct=原有玩家直连，其余为三种接入方式 */
type ConnectMode = 'choose' | 'direct' | 'voxlink' | 'terracotta' | 'frp'
const mode = ref<ConnectMode>('choose')

const methodCards: Array<{ key: Exclude<ConnectMode, 'choose'>; name: string; tag: string; desc: string; icon: string }> = [
  {
    key: 'frp',
    name: 'FRP 内网穿透',
    tag: '樱花穿透',
    desc: '使用樱花穿透（SakuraFrp）隧道把本地世界映射到公网，任何网络环境都能稳定开局，需要 natfrp 账号的访问密钥与隧道。',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V9m5 11V5m5 15v-8m5 8V8"/></svg>'
  },
  {
    key: 'voxlink',
    name: 'VoxLink',
    tag: '6 位码 · P2P',
    desc: '完整移植 VoxLink 应用端：创建房间获得 6 位邀请码，好友输码即连。UDP 打洞、反向穿透、玩家中继全部内置，无需公网 IP。',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="7" width="19" height="10" rx="5"/><path d="M8 12h2m4 0h2"/><circle cx="9" cy="12" r="0.8" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="0.8" fill="currentColor" stroke="none"/></svg>'
  },
  {
    key: 'terracotta',
    name: '陶瓦联机',
    tag: 'Terracotta',
    desc: '接入 Terracotta 官方工具：自动下载并校验官方二进制，一键创建/加入房间，可与陶瓦联机玩家互连，显著提升极端 NAT 下的成功率。',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z"/><path d="M4 7l8 4 8-4M12 11v10"/></svg>'
  },
  {
    key: 'direct',
    name: '玩家直连',
    tag: '原有功能',
    desc: '不经过任何平台：局域网开放世界后自动探测端口与公网候选，生成 KAMUCL 邀请信息，好友粘贴即可验证连通并启动加入。',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M2 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 4 5"/></svg>'
  }
]

const currentCard = computed(() => methodCards.find((c) => c.key === mode.value))
function pick(key: ConnectMode) { mode.value = key; if (key === 'direct') void refresh() }

const overview = ref<DirectOverview | null>(null)
const state = ref<DirectHostState>({active:false,connections:0,endpoints:[],messages:[]})
const busy = ref(false), scanning = ref(false), checking = ref(false), joining = ref(false)
const error = ref(''), port = ref(''), publicAddress = ref(''), useUpnp = ref(true)
const hostTarget = ref(''), joinTarget = ref(''), invitation = ref('')
const resolved = ref<DirectJoinResult | null>(null)
const manualJoinAddress = ref('')
const instances = computed(() => overview.value?.instances.filter(item => !item.incomplete) ?? [])
const token = (item: { id:string; folder:string }) => JSON.stringify([item.folder,item.id])
const target = (value: string) => instances.value.find(item => token(item) === value)
const compatible = computed(() => instances.value.filter(item => {
  const invite = resolved.value?.invitation
  return invite && item.mcVersion === invite.minecraftVersion && (item.loader ?? '') === (invite.loader ?? '') && (!invite.loaderVersion || item.loaderVersion === invite.loaderVersion)
}))
let disposed = false
async function refresh() {
  if (scanning.value) return
  scanning.value = true; error.value = ''
  try {
    const data = await getDirectOverview()
    if (disposed) return
    overview.value = data; state.value = data.state
    if (data.detectedPort) port.value = String(data.detectedPort)
    if (!target(hostTarget.value)) hostTarget.value = token(instances.value.find(item => item.id === store.launchingVersionId) ?? instances.value[0] ?? {folder:'',id:''})
  } catch (e) { error.value = errText(e) }
  finally { scanning.value = false }
}
async function host() {
  const instance = target(hostTarget.value)
  if (!instance) { error.value = '请选择一个完整的游戏实例'; return }
  busy.value = true; error.value = ''
  try {
    state.value = await startDirectHost({versionId:instance.id,folder:instance.folder,port:port.value ? Number(port.value) : undefined,useUpnp:useUpnp.value,publicAddress:publicAddress.value})
  } catch (e) { error.value = errText(e) }
  finally { busy.value = false }
}
async function stop() {
  try { state.value = await stopDirectHost() }
  catch(e) { error.value = errText(e) }
}
async function copy(value?: string) {
  if (value) toast(await copyText(value) ? '已复制，请通过你自己的聊天工具发送给好友' : '复制失败', 'info')
}
async function check() {
  if (checking.value) return
  checking.value = true; error.value = ''; resolved.value = null; manualJoinAddress.value = ''
  try {
    resolved.value = await resolveDirectInvitation(invitation.value)
    joinTarget.value = compatible.value[0] ? token(compatible.value[0]) : ''
    if (!resolved.value.endpoint) error.value = '所有地址均不可达。请让房主检查网络映射与防火墙，或改用专门的内网穿透工具。'
  } catch(e) { error.value = errText(e) }
  finally { checking.value = false }
}
async function join() {
  const instance = target(joinTarget.value)
  if (!instance || !store.selectedAccount) { error.value = '请选择兼容实例并登录游戏账号'; return }
  joining.value = true; error.value = ''
  try {
    const prepared = await prepareDirectJoin(invitation.value, instance.id, instance.folder)
    store.settings = await getSettings(); await refreshInstalled()
    store.launchingVersionId = prepared.versionId; store.launchingFolder = prepared.folder
    if (!prepared.directJoin) manualJoinAddress.value = prepared.address
    await launchGame(prepared.versionId, prepared.directJoin ? prepared.address : undefined)
    toast(prepared.directJoin ? '已请求启动游戏并进入好友世界' : '此版本请在多人游戏中使用下方地址直接连接', 'info')
  } catch(e) { error.value = errText(e) }
  finally { joining.value = false }
}
let poll: ReturnType<typeof setInterval> | undefined
let polling = false
// 联机方式弹层 ESC 关闭（落到玩家直连面板）
function onModeKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && mode.value === 'choose') pick('direct')
}
onMounted(() => {
  window.addEventListener('keydown', onModeKeydown)
  void refresh()
  poll = setInterval(async () => {
    if (polling || busy.value || disposed) return
    polling = true
    try { const next = await getDirectState(); if (!disposed) state.value = next } catch { /* 主窗口关闭 */ }
    finally { polling = false }
  }, 3000)
})
onUnmounted(() => { disposed = true; clearInterval(poll); window.removeEventListener('keydown', onModeKeydown) })
</script>

<template>
  <div class="connect-page friend-connect">
    <!-- 联机方式选择弹层（× / 遮罩空白 / ESC 均可关闭，关闭后落到玩家直连面板） -->
    <div v-if="mode === 'choose'" class="mode-overlay" role="dialog" aria-label="选择联机方式" @click.self="pick('direct')" @keydown.esc="pick('direct')">
      <div class="mode-sheet">
        <button class="mode-close" title="关闭（Esc）" @click="pick('direct')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <header class="mode-head">
          <span class="connection-eyebrow">PLAY TOGETHER</span>
          <h2>选择联机方式</h2>
          <p>三种接入方式覆盖所有网络环境，也可以沿用原有的玩家直连。</p>
        </header>
        <div class="mode-grid">
          <button v-for="card in methodCards" :key="card.key" class="mode-card" :class="{ primary: card.key === 'frp' }" @click="pick(card.key)">
            <span class="mode-icon" aria-hidden="true" v-html="card.icon"></span>
            <span class="mode-name">{{ card.name }}<em>{{ card.tag }}</em></span>
            <span class="mode-desc">{{ card.desc }}</span>
          </button>
        </div>
      </div>
    </div>

    <template v-else>
      <header class="connection-header">
        <div>
          <span class="connection-eyebrow">PLAY TOGETHER</span>
          <h1>{{ currentCard?.name ?? '联机' }}</h1>
          <p>{{ currentCard?.desc ?? '' }}</p>
        </div>
        <div class="header-side">
          <ConnectionStatus :tone="mode === 'direct' && state.active ? 'success' : 'neutral'" :label="mode === 'direct' ? (state.active ? '房间运行中' : '准备联机') : '联机进行中'" />
          <button class="btn btn-ghost" @click="pick('choose')">← 更换方式</button>
        </div>
      </header>

      <!-- VoxLink -->
      <VoxLinkPanel v-if="mode === 'voxlink'" />
      <!-- 陶瓦联机 Terracotta -->
      <TerracottaPanel v-else-if="mode === 'terracotta'" />
      <!-- FRP 樱花穿透 -->
      <FrpPanel v-else-if="mode === 'frp'" />

      <!-- 原有玩家直连 -->
      <template v-else>
        <NetworkOverview :overview="overview" :state="state" :scanning="scanning" @refresh="refresh" />
        <aside class="connection-notice" aria-label="直连限制与安全提示">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m12 3 9 4v5c0 5-9 9-9 9s-9-4-9-9V7Z"/><path d="M12 8v5m0 3v1"/></svg>
          <div><strong>先了解网络边界，再开始联机</strong><p>CGNAT、手机热点、校园网等环境下可能无法作为公网房主，但仍可能加入他人可达的世界。若希望更稳定地联机，建议使用专业内网穿透工具。开启房间会向可达网络开放世界端口，请仅向可信好友分享邀请。</p></div>
        </aside>
        <p v-if="error" class="connection-error" role="alert">{{ error }}</p>
        <div class="connection-columns">
          <ConnectionPanel title="创建房间" subtitle="邀请好友进入你的世界" step="01">
            <p class="connection-muted">先启动游戏，在世界内选择“对局域网开放”，再填写游戏显示的端口。</p>
            <label class="connection-field">房主实例<select v-model="hostTarget" class="select" :disabled="busy || state.active"><option value="" disabled>选择实例</option><option v-for="item in instances" :key="token(item)" :value="token(item)">{{ item.id }} · {{ item.folder }}</option></select></label>
            <p v-if="overview && !instances.length" class="connection-muted">暂无完整实例。<button class="btn btn-ghost" @click="store.currentView = 'game'">前往安装实例</button></p>
            <label class="connection-field">局域网端口<input v-model="port" class="input" type="number" min="1" max="65535" placeholder="例如 54321" :disabled="busy || state.active" /><small>优先从本次启动日志识别，也可手动输入游戏内显示的端口。</small></label>
            <label class="connection-toggle"><span>UPnP 临时端口映射<small>尝试让路由器自动建立映射，不保证成功</small></span><input v-model="useUpnp" type="checkbox" :disabled="busy || state.active" /><span class="connection-toggle-track" aria-hidden="true"></span></label>
            <details class="connection-details"><summary>高级设置 · 手动 IPv4 映射</summary><div class="connection-detail-content"><label class="connection-field">公网 IPv4<input v-model="publicAddress" class="input" placeholder="可选：路由器的公网 IPv4" :disabled="busy || state.active" /></label><p>开启后按显示的开放端口配置路由器，外部和内部端口保持一致。</p></div></details>
            <p v-if="store.settings?.closeAfterLaunch" class="connection-error">已开启“启动后退出启动器”。请在设置中关闭该选项，保持启动器运行以维持直连。</p>
            <div class="connection-actions">
              <button v-if="!state.active" class="btn btn-gold" :disabled="busy || scanning || !hostTarget" @click="host">{{ busy ? '正在建立直连…' : '开启房间' }}</button>
              <button v-if="busy || state.active" class="btn btn-ghost" @click="stop">{{ busy ? '取消创建' : '关闭房间' }}</button>
            </div>
            <div v-if="state.active" class="connection-result success" aria-live="polite">
              <ConnectionStatus tone="success" :label="'房间已开启 · ' + state.connections + ' 个连接'" />
              <p>世界端口 <code>{{ state.localPort }}</code> → 开放 TCP <code>{{ state.exposedPort }}</code></p>
              <p v-for="endpoint in state.endpoints" :key="endpoint.host"><code>{{ endpoint.host.includes(':') ? `[${endpoint.host}]` : endpoint.host }}:{{ endpoint.port }}</code><br /><span class="connection-muted">{{ endpoint.kind === 'lan' ? '仅局域网' : '公网候选，需好友验证' }}</span></p>
              <button class="btn btn-gold" :disabled="!state.invite" @click="copy(state.invite)">复制邀请信息</button>
            </div>
            <div v-if="state.messages.length" class="connection-result" aria-live="polite"><p v-for="message in state.messages" :key="message" class="connection-muted">{{ message }}</p></div>
          </ConnectionPanel>
          <ConnectionPanel title="加入好友" subtitle="有邀请，就从这里出发" step="02">
            <label class="connection-field">好友的邀请信息<textarea v-model="invitation" class="input invite-input" placeholder="在这里粘贴 KAMUCL-DIRECT-1:… 邀请信息" maxlength="16384" spellcheck="false" @input="resolved = null; manualJoinAddress = ''" /><small>邀请信息包含连接地址与版本要求，请勿向陌生人转发。</small></label>
            <div class="connection-actions"><button class="btn" :class="resolved ? 'btn-ghost' : 'btn-gold'" :disabled="checking || !invitation.trim()" @click="check">{{ checking ? '正在检测地址…' : '识别并检测连接' }}</button></div>
            <div v-if="!resolved" class="join-placeholder"><span class="connection-step" aria-hidden="true">↗</span><div><h3>等待一份邀请</h3><p>粘贴后将检测可达地址，并列出本机兼容实例。</p></div></div>
            <template v-if="resolved">
              <div class="connection-result" :class="{ success: resolved.endpoint }" aria-live="polite">
                <h3>{{ resolved.invitation.name }}</h3><p class="connection-muted">Minecraft {{ resolved.invitation.minecraftVersion }} · {{ resolved.invitation.loader || '原版' }} {{ resolved.invitation.loaderVersion || '' }}</p>
                <ConnectionStatus :tone="resolved.endpoint ? 'success' : 'danger'" :label="resolved.endpoint ? '找到可达地址' : '没有可达地址'" />
                <p v-if="resolved.endpoint" class="connection-muted">TCP 连通已验证，游戏登录仍需通过服务器认证。</p>
                <details v-if="resolved.failures.length" class="connection-details"><summary>未连通的地址</summary><div class="connection-detail-content"><p v-for="message in resolved.failures" :key="message">{{ message }}</p></div></details>
              </div>
              <label class="connection-field">兼容实例<select v-model="joinTarget" class="select"><option value="" disabled>选择兼容实例</option><option v-for="item in compatible" :key="token(item)" :value="token(item)">{{ item.id }} · {{ item.folder }}</option></select></label>
              <p class="connection-muted">版本和加载器匹配不代表 MOD 完全兼容，请与房主确认模组列表相同。游戏沿用所选账号的正常认证。</p>
              <p v-if="!store.selectedAccount" class="connection-muted">加入前请先登录游戏账号。</p>
              <div class="connection-actions"><button v-if="!compatible.length" class="btn btn-ghost" @click="store.currentView = 'game'">下载或导入兼容实例</button><button class="btn btn-gold" :disabled="joining || !joinTarget || !resolved.endpoint || store.launchState?.status === 'running' || store.launchState?.status === 'launching'" @click="join">{{ joining ? '准备启动…' : '启动并加入好友' }}</button></div>
            </template>
            <div v-if="manualJoinAddress" class="connection-result"><p>请在游戏的“多人游戏 → 直接连接”中填入 <code>{{ manualJoinAddress }}</code></p><button class="btn btn-ghost" @click="copy(manualJoinAddress)">复制地址</button></div>
          </ConnectionPanel>
        </div>
      </template>
    </template>
  </div>
</template>
<style scoped>
.invite-input { min-height: 145px; resize: vertical; line-height: 1.7; }
.join-placeholder { display: flex; align-items: center; gap: 14px; padding: 22px 18px; border: 1px dashed var(--border-strong); border-radius: 12px; background: var(--card-2); }
.join-placeholder h3 { font-size: 13px; margin-bottom: 6px; }
.join-placeholder p { color: var(--text-dim); font-size: 12px; line-height: 1.7; }
.header-side { display: flex; align-items: center; gap: 10px; }

/* 联机方式选择弹层 */
.mode-overlay { position: fixed; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center; padding: 24px; background: color-mix(in srgb, var(--bg) 62%, transparent); backdrop-filter: blur(14px); }
.mode-sheet { position: relative; width: min(880px, 100%); max-height: 100%; overflow: auto; padding: 26px 26px 22px; border-radius: 18px; border: 1px solid var(--border-strong); background: var(--card); box-shadow: var(--shadow-lg); }
/* 联机方式弹层右上角关闭按钮 */
.mode-close { position: absolute; top: 14px; right: 14px; display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid var(--border); border-radius: 8px; background: var(--card-2); color: var(--text-dim); cursor: pointer; transition: color .15s ease, border-color .15s ease; z-index: 1; }
.mode-close:hover { color: var(--text); border-color: var(--accent); }
.mode-close svg { width: 14px; height: 14px; }
.mode-head h2 { font-size: 18px; margin: 4px 0 6px; }
.mode-head p { color: var(--text-dim); font-size: 12.5px; }
.mode-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
.mode-card { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 18px; text-align: left; border-radius: 14px; border: 1px solid var(--border-strong); background: var(--card-2); color: var(--text); cursor: pointer; transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease; }
.mode-card:hover { transform: translateY(-2px); border-color: var(--accent, var(--border-strong)); box-shadow: var(--shadow); }
.mode-card.primary { border-color: color-mix(in srgb, var(--accent) 55%, var(--border-strong)); }
.mode-icon { width: 30px; height: 30px; color: var(--accent, currentColor); }
.mode-icon :deep(svg) { width: 100%; height: 100%; }
.mode-name { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.mode-name em { font-style: normal; font-size: 10.5px; font-weight: 500; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--border-strong); color: var(--text-dim); }
.mode-desc { font-size: 12px; line-height: 1.65; color: var(--text-dim); }
</style>
