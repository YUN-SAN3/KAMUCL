<script setup lang="ts">
import { terracottaRole } from '@shared/uiPresentation'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import ConnectionPanel from './ConnectionPanel.vue'
import ConnectionStatus from './ConnectionStatus.vue'
import { toast } from '../../store'
import { copyText } from '../../api'

interface TcStatus { phase: 'idle' | 'downloading' | 'starting' | 'hosting' | 'joining' | 'ready'; room?: string; url?: string; stateRaw?: string; error?: string; downloaded?: number; total?: number; binaryReady: boolean; running: boolean; toolVersion?: string; binaryPath?: string }

const status = ref<TcStatus | null>(null)
const busy = ref(false)
const error = ref('')
const logs = ref<Array<{ ts: string; text: string }>>([])
const mode = ref<'host' | 'join'>('host')
const roomCode = ref('')
const playerName = ref('')

/** 官方房间码格式：U/ 前缀 + 四段各 4 位（burningtnt/Terracotta） */
const ROOM_CODE_RE = /^U\/[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/
const joinCodeValid = computed(() => ROOM_CODE_RE.test(roomCode.value.trim().toUpperCase()))
/** 只有 ready 且拿到本地地址才算「已连接」；joining/hosting 只是进行中 */
const connected = computed(() => !!status.value && status.value.phase === 'ready' && !!status.value.url)
const busyPhase = computed(() => !!status.value && ['downloading', 'starting', 'hosting', 'joining'].includes(status.value.phase))
const hosting = computed(() => terracottaRole(status.value) === 'host')
const toolDetails=ref(false)

interface Step { label: string; state: 'done' | 'active' | 'pending'; detail?: string }
/** 阶段条：由 tc:status 的真实 phase / stateRaw 驱动 */
const steps = computed<Step[]>(() => {
  const s = status.value
  if (!s || (s.phase === 'idle' && !s.running)) return []
  const phase = s.phase
  const stepState = (active: boolean, done: boolean): 'done' | 'active' | 'pending' => (done ? 'done' : active ? 'active' : 'pending')
  return [
    { label: '准备官方工具', state: stepState(phase === 'downloading', s.binaryReady), detail: s.binaryReady ? '已就绪（SHA-256 校验通过）' : '等待下载' },
    { label: '启动陶瓦引擎', state: stepState(phase === 'starting', s.running), detail: s.running ? '运行中' : undefined },
    { label: hosting.value ? '创建房间' : '加入房间', state: stepState(phase === 'hosting' || phase === 'joining', !!s.room || !!s.url), detail: s.stateRaw ? `引擎状态 ${s.stateRaw}` : undefined },
    { label: hosting.value ? '房间就绪' : '连接就绪', state: stepState(false, phase === 'ready'), detail: phase === 'ready' ? (hosting.value ? '房间码已生成' : '本地地址已生成') : undefined }
  ]
})

/** 消敏：远程地址不进日志（本地 127.0.0.1:端口 除外） */
function sanitizeLog(text: string): string {
  return text
    .replace(/(\d{1,3}\.){3}\d{1,3}:\d+/g, (m) => (m.startsWith('127.0.0.1') ? m : '***:***'))
    .replace(/(\d{1,3}\.){3}\d{1,3}/g, (m) => (m === '127.0.0.1' ? m : '***'))
}

const logViewport = ref<HTMLElement | null>(null)
function pushLog(text: string): void {
  const d = new Date()
  const ts = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
  logs.value.push({ ts, text: sanitizeLog(text) })
  if (logs.value.length > 300) logs.value.shift()
  requestAnimationFrame(() => {
    const el = logViewport.value
    if (el) el.scrollTop = el.scrollHeight
  })
}
async function copyLogs(): Promise<void> {
  const text = logs.value.map((l) => `[${l.ts}] ${l.text}`).join('\n')
  toast(await copyText(text) ? '日志已复制' : '复制失败', 'info')
}

let offEvent: (() => void) | undefined

function onEvent(payload: { type: string; data: unknown }): void {
  if (payload.type === 'status') { status.value = { toolVersion:status.value?.toolVersion, binaryPath:status.value?.binaryPath, binaryReady: status.value?.binaryReady ?? false, running: status.value?.running ?? false, ...(payload.data as TcStatus) }; return }
  if (payload.type === 'log') {
    const d = payload.data as { level: string; msg: string }
    if (d?.msg) pushLog(`[${d.level}] ${d.msg}`)
  } else if (payload.type === 'error') {
    error.value = String(payload.data)
  } else if (payload.type === 'stopped') {
    void refresh()
  } else if (payload.type === 'ready') {
    void refresh()
  }
}

async function refresh(): Promise<void> {
  try { status.value = await window.kamucl.invoke('tc:status'); if(status.value?.error)error.value=status.value.error; const role=terracottaRole(status.value); if(role!=='none')mode.value=role==='host'?'host':'join' } catch { /* 窗口关闭 */ }
}

async function install(): Promise<void> {
  busy.value = true; error.value = ''
  try { await window.kamucl.invoke('tc:install'); toast('陶瓦工具已下载并通过校验', 'success') }
  catch (e) { error.value = (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') }
  finally { busy.value = false; await refresh() }
}
async function cancelInstall() { await window.kamucl.invoke('tc:cancel-install') }
async function start(): Promise<void> {
  if (!status.value?.binaryReady) return
  busy.value = true; error.value = ''
  try {
    const result = await window.kamucl.invoke<TcStatus>('tc:start', { mode: mode.value, code: roomCode.value.trim().toUpperCase(), playerName: playerName.value || undefined })
    status.value = result
  } catch (e) { error.value = (e as Error).message?.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') ?? '操作失败' }
  finally { busy.value = false; void refresh() }
}
async function stop(): Promise<void> {
  busy.value = true
  try { await window.kamucl.invoke('tc:stop') } catch { /* 忽略 */ }
  finally { busy.value = false; void refresh() }
}
function joinNow(): void {
  if (!joinCodeValid.value || busy.value || status.value?.running) return
  mode.value = 'join'
  void start()
}
async function copy(value?: string | null): Promise<void> {
  if (value) toast(await copyText(value) ? '已复制' : '复制失败', 'info')
}

onMounted(() => {
  offEvent = window.kamucl.on('tc:event', onEvent)
  void refresh()
})
onUnmounted(() => { offEvent?.() })
</script>

<template>
  <div data-ui="TerracottaPanel:8b1e2f3973ef" class="tc-page">
    <section class="tc-tool"><div class="tc-tool-heading"><strong>陶瓦工具 <small data-ui="TerracottaPanel:827e768b6562">{{ status?.toolVersion || '正在读取版本…' }}</small></strong><button v-if="status?.binaryReady" class="btn btn-ghost btn-sm" @click="toolDetails=!toolDetails">{{ toolDetails ? '收起' : '管理工具' }}</button></div>
      <p class="connection-muted">{{ status?.binaryReady ? '已安装并通过校验' : '尚未安装或需要修复' }}</p>
      <template v-if="status?.phase === 'downloading'">
        <progress data-ui="TerracottaPanel:6f7c029c3008" class="tc-progress" :value="status.downloaded || 0" :max="status.total || undefined"></progress>
        <p class="connection-muted">{{ ((status.downloaded || 0) / 1048576).toFixed(1) }} MB{{ status.total ? ' / ' + (status.total / 1048576).toFixed(1) + ' MB' : '' }} · 下载后校验并解压</p>
        <button data-ui="TerracottaPanel:1590618aaf7d" class="btn btn-ghost" @click="cancelInstall">取消下载</button>
      </template>
      <button data-ui="TerracottaPanel:bcda19ff0078" v-else-if="!status?.binaryReady" class="btn btn-gold" :disabled="busy" @click="install">下载陶瓦工具</button>
    <div v-if="toolDetails && status?.binaryReady" class="tc-tool-details"><p class="mono tc-binary-path">{{status.binaryPath}}</p><p class="connection-muted">当前官方工具已通过完整性校验；校验失败时会显示重新下载入口。</p><button class="btn btn-ghost btn-sm" @click="refresh">重新校验</button></div></section>

    <!-- 状态区：引擎指标 + 进行中/已就绪的房间与地址 -->
    <ConnectionPanel title="当前连接">
      <template #action>
        <ConnectionStatus
          :tone="error ? 'danger' : connected || (hosting && status?.phase==='ready') ? 'success' : busyPhase ? 'pending' : 'neutral'"
          :label="error ? '操作未完成' : connected ? '连接就绪' : hosting && status?.phase==='ready' ? '房间已就绪' : busyPhase ? '正在连接' : status?.binaryReady ? '尚未联机' : '工具待准备'"
        />
      </template>

      <details class="tc-diagnostics"><summary>详细状态</summary><p v-if="status?.binaryPath" class="mono tc-binary-path">{{ status.binaryPath }}</p><div data-ui="TerracottaPanel:ce3fababc2be" class="tc-metrics">
        <div><span>二进制</span><ConnectionStatus :tone="status?.binaryReady ? 'success' : 'neutral'" :label="status?.binaryReady ? '已就绪' : '待下载'" /></div>
        <div><span>进程</span><ConnectionStatus :tone="status?.running ? 'success' : 'neutral'" :label="status?.running ? '运行中' : '未运行'" /></div>
        <div><span>引擎状态</span><strong>{{ status?.stateRaw ?? '—' }}</strong></div>
      </div>

      </details>
      <!-- 房主：房间码就绪 -->
      <div data-ui="TerracottaPanel:206e7b16e50e" v-if="hosting && status?.room" class="room-card" :class="{ ok: status.phase === 'ready' }">
        <p data-ui="TerracottaPanel:1bd0e99be803" class="room-label">房间码（发给好友）</p>
        <p data-ui="TerracottaPanel:56648d11bc2e" class="room-code"><code>{{ status.room }}</code><button data-ui="TerracottaPanel:20b2d500a6d2" class="btn btn-ghost copy-mini" :disabled="!status.room" @click="copy(status.room)">复制房间码</button></p>
        <p class="connection-muted">把 U/ 开头的房间码发给好友（官方四段格式）。好友既可以用 KAMUCL 加入，也可以在陶瓦联机官方工具里输入。</p>
        <div class="connection-actions"><button class="btn btn-ghost" :disabled="busy" @click="stop">关闭房间</button></div>
      </div>

      <!-- 加入方：本地地址就绪 -->
      <div data-ui="TerracottaPanel:df0a2c1c5a0a" v-else-if="connected" class="connection-result success" aria-live="polite">
        <ConnectionStatus tone="success" label="已连接 · 本地地址就绪" />
        <p data-ui="TerracottaPanel:9d326d8a8d4e" class="mc-address"><code>{{ status?.url }}</code><button data-ui="TerracottaPanel:ce5c6200c8bf" class="btn btn-ghost copy-mini" @click="copy(status?.url)">复制地址</button></p>
        <ol data-ui="TerracottaPanel:2344f43069e9" class="join-guide">
          <li>打开 Minecraft（与房主相同的实例与版本）</li>
          <li>进入「多人游戏」→「直接连接」</li>
          <li>粘贴上方地址并加入</li>
        </ol>
        <div class="connection-actions"><button class="btn btn-ghost" :disabled="busy" @click="stop">断开</button></div>
      </div>

      <!-- 进行中 -->
      <div data-ui="TerracottaPanel:c48e076cac45" v-else-if="busyPhase" class="connection-result" aria-live="polite">
        <ConnectionStatus tone="pending" label="正在建立连接…" />
        <p class="connection-muted">当前阶段：{{ status?.phase === 'downloading' ? '下载官方工具' : status?.phase === 'starting' ? '启动陶瓦引擎' : status?.phase === 'joining' ? '正在加入房间' : status?.phase === 'hosting' ? '等待房间号' : '处理中' }}{{ status?.stateRaw ? ` · 引擎状态 ${status.stateRaw}` : '' }}</p>
      </div>

      <ol data-ui="TerracottaPanel:8c761921c1c5" v-if="steps.length" class="stage-bar" aria-label="连接过程">
        <li data-ui="TerracottaPanel:25a2ddf62ba7" v-for="s in steps" :key="s.label" class="stage-item" :class="s.state">
          <span data-ui="TerracottaPanel:f1d7550a3d17" class="stage-dot" aria-hidden="true">{{ s.state === 'done' ? '✓' : '' }}</span>
          <span data-ui="TerracottaPanel:99431821492b" class="stage-copy"><strong>{{ s.label }}</strong><small v-if="s.detail">{{ s.detail }}</small></span>
        </li>
      </ol>

      <div data-ui="TerracottaPanel:48b8a0fb7f25" v-if="busyPhase && status?.phase !== 'downloading'" class="connection-actions"><button data-ui="TerracottaPanel:e4686b6661b3" class="btn btn-ghost" @click="stop">取消连接</button></div>
      <p data-ui="TerracottaPanel:1861deb0662b" v-if="error" class="connection-error" role="alert">{{ error }}</p>
    </ConnectionPanel>

    <!-- 主操作区：创建房间 / 加入房间 两栏并排（窄窗口自动换行） -->
    <section class="tc-operations" aria-label="创建或加入房间"><p v-if="!status?.binaryReady || status?.running" class="connection-muted">{{ !status?.binaryReady ? '请先下载并校验陶瓦工具，再创建或加入房间。' : '当前已有会话，请先关闭或断开，再创建或加入其他房间。' }}</p>
      <div data-ui="TerracottaPanel:1ffe44625ede" class="connection-columns">
        <div class="op-card">
          <h3>创建房间</h3>
          <p class="connection-muted">先启动游戏并对局域网开放世界；陶瓦会自动完成其余工作，房间码会出现在上方「连接状态」。</p>
          <label class="connection-field">游戏内名字<input data-ui="TerracottaPanel:6810d6fb09db" v-model="playerName" class="input" maxlength="16" placeholder="可选，默认 KAMUCL" /></label>
          <div class="connection-actions">
            <button data-ui="TerracottaPanel:f0d7559a0af1" class="btn btn-gold main-btn" :disabled="busy || status?.running || !status?.binaryReady" @click="mode = 'host'; start()">{{ busy && mode === 'host' ? '处理中…' : '创建陶瓦房间' }}</button>
          </div>
        </div>
        <div class="op-card">
          <h3>加入房间</h3>
          <label class="connection-field">房间码<input data-ui="TerracottaPanel:c407f428b093" v-model="roomCode" class="input room-input" placeholder="U/XXXX-XXXX-XXXX-XXXX" :disabled="busy" @keydown.enter="joinNow" /></label>
          <p data-ui="TerracottaPanel:9bf07a151f37" v-if="roomCode.trim() && !joinCodeValid" class="connection-muted">格式：U/ 开头 + 四段各 4 位（例如 U/AB12-CD34-EF56-GH78）。</p>
          <div class="connection-actions">
            <button data-ui="TerracottaPanel:353f1b95db3e" class="btn btn-gold main-btn" :disabled="busy || status?.running || !joinCodeValid || !status?.binaryReady" @click="joinNow">{{ busy && mode === 'join' ? '连接中…' : '加入房间' }}</button>
          </div>
          <p class="connection-muted">加入成功（引擎给出本地地址）后，地址会显示在上方「连接状态」。</p>
        </div>
      </div>
    </section>

    <!-- 参考信息区：默认折叠 -->
    <details data-ui="TerracottaPanel:3fe99c5bebdf" class="connection-details reference-details">
      <summary>关于陶瓦联机</summary>
      <div data-ui="TerracottaPanel:47f49123c2eb" class="connection-detail-content">
        <p>陶瓦联机（Terracotta）是 burningtnt（GitHub burningtnt/Terracotta）维护的独立开源联机项目，基于 EasyTier、AGPL-3.0 协议。</p>
        <p>点击「下载陶瓦工具」获取官方 {{ status?.toolVersion || '指定版本' }} 二进制，分别校验压缩包与 EXE 的 SHA-256；极端 NAT 环境下成功率较高。</p>
        <p>房间码为官方四段格式 U/XXXX-XXXX-XXXX-XXXX，与陶瓦官方工具互通。</p>
      </div>
    </details>

    <!-- 日志区：窄、默认收起 -->
    <details data-ui="TerracottaPanel:9ff4da54ff0d" class="connection-details log-details">
      <summary>陶瓦引擎日志（{{ logs.length }} 条）</summary>
      <div data-ui="TerracottaPanel:387469b5876d" class="log-tools"><button data-ui="TerracottaPanel:1e6ff6dd4e33" class="btn btn-ghost copy-mini" :disabled="!logs.length" @click="copyLogs">复制日志</button></div>
      <div data-ui="TerracottaPanel:9ba0004a10df" ref="logViewport" class="connection-log-viewport" aria-live="polite" tabindex="0">
        <p data-ui="TerracottaPanel:8607ff626ce4" v-for="(l, i) in logs" :key="i" class="connection-log-line"><span data-ui="TerracottaPanel:41e49f406b4c" class="log-ts">{{ l.ts }}</span>{{ l.text }}</p>
        <p data-ui="TerracottaPanel:c7a082d9c420" v-if="!logs.length" class="connection-muted">暂无日志。</p>
      </div>
    </details>
  </div>
</template>
<style scoped>
.tc-progress { width:100%; accent-color:var(--accent); height:8px; margin:12px 0 }
.tc-page { display: flex; flex-direction: column; gap: var(--sec-gap); min-width: 0; }
.tc-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); }
.tc-metrics > div { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); min-height: var(--row-h); padding: var(--space-3) var(--space-4); border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--card-2); }
.tc-metrics span { font-size: var(--text-xs); color: var(--text-dim); }
.tc-metrics strong { font-size: var(--text-sm); }
.room-card {
  display: flex; flex-direction: column; gap: var(--space-2);
  padding: var(--card-pad); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card-2);
}
.room-card.ok { border-color: color-mix(in srgb, var(--ok) 40%, var(--border)); }
.room-label { font-size: var(--text-xs); font-weight: 600; color: var(--text-dim); }
.room-code { display: inline-flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); font-size: var(--text-lg); letter-spacing: 0.06em; margin: var(--space-1) 0; min-height: var(--row-h); }
.room-code code { font-weight: 700; overflow-wrap: anywhere; }
.room-input { text-transform: uppercase; letter-spacing: 0.1em; }
.copy-mini { padding: var(--space-1) var(--space-3); font-size: var(--text-xs); min-height: 28px; }
.mc-address { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); font-size: var(--text-lg); min-height: var(--row-h); }
.mc-address code { font-weight: 700; overflow-wrap: anywhere; }
.join-guide { margin: 0; padding-left: var(--space-5); display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--text-xs); color: var(--text-dim); line-height: 1.8; }
.stage-bar { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2); }
.stage-item { display: flex; align-items: center; gap: var(--space-2); min-height: var(--row-h); padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card-2); }
.stage-item.active { border-color: color-mix(in srgb, var(--accent-2) 55%, var(--border)); }
.stage-item.done { border-color: color-mix(in srgb, var(--ok) 40%, var(--border)); }
.stage-dot { width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: var(--text-xs); font-weight: 700; background: var(--card); border: 1px solid var(--border-strong); flex: none; }
.stage-item.done .stage-dot { background: var(--ok-soft); color: var(--ok); border-color: transparent; }
.stage-item.active .stage-dot { background: var(--accent-soft); color: var(--accent-2); border-color: transparent; }
.stage-copy { display: flex; flex-direction: column; min-width: 0; }
.stage-copy strong { font-size: var(--text-xs); font-weight: 600; }
.stage-copy small { color: var(--text-dim); font-size: var(--text-xs); }
.op-card {
  display: flex; flex-direction: column; gap: var(--card-gap);
  padding: var(--card-pad); min-width: 0;
  border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card-2);
}
.op-card h3 { font-size: var(--text-sm); font-weight: 700; }
.main-btn { min-height: calc(var(--ctl-h) + var(--space-2)); font-weight: 700; }
.reference-details, .log-details { padding: var(--space-3) var(--space-4); }
.log-tools { display: flex; justify-content: flex-end; margin-top: var(--space-3); }
.log-ts { color: color-mix(in srgb, var(--text-dim) 70%, transparent); margin-right: var(--space-2); }
.tc-page{gap:16px}.tc-tool{display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:16px 20px;background:var(--surface-content);border:1px solid var(--border);border-radius:var(--radius-lg)}.tc-tool-heading{display:flex;gap:12px;align-items:center}.tc-tool-heading small{color:var(--text-dim);font-weight:400;margin-left:8px}.tc-tool>.btn{width:auto;margin-left:auto}.tc-tool-details{flex-basis:100%;border-top:1px solid var(--border);padding-top:12px}.tc-binary-path{font-size:12px;overflow-wrap:anywhere}.tc-diagnostics summary{font-size:13px;color:var(--text-dim);cursor:pointer}.tc-diagnostics .tc-metrics{margin-top:12px}.tc-metrics>div{border:0;background:none;padding:8px;min-height:0}.tc-metrics span{font-size:12px}.tc-operations{display:grid;gap:12px}.tc-operations .op-card{background:var(--surface-content);border:1px solid var(--border);padding:20px;border-radius:var(--radius-lg);display:flex;flex-direction:column;gap:12px}.tc-operations .connection-actions{margin-top:auto}.tc-operations .main-btn{flex:none;min-height:40px}.tc-page .reference-details,.tc-page .log-details{padding:12px 0}.tc-operations .connection-field{font-size:14px}.tc-tool .tc-progress{flex-basis:100%}
</style>
