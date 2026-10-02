<script setup lang="ts">
/**
 * MOD 实时配置面板：通过 KAMUCL Bridge 桥接 MOD 展示与修改参数。
 * MOD 声明参数元数据（名称/说明/分组/类型/默认值/范围/生效方式），
 * 这里自动生成开关、滑块、输入框或下拉选项；以 MOD 返回的实际结果为准。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { bridgeInstall, bridgeInstalled, bridgeManifest, bridgeReset, bridgeSet, bridgeStatus, errText } from '../api'
import { refreshInstalled, store, toast, selectedInstance, displayVersionName as versionLabel } from '../store'
import SelectMenu from '../components/SelectMenu.vue'
import type { BridgeParam, BridgeStatus } from '@shared/types'

/** 面板面向正在运行的实例（游戏在哪台实例上跑就配置哪台）；未运行时跟随首页选中实例 */
const currentVersion = selectedInstance

const status = ref<BridgeStatus | null>(null)
const params = ref<BridgeParam[]>([])
const loadingManifest = ref(false)
const search = ref('')
const itemError = ref<Record<string, string>>({})
const noticeShown = ref<Record<string, string>>({})
let pollTimer: ReturnType<typeof setInterval> | undefined

/** 实例 mods 目录是否已有桥接 MOD（决定显示"安装桥接 MOD"按钮） */
const bridgePresent = ref<boolean | null>(null)
const presenceError = ref('')
let presenceRequest=0, statusRequest=0, manifestRequest=0, disposed=false
const installingBridge = ref(false)

async function refreshBridgePresent() {
  const request=++presenceRequest, v=currentVersion.value
  bridgePresent.value=null; presenceError.value=''
  if (!v) return
  try { const result=await bridgeInstalled(v.id); if(request===presenceRequest)bridgePresent.value=result }
  catch(e) { if(request===presenceRequest)presenceError.value='无法确认桥接 MOD 是否已安装：'+errText(e) }
}

async function onInstallBridge() {
  const v = currentVersion.value
  if (!v || installingBridge.value) return
  installingBridge.value = true
  try {
    const result = await bridgeInstall(v.id)
    if (result.ok) {
      if(currentVersion.value===v && !disposed) bridgePresent.value = true
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
  const request=++statusRequest, v = currentVersion.value
  if (!v) { status.value = { connected: false, reason: '未选择实例' }; return }
  try {
    const next = await bridgeStatus(v.id); if(request===statusRequest)status.value=next
  } catch {
    if(request===statusRequest)status.value = { connected: false, reason: '桥接状态检查失败' }
  }
}

async function loadManifest() {
  const v = currentVersion.value
  if (!v || loadingManifest.value || disposed) return
  const request=++manifestRequest
  loadingManifest.value = true
  try {
    const manifest = await bridgeManifest(v.id)
    if(request===manifestRequest && !disposed) params.value = manifest.params
  } catch (e) {
    if(request!==manifestRequest || disposed)return
    params.value = []
    if (status.value?.connected) toast('读取参数清单失败：' + errText(e), 'error')
  } finally {
    if(request===manifestRequest) loadingManifest.value = false
  }
}

async function poll() {
  // 页面隐藏时暂停轮询，回到页面后下一轮自动恢复，避免后台空转
  if (document.hidden || disposed) return
  const wasConnected = status.value?.connected === true
  await refreshStatus()
  if (status.value?.connected && !wasConnected) await loadManifest()
  if (status.value?.connected && !params.value.length && !loadingManifest.value) await loadManifest()
}

watch(currentVersion, () => {
  ++statusRequest; ++manifestRequest
  status.value=null; loadingManifest.value=false; itemError.value={}; noticeShown.value={}
  params.value = []
  void refreshBridgePresent()
  void poll()
})

onMounted(async () => {
  if (!store.installed.length) await refreshInstalled()
  if(disposed)return
  await refreshBridgePresent()
  await poll()
  if(disposed)return
  pollTimer = setInterval(() => void poll(), 3000)
})
onUnmounted(() => { disposed=true; ++presenceRequest; ++statusRequest; ++manifestRequest; clearInterval(pollTimer) })

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
  <div data-ui="BridgeView:cfdb5a4d90a2" class="page bridge-page">
    <div data-ui="BridgeView:db609f258d77" class="page-head">
      <h1 data-ui="BridgeView:83a0b6c9508f" class="page-title">MOD 面板</h1>
      <p data-ui="BridgeView:bb8e2f3a040b" class="page-sub">游戏运行期间实时读取与修改 MOD 参数；以 MOD 返回的实际结果为准</p>
    </div>

    <div data-ui="BridgeView:b3265d72c149" class="card bridge-status" :class="{ connected: status?.connected }">
      <div class="bridge-context"><span>{{ currentVersion ? versionLabel(currentVersion) : '尚未选择游戏实例' }}</span><button class="btn btn-ghost btn-sm" :disabled="installingBridge" @click="refreshBridgePresent();poll()">刷新状态</button></div>
      <span data-ui="BridgeView:5325fe599383" class="bridge-dot" :class="{ on: status?.connected }"></span>
      <div data-ui="BridgeView:b1906759db96" class="bridge-status-text">
        <strong>{{ status?.connected ? `已连接桥接 MOD（v${status.modVersion || '?'}）` : !currentVersion ? '先选择游戏实例' : bridgePresent === false ? '尚未安装桥接 MOD' : bridgePresent === null ? '尚未确认安装状态' : gameRunning ? '等待游戏接入' : '启动游戏后自动接入' }}</strong>
        <span class="muted">{{ status?.connected ? '参数修改即时下发，以游戏返回结果为准。' : !currentVersion ? '选择已安装加载器的实例后，可安装桥接 MOD。' : bridgePresent === false ? '安装后启动游戏，即可调整支持的 MOD 参数。' : bridgePresent === null ? '请刷新确认安装情况，再进行操作。' : status?.reason || '前往首页启动游戏；此页面会自动检测连接。' }}</span>
        <p v-if="presenceError" class="connection-error" role="alert">{{ presenceError }}</p>
      </div>
      <div class="bridge-guide-actions">
        <button v-if="!status?.connected && bridgePresent === false" class="btn btn-gold" :disabled="installingBridge || !currentVersion?.loader" @click="onInstallBridge">{{ installingBridge ? '安装中…' : '安装桥接 MOD' }}</button>
        <small v-if="currentVersion && !currentVersion.loader && bridgePresent===false" class="muted">纯净版不加载 MOD，请选择带加载器的实例。</small>
        <button v-if="!status?.connected" class="btn" :class="bridgePresent === false ? 'btn-ghost' : 'btn-gold'" @click="store.currentView = currentVersion ? 'home' : 'game'">{{ currentVersion ? '前往首页' : '选择游戏实例' }}</button>
        <button data-ui="BridgeView:b3c6f77da5ef" v-if="status?.connected && params.length" class="btn btn-ghost" @click="resetAll">全部恢复默认</button>
      </div>
    </div>
    <!-- 参数区 -->
    <template v-if="status?.connected">
      <div data-ui="BridgeView:e2062fc19818" v-if="params.length" class="bridge-toolbar">
        <input data-ui="BridgeView:ca30db9d543d" v-model="search" class="input bridge-search" placeholder="搜索参数名称、说明、分组…" />
      </div>
      <div data-ui="BridgeView:f720f714d75f" v-if="loadingManifest" class="card empty"><span data-ui="BridgeView:6bcd3d93d313" class="spin"></span><span>正在读取参数清单…</span></div>
      <template v-else>
        <div data-ui="BridgeView:ca3ed5c40349" v-for="mod in groupedParams" :key="mod.modId" class="bridge-mod">
          <div data-ui="BridgeView:c7ebe4470e01" v-for="group in mod.groups" :key="group.group" class="card bridge-card">
            <div data-ui="BridgeView:4a5c8c65dd64" class="bridge-card-head">
              <strong>{{ group.group }}</strong>
              <span class="muted">{{ mod.modId }}</span>
            </div>
            <div data-ui="BridgeView:9534fa3e44a9" v-for="p in group.items" :key="p.id" class="bridge-row" :class="{ disabled: !p.visible || p.scope === 'SERVER' }">
              <div data-ui="BridgeView:20c0ec6ff98d" class="bridge-row-info">
                <span data-ui="BridgeView:d6913ec6096c" class="bridge-label">
                  {{ p.label }}
                  <span data-ui="BridgeView:7737e6691034" v-if="APPLY_HINT[p.apply]" class="tag bridge-apply-tag">{{ APPLY_HINT[p.apply] }}</span>
                  <span data-ui="BridgeView:072b1f0fecd4" v-if="p.scope === 'SERVER'" class="tag bridge-scope-tag" title="服务器参数：必须由服务端校验权限，本地接口只读">服务器</span>
                </span>
                <span data-ui="BridgeView:7c9682444806" v-if="p.description" class="muted bridge-desc">{{ p.description }}</span>
                <span data-ui="BridgeView:2d8e87e07e42" v-if="itemError[p.id]" class="bridge-error">{{ itemError[p.id] }}</span>
              </div>
              <div data-ui="BridgeView:9ca3c51d77e3" class="bridge-control">
                <label data-ui="BridgeView:8460a5e8359b" v-if="p.kind === 'SWITCH'" class="switch">
                  <input data-ui="BridgeView:ccafccfd626d"
                    type="checkbox"
                    :checked="p.value === true"
                    :disabled="!p.visible || p.scope === 'SERVER'"
                    @change="applyParam(p, ($event.target as HTMLInputElement).checked)"
                  />
                  <span data-ui="BridgeView:75c7b5405cfa" class="switch-ui"></span>
                </label>
                <template v-else-if="p.kind === 'SLIDER'">
                  <input data-ui="BridgeView:0926fcdcd53a"
                    type="range"
                    class="bridge-slider"
                    :min="p.min ?? 0"
                    :max="p.max ?? 100"
                    :step="p.step ?? 1"
                    :value="Number(p.value)"
                    :disabled="!p.visible || p.scope === 'SERVER'"
                    @change="applyParam(p, Number(($event.target as HTMLInputElement).value))"
                  />
                  <span data-ui="BridgeView:fbf62cc0f3d7" class="bridge-slider-value">{{ p.value }}</span>
                </template>
                <input data-ui="BridgeView:87863c4c8f30"
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
                <button data-ui="BridgeView:1433b0496f90"
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
        <div data-ui="BridgeView:ebfce48a2687" v-if="params.length && !groupedParams.length" class="card empty"><span>没有匹配「{{ search }}」的参数</span></div>
        <div data-ui="BridgeView:80ec96dd566a" v-if="!params.length && !loadingManifest" class="card empty"><span>桥接 MOD 没有注册任何参数</span></div>
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
.bridge-status{max-width:960px;display:grid;grid-template-columns:24px minmax(0,1fr);gap:16px;padding:24px;min-height:0}.bridge-context{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--text-dim);font-size:13px;border-bottom:1px solid var(--border);padding-bottom:12px}.bridge-status-text strong{font-size:21px}.bridge-status-text span{line-height:1.7}.bridge-guide-actions{grid-column:2;display:flex;flex-wrap:wrap;align-items:center;gap:12px}.bridge-dot{margin-top:9px}
</style>
