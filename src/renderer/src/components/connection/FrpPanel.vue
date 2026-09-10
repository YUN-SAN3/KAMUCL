<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import ConnectionPanel from './ConnectionPanel.vue'
import ConnectionStatus from './ConnectionStatus.vue'
import { toast } from '../../store'

type FrpStatus = 'idle' | 'starting' | 'running' | 'auth_failed' | 'tunnel_offline' | 'error' | 'stopped'
interface FrpState {
  status: FrpStatus
  config: { accessKey: string; tunnelId: string; localPort: number } | null
  remoteAddress: string | null
  pid: number | null
  startedAt: string | null
  message: string
  logs: Array<{ ts: string; stream: 'stdout' | 'stderr' | 'system'; text: string }>
}
interface FrpEvent {
  type: 'status' | 'log' | 'ready' | 'error' | 'stopped'
  status?: FrpStatus
  remoteAddress?: string | null
  data?: { ts: string; stream: 'stdout' | 'stderr' | 'system'; text: string } | string
  message?: string
}
/** 与 src/main/core/frpNodes.ts 的 FrpNodeInfo / FrpTunnelInfo 字段一致 */
interface FrpNodeInfo {
  id: number; name: string; host: string; description: string
  vip: number; free: boolean; online: boolean; load: number | null
  udp: boolean; mainland: boolean; canCreate: boolean; noProtect: boolean; beta: boolean
}
interface FrpTunnelInfo {
  id: number; name: string; type: string; node: number; nodeName: string | null
  online: boolean; status: number; localIp: string; localPort: number; remote: string
}
interface FrpNodesResult { fetchedAt: string; nodes: FrpNodeInfo[]; tunnels: FrpTunnelInfo[] | null }

const kamucl = (window as unknown as {
  kamucl: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    on: (channel: string, cb: (...args: unknown[]) => void) => () => void
  }
}).kamucl

const state = ref<FrpState>({
  status: 'idle',
  config: null,
  remoteAddress: null,
  pid: null,
  startedAt: null,
  message: '尚未启动',
  logs: []
})
const busy = ref(false)
const errorMsg = ref('')

const form = reactive({
  accessKey: '',
  tunnelId: '',
  localPort: '' // 留空 → 自动读取 MC 局域网端口
})

const statusLabel: Record<FrpStatus, string> = {
  idle: '尚未启动',
  starting: '正在连接',
  running: '隧道已连接',
  auth_failed: '认证失败',
  tunnel_offline: '隧道离线',
  error: '异常',
  stopped: '已停止'
}
const statusTone = (s: FrpStatus): 'neutral' | 'success' | 'danger' | 'pending' => {
  if (s === 'running' || s === 'starting') return s === 'running' ? 'success' : 'pending'
  if (s === 'auth_failed' || s === 'tunnel_offline' || s === 'error') return 'danger'
  return 'neutral'
}
/** 上次保存的配置（userData/frp-config.json 经 frp:status 回填），驱动「一键开始」 */
const hasSavedConfig = computed(() => !!form.accessKey.trim() && !!form.tunnelId.trim())
const running = computed(() => state.value.status === 'running' || state.value.status === 'starting')

async function refreshStatus(): Promise<void> {
  try {
    const res = (await kamucl.invoke('frp:status')) as FrpState
    state.value = res
    if (res.config) {
      form.accessKey = res.config.accessKey
      form.tunnelId = res.config.tunnelId
      form.localPort = res.config.localPort ? String(res.config.localPort) : ''
    }
  } catch (e) {
    // 首次启动可能尚未实现 IPC，吞掉即可
    void e
  }
}

async function onStart(): Promise<void> {
  if (busy.value) return
  errorMsg.value = ''
  busy.value = true
  try {
    const localPort = Number(form.localPort) || 0
    await kamucl.invoke('frp:start', {
      accessKey: form.accessKey.trim(),
      tunnelId: form.tunnelId.trim(),
      localPort
    })
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
    void refreshStatus()
  }
}

async function onStop(): Promise<void> {
  if (busy.value) return
  errorMsg.value = ''
  busy.value = true
  try {
    await kamucl.invoke('frp:stop')
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
    void refreshStatus()
  }
}

async function copyRemote(): Promise<void> {
  if (!state.value.remoteAddress) return
  try {
    await navigator.clipboard.writeText(state.value.remoteAddress)
    toast('已复制远程地址', 'info')
  } catch {
    toast('复制失败', 'info')
  }
}

// ---- 节点参考（api.natfrp.com/v4，主进程缓存 10 分钟；默认折叠，点开才拉取/展开） ----
const nodesResult = ref<FrpNodesResult | null>(null)
const nodesLoading = ref(false)
const nodesError = ref('')
const onlyFree = ref(true)
const visibleNodes = computed<FrpNodeInfo[]>(() => {
  const all = nodesResult.value?.nodes ?? []
  return onlyFree.value ? all.filter((n) => n.free) : all
})

async function loadNodes(refresh = false): Promise<void> {
  if (nodesLoading.value) return
  nodesLoading.value = true
  nodesError.value = ''
  try {
    nodesResult.value = (await kamucl.invoke('frp:nodes', { accessKey: form.accessKey.trim(), refresh })) as FrpNodesResult
  } catch (e) {
    nodesError.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : String(e)
  } finally {
    nodesLoading.value = false
  }
}
function onReferenceToggle(event: Event): void {
  // 首次展开且已保存过访问密钥时自动拉一次节点（失败只展示真实错误，不打扰）
  if ((event.target as HTMLDetailsElement).open && !nodesResult.value && !nodesLoading.value && form.accessKey.trim()) void loadNodes()
}

const logsContainer = ref<HTMLElement | null>(null)
function handleEvent(event: FrpEvent): void {
  if (!event) return
  if (event.type === 'log' && event.data && typeof event.data === 'object') {
    state.value.logs = [...state.value.logs, event.data].slice(-200)
    void nextTickScroll()
    return
  }
  if (event.type === 'status') {
    state.value.status = event.status ?? state.value.status
    if (event.message) state.value.message = event.message
  }
  if (event.type === 'ready') {
    state.value.remoteAddress = event.remoteAddress ?? null
    state.value.status = 'running'
    state.value.message = `已连接，远程地址 ${state.value.remoteAddress}`
  }
  if (event.type === 'error') {
    state.value.status = 'error'
    if (event.message) state.value.message = event.message
  }
  if (event.type === 'stopped') {
    state.value.status = event.status ?? 'stopped'
    state.value.message = event.message ?? state.value.message
  }
}

function nextTickScroll(): void {
  requestAnimationFrame(() => {
    const el = logsContainer.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

let unsubscribe: (() => void) | null = null
onMounted(async () => {
  unsubscribe = kamucl.on('frp:event', (raw) => handleEvent(raw as FrpEvent))
  await refreshStatus()
})
onBeforeUnmount(() => {
  unsubscribe?.()
})
</script>

<template>
  <div class="frp-page">
    <!-- 状态区：隧道状态 + 远程地址（好友直接连接用） -->
    <ConnectionPanel
      title="连接状态"
      subtitle="隧道与远程地址的实时状态，全部来自 frpc 真实事件"
    >
      <template #action>
        <ConnectionStatus :tone="statusTone(state.status)" :label="statusLabel[state.status]" />
      </template>

      <div class="remote-card" :class="{ ok: state.status === 'running' }">
        <p class="remote-label">远程地址（好友直接连接用）</p>
        <p class="remote-line">
          <code class="mono">{{ state.remoteAddress ?? '尚未分配' }}</code>
          <button v-if="state.remoteAddress" class="btn btn-ghost copy-mini" @click="copyRemote">复制地址</button>
        </p>
        <p class="connection-muted">{{ state.message }}</p>
        <ol v-if="state.remoteAddress" class="join-guide">
          <li>保持游戏与「对局域网开放」的世界运行</li>
          <li>好友打开「多人游戏」→「直接连接」</li>
          <li>粘贴上方地址并加入</li>
        </ol>
        <p v-if="!state.remoteAddress && !running" class="connection-muted">
          启动隧道并通过认证后，这里会显示 frpc 分配的远程地址。
        </p>
      </div>
      <p v-if="errorMsg" class="connection-error" role="alert">{{ errorMsg }}</p>
    </ConnectionPanel>

    <!-- 主操作区：一键开始（上次配置自动预填） -->
    <ConnectionPanel
      title="启动隧道"
      subtitle="确认访问密钥与隧道 ID 后一键开始；两项均保存在本机 userData/frp-config.json，进入本页已自动填入上次配置。"
    >
      <label class="connection-field">
        <span>访问密钥</span>
        <input
          v-model="form.accessKey"
          class="input"
          type="password"
          autocomplete="off"
          placeholder="natfrp.com 用户信息页查看"
        />
        <small>即 frpc 启动命令里 accessKey:tunnelId 的前半段；节点查询也使用它。密钥仅保存在本机，日志中默认打码。</small>
      </label>

      <label class="connection-field">
        <span>隧道 ID</span>
        <input
          v-model="form.tunnelId"
          class="input"
          inputmode="numeric"
          placeholder="例如 12345"
        />
        <small>在 natfrp.com 隧道列表创建（选择节点后生成），本地 IP 填 127.0.0.1，本地端口与 MC 局域网一致。</small>
      </label>

      <details class="connection-details">
        <summary>高级选项 · 本地端口</summary>
        <div class="connection-detail-content">
          <label class="connection-field">
            <span>本地端口（MC 局域网端口）</span>
            <input
              v-model="form.localPort"
              class="input"
              inputmode="numeric"
              placeholder="留空自动读取游戏内局域网端口"
            />
            <small>在游戏中选择「对局域网开放」后会写入 latest.log，启动器会尝试自动识别；仅当自动识别失败时才需要手动填写。</small>
          </label>
        </div>
      </details>

      <div class="connection-actions main-actions">
        <button
          v-if="!running"
          class="btn btn-gold main-btn"
          :disabled="busy || !form.accessKey.trim() || !form.tunnelId.trim()"
          @click="onStart"
        >
          {{ busy ? '启动中…' : '启动 frpc' }}
        </button>
        <button v-else class="btn btn-ghost main-btn" :disabled="busy" @click="onStop">
          {{ busy ? '停止中…' : '停止 frpc' }}
        </button>
        <button class="btn btn-ghost" :disabled="busy" @click="refreshStatus">刷新状态</button>
      </div>
      <p class="connection-muted">
        <template v-if="hasSavedConfig">已载入上次保存的配置，确认无误即可启动。</template>
        <template v-else>首次使用：填入访问密钥与隧道 ID，启动后会自动保存在本机，下次进入本页即可直接启动。</template>
        启动即运行官方 frpc，把本地世界映射到樱花穿透节点；失败时状态区会给出认证或隧道原因。
      </p>
    </ConnectionPanel>

    <!-- 参考信息区：节点参考（默认折叠，点开才展开/查询） -->
    <section class="connection-panel">
      <header class="connection-panel-head">
        <div>
          <h2>节点参考</h2>
          <p>节点由 natfrp 后台创建隧道时选择，此处仅供查看：在线状态、负载与免费/专业版标识来自 api.natfrp.com/v4（缓存 10 分钟）。</p>
        </div>
      </header>
      <div class="connection-panel-body">
        <details class="reference-details" @toggle="onReferenceToggle">
          <summary>展开节点列表{{ nodesResult ? `（共 ${nodesResult.nodes.length} 个节点）` : '（默认收起）' }}</summary>
          <div class="reference-body">
            <div class="node-toolbar">
              <label class="connection-toggle node-toggle"><span>只看免费节点<small>专业版（VIP）节点需要 natfrp 专业版账号</small></span><input v-model="onlyFree" type="checkbox" /><span class="connection-toggle-track" aria-hidden="true"></span></label>
              <button class="btn btn-ghost" :disabled="nodesLoading || !form.accessKey.trim()" @click="loadNodes(true)">{{ nodesLoading ? '查询中…' : nodesResult ? '刷新节点' : '查询节点' }}</button>
            </div>

            <p v-if="nodesError" class="connection-error" role="alert">{{ nodesError }}</p>

            <!-- 我的隧道：节点列表上方的单独小卡 -->
            <div v-if="nodesResult?.tunnels?.length" class="connection-result tunnels-card">
              <h3>我的隧道（natfrp 账号内）</h3>
              <p v-for="t in nodesResult.tunnels" :key="t.id" class="tunnel-line">
                <ConnectionStatus :tone="t.online ? 'success' : 'neutral'" :label="t.online ? '在线' : '离线'" />
                <span><strong>#{{ t.id }} {{ t.name }}</strong><span class="connection-muted"> · {{ t.type.toUpperCase() }} · 节点 {{ t.nodeName ?? t.node }}</span></span>
              </p>
            </div>

            <p v-if="!nodesResult && !nodesLoading && !nodesError" class="connection-muted">填写访问密钥后点击「查询节点」查看节点列表。</p>
            <p v-else-if="nodesResult && !visibleNodes.length" class="connection-muted">没有符合筛选条件的节点。</p>

            <ul v-else-if="nodesResult" class="node-list" aria-label="节点列表">
              <li v-for="n in visibleNodes" :key="n.id" class="node-item">
                <span class="node-online" :class="{ on: n.online }" role="img" :aria-label="n.online ? '在线' : '离线'"></span>
                <span class="node-main">
                  <span class="node-title">
                    <strong>{{ n.name }}</strong>
                    <em class="node-badge" :class="n.free ? 'free' : 'vip'">{{ n.free ? '免费' : '专业版' }}</em>
                    <em v-if="n.mainland" class="node-badge">内地</em>
                    <em v-if="n.udp" class="node-badge">UDP</em>
                    <em v-if="!n.canCreate" class="node-badge warn">满载</em>
                    <em v-if="n.beta" class="node-badge">BETA</em>
                  </span>
                  <small v-if="n.description" class="connection-muted node-desc">{{ n.description }}</small>
                  <small class="mono node-host">{{ n.host }}</small>
                </span>
                <span class="node-load"><small class="connection-muted">负载</small><strong>{{ n.load === null ? '—' : n.load + '%' }}</strong></span>
              </li>
            </ul>
          </div>
        </details>
      </div>
    </section>

    <!-- 日志区：窄、默认收起 -->
    <details class="connection-details log-details">
      <summary>frpc 运行日志（{{ state.logs.length }} 条）</summary>
      <div ref="logsContainer" class="connection-log-viewport">
        <p v-if="!state.logs.length" class="connection-muted">尚无日志。</p>
        <p v-for="(entry, i) in state.logs" :key="i" class="mono connection-log-line">
          <span class="connection-muted">[{{ entry.stream }}]</span> {{ entry.text }}
        </p>
      </div>
    </details>
  </div>
</template>
<style scoped>
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

</style>
