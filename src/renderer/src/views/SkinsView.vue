<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  changeCape,
  deleteSkinHistory,
  errText,
  getSkinHistory,
  getSkinProfile,
  renameSkinHistory,
  uploadSkin,
  uploadSkinFromHistory
} from '../api'
import { store, toast } from '../store'
import { renderCape, renderSkinFront } from '../skin-render'
import SkinViewer3D from '../components/SkinViewer3D.vue'
import SkinEditor from '../components/SkinEditor.vue'
const editorOpen = ref(false)
import type { CapeInfo, ProfileSkins, SkinHistoryEntry, SkinVariant } from '@shared/types'

/** 仅微软正版账号可用 */
const isMs = computed(() => store.selectedAccount?.type === 'microsoft')
const isExternal = computed(() => store.selectedAccount?.type === 'yggdrasil')
const canViewProfile = computed(() => isMs.value || isExternal.value)

/** 历史皮肤重命名输入框自动聚焦 */
const vFocus = { mounted: (el: HTMLElement) => el.focus() }

// ---------------- 档案 ----------------
const profile = ref<ProfileSkins | null>(null)
const loadingProfile = ref(false)

const currentSkin = computed(() => profile.value?.skins[0] ?? null)
const currentVariant = computed<SkinVariant>(() =>
  currentSkin.value?.variant === 'slim' ? 'slim' : 'classic'
)
const capes = computed(() => profile.value?.capes ?? [])
/** 使用中的披风直接传给 3D 人偶渲染 */
const activeCape = computed(() => capes.value.find((c) => c.active)?.dataUrl ?? '')

let profileRequest = 0, historyRequest = 0
const profileError = ref(''), historyError = ref('')
onUnmounted(() => { profileRequest++; historyRequest++ })
async function loadProfile() {
  const request = ++profileRequest; profileError.value = ''
  loadingProfile.value = true
  try {
    const next = await getSkinProfile()
    if (request !== profileRequest) return
    profile.value = next
    void renderCapes()
  } catch (e) {
    if (request === profileRequest) profileError.value = errText(e)
  } finally {
    if (request === profileRequest) loadingProfile.value = false
  }
}

// ---------------- 3D 预览控制 ----------------
const viewerRef = ref<InstanceType<typeof SkinViewer3D> | null>(null)
/** 行走 / 待机动画切换 */
const previewAnim = ref<'walk' | 'idle'>('walk')

/** 行走/待机分段控件滑动块（与导航水滴/游戏 Tab 同款弹簧动效） */
const animSeg = ref<HTMLElement | null>(null)
const animSegBlob = reactive({ left: 0, width: 0, on: false })
function updateAnimSegBlob() {
  const root = animSeg.value
  if (!root) return
  const active = root.querySelector<HTMLElement>(`.seg-btn[data-seg="${previewAnim.value}"]`)
  if (!active) return
  animSegBlob.left = active.offsetLeft
  animSegBlob.width = active.offsetWidth
  animSegBlob.on = true
}
watch(previewAnim, () => nextTick(updateAnimSegBlob))
let animSegObserver: ResizeObserver | null = null
onMounted(() => {
  nextTick(updateAnimSegBlob)
  setTimeout(updateAnimSegBlob, 200)
  animSegObserver = new ResizeObserver(() => updateAnimSegBlob())
  if (animSeg.value) animSegObserver.observe(animSeg.value)
  watch(() => store.settings?.theme, () => nextTick(() => setTimeout(updateAnimSegBlob, 60)))
})
onUnmounted(() => animSegObserver?.disconnect())
const animSegBlobStyle = computed(() => ({
  left: animSegBlob.left + 'px',
  width: animSegBlob.width + 'px',
  opacity: animSegBlob.on ? 1 : 0
}))

// ---------------- 披风 ----------------
const capeRenders = ref<Record<string, string>>({})
const capeBusy = ref<string | null>(null)

async function renderCapes() {
  const request = profileRequest
  const map: Record<string, string> = {}
  for (const c of capes.value) {
    if (c.dataUrl) map[c.id] = await renderCape(c.dataUrl, 100, 160)
  }
  if (request === profileRequest) capeRenders.value = map
}

/** 点击披风：使用中 → 卸下；其他 → 激活 */
async function onCapeClick(c: CapeInfo) {
  if (!isMs.value) return
  if (capeBusy.value) return
  capeBusy.value = c.id
  try {
    profile.value = await changeCape(c.active ? null : c.id)
    toast(c.active ? '已卸下披风' : `已换上披风「${c.alias}」`, 'success')
  } catch (e) {
    toast('披风更换失败：' + errText(e), 'error')
  } finally {
    capeBusy.value = null
  }
}

// ---------------- 历史皮肤 ----------------
const historyList = ref<SkinHistoryEntry[]>([])
const historyRenders = ref<Record<string, string>>({})
const loadingHistory = ref(false)
const historyBusy = ref<string | null>(null)

/** 历史皮肤搜索（即时过滤：按显示名或记录 id） */
const historySearch = ref('')
const filteredHistory = computed(() => {
  const kw = historySearch.value.trim().toLowerCase()
  if (!kw) return historyList.value
  return historyList.value.filter(
    (item) =>
      (item.name || '').toLowerCase().includes(kw) || item.id.toLowerCase().includes(kw)
  )
})

/** 历史皮肤重命名（点击文件名进入编辑，回车/失焦保存，Esc 取消） */
const historyRenaming = ref('')
const historyRenameText = ref('')

function startHistoryRename(item: SkinHistoryEntry) {
  historyRenaming.value = item.id
  historyRenameText.value = item.name || ''
}
function cancelHistoryRename() {
  historyRenaming.value = ''
  historyRenameText.value = ''
}
async function commitHistoryRename(item: SkinHistoryEntry) {
  // Enter 会卸载输入框并触发 blur；同一次编辑只能提交一次，Esc 后也不能再保存。
  if (historyRenaming.value !== item.id) return
  const name = historyRenameText.value.trim()
  const old = item.name || ''
  cancelHistoryRename()
  if (name === old) return
  try {
    historyList.value = await renameSkinHistory(item.id, name)
    toast(name ? `已重命名为「${name}」` : '已恢复默认名称', 'success')
  } catch (e) {
    toast('重命名失败：' + errText(e), 'error')
  }
}

/** 历史记录的显示名：优先自定义名/源文件名，回退记录 id */
function historyDisplayName(item: SkinHistoryEntry): string {
  return item.name || `${item.id}.png`
}

async function loadHistory() {
  const request = ++historyRequest; historyError.value = ''
  loadingHistory.value = true
  try {
    const next = await getSkinHistory()
    if (request !== historyRequest) return
    historyList.value = next
    const map: Record<string, string> = {}
    for (const item of historyList.value) {
      map[item.id] = await renderSkinFront(item.dataUrl, 6)
    }
    if (request === historyRequest) historyRenders.value = map
  } catch (e) {
    if (request === historyRequest) historyError.value = errText(e)
  } finally {
    if (request === historyRequest) loadingHistory.value = false
  }
}

/** 换回历史皮肤：主进程走标准上传流程并返回最新档案 */
async function onRestore(item: SkinHistoryEntry) {
  if (historyBusy.value) return
  historyBusy.value = item.id
  try {
    profile.value = await uploadSkinFromHistory(item.id)
    toast('已换回历史皮肤', 'success')
    void loadHistory()
  } catch (e) {
    toast('换回皮肤失败：' + errText(e), 'error')
  } finally {
    historyBusy.value = null
  }
}

async function onDeleteHistory(item: SkinHistoryEntry) {
  if (historyBusy.value) return
  historyBusy.value = item.id
  try {
    historyList.value = await deleteSkinHistory(item.id)
    const map = { ...historyRenders.value }
    delete map[item.id]
    historyRenders.value = map
    toast('历史皮肤已移入回收站', 'success')
  } catch (e) {
    toast('删除失败：' + errText(e), 'error')
  } finally {
    historyBusy.value = null
  }
}

// ---------------- 待上传皮肤（选择 / 拖拽） ----------------
const pending = ref<{ path: string; name: string } | null>(null)
const pendingDataUrl = ref('')
const variant = ref<SkinVariant>('classic')
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('读取文件失败'))
    r.readAsDataURL(f)
  })
}

/** 统一入口：文件选择框与拖拽都来此 */
async function pickFile(f: File | undefined | null) {
  if (!isMs.value) return
  if (!f) return
  if (!/\.png$/i.test(f.name)) {
    toast('请选择 PNG 格式的皮肤文件', 'error')
    return
  }
  const p = window.kamucl.getFilePath(f)
  if (!p) {
    toast('无法获取文件路径', 'error')
    return
  }
  pending.value = { path: p, name: f.name }
  try {
    pendingDataUrl.value = await fileToDataUrl(f)
  } catch {
    pendingDataUrl.value = ''
  }
}

function onInputChange(e: Event) {
  const input = e.target as HTMLInputElement
  void pickFile(input.files?.[0])
  input.value = '' // 允许再次选择同一文件
}

function clearPending() {
  pending.value = null
  pendingDataUrl.value = ''
}

async function doUpload() {
  if (!pending.value || uploading.value) return
  uploading.value = true
  try {
    profile.value = await uploadSkin(pending.value.path, variant.value)
    toast('皮肤上传成功', 'success')
    clearPending()
    void loadHistory()
  } catch (e) {
    toast('皮肤上传失败：' + errText(e), 'error')
  } finally {
    uploading.value = false
  }
}

// ---------------- 卡片拖拽（stop 防止冒泡到 App 的整合包导入） ----------------
const dragOver = ref(false)
let dragDepth = 0
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

function onCardDragEnter(e: DragEvent) {
  if (!hasFiles(e)) return
  dragDepth++
  dragOver.value = true
}

function onCardDragOver(e: DragEvent) {
  if (!hasFiles(e)) return
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dragOver.value = true
}

function onCardDragLeave(e: DragEvent) {
  if (!hasFiles(e)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragOver.value = false
}

function onCardDrop(e: DragEvent) {
  if (!hasFiles(e)) return
  dragDepth = 0
  dragOver.value = false
  void pickFile(e.dataTransfer?.files?.[0])
}

// ---------------- 工具 ----------------
function fmtTime(t: number): string {
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------------- 生命周期 ----------------
function loadAll() {
  void loadProfile()
  if (isMs.value) void loadHistory()
}

onMounted(() => {
  if (canViewProfile.value) loadAll()
})

/** 切换账号后重置并重新加载 */
watch(
  () => store.selectedAccount?.id,
  () => {
    profileRequest++; historyRequest++; loadingProfile.value = false; loadingHistory.value = false; profileError.value = ''; historyError.value = ''
    profile.value = null
    historyList.value = []
    historyRenders.value = {}
    capeRenders.value = {}
    clearPending()
    if (canViewProfile.value) loadAll()
  }
)
</script>

<template>
  <div data-ui="SkinsView:79bfa9f178a8" class="page skins-page">
    <SkinEditor v-if="editorOpen" :current="currentSkin?.dataUrl" :variant="currentVariant" @close="editorOpen=false" @uploaded="loadAll" />
    <div data-ui="SkinsView:483ce0fd91a6" class="page-head">
      <div class="skin-page-heading"><h1 data-ui="SkinsView:b30aa0d910d4" class="page-title">皮肤与披风</h1>
      <p data-ui="SkinsView:dc0d51be1910" class="page-sub">
        {{ isExternal ? `查看 ${store.selectedAccount?.providerName ?? '外置皮肤站'} 的角色材质` : '管理微软正版账号的皮肤与披风' }}
      </p></div>
      <button class="btn btn-gold skin-editor-entry" @click="editorOpen=true">绘制皮肤</button>
    </div>

    <!-- 非微软账号：整页引导 -->
    <div data-ui="SkinsView:bd24ad0997f2" v-if="!canViewProfile" class="card empty need-ms">
      <svg class="need-ms-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="m9 4-6 3 2 5 3-1v9h8v-9l3 1 2-5-6-3a3 3 0 0 1-6 0Z" />
      </svg>
      <p data-ui="SkinsView:b00f59b6449e" class="need-ms-text">皮肤与披风需要微软正版账号或外置 Yggdrasil 账号</p>
      <button data-ui="SkinsView:81397b7fad2a" class="btn btn-gold" @click="store.currentView = 'accounts'">去登录</button>
    </div>

    <template v-else>
      <!-- ============ 第一行：3D 预览 + 当前皮肤（40% / 60%，窄窗自动换行） ============ -->
      <div data-ui="SkinsView:09d4cbffd159"
        class="row-main"
        :class="{ 'drag-over': dragOver }"
        @dragenter.stop.prevent="onCardDragEnter"
        @dragover.stop.prevent="onCardDragOver"
        @dragleave.stop.prevent="onCardDragLeave"
        @drop.stop.prevent="onCardDrop"
      >
        <!-- 左：3D 人偶预览 -->
        <section data-ui="SkinsView:6a4cd6686688" class="card pane pane-preview">
          <header class="pane-head">
            <h3 class="pane-title">3D 预览</h3>
            <div data-ui="SkinsView:bb4ca04a6667" v-if="!loadingProfile && currentSkin?.dataUrl" class="pane-tools">
              <div data-ui="SkinsView:66970b2bfb5f" class="seg" ref="animSeg" role="group" aria-label="动画模式">
                <span data-ui="SkinsView:aaed9003b2f3" class="seg-blob" :style="animSegBlobStyle" aria-hidden="true"></span>
                <button data-ui="SkinsView:5de01b07fe8b"
                  class="seg-btn"
                  data-seg="walk"
                  :class="{ active: previewAnim === 'walk' }"
                  @click="previewAnim = 'walk'"
                >
                  行走
                </button>
                <button data-ui="SkinsView:16d5c8eb50e9"
                  class="seg-btn"
                  data-seg="idle"
                  :class="{ active: previewAnim === 'idle' }"
                  @click="previewAnim = 'idle'"
                >
                  待机
                </button>
              </div>
              <button data-ui="SkinsView:1350e68d93c0" class="icon-btn" title="回正视角" @click="viewerRef?.resetView()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="7.5" />
                  <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
                </svg>
              </button>
            </div>
          </header>
          <div data-ui="SkinsView:69891078db9e" class="preview-3d">
            <template v-if="!loadingProfile && currentSkin?.dataUrl">
              <SkinViewer3D
                ref="viewerRef"
                :src="currentSkin.dataUrl"
                :variant="currentVariant"
                :animation="previewAnim"
                :cape="activeCape"
              />
              <p data-ui="SkinsView:50827644b628" class="muted viewer-tip">拖动旋转 · 滚轮缩放 · 双击回正</p>
            </template>
            <div data-ui="SkinsView:e868aac3a5b8" v-else class="preview-3d-empty">
              <span data-ui="SkinsView:931587e4968d" v-if="loadingProfile" class="spin"></span>
              <div data-ui="SkinsView:2612f1d28a75" v-else class="preview-placeholder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21v-1a8 8 0 0 1 16 0v1" />
                </svg>
                <span>暂无皮肤</span>
              </div>
            </div>
          </div>
        </section>

        <!-- 右：当前皮肤信息与上传 -->
        <div class="skin-operation-panel">
        <section data-ui="SkinsView:8be659224d2f" class="card pane pane-info">
          <div data-ui="SkinsView:36f73e18abbe" v-if="profileError" class="status-strip error" role="alert">读取皮肤失败：{{ profileError }}<button data-ui="SkinsView:73348961dd1a" class="btn btn-ghost" @click="loadProfile">重试</button></div>
          <header class="pane-head">
            <h3 class="pane-title">当前皮肤</h3>
            <span data-ui="SkinsView:636efe9c920f" class="tag" :class="currentVariant === 'slim' ? 'tag-cyan' : 'tag-gold'">
              {{ currentVariant === 'slim' ? '纤细 Slim' : '经典 Classic' }}
            </span>
          </header>

          <div data-ui="SkinsView:30eab3450632" class="skin-name-row">
            <span data-ui="SkinsView:ed498f5909bf" class="skin-username">{{ profile?.username || store.selectedAccount?.username }}</span>
          </div>

          <!-- 待上传文件 -->
          <div data-ui="SkinsView:9ae4ea0309a4" v-if="isMs && pending" class="pending-box">
            <div data-ui="SkinsView:15c4e36a7b28" class="pending-viewer">
              <SkinViewer3D v-if="pendingDataUrl" :src="pendingDataUrl" :variant="variant" />
            </div>
            <div data-ui="SkinsView:b106466a5379" class="pending-meta">
              <span data-ui="SkinsView:8de65fd7bef0" class="pending-name" :title="pending.name">{{ pending.name }}</span>
              <div data-ui="SkinsView:5351ef1f918a" class="seg">
                <button data-ui="SkinsView:a9baa001dcb8"
                  class="seg-btn"
                  :class="{ active: variant === 'classic' }"
                  @click="variant = 'classic'"
                >
                  经典 Classic
                </button>
                <button data-ui="SkinsView:25ab876996cc"
                  class="seg-btn"
                  :class="{ active: variant === 'slim' }"
                  @click="variant = 'slim'"
                >
                  纤细 Slim
                </button>
              </div>
            </div>
            <button data-ui="SkinsView:dbcfe6eb10f9" class="icon-btn" title="移除待上传文件" @click="clearPending">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          <div data-ui="SkinsView:2ce0dc456e94" v-if="isMs" class="skin-actions">
            <button data-ui="SkinsView:45688b94a733" class="btn btn-ghost" @click="fileInput?.click()">选择皮肤文件…</button>
            <button data-ui="SkinsView:18b48238d441" class="btn btn-gold" :disabled="!pending || uploading" @click="doUpload">
              {{ uploading ? '上传中…' : '上传' }}
            </button>
          </div>
          <p data-ui="SkinsView:aa2915a1b866" v-if="isMs" class="muted skin-hint">支持 64×64 的 PNG 皮肤文件</p>
          <div data-ui="SkinsView:252d1a5f5b2f" v-else class="external-skin-note">
            <span data-ui="SkinsView:d35771891dd7" class="tag tag-cyan">{{ store.selectedAccount?.providerName }}</span>
            <p data-ui="SkinsView:d7b70906b3c5" class="muted skin-hint">外置账号的皮肤与披风由所属皮肤站管理；KAMUCL 会读取并在启动时加载当前材质。</p>
          </div>

          <input data-ui="SkinsView:e63f2137c12b"
            ref="fileInput"
            type="file"
            accept=".png,image/png"
            class="hidden-input"
            @change="onInputChange"
          />
        </section>

        <div data-ui="SkinsView:de1900d63ab5" v-if="dragOver" class="drag-hint">松开以选择皮肤文件</div>
        <section data-ui="SkinsView:b5f0f1bd543a" class="card pane pane-capes">
          <header class="pane-head">
            <h3 class="pane-title">披风（{{ capes.length }}）</h3>
          </header>
          <div data-ui="SkinsView:0f570e391601" v-if="loadingProfile" class="empty pane-empty"><span class="spin"></span></div>
          <div data-ui="SkinsView:23e5aa429fa5" v-else-if="!capes.length" class="empty pane-empty">
            <span>该账号暂无披风</span>
          </div>
          <div data-ui="SkinsView:b74774f82cbb" v-else class="cape-grid">
            <button data-ui="SkinsView:cef45a945c20"
              v-for="c in capes"
              :key="c.id"
              class="cape-item"
              :class="{ active: c.active }"
              :disabled="capeBusy !== null || isExternal"
              :title="isExternal ? '请在所属皮肤站管理披风' : c.active ? '点击卸下披风' : '点击使用该披风'"
              @click="onCapeClick(c)"
            >
              <div data-ui="SkinsView:ef385c3e5a89" class="cape-preview">
                <img data-ui="SkinsView:f3c3ca0681c7" v-if="capeRenders[c.id]" :src="capeRenders[c.id]" class="cape-img" :alt="c.alias" />
                <span data-ui="SkinsView:066f80062d81" v-else class="cape-alias">{{ c.alias }}</span>
              </div>
              <span data-ui="SkinsView:ecfe9b1c09a5" class="cape-name">{{ c.alias }}</span>
              <span data-ui="SkinsView:d40a5d07ca29" class="cape-state">
                <span data-ui="SkinsView:1816d05e22d8" v-if="capeBusy === c.id" class="spin"></span>
                <span data-ui="SkinsView:b5509fdec2ff" v-else-if="c.active" class="tag tag-gold">使用中</span>
              </span>
            </button>
          </div>
        </section>

        </div>
        <section data-ui="SkinsView:7bae5dc497d8" v-if="isMs" class="card pane pane-history">
          <header class="pane-head">
            <h3 class="pane-title">历史皮肤（{{ historyList.length }}）</h3>
            <input data-ui="SkinsView:eae2262398f8"
              v-if="historyList.length"
              v-model="historySearch"
              class="input history-search"
              placeholder="搜索文件名…"
              title="按文件名即时筛选历史皮肤"
            />
          </header>
          <div data-ui="SkinsView:07a35fa3d13e" v-if="historyError" class="status-strip error">读取历史失败：{{ historyError }}<button data-ui="SkinsView:795ecc15b13b" class="btn btn-ghost" @click="loadHistory">重试</button></div>
          <div data-ui="SkinsView:7cb3faa3d3a0" v-else-if="loadingHistory && !historyList.length" class="empty pane-empty"><span class="spin"></span></div>
          <div data-ui="SkinsView:30798d037a0e" v-else-if="!historyList.length" class="empty pane-empty">
            <span>暂无历史皮肤，上传皮肤后会自动保存到这里，方便随时换回</span>
          </div>
          <div data-ui="SkinsView:cb559646d8cc" v-else-if="!filteredHistory.length" class="empty pane-empty">
            <span>没有匹配「{{ historySearch }}」的历史皮肤</span>
          </div>
          <div data-ui="SkinsView:c57cc36b5fe3" v-else class="history-grid">
            <div data-ui="SkinsView:2848a3535fdf" v-for="item in filteredHistory" :key="item.id" class="history-item">
              <div data-ui="SkinsView:915113e01369" class="history-preview">
                <img data-ui="SkinsView:93154017e1c0"
                  :src="historyRenders[item.id] || item.dataUrl"
                  class="history-img"
                  alt="历史皮肤"
                />
                <div data-ui="SkinsView:e8374fa9d9a7" class="history-overlay">
                  <button data-ui="SkinsView:96c3c4ae26c7"
                    class="btn btn-gold btn-sm"
                    :disabled="historyBusy !== null"
                    @click="onRestore(item)"
                  >
                    {{ historyBusy === item.id ? '处理中…' : '换回' }}
                  </button>
                  <button data-ui="SkinsView:18710f6d05c6"
                    class="btn btn-danger btn-sm"
                    :disabled="historyBusy !== null"
                    @click="onDeleteHistory(item)"
                  >
                    删除
                  </button>
                </div>
              </div>
              <div data-ui="SkinsView:30559af409bc" class="history-meta">
                <span data-ui="SkinsView:6db94431a918" class="tag" :class="item.variant === 'slim' ? 'tag-cyan' : 'tag-gold'">
                  {{ item.variant === 'slim' ? '纤细' : '经典' }}
                </span>
                <span data-ui="SkinsView:cf1055002679" class="muted history-time">{{ fmtTime(item.time) }}</span>
              </div>
              <div data-ui="SkinsView:664da1b81a10" class="history-name-row">
                <input data-ui="SkinsView:13bf75e97efb"
                  v-if="historyRenaming === item.id"
                  v-model="historyRenameText"
                  class="input history-name-input"
                  :placeholder="item.id + '.png'"
                  @keydown.enter="!$event.isComposing && commitHistoryRename(item)"
                  @keydown.esc="cancelHistoryRename"
                  @blur="commitHistoryRename(item)"
                  v-focus
                />
                <span data-ui="SkinsView:4691c713a4de"
                  v-else
                  class="history-name"
                  :title="`${historyDisplayName(item)}（点击重命名）`"
                  @click="startHistoryRename(item)"
                >{{ historyDisplayName(item) }}</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.row-sub { align-items:flex-start !important; }
.no-history .pane-history .pane-empty { min-height:0; padding:20px 0; }
.pane-preview,.pane-info,.pane-capes,.pane-history { min-width:min(100%,280px) !important; }
@media(max-width:1050px) { .pane-preview,.pane-capes { max-width:100% !important; } }

/* ================= 页面骨架：区块排「行」，行内横向分栏，窄窗换行 ================= */
.skins-page {
  display: flex;
  flex-direction: column;
  gap: var(--sec-gap);
  max-width: 1080px;
  margin: 0 auto;
}
.skins-page .page-title {
  font-size: var(--text-xl);
  font-weight: 700;
}
.skins-page .page-sub {
  font-size: var(--text-xs);
  color: var(--text-dim);
}
/* 毛玻璃卡片：内边距 / 圆角 / 背景模糊统一走令牌 */
.skins-page .card {
  padding: var(--card-pad);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(24px) saturate(130%);
  -webkit-backdrop-filter: blur(24px) saturate(130%);
}
.row-main,
.row-sub {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: var(--card-gap);
}
/* 预览区 ≈40%、信息区 ≈60%（FCL 主页比例参考），各自带最小宽度以便窄窗换行 */
.pane-preview {
  flex: 1 1 380px;
  max-width: 40%;
  min-width: 330px;
}
.pane-info {
  flex: 2 1 420px;
  min-width: 330px;
}
.pane-capes {
  flex: 1 1 380px;
  max-width: 40%;
  min-width: 300px;
}
.pane-history {
  flex: 2 1 420px;
  min-width: 320px;
}
.row-main {
  transition: box-shadow 0.18s ease;
}
.row-main.drag-over {
  box-shadow: 0 0 0 3px var(--accent-soft);
}
@media (max-width: 820px) {
  .pane-preview,
  .pane-info,
  .pane-capes,
  .pane-history {
    flex: 1 1 100%;
    max-width: none;
  }
}

/* ================= 卡片头：标题行高 ≥ --row-h，控件垂直居中 ================= */
.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: var(--row-h);
  margin-bottom: var(--space-2);
}
.pane-title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 700;
}
.pane-tools {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.pane-tools .icon-btn {
  width: var(--ctl-h);
  height: var(--ctl-h);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.pane-tools .icon-btn svg {
  width: 16px;
  height: 16px;
}
.pane-empty {
  padding: var(--space-5);
  font-size: var(--text-xs);
  color: var(--text-dim);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
}

/* ================= 3D 预览 ================= */
.preview-3d {
  --sv3d-height: 380px;
  position: relative;
}
.preview-3d-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--sv3d-height);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--card-2);
  overflow: hidden;
}
.viewer-tip {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-dim);
  text-align: center;
}
.preview-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-dim);
  font-size: var(--text-xs);
}
.preview-placeholder svg {
  width: 40px;
  height: 40px;
  opacity: 0.6;
}
.drag-hint {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent-2);
  font-size: var(--text-sm);
  font-weight: 600;
  text-align: center;
  padding: 0 var(--space-4);
  pointer-events: none;
}

/* ================= 当前皮肤信息 ================= */
.skin-name-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--row-h);
}
.skin-username {
  font-size: var(--text-lg);
  font-weight: 700;
}

/* 待上传 */
.pending-box {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--row-h);
  padding: var(--space-3);
  border: 1px solid var(--accent);
  border-radius: var(--radius-md);
  background: var(--accent-soft);
}
.pending-viewer {
  width: 132px;
  flex-shrink: 0;
  --sv3d-height: 176px;
}
.pending-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}
.pending-name {
  font-size: var(--text-sm);
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* 模型分段选择 */
.seg {
  position: relative;
  display: inline-flex;
  align-items: stretch;
  gap: 2px;
  height: var(--ctl-h);
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-2);
}
/* 滑动指示块：弹簧动效跟随激活分段 */
.seg-blob {
  position: absolute;
  top: 3px;
  bottom: 3px;
  border-radius: var(--radius-sm);
  background: var(--accent-grad);
  transition: left 0.3s cubic-bezier(0.3, 1.2, 0.4, 1), width 0.3s cubic-bezier(0.3, 1.2, 0.4, 1), opacity 0.15s ease;
  pointer-events: none;
  z-index: 0;
}
.seg-btn {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-dim);
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;
  transition: color 0.2s ease;
  white-space: nowrap;
}
.seg-btn:hover:not(.active) {
  color: var(--text);
}
.seg-btn.active {
  color: var(--on-accent);
  font-weight: 600;
}

.skin-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-2);
}
.skin-actions .btn {
  min-height: var(--ctl-h);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.skin-hint {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-dim);
}
.external-skin-note {
  display: grid;
  justify-items: start;
  gap: var(--space-2);
  margin-top: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-2);
}
.hidden-input {
  display: none;
}

/* ================= 披风 ================= */
.cape-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
  gap: var(--space-3);
}
.cape-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-2);
  color: var(--text);
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.12s ease;
}
.cape-item:hover:not(:disabled) {
  border-color: var(--accent-deep);
  transform: translateY(-2px);
}
.cape-item:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.cape-item.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.cape-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 112px;
  border-radius: var(--radius-sm);
  background: var(--card);
  border: 1px solid var(--border);
  overflow: hidden;
}
.cape-img {
  width: 60px;
  image-rendering: pixelated;
}
.cape-alias {
  font-size: var(--text-xs);
  color: var(--text-dim);
  text-align: center;
  padding: 0 var(--space-2);
  word-break: break-all;
}
.cape-name {
  font-size: var(--text-sm);
  font-weight: 600;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.cape-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 20px;
}
.cape-state .tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* ================= 历史皮肤 ================= */
.history-search {
  width: 180px;
  height: var(--ctl-h);
  padding: 0 var(--space-3);
  font-size: var(--text-xs);
}
.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: var(--space-3);
}
.history-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.history-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 168px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-2);
  overflow: hidden;
}
.history-img {
  height: 144px;
  image-rendering: pixelated;
}
.history-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  background: var(--mask);
  opacity: 0;
  transition: opacity 0.16s ease;
}
.history-preview:hover .history-overlay {
  opacity: 1;
}
.history-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-1);
  min-height: 20px;
}
.history-meta .tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.history-time {
  font-size: var(--text-xs);
  white-space: nowrap;
}
.history-name-row {
  min-height: 20px;
}
.history-name {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
  border-radius: var(--radius-sm);
  padding: 1px 3px;
  transition: background 0.12s ease, color 0.12s ease;
}
.history-name:hover {
  background: var(--hover);
  color: var(--text);
}
.history-name-input {
  width: 100%;
  height: var(--ctl-h);
  padding: 0 var(--space-2);
  font-size: var(--text-xs);
}

/* ================= 非微软账号引导 ================= */
.need-ms {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  padding: var(--space-7) var(--card-pad);
  text-align: center;
}
.need-ms-icon {
  width: 52px;
  height: 52px;
  color: var(--accent);
  opacity: 0.8;
}
.need-ms-text {
  font-size: var(--text-md);
}
.need-ms .btn {
  min-height: var(--ctl-h);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

</style>
<style scoped>
/* Content-sized right column, with history across both columns. */
.skins-page { display:grid; grid-template-columns:minmax(260px,2fr) minmax(300px,3fr); align-items:start; gap:16px; }
.skins-page > :is(.page-head,.status-strip,.need-ms) { grid-column:1/-1; }
.skins-page > .page-head { flex-direction:row; align-items:center; justify-content:space-between; gap:12px; }
.skin-page-heading { min-width:0; }.skin-page-heading .page-sub { margin:4px 0 0; }
.skin-editor-entry { flex:none; width:auto; padding:8px 14px; min-height:36px; }
.skins-page .row-main,.skins-page .row-sub { display:contents; }
.skins-page .pane-preview { grid-column:1; grid-row:2; width:100%; max-width:100%; min-height:0; }
.skins-page .pane-preview .viewer3d { min-height:320px; }
.skin-operation-panel { grid-column:2; grid-row:2; min-width:0; background:var(--surface-content); border:1px solid var(--border); border-radius:var(--radius-lg); overflow:hidden; display:flex; flex-direction:column; }
.skins-page .skin-operation-panel :is(.pane-info,.pane-capes) { flex:0 0 auto; border:0; border-radius:0; background:transparent; margin:0; min-height:0; padding:20px; width:100%; max-width:100%; box-shadow:none; }
.skin-operation-panel .pane-capes { border-top:1px solid var(--border)!important; }
.skin-operation-panel .pane-empty { min-height:60px; padding:16px; }
.skins-page .pane-history { grid-column:1/-1; grid-row:3; }
.skins-page .pane-history:has(.pane-empty) { display:flex; align-items:center; gap:16px; padding:16px 20px; }
.skins-page .pane-history:has(.pane-empty) .pane-head { margin:0; flex:none; }
.skins-page .pane-history:has(.pane-empty) .pane-empty { padding:8px; min-height:0; }
.cape-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.cape-item { display:grid; grid-template-columns:58px minmax(0,1fr); grid-template-rows:auto auto; align-items:center; gap:8px 12px; min-height:100px; padding:12px; text-align:left; }
.cape-preview { grid-column:1; grid-row:1/4; width:58px; height:78px; padding:0; }
.cape-img { max-width:100%; max-height:100%; object-fit:contain; }
.cape-name,.cape-state { grid-column:2; margin:0; white-space:normal; overflow-wrap:break-word; }
.cape-name { font-size:13px; }
.row-main.drag-over .pane { outline:2px solid var(--accent); }
@media(max-width:1050px) {
 .skins-page { grid-template-columns:minmax(0,1fr); }
 .skins-page :is(.pane-preview,.skin-operation-panel,.pane-history) { grid-column:1; grid-row:auto; }
 .skins-page .pane-history:has(.pane-empty) { flex-wrap:wrap; }
}
@media(max-width:650px) { .cape-grid { grid-template-columns:minmax(0,1fr); } }
</style>
