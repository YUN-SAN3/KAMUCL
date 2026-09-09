<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
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
import type { LocalUpdateCheck, PluginInfo, ReleaseInfo, Settings, ThemeName, UpdateStateInfo } from '@shared/types'
import { QQ_GROUP_NUMBER } from '@shared/branding'
import HomeLayoutEditor from '../components/HomeLayoutEditor.vue'
import { updateSettings } from '../settingsUpdates'

const page = ref<HTMLElement | null>(null)
/** 精确输入框自动聚焦 */
const vFocus = { mounted: (el: HTMLElement) => el.focus() }
async function revealSection() {
  await nextTick()
  if (!store.settingsSection) return
  const target = page.value?.querySelector<HTMLElement>(`[data-section="${store.settingsSection}"]`)
  if (!target) return
  // 目标分区是折叠卡片时先展开再滚动，保证滚动定位有效
  if (target.tagName === 'DETAILS') (target as HTMLDetailsElement).open = true
  target.scrollIntoView({ block: 'start', behavior: 'instant' })
  target.focus({ preventScroll: true })
  store.settingsSection = ''
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
      store.updatePrompt = { release: r.release, rollback: false }
    } else if (r.ok) {
      updateCheckState.value = 'latest'
    } else {
      updateCheckState.value = 'failed'
    }
  } catch {
    updateCheckState.value = 'failed'
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
  const first = (body || '').split(/\r?\n/).map((s) => s.replace(/^#+\s*/, '').trim()).filter(Boolean)[0] ?? ''
  return first.length > 60 ? first.slice(0, 60) + '…' : first
}

// 还原到更新前的版本
const updateState = ref<UpdateStateInfo | null>(null)
const restoringBackup = ref(false)
// 已就绪待安装的更新（关闭启动器时自动安装，也可立即安装）
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
  } catch (e) {
    restoringBackup.value = false
    toast('还原失败：' + errText(e), 'error')
  }
}
async function onApplyPending() {
  try {
    await applyPendingUpdate()
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
  { key: 'keys', label: '默认配置' },
  { key: 'bridge', label: 'MOD 面板' },
  { key: 'servers', label: '服务器' },
  { key: 'friends', label: '联机' },
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

function chooseTheme(theme: ThemeName, label: string) {
  void save({ theme })
  toast(`已切换到「${label}」主题`, 'success')
}

function themePreviewBackground(theme: ThemeName, fallback: string): string {
  if (theme !== 'transparent') return fallback
  return 'linear-gradient(145deg, rgba(20, 34, 38, .72), rgba(10, 18, 21, .9)), linear-gradient(135deg, #455b62, #7a6558)'
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
    toast(`已删除插件 ${p.name}`, 'success')
  } catch (e) {
    toast('删除失败：' + errText(e), 'error')
  }
}
</script>

<template>
  <div ref="page" class="page">
    <div class="page-head">
      <h1 class="page-title">设置</h1>
      <p class="page-sub">游戏目录、内存、Java 与启动行为</p>
    </div>

    <div v-if="!store.settings" class="card empty">
      <span class="spin"></span>
      <span>正在加载设置…</span>
    </div>

    <template v-else>
      <!-- 外观主题（PCL 式折叠卡片：标题行 + 箭头，展开内容统一内边距） -->
      <details class="card group collapse" open>
        <summary class="collapse-head">
          <h3 class="group-title">主题</h3>
          <span class="collapse-arrow" aria-hidden="true"></span>
        </summary>
        <div class="collapse-body">
          <div class="theme-options">
            <button
              v-for="theme in themeOptions"
              :key="theme.key"
              class="theme-option"
              :class="{ active: store.settings.theme === theme.key }"
              :title="theme.description"
              @click="chooseTheme(theme.key, theme.label)"
            >
              <span
                class="theme-preview"
                :class="{ 'preview-custom': theme.key === 'custom', 'preview-transparent': theme.key === 'transparent' }"
                :style="{ background: themePreviewBackground(theme.key, theme.colors.bg) }"
              >
                <span
                  class="tp-side"
                  :style="{
                    background: theme.key === 'transparent' ? 'rgba(12, 23, 25, .68)' : theme.colors.sidebarBg,
                    borderRight: '1px solid ' + theme.colors.border
                  }"
                >
                  <span class="tp-dot" :style="{ background: theme.colors.accent }"></span>
                </span>
                <span class="tp-main">
                  <span
                    class="tp-top"
                    :style="{
                      background: theme.key === 'transparent' ? 'rgba(20, 31, 33, .62)' : theme.colors.card,
                      borderBottom: '1px solid ' + theme.colors.border
                    }"
                  ></span>
                  <span class="tp-body">
                    <span
                      class="tp-block"
                      :style="{
                        background: theme.key === 'transparent' ? 'rgba(27, 39, 40, .64)' : theme.colors.card,
                        border: '1px solid ' + theme.colors.border
                      }"
                    ></span>
                    <span class="tp-btn" :style="{ background: theme.colors.accent }"></span>
                  </span>
                </span>
                <span v-if="theme.key === 'custom'" class="tp-custom-grad"></span>
                <svg v-if="theme.key === 'custom'" class="tp-palette" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67A2.5 2.5 0 0 1 12 22Z" />
                  <circle cx="7.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
                  <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
                  <circle cx="16.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
                </svg>
                <svg v-if="store.settings.theme === theme.key" class="tp-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </span>
              <span class="theme-label">{{ theme.label }}</span>
            </button>
          </div>

          <p class="muted group-hint">六套主题共用图一布局与系统桌面磨砂玻璃，只改变配色；切换不会改变账户、版本或启动设置。</p>
          <button
            v-if="store.settings.theme === 'custom'"
            class="btn personalize-btn"
            @click="enterEditMode"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
              <path d="M1 14h6M9 8h6M17 16h6" />
            </svg>
            个性化
          </button>
        </div>
      </details>

      <!-- 功能管理 -->
      <details class="card group collapse" open>
        <summary class="collapse-head">
          <h3 class="group-title">功能管理</h3>
          <span class="collapse-arrow" aria-hidden="true"></span>
        </summary>
        <div class="collapse-body">
          <p class="muted group-hint">
            关闭的功能将从侧边栏隐藏入口。核心功能（首页/游戏/设置）不可关闭。
          </p>
          <div v-for="f in featureToggles" :key="f.key" class="feature-row">
            <span class="feature-name">{{ f.label }}</span>
            <span class="switch">
              <input
                type="checkbox"
                :checked="!store.settings.disabledFeatures.includes(f.key)"
                @change="onToggleFeature(f.key, ($event.target as HTMLInputElement).checked)"
              />
              <span class="switch-ui"></span>
            </span>
          </div>
        </div>
      </details>

      <!-- 个性化背景与启动卡图片；首页结构固定为图一布局。 -->
      <HomeLayoutEditor />

      <!-- 下载 + 下载目标文件夹：同一行横向排布，窄窗口自动换行 -->
      <div class="settings-grid">
        <!-- 游戏文件夹统一在版本页管理，设置页只显示当前状态，避免双入口冲突。 -->
        <details class="card group collapse setting-target" data-section="downloads" tabindex="-1" open>
          <summary class="collapse-head">
            <h3 class="group-title">下载</h3>
            <span class="collapse-arrow" aria-hidden="true"></span>
          </summary>
          <div class="collapse-body">
            <label class="download-setting">最大线程数
              <input class="input" type="number" min="1" max="64" :value="store.settings.downloadThreads" @change="save({ downloadThreads: Number(($event.target as HTMLInputElement).value) })" />
            </label>
            <label class="download-setting">速度限制（KiB/s）
              <input class="input" type="number" min="0" max="1048576" :value="store.settings.downloadSpeedKBps" @change="save({ downloadSpeedKBps: Number(($event.target as HTMLInputElement).value) })" />
            </label>
            <p class="muted group-hint">0 表示不限速。限制对全部下载任务合计生效；减少线程数后，已有连接完成时释放名额。</p>
          </div>
        </details>
        <div class="card group">
          <h3 class="group-title">下载目标文件夹</h3>
          <p class="muted group-hint">
            请在“首页 → 版本选择 → 文件夹列表”中更改下载目标文件夹；也可进入游戏版本页统一管理。
          </p>
          <div class="dir-row">
            <input class="input mono" :value="store.settings.activeFolder" readonly title="当前游戏文件夹" />
            <button class="btn btn-gold dir-btn" @click="store.currentView = 'game'">
              前往管理
            </button>
          </div>
        </div>
      </div>

      <!-- 默认版本隔离 -->
      <div class="card group group-inline">
        <div>
          <h3 class="group-title">新版本默认开启版本隔离（推荐）</h3>
          <p class="muted group-hint">
            每个新安装的版本使用独立的存档/模组/配置目录，互不干扰。关闭后新版本与全局共享游戏目录；已安装的版本可在游戏版本页单独开关。
          </p>
        </div>
        <label class="switch">
          <input
            type="checkbox"
            :checked="store.settings.defaultIsolation"
            @change="save({ defaultIsolation: ($event.target as HTMLInputElement).checked })"
          />
          <span class="switch-ui"></span>
        </label>
      </div>

      <!-- 内存 -->
      <details class="card group collapse setting-target" data-section="memory" tabindex="-1" open>
        <summary class="collapse-head">
          <h3 class="group-title">内存分配</h3>
          <span class="collapse-arrow" aria-hidden="true"></span>
        </summary>
        <div class="collapse-body">
          <div class="memory-auto-row">
            <span class="java-auto-text">
              <span class="java-auto-title">自动分配（推荐）</span>
              <span class="muted java-auto-desc">按物理内存 1/4 自动分配（本机当前 {{ autoMemoryText }}，2-8GB 区间），启动时实时生效；开启后禁用手动调节。</span>
            </span>
            <label class="switch">
              <input
                :checked="memoryAuto"
                type="checkbox"
                @change="onMemoryAutoChange(($event.target as HTMLInputElement).checked)"
              />
              <span class="switch-ui"></span>
            </label>
          </div>
          <template v-if="!memoryAuto">
            <div class="memory-row">
              <!-- 自定义滑块：只有按住拇指才拖得动（点轨道不跳值，不抢鼠标）；0.5GB 步进 -->
              <div ref="memTrack" class="mem-slider" @pointermove="onMemPointerMove" @pointerup="onMemPointerUp" @pointercancel="onMemPointerUp">
                <div class="mem-slider-track"></div>
                <div class="mem-slider-fill" :style="{ width: memFillPct + '%' }"></div>
                <div
                  class="mem-slider-thumb"
                  :class="{ dragging: memDragging }"
                  :style="{ left: memFillPct + '%' }"
                  @pointerdown="onMemThumbDown"
                  @pointermove="onMemPointerMove"
                  @pointerup="onMemPointerUp"
                  @pointercancel="onMemPointerUp"
                ></div>
              </div>
              <input
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
              <span v-else class="memory-value" title="点击精确输入（GB）" @click="startMemoryEdit">{{ memoryText }}</span>
            </div>
            <p class="muted group-hint">拖动滑块以 0.5 GB 步进（上限随当前可用内存浮动，预留 1G 给系统）；需要精细调节（如 0.25 GB）时点右侧数值直接输入</p>
            <p v-if="memoryOverFree" class="memory-warn">
              当前分配超过可用内存，游戏可能启动失败或卡死系统；请调低或改回「自动分配」
            </p>
          </template>
          <p class="muted memory-info">
            {{ memoryInfoText }}
            <button class="memory-refresh" type="button" @click="refreshSystemInfo">刷新</button>
          </p>
        </div>
      </details>

      <!-- Java -->
      <details class="card group collapse setting-target" data-section="java" tabindex="-1" open>
        <summary class="collapse-head">
          <h3 class="group-title">Java 运行时</h3>
          <span class="collapse-arrow" aria-hidden="true"></span>
        </summary>
        <div class="collapse-body">
          <label class="java-auto-row">
            <span class="java-auto-text">
              <span class="java-auto-title">自动检测并下载所需 Java（推荐）</span>
              <span class="muted java-auto-desc">
                启动时按游戏版本自动选择匹配的 Java；本机没有时自动下载安装。关闭后使用下方手动选择的 Java。
              </span>
            </span>
            <span class="switch">
              <input
                type="checkbox"
                :checked="store.settings.javaAuto"
                @change="save({ javaAuto: ($event.target as HTMLInputElement).checked })"
              />
              <span class="switch-ui"></span>
            </span>
          </label>
          <div v-if="javaLoading" class="java-loading">
            <span class="spin"></span>
            <span class="muted">正在检测本机 Java…</span>
          </div>
          <template v-else>
            <select
              v-model="store.settings.javaPath"
              class="select"
              :disabled="store.settings.javaAuto"
              @change="save({ javaPath: store.settings!.javaPath })"
            >
              <option value="">自动选择（推荐）</option>
              <option v-for="j in javas" :key="j.path" :value="j.path">{{ javaLabel(j) }}</option>
            </select>
            <p v-if="javaError" class="group-error">Java 检测失败：{{ javaError }}</p>
            <p v-else-if="!javas.length" class="muted group-hint">
              未检测到本机 Java，将使用「自动选择」或在启动时自动下载。
            </p>

            <div class="java-scan-row">
              <div class="java-scan-status">
                <span class="muted">扫描注册表、PATH、启动器 Runtime 与全部本地固定磁盘</span>
                <span v-if="javaRefreshing" class="muted java-scan-text" :title="javaScanText">
                  {{ javaScanText }}
                </span>
                <div v-if="javaRefreshing" class="java-scan-track" aria-label="Java 扫描进度">
                  <span :style="{ width: `${javaScanProgress * 100}%` }"></span>
                </div>
              </div>
              <button
                class="btn btn-ghost btn-sm"
                :disabled="javaCancelling"
                @click="onRefreshJava()"
              >
                {{ javaCancelling ? '正在取消…' : javaRefreshing ? '取消扫描' : '重新扫描' }}
              </button>
            </div>

            <!-- 已识别的 Java 列表（版本/位数/来源，支持移除） -->
            <div v-if="javas.length" class="java-list">
              <div class="java-list-head">
                <span class="muted">已识别 {{ javas.length }} 个 Java</span>
              </div>
              <div v-for="j in javas" :key="j.path" class="java-item">
                <span class="tag" :class="j.source === 'manual' ? 'tag-accent' : ''">
                  {{ j.source === 'manual' ? '手动' : '自动' }}
                </span>
                <span class="java-item-ver">Java {{ j.major }}</span>
                <span
                  class="muted java-item-path"
                  :title="`${j.vendor ?? '未知发行版'} · ${j.architecture ?? (j.is64Bit ? '64 位' : '32 位')} · ${j.sourceDetail ?? ''}\n${j.path}`"
                >
                  {{ j.vendor ?? 'Java' }} · {{ j.architecture ?? (j.is64Bit ? '64 位' : '32 位') }} · {{ j.path }}
                </span>
                <button class="java-item-hide" title="从列表隐藏" @click="onHideJava(j.path)">×</button>
              </div>
            </div>

            <!-- 手动添加 Java：点「添加」弹文件选择器定位 java.exe（自动校验版本/位数）；也可粘贴完整路径后回车 -->
            <div class="java-add-row">
              <input
                v-model="javaCustomInput"
                class="input mono"
                placeholder="粘贴 java 可执行文件完整路径回车添加，或留空点「添加」选择文件…"
                spellcheck="false"
                @keyup.enter="onAddJava"
              />
              <button class="btn btn-ghost" :disabled="javaAdding" @click="onAddJava">
                {{ javaAdding ? '校验中…' : '添加' }}
              </button>
            </div>
            <p v-if="javaAddError" class="group-error">{{ javaAddError }}</p>
          </template>
        </div>
      </details>

      <!-- 分辨率 + JVM 参数：同一行横向排布 -->
      <div class="settings-grid">
        <div class="card group">
          <h3 class="group-title">游戏窗口分辨率</h3>
          <div class="resolution-row">
            <div class="res-field">
              <span class="muted res-label">宽</span>
              <input
                v-model.number="store.settings.resolution.width"
                type="number"
                class="input"
                min="854"
                max="7680"
                :disabled="store.settings.resolution.mode !== 'windowed'"
                @change="saveResolution"
              />
            </div>
            <span class="muted res-x">×</span>
            <div class="res-field">
              <span class="muted res-label">高</span>
              <input
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
          <div class="resolution-mode">
            <span class="muted res-label">模式</span>
            <select v-model="store.settings.resolution.mode" class="select" @change="saveResolution">
              <option value="windowed">窗口化</option>
              <option value="maximized">最大化</option>
              <option value="fullscreen">全屏</option>
            </select>
          </div>
          <p v-if="resolutionError" class="group-error">{{ resolutionError }}</p>
          <p v-else class="muted group-hint">
            窗口化使用以上宽高；最大化使用启动时所在显示器的工作区；全屏不会修改显示器分辨率。
          </p>
        </div>

        <div class="card group">
          <h3 class="group-title">JVM 参数</h3>
          <input
            v-model="store.settings.jvmArgs"
            class="input mono"
            placeholder="例如：-XX:+UseG1GC -XX:+ParallelRefProcEnabled"
            @change="save({ jvmArgs: store.settings!.jvmArgs })"
          />
          <p class="muted group-hint">高级选项，留空则使用默认参数</p>
        </div>
      </div>

      <!-- 下载镜像（微软登录 Client ID 按隐私要求不在界面展示，登录固定使用内置默认应用） -->
      <div class="settings-grid">
        <div class="card group">
          <h3 class="group-title">下载镜像</h3>
          <div class="mirror-options">
            <label class="mirror-option" :class="{ active: store.settings.mirror === 'official' }">
              <input v-model="store.settings.mirror" type="radio" value="official" @change="save({ mirror: 'official' })" />
              <span>官方源</span>
            </label>
            <label class="mirror-option" :class="{ active: store.settings.mirror === 'bmclapi' }">
              <input v-model="store.settings.mirror" type="radio" value="bmclapi" @change="save({ mirror: 'bmclapi' })" />
              <span>BMCLAPI 镜像（国内更快）</span>
            </label>
          </div>
        </div>
      </div>

      <!-- 正版代理 + 启动后关闭：同一行横向排布 -->
      <div class="settings-grid">
        <div class="card group group-inline">
          <div>
            <h3 class="group-title">正版登录使用系统代理</h3>
            <p class="muted group-hint">默认直连微软端点（安全优先）。浏览器能打开微软登录页但启动器登录失败时开启；经代理 CONNECT 隧道传输，端到端 TLS 证书校验保持不变。</p>
          </div>
          <label class="switch">
            <input
              :checked="store.settings.msUseProxy === true"
              type="checkbox"
              @change="save({ msUseProxy: ($event.target as HTMLInputElement).checked })"
            />
            <span class="switch-ui"></span>
          </label>
        </div>

        <div class="card group group-inline">
          <div>
            <h3 class="group-title">启动后关闭启动器</h3>
            <p class="muted group-hint">游戏成功启动后自动退出 KAMUCL</p>
          </div>
          <label class="switch">
            <input
              v-model="store.settings.closeAfterLaunch"
              type="checkbox"
              @change="save({ closeAfterLaunch: store.settings!.closeAfterLaunch })"
            />
            <span class="switch-ui"></span>
          </label>
        </div>
      </div>

      <!-- 关于与更新 -->
      <details class="card group collapse" open data-section="update">
        <summary class="collapse-head">
          <h3 class="group-title">关于与更新</h3>
          <span class="collapse-arrow" aria-hidden="true"></span>
        </summary>
        <div class="collapse-body">
          <div class="upd-row">
            <span class="upd-label">当前版本</span>
            <span class="upd-value">v{{ appVersion }}</span>
            <button class="btn btn-ghost btn-sm" :disabled="updateCheckState === 'checking'" @click="onCheckUpdate">
              <span v-if="updateCheckState === 'checking'" class="spin"></span>
              {{ updateCheckState === 'checking' ? '检查中' : '检查更新' }}
            </button>
            <span v-if="updateCheckState === 'latest'" class="upd-latest">已是最新 ✓</span>
            <span v-else-if="updateCheckState === 'failed'" class="muted">检查失败（已记日志，可稍后再试）</span>
          </div>
          <div class="upd-row">
            <span class="upd-label">自动安装更新</span>
            <label class="switch">
              <input
                :checked="store.settings.autoUpdate !== false"
                type="checkbox"
                @change="save({ autoUpdate: ($event.target as HTMLInputElement).checked })"
              />
              <span class="switch-ui"></span>
            </label>
            <span class="muted upd-auto-hint">发现新版本静默下载，关闭启动器时自动安装；关闭则弹窗询问</span>
          </div>
          <div v-if="pendingUpdate" class="upd-row upd-pending-row">
            <span class="upd-pending-text">v{{ pendingUpdate.release.version }} 已就绪，关闭启动器时自动安装</span>
            <button class="btn btn-gold btn-sm" @click="onApplyPending">立即重启安装</button>
          </div>
          <div class="upd-row">
            <span class="upd-label">更新下载源</span>
            <select class="select upd-source" :value="updateSource" @change="onUpdateSourceChange">
              <option value="auto">自动（直连优先，镜像加速）</option>
              <option value="direct">仅 GitHub 直连</option>
              <option value="mirror">仅自定义镜像</option>
            </select>
          </div>
          <div v-if="updateSource !== 'direct'" class="upd-row">
            <span class="upd-label">自定义镜像</span>
            <input
              class="input mono upd-mirror"
              :value="store.settings.updateMirrorUrl ?? ''"
              placeholder="https://ghproxy.net/（留空用默认）"
              @change="onUpdateMirrorChange"
            />
          </div>
          <div class="upd-row upd-actions-row">
            <button class="btn btn-ghost btn-sm" @click="openRollback">版本回退…</button>
            <button v-if="updateState" class="btn btn-ghost btn-sm" :disabled="restoringBackup" @click="onRestoreBackup">
              还原到更新前的版本（v{{ updateState.backupVersion }}）
            </button>
            <button class="btn btn-ghost btn-sm" @click="onPickLocalUpdate">从本地文件安装更新…</button>
          </div>
          <p class="muted group-hint">
            更新包发布在 GitHub Releases；下载较慢时可到 KAMUCL 内测群（{{ store.settings.qqGroupNumber?.trim() || QQ_GROUP_NUMBER }}）获取，群内文件与 GitHub 版本一致。
          </p>
        </div>
      </details>

      <!-- 插件系统 -->
      <details class="card group collapse" open>
        <summary class="collapse-head">
          <h3 class="group-title">插件</h3>
          <span class="collapse-arrow" aria-hidden="true"></span>
        </summary>
        <div class="collapse-body">
          <p class="muted group-hint">
            JS 插件可更改界面、新增功能（启动器版 Mod）。插件拥有界面完全控制权，请只安装可信来源。
          </p>
          <div v-if="plugins.length" class="plugin-list">
            <div v-for="p in plugins" :key="p.id" class="plugin-row">
              <div class="plugin-info">
                <span class="plugin-name">
                  {{ p.name }}
                  <span v-if="p.version" class="muted">v{{ p.version }}</span>
                </span>
                <span class="muted plugin-meta">{{ [p.author, p.description].filter(Boolean).join(' · ') || p.id }}</span>
              </div>
              <button
                class="btn btn-sm"
                :class="pluginConfirmRemove === p.id ? 'btn-danger' : 'btn-ghost'"
                @click="onRemovePlugin(p)"
              >{{ pluginConfirmRemove === p.id ? '确认删除' : '删除' }}</button>
              <label class="switch" :title="p.enabled ? '停用插件' : '启用插件'">
                <input type="checkbox" :checked="p.enabled" @change="onTogglePlugin(p, ($event.target as HTMLInputElement).checked)" />
                <span class="switch-ui"></span>
              </label>
            </div>
          </div>
          <p v-else class="muted group-hint">还没有安装插件</p>
          <div class="plugin-actions">
            <button class="btn btn-ghost btn-sm" :disabled="pluginBusy" @click="onInstallPlugin">
              <span v-if="pluginBusy" class="spin"></span>
              安装插件（.js）
            </button>
            <button class="btn btn-ghost btn-sm" @click="openPluginsDir">打开插件目录</button>
            <button v-if="pluginDirty" class="btn btn-gold btn-sm" @click="($event.target as HTMLButtonElement).blur(); location.reload()">重载启动器生效</button>
          </div>
        </div>
      </details>
    </template>

    <!-- 版本回退：历史版本列表 -->
    <div v-if="rollback.open" class="menu-overlay upd-modal-mask" @click.self="rollback.open = false">
      <div class="card upd-modal-card" role="dialog" aria-label="版本回退">
        <div class="upd-modal-head">
          <h3 class="upd-modal-title">版本回退</h3>
          <button class="icon-btn" title="关闭" @click="rollback.open = false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <p class="upd-risk">⚠ 旧版本可能不兼容新配置格式。回退前将自动备份当前版本，可随时还原。</p>
        <div v-if="rollback.loading" class="empty"><span class="spin"></span></div>
        <div v-else class="upd-release-list">
          <label v-for="r in rollback.list" :key="r.version" class="upd-release-item" :class="{ selected: rollback.selected === r.version }">
            <input v-model="rollback.selected" type="radio" name="rollback-version" :value="r.version" />
            <span class="upd-release-main">
              <span class="upd-release-ver">v{{ r.version }}</span>
              <span class="muted upd-release-date">{{ r.publishedAt.slice(0, 10) }}</span>
              <span class="muted upd-release-summary">{{ releaseSummary(r.body) }}</span>
            </span>
          </label>
          <div v-if="!rollback.list.length" class="empty"><span>没有可回退的历史版本</span></div>
        </div>
        <div class="upd-modal-actions">
          <button class="btn btn-ghost" @click="rollback.open = false">取消</button>
          <button class="btn btn-gold" :disabled="!rollback.selected" @click="confirmRollback">回退到选中版本</button>
        </div>
      </div>
    </div>

    <!-- 本地文件安装更新确认 -->
    <div v-if="localUpdate?.confirming" class="menu-overlay upd-modal-mask" @click.self="localUpdate = null">
      <div class="card upd-modal-card" role="dialog" aria-label="安装本地更新包">
        <div class="upd-modal-head">
          <h3 class="upd-modal-title">安装本地更新包</h3>
          <button class="icon-btn" title="关闭" @click="localUpdate = null">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <p class="upd-local-file">{{ localUpdate.check.fileName }} · {{ (localUpdate.check.fileSize / 1048576).toFixed(1) }} MB</p>
        <div class="upd-local-check">
          <span>版本校验</span>
          <span v-if="localUpdate.check.versionOk" class="upd-ok">v{{ localUpdate.check.version }} ≥ 当前 v{{ appVersion }} ✓</span>
          <span v-else class="upd-warn">⚠ {{ localUpdate.check.version ? `v${localUpdate.check.version} 低于当前 v${appVersion}` : '无法从文件名识别版本号' }}，继续需自担风险</span>
        </div>
        <div class="upd-local-check">
          <span>完整性校验</span>
          <span v-if="localUpdate.check.sha256 === 'match'" class="upd-ok">SHA256 与 GitHub Release 一致 ✓</span>
          <span v-else-if="localUpdate.check.sha256 === 'mismatch'" class="upd-warn">⚠ SHA256 不一致！文件可能被篡改（{{ localUpdate.check.detail }}）</span>
          <span v-else class="upd-warn">⚠ 无法联网校验，请确认文件来自官方渠道，风险自担</span>
        </div>
        <div class="upd-modal-actions">
          <button class="btn btn-ghost" @click="localUpdate = null">取消</button>
          <button
            class="btn"
            :class="localUpdate.check.versionOk && localUpdate.check.sha256 === 'match' ? 'btn-gold' : 'btn-danger'"
            @click="confirmLocalUpdate"
          >确认安装</button>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
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
/* 回退/本地安装弹窗 */
.upd-modal-mask { z-index: 9400; display: grid; place-items: center; }
.upd-modal-card { width: min(560px, 92vw); max-height: 82vh; display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5) var(--space-6); }
.upd-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
.upd-modal-title { margin: 0; font-size: var(--text-lg); }
.upd-risk {
  margin: 0; padding: 9px 12px; border-radius: var(--radius-md); font-size: var(--text-xs); font-weight: 600;
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 26%, transparent);
  color: var(--danger);
}
.upd-release-list { overflow-y: auto; max-height: 46vh; display: flex; flex-direction: column; gap: var(--space-2); }
.upd-release-item {
  display: flex; gap: var(--space-3); align-items: flex-start; padding: var(--space-3) var(--space-3); cursor: pointer;
  border: 1px solid var(--border); border-radius: var(--radius-md); transition: border-color 0.15s ease, background 0.15s ease;
}
.upd-release-item:hover { border-color: var(--accent-deep); }
.upd-release-item.selected { border-color: var(--accent); background: var(--accent-soft); }
.upd-release-item input { margin-top: 3px; accent-color: var(--accent); }
.upd-release-main { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); min-width: 0; }
.upd-release-ver { font-weight: 650; }
.upd-release-date { font-size: var(--text-xs); }
.upd-release-summary { font-size: var(--text-xs); flex-basis: 100%; }
.upd-modal-actions { display: flex; justify-content: flex-end; gap: var(--space-3); }
.upd-local-file { margin: 0; font-weight: 600; font-size: var(--text-sm); word-break: break-all; }
.upd-local-check { display: flex; gap: var(--space-3); font-size: var(--text-sm); align-items: baseline; }
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
</style>
