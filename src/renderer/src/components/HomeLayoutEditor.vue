<script setup lang="ts">
/** 图一固定布局下的个性化背景与启动卡图片管理。 */
import { computed, ref } from 'vue'
import { carouselImages, carouselDuration, MAX_CAROUSEL_IMAGES } from '@shared/appearancePolicy'
import { updateSettings } from '../settingsUpdates'
import {
  errText,
  importBackground,
  importBackgroundMulti,
  importLaunchThumbnail,
  resetBackground,
  resetLaunchThumbnail
} from '../api'
import { store, toast } from '../store'
import { managedImageUrl } from '../managedAssets'
import type { BackgroundSettings, ImageFit, Settings } from '@shared/types'

function save(patch: Partial<Settings>) {
  void updateSettings(patch)
    .catch((e) => toast('保存失败：' + errText(e), 'error')
  )
}

// ---------------- 背景 ----------------
const bgModes = [
  { value: 'none', label: '系统桌面' },
  { value: 'color', label: '纯色' },
  { value: 'image', label: '图片' }
] as const
const fitModes: Array<{ value: ImageFit; label: string }> = [
  { value: 'fill', label: '填充' },
  { value: 'fit', label: '适应' },
  { value: 'crop', label: '裁切' }
]
const importingBackground = ref(false)
const importingThumbnail = ref(false)
const backgroundPreviewFailed = ref(false)
const thumbnailPreviewFailed = ref(false)
const images = computed(() => carouselImages(store.settings?.launchThumbnail))
function changeImages(next: string[]) {
  if (!store.settings) return
  thumbnailPreviewFailed.value = false
  save({ launchThumbnail: { ...store.settings.launchThumbnail, images: next, image: next[0] ?? '' } })
}
function moveImage(index: number, direction: number) {
  const next = [...images.value]
  const target = index + direction
  if (target < 0 || target >= next.length) return
  ;[next[index], next[target]] = [next[target], next[index]]
  changeImages(next)
}
function setDuration(value: string, image?: string) {
  if (!store.settings) return
  const current = store.settings.launchThumbnail
  const seconds = carouselDuration(Number(value))
  save({ launchThumbnail: image ? { ...current, durations: { ...current.durations, [image]: seconds } } : { ...current, intervalSeconds: seconds } })
}

function fitCss(fit: ImageFit): 'fill' | 'contain' | 'cover' {
  return fit === 'fill' ? 'fill' : fit === 'fit' ? 'contain' : 'cover'
}

function setBg(patch: Partial<BackgroundSettings>) {
  if (!store.settings) return
  save({ background: { ...store.settings.background, ...patch } })
}

async function pickImage() {
  if (importingBackground.value) return
  importingBackground.value = true
  try {
    const settings = await importBackground()
    if (settings) {
      store.settings = settings
      backgroundPreviewFailed.value = false
      toast('背景已复制并优化到 KAMUCL 资源目录', 'success')
    }
  } catch (e) {
    toast('导入背景失败：' + errText(e), 'error')
  } finally {
    importingBackground.value = false
  }
}

/** 多选导入背景图（自动切换用）：追加进 images 数组 */
const importingBackgroundMulti = ref(false)
async function pickImageMulti() {
  if (importingBackgroundMulti.value) return
  importingBackgroundMulti.value = true
  try {
    const settings = await importBackgroundMulti()
    if (settings) {
      store.settings = settings
      backgroundPreviewFailed.value = false
      toast(`背景图已加入切换列表（共 ${settings.background.images?.length ?? 1} 张）`, 'success')
    }
  } catch (e) {
    toast('导入背景失败：' + errText(e), 'error')
  } finally {
    importingBackgroundMulti.value = false
  }
}

/** 背景图列表（多图切换用；空时回退单张 image） */
const bgImageList = computed(() => {
  const bg = store.settings?.background
  if (!bg) return [] as string[]
  return bg.images?.length ? bg.images : (bg.image ? [bg.image] : [])
})
function removeBgImage(image: string) {
  if (!store.settings) return
  const next = bgImageList.value.filter((i) => i !== image)
  backgroundPreviewFailed.value = false
  save({ background: { ...store.settings.background, images: next, image: next[0] ?? '' } })
}

/** 切换策略 */
const switchModes = [
  { value: 'off', label: '固定' },
  { value: 'order', label: '按顺序' },
  { value: 'random', label: '随机' }
] as const

async function resetBg() {
  try {
    store.settings = await resetBackground()
    backgroundPreviewFailed.value = false
    toast('背景已恢复默认', 'success')
  } catch (error) {
    toast('恢复背景失败：' + errText(error), 'error')
  }
}

async function pickLaunchThumbnail() {
  if (importingThumbnail.value) return
  importingThumbnail.value = true
  try {
    const settings = await importLaunchThumbnail()
    if (settings) {
      store.settings = settings
      thumbnailPreviewFailed.value = false
      toast('启动卡缩略图已保存到 KAMUCL 资源目录', 'success')
    }
  } catch (error) {
    toast('导入缩略图失败：' + errText(error), 'error')
  } finally {
    importingThumbnail.value = false
  }
}

async function resetThumbnail() {
  try {
    store.settings = await resetLaunchThumbnail()
    thumbnailPreviewFailed.value = false
    toast('启动卡已恢复内置轮播图片', 'success')
  } catch (error) {
    toast('恢复缩略图失败：' + errText(error), 'error')
  }
}

function setLaunchFit(fit: ImageFit) {
  if (!store.settings) return
  save({ launchThumbnail: { ...store.settings.launchThumbnail, fit } })
}
</script>

<template>
  <!-- 背景 -->
  <div class="card group">
    <div class="layout-head">
      <div>
        <h3 class="group-title group-title-tight">窗口背景</h3>
        <p class="muted group-hint group-hint-flush">默认透出并模糊真实系统桌面；图片模式仅在你主动选择时启用。</p>
      </div>
      <button class="btn btn-ghost btn-sm" @click="resetBg">恢复默认</button>
    </div>

    <div class="bg-modes">
      <button
        v-for="m in bgModes"
        :key="m.value"
        class="capsule"
        :class="{ active: store.settings?.background.mode === m.value }"
        @click="setBg({ mode: m.value })"
      >
        {{ m.label }}
      </button>
    </div>

    <template v-if="store.settings?.background.mode === 'color'">
      <div class="bg-row">
        <span class="muted bg-label">背景色</span>
        <input
          type="color"
          class="color-swatch"
          :value="store.settings.background.color"
          @input="setBg({ color: ($event.target as HTMLInputElement).value })"
        />
        <span class="mono muted">{{ store.settings.background.color }}</span>
      </div>
    </template>

    <template v-if="store.settings?.background.mode === 'image'">
      <div v-if="store.settings.background.image && !backgroundPreviewFailed" class="image-preview background-preview">
        <img
          :src="managedImageUrl(store.settings.background.image)"
          :style="{ objectFit: fitCss(store.settings.background.fit) }"
          alt="自定义背景预览"
          @error="backgroundPreviewFailed = true"
        />
      </div>
      <div v-else class="image-preview image-preview-empty">
        {{ backgroundPreviewFailed ? '受管背景不可用，将自动回退默认背景' : '尚未导入背景图片' }}
      </div>
      <div class="bg-row">
        <span class="muted bg-label">背景图片</span>
        <button class="btn btn-ghost btn-sm" :disabled="importingBackground || importingBackgroundMulti" @click="pickImage">
          {{ importingBackground ? '处理中…' : '导入单张…' }}
        </button>
        <button class="btn btn-ghost btn-sm" :disabled="importingBackground || importingBackgroundMulti" @click="pickImageMulti">
          {{ importingBackgroundMulti ? '处理中…' : '添加多张（可多选）…' }}
        </button>
        <span class="muted bg-img-path" :title="store.settings.background.image">
          {{ store.settings.background.image ? '已由 KAMUCL 管理' : '未选择' }}
        </span>
      </div>
      <ol v-if="bgImageList.length > 1" class="carousel-list" aria-label="背景图切换列表">
        <li v-for="(image, index) in bgImageList" :key="image">
          <img :src="managedImageUrl(image)" :alt="`第 ${index + 1} 张`" />
          <span>{{ index + 1 }}</span>
          <button class="btn btn-ghost btn-sm" @click="removeBgImage(image)">移除</button>
        </li>
      </ol>
      <div v-if="bgImageList.length > 1" class="bg-row">
        <span class="muted bg-label">自动切换</span>
        <div class="fit-options">
          <button
            v-for="m in switchModes"
            :key="m.value"
            class="capsule"
            :class="{ active: (store.settings.background.switchMode ?? 'off') === m.value }"
            :title="m.value === 'off' ? '固定显示第一张' : m.value === 'order' ? '每次上线切换到下一张，运行中按间隔轮换' : '每次上线随机一张，运行中按间隔随机'"
            @click="setBg({ switchMode: m.value })"
          >
            {{ m.label }}
          </button>
        </div>
      </div>
      <div v-if="bgImageList.length > 1 && (store.settings.background.switchMode ?? 'off') !== 'off'" class="bg-row">
        <span class="muted bg-label">切换间隔</span>
        <input
          type="number"
          class="input num-input"
          min="30"
          max="7200"
          step="30"
          :value="store.settings.background.switchIntervalSec ?? 300"
          @change="setBg({ switchIntervalSec: Math.max(30, Number(($event.target as HTMLInputElement).value) || 300) })"
        />
        <span class="muted">秒 · 每次上线也会自动切换一张</span>
      </div>
      <div class="bg-row">
        <span class="muted bg-label">显示方式</span>
        <div class="fit-options">
          <button
            v-for="fit in fitModes"
            :key="fit.value"
            class="capsule"
            :class="{ active: store.settings.background.fit === fit.value }"
            @click="setBg({ fit: fit.value })"
          >
            {{ fit.label }}
          </button>
        </div>
      </div>
      <div class="bg-row">
        <span class="muted bg-label">图片透明度</span>
        <input
          type="range"
          class="slider"
          min="0"
          max="1"
          step="0.05"
          :value="1 - store.settings.background.opacity"
          @input="setBg({ opacity: 1 - Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="muted bg-val">{{ Math.round((1 - store.settings.background.opacity) * 100) }}%</span>
      </div>
      <div class="bg-row">
        <span class="muted bg-label">图片模糊</span>
        <input
          type="range"
          class="slider"
          min="0"
          max="40"
          step="2"
          :value="store.settings.background.blur"
          @input="setBg({ blur: Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="muted bg-val">{{ store.settings.background.blur }}px</span>
      </div>
      <p class="muted group-hint">透明度越高图片越透；图片模糊单独控制清晰度。系统桌面毛玻璃由 Windows 管理，不受这两个图片选项影响。</p>
    </template>
  </div>

  <!-- 首页启动卡全局缩略图 -->
  <div class="card group">
    <div class="layout-head">
      <div>
        <h3 class="group-title group-title-tight">首页启动卡</h3>
        <p class="muted group-hint group-hint-flush">实例专属图片优先；未设置时使用这里的全局图片，再回退内置轮播。</p>
      </div>
      <button class="btn btn-ghost btn-sm" @click="resetThumbnail">恢复内置轮播</button>
    </div>
    <div v-if="store.settings?.launchThumbnail.image && !thumbnailPreviewFailed" class="image-preview launch-preview">
      <img
        :src="managedImageUrl(store.settings.launchThumbnail.image)"
        :style="{ objectFit: fitCss(store.settings.launchThumbnail.fit) }"
        alt="启动卡缩略图预览"
        @error="thumbnailPreviewFailed = true"
      />
    </div>
    <div v-else class="image-preview image-preview-empty">
      {{ thumbnailPreviewFailed ? '缩略图不可用，将自动使用内置轮播' : '当前使用内置三图轮播' }}
    </div>
    <div class="bg-row">
      <span class="muted bg-label">默认图片</span>
      <button class="btn btn-ghost btn-sm" :disabled="importingThumbnail" @click="pickLaunchThumbnail">
        {{ importingThumbnail ? '处理中…' : '添加图片（可多选）…' }}
      </button>
      <span class="muted bg-img-path">
        {{ images.length ? `${images.length} / ${MAX_CAROUSEL_IMAGES} 张 · 已由 KAMUCL 管理` : '内置轮播' }}
      </span>
    </div>
    <div class="bg-row">
      <span class="muted bg-label">显示方式</span>
      <div class="fit-options">
        <button
          v-for="fit in fitModes"
          :key="fit.value"
          class="capsule"
          :class="{ active: store.settings?.launchThumbnail.fit === fit.value }"
          @click="setLaunchFit(fit.value)"
        >
          {{ fit.label }}
        </button>
      </div>
    </div>
    <ol v-if="images.length" class="carousel-list" aria-label="启动卡轮播顺序">
      <li v-for="(image, index) in images" :key="image">
        <img :src="managedImageUrl(image)" :alt="`第 ${index + 1} 张`" />
        <span>{{ index + 1 }}</span>
        <label class="slide-duration">停留 <input type="number" min="1" max="120" step="0.5" :aria-label="`第 ${index + 1} 张停留秒数`" :value="carouselDuration(store.settings?.launchThumbnail.durations?.[image] ?? store.settings?.launchThumbnail.intervalSeconds)" @change="setDuration(($event.target as HTMLInputElement).value, image)" /> 秒</label>
        <button class="btn btn-ghost btn-sm" :disabled="index === 0" title="向前移动" @click="moveImage(index, -1)">↑</button>
        <button class="btn btn-ghost btn-sm" :disabled="index === images.length - 1" title="向后移动" @click="moveImage(index, 1)">↓</button>
        <button class="btn btn-ghost btn-sm" @click="changeImages(images.filter((_, i) => i !== index))">移除</button>
      </li>
    </ol>
    <div class="bg-row"><label for="carousel-default-duration">默认停留时间</label><input id="carousel-default-duration" type="number" min="1" max="120" step="0.5" class="input num-input" :value="carouselDuration(store.settings?.launchThumbnail.intervalSeconds)" @change="setDuration(($event.target as HTMLInputElement).value)" /><span class="muted">秒 · 用于内置轮播及未单独设置的图片</span></div>
  </div>
</template>

<style scoped>
.layout-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.group-title-tight {
  margin-bottom: var(--space-1);
}
.group-hint-flush {
  margin: 0;
}
.num-input {
  width: 90px;
  flex: none;
}
/* 背景 */
.bg-modes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.capsule { display: inline-flex; align-items: center; justify-content: center; min-height: var(--ctl-h); padding: 0 var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card-2); color: var(--text); cursor: pointer; font: inherit; }
.capsule.active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-2); }
.carousel-list { list-style: none; padding: 0; margin: var(--space-3) 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(265px, 1fr)); gap: var(--space-2); }
.carousel-list li { display: flex; align-items: center; gap: var(--space-2); min-height: var(--row-h); padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-md); min-width: 0; }
.carousel-list li { flex-wrap: wrap; }
.slide-duration { display: flex; align-items: center; gap: var(--space-1); font-size: var(--text-xs); }
.slide-duration input { width: 65px; min-height: var(--ctl-h); padding: var(--space-1) var(--space-2); }
.carousel-list img { width: 64px; height: 40px; object-fit: cover; border-radius: var(--radius-sm); }
.carousel-list span { flex: 1; }
.carousel-list button { min-width: var(--ctl-h); min-height: var(--ctl-h); }
.fit-options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.image-preview {
  width: 100%;
  height: 150px;
  margin: var(--space-3) 0 var(--space-2);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card-2);
}
.image-preview img {
  display: block;
  width: 100%;
  height: 100%;
}
.image-preview-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-5) var(--space-4);
  color: var(--text-dim);
  font-size: var(--text-xs);
  text-align: center;
}
.launch-preview {
  aspect-ratio: 16 / 7;
  height: auto;
  max-height: 220px;
}
.bg-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--row-h);
  padding: var(--space-1) 0;
}
.bg-label {
  flex: 0 0 82px;
  font-size: var(--text-sm);
}
.bg-val {
  flex-shrink: 0;
  min-width: 44px;
  text-align: right;
  font-weight: 700;
  color: var(--accent-2);
  font-size: var(--text-xs);
}
.bg-img-path {
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.color-swatch {
  -webkit-appearance: none;
  appearance: none;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
}
.color-swatch::-webkit-color-swatch-wrapper {
  padding: 3px;
}
.color-swatch::-webkit-color-swatch {
  border: none;
  border-radius: 4px;
}
.mono {
  font-size: var(--text-xs);
}
</style>
