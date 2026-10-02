<script setup lang="ts">
/**
 * 启动器更新弹窗：发现新版本 / 下载中 / 下载完成 三态。
 * 常驻内测群备用下载提示 + 复制群号；低速 30s 内嵌醒目提示一次。
 */
import { computed, ref } from 'vue'
import UpdateDialogShell from './UpdateDialogShell.vue'
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

const bodyHtml = computed(() => renderMarkdownLite((props.release.body || '').replace(/^\s*(?:#{1,4}\s*)?KAMUCL\s+v?[\d.]+\s*(?:\r?\n|$)/i, '').trim() || '暂无更新说明'))
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
  <UpdateDialogShell :label="rollback ? '版本回退确认' : '启动器更新'" @dismiss="state === 'found' ? emit('later') : state === 'done' ? emit('close') : undefined">
    <template #header>
      <div class="upd-head">
        <div><p class="upd-eyebrow">KAMUCL · {{ rollback ? '版本回退' : '软件更新' }}</p><h3 class="upd-title">{{ state === 'found' ? (rollback ? '回退到' : '发现新版本') : state === 'downloading' ? '正在下载' : '准备安装' }} v{{ release.version }}</h3></div>
        <button v-if="state !== 'downloading'" class="icon-btn" :aria-label="state === 'found' ? '稍后提醒' : '关闭'" @click="state === 'found' ? emit('later') : emit('close')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="upd-meta"><span>当前 v{{ currentVersion }}</span><span v-if="dateText">{{ dateText }}</span><span v-if="sizeText">{{ sizeText }}</span></div>
    </template>
    <template v-if="state === 'found'">
      <p v-if="rollback" class="upd-slow">旧版本可能不兼容新配置。回退前会自动备份当前版本。</p>
      <h4 class="upd-section-title">{{ rollback ? '此版本说明' : '更新内容' }}</h4>
      <div class="upd-body" v-html="bodyHtml"></div>
    </template>
    <template v-else-if="state === 'downloading'">
      <div class="upd-download-status"><strong>{{ Math.round((percent ?? 0) * 100) }}%</strong><span class="muted">{{ speedText }}</span></div>
      <div class="upd-progress" role="progressbar" aria-label="更新下载进度" :aria-valuenow="Math.round((percent ?? 0) * 100)" aria-valuemin="0" aria-valuemax="100"><div class="upd-progress-bar" :style="{ width: Math.max(0, Math.min(100, Math.round((percent ?? 0) * 100))) + '%' }"></div></div>
      <p class="upd-meta"><span>{{ bytesText }}</span><span>{{ etaText }}</span></p>
      <p class="muted upd-note">下载进度同时显示在下载中心，支持断点续传。</p>
      <p v-if="slowHint" class="upd-slow">下载速度持续偏低，可以通过下方备用方式获取安装包。</p>
    </template>
    <p v-else class="upd-done-text">安装包已下载并通过 SHA256 完整性校验。下次手动启动时完成安装，替换前会自动备份当前版本。</p>
    <details v-if="state !== 'done'" class="upd-help" :open="slowHint || undefined">
      <summary>其他下载方式与安装说明</summary>
      <p class="muted">{{ QQ_GROUP_HINT }}</p>
      <div class="upd-qq-row"><span>内测群 {{ qqGroup }}</span><button class="btn btn-ghost btn-sm" @click="copyGroup">{{ copied ? '已复制' : '复制群号' }}</button></div>
      <p class="muted">如果旧桌面快捷方式失效，请重新指向更新后的文件。</p>
    </details>
    <template #footer>
      <div class="upd-actions">
        <template v-if="state === 'found'"><button v-if="!rollback" class="upd-skip" @click="emit('skip')">跳过此版本</button><div class="upd-actions-right"><button class="btn btn-ghost" @click="emit('later')">稍后提醒</button><button class="btn btn-gold" @click="emit('updateNow')">{{ rollback ? '确认回退' : '立即更新' }}</button></div></template>
        <div v-else-if="state === 'downloading'" class="upd-actions-right"><button class="btn btn-ghost" @click="emit('cancelDownload')">取消下载</button></div>
        <div v-else class="upd-actions-right"><button class="btn btn-ghost" @click="emit('close')">稍后</button><button class="btn btn-gold" @click="emit('installNow')">下次启动应用</button></div>
      </div>
    </template>
  </UpdateDialogShell>
</template>

<style scoped>
.upd-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.upd-eyebrow{font-size:12px;color:var(--text-dim);margin:0 0 6px}.upd-title{margin:0;font-size:22px;line-height:1.4;overflow-wrap:anywhere}.upd-meta{display:flex;flex-wrap:wrap;gap:6px 16px;margin:12px 0 0;font-size:12px;color:var(--text-dim);font-variant-numeric:tabular-nums}.upd-section-title{font-size:13px;color:var(--text-dim);margin:0 0 10px}.upd-body{font-size:14px;line-height:1.8}.upd-body :deep(h4){margin:16px 0 8px;font-size:14px}.upd-body :deep(ul){margin:0;padding-left:20px}.upd-body :deep(li){margin:8px 0;padding-left:2px}.upd-body :deep(p){margin:8px 0}.upd-body :deep(code){padding:1px 5px;border-radius:5px;background:var(--hover);font-size:12px}.upd-body :deep(a){color:var(--accent-2)}.upd-help{margin-top:24px;padding-top:16px;border-top:1px solid var(--border);font-size:12px}.upd-help summary{cursor:pointer;color:var(--text-dim);width:fit-content}.upd-help p{margin:12px 0}.upd-qq-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.upd-slow{padding:12px 14px;margin:0 0 18px;border-radius:10px;font-size:13px;background:var(--danger-soft);color:var(--danger);border:1px solid var(--danger-border)}.upd-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.upd-actions-right{display:flex;gap:10px;margin-left:auto;flex-wrap:wrap}.upd-skip{border:0;background:none;color:var(--text-dim);font:inherit;font-size:12px;cursor:pointer;padding:8px 0}.upd-skip:hover{color:var(--text)}.upd-progress{height:8px;border-radius:99px;background:var(--hover);overflow:hidden;margin:14px 0}.upd-progress-bar{height:100%;border-radius:99px;background:var(--accent-grad);transition:width var(--motion-normal) var(--ease-out)}.upd-download-status{display:flex;justify-content:space-between;align-items:baseline;font-variant-numeric:tabular-nums}.upd-download-status strong{font-size:28px}.upd-note{font-size:12px;margin-top:18px}.upd-done-text{margin:0;font-size:14px;line-height:1.8}
</style>
