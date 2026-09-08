<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import ConnectionPanel from './ConnectionPanel.vue'
import ConnectionStatus from './ConnectionStatus.vue'
import { toast } from '../../store'
import { copyText } from '../../api'

interface LobbyRoom { code: string; name: string; currentPlayers?: number; maxPlayers?: number; hasPassword?: boolean; category?: string; gameVersion?: string; loader?: string; clientTag?: string; natType?: string }
interface RoomInfo { code: string; name: string; currentPlayers: number; maxPlayers: number; isHost: boolean; gameVersion?: string; loader?: string }
interface Snapshot { state: string; room: RoomInfo | null; session: { state: string; code: string; isHost: boolean; room: RoomInfo | null }; settings: { allowRelay: boolean; theme: string } }
/** 引擎 stage 事件（voxlink/engine.ts emitStage）：阶段条唯一数据源，禁止前端自演进度 */
interface StageEvent { key: 'stun' | 'punch' | 'relay' | 'host_stun' | 'host_punch'; status: 'active' | 'retry' | 'ok' | 'degraded' | 'fail'; detail: string; ts: number }
/** 引擎 conn:state 事件：phase = p2p | direct | prelay */
interface ConnStateEvent { phase?: string; status?: string; address?: string; detail?: string }

const state = ref<Snapshot | null>(null)
const busy = ref(false)
const error = ref('')
const logs = ref<Array<{ ts: string; text: string }>>([])

// 主操作区页内 Tab：创建房间 / 加入房间 / 公共大厅 分开，避免同屏拥挤
const tab = ref<'host' | 'join' | 'lobby'>('host')
function switchTab(next: 'host' | 'join' | 'lobby'): void {
  tab.value = next
  if (next === 'lobby' && !rooms.value.length) void loadLobby()
}

// 创建房间
const roomName = ref('KAMUCL 房间')
const isPublic = ref(true)
// 加入房间
const joinCode = ref('')
// 大厅
const rooms = ref<LobbyRoom[]>([])
const search = ref('')
const loadingLobby = ref(false)

/**
 * MC 手填地址：只有隧道真正建立（conn:state success）后才有值。
 * - phase=p2p：detail 中的本地代理 127.0.0.1:端口
 * - phase=direct：房主公网地址（直连探测成功才给出）
 * - phase=prelay：玩家中继本地桥 127.0.0.1:端口
 * 它是「已连接」的唯一判定，绝不因「已加入房间」而置位。
 */
const mcAddress = ref('')
const mcPhase = ref('')
const conn = ref<ConnStateEvent | null>(null)
/** 阶段事件表（key → 最新事件） */
const stageMap = ref<Record<string, StageEvent>>({})
/** 各阶段耗时（秒）：由真实事件时间戳计算 */
const stageSeconds = ref<Record<string, number>>({})
/** UDP 打洞开始时刻（真实事件 ts），驱动 20 秒后出现手动后备 */
const punchStartTs = ref(0)
const relayTried = ref(false)
const directTried = ref(false)
const nowTick = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | undefined

const connected = computed(() => mcAddress.value !== '')
const sessionState = computed(() => state.value?.state ?? 'idle')
const joined = computed(() => sessionState.value === 'hosting' || sessionState.value === 'in_room')
const sessionClosed = computed(() => sessionState.value === 'closed')
const isHost = computed(() => !!state.value?.session?.isHost)
const punchStage = computed(() => stageMap.value[isHost.value ? 'host_punch' : 'punch'])
const stunStage = computed(() => stageMap.value[isHost.value ? 'host_stun' : 'stun'])
const relayStage = computed(() => stageMap.value.relay)
const punching = computed(() => joined.value && !connected.value && !!punchStage.value && (punchStage.value.status === 'active' || punchStage.value.status === 'retry'))
const punchElapsed = computed(() => punchStartTs.value > 0 ? Math.max(0, Math.floor((nowTick.value - punchStartTs.value) / 1000)) : 0)
/** 打洞持续约 20 秒未成功 → 出现「尝试直连」「使用玩家中继」（时刻取自真实引擎事件） */
const fallbackVisible = computed(() => punching.value && punchStartTs.value > 0 && nowTick.value - punchStartTs.value >= 20_000)

/** 状态区徽标：由会话与隧道真实状态推导（文案不含「已连接」，判定以 mcAddress 为准） */
const overallTone = computed<'neutral' | 'success' | 'danger' | 'pending'>(() => {
  if (sessionClosed.value) return 'danger'
  if (connected.value) return 'success'
  if (joined.value) return 'pending'
  return 'neutral'
})
const overallLabel = computed(() => {
  if (sessionClosed.value) return '会话已结束'
  if (connected.value) return '数据隧道已建立'
  if (joined.value) return '连接进行中'
  return '尚未开始'
})

interface Step { key: string; label: string; state: 'done' | 'active' | 'pending' | 'fail' | 'degraded'; detail?: string; seconds?: number }
const stepState = (st: StageEvent | undefined, done: boolean): 'done' | 'active' | 'pending' | 'fail' | 'degraded' => {
  if (done) return 'done'
  if (!st) return 'pending'
  if (st.status === 'ok') return 'done'
  if (st.status === 'fail') return 'fail'
  if (st.status === 'degraded') return 'degraded'
  return 'active'
}
/** 连接过程阶段条：全部由引擎真实事件（stage / conn:state / 会话状态）驱动 */
const steps = computed<Step[]>(() => {
  if (!joined.value) return []
  const list: Step[] = []
  list.push({ key: 'join', label: isHost.value ? '创建房间' : '加入房间', state: 'done', detail: state.value?.room?.name })
  list.push({
    key: isHost.value ? 'host_stun' : 'stun',
    label: 'NAT 探测（STUN）',
    state: stepState(stunStage.value, false),
    detail: stunStage.value?.detail,
    seconds: stageSeconds.value[isHost.value ? 'host_stun' : 'stun']
  })
  list.push({
    key: isHost.value ? 'host_punch' : 'punch',
    label: isHost.value ? '等待房客打洞' : 'UDP 打洞',
    state: stepState(punchStage.value, connected.value),
    detail: punching.value ? `已进行 ${punchElapsed.value} 秒` : punchStage.value?.detail,
    seconds: stageSeconds.value[isHost.value ? 'host_punch' : 'punch']
  })
  if (!isHost.value && (relayTried.value || relayStage.value)) {
    list.push({
      key: 'relay',
      label: '玩家中继（后备）',
      state: stepState(relayStage.value, connected.value && mcPhase.value === 'prelay'),
      detail: relayStage.value?.detail,
      seconds: stageSeconds.value.relay
    })
  }
  list.push({
    key: 'tunnel',
    label: isHost.value ? '房客隧道建立' : '数据隧道建立',
    state: connected.value ? 'done' : punching.value ? 'active' : 'pending',
    detail: connected.value ? '隧道已建立' : undefined
  })
  return list
})

let offEvent: (() => void) | undefined

/** 消敏：远程地址/中继节点地址不写入日志（本地 127.0.0.1:端口 除外，那是用户要填的） */
function sanitizeLog(text: string): string {
  return text
    .replace(/(\d{1,3}\.){3}\d{1,3}:\d+/g, (m) => (m.startsWith('127.0.0.1') ? m : '***:***'))
    .replace(/(\d{1,3}\.){3}\d{1,3}/g, (m) => (m === '127.0.0.1' ? m : '***'))
}

function pushLog(text: string): void {
  const d = new Date()
  const ts = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
  logs.value.push({ ts, text: sanitizeLog(text) })
  if (logs.value.length > 300) logs.value.shift()
  requestAnimationFrame(scrollLogBottom)
}

const logViewport = ref<HTMLElement | null>(null)
function scrollLogBottom(): void {
  const el = logViewport.value
  if (el) el.scrollTop = el.scrollHeight
}
async function copyLogs(): Promise<void> {
  const text = logs.value.map((l) => `[${l.ts}] ${l.text}`).join('\n')
  toast(await copyText(text) ? '日志已复制' : '复制失败', 'info')
}

function resetConn(): void {
  mcAddress.value = ''
  mcPhase.value = ''
  conn.value = null
  stageMap.value = {}
  stageSeconds.value = {}
  punchStartTs.value = 0
  relayTried.value = false
  directTried.value = false
}

function onStage(s: StageEvent): void {
  const prev = stageMap.value[s.key]
  if ((s.status === 'active' || s.status === 'retry') && !prev) stageSeconds.value = { ...stageSeconds.value, [s.key]: 0 }
  if (s.status === 'ok' && prev && (prev.status === 'active' || prev.status === 'retry')) {
    const sec = Math.max(1, Math.round((s.ts - prev.ts) / 1000))
    stageSeconds.value = { ...stageSeconds.value, [s.key]: sec }
  }
  stageMap.value = { ...stageMap.value, [s.key]: s }
  if (s.key === 'punch' && s.status === 'active' && !punchStartTs.value) punchStartTs.value = s.ts
  if (s.key === 'relay' && s.status === 'active') relayTried.value = true
  pushLog(`[阶段] ${s.detail}`)
}

function onConnState(d: ConnStateEvent): void {
  conn.value = d
  if (d?.status === 'success') {
    if (d.phase === 'direct') {
      // 直连成功：MC 手填地址 = 房主公网地址（远程地址只出现在连接指引，不进日志）
      mcAddress.value = (d.address ?? '').trim()
      mcPhase.value = 'direct'
      pushLog('[连接:direct] 直连探测成功，目标地址见「连接成功」区块')
    } else {
      const m = /127\.0\.0\.1:\d+/.exec(`${d.detail ?? ''} ${d.address ?? ''}`)
      mcAddress.value = m ? m[0] : ''
      mcPhase.value = d.phase ?? ''
      pushLog(`[连接:${d.phase}] 数据隧道建立成功${mcAddress.value ? '，本地地址已生成' : ''}`)
    }
    return
  }
  if (d?.status === 'trying') {
    if (d.phase === 'direct') { directTried.value = true; pushLog('[连接:direct] 正在尝试直连探测…') }
    if (d.phase === 'prelay') relayTried.value = true
    return
  }
  if (d?.status === 'failed') {
    // 只清掉同一 phase 建立的地址：直连失败不能推翻已建好的 p2p 隧道
    if (mcPhase.value === d.phase) { mcAddress.value = ''; mcPhase.value = '' }
    pushLog(`[连接:${d.phase ?? '?'}] 失败 ${d.detail ?? ''}`)
  }
}

function onEvent(payload: { type: string; data: unknown }): void {
  if (payload.type === 'state') {
    state.value = payload.data as Snapshot
    if (sessionState.value === 'idle') resetConn()
    return
  }
  if (payload.type === 'log') {
    const d = payload.data as { level: string; msg: string }
    if (d?.msg) pushLog(`[${d.level}] ${d.msg}`)
    return
  }
  if (payload.type === 'stage') { onStage(payload.data as StageEvent); return }
  if (payload.type === 'conn:state') { onConnState(payload.data as ConnStateEvent); return }
  if (payload.type === 'bridge') pushLog(`[bridge] ${JSON.stringify(payload.data)}`)
}

async function call<T>(channel: string, payload?: unknown): Promise<T | undefined> {
  try { return await window.kamucl.invoke(channel, payload) } catch (e) { error.value = (e as Error).message?.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') ?? '操作失败'; return undefined }
}

async function startHost(): Promise<void> {
  busy.value = true; error.value = ''
  const r = await call<{ ok: boolean }>('voxlink:start', { mode: 'host', roomName: roomName.value, isPublic: isPublic.value })
  if (r?.ok) await status()
  busy.value = false
}
async function startJoin(code: string): Promise<void> {
  const c = code.trim().toUpperCase()
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(c)) { error.value = 'VoxLink 房间码为 6 位字符（不含 I、L、O、0、1）'; return }
  busy.value = true; error.value = ''; resetConn()
  const r = await call<{ ok: boolean }>('voxlink:start', { mode: 'join', code: c })
  if (r?.ok) await status()
  busy.value = false
}
async function stop(): Promise<void> {
  busy.value = true
  await call('voxlink:stop')
  resetConn()
  await status()
  busy.value = false
}
async function status(): Promise<void> {
  const s = await call<Snapshot>('voxlink:status')
  if (s) state.value = s
}
async function loadLobby(): Promise<void> {
  loadingLobby.value = true
  const r = await call<{ rooms: LobbyRoom[] }>('voxlink:lobby', { search: search.value || undefined, size: 50 })
  if (r) rooms.value = r.rooms ?? []
  loadingLobby.value = false
}
async function toggleRelay(): Promise<void> {
  if (!state.value) return
  const allowRelay = await call<{ allowRelay: boolean }>('voxlink:settings', { allowRelay: !state.value.settings.allowRelay })
  if (allowRelay) state.value.settings.allowRelay = allowRelay.allowRelay
}
/** 手动后备 1：直连探测（app-desktop TryDirect） */
async function tryDirect(): Promise<void> {
  if (directTried.value) return
  const r = await call<{ ok: boolean; err?: string }>('voxlink:tryDirect')
  if (r && !r.ok) error.value = r.err ?? '直连探测无法启动'
  directTried.value = true
}
/** 手动后备 2：玩家中继（app-desktop UsePlayerRelay） */
async function useRelay(): Promise<void> {
  if (relayTried.value) return
  const r = await call<{ ok: boolean; err?: string }>('voxlink:usePlayerRelay')
  if (r && !r.ok) error.value = r.err ?? '玩家中继无法启动'
  relayTried.value = true
}
async function copy(value?: string | null): Promise<void> {
  if (value) toast(await copyText(value) ? '已复制' : '复制失败', 'info')
}

onMounted(async () => {
  offEvent = window.kamucl.on('voxlink:event', onEvent)
  await status()
  if (sessionState.value === 'idle') await loadLobby()
  // 仅用于把真实事件的耗时换算成秒，不是进度动画
  tickTimer = setInterval(() => { nowTick.value = Date.now() }, 1000)
})
onUnmounted(() => { offEvent?.(); if (tickTimer) clearInterval(tickTimer) })
</script>

<template>
  <div class="voxlink-page">
    <!-- 状态区：会话状态 + 房间码 + 连接过程阶段条 -->
    <ConnectionPanel title="连接状态" subtitle="房间与打洞全程由引擎真实事件驱动，这里只反映真实进度">
      <template #action><ConnectionStatus :tone="overallTone" :label="overallLabel" /></template>

      <div v-if="joined && state?.session.code" class="room-card" :class="{ ok: connected }">
        <p class="room-label">{{ isHost ? '你的房间码（发给好友）' : '已加入的房间码' }}</p>
        <p class="room-code"><code>{{ state.session.code.slice(0, 3) + ' ' + state.session.code.slice(3) }}</code><button class="btn btn-ghost copy-mini" @click="copy(state?.session.code)">复制</button></p>
        <p class="connection-muted">把 6 位房间码发给好友。好友输入房间码后会自动开始打洞；打通后好友仍需在自己游戏的「多人游戏 → 直接连接」手动填入地址完成加入。</p>
        <p class="connection-muted">房间心跳有效期 300 秒：双方必须同时在线，房间失效后需重新创建。</p>
        <p v-if="state?.room" class="connection-muted">房间：{{ state.room.name }} · {{ state.room.currentPlayers }}/{{ state.room.maxPlayers }} 人</p>
      </div>

      <ol v-if="steps.length" class="stage-bar" aria-label="连接过程">
        <li v-for="s in steps" :key="s.key" class="stage-item" :class="s.state">
          <span class="stage-dot" aria-hidden="true">{{ s.state === 'done' ? '✓' : s.state === 'fail' ? '×' : '' }}</span>
          <span class="stage-copy"><strong>{{ s.label }}</strong><small v-if="s.detail">{{ s.detail }}</small><small v-else-if="s.seconds !== undefined">耗时 {{ s.seconds }} 秒</small></span>
        </li>
      </ol>
      <p v-else class="connection-muted">当前没有进行中的连接。在下方选择「创建房间」「加入房间」或去「公共大厅」，这里会逐步展示 NAT 探测 → UDP 打洞 → 隧道建立的真实进度。</p>

      <p v-if="sessionClosed" class="connection-error" role="alert">会话已结束（房间可能过期或网络中断）。房间码 300 秒无心跳即失效，请双方同时在线后重新加入。</p>
      <p v-if="error" class="connection-error" role="alert">{{ error }}</p>
    </ConnectionPanel>

    <!-- 主操作区：创建 / 加入 / 大厅 用页内 Tab 分开 -->
    <ConnectionPanel title="开始联机" subtitle="三种入口分 Tab 展示，同一时间只做一件事">
      <div class="connect-tabs" role="tablist" aria-label="联机入口">
        <button class="connect-tab" :class="{ active: tab === 'host' }" role="tab" :aria-selected="tab === 'host'" @click="switchTab('host')">创建房间</button>
        <button class="connect-tab" :class="{ active: tab === 'join' }" role="tab" :aria-selected="tab === 'join'" @click="switchTab('join')">加入房间</button>
        <button class="connect-tab" :class="{ active: tab === 'lobby' }" role="tab" :aria-selected="tab === 'lobby'" @click="switchTab('lobby')">公共大厅</button>
      </div>

      <!-- 创建房间 -->
      <div v-if="tab === 'host'" class="tab-body">
        <template v-if="!joined">
          <label class="connection-field">房间名<input v-model="roomName" class="input" maxlength="32" placeholder="大厅里显示的名字" :disabled="busy" /></label>
          <label class="connection-toggle"><span>公开房间<small>出现在大厅列表，任何人可通过房间码加入</small></span><input v-model="isPublic" type="checkbox" :disabled="busy" /><span class="connection-toggle-track" aria-hidden="true"></span></label>
          <p class="connection-muted">先启动游戏并对局域网开放世界，VoxLink 会自动探测端口。创建后你会得到 6 位房间码（不含 I、L、O、0、1），显示在上方「连接状态」里。</p>
          <div class="connection-actions"><button class="btn btn-gold" :disabled="busy" @click="startHost">{{ busy ? '创建中…' : '创建房间' }}</button></div>
        </template>
        <template v-else>
          <div class="connection-result" aria-live="polite">
            <p>房间进行中，实时进度见上方「连接状态」。</p>
            <div class="connection-actions"><button class="btn btn-ghost" :disabled="busy" @click="stop">关闭房间</button></div>
          </div>
        </template>
      </div>

      <!-- 加入房间 -->
      <div v-else-if="tab === 'join'" class="tab-body">
        <template v-if="!joined">
          <label class="connection-field">房间码<input v-model="joinCode" class="input room-input" maxlength="7" placeholder="例如 ABC123" :disabled="busy" @keydown.enter="startJoin(joinCode)" /></label>
          <div class="connection-actions"><button class="btn btn-gold" :disabled="busy || joinCode.trim().length < 6" @click="startJoin(joinCode)">{{ busy ? '连接中…' : '加入房间' }}</button></div>
          <p class="connection-muted">主路径是 UDP 打洞 + STUN 的 P2P 直连，游戏数据不经服务器。输入房间码后会自动开始打洞，全程进度见上方「连接状态」。</p>
          <p class="connection-muted">双对称 NAT、校园网、手机热点下成功率较低；打洞约 20 秒未成功会出现「尝试直连」「使用玩家中继」手动后备，也可让双方重启游戏刷新 NAT 后再试。</p>
        </template>
        <template v-else-if="connected">
          <!-- 只有隧道真正建立、本地地址可用后才算「已连接」 -->
          <div class="connection-result success" aria-live="polite">
            <ConnectionStatus tone="success" label="已连接 · 数据隧道建立" />
            <p class="mc-address"><code>{{ mcAddress }}</code><button class="btn btn-ghost copy-mini" @click="copy(mcAddress)">复制地址</button></p>
            <ol class="join-guide">
              <li>打开 Minecraft（与房主相同的实例与版本）</li>
              <li>进入「多人游戏」→「直接连接」</li>
              <li>粘贴上方地址</li>
              <li>点击「加入服务器」</li>
            </ol>
            <p class="connection-muted">连接方式 <code>{{ mcPhase === 'prelay' ? '玩家中继' : mcPhase === 'direct' ? '直连' : 'P2P 打洞' }}</code>；地址{{ mcPhase === 'direct' ? '为房主公网地址' : '为本机隧道入口（127.0.0.1）' }}。</p>
            <div class="connection-actions"><button class="btn btn-ghost" :disabled="busy" @click="stop">离开房间</button></div>
          </div>
        </template>
        <template v-else-if="!isHost">
          <!-- 打洞进行中：绝不显示「已连接」 -->
          <div class="connection-result" aria-live="polite">
            <ConnectionStatus tone="pending" label="房间已加入，正在建立 P2P 连接…" />
            <p v-if="conn?.phase" class="connection-muted">当前阶段：{{ conn.phase === 'prelay' ? '玩家中继' : conn.phase === 'direct' ? '直连探测' : 'P2P 打洞' }}{{ punching ? ` · 已进行 ${punchElapsed} 秒` : '' }}</p>
            <p v-if="fallbackVisible" class="connection-muted">打洞已持续约 {{ punchElapsed }} 秒仍未命中。双对称 NAT / 校园网 / 手机热点成功率较低，可尝试手动后备，或让双方重启游戏刷新 NAT。</p>
            <div v-if="fallbackVisible" class="connection-actions">
              <button class="btn" :disabled="directTried" @click="tryDirect">{{ directTried ? '直连探测中/已探测' : '尝试直连' }}</button>
              <button class="btn" :disabled="relayTried" @click="useRelay">{{ relayTried ? '中继请求中/已请求' : '使用玩家中继' }}</button>
            </div>
            <div class="connection-actions"><button class="btn btn-ghost" :disabled="busy" @click="stop">离开房间</button></div>
          </div>
        </template>
        <template v-else>
          <div class="connection-result" aria-live="polite">
            <p>你是房主，等待房客加入即可；进度见上方「连接状态」。</p>
            <div class="connection-actions"><button class="btn btn-ghost" :disabled="busy" @click="stop">关闭房间</button></div>
          </div>
        </template>
      </div>

      <!-- 公共大厅 -->
      <div v-else class="tab-body">
        <div class="lobby-bar">
          <label class="connection-field lobby-search">搜索<input v-model="search" class="input" placeholder="按房间名搜索" @keydown.enter="loadLobby" /></label>
          <button class="btn btn-ghost" :disabled="loadingLobby" @click="loadLobby">{{ loadingLobby ? '刷新中…' : '刷新' }}</button>
        </div>
        <p v-if="!rooms.length && !loadingLobby" class="connection-muted">大厅暂时没有公开房间。</p>
        <ul v-else class="lobby-list">
          <li v-for="room in rooms" :key="room.code" class="lobby-item">
            <div class="lobby-main">
              <strong>{{ room.name }}</strong>
              <span v-if="room.clientTag === 'kamucl'" class="kamucl-badge" title="此房间由 KAMUCL 启动器创建">KAMUCL 启动器创建</span>
              <small>{{ [room.gameVersion, room.loader, room.category].filter(Boolean).join(' · ') }}</small>
            </div>
            <div class="lobby-side">
              <span class="connection-muted">{{ room.currentPlayers ?? '?' }}/{{ room.maxPlayers ?? '?' }} 人</span>
              <button class="btn btn-gold" :disabled="busy || joined" @click="startJoin(room.code)">加入</button>
            </div>
          </li>
        </ul>
      </div>
    </ConnectionPanel>

    <!-- 参考信息区：默认折叠 -->
    <details class="connection-details reference-details">
      <summary>联机说明与中继设置</summary>
      <div class="connection-detail-content">
        <label class="connection-toggle"><span>允许为他人提供中继<small>关闭后不再为别人中继，但自己也无法使用玩家中继</small></span><input type="checkbox" :checked="state?.settings.allowRelay ?? true" :disabled="!!state && sessionState !== 'idle'" @change="toggleRelay" /><span class="connection-toggle-track" aria-hidden="true"></span></label>
        <p>主路径是 UDP 打洞 + STUN 的 P2P 直连，游戏数据不经服务器；打洞约 20 秒未成功时，可手动选择「尝试直连」或「使用玩家中继」两种后备路径，两者都由引擎真实事件驱动。</p>
        <p>打通后需要在游戏「多人游戏 → 直接连接」中手动填入本地地址完成加入——启动器不会替你点最后一下。</p>
      </div>
    </details>

    <!-- 日志区：窄、默认收起 -->
    <details class="connection-details log-details">
      <summary>实时日志（{{ logs.length }} 条）</summary>
      <div class="log-tools"><button class="btn btn-ghost copy-mini" :disabled="!logs.length" @click="copyLogs">复制日志</button></div>
      <div ref="logViewport" class="connection-log-viewport" aria-live="polite" tabindex="0">
        <p v-for="(l, i) in logs" :key="i" class="connection-log-line"><span class="log-ts">{{ l.ts }}</span>{{ l.text }}</p>
        <p v-if="!logs.length" class="connection-muted">暂无日志。</p>
      </div>
    </details>
  </div>
</template>
<style scoped>
.voxlink-page { display: flex; flex-direction: column; gap: var(--sec-gap); min-width: 0; }
.room-card {
  display: flex; flex-direction: column; gap: var(--space-2);
  padding: var(--card-pad); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card-2);
}
.room-card.ok { border-color: color-mix(in srgb, var(--ok) 40%, var(--border)); }
.room-label { font-size: var(--text-xs); font-weight: 600; color: var(--text-dim); }
.room-code { display: inline-flex; align-items: center; gap: var(--space-3); font-size: var(--text-2xl); letter-spacing: 0.12em; margin: var(--space-1) 0; min-height: var(--row-h); }
.room-code code { font-weight: 700; }
.room-input { text-transform: uppercase; letter-spacing: 0.2em; font-weight: 600; }
.copy-mini { padding: var(--space-1) var(--space-3); font-size: var(--text-xs); min-height: 28px; }
.mc-address { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); font-size: var(--text-lg); min-height: var(--row-h); }
.mc-address code { font-weight: 700; overflow-wrap: anywhere; }
.join-guide { margin: 0; padding-left: var(--space-5); display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--text-xs); color: var(--text-dim); line-height: 1.8; }
.stage-bar { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2); }
.stage-item { display: flex; align-items: center; gap: var(--space-2); min-height: var(--row-h); padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card-2); }
.stage-item.active { border-color: color-mix(in srgb, var(--accent-2) 55%, var(--border)); }
.stage-item.fail { border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); }
.stage-item.done { border-color: color-mix(in srgb, var(--ok) 40%, var(--border)); }
.stage-dot { width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: var(--text-xs); font-weight: 700; background: var(--card); border: 1px solid var(--border-strong); flex: none; }
.stage-item.done .stage-dot { background: var(--ok-soft); color: var(--ok); border-color: transparent; }
.stage-item.active .stage-dot { background: var(--accent-soft); color: var(--accent-2); border-color: transparent; }
.stage-item.degraded .stage-dot { background: var(--accent-soft); color: var(--accent-2); border-color: transparent; }
.stage-item.fail .stage-dot { background: var(--danger-soft); color: var(--danger); border-color: transparent; }
.stage-copy { display: flex; flex-direction: column; min-width: 0; }
.stage-copy strong { font-size: var(--text-xs); font-weight: 600; }
.stage-copy small { color: var(--text-dim); font-size: var(--text-xs); }
.tab-body { display: flex; flex-direction: column; gap: var(--card-gap); }
.lobby-bar { display: flex; align-items: flex-end; gap: var(--space-3); flex-wrap: wrap; }
.lobby-search { max-width: 320px; }
.lobby-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
.lobby-item { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); min-height: var(--row-h); padding: var(--space-3) var(--space-4); border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--card-2); }
.lobby-main { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.lobby-main strong { font-size: var(--text-sm); }
.lobby-main small { color: var(--text-dim); font-size: var(--text-xs); }
.lobby-side { display: flex; align-items: center; gap: var(--space-3); flex-shrink: 0; }
.kamucl-badge { display: inline-block; padding: 1px var(--space-2); border-radius: 999px; font-size: var(--text-xs); border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent); color: var(--accent); }
.reference-details, .log-details { padding: var(--space-3) var(--space-4); }
.log-tools { display: flex; justify-content: flex-end; margin-top: var(--space-3); }
.log-ts { color: color-mix(in srgb, var(--text-dim) 70%, transparent); margin-right: var(--space-2); }
</style>
