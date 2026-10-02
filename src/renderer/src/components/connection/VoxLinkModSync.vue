<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { InstanceTarget } from '@shared/instanceCenter'
import type { ModSyncPlan, ModSyncScope, ModSyncGate, ModSyncGateResult } from '@shared/voxlinkMods'
import UpdateDialogShell from '../UpdateDialogShell.vue'
const props = defineProps<{ code: string; target?: InstanceTarget }>()
const emit = defineEmits<{ join: [gate:ModSyncGate]; dismiss: [] }>()
const scope = ref<ModSyncScope>('required'), plan = ref<ModSyncPlan | null>(null)
const busy = ref(false), message = ref(''), done = ref(false), selected = ref<string[]>([])
const missing = computed(() => plan.value?.rows.filter(r => r.status === 'missing') || [])
const progress = ref('')
let offProgress: (() => void) | undefined
let operation = '', epoch = 0
onMounted(() => { offProgress = window.kamucl.on('voxlink:mods:progress', value => {
  const p = value as { operation: string; installed: number; total: number; file: string; bytes: number; fileSize: number }
  if (p.operation === operation) progress.value = `${p.installed}/${p.total} · ${p.file} · ${(p.bytes / 1048576).toFixed(1)}/${(p.fileSize / 1048576).toFixed(1)} MB`
}) })
function cancel() { ++epoch; if (operation) void window.kamucl.invoke('voxlink:mods:cancel', operation); operation = ''; busy.value = false }
function dismiss() { cancel(); emit('dismiss') }
function cancelDownload() { if (operation) void window.kamucl.invoke('voxlink:mods:cancel', operation); message.value = '正在取消下载…' }
function join(gate:ModSyncGate='BYPASSED') { cancel();if(gate==='BYPASSED')void window.kamucl.invoke('voxlink:mods:bypass',props.code);emit('join',gate) }
async function check() {
  if (!props.target || busy.value) return
  const current = ++epoch; operation = crypto.randomUUID(); busy.value = true; message.value = ''; plan.value = null
  try {
    const result = await window.kamucl.invoke('voxlink:mods:check', { operation, code: props.code, scope: scope.value, target: props.target }) as ModSyncPlan | ModSyncGateResult
    if (current !== epoch) return
    if(result.gate&&result.gate!=='MANIFEST'){join(result.gate);return}
    const manifest=result as ModSyncPlan
    if (!manifest.unknownMods.length && manifest.rows.every(r => r.status === 'installed')) { join('MANIFEST'); return }
    plan.value = manifest; selected.value = missing.value.map(r => r.entry.sha1)
  } catch (error) { if (current === epoch) message.value = (error as Error).message }
  finally { if (current === epoch) busy.value = false }
}
async function download() {
  if (!plan.value || busy.value) return
  const current = ++epoch; operation = crypto.randomUUID(); busy.value = true; message.value = ''
  try {
    const result = await window.kamucl.invoke('voxlink:mods:download', { operation, plan: plan.value.id, selected: selected.value }) as { message: string }
    if (current !== epoch) return
    done.value = true; message.value = result.message
  } catch (error) { if (current === epoch) message.value = (error as Error).message }
  finally { if (current === epoch) busy.value = false }
}
onUnmounted(() => { cancel(); offProgress?.() })
</script>
<template>
  <UpdateDialogShell label="加入房间前检查模组" @dismiss="dismiss">
    <template #header><h2>与房主同步模组</h2><button class="btn btn-ghost" aria-label="关闭" @click="dismiss">×</button></template>
    <p class="connection-muted">房间 {{ code }} · {{ target?.id || '尚未选择游戏实例' }}</p>
    <p v-if="target" class="mod-path">{{ target.folder }}</p>
    <p v-if="!target">先返回选择实例以检查模组，或跳过检查直接加入。</p>
    <fieldset v-if="!plan" :disabled="busy" class="mod-scopes">
      <legend>获取范围</legend>
      <label><input v-model="scope" type="radio" value="required" /> 必装模组 <small>与房主联机所需</small></label>
      <label><input v-model="scope" type="radio" value="all" /> 全部模组 <small>包含可选客户端模组</small></label>
    </fieldset>
    <p v-if="busy" role="status">{{ plan ? '正在下载并校验所选模组…' : '正在检查房主清单和本地文件…' }}</p>
    <p v-if="busy && progress" class="connection-muted" role="status">{{ progress }}</p>
    <template v-if="plan && !done">
      <p class="connection-muted">房主环境：{{ plan.mcVersion }} · {{ plan.loader }}。禁用或版本冲突需手动处理。</p>
      <ul class="mod-rows">
        <li v-for="row in plan.rows" :key="row.entry.sha1" :class="{ warning: ['conflict', 'unresolved', 'disabled'].includes(row.status) }">
          <input v-if="row.status === 'missing'" v-model="selected" type="checkbox" :value="row.entry.sha1" :disabled="busy" :aria-label="`下载 ${row.entry.title}`" />
          <div><strong>{{ row.entry.title || row.entry.fileName }}</strong><small>{{ row.entry.versionNumber }} · {{ row.reason }}</small></div>
        </li>
        <li v-for="name in plan.unknownMods" :key="name" class="warning"><div><strong>{{ name }}</strong><small>无法自动识别，请向房主确认</small></div></li>
      </ul>
    </template>
    <p v-if="message" :class="done ? 'connection-muted' : 'connection-error'" role="status">{{ message }}</p>
    <template #footer>
      <button class="btn btn-ghost" @click="busy && plan ? cancelDownload() : dismiss()">{{ busy ? '取消' : '返回' }}</button>
      <button class="btn btn-ghost" :disabled="busy && !!plan" @click="join()">{{ done ? '已知需重启，继续加入' : busy ? '跳过检查并加入' : '直接加入' }}</button>
      <button v-if="!plan" class="btn btn-gold" :disabled="busy || !target" @click="check">检查模组</button>
      <button v-else-if="!done && missing.length" class="btn btn-gold" :disabled="busy || !selected.length" @click="download">下载所选（{{ selected.length }}）</button>
    </template>
  </UpdateDialogShell>
</template>
<style scoped>
.mod-path { color: var(--text-dim); font-size: var(--text-xs); overflow-wrap: anywhere; }
.mod-scopes { display: grid; gap: 12px; border: 0; padding: 16px 0; }
.mod-scopes label { display: flex; gap: 8px; align-items: center; }
.mod-scopes small { color: var(--text-dim); }
.mod-rows { list-style: none; padding: 0; display: grid; gap: 8px; }
.mod-rows li { display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--card-2); border-radius: var(--radius-md); }
.mod-rows div { min-width: 0; overflow-wrap: anywhere; }
.mod-rows small { display: block; color: var(--text-dim); margin-top: 4px; }
.mod-rows .warning small { color: var(--danger); }
</style>
