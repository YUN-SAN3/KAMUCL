<script setup lang="ts">
import { openInstanceCenter } from '../instanceCenter'
import { appearancePreview } from '../visualDesign'
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { activeCarouselKeys, carouselDuration } from '@shared/appearancePolicy'
import { useMotion } from '../motion'
import { CarouselPlayback } from '@shared/carouselPlayback'
import {
  errText,
  exportLaunchLogs,
  getSkinProfile,
  getSettings,
  launchGame,
  restartGame,
  cancelGameRestart,
  listJava,
  setVersionJava,
  openDir,
  removeVersion,
  setActiveFolder,
  showFolderContextMenu
} from '../api'
import {
  selectedInstance, activeInstalled, selectInstance,
  displayVersionName,
  displayVersionSub,
  fmtLastPlayed,
  isFavorite,
  openSettings,
  progressMono,
  refreshInstalled,
  sortWithFavorite,
  store,
  toast,
  toggleFavorite,
  versionIconUrl
} from '../store'
import Avatar from '../components/Avatar.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import SkinViewer3D from '../components/SkinViewer3D.vue'
import CreatorCard from '../components/CreatorCard.vue'
import type {
  ImageFit,
  InstalledVersion,
  JavaInfo,
  ProfileSkins,
  SkinVariant
} from '@shared/types'
import { trackBootTask } from '../bootTasks'
import { managedImageUrl } from '../managedAssets'
import { builtInLaunchImages } from '../launchImages'

const LAST_VERSION_KEY = 'kamucl.lastVersion'

// ---------------- 当前实例与展示图 ----------------
const selectedId = computed({get: () => store.resourceVersionId, set: id => { store.resourceVersionId = id }})
const currentVersion = selectedInstance
const versionLabel = (version: InstalledVersion) => displayVersionName(version)
const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
const loaderText = (version: InstalledVersion) =>
  version.loader ? `${version.loader === 'neoforge' ? 'NeoForge' : cap(version.loader)} ${version.loaderVersion ?? ''}`.trim() : '正式版'
// 与下方实例卡片共用命名规则；技术版本只读真实元数据，不从名称推断。
const heroName = computed(() => currentVersion.value ? versionLabel(currentVersion.value) : '选择游戏实例')
const heroVersion = computed(() => currentVersion.value?.mcVersion || '版本未知')

function fitCss(fit: ImageFit): 'fill' | 'contain' | 'cover' {
  return fit === 'fill' ? 'fill' : fit === 'fit' ? 'contain' : 'cover'
}

const failedBanners = ref(new Set<string>())
const globalBanners = computed(() => {
  const global = appearancePreview.value?.launchThumbnail
  return activeCarouselKeys(global).map(path => {
    const bundled = builtInLaunchImages.find(image => image.key === path)
    return { path, src: bundled?.src ?? managedImageUrl(path), fit: fitCss(global?.fit ?? 'crop'), custom: !bundled }
  })
})
const instanceBanners = computed(() => {
  const version = currentVersion.value
  if (version?.thumbnail) {
    return [{
      path: version.thumbnail,
      src: managedImageUrl(version.thumbnail),
      fit: fitCss(version.thumbnailFit ?? 'crop'),
      custom: true
    }]
  }
  return []
})

const banners = computed(() => {
  const instance = instanceBanners.value.filter(item => !failedBanners.value.has(item.path))
  return instance.length ? instance : globalBanners.value.filter(item => !failedBanners.value.has(item.path))
})
const { decorativeActive } = useMotion()
watch(decorativeActive, active => active ? startBannerTimer() : stopBannerTimer())
const bannerIndex = ref(0)
let bannerTimer: ReturnType<typeof setInterval> | null = null
let playback: CarouselPlayback | null = null
let playbackKey = ''
/** 已加载就绪的轮播图（src 级缓存）：切换只在下一张就绪后发生，杜绝「先闪第一张」 */
const readyBanners = new Set<string>()

function preloadBanner(src: string) {
  if (readyBanners.has(src)) return
  const im = new Image()
  im.onload = () => readyBanners.add(src)
  im.src = src
}
const bannerScope = computed(() => instanceBanners.value.some(item => !failedBanners.value.has(item.path)) ? `instance:${currentVersion.value?.folder}:${currentVersion.value?.id}` : 'global')

function stopBannerTimer() {
  if (playback && playbackKey) {
    try { localStorage.setItem(playbackKey, JSON.stringify(playback.bookmark(Date.now()))) } catch { /* read-only storage */ }
  }
  if (bannerTimer) clearInterval(bannerTimer)
  bannerTimer = null
}

function startBannerTimer() {
  stopBannerTimer()
  if (!banners.value.length) { playback = null; playbackKey = ''; bannerIndex.value = 0; return }
  playbackKey = 'kamucl.carousel.' + bannerScope.value
  let saved
  try { saved = JSON.parse(localStorage.getItem(playbackKey) ?? 'null') } catch { /* invalid bookmark */ }
  const settings = appearancePreview.value?.launchThumbnail
  playback = new CarouselPlayback(banners.value.map(item => ({ path: item.path, durationMs: 1000 * carouselDuration(settings?.durations?.[item.path] ?? settings?.intervalSeconds) })), Date.now(), saved)
  bannerIndex.value = playback.index
  // 预加载全部轮播图：避免切到下一张时因图片未加载而短暂露出第一张
  for (const item of banners.value) preloadBanner(item.src)
  if (banners.value.length < 2 || !decorativeActive.value) return
  bannerTimer = setInterval(() => {
    if (document.hidden || !playback) return
    const nextIdx = playback.peekNext(Date.now())
    if (nextIdx !== playback.index && !readyBanners.has(banners.value[nextIdx]?.src ?? '')) return // 下一张未就绪，下一拍再试
    bannerIndex.value = playback.tick(Date.now())
  }, 100)
}

watch(
  () => JSON.stringify([instanceBanners.value, globalBanners.value, appearancePreview.value?.launchThumbnail.intervalSeconds, appearancePreview.value?.launchThumbnail.durations]),
  () => {
    failedBanners.value = new Set()
    startBannerTimer()
  }
)

function onBannerError(item: { custom: boolean; path: string }) {
  if (failedBanners.value.has(item.path)) return
  failedBanners.value = new Set([...failedBanners.value, item.path])
  bannerIndex.value = 0
  startBannerTimer()
  toast('已跳过不可用的启动卡图片；仅显示已勾选且可用的图片', 'error')
}

// ---------------- 启动、设置与日志 ----------------
const launching = computed(() => store.launchState?.status === 'launching')
const running = computed(() => store.launchState?.status === 'running')
const launchFailed = computed(
  () =>
    store.launchState?.status === 'error' ||
    (store.launchState?.status === 'exited' && store.launchState.code !== 0)
)
const percent = computed(() =>
  store.progress ? Math.round(progressMono(store.progress) * 100) : 0
)
const launchText = computed(() => {
  if (launching.value) return store.progress?.text || '正在启动…'
  return running.value ? '再次启动' : launchFailed.value ? '重新启动' : '开始游戏'
})
// ---------------- 快捷行悬浮浮块（跟随指针在三格间平滑滑动） ----------------
const runtimeHover = ref(-1)
const runtimeStrip = ref<HTMLElement | null>(null)
const runtimeBlob = reactive({ left: 0, width: 0 })
function updateRuntimeBlob() {
  const strip = runtimeStrip.value
  if (!strip || runtimeHover.value < 0) return
  const items = strip.querySelectorAll<HTMLElement>('.runtime-item')
  const target = items[runtimeHover.value]
  if (!target) return
  runtimeBlob.left = target.offsetLeft
  runtimeBlob.width = target.offsetWidth
}
watch(runtimeHover, () => nextTick(updateRuntimeBlob))
const runtimeBlobStyle = computed(() => ({
  left: runtimeBlob.left + 'px',
  width: runtimeBlob.width + 'px'
}))

const heroStatus = computed(() => {
  const version = currentVersion.value
  if (!version) return { text: '等待选择', tone: 'idle' }
  if (running.value) return { text: '游戏运行中', tone: 'running' }
  if (launching.value) return { text: '正在准备', tone: 'running' }
  if (launchFailed.value || version.failed || version.incomplete) {
    return { text: '需要检查', tone: 'error' }
  }
  return { text: '就绪', tone: 'ready' }
})

async function startVersion(id: string, createCommandWorld = false) {
  if (!id) return
  selectedId.value = id
  // 多开支持：仅「正在启动」的重复点击拦截；已有游戏运行中仍可再启动新实例
  if (launching.value) {
    toast('正在启动中，请稍候', 'info')
    return
  }
  if (!store.selectedAccount) {
    toast('请先在账户页选择或添加账号', 'error')
    store.currentView = 'accounts'
    return
  }
  store.launchingVersionId = id
  store.launchingFolder = currentVersion.value?.folder ?? store.settings?.activeFolder ?? store.settings?.gameDir ?? ''
  store.launchState = { status: 'launching', text: '正在准备启动…' }
  try {
    await launchGame(id, undefined, currentVersion.value?.folder, createCommandWorld)
  } catch (error) {
    store.launchState = { status: 'error', text: errText(error) }
    toast('启动失败：' + errText(error), 'error')
  }
}

const restartBusy = ref(false)
const restartConfirm = ref<{ id: string; folder: string; token: string } | null>(null)
async function quickRestart(version: InstalledVersion, token?: string) {
  if (restartBusy.value) return
  restartBusy.value = true; cardMenu.id = ''
  try {
    const folder = version.folder ?? store.settings?.activeFolder ?? ''
    const result = await restartGame(version.id, folder, token)
    restartConfirm.value = result.requiresForce ? { id: version.id, folder, token: result.forceToken! } : null
    if (!result.requiresForce) toast('已确认退出并重新启动同一实例', 'success')
  } catch (e) { toast('重启失败：' + errText(e), 'error'); restartConfirm.value = null }
  finally { restartBusy.value = false }
}
async function cancelRestartPrompt() { await cancelGameRestart(); restartConfirm.value = null }

async function onLaunchClick() {
  if (!launching.value) await startVersion(selectedId.value)
}

function openVersionSettings() {
  if (selectedId.value) localStorage.setItem(LAST_VERSION_KEY, selectedId.value)
  store.currentView = 'game'
}

const logOpen = ref(false)
const logBody = ref<HTMLElement | null>(null)
const exportingLogs = ref(false)

watch(
  () => store.logs.length,
  async () => {
    if (!logOpen.value) return
    await nextTick()
    if (logBody.value) logBody.value.scrollTop = logBody.value.scrollHeight
  }
)

async function exportFailureLogs() {
  if (exportingLogs.value) return
  exportingLogs.value = true
  try {
    const saved = await exportLaunchLogs(store.launchingVersionId || selectedId.value)
    if (saved) toast(`错误日志已导出：${saved}`, 'success')
  } catch (error) {
    toast(`导出失败：${errText(error)}`, 'error')
  } finally {
    exportingLogs.value = false
  }
}

// ---------------- Java 与内存摘要 ----------------
const javas = ref<JavaInfo[]>([])
const javaChecked = ref(false)
const javaText = computed(() => {
  if (currentVersion.value?.javaAuto) return '自动选择'
  const versionJava = currentVersion.value?.javaPath || (!store.settings?.javaAuto ? store.settings?.javaPath : '')
  if (versionJava) {
    const match = javas.value.find((java) => java.path === versionJava)
    return match
      ? `Java ${match.version} (${match.architecture ?? (match.is64Bit ? '64-bit' : '32-bit')})`
      : versionJava
  }
  return '自动选择'
})
const javaPicker = ref<{ id: string; folder?: string; name: string; choice: string } | null>(null)
const javaSaving = ref(false)
function openJavaPicker() {
  const version = currentVersion.value
  if (!version) { openSettings('java'); return }
  javaPicker.value = { id: version.id, folder: version.folder, name: versionLabel(version),
    choice: version.javaAuto ? '@auto' : version.javaPath || '@inherit' }
  void loadJavaSummaryImpl()
}
async function saveJavaChoice() {
  const target = javaPicker.value
  if (!target || javaSaving.value) return
  javaSaving.value = true
  try {
    await setVersionJava(target.id, target.choice.startsWith('@') ? '' : target.choice, target.choice === '@auto', target.folder)
    await refreshInstalled()
    javaPicker.value = null
    toast('已更新此实例的 Java 选择', 'success')
  } catch (error) { toast('保存失败：' + errText(error), 'error') }
  finally { javaSaving.value = false }
}
const memoryText = computed(() => {
  // 与设置实时同步：开启自动分配显示「自动」，关闭显示手动数值
  if (store.settings?.memoryAuto === true) return '自动'
  const mb = store.settings?.memoryMB ?? 0
  if (!mb) return '—'
  return mb % 1024 === 0 ? `${mb / 1024} GB` : `${(mb / 1024).toFixed(1)} GB`
})

function loadJavaSummary() { return trackBootTask(loadJavaSummaryImpl, 800) }
async function loadJavaSummaryImpl() {
  try {
    javas.value = await listJava()
  } catch {
    javas.value = []
  } finally {
    javaChecked.value = true
  }
}

// ---------------- 账户与 3D 皮肤 ----------------
const accountName = computed(() => store.selectedAccount?.username ?? '未登录')
const accountTypeLabel = computed(() => {
  const account = store.selectedAccount
  if (!account) return '添加账户后开始游戏'
  if (account.type === 'microsoft') return 'Microsoft 正版账户'
  if (account.type === 'yggdrasil') return account.providerName ?? '外置 Yggdrasil'
  return '离线账户'
})

const skinProfile = ref<ProfileSkins | null>(null)
const skinLoading = ref(false)
const skinError = ref('')
let skinRequestToken = 0

const currentSkin = computed(() => skinProfile.value?.skins[0] ?? null)
const skinSrc = computed(() => currentSkin.value?.dataUrl ?? '')
const skinVariant = computed<SkinVariant>(() =>
  currentSkin.value?.variant === 'slim' ? 'slim' : 'classic'
)
/** 首页 3D 预览与皮肤页共用披风渲染：有披风则显示，无则不显示（无手动开关） */
const activeCape = computed(() => skinProfile.value?.capes?.find((c) => c.active)?.dataUrl ?? '')

function reloadSkin(refresh = false) { return trackBootTask(() => reloadSkinImpl(refresh), 800) }
async function reloadSkinImpl(refresh = false) {
  const request = ++skinRequestToken
  skinError.value = ''
  if (!store.selectedAccount) { skinProfile.value = null; skinLoading.value = false; return }
  skinLoading.value = true
  try {
    const profile = await getSkinProfile(refresh)
    if (request === skinRequestToken) skinProfile.value = profile
  } catch (error) {
    if (request === skinRequestToken) skinError.value = errText(error)
  } finally {
    if (request === skinRequestToken) skinLoading.value = false
  }
}

watch(
  () => store.selectedAccount?.id,
  () => { skinProfile.value = null; void reloadSkin() }
)

// ---------------- 最近游戏与菜单 ----------------
// 收藏优先 + 最近游玩排序；启动某实例后 recordLastPlayed 更新使其自然提前。
// 选中实例不再直接置顶——只有启动过才排到第一个。
const wideRecent = ref(window.innerWidth >= 1500)
const updateRecentWidth = () => { wideRecent.value = window.innerWidth >= 1500 }
onMounted(() => window.addEventListener('resize', updateRecentWidth))
onUnmounted(() => window.removeEventListener('resize', updateRecentWidth))
const recent = computed(() => sortWithFavorite(activeInstalled.value).slice(0, wideRecent.value ? 8 : 4))
const sortedInstalled = computed(() => sortWithFavorite(store.installed))

const versionMenu = reactive({ open: false, top: 0, left: 0, width: 230 })
const folderListOpen = ref(false)
const folderSwitchBusy = ref(false)
async function chooseGameFolder(folder: string) {
  if (folderSwitchBusy.value) return
  folderSwitchBusy.value = true
  try {
    await setActiveFolder(folder)
    store.settings = await getSettings()
    store.resourceVersionId = ''
    await refreshInstalled()
    folderListOpen.value = false
  } catch (error) { toast(errText(error), 'error') }
  finally { folderSwitchBusy.value = false }
}
const versionMenuButton = ref<HTMLElement | null>(null)

function toggleVersionMenu() {
  if (!versionMenu.open && versionMenuButton.value) {
    const bounds = versionMenuButton.value.getBoundingClientRect()
    versionMenu.top = Math.min(window.innerHeight - 300, bounds.bottom + 8)
    versionMenu.left = Math.max(8, Math.min(window.innerWidth - 250, bounds.right - 230))
  }
  versionMenu.open = !versionMenu.open
}

function chooseVersion(id: string) {
  selectedId.value = id
  versionMenu.open = false
}

const cardMenu = reactive({ id: '', top: 0, left: 0 })
const cardMenuVersion = computed(() =>
  store.installed.find((version) => version.id === cardMenu.id)
)

function openCardMenu(event: MouseEvent, id: string) {
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  cardMenu.id = cardMenu.id === id ? '' : id
  cardMenu.top = Math.max(8, Math.min(window.innerHeight - 272, bounds.bottom + 6))
  cardMenu.left = Math.max(8, Math.min(window.innerWidth - 244, bounds.right - 232))
}

async function openVersionFolder(id: string) {
  cardMenu.id = ''
  try {
    await openDir(`versions/${id}`)
  } catch (error) {
    toast('打开文件夹失败：' + errText(error), 'error')
  }
}

const removeModal = reactive({
  open: false,
  target: null as InstalledVersion | null,
  busy: false
})

function requestRemove(version: InstalledVersion) {
  cardMenu.id = ''
  removeModal.target = version
  removeModal.open = true
}

async function confirmRemove() {
  const version = removeModal.target
  if (!version || removeModal.busy) return
  removeModal.busy = true
  try {
    await removeVersion(version.id, version.folder)
    await refreshInstalled()
    removeModal.open = false
    toast(`已删除 ${version.id}`, 'success')
  } catch (error) {
    toast('删除失败：' + errText(error), 'error')
  } finally {
    removeModal.busy = false
  }
}

onMounted(() => {
  startBannerTimer()
  void loadJavaSummary()
  void reloadSkin()
})

onUnmounted(() => {
  stopBannerTimer()
  skinRequestToken++
})
</script>

<template>
  <div data-ui="HomeView:a32c099bc136" class="home-dashboard">
    <div data-ui="HomeView:5fc354f9fa6d" class="home-main">
      <section data-ui="HomeView:53555cbc5ab3" class="hero-card" :class="{ 'no-banner': !banners.length }" data-edit="banner">
        <img data-ui="HomeView:1182a4262184"
          v-for="(item, index) in banners"
          :key="item.path"
          :src="item.src"
          class="hero-image"
          :class="{ active: index === bannerIndex }"
          :style="{ objectFit: item.fit }"
          alt=""
          aria-hidden="true"
          @error="onBannerError(item)"
        />
        <div data-ui="HomeView:5838d59b9e2a" v-if="banners.length" class="hero-shade"></div>

        <div data-ui="HomeView:2e850cf13849" class="hero-content" data-edit="bannerText">
          <span data-ui="HomeView:13616e708e66" class="hero-kicker">当前版本</span>
          <div data-ui="HomeView:027bc7e292dc" class="hero-metadata-slot">
            <Transition name="instance-switch" mode="out-in">
              <div data-ui="HomeView:e8ce122328e6" :key="JSON.stringify([currentVersion?.folder, selectedId, heroName, heroVersion, currentVersion?.loader, currentVersion?.loaderVersion])" class="hero-metadata">
                <h1 data-ui="HomeView:d209b16cd00e" :title="heroName" :class="{ 'long-name': heroName.length > 16 }">{{ heroName }}</h1>
                <div data-ui="HomeView:273ef3354188" class="hero-edition">
                  <span data-ui="HomeView:cbc929d650f0" v-if="currentVersion && !heroName.includes(heroVersion)" class="hero-game-version" :title="`Minecraft ${heroVersion}`">{{ heroVersion }}</span>
                  <span data-ui="HomeView:323afa8d269b" v-if="currentVersion && !heroName.includes(loaderText(currentVersion))" class="loader-badge">{{ loaderText(currentVersion) }}</span>
                </div>
              </div>
            </Transition>
          </div>

          <div data-ui="HomeView:b9457a1e78a6" class="hero-actions">
            <div data-ui="HomeView:8079f9c9866a" class="hero-secondary-actions">
              <button data-ui="HomeView:f170f5154efb" class="hero-settings" :disabled="!currentVersion" @click="openVersionSettings">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1.4 1.68V21h-4v-.08A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3 13.6H3v-4h.08A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10.4 3H14a1.7 1.7 0 0 0 1.4 1.6 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9 1.7 1.7 0 0 0 21 10.4V14a1.7 1.7 0 0 0-1.6 1Z" /></svg>
                版本设置
              </button>
              <button data-ui="HomeView:8389ad960143"
                class="hero-more"
                :disabled="!currentVersion"
                title="更多实例操作"
                @click="currentVersion && openCardMenu($event, currentVersion.id)"
              >
                <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
              </button>
            </div>

            <div data-ui="HomeView:27feb55000dd" class="launch-combo" data-edit="accent">
              <button data-ui="HomeView:3fed5eb9ac9e"
                class="launch-main"
                :class="{ launching }"
                :disabled="launching || !currentVersion"
                @click="onLaunchClick"
              >
                <span data-ui="HomeView:62395e18f043" v-if="launching" class="launch-progress" :style="{ width: percent + '%' }"></span>
                <span data-ui="HomeView:57cbf5d7ee2f" class="launch-content">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5Z" /></svg>
                  <span>{{ launchText }}</span>
                </span>
              </button>
              <button data-ui="HomeView:5ca10c2a5c92" ref="versionMenuButton" class="launch-arrow" title="选择游戏实例" @click="toggleVersionMenu">
                <svg :class="{ open: versionMenu.open }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      <section data-ui="HomeView:a9a31ca336dd" ref="runtimeStrip" class="runtime-strip" data-edit="card" @mouseleave="runtimeHover = -1">
        <span data-ui="HomeView:43baf1da9a9d" class="runtime-blob" :class="{ on: runtimeHover >= 0 }" :style="runtimeBlobStyle" aria-hidden="true"></span>
        <button data-ui="HomeView:5d665ee0e06b" class="runtime-item" @mouseenter="runtimeHover = 0" @click="openJavaPicker" title="选择此实例的 Java：自动或手动">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4M16 2v4M7 8h10a4 4 0 0 1 4 4v0a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8v0a4 4 0 0 1 4-4Z" /><path d="M8 13h8M9 17h6" /></svg>
          <span><small>运行环境</small><strong>{{ javaText }}</strong></span>
          <svg class="runtime-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6" /></svg>
        </button>
        <button data-ui="HomeView:ac285743c8c3" class="runtime-item" @mouseenter="runtimeHover = 1" @click="openSettings('memory')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2" /><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4M9 9h6v6H9Z" /></svg>
          <span><small>内存分配</small><strong>{{ memoryText }}</strong></span>
          <svg class="runtime-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6" /></svg>
        </button>
        <button data-ui="HomeView:3e2f60ad69a5" class="runtime-item runtime-state" :class="heroStatus.tone" @mouseenter="runtimeHover = 2" @click="logOpen = true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-7 4 14 2-7h6" /></svg>
          <span><small>运行状态</small><strong><i></i>{{ heroStatus.text }}</strong></span>
          <svg class="runtime-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6" /></svg>
        </button>
      </section>

      <section data-ui="HomeView:d4eaa1c0d798" class="instances-block">
        <div data-ui="HomeView:07c360f67ff2" class="instances-head">
          <h2 data-ui="HomeView:ab67b2084be9">最近游戏</h2>
          <button data-ui="HomeView:1f3a4e95599d" class="manage-instances" @click="store.currentView = 'game'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
            管理实例
          </button>
        </div>

        <div data-ui="HomeView:204c17c101ec" v-if="store.installed.length" class="instance-grid">
          <article data-ui="HomeView:22d3ec196f2b"
            v-for="version in recent"
            :key="version.id"
            class="instance-card" tabindex="0" @keydown.enter.self="chooseVersion(version.id)" @keydown.space.self.prevent="chooseVersion(version.id)"
            :class="{ selected: version.id === selectedId }"
            data-edit="card"
            @click="chooseVersion(version.id)"
            @contextmenu.prevent="showFolderContextMenu(version.folder, version.id)"
          >
            <img data-ui="HomeView:ead234e5a835" v-if="versionIconUrl(version)" class="instance-icon image" :src="versionIconUrl(version)" alt="" />
            <svg v-else class="instance-icon" viewBox="0 0 48 48" aria-hidden="true"><polygon points="24,5 43,14.5 24,24 5,14.5" fill="#79c144" /><polygon points="5,14.5 24,24 24,29.5 5,20" fill="#5da236" /><polygon points="24,24 43,14.5 43,20 24,29.5" fill="#4e8a2f" /><polygon points="5,20 24,29.5 24,43 5,33.5" fill="#8b5e34" /><polygon points="24,29.5 43,20 43,33.5 24,43" fill="#6f4a29" /></svg>
            <div data-ui="HomeView:0541baba1a35" class="instance-copy">
              <strong data-ui="HomeView:51623bcd9cd5" :title="versionLabel(version)">{{ versionLabel(version) }}</strong>
              <span data-ui="HomeView:59cc23bdfbdc" :title="displayVersionSub(version)">{{ displayVersionSub(version) }}</span>
            </div>
            <button data-ui="HomeView:b5167161777c" class="instance-more" title="更多" @click.stop="openCardMenu($event, version.id)">
              <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
            </button>
            <span data-ui="HomeView:ba095d8dcc15" v-if="store.lastPlayed[version.id]" class="instance-last">上次游玩：{{ fmtLastPlayed(store.lastPlayed[version.id]) }}</span>
            <button data-ui="HomeView:1a638472fc2a"
              class="instance-play"
              :disabled="launching"
              :title="`启动 ${version.id}`"
              @click.stop="startVersion(version.id)"
            >
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5Z" /></svg>
            </button>
          </article>
        </div>
        <button data-ui="HomeView:c485ad83d7d3" v-else class="empty-instances" @click="store.currentView = 'game'">
          尚未安装游戏实例，点击前往版本管理
        </button>
      </section>
    </div>

    <aside data-ui="HomeView:3ce39fef1300" class="home-side">
      <section data-ui="HomeView:1a033831e623" class="account-panel" data-edit="card">
        <template v-if="store.selectedAccount">
          <div class="account-head">
            <Avatar :size="54" />
            <div data-ui="HomeView:69c3212000eb" class="account-copy" data-edit="text">
              <strong>{{ accountName }}</strong>
              <span><i></i>{{ store.selectedAccount.type === 'offline' ? '离线账号' : '已登录' }}</span>
            </div>
            <button data-ui="HomeView:c7c1ffb68ac7" class="account-more" title="账户管理" @click="store.currentView = 'accounts'">
              <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
            </button>
          </div>
          <button class="account-provider" @click="store.currentView = 'accounts'">
            <span data-ui="HomeView:8bfe0faab45b" class="provider-mark" :class="store.selectedAccount.type"><svg v-if="store.selectedAccount.type === 'microsoft'" viewBox="0 0 22 22" aria-label="Microsoft"><path fill="#f25022" d="M0 0h10v10H0z"/><path fill="#7fba00" d="M12 0h10v10H12z"/><path fill="#00a4ef" d="M0 12h10v10H0z"/><path fill="#ffb900" d="M12 12h10v10H12z"/></svg><template v-else>{{ store.selectedAccount.type === 'yggdrasil' ? 'Y' : 'O' }}</template></span>
            <span>{{ accountTypeLabel }}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        </template>
        <template v-else>
          <div class="account-head">
            <div data-ui="HomeView:14b73e10a66b" class="account-placeholder">?</div>
            <div data-ui="HomeView:b713dda14ce9" class="account-copy"><strong>未登录</strong><span data-ui="HomeView:ab6dcd8df3ac" class="offline-state">请选择账户</span></div>
          </div>
          <button class="account-provider" @click="store.currentView = 'accounts'">
            <span data-ui="HomeView:57ae15324d65" class="provider-mark offline">+</span><span>添加或选择账户</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        </template>
      </section>

      <section data-ui="HomeView:f56ae81d7b8f" class="skin-panel" data-edit="card">
        <div data-ui="HomeView:a11abb820a96" class="skin-head">
          <div><h3>皮肤预览</h3><span>{{ currentSkin ? (skinVariant === 'slim' ? '纤细模型' : '经典模型') : '动态角色' }}</span></div>
          <button data-ui="HomeView:d5082937e164" class="skin-refresh" :disabled="skinLoading || !store.selectedAccount" title="联网刷新皮肤（默认使用本地缓存）" @click="reloadSkin(true)">
            <svg :class="{ spinning: skinLoading }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 9A7 7 0 0 1 18 6l2 1M4 17l2 1a7 7 0 0 0 11.9-3" /></svg>
          </button>
        </div>
        <div data-ui="HomeView:22e64941359b" class="skin-stage" @dblclick="store.currentView = store.selectedAccount ? 'skins' : 'accounts'">
          <SkinViewer3D :src="skinSrc" :variant="skinVariant" :cape="activeCape" />
          <div data-ui="HomeView:862dfc8e4099" v-if="skinLoading" class="skin-overlay"><span data-ui="HomeView:369e7ffcf786" class="spin"></span><span>正在加载皮肤…</span></div>
          <button data-ui="HomeView:0309ef6b61da" v-else-if="!store.selectedAccount" class="skin-overlay action" @click="store.currentView = 'accounts'">登录后加载角色皮肤</button>
          <button data-ui="HomeView:70bc857e7889" v-else-if="skinError" class="skin-overlay action error" :title="skinError" @click="reloadSkin(true)">皮肤加载失败，点击重试</button>
        </div>
        <button data-ui="HomeView:d3685d94fd0f" class="skin-tip" @click="store.currentView = store.selectedAccount ? 'skins' : 'accounts'">
          拖动可旋转 · 行走动画
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6" /></svg>
        </button>
      </section>
      <CreatorCard class="home-creator" />
    </aside>

    <Teleport to="body">
      <div data-ui="HomeView:d64e8ccae3be" v-if="versionMenu.open" class="menu-overlay" @click="versionMenu.open = false"></div>
      <div data-ui="HomeView:d4dfd8dd87c8"
        v-if="versionMenu.open"
        class="float-menu"
        :style="{ top: versionMenu.top + 'px', left: versionMenu.left + 'px', width: versionMenu.width + 'px' }"
      >
        <button data-ui="HomeView:9fae1e3ba335" class="menu-item" @click="folderListOpen = !folderListOpen">{{ folderListOpen ? '‹ 返回版本选择' : '文件夹列表 ›' }}</button>
        <template v-if="folderListOpen">
          <button data-ui="HomeView:4aa05f9d0808" v-for="folder in store.settings?.folders || []" :key="folder.path" class="menu-item" :class="{ active: folder.path === store.settings?.activeFolder }" :disabled="folderSwitchBusy" :title="folder.path" @click="chooseGameFolder(folder.path)" @contextmenu.prevent="showFolderContextMenu(folder.path)">{{ folder.name }}</button>
          <button data-ui="HomeView:a82260e8c53c" class="menu-item" @click="store.currentView = 'game'">添加 / 管理文件夹</button>
        </template>
        <template v-else>
        <button data-ui="HomeView:dedcb316a30b"
          v-for="version in sortedInstalled"
          :key="version.id"
          class="menu-item"
          :class="{ active: version.id === selectedId }"
          @click="chooseVersion(version.id)"
          @contextmenu.prevent="showFolderContextMenu(version.folder, version.id)"
        >
          <svg v-if="isFavorite(version.id, version.folder)" viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z" /></svg>
          <span data-ui="HomeView:f77a89b73779" v-else class="menu-spacer"></span>
          {{ versionLabel(version) }}
        </button>
        <div data-ui="HomeView:2de4cc34bb59" v-if="!sortedInstalled.length" class="menu-empty">暂无已安装实例</div>
        </template>
      </div>
    </Teleport>

    <Teleport to="body">
      <div data-ui="HomeView:4f4a9fb8dc2a" v-if="cardMenu.id" class="menu-overlay" @click="cardMenu.id = ''"></div>
      <div data-ui="HomeView:3c3ff2f77e4f"
        v-if="cardMenu.id && cardMenuVersion"
        class="float-menu card-float-menu"
        :style="{ top: cardMenu.top + 'px', left: cardMenu.left + 'px' }"
      >
        <button data-ui="HomeView:3e8d19a019ab" class="menu-item" @click="openInstanceCenter(cardMenuVersion); cardMenu.id = ''">管理实例</button>
        <button data-ui="HomeView:a0dd508b6e16" class="menu-item" @click="startVersion(cardMenuVersion.id); cardMenu.id = ''">启动实例</button>
        <button data-ui="HomeView:cc765cc95569" class="menu-item" title="新建允许命令的创造模式测试世界并自动进入（Minecraft 1.20+）" :disabled="running || launching || restartBusy" @click="startVersion(cardMenuVersion.id, true); cardMenu.id = ''">启动并创建命令世界</button>
        <button data-ui="HomeView:98ec7f1bfdb4" class="menu-item" :disabled="!running || restartBusy" @click="quickRestart(cardMenuVersion)">快速重启游戏</button>
        <button data-ui="HomeView:a83bf9067bf3" class="menu-item" @click="toggleFavorite(cardMenuVersion.id, cardMenuVersion.folder); cardMenu.id = ''">
          {{ isFavorite(cardMenuVersion.id, cardMenuVersion.folder) ? '取消收藏' : '收藏实例' }}
        </button>
        <button data-ui="HomeView:471f5e20fd6f" class="menu-item" @click="openVersionFolder(cardMenuVersion.id)">打开文件夹</button>
        <button data-ui="HomeView:31cc199f9344" class="menu-item danger" @click="requestRemove(cardMenuVersion)">删除实例</button>
      </div>
    </Teleport>

    <Teleport to="body">
      <div data-ui="HomeView:923206ea2c37" v-if="logOpen" class="log-mask" @pointerdown.self="logOpen = false">
        <section data-ui="HomeView:21a3dfa129bb" class="log-dialog" role="dialog" aria-modal="true" aria-label="游戏日志">
          <header data-ui="HomeView:e10df8fdf6ce">
            <div><h3>启动日志</h3><span>{{ store.logs.length }} 行 · {{ heroStatus.text }}</span></div>
            <button data-ui="HomeView:8c1728a36b47" class="log-close" title="关闭" @click="logOpen = false">×</button>
          </header>
          <div data-ui="HomeView:1921d3d812a6" v-if="launchFailed" class="log-failure">
            <span>检测到启动失败或异常退出</span>
            <button data-ui="HomeView:4e02813325fa" :disabled="exportingLogs" @click="exportFailureLogs">{{ exportingLogs ? '导出中…' : '导出错误日志' }}</button>
          </div>
          <div data-ui="HomeView:d816343842fa" ref="logBody" class="log-body">
            <p data-ui="HomeView:9e34f7306c51" v-if="!store.logs.length" class="log-empty">暂无启动日志</p>
            <pre data-ui="HomeView:b8671047aacf" v-else><span data-ui="HomeView:d2bfb16eae17" v-for="(line, index) in store.logs" :key="index">{{ line }}</span></pre>
          </div>
          <footer data-ui="HomeView:113536fd4ef0"><button data-ui="HomeView:287dd6a53ff1" class="btn btn-ghost btn-sm" :disabled="!store.logs.length" @click="store.logs = []">清空日志</button></footer>
        </section>
      </div>
    </Teleport>

    <ConfirmModal
      :open="removeModal.open"
      title="删除版本"
      :message="`确定要删除版本「${removeModal.target?.id}」吗？该版本目录将移入系统回收站（共享依赖与资源保留）。`"
      :busy="removeModal.busy"
      @cancel="removeModal.open = false"
      @confirm="confirmRemove"
    />
  </div>
  <Teleport to="body">
    <div data-ui="HomeView:5da5c508a315" v-if="javaPicker" class="modal-mask" @pointerdown.self="!javaSaving && (javaPicker = null)" @keydown.esc="!javaSaving && (javaPicker = null)">
      <section data-ui="HomeView:d9cf38660e47" class="modal java-picker" role="dialog" aria-modal="true" aria-labelledby="java-picker-title">
        <h3 data-ui="HomeView:5e6790a8da51" id="java-picker-title" class="modal-title">选择 Java 运行环境</h3>
        <p data-ui="HomeView:96c5153e7b82" class="java-picker-description">{{ javaPicker.name }} · 仅修改此实例，不影响其他实例</p>
        <label class="java-option"><input data-ui="HomeView:e530b03f8660" v-model="javaPicker.choice" type="radio" value="@auto" name="home-java" /><span><strong>自动选择</strong><small>按游戏的真实版本要求匹配 Java，必要时自动下载</small></span></label>
        <label class="java-option"><input data-ui="HomeView:a0b100241102" v-model="javaPicker.choice" type="radio" value="@inherit" name="home-java" /><span><strong>跟随全局设置</strong><small>{{ store.settings?.javaAuto ? '当前全局：自动选择' : '当前全局：' + (store.settings?.javaPath || '匹配本地 Java') }}</small></span></label>
        <div data-ui="HomeView:2b732ea02a21" class="java-list">
          <label data-ui="HomeView:484d96932255" v-for="java in javas" :key="java.path" class="java-option"><input data-ui="HomeView:3b272633f5d0" v-model="javaPicker.choice" type="radio" :value="java.path" name="home-java" /><span><strong>Java {{ java.version }} · {{ java.architecture || (java.is64Bit ? '64-bit' : '32-bit') }}</strong><small data-ui="HomeView:012aa6cd6faf" :title="java.path">{{ java.path }}</small></span></label>
          <p data-ui="HomeView:cf5a93492c1f" v-if="!javas.length" class="java-picker-description">{{ javaChecked ? '未发现本地 Java，可使用自动选择，或在设置中添加 Java。' : '正在扫描本地 Java…' }}</p>
          <p data-ui="HomeView:c23c056bc1bd" v-if="javaPicker.choice && !javaPicker.choice.startsWith('@') && !javas.some(java => java.path === javaPicker?.choice)" class="java-picker-description">当前指定：{{ javaPicker.choice }}</p>
        </div>
        <div data-ui="HomeView:e1c395584dc9" class="modal-actions">
          <button data-ui="HomeView:765c5489bdca" class="btn btn-ghost" :disabled="javaSaving" @click="javaPicker = null; openSettings('java')">管理 Java</button>
          <button data-ui="HomeView:6248b7b5543e" class="btn btn-ghost" :disabled="javaSaving" @click="javaPicker = null">取消</button>
          <button data-ui="HomeView:853a319d45b3" class="btn btn-gold" :disabled="javaSaving" @click="saveJavaChoice">{{ javaSaving ? '保存中…' : '保存选择' }}</button>
        </div>
      </section>
    </div>
  </Teleport>
  <Teleport to="body"><div data-ui="HomeView:9d63fadc1ed6" v-if="restartConfirm" class="modal-mask" style="z-index: 10030"><section data-ui="HomeView:b6df5ebbb9a2" class="modal" role="dialog" aria-modal="true" aria-label="正常退出超时">
    <h3>正常退出等待超时</h3><p data-ui="HomeView:2925c2d17b9d">Minecraft 可能仍在保存世界。建议在游戏内保存退出，然后重试。</p><p data-ui="HomeView:37b32c3aeef4" style="color: var(--danger)">强制结束可能丢失进度或损坏存档；只有你确认后才会执行。</p>
    <div data-ui="HomeView:6801f8598bb3" style="display: flex; gap: 12px; justify-content: flex-end"><button data-ui="HomeView:1ab5dde2249d" class="btn btn-ghost" :disabled="restartBusy" @click="cancelRestartPrompt">取消重启，继续等待</button><button data-ui="HomeView:df15de437ca0" class="btn btn-danger" :disabled="restartBusy" @click="quickRestart({ id: restartConfirm.id, folder: restartConfirm.folder } as InstalledVersion, restartConfirm.token)">确认强制结束并重启</button></div>
  </section></div></Teleport>
</template>

<style scoped>
.recent-grid, .instance-grid { grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr)) !important; }
.recent-card { min-height:140px; height:auto !important; }
.hero-content h1 { overflow-wrap:break-word; word-break:normal; }
.runtime-strip { background:var(--surface-content) !important; }
.home-side { align-self:start; }

.java-picker { width: min(580px, calc(100vw - 40px)); }
.java-picker .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
.java-picker-description { color: var(--text-dim); font-size: 12px; margin-bottom: 16px; overflow-wrap: anywhere; }
.java-list { max-height: 32vh; overflow: auto; margin-top: 10px; }
.java-option { display: flex; gap: 12px; align-items: center; padding: 13px; margin-bottom: 8px; border: 1px solid var(--border); border-radius: 12px; cursor: pointer; }
.java-option:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
.java-option input { accent-color: var(--accent); flex: none; }
.java-option span { min-width: 0; }
.java-option strong, .java-option small { display: block; }
.java-option small { margin-top: 5px; font-size: 11px; color: var(--text-dim); overflow-wrap: anywhere; }
.home-dashboard {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 286px;
  gap: 14px;
  width: 100%;
  max-width: 1160px;
  margin: 0 auto;
  min-width: 0;
  min-height: calc(100vh - 132px);
}
.home-main {
  display: flex;
  min-width: 0;
  min-height: inherit;
  flex-direction: column;
  gap: 14px;
}
.hero-card {
  position: relative;
  height: var(--banner-h);
  min-height: 348px;
  flex: none;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 95%, white 4%);
  border-radius: 20px;
  background: #17231f;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.22);
}
.hero-image { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; transition: opacity var(--motion-carousel) ease; }
.hero-image.active { opacity: 1; }
.hero-card.no-banner { background: var(--surface-content); box-shadow: none; }
.no-banner .hero-content, .no-banner .hero-content h1, .no-banner .hero-game-version { color: var(--text); text-shadow: none; }
.no-banner .hero-kicker, .no-banner .hero-settings, .no-banner .hero-more { background: var(--card-2); color: var(--text); border-color: var(--border); backdrop-filter: none; }
.no-banner .loader-badge { color: var(--accent-2); background: var(--accent-soft); }
.hero-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(8, 14, 15, 0.66), rgba(8, 14, 15, 0.24) 54%, rgba(8, 14, 15, 0.08)), linear-gradient(0deg, rgba(5, 10, 9, 0.38), transparent 52%);
}
.hero-content { position: relative; z-index: 1; display: flex; height: 100%; padding: 48px 44px 32px 44px; flex-direction: column; align-items: flex-start; color: var(--bn-text); }
.hero-kicker { display: inline-flex; align-items: center; min-height: 34px; padding: 0 14px; border: 1px solid rgba(255, 255, 255, 0.13); border-radius: 7px; background: rgba(9, 13, 14, 0.48); backdrop-filter: blur(12px); font-size: 13px; font-weight: 650; }
.hero-content h1 { max-width: 100%; margin-top: 18px; overflow: hidden; color: #fff; font-size: clamp(46px, 5.2vw, 64px); font-weight: 850; line-height: 1.15; letter-spacing: -1px; text-overflow: ellipsis; text-shadow: 0 4px 24px rgba(0, 0, 0, 0.32); white-space: nowrap; }
.hero-content h1.long-name { font-size: clamp(28px, 3.2vw, 42px); letter-spacing: -0.5px; }
.hero-metadata-slot { width: 100%; min-height: 130px; position: relative; }
.hero-metadata { width: 100%; }
.instance-switch-enter-active, .instance-switch-leave-active { transition: opacity 100ms ease, transform 100ms ease; }
.instance-switch-enter-from { opacity: 0; transform: translateY(2px); }
.instance-switch-leave-to { opacity: 0; transform: translateY(-2px); }
@media (prefers-reduced-motion: reduce) {
  .instance-switch-enter-active, .instance-switch-leave-active { transition: none; }
}
.hero-edition { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 16px; font-size: 17px; font-weight: 650; overflow-wrap: anywhere; }
.hero-game-version { color: #fff; }
.loader-badge { padding: 5px 11px; border: 1px solid color-mix(in srgb, var(--accent-2) 34%, transparent); border-radius: 999px; background: color-mix(in srgb, var(--accent) 30%, rgba(20, 30, 24, 0.46)); color: #f6fff8; font-size: 11px; font-weight: 650; }
.hero-actions { display: flex; width: 100%; margin-top: auto; align-items: flex-end; justify-content: space-between; gap: 18px; }
.hero-secondary-actions, .launch-combo { display: flex; align-items: stretch; }
.hero-settings, .hero-more { height: 52px; border: 1px solid rgba(255, 255, 255, 0.14); background: rgba(10, 16, 17, 0.58); color: #f4f7f5; backdrop-filter: blur(13px); cursor: pointer; }
.hero-settings { display: inline-flex; align-items: center; gap: 10px; min-width: 150px; padding: 0 18px; border-radius: 10px 0 0 10px; font-family: inherit; font-size: 14px; font-weight: 650; }
.hero-settings svg { width: 18px; height: 18px; }
.hero-more { width: 52px; border-left: 0; border-radius: 0 10px 10px 0; }
.hero-more svg { width: 19px; height: 19px; }
.hero-settings:hover:not(:disabled), .hero-more:hover:not(:disabled) { background: rgba(19, 29, 29, 0.76); }
.hero-settings:disabled, .hero-more:disabled { opacity: 0.45; cursor: default; }
.launch-combo {
  min-width: 310px; height: 76px; border-radius: 14px; overflow: hidden;
  box-shadow: 0 12px 32px color-mix(in srgb, var(--accent) 38%, transparent), 0 2px 0 color-mix(in srgb, white 14%, transparent) inset;
  transition: transform var(--motion-normal) var(--ease-out), box-shadow 0.22s ease;
}
.launch-combo:hover { transform: translateY(-2px); box-shadow: 0 16px 40px color-mix(in srgb, var(--accent) 46%, transparent), 0 2px 0 color-mix(in srgb, white 16%, transparent) inset; }
.launch-combo:active { transform: translateY(0) scale(0.99); }
.launch-main, .launch-arrow { position: relative; overflow: hidden; border: 0; background: var(--accent-grad); color: var(--on-accent); cursor: pointer; }
.launch-main { flex: 1; min-width: 0; padding: 0 26px; font-family: inherit; font-size: 21px; font-weight: 800; letter-spacing: 0.5px; }
.launch-content { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; gap: 12px; }
.launch-content svg { width: 22px; height: 22px; flex: none; }
.launch-content span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.launch-progress { position: absolute; inset: 0 auto 0 0; background: rgba(255, 255, 255, 0.25); transition: width 0.25s ease; }
.launch-main:disabled { cursor: not-allowed; filter: saturate(0.75); }
.launch-arrow { width: 62px; border-left: 1px solid rgba(255, 255, 255, 0.22); }
.launch-arrow:hover, .launch-main:hover:not(:disabled) { filter: brightness(1.08); }
.launch-arrow svg { width: 22px; height: 22px; transition: transform 0.18s ease; }
.launch-arrow svg.open { transform: rotate(180deg); }

.runtime-strip { position: relative; display: grid; grid-template-columns: 1.12fr 0.95fr 0.92fr; min-height: 82px; flex: none; overflow: hidden; border: 1px solid var(--border); border-radius: 15px; background: color-mix(in srgb, var(--card) 80%, transparent); box-shadow: var(--shadow); backdrop-filter: blur(18px) saturate(130%); -webkit-backdrop-filter: blur(18px) saturate(130%); }
/* 悬浮浮块：跟随指针在三格间平滑滑动（浮起+落下+格间转移过渡） */
.runtime-blob {
  position: absolute; top: 0; bottom: 0; z-index: 0;
  border-radius: 12px; margin: var(--space-1) 0;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  opacity: 0; transform: scale(0.97);
  transition: left var(--motion-normal) var(--ease-out), width var(--motion-normal) var(--ease-out), opacity 0.18s ease, transform 0.2s ease;
  pointer-events: none;
}
.runtime-blob.on { opacity: 1; transform: scale(1); }
.runtime-item { position: relative; z-index: 1; display: grid; grid-template-columns: 34px minmax(0, 1fr) 15px; align-items: center; gap: 11px; min-width: 0; padding: 0 18px; border: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; transition: transform 0.18s cubic-bezier(0.22, 0.9, 0.32, 1.15); }
.runtime-item + .runtime-item { border-left: 1px solid var(--border); }
.runtime-item:hover { color: var(--accent-2); }
.runtime-item > svg:first-child { width: 27px; height: 27px; color: var(--text); }
.runtime-item > span { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.runtime-item small { color: var(--text-dim); font-size: 12px; }
.runtime-item strong { overflow: hidden; font-size: 13px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.runtime-chevron { width: 14px; height: 14px; color: var(--text-dim); opacity: 0.7; }
.runtime-state > svg:first-child { color: var(--accent-2); }
.runtime-state strong { display: flex; align-items: center; gap: 7px; color: var(--accent-2); }
.runtime-state i { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #9ca3af; }
.runtime-state.ready i, .runtime-state.running i { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
.runtime-state.error strong { color: var(--danger); }
.runtime-state.error i { background: var(--danger); box-shadow: 0 0 0 3px var(--danger-soft); }

.instances-block { min-width: 0; margin-top: 14px; }
.instances-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 13px; }
.instances-head h2 { font-size: 17px; font-weight: 750; display: flex; align-items: center; gap: 9px; }
/* 区块标题前的主题色短竖线：视觉锚点 */
.instances-head h2::before { content: ''; width: 4px; height: 17px; border-radius: 2px; background: var(--accent-grad); flex: none; }
.manage-instances { display: inline-flex; align-items: center; gap: 7px; min-height: 34px; padding: 0 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--card-2); color: var(--text-dim); font-family: inherit; font-size: 12px; font-weight: 550; cursor: pointer; }
.manage-instances:hover { color: var(--text); border-color: var(--border-strong); }
.manage-instances svg { width: 15px; height: 15px; }
.instance-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
/* Cards appear together so every action is available at the same time. */
.instance-card { position: relative; display: grid; grid-template-columns: 36px minmax(0, 1fr); grid-template-rows: 1fr auto; gap: 8px 8px; min-width: 0; height: 132px; min-height: 132px; padding: 17px 14px 13px; border: 1px solid var(--border); border-radius: 14px; background: color-mix(in srgb, var(--card) 82%, transparent); cursor: pointer; transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease, box-shadow 0.22s ease; animation: card-in var(--motion-enter) var(--ease-out) backwards; }
@keyframes card-in { from { opacity: 0; } to { opacity: 1; } }
.instance-card:hover { border-color: var(--border-strong); background: var(--card-2); transform: translateY(-1px); box-shadow: var(--shadow); }
.instance-card.selected { border-color: var(--accent-2); box-shadow: inset 0 0 0 1px var(--accent); }
.instance-icon { align-self: center; width: 36px; height: 36px; }
.instance-icon.image { object-fit: contain; image-rendering: pixelated; }
.instance-copy { grid-column: 2; padding-right: 7px; align-self: center; display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.instance-copy strong { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 13px; line-height: 1.4; font-weight: 650; overflow-wrap: anywhere; word-break: break-all; }
.instance-copy span, .instance-last { overflow: hidden; color: var(--text-dim); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.instance-more { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border: 0; border-radius: 7px; background: transparent; color: var(--text-dim); cursor: pointer; }
.instance-more:hover { background: var(--hover); color: var(--text); }
.instance-more svg { width: 15px; height: 15px; }
.instance-last { grid-column: 1 / -1; grid-row: 2; padding-right: 42px; align-self: center; }
.instance-play { grid-column: 2; grid-row: 2; display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 32px; justify-self: end; border: 0; border-radius: 8px; background: color-mix(in srgb, var(--accent) 18%, var(--card-2)); color: var(--accent-2); cursor: pointer; }
.instance-play:hover:not(:disabled) { background: var(--accent); color: var(--on-accent); }
.instance-play:disabled { opacity: 0.45; cursor: default; }
.instance-play svg { width: 15px; height: 15px; }
.empty-instances { width: 100%; min-height: 110px; border: 1px dashed var(--border-strong); border-radius: 13px; background: var(--card); color: var(--text-dim); cursor: pointer; }

.home-side { display: flex; min-width: 0; flex-direction: column; gap: 12px; }
.home-creator { margin-top: 0; border-color: color-mix(in srgb, var(--accent) 26%, var(--border)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 10%, transparent), var(--shadow); }
.account-panel, .skin-panel { border: 1px solid var(--border); border-radius: 15px; background: var(--surface-content); box-shadow: var(--shadow); }
.account-panel { min-height: 146px; padding: 18px; }
.account-head { display: flex; align-items: center; gap: 13px; }
.account-head :deep(.mc-avatar) { border-radius: 12px; box-shadow: 0 0 0 4px color-mix(in srgb, var(--text) 8%, transparent); }
.account-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 5px; }
.account-copy strong { overflow: hidden; font-size: 16px; text-overflow: ellipsis; white-space: nowrap; }
.account-copy span { display: flex; align-items: center; gap: 7px; color: var(--accent-2); font-size: 11px; }
.account-copy span i { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
.account-copy .offline-state { color: var(--text-dim); }
.account-more, .skin-refresh { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; color: var(--text-dim); cursor: pointer; }
.account-more:hover, .skin-refresh:hover:not(:disabled) { color: var(--text); background: var(--hover); }
.account-more svg, .skin-refresh svg { width: 17px; height: 17px; }
.account-placeholder { display: flex; align-items: center; justify-content: center; width: 54px; height: 54px; border: 1px dashed var(--border-strong); border-radius: 12px; color: var(--text-dim); font-size: 20px; }
.account-provider { display: grid; grid-template-columns: 26px minmax(0, 1fr) 15px; align-items: center; gap: 10px; width: 100%; min-height: 44px; margin-top: 15px; padding: 0 11px; border: 1px solid var(--border); border-radius: 9px; background: var(--card-2); color: var(--text); font-family: inherit; font-size: 12px; font-weight: 550; text-align: left; cursor: pointer; }
.provider-mark.microsoft { background: transparent; border-radius: 0; }
.provider-mark.microsoft svg { width: 22px; height: 22px; }
.account-provider:hover { border-color: var(--border-strong); }
.account-provider > svg { width: 15px; height: 15px; color: var(--text-dim); }
.provider-mark { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; background: linear-gradient(135deg, #f35325 0 48%, #81bc06 48% 100%); color: #fff; font-size: 10px; font-weight: 800; }
.provider-mark.yggdrasil { background: linear-gradient(135deg, #65bd78, #268e54); }
.provider-mark.offline { background: var(--card); color: var(--text-dim); }

.skin-panel { min-height: 400px; padding: 16px 15px 12px; }
.skin-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 0 2px 8px; }
.skin-head > div { display: flex; flex-direction: column; gap: 3px; }
.skin-head h3 { font-size: 14px; font-weight: 700; }
.skin-head span { color: var(--text-dim); font-size: 10px; }
.skin-refresh:disabled { opacity: 0.4; cursor: default; }
.skin-refresh .spinning { animation: spin 0.8s linear infinite; }
.skin-stage { position: relative; height: 300px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--border) 78%, transparent); border-radius: 12px; background: radial-gradient(circle at 50% 82%, color-mix(in srgb, var(--accent) 13%, transparent), transparent 38%), linear-gradient(180deg, transparent, color-mix(in srgb, var(--bg) 18%, transparent)); }
.skin-stage :deep(.viewer3d) { height: 100%; --sv3d-height: 100%; background: transparent; }

.skin-overlay { position: absolute; z-index: 2; right: 12px; bottom: 12px; left: 12px; display: flex; min-height: 34px; align-items: center; justify-content: center; gap: 9px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 9px; background: color-mix(in srgb, var(--card) 78%, transparent); color: var(--text-dim); font-family: inherit; font-size: 11px; font-weight: 550; backdrop-filter: blur(12px); }
.skin-overlay.action { cursor: pointer; }
.skin-overlay.action:hover { color: var(--text); }
.skin-overlay.error { color: var(--danger); }
.skin-tip { display: flex; align-items: center; justify-content: center; gap: 5px; width: 100%; margin-top: 8px; border: 0; background: transparent; color: var(--text-dim); font-family: inherit; font-size: 10px; font-weight: 500; cursor: pointer; }
.skin-tip:hover { color: var(--accent-2); }
.skin-tip svg { width: 12px; height: 12px; }

.menu-overlay { position: fixed; inset: 0; z-index: 8000; }
.float-menu { position: fixed; z-index: 8001; max-height: 280px; overflow-y: auto; padding: 6px; border: 1px solid var(--border); border-radius: 10px; background: color-mix(in srgb, var(--card) 94%, transparent); box-shadow: var(--shadow-lg); backdrop-filter: blur(24px); }
.card-float-menu { width: 232px; max-height: 340px; background: var(--card-solid, #192225); }
.card-float-menu .menu-item { min-height: 40px; font-size: 13px; }
.menu-item:disabled { opacity: .45; cursor: not-allowed; }
.menu-item { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 34px; padding: 0 10px; border: 0; border-radius: 7px; background: transparent; color: var(--text); font-family: inherit; font-size: 12px; font-weight: 500; text-align: left; cursor: pointer; }
.menu-item:hover, .menu-item.active { background: var(--accent-soft); color: var(--accent-2); }
.menu-item.danger { color: var(--danger); }
.menu-spacer { width: 12px; flex: none; }
.menu-empty { padding: 20px 8px; color: var(--text-dim); font-size: 12px; text-align: center; }

.log-mask { position: fixed; z-index: 9100; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--mask); backdrop-filter: blur(5px); }
.log-dialog { display: flex; width: min(760px, calc(100vw - 64px)); max-height: min(620px, calc(100vh - 80px)); flex-direction: column; overflow: hidden; border: 1px solid var(--border); border-radius: 16px; background: color-mix(in srgb, var(--card) 94%, transparent); box-shadow: var(--shadow-lg); }
.log-dialog header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid var(--border); }
.log-dialog header div { display: flex; flex-direction: column; gap: 3px; }
.log-dialog h3 { font-size: 16px; }
.log-dialog header span { color: var(--text-dim); font-size: 11px; }
.log-close { width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--text-dim); font-size: 20px; cursor: pointer; }
.log-close:hover { background: var(--hover); color: var(--text); }
.log-failure { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 18px; background: var(--danger-soft); color: var(--danger); font-size: 12px; }
.log-failure button { padding: 6px 10px; border: 1px solid var(--danger-border); border-radius: 7px; background: transparent; color: var(--danger); cursor: pointer; }
.log-body { min-height: 220px; flex: 1; overflow: auto; padding: 14px 18px; background: color-mix(in srgb, var(--bg) 42%, transparent); user-select: text; }
.log-body pre { display: flex; flex-direction: column; color: var(--text-dim); font: 11.5px/1.65 'Cascadia Code', Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
.log-empty { padding: 70px 0; color: var(--text-dim); text-align: center; }
.log-dialog footer { display: flex; justify-content: flex-end; padding: 11px 16px; border-top: 1px solid var(--border); }

@media (max-width: 1180px) {
  .home-dashboard { grid-template-columns: minmax(0, 1fr) 248px; gap: 12px; }
  .hero-content { padding: 38px 26px 25px; }
  .launch-combo { min-width: 242px; height: 62px; }
  .launch-main { padding: 0 16px; font-size: 17px; }
  .launch-arrow { width: 50px; }
  .hero-settings { min-width: 126px; padding: 0 13px; }
  .hero-more { width: 46px; }
  .runtime-item { grid-template-columns: 28px minmax(0, 1fr); padding: 0 12px; }
  .runtime-item > svg:first-child { width: 23px; height: 23px; }
  .runtime-chevron { display: none; }
  .instance-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 1010px) {
  .home-dashboard { grid-template-columns: minmax(0, 1fr) 226px; }
  .hero-card { min-height: 320px; }
  .hero-content h1 { font-size: 42px; }
  .hero-actions { gap: 10px; }
  .hero-settings { min-width: 112px; font-size: 12px; }
  .launch-combo { min-width: 210px; }
  .launch-main { font-size: 15px; }
  .runtime-item { padding: 0 9px; gap: 8px; }
  .runtime-item strong { font-size: 11px; }
  .skin-panel { padding-inline: 10px; }
}

@media (max-width: 1080px) {
  .hero-actions { flex-wrap: wrap; align-items: stretch; gap: 12px; }
  .hero-secondary-actions { width: 100%; }
  .hero-settings { height: 38px; flex: 1; }
  .hero-more { height: 38px; }
  .launch-combo { width: 100%; min-width: 0; height: 54px; }
  .hero-content { padding: 24px; }
  .hero-content h1, .hero-content h1.long-name { font-size: clamp(25px, 3.2vw, 36px); }
  .hero-metadata-slot { min-height: 110px; }
  .hero-edition { font-size: 14px; margin-top: 10px; }
}

@media (max-height: 760px) {
  .home-dashboard { min-height: 660px; }
  .hero-card { height: 340px; }
  .hero-content { padding-top: 30px; }
  .skin-stage { height: 230px; }
  .skin-panel { min-height: 322px; }
}

.home-dashboard{grid-template-columns:minmax(0,1fr) minmax(250px,290px);gap:16px}.hero-card{height:var(--banner-h);max-height:360px;min-height:320px}.hero-content{padding:24px;justify-content:space-between}.hero-metadata-slot{min-height:0}.hero-kicker{font-size:12px;align-self:flex-start;padding:5px 10px}.hero-content h1,.hero-content h1.long-name{font-size:clamp(24px,2.6vw,32px);line-height:1.25;max-width:100%;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.hero-edition{margin-top:8px;gap:10px}.hero-game-version{font-size:15px}.launch-main{min-height:56px;min-width:180px;font-size:21px;padding:0 24px}.launch-arrow{width:48px}.hero-actions{gap:12px;flex-wrap:wrap}.runtime-strip{min-height:68px;padding:8px}.runtime-item{padding:10px 12px}.instance-grid{display:flex!important;flex-direction:column;gap:0}.home-dashboard .instance-card{display:grid;grid-template-columns:36px minmax(0,1fr) auto 36px 40px;gap:12px;align-items:center;min-height:72px;height:auto;padding:12px;border:0;border-bottom:1px solid var(--border);border-radius:0;box-shadow:none;background:transparent}.instance-card.selected{background:var(--accent-soft)}.instance-card:hover{background:var(--hover)}.instance-card .instance-icon{width:36px;height:36px}.instance-card .instance-copy{min-width:0}.instance-copy strong{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:normal}.instance-copy span{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.instance-more,.instance-last,.instance-play{position:static;margin:0;grid-row:1}.instance-last{grid-column:3;font-size:12px;white-space:nowrap}.instance-more{grid-column:4}.instance-play{grid-column:5;width:40px;height:34px}.instances-block{background:var(--surface-content);border-radius:var(--radius-lg);padding:16px}.instances-head{margin-bottom:8px}.account-panel{border-radius:var(--radius-lg) var(--radius-lg) 0 0;border-bottom:0;box-shadow:none;padding:16px}.skin-panel{border-radius:0 0 var(--radius-lg) var(--radius-lg);margin-top:-16px;border-top:0;box-shadow:none;padding:16px}.skin-stage{height:260px;min-height:220px}.account-head{gap:10px}.home-side{gap:16px}.home-creator{box-shadow:none;margin-top:0}.hero-shade{background:linear-gradient(180deg,rgba(0,0,0,.16),rgba(0,0,0,.18) 30%,rgba(0,0,0,.68))}
@media(max-width:1100px){.home-dashboard{grid-template-columns:minmax(0,1fr)}.home-side{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}.account-panel{border-radius:var(--radius-lg)}.skin-panel{margin-top:0;border-radius:var(--radius-lg);grid-column:2;grid-row:1/3}.home-creator{grid-column:1}.hero-card{max-height:360px}}@media(max-width:700px){.home-side{grid-template-columns:minmax(0,1fr)}.skin-panel,.home-creator{grid-column:1;grid-row:auto}.home-dashboard .instance-card{grid-template-columns:28px minmax(0,1fr) 32px 36px;gap:8px}.instance-last{grid-row:2;grid-column:2;font-size:12px}.instance-more{grid-column:3}.instance-play{grid-column:4}.hero-content{padding:16px}.launch-main{min-width:140px}.runtime-strip{flex-wrap:wrap}.runtime-item{min-width:140px}.hero-card{min-height:330px}}

.home-side{align-self:start}.skin-panel{flex:none;min-height:0}.home-side .skin-stage{height:230px;min-height:0}.skin-panel .skin-tip{margin-bottom:0}.account-panel{padding:16px}.hero-card .hero-image{object-position:center 42%}
</style>
