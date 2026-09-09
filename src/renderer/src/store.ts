/**
 * 轻量全局状态（Vue reactive），跨视图共享。
 */
import { reactive } from 'vue'
import { trackLaunchState } from '@shared/launchTracking'
import type {
  Account,
  InstalledVersion,
  LaunchState,
  ProgressEvent,
  Settings,
  YggdrasilProviderInput
} from '@shared/types'
import { errText, getInstalled, getSelectedAccount, listAccounts, saveSettings } from './api'

export type ViewName =
  | 'home'
  | 'game'
  | 'mods'
  | 'packs'
  | 'shaders'
  | 'keys'
  | 'bridge'
  | 'skins'
  | 'community'
  | 'servers'
  | 'friends'
  | 'settings'
  | 'accounts'
export type ToastType = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  text: string
  type: ToastType
}

const LAST_PLAYED_KEY = 'kamucl.lastPlayed'
const BANNER_ALIGN_KEY = 'kamucl.bannerAlign'

export type BannerAlign = 'start' | 'center'

/** 从 localStorage 读取 Banner 文字对齐方式 */
function loadBannerAlign(): BannerAlign {
  try {
    return localStorage.getItem(BANNER_ALIGN_KEY) === 'center' ? 'center' : 'start'
  } catch {
    return 'start'
  }
}

/** 从 localStorage 读取「版本 id -> 最后启动时间戳」映射 */
function loadLastPlayed(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LAST_PLAYED_KEY)
    if (!raw) return {}
    const obj: unknown = JSON.parse(raw)
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return obj as Record<string, number>
    }
    return {}
  } catch {
    return {}
  }
}

export const store = reactive({
  /** 应用设置（未加载完成时为 null） */
  settings: null as Settings | null,
  /** 首次初始化是否完成 */
  initialized: false,
  accounts: [] as Account[],
  selectedAccount: null as Account | null,
  installed: [] as InstalledVersion[],
  currentView: 'home' as ViewName,
  settingsSection: '' as '' | 'java' | 'memory' | 'downloads',
  /** 顶栏搜索关键字（游戏版本页版本列表联动过滤） */
  searchKeyword: '',
  /** 资源管理（模组/资源包/光影包）当前选中的版本 id；空 = 跟随第一个已装版本 */
  resourceVersionId: '',
  /** 文件系统变更计数器（MOD 装入等操作后自增，驱动 FileManager 刷新） */
  fsRefreshTick: 0,
  /** 当前下载/安装进度（无任务时为 null） */
  progress: null as ProgressEvent | null,
  /** 正在后台下载/安装的版本 id 集合（installDone 事件到达后移除） */
  installing: new Set<string>(),
  /** 最近一次安装失败的版本 id 集合（已安装页显示重试入口） */
  failedInstalls: new Set<string>(),
  /** 首页 Banner 文字对齐（localStorage 持久化） */
  bannerAlign: loadBannerAlign(),
  /** 游戏启动状态（未启动过为 null） */
  launchState: null as LaunchState | null,
  launchStates: {} as Record<string, LaunchState>,
  /** 最近一次点击启动的版本 id（用于启动成功后记录 lastPlayed） */
  launchingVersionId: '',
  /** 启动时锁定的游戏根目录；游戏运行期间切换目录也不会让退出同步串到别处。 */
  launchingFolder: '',
  /** 启动日志行（滚动缓冲，有上限） */
  logs: [] as string[],
  /** 每个版本的最后启动时间戳（localStorage 持久化） */
  lastPlayed: loadLastPlayed(),
  /** 个性化点选编辑模式（停留当前界面，点击板块改色） */
  editMode: false,
  /** 当前选中的板块 key（对应元素 data-edit 值），空 = 未选中 */
  editTarget: '',
  /** 通知中心：最近的 toast 记录（新→旧，上限 30 条） */
  notices: [] as Array<{ id: number; text: string; type: ToastType; time: number }>,
  /** 通知是否有未读（驱动铃铛红点） */
  noticesUnread: false,
  /** 整合包导入处理器（App.vue 注册，供任意页面触发导入确认弹窗） */
  importHandler: null as ((filePath: string) => void) | null,
  /** 启动器更新弹窗触发器（设置页手动检查/启动自动检查写入，App.vue 监听打开弹窗） */
  updatePrompt: null as { release: import('@shared/types').ReleaseInfo; rollback: boolean } | null,
  /** 外置登录提供商拖拽入口；切换到账号页期间先暂存在 pending 中。 */
  yggdrasilImportHandler: null as ((input: YggdrasilProviderInput) => void) | null,
  pendingYggdrasilImport: null as YggdrasilProviderInput | null,
  /** 后台任务列表（版本安装/整合包导入/资源下载），驱动顶栏下载中心 */
  tasks: [] as TaskItem[],
  toasts: [] as ToastItem[]
})

export const applyLaunchState = (state: LaunchState) => trackLaunchState(store, state)

export function openSettings(section: 'java' | 'memory' | 'downloads'): void {
  store.settingsSection = section
  store.currentView = 'settings'
}

// ---------------- 后台任务（下载中心） ----------------
export interface TaskItem {
  id: string
  title: string
  stage: string
  text: string
  /** 0-1 */
  progress: number
  speed?: number
  etaSeconds?: number
  indeterminate?: boolean
  status: 'running' | 'paused' | 'cancelling' | 'done' | 'error' | 'cancelled'
  error?: string
  /** 完成时间戳（用于完成态短暂展示后清理） */
  finishedAt?: number
}

/** 阶段名 → 中文阶段标签 */
const STAGE_LABEL: Record<string, string> = {
  'version-json': '解析版本信息',
  libraries: '下载依赖库',
  client: '下载游戏本体',
  assets: '下载资源文件',
  loader: '安装加载器',
  'fabric-api': '安装 Fabric API',
  repair: '修复文件',
  modpack: '安装整合包',
  java: '准备 Java',
  download: '下载文件',
  launch: '启动',
  done: '完成',
  error: '失败'
}

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage
}

/** 进度事件驱动任务 upsert（无 taskId 的全局进度不入任务列表） */
export function upsertTaskProgress(e: ProgressEvent) {
  if (!e.taskId) return
  let t = store.tasks.find((x) => x.id === e.taskId)
  if (!t) {
    t = {
      id: e.taskId,
      title: e.taskTitle ?? '后台任务',
      stage: e.stage,
      text: e.text,
      progress: e.progress,
      status: 'running'
    }
    store.tasks.unshift(t)
  }
  if (t.status !== 'running') return // 已终态不再更新
  t.stage = e.stage
  t.text = e.text
  t.progress = progressMono(e)
  t.speed = e.speed
  t.etaSeconds = e.etaSeconds
  t.indeterminate = e.indeterminate
}

/** 任务终态（成功/失败/取消），失败保留阶段与原因 */
export function finalizeTask(r: {
  taskId?: string
  ok: boolean
  error?: string
  cancelled?: boolean
  stage?: string
}) {
  if (!r.taskId) return
  const t = store.tasks.find((x) => x.id === r.taskId)
  if (
    !t ||
    (t.status !== 'running' && t.status !== 'paused' && t.status !== 'cancelling')
  )
    return
  t.status = r.cancelled ? 'cancelled' : r.ok ? 'done' : 'error'
  t.error = r.error
  t.progress = r.ok ? 1 : t.progress
  t.finishedAt = Date.now()
  if (r.ok || r.cancelled) {
    // 成功 8 秒、取消 3 秒后自动从下载中心移除
    setTimeout(
      () => {
        const i = store.tasks.findIndex(
          (x) => x.id === t.id && (x.status === 'done' || x.status === 'cancelled')
        )
        if (i >= 0) store.tasks.splice(i, 1)
      },
      r.ok ? 8000 : 3000
    )
  }
}

/** 手动关闭一条终态任务记录 */
export function dismissTask(taskId: string) {
  const i = store.tasks.findIndex((x) => x.id === taskId && x.status !== 'running')
  if (i >= 0) store.tasks.splice(i, 1)
}

// ---------------- toast ----------------
let toastSeq = 0

export function toast(text: string, type: ToastType = 'info') {
  const id = ++toastSeq
  store.toasts.push({ id, text, type })
  // 同步记录到通知中心（新→旧，上限 30 条，标记未读）
  store.notices.unshift({ id, text, type, time: Date.now() })
  if (store.notices.length > 30) store.notices.length = 30
  store.noticesUnread = true
  setTimeout(() => {
    const i = store.toasts.findIndex((t) => t.id === id)
    if (i >= 0) store.toasts.splice(i, 1)
  }, 3000)
}

/** 打开通知中心时调用：清除未读标记 */
export function markNoticesRead() {
  store.noticesUnread = false
}

// ---------------- 数据刷新 ----------------
export async function refreshAccounts() {
  const [accounts, selected] = await Promise.all([listAccounts(), getSelectedAccount()])
  store.accounts = accounts
  store.selectedAccount = selected
}

export async function refreshInstalled() {
  store.installed = await getInstalled()
}

// ---------------- 版本收藏 ----------------
export function isFavorite(id: string): boolean {
  return (store.settings?.favoriteVersions ?? []).includes(id)
}

export async function toggleFavorite(id: string) {
  const cur = store.settings?.favoriteVersions ?? []
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
  try {
    store.settings = await saveSettings({ favoriteVersions: next })
    toast(isFavorite(id) ? '已收藏' : '已取消收藏', 'success')
  } catch (e) {
    toast('收藏失败：' + errText(e), 'error')
  }
}

/** 收藏置顶 + 组内最近游玩倒序 */
export function sortWithFavorite<T extends { id: string }>(list: T[]): T[] {
  const fav = new Set(store.settings?.favoriteVersions ?? [])
  return [...list].sort((a, b) => {
    const fa = fav.has(a.id) ? 0 : 1
    const fb = fav.has(b.id) ? 0 : 1
    if (fa !== fb) return fa - fb
    return (store.lastPlayed[b.id] ?? 0) - (store.lastPlayed[a.id] ?? 0)
  })
}

// ---------------- 最近游玩记录 ----------------
/** 记录某版本的最后启动时间（启动状态变为 running 时调用） */
export function recordLastPlayed(id: string) {
  if (!id) return
  store.lastPlayed[id] = Date.now()
  try {
    localStorage.setItem(LAST_PLAYED_KEY, JSON.stringify(store.lastPlayed))
  } catch {
    /* 持久化失败不影响功能 */
  }
}

/** 实例重命名后迁移最近游玩记录（lastPlayed 以版本 id 为键） */
export function renameLastPlayed(oldId: string, newId: string) {
  if (!oldId || !newId || oldId === newId) return
  const ts = store.lastPlayed[oldId]
  if (ts === undefined) return
  store.lastPlayed[newId] = ts
  delete store.lastPlayed[oldId]
  try {
    localStorage.setItem(LAST_PLAYED_KEY, JSON.stringify(store.lastPlayed))
  } catch {
    /* 持久化失败不影响功能 */
  }
}

/** 设置 Banner 文字对齐方式（靠左下 / 居中），并持久化 */
export function setBannerAlign(a: BannerAlign) {
  store.bannerAlign = a
  try {
    localStorage.setItem(BANNER_ALIGN_KEY, a)
  } catch {
    /* 持久化失败不影响功能 */
  }
}

// ---------------- 个性化点选编辑模式 ----------------
/** 进入编辑模式：确保主题为 custom（custom 保持现有值或默认），然后停留在当前界面 */
export async function enterEditMode() {
  if (store.editMode) return
  if (store.settings && store.settings.theme !== 'custom') {
    try {
      store.settings = await saveSettings({ theme: 'custom' })
    } catch (e) {
      toast('切换自定义主题失败：' + errText(e), 'error')
      return
    }
  }
  store.editTarget = ''
  store.editMode = true
}

/** 退出编辑模式并复位选中板块 */
export function exitEditMode() {
  store.editMode = false
  store.editTarget = ''
}

// ---------------- 实例显示（版本 × 加载器 统一语义） ----------------
/** 实例 id 是否为自动生成的默认名（自定义命名的实例按自定义名展示） */
function isAutoInstanceId(v: InstalledVersion): boolean {
  if (v.modpackName) return false // 整合包实例 id 即包名，视作自定义名展示
  if (!v.loader) return v.id === v.mcVersion
  const lv = v.loaderVersion ?? ''
  switch (v.loader) {
    case 'forge':
      return v.id === `${v.mcVersion}-forge-${lv}`
    case 'neoforge':
      return v.id === `neoforge-${lv}`
    case 'fabric':
      return v.id === `fabric-loader-${lv}-${v.mcVersion}`
    case 'quilt':
      return v.id === `quilt-loader-${lv}-${v.mcVersion}`
    default:
      return false
  }
}

/** 实际内容描述：`26.2 · NeoForge 21.1.0` / `26.2`（纯净版） */
function contentDesc(v: InstalledVersion): string {
  if (v.loader) {
    const cap = v.loader.charAt(0).toUpperCase() + v.loader.slice(1)
    return `${v.mcVersion} · ${cap}${v.loaderVersion ? ' ' + v.loaderVersion : ''}`
  }
  return v.mcVersion
}

/**
 * 实例主显示名：默认名实例显示 `26.2 · Forge 65.0.0` / `26.2`；
 * 自定义命名实例直接显示自定义名（如「机械动力生存」）。
 */
export function displayVersionName(v: InstalledVersion): string {
  if (!isAutoInstanceId(v)) return v.id
  return contentDesc(v)
}

/** 实例副显示名：默认名实例显示技术 id；自定义名实例显示实际内容（MC 版本 + 加载器） */
export function displayVersionSub(v: InstalledVersion): string {
  if (!isAutoInstanceId(v)) return contentDesc(v)
  return v.id
}

/** 实例图标 URL：内置 mob 头像走渲染包静态资源；自定义图标走 file://（空 = 默认图标） */
export function versionIconUrl(v: InstalledVersion): string {
  const icon = v.icon
  if (!icon) return ''
  if (icon.startsWith('mob:')) return `mobs/${icon.slice(4)}.png`
  if (icon.startsWith('file:')) {
    const def =
      store.settings?.folders.find((f) => f.isDefault)?.path ?? store.settings?.gameDir ?? ''
    if (!def) return ''
    const p = `${def}/.kamucl/icons/${icon.slice(5)}`.replace(/\\/g, '/')
    return 'file:///' + p.replace(/^\/+/, '')
  }
  return ''
}

// ---------------- 进度平滑 ----------------/** 安装/启动任务的阶段顺序（用于把单阶段进度换算为单调不回退的整体进度） */
const STAGE_ORDER = [
  'version-json',
  'libraries',
  'client',
  'assets',
  'loader',
  'fabric-api',
  'repair',
  'modpack',
  'java',
  'launch',
  'done'
]

/** 把当前阶段进度换算为整体进度（0-1，阶段单调推进不回退） */
export function progressOverall(e: ProgressEvent): number {
  if (typeof e.overall === 'number' && Number.isFinite(e.overall)) {
    return Math.max(0, Math.min(1, e.overall))
  }
  const i = STAGE_ORDER.indexOf(e.stage)
  const idx = i < 0 ? 0 : i
  const p = Math.max(0, Math.min(1, e.progress))
  return Math.min(1, (idx + p) / STAGE_ORDER.length)
}

// ---------------- 整体进度单调守护 ----------------
// 阶段切换（如 loader 前置事件早于 vanilla 阶段）与单文件重试会造成整体进度回跳，
// 同一任务内对换算后的整体进度取历史最大值，保证进度条单调递增
const monoMap = new Map<string, number>()

/** 单调递增的整体进度（0-1）：同一 taskId（无 taskId 时按全局序列）内只增不减 */
export function progressMono(e: ProgressEvent): number {
  const key = e.taskId ?? '__global__'
  const cur = progressOverall(e)
  const prev = monoMap.get(key) ?? 0
  const next = Math.max(prev, cur)
  monoMap.set(key, next)
  return next
}

/** 任务终态/新任务开始时重置守护（installDone/taskDone/gameDirDone 时调用） */
export function resetProgressMono(taskId?: string) {
  if (taskId) monoMap.delete(taskId)
  else monoMap.clear()
}

/** 最后启动时间 -> 「今天 / 昨天 / x天前」，无记录返回 '—' */export function fmtLastPlayed(ts?: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(new Date()) - startOf(d)) / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return `${days}天前`
  return d.toLocaleDateString('zh-CN')
}
