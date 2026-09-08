<script setup lang="ts">
// 服务器页：服务器列表管理 + SLP 实时状态 + 一键进服
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  addServer,
  editServer,
  copyText,
  bindServer,
  errText,
  getSettings,
  launchGame,
  listServers,
  pingServer,
  prepareServerLaunch,
  removeServer,
  syncServersFromDat
} from '../api'
import ConnectionStatus from '../components/connection/ConnectionStatus.vue'
import ServerListItem from '../components/connection/ServerListItem.vue'
import ServerDetails from '../components/connection/ServerDetails.vue'
import '../components/connection/connection.css'
import { refreshInstalled, store, toast } from '../store'
import type { InstalledVersion, ServerEntry, ServerPingResult } from '@shared/types'

// ---------------- 列表与状态 ----------------
const servers = ref<ServerEntry[]>([])
const targets = ref<InstalledVersion[]>([])
const pings = reactive<Record<string, ServerPingResult | 'loading'>>({})
const loading = ref(true)
const refreshing = ref(false), launchBusy = ref(false), bindingId = ref(''), loadError = ref('')
const activeId = ref('')
const pingEpoch = new Map<string, number>()

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    // 先从各版本 servers.dat 合并（游戏内添加的服务器自动纳入并标注所属版本）
    const r = await syncServersFromDat()
    servers.value = r.list
    targets.value = r.targets ?? store.installed
    if (r.added > 0) toast(`已从游戏内同步 ${r.added} 个服务器`, 'info')
    if (r.errors?.length) toast(`有 ${r.errors.length} 个服务器列表未能读取：${r.errors[0]}`, 'error')
  } catch (e) {
    loadError.value = '读取服务器列表失败：' + errText(e)
    toast(loadError.value, 'error')
  } finally {
    loading.value = false
  }
  void pingAll()
}

async function syncNow() {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  try {
    const r = await syncServersFromDat()
    servers.value = r.list
    targets.value = r.targets ?? store.installed
    const detail = r.added || r.updated ? `新增 ${r.added}，更新 ${r.updated ?? 0}` : '没有发现变化'
    toast(`游戏内服务器同步完成：${detail}`, r.errors?.length ? 'error' : 'success')
    if (r.errors?.length) toast(r.errors[0], 'error')
  } catch (e) {
    toast('同步失败：' + errText(e), 'error')
  } finally {
    loading.value = false
  }
  void pingAll()
}

async function pingAll() {
  if (refreshing.value) return
  refreshing.value = true
  try { await Promise.allSettled(servers.value.map((s) => pingOne(s))) }
  finally { refreshing.value = false }
}

async function pingOne(s: ServerEntry) {
  const epoch = (pingEpoch.get(s.id) ?? 0) + 1
  pingEpoch.set(s.id, epoch)
  pings[s.id] = 'loading'
  try {
    const result = await pingServer(s.address)
    if (pingEpoch.get(s.id) === epoch && servers.value.some(item => item.id === s.id && item.address === s.address)) pings[s.id] = result
  } catch {
    if (pingEpoch.get(s.id) !== epoch || !servers.value.some(item => item.id === s.id && item.address === s.address)) return
    pings[s.id] = {
      online: false,
      players: '-',
      motd: '无法连接（服务器离线或地址错误）',
      version: '-',
      latencyMs: 0
    }
  }
}

onMounted(() => {
  void load()
  if (!store.installed.length) void refreshInstalled()
})

// ---------------- 添加 ----------------
const addModal = reactive({ open: false, id: '', name: '', address: '', busy: false, error: '' })
function openAdd(server?: ServerEntry) {
  Object.assign(addModal, { open: true, id: server?.id ?? '', name: server?.name ?? '', address: server?.address ?? '', error: '' })
}

async function onAdd() {
  if (addModal.busy) return
  addModal.busy = true
  addModal.error = ''
  try {
    const editingId = addModal.id
    servers.value = editingId ? await editServer(editingId, addModal.name, addModal.address) : await addServer(addModal.name, addModal.address)
    addModal.open = false
    addModal.name = ''
    addModal.address = ''
    toast(editingId ? '服务器已更新' : '服务器已添加', 'success')
    const just = editingId ? servers.value.find(s => s.id === editingId) : servers.value[servers.value.length - 1]
    if (just) { activeId.value = just.id; void pingOne(just) }
  } catch (e) {
    addModal.error = errText(e)
  } finally {
    addModal.busy = false
  }
}

// ---------------- 删除（二次确认，支持单个/多选/全选批量） ----------------
const delModal = reactive({ open: false, target: null as ServerEntry | null, batch: false, busy: false })

// ---------------- 多选模式 ----------------
const selectMode = ref(false)
const selected = ref<Set<string>>(new Set())
const allChecked = computed(
  () => filteredServers.value.length > 0 && filteredServers.value.every((s) => selected.value.has(s.id))
)
const selectedCount = computed(() => selected.value.size)

function toggleSelectMode() {
  selectMode.value = !selectMode.value
  if (!selectMode.value) selected.value = new Set()
}
function toggleSelect(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}
function toggleAll() {
  selected.value = allChecked.value ? new Set() : new Set(filteredServers.value.map((s) => s.id))
}
function openBatchDelete() {
  if (!selectedCount.value) return
  delModal.target = null
  delModal.batch = true
  delModal.open = true
}

async function onDelete() {
  if (delModal.busy) return
  delModal.busy = true
  try {
    if (delModal.batch) {
      // 批量：逐个删除（同一存储文件，顺序执行）
      const ids = [...selected.value]
      let okCount = 0
      for (const id of ids) {
        servers.value = await removeServer(id)
        delete pings[id]
        okCount++
      }
      selected.value = new Set()
      delModal.open = false
      toast(`已删除 ${okCount} 个服务器`, 'success')
    } else {
      const t = delModal.target
      if (!t) return
      servers.value = await removeServer(t.id)
      delete pings[t.id]
      delModal.open = false
      toast('已删除服务器', 'success')
    }
  } catch (e) {
    toast('删除失败：' + errText(e), 'error')
  } finally {
    delModal.busy = false
  }
}

// ---------------- 一键进服 ----------------
const joinModal = reactive({ open: false, target: null as ServerEntry | null, versionId: '' })

const normalizedPath = (value: string) => value.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
const targetToken = (target: Pick<InstalledVersion, 'id' | 'folder'>) =>
  JSON.stringify({ id: target.id, folder: target.folder })
const parseTargetToken = (value: string): { id: string; folder: string } | null => {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as { id?: unknown; folder?: unknown }
    return typeof parsed.id === 'string' && typeof parsed.folder === 'string'
      ? { id: parsed.id, folder: parsed.folder }
      : null
  } catch {
    return null
  }
}
const targetOf = (server: ServerEntry): InstalledVersion | undefined =>
  targets.value.find(
    (target) =>
      target.id === server.versionId &&
      (!server.folder || normalizedPath(target.folder) === normalizedPath(server.folder))
  )
const boundToken = (server: ServerEntry): string => {
  const target = targetOf(server)
  return target ? targetToken(target) : ''
}
const folderLabel = (folder: string): string =>
  store.settings?.folders.find(
    (item) => normalizedPath(item.path) === normalizedPath(folder)
  )?.name ?? folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder
const targetLabel = (target: InstalledVersion): string =>
  `${folderLabel(target.folder)} · ${target.id}${target.loader ? ` · ${target.loader} ${target.loaderVersion ?? ''}` : ''}`
const formatLastUsed = (value?: string): string => {
  if (!value) return '尚未从启动器进入'
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? '时间未知' : `上次启动 ${time.toLocaleString()}`
}

/** 双击卡片：已绑定版本直接启动进服；未绑定弹版本选择 */
function onCardDblClick(s: ServerEntry) {
  if (launchBusy.value || bindingId.value || store.launchState?.status === 'running' || store.launchState?.status === 'launching') return
  if (s.versionId) {
    const v = targetOf(s)
    if (v) {
      void doLaunch(s, s.versionId)
      return
    }
    relinkMissing(s)
    return
  }
  openJoin(s)
}

async function doLaunch(s: ServerEntry, versionId: string) {
  if (launchBusy.value) return
  launchBusy.value = true
  try {
    const target = targets.value.find(
      (item) => item.id === versionId && (!s.folder || normalizedPath(item.folder) === normalizedPath(s.folder))
    )
    const prepared = await prepareServerLaunch(s.id, versionId, target?.folder ?? s.folder)
    store.settings = await getSettings()
    await refreshInstalled()
    store.launchingVersionId = prepared.versionId
    store.launchingFolder = prepared.folder
    await launchGame(prepared.versionId, prepared.directJoin ? prepared.address : undefined)
    servers.value = await listServers()
    toast(
      prepared.directJoin
        ? `正在启动并进入 ${s.name}…`
        : `Minecraft ${prepared.minecraftVersion} 不支持快速进入，已启动正确实例`,
      'info'
    )
  } catch (e) {
    toast('启动失败：' + errText(e), 'error')
  } finally { launchBusy.value = false }
}

/** 仅更新 KAMUCL 的实例关联；绝不写回或覆盖 Minecraft 的 servers.dat。 */
async function onBind(s: ServerEntry, token: string) {
  if (bindingId.value) return
  bindingId.value = s.id
  try {
    const target = parseTargetToken(token)
    servers.value = await bindServer(s.id, target?.id ?? '', target?.folder)
    toast(target ? `已关联到 ${target.id}` : '已解除实例关联', 'success')
  } catch (e) {
    toast('绑定失败：' + errText(e), 'error')
  } finally { bindingId.value = '' }
}

function relinkMissing(s: ServerEntry) {
  toast('关联实例已缺失；可选择现有实例重新关联，或到游戏版本页重新下载', 'info')
  openJoin(s)
}

const versionMissing = (s: ServerEntry): boolean => !!s.versionId && !targetOf(s)

function openJoin(s: ServerEntry) {
  if (!targets.value.length) {
    toast('还没有安装任何版本，请先到游戏版本页安装', 'error')
    return
  }
  joinModal.target = s
  joinModal.versionId = targetOf(s) ? boundToken(s) : targetToken(targets.value[0])
  joinModal.open = true
}

async function onJoin() {
  const s = joinModal.target
  if (!s || !joinModal.versionId) return
  const target = parseTargetToken(joinModal.versionId)
  if (!target) return
  joinModal.open = false
  try {
    servers.value = await bindServer(s.id, target.id, target.folder)
    const linked = servers.value.find((server) => server.id === s.id) ?? s
    await doLaunch(linked, target.id)
  } catch (e) {
    toast('启动失败：' + errText(e), 'error')
  }
}

const pingOf = (s: ServerEntry): ServerPingResult | null =>
  pings[s.id] && pings[s.id] !== 'loading' ? (pings[s.id] as ServerPingResult) : null

// ---------------- 顶栏搜索联动（过滤名称/地址/MOTD） ----------------
const keyword = computed(() => store.searchKeyword.trim().toLowerCase())
const filteredServers = computed(() =>
  keyword.value
    ? servers.value.filter((s) => {
        const ping = pingOf(s)
        return (
          s.name.toLowerCase().includes(keyword.value) ||
          s.address.toLowerCase().includes(keyword.value) ||
          (ping?.motd.toLowerCase().includes(keyword.value) ?? false)
        )
      })
    : servers.value
)
const activeServer = computed(() => filteredServers.value.find(s => s.id === activeId.value) ?? filteredServers.value[0])
const onlineCount = computed(() => servers.value.filter(s => pingOf(s)?.online).length)
watch(servers, list => { selected.value = new Set([...selected.value].filter(id => list.some(s => s.id === id))) })
function requestDelete(s: ServerEntry) {
  Object.assign(delModal, { open: true, target: s, batch: false })
}
async function copyAddress(s: ServerEntry) {
  try { toast(await copyText(s.address) ? '服务器地址已复制' : '复制失败', 'info') }
  catch (e) { toast(errText(e), 'error') }
}
</script>

<template>
  <div class="connect-page servers-page">
    <header class="connection-header">
      <div><span class="connection-eyebrow">YOUR DESTINATIONS</span><h1>服务器</h1><p>收藏常去的世界，为每一次出发选好实例。</p></div>
      <button class="btn btn-gold" :disabled="loading" @click="openAdd()"><span aria-hidden="true">＋</span> 添加服务器</button>
    </header>
    <div class="server-toolbar">
      <label class="server-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input v-model="store.searchKeyword" type="search" placeholder="搜索名称、地址或服务器介绍" aria-label="搜索服务器" /></label>
      <div class="connection-actions"><button class="btn btn-ghost" :disabled="refreshing || loading || !servers.length" @click="pingAll">{{ refreshing ? '刷新中…' : '刷新状态' }}</button><button class="btn btn-ghost" :disabled="loading || !!bindingId || launchBusy" @click="syncNow">{{ loading ? '同步中…' : '同步游戏列表' }}</button></div>
    </div>
    <p v-if="loadError" class="connection-error" role="alert">{{ loadError }} <button class="btn btn-ghost" @click="load">重试</button></p>
    <div class="server-collection-head"><div><strong>我的服务器 <span>{{ servers.length }}</span></strong><ConnectionStatus :tone="refreshing ? 'pending' : 'neutral'" :label="refreshing ? '检测状态中' : onlineCount + ' 个在线'" /></div><button class="btn btn-ghost" :disabled="!servers.length || loading" @click="toggleSelectMode">{{ selectMode ? '退出多选' : '批量管理' }}</button></div>
    <div v-if="selectMode" class="server-batch"><label class="check-all"><input type="checkbox" :checked="allChecked" @change="toggleAll" /> 全选搜索结果</label><span>已选 {{ selectedCount }} 项</span><button class="btn btn-danger" :disabled="!selectedCount" @click="openBatchDelete">删除所选</button></div>
    <div v-if="loading" class="connection-panel connection-empty" role="status"><span class="spin"></span><h3>正在整理服务器列表</h3><p>同步各实例中的收藏，不会覆盖游戏文件。</p></div>
    <div v-else-if="!servers.length" class="connection-panel connection-empty">
      <span class="connection-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h2m-2 10h2"/></svg></span><h3>下一站，去哪个世界？</h3><p>添加好友的服务器地址，或同步游戏内的收藏。关联实例后即可快速进入。</p><button class="btn btn-gold" @click="openAdd()">添加第一个服务器</button>
    </div>
    <div v-else-if="!filteredServers.length" class="connection-panel connection-empty"><h3>没有找到匹配的服务器</h3><p>试试其他名称、地址或关键词。</p><button class="btn btn-ghost" @click="store.searchKeyword = ''">清除搜索</button></div>
    <div v-else class="server-workspace">
      <section class="server-list" aria-label="服务器列表">
        <ServerListItem v-for="s in filteredServers" :key="s.id" :server="s" :ping="pingOf(s)" :pending="pings[s.id] === 'loading'" :active="activeServer?.id === s.id" :select-mode="selectMode" :checked="selected.has(s.id)" @select="activeId = s.id" @toggle="toggleSelect(s.id)" @connect="onCardDblClick(s)" />
        <p class="connection-muted server-list-hint">选择查看详情 · 双击快速连接</p>
      </section>
      <ServerDetails v-if="activeServer" :server="activeServer" :ping="pingOf(activeServer)" :pending="pings[activeServer.id] === 'loading'" :busy="launchBusy || store.launchState?.status === 'running' || store.launchState?.status === 'launching'" :binding="!!bindingId" :targets="targets" :bound="boundToken(activeServer)" :missing="versionMissing(activeServer)" :last-used="formatLastUsed(activeServer.lastUsedAt)" :target-token="targetToken" :target-label="targetLabel" @bind="onBind(activeServer, $event)" @connect="onCardDblClick(activeServer)" @refresh="pingOne(activeServer)" @edit="openAdd(activeServer)" @remove="requestDelete(activeServer)" @relink="relinkMissing(activeServer)" @versions="store.currentView = 'game'" @copy="copyAddress(activeServer)" />
    </div>
    <!-- 添加模态框 -->
    <Teleport to="body">
      <div v-if="addModal.open" class="modal-mask connection-modal" @pointerdown.self="!addModal.busy && (addModal.open = false)">
        <div class="modal" role="dialog" aria-modal="true" aria-label="服务器操作">
          <h3 class="modal-title">{{ addModal.id ? '编辑服务器' : '添加服务器' }}</h3><p class="connection-muted">只修改启动器记录，不会覆盖游戏内服务器列表。</p><p v-if="addModal.error" class="connection-error" role="alert">{{ addModal.error }}</p>
          <label for="server-edit-name" class="modal-label">服务器名称</label>
          <input id="server-edit-name" v-model="addModal.name" class="input" placeholder="例如：好友的生存服" maxlength="30" />
          <label for="server-edit-address" class="modal-label">服务器地址</label>
          <input
            id="server-edit-address" v-model="addModal.address"
            class="input mono"
            placeholder="例如：mc.example.com 或 1.2.3.4:25565"
            spellcheck="false"
            @keyup.enter="onAdd"
          />
          <div class="modal-actions">
            <button class="btn btn-ghost" :disabled="addModal.busy" @click="addModal.open = false">取消</button>
            <button class="btn btn-gold" :disabled="addModal.busy || !addModal.name.trim() || !addModal.address.trim()" @click="onAdd">
              {{ addModal.busy ? '保存中…' : addModal.id ? '保存修改' : '添加服务器' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 删除确认 -->
      <div v-if="delModal.open" class="modal-mask connection-modal" @pointerdown.self="!delModal.busy && (delModal.open = false)">
        <div class="modal">
          <h3 class="modal-title">删除服务器</h3>
          <p class="confirm-text">
            <template v-if="delModal.batch">
              确定要从 KAMUCL 删除所选的 {{ selectedCount }} 个服务器吗？这只会删除启动器记录，不会修改 Minecraft 的 servers.dat；下次同步时，游戏内仍存在的条目可能再次出现。
            </template>
            <template v-else>
              确定要从 KAMUCL 删除「{{ delModal.target?.name }}」吗？这只会删除启动器记录，不会修改 Minecraft 的 servers.dat；下次同步时，游戏内仍存在的条目可能再次出现。
            </template>
          </p>
          <div class="modal-actions">
            <button class="btn btn-ghost" :disabled="delModal.busy" @click="delModal.open = false">取消</button>
            <button class="btn btn-danger" :disabled="delModal.busy" @click="onDelete">
              {{ delModal.busy ? '删除中…' : '确认删除' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 进入游戏（选版本） -->
      <div v-if="joinModal.open" class="modal-mask connection-modal" @pointerdown.self="joinModal.open = false">
        <div class="modal">
          <h3 class="modal-title">进入 {{ joinModal.target?.name }}</h3>
          <p class="modal-label">选择游戏实例（将保存关联并启动 {{ joinModal.target?.address }}）</p>
          <select v-model="joinModal.versionId" class="select">
            <option v-for="v in targets" :key="`${v.folder}\u0000${v.id}`" :value="targetToken(v)">
              {{ targetLabel(v) }}
            </option>
          </select>
          <p class="muted join-hint">
            Java 1.20 及以上会使用官方 Quick Play 直接进入；更旧版本只启动正确实例，并保留服务器记录。
          </p>
          <div class="modal-actions">
            <button class="btn btn-ghost" @click="joinModal.open = false">取消</button>
            <button class="btn btn-gold" @click="onJoin">启动并进入</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
<style>
/* Server children share these page-scoped rules with the connection components.
   颜色一律 var/color-mix（禁止 hex/rgb 字面量）；字号/间距/圆角只用设计令牌。 */
.servers-page .server-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.servers-page .server-search { display: flex; flex: 1 1 250px; align-items: center; gap: var(--space-2); min-width: 0; height: var(--row-h); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0 var(--space-4); background: var(--card); }
.servers-page .server-search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.servers-page .server-search svg { width: 18px; height: 18px; flex: none; color: var(--text-dim); }
.servers-page .server-search input { border: 0; outline: 0; background: transparent; color: var(--text); min-width: 0; width: 100%; font: inherit; font-size: var(--text-sm); }
.servers-page .server-search input::placeholder { color: var(--text-dim); }
.servers-page .server-collection-head, .servers-page .server-collection-head > div { display: flex; align-items: center; gap: var(--space-3); }
.servers-page .server-collection-head { justify-content: space-between; flex-wrap: wrap; }
.servers-page .server-collection-head strong { font-size: var(--text-md); font-weight: 700; }
.servers-page .server-collection-head strong > span { margin-left: var(--space-1); color: var(--text-dim); font-size: var(--text-xs); font-weight: 400; font-variant-numeric: tabular-nums; }
.servers-page .server-workspace { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(300px, 1.05fr); gap: var(--card-gap); align-items: start; }
.servers-page .server-list { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.servers-page .server-list-item { display: flex; align-items: center; min-width: 0; min-height: var(--row-h); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card); transition: background 160ms ease, border-color 160ms ease; overflow: hidden; }
.servers-page .server-list-item:hover { border-color: var(--border-strong); background: var(--card-2); }
.servers-page .server-list-item.active, .servers-page .server-list-item.checked { border-color: var(--accent); background: linear-gradient(110deg, var(--accent-soft), transparent), var(--card); box-shadow: inset 3px 0 var(--accent); }
.servers-page .server-row-button { display: flex; align-items: center; gap: var(--space-3); width: 100%; min-width: 0; padding: var(--space-3); border: 0; background: transparent; color: var(--text); text-align: left; font: inherit; cursor: pointer; }
.servers-page .server-row-button:focus-visible { outline: 2px solid var(--accent-2); outline-offset: calc(var(--space-1) * -1); border-radius: var(--radius-sm); }
.servers-page .server-monogram { display: flex; align-items: center; justify-content: center; width: 36px; height: 40px; flex: none; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent-2); font-size: var(--text-lg); font-weight: 700; }
.servers-page .server-monogram.large { width: 48px; height: 52px; font-size: var(--text-xl); }
.servers-page .server-row-copy { display: flex; flex: 1; flex-direction: column; min-width: 0; gap: var(--space-1); }
.servers-page .server-row-copy strong { font-size: var(--text-sm); }
.servers-page .server-row-copy > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.servers-page .server-row-copy > span { color: var(--text-dim); font-size: var(--text-xs); }
.servers-page .server-row-copy small { color: var(--text-dim); font-size: var(--text-xs); }
.servers-page .server-row-state { display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-1); flex: none; }
.servers-page .server-row-state small { color: var(--text-dim); font-size: var(--text-xs); white-space: nowrap; }
.servers-page .server-list-hint { padding: var(--space-1) var(--space-2); }
.servers-page .server-detail { position: sticky; top: 0; }
.servers-page .server-detail-title { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.servers-page .server-detail-title > div { min-width: 0; }
.servers-page .server-detail-title h3 { font-size: var(--text-xl); font-weight: 700; line-height: 1.4; overflow-wrap: anywhere; }
.servers-page .server-detail-title p { color: var(--text-dim); font-size: var(--text-xs); line-height: 1.7; margin-top: var(--space-1); }
.servers-page .server-description { color: var(--text-dim); background: var(--card-2); border-radius: var(--radius-md); padding: var(--space-3) var(--space-4); font-size: var(--text-xs); line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }
.servers-page .server-facts { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
.servers-page .server-facts > div { display: flex; flex-direction: column; gap: var(--space-1); }
.servers-page .server-facts span { color: var(--text-dim); font-size: var(--text-xs); }
.servers-page .server-facts strong { font-size: var(--text-xl); font-weight: 700; font-variant-numeric: tabular-nums; }
.servers-page .server-connect { width: 100%; justify-content: space-between; min-height: var(--row-h); }
.servers-page .server-secondary { gap: var(--space-1); }
.servers-page .server-secondary .btn { flex: 1; padding: var(--space-1) var(--space-2); white-space: nowrap; }
.servers-page .server-delete { color: var(--danger); }
.servers-page .server-footnote { font-size: var(--text-xs); }
.servers-page .server-check { padding-left: var(--space-4); cursor: pointer; }
.servers-page input[type=checkbox] { width: 18px; height: 18px; accent-color: var(--accent); cursor: pointer; }
.servers-page .check-all, .servers-page .server-batch { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-xs); }
.servers-page .server-batch { padding: var(--space-3) var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--accent-soft); flex-wrap: wrap; }
.servers-page .server-batch > .btn { margin-left: auto; }
@media (max-width: 1120px) { .servers-page .server-workspace { grid-template-columns: 1fr; } .servers-page .server-detail { position: static; } }
</style>
