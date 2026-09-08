<script setup lang="ts">
/**
 * 玩家直连面板（原联机主页能力，1.0.18 还原）：创建房间 + 加入好友两栏。
 * 不依赖任何平台：公网/局域网端口映射（UPnP 或手动 IPv4 映射）+ KAMUCL 邀请信息串。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import ConnectionPanel from './ConnectionPanel.vue'
import ConnectionStatus from './ConnectionStatus.vue'
import NetworkOverview from './NetworkOverview.vue'
import './connection.css'
import { copyText, errText, getDirectOverview, getDirectState, getSettings, launchGame, prepareDirectJoin, resolveDirectInvitation, startDirectHost, stopDirectHost } from '../../api'
import { refreshInstalled, store, toast } from '../../store'
import type { DirectHostState, DirectJoinResult, DirectOverview } from '@shared/directConnect'

const overview = ref<DirectOverview | null>(null)
const state = ref<DirectHostState>({ active: false, connections: 0, endpoints: [], messages: [] })
const busy = ref(false), scanning = ref(false), checking = ref(false), joining = ref(false)
const error = ref(''), port = ref(''), publicAddress = ref(''), useUpnp = ref(true)
const hostTarget = ref(''), joinTarget = ref(''), invitation = ref('')
const resolved = ref<DirectJoinResult | null>(null)
const manualJoinAddress = ref('')
const instances = computed(() => overview.value?.instances.filter(item => !item.incomplete) ?? [])
const token = (item: { id: string; folder: string }) => JSON.stringify([item.folder, item.id])
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
    if (!target(hostTarget.value)) hostTarget.value = token(instances.value.find(item => item.id === store.launchingVersionId) ?? instances.value[0] ?? { folder: '', id: '' })
  } catch (e) { error.value = errText(e) }
  finally { scanning.value = false }
}
async function host() {
  const instance = target(hostTarget.value)
  if (!instance) { error.value = '请先选择一个要开放的游戏实例'; return }
  busy.value = true; error.value = ''
  try {
    state.value = await startDirectHost({ versionId: instance.id, folder: instance.folder, port: port.value ? Number(port.value) : undefined, useUpnp: useUpnp.value, publicAddress: publicAddress.value })
  } catch (e) { error.value = errText(e) }
  finally { busy.value = false }
}
async function stop() {
  try { state.value = await stopDirectHost() }
  catch (e) { error.value = errText(e) }
}
async function copy(value?: string) {
  if (value) toast(await copyText(value) ? '已复制，通过通讯软件或聊天工具发给好友' : '复制失败', 'info')
}
async function check() {
  if (checking.value) return
  checking.value = true; error.value = ''; resolved.value = null; manualJoinAddress.value = ''
  try {
    resolved.value = await resolveDirectInvitation(invitation.value)
    joinTarget.value = compatible.value[0] ? token(compatible.value[0]) : ''
    if (!resolved.value.endpoint) error.value = '所有地址均不可达。请对方检查端口映射与防火墙，或改用专门的联机穿透方式。'
  } catch (e) { error.value = errText(e) }
  finally { checking.value = false }
}
async function join() {
  const instance = target(joinTarget.value)
  if (!instance || !store.selectedAccount) { error.value = '请先选择兼容实例并登录游戏账户'; return }
  joining.value = true; error.value = ''
  try {
    const prepared = await prepareDirectJoin(invitation.value, instance.id, instance.folder)
    store.settings = await getSettings(); await refreshInstalled()
    store.launchingVersionId = prepared.versionId; store.launchingFolder = prepared.folder
    if (!prepared.directJoin) manualJoinAddress.value = prepared.address
    await launchGame(prepared.versionId, prepared.directJoin ? prepared.address : undefined)
    toast(prepared.directJoin ? '已请求启动游戏并进入好友世界' : '此版本请在多人游戏中使用下方地址直接连接', 'info')
  } catch (e) { error.value = errText(e) }
  finally { joining.value = false }
}
let poll: ReturnType<typeof setInterval> | undefined
let polling = false
onMounted(() => {
  void refresh()
  poll = setInterval(async () => {
    if (polling || busy.value || disposed) return
    polling = true
    try { const next = await getDirectState(); if (!disposed) state.value = next } catch { /* 窗口在关闭 */ }
    finally { polling = false }
  }, 3000)
})
onUnmounted(() => { disposed = true; clearInterval(poll) })
</script>

<template>
  <div class="direct-panel">
    <NetworkOverview :overview="overview" :state="state" :scanning="scanning" @refresh="refresh" />
    <p v-if="error" class="connection-error" role="alert">{{ error }}</p>
    <div class="connection-columns">
      <ConnectionPanel title="创建房间" subtitle="邀请好友进入你的世界" step="01">
        <p class="connection-muted">先启动游戏世界，再选择「对局域网开放」。这里填写游戏显示的端口。</p>
        <label class="connection-field">游戏实例<select v-model="hostTarget" class="select" :disabled="busy || state.active"><option value="" disabled>选择实例</option><option v-for="item in instances" :key="token(item)" :value="token(item)">{{ item.id }} · {{ item.folder }}</option></select></label>
        <p v-if="overview && !instances.length" class="connection-muted">还没有游戏实例。<button class="btn btn-ghost" @click="store.currentView = 'game'">前往安装实例</button></p>
        <label class="connection-field">开放的端口<input v-model="port" class="input" type="number" min="1" max="65535" placeholder="例如 54321" :disabled="busy || state.active" /><small>优先从本地游戏日志识别，也可手动填入游戏显示的端口。</small></label>
        <label class="connection-toggle"><span>UPnP 临时端口映射<small>支持的路由器会自动完成映射，无需验证。</small></span><input v-model="useUpnp" type="checkbox" :disabled="busy || state.active" /><span class="connection-toggle-track" aria-hidden="true"></span></label>
        <details class="connection-details"><summary>高级选项 · 手动 IPv4 映射</summary><div class="connection-detail-content"><label class="connection-field">公网 IPv4<input v-model="publicAddress" class="input" placeholder="可选：路由器配置的公网 IPv4" :disabled="busy || state.active" /></label><p>路由器显示的开放端口与路由器外部访问端口保持一致。</p></div></details>
        <p v-if="store.settings?.closeAfterLaunch" class="connection-error">已开启「启动后关闭启动器」，请先关闭该选项，否则房间无法维持直连。</p>
        <div class="connection-actions">
          <button v-if="!state.active" class="btn btn-gold" :disabled="busy || scanning || !hostTarget" @click="host">{{ busy ? '正在建立直连…' : '创建房间' }}</button>
          <button v-if="busy || state.active" class="btn btn-ghost" @click="stop">{{ busy ? '取消创建' : '关闭房间' }}</button>
        </div>
        <div v-if="state.active" class="connection-result success" aria-live="polite">
          <ConnectionStatus tone="success" :label="'房间已开启 · ' + state.connections + ' 个连接'" />
          <p>本地端口 <code>{{ state.localPort }}</code> · 公开 TCP <code>{{ state.exposedPort }}</code></p>
          <p v-for="endpoint in state.endpoints" :key="endpoint.host"><code>{{ endpoint.host.includes(':') ? `[${endpoint.host}]` : endpoint.host }}:{{ endpoint.port }}</code><br /><span class="connection-muted">{{ endpoint.kind === 'lan' ? '局域网直连' : '公网候选，需验证' }}</span></p>
          <button class="btn btn-gold" :disabled="!state.invite" @click="copy(state.invite)">复制邀请信息</button>
        </div>
        <div v-if="state.messages.length" class="connection-result" aria-live="polite"><p v-for="message in state.messages" :key="message" class="connection-muted">{{ message }}</p></div>
      </ConnectionPanel>
      <ConnectionPanel title="加入好友" subtitle="有邀请，就从这里出发" step="02">
        <label class="connection-field">好友的邀请信息<textarea v-model="invitation" class="input invite-input" placeholder="请朋友粘贴以 KAMUCL-DIRECT-1: 开头的邀请信息" maxlength="16384" spellcheck="false" @input="resolved = null; manualJoinAddress = ''" /><small>邀请信息会包含对方的地址、版本要求与可用的转发端口。</small></label>
        <div class="connection-actions"><button class="btn" :class="resolved ? 'btn-ghost' : 'btn-gold'" :disabled="checking || !invitation.trim()" @click="check">{{ checking ? '正在检查地址…' : '识别并检查地址' }}</button></div>
        <div v-if="!resolved" class="join-placeholder"><span class="connection-step" aria-hidden="true">⌁</span><div><h3>等待一份邀请</h3><p>粘贴后将检查地址、列出可兼容的实例。</p></div></div>
        <template v-if="resolved">
          <div class="connection-result" :class="{ success: resolved.endpoint }" aria-live="polite">
            <h3>{{ resolved.invitation.name }}</h3><p class="connection-muted">Minecraft {{ resolved.invitation.minecraftVersion }} · {{ resolved.invitation.loader || '原版' }} {{ resolved.invitation.loaderVersion || '' }}</p>
            <ConnectionStatus :tone="resolved.endpoint ? 'success' : 'danger'" :label="resolved.endpoint ? '找到可达地址' : '没有可达地址'" />
            <p v-if="resolved.endpoint" class="connection-muted">TCP 连通性验证通过，登录后即可加入（还需要账号验证）。</p>
            <details v-if="resolved.failures.length" class="connection-details"><summary>未连通的地址</summary><div class="connection-detail-content"><p v-for="message in resolved.failures" :key="message">{{ message }}</p></div></details>
          </div>
          <label class="connection-field">兼容实例<select v-model="joinTarget" class="select"><option value="" disabled>选择兼容实例</option><option v-for="item in compatible" :key="token(item)" :value="token(item)">{{ item.id }} · {{ item.folder }}</option></select></label>
          <p class="connection-muted">版本和加载器匹配不保证 MOD 完全一致，请和朋友确认模组列表一致（游戏内可以选择账号进行验证）。</p>
          <p v-if="!store.selectedAccount" class="connection-muted">请先前往账户页登录游戏账号。</p>
          <div class="connection-actions"><button v-if="!compatible.length" class="btn btn-ghost" @click="store.currentView = 'game'">下载或新建实例</button><button class="btn btn-gold" :disabled="joining || !joinTarget || !resolved.endpoint || store.launchState?.status === 'running' || store.launchState?.status === 'launching'" @click="join">{{ joining ? '准备加入中…' : '加入好友世界' }}</button></div>
        </template>
        <div v-if="manualJoinAddress" class="connection-result"><p>请在游戏的「多人游戏 → 直接连接」中填入 <code>{{ manualJoinAddress }}</code></p><button class="btn btn-ghost" @click="copy(manualJoinAddress)">复制地址</button></div>
      </ConnectionPanel>
    </div>
  </div>
</template>

<style scoped>
.direct-panel { display: flex; flex-direction: column; gap: var(--sec-gap); }
.invite-input { min-height: 145px; resize: vertical; line-height: 1.7; }
.join-placeholder { display: flex; align-items: center; gap: 14px; padding: 22px 18px; border: 1px dashed var(--border-strong); border-radius: 12px; background: var(--card-2); }
.join-placeholder h3 { font-size: 13px; margin-bottom: 6px; }
.join-placeholder p { color: var(--text-dim); font-size: 12px; line-height: 1.7; }
</style>
