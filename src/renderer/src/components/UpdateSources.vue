<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { MAX_CUSTOM_UPDATE_MIRRORS, UPDATE_MIRRORS, normalizeUpdateMirrorUrl, storedUpdateMirrorUrls } from '@shared/updateMirrors'
import type { Settings } from '@shared/types'
import { store, toast } from '../store'
import { updateSettings } from '../settingsUpdates'
import { errText } from '../api'
import { restoreLostControlFocus } from '../controlFocus'

const source = computed(() => store.settings?.updateSource ?? 'auto')
// Keep the visible rows until persistence completes: optimistic settings writes
// must not destroy a focused remove button that rollback would recreate.
const pendingRows = ref<{ custom: string[]; legacy: string } | null>(null)
const custom = computed(() => pendingRows.value?.custom ?? storedUpdateMirrorUrls(store.settings?.updateMirrorUrls))
const legacy = computed(() => normalizeUpdateMirrorUrl(store.settings?.updateMirrorUrl))
const legacySeparate = computed(() => pendingRows.value?.legacy ?? (legacy.value && !custom.value.includes(legacy.value) && !UPDATE_MIRRORS.some(item => item.url === legacy.value) ? legacy.value : ''))
const input = ref(''), error = ref(''), busy = ref(false)
async function save(patch: Partial<Settings>) {
  if (busy.value) return false
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  let failed = false
  pendingRows.value = { custom: [...custom.value], legacy: legacySeparate.value }
  busy.value = true; error.value = ''
  try { await updateSettings(patch); return true }
  catch (failure) { failed = true; error.value = errText(failure); toast('保存更新来源失败：' + error.value, 'error'); return false }
  finally { pendingRows.value = null; busy.value = false; if (failed) { await nextTick(); restoreLostControlFocus(previousFocus, '.update-sources') } }
}
async function add() {
  const url = normalizeUpdateMirrorUrl(input.value)
  if (!url) { error.value = '请输入不含账号、密码、查询参数或片段的 HTTPS 镜像地址。'; return }
  if (UPDATE_MIRRORS.some(item => item.url === url) || custom.value.includes(url) || legacy.value === url) { error.value = '这个镜像已在候选列表中。'; return }
  if (custom.value.length >= MAX_CUSTOM_UPDATE_MIRRORS) { error.value = `最多追加 ${MAX_CUSTOM_UPDATE_MIRRORS} 个镜像。`; return }
  if (await save({ updateMirrorUrls: [...custom.value, url] })) input.value = ''
}
function remove(url: string) { void save({ updateMirrorUrls: custom.value.filter(item => item !== url) }) }
</script>

<template>
  <section data-ui="" class="update-sources" aria-label="更新下载来源">
    <div data-ui="SettingsView:ef2f8a060d8a" class="source-row"><label for="update-source">更新下载源</label><select id="update-source" data-ui="SettingsView:c67695800552" class="select" :value="source" :disabled="busy" @change="save({ updateSource: ($event.target as HTMLSelectElement).value as Settings['updateSource'] })"><option value="auto">自动择优（直连与镜像）</option><option value="direct">仅 GitHub 直连</option><option value="mirror">仅镜像</option></select></div>
    <p class="muted source-help" role="status">{{ source === 'direct' ? '只通过 GitHub 下载更新，不启用镜像。' : source === 'mirror' ? '从下方预设与自定义镜像中测速择优，不使用 GitHub 直连。' : '从 GitHub 直连、预设与自定义镜像中测速择优；下载过慢时自动切换来源。' }}</p>
    <template v-if="source !== 'direct'">
      <div class="source-row source-list"><span>预设镜像</span><span v-for="mirror in UPDATE_MIRRORS" :key="mirror.url" class="source-preset">{{ mirror.label }}</span></div>
      <div class="source-row"><label for="update-mirror">追加自定义镜像</label><input id="update-mirror" data-ui="SettingsView:573dec07c5b6" v-model="input" class="input mono" placeholder="https://example.com/" :disabled="busy" @keydown.enter.prevent="add"><button class="btn btn-ghost btn-sm" :disabled="busy || !input.trim() || custom.length >= MAX_CUSTOM_UPDATE_MIRRORS" @click="add">添加</button></div>
      <p class="muted source-help">最多 {{ MAX_CUSTOM_UPDATE_MIRRORS }} 个；保存后与预设一起参与测速。</p>
      <ul v-if="custom.length || legacySeparate" class="custom-mirror-list"><li v-for="url in custom" :key="url"><span class="mono" :title="url">{{ url }}</span><button class="btn btn-ghost btn-sm" :aria-label="'移除镜像 '+url" :disabled="busy" @click="remove(url)">移除</button></li><li v-if="legacySeparate"><span class="mono" :title="legacySeparate">{{ legacySeparate }} <small>旧版设置</small></span><button class="btn btn-ghost btn-sm" :disabled="busy" @click="save({updateMirrorUrl:''})">移除</button></li></ul>
    </template>
    <p v-if="error" class="source-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.update-sources{min-width:0}.source-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px}.source-row>label,.source-list>span:first-child{font-size:13px;min-width:104px}.source-row .select{width:250px;max-width:100%}.source-row .input{flex:1;min-width:160px}.source-help{font-size:12px;line-height:1.6;margin:7px 0}.source-preset{font-size:11px;border:1px solid var(--border);border-radius:6px;padding:4px 7px}.custom-mirror-list{list-style:none;padding:0;margin:8px 0;display:grid;gap:6px}.custom-mirror-list li{display:flex;gap:10px;align-items:center;padding:6px 9px;background:var(--card-2);border-radius:7px}.custom-mirror-list li>span{flex:1;min-width:0;overflow-wrap:anywhere;font-size:12px}.custom-mirror-list small{color:var(--text-dim)}.source-error{color:var(--danger);font-size:12px;line-height:1.6}
</style>
