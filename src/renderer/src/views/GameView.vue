<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  addFolder,
  cleanupPartialInstall,
  errText,
  formatSpeed,
  getManifest,
  getIsolationPlan,
  getSettings,
  installVersion,
  launchGame,
  listFabricApi,
  listFolders,
  listJava,
  listLoaders,
  openDir,
  openGameFolder,
  showFolderContextMenu,
  removeFolder,
  removeVersion,
  renameFolder,
  renameVersion,
  saveSettings,
  scanFolder,
  selectDir,
  setActiveFolder,
  setDefaultFolder,
  setVersionIsolation,
  setVersionJava,
  setVersionResolution
} from '../api'
import { displayVersionName, displayVersionSub, fmtLastPlayed, isFavorite, progressMono, refreshInstalled, renameLastPlayed, sortWithFavorite, store, toast, toggleFavorite, versionIconUrl } from '../store'
import ConfirmModal from '../components/ConfirmModal.vue'
import IconPickerModal from '../components/IconPickerModal.vue'
import SelectMenu from '../components/SelectMenu.vue'
import ThumbnailPickerModal from '../components/ThumbnailPickerModal.vue'
import type {
  FabricApiVersion,
  FolderScanResult,
  GameFolder,
  GameResolution,
  GameWindowMode,
  InstallOptions,
  InstalledVersion,
  ImageFit,
  IsolationMigrationPlan,
  LoaderName,
  RemoteVersion
} from '@shared/types'

// ---------------- 清单加载 ----------------
const manifest = ref<RemoteVersion[]>([])
const loading = ref(false)
const loadError = ref('')

/** 顶部 Tab：版本下载 / 已安装（消灭内层嵌套滚动，localStorage 记忆） */
const TAB_KEY = 'kamucl.gameTab'
const tab = ref<'download' | 'installed'>(
  (localStorage.getItem(TAB_KEY) as 'download' | 'installed') === 'installed'
    ? 'installed'
    : 'download'
)
watch(tab, (t) => localStorage.setItem(TAB_KEY, t))

async function load(refresh = false) {
  loading.value = true
  loadError.value = ''
  try {
    manifest.value = await getManifest(refresh)
  } catch (e) {
    loadError.value = errText(e)
  } finally {
    loading.value = false
  }
}

// ---------------- 游戏文件夹（统一管理入口） ----------------
const folders = ref<GameFolder[]>([])
const activeFolder = ref('')
const folderScan = ref<FolderScanResult | null>(null)
const folderBusy = ref(false)
const folderRename = reactive({ open: false, name: '', busy: false, error: '' })
const folderRemove = reactive({ open: false, busy: false })

const currentFolder = computed(() =>
  folders.value.find((folder) => folder.path === activeFolder.value)
)

async function refreshFolderScan(syncList = true) {
  if (!activeFolder.value) return
  folderBusy.value = true
  try {
    const result = await scanFolder(activeFolder.value)
    folderScan.value = result
    if (syncList) store.installed = result.versions
  } catch (error) {
    folderScan.value = null
    toast(`扫描游戏文件夹失败：${errText(error)}`, 'error')
  } finally {
    folderBusy.value = false
  }
}

async function loadFolderState() {
  try {
    const state = await listFolders()
    folders.value = state.folders
    activeFolder.value = state.active
    await refreshFolderScan()
  } catch (error) {
    toast(`读取游戏文件夹失败：${errText(error)}`, 'error')
  }
}

async function chooseFolderPath(selected: string) {
  if (!selected || selected === activeFolder.value || folderBusy.value) return
  folderBusy.value = true
  try {
    activeFolder.value = await setActiveFolder(selected)
    store.settings = await getSettings()
    store.resourceVersionId = ''
    await refreshInstalled()
    await refreshFolderScan(false)
    toast(`已切换到「${currentFolder.value?.name ?? '游戏文件夹'}」`, 'success')
  } catch (error) {
    toast(`切换失败：${errText(error)}`, 'error')
    await loadFolderState()
  } finally {
    folderBusy.value = false
  }
}

async function addGameFolder() {
  try {
    const selected = await selectDir()
    if (!selected) return
    folderBusy.value = true
    const added = await addFolder(selected)
    await setActiveFolder(added.folder.path)
    const state = await listFolders()
    folders.value = state.folders
    activeFolder.value = state.active
    store.settings = await getSettings()
    await refreshInstalled()
    await refreshFolderScan(false)
    const count = folderScan.value?.versions.length ?? 0
    toast(`已添加并切换游戏文件夹，识别到 ${count} 个版本`, 'success')
  } catch (error) {
    toast(`添加失败：${errText(error)}`, 'error')
  } finally {
    folderBusy.value = false
  }
}

async function markCurrentDefault() {
  if (!activeFolder.value || currentFolder.value?.isDefault) return
  folderBusy.value = true
  try {
    folders.value = await setDefaultFolder(activeFolder.value)
    store.settings = await getSettings()
    toast('已设为默认游戏文件夹', 'success')
  } catch (error) {
    toast(`设置失败：${errText(error)}`, 'error')
  } finally {
    folderBusy.value = false
  }
}

function openFolderRename() {
  if (!currentFolder.value) return
  folderRename.name = currentFolder.value.name
  folderRename.error = ''
  folderRename.open = true
}

async function confirmFolderRename() {
  if (!activeFolder.value || folderRename.busy) return
  folderRename.busy = true
  folderRename.error = ''
  try {
    folders.value = await renameFolder(activeFolder.value, folderRename.name)
    folderRename.open = false
    store.settings = await getSettings()
    toast('显示名称已更新', 'success')
  } catch (error) {
    folderRename.error = errText(error)
  } finally {
    folderRename.busy = false
  }
}

async function confirmFolderRemove() {
  if (!activeFolder.value || folderRemove.busy) return
  folderRemove.busy = true
  try {
    await removeFolder(activeFolder.value)
    folderRemove.open = false
    await loadFolderState()
    store.settings = await getSettings()
    toast('已解除文件夹绑定；磁盘中的游戏、存档和 MOD 均未删除', 'success')
  } catch (error) {
    toast(`解除绑定失败：${errText(error)}`, 'error')
  } finally {
    folderRemove.busy = false
  }
}

async function revealCurrentFolder() {
  if (!activeFolder.value) return
  try {
    await openGameFolder(activeFolder.value)
  } catch (error) {
    toast(`打开文件夹失败：${errText(error)}`, 'error')
  }
}

onMounted(() => {
  void load()
  void loadFolderState()
})

// ---------------- 搜索与筛选（搜索框联动顶栏 store.searchKeyword） ----------------
type TypeFilter = 'all' | 'release' | 'snapshot' | 'old'
const typeFilter = ref<TypeFilter>('release')

const typeFilters: Array<{ value: TypeFilter; label: string }> = [
  { value: 'release', label: '正式版' },
  { value: 'all', label: '全部' },
  { value: 'snapshot', label: '快照' },
  { value: 'old', label: '旧版' }
]

const typeText: Record<RemoteVersion['type'], string> = {
  release: '正式版',
  snapshot: '快照',
  old_beta: 'Beta 旧版',
  old_alpha: 'Alpha 旧版'
}

/* release 金 / snapshot 青灰 / 旧版 dim */
const typeTagClass = (t: RemoteVersion['type']) =>
  t === 'release' ? 'tag-gold' : t === 'snapshot' ? 'tag-cyan' : ''

const keyword = computed(() => store.searchKeyword.trim().toLowerCase())

/** ETA 由主进程基于字节速度指数平滑；未知总量/暂停时不伪造。 */
const etaText = computed(() => {
  const p = store.progress
  const eta = p?.etaSeconds
  if (eta == null || !Number.isFinite(eta) || eta <= 3) return ''
  if (eta >= 3600) return `约剩 ${Math.ceil(eta / 3600)}h`
  if (eta >= 60) return `约剩 ${Math.ceil(eta / 60)}min`
  return `约剩 ${Math.round(eta)}s`
})

const filtered = computed(() =>
  manifest.value.filter((v) => {
    if (keyword.value && !v.id.toLowerCase().includes(keyword.value)) return false
    if (typeFilter.value === 'all') return true
    if (typeFilter.value === 'old') return v.type === 'old_beta' || v.type === 'old_alpha'
    return v.type === typeFilter.value
  })
)

const formatDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('zh-CN')
}

const isInstalled = (v: RemoteVersion) => store.installed.some((i) => i.mcVersion === v.id)

// ---------------- 安装模态框 ----------------
const loaderOptions: Array<{ value: '' | LoaderName; label: string }> = [
  { value: '', label: '不安装' },
  { value: 'forge', label: 'Forge' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'quilt', label: 'Quilt' },
  { value: 'neoforge', label: 'NeoForge' }
]

const modal = reactive({
  open: false,
  version: null as RemoteVersion | null,
  loader: '' as '' | LoaderName,
  loaderVersions: [] as string[],
  loaderVersion: '',
  loadingLoaders: false,
  loadLoadersError: '',
  // Fabric API 联动
  apiOn: true,
  apiVersions: [] as FabricApiVersion[],
  apiVersion: '',
  loadingApi: false,
  apiError: '',
  instanceName: '',
  instanceEdited: false
})

/** 默认实例名（加载器类型+版本自动生成；纯净版固定为 MC 版本号） */
const defaultInstanceName = computed(() => {
  const mc = modal.version?.id ?? ''
  if (!modal.loader) return mc
  if (modal.loader === 'forge') return `${mc}-forge-${modal.loaderVersion || '?'}`
  if (modal.loader === 'neoforge') return `neoforge-${modal.loaderVersion || '?'}`
  return `${modal.loader}-loader-${modal.loaderVersion || '?'}-${mc}`
})

/** 实例名冲突/非法校验（返回错误文案，合法为 ''；与主进程 validateInstanceName 同规则） */
const instanceError = computed(() => {
  const n = (modal.instanceEdited ? modal.instanceName : defaultInstanceName.value).trim()
  if (!n) return '实例名不能为空'
  if (n.length > 64) return '实例名过长（最多 64 字符）'
  if (/[\\/:*?"<>|]/.test(n)) return '实例名不能包含 \\ / : * ? " < > | 字符'
  if (/^[.\s]|[.\s]$/.test(n)) return '实例名不能以空格或点开头/结尾'
  if (store.installed.some((v) => v.id === n)) return `实例「${n}」已存在，请改名后安装`
  return ''
})

/** 实际生效的实例名（纯净版默认 MC 版本号，加载器实例按规则生成，均可自定义） */
const effectiveInstanceName = computed(() =>
  modal.instanceEdited ? modal.instanceName.trim() : defaultInstanceName.value
)

function openInstall(v: RemoteVersion) {  modal.open = true
  modal.version = v
  modal.loader = ''
  modal.loaderVersions = []
  modal.loaderVersion = ''
  modal.loadingLoaders = false
  modal.loadLoadersError = ''
  modal.apiOn = true
  modal.apiVersions = []
  modal.apiVersion = ''
  modal.loadingApi = false
  modal.apiError = ''
  modal.instanceName = ''
  modal.instanceEdited = false
}

watch(
  () => modal.loader,
  async (loader) => {
    modal.loaderVersions = []
    modal.loaderVersion = ''
    modal.loadLoadersError = ''
    modal.apiVersions = []
    modal.apiVersion = ''
    modal.apiError = ''
    if (!loader || !modal.version) return
    modal.loadingLoaders = true
    try {
      const list = await listLoaders(loader, modal.version.id)
      modal.loaderVersions = list
      modal.loaderVersion = list[0] ?? ''
      if (!list.length) modal.loadLoadersError = '该版本暂无可用的加载器版本'
    } catch (e) {
      modal.loadLoadersError = '获取加载器版本失败：' + errText(e)
    } finally {
      modal.loadingLoaders = false
    }
    // 选择 Fabric 时联动拉取 Fabric API 版本列表
    if (loader === 'fabric' && modal.version) {
      modal.loadingApi = true
      try {
        const list = await listFabricApi(modal.version.id)
        modal.apiVersions = list
        modal.apiVersion = list[0]?.version ?? ''
        if (!list.length) modal.apiError = '该版本暂无适配的 Fabric API'
      } catch (e) {
        modal.apiError = '获取 Fabric API 列表失败：' + errText(e)
      } finally {
        modal.loadingApi = false
      }
    }
  }
)

const canConfirm = computed(
  () =>
    !!modal.version &&
    !modal.loadingLoaders &&
    (modal.loader === '' || !!modal.loaderVersion) &&
    !instanceError.value
)

async function confirmInstall() {
  const v = modal.version
  if (!v || !canConfirm.value) return
  const opts: InstallOptions = modal.loader
    ? {
        loader: modal.loader,
        loaderVersion: modal.loaderVersion || undefined,
        fabricApi:
          modal.loader === 'fabric' && modal.apiOn && modal.apiVersion
            ? modal.apiVersion
            : undefined,
        instanceName: effectiveInstanceName.value || undefined
      }
    : { instanceName: effectiveInstanceName.value || undefined }
  modal.open = false
  // 主进程后台异步下载，invoke 仅表示任务已受理；
  // 完成/失败由 App.vue 订阅的 installDone 事件统一提示并刷新已安装列表
  store.installing.add(v.id)
  toast(`开始下载版本 ${v.id}，请稍候…`, 'info')
  try {
    await installVersion(v.id, opts)
  } catch (e) {
    store.installing.delete(v.id)
    toast('安装失败：' + errText(e), 'error')
  }
}

// ---------------- 已安装区 ----------------
const removeModal = reactive({
  open: false,
  target: null as InstalledVersion | null,
  busy: false
})

async function onConfirmRemove() {
  const v = removeModal.target
  if (!v || removeModal.busy) return
  removeModal.busy = true
  try {
    await removeVersion(v.id)
    await refreshInstalled()
    removeModal.open = false
    toast(`已删除 ${v.id}`, 'success')
  } catch (e) {
    toast('删除失败：' + errText(e), 'error')
  } finally {
    removeModal.busy = false
  }
}

/** 清理安装失败的残留目录 */
async function onCleanup(id: string) {
  try {
    await cleanupPartialInstall(id)
    await refreshInstalled()
    toast('残留已清理', 'success')
  } catch (e) {
    toast('清理失败：' + errText(e), 'error')
  }
}

/** 打开该版本的版本文件夹（versions/<id>） */
async function openVersionFolder(v: InstalledVersion) {
  try {
    await openDir('versions/' + v.id)
  } catch (e) {
    toast('打开文件夹失败：' + errText(e), 'error')
  }
}

/** 版本列表条目的主操作：直接用该版本启动游戏（与首页最近游戏卡片行为一致） */
async function launchVersion(v: InstalledVersion) {
  try {
    await launchGame(v.id, undefined, v.folder)
  } catch (e) {
    toast('启动失败：' + errText(e), 'error')
  }
}

// ---------------- 版本隔离开关 ----------------
const isoBusy = ref<string | null>(null)
const isolationModal = reactive<{
  open: boolean
  target: InstalledVersion | null
  plan: IsolationMigrationPlan | null
  busy: boolean
  error: string
}>({ open: false, target: null, plan: null, busy: false, error: '' })

function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function closeIsolationModal() {
  if (isolationModal.busy) return
  isoBusy.value = null
  isolationModal.open = false
  isolationModal.target = null
  isolationModal.plan = null
  isolationModal.error = ''
}

// ---------------- 管理快捷菜单 ----------------
const manageMenu = reactive({ id: '', top: 0, left: 0 })

/** 下载源切换（镜像 ⇄ 官方），持久化并刷新版本清单 */
async function onToggleMirror() {
  const next = store.settings?.mirror === 'bmclapi' ? 'official' : 'bmclapi'
  try {
    await saveSettings({ mirror: next })
    store.settings = await getSettings()
    toast(next === 'bmclapi' ? '已切换为 BMCLAPI 镜像源' : '已切换为官方源', 'success')
    void load(true)
  } catch (e) {
    toast('切换下载源失败：' + errText(e), 'error')
  }
}

/** 重试安装失败的版本 */
function onRetry(versionId: string) {
  store.failedInstalls.delete(versionId)
  store.installing.add(versionId)
  toast(`重新开始下载版本 ${versionId}…`, 'info')
  void installVersion(versionId, {}).catch((e) => {
    store.installing.delete(versionId)
    toast('安装失败：' + errText(e), 'error')
  })
}

/** 安装中的版本（进度条显示在已安装页顶部） */
const installingVersions = computed(() => [...store.installing])

/** 文件夹显示名：优先用文件夹登记时的命名，未登记回退路径末级目录名 */
const folderShortName = (p: string): string => {
  const norm = (v: string) => v.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
  const hit = store.settings?.folders.find((f) => norm(f.path) === norm(p))
  if (hit?.name?.trim()) return hit.name.trim()
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}

/** 收藏置顶 + 组内最近游玩倒序 */
const sortedInstalled = computed(() => sortWithFavorite(store.installed))
/** 已收藏分组（不含残缺/失败版本） */
const favoriteInstalled = computed(() =>
  store.installed.filter((v) => isFavorite(v.id) && !v.incomplete && !v.failed)
)

function openManageMenu(e: MouseEvent, id: string) {
  if (manageMenu.id === id) {
    manageMenu.id = ''
    return
  }
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  manageMenu.top = r.bottom + 6
  manageMenu.left = Math.max(8, r.right - 140)
  manageMenu.id = id
}

/** 跳转资源管理对应子页，并把上下文版本切到该版本 */
function goManage(view: 'mods' | 'packs' | 'shaders') {
  store.resourceVersionId = manageMenu.id
  manageMenu.id = ''
  store.currentView = view
}

// ---------------- 实例重命名 ----------------
const renameModal = reactive({ open: false, id: '', name: '', error: '', busy: false })

// ---------------- 实例图标 ----------------
const iconModal = reactive({ open: false, id: '', current: '' })

function openIconPicker(id: string) {
  iconModal.id = id
  iconModal.current = store.installed.find((v) => v.id === id)?.icon ?? ''
  iconModal.open = true
  manageMenu.id = ''
}

// ---------------- 首页启动卡缩略图 ----------------
const thumbnailModal = reactive({
  open: false,
  id: '',
  current: '',
  fit: 'crop' as ImageFit
})

function openThumbnailPicker(id: string) {
  const version = store.installed.find((item) => item.id === id)
  thumbnailModal.id = id
  thumbnailModal.current = version?.thumbnail ?? ''
  thumbnailModal.fit = version?.thumbnailFit ?? 'crop'
  thumbnailModal.open = true
  manageMenu.id = ''
}

// ---------------- 指定 Java ----------------
const javaModal = reactive({
  open: false,
  id: '',
  value: '',
  list: [] as Awaited<ReturnType<typeof listJava>>,
  busy: false
})

async function openJavaModal() {
  javaModal.id = manageMenu.id
  manageMenu.id = ''
  javaModal.busy = true
  javaModal.open = true
  try {
    javaModal.list = await listJava()
    const cur = store.installed.find((v) => v.id === javaModal.id)
    javaModal.value = cur?.javaPath ?? ''
  } catch (e) {
    toast('读取 Java 列表失败：' + errText(e), 'error')
  } finally {
    javaModal.busy = false
  }
}

async function onConfirmJava() {
  try {
    await setVersionJava(javaModal.id, javaModal.value)
    await refreshInstalled()
    javaModal.open = false
    toast(javaModal.value ? '已为该版本指定 Java' : '已恢复自动匹配 Java', 'success')
  } catch (e) {
    toast('设置失败：' + errText(e), 'error')
  }
}

// ---------------- 实例窗口设置 ----------------
const resolutionModal = reactive({
  open: false,
  id: '',
  mode: 'inherit' as 'inherit' | GameWindowMode,
  width: 854,
  height: 480,
  error: '',
  busy: false
})

function openResolutionModal() {
  resolutionModal.id = manageMenu.id
  manageMenu.id = ''
  const current = store.installed.find((version) => version.id === resolutionModal.id)
  const fallback = store.settings?.resolution
  resolutionModal.mode = current?.resolution?.mode ?? 'inherit'
  resolutionModal.width = current?.resolution?.width ?? fallback?.width ?? 854
  resolutionModal.height = current?.resolution?.height ?? fallback?.height ?? 480
  resolutionModal.error = ''
  resolutionModal.open = true
}

async function onConfirmResolution() {
  if (resolutionModal.busy) return
  resolutionModal.error = ''
  let override: GameResolution | null = null
  if (resolutionModal.mode !== 'inherit') {
    const width = Number(resolutionModal.width)
    const height = Number(resolutionModal.height)
    if (!Number.isInteger(width) || width < 854 || width > 7680) {
      resolutionModal.error = '窗口宽度必须是 854–7680 之间的整数'
      return
    }
    if (!Number.isInteger(height) || height < 480 || height > 4320) {
      resolutionModal.error = '窗口高度必须是 480–4320 之间的整数'
      return
    }
    override = {
      width,
      height,
      mode: resolutionModal.mode,
      fullscreen: resolutionModal.mode === 'fullscreen'
    }
  }
  resolutionModal.busy = true
  try {
    await setVersionResolution(resolutionModal.id, override)
    await refreshInstalled()
    resolutionModal.open = false
    toast(override ? '已保存实例窗口设置' : '该实例已改为跟随全局窗口设置', 'success')
  } catch (error) {
    resolutionModal.error = errText(error)
  } finally {
    resolutionModal.busy = false
  }
}

function openRename() {
  openRenameFor(manageMenu.id)
  manageMenu.id = ''
}

/** 点击版本名直接进入改名 */
function openRenameFor(id: string) {
  renameModal.id = id
  renameModal.name = id
  renameModal.error = ''
  renameModal.open = true
}

async function onConfirmRename() {
  if (renameModal.busy) return
  renameModal.busy = true
  renameModal.error = ''
  const oldId = renameModal.id
  const newId = renameModal.name.trim()
  try {
    await renameVersion(oldId, newId)
    // 引用同步（渲染端）：最近游玩记录以版本 id 为键（收藏/服务器绑定由主进程同步）
    renameLastPlayed(oldId, newId)
    await refreshInstalled()
    renameModal.open = false
    toast('实例已重命名', 'success')
  } catch (e) {
    renameModal.error = errText(e)
  } finally {
    renameModal.busy = false
  }
}

async function onToggleIsolation(v: InstalledVersion, event: Event) {
  // 原生 checkbox 会先自行翻转；状态只有在主进程事务成功后才允许改变。
  const input = event.currentTarget as HTMLInputElement
  input.checked = !!v.isolated
  if (isoBusy.value) return
  isoBusy.value = v.id
  const next = !v.isolated
  try {
    if (next) {
      const plan = await getIsolationPlan(v.id)
      if (plan.items.length > 0) {
        isolationModal.target = v
        isolationModal.plan = plan
        isolationModal.error = ''
        isolationModal.open = true
        return
      }
    }
    await setVersionIsolation(v.id, next)
    await refreshInstalled()
    toast(
      next
        ? `已为「${v.id}」开启版本隔离`
        : `已关闭「${v.id}」的版本隔离；独立目录中的原数据已保留`,
      'success'
    )
  } catch (e) {
    toast('切换隔离失败：' + errText(e), 'error')
  } finally {
    if (!isolationModal.open) isoBusy.value = null
  }
}

async function confirmIsolation() {
  const target = isolationModal.target
  if (!target || isolationModal.busy) return
  isolationModal.busy = true
  isolationModal.error = ''
  try {
    await setVersionIsolation(target.id, true)
    await refreshInstalled()
    isolationModal.open = false
    toast(`已为「${target.id}」开启版本隔离，共享数据已安全复制`, 'success')
  } catch (error) {
    isolationModal.error = errText(error)
  } finally {
    isolationModal.busy = false
    isoBusy.value = null
    if (!isolationModal.open) {
      isolationModal.target = null
      isolationModal.plan = null
    }
  }
}
</script>

<template>
  <div class="page">
    <!-- 标题 -->
    <div class="page-head">
      <h1 class="page-title">游戏版本</h1>
      <p class="page-sub">浏览、安装与管理 Minecraft 版本</p>
    </div>

    <!-- 当前游戏文件夹：版本列表与安装目标都由这里唯一控制。 -->
    <section class="card folder-manager" @contextmenu.prevent="showFolderContextMenu(activeFolder)">
      <div class="folder-manager-main">
        <div class="folder-select-wrap">
          <span class="folder-caption">当前游戏文件夹</span>
          <SelectMenu
            class="folder-select"
            :model-value="activeFolder"
            :options="folders.map(f => ({ value: f.path, label: f.name + (f.isDefault ? '（默认）' : '') }))"
            :disabled="folderBusy || !folders.length"
            @change="chooseFolderPath"
          />
          <span class="muted folder-current-path" :title="activeFolder">{{ activeFolder }}</span>
        </div>
        <div class="folder-manager-actions">
          <button class="btn btn-gold btn-sm" :disabled="folderBusy" @click="addGameFolder">
            + 添加文件夹
          </button>
          <button class="btn btn-ghost btn-sm" :disabled="folderBusy" @click="refreshFolderScan()">
            <span v-if="folderBusy" class="spin"></span>
            {{ folderBusy ? '扫描中' : '刷新' }}
          </button>
          <button class="btn btn-ghost btn-sm" :disabled="!activeFolder" @click="revealCurrentFolder">
            打开
          </button>
          <button class="btn btn-ghost btn-sm" :disabled="!currentFolder" @click="openFolderRename">
            重命名
          </button>
          <button
            v-if="currentFolder && !currentFolder.isDefault"
            class="btn btn-ghost btn-sm"
            :disabled="folderBusy"
            @click="markCurrentDefault"
          >
            设为默认
          </button>
          <button
            class="btn btn-danger btn-sm"
            :disabled="folderBusy || folders.length <= 1"
            title="只解除 KAMUCL 登记，不删除磁盘文件"
            @click="folderRemove.open = true"
          >
            解除绑定
          </button>
        </div>
      </div>
      <div class="folder-shortcuts" aria-label="文件夹列表">
        <button v-for="folder in folders" :key="folder.path" class="btn btn-sm" :class="folder.path === activeFolder ? 'btn-gold' : 'btn-ghost'" :disabled="folderBusy" :title="folder.path" @click="chooseFolderPath(folder.path)" @contextmenu.stop.prevent="showFolderContextMenu(folder.path)">{{ folder.name }}</button>
      </div>
      <div class="folder-scan-state" :class="folderScan?.status">
        <template v-if="folderBusy">
          <span class="spin"></span><span>正在扫描版本与完整性…</span>
        </template>
        <template v-else-if="folderScan">
          <span class="folder-state-dot"></span>
          <span>
            {{ folderScan.structure === 'kamucl' ? 'KAMUCL 游戏根目录' : folderScan.structure === 'minecraft' ? 'Minecraft 根目录' : folderScan.structure === 'empty' ? '空游戏目录' : '目录不可用' }}
            · 已识别 {{ folderScan.versions.length }} 个版本
            · {{ folderScan.durationMs }} ms
          </span>
          <span v-if="folderScan.errors.length" class="folder-scan-error" :title="folderScan.errors.join('\n')">
            {{ folderScan.errors[0] }}{{ folderScan.errors.length > 1 ? `（另有 ${folderScan.errors.length - 1} 项）` : '' }}
          </span>
        </template>
        <span v-else class="muted">尚未扫描</span>
      </div>
    </section>

    <!-- 顶部 Tab：版本下载 / 已安装 -->
    <div class="game-tabs">
      <button class="game-tab" :class="{ active: tab === 'download' }" @click="tab = 'download'">
        版本下载
      </button>
      <button class="game-tab" :class="{ active: tab === 'installed' }" @click="tab = 'installed'">
        已安装<template v-if="store.installed.length">（{{ store.installed.length }}）</template>
      </button>
    </div>

    <template v-if="tab === 'download'">
    <!-- 工具行 -->
    <div class="toolbar">
      <div class="tool-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input v-model="store.searchKeyword" placeholder="搜索版本号…" />
      </div>

      <div class="filter-capsules">
        <button
          v-for="f in typeFilters"
          :key="f.value"
          class="capsule"
          :class="{ active: typeFilter === f.value }"
          @click="typeFilter = f.value"
        >
          {{ f.label }}
        </button>
      </div>

      <button class="btn btn-ghost tool-refresh" :disabled="loading" @click="load(true)">
        <span v-if="loading" class="spin"></span>
        <svg v-else viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
        {{ loading ? '刷新中' : '刷新' }}
      </button>

      <button
        class="tag mirror-toggle"
        :class="store.settings?.mirror === 'bmclapi' ? 'tag-cyan' : ''"
        :title="store.settings?.mirror === 'bmclapi' ? '当前：BMCLAPI 镜像源，点击切换为官方源' : '当前：官方源，点击切换为 BMCLAPI 镜像源'"
        @click="onToggleMirror"
      >
        {{ store.settings?.mirror === 'bmclapi' ? 'BMCLAPI 镜像' : '官方源' }}
      </button>
    </div>

    <!-- 版本列表 -->
    <div class="card list-card">
      <div v-if="loading && !manifest.length" class="empty">
        <span class="spin"></span>
        <span>正在获取版本列表…</span>
      </div>
      <div v-else-if="loadError" class="empty">
        <span>加载失败：{{ loadError }}</span>
        <button class="btn btn-ghost btn-sm" @click="load(true)">重试</button>
      </div>
      <div v-else-if="!filtered.length" class="empty">
        <span>{{ keyword || typeFilter !== 'all' ? '没有匹配的版本' : '版本列表为空' }}</span>
      </div>
      <div v-else class="version-list">
        <div v-for="v in filtered" :key="v.id" class="version-row">
          <div class="version-info">
            <span class="version-id">{{ v.id }}</span>
            <span class="tag" :class="typeTagClass(v.type)">{{ typeText[v.type] }}</span>
            <span class="muted version-date">{{ formatDate(v.releaseTime) }}</span>
          </div>
          <div class="version-actions">
            <div v-if="store.installing.has(v.id) && store.progress" class="row-progress">
              <div class="row-bar">
                <div class="row-bar-fill" :style="{ width: Math.round(progressMono(store.progress) * 100) + '%' }"></div>
              </div>
              <span class="muted row-progress-text">
                {{ Math.round(progressMono(store.progress) * 100) }}%
                {{ store.progress.speed ? '· ' + formatSpeed(store.progress.speed) : '' }}
                {{ etaText ? '· ' + etaText : '' }}
                {{ store.progress.source ? '· ' + store.progress.source : '' }}
              </span>
            </div>
            <span v-if="isInstalled(v)" class="tag tag-success">已安装</span>
            <button
              class="btn btn-sm"
              :class="isInstalled(v) ? 'btn-ghost' : 'btn-gold'"
              :disabled="store.installing.size > 0"
              @click="openInstall(v)"
            >
              {{ store.installing.has(v.id) ? '下载中' : isInstalled(v) ? '再安装' : '安装' }}
            </button>
          </div>
        </div>
      </div>
    </div>
    </template>

    <!-- 已安装区 -->
    <template v-else>
    <div class="card installed-card">
      <!-- 安装中（进度显示） -->
      <div v-if="installingVersions.length" class="installing-block">
        <div v-for="id in installingVersions" :key="id" class="installed-row installing-row">
          <div class="inst-names">
            <span class="version-id">{{ id }}</span>
            <span class="muted">正在下载安装…</span>
          </div>
          <div v-if="store.progress" class="row-progress">
            <div class="row-bar">
              <div class="row-bar-fill" :style="{ width: Math.round(progressMono(store.progress) * 100) + '%' }"></div>
            </div>
            <span class="muted row-progress-text">
              {{ Math.round(progressMono(store.progress) * 100) }}%
              {{ store.progress.speed ? '· ' + formatSpeed(store.progress.speed) : '' }}
            </span>
          </div>
        </div>
      </div>

      <!-- 安装失败（重试入口） -->
      <div v-for="id in [...store.failedInstalls].filter((x) => !installingVersions.includes(x))" :key="'fail-' + id" class="installed-row failed-row">
        <div class="inst-names">
          <span class="version-id">{{ id }}</span>
          <span class="muted">上次安装失败</span>
        </div>
        <button class="btn btn-ghost btn-sm installed-folder row-actions" @click="onRetry(id)">重试</button>
      </div>

      <div v-if="!store.installed.length && !installingVersions.length" class="empty installed-empty">
        <span>还没有安装任何版本</span>
        <button class="btn btn-gold btn-sm" @click="tab = 'download'">去版本下载看看</button>
      </div>
      <div v-else class="installed-list">
        <!-- 同一实例仅渲染一次；sortWithFavorite 已负责收藏置顶。 -->

        <div v-for="v in sortedInstalled" :key="v.id" class="installed-row" @contextmenu.prevent="showFolderContextMenu(v.folder, v.id)">
          <button
            class="fav-btn"
            :class="{ on: isFavorite(v.id) }"
            :title="isFavorite(v.id) ? '取消收藏' : '收藏'"
            @click="toggleFavorite(v.id)"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z" /></svg>
          </button>
          <button class="inst-icon" title="更换实例图标" @click="openIconPicker(v.id)">
            <img v-if="versionIconUrl(v)" :src="versionIconUrl(v)" alt="" />
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/></svg>
          </button>
          <div class="inst-names">
            <span class="version-id editable" :title="`点击改名（目录名：${v.id}）`" @click="openRenameFor(v.id)">{{ displayVersionName(v) }}</span>
            <span v-if="displayVersionSub(v) !== displayVersionName(v)" class="muted inst-sub">
              {{ displayVersionSub(v) }}
            </span>
          </div>
          <!-- 下载未完成的残缺版本：继续下载 / 删除 -->
          <template v-if="v.incomplete">
            <span class="tag tag-danger">下载未完成</span>
            <div class="row-actions">
              <button
                class="btn btn-gold btn-sm installed-folder"
                :disabled="store.installing.has(v.id)"
                @click="onRetry(v.id)"
              >
                继续下载
              </button>
              <button
                class="btn btn-danger btn-sm installed-remove"
                @click="removeModal.open = true; removeModal.target = v"
              >
                删除残留
              </button>
            </div>
          </template>
          <!-- 安装事务失败：清理残留 -->
          <template v-else-if="v.failed">
            <span class="tag tag-danger">安装失败</span>
            <div class="row-actions">
              <button
                class="btn btn-danger btn-sm installed-remove"
                @click="onCleanup(v.id)"
              >
                清理残留
              </button>
            </div>
          </template>
          <template v-else>
          <span v-if="v.modpackName" class="tag tag-accent">整合包 · {{ v.modpackName }}</span>
          <span v-else-if="!v.loader" class="tag">纯净版</span>
          <span
            v-if="v.isolated"
            class="tag"
            :title="`实际游戏目录：${v.gameDirectory || '版本独立目录'}（${v.isolationReason || '已配置'}）`"
          >已隔离</span>
          <span class="tag tag-cyan" :title="v.folder">{{ folderShortName(v.folder) }}</span>
          <span class="muted played-text">最近游玩：{{ fmtLastPlayed(store.lastPlayed[v.id]) }}</span>
          <div class="row-actions">
          <label
            v-if="!v.modpackName"
            class="iso-switch"
            :title="v.isolated ? `版本隔离已开启：${v.gameDirectory || '使用独立游戏目录'}。点击关闭` : '版本隔离已关闭：与全局共享游戏目录。点击开启前会展示迁移范围'"
          >
            <span class="muted iso-label">隔离</span>
            <span class="switch">
              <input
                type="checkbox"
                :checked="!!v.isolated"
                :disabled="isoBusy === v.id"
                @change="onToggleIsolation(v, $event)"
              />
              <span class="switch-ui"></span>
            </span>
          </label>
          <button
            class="icon-btn installed-folder"
            :title="`打开 ${v.id} 的版本文件夹`"
            @click="openVersionFolder(v)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
            </svg>
          </button>
          <button
            class="icon-btn installed-folder"
            :title="`管理 ${v.id} 的模组/资源包/光影包`"
            @click="openManageMenu($event, v.id)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06-.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1.82.33l.06.06a2 2 0 1 1 2.83 2.83l.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button
            class="btn btn-gold btn-sm installed-launch"
            :disabled="store.launchState?.status === 'running' || store.launchState?.status === 'launching'"
            :title="`启动 ${v.id}`"
            @click="launchVersion(v)"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="margin-right:4px;vertical-align:-1px"><path d="M8 5.5v13l11-6.5Z" /></svg>
            启动
          </button>
          <button
            class="btn btn-danger btn-sm installed-remove"
            @click="removeModal.open = true; removeModal.target = v"
          >
            删除
          </button>
          </div>
          </template>
        </div>
      </div>
    </div>
    </template>

    <!-- 管理快捷菜单（模组/资源包/光影包） -->
    <Teleport to="body">
      <div v-if="manageMenu.id" class="menu-overlay" @click="manageMenu.id = ''"></div>
      <div
        v-if="manageMenu.id"
        class="float-menu"
        :style="{ top: manageMenu.top + 'px', left: manageMenu.left + 'px' }"
      >
        <button class="menu-item" @click="goManage('mods')">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/></svg>
          模组
        </button>
        <button class="menu-item" @click="goManage('packs')">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>
          资源包
        </button>
        <button class="menu-item" @click="goManage('shaders')">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          光影包
        </button>
        <button class="menu-item" @click="openRename">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
          重命名
        </button>
        <button class="menu-item" @click="openIconPicker(manageMenu.id)">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>
          更换图标
        </button>
        <button class="menu-item" @click="openThumbnailPicker(manageMenu.id)">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16.5" cy="8.5" r="1.5"/></svg>
          启动卡图片
        </button>
        <button class="menu-item" @click="openJavaModal">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a3 3 0 0 1 0 6h-1M3 8h15v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M7 12h6M7 15h4"/></svg>
          指定 Java
        </button>
        <button class="menu-item" @click="openResolutionModal">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg>
          窗口设置
        </button>
      </div>
    </Teleport>

    <!-- 实例窗口设置；未覆盖时始终跟随全局配置。 -->
    <Teleport to="body">
      <div v-if="resolutionModal.open" class="modal-mask" @pointerdown.self="resolutionModal.open = false">
        <div class="modal">
          <h3 class="modal-title">窗口设置 · {{ resolutionModal.id }}</h3>
          <p class="modal-label">实例设置优先于全局设置；选择“跟随全局”可删除覆盖。</p>
          <select v-model="resolutionModal.mode" class="select">
            <option value="inherit">跟随全局</option>
            <option value="windowed">窗口化</option>
            <option value="maximized">最大化</option>
            <option value="fullscreen">全屏</option>
          </select>
          <div class="instance-resolution-size">
            <label>
              <span class="muted">宽</span>
              <input v-model.number="resolutionModal.width" class="input" type="number" min="854" max="7680" :disabled="resolutionModal.mode !== 'windowed'" />
            </label>
            <span class="muted">×</span>
            <label>
              <span class="muted">高</span>
              <input v-model.number="resolutionModal.height" class="input" type="number" min="480" max="4320" :disabled="resolutionModal.mode !== 'windowed'" />
            </label>
          </div>
          <p class="muted instance-resolution-tip">
            最大化会使用启动时所在显示器的可用工作区；全屏不会修改系统显示器分辨率。
          </p>
          <p v-if="resolutionModal.error" class="loaders-error">{{ resolutionModal.error }}</p>
          <div class="modal-actions">
            <button class="btn btn-ghost" :disabled="resolutionModal.busy" @click="resolutionModal.open = false">取消</button>
            <button class="btn btn-gold" :disabled="resolutionModal.busy" @click="onConfirmResolution">
              {{ resolutionModal.busy ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 指定 Java 弹窗 -->
    <Teleport to="body">
      <div v-if="javaModal.open" class="modal-mask" @pointerdown.self="javaModal.open = false">
        <div class="modal">
          <h3 class="modal-title">指定 Java · {{ javaModal.id }}</h3>
          <p class="modal-label">选择该版本使用的 Java（默认自动匹配）</p>
          <div v-if="javaModal.busy" class="loaders-loading">
            <span class="spin"></span><span class="muted">读取 Java 列表…</span>
          </div>
          <template v-else>
            <select v-model="javaModal.value" class="select">
              <option value="">自动匹配（按版本需求选择，推荐）</option>
              <option v-for="j in javaModal.list" :key="j.path" :value="j.path">
                Java {{ j.major }}（{{ j.source === 'manual' ? '手动' : '自动' }}）· {{ j.path }}
              </option>
            </select>
          </template>
          <div class="modal-actions">
            <button class="btn btn-ghost" @click="javaModal.open = false">取消</button>
            <button class="btn btn-gold" @click="onConfirmJava">确定</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 实例重命名弹窗 -->
    <Teleport to="body">
      <div v-if="renameModal.open" class="modal-mask" @pointerdown.self="renameModal.open = false">
        <div class="modal">
          <h3 class="modal-title">重命名实例</h3>
          <p class="modal-label">新实例名（将作为文件夹名 versions/&lt;名&gt;/）</p>
          <input
            v-model="renameModal.name"
            class="input mono"
            spellcheck="false"
            @keyup.enter="onConfirmRename"
          />
          <p v-if="renameModal.error" class="loaders-error">{{ renameModal.error }}</p>
          <div class="modal-actions">
            <button class="btn btn-ghost" @click="renameModal.open = false">取消</button>
            <button class="btn btn-gold" :disabled="renameModal.busy" @click="onConfirmRename">
              {{ renameModal.busy ? '重命名中…' : '确认重命名' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 实例图标选择弹窗 -->
    <IconPickerModal
      :open="iconModal.open"
      :version-id="iconModal.id"
      :current-icon="iconModal.current"
      @close="iconModal.open = false"
    />

    <ThumbnailPickerModal
      :open="thumbnailModal.open"
      :version-id="thumbnailModal.id"
      :current-path="thumbnailModal.current"
      :current-fit="thumbnailModal.fit"
      @close="thumbnailModal.open = false"
    />

    <!-- 游戏文件夹显示名称 -->
    <Teleport to="body">
      <div v-if="folderRename.open" class="modal-mask" @pointerdown.self="folderRename.open = false">
        <div class="modal">
          <h3 class="modal-title">重命名游戏文件夹</h3>
          <p class="modal-label">只修改 KAMUCL 中的显示名称，不会改动磁盘路径。</p>
          <input
            v-model="folderRename.name"
            class="input"
            maxlength="64"
            autofocus
            @keyup.enter="confirmFolderRename"
          />
          <p v-if="folderRename.error" class="loaders-error">{{ folderRename.error }}</p>
          <div class="modal-actions">
            <button class="btn btn-ghost" @click="folderRename.open = false">取消</button>
            <button class="btn btn-gold" :disabled="folderRename.busy" @click="confirmFolderRename">
              {{ folderRename.busy ? '保存中…' : '保存名称' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <ConfirmModal
      :open="folderRemove.open"
      title="解除游戏文件夹绑定"
      :message="`只会从 KAMUCL 移除「${currentFolder?.name ?? ''}」的登记。磁盘目录 ${activeFolder} 以及其中的游戏、存档、MOD 和配置都将完整保留。`"
      :busy="folderRemove.busy"
      @cancel="folderRemove.open = false"
      @confirm="confirmFolderRemove"
    />

    <!-- 开启隔离前展示精确迁移范围；确认后才执行事务式复制。 -->
    <Teleport to="body">
      <div v-if="isolationModal.open && isolationModal.plan" class="modal-mask" @pointerdown.self="closeIsolationModal">
        <div class="modal isolation-modal">
          <h3 class="modal-title">开启版本隔离 · {{ isolationModal.target?.id }}</h3>
          <p class="modal-label isolation-intro">
            以下共享数据将复制到版本独立目录。源文件会保留，目标中已存在的同名项不会被覆盖；失败时会回滚本次新增内容。
          </p>
          <div class="isolation-paths">
            <span>来源</span><code>{{ isolationModal.plan.source }}</code>
            <span>目标</span><code>{{ isolationModal.plan.destination }}</code>
          </div>
          <div class="isolation-summary">
            {{ isolationModal.plan.items.length }} 项 · {{ isolationModal.plan.totalFiles }} 个文件 · {{ fmtBytes(isolationModal.plan.totalBytes) }}
          </div>
          <div class="isolation-items">
            <div v-for="item in isolationModal.plan.items" :key="item.name" class="isolation-item">
              <div>
                <strong>{{ item.name }}</strong>
                <span class="muted">{{ item.kind === 'directory' ? '文件夹' : '文件' }} · {{ item.files }} 个文件 · {{ fmtBytes(item.bytes) }}</span>
              </div>
              <span v-if="isolationModal.plan.conflicts.includes(item.name)" class="tag tag-gold">目标已存在，跳过</span>
              <span v-else class="tag">将复制</span>
            </div>
          </div>
          <p v-if="isolationModal.error" class="loaders-error">{{ isolationModal.error }}</p>
          <div class="modal-actions">
            <button class="btn btn-ghost" :disabled="isolationModal.busy" @click="closeIsolationModal">取消</button>
            <button class="btn btn-gold" :disabled="isolationModal.busy" @click="confirmIsolation">
              {{ isolationModal.busy ? '正在迁移…' : '确认并开启' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 删除版本二次确认 -->
    <ConfirmModal
      :open="removeModal.open"
      title="删除版本"
      :message="`确定要删除版本「${removeModal.target?.id}」吗？该版本的游戏文件将被移除（共享的依赖库与资源会保留），此操作不可恢复。`"
      :busy="removeModal.busy"
      @cancel="removeModal.open = false"
      @confirm="onConfirmRemove"
    />

    <!-- 安装模态框 -->
    <Teleport to="body">
      <div v-if="modal.open" class="modal-mask" @pointerdown.self="modal.open = false">
        <div class="modal">
          <h3 class="modal-title">安装 {{ modal.version?.id }}</h3>

          <p class="modal-label">选择模组加载器</p>
          <div class="loader-options">
            <button
              v-for="opt in loaderOptions"
              :key="opt.value"
              class="loader-option"
              :class="{ active: modal.loader === opt.value }"
              @click="modal.loader = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>

          <template v-if="modal.loader">
            <p class="modal-label">加载器版本</p>
            <div v-if="modal.loadingLoaders" class="loaders-loading">
              <span class="spin"></span>
              <span class="muted">正在获取 {{ modal.loader }} 版本列表…</span>
            </div>
            <template v-else>
              <select v-if="modal.loaderVersions.length" v-model="modal.loaderVersion" class="select">
                <option v-for="lv in modal.loaderVersions" :key="lv" :value="lv">{{ lv }}</option>
              </select>
              <p v-if="modal.loadLoadersError" class="loaders-error">{{ modal.loadLoadersError }}</p>
            </template>

            <!-- Fabric 联动：Fabric API 自动选择 -->
            <template v-if="modal.loader === 'fabric'">
              <div class="fapi-head">
                <p class="modal-label" style="margin: 0">Fabric API</p>
                <label class="fapi-switch">
                  <span class="muted">同时安装（大多数 Fabric 模组需要）</span>
                  <span class="switch">
                    <input v-model="modal.apiOn" type="checkbox" />
                    <span class="switch-ui"></span>
                  </span>
                </label>
              </div>
              <template v-if="modal.apiOn">
                <div v-if="modal.loadingApi" class="loaders-loading">
                  <span class="spin"></span>
                  <span class="muted">正在获取 Fabric API 版本…</span>
                </div>
                <template v-else>
                  <select v-if="modal.apiVersions.length" v-model="modal.apiVersion" class="select">
                    <option v-for="a in modal.apiVersions" :key="a.version" :value="a.version">
                      {{ a.version }}{{ a.date ? `（${formatDate(a.date)}）` : '' }}
                    </option>
                  </select>
                  <p v-if="modal.apiError" class="loaders-error">{{ modal.apiError }}</p>
                  <p class="muted fapi-tip">安装完成后将自动放入 mods 文件夹</p>
                </template>
              </template>
            </template>
          </template>

          <!-- 实例名（所有实例均可自定义；纯净版默认 MC 版本号，加载器实例按规则生成） -->
          <p class="modal-label">实例名</p>
          <input
            v-model="modal.instanceName"
            class="input mono"
            :placeholder="defaultInstanceName"
            spellcheck="false"
            @input="modal.instanceEdited = true"
          />
          <p v-if="instanceError" class="loaders-error">{{ instanceError }}</p>
          <p v-else class="muted inst-hint">实例将安装为 versions/{{ effectiveInstanceName }}/，可自定义（同 MC 版本可共存多个实例）</p>

          <div class="modal-actions">
            <button class="btn btn-ghost" @click="modal.open = false">取消</button>
            <button class="btn btn-gold" :disabled="!canConfirm" @click="confirmInstall">确认安装</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 940px;
  margin: 0 auto;
}

/* 游戏文件夹统一管理 */
.folder-manager {
  scroll-margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
}
.folder-manager-main {
  display: flex;
  align-items: flex-end;
  gap: 14px;
}
.folder-shortcuts { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.folder-select-wrap {
  display: grid;
  grid-template-columns: minmax(210px, 320px);
  gap: 5px;
  min-width: 0;
}
.folder-caption {
  color: var(--text-dim);
  font-size: 11.5px;
}
.folder-select {
  width: 100%;
}
.folder-current-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 10.5px;
}
.folder-manager-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex: 1;
  flex-wrap: wrap;
}
.folder-scan-state {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 11.5px;
}
.folder-state-dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: #3fb950;
}
.folder-scan-state.warning .folder-state-dot {
  background: #e6a23c;
}
.folder-scan-state.error .folder-state-dot {
  background: var(--danger);
}
.folder-scan-error {
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  color: var(--danger);
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 1120px) {
  .folder-manager-main {
    align-items: stretch;
    flex-direction: column;
  }
  .folder-select-wrap {
    grid-template-columns: minmax(0, 1fr);
  }
  .folder-manager-actions {
    justify-content: flex-start;
  }
}

/* 工具行 */
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.tool-search {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 180px;
  height: 38px;
  padding: 0 13px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--card-2);
  color: var(--text-dim);
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.tool-search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.tool-search svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.tool-search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
}
.tool-search input::placeholder {
  color: var(--text-dim);
  opacity: 0.75;
}

.filter-capsules {
  display: flex;
  gap: 6px;
}
.capsule {
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--card-2);
  color: var(--text-dim);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.capsule:hover {
  color: var(--text);
}
.capsule.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-2);
}
.tool-refresh {
  flex-shrink: 0;
}

/* 列表 */
.list-card {
  padding: 8px;
}
.version-list {
  /* 不再限制高度——整页单条外滚动，消灭内层嵌套滚动 */
  display: flex;
  flex-direction: column;
}
.version-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  transition: background 0.15s ease;
}
.version-row:hover {
  background: var(--card-2);
}
.version-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.version-id {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.version-id.editable {
  cursor: pointer;
  border-bottom: 1px dashed transparent;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.version-id.editable:hover {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
/* 实例图标按钮 */
.inst-icon {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card-2);
  color: var(--text-dim);
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.12s ease;
}
.inst-icon:hover {
  border-color: var(--accent);
  transform: scale(1.05);
}
.inst-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}
.version-date {
  font-size: 12px;
  flex-shrink: 0;
}
.version-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.row-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}
.row-bar {
  width: 90px;
  height: 6px;
  border-radius: 999px;
  background: var(--card-2);
  border: 1px solid var(--border);
  overflow: hidden;
}
.row-bar-fill {
  height: 100%;
  background: var(--accent-grad);
  transition: width 0.25s ease;
}
.row-progress-text {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

/* 已安装 */
.section-title {
  font-size: 15px;
  margin-bottom: 12px;
}
.installed-empty {
  padding: 24px;
}
.installed-list {
  display: flex;
  flex-direction: column;
}
.installed-row {
  display: flex;
  /* 三区模型：信息区收缩省略 / 元信息区收缩省略 / 操作区钉右，永不换行 */
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border);
}
.installed-row:last-child {
  border-bottom: none;
}
/* 实例名称（主名 + 技术 id 副标）：信息区可收缩，超长省略号（完整名在 tooltip） */
.inst-names {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}
.inst-sub {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  font-family: ui-monospace, Consolas, monospace;
  word-break: break-all;
}
.inst-names .version-id { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 元信息区（标签）：可收缩，省略号兜底，不挤压操作区 */
.installed-row > .tag { max-width: 200px; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iso-switch { flex-shrink: 0; white-space: nowrap; }
.mirror-toggle {
  cursor: pointer;
  user-select: none;
  transition: transform 0.12s ease, filter 0.15s ease;
}
.mirror-toggle:hover {
  filter: brightness(1.15);
}
.mirror-toggle:active {
  transform: scale(0.96);
}

/* 顶部 Tab 分段 */
.game-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--card-2);
  align-self: flex-start;
}
.game-tab {
  padding: 7px 20px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-dim);
  font-size: 13.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.game-tab:hover {
  color: var(--text);
}
.game-tab.active {
  background: var(--accent-grad);
  color: var(--on-accent);
  box-shadow: 0 2px 8px var(--accent-soft);
}

/* 安装中/失败行 */
.installing-block {
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
.failed-row .installed-folder {
  margin-left: auto;
}
.played-text {
  font-size: 12px;
  /* 元信息区可收缩省略，不再用 auto 外边距推右（操作区统一由 .row-actions 钉右） */
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 行内操作区：隔离/文件夹/管理/启动/删除统一容器，钉右且永不换行 */
.row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
}

/* 收藏星标按钮与分组标题 */
.fav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s ease, background 0.15s ease, transform 0.12s ease;
}
.fav-btn:hover {
  color: var(--accent);
  background: var(--accent-soft);
}
.fav-btn.on {
  color: #f5b301;
}
.fav-btn:active {
  transform: scale(0.9);
}
.fav-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 4px 4px;
  font-size: 12.5px;
  font-weight: 700;
  color: #f5b301;
}

/* 版本隔离开关 */
.iso-switch {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.iso-label {
  font-size: 12px;
}
.installed-remove {
  flex-shrink: 0;
}

/* 模态框 */
.modal-title {
  font-size: 17px;
  margin-bottom: 18px;
}
.modal-label {
  font-size: 13px;
  color: var(--text-dim);
  margin: 14px 0 8px;
}
.loader-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.loader-option {
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--card-2);
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.loader-option:hover {
  border-color: var(--text-dim);
}
.loader-option.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-2);
}
.loaders-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
}
.loaders-error {
  margin-top: 8px;
  font-size: 13px;
  color: var(--danger);
}
.inst-hint {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
}
/* Fabric API 联动区块 */
.fapi-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 18px;
}
.fapi-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
}
.fapi-tip {
  margin-top: 6px;
  font-size: 12px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 22px;
}
.instance-resolution-size {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  margin-top: 12px;
}
.instance-resolution-size label {
  display: grid;
  flex: 1;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
}
.instance-resolution-tip {
  margin-top: 10px;
  font-size: 11.5px;
  line-height: 1.55;
}
.isolation-modal {
  width: min(620px, calc(100vw - 40px));
}
.isolation-intro {
  line-height: 1.65;
}
.isolation-paths {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 7px 10px;
  align-items: center;
  margin-top: 12px;
  font-size: 11.5px;
  color: var(--text-dim);
}
.isolation-paths code {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.isolation-summary {
  margin-top: 14px;
  font-size: 12px;
  color: var(--text-dim);
}
.isolation-items {
  display: grid;
  gap: 7px;
  max-height: 230px;
  margin-top: 9px;
  overflow: auto;
}
.isolation-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card-2);
}
.isolation-item > div {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.isolation-item strong {
  font-size: 12px;
}
.isolation-item .muted {
  font-size: 10.5px;
}
</style>
