<script setup lang="ts">
/**
 * MOD 实时配置面板：通过 KAMUCL Bridge 桥接 MOD 展示与修改参数。
 * MOD 声明参数元数据（名称/说明/分组/类型/默认值/范围/生效方式），
 * 这里自动生成开关、滑块、输入框或下拉选项；以 MOD 返回的实际结果为准。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { bridgeInstall, bridgeInstalled, bridgeManifest, bridgeReset, bridgeSet, bridgeStatus, errText } from '../api'
import { refreshInstalled, store, toast } from '../store'
import SelectMenu from '../components/SelectMenu.vue'
import type { BridgeParam, BridgeStatus } from '@shared/types'

/** 面板面向正在运行的实例（游戏在哪台实例上跑就配置哪台）；未运行时跟随首页选中实例 */
const currentVersion = computed(() => {
  const list = store.installed
  if (!list.length) return null
  const runningId = store.launchingVersionId
  if (runningId && store.launchState?.status === 'running') {
    const running = list.find((v) => v.id === runningId)
    if (running) return running
  }
  return list.find((v) => v.id === store.selectedId) ?? list[0]
})

const status = ref<BridgeStatus | null>(null)
const params = ref<BridgeParam[]>([])
const loadingManifest = ref(false)
const search = ref('')
const itemError = ref<Record<string, string>>({})
const noticeShown = ref<Record<string, string>>({})
let pollTimer: ReturnType<typeof setInterval> | undefined

/** 实例 mods 目录是否已有桥接 MOD（决定显示"安装桥接 MOD"按钮） */
const bridgePresent = ref(true)
const installingBridge = ref(false)

async function refreshBridgePresent() {
  const v = currentVersion.value
  if (!v) { bridgePresent.value = true; return }
  try {
    bridgePresent.value = await bridgeInstalled(v.id)
  } catch {
    bridgePresent.value = true
  }
}

async function onInstallBridge() {
  const v = currentVersion.value
  if (!v || installingBridge.value) return
  installingBridge.value = true
  try {
    const result = await bridgeInstall(v.id)
    if (result.ok) {
      bridgePresent.value = true
      toast(result.already ? '桥接 MOD 已在实例中' : '桥接 MOD 已装入实例，启动游戏后自动接入', 'success')
    } else {
      toast('安装失败：' + (result.error ?? ''), 'error')
    }
  } catch (e) {
    toast('安装失败：' + errText(e), 'error')
  } finally {
    installingBridge.value = false
  }
}

const gameRunning = computed(() => store.launchState?.status === 'running')

async function refreshStatus() {
  const v = currentVersion.value
  if (!v) { status.value = { connected: false, reason: '未选择实例' }; return }
  try {
    status.value = await bridgeStatus(v.id)
  } catch {
    status.value = { connected: false, reason: '桥接状态检查失败' }
  }
}

async function loadManifest() {
  const v = currentVersion.value
  if (!v || loadingManifest.value) return
  loadingManifest.value = true
  try {
    const manifest = await bridgeManifest(v.id)
    params.value = manifest.params
  } catch (e) {
    params.value = []
    if (status.value?.connected) toast('读取参数清单失败：' + errText(e), 'error')
  } finally {
    loadingManifest.value = false
  }
}

async function poll() {
  // 页面隐藏时暂停轮询，回到页面后下一轮自动恢复，避免后台空转
  if (document.hidden) return
  const wasConnected = status.value?.connected === true
  await refreshStatus()
  if (status.value?.connected && !wasConnected) await loadManifest()
  if (status.value?.connected && !params.value.length && !loadingManifest.value) await loadManifest()
}

watch(currentVersion, () => {
  params.value = []
  void refreshBridgePresent()
  void poll()
})

onMounted(async () => {
  if (!store.installed.length) await refreshInstalled()
  await refreshBridgePresent()
  await poll()
  pollTimer = setInterval(() => void poll(), 3000)
})
onUnmounted(() => clearInterval(pollTimer))

/** 按 MOD → 分组聚合参数；搜索即时过滤（名称/说明/分组） */
const groupedParams = computed(() => {
  const kw = search.value.trim().toLowerCase()
  const match = (p: BridgeParam) =>
    !kw || p.label.toLowerCase().includes(kw) || p.description.toLowerCase().includes(kw) ||
    p.group.toLowerCase().includes(kw) || p.modId.toLowerCase().includes(kw)
  const byMod = new Map<string, Map<string, BridgeParam[]>>()
  for (const p of params.value.filter(match)) {
    if (!byMod.has(p.modId)) byMod.set(p.modId, new Map())
    const groups = byMod.get(p.modId)!
    if (!groups.has(p.group)) groups.set(p.group, [])
    groups.get(p.group)!.push(p)
  }
  return [...byMod.entries()].map(([modId, groups]) => ({
    modId,
    groups: [...groups.entries()].map(([group, items]) => ({ group, items }))
  }))
})

const APPLY_HINT: Record<BridgeParam['apply'], string> = {
  INSTANT: '',
  RELOAD_RESOURCES: '需重载资源',
  REJOIN_WORLD: '需重进世界',
  RESTART_GAME: '需重启游戏'
}

async function applyParam(p: BridgeParam, value: unknown) {
  const v = currentVersion.value
  if (!v) return
  delete itemError.value[p.id]
  const result = await bridgeSet(v.id, p.id, value)
  if (result.ok) {
    p.value = result.value
    if (result.notice) {
      noticeShown.value[p.id] = result.notice
      toast(result.notice, 'info')
    }
  } else {
    itemError.value[p.id] = result.error ?? '修改失败'
  }
}

async function resetParam(p: BridgeParam) {
  const v = currentVersion.value
  if (!v) return
  const result = await bridgeReset(v.id, p.id)
  if (result.ok) {
    p.value = p.defaultValue
    delete itemError.value[p.id]
    toast(`「${p.label}」已恢复默认`, 'success')
  } else {
    itemError.value[p.id] = result.error ?? '恢复失败'
  }
}

async function resetAll() {
  const v = currentVersion.value
  if (!v) return
  const result = await bridgeReset(v.id)
  if (result.ok) {
    await loadManifest()
    toast('已恢复全部默认配置', 'success')
  } else {
    toast('恢复失败：' + (result.error ?? ''), 'error')
  }
}

function isModified(p: BridgeParam): boolean {
  return JSON.stringify(p.value) !== JSON.stringify(p.defaultValue)
}
</script>

<template>
  <div class="page bridge-page">
    <div class="page-head">
      <h1 class="page-title">MOD 面板</h1>
      <p class="page-sub">游戏运行期间实时读取与修改 MOD 参数；以 MOD 返回的实际结果为准</p>
    </div>

    <!-- 连接状态 -->
    <div class="card bridge-status" :class="{ connected: status?.connected }">
      <span class="bridge-dot" :class="{ on: status?.connected }"></span>
      <div class="bridge-status-text">
        <strong>{{ status?.connected ? `已连接桥接 MOD（v${status.modVersion || '?'}）` : '未接入桥接 MOD' }}</strong>
        <span class="muted">
          <template v-if="status?.connected">实例「{{ currentVersion?.id }}」 · 参数修改即时下发</template>
          <template v-else-if="!gameRunning">{{ status?.reason || '游戏未运行' }}。启动游戏后自动接入。</template>
          <template v-else>{{ status?.reason || '等待桥接服务' }}</template>
        </span>
      </div>
      <button class="btn btn-ghost btn-sm" @click="poll">刷新状态</button>
      <button
        v-if="!status?.connected && !bridgePresent"
        class="btn btn-gold btn-sm"
        :disabled="installingBridge || !currentVersion?.loader"
        :title="currentVersion?.loader ? '把内置 KAMUCL Bridge 装入当前实例的 mods 目录，下次启动游戏自动接入' : '当前实例是纯净版，不加载 MOD'"
        @click="onInstallBridge"
      >{{ installingBridge ? '安装中…' : '安装桥接 MOD' }}</button>
      <button v-if="status?.connected && params.length" class="btn btn-ghost btn-sm" @click="resetAll">全部恢复默认</button>
    </div>

    <!-- 参数区 -->
    <template v-if="status?.connected">
      <div v-if="params.length" class="bridge-toolbar">
        <input v-model="search" class="input bridge-search" placeholder="搜索参数名称、说明、分组…" />
      </div>
      <div v-if="loadingManifest" class="card empty"><span class="spin"></span><span>正在读取参数清单…</span></div>
      <template v-else>
        <div v-for="mod in groupedParams" :key="mod.modId" class="bridge-mod">
          <div v-for="group in mod.groups" :key="group.group" class="card bridge-card">
            <div class="bridge-card-head">
              <strong>{{ group.group }}</strong>
              <span class="muted">{{ mod.modId }}</span>
            </div>
            <div v-for="p in group.items" :key="p.id" class="bridge-row" :class="{ disabled: !p.visible || p.scope === 'SERVER' }">
              <div class="bridge-row-info">
                <span class="bridge-label">
                  {{ p.label }}
                  <span v-if="APPLY_HINT[p.apply]" class="tag bridge-apply-tag">{{ APPLY_HINT[p.apply] }}</span>
                  <span v-if="p.scope === 'SERVER'" class="tag bridge-scope-tag" title="服务器参数：必须由服务端校验权限，本地接口只读">服务器</span>
                </span>
                <span v-if="p.description" class="muted bridge-desc">{{ p.description }}</span>
                <span v-if="itemError[p.id]" class="bridge-error">{{ itemError[p.id] }}</span>
              </div>
              <div class="bridge-control">
                <label v-if="p.kind === 'SWITCH'" class="switch">
                  <input
                    type="checkbox"
                    :checked="p.value === true"
                    :disabled="!p.visible || p.scope === 'SERVER'"
                    @change="applyParam(p, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="switch-ui"></span>
                </label>
                <template v-else-if="p.kind === 'SLIDER'">
                  <input
                    type="range"
                    class="bridge-slider"
                    :min="p.min ?? 0"
                    :max="p.max ?? 100"
                    :step="p.step ?? 1"
                    :value="Number(p.value)"
                    :disabled="!p.visible || p.scope === 'SERVER'"
                    @change="applyParam(p, Number(($event.target as HTMLInputElement).value))"
                  />
                  <span class="bridge-slider-value">{{ p.value }}</span>
                </template>
                <input
                  v-else-if="p.kind === 'TEXT'"
                  class="input bridge-text"
                  :value="String(p.value ?? '')"
                  :disabled="!p.visible || p.scope === 'SERVER'"
                  @change="applyParam(p, ($event.target as HTMLInputElement).value)"
                />
                <SelectMenu
                  v-else
                  class="bridge-select"
                  :model-value="String(p.value ?? '')"
                  :options="(p.options ?? []).map((o) => ({ value: o, label: o }))"
                  :disabled="!p.visible || p.scope === 'SERVER'"
                  @change="(v) => applyParam(p, v)"
                />
                <button
                  v-if="isModified(p)"
                  class="bridge-reset"
                  title="恢复默认"
                  :disabled="p.scope === 'SERVER'"
                  @click="resetParam(p)"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 4v5h5"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div v-if="params.length && !groupedParams.length" class="card empty"><span>没有匹配「{{ search }}」的参数</span></div>
        <div v-if="!params.length && !loadingManifest" class="card empty"><span>桥接 MOD 没有注册任何参数</span></div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.bridge-page { max-width: 860px; }
.bridge-status { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-4) var(--card-pad); flex-wrap: wrap; }
.bridge-status.connected { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.bridge-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--text-dim); flex-shrink: 0; }
/* 已连接状态点：呼吸脉冲 */
.bridge-dot.on { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); animation: bridge-pulse 2.2s ease-in-out infinite; }
@keyframes bridge-pulse {
  0%, 100% { box-shadow: 0 0 0 3px var(--ok-soft); }
  50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--ok) 10%, transparent); }
}
/* 观感修正：文字行距/元素间距从 2px 提到令牌档，避免与边框/控件贴死 */
.bridge-status-text { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: var(--space-1); }
.bridge-status-text strong { font-size: var(--text-sm); }
.bridge-status-text .muted { font-size: var(--text-xs); }
.bridge-toolbar { display: flex; }
.bridge-search { flex: 1; }
.bridge-mod { display: flex; flex-direction: column; gap: var(--card-gap); }
.bridge-card { padding: var(--space-4) var(--card-pad) var(--space-4); transition: transform 0.18s ease, box-shadow 0.22s ease, border-color 0.18s ease; }
.bridge-card:hover { transform: translateY(-2px); box-shadow: 0 10px 26px color-mix(in srgb, var(--accent) 10%, transparent); border-color: var(--border-strong); }
.bridge-card-head { display: flex; align-items: baseline; gap: var(--space-3); padding: 0 0 var(--space-3); border-bottom: 1px solid var(--border); margin-bottom: var(--space-2); }
.bridge-card-head strong { font-size: var(--text-sm); font-weight: 700; }
.bridge-card-head .muted { font-size: var(--text-xs); }
.bridge-row { display: flex; align-items: center; gap: var(--space-4); min-height: var(--row-h); padding: var(--space-3) 0; }
.bridge-row + .bridge-row { border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent); }
.bridge-row.disabled .bridge-row-info { opacity: 0.55; }
.bridge-row-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.bridge-label { font-size: var(--text-sm); font-weight: 600; display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.bridge-desc { font-size: var(--text-xs); }
.bridge-error { font-size: var(--text-xs); color: var(--danger); }
.bridge-apply-tag { font-size: var(--text-xs); padding: 1px var(--space-2); }
.bridge-scope-tag { font-size: var(--text-xs); padding: 1px var(--space-2); }
.bridge-control { display: flex; align-items: center; gap: var(--space-3); flex-shrink: 0; }
.bridge-slider { width: 150px; accent-color: var(--accent); }
.bridge-slider-value { min-width: 44px; text-align: right; font-size: var(--text-xs); color: var(--text-dim); font-variant-numeric: tabular-nums; }
.bridge-text { width: 200px; }
.bridge-select { width: 160px; }
.bridge-reset {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border: none; border-radius: var(--radius-sm);
  background: transparent; color: var(--text-dim); cursor: pointer;
}
.bridge-reset:hover { color: var(--accent-2); background: var(--hover); }
.bridge-reset svg { width: 13px; height: 13px; }
</style>
