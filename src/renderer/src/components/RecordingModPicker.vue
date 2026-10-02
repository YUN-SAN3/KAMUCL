<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CommunityFile, InstallOptions, LoaderName } from '@shared/types'
import type { RecordingKind } from '@shared/recordings'
import SelectMenu from './SelectMenu.vue'
import { errText } from '../api'
import { formatReleaseTime } from '@shared/releaseTime'
const props = defineProps<{ mc: string; loader: '' | LoaderName; modelValue?: InstallOptions['recordingMod'] }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: InstallOptions['recordingMod']): void }>()
const kind = ref(''), file = ref(''), choices = ref<CommunityFile[]>([]), busy = ref(false), error = ref(''), retry = ref(0)
const options = computed(() => choices.value.map(f => ({ value: f.fileId, label: `${f.version} · ${f.releaseType === 'release' ? '正式版' : f.releaseType} · ${formatReleaseTime(f.date)}` })))
watch(() => [props.mc, props.loader, kind.value, retry.value], async (_v, _p, cleanup) => {
  let stale = false; cleanup(() => { stale = true })
  choices.value = []; file.value = ''; error.value = ''; busy.value = false
  emit('update:modelValue', kind.value ? { kind: kind.value as RecordingKind, fileId: '' } : undefined)
  if (!kind.value || !props.loader) return
  busy.value = true
  try {
    const list = await window.kamucl.invoke('recordings:modVersions', kind.value, props.mc, props.loader) as CommunityFile[]
    if (stale) return
    choices.value = list; file.value = list.find(f => f.releaseType === 'release')?.fileId || list[0]?.fileId || ''
    emit('update:modelValue', { kind: kind.value as RecordingKind, fileId: file.value })
  } catch (e) { if (!stale) error.value = errText(e) } finally { if (!stale) busy.value = false }
}, { immediate: true })
function choose(value: string) { emit('update:modelValue', { kind: kind.value as RecordingKind, fileId: value }) }
</script>
<template>
  <section class="recording-picker" data-ui="recording-mod:picker">
    <p class="modal-label">同时安装录像模组（可选）</p>
    <SelectMenu v-model="kind" :options="[{ value: '', label: '不安装录像模组' }, { value: 'replaymod', label: 'ReplayMod' }, { value: 'flashback', label: 'Flashback' }]" />
    <template v-if="kind">
      <p v-if="!loader" class="muted">请先选择模组加载器，以检查兼容版本。</p>
      <p v-else-if="busy" class="muted">正在检查兼容的模组版本…</p>
      <div v-else-if="error" class="recording-unavailable"><p role="alert">{{ error }}</p><button class="btn btn-ghost btn-sm" @click="retry++">重试</button></div>
      <template v-else><p class="modal-label">模组版本</p><SelectMenu v-if="options.length" v-model="file" :options="options" @change="choose" /><p v-else class="recording-unavailable" role="alert"><strong>⚠ {{ kind === 'replaymod' ? 'ReplayMod' : 'Flashback' }} 暂无兼容版本</strong><br>当前 Minecraft {{ mc }} / {{ loader }} 无法安装此录像模组。请更换加载器或选择“不安装录像模组”。</p></template>
      <p class="muted">创建独立实例，同时下载所选版本及兼容的必要前置；不会修改其他实例的模组。</p>
    </template>
  </section>
</template>
<style scoped>.recording-picker{margin:20px 0;padding-top:4px}.recording-picker p{line-height:1.6}.recording-picker :deep(.select-menu-btn){width:100%}.recording-unavailable{color:var(--danger,#e05260);border:1px solid currentColor;background:color-mix(in srgb,var(--danger,#e05260) 10%,transparent);border-radius:12px;padding:12px 14px;font-size:14px}.recording-unavailable strong{font-size:15px;font-weight:700}</style>
