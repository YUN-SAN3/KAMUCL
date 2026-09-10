<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { communityDownload, communityFiles, communitySearch, errText, getManifest, getModTargets } from '../api'
import { store, toast } from '../store'
import { instanceKey } from '@shared/modCompatibility'
import { communityFileMatchesInstance, usesCommunityLoader } from '@shared/communityPolicy'
import { mcmodSearchUrl } from '@shared/communityLinks'
import MarqueeText from '../components/MarqueeText.vue'
import ModInstallDialog from '../components/ModInstallDialog.vue'
import type {
  CommunityFile,
  CommunityKind,
  CommunityResult,
  CommunitySource,
  LoaderName
} from '@shared/types'
import type { InstalledVersion } from '@shared/types'

// ---------------- 资源外链（源页面 + MC 百科介绍） ----------------
/** CurseForge 的 URL 分类段（按当前搜索分类推断） */
const CF_KIND_SEGMENT: Record<CommunityKind, string> = {
  mod: 'mc-mods',
  modpack: 'modpacks',
  resourcepack: 'texture-packs',
  shader: 'shaders',
  datapack: 'data-packs'
}

/** 资源的源站网页链接（Modrinth/CurseForge） */
function sourceUrl(r: CommunityResult): string {
  if (r.source === 'modrinth') return `https://modrinth.com/project/${r.slug || r.projectId}`
  return `https://www.curseforge.com/minecraft/${CF_KIND_SEGMENT[query.kind] ?? 'mc-mods'}/${r.slug || r.projectId}`
}

function openMcmod(item: CommunityResult) {
  const url = mcmodSearchUrl(item)
  if (url) openExternal(url)
  else toast('该项目没有可用于检索的英文名称', 'error')
}

function openExternal(url: string) {
  window.open(url, '_blank')
}
const currentInstance = computed(() => store.installed.find(v => v.id === localStorage.getItem('kamucl.lastVersion')) ?? store.installed[0])
const allTargets = ref<InstalledVersion[]>([])
const modRequest = ref<{ target: InstalledVersion; input: { file: CommunityFile } } | null>(null)

// ---------------- 搜索条件 ----------------
const PAGE_SIZE = 20

const kindTabs: Array<{ value: CommunityKind; label: string }> = [
  { value: 'mod', label: 'Mod' },
  { value: 'modpack', label: '整合包' },
  { value: 'resourcepack', label: '资源包' },
  { value: 'shader', label: '光影包' },
  { value: 'datapack', label: '数据包' }
]

/** 类型筛选胶囊滑动指示块（与导航水滴/游戏 Tab 同款弹簧动效） */
const kindCapsules = ref<HTMLElement | null>(null)
const kindBlob = reactive({ left: 0, top: 0, width: 0, height: 0, on: false })
function updateKindBlob() {
  const root = kindCapsules.value
  if (!root) return
  const active = root.querySelector<HTMLElement>(`.capsule[data-kind="${query.kind}"]`)
  if (!active) return
  kindBlob.left = active.offsetLeft
  kindBlob.top = active.offsetTop
  kindBlob.width = active.offsetWidth
  kindBlob.height = active.offsetHeight
  kindBlob.on = true
}
// 字体、主题及换行会改变胶囊尺寸，分类切换以外也需要重算。
let kindBlobObserver: ResizeObserver | null = null
onMounted(() => {
  nextTick(updateKindBlob)
  setTimeout(updateKindBlob, 200)
  kindBlobObserver = new ResizeObserver(() => updateKindBlob())
  watch(kindCapsules, (el) => {
    kindBlobObserver?.disconnect()
    if (el) kindBlobObserver?.observe(el)
  }, { immediate: true })
  // 主题切换改变配色/字体度量 → 重算
  watch(() => store.settings?.theme, () => nextTick(() => setTimeout(updateKindBlob, 60)))
})
onUnmounted(() => kindBlobObserver?.disconnect())
const kindBlobStyle = computed(() => ({
  left: kindBlob.left + 'px',
  top: kindBlob.top + 'px',
  width: kindBlob.width + 'px',
  height: kindBlob.height + 'px',
  opacity: kindBlob.on ? 1 : 0
}))

const sourceOptions: Array<{ value: 'all' | CommunitySource; label: string }> = [
  { value: 'all', label: '全部来源' },
  { value: 'modrinth', label: 'Modrinth' },
  { value: 'curseforge', label: 'CurseForge' }
]

const loaderOptions: Array<{ value: '' | LoaderName; label: string }> = [
  { value: '', label: '全部加载器' },
  { value: 'forge', label: 'Forge' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'quilt', label: 'Quilt' },
  { value: 'neoforge', label: 'NeoForge' }
]

/** 完整 MC 版本列表（与游戏下载页同一数据源：远程版本清单，正式版为主） */
const manifestVersions = ref<string[]>([])
const manifestLoading = ref(false)

async function loadManifest() {
  if (manifestVersions.value.length || manifestLoading.value) return
  manifestLoading.value = true
  try {
    const list = await getManifest()
    manifestVersions.value = list.filter((v) => v.type === 'release').map((v) => v.id)
  } catch {
    /* 清单失败时回退到已安装版本 */
    const set = new Set<string>()
    for (const v of store.installed) if (v.mcVersion) set.add(v.mcVersion)
    manifestVersions.value = [...set].sort().reverse()
  } finally {
    manifestLoading.value = false
  }
}

/** 版本筛选下拉（支持输入搜索定位） */
const versionInput = ref('')
const versionDropdownOpen = ref(false)
const filteredVersionOptions = computed(() => {
  const kw = versionInput.value.trim().toLowerCase()
  if (!kw) return manifestVersions.value.slice(0, 60)
  return manifestVersions.value.filter((v) => v.toLowerCase().includes(kw)).slice(0, 60)
})

function pickVersion(v: string) {
  query.mcVersion = v
  versionInput.value = query.mcVersion
  versionDropdownOpen.value = false
  onFilterChange()
}

function applyVersionInput() {
  query.mcVersion = versionInput.value.trim()
  versionDropdownOpen.value = false
  onFilterChange()
}

onMounted(() => void loadManifest())

const query = reactive({
  keyword: '',
  kind: 'mod' as CommunityKind,
  source: 'all' as 'all' | CommunitySource,
  mcVersion: currentInstance.value?.mcVersion === '未知' ? '' : currentInstance.value?.mcVersion ?? '',
  loader: currentInstance.value?.loader ?? '' as '' | LoaderName,
  sort: 'relevance' as 'relevance' | 'downloads' | 'newest'
})
// query 必须先初始化。过早运行 getter 会抛错，导致监听未订阅分类变化。
watch(() => query.kind, () => nextTick(updateKindBlob), { flush: 'post' })
const supportsLoader = computed(() => usesCommunityLoader(query.kind))
const usesPagination = computed(() => !supportsLoader.value)

/** 排序选项 */
const sortOptions = [
  { value: 'relevance', label: '相关度' },
  { value: 'downloads', label: '最多下载' },
  { value: 'newest', label: '最新发布' }
]

// ---------------- 搜索与列表 ----------------
const results = ref<CommunityResult[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const searched = ref(false) // 是否已发起过搜索（区分初始空态）
const loadError = ref('')
const offset = ref(0)
const hasMore = ref(false)
const currentPage = ref(1)
const totalResults = ref(0)
const searchWarnings = ref<string[]>([])
const totalPages = computed(() => Math.max(1, Math.ceil(totalResults.value / PAGE_SIZE)))
const visiblePages = computed(() => {
  const start = Math.max(1, Math.min(currentPage.value - 2, totalPages.value - 4))
  return Array.from({ length: Math.min(5, totalPages.value) }, (_, i) => start + i)
})
const listCard = ref<HTMLElement | null>(null)

let searchGeneration = 0
async function doSearch(reset: boolean, page = currentPage.value) {
  if (!reset && (loading.value || loadingMore.value)) return
  const generation = ++searchGeneration
  if (reset) {
    offset.value = 0
    currentPage.value = 1
    totalResults.value = 0
    results.value = []
    searchWarnings.value = []
  }
  const paged = usesPagination.value
  if (paged && !reset) currentPage.value = page
  const requestedOffset = paged ? (currentPage.value - 1) * PAGE_SIZE : offset.value
  const first = reset || paged
  if (first) loading.value = true
  else loadingMore.value = true
  loadError.value = ''
  searched.value = true
  try {
    const response = await communitySearch({
      keyword: query.keyword.trim(),
      kind: query.kind,
      source: query.source,
      mcVersion: query.mcVersion || undefined,
      loader: supportsLoader.value ? query.loader || undefined : undefined,
      sort: query.sort,
      offset: requestedOffset,
      limit: PAGE_SIZE
    })
    if (generation !== searchGeneration) return
    const list = response.items
    if (first) results.value = list
    else results.value = [...results.value, ...list]
    totalResults.value = response.total
    searchWarnings.value = response.warnings ?? []
    hasMore.value = requestedOffset + PAGE_SIZE < response.total
    offset.value = requestedOffset + PAGE_SIZE
  } catch (e) {
    if (generation !== searchGeneration) return
    loadError.value = errText(e)
    if (!first) toast('加载失败：' + loadError.value, 'error')
  } finally {
    if (generation === searchGeneration) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

const onSearch = () => void doSearch(true)
const onLoadMore = () => void doSearch(false)
async function goToPage(page: number) {
  if (loading.value || page < 1 || page > totalPages.value || page === currentPage.value) return
  await doSearch(false, page)
  listCard.value?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

// ---------------- 无限滚动：列表底部哨兵进入视口即自动加载（保留按钮作兜底） ----------------
const moreSentinel = ref<HTMLElement | null>(null)
let moreObserver: IntersectionObserver | null = null
onMounted(() => {
  moreObserver = new IntersectionObserver(
    (entries) => {
      if (!usesPagination.value && entries.some((e) => e.isIntersecting) && hasMore.value && !loading.value && !loadingMore.value) {
        onLoadMore()
      }
    },
    { root: null, rootMargin: '240px', threshold: 0 }
  )
  watch(moreSentinel, (el) => {
    moreObserver?.disconnect()
    if (el) moreObserver?.observe(el)
  }, { immediate: true })
})
onUnmounted(() => moreObserver?.disconnect())
function useCurrentInstance() {
  query.mcVersion = currentInstance.value?.mcVersion === '未知' ? '' : currentInstance.value?.mcVersion ?? ''
  query.loader = currentInstance.value?.loader ?? ''
  versionInput.value = query.mcVersion
  onFilterChange()
}
versionInput.value = query.mcVersion

/** 按具体实例筛选：选中实例即带入其 MC 版本与 Loader */
function useInstance(id: string) {
  const v = store.installed.find((x) => x.id === id)
  if (!v) return
  query.mcVersion = v.mcVersion === '未知' ? '' : v.mcVersion
  query.loader = v.loader ?? ''
  versionInput.value = query.mcVersion
  onFilterChange()
}

/** 切换条件后自动重新搜索 */
function onFilterChange() {
  void doSearch(true)
}

function onReset() {
  query.keyword = ''
  query.kind = 'mod'
  query.source = 'all'
  query.mcVersion = ''
  query.loader = ''
  query.sort = 'relevance'
  versionInput.value = ''
  void doSearch(true)
}

onMounted(() => { query.keyword = store.searchKeyword.trim(); void doSearch(true) })

// ---------------- 顶栏搜索联动：顶栏输入防抖驱动社区搜索 ----------------
let topSearchTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => store.searchKeyword,
  (kw) => {
    if (topSearchTimer) clearTimeout(topSearchTimer)
    topSearchTimer = setTimeout(() => {
      query.keyword = kw.trim()
      void doSearch(true)
    }, 400)
  }
)

// ---------------- 列表展示 ----------------
/** 图标加载失败的项目（显示首字母占位） */
const brokenIcons = ref(new Set<string>())
const itemKey = (r: CommunityResult) => `${r.source}:${r.projectId}`
const onIconError = (r: CommunityResult) => {
  brokenIcons.value = new Set([...brokenIcons.value, itemKey(r)])
}

const fmtDownloads = (n: number): string => {
  if (n >= 1e8) return (n / 1e8).toFixed(1) + ' 亿'
  if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万'
  return String(n)
}

const fmtDate = (iso: string): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('zh-CN')
}

const fmtSize = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const releaseTagClass = (t: CommunityFile['releaseType']) =>
  t === 'beta' ? 'tag-cyan' : t === 'alpha' ? 'tag-danger' : 'tag-gold'
const releaseText: Record<CommunityFile['releaseType'], string> = {
  release: '正式版',
  beta: 'Beta',
  alpha: 'Alpha'
}

// ---------------- 下载模态框 ----------------
const modal = reactive({
  open: false,
  item: null as CommunityResult | null,
  kind: 'mod' as CommunityKind,
  files: [] as CommunityFile[],
  loadingFiles: false,
  filesError: '',
  fileId: '',
  versionId: '',
  mcVersion: '',
  loader: '' as LoaderName | '',
  downloading: false
})

const isModpack = computed(() => modal.kind === 'modpack')
const selectedFile = computed(
  () => modal.files.find((f) => f.fileId === modal.fileId) ?? null
)
const targetOptions = computed(() => modal.kind === 'mod' ? allTargets.value.filter(v => selectedFile.value && communityFileMatchesInstance(selectedFile.value, v)) : store.installed)
watch(targetOptions, options => {
  if (!options.some(v => instanceKey(v) === modal.versionId)) {
    const selected = options.find(v => v.id === currentInstance.value?.id && v.folder === currentInstance.value?.folder) ?? options[0]
    modal.versionId = selected ? instanceKey(selected) : ''
  }
})
let fileGeneration = 0
async function loadFiles() {
  if (!modal.item) return
  const generation = ++fileGeneration, item = modal.item
  modal.loadingFiles = true; modal.filesError = ''; modal.files = []; modal.fileId = ''
  try {
    const files = await communityFiles(item.source, item.projectId, { kind: modal.kind, mcVersion: modal.mcVersion || undefined, loader: usesCommunityLoader(modal.kind) ? modal.loader || undefined : undefined })
    if (generation !== fileGeneration || !modal.open) return
    modal.files = files
    modal.fileId = (files.find(f => f.releaseType === 'release') ?? files[0])?.fileId ?? ''
    if (!files.length) modal.filesError = usesCommunityLoader(modal.kind) ? '当前 Minecraft / Loader 条件下没有文件，可手动调整筛选。' : '当前 Minecraft 版本下没有文件，可调整版本筛选。'
  } catch (e) { if (generation === fileGeneration) modal.filesError = '获取文件列表失败：' + errText(e) }
  finally { if (generation === fileGeneration) modal.loadingFiles = false }
}

async function openDownload(item: CommunityResult) {
  modal.open = true
  modal.item = item
  modal.kind = query.kind
  modal.files = []
  modal.loadingFiles = true
  modal.filesError = ''
  modal.fileId = ''
  modal.versionId = currentInstance.value ? instanceKey(currentInstance.value) : ''
  modal.mcVersion = query.mcVersion
  modal.loader = supportsLoader.value ? query.loader : ''
  modal.downloading = false
  try {
    const scanned = await getModTargets()
    allTargets.value = scanned.versions
    if (scanned.errors.length) toast('部分目录扫描失败：' + scanned.errors.join('；'), 'error')
    await loadFiles()
  } catch (e) {
    modal.filesError = '获取文件列表失败：' + errText(e)
  } finally {
    modal.loadingFiles = false
  }
}

const canConfirm = computed(
  () =>
    !!selectedFile.value &&
    !modal.loadingFiles &&
    !modal.downloading &&
    (isModpack.value || !!modal.versionId)
)

async function confirmDownload() {
  const file = selectedFile.value
  if (!file || !canConfirm.value) return
  const target = targetOptions.value.find(v => instanceKey(v) === modal.versionId)
  if (modal.kind === 'mod') {
    if (!target) return
    modRequest.value = { target, input: { file } }
    return
  }
  modal.downloading = true
  try {
    const res = await communityDownload(file, {
      versionId: target?.id ?? '',
      kind: modal.kind
    })
    modal.open = false
    if (modal.kind === 'modpack') {
      toast(res || '已开始安装整合包', 'success')
    } else {
      toast(`下载完成，已保存到：${res}`, 'success')
    }
  } catch (e) {
    toast('下载失败：' + errText(e), 'error')
  } finally {
    modal.downloading = false
  }
}
</script>

<template>
  <div class="page">
    <!-- 标题 -->
    <div class="page-head">
      <h1 class="page-title">社区资源</h1>
      <p class="page-sub">搜索并下载 Modrinth / CurseForge 上的 Mod、整合包、资源包、光影与数据包</p>
    </div>

    <!-- 搜索卡片 -->
    <div class="card search-card">
      <div class="filter-row">
        <span class="muted">兼容筛选：{{ query.mcVersion || '全部 Minecraft' }}<template v-if="supportsLoader"> / {{ query.loader || '全部 Loader' }}</template><template v-else> · 不按模组加载器筛选</template></span>
        <select
          v-if="store.installed.length"
          class="select filter-select instance-filter"
          :value="''"
          title="按已安装实例带入其 MC 版本与 Loader"
          @change="useInstance(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''"
        >
          <option value="" disabled selected>选择实例…</option>
          <option v-for="v in store.installed.filter((x) => !x.failed && !x.incomplete)" :key="v.id" :value="v.id">
            {{ v.id }}（{{ v.mcVersion }}{{ v.loader ? ` · ${v.loader}` : '' }}）
          </option>
        </select>
        <button class="btn btn-ghost btn-sm" @click="useCurrentInstance">使用当前实例</button>
      </div>
      <div class="search-row">
        <input
          v-model="query.keyword"
          class="input"
          placeholder="输入资源名称，回车搜索…"
          @keyup.enter="onSearch"
        />
        <button class="btn btn-gold search-btn" :disabled="loading" @click="onSearch">
          <span v-if="loading" class="spin"></span>
          <svg v-else viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          搜索
        </button>
        <button class="btn btn-ghost" :disabled="loading" @click="onReset">重置条件</button>
      </div>

      <div class="kind-capsules" ref="kindCapsules">
        <span class="capsule-blob" :style="kindBlobStyle" aria-hidden="true"></span>
        <button
          v-for="t in kindTabs"
          :key="t.value"
          class="capsule"
          :data-kind="t.value"
          :class="{ active: query.kind === t.value }"
          @click="query.kind = t.value; onFilterChange()"
        >
          {{ t.label }}
        </button>
      </div>

      <div class="filter-row">
        <select v-model="query.source" class="select filter-select" @change="onFilterChange">
          <option v-for="o in sourceOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <!-- 可搜索版本下拉：完整 MC 版本列表（远程清单数据源） -->
        <div class="ver-filter">
          <input
            v-model="versionInput"
            class="input ver-filter-input"
            :placeholder="manifestLoading ? '加载版本列表…' : (query.mcVersion || '全部版本')"
            @focus="versionDropdownOpen = true"
            @input="versionDropdownOpen = true"
            @change="applyVersionInput"
            @keydown.enter.prevent="applyVersionInput"
          />
          <div v-if="versionDropdownOpen" class="menu-overlay" @click="versionDropdownOpen = false"></div>
          <div v-if="versionDropdownOpen" class="float-menu ver-filter-menu">
            <button class="menu-item" :class="{ active: !query.mcVersion }" @mousedown.prevent @click="pickVersion('')">
              全部版本
            </button>
            <button
              v-for="v in filteredVersionOptions"
              :key="v"
              class="menu-item"
              :class="{ active: query.mcVersion === v }"
              @mousedown.prevent
              @click="pickVersion(v)"
            >
              {{ v }}
            </button>
            <div v-if="!filteredVersionOptions.length" class="ver-menu-empty">无匹配版本</div>
          </div>
        </div>
        <select v-if="supportsLoader" v-model="query.loader" class="select filter-select" @change="onFilterChange">
          <option v-for="o in loaderOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <select v-model="query.sort" class="select filter-select" @change="onFilterChange">
          <option v-for="o in sortOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
    </div>

    <!-- 结果列表 -->
    <div ref="listCard" class="card list-card">
      <p v-for="warning in searchWarnings" :key="warning" class="search-warning">{{ warning }}</p>
      <!-- 加载中 -->
      <div v-if="loading" class="empty">
        <span class="spin"></span>
        <span>正在搜索社区资源…</span>
      </div>
      <!-- 错误态 -->
      <div v-else-if="loadError" class="empty">
        <span>搜索失败：{{ loadError }}</span>
        <button class="btn btn-ghost btn-sm" @click="usesPagination ? doSearch(false) : onSearch()">重试</button>
      </div>
      <!-- 空态 -->
      <div v-else-if="!results.length" class="empty">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a13.5 13.5 0 0 1 0 18" />
          <path d="M12 3a13.5 13.5 0 0 0 0 18" />
        </svg>
        <span>{{ searched ? '没有找到匹配的资源，换个关键词或条件试试' : '输入关键词或选择条件开始搜索' }}</span>
      </div>
      <!-- 列表 -->
      <template v-else>
        <div class="result-list">
          <div v-for="r in results" :key="itemKey(r)" class="result-card">
            <div class="result-top">
              <div class="result-icon">
                <img
                  v-if="r.iconUrl && !brokenIcons.has(itemKey(r))"
                  :src="r.iconUrl"
                  alt=""
                  loading="lazy"
                  @error="onIconError(r)"
                />
                <span v-else class="icon-placeholder">{{ (r.title || '?').charAt(0).toUpperCase() }}</span>
              </div>
              <div class="result-head">
                <MarqueeText class="result-title" :text="r.title"/>
                <span class="tag" :class="r.source === 'modrinth' ? 'tag-success' : 'tag-cf'">
                  来源：{{ r.source === 'modrinth' ? 'Modrinth' : 'CurseForge' }}
                </span>
                <span v-if="r.author" class="muted result-author">{{ r.author }}</span>
              </div>
            </div>
            <p class="result-desc" :title="r.description">{{ r.description || '暂无简介' }}</p>
            <div class="result-meta muted">
              <span>下载量 {{ fmtDownloads(r.downloads) }}</span>
              <span class="meta-dot">·</span>
              <span>更新于 {{ fmtDate(r.updatedAt) }}</span>
            </div>
            <div class="result-foot">
              <div class="result-links">
                <button
                  class="icon-btn"
                  :title="`打开 ${r.source === 'modrinth' ? 'Modrinth' : 'CurseForge'} 源页面（查看完整介绍）`"
                  @click="openExternal(sourceUrl(r))"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>
                </button>
                <button
                  class="icon-btn"
                  title="在 MC 百科查看介绍与教程"
                  @click="openMcmod(r)"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
                </button>
              </div>
              <button class="btn btn-gold btn-sm result-dl" @click="openDownload(r)">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 3v11" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M4 21h16" />
                </svg>
                下载
              </button>
            </div>
          </div>
        </div>
        <!-- 无限滚动哨兵：进入视口自动加载更多（按钮保留作兜底） -->
        <div v-if="!usesPagination && hasMore" ref="moreSentinel" class="more-sentinel"></div>
        <!-- 加载更多 -->
        <div v-if="!usesPagination && hasMore" class="more-row">
          <button class="btn btn-ghost" :disabled="loadingMore" @click="onLoadMore">
            <span v-if="loadingMore" class="spin"></span>
            {{ loadingMore ? '加载中…' : '加载更多' }}
          </button>
        </div>
      </template>
      <nav v-if="usesPagination && searched" class="pagination" aria-label="资源分页">
        <span class="muted">共 {{ totalResults }} 项 · 第 {{ currentPage }} / {{ totalPages }} 页</span>
        <button class="btn btn-ghost btn-sm" :disabled="loading || currentPage <= 1" @click="goToPage(currentPage - 1)">上一页</button>
        <button v-for="page in visiblePages" :key="page" class="btn btn-sm" :class="page === currentPage ? 'btn-gold' : 'btn-ghost'" :aria-current="page === currentPage ? 'page' : undefined" :disabled="loading" @click="goToPage(page)">{{ page }}</button>
        <button class="btn btn-ghost btn-sm" :disabled="loading || currentPage >= totalPages" @click="goToPage(currentPage + 1)">下一页</button>
      </nav>
    </div>

    <!-- 下载模态框 -->
    <Teleport to="body">
      <div v-if="modal.open" class="modal-mask" @pointerdown.self="!modal.downloading && (modal.open = false)">
        <div class="modal download-modal">
          <h3 class="modal-title"><MarqueeText :text="'下载 ' + modal.item?.title"/></h3>
          <div v-if="modal.item" class="modal-links">
            <button class="btn btn-ghost btn-sm" @click="openExternal(sourceUrl(modal.item))">
              {{ modal.item.source === 'modrinth' ? 'Modrinth 源页面' : 'CurseForge 源页面' }}
            </button>
            <button class="btn btn-ghost btn-sm" @click="openMcmod(modal.item)">
              MC 百科介绍
            </button>
          </div>
          <div class="filter-row">
            <label class="modal-field">Minecraft 版本<input v-model="modal.mcVersion" class="input" list="mod-minecraft-versions" placeholder="全部版本" @change="loadFiles"/></label>
            <label v-if="usesCommunityLoader(modal.kind)" class="modal-field">Loader<select v-model="modal.loader" class="select" @change="loadFiles"><option v-for="l in loaderOptions" :key="l.value" :value="l.value">{{ l.label }}</option></select></label>
            <datalist id="mod-minecraft-versions"><option v-for="v in manifestVersions" :key="v" :value="v"/></datalist>
          </div>

          <p class="modal-label">选择文件版本</p>
          <div v-if="modal.loadingFiles" class="files-loading">
            <span class="spin"></span>
            <span class="muted">正在获取文件列表…</span>
          </div>
          <template v-else>
            <div v-if="modal.files.length" class="file-list">
              <button
                v-for="f in modal.files"
                :key="f.fileId"
                class="file-row"
                :class="{ active: modal.fileId === f.fileId }"
                @click="modal.fileId = f.fileId"
              >
                <span class="file-main">
                  <span class="file-name" :title="f.fileName">{{ f.fileName }}</span>
                  <span class="file-sub">版本 {{ f.version }} · MC {{ f.gameVersions.join(' / ') }}<template v-if="usesCommunityLoader(modal.kind) && f.loaders.length"> · {{ f.loaders.join(' / ') }}</template></span>
                </span>
                <span class="file-side">
                  <span class="tag" :class="releaseTagClass(f.releaseType)">{{ releaseText[f.releaseType] }}</span>
                  <span class="muted file-meta">{{ fmtDate(f.date) }} · {{ fmtSize(f.size) }}</span>
                </span>
              </button>
            </div>
            <p v-if="modal.filesError" class="files-error">{{ modal.filesError }}</p>
          </template>

          <!-- 目标版本（整合包安装即新实例，无需选择） -->
          <template v-if="!isModpack">
            <p class="modal-label">下载到版本</p>
            <select v-if="targetOptions.length" v-model="modal.versionId" class="select">
              <option v-for="v in targetOptions" :key="instanceKey(v)" :value="instanceKey(v)">
                {{ v.id }} · {{ v.mcVersion }} / {{ v.loader }} {{ v.loaderVersion }} · {{ v.folder }}
              </option>
            </select>
            <p v-else class="files-error">没有与所选文件兼容的已安装实例；可调整文件筛选，或在游戏版本页安装。</p>
          </template>
          <p v-else class="muted pack-tip">整合包将下载后自动创建独立实例并安装</p>

          <div class="modal-actions">
            <button class="btn btn-ghost" :disabled="modal.downloading" @click="modal.open = false">取消</button>
            <button class="btn btn-gold" :disabled="!canConfirm" @click="confirmDownload">
              <span v-if="modal.downloading" class="spin"></span>
              {{ modal.downloading ? '下载中…' : '确认下载' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
    <ModInstallDialog v-if="modRequest" :target="modRequest.target" :input="modRequest.input" @close="modRequest = null" @installed="modRequest = null; modal.open = false"/>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--sec-gap);
  max-width: 940px;
  margin: 0 auto;
}

/* ---------------- 搜索卡片 ---------------- */
.search-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.search-row {
  display: flex;
  gap: var(--space-3);
}
.search-row .input {
  flex: 1;
  min-width: 0;
}
.search-btn {
  flex-shrink: 0;
}

.kind-capsules {
  position: relative;
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--card-2);
  width: fit-content;
}
/* 类型筛选滑动指示块：弹簧动效跟随激活胶囊 */
.capsule-blob {
  position: absolute;
  border-radius: 999px;
  background: var(--accent-grad);
  box-shadow: 0 2px 8px var(--accent-soft);
  transition: left 0.32s cubic-bezier(0.3, 1.2, 0.4, 1), top 0.32s cubic-bezier(0.3, 1.2, 0.4, 1), width 0.32s cubic-bezier(0.3, 1.2, 0.4, 1), height 0.32s ease, opacity 0.15s ease;
  pointer-events: none;
  z-index: 0;
}
.capsule {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: calc(var(--ctl-h) - 6px);
  padding: 0 var(--space-4);
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-dim);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.2s ease;
}
.capsule:hover {
  color: var(--text);
}
.capsule.active {
  color: var(--on-accent);
  font-weight: 600;
}

.filter-row {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.filter-select {
  flex: 1;
  min-width: 140px;
}

/* 可搜索版本下拉 */
.ver-filter {
  position: relative;
  flex: 1.4;
  min-width: 170px;
}
.ver-filter-input {
  width: 100%;
}
.ver-filter-menu {
  position: absolute;
  top: calc(100% + var(--space-1));
  left: 0;
  right: 0;
  max-height: 260px;
  overflow-y: auto;
  z-index: 9001;
}
.ver-menu-empty {
  padding: var(--space-3);
  text-align: center;
  color: var(--text-dim);
  font-size: var(--text-xs);
}

/* ---------------- 结果列表（卡片横向网格，窄窗口自动换行） ---------------- */
.list-card {
  padding: var(--space-3);
}
.pagination { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: var(--space-2); padding: var(--space-4) 0 var(--space-2); }
.search-warning { color: var(--text-dim); font-size: var(--text-xs); padding: var(--space-2); }
.result-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-3);
}
.result-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--card-2);
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease, box-shadow 0.22s ease;
  /* 入场：自下而上渐入 + 按序错落 */
  animation: community-card-in 0.4s cubic-bezier(0.22, 0.9, 0.32, 1) backwards;
}
.result-card:nth-child(3n+1) { animation-delay: 0ms; }
.result-card:nth-child(3n+2) { animation-delay: 50ms; }
.result-card:nth-child(3n) { animation-delay: 100ms; }
@keyframes community-card-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
.result-card:hover {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  background: var(--hover);
  transform: translateY(-3px);
  box-shadow: 0 10px 28px color-mix(in srgb, var(--accent) 13%, transparent);
}

.result-top {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.result-icon {
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--card);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 8%, transparent);
}
.result-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.icon-placeholder {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--text-dim);
}

.result-head {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.result-title {
  flex: 1 1 100%;
  font-weight: 700;
  font-size: var(--text-md);
}
/* CurseForge 橙（Modrinth 绿复用 tag-success） */
.tag-cf {
  background: color-mix(in srgb, #f97316 12%, transparent);
  color: #f97316;
}
.result-author {
  font-size: var(--text-xs);
  min-width: 0;
}
.result-desc {
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--text-dim);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  /* 固定两行高度，保证网格内卡片对齐不跳动 */
  min-height: calc(var(--text-xs) * 1.6 * 2);
}
.result-meta {
  font-size: var(--text-xs);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-top: auto;
}
.meta-dot {
  opacity: 0.6;
}
.result-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
}
.result-links {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-shrink: 0;
}
.modal-links {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.result-dl {
  flex-shrink: 0;
}

.more-row {
  display: flex;
  justify-content: center;
  padding: var(--space-4) 0 var(--space-2);
}

/* ---------------- 下载模态框 ---------------- */
.download-modal {
  width: min(740px, calc(100vw - 40px));
  max-height: 88vh;
  overflow-y: auto;
}
.modal-field {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--text-dim);
}
.modal-title {
  font-size: var(--text-lg);
  font-weight: 700;
  margin: 0 0 var(--space-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.modal-label {
  font-size: var(--text-sm);
  color: var(--text-dim);
  margin: var(--space-4) 0 var(--space-2);
}
.files-loading {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) 0;
}
/* 文件版本列表：卡片化行（主行文件名 + 副行版本兼容信息，右侧标签+日期体积），宽松呼吸 */
.file-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 280px;
  overflow-y: auto;
  padding: var(--space-1) var(--space-1) var(--space-1) 0;
  /* 内嵌滚动区不再用外框包住（卡片自带边界） */
}
.file-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-2);
  color: var(--text);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s ease, box-shadow 0.2s ease;
}
.file-row:hover {
  background: var(--hover);
  border-color: var(--border-strong);
  transform: translateY(-1px);
}
.file-row.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent), 0 4px 14px var(--accent-soft);
}
/* 左：文件名（主）+ 版本兼容信息（副） */
.file-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 650;
  font-size: var(--text-sm);
  font-family: ui-monospace, Consolas, monospace;
}
.file-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: var(--text-dim);
}
/* 右：发行标签 + 日期·体积 */
.file-side {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.file-meta {
  font-size: var(--text-xs);
  white-space: nowrap;
}
.files-error {
  font-size: var(--text-sm);
  color: var(--danger);
  padding: var(--space-1) 0;
}
.pack-tip {
  font-size: var(--text-sm);
  margin: var(--space-4) 0 0;
}
.modal-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-5);
}
</style>
