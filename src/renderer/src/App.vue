<script setup lang="ts">
import LaunchNotice from './components/LaunchNotice.vue'
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import type { Component } from 'vue'
import { backgroundImageEffect } from '@shared/appearancePolicy'
import { taskProgressPercent } from '@shared/taskProgress'
import {
  applyUpdate,
  cancelTask,
  errText,
  exportLaunchLogs,
  formatSpeed,
  getConfigStatus,
  getSettings,
  installModpack,
  onGameDirDone,
  onInstallDone,
  onLaunchLog,
  onLaunchState,
  onProgress,
  onTaskDone,
  onUpdatePrompt,
  onUpdateReady,
  onUpdateSlowHint,
  pauseTask,
  probeModpack,
  probeWorld,
  resetSettingsToDefaults,
  resumeTask,
  selectFile,
  skipUpdateVersion,
  startUpdateDownload
} from './api'
import type { ReleaseInfo } from '@shared/types'
import { QQ_GROUP_NUMBER } from '@shared/branding'
import UpdateModal from './components/UpdateModal.vue'
import { applyLaunchState, dismissTask, exitEditMode, finalizeTask, markNoticesRead, recordLastPlayed, refreshAccounts, refreshInstalled, resetProgressMono, stageLabel, store, toast, upsertTaskProgress } from './store'
import type { ViewName } from './store'
import type {
  CustomTheme,
  ModpackInfo,
  ThemeName,
  WorldImportInfo,
  YggdrasilProviderInput
} from '@shared/types'
import { DEFAULT_CUSTOM_THEME, THEME_PRESETS } from '@shared/types'
import { readableCustomColors } from '@shared/themeContrast'
import { managedImageUrl } from './managedAssets'
import Toasts from './components/Toasts.vue'
import EditPanel from './components/EditPanel.vue'
import { waitForBootTasks, sealBootTasks } from './bootTasks'
import { acceptsImportDrag, showsImportOverlay } from '@shared/dropIntent'
import { updateNotes, latestUpdateNote } from '@shared/updateNotes'
import HomeView from './views/HomeView.vue'
// 非首屏视图全部懒加载：首屏只打包/挂载 HomeView，其余视图拆独立 chunk 按需拉取
// （渲染层常驻内存大头之一；配合 memTrim/idleTrim 的静默瘦身）。
const GameView = defineAsyncComponent(() => import('./views/GameView.vue'))
const ModsView = defineAsyncComponent(() => import('./views/ModsView.vue'))
const PacksView = defineAsyncComponent(() => import('./views/PacksView.vue'))
const ShadersView = defineAsyncComponent(() => import('./views/ShadersView.vue'))
const KeysView = defineAsyncComponent(() => import('./views/KeysView.vue'))
const BridgeView = defineAsyncComponent(() => import('./views/BridgeView.vue'))
const SkinsView = defineAsyncComponent(() => import('./views/SkinsView.vue'))
const CommunityView = defineAsyncComponent(() => import('./views/CommunityView.vue'))
const ServersView = defineAsyncComponent(() => import('./views/ServersView.vue'))
const FriendConnectView = defineAsyncComponent(() => import('./views/FriendConnectView.vue'))
const SettingsView = defineAsyncComponent(() => import('./views/SettingsView.vue'))
const AccountsView = defineAsyncComponent(() => import('./views/AccountsView.vue'))
import brandHead from './assets/splash-face.png'

// Vite 的全局 define 在 script 中解析；模板直接访问会被 Vue 当作组件实例字段。
const appVersion = __APP_VERSION__
import ModDropModal from './components/ModDropModal.vue'
import WorldImportModal from './components/WorldImportModal.vue'

const viewMap: Record<ViewName, Component> = {
  home: HomeView,
  game: GameView,
  mods: ModsView,
  packs: PacksView,
  shaders: ShadersView,
  keys: KeysView,
  bridge: BridgeView,
  skins: SkinsView,
  community: CommunityView,
  servers: ServersView,
  friends: FriendConnectView,
  settings: SettingsView,
  accounts: AccountsView
}

const currentComponent = computed(() => viewMap[store.currentView])

const navItems: Array<{ key: ViewName; label: string; icon: string }> = [
  {
    key: 'home',
    label: '首页',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/></svg>'
  },
  {
    key: 'game',
    label: '游戏版本',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="11" rx="5.5"/><path d="M7.5 10.8v3.4M5.8 12.5h3.4"/><circle cx="15.6" cy="11.9" r="0.6" fill="currentColor" stroke="none"/><circle cx="18" cy="13.6" r="0.6" fill="currentColor" stroke="none"/></svg>'
  },
  {
    key: 'skins',
    label: '皮肤',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 4-6 3 2 5 3-1v9h8v-9l3 1 2-5-6-3a3 3 0 0 1-6 0Z"/></svg>'
  },
  {
    key: 'community',
    label: '社区资源',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a13.5 13.5 0 0 1 0 18"/><path d="M12 3a13.5 13.5 0 0 0 0 18"/></svg>'
  },
  {
    key: 'settings',
    label: '设置',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06-.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>'
  }
]

/** 功能禁用判定 */
const isFeatureOff = (key: string): boolean =>
  (store.settings?.disabledFeatures ?? []).includes(key)

/** 过滤禁用功能后的主导航 */
const visibleNavItems = computed(() =>
  navItems.filter((n) => !isFeatureOff(n.key))
)

/** 过滤禁用功能后的资源管理子项 */
const visibleResourceSubItems = computed(() =>
  resourceSubItems.filter((s) => !isFeatureOff(s.key))
)

/** 资源管理子级菜单（模组/资源包/光影包），按游戏版本管理对应目录 */
const resourceSubItems: Array<{ key: ViewName; label: string; icon: string }> = [
  {
    key: 'mods',
    label: '模组',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/></svg>'
  },
  {
    key: 'packs',
    label: '资源包',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>'
  },
  {
    key: 'shaders',
    label: '光影包',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
  },
  {
    key: 'keys',
    label: '默认配置',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>'
  },
  {
    key: 'bridge',
    label: 'MOD 面板',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="3.5"/></svg>'
  },
  {
    key: 'servers',
    label: '服务器',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>'
  },
  {
    key: 'friends',
    label: '联机',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M2 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 4 5"/></svg>'
  }
]

/** 资源管理组是否展开（默认折叠；当前在其中任一子页时强制展开高亮） */
const resourceExpanded = ref(false)
const inResourceGroup = computed(() =>
  ['mods', 'packs', 'shaders', 'keys', 'bridge', 'servers', 'friends'].includes(store.currentView)
)

// ---- 导航水滴：单一高亮块随指针在按钮间弹性滑动（iOS 液态感） ----
const navEl = ref<HTMLElement | null>(null)
const navHoverKey = ref('')
const navBlob = reactive({ top: 0, height: 0, on: false, stretch: false })
let blobStretchTimer: ReturnType<typeof setTimeout> | undefined
let blobRecalcTimer: ReturnType<typeof setTimeout> | undefined
const navBlobStyle = computed(() => ({
  height: navBlob.height + 'px',
  transform: `translateY(${navBlob.top}px) scale(${navBlob.stretch ? '0.96, 1.12' : '1, 1'})`
}))
function updateNavBlob() {
  const root = navEl.value
  if (!root) { navBlob.on = false; return }
  const key = navHoverKey.value || store.currentView
  let target = root.querySelector<HTMLElement>(`[data-nav="${key}"]`)
  // 资源子项在子菜单折叠时不可见（v-show），回退到父级「资源管理」
  if (target && target.offsetHeight === 0) target = root.querySelector<HTMLElement>('[data-nav="resources"]')
  if (!target) { navBlob.on = false; return }
  navBlob.top = target.offsetTop
  navBlob.height = target.offsetHeight
  navBlob.on = true
  navBlob.stretch = true
  clearTimeout(blobStretchTimer)
  blobStretchTimer = setTimeout(() => { navBlob.stretch = false }, 430)
}
watch([navHoverKey, () => store.currentView, resourceExpanded, visibleNavItems, visibleResourceSubItems], () => {
  nextTick(updateNavBlob)
  // 子列表展开/收起动画结束后二次校准水滴位置（动画期间元素位移尚未稳定）
  clearTimeout(blobRecalcTimer)
  blobRecalcTimer = setTimeout(updateNavBlob, 420)
})

/** 关闭启动器不影响游戏：游戏在跑时点关闭先提示一次，再真正关闭 */
let closeHintShown = false
const win = (action: 'minimize' | 'maximize' | 'close') => {
  if (action === 'close' && store.launchState?.status === 'running' && !closeHintShown) {
    closeHintShown = true
    toast('关闭启动器不影响游戏，游戏继续运行', 'info')
    setTimeout(() => window.kamucl.send('window:close'), 1300)
    return
  }
  window.kamucl.send(`window:${action}`)
}

// ---------------- 启动器自更新弹窗 ----------------
const updateModal = reactive<{
  open: boolean
  release: ReleaseInfo | null
  state: 'found' | 'downloading' | 'done'
  taskId: string
  slowHint: boolean
  rollback: boolean
}>({ open: false, release: null, state: 'found', taskId: '', slowHint: false, rollback: false })

/** 内测群号：设置覆盖优先，默认 shared/branding 常量 */
const qqGroup = computed(() => store.settings?.qqGroupNumber?.trim() || QQ_GROUP_NUMBER)

/** 更新下载任务进度（从下载中心任务列表取，含速度） */
const updateTask = computed(() => store.tasks.find((t) => t.id === updateModal.taskId))
const updatePercent = computed(() => updateTask.value?.progress ?? 0)
const updateSpeedText = computed(() => (updateTask.value?.speed ? formatSpeed(updateTask.value.speed) + '/s' : ''))

function openUpdateModal(release: ReleaseInfo, rollback = false) {
  updateModal.release = release
  updateModal.state = 'found'
  updateModal.taskId = ''
  updateModal.slowHint = false
  updateModal.rollback = rollback
  updateModal.open = true
}
// 设置页手动检查/任意页面写入 store.updatePrompt → 统一在此打开弹窗
watch(
  () => store.updatePrompt,
  (req) => {
    if (req) {
      openUpdateModal(req.release, req.rollback)
      store.updatePrompt = null
    }
  }
)

async function onUpdateNow() {
  const release = updateModal.release
  if (!release) return
  try {
    const { taskId } = await startUpdateDownload(release, updateModal.rollback ? 'rollback' : 'upgrade')
    updateModal.taskId = taskId
    updateModal.state = 'downloading'
  } catch (e) {
    toast('启动更新下载失败：' + errText(e), 'error')
    updateModal.open = false
  }
}
function onUpdateLater() {
  updateModal.open = false
}
async function onUpdateSkip() {
  const release = updateModal.release
  updateModal.open = false
  if (!release) return
  try {
    await skipUpdateVersion(release.version)
    store.settings = { ...store.settings!, skipUpdateVersion: release.version }
    toast(`已跳过 v${release.version}，下个版本再提醒`, 'info')
  } catch (e) {
    toast('保存失败：' + errText(e), 'error')
  }
}
async function onUpdateCancelDownload() {
  if (updateModal.taskId) await cancelTask(updateModal.taskId)
  updateModal.open = false
}
async function onUpdateInstallNow() {
  const release = updateModal.release
  if (!release) return
  try {
    await applyUpdate(release)
    // 主进程将退出：无需后续处理
  } catch (e) {
    toast('安装更新失败：' + errText(e), 'error')
    updateModal.open = false
  }
}

// 配置文件版本不兼容（回退后旧版读到新版配置）：继续尝试 / 重置设置
const configMismatch = ref(false)
async function checkConfigStatus() {
  try {
    const s = await getConfigStatus()
    if (s.mismatch === 'newer') configMismatch.value = true
  } catch { /* 检查失败不打扰 */ }
}
async function onConfigReset() {
  try {
    await resetSettingsToDefaults()
    configMismatch.value = false
    toast('设置已重置为默认值（原配置已备份）', 'success')
    setTimeout(() => location.reload(), 800)
  } catch (e) {
    toast('重置失败：' + errText(e), 'error')
  }
}

// 自绘标题栏中的返回按钮使用真实视图历史；不伪造“返回”入口。
const viewHistory = ref<ViewName[]>([])
let navigatingBack = false
watch(
  () => store.currentView,
  (next, previous) => {
    if (navigatingBack) {
      navigatingBack = false
      return
    }
    if (previous && previous !== next) {
      viewHistory.value = [...viewHistory.value.slice(-19), previous]
    }
  },
  { flush: 'sync' }
)
const canGoBack = computed(() => viewHistory.value.length > 0)
function goBack() {
  const target = viewHistory.value.at(-1)
  if (!target) return
  viewHistory.value = viewHistory.value.slice(0, -1)
  navigatingBack = true
  store.currentView = target
}

// ---------------- 全局拖拽导入整合包 ----------------
const dragActive = ref(false)
/** 进入/离开子元素会成对触发 dragenter/dragleave，用计数器避免遮罩闪烁 */
let dragDepth = 0
let internalDrag = false
/** 最近一次 dragover 时间戳：浏览器对拖出窗口/异常手势会停发事件，超时兜底防覆盖层残留 */
let lastDragoverAt = 0
let dragWatchdog: ReturnType<typeof setInterval> | null = null
function endDrag() { internalDrag = false; dragDepth = 0; dragActive.value = false }

/** 覆盖层激活期间启动看门狗：1.5s 没有任何拖拽事件即强制复位 */
function startDragWatchdog() {
  stopDragWatchdog()
  lastDragoverAt = Date.now()
  dragWatchdog = setInterval(() => {
    if (dragActive.value && Date.now() - lastDragoverAt > 1500) endDrag()
  }, 400)
}
function stopDragWatchdog() {
  if (dragWatchdog) {
    clearInterval(dragWatchdog)
    dragWatchdog = null
  }
}
watch(dragActive, (active) => (active ? startDragWatchdog() : stopDragWatchdog()))

const dragHasFiles = (e: DragEvent) =>
  Array.from(e.dataTransfer?.types ?? []).includes('Files')
const dragHasProviderText = (e: DragEvent) => {
  const types = Array.from(e.dataTransfer?.types ?? [])
  return types.includes('text/plain') || types.includes('text/uri-list')
}
const dragHasSupportedData = (e: DragEvent) => acceptsImportDrag(Array.from(e.dataTransfer?.types ?? []), internalDrag)
const looksLikeYggdrasilProvider = (value: string): boolean => {
  const text = value.trim()
  return (
    /^authlib-injector:yggdrasil-server:/i.test(text) ||
    /^https?:\/\//i.test(text) ||
    /^\{[\s\S]*\}$/i.test(text) ||
    /(?:api\s*root|yggdrasil(?:\s*server)?)\s*[:=]/i.test(text) ||
    /^[\w.-]+\.[a-z]{2,}(?:[/:][^\s]*)?$/i.test(text)
  )
}

function onDragEnter(e: DragEvent) {
  if (!dragHasSupportedData(e)) return
  e.preventDefault()
  dragDepth++
  dragActive.value = showsImportOverlay(Array.from(e.dataTransfer?.types ?? []), internalDrag)
  if (dragActive.value) { dlOpen.value = false; noticeOpen.value = false }
}

function onDragOver(e: DragEvent) {
  if (!dragHasSupportedData(e)) return
  e.preventDefault() // 必须 preventDefault 才允许 drop
  lastDragoverAt = Date.now()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dragActive.value = showsImportOverlay(Array.from(e.dataTransfer?.types ?? []), internalDrag)
}

function onDragLeave(e: DragEvent) {
  if (!dragHasSupportedData(e)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragActive.value = false
}

function onDrop(e: DragEvent) {
  // 覆盖层复位先于一切判定：任何 drop 发生都意味着拖拽手势已结束
  dragDepth = 0
  dragActive.value = false
  if (!dragHasSupportedData(e)) return
  e.preventDefault()
  dlOpen.value = false; noticeOpen.value = false
  const dropped = Array.from(e.dataTransfer?.files ?? [])
  if (!dropped.length) {
    const text =
      e.dataTransfer?.getData('text/plain') || e.dataTransfer?.getData('text/uri-list') || ''
    if (looksLikeYggdrasilProvider(text)) {
      routeYggdrasilImport({ kind: 'text', value: text })
    }
    return
  }
  const paths = dropped.map((f) => window.kamucl.getFilePath(f))
  const names = dropped.map((f) => f.name.toLowerCase())

  if (names.length === 1 && /\.(json|txt|url|yggdrasil)$/.test(names[0])) {
    routeYggdrasilImport({ kind: 'file', value: paths[0] })
    return
  }

  // 单项拖入先按内容识别：.mrpack 始终优先，ZIP/文件夹可能是世界存档。
  if (names.length === 1) {
    void routeSingleImport(paths[0], names[0])
    return
  }
  // 全部为非压缩包扩展（.jar 或文件夹）→ MOD 拖入即装流程
  if (names.every((n) => !/\.(mrpack|zip)$/.test(n))) {
    modDrop.files = paths
    modDrop.open = true
    return
  }
  toast('不能混合拖入整合包与其他文件，请分开拖入', 'error')
}

function routeYggdrasilImport(input: YggdrasilProviderInput) {
  store.pendingYggdrasilImport = input
  store.currentView = 'accounts'
  void nextTick(() => {
    const pending = store.pendingYggdrasilImport
    if (pending && store.yggdrasilImportHandler) {
      store.pendingYggdrasilImport = null
      store.yggdrasilImportHandler(pending)
    }
  })
}

// ---------------- MOD 拖入即装 ----------------
const modDrop = reactive({ open: false, files: [] as string[] })

const worldModal = reactive({
  open: false,
  filePath: '',
  info: null as WorldImportInfo | null
})

async function routeSingleImport(filePath: string, displayName: string) {
  if (/\.mrpack$/i.test(displayName)) {
    await openModpackImport(filePath)
    return
  }
  if (!/\.jar$/i.test(displayName)) {
    try {
      const info = await probeWorld(filePath)
      if (info) {
        worldModal.filePath = filePath
        worldModal.info = info
        worldModal.open = true
        return
      }
    } catch (e) {
      toast('存档识别失败：' + errText(e), 'error')
      return
    }
  }
  if (/\.zip$/i.test(displayName)) {
    await openModpackImport(filePath)
    return
  }
  modDrop.files = [filePath]
  modDrop.open = true
}

// ---------------- 整合包导入确认弹窗 ----------------
const FORMAT_LABEL: Record<ModpackInfo['format'], string> = {
  mrpack: 'Modrinth',
  curseforge: 'CurseForge',
  fullpack: '完整客户端包'
}
const FORMAT_TAG_CLASS: Record<ModpackInfo['format'], string> = {
  mrpack: 'tag-success',
  curseforge: 'tag-gold',
  fullpack: 'tag-cyan'
}

interface ModpackModal {
  open: boolean
  probing: boolean
  error: string
  filePath: string
  info: ModpackInfo | null
  nameSource: 'file' | 'inner'
  customName: string
  targetFolder: string
  conflictAction: 'rename' | 'new' | 'update' | 'overwrite'
  existingId: string
  confirmReplace: boolean
  keySyncOverride: boolean
}

const mpModal = reactive<ModpackModal>({
  open: false,
  probing: false,
  error: '',
  filePath: '',
  info: null,
  nameSource: 'file',
  customName: '',
  targetFolder: '',
  conflictAction: 'rename',
  existingId: '',
  confirmReplace: false,
  keySyncOverride: false
})

const mpFormatLabel = computed(() => (mpModal.info ? FORMAT_LABEL[mpModal.info.format] : ''))
const mpFormatTagClass = computed(() =>
  mpModal.info ? FORMAT_TAG_CLASS[mpModal.info.format] : ''
)
const normalizeMpName = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
const mpExistingInFolder = computed(() =>
  (mpModal.info?.existingInstances ?? []).filter((item) => item.folder === mpModal.targetFolder)
)
const mpNameConflict = computed(() =>
  mpExistingInFolder.value.find(
    (item) => normalizeMpName(item.id) === normalizeMpName(mpModal.customName)
  )
)
const mpRelatedExisting = computed(() => {
  const result = mpExistingInFolder.value.filter(
    (item) => item.samePackVersion || normalizeMpName(item.id) === normalizeMpName(mpModal.customName)
  )
  return [...new Map(result.map((item) => [item.id, item])).values()]
})
const mpNeedsReplaceConfirm = computed(
  () => mpModal.conflictAction === 'update' || mpModal.conflictAction === 'overwrite'
)

function fmtPackBytes(bytes: number): string {
  if (!bytes) return '大小未知'
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function setMpNameSource(source: 'file' | 'inner') {
  mpModal.nameSource = source
  if (mpModal.info) mpModal.customName = source === 'inner' ? mpModal.info.innerName : mpModal.info.fileName
  mpModal.confirmReplace = false
}

function onMpTargetFolderChange() {
  const related = mpRelatedExisting.value[0]
  mpModal.existingId = related?.id ?? ''
  mpModal.conflictAction = related ? 'new' : 'rename'
  mpModal.confirmReplace = false
  mpModal.error = ''
}

function onMpConflictActionChange() {
  mpModal.confirmReplace = false
  mpModal.error = ''
  if (mpNeedsReplaceConfirm.value) {
    const valid = mpExistingInFolder.value.some((item) => item.id === mpModal.existingId)
    if (!valid) mpModal.existingId = mpRelatedExisting.value[0]?.id ?? mpExistingInFolder.value[0]?.id ?? ''
  }
}

/** 拿到文件路径后先 probe 解析，弹确认框；解析失败在框内展示错误 */
async function openModpackImport(filePath: string) {
  if (!filePath) return
  Object.assign(mpModal, {
    open: true,
    probing: true,
    error: '',
    filePath,
    info: null,
    nameSource: 'file' as const,
    customName: '',
    targetFolder: store.settings?.activeFolder || store.settings?.gameDir || '',
    conflictAction: 'rename' as const,
    existingId: '',
    confirmReplace: false
  })
  try {
    const info = await probeModpack(filePath)
    // 防止解析期间用户又发起了另一次导入，旧结果覆盖新弹窗
    if (mpModal.filePath === filePath) {
      mpModal.info = info
      mpModal.customName = info.fileName
      const relevant = info.existingInstances.find(
        (item) => item.folder === mpModal.targetFolder && (item.sameNormalizedName || item.samePackVersion)
      )
      mpModal.existingId = relevant?.id ?? ''
      mpModal.conflictAction = relevant ? 'new' : 'rename'
    }
  } catch (e) {
    if (mpModal.filePath === filePath) mpModal.error = errText(e)
  } finally {
    if (mpModal.filePath === filePath) mpModal.probing = false
  }
}

function closeModpackImport() {
  mpModal.open = false
}

/** 确认导入：主进程后台异步执行，完成/失败由 installDone 订阅统一提示 */
function confirmModpackImport() {
  if (!mpModal.info) return
  if (!mpModal.customName.trim()) {
    mpModal.error = '实例名称不能为空'
    return
  }
  if (mpModal.conflictAction === 'rename' && mpNameConflict.value) {
    mpModal.error = `实例名称已存在：${mpNameConflict.value.id}，请改名或选择其他处理方式`
    return
  }
  if (mpNeedsReplaceConfirm.value && (!mpModal.existingId || !mpModal.confirmReplace)) {
    mpModal.error = '请选择现有实例并勾选影响范围确认'
    return
  }
  const filePath = mpModal.filePath
  const nameSource = mpModal.nameSource
  mpModal.open = false
  toast('开始解析并安装整合包…', 'info')
  void installModpack(filePath, {
    nameSource,
    instanceName: mpModal.customName.trim(),
    targetFolder: mpModal.targetFolder,
    conflictAction: mpModal.conflictAction,
    existingId: mpModal.existingId || undefined,
    confirmReplace: mpNeedsReplaceConfirm.value && mpModal.confirmReplace,
    keySyncOverride: mpModal.keySyncOverride
  }).catch((e) => {
    toast('整合包安装失败：' + errText(e), 'error')
  })
}

/** 顶栏「导入」按钮：系统文件选择框选整合包 */
async function onImportClick() {
  try {
    const p = await selectFile()
    if (p) void routeSingleImport(p, p.split(/[\\/]/).pop() ?? p)
  } catch (e) {
    toast('整合包安装失败：' + errText(e), 'error')
  }
}

// ---------------- 通知中心 ----------------
const noticeOpen = ref(false)

function toggleNotices() {
  noticeOpen.value = !noticeOpen.value
  if (noticeOpen.value) markNoticesRead()
}

// ---------------- 启动失败日志导出 ----------------
const launchFail = reactive({ open: false, title: '', text: '', exporting: false })

async function onExportLogs() {
  if (launchFail.exporting) return
  launchFail.exporting = true
  try {
    const p = await exportLaunchLogs(store.launchingVersionId)
    if (p) {
      toast(`错误日志已导出：${p}`, 'success')
      launchFail.open = false
    }
  } catch (e) {
    toast('导出失败：' + errText(e), 'error')
  } finally {
    launchFail.exporting = false
  }
}

// ---------------- 下载中心 ----------------
const dlOpen = ref(false)
const notesOpen = ref(false)

/** 顶栏空白处点击关闭已展开的下拉面板（顶栏是 -webkit-app-region:drag 拖拽区，点击不会落到下拉遮罩上） */
function onTopbarPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('button, input, select, textarea, a, [role="button"]')) closeTopDropdowns()
}
function closeTopDropdowns() {
  noticeOpen.value = false
  dlOpen.value = false
  notesOpen.value = false
}
/** 操作习惯：下拉打开后点击面板与触发按钮之外的任意位置即关闭（全屏遮罩之外的兜底） */
function onGlobalPointerDown(event: PointerEvent) {
  if (!noticeOpen.value && !dlOpen.value && !notesOpen.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest?.('.notice-panel, .dl-toggle, [title="通知"]')) return
  closeTopDropdowns()
}
const activeTaskCount = computed(
  () =>
    store.tasks.filter(
      (t) => t.status === 'running' || t.status === 'paused' || t.status === 'cancelling'
    ).length
)
const launcherHealth = computed(() => {
  if (store.launchState?.status === 'error') {
    return { tone: 'error', text: '最近启动出现异常' }
  }
  if (activeTaskCount.value) {
    return { tone: 'busy', text: `${activeTaskCount.value} 项后台任务进行中` }
  }
  return { tone: 'ok', text: '全部系统运行正常' }
})

async function onPauseTask(id: string) {
  const task = store.tasks.find((t) => t.id === id)
  if (!task || task.status !== 'running') return
  try {
    if (await pauseTask(id)) task.status = 'paused'
  } catch (e) {
    toast('暂停失败：' + errText(e), 'error')
  }
}

async function onResumeTask(id: string) {
  const task = store.tasks.find((t) => t.id === id)
  if (!task || task.status !== 'paused') return
  try {
    if (await resumeTask(id)) task.status = 'running'
  } catch (e) {
    toast('恢复失败：' + errText(e), 'error')
  }
}

async function onCancelTask(id: string) {
  const task = store.tasks.find((t) => t.id === id)
  if (!task || (task.status !== 'running' && task.status !== 'paused')) return
  task.status = 'cancelling'
  try {
    const found = await cancelTask(id)
    if (!found) {
      finalizeTask({ taskId: id, ok: false, cancelled: true, error: '任务已结束' })
      toast('任务已结束或不存在', 'info')
    }
  } catch (e) {
    toast('取消失败：' + errText(e), 'error')
  }
}

/** 任务副标题：阶段标签与进度文本重复时只显示一次 */
function taskSubText(t: { stage: string; text: string }): string {
  const label = stageLabel(t.stage)
  return t.text.startsWith(label) ? t.text : `${label} · ${t.text}`
}

function taskEtaText(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 3) return ''
  if (seconds >= 3600) return ` · 约剩 ${Math.ceil(seconds / 3600)}h`
  if (seconds >= 60) return ` · 约剩 ${Math.ceil(seconds / 60)}min`
  return ` · 约剩 ${Math.round(seconds)}s`
}

function fmtNoticeTime(ts: number): string {
  const d = new Date(ts)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const today = new Date().toDateString() === d.toDateString()
  return today ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

const failedBackground = ref('')

/** 背景图列表：多图自动切换用 images；否则回退单张 image */
const bgImages = computed(() => {
  const bg = store.settings?.background
  if (!bg || bg.mode !== 'image') return [] as string[]
  return bg.images?.length ? bg.images : (bg.image ? [bg.image] : [])
})
const BG_INDEX_KEY = 'kamucl:bg-last-index'
const currentBgIndex = ref(0)
const currentBgImage = computed(() => bgImages.value[currentBgIndex.value % Math.max(1, bgImages.value.length)] ?? '')

/** 切换到下一张背景图（按顺序/随机）；off 模式不切换 */
function switchBackground() {
  const list = bgImages.value
  const mode = store.settings?.background.switchMode ?? 'off'
  if (mode === 'off' || list.length < 2) return
  if (mode === 'random') {
    let next = currentBgIndex.value
    while (next === currentBgIndex.value) next = Math.floor(Math.random() * list.length)
    currentBgIndex.value = next
  } else {
    currentBgIndex.value = (currentBgIndex.value + 1) % list.length
  }
  localStorage.setItem(BG_INDEX_KEY, String(currentBgIndex.value))
}

let bgSwitchTimer: ReturnType<typeof setInterval> | undefined
function armBgSwitchTimer() {
  clearInterval(bgSwitchTimer)
  bgSwitchTimer = undefined
  const bg = store.settings?.background
  const mode = bg?.switchMode ?? 'off'
  if (bg?.mode !== 'image' || mode === 'off' || bgImages.value.length < 2) return
  const sec = Math.max(30, bg?.switchIntervalSec ?? 300)
  // document.hidden 时跳过切换：页面不可见即暂停轮换，回到前台后下一拍继续
  bgSwitchTimer = setInterval(() => {
    if (document.hidden) return
    switchBackground()
  }, sec * 1000)
}

watch(
  () => [store.settings?.background.mode, currentBgImage.value] as const,
  ([mode, imagePath]) => {
    failedBackground.value = ''
    if (mode !== 'image' || !imagePath) return
    const probe = new Image()
    probe.onload = () => {
      if (currentBgImage.value === imagePath) failedBackground.value = ''
    }
    probe.onerror = () => {
      if (currentBgImage.value !== imagePath) return
      failedBackground.value = imagePath
      toast('自定义背景不可用，已回退到主题默认背景', 'error')
    }
    probe.src = managedImageUrl(imagePath)
  },
  { immediate: true }
)

// 切换策略/图片列表变化时重排定时器；图片被删除导致越界时收敛索引
watch([() => store.settings?.background.switchMode, () => store.settings?.background.switchIntervalSec, bgImages], () => {
  if (currentBgIndex.value >= bgImages.value.length) currentBgIndex.value = 0
  armBgSwitchTimer()
})

/**
 * 用户显式选择的个性化背景层。默认不生成内部壁纸：桌面透视由透明
 * BrowserWindow + Windows DWM Acrylic 提供。
 */
const bgStyle = computed(() => {
  const bg = store.settings?.background
  if (!bg || bg.mode === 'none') return null
  if (bg.mode === 'color') {
    return {
      background: bg.color,
      opacity: String(bg.opacity)
    }
  }
  if (bg.mode === 'image' && currentBgImage.value && failedBackground.value !== currentBgImage.value) {
    const size = bg.fit === 'fill' ? '100% 100%' : bg.fit === 'fit' ? 'contain' : 'cover'
    return {
      inset: bg.blur > 0 ? `${-Math.ceil(bg.blur * 1.5)}px` : '0',
      backgroundColor: bg.color,
      backgroundImage: `url("${managedImageUrl(currentBgImage.value)}")`,
      backgroundSize: size,
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      ...backgroundImageEffect(bg)
    }
  }
  return null
})

// ---------------- 主题应用（亮 / 暗 / 自定义） ----------------
/** 自定义主题写入的全部 inline CSS 变量（切回亮/暗时需统一清除） */
const CUSTOM_VARS = [
  '--accent',
  '--accent-2',
  '--accent-deep',
  '--accent-grad',
  '--accent-soft',
  '--on-accent',
  '--bg',
  '--bg-2',
  '--card',
  '--card-solid',
  '--card-2',
  '--text',
  '--text-dim',
  '--border',
  '--sidebar-text',
  '--bn-text',
  '--border-strong',
  '--scroll',
  '--hover',
  '--mask',
  '--danger',
  '--danger-soft',
  '--danger-border',
  '--ok',
  '--ok-soft',
  '--cyan',
  '--cyan-soft',
  '--shadow',
  '--shadow-lg',
  '--shell-surface',
  '--glass-blur',
  '--sidebar-w',
  '--banner-h',
  '--radius'
]

/** 解析 #rrggbb 并计算相对亮度（0-1），非法输入按暗色处理 */
function hexLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

function clearCustomVars() {
  const st = document.documentElement.style
  CUSTOM_VARS.forEach((v) => st.removeProperty(v))
}

/** 把 settings.custom 映射为 documentElement 上的 inline CSS 变量覆盖 */
function applyCustomVars(custom: CustomTheme, theme: ThemeName) {
  const st = document.documentElement.style
  const colors = theme === 'custom' ? readableCustomColors(custom.colors) : custom.colors
  const accent = colors.accent
  const dark = hexLuminance(colors.bg) < 0.46
  const transparent = theme === 'transparent'
  const cardOpacity = dark ? 44 : 62
  const raisedOpacity = dark ? 36 : 52
  const sideOpacity = dark ? 26 : 38
  const accent2 = `color-mix(in srgb, ${accent} 72%, white)`
  const accentDeep = `color-mix(in srgb, ${accent} 78%, black)`
  st.setProperty('--accent', accent)
  st.setProperty('--accent-2', accent2)
  st.setProperty('--accent-deep', accentDeep)
  st.setProperty(
    '--accent-grad',
    `linear-gradient(135deg, ${accent2} 0%, ${accent} 55%, ${accentDeep} 100%)`
  )
  st.setProperty('--accent-soft', `color-mix(in srgb, ${accent} 14%, transparent)`)
  st.setProperty('--on-accent', hexLuminance(accent) > 0.6 ? '#1a1208' : '#ffffff')
  st.setProperty('--bg', colors.bg)
  st.setProperty('--card', `color-mix(in srgb, ${colors.card} ${cardOpacity}%, transparent)`)
  st.setProperty('--card-solid', colors.card)
  st.setProperty('--card-2', `color-mix(in srgb, ${colors.card} ${raisedOpacity}%, transparent)`)
  st.setProperty('--text', colors.text)
  st.setProperty('--text-dim', colors.textDim)
  st.setProperty('--border', colors.border)
  st.setProperty('--bg-2', `color-mix(in srgb, ${colors.sidebarBg} ${sideOpacity}%, transparent)`)
  st.setProperty('--sidebar-text', colors.sidebarText)
  st.setProperty('--bn-text', colors.bannerText)
  st.setProperty('--border-strong', `color-mix(in srgb, ${colors.border} 65%, ${colors.text})`)
  st.setProperty('--scroll', `color-mix(in srgb, ${colors.textDim} 32%, transparent)`)
  st.setProperty('--hover', `color-mix(in srgb, ${colors.text} ${dark ? 7 : 5}%, transparent)`)
  st.setProperty('--mask', dark ? 'rgba(2, 5, 6, 0.72)' : 'rgba(27, 36, 55, 0.42)')
  st.setProperty('--danger', dark ? '#ff6b73' : '#dc2626')
  st.setProperty('--danger-soft', dark ? 'rgba(255, 107, 115, 0.13)' : 'rgba(220, 38, 38, 0.08)')
  st.setProperty('--danger-border', dark ? 'rgba(255, 107, 115, 0.34)' : 'rgba(220, 38, 38, 0.3)')
  st.setProperty('--ok', dark ? '#68dc88' : '#168a42')
  st.setProperty('--ok-soft', dark ? 'rgba(104, 220, 136, 0.13)' : 'rgba(22, 138, 66, 0.1)')
  st.setProperty('--cyan', dark ? '#9ed7e9' : '#0e7490')
  st.setProperty('--cyan-soft', dark ? 'rgba(158, 215, 233, 0.13)' : 'rgba(14, 116, 144, 0.1)')
  st.setProperty('--shadow', dark ? '0 8px 24px rgba(0, 0, 0, 0.22)' : '0 8px 24px rgba(31, 50, 85, 0.09)')
  st.setProperty('--shadow-lg', dark ? '0 20px 55px rgba(0, 0, 0, 0.42)' : '0 20px 55px rgba(31, 50, 85, 0.18)')
  st.setProperty(
    '--shell-surface',
    `color-mix(in srgb, ${colors.bg} ${transparent ? 24 : dark ? 30 : 42}%, transparent)`
  )
  st.setProperty('--glass-blur', '28px')
  // 图一布局是全部主题共享的固定骨架；旧 layout 字段只保留兼容，不再改变结构。
  st.setProperty('--sidebar-w', '208px')
  st.setProperty('--banner-h', '430px')
  st.setProperty('--radius', '14px')
}

/**
 * 所有正式主题共用玻璃变量与布局；个性化只替换用户色板。
 */
function applyTheme(theme?: ThemeName, custom?: CustomTheme) {
  const root = document.documentElement
  const selected = theme ?? 'transparent'
  clearCustomVars()
  root.dataset.theme = selected
  if (selected === 'custom') {
    applyCustomVars(custom ?? DEFAULT_CUSTOM_THEME, selected)
    return
  }
  const preset = THEME_PRESETS[selected] ?? THEME_PRESETS.transparent
  applyCustomVars(
    { colors: preset.colors, layout: DEFAULT_CUSTOM_THEME.layout },
    selected
  )
}

// settings 未加载时按亮色应用；加载完成 / 修改后 watch 触发立即生效
// deep: true 保证 custom.colors / custom.layout 内部字段变化也重新应用（即改即生效）
watch(
  () => [store.settings?.theme, store.settings?.custom] as const,
  ([t, c]) => applyTheme(t, c),
  { immediate: true, deep: true }
)

// ---------------- 个性化点选编辑模式 ----------------
/** 编辑模式下捕获点击：命中最内层 [data-edit] 板块则拦截真实动作并选中（再点取消） */
function onEditClick(e: MouseEvent) {
  if (!store.editMode) return
  const el = (e.target as HTMLElement | null)?.closest?.('[data-edit]') as HTMLElement | null
  if (!el) return // 未命中不清空，便于点击编辑面板
  e.preventDefault()
  e.stopPropagation()
  const key = el.dataset.edit ?? ''
  store.editTarget = store.editTarget === key ? '' : key
}

/** Esc 退出编辑模式 */
function onEditKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && store.editMode) exitEditMode()
}

/** 同步选中板块的 .edit-active 高亮描边（视图切换后需重挂） */
async function refreshEditHighlight() {
  await nextTick()
  document
    .querySelectorAll('[data-edit].edit-active')
    .forEach((el) => el.classList.remove('edit-active'))
  if (store.editMode && store.editTarget) {
    document
      .querySelectorAll(`[data-edit="${store.editTarget}"]`)
      .forEach((el) => el.classList.add('edit-active'))
  }
}

watch(
  () => [store.editMode, store.editTarget, store.currentView] as const,
  () => void refreshEditHighlight(),
  { flush: 'post' }
)

// ---------------- 初始化与事件订阅 ----------------
const offs: Array<() => void> = []

onMounted(async () => {
  applyTheme(store.settings?.theme, store.settings?.custom)
  nextTick(updateNavBlob)
  // 每次上线自动切换一张背景图（按顺序/随机）；off 模式固定第一张
  {
    const mode = store.settings?.background.switchMode ?? 'off'
    if (store.settings?.background.mode === 'image' && mode !== 'off' && bgImages.value.length > 1) {
      const last = Number(localStorage.getItem(BG_INDEX_KEY) ?? -1)
      currentBgIndex.value = Number.isInteger(last) && last >= 0 && last < bgImages.value.length ? last : 0
      switchBackground()
    }
    armBgSwitchTimer()
  }
  void import('./plugins').then((m) => m.loadEnabledPlugins())
  window.addEventListener('keydown', onEditKeydown)
  // Teleports are outside .shell; capture above their masks without accepting
  // internal text/image drags or invoking the import handler twice.
  const dragStart = () => { internalDrag = true }
  const dragEvents = { dragenter: onDragEnter, dragover: onDragOver, dragleave: onDragLeave, drop: onDrop, dragstart: dragStart, dragend: endDrag }
  for (const [type, listener] of Object.entries(dragEvents)) {
    window.addEventListener(type, listener as EventListener, true)
    offs.push(() => window.removeEventListener(type, listener as EventListener, true))
  }
  // 注册全局整合包导入入口（供首页快速操作等任意页面触发）
  store.importHandler = (filePath: string) => void openModpackImport(filePath)
  window.addEventListener('pointerdown', onGlobalPointerDown, true)
  offs.push(() => window.removeEventListener('pointerdown', onGlobalPointerDown, true))
  offs.push(
    window.kamucl.on('window:caption-pointerdown', closeTopDropdowns),
    onProgress((e) => {
      store.progress = e
      upsertTaskProgress(e)
    }),
    onTaskDone((r) => {
      finalizeTask(r)
      resetProgressMono(r.taskId)
      // 更新下载完成 → 弹窗切到「下载完成」待安装态
      if (updateModal.open && updateModal.taskId && r.taskId === updateModal.taskId) {
        if (r.ok) {
          updateModal.state = 'done'
        } else {
          updateModal.open = false
          if (!r.cancelled) toast('更新下载失败：' + (r.error || '未知错误'), 'error')
        }
      }
      if (r.cancelled) toast('任务已取消', 'info')
    }),
    onUpdatePrompt((payload) => {
      // 回滚通知（更新失败自动还原后备份）
      if ((payload as { rollbackNotice?: boolean }).rollbackNotice) {
        toast('更新失败，已自动回滚到当前版本', 'error')
        return
      }
      store.updatePrompt = { release: payload, rollback: false }
    }),
    onUpdateSlowHint((r) => {
      if (updateModal.open && r.taskId === updateModal.taskId) updateModal.slowHint = true
    }),
    onUpdateReady((r) => {
      toast(`新版本 v${r.version} 已下载完成，关闭启动器时将自动安装`, 'success')
    }),
    onInstallDone((r) => {
      store.installing.delete(r.versionId)
      store.progress = null
      finalizeTask(r)
      resetProgressMono(r.taskId)
      if (r.ok) {
        store.failedInstalls.delete(r.versionId)
        toast(`版本 ${r.versionId} 安装完成`, 'success')
        void refreshInstalled()
      } else if (r.cancelled) {
        // 用户主动取消：不记失败、不弹错误（taskDone 已提示）
        void refreshInstalled()
      } else {
        store.failedInstalls.add(r.versionId)
        toast(`安装失败${r.stage ? `（${stageLabel(r.stage)}）` : ''}：` + (r.error ?? '未知错误'), 'error')
      }
    }),
    // 游戏目录迁移完成：立即全局刷新（版本列表/最近游戏/资源管理），全程无需重启
    onGameDirDone((r) => {
      store.progress = null
      resetProgressMono()
      if (r.ok) {
        void refreshInstalled().then(() => {
          store.fsRefreshTick++
        })
      }
    }),
    onLaunchLog((line) => {
      store.logs.push(line)
      if (store.logs.length > 1000) store.logs.splice(0, store.logs.length - 1000)
    }),
    onLaunchState((s) => {
      const focused = applyLaunchState(s)
      // 启动成功（进入 running）时记录该版本的最近游玩时间
      if (s.status === 'running' && store.launchingVersionId) {
        recordLastPlayed(s.versionId || store.launchingVersionId)
      }
      if (focused && (s.status === 'exited' || s.status === 'error')) store.progress = null
      if (s.status === 'error') {
        // 启动失败：弹窗提示并提供「导出错误日志」
        launchFail.open = true
        launchFail.title = '游戏启动失败'
        launchFail.text = s.text
      } else if (s.status === 'exited') {
        if (s.code && !s.intentionalRestart && !s.intentionalStop) {
          // 非 0 退出码 = 崩溃，同样提供日志导出
          launchFail.open = true
          launchFail.title = `游戏异常退出（代码 ${s.code}）`
          launchFail.text = '游戏进程崩溃或被异常终止。可导出错误日志（含 crash-report 与 latest.log）用于排查。'
        } else {
          toast('游戏已退出', 'info')
        }
        // 游戏退出后只扫描刚运行的实例，避免共享 servers.dat 被错误关联到其他版本。
        const exitedVersionId = s.versionId || store.launchingVersionId
        const exitedFolder =
          s.folder || store.launchingFolder || (store.settings?.activeFolder ?? store.settings?.gameDir)
        void import('./api').then(({ syncServersFromDat }) =>
          syncServersFromDat(exitedVersionId || undefined, exitedFolder).catch(() => undefined)
        )
      }
    })
  )

  try {
    store.settings = await getSettings()
    window.kamucl.send('boot:stage', 'settings')
    void checkConfigStatus()
    await Promise.all([
      refreshAccounts().then(() => window.kamucl.send('boot:stage', 'accounts')),
      refreshInstalled().then(() => window.kamucl.send('boot:stage', 'instances'))
    ])
        // 启动自检：发现上次下载未完成的残缺版本，提示去已安装页处理
        const broken = store.installed.filter((v) => v.incomplete)
        if (broken.length) {
          toast(
            `检测到 ${broken.length} 个版本下载未完成（${broken.map((b) => b.id).join('、')}），可在「游戏版本 → 已安装」继续下载或删除残留`,
            'info'
          )
        }

  } catch (e) {
    toast('初始化失败：' + errText(e), 'error')
  } finally {
    store.initialized = true
    await nextTick()
    await waitForBootTasks()
    await nextTick()
    await document.fonts.ready
    // Decode rendered assets after async account/skin/thumbnail bindings have settled.
    await Promise.all([...document.images].map(img => img.decode().catch(() => undefined)))
    await nextTick()
    await waitForBootTasks()
    sealBootTasks()
    window.kamucl.send('boot:stage', 'assets')
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    window.kamucl.send('boot:stage', 'paint')
    window.kamucl.send('boot:renderer-ready')
  }
})

onUnmounted(() => {
  stopDragWatchdog()
  clearInterval(bgSwitchTimer)
  window.removeEventListener('keydown', onEditKeydown)
  offs.forEach((off) => off())
})
</script>

<template>
  <LaunchNotice />
  <!-- 自定义背景层（纯色/图片 + 透明度 + 模糊） -->
  <div v-if="bgStyle" class="app-bg" :style="bgStyle"></div>
  <div
    class="shell"
    :class="{ 'edit-mode': store.editMode, 'has-bg': !!bgStyle }"
    @click.capture="onEditClick"
  >
    <!-- ============ 左侧边栏（宽度 --sidebar-w） ============ -->
    <aside class="sidebar" data-edit="sidebar">
      <!-- Logo 区 -->
      <div class="logo-area">
        <img class="brand-head" :src="brandHead" alt="KaMuaMua 的 Minecraft 头像" />
        <div class="logo-text">
          <span class="logo-name">KAMUCL</span>
          <span class="logo-version">v{{ appVersion }}</span>
        </div>
      </div>

      <!-- 导航 -->
      <nav class="nav" ref="navEl" @mouseleave="navHoverKey = ''">
        <div class="nav-blob" :class="{ on: navBlob.on }" :style="navBlobStyle" aria-hidden="true"></div>
        <template v-for="item in visibleNavItems" :key="item.key">
          <button
            class="nav-item"
            :data-nav="item.key"
            :class="{ active: store.currentView === item.key }"
            @mouseenter="navHoverKey = item.key"
            @click="store.currentView = item.key"
          >
            <span class="nav-icon" v-html="item.icon"></span>
            <span class="nav-label">{{ item.label }}</span>
          </button>

          <!-- 资源管理子级菜单（插在「游戏版本」之后） -->
          <template v-if="item.key === 'game'">
            <button
              class="nav-item nav-parent"
              data-nav="resources"
              :class="{ active: inResourceGroup }"
              @mouseenter="navHoverKey = 'resources'"
              @click="resourceExpanded = !resourceExpanded"
            >
              <span class="nav-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 11h18"/></svg>
              </span>
              <span class="nav-label">资源管理</span>
              <svg
                class="nav-caret"
                :class="{ open: resourceExpanded || inResourceGroup }"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
            <!-- 资源管理子级菜单：grid 0fr→1fr 高度展开 + 子项错落渐入（插在「游戏版本」之后） -->
            <div class="nav-sub" :class="{ open: resourceExpanded || inResourceGroup }">
              <div class="nav-sub-inner">
                <button
                  v-for="(sub, subIndex) in visibleResourceSubItems"
                  :key="sub.key"
                  class="nav-item nav-sub-item"
                  :data-nav="sub.key"
                  :style="{ '--sub-i': subIndex }"
                  :class="{ active: store.currentView === sub.key }"
                  @mouseenter="navHoverKey = sub.key"
                  @click="store.currentView = sub.key"
                >
                  <span class="nav-icon" v-html="sub.icon"></span>
                  <span class="nav-label">{{ sub.label }}</span>
                </button>
              </div>
            </div>
          </template>
        </template>
      </nav>

      <button
        class="sidebar-health"
        :class="`is-${launcherHealth.tone}`"
        title="打开通知中心"
        @click="toggleNotices"
      >
        <i></i>
        <span>{{ launcherHealth.text }}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>
      </button>
    </aside>

    <!-- ============ 右侧（顶栏 + 内容） ============ -->
    <div class="main-area">
      <!-- 顶部栏（可拖拽） -->
      <header class="topbar" data-edit="topbar" @pointerdown="onTopbarPointerDown">
        <button
          v-if="canGoBack && store.currentView !== 'home'"
          class="top-back"
          :disabled="!canGoBack"
          title="返回上一个页面"
          @click="goBack"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            v-model="store.searchKeyword"
            class="search-input"
            placeholder="搜索游戏版本、模组、资源包…"
            @keydown.enter="store.currentView = /^\d+(?:\.\d+)+$/.test(store.searchKeyword.trim()) ? 'game' : 'community'"
          />
        </div>

        <div class="top-actions">
          <button v-if="store.currentView !== 'home'" class="top-btn dl-toggle" @click="dlOpen = !dlOpen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3v11" />
              <path d="m7 10 5 5 5-5" />
              <path d="M4 21h16" />
            </svg>
            下载
            <span v-if="activeTaskCount" class="dl-badge">{{ activeTaskCount }}</span>
          </button>
          <button v-if="store.currentView !== 'home'" class="top-btn" @click="onImportClick">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 15V4" />
              <path d="m7 8 5-5 5 5" />
              <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
            </svg>
            导入
          </button>
          <button
            v-if="store.currentView === 'home' && activeTaskCount"
            class="top-icon-btn dl-toggle"
            title="下载中心"
            @click="dlOpen = !dlOpen"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11" /><path d="m7 10 5 5 5-5" /><path d="M4 21h16" /></svg>
            <span class="dl-badge compact">{{ activeTaskCount }}</span>
          </button>
          <button v-if="store.currentView === 'home'" class="top-icon-btn dl-toggle" title="更新日志" @click="notesOpen = !notesOpen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9" />
              <path d="M3 4v5h5" />
              <path d="M12 7v5l3.5 2" />
            </svg>
          </button>
          <button class="top-icon-btn" title="通知" @click="toggleNotices">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.7 21a2 2 0 0 1-3.4 0" />
            </svg>
            <span v-if="store.noticesUnread" class="bell-dot"></span>
          </button>

          <span class="top-divider"></span>

          <button class="win-btn" title="最小化" @click="win('minimize')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M5 12h14" />
            </svg>
          </button>
          <button class="win-btn" title="最大化/还原" @click="win('maximize')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <rect x="6" y="6" width="12" height="12" rx="1.5" />
            </svg>
          </button>
          <button class="win-btn win-close" title="关闭" @click="win('close')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <!-- 通知中心下拉 -->
        <Teleport to="body">
          <div v-if="noticeOpen" class="notice-mask" @click="noticeOpen = false"></div>
          <div v-if="noticeOpen" class="notice-panel">
            <div class="notice-head">
              <span class="notice-title">通知</span>
              <button class="btn btn-ghost btn-sm" :disabled="!store.notices.length" @click="store.notices = []">清空</button>
            </div>
            <div v-if="!store.notices.length" class="notice-empty">暂无通知</div>
            <div v-else class="notice-list">
              <div v-for="n in store.notices" :key="n.id" class="notice-item" :class="'notice-' + n.type">
                <span class="notice-dot"></span>
                <div class="notice-body">
                  <p class="notice-text">{{ n.text }}</p>
                  <span class="notice-time">{{ fmtNoticeTime(n.time) }}</span>
                </div>
              </div>
            </div>
          </div>
        </Teleport>

        <!-- 更新日志下拉（首页标题栏秒表入口）：内置各版本改动，无网络依赖 -->
        <Teleport to="body">
          <div v-if="notesOpen" class="notice-mask" @click="notesOpen = false"></div>
          <div v-if="notesOpen" class="notice-panel notes-panel">
            <div class="notice-head">
              <span class="notice-title">更新日志</span>
              <span class="muted">{{ latestUpdateNote()?.version }} · {{ latestUpdateNote()?.date }}</span>
            </div>
            <div class="notes-list">
              <section v-for="note in updateNotes" :key="note.version" class="note-version">
                <h4 class="note-head">
                  <span class="note-ver">{{ note.version }}</span>
                  <span class="muted">{{ note.date }}</span>
                </h4>
                <ul class="note-changes">
                  <li v-for="(c, i) in note.changes" :key="i">{{ c }}</li>
                </ul>
              </section>
            </div>
          </div>
        </Teleport>

        <!-- 下载中心下拉：版本安装/整合包导入/资源下载统一任务列表，支持取消 -->
        <Teleport to="body">
          <div v-if="dlOpen" class="notice-mask" @click="dlOpen = false"></div>
          <div v-if="dlOpen" class="notice-panel dl-panel">
            <div class="notice-head">
              <span class="notice-title">下载中心</span>
              <button class="btn btn-ghost btn-sm" @click="dlOpen = false; store.currentView = 'game'">
                去版本下载
              </button>
            </div>
            <div v-if="!store.tasks.length" class="notice-empty">没有进行中的任务</div>
            <div v-else class="notice-list">
              <div v-for="t in store.tasks" :key="t.id" class="dl-item" :class="'dl-' + t.status">
                <div class="dl-item-head">
                  <span class="dl-title" :title="t.title">{{ t.title }}</span>
                  <span v-if="t.status === 'running'" class="dl-actions">
                    <button class="btn btn-ghost btn-sm" @click="onPauseTask(t.id)">暂停</button>
                    <button class="btn btn-ghost btn-sm" @click="onCancelTask(t.id)">取消</button>
                  </span>
                  <span v-else-if="t.status === 'paused'" class="dl-actions">
                    <button class="btn btn-ghost btn-sm" @click="onResumeTask(t.id)">继续</button>
                    <button class="btn btn-ghost btn-sm" @click="onCancelTask(t.id)">取消</button>
                  </span>
                  <button v-else-if="t.status === 'cancelling'" class="btn btn-ghost btn-sm" disabled>
                    正在取消…
                  </button>
                  <button v-else class="dl-dismiss" title="移除记录" @click="dismissTask(t.id)">×</button>
                </div>
                <div class="dl-sub muted">
                  <template v-if="t.status === 'running'">
                    {{ taskSubText(t) }} · {{ t.indeterminate ? '正在计算总量' : taskProgressPercent(t) + '%' }}{{ taskEtaText(t.etaSeconds) }}
                  </template>
                  <template v-else-if="t.status === 'paused'">已暂停 · {{ t.indeterminate ? '总量未知' : taskProgressPercent(t) + '%' }}</template>
                  <template v-else-if="t.status === 'cancelling'">正在停止网络与后台任务…</template>
                  <template v-else-if="t.status === 'done'">已完成</template>
                  <template v-else-if="t.status === 'cancelled'">已取消</template>
                  <template v-else>
                    失败于「{{ stageLabel(t.stage || 'error') }}」阶段：{{ t.error }}
                  </template>
                </div>
                <div v-if="t.status === 'running' || t.status === 'paused' || t.status === 'cancelling'" class="dl-bar" :class="{ 'is-indeterminate': t.indeterminate && t.status === 'running' }">
                  <div class="dl-bar-fill" :style="{ width: t.indeterminate ? '35%' : taskProgressPercent(t) + '%' }"></div>
                </div>
              </div>
            </div>
          </div>
        </Teleport>
      </header>

      <!-- 内容区（:duration 显式给出过渡时长：窗口被遮挡/最小化时 transitionend 不会触发，setTimeout 兜底防切换卡死） -->
      <main class="content">
        <Transition name="fade" mode="out-in" :duration="250">
          <div :key="store.currentView" class="route-view">
            <component :is="currentComponent" />
          </div>
        </Transition>
      </main>
    </div>

    <Toasts />

    <!-- 启动器自更新弹窗（发现新版本/下载中/下载完成三态） -->
    <UpdateModal
      v-if="updateModal.open && updateModal.release"
      :release="updateModal.release"
      :current-version="appVersion"
      :state="updateModal.state"
      :percent="updatePercent"
      :speed-text="updateSpeedText"
      :slow-hint="updateModal.slowHint"
      :qq-group="qqGroup"
      :rollback="updateModal.rollback"
      @update-now="onUpdateNow"
      @later="onUpdateLater"
      @skip="onUpdateSkip"
      @cancel-download="onUpdateCancelDownload"
      @install-now="onUpdateInstallNow"
      @close="updateModal.open = false"
    />

    <!-- 配置文件版本不兼容（回退后旧版读到新版配置） -->
    <div v-if="configMismatch" class="menu-overlay cfg-mismatch-mask">
      <div class="card cfg-mismatch-modal" role="dialog" aria-label="配置不兼容">
        <h3 class="upd-modal-title">配置文件版本不兼容</h3>
        <p class="muted">当前配置文件由更新版本的启动器创建，可能包含本版本不认识的格式。可以继续尝试使用（可能异常），或重置为默认设置（原配置会自动备份）。</p>
        <div class="upd-modal-actions">
          <button class="btn btn-ghost" @click="configMismatch = false">继续尝试</button>
          <button class="btn btn-danger" @click="onConfigReset">重置设置</button>
        </div>
      </div>
    </div>

    <!-- 个性化编辑模式：右侧滑出编辑面板 -->
    <Transition name="ep-slide">
      <EditPanel v-if="store.editMode" />
    </Transition>
  </div>

  <!-- 整合包拖入：全屏遮罩（pointer-events:none 保证不干扰拖拽事件） -->
  <Teleport to="body">
    <div v-if="dragActive" class="drop-mask">
      <div class="drop-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="m7 8 5-5 5 5" />
          <path d="M12 3v12" />
        </svg>
        <p class="drop-title">松开导入：存档 / 整合包 / MOD / 外置登录提供商</p>
      </div>
    </div>
  </Teleport>

  <!-- MOD 拖入即装确认弹窗 -->
  <ModDropModal :open="modDrop.open" :files="modDrop.files" @close="modDrop.open = false" />

  <WorldImportModal
    :open="worldModal.open"
    :file-path="worldModal.filePath"
    :info="worldModal.info"
    @close="worldModal.open = false"
  />

  <!-- 启动失败：提示 + 导出错误日志 -->
  <Teleport to="body">
    <div v-if="launchFail.open" class="modal-mask" @pointerdown.self="launchFail.open = false">
      <div class="modal launchfail-modal">
        <h3 class="modal-title">{{ launchFail.title }}</h3>
        <p class="launchfail-text">{{ launchFail.text }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="launchFail.open = false">关闭</button>
          <button class="btn btn-gold" :disabled="launchFail.exporting" @click="onExportLogs">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11" /><path d="m7 10 5 5 5-5" /><path d="M4 21h16" /></svg>
            {{ launchFail.exporting ? '导出中…' : '导出错误日志' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 整合包导入确认弹窗 -->
  <Teleport to="body">
    <div v-if="mpModal.open" class="modal-mask" @pointerdown.self="closeModpackImport">
      <div class="modal mp-modal">
        <h3 class="mp-title">导入整合包</h3>

        <!-- 解析中 -->
        <div v-if="mpModal.probing" class="mp-loading">
          <span class="spin"></span>
          <span class="muted">解析中…</span>
        </div>

        <!-- 解析成功：包信息 + 命名选项 -->
        <template v-else-if="mpModal.info">
          <div class="mp-tags">
            <span class="tag" :class="mpFormatTagClass">{{ mpFormatLabel }}</span>
            <span class="tag">MC {{ mpModal.info.mcVersion }}</span>
            <span v-if="mpModal.info.loader" class="tag tag-gold">
              {{ mpModal.info.loader
              }}{{ mpModal.info.loaderVersion ? ' ' + mpModal.info.loaderVersion : '' }}
            </span>
            <span
              v-if="mpModal.info.version && mpModal.info.version !== mpModal.info.innerName"
              class="tag"
              >版本 {{ mpModal.info.version }}</span
            >
          </div>
          <p class="mp-summary">
            {{ mpModal.info.fileCount }} 个清单文件 · {{ fmtPackBytes(mpModal.info.downloadBytes) }}
            <span v-if="mpModal.info.hasOverrides"> · overrides</span>
            <span v-if="mpModal.info.hasClientOverrides"> · client-overrides</span>
          </p>

          <p class="mp-label">目标游戏文件夹</p>
          <select v-model="mpModal.targetFolder" class="select" @change="onMpTargetFolderChange">
            <option v-for="folder in store.settings?.folders || []" :key="folder.path" :value="folder.path">
              {{ folder.name }}{{ folder.isDefault ? '（默认）' : '' }} · {{ folder.path }}
            </option>
          </select>

          <p class="mp-label">实例命名</p>
          <div class="mp-name-opts">
            <button
              class="mp-name-opt"
              :class="{ active: mpModal.nameSource === 'file' }"
              @click="setMpNameSource('file')"
            >
              <span class="mp-radio"></span>
              <span class="mp-name-text">
                <span class="mp-name-label">使用压缩包文件名</span>
                <span class="mp-name-value">{{ mpModal.info.fileName }}</span>
              </span>
            </button>
            <button
              class="mp-name-opt"
              :class="{ active: mpModal.nameSource === 'inner' }"
              @click="setMpNameSource('inner')"
            >
              <span class="mp-radio"></span>
              <span class="mp-name-text">
                <span class="mp-name-label">使用整合包名称</span>
                <span class="mp-name-value">{{ mpModal.info.innerName }}</span>
              </span>
            </button>
          </div>
          <input v-model="mpModal.customName" class="input mp-custom-name" maxlength="120" placeholder="自定义实例名称" @input="mpModal.confirmReplace = false; mpModal.error = ''" />

          <div v-if="mpRelatedExisting.length" class="mp-conflict">
            <strong>检测到实例冲突或相同整合包版本</strong>
            <span>
              {{ mpRelatedExisting.map(item => `${item.id}${item.samePackVersion ? '（同包同版本）' : ''}`).join('、') }}
            </span>
            <div class="mp-conflict-actions">
              <label><input v-model="mpModal.conflictAction" type="radio" value="rename" @change="onMpConflictActionChange" /> 重新命名</label>
              <label><input v-model="mpModal.conflictAction" type="radio" value="new" @change="onMpConflictActionChange" /> 作为新实例安装（自动加序号）</label>
              <label><input v-model="mpModal.conflictAction" type="radio" value="update" @change="onMpConflictActionChange" /> 更新现有实例</label>
              <label><input v-model="mpModal.conflictAction" type="radio" value="overwrite" @change="onMpConflictActionChange" /> 覆盖安装</label>
            </div>

            <template v-if="mpNeedsReplaceConfirm">
              <select v-model="mpModal.existingId" class="select mp-existing-select">
                <option v-for="item in mpExistingInFolder" :key="item.id" :value="item.id">
                  {{ item.id }}{{ item.samePackVersion ? ' · 同一整合包版本' : '' }}
                </option>
              </select>
              <div class="mp-impact" :class="{ danger: mpModal.conflictAction === 'overwrite' }">
                <template v-if="mpModal.conflictAction === 'update'">
                  将重建包管理文件并恢复用户存档、配置及非包管理文件；同名的新包 MOD 优先。操作失败会恢复完整备份。
                </template>
                <template v-else>
                  将重建实例包文件；存档、配置、截图、资源包及可识别的用户 MOD 会保留，其他未知顶层内容可能被移除。操作失败会恢复完整备份。
                </template>
              </div>
              <label class="mp-replace-confirm">
                <input v-model="mpModal.confirmReplace" type="checkbox" />
                <span>我已确认上述影响范围，并同意{{ mpModal.conflictAction === 'update' ? '更新' : '覆盖' }}所选实例。</span>
              </label>
            </template>
          </div>

          <!-- 默认按键冲突：检测到作者预设键位且已开启默认按键同步时，给出替换选项（默认不替换） -->
          <label v-if="mpModal.info?.hasPresetKeys && store.settings?.keySync" class="mp-keysync-opt">
            <input v-model="mpModal.keySyncOverride" type="checkbox" />
            <span>该整合包含作者预设键位（options.txt）。用启动器默认按键替换预设键位；其余设置保留。不勾选则保留作者预设。</span>
          </label>

          <p v-if="mpNameConflict && mpModal.conflictAction === 'rename'" class="mp-error">
            名称「{{ mpModal.customName }}」已存在，请重新命名或选择其他处理方式。
          </p>
          <p v-if="mpModal.error" class="mp-error">{{ mpModal.error }}</p>

          <div class="mp-actions">
            <button class="btn btn-ghost" @click="closeModpackImport">取消</button>
            <button class="btn btn-gold" @click="confirmModpackImport">确认导入</button>
          </div>
        </template>

        <!-- 解析失败 -->
        <template v-else>
          <p class="mp-error">{{ mpModal.error || '无法解析该整合包' }}</p>
          <div class="mp-actions">
            <button class="btn btn-ghost" @click="closeModpackImport">关闭</button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>

  <!-- 编辑模式顶部悬浮提示条（fixed 居中，accent 底） -->
  <Teleport to="body">
    <Transition name="edit-tip">
      <div v-if="store.editMode" class="edit-tip">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67A2.5 2.5 0 0 1 12 22Z" />
        </svg>
        <span>个性化编辑中 · 点击板块自定义颜色</span>
        <button class="edit-tip-done" @click="exitEditMode">完成</button>
      </div>
    </Transition>
  </Teleport>


</template>

<style scoped>
/* 配置不兼容弹窗 */
.cfg-mismatch-mask { z-index: 9600; display: grid; place-items: center; }
.cfg-mismatch-modal { width: min(460px, 90vw); padding: 20px 22px; display: flex; flex-direction: column; gap: 12px; }
.upd-modal-title { margin: 0; font-size: 17px; }
.upd-modal-actions { display: flex; justify-content: flex-end; gap: 10px; }
.shell {
  display: flex;
  width: 100%;
  height: 100%;
  background: var(--shell-surface);
  position: relative;
  z-index: 1;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: var(--radius-md);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.12);
}
/* 自定义背景层：垫底铺满，不拦截交互 */
.app-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}
/* 激活自定义背景时界面底色透出背景层 */
.shell.has-bg {
  background: var(--shell-surface);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .shell {
    background: color-mix(in srgb, var(--bg) 78%, transparent);
  }
}

/* ---------------- 左侧边栏 ---------------- */
.sidebar {
  width: var(--sidebar-w);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--bg-2) 92%, transparent);
  border-right: 1px solid var(--border);
}

.logo-area {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: 104px;
  padding: 0 var(--space-4);
  flex-shrink: 0;
}
.brand-head {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  image-rendering: pixelated;
  border-radius: var(--radius-md);
  border: 1px solid rgba(255,255,255,.26);
  box-shadow: 0 3px 12px rgba(0,0,0,.18);
}
.logo-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.logo-name {
  font-family: 'Segoe UI Variable Display', 'Segoe UI', sans-serif;
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: 2px;
  line-height: 1.2;
  color: var(--text);
}
.logo-version {
  align-self: flex-end;
  padding-right: 2px;
  font-size: var(--text-xs);
  color: var(--accent-2);
  opacity: 0.85;
}

.nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3) var(--space-3);
  overflow-y: auto;
  position: relative;
}
/* 水滴高亮块：随指针在导航项间弹性滑动并拉伸形变 */
.nav-blob {
  position: absolute;
  left: var(--space-3);
  right: var(--space-3);
  top: 0;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--accent) 15%, var(--card-2));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 9%, transparent);
  opacity: 0;
  pointer-events: none;
  transition:
    transform 0.42s cubic-bezier(0.3, 1.5, 0.4, 1),
    height 0.42s cubic-bezier(0.3, 1.5, 0.4, 1),
    opacity 0.16s ease;
  will-change: transform;
}
.nav-blob.on {
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .nav-blob { transition: none; }
}
.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--space-7);
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--sidebar-text);
  font-size: var(--text-md);
  font-family: inherit;
  cursor: pointer;
  transition: color 0.16s ease;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}
.nav-item:hover {
  color: var(--text);
}
.nav-item.active {
  color: color-mix(in srgb, var(--text) 84%, var(--accent));
}
.nav-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
.nav-icon :deep(svg) {
  width: 19px;
  height: 19px;
  display: block;
}
.nav-label {
  font-weight: 500;
}
.nav-item.active .nav-label {
  font-weight: 600;
}

/* 资源管理子级菜单 */
.nav-parent .nav-caret {
  width: 14px;
  height: 14px;
  margin-left: auto;
  flex-shrink: 0;
  transition: transform 0.18s ease;
  opacity: 0.7;
}
.nav-parent .nav-caret.open {
  transform: rotate(90deg);
}
/* 资源管理子级菜单：grid 0fr→1fr 高度过渡（打开/收起都有动画），子项自上而下错落渐入 */
.nav-sub {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  margin: 0;
  transition: grid-template-rows 0.34s cubic-bezier(0.32, 0.72, 0.35, 1), opacity 0.22s ease, margin 0.34s cubic-bezier(0.32, 0.72, 0.35, 1);
}
.nav-sub.open {
  grid-template-rows: 1fr;
  opacity: 1;
  margin: var(--space-1) 0;
}
.nav-sub-inner {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-height: 0;
}
.nav-sub .nav-sub-item {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
  transition: opacity 0.22s ease, transform 0.3s cubic-bezier(0.22, 0.9, 0.32, 1.1);
  transition-delay: 0s;
}
.nav-sub.open .nav-sub-item {
  opacity: 1;
  transform: translateY(0) scale(1);
  /* 错落：第 i 项比前一项晚 28ms 入场 */
  transition-delay: calc(var(--sub-i) * 28ms + 60ms);
}
@media (prefers-reduced-motion: reduce) {
  .nav-sub, .nav-sub .nav-sub-item { transition: none; }
}
.nav-sub-item {
  height: 40px;
  padding-left: var(--space-6);
  font-size: var(--text-sm);
  position: relative;
}
.nav-sub-item::before {
  content: '';
  position: absolute;
  left: 17px;
  top: 50%;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.4;
  transform: translateY(-50%);
}
.nav-sub-item.active::before {
  opacity: 1;
}
.nav-sub-item .nav-icon {
  width: 17px;
  height: 17px;
}
.nav-sub-item .nav-icon :deep(svg) {
  width: 16px;
  height: 16px;
}

.sidebar-health {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) 14px;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--row-h);
  margin: var(--space-3);
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--card) 48%, transparent);
  color: var(--text-dim);
  font-family: inherit;
  font-size: var(--text-xs);
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  -webkit-app-region: no-drag;
}
.sidebar-health:hover {
  background: var(--card-2);
  color: var(--text);
}
.sidebar-health i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 0 3px var(--ok-soft);
}
.sidebar-health.is-busy i {
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.sidebar-health.is-error i {
  background: var(--danger);
  box-shadow: 0 0 0 3px var(--danger-soft);
}
.sidebar-health span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-health svg {
  width: 14px;
  height: 14px;
}

/* ---------------- 右侧区域 ---------------- */
.main-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* 顶部栏 */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  height: 78px;
  flex-shrink: 0;
  padding: 0 var(--space-5);
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-2) 78%, transparent);
  -webkit-app-region: drag;
}
/* 个性化编辑模式：顶栏不再是拖拽区，点击可落到 DOM 选中顶栏板块（退出编辑恢复拖拽） */
.shell.edit-mode .topbar {
  -webkit-app-region: no-drag;
}

.top-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--ctl-h);
  height: var(--ctl-h);
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: var(--radius-sm);
  background: var(--card-2);
  color: var(--text-dim);
  cursor: pointer;
  -webkit-app-region: no-drag;
}
.top-back:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--border-strong);
}
.top-back:disabled {
  opacity: 0.62;
  cursor: default;
}
.top-back svg {
  width: 16px;
  height: 16px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 400px;
  max-width: 46%;
  height: var(--ctl-h);
  padding: 0 var(--space-4);
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-dim);
  -webkit-app-region: no-drag;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.search-box:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.search-box svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: var(--text-sm);
  font-family: inherit;
}
.search-input::placeholder {
  color: var(--text-dim);
  opacity: 0.75;
}

.top-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  -webkit-app-region: no-drag;
}
.top-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  height: var(--ctl-h);
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-dim);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.top-btn:hover {
  background: var(--card-2);
  color: var(--accent-2);
}
.top-btn svg {
  width: 15px;
  height: 15px;
}

.top-icon-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--ctl-h);
  height: var(--ctl-h);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.top-icon-btn:hover {
  background: var(--card-2);
  color: var(--text);
}
.top-icon-btn svg {
  width: 17px;
  height: 17px;
}
.bell-dot {
  position: absolute;
  top: 7px;
  right: 8px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  border: 1.5px solid var(--bg-2);
}
.dl-badge.compact {
  position: absolute;
  top: 2px;
  right: 0;
  min-width: 14px;
  height: 14px;
  font-size: var(--text-xs);
}

/* 通知中心面板（Teleport 到 body，fixed 定位） */
.notice-mask {
  position: fixed;
  inset: 0;
  z-index: 9000;
}
.notes-panel {
  width: 380px;
  max-height: 480px;
}
.notes-list {
  overflow-y: auto;
  padding: 2px var(--space-4) var(--space-4);
}
.note-version + .note-version {
  margin-top: var(--space-3);
  border-top: 1px dashed var(--border);
  padding-top: var(--space-3);
}
.note-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  margin: 0 0 var(--space-2);
}
.note-ver {
  font-weight: 700;
  font-size: var(--text-sm);
}
.note-changes {
  margin: 0;
  padding-left: var(--space-4);
  line-height: 1.7;
  font-size: var(--text-xs);
  color: var(--text);
}
.notice-panel {
  position: fixed;
  top: 82px;
  right: 92px;
  width: 320px;
  max-height: 420px;
  z-index: 9001;
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--card-solid, var(--card)) 94%, transparent);
  backdrop-filter: blur(24px) saturate(130%);
  -webkit-backdrop-filter: blur(24px) saturate(130%);
  -webkit-app-region: no-drag;
  isolation: isolate;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  max-width: calc(100vw - 32px);
}
.notice-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
}
.notice-title {
  font-size: var(--text-md);
  font-weight: 700;
}
.notice-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 96px;
  padding: var(--space-4);
  text-align: center;
  color: var(--text-dim);
  font-size: var(--text-sm);
}
.notice-list {
  overflow-y: auto;
}
/* 下载中心 */
.dl-toggle {
  position: relative;
}
.dl-badge {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: var(--text-xs);
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dl-panel {
  width: 380px;
}
.dl-item {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
}
.dl-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.dl-actions {
  display: inline-flex;
  gap: 4px;
  flex: none;
}
.dl-title {
  font-size: var(--text-sm);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dl-sub {
  margin-top: var(--space-1);
  font-size: var(--text-xs);
  line-height: 1.5;
  word-break: break-all;
}
.dl-error .dl-title {
  color: var(--danger);
}
.dl-bar {
  margin-top: var(--space-2);
  height: 5px;
  border-radius: 999px;
  background: var(--card-2);
  overflow: hidden;
}
.dl-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent-2), var(--accent));
  transition: width 0.3s ease;
}
.dl-bar.is-indeterminate .dl-bar-fill {
  animation: dl-indeterminate 1.25s ease-in-out infinite;
}
@keyframes dl-indeterminate {
  from {
    transform: translateX(-120%);
  }
  to {
    transform: translateX(320%);
  }
}
.dl-dismiss {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: var(--text-md);
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.dl-dismiss:hover {
  color: var(--text);
}
/* 启动失败弹窗 */
.launchfail-modal {
  width: 480px;
}
.launchfail-text {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--text-dim);
  word-break: break-all;
  max-height: 220px;
  overflow-y: auto;
  white-space: pre-wrap;
}
.notice-item {
  display: flex;
  gap: var(--space-3);
  min-height: var(--row-h);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
  font-size: var(--text-sm);
}
.notice-item:last-child {
  border-bottom: none;
}
.notice-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: var(--space-1);
  flex-shrink: 0;
  background: var(--accent);
}
.notice-success .notice-dot {
  background: var(--ok);
}
.notice-error .notice-dot {
  background: var(--danger);
}
.notice-body {
  min-width: 0;
}
.notice-text {
  line-height: 1.5;
  word-break: break-all;
}
.notice-time {
  font-size: var(--text-xs);
  color: var(--text-dim);
}

.top-divider {
  width: 1px;
  height: 20px;
  background: var(--border);
  margin: 0 8px;
  flex-shrink: 0;
}

.win-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: var(--ctl-h);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.win-btn svg {
  width: 15px;
  height: 15px;
}
.win-btn:hover {
  background: var(--card-2);
  color: var(--text);
}
.win-close:hover {
  background: var(--danger);
  color: #fff;
}

/* 内容区 */
.content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-5);
}

@media (max-width: 1080px) {
  .shell {
    width: calc(100% - 16px);
    height: calc(100% - 16px);
    margin: 8px;
    border-radius: var(--radius-lg);
  }
  .content {
    padding: var(--space-4);
  }
  .topbar {
    height: 68px;
  }
  .logo-area {
    height: 92px;
  }
}

/* ---------------- 整合包拖入遮罩 ---------------- */
.drop-mask {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  backdrop-filter: blur(24px) saturate(130%);
  -webkit-backdrop-filter: blur(24px) saturate(130%);
  pointer-events: none; /* 遮罩不拦截拖拽事件，避免 dragleave 闪烁 */
}
.drop-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-7);
  border: 2px dashed var(--accent);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--accent) 8%, var(--card));
  color: var(--accent);
}
.drop-box svg {
  width: 48px;
  height: 48px;
}
.drop-title {
  font-size: var(--text-lg);
  font-weight: 600;
}

/* ---------------- 整合包导入确认弹窗 ---------------- */
.mp-modal {
  width: min(620px, calc(100vw - 40px));
  max-height: 88vh;
  overflow-y: auto;
}
.mp-title {
  font-size: var(--text-lg);
  margin-bottom: var(--space-4);
}
.mp-loading {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) 0;
}
.mp-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.mp-summary {
  margin: var(--space-2) 0 0;
  color: var(--text-dim);
  font-size: var(--text-xs);
}
.mp-label {
  font-size: var(--text-sm);
  color: var(--text-dim);
  margin: var(--space-4) 0 var(--space-2);
}
.mp-name-opts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mp-name-opt {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--card-2);
  color: var(--text);
  font-size: var(--text-sm);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.mp-name-opt:hover {
  border-color: var(--text-dim);
}
.mp-name-opt.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.mp-radio {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--text-dim);
  flex-shrink: 0;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.mp-name-opt.active .mp-radio {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 3px var(--card), inset 0 0 0 8px var(--accent);
}
.mp-name-text {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.mp-name-label {
  flex-shrink: 0;
}
.mp-name-value {
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mp-name-opt.active .mp-name-value {
  color: var(--accent-2);
}
.mp-custom-name {
  width: 100%;
  margin-top: var(--space-2);
}
.mp-conflict {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding: var(--space-3);
  border: 1px solid color-mix(in srgb, var(--accent-deep) 48%, var(--border));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--accent-deep) 8%, var(--card));
  font-size: var(--text-xs);
  color: var(--text-dim);
}
.mp-conflict strong {
  color: var(--text);
}
.mp-conflict-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2) var(--space-3);
  margin-top: var(--space-1);
}
.mp-conflict-actions label,
.mp-replace-confirm {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 48px; /* 测试钉死字面量（tests/ui-regressions.test.ts:34），等价 var(--space-7) */
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  line-height: 1.4;
}
.mp-conflict-actions label:hover, .mp-replace-confirm:hover { background: var(--card-2); }
.mp-conflict-actions label:has(input:checked), .mp-replace-confirm:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
.mp-keysync-opt {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  line-height: 1.5;
  font-size: var(--text-xs);
  color: var(--text-dim);
}
.mp-keysync-opt:hover { background: var(--card-2); }
.mp-keysync-opt:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
.mp-keysync-opt input { accent-color: var(--accent); margin-top: 2px; flex-shrink: 0; }
.mp-conflict input {
  accent-color: var(--accent);
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  margin: 0;
}
.mp-existing-select {
  margin-top: var(--space-1);
}
.mp-impact {
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--card-2);
  line-height: 1.55;
}
.mp-impact.danger {
  color: var(--danger);
}
.mp-error {
  font-size: var(--text-sm);
  color: var(--danger);
  line-height: 1.7;
  word-break: break-all;
}
.mp-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-5);
}
</style>
