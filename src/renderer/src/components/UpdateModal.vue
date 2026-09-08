<script setup lang="ts">
/**
 * 启动器更新弹窗：发现新版本 / 下载中 / 下载完成 三态。
 * 常驻内测群备用下载提示 + 复制群号；低速 30s 内嵌醒目提示一次。
 */
import { computed, ref } from 'vue'
import type { ReleaseInfo } from '@shared/types'
import { QQ_GROUP_HINT } from '@shared/branding'
import { renderMarkdownLite } from '../markdownLite'

const props = defineProps<{
  release: ReleaseInfo
  currentVersion: string
  /** found=发现新版本；downloading=下载中；done=下载完成待安装 */
  state: 'found' | 'downloading' | 'done'
  /** 下载进度 0-1 与速度文本（downloading 态） */
  percent?: number
  speedText?: string
  bytesText?: string
  etaText?: string
  /** 低速提示（30s<100KB/s 出现一次） */
  slowHint?: boolean
  /** 内测群号（配置项，可覆盖） */
  qqGroup: string
  /** 回退模式（文案微调） */
  rollback?: boolean
}>()

const emit = defineEmits<{
  (e: 'updateNow'): void
  (e: 'later'): void
  (e: 'skip'): void
  (e: 'cancelDownload'): void
  (e: 'installNow'): void
  (e: 'close'): void
}>()

const copied = ref(false)
async function copyGroup() {
  try {
    await navigator.clipboard.writeText(props.qqGroup)
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  } catch { /* 剪贴板不可用时静默 */ }
}

const bodyHtml = computed(() => renderMarkdownLite(props.release.body || '（无更新说明）'))
const dateText = computed(() => {
  const d = new Date(props.release.publishedAt)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
})
const sizeText = computed(() => {
  const s = props.release.assetSize
  if (!s) return ''
  return s >= 1048576 ? `${(s / 1048576).toFixed(1)} MB` : `${Math.round(s / 1024)} KB`
})
</script>

<template>
  <div class="menu-overlay upd-mask" @click.self="state === 'found' ? emit('later') : undefined">
    <div class="card upd-modal" role="dialog" aria-label="启动器更新">
      <!-- 发现新版本 -->
      <template v-if="state === 'found'">
        <div class="upd-head">
          <h3 class="upd-title">{{ rollback ? '回退到' : '发现新版本' }} v{{ release.version }}</h3>
          <button class="icon-btn" title="稍后提醒" @click="emit('later')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <p class="muted upd-meta">当前 v{{ currentVersion }}<template v-if="dateText"> · 发布于 {{ dateText }}</template><template v-if="sizeText"> · {{ sizeText }}</template></p>
        <div v-if="rollback" class="upd-slow">⚠ 旧版本可能不兼容新配置格式。回退前将自动备份当前版本，可随时还原。</div>
        <div class="upd-body" v-html="bodyHtml"></div>
        <div class="upd-qq">
          <span class="upd-qq-text">{{ QQ_GROUP_HINT }}</span>
          <span class="upd-qq-row">
            <span class="upd-qq-num">群号 {{ qqGroup }}</span>
            <button class="btn btn-ghost btn-sm" @click="copyGroup">{{ copied ? '已复制' : '复制群号' }}</button>
          </span>
        </div>
        <p class="muted upd-shortcut-hint">更新后原桌面快捷方式可能失效，需重新指向新文件</p>
        <div class="upd-actions">
          <button v-if="!rollback" class="upd-skip" @click="emit('skip')">跳过此版本</button>
          <span class="upd-actions-right">
            <button class="btn btn-ghost" @click="emit('later')">稍后提醒</button>
            <button class="btn btn-gold" @click="emit('updateNow')">{{ rollback ? '确认回退' : '立即更新' }}</button>
          </span>
        </div>
      </template>

      <!-- 下载中 -->
      <template v-else-if="state === 'downloading'">
        <div class="upd-head">
          <h3 class="upd-title">正在下载 v{{ release.version }}</h3>
        </div>
        <div class="upd-progress">
          <div class="upd-progress-bar" :style="{ width: Math.round((percent ?? 0) * 100) + '%' }"></div>
        </div>
        <p class="muted upd-meta">
          {{ Math.round((percent ?? 0) * 100) }}%
          <template v-if="speedText"> · {{ speedText }}</template>
          <template v-if="bytesText"> · {{ bytesText }}</template>
          <template v-if="etaText"> · {{ etaText }}</template>
        </p>
        <div v-if="slowHint" class="upd-slow">⚠ 下载速度持续偏低，建议到内测群获取安装包</div>
        <div class="upd-qq">
          <span class="upd-qq-text">{{ QQ_GROUP_HINT }}</span>
          <span class="upd-qq-row">
            <span class="upd-qq-num">群号 {{ qqGroup }}</span>
            <button class="btn btn-ghost btn-sm" @click="copyGroup">{{ copied ? '已复制' : '复制群号' }}</button>
          </span>
        </div>
        <p class="muted upd-shortcut-hint">下载同时在下载中心显示，可断点续传</p>
        <div class="upd-actions">
          <span class="upd-actions-right">
            <button class="btn btn-danger" @click="emit('cancelDownload')">取消下载</button>
          </span>
        </div>
      </template>

      <!-- 下载完成 -->
      <template v-else>
        <div class="upd-head">
          <h3 class="upd-title">v{{ release.version }} 下载完成</h3>
        </div>
        <p class="upd-done-text">安装包已下载并通过完整性校验（SHA256）。重启启动器完成安装，替换前会自动备份当前版本。</p>
        <div class="upd-actions">
          <span class="upd-actions-right">
            <button class="btn btn-ghost" @click="emit('close')">稍后</button>
            <button class="btn btn-gold" @click="emit('installNow')">立即重启安装</button>
          </span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.upd-mask { z-index: 9500; display: grid; place-items: center; }
.upd-modal { width: min(560px, 92vw); max-height: 84vh; display: flex; flex-direction: column; gap: 10px; padding: 20px 22px; }
.upd-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.upd-title { margin: 0; font-size: 18px; }
.upd-meta { margin: 0; font-size: 12.5px; }
.upd-body {
  overflow-y: auto; max-height: 40vh; padding: 12px 14px; border: 1px solid var(--border);
  border-radius: 10px; background: var(--card-2); font-size: 13px; line-height: 1.65;
}
.upd-body :deep(h4) { margin: 8px 0 4px; font-size: 13.5px; color: var(--accent-2); }
.upd-body :deep(h4:first-child) { margin-top: 0; }
.upd-body :deep(ul) { margin: 4px 0; padding-left: 18px; }
.upd-body :deep(li) { margin: 2px 0; }
.upd-body :deep(p) { margin: 4px 0; }
.upd-body :deep(code) { padding: 1px 5px; border-radius: 5px; background: var(--hover); font-size: 12px; }
.upd-body :deep(a) { color: var(--accent-2); }
.upd-qq {
  display: flex; flex-direction: column; gap: 6px; padding: 10px 12px;
  border: 1px dashed var(--border-strong); border-radius: 10px; background: var(--accent-soft);
}
.upd-qq-text { font-size: 12px; color: var(--text-dim); }
.upd-qq-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.upd-qq-num { font-size: 12.5px; font-weight: 600; }
.upd-slow {
  padding: 9px 12px; border-radius: 10px; font-size: 12.5px; font-weight: 600;
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  color: var(--danger);
}
.upd-shortcut-hint { margin: 0; font-size: 11.5px; }
.upd-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 2px; }
.upd-actions-right { display: flex; gap: 10px; margin-left: auto; }
.upd-skip {
  border: none; background: transparent; color: var(--text-dim); font-size: 12.5px;
  cursor: pointer; padding: 4px 2px; font-family: inherit; text-decoration: underline;
  text-underline-offset: 3px;
}
.upd-skip:hover { color: var(--text); }
.upd-progress { height: 8px; border-radius: 999px; background: var(--card-2); overflow: hidden; }
.upd-progress-bar { height: 100%; border-radius: 999px; background: var(--accent-grad); transition: width 0.25s ease; }
.upd-done-text { margin: 0; font-size: 13.5px; line-height: 1.7; }
</style>
