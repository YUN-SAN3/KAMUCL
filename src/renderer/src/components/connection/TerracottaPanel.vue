<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import ConnectionPanel from './ConnectionPanel.vue'
import ConnectionStatus from './ConnectionStatus.vue'
import { toast } from '../../store'
import { copyText } from '../../api'

interface TcStatus { phase: 'idle' | 'downloading' | 'starting' | 'hosting' | 'joining' | 'ready'; room?: string; url?: string; stateRaw?: string; error?: string; binaryReady: boolean; running: boolean }

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
const hosting = computed(() => !!status.value && (status.value.phase === 'hosting' || (!!status.value.room && status.value.phase !== 'idle')))

interface Step { label: string; state: 'done' | 'active' | 'pending'; detail?: string }
/** 阶段条：由 tc:status 的真实 phase / stateRaw 驱动 */
const steps = computed<Step[]>(() => {
  const s = status.value
  if (!s || (s.phase === 'idle' && !s.running)) return []
  const phase = s.phase
  const stepState = (active: boolean, done: boolean): 'done' | 'active' | 'pending' => (done ? 'done' : active ? 'active' : 'pending')
  return [
    { label: '准备官方工具', state: stepState(phase === 'downloading', s.binaryReady || phase !== 'idle'), detail: s.binaryReady ? '已就绪（SHA-256 校验通过）' : '等待下载' },
    { label: '启动陶瓦引擎', state: stepState(phase === 'starting', s.running), detail: s.running ? '运行中' : undefined },
    { label: mode.value === 'join' ? '加入房间' : '创建房间', state: stepState(phase === 'hosting' || phase === 'joining', !!s.room || !!s.url), detail: s.stateRaw ? `引擎状态 ${s.stateRaw}` : undefined },
    { label: mode.value === 'join' ? '连接就绪' : '房间就绪', state: stepState(false, phase === 'ready'), detail: phase === 'ready' ? (mode.value === 'join' ? '本地地址已生成' : '房间码已生成') : undefined }
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
  try { status.value = await window.kamucl.invoke('tc:status') } catch { /* 窗口关闭 */ }
}

async function start(): Promise<void> {
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
  if (!joinCodeValid.value || busy.value) return
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
  <div class="tc-page">
    <!-- 状态区：引擎指标 + 进行中/已就绪的房间与地址 -->
    <ConnectionPanel title="连接状态" subtitle="二进制、进程与房间状态全部来自陶瓦引擎真实状态">
      <template #action>
        <ConnectionStatus
          :tone="connected ? 'success' : busyPhase ? 'pending' : 'neutral'"
          :label="connected ? '连接就绪' : busyPhase ? '处理中…' : '未开始'"
        />
      </template>

      <div class="tc-metrics">
        <div><span>二进制</span><ConnectionStatus :tone="status?.binaryReady ? 'success' : 'neutral'" :label="status?.binaryReady ? '已就绪' : '待下载'" /></div>
        <div><span>进程</span><ConnectionStatus :tone="status?.running ? 'success' : 'neutral'" :label="status?.running ? '运行中' : '未运行'" /></div>
        <div><span>引擎状态</span><strong>{{ status?.stateRaw ?? '—' }}</strong></div>
      </div>

      <!-- 房主：房间码就绪 -->
      <div v-if="hosting && status?.room" class="room-card" :class="{ ok: status.phase === 'ready' }">
        <p class="room-label">房间码（发给好友）</p>
        <p class="room-code"><code>{{ status.room }}</code><button class="btn btn-ghost copy-mini" :disabled="!status.room" @click="copy(status.room)">复制房间码</button></p>
        <p class="connection-muted">把 U/ 开头的房间码发给好友（官方四段格式）。好友既可以用 KAMUCL 加入，也可以在陶瓦联机官方工具里输入。</p>
        <div class="connection-actions"><button class="btn btn-ghost" :disabled="busy" @click="stop">关闭房间</button></div>
      </div>

      <!-- 加入方：本地地址就绪 -->
      <div v-else-if="connected" class="connection-result success" aria-live="polite">
        <ConnectionStatus tone="success" label="已连接 · 本地地址就绪" />
        <p class="mc-address"><code>{{ status?.url }}</code><button class="btn btn-ghost copy-mini" @click="copy(status?.url)">复制地址</button></p>
        <ol class="join-guide">
          <li>打开 Minecraft（与房主相同的实例与版本）</li>
          <li>进入「多人游戏」→「直接连接」</li>
          <li>粘贴上方地址并加入</li>
        </ol>
        <div class="connection-actions"><button class="btn btn-ghost" :disabled="busy" @click="stop">断开</button></div>
      </div>

      <!-- 进行中 -->
      <div v-else-if="busyPhase" class="connection-result" aria-live="polite">
        <ConnectionStatus tone="pending" label="正在建立连接…" />
        <p class="connection-muted">当前阶段：{{ status?.phase === 'downloading' ? '下载官方工具' : status?.phase === 'starting' ? '启动陶瓦引擎' : status?.phase === 'joining' ? '正在加入房间' : status?.phase === 'hosting' ? '等待房间号' : '处理中' }}{{ status?.stateRaw ? ` · 引擎状态 ${status.stateRaw}` : '' }}</p>
      </div>

      <ol v-if="steps.length" class="stage-bar" aria-label="连接过程">
        <li v-for="s in steps" :key="s.label" class="stage-item" :class="s.state">
          <span class="stage-dot" aria-hidden="true">{{ s.state === 'done' ? '✓' : '' }}</span>
          <span class="stage-copy"><strong>{{ s.label }}</strong><small v-if="s.detail">{{ s.detail }}</small></span>
        </li>
      </ol>

      <p v-if="error" class="connection-error" role="alert">{{ error }}</p>
    </ConnectionPanel>

    <!-- 主操作区：创建房间 / 加入房间 两栏并排（窄窗口自动换行） -->
    <ConnectionPanel title="开始联机" subtitle="创建或加入，两步各自独立、互不打扰">
      <div class="connection-columns">
        <div class="op-card">
          <h3>创建房间</h3>
          <p class="connection-muted">先启动游戏并对局域网开放世界；陶瓦会自动完成其余工作，房间码会出现在上方「连接状态」。</p>
          <label class="connection-field">游戏内名字<input v-model="playerName" class="input" maxlength="16" placeholder="可选，默认 KAMUCL" /></label>
          <div class="connection-actions">
            <button class="btn btn-gold main-btn" :disabled="busy || status?.running" @click="mode = 'host'; start()">{{ busy && mode === 'host' ? '处理中…' : '创建陶瓦房间' }}</button>
          </div>
        </div>
        <div class="op-card">
          <h3>加入房间</h3>
          <label class="connection-field">房间码<input v-model="roomCode" class="input room-input" placeholder="U/XXXX-XXXX-XXXX-XXXX" :disabled="busy" @keydown.enter="joinNow" /></label>
          <p v-if="roomCode.trim() && !joinCodeValid" class="connection-muted">格式：U/ 开头 + 四段各 4 位（例如 U/AB12-CD34-EF56-GH78）。</p>
          <div class="connection-actions">
            <button class="btn btn-gold main-btn" :disabled="busy || !joinCodeValid" @click="joinNow">{{ busy && mode === 'join' ? '连接中…' : '加入房间' }}</button>
          </div>
          <p class="connection-muted">加入成功（引擎给出本地地址）后，地址会显示在上方「连接状态」。</p>
        </div>
      </div>
    </ConnectionPanel>

    <!-- 参考信息区：默认折叠 -->
    <details class="connection-details reference-details">
      <summary>关于陶瓦联机</summary>
      <div class="connection-detail-content">
        <p>陶瓦联机（Terracotta）是 burningtnt（GitHub burningtnt/Terracotta）维护的独立开源联机项目，基于 EasyTier、AGPL-3.0 协议。</p>
        <p>首次使用会自动下载官方 0.4.2 二进制并做 SHA-256 校验；极端 NAT 环境下成功率较高。</p>
        <p>房间码为官方四段格式 U/XXXX-XXXX-XXXX-XXXX，与陶瓦官方工具互通。</p>
      </div>
    </details>

    <!-- 日志区：窄、默认收起 -->
    <details class="connection-details log-details">
      <summary>陶瓦引擎日志（{{ logs.length }} 条）</summary>
      <div class="log-tools"><button class="btn btn-ghost copy-mini" :disabled="!logs.length" @click="copyLogs">复制日志</button></div>
      <div ref="logViewport" class="connection-log-viewport" aria-live="polite" tabindex="0">
        <p v-for="(l, i) in logs" :key="i" class="connection-log-line"><span class="log-ts">{{ l.ts }}</span>{{ l.text }}</p>
        <p v-if="!logs.length" class="connection-muted">暂无日志。</p>
      </div>
    </details>
  </div>
</template>
<style scoped>
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
</style>
