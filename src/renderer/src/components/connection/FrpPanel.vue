<script setup lang="ts">
import ReferenceLinks from './ReferenceLinks.vue'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import ConnectionPanel from './ConnectionPanel.vue'
import ConfirmModal from '../ConfirmModal.vue'
import ConnectionStatus from './ConnectionStatus.vue'
import { copyText } from '../../api'
import { toast } from '../../store'
import type { ManagedTunnel } from '../../../../main/core/frpManager'
import type { FrpNodesResult } from '../../../../main/core/frpNodes'

const kamucl = window.kamucl
const tunnels = ref<ManagedTunnel[]>([])
const form = reactive({ accessKey: '' })
const operations = reactive(new Set<string>())
const stopping = reactive(new Set<string>())
const errorMsg = ref('')
const editingAccount=ref(false), createOpen=ref(false)
const accountReady=computed(()=>!!nodesResult.value && !nodesError.value)
const deleteTarget = ref<ManagedTunnel | null>(null)
const deleting = ref(false)
const deleteError = ref('')
function askDelete(t: ManagedTunnel) { if (t.deleting) return; deleteError.value = ''; deleteTarget.value = t }
function cancelDelete() { if (!deleting.value) deleteTarget.value = null }
async function confirmDelete() {
  const target = deleteTarget.value
  if (!target || deleting.value) return
  deleting.value = true; deleteError.value = ''
  try {
    const result = await kamucl.invoke('frp:delete-tunnel', { id: target.id, confirmed: true }) as { remoteDisconnectPending: boolean }
    tunnels.value = tunnels.value.filter(t => t.id !== target.id)
    nodesResult.value = null; deleteTarget.value = null
    toast(result.remoteDisconnectPending ? '远端隧道已删除，本地连接已停止；其他设备连接可能尚未断开' : `已从樱花穿透删除「${target.name}」`, result.remoteDisconnectPending ? 'info' : 'success')
  } catch(e) { deleteError.value = errText(e); toast(deleteError.value, 'error') }
  finally { deleting.value = false; await refreshStatus() }
}
const nodesResult = ref<FrpNodesResult | null>(null)
const nodesLoading = ref(false)
const nodesError = ref('')
const onlyFree = ref(true)
const creation = reactive({ name: 'Minecraft', node: '', localPort: '', remotePort: '' })
const creating = ref(false)
const visibleNodes = computed(() => onlyFree.value ? (nodesResult.value?.nodes || []).filter(n => n.free) : nodesResult.value?.nodes || [])
const creatableNodes = computed(() => visibleNodes.value.filter(n => n.online && n.canCreate))
const connected = computed(() => tunnels.value.filter(t => t.status === 'running').length)
const restoring = computed(() => tunnels.value.filter(t => t.desired).length)
const busy = computed(() => creating.value || nodesLoading.value)
let disposed = false
const statusLabel: Record<string, string> = { idle: '未启动', starting: '正在连接', running: '已连接', auth_failed: '认证失败', tunnel_offline: '隧道不可用', error: '连接失败', stopped: '已停止' }
const active = (t: ManagedTunnel) => t.status === 'running' || t.status === 'starting'
const tone = (t: ManagedTunnel): 'neutral' | 'success' | 'danger' | 'pending' => t.busy ? 'pending' : t.status === 'running' ? 'success' : t.status === 'starting' ? 'pending' : ['auth_failed', 'tunnel_offline', 'error'].includes(t.status) ? 'danger' : 'neutral'
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
watch(() => form.accessKey, () => { nodesResult.value = null })
async function refreshStatus() {
  try {
    const result = await kamucl.invoke('frp:status') as { accessKey: string; tunnels: ManagedTunnel[] }
    if (disposed) return
    tunnels.value = result.tunnels || []
    if (!form.accessKey && result.accessKey) form.accessKey = result.accessKey
  } catch(e) { errorMsg.value = errText(e) }
}
async function control(t: ManagedTunnel, stop: boolean) {
  if (t.deleting || (stop ? stopping.has(t.id) : operations.has(t.id))) return
  if (stop) stopping.add(t.id)
  operations.add(t.id); errorMsg.value = ''
  try {
    await kamucl.invoke(stop ? 'frp:stop' : 'frp:start', { id: t.id })
    if (stop) toast(`已停止「${t.name}」，下次启动不会自动恢复`, 'success')
  } catch(e) { errorMsg.value = errText(e); toast(errorMsg.value, 'error') }
  finally { operations.delete(t.id); stopping.delete(t.id); await refreshStatus() }
}
async function loadNodes(refresh = false, notify = true): Promise<boolean> {
  if (nodesLoading.value) return false
  nodesLoading.value = true; nodesError.value = ''
  try {
    const result = await kamucl.invoke('frp:nodes', { accessKey: form.accessKey.trim(), refresh }) as FrpNodesResult
    if (!Array.isArray(result?.nodes)) throw new Error('节点列表查询失败，请重试')
    if (!Array.isArray(result.tunnels)) throw new Error('隧道列表查询失败，请检查密钥权限后重试')
    if (disposed) return false
    nodesResult.value = result; editingAccount.value=false; await refreshStatus()
    if (notify) toast(`已读取成功：${result.tunnels.length} 条隧道，${result.nodes.length} 个节点`, 'success')
    return true
  } catch(e) { if (!disposed) { nodesError.value = errText(e); toast(`读取失败：${nodesError.value}`, 'error') }; return false }
  finally { nodesLoading.value = false }
}
async function createTunnel() {
  if (creating.value) return
  creating.value = true; errorMsg.value = ''
  try {
    await kamucl.invoke('frp:create-tunnel', { accessKey: form.accessKey.trim(), tunnel: { name: creation.name, node: Number(creation.node), localPort: Number(creation.localPort), remotePort: Number(creation.remotePort) || undefined } })
    const loaded = await loadNodes(true, false)
    toast(loaded ? '隧道已创建，可在隧道卡片中启动' : '隧道已创建，请刷新列表后查看', loaded ? 'success' : 'info')
  } catch(e) { errorMsg.value = errText(e); toast(errorMsg.value, 'error') }
  finally { creating.value = false }
}
async function copyWebsite() { toast(await copyText('https://www.natfrp.com/') ? '已复制樱花穿透网址' : '复制失败', 'info') }
async function copyRemote(address: string) { toast(await copyText(address) ? '已复制远程地址' : '复制失败', 'info') }
function onReferenceToggle(event: Event) { if ((event.target as HTMLDetailsElement).open && !nodesResult.value && !nodesLoading.value && form.accessKey.trim()) void loadNodes() }
let unsubscribe: (() => void) | undefined
onMounted(async () => {
  unsubscribe = kamucl.on('frp:event', (raw: unknown) => {
    const t = (raw as { tunnel?: ManagedTunnel })?.tunnel
    if (!t || disposed) return
    const index = tunnels.value.findIndex(x => x.id === t.id)
    if (index >= 0) tunnels.value[index] = t
    else tunnels.value.push(t)
  })
  await refreshStatus()
})
onBeforeUnmount(() => { disposed = true; unsubscribe?.() })
</script>

<template>
  <div data-ui="FrpPanel:ab59a69f21ab" class="frp-page">
    <ConfirmModal :open="!!deleteTarget" title="删除樱花隧道" :message="deleteTarget ? `确认删除「${deleteTarget.name}」（#${deleteTarget.config?.tunnelId}）？这会从樱花穿透账号中永久删除该隧道，停止本地连接并取消自动恢复，无法撤销。其他隧道不受影响。${deleteError ? '\n' + deleteError : ''}` : ''" confirm-text="从樱花穿透删除" :busy="deleting" @confirm="confirmDelete" @cancel="cancelDelete" />
    <section class="frp-overview" data-ui="frp:overview">
      <div><h2>我的隧道</h2><p>每条隧道独立连接，随时启停。</p></div>
      <div data-ui="FrpPanel:e70e34f9b8cf" class="frp-metrics"><span><b>{{ connected }}</b> 已连接</span><span><b>{{ restoring }}</b> 下次恢复</span><button data-ui="FrpPanel:00eb1ec1c260" class="btn btn-ghost" @click="refreshStatus">刷新状态</button><button class="btn btn-gold" @click="createOpen=!createOpen">{{createOpen?'收起新建':'新建隧道'}}</button></div>
    </section>
    <details class="frp-restore-note"><summary>自动恢复与连接说明</summary><p>关闭启动器时，会记住未手动停止的隧道，下次打开自动恢复。点击某条隧道的“停止”只影响该隧道。好友可在游戏的“直接连接”中填入远程地址。</p></details>
    <p data-ui="FrpPanel:54b1d9fe0e6e" v-if="errorMsg" class="connection-error" role="alert">{{ errorMsg }}</p>
    <div v-if="accountReady && !editingAccount" class="frp-account-summary"><span>已读取 {{ tunnels.length }} 条隧道 · 密钥保存在本机</span><button data-ui="FrpPanel:57467d5ded4a" class="btn btn-ghost btn-sm" @click="editingAccount=true">编辑密钥</button><button class="btn btn-ghost btn-sm" :disabled="nodesLoading" @click="loadNodes(true)">重新读取</button></div>
    <ConnectionPanel v-else title="樱花穿透账号" subtitle="填写访问密钥，读取账号中的隧道与节点。已连接的隧道不会被其他隧道的操作打断。">
      <div data-ui="FrpPanel:08816fe7bdc1" class="frp-account-row"><label class="connection-field"><span>访问密钥</span><input data-ui="FrpPanel:a4d20e81e801" v-model="form.accessKey" class="input" type="password" autocomplete="off" placeholder="粘贴用户信息页的访问密钥" :disabled="busy" /></label><button data-ui="FrpPanel:595aea894985" class="btn btn-gold" :disabled="busy || !form.accessKey.trim()" @click="loadNodes(true)">{{ nodesLoading ? '正在读取…' : '读取我的隧道与节点' }}</button></div>
      <div data-ui="FrpPanel:b0c9c097bfa7" class="frp-account-help">
        <ReferenceLinks :links="[{ label: '樱花穿透官网', url: 'https://www.natfrp.com/' }, { label: '使用指南', url: 'https://doc.natfrp.com/' }]">
          <button data-ui="FrpPanel:a705e51a826a" type="button" @click="copyWebsite">复制官网地址</button>
        </ReferenceLinks>
        <small>访问密钥仅保存在本机</small>
      </div>
      <p v-if="nodesError" class="connection-error" role="alert">{{ nodesError }}</p>
    </ConnectionPanel>
    <details data-ui="FrpPanel:09a75850bc84" class="frp-create-details" :open="createOpen" @toggle="createOpen=($event.target as HTMLDetailsElement).open"><summary>＋ 创建新隧道</summary>

    <ConnectionPanel title="创建新隧道" subtitle="选择服务节点，再填入游戏局域网端口。创建成功后显示独立卡片，不会自动运行。">
      <div data-ui="FrpPanel:fc691b543124" class="frp-create-grid"><label class="connection-field"><span>隧道名称</span><input data-ui="FrpPanel:b7caefdb0a45" v-model="creation.name" class="input" maxlength="64" placeholder="例如：好友生存世界" /></label><label class="connection-field"><span>服务节点</span><select data-ui="FrpPanel:e06c3d520528" v-model="creation.node" class="input"><option value="">{{ nodesResult ? '选择可用节点' : '请先读取节点' }}</option><option v-for="n in creatableNodes" :key="n.id" :value="String(n.id)">{{ n.name }} · {{ n.free ? '免费' : '专业版' }}{{ n.load !== null ? ' · ' + n.load + '%' : '' }}</option></select></label><label class="connection-field"><span>本地端口</span><input data-ui="FrpPanel:9ca5880a3b61" v-model="creation.localPort" class="input" type="number" min="1" max="65535" placeholder="游戏对局域网开放后显示的端口" /></label><label class="connection-field"><span>远程端口（可选）</span><input data-ui="FrpPanel:0ce18bb53250" v-model="creation.remotePort" class="input" type="number" min="1" max="65535" placeholder="留空由樱花穿透分配" /></label></div>
      <label data-ui="FrpPanel:0ae18a9aca64" class="frp-free"><input v-model="onlyFree" type="checkbox" />仅显示免费节点</label>
      <button data-ui="FrpPanel:1769901eab4f" class="btn btn-gold" :disabled="creating || !form.accessKey.trim() || !creation.node || !creation.localPort" @click="createTunnel">{{ creating ? '正在创建…' : '创建 TCP 隧道' }}</button>
    </ConnectionPanel>

    </details>
    <section class="frp-tunnel-grid" aria-label="隧道控制区域" data-ui="frp:tunnels">
      <article v-for="t in tunnels" :key="t.id" class="frp-tunnel-card" :class="{ connected: t.status === 'running' }" :data-ui="'frp:tunnel:' + t.id">
        <header data-ui="FrpPanel:c5911bc51b7c"><div><h3>{{ t.name }}</h3><p>{{ t.nodeName || '节点信息待读取' }} · #{{ t.config?.tunnelId }}</p></div><ConnectionStatus :tone="tone(t)" :label="t.deleting ? '正在删除' : t.busy ? '正在准备' : statusLabel[t.status]" /></header>
        <div data-ui="FrpPanel:e157d6943eab" class="frp-endpoints"><div><span>本地服务</span><strong>{{ t.localIp }}:{{ t.config?.localPort || '未配置' }}</strong></div><div><span>远程地址</span><strong>{{ t.remoteAddress || (t.status === 'running' ? '等待服务返回地址' : '连接后显示') }}</strong><button v-if="t.remoteAddress" class="btn btn-ghost btn-sm" @click="copyRemote(t.remoteAddress)">复制地址</button></div></div>
        <p data-ui="FrpPanel:95340b6c69f4" v-if="t.busy || tone(t) === 'danger'" class="frp-tunnel-message" :class="{ danger: tone(t) === 'danger' }">{{ t.busy ? '正在检查隧道并准备连接…' : t.message }}</p>
        <footer data-ui="FrpPanel:10ce12df3ad2"><small>{{ t.desired ? '下次打开启动器将自动恢复' : '已停止自动恢复' }}</small><div data-ui="FrpPanel:3acd6476d7b7" class="frp-card-actions"><button data-ui="FrpPanel:d8c4790e0c8e" v-if="!active(t) && !t.busy" class="btn btn-gold" :disabled="t.deleting || operations.has(t.id)" @click="control(t, false)">{{ tone(t) === 'danger' ? '重试连接' : '启动隧道' }}</button><button data-ui="FrpPanel:1cbfb09e7f09" v-if="active(t) || t.desired || t.busy" class="btn btn-ghost" :disabled="t.deleting || stopping.has(t.id)" @click="control(t, true)">{{ t.busy ? '取消启动' : '停止隧道' }}</button><details class="frp-more" @keydown.esc="($event.currentTarget as HTMLDetailsElement).open=false"><summary class="btn btn-ghost btn-sm" :aria-label="'更多操作 '+t.name">⋯</summary><div><button data-ui="FrpPanel:05be50a5135c" class="btn btn-danger btn-sm" :disabled="t.deleting" @click="askDelete(t)">删除隧道</button></div></details></div></footer>
        <details data-ui="FrpPanel:817cbf8159bb" class="frp-card-logs"><summary>运行日志 · {{ t.logs.length }} 条</summary><div data-ui="FrpPanel:3156be53d1a0" class="connection-log-viewport"><p data-ui="FrpPanel:6f7846e870fd" v-if="!t.logs.length" class="connection-muted">尚无日志</p><p data-ui="FrpPanel:ff75ffc93400" v-for="(entry, i) in t.logs" :key="i" class="mono connection-log-line">[{{ entry.stream }}] {{ entry.text }}</p></div></details>
      </article>
      <div data-ui="FrpPanel:dd7f31ce9863" v-if="!tunnels.length" class="frp-empty"><h3>还没有读取隧道</h3><p>读取账号后，每条隧道会在这里拥有独立的控制卡片。没有隧道时，可在下方创建。</p></div>
    </section>
    <!-- 参考信息区：节点参考（默认折叠，点开才展开/查询） -->
    <section data-ui="FrpPanel:2e6691d7697c" class="connection-panel">
      <header data-ui="FrpPanel:c82fb938cb1d" class="connection-panel-head">
        <div>
          <h2>节点参考</h2>
          <p>查看各节点的状态与说明，在上方选择可用节点创建隧道。专业版节点需要对应账号权限。</p>
        </div>
      </header>
      <div data-ui="FrpPanel:6b23ee6b6224" class="connection-panel-body">
        <details data-ui="FrpPanel:5207f7c466f0" class="reference-details" @toggle="onReferenceToggle">
          <summary>展开节点列表{{ nodesResult ? `（共 ${nodesResult.nodes.length} 个节点）` : '（默认收起）' }}</summary>
          <div data-ui="FrpPanel:4f372443ab5b" class="reference-body">
            <div data-ui="FrpPanel:6b412b921017" class="node-toolbar">
              <label data-ui="FrpPanel:c99a7ef6ce06" class="connection-toggle node-toggle"><span>只看免费节点<small>专业版（VIP）节点需要 natfrp 专业版账号</small></span><input v-model="onlyFree" type="checkbox" /><span data-ui="FrpPanel:a8ec6884149b" class="connection-toggle-track" aria-hidden="true"></span></label>
              <button data-ui="FrpPanel:8d48bc817d33" class="btn btn-ghost" :disabled="nodesLoading || !form.accessKey.trim()" @click="loadNodes(true)">{{ nodesLoading ? '查询中…' : nodesResult ? '刷新节点' : '查询节点' }}</button>
            </div>

            <p v-if="nodesError" class="connection-error" role="alert">{{ nodesError }}</p>

            <!-- 我的隧道：节点列表上方的单独小卡 -->
            <div data-ui="FrpPanel:f18f927656e2" v-if="nodesResult?.tunnels?.length" class="connection-result tunnels-card">
              <h3>我的隧道（natfrp 账号内）</h3>
              <p data-ui="FrpPanel:7dca49e9f311" v-for="t in nodesResult.tunnels" :key="t.id" class="tunnel-line">
                <ConnectionStatus :tone="t.online ? 'success' : 'neutral'" :label="t.online ? '在线' : '离线'" />
                <span><strong>#{{ t.id }} {{ t.name }}</strong><span data-ui="FrpPanel:b09f4d899f56" class="connection-muted"> · {{ t.type.toUpperCase() }} · 节点 {{ t.nodeName ?? t.node }}</span></span>
              </p>
            </div>

            <p data-ui="FrpPanel:328608aa9206" v-if="!nodesResult && !nodesLoading && !nodesError" class="connection-muted">填写访问密钥后点击「查询节点」查看节点列表。</p>
            <p data-ui="FrpPanel:600aeb2fc2e2" v-else-if="nodesResult && !visibleNodes.length" class="connection-muted">没有符合筛选条件的节点。</p>

            <ul data-ui="FrpPanel:d02fe3adf345" v-else-if="nodesResult" class="node-list" aria-label="节点列表">
              <li data-ui="FrpPanel:9c24368300dc" v-for="n in visibleNodes" :key="n.id" class="node-item">
                <span data-ui="FrpPanel:2a396bfd1af7" class="node-online" :class="{ on: n.online }" role="img" :aria-label="n.online ? '在线' : '离线'"></span>
                <span data-ui="FrpPanel:0b012af541ee" class="node-main">
                  <span data-ui="FrpPanel:6cdd73008975" class="node-title">
                    <strong>{{ n.name }}</strong>
                    <em data-ui="FrpPanel:bbbe3ac23456" class="node-badge" :class="n.free ? 'free' : 'vip'">{{ n.free ? '免费' : '专业版' }}</em>
                    <em data-ui="FrpPanel:e88759215898" v-if="n.mainland" class="node-badge">内地</em>
                    <em data-ui="FrpPanel:95bd84a9e9a0" v-if="n.udp" class="node-badge">UDP</em>
                    <em data-ui="FrpPanel:d6ea22acee8d" v-if="!n.canCreate" class="node-badge warn">满载</em>
                    <em data-ui="FrpPanel:218b0217dc78" v-if="n.beta" class="node-badge">BETA</em>
                  </span>
                  <small data-ui="FrpPanel:be7c9e5f6c63" v-if="n.description" class="connection-muted node-desc">{{ n.description }}</small>
                  <small data-ui="FrpPanel:6fce33a59021" class="mono node-host">{{ n.host }}</small>
                </span>
                <span data-ui="FrpPanel:a0710cc1b6d3" class="node-load"><small data-ui="FrpPanel:601b8e03c020" class="connection-muted">负载</small><strong>{{ n.load === null ? '—' : n.load + '%' }}</strong></span>
              </li>
            </ul>
          </div>
        </details>
      </div>
    </section>

  </div>
</template>
<style scoped>
.frp-account-help { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:14px; padding-top:18px; margin-top:6px; border-top:1px solid var(--border-strong); }
.frp-account-help small { color:var(--text-dim); font-size:12px; }

.frp-overview { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap }
.frp-overview h2 { margin:0 0 8px; font-size:24px }
.frp-overview p,.frp-restore-note { color:var(--text-dim); line-height:1.7; margin:0 }
.frp-metrics { display:flex; align-items:center; gap:20px; flex-wrap:wrap; color:var(--text-dim) }
.frp-metrics b { color:var(--text); font-size:24px; margin-right:6px }
.frp-restore-note { padding:14px 18px; background:var(--accent-soft); border:1px solid var(--border); border-radius:var(--radius-md) }
.frp-account-row { display:flex; align-items:flex-end; gap:14px; flex-wrap:wrap; margin-bottom:14px }
.frp-account-row .connection-field { flex:1; min-width:200px }
.frp-tunnel-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px }
.frp-tunnel-card { min-width:0; padding:22px; border:1px solid var(--border); background:var(--card); border-radius:var(--radius-lg); box-shadow:var(--shadow); display:flex; flex-direction:column; gap:18px }
.frp-tunnel-card.connected { border-color:color-mix(in srgb,var(--ok) 55%,var(--border)) }
.frp-tunnel-card header,.frp-tunnel-card footer { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap }
.frp-tunnel-card h3 { margin:0 0 6px; font-size:18px; overflow-wrap:anywhere }
.frp-tunnel-card header p,.frp-tunnel-card small { color:var(--text-dim); margin:0 }
.frp-endpoints { padding:14px; background:var(--card-2); border-radius:var(--radius-md); display:grid; gap:14px }
.frp-endpoints>div { display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0 }
.frp-endpoints span { width:100%; font-size:12px; color:var(--text-dim) }
.frp-endpoints strong { font-size:14px; overflow-wrap:anywhere; user-select:text }
.frp-tunnel-message { margin:0; line-height:1.6; font-size:13px; color:var(--text-dim); overflow-wrap:anywhere }
.frp-tunnel-message.danger { color:var(--danger) }
.frp-card-actions { display:flex; gap:8px; flex-wrap:wrap }
.frp-tunnel-card footer { margin-top:auto }
.frp-card-logs { padding-top:12px; border-top:1px solid var(--border) }
.frp-card-logs summary,.frp-create-details>summary { cursor:pointer; color:var(--text-dim); padding:8px 0 }
.frp-empty { grid-column:1/-1; border:1px dashed var(--border); padding:32px; text-align:center; border-radius:var(--radius-md); color:var(--text-dim) }
@media(max-width:1100px) { .frp-tunnel-grid { grid-template-columns:1fr } }
.frp-guide-links{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.selectable{user-select:text}.frp-create-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.frp-free{display:flex;gap:8px;align-items:center;font-size:13px;margin:16px 0}@media(max-width:750px){.frp-create-grid{grid-template-columns:1fr}}
.frp-page { display: flex; flex-direction: column; gap: var(--sec-gap); min-width: 0; }
.remote-card {
  display: flex; flex-direction: column; gap: var(--space-3);
  padding: var(--card-pad); min-height: var(--row-h);
  border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card-2);
}
.remote-card.ok { border-color: color-mix(in srgb, var(--ok) 40%, var(--border)); }
.remote-label { font-size: var(--text-xs); font-weight: 600; color: var(--text-dim); }
.remote-line { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); min-height: var(--row-h); }
.remote-line code { font-weight: 700; font-size: var(--text-lg); overflow-wrap: anywhere; }
.copy-mini { padding: var(--space-1) var(--space-3); font-size: var(--text-xs); min-height: 28px; }
.join-guide { margin: 0; padding-left: var(--space-5); display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--text-xs); color: var(--text-dim); line-height: 1.8; }
.main-actions { padding-top: var(--space-1); }
.main-btn { min-height: calc(var(--ctl-h) + var(--space-2)); font-size: var(--text-md); font-weight: 700; padding: var(--space-2) var(--space-6); flex: 1 1 auto; }

/* 参考信息区：默认折叠，展开后宽松排布 */
.reference-details { border: 0; background: transparent; padding: 0; }
.reference-details > summary { min-height: var(--ctl-h); font-size: var(--text-xs); }
.reference-body { display: flex; flex-direction: column; gap: var(--space-4); margin-top: var(--space-4); }
.node-toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
.node-toggle { flex: 1; min-width: 220px; }
.tunnels-card { gap: var(--space-2); }
.tunnel-line { display: flex; align-items: center; gap: var(--space-3); min-height: var(--row-h); flex-wrap: wrap; }
.node-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
/* 节点行：自适应高度 + 内边距，行与行之间留出空隙，绝不互相重叠贴死 */
.node-item {
  display: flex; align-items: flex-start; gap: var(--space-3);
  min-height: var(--row-h); padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--card-2);
}
.node-online { width: 9px; height: 9px; border-radius: 50%; flex: none; margin-top: var(--space-2); background: var(--text-dim); }
.node-online.on { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent); }
.node-main { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; flex: 1; }
.node-title { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); min-width: 0; }
.node-title strong { font-size: var(--text-sm); overflow-wrap: anywhere; }
.node-badge { display: inline-flex; align-items: center; font-style: normal; font-size: var(--text-xs); line-height: 1; padding: 3px var(--space-2); border-radius: 999px; border: 1px solid var(--border-strong); color: var(--text-dim); white-space: nowrap; }
.node-badge.free { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); }
.node-badge.vip { color: var(--accent-2); border-color: color-mix(in srgb, var(--accent-2) 45%, transparent); }
.node-badge.warn { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, transparent); }
.node-desc { line-height: 1.7; }
.node-host { color: var(--text-dim); overflow-wrap: anywhere; }
.node-load { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); flex: none; min-width: 52px; }


.frp-page{gap:12px}.frp-overview{padding:0}.frp-overview h2{font-size:16px}.frp-overview p{display:none}.frp-metrics{flex-wrap:wrap;gap:12px}.frp-restore-note{padding:8px 0;border:0;background:none;border-radius:0;font-size:12px}.frp-restore-note summary{cursor:pointer}.frp-account-summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px;padding:12px 16px;background:var(--surface-content);border-radius:var(--radius-md)}.frp-account-summary>span{flex:1}.frp-tunnel-grid{display:flex;flex-direction:column;gap:0;background:var(--surface-content);border-radius:var(--radius-lg);padding:0 16px}.frp-tunnel-card,.frp-tunnel-card.connected{display:grid;grid-template-columns:minmax(150px,1fr) minmax(240px,1.3fr) auto;gap:8px 16px;min-height:112px;border:0;border-bottom:1px solid var(--border);border-radius:0;box-shadow:none;background:transparent;padding:16px 0}.frp-tunnel-card header{grid-column:1;display:flex;flex-wrap:wrap;gap:8px}.frp-tunnel-card h3{font-size:17px;margin:0}.frp-tunnel-card header p{font-size:12px;line-height:1.5;margin:4px 0}.frp-endpoints{grid-column:2;display:grid;grid-template-columns:1fr;gap:6px;padding:0;background:none;border-radius:0}.frp-endpoints>div{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.frp-endpoints strong{font-size:14px;white-space:nowrap}.frp-endpoints span{font-size:12px}.frp-tunnel-card footer{grid-column:3;grid-row:1;display:flex;flex-direction:column-reverse;align-items:flex-end;justify-content:space-between;gap:8px;margin:0}.frp-card-actions{display:flex;gap:8px}.frp-tunnel-card footer small{font-size:12px}.frp-card-logs{grid-column:1/-1;margin:0;padding:0;border:0;font-size:12px}.frp-card-logs summary{padding:0}.frp-tunnel-message{grid-column:1/-1;margin:0;font-size:13px}.frp-more{position:relative}.frp-more summary{list-style:none}.frp-more>div{position:absolute;right:0;padding:8px;background:var(--surface-solid);border:1px solid var(--border);z-index:5;border-radius:var(--radius-md)}.frp-create-details:not([open]){display:none}.frp-page :deep(.reference-panel){box-shadow:none}.frp-tunnel-card .connection-log-viewport{max-height:200px}
@media(max-width:1150px){.frp-tunnel-card{grid-template-columns:minmax(0,1fr) auto}.frp-tunnel-card header{grid-column:1}.frp-endpoints{grid-row:2;grid-column:1/-1}.frp-tunnel-card footer{grid-column:2}.frp-card-logs{grid-row:3}.frp-tunnel-message{grid-row:4}}@media(max-width:650px){.frp-tunnel-card{grid-template-columns:minmax(0,1fr)}.frp-tunnel-card footer{grid-column:1;grid-row:3;align-items:flex-start;flex-direction:row;flex-wrap:wrap}.frp-card-logs{grid-row:4}.frp-tunnel-message{grid-row:5}.frp-endpoints strong{white-space:normal;overflow-wrap:anywhere}}

</style>
