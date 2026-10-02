<script setup lang="ts">
import { withDeadline } from '@shared/deadline'
// 服务器页：服务器列表管理 + SLP 实时状态 + 一键进服
import ContentSkeleton from '../components/ContentSkeleton.vue'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  addServer,
  favoriteServer,
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
import { selectInstance, selectedInstance, refreshInstalled, store, toast } from '../store'
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
    loadError.value = '同步失败：' + errText(e)
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
function syncJoinSelection(){const t=parseTargetToken(joinModal.versionId);if(t)void selectInstance(t.id,t.folder)}
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
    const prepared = await withDeadline(() => prepareServerLaunch(s.id, versionId, target?.folder ?? s.folder), 15000, '服务器启动准备超时，请检查实例目录是否可访问后重试')
    store.settings = await getSettings()
    // Preparation already pins the target folder. Reuse the list loaded by this
    // page instead of blocking launch on another scan of every installed instance.
    store.installed = targets.value.filter(item => normalizedPath(item.folder) === normalizedPath(prepared.folder))
    await selectInstance(prepared.versionId, prepared.folder)
    store.launchingVersionId = prepared.versionId
    store.launchingFolder = prepared.folder
    await launchGame(prepared.versionId, prepared.directJoin ? prepared.address : undefined, prepared.folder)
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
    if(target)await selectInstance(target.id,target.folder)
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
  joinModal.versionId = targetOf(s) ? boundToken(s) : targetToken(selectedInstance.value ?? targets.value[0])
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
  (keyword.value
    ? servers.value.filter((s) => {
        const ping = pingOf(s)
        return (
          s.name.toLowerCase().includes(keyword.value) ||
          s.address.toLowerCase().includes(keyword.value) ||
          (ping?.motd.toLowerCase().includes(keyword.value) ?? false)
        )
      })
    : servers.value).slice().sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite))
)
async function toggleFavorite(server: ServerEntry) {
  try { servers.value = await favoriteServer(server.id, !server.favorite) }
  catch (e) { toast('收藏失败：' + errText(e), 'error') }
}
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
  <div data-ui="ServersView:b824bf7cac3c" class="connect-page servers-page">
    <header data-ui="ServersView:c2edecc77ee3" class="connection-header">
      <div><h1 data-ui="ServersView:ee8e70e0acab">服务器 <small>{{ servers.length }} 个 · {{ onlineCount }} 个在线</small></h1></div>
      <button data-ui="ServersView:c8a77fb10c66" class="btn btn-gold" :disabled="loading" @click="openAdd()"><span data-ui="ServersView:12718dc300bd" aria-hidden="true">＋</span> 添加服务器</button>
    </header>
    <div data-ui="ServersView:eee6f822ac69" class="server-toolbar">
      <label data-ui="ServersView:fd69834ac923" class="server-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input data-ui="ServersView:3445c173cb2a" v-model="store.searchKeyword" type="search" placeholder="搜索名称、地址或服务器介绍" aria-label="搜索服务器" /></label>
      <div data-ui="ServersView:1b941bebf470" class="connection-actions"><button data-ui="ServersView:d1988c769077" class="btn btn-ghost" :disabled="refreshing || loading || !servers.length" @click="pingAll">{{ refreshing ? '刷新中…' : '刷新状态' }}</button><button data-ui="ServersView:976ee42760fa" class="btn btn-ghost" :disabled="loading || !!bindingId || launchBusy" @click="syncNow">{{ loading ? '同步中…' : '同步游戏列表' }}</button><button data-ui="ServersView:6701e62ae081" class="btn btn-ghost" :disabled="!servers.length || loading" @click="toggleSelectMode">{{ selectMode ? '退出多选' : '批量管理' }}</button></div>
    </div>
    <p data-ui="ServersView:de3efa1d5d8c" v-if="loadError" class="connection-error" role="alert">{{ loadError }} <button data-ui="ServersView:99e827f2934b" class="btn btn-ghost" @click="load">重试</button></p>

    <div data-ui="ServersView:f5fd3e224d72" v-if="selectMode" class="server-batch"><label data-ui="ServersView:95d3c099e4dd" class="check-all"><input data-ui="ServersView:ae275f78348c" type="checkbox" :checked="allChecked" @change="toggleAll" /> 全选搜索结果</label><span>已选 {{ selectedCount }} 项</span><button data-ui="ServersView:bfafec35f377" class="btn btn-danger" :disabled="!selectedCount" @click="openBatchDelete">删除所选</button></div>
    <ContentSkeleton v-if="loading && !servers.length" class="connection-panel" label="正在整理服务器列表…"/>
    <div data-ui="ServersView:0c74b7b7657d" v-else-if="!servers.length && !loadError" class="connection-panel connection-empty">
      <span data-ui="ServersView:ace2288ec1cd" class="connection-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h2m-2 10h2"/></svg></span><h3>下一站，去哪个世界？</h3><p>添加好友的服务器地址，或同步游戏内的收藏。关联实例后即可快速进入。</p><button data-ui="ServersView:425560590e46" class="btn btn-gold" @click="openAdd()">添加第一个服务器</button>
    </div>
    <div data-ui="ServersView:18026edb487f" v-else-if="!filteredServers.length && !loadError" class="connection-panel connection-empty"><h3>没有找到匹配的服务器</h3><p>试试其他名称、地址或关键词。</p><button data-ui="ServersView:9d3cfed9a775" class="btn btn-ghost" @click="store.searchKeyword = ''">清除搜索</button></div>
    <div data-ui="ServersView:327a59a2e7d9" v-else-if="servers.length" class="server-workspace" :inert="loading || !!loadError">
      <section data-ui="ServersView:9f97ae2c334b" class="server-list" aria-label="服务器列表">
        <ServerListItem v-for="s in filteredServers" :key="s.id" :server="s" :ping="pingOf(s)" :pending="pings[s.id] === 'loading'" :active="activeServer?.id === s.id" :select-mode="selectMode" :checked="selected.has(s.id)" @favorite="toggleFavorite(s)" @select="activeId = s.id" @toggle="toggleSelect(s.id)" @connect="onCardDblClick(s)" />
        <p data-ui="ServersView:14a890c77df9" class="connection-muted server-list-hint">选择查看详情 · 双击快速连接</p>
      </section>
      <ServerDetails v-if="activeServer" :server="activeServer" :ping="pingOf(activeServer)" :pending="pings[activeServer.id] === 'loading'" :busy="launchBusy || store.launchState?.status === 'running' || store.launchState?.status === 'launching'" :running="store.launchState?.status === 'running'" :binding="!!bindingId" :targets="targets" :bound="boundToken(activeServer)" :missing="versionMissing(activeServer)" :last-used="formatLastUsed(activeServer.lastUsedAt)" :target-token="targetToken" :target-label="targetLabel" @bind="onBind(activeServer, $event)" @connect="onCardDblClick(activeServer)" @refresh="pingOne(activeServer)" @edit="openAdd(activeServer)" @remove="requestDelete(activeServer)" @relink="relinkMissing(activeServer)" @versions="store.currentView = 'game'" @copy="copyAddress(activeServer)" />
    </div>
    <!-- 添加模态框 -->
    <Teleport to="body">
      <div data-ui="ServersView:9f87bde5903a" v-if="addModal.open" class="modal-mask connection-modal" @pointerdown.self="!addModal.busy && (addModal.open = false)">
        <div data-ui="ServersView:64843d40b149" class="modal" role="dialog" aria-modal="true" aria-label="服务器操作">
          <h3 class="modal-title">{{ addModal.id ? '编辑服务器' : '添加服务器' }}</h3><p data-ui="ServersView:0673ab93fcb6" class="connection-muted">只修改启动器记录，不会覆盖游戏内服务器列表。</p><p data-ui="ServersView:ff5270751bc0" v-if="addModal.error" class="connection-error" role="alert">{{ addModal.error }}</p>
          <label data-ui="ServersView:ef16ee272d28" for="server-edit-name" class="modal-label">服务器名称</label>
          <input data-ui="ServersView:269e49ea31d8" id="server-edit-name" v-model="addModal.name" class="input" placeholder="例如：好友的生存服" maxlength="30" />
          <label data-ui="ServersView:7726e21fdba4" for="server-edit-address" class="modal-label">服务器地址</label>
          <input data-ui="ServersView:96ef483b19f6"
            id="server-edit-address" v-model="addModal.address"
            class="input mono"
            placeholder="例如：mc.example.com 或 1.2.3.4:25565"
            spellcheck="false"
            @keyup.enter="onAdd"
          />
          <div class="modal-actions">
            <button data-ui="ServersView:c271ffbad47f" class="btn btn-ghost" :disabled="addModal.busy" @click="addModal.open = false">取消</button>
            <button data-ui="ServersView:597bd1616442" class="btn btn-gold" :disabled="addModal.busy || !addModal.name.trim() || !addModal.address.trim()" @click="onAdd">
              {{ addModal.busy ? '保存中…' : addModal.id ? '保存修改' : '添加服务器' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 删除确认 -->
      <div data-ui="ServersView:581b4d7ed38f" v-if="delModal.open" class="modal-mask connection-modal" @pointerdown.self="!delModal.busy && (delModal.open = false)">
        <div class="modal">
          <h3 class="modal-title">删除服务器</h3>
          <p data-ui="ServersView:76f7cd862f50" class="confirm-text">
            <template v-if="delModal.batch">
              确定要从 KAMUCL 删除所选的 {{ selectedCount }} 个服务器吗？这只会删除启动器记录，不会修改 Minecraft 的 servers.dat；下次同步时，游戏内仍存在的条目可能再次出现。
            </template>
            <template v-else>
              确定要从 KAMUCL 删除「{{ delModal.target?.name }}」吗？这只会删除启动器记录，不会修改 Minecraft 的 servers.dat；下次同步时，游戏内仍存在的条目可能再次出现。
            </template>
          </p>
          <div class="modal-actions">
            <button data-ui="ServersView:f352d5e4009a" class="btn btn-ghost" :disabled="delModal.busy" @click="delModal.open = false">取消</button>
            <button data-ui="ServersView:488f14bc3ac2" class="btn btn-danger" :disabled="delModal.busy" @click="onDelete">
              {{ delModal.busy ? '删除中…' : '确认删除' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 进入游戏（选版本） -->
      <div data-ui="ServersView:134da6c8d6c9" v-if="joinModal.open" class="modal-mask connection-modal" @pointerdown.self="joinModal.open = false">
        <div class="modal">
          <h3 class="modal-title">进入 {{ joinModal.target?.name }}</h3>
          <p data-ui="ServersView:86a7b84a1c0f" class="modal-label">选择游戏实例（将保存关联并启动 {{ joinModal.target?.address }}）</p>
          <select data-ui="ServersView:86d2c55efdd8" v-model="joinModal.versionId" class="select" @change="syncJoinSelection">
            <option v-for="v in targets" :key="`${v.folder}\u0000${v.id}`" :value="targetToken(v)">
              {{ targetLabel(v) }}
            </option>
          </select>
          <p data-ui="ServersView:6b5692aed293" class="muted join-hint">
            Java 1.20 及以上会使用官方 Quick Play 直接进入；更旧版本只启动正确实例，并保留服务器记录。
          </p>
          <div class="modal-actions">
            <button data-ui="ServersView:ed11f95a3941" class="btn btn-ghost" @click="joinModal.open = false">取消</button>
            <button data-ui="ServersView:9bd6d5ab8297" class="btn btn-gold" @click="onJoin">启动并进入</button>
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
.servers-page .server-list-item { display: flex; align-items: center; min-width: 0; min-height: var(--row-h); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card); transition: background 160ms ease, border-color 160ms ease, transform 0.18s ease, box-shadow 0.22s ease; overflow: hidden; animation: server-row-in 0.38s cubic-bezier(0.22, 0.9, 0.32, 1) backwards; }
.servers-page .server-list-item:nth-child(2) { animation-delay: 40ms; }
.servers-page .server-list-item:nth-child(3) { animation-delay: 80ms; }
.servers-page .server-list-item:nth-child(4) { animation-delay: 120ms; }
.servers-page .server-list-item:nth-child(5) { animation-delay: 160ms; }
.servers-page .server-list-item:nth-child(6) { animation-delay: 200ms; }
.servers-page .server-list-item:nth-child(7) { animation-delay: 240ms; }
.servers-page .server-list-item:nth-child(8) { animation-delay: 280ms; }
@keyframes server-row-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.servers-page .server-list-item:hover { border-color: var(--border-strong); background: var(--card-2); transform: translateY(-2px); box-shadow: 0 8px 22px color-mix(in srgb, var(--accent) 10%, transparent); }
.servers-page .server-list-item:active { transform: translateY(0) scale(0.998); }
.servers-page .server-list-item.active, .servers-page .server-list-item.checked { border-color: var(--accent); background: linear-gradient(110deg, var(--accent-soft), transparent), var(--card); box-shadow: inset 3px 0 var(--accent); }
.servers-page .server-row-button { display: flex; align-items: center; gap: var(--space-3); width: 100%; min-width: 0; padding: var(--space-3); border: 0; background: transparent; color: var(--text); text-align: left; font: inherit; cursor: pointer; }
.servers-page .server-row-button:focus-visible { outline: 2px solid var(--accent-2); outline-offset: calc(var(--space-1) * -1); border-radius: var(--radius-sm); }
.servers-page .server-monogram { display: flex; align-items: center; justify-content: center; width: 36px; height: 40px; flex: none; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent-2); font-size: var(--text-lg); font-weight: 700; transition: transform 0.18s cubic-bezier(0.22, 0.9, 0.32, 1.2); }
.servers-page .server-list-item:hover .server-monogram { transform: scale(1.08); }
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
.servers-page{gap:16px}.servers-page .connection-header{margin:0;padding:0}.servers-page .connection-header h1 small{font-size:12px;font-weight:400;color:var(--text-dim);margin-left:12px}.server-toolbar{margin:0;gap:12px}.servers-page .server-list-item{border:0;border-bottom:1px solid var(--border);border-radius:0;min-height:80px;box-shadow:none;padding:0 8px;background:transparent}.servers-page .server-list-item.active{background:var(--accent-soft);box-shadow:inset 3px 0 var(--accent)}.servers-page .server-row-button{padding:12px;min-width:0}.servers-page .server-row-copy{min-width:0}.servers-page .server-row-copy strong{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.servers-page .server-row-state{min-width:76px}.servers-page .server-favorite{order:3;margin:0 4px}.servers-page .server-row-button{flex:1}.servers-page .server-detail-title h3{font-size:21px}.servers-page .server-detail{align-self:start}@media(max-width:800px){.server-toolbar{flex-wrap:wrap}.server-toolbar .server-search{flex-basis:100%}.servers-page .connection-header h1 small{display:block;margin:6px 0 0}}
.servers-page .server-list{gap:0;background:var(--surface-content);padding:0 12px;border:1px solid var(--border);border-radius:var(--radius-lg)}.servers-page .server-list-item{animation:none;overflow:visible}.servers-page .server-list-item:hover,.servers-page .server-list-item:active{transform:none;box-shadow:none}.servers-page .server-list-item:hover .server-monogram{transform:none}@media(min-width:1121px){.servers-page .server-workspace{grid-template-columns:minmax(360px,1.2fr) minmax(320px,1fr);min-height:0;flex:1}.servers-page .server-list,.servers-page .server-detail{max-height:calc(100vh - 270px);overflow:auto;scrollbar-gutter:stable}.content:has(.servers-page){overflow:hidden}.servers-page{height:100%;min-height:0}}

.servers-page .server-workspace { gap:16px; }
.servers-page .server-list { padding:8px; }
.servers-page .server-list-item { padding:0 4px; min-height:86px; }
.servers-page .server-list-item.active { border-bottom-color:var(--border);box-shadow:none;background:var(--accent-soft);border-radius:var(--radius-sm); }
.servers-page .server-list-item.active .server-row-copy strong { color:var(--accent-2); }
.servers-page .server-row-button { gap:12px;padding:12px 8px; }
.servers-page .server-monogram { width:36px;height:36px; }
.servers-page .server-row-state { min-width:66px; }
.servers-page .server-favorite { margin:0 4px; }
.servers-page .server-list > .connection-muted { padding:8px;font-size:12px; }
.servers-page .server-detail .connection-panel-body { gap:16px;padding:20px; }
.servers-page .server-detail-title h3 { margin:0;font-size:20px; }
.servers-page .server-facts { padding:12px 0;border-block:1px solid var(--border); }
.servers-page .server-facts strong { font-size:18px; }
.servers-page .server-description { padding:10px 12px;line-height:1.6; }
.servers-page .server-detail .connection-panel-head { padding:12px 20px; }
.servers-page .server-detail .connection-panel-head h2 { font-size:14px;color:var(--text-dim);font-weight:500; }
@media(min-width:1121px) { .servers-page { max-width:1480px;margin-inline:auto;width:100%; }.servers-page .server-detail { position:sticky;top:0; } }
@media(max-width:1120px) { .servers-page .server-workspace { grid-template-columns:minmax(0,1fr); }.servers-page .server-list{max-height:360px;overflow:auto}.servers-page .server-detail{position:static} }
</style>
