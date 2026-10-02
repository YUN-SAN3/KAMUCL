<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import UpdateDialogShell from '../components/UpdateDialogShell.vue'
const ThirdPartyNotices = defineAsyncComponent(() => import('../components/ThirdPartyNotices.vue'))
import {
  addCustomJava,
  applyLocalUpdate,
  applyPendingUpdate,
  cancelJavaScan,
  checkUpdate,
  errText,
  getPendingUpdate,
  getSystemInfo,
  getUpdateState,
  hideJava,
  installPlugin,
  listJava,
  listPlugins,
  listUpdateReleases,
  onProgress,
  openPluginsDir,
  pickAddJava,
  pickLocalUpdateFile,
  refreshJava,
  removePlugin,
  restoreUpdateBackup,
  setPluginEnabled
} from '../api'
import { enterEditMode, store, toast } from '../store'
import { DEFAULT_CUSTOM_THEME, THEME_PRESETS } from '@shared/types'
import { autoMemoryMB } from '@shared/memory'
import MemoryOrganizer from '../components/MemoryOrganizer.vue'
import type { LocalUpdateCheck, PluginInfo, ReleaseInfo, Settings, ThemeName, UpdateStateInfo } from '@shared/types'
import { QQ_GROUP_NUMBER } from '@shared/branding'
import HomeLayoutEditor from '../components/HomeLayoutEditor.vue'
import { settingsCatalog, settingsCategories, settingsScopes, scopeOfCategory, searchSettings, type SettingsCategory, type SettingsScope } from '@shared/settingsCatalog'
import { updateSettings } from '../settingsUpdates'

const page = ref<HTMLElement | null>(null)
/** 精确输入框自动聚焦 */
const vFocus = { mounted: (el: HTMLElement) => el.focus() }
const settingsQuery = ref('')
const searchMatches = computed(() => searchSettings(settingsQuery.value))
const savedCategory = sessionStorage.getItem('kamucl.settings.category')
const category = ref<SettingsCategory>(settingsCategories.find(c => c.id === savedCategory)?.id ?? 'appearance')
const scope = computed(() => scopeOfCategory(category.value))
const visibleCategories = computed(() => settingsCategories.filter(c => c.scope === scope.value))
const lastCategories: Record<SettingsScope, SettingsCategory> = { launcher: 'appearance', game: 'game' }
lastCategories[scope.value] = category.value
function selectScope(id: SettingsScope) { void selectCategory(lastCategories[id]) }
const positions = new Map<string, number>()
let navigation = 0
function scroller() { return page.value?.querySelector<HTMLElement>('.settings-body') }
async function selectCategory(id: SettingsCategory) {
  const ticket = ++navigation
  const scroll = scroller(); positions.set(category.value, scroll?.scrollTop ?? 0)
  category.value = id; lastCategories[scopeOfCategory(id)] = id; settingsQuery.value = ''; sessionStorage.setItem('kamucl.settings.category', id)
  await nextTick()
  if (ticket === navigation && scroll) scroll.scrollTop = Math.min(positions.get(id) ?? 0, Math.max(0, scroll.scrollHeight-scroll.clientHeight))
}
async function jumpSetting(id: string) {
  const item = settingsCatalog.find(item => item.id === id)
  if (!item) return
  await selectCategory(item.category)
  const target = page.value?.querySelector<HTMLElement>('[data-section="' + id + '"]')
  if (!target) return
  if (target.tagName === 'DETAILS') (target as HTMLDetailsElement).open = true
  // Reveal only the path to the result, never expand every advanced setting below it.
  for (let parent = target.parentElement; parent && parent !== scroller(); parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true
  }
  await nextTick()
  target.setAttribute('tabindex', '-1')
  const body=scroller(); if(body)body.scrollTop += target.getBoundingClientRect().top-body.getBoundingClientRect().top-12; target.focus({ preventScroll: true })
}
async function revealSection() {
  if (!store.settings || !store.settingsSection) return
  const id = store.settingsSection; store.settingsSection = ''
  await jumpSetting(id)
}
onMounted(revealSection)
watch([() => store.settingsSection, () => !!store.settings], revealSection, { flush: 'post' })

// ---------------- 保存 ----------------
async function save(patch: Partial<Settings>) {
  try {
    await updateSettings(patch)
  } catch (e) {
    toast('保存设置失败：' + errText(e), 'error')
  }
}

// ---------------- 关于与更新 ----------------
const appVersion = __APP_VERSION__
const showLicenses = ref(false)
const updateCheckState = ref<'idle' | 'checking' | 'latest' | 'failed'>('idle')
let lastManualCheck = 0

async function onCheckUpdate() {
  const now = Date.now()
  if (now - lastManualCheck < 5 * 60_000 && updateCheckState.value === 'latest') {
    toast('5 分钟内已检查过，已是最新', 'info')
    return
  }
  lastManualCheck = now
  updateCheckState.value = 'checking'
  try {
    const r = await checkUpdate(true)
    if (r.ok && r.hasUpdate && r.release) {
      updateCheckState.value = 'idle'
      // 更新弹窗已经给出结果，避免再叠加同内容通知。
      store.updatePrompt = { release: r.release, rollback: false }
    } else if (r.ok) {
      updateCheckState.value = 'latest'
      // Result remains visible beside the check button; no duplicate success toast.
    } else {
      // 仅真实失败（断网/更新源不可达）才走这里，已记日志
      updateCheckState.value = 'failed'
      toast('检查失败：断网或更新源不可达（已记日志）', 'error')
    }
  } catch {
    updateCheckState.value = 'failed'
    toast('检查失败：断网或更新源不可达（已记日志）', 'error')
  }
}

const updateSource = computed(() => store.settings?.updateSource ?? 'auto')
function onUpdateSourceChange(e: Event) {
  void save({ updateSource: (e.target as HTMLSelectElement).value as Settings['updateSource'] })
}
function onUpdateMirrorChange(e: Event) {
  void save({ updateMirrorUrl: (e.target as HTMLInputElement).value.trim() })
}

// 版本回退
const rollback = ref<{ open: boolean; loading: boolean; list: ReleaseInfo[]; selected: string }>({
  open: false, loading: false, list: [], selected: ''
})
async function openRollback() {
  rollback.value.open = true
  rollback.value.loading = true
  try {
    rollback.value.list = (await listUpdateReleases()).filter((r) => r.version !== appVersion)
    if (!rollback.value.list.length) toast('没有可回退的历史版本', 'info')
  } catch (e) {
    toast('获取历史版本失败：' + errText(e), 'error')
  } finally {
    rollback.value.loading = false
  }
}
function confirmRollback() {
  const release = rollback.value.list.find((r) => r.version === rollback.value.selected)
  rollback.value.open = false
  if (!release) return
  store.updatePrompt = { release, rollback: true }
}
function releaseSummary(body: string): string {
  const first = (body || '').split(/\r?\n/).map((s) => s.replace(/^(?:#+|[-*])\s*/, '').trim()).filter(s => s && !/^KAMUCL\s+v?[\d.]+$/i.test(s))[0] ?? ''
  return first.length > 60 ? first.slice(0, 60) + '…' : first
}
function releaseDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// 还原到更新前的版本
const updateState = ref<UpdateStateInfo | null>(null)
const restoringBackup = ref(false)
// 已就绪待安装的更新（下次启动时应用，也可立即安装）
const pendingUpdate = ref<{ release: ReleaseInfo; file: string } | null>(null)
async function refreshUpdateState() {
  try {
    updateState.value = await getUpdateState()
  } catch {
    updateState.value = null
  }
  try {
    pendingUpdate.value = await getPendingUpdate()
  } catch {
    pendingUpdate.value = null
  }
}
async function onRestoreBackup() {
  if (!updateState.value) return
  restoringBackup.value = true
  try {
    await restoreUpdateBackup()
    restoringBackup.value = false
    await refreshUpdateState()
    toast('备份已准备，下次手动启动时恢复', 'success')
  } catch (e) {
    restoringBackup.value = false
    toast('还原失败：' + errText(e), 'error')
  }
}
async function onApplyPending() {
  try {
    await applyPendingUpdate()
    toast('更新已就绪，下次手动启动时应用', 'success')
  } catch (e) {
    toast('安装失败：' + errText(e), 'error')
  }
}

// 从本地文件安装更新
const localUpdate = ref<{ check: LocalUpdateCheck; confirming: boolean } | null>(null)
async function onPickLocalUpdate() {
  try {
    const check = await pickLocalUpdateFile()
    if (!check) return
    localUpdate.value = { check, confirming: true }
  } catch (e) {
    toast('校验安装包失败：' + errText(e), 'error')
  }
}
async function confirmLocalUpdate() {
  const lu = localUpdate.value
  if (!lu) return
  localUpdate.value = null
  try {
    await applyLocalUpdate(lu.check)
    await refreshUpdateState()
    toast('本地更新已准备，下次手动启动时应用', 'success')
  } catch (e) {
    toast('安装更新失败：' + errText(e), 'error')
  }
}

onMounted(refreshUpdateState)

// ---------------- 功能管理 ----------------
const featureToggles = [
  { key: 'mods', label: '模组（资源管理）' },
  { key: 'packs', label: '资源包' },
  { key: 'shaders', label: '光影包' },
  { key: 'recordings', label: '录像' },
  { key: 'bridge', label: 'MOD 面板' },
  { key: 'servers', label: '服务器' },
  { key: 'friends', label: '联机' },
  { key: 'keys', label: '默认配置' },
  { key: 'skins', label: '皮肤与披风' },
  { key: 'community', label: '社区资源' }
]

function onToggleFeature(key: string, enabled: boolean) {
  const cur = store.settings?.disabledFeatures ?? []
  const next = enabled ? cur.filter((k) => k !== key) : [...new Set([...cur, key])]
  void save({ disabledFeatures: next })
}

// ---------------- 主题 ----------------
const themeOptions = computed(() => {
  const customColors = store.settings?.custom.colors ?? DEFAULT_CUSTOM_THEME.colors
  const named = (key: Exclude<ThemeName, 'custom'>) => ({ key, ...THEME_PRESETS[key] })
  return [
    named('transparent'),
    named('blue-white'),
    named('black-orange'),
    named('black-pink'),
    named('white-pink'),
    {
      key: 'custom' as const,
      label: '个性化',
      description: '自定义配色与图片，沿用统一的图一布局',
      colors: customColors
    }
  ]
})

function chooseTheme(theme: ThemeName, _label: string) {
  void save({ theme })
}

// ---------------- Java 列表 ----------------
const javas = ref<Awaited<ReturnType<typeof listJava>>>([])
const javaLoading = ref(true)
const javaError = ref('')
const javaRefreshing = ref(false)
const javaCancelling = ref(false)
const javaScanText = ref('')
const javaScanProgress = ref(0)
const javaAdding = ref(false)
const javaCustomInput = ref('')
const javaAddError = ref('')

async function onRefreshJava(refresh = true, announce = true) {
  if (javaRefreshing.value) {
    javaCancelling.value = true
    try {
      const cancelled = await cancelJavaScan()
      if (!cancelled) toast('扫描任务已结束', 'info')
    } catch (e) {
      toast('取消扫描失败：' + errText(e), 'error')
    } finally {
      javaCancelling.value = false
    }
    return
  }
  javaRefreshing.value = true
  javaScanText.value = '正在准备扫描全部本地固定磁盘…'
  javaScanProgress.value = 0
  try {
    javas.value = await refreshJava(refresh)
    if (announce) toast('Java 扫描完成', 'success')
  } catch (e) {
    const message = errText(e)
    const cancelled = /取消|abort/i.test(message)
    toast(cancelled ? 'Java 扫描已取消' : '扫描失败：' + message, cancelled ? 'info' : 'error')
  } finally {
    javaRefreshing.value = false
    javaCancelling.value = false
  }
}

async function onAddJava() {
  if (javaAdding.value) return
  javaAdding.value = true
  javaAddError.value = ''
  try {
    const p = javaCustomInput.value.trim()
    if (p) {
      // 备选路径：手动输入完整路径（仍走 -version 校验）
      await addCustomJava(p)
      javaCustomInput.value = ''
      javas.value = await listJava()
    } else {
      // 主路径：系统文件选择器定位 java.exe（空输入时点击「添加」即弹选择框）
      const list = await pickAddJava()
      if (!list) return // 用户取消选择
      javas.value = list
    }
    toast('已添加 Java', 'success')
  } catch (e) {
    javaAddError.value = errText(e)
  } finally {
    javaAdding.value = false
  }
}

async function onHideJava(p: string) {
  try {
    await hideJava(p)
    javas.value = await listJava()
  } catch (e) {
    toast('操作失败：' + errText(e), 'error')
  }
}

onMounted(async () => {
  try {
    javas.value = await listJava()
  } catch (e) {
    javaError.value = errText(e)
  } finally {
    javaLoading.value = false
  }
  // 先立即展示缓存/快速扫描结果，再在后台补齐固定磁盘扫描；有新鲜缓存时会立即返回。
  void onRefreshJava(false, false)
})

const stopJavaProgress = onProgress((event) => {
  if (event.stage !== 'java-scan') return
  javaScanText.value = event.text
  javaScanProgress.value = Math.max(0, Math.min(1, event.overall ?? event.progress))
})
onUnmounted(stopJavaProgress)

const javaLabel = (j: { major: number; path: string; version: string; architecture?: string }) =>
  `Java ${j.major}（${j.version} · ${j.architecture ?? '未知架构'}）· ${j.path}`

// ---------------- 内存分配（自动/手动） ----------------
const MEM_MIN = 1024
/** 滑块步长 512MB（0.5GB，粗调节）；精细调节用数值输入框（0.25GB 精度） */
const MEM_STEP = 512
/** 给系统预留的内存（手动上限 = 可用内存 - 预留） */
const SYS_RESERVE_MB = 1024
/** 上限 = 当前可用内存 - 系统预留，向下取 512MB 整（随可用内存浮动） */
const memMax = ref(16384)
/** 物理内存总量（自动分配与信息展示用） */
const memTotal = ref(0)
/** 当前可用内存（信息展示，可手动刷新） */
const memFree = ref(0)
/** 双单位显示：整 G 只显示 G（如 2G），非整 G 显示「MB（x.xxG）」 */
const fmtMem = (mb: number) =>
  mb % 1024 === 0 ? `${mb / 1024}G` : `${mb}MB（${(mb / 1024).toFixed(2)}G）`

async function refreshSystemInfo(): Promise<void> {
  try {
    const info = await getSystemInfo()
    memTotal.value = info.totalMemMB
    memFree.value = info.freeMemMB
    memMax.value = Math.max(MEM_MIN, Math.floor((info.freeMemMB - SYS_RESERVE_MB) / MEM_STEP) * MEM_STEP)
    // 手动值超出真实内存（换机/降配后）时夹回物理总量；显示范围随可用内存浮动
    const s = store.settings
    if (s && s.memoryMB > info.totalMemMB) {
      s.memoryMB = info.totalMemMB
      void save({ memoryMB: info.totalMemMB })
    }
  } catch {
    /* 读不到就保持保守上限 */
  }
}
onMounted(refreshSystemInfo)

const memoryAuto = computed(() => store.settings?.memoryAuto === true)
function onMemoryAutoChange(on: boolean): void {
  store.settings!.memoryAuto = on
  void save({ memoryAuto: on })
}
/** 自动分配的当前计算值（展示用） */
const autoMemMB = computed(() => autoMemoryMB(memTotal.value || 16384))
const autoMemoryText = computed(() => (memTotal.value ? fmtMem(autoMemMB.value) : '…'))

/** 手动值超过当前可用内存：红色警告（崩溃风险） */
const memoryOverFree = computed(() => {
  const mb = store.settings?.memoryMB ?? 0
  return memFree.value > 0 && mb > memFree.value
})

const memoryMaxText = computed(() => fmtMem(memMax.value))
const memoryText = computed(() => {
  if (memoryAuto.value) return `自动（${fmtMem(autoMemMB.value)}）`
  // 拖动中显示预览值（按 0.5GB 步进预览取整），松手后稳定为生效值
  if (memPreview.value != null) return fmtMem(Math.round(memPreview.value / MEM_STEP) * MEM_STEP)
  return fmtMem(store.settings?.memoryMB ?? 0)
})
const memoryInfoText = computed(() =>
  memTotal.value
    ? `已用 ${fmtMem(Math.max(0, memTotal.value - memFree.value))} · 可用 ${fmtMem(memFree.value)} · 总计 ${fmtMem(memTotal.value)}`
    : '正在读取本机内存信息…'
)

// ---------------- 自定义内存滑块（拖动＝预览+比例基准冻结，松手＝生效+一次性重算校准） ----------------
const memTrack = ref<HTMLElement | null>(null)
const memDragging = ref(false)
/** 拖动预览值（MB，无级原始值；拖动中只驱动它，生效值 store.settings.memoryMB 全程不动） */
const memPreview = ref<number | null>(null)
/**
 * 拖动开始时刻度基准快照：{ 上限 max }。
 * 整个拖动过程冻结——可用内存浮动、右侧数值宽度变化一律不得影响进度条总长度与比例映射。
 * （根因实证：拖动中上限随可用内存浮动/数值位数挤压轨道 → 同一位置映射比例前后不一致 = 来回抖动）
 */
const memBaseline = ref<{ max: number; span: number } | null>(null)

/** 当前刻度基准：拖动中用冻结快照，其余时候用实时值 */
const memScaleMax = computed(() => memBaseline.value?.max ?? memMax.value)
const memScaleSpan = computed(() => memBaseline.value?.span ?? Math.max(memMax.value, MEM_MIN + MEM_STEP) - MEM_MIN)

/** 指针位置 → 无级原始 MB（不取整不钳制，取整与钳制只在预览显示与最终提交时发生） */
function memRawFromClientX(clientX: number): number {
  const track = memTrack.value
  if (!track) return store.settings?.memoryMB ?? MEM_MIN
  const rect = track.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  return MEM_MIN + ratio * memScaleSpan.value
}

function onMemThumbDown(e: PointerEvent) {
  e.preventDefault()
  e.stopPropagation()
  memDragging.value = true
  // 快照冻结刻度基准：整个拖动期间比例尺不许变
  const max = memMax.value
  memBaseline.value = { max, span: Math.max(max, MEM_MIN + MEM_STEP) - MEM_MIN }
  memPreview.value = store.settings?.memoryMB ?? MEM_MIN
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}
function onMemPointerMove(e: PointerEvent) {
  if (!memDragging.value) return
  memPreview.value = memRawFromClientX(e.clientX)
}
function onMemPointerUp() {
  if (!memDragging.value) return
  memDragging.value = false
  // 松手一次性生效：按冻结基准取整（0.5GB 步进）+钳制 + 保存；随后清预览与快照
  const raw = memPreview.value ?? store.settings?.memoryMB ?? MEM_MIN
  const frozenMax = memBaseline.value?.max ?? memMax.value
  memPreview.value = null
  memBaseline.value = null
  const v = Math.max(MEM_MIN, Math.min(Math.round(raw / MEM_STEP) * MEM_STEP, frozenMax))
  if (store.settings) {
    store.settings.memoryMB = v
    void save({ memoryMB: v })
  }
  // 松手后允许以最新可用内存重算刻度并一次性校准（此时两值一致，不产生二次跳动）
  void refreshSystemInfo()
}

/** 数值输入（GB，支持 0.25 精度）；失焦/回车保存 */
const memoryInputGB = ref('')
const memoryEditing = ref(false)
function startMemoryEdit() {
  memoryInputGB.value = String(((store.settings?.memoryMB ?? MEM_MIN) / 1024).toFixed(2)).replace(/\.?0+$/, '')
  memoryEditing.value = true
}
function commitMemoryEdit() {
  const gb = Number(memoryInputGB.value)
  memoryEditing.value = false
  if (!Number.isFinite(gb) || gb <= 0) return
  const mb = Math.round(Math.max(MEM_MIN / 1024, Math.min(gb, memMax.value / 1024)) * 1024)
  if (store.settings) {
    store.settings.memoryMB = mb
    void save({ memoryMB: mb })
  }
}

/* 已填充段宽度百分比：拖动中跟随预览值（无级）+ 冻结比例基准，松手后跟随生效值 */
const memFillPct = computed(() => {
  const mb = memPreview.value ?? store.settings?.memoryMB ?? MEM_MIN
  return Math.max(0, Math.min(100, ((mb - MEM_MIN) / memScaleSpan.value) * 100))
})


// ---------------- 分辨率 ----------------
const resolutionError = ref('')

function saveResolution() {
  const s = store.settings
  if (!s) return
  const width = Number(s.resolution.width)
  const height = Number(s.resolution.height)
  if (!Number.isInteger(width) || width < 854 || width > 7680) {
    resolutionError.value = '窗口宽度必须是 854–7680 之间的整数'
    return
  }
  if (!Number.isInteger(height) || height < 480 || height > 4320) {
    resolutionError.value = '窗口高度必须是 480–4320 之间的整数'
    return
  }
  resolutionError.value = ''
  s.resolution.fullscreen = s.resolution.mode === 'fullscreen'
  void save({ resolution: { ...s.resolution } })
}

// ---------------- 插件系统 ----------------
const plugins = ref<PluginInfo[]>([])
const pluginBusy = ref(false)
/** 有插件变更（启停/安装/删除）后需重载生效 */
const pluginDirty = ref(false)
const pluginConfirmRemove = ref('')

onMounted(async () => {
  try {
    plugins.value = await listPlugins()
  } catch { /* 插件列表失败不阻塞设置页 */ }
})

async function onInstallPlugin() {
  if (pluginBusy.value) return
  pluginBusy.value = true
  try {
    const before = plugins.value.length
    plugins.value = await installPlugin()
    if (plugins.value.length > before) {
      pluginDirty.value = true
      toast('插件已安装，重载启动器后生效', 'success')
    }
  } catch (e) {
    toast('安装失败：' + errText(e), 'error')
  } finally {
    pluginBusy.value = false
  }
}

async function onTogglePlugin(p: PluginInfo, enabled: boolean) {
  try {
    plugins.value = await setPluginEnabled(p.id, enabled)
    pluginDirty.value = true
  } catch (e) {
    toast('操作失败：' + errText(e), 'error')
  }
}

async function onRemovePlugin(p: PluginInfo) {
  if (pluginConfirmRemove.value !== p.id) {
    pluginConfirmRemove.value = p.id
    setTimeout(() => { if (pluginConfirmRemove.value === p.id) pluginConfirmRemove.value = '' }, 3000)
    return
  }
  pluginConfirmRemove.value = ''
  try {
    plugins.value = await removePlugin(p.id)
    pluginDirty.value = true
    toast(`插件已移入回收站：${p.name}`, 'success')
  } catch (e) {
    toast('删除失败：' + errText(e), 'error')
  }
}
</script>

<template>
  <div data-ui="SettingsView:bf6b46a9d4d6" ref="page" class="page settings-page">
    <div data-ui="SettingsView:4348bca0a0cd" class="page-head">
      <h1 data-ui="SettingsView:23c5aeacd581" class="page-title">设置</h1>

    </div>

<div data-ui="SettingsView:821acd5b45d3" class="settings-navigation">
      <label data-ui="SettingsView:213f2c95d295" class="settings-search"><input data-ui="SettingsView:a49601b2b97e" v-model="settingsQuery" class="input" type="search" placeholder="搜索：内存、Java、动画、下载…" aria-label="搜索设置" @keydown.esc="settingsQuery = ''" /></label>
      <nav class="settings-scopes" aria-label="设置范围"><button v-for="item in settingsScopes" :key="item.id" class="btn btn-ghost" :aria-current="scope === item.id ? 'page' : undefined" @click="selectScope(item.id)">{{ item.label }}</button></nav>
      <nav data-ui="SettingsView:59cf14ccb4be" class="settings-categories" aria-label="设置分类"><button data-ui="SettingsView:68ab6a2985c0" v-for="item in visibleCategories" :key="item.id" class="btn btn-ghost" :aria-current="category === item.id ? 'page' : undefined" @click="selectCategory(item.id)">{{ item.label }}</button></nav>
      <div data-ui="SettingsView:9e789d8ad646" v-if="settingsQuery.trim()" class="settings-search-results" role="region" aria-label="设置搜索结果"><p data-ui="SettingsView:4c05037c5017" v-if="!searchMatches.length" class="muted">没有找到相关设置，试试“主题”“内存”或“下载”。</p><button data-ui="SettingsView:5bdb3d2f1359" v-for="item in searchMatches" :key="item.id" class="btn btn-ghost" @click="jumpSetting(item.id)"><strong data-ui="SettingsView:32a83676fd73">{{ item.name }}</strong><span class="muted">{{ settingsScopes.find(s => s.id === scopeOfCategory(item.category))?.label }} · {{ settingsCategories.find(c => c.id === item.category)?.label }} →</span></button></div>
    </div>
    <div class="settings-body" tabindex="0" aria-label="设置内容">
    <div data-ui="SettingsView:a82a0d33446b" v-if="!store.settings" class="card empty">
      <span class="spin"></span>
      <span>正在加载设置…</span>
    </div>

    <template v-else>
      <!-- 外观主题（PCL 式折叠卡片：标题行 + 箭头，展开内容统一内边距） -->
      <details data-ui="SettingsView:24e434dcfefc" v-show="category === 'appearance'" data-section="theme" class="card group collapse" open>
        <summary class="collapse-head">
          <h3 class="group-title">主题</h3>
          <span class="collapse-arrow" aria-hidden="true"></span>
        </summary>
        <div class="collapse-body">
          <div data-ui="SettingsView:98eed5eaae97" class="theme-options">
            <button data-ui="SettingsView:ae1494b5d771"
              v-for="theme in themeOptions"
              :key="theme.key"
              class="theme-option"
              :class="{ active: store.settings.theme === theme.key }"
              :title="theme.description"
              @click="chooseTheme(theme.key, theme.label)"
            >
              <span data-ui="SettingsView:ff8e35becbf3"
                class="theme-preview"
                :class="{ 'preview-custom': theme.key === 'custom', 'preview-transparent': theme.key === 'transparent' }"
                :style="{ background: theme.colors.bg }"
              >
                <span data-ui="SettingsView:202a66a2a038"
                  class="tp-side"
                  :style="{
                    background: theme.colors.sidebarBg,
                    borderRight: '1px solid ' + theme.colors.border
                  }"
                >
                  <span data-ui="SettingsView:f9ad546443d3" class="tp-dot" :style="{ background: theme.colors.accent }"></span>
                </span>
                <span data-ui="SettingsView:a397f44260a9" class="tp-main">
                  <span data-ui="SettingsView:e0b92057c385"
                    class="tp-top"
                    :style="{
                      background: theme.colors.card,
                      borderBottom: '1px solid ' + theme.colors.border
                    }"
                  ></span>
                  <span data-ui="SettingsView:b2cf2e01e30e" class="tp-body">
                    <span data-ui="SettingsView:d9c43308480c"
                      class="tp-block"
                      :style="{
                        background: theme.colors.card,
                        border: '1px solid ' + theme.colors.border
                      }"
                    ></span>
                    <span data-ui="SettingsView:fb0c4f0c22dd" class="tp-btn" :style="{ background: theme.colors.accent }"></span>
                  </span>
                </span>
                <span data-ui="SettingsView:bb37f5272e76" v-if="theme.key === 'custom'" class="tp-custom-grad"></span>
                <svg v-if="theme.key === 'custom'" class="tp-palette" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67A2.5 2.5 0 0 1 12 22Z" />
                  <circle cx="7.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
                  <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
                  <circle cx="16.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
                </svg>
                <svg v-if="store.settings.theme === theme.key" class="tp-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </span>
              <span data-ui="SettingsView:6e56a2fb3976" class="theme-label">{{ theme.label }}</span>
            </button>
          </div>

          <div class="theme-tools"><p class="muted group-hint">选择基础配色；个性化可继续调整布局、文字和透明度。</p>
          <button data-ui="SettingsView:16e9da51c37b"
            class="btn personalize-btn"
            @click="enterEditMode"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
              <path d="M1 14h6M9 8h6M17 16h6" />
            </svg>
            个性化
          </button></div>
        </div>
      </details>

      <!-- 功能管理 -->
      <details data-ui="SettingsView:12f88af0d6bb" v-show="category === 'features'" data-section="features" class="card group collapse" open>
        <summary class="collapse-head">
          <h3 class="group-title">功能管理</h3>
          <span class="collapse-arrow" aria-hidden="true"></span>
        </summary>
        <div class="collapse-body feature-grid">
          <p class="muted group-hint">
            关闭的功能将从侧边栏隐藏入口。核心功能（首页/游戏/设置）不可关闭。
          </p>
          <template v-for="f in featureToggles" :key="f.key"><h4 v-if="f.key==='mods' || f.key==='friends'" class="feature-section-title">{{f.key==='mods'?'资源管理':'其他功能'}}</h4><div data-ui="SettingsView:bd3c6919b18c" class="feature-row">
            <span data-ui="SettingsView:fa3cacde91cf" class="feature-name">{{ f.label }}</span>
            <span class="switch">
              <input data-ui="SettingsView:907bb2e68f36"
                type="checkbox"
                :checked="!store.settings.disabledFeatures.includes(f.key)"
                @change="onToggleFeature(f.key, ($event.target as HTMLInputElement).checked)"
              />
              <span class="switch-ui"></span>
            </span>
          </div></template>
        </div>
      </details>

      <!-- 个性化背景与启动卡图片；首页结构固定为图一布局。 -->
      <div data-ui="SettingsView:9816c9c5870a" class="background-settings" v-show="category === 'appearance'"><HomeLayoutEditor /></div>
    <div data-ui="SettingsView:0683ad7389b1" v-if="store.settings && category === 'appearance'" class="card group group-inline setting-target" data-section="motion" tabindex="-1"><div><h3 class="group-title">减少动态效果</h3><p data-ui="SettingsView:53f72432b671" class="muted">停止装饰动画与自动轮播，缩短过渡。系统开启减少动态效果时也会自动生效。</p></div><label class="switch"><input data-ui="SettingsView:35ef39b7e9bc" type="checkbox" aria-label="减少动态效果" :checked="store.settings.reduceMotion === true" @change="save({ reduceMotion: ($event.target as HTMLInputElement).checked })"/><span data-ui="SettingsView:4490d3e5d395" class="switch-ui"/></label></div>

      <!-- 下载 + 下载目标文件夹：同一行横向排布，窄窗口自动换行 -->
      <div data-ui="SettingsView:9df9d3d48082" v-show="category === 'downloads'" class="settings-grid">
        <!-- 游戏文件夹统一在版本页管理，设置页只显示当前状态，避免双入口冲突。 -->
        <details data-ui="SettingsView:d0490715189c" class="card group collapse setting-target" data-section="downloads" tabindex="-1" open>
          <summary class="collapse-head">
            <h3 class="group-title">下载</h3>
            <span class="collapse-arrow" aria-hidden="true"></span>
          </summary>
          <div class="collapse-body">
      <!-- 下载镜像（微软登录 Client ID 按隐私要求不在界面展示，登录固定使用内置默认应用） -->
      <div data-ui="SettingsView:95f82195a3e7" v-show="category === 'downloads'" data-section="mirror" class="download-mirror-group">
        <div class="download-mirror-options">
          <h3 class="group-title">下载镜像</h3>
          <div data-ui="SettingsView:7039ff11fe3c" class="mirror-options">
            <label data-ui="SettingsView:3dd4d470872e" class="mirror-option" :class="{ active: store.settings.mirror === 'official' }">
              <input data-ui="SettingsView:2f522f16f088" v-model="store.settings.mirror" type="radio" value="official" @change="save({ mirror: 'official' })" />
              <span>官方源</span>
            </label>
            <label data-ui="SettingsView:4948cbbe2972" class="mirror-option" :class="{ active: store.settings.mirror === 'bmclapi' }">
              <input data-ui="SettingsView:6cf3093424b7" v-model="store.settings.mirror" type="radio" value="bmclapi" @change="save({ mirror: 'bmclapi' })" />
              <span>BMCLAPI 镜像（国内更快）</span>
            </label>
          </div>
        </div>
      </div>

            <label class="download-setting">最大线程数
              <input data-ui="SettingsView:0975603bb2e6" class="input" type="number" min="1" max="64" :value="store.settings.downloadThreads" @change="save({ downloadThreads: Number(($event.target as HTMLInputElement).value) })" />
            </label>
            <label class="download-setting">速度限制（KiB/s）
              <input data-ui="SettingsView:f6bb60f3451f" class="input" type="number" min="0" max="1048576" :value="store.settings.downloadSpeedKBps" @change="save({ downloadSpeedKBps: Number(($event.target as HTMLInputElement).value) })" />
            </label>
            <p class="muted group-hint">0 表示不限速。限制对全部下载任务合计生效；减少线程数后，已有连接完成时释放名额。</p>
            <details data-ui="SettingsView:d03dfc867050" class="advanced-setting"><summary data-ui="SettingsView:98629fe42230">高级 · CurseForge API Key</summary><label data-ui="SettingsView:5d8857a9ab59" class="download-setting download-setting-col">
              <span>CurseForge API Key<small data-ui="SettingsView:a100ae255935" class="muted">（选填，官方 api.curseforge.com 通道）</small></span>
              <input data-ui="SettingsView:bb44d7c926e9"
                class="input mono"
                type="password"
                :value="store.settings.curseforgeApiKey ?? ''"
                placeholder="留空走镜像通道"
                @change="save({ curseforgeApiKey: ($event.target as HTMLInputElement).value.trim() })"
              />
            </label>
            <p class="muted group-hint">CurseForge 官方 API 需要免费注册申请：<a data-ui="SettingsView:b8eb49f2eba5" class="upd-link" href="https://console.curseforge.com/" target="_blank" rel="noreferrer">console.curseforge.com</a>（注册 → 创建应用 → 复制 API Key 粘贴到上方）。填入后社区资源的 CurseForge 搜索与下载走官方通道，不受镜像波动影响。</p></details>
          </div>
        </details>
      </div>
        <div v-show="category === 'directories'" data-section="installation" class="card group directory-setting">
          <h3 class="group-title">新版本安装目录</h3>
          <p class="muted group-hint">
            新版本将安装到此目录；在游戏版本页管理绑定目录。
          </p>
          <div data-ui="SettingsView:df97f9cf717f" class="dir-row">
            <input data-ui="SettingsView:d4e967de8849" class="input mono" :value="store.settings.activeFolder" readonly title="当前游戏文件夹" />
            <button data-ui="SettingsView:849a63a7ca8c" class="btn btn-ghost dir-btn" @click="store.currentView = 'game'">
              前往管理
            </button>
          </div>
        </div>

      <!-- 默认版本隔离 -->
      <div data-ui="SettingsView:72c1d8b58f43" v-show="category === 'directories'" data-section="isolation" class="card group group-inline">
        <div>
          <h3 class="group-title">新版本默认开启版本隔离（推荐）</h3>
          <p class="muted group-hint">
            仅影响新安装的版本。开启后独立保存存档、模组与配置；已有实例在游戏版本页调整。
          </p>
        </div>
        <label class="switch">
          <input data-ui="SettingsView:7af59c7c71ed"
            type="checkbox"
            :checked="store.settings.defaultIsolation"
            @change="save({ defaultIsolation: ($event.target as HTMLInputElement).checked })"
          />
          <span class="switch-ui"></span>
        </label>
      </div>

      <div v-show="category === 'game'" class="runtime-grid">
      <!-- 内存 -->
      <details data-ui="SettingsView:af57e3969b2b" class="card group collapse setting-target" data-section="memory" tabindex="-1" open>
        <summary class="collapse-head">
          <h3 class="group-title">内存分配</h3>
          <span class="collapse-arrow" aria-hidden="true"></span>
        </summary>
        <div class="collapse-body">
          <div data-ui="SettingsView:c72d10bfcf7d" class="memory-auto-row">
            <span class="java-auto-text">
              <span class="java-auto-title">自动分配（推荐）</span>
              <span class="muted java-auto-desc">按物理内存 1/4 自动分配（本机当前 {{ autoMemoryText }}，2-8GB 区间），启动时实时生效；开启后禁用手动调节。</span>
            </span>
            <label class="switch">
              <input data-ui="SettingsView:acfa8cbaf083"
                :checked="memoryAuto"
                type="checkbox"
                @change="onMemoryAutoChange(($event.target as HTMLInputElement).checked)"
              />
              <span class="switch-ui"></span>
            </label>
          </div>
          <template v-if="!memoryAuto">
            <div data-ui="SettingsView:cbb53c3f809e" class="memory-row">
              <!-- 自定义滑块：只有按住拇指才拖得动（点轨道不跳值，不抢鼠标）；0.5GB 步进 -->
              <div data-ui="SettingsView:2a2d1473539f" ref="memTrack" class="mem-slider" @pointermove="onMemPointerMove" @pointerup="onMemPointerUp" @pointercancel="onMemPointerUp">
                <div data-ui="SettingsView:e74d81b4804a" class="mem-slider-track"></div>
                <div data-ui="SettingsView:91a09abfe5b0" class="mem-slider-fill" :style="{ width: memFillPct + '%' }"></div>
                <div data-ui="SettingsView:9f6291a873d4"
                  class="mem-slider-thumb"
                  :class="{ dragging: memDragging }"
                  :style="{ left: memFillPct + '%' }"
                  @pointerdown="onMemThumbDown"
                  @pointermove="onMemPointerMove"
                  @pointerup="onMemPointerUp"
                  @pointercancel="onMemPointerUp"
                ></div>
              </div>
              <input data-ui="SettingsView:ff586c53928a"
                v-if="memoryEditing"
                v-model="memoryInputGB"
                class="input memory-input"
                type="number"
                :min="MEM_MIN / 1024"
                :max="memMax / 1024"
                step="0.25"
                @keydown.enter="commitMemoryEdit"
                @keydown.esc="memoryEditing = false"
                @blur="commitMemoryEdit"
                v-focus
              />
              <span data-ui="SettingsView:5c63bc2aa86a" v-else class="memory-value" title="点击精确输入（GB）" @click="startMemoryEdit">{{ memoryText }}</span>
            </div>
            <p class="muted group-hint">拖动滑块以 0.5 GB 步进（上限随当前可用内存浮动，预留 1G 给系统）；需要精细调节（如 0.25 GB）时点右侧数值直接输入</p>
            <p data-ui="SettingsView:9377cfb85e03" v-if="memoryOverFree" class="memory-warn">
              当前分配超过可用内存，游戏可能启动失败或卡死系统；请调低或改回「自动分配」
            </p>
          </template>
          <p data-ui="SettingsView:8cff89231775" class="muted memory-info">
            {{ memoryInfoText }}
            <button data-ui="SettingsView:87a00792aa4a" class="memory-refresh" type="button" @click="refreshSystemInfo">刷新</button>
          </p>
          <MemoryOrganizer @refresh="refreshSystemInfo" />
        </div>
      </details>

      <!-- Java -->
      <details data-ui="SettingsView:b128c0a66c1b" class="card group collapse setting-target" data-section="java" tabindex="-1" open>
        <summary class="collapse-head">
          <h3 class="group-title">Java 运行时</h3>
          <span class="collapse-arrow" aria-hidden="true"></span>
        </summary>
        <div class="collapse-body">
          <label data-ui="SettingsView:2937d97802dc" class="java-auto-row">
            <span class="java-auto-text">
              <span class="java-auto-title">自动检测并下载所需 Java（推荐）</span>
              <span class="muted java-auto-desc">
                启动时按游戏版本自动选择匹配的 Java；本机没有时自动下载安装。关闭后使用下方手动选择的 Java。
              </span>
            </span>
            <span class="switch">
              <input data-ui="SettingsView:84de310dd205"
                type="checkbox"
                :checked="store.settings.javaAuto"
                @change="save({ javaAuto: ($event.target as HTMLInputElement).checked })"
              />
              <span class="switch-ui"></span>
            </span>
          </label>
          <div data-ui="SettingsView:033fa130c6ea" v-if="javaLoading" class="java-loading">
            <span class="spin"></span>
            <span class="muted">正在检测本机 Java…</span>
          </div>
          <template v-else>
            <select data-ui="SettingsView:47dcfd6bb554"
              v-model="store.settings.javaPath"
              class="select"
              :disabled="store.settings.javaAuto"
              @change="save({ javaPath: store.settings!.javaPath })"
            >
              <option value="">自动选择（推荐）</option>
              <option v-for="j in javas" :key="j.path" :value="j.path">{{ javaLabel(j) }}</option>
            </select>
            <p data-ui="SettingsView:a4338b6dbdab" v-if="javaError" class="group-error">Java 检测失败：{{ javaError }}</p>
            <p data-ui="SettingsView:b8220f037cc7" v-else-if="!javas.length" class="muted group-hint">
              未检测到本机 Java，将使用「自动选择」或在启动时自动下载。
            </p>

            <details class="java-detected"><summary>本机 Java 与手动管理（{{ javas.length }}）</summary>
            <div data-ui="SettingsView:205e9439c186" class="java-scan-row">
              <div data-ui="SettingsView:b5bbe482ca7a" class="java-scan-status">
                <span class="muted">扫描注册表、PATH、启动器 Runtime 与全部本地固定磁盘</span>
                <span data-ui="SettingsView:95cdba118743" v-if="javaRefreshing" class="muted java-scan-text" :title="javaScanText">
                  {{ javaScanText }}
                </span>
                <div data-ui="SettingsView:8b0c0b54c54f" v-if="javaRefreshing" class="java-scan-track" aria-label="Java 扫描进度">
                  <span data-ui="SettingsView:ac6550af67ec" :style="{ width: `${javaScanProgress * 100}%` }"></span>
                </div>
              </div>
              <button data-ui="SettingsView:9df6cab1a2e9"
                class="btn btn-ghost btn-sm"
                :disabled="javaCancelling"
                @click="onRefreshJava()"
              >
                {{ javaCancelling ? '正在取消…' : javaRefreshing ? '取消扫描' : '重新扫描' }}
              </button>
            </div>

            <!-- 已识别的 Java 列表（版本/位数/来源，支持移除） -->
            <div data-ui="SettingsView:6dc6e26726aa" v-if="javas.length" class="java-list">
              <div data-ui="SettingsView:6bd22de0fe44" class="java-list-head">
                <span class="muted">已识别 {{ javas.length }} 个 Java</span>
              </div>
              <div data-ui="SettingsView:6cc4e456c280" v-for="j in javas" :key="j.path" class="java-item">
                <span data-ui="SettingsView:b1a116a1a7bb" class="tag" :class="j.source === 'manual' ? 'tag-accent' : ''">
                  {{ j.source === 'manual' ? '手动' : '自动' }}
                </span>
                <span data-ui="SettingsView:5131692582d3" class="java-item-ver">Java {{ j.major }}</span>
                <span data-ui="SettingsView:7972354cc877"
                  class="muted java-item-path"
                  :title="`${j.vendor ?? '未知发行版'} · ${j.architecture ?? (j.is64Bit ? '64 位' : '32 位')} · ${j.sourceDetail ?? ''}\n${j.path}`"
                >
                  {{ j.vendor ?? 'Java' }} · {{ j.architecture ?? (j.is64Bit ? '64 位' : '32 位') }} · {{ j.path }}
                </span>
                <button data-ui="SettingsView:0360c51d1055" class="java-item-hide" title="从列表隐藏" @click="onHideJava(j.path)">×</button>
              </div>
            </div>

            <!-- 手动添加 Java：点「添加」弹文件选择器定位 java.exe（自动校验版本/位数）；也可粘贴完整路径后回车 -->
            <div data-ui="SettingsView:47c462c48d2f" class="java-add-row">
              <input data-ui="SettingsView:03420f9eb5b5"
                v-model="javaCustomInput"
                class="input mono"
                placeholder="粘贴 java 可执行文件完整路径回车添加，或留空点「添加」选择文件…"
                spellcheck="false"
                @keyup.enter="onAddJava"
              />
              <button data-ui="SettingsView:85975bff1446" class="btn btn-ghost" :disabled="javaAdding" @click="onAddJava">
                {{ javaAdding ? '校验中…' : '添加' }}
              </button>
            </div>
            <p data-ui="SettingsView:e6688869ed97" v-if="javaAddError" class="group-error">{{ javaAddError }}</p>
            </details>
          </template>
        </div>
      </details>

        <details data-ui="SettingsView:612d9b820913" class="card group" data-section="jvm"><summary data-ui="SettingsView:3cc49dcec409" class="group-title">高级 · JVM 参数</summary>
          <input data-ui="SettingsView:cce61f7d8c4e"
            v-model="store.settings.jvmArgs"
            class="input mono"
            placeholder="例如：-XX:+UseG1GC -XX:+ParallelRefProcEnabled"
            @change="save({ jvmArgs: store.settings!.jvmArgs })"
          />
          <p class="muted group-hint">高级选项，留空则使用默认参数</p>
        </details>
      </div>

      <!-- 分辨率 + JVM 参数：同一行横向排布 -->
      <div data-ui="SettingsView:a1da38f817b5" v-show="category === 'display'" class="settings-grid">
        <div data-ui="SettingsView:5265f547a736" class="card group" data-section="resolution">
          <h3 class="group-title">游戏窗口分辨率</h3>
          <div data-ui="SettingsView:7e472ba8461b" class="resolution-row">
            <div class="res-field">
              <span class="muted res-label">宽</span>
              <input data-ui="SettingsView:a5f1bf93348f"
                v-model.number="store.settings.resolution.width"
                type="number"
                class="input"
                min="854"
                max="7680"
                :disabled="store.settings.resolution.mode !== 'windowed'"
                @change="saveResolution"
              />
            </div>
            <span data-ui="SettingsView:bc7a0e5ae260" class="muted res-x">×</span>
            <div class="res-field">
              <span class="muted res-label">高</span>
              <input data-ui="SettingsView:c9736d13ba36"
                v-model.number="store.settings.resolution.height"
                type="number"
                class="input"
                min="480"
                max="4320"
                :disabled="store.settings.resolution.mode !== 'windowed'"
                @change="saveResolution"
              />
            </div>
          </div>
          <div data-ui="SettingsView:f3d214648a71" class="resolution-mode">
            <span class="muted res-label">模式</span>
            <select data-ui="SettingsView:6e8bb36bb0de" v-model="store.settings.resolution.mode" class="select" @change="saveResolution">
              <option value="windowed">窗口化</option>
              <option value="maximized">最大化</option>
              <option value="fullscreen">全屏</option>
            </select>
          </div>
          <p data-ui="SettingsView:2f107fd117d3" v-if="resolutionError" class="group-error">{{ resolutionError }}</p>
          <p v-else class="muted group-hint">
            窗口化使用以上宽高；最大化使用启动时所在显示器的工作区；全屏不会修改显示器分辨率。
          </p>
        </div>

      </div>

      <!-- 正版代理 + 启动后关闭：同一行横向排布 -->
      <div data-ui="SettingsView:35d4b384db5b" v-show="category === 'general'" data-section="launch" class="settings-grid">


        <div class="card group group-inline">
          <div>
            <h3 class="group-title">启动后关闭启动器</h3>
            <p class="muted group-hint">游戏成功启动后自动退出 KAMUCL</p>
          </div>
          <label class="switch">
            <input data-ui="SettingsView:f2f1ffcd2e84"
              v-model="store.settings.closeAfterLaunch"
              type="checkbox"
              @change="save({ closeAfterLaunch: store.settings!.closeAfterLaunch })"
            />
            <span class="switch-ui"></span>
          </label>
        </div>
        <div class="card group group-inline">
          <div>
            <h3 class="group-title">正版登录使用系统代理</h3>
            <p class="muted group-hint">微软登录失败而浏览器正常时可开启。默认直连；开启后仍保留 TLS 证书校验。</p>
          </div>
          <label class="switch">
            <input data-ui="SettingsView:41ae714db129"
              :checked="store.settings.msUseProxy === true"
              type="checkbox"
              @change="save({ msUseProxy: ($event.target as HTMLInputElement).checked })"
            />
            <span class="switch-ui"></span>
          </label>
        </div>
      </div>

      <!-- 关于与更新 -->
      <details data-ui="SettingsView:7f23eec9c558" v-show="category === 'about'" class="card group collapse" open data-section="update">
        <summary class="collapse-head">
          <h3 class="group-title">关于与更新</h3>
          <span class="collapse-arrow" aria-hidden="true"></span>
        </summary>
        <div class="collapse-body">
          <div class="upd-row">
            <span class="upd-label">当前版本</span>
            <span data-ui="SettingsView:7f2b62d69ce5" class="upd-value">v{{ appVersion }}</span>
            <button data-ui="SettingsView:e3f1fccf0c78" class="btn btn-ghost btn-sm" @click="showLicenses = true">第三方许可</button>
            <ThirdPartyNotices v-if="showLicenses" @dismiss="showLicenses = false" />
            <button data-ui="SettingsView:2d10e8cc0926" class="btn btn-ghost btn-sm" :disabled="updateCheckState === 'checking'" @click="onCheckUpdate">
              <span data-ui="SettingsView:bb9654fb7775" v-if="updateCheckState === 'checking'" class="spin"></span>
              {{ updateCheckState === 'checking' ? '检查中' : '检查更新' }}
            </button>
            <span data-ui="SettingsView:cd41281572d3" v-if="updateCheckState === 'latest'" class="upd-latest">已是最新 ✓</span>
          </div>
          <!-- 检查失败：明确是连不上 GitHub 更新源，并提供重试入口（不再误报「无更新」） -->
          <div data-ui="SettingsView:203842d2f6d4" v-if="updateCheckState === 'failed'" class="upd-row upd-failed-row">
            <span data-ui="SettingsView:5ae61f0d3e62" class="upd-failed-text">你的网络可能无法连接 GitHub，检查更新失败</span>
            <button data-ui="SettingsView:c30ef48b6984" class="btn btn-ghost btn-sm" @click="onCheckUpdate">重试</button>
          </div>
          <div class="upd-row">
            <span class="upd-label">自动安装更新</span>
            <label class="switch">
              <input data-ui="SettingsView:bc540ac861a7"
                :checked="store.settings.autoUpdate !== false"
                type="checkbox"
                @change="save({ autoUpdate: ($event.target as HTMLInputElement).checked })"
              />
              <span class="switch-ui"></span>
            </label>
            <span data-ui="SettingsView:94871aad1da8" class="muted upd-auto-hint">发现新版本静默下载，下次启动时应用；关闭则弹窗询问</span>
          </div>
          <div data-ui="SettingsView:1c8ad9d5ad0b" v-if="pendingUpdate" class="upd-row upd-pending-row">
            <span data-ui="SettingsView:0447f8159ad6" class="upd-pending-text">v{{ pendingUpdate.release.version }} 已就绪，下次启动时应用</span>
            <button data-ui="SettingsView:5bd17b41383a" class="btn btn-gold btn-sm" @click="onApplyPending">下次启动应用</button>
          </div>
          <div class="upd-row">
            <span class="upd-label">更新下载源</span>
            <select data-ui="SettingsView:c67695800552" class="select upd-source" :value="updateSource" @change="onUpdateSourceChange">
              <option value="auto">自动（直连优先，镜像加速）</option>
              <option value="direct">仅 GitHub 直连</option>
              <option value="mirror">仅自定义镜像</option>
            </select>
          </div>
          <div data-ui="SettingsView:c63358a8e469" v-if="updateSource !== 'direct'" class="upd-row">
            <span class="upd-label">自定义镜像</span>
            <input data-ui="SettingsView:573dec07c5b6"
              class="input mono upd-mirror"
              :value="store.settings.updateMirrorUrl ?? ''"
              placeholder="https://ghproxy.net/（留空用默认）"
              @change="onUpdateMirrorChange"
            />
          </div>
          <details class="update-maintenance"><summary>维护与恢复</summary>
          <div data-ui="SettingsView:bb7974b118ee" class="upd-row upd-actions-row">
            <button data-ui="SettingsView:3752063389f8" class="btn btn-ghost btn-sm" @click="openRollback">版本回退…</button>
            <button data-ui="SettingsView:a671c86452da" v-if="updateState" class="btn btn-ghost btn-sm" :disabled="restoringBackup" @click="onRestoreBackup">
              还原到更新前的版本（v{{ updateState.backupVersion }}）
            </button>
            <button data-ui="SettingsView:c7a44c22390c" class="btn btn-ghost btn-sm" @click="onPickLocalUpdate">从本地文件安装更新…</button>
          </div>
          </details>
          <p class="muted group-hint">
            更新包发布在 GitHub Releases；下载较慢时可到 KAMUCL 内测群（{{ store.settings.qqGroupNumber?.trim() || QQ_GROUP_NUMBER }}）获取，群内文件与 GitHub 版本一致。
          </p>
        </div>
      </details>

      <!-- 插件系统 -->
      <details data-ui="SettingsView:034daafb11ff" v-show="category === 'features'" data-section="plugins" class="card group collapse" open>
        <summary class="collapse-head">
          <h3 class="group-title">插件</h3>
          <span class="collapse-arrow" aria-hidden="true"></span>
        </summary>
        <div class="collapse-body">
          <p class="muted group-hint">
            JS 插件可更改界面、新增功能（启动器版 Mod）。插件拥有界面完全控制权，请只安装可信来源。
          </p>
          <div data-ui="SettingsView:3610ad90128d" v-if="plugins.length" class="plugin-list">
            <div data-ui="SettingsView:f0df70c46e6e" v-for="p in plugins" :key="p.id" class="plugin-row">
              <div data-ui="SettingsView:f0ef3e1815ac" class="plugin-info">
                <span data-ui="SettingsView:2654f6c0658e" class="plugin-name">
                  {{ p.name }}
                  <span data-ui="SettingsView:ed121d4fcf9e" v-if="p.version" class="muted">v{{ p.version }}</span>
                </span>
                <span data-ui="SettingsView:2651a76d5a4b" class="muted plugin-meta">{{ [p.author, p.description].filter(Boolean).join(' · ') || p.id }}</span>
              </div>
              <button data-ui="SettingsView:4b6726b9ed78"
                class="btn btn-sm"
                :class="pluginConfirmRemove === p.id ? 'btn-danger' : 'btn-ghost'"
                @click="onRemovePlugin(p)"
              >{{ pluginConfirmRemove === p.id ? '移入回收站' : '删除' }}</button>
              <label data-ui="SettingsView:1df38fea5b7b" class="switch" :title="p.enabled ? '停用插件' : '启用插件'">
                <input data-ui="SettingsView:e7c877c0882e" type="checkbox" :checked="p.enabled" @change="onTogglePlugin(p, ($event.target as HTMLInputElement).checked)" />
                <span class="switch-ui"></span>
              </label>
            </div>
          </div>
          <p v-else class="muted group-hint">还没有安装插件</p>
          <div data-ui="SettingsView:70c23a4a8b21" class="plugin-actions">
            <button data-ui="SettingsView:2efffb3d4610" class="btn btn-ghost btn-sm" :disabled="pluginBusy" @click="onInstallPlugin">
              <span data-ui="SettingsView:f506d1f658b6" v-if="pluginBusy" class="spin"></span>
              安装插件（.js）
            </button>
            <button data-ui="SettingsView:5032f71dc65d" class="btn btn-ghost btn-sm" @click="openPluginsDir">打开插件目录</button>
            <button data-ui="SettingsView:ede794e781ff" v-if="pluginDirty" class="btn btn-gold btn-sm" @click="($event.target as HTMLButtonElement).blur(); location.reload()">重载启动器生效</button>
          </div>
        </div>
      </details>
    </template>

    </div>
    <!-- 版本回退：历史版本列表 -->
    <UpdateDialogShell v-if="rollback.open" label="版本回退" @dismiss="rollback.open = false">
      <template #header>
        <div class="upd-modal-head">
          <h3 class="upd-modal-title">版本回退</h3>
          <button data-ui="SettingsView:606774134bae" class="icon-btn" title="关闭" @click="rollback.open = false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <p data-ui="SettingsView:f683c36eb3d1" class="upd-modal-subtitle muted">当前 v{{ appVersion }} · 选择要恢复的历史版本</p>
      </template>
        <p data-ui="SettingsView:e60d0b9f406f" class="upd-risk">⚠ 旧版本可能不兼容新配置格式。回退前将自动备份当前版本，可随时还原。</p>
        <div data-ui="SettingsView:057bbe26b76d" v-if="rollback.loading" class="empty"><span class="spin"></span></div>
        <div data-ui="SettingsView:5fc7aa4d0d0b" v-else class="upd-release-list">
          <label data-ui="SettingsView:75b890b63a58" v-for="r in rollback.list" :key="r.version" class="upd-release-item" :class="{ selected: rollback.selected === r.version }">
            <input data-ui="SettingsView:839c64939132" v-model="rollback.selected" type="radio" name="rollback-version" :value="r.version" />
            <span data-ui="SettingsView:147be114439d" class="upd-release-main">
              <span data-ui="SettingsView:472e50c1be99" class="upd-release-ver">v{{ r.version }}</span>
              <span data-ui="SettingsView:f2396c2f4962" class="muted upd-release-date">{{ releaseDate(r.publishedAt) }}</span>
              <span data-ui="SettingsView:b10e6198b84f" v-if="releaseSummary(r.body)" class="muted upd-release-summary">{{ releaseSummary(r.body) }}</span>
            </span>
          </label>
          <div data-ui="SettingsView:b683a5ef98a2" v-if="!rollback.list.length" class="empty"><span>没有可回退的历史版本</span></div>
        </div>
      <template #footer><div class="upd-modal-actions">
          <button data-ui="SettingsView:64d5b7c61143" class="btn btn-ghost" @click="rollback.open = false">取消</button>
          <button data-ui="SettingsView:8a817c12df3a" class="btn btn-gold" :disabled="!rollback.selected" @click="confirmRollback">回退到选中版本</button>
        </div></template>
    </UpdateDialogShell>

    <!-- 本地文件安装更新确认 -->
    <UpdateDialogShell v-if="localUpdate?.confirming" label="安装本地更新包" @dismiss="localUpdate = null">
      <template #header>
        <div class="upd-modal-head">
          <h3 class="upd-modal-title">安装本地更新包</h3>
          <button data-ui="SettingsView:7162c61cf755" class="icon-btn" title="关闭" @click="localUpdate = null">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </template>
        <p data-ui="SettingsView:d8da86ab7cbc" class="upd-local-file">{{ localUpdate.check.fileName }} · {{ (localUpdate.check.fileSize / 1048576).toFixed(1) }} MB</p>
        <div class="upd-local-check">
          <span>版本校验</span>
          <span data-ui="SettingsView:152ca71f54e0" v-if="localUpdate.check.versionOk" class="upd-ok">v{{ localUpdate.check.version }} ≥ 当前 v{{ appVersion }} ✓</span>
          <span v-else class="upd-warn">⚠ {{ localUpdate.check.version ? `v${localUpdate.check.version} 低于当前 v${appVersion}` : '无法从文件名识别版本号' }}，继续需自担风险</span>
        </div>
        <div class="upd-local-check">
          <span>完整性校验</span>
          <span data-ui="SettingsView:9df9b415ad42" v-if="localUpdate.check.sha256 === 'match'" class="upd-ok">SHA256 与 GitHub Release 一致 ✓</span>
          <span data-ui="SettingsView:5b6de8db67a7" v-else-if="localUpdate.check.sha256 === 'mismatch'" class="upd-warn">⚠ SHA256 不一致！文件可能被篡改（{{ localUpdate.check.detail }}）</span>
          <span v-else class="upd-warn">⚠ 无法联网校验，请确认文件来自官方渠道，风险自担</span>
        </div>
      <template #footer><div class="upd-modal-actions">
          <button data-ui="SettingsView:3ccc5837a1e1" class="btn btn-ghost" @click="localUpdate = null">取消</button>
          <button data-ui="SettingsView:1b671fb6ec3e"
            class="btn"
            :class="localUpdate.check.versionOk && localUpdate.check.sha256 === 'match' ? 'btn-gold' : 'btn-danger'"
            @click="confirmLocalUpdate"
          >确认安装</button>
        </div></template>
    </UpdateDialogShell>

  </div>
</template>

<style scoped>
.settings-navigation { position:sticky; top:0; z-index:15; padding:12px; margin-bottom:16px; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--surface-solid); }
.settings-search { display:flex; align-items:center; gap:12px; }
.settings-search > span { white-space:nowrap; font-weight:600; }
.settings-search input { flex:1; min-width:0; }
.settings-categories { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.settings-categories [aria-current] { background:var(--accent-soft); color:var(--accent); border-color:transparent; }
.settings-search-results { display:grid; max-height:40vh; overflow:auto; gap:8px; padding-top:12px; }
.settings-search-results button { justify-content:space-between; white-space:normal; text-align:left; }
.settings-page [data-section] { scroll-margin-top:150px; }
.settings-page [data-section]:focus { outline:2px solid var(--accent); outline-offset:3px; }
.settings-page .group { margin-bottom:0; }
@media(max-width:800px) { .settings-navigation { position:relative; } .settings-search { align-items:stretch; flex-direction:column; } .settings-page [data-section] { scroll-margin-top:16px; } }

/* 关于与更新 */
.upd-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) 0; flex-wrap: wrap; }
.upd-label { width: 84px; flex-shrink: 0; font-size: var(--text-sm); color: var(--text-dim); }
.upd-value { font-weight: 650; }
.upd-latest { color: var(--accent-2); font-size: var(--text-sm); }
.upd-source { min-width: 220px; }
.upd-mirror { flex: 1; min-width: 240px; font-size: var(--text-xs); }
.upd-actions-row { gap: var(--space-2); margin-top: var(--space-1); }
.upd-auto-hint { font-size: var(--text-xs); }
.upd-pending-row {
  padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
}
.upd-pending-text { font-size: var(--text-sm); font-weight: 600; }
.upd-failed-row {
  padding: var(--space-2) var(--space-3); border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--danger) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 26%, transparent);
}
.upd-failed-text { font-size: var(--text-xs); color: var(--danger); }
/* 回退/本地安装弹窗 */
.upd-modal-subtitle { margin:10px 0 0; font-size:12px; }
.upd-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
.upd-modal-title { margin: 0; font-size:22px; line-height:1.4; }
.upd-risk {
  margin: 0 0 18px; padding: 12px 14px; border-radius: var(--radius-md); font-size: var(--text-xs); font-weight: 500;
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 26%, transparent);
  color: var(--danger);
}
.upd-release-list { display:flex; flex-direction:column; gap:10px; }
.upd-release-item {
  display: flex; gap:14px; align-items:flex-start; padding:16px; cursor:pointer;
  border: 1px solid var(--border); border-radius: var(--radius-md); transition: border-color 0.15s ease, background 0.15s ease;
}
.upd-release-item:hover { border-color: var(--accent-deep); }
.upd-release-item.selected { border-color: var(--accent); background: var(--accent-soft); }
.upd-release-item input { margin-top:5px; accent-color:var(--accent); flex-shrink:0; }
.upd-release-main { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); min-width: 0; }
.upd-release-ver { font-weight: 650; }
.upd-release-date { font-size: var(--text-xs); }
.upd-release-summary { font-size: var(--text-xs); flex-basis: 100%; }
.upd-modal-actions { display:flex; justify-content:flex-end; gap:var(--space-3); flex-wrap:wrap; }
.upd-local-file { margin: 0; font-weight: 600; font-size: var(--text-sm); word-break: break-all; }
.upd-local-check { display:flex; gap:var(--space-3); font-size:var(--text-sm); align-items:baseline; margin-top:16px; }
.upd-local-check > span:first-child { width: 72px; flex-shrink: 0; color: var(--text-dim); }
.upd-ok { color: var(--accent-2); }
.upd-warn { color: var(--danger); }
.plugin-list { display: flex; flex-direction: column; gap: var(--space-2); }
.plugin-row { display: flex; align-items: center; gap: var(--space-3); min-height: var(--row-h); padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); }
.plugin-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.plugin-name { font-weight: 600; }
.plugin-meta { font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plugin-actions { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.download-setting { display: flex; align-items: center; justify-content: space-between; gap: var(--space-5); }
.download-setting .input { width: 160px; }
.download-setting-col { flex-direction: column; align-items: stretch; gap: var(--space-2); margin-top: var(--space-3); }
.download-setting-col .input { width: 100%; }
.download-setting-col small { font-weight: 400; }
.upd-link { color: var(--accent-2); }
.setting-target { scroll-margin-top: var(--space-5); }
.setting-target:focus { outline: 2px solid var(--accent); outline-offset: var(--space-1); }
.page {
  display: flex;
  flex-direction: column;
  gap: var(--sec-gap);
  max-width: 760px;
  margin: 0 auto;
}

/* 小卡片两两成行（顺序横向向下），窄窗口自动换行堆叠 */
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--card-gap);
  align-items: stretch;
}
.settings-grid > .card {
  min-width: 0;
}

.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--card-pad);
}
.group-title {
  font-size: var(--text-sm);
  font-weight: 700;
  margin: 0;
  line-height: 1.5;
}
.group-hint {
  font-size: var(--text-xs);
  margin: 0;
  line-height: 1.6;
}
.group-error {
  font-size: var(--text-xs);
  margin: 0;
  color: var(--danger);
}
.group-inline {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

/* PCL 式折叠卡片：折叠态 = 标题行（行高）+ 右侧箭头；展开态内容统一内边距 */
.collapse {
  padding: 0;
}
.collapse-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: var(--row-h);
  padding: var(--space-2) var(--card-pad);
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.collapse-head::-webkit-details-marker {
  display: none;
}
.collapse-head:hover .group-title {
  color: var(--accent-2);
}
.collapse-arrow {
  width: 7px;
  height: 7px;
  border-right: 2px solid var(--text-dim);
  border-bottom: 2px solid var(--text-dim);
  /* 折叠态：箭头朝上（PCL 折叠卡片右上箭头） */
  transform: rotate(-45deg);
  transition: transform 0.18s ease;
  flex-shrink: 0;
}
.collapse[open] > .collapse-head .collapse-arrow {
  /* 展开态：箭头朝下 */
  transform: rotate(45deg);
}
.collapse-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3) var(--card-pad) var(--card-pad);
  border-top: 1px solid var(--border);
}

/* 功能开关行 */
.feature-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 40px;
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--border);
}
.feature-row:last-child {
  border-bottom: none;
}
.feature-name {
  font-size: var(--text-sm);
}

/* Java 列表 */
.java-list {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.java-scan-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-2);
}
.java-scan-status {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-xs);
}
.java-scan-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.java-scan-track {
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--border);
}
.java-scan-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.15s ease;
}
.java-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  background: var(--card-2);
  font-size: var(--text-xs);
}
.java-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--row-h);
  padding: var(--space-1) var(--space-3);
  border-top: 1px solid var(--border);
  font-size: var(--text-sm);
}
.java-item-ver {
  font-weight: 600;
  flex-shrink: 0;
}
.java-item-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, Consolas, monospace;
  font-size: var(--text-xs);
}
.java-item-hide {
  border: none;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  font-size: var(--text-md);
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
}
.java-item-hide:hover {
  color: var(--danger);
  background: var(--danger-soft);
}
.java-add-row {
  display: flex;
  gap: var(--space-2);
}
.java-auto-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-2);
  cursor: pointer;
}
.java-auto-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}
.java-auto-title {
  font-size: var(--text-sm);
  font-weight: 600;
}
.java-auto-desc {
  font-size: var(--text-xs);
  line-height: 1.6;
}
.select:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* 主题选择 */
.theme-options {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-3);
}
.theme-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: 0;
  border: none;
  background: transparent;
  font-family: inherit;
  cursor: pointer;
}
.theme-preview {
  position: relative;
  display: flex;
  width: 150px;
  height: 84px;
  border-radius: var(--radius-md);
  border: 1.5px solid var(--border);
  overflow: hidden;
  transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.12s ease;
}
.theme-option:hover .theme-preview {
  transform: translateY(-1px);
  border-color: var(--border-strong);
}
.theme-option.active .theme-preview {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.theme-option:active .theme-preview {
  transform: scale(0.98);
}
.theme-label {
  font-size: var(--text-sm);
  color: var(--text-dim);
  transition: color 0.16s ease;
}
.theme-option.active .theme-label {
  color: var(--accent);
  font-weight: 600;
}
/* 迷你界面：侧栏 + 顶栏 + 内容块（各主题预览固定用自身配色，不跟随当前主题） */
.tp-side {
  width: 26px;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding-top: var(--space-2);
}
.tp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.tp-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.tp-top {
  height: 14px;
  flex-shrink: 0;
}
.tp-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px;
}
.tp-block {
  flex: 1;
  border-radius: 4px;
}
.tp-btn {
  height: 12px;
  flex-shrink: 0;
  border-radius: 4px;
}
.tp-check {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent);
  padding: 3.5px;
}
/* 自定义预览：彩虹渐变色块 + 调色盘图标 */
.preview-custom {
  align-items: center;
  justify-content: center;
  background: #16161d;
}
.tp-custom-grad {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, #f43f5e 0%, #f97316 25%, #eab308 45%, #22c55e 65%, #3b82f6 85%, #a855f7 100%);
  opacity: 0.85;
}
.tp-palette {
  position: relative;
  width: 30px;
  height: 30px;
  color: #ffffff;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.45));
}
/* 「个性化」入口（选中自定义主题后出现） */
.personalize-btn {
  align-self: flex-start;
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
  font-weight: 600;
}
.personalize-btn:hover:not(:disabled) {
  filter: brightness(1.06);
  border-color: var(--accent);
  color: var(--accent);
}

/* 目录 */
.dir-row {
  display: flex;
  gap: var(--space-3);
}
.dir-row .input {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
}
.dir-btn {
  flex-shrink: 0;
}

/* 内存 */
.memory-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.memory-value {
  flex: none;
  /* 固定宽度：数值位数变化不得挤压/拉伸滑块轨道（双单位最坏情形「128658MB (125.64G)」容纳得下） */
  width: 172px;
  text-align: right;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--accent-2);
  cursor: text;
  border-radius: var(--radius-sm);
  padding: 2px var(--space-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.memory-value:hover { background: var(--hover); }
.memory-input { width: 88px; text-align: right; }
.memory-auto-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  padding-bottom: var(--space-3);
  margin-bottom: var(--space-3);
  border-bottom: 1px solid var(--border);
}
/* 自定义内存滑块：拇指拖拽，轨道不响应点击（不抢鼠标） */
.mem-slider { position: relative; flex: 1; height: 24px; touch-action: none; }
.mem-slider-track {
  position: absolute; left: 0; right: 0; top: 50%; height: 6px; transform: translateY(-50%);
  border-radius: 999px; background: var(--card-2); pointer-events: none;
}
.mem-slider-fill {
  position: absolute; left: 0; top: 50%; height: 6px; transform: translateY(-50%);
  border-radius: 999px; background: linear-gradient(90deg, var(--accent-2), var(--accent)); pointer-events: none;
  /* 拖动中禁用过渡：否则填充追着指针值跑=前后抽搐闪现（用户实测报告） */
  transition: width 0.12s ease;
}
.mem-slider:has(.mem-slider-thumb.dragging) .mem-slider-fill { transition: none; }
.mem-slider-thumb {
  position: absolute; top: 50%; width: 16px; height: 16px; transform: translate(-50%, -50%);
  border-radius: 50%; background: var(--accent); border: 2px solid var(--on-accent);
  box-shadow: 0 1px 6px color-mix(in srgb, var(--accent) 45%, transparent);
  cursor: grab; transition: transform 0.12s ease;
}
.mem-slider-thumb:hover { transform: translate(-50%, -50%) scale(1.12); }
.mem-slider-thumb.dragging { cursor: grabbing; transform: translate(-50%, -50%) scale(1.18); }
.memory-warn {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  color: var(--danger);
}
.memory-info {
  margin-top: var(--space-2);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
}
.memory-refresh {
  border: none;
  background: transparent;
  color: var(--accent-2);
  font-size: var(--text-xs);
  cursor: pointer;
  padding: 0;
}
.memory-refresh:hover {
  text-decoration: underline;
}

/* 分辨率 */
.resolution-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.res-field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
}
.res-label {
  font-size: var(--text-sm);
  flex-shrink: 0;
}
.res-x {
  flex-shrink: 0;
}
.resolution-mode {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
  font-size: var(--text-md);
}
.resolution-mode .select {
  min-width: 108px;
}

/* 镜像 */
.mirror-options {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.mirror-option {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: 0 var(--space-4);
  min-height: var(--ctl-h);
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--card-2);
  color: var(--text);
  font-size: var(--text-sm);
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.mirror-option input {
  display: none;
}
.mirror-option:hover {
  border-color: var(--text-dim);
}
.mirror-option.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-2);
}

.mono {
  font-size: var(--text-sm);
}

.java-loading {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-1) 0;
}

/* Two scopes share compact, state-preserving category panels. */
.settings-page { height:100%;min-height:0;display:grid!important;grid-template-columns:minmax(0,1fr) minmax(220px,340px);grid-template-rows:auto auto auto minmax(0,1fr);gap:10px!important;padding:0!important;max-width:1080px!important;position:relative; }
.settings-page>.page-head { grid-row:1;grid-column:1;margin:0!important;align-self:center; }
.settings-navigation { display:contents; }
.settings-search { grid-column:2;grid-row:1;min-width:0; }
.settings-scopes { grid-column:1/-1;grid-row:2;display:flex;gap:6px; }
.settings-scopes .btn { font-size:15px;font-weight:650;min-height:38px;padding:8px 18px;border-color:transparent; }
.settings-scopes [aria-current] { background:var(--accent-soft);color:var(--accent-2); }
.settings-categories { grid-column:1/-1;grid-row:3;margin:0;border-bottom:1px solid var(--border);padding:0 0 8px;gap:4px; }
.settings-categories .btn { border:0;border-radius:var(--radius-sm);min-height:32px;padding:6px 12px;font-size:13px; }
.settings-body { grid-column:1/-1;grid-row:4;min-height:0;overflow:auto;scrollbar-gutter:stable;display:flex;flex-direction:column;gap:12px;padding:2px 8px 20px 0; }
.settings-body>* { flex-shrink:0; }
.settings-search-results { position:absolute;right:0;top:48px;z-index:20;width:min(480px,100%);max-height:60vh;overflow:auto;padding:12px;background:var(--surface-solid);border:1px solid var(--border);border-radius:var(--radius-md);box-shadow:var(--shadow); }
.settings-page .settings-grid { grid-template-columns:minmax(0,1fr);align-items:start;gap:12px; }
.settings-page .settings-grid>.card { height:auto; }
.settings-page [data-section] { scroll-margin-top:12px; }
.settings-body .group { padding:14px 18px; }
.settings-body .collapse { padding:0;gap:0; }
.settings-body .collapse-body { padding:10px 18px 14px;gap:8px; }
.settings-body .collapse-head { min-height:42px;padding:10px 18px; }
.settings-body .group-title { font-size:15px;margin-bottom:8px; }
.settings-body .collapse-head .group-title { margin:0; }
.settings-body .group-hint { font-size:12px;line-height:1.6;margin:6px 0; }
.settings-body .group-inline { align-items:center;gap:16px; }
.settings-body .group-inline>div { flex:1;min-width:0; }
.settings-body .group-inline .switch { flex:none; }
.settings-body [data-section=motion] { padding:12px 18px;order:1; }
.settings-body [data-section=motion] p { font-size:12px;line-height:1.6;margin:0; }
.settings-body .background-settings { order:2;display:grid;gap:12px; }
.theme-options { display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px; }
.theme-option { flex-direction:row;justify-content:flex-start;gap:10px;min-height:48px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius-sm); }
.theme-option.active { border-color:var(--accent);background:var(--accent-soft); }
.theme-preview { width:46px;height:32px;flex:none;border-radius:5px; }
.theme-option:hover .theme-preview,.theme-option:active .theme-preview { transform:none; }
.theme-option.active .theme-preview { box-shadow:none; }
.theme-label { font-size:13px;white-space:nowrap; }
.tp-side { width:9px;padding-top:4px; }.tp-dot{width:4px;height:4px}.tp-top{height:6px}.tp-body{gap:2px;padding:3px}.tp-btn{height:4px}.tp-check{width:14px;height:14px;top:1px;right:1px;padding:2px}.tp-palette{width:20px;height:20px}
.theme-tools { display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap; }
.personalize-btn { min-height:32px;padding:5px 12px;margin-top:6px; }
.feature-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:24px; }
.feature-grid>.group-hint,.feature-section-title { grid-column:1/-1; }
.feature-section-title { margin:8px 0 2px;font-size:12px;color:var(--text-dim); }
.feature-row { min-height:40px;padding:6px 0; }
.runtime-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start; }
.runtime-grid [data-section=jvm] { grid-column:1/-1; }
.runtime-grid .java-auto-row,.runtime-grid .memory-auto-row { margin:0 0 8px;padding:0 0 10px;gap:12px; }
.runtime-grid .java-auto-title { font-size:13px; }.runtime-grid .java-auto-desc{font-size:12px;line-height:1.55;margin-top:4px}.runtime-grid .memory-info{font-size:12px;margin:10px 0 0}
.memory-refresh { flex:none;white-space:nowrap; }
.java-detected>summary { padding:10px 0;color:var(--text-dim);font-size:13px; }
.runtime-grid .java-list { max-height:200px;overflow:auto; }
.download-mirror-group { margin-bottom:10px; }.download-mirror-options .group-title{font-size:13px}.download-setting{min-height:44px}.advanced-setting{margin-top:10px}
.settings-body .resolution-row { margin-top:8px; }.settings-body .resolution-mode{margin-top:10px}
.settings-body .upd-row { min-height:38px;margin:0;padding:6px 0; }.settings-body .update-maintenance{margin-top:8px}
@media(max-width:1100px) { .runtime-grid{grid-template-columns:minmax(0,1fr)} }
@media(max-width:800px) {
 .settings-page{grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto auto auto minmax(0,1fr)}
 .settings-search{grid-row:2;grid-column:1}.settings-scopes{grid-row:3}.settings-categories{grid-row:4}.settings-body{grid-row:5}.settings-search-results{top:92px}
 .feature-grid{grid-template-columns:minmax(0,1fr)}.theme-options{grid-template-columns:repeat(2,minmax(0,1fr))}
}
</style>
