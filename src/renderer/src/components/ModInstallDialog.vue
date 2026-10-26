<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import type { CommunityFile, InstalledVersion, ModInstallPlan, ProgressEvent } from '@shared/types'
import { prepareModInstall, commitModInstall, discardModInstall, errText, onProgress, cancelTask, formatSpeed } from '../api'
import { matchingModProgress, modProgressPercent, modProgressBytes } from '../modInstallProgress'
import { store, toast } from '../store'
import MarqueeText from './MarqueeText.vue'
import CommunityModDetails from './CommunityModDetails.vue'
import type { CommunityProjectReference } from '@shared/types'
const props = defineProps<{ target: InstalledVersion; input: { paths?: string[]; file?: CommunityFile } }>()
const emit = defineEmits<{ close: []; installed: [] }>()
const plan = ref<ModInstallPlan>(), busy = ref(true), error = ref('')
const includeDependencies = ref(true), detail = ref<CommunityProjectReference | null>(null)
const dependencies = computed(() => plan.value?.files.filter(file => file.dependency) ?? [])
const dependencyOptOut = computed(() => dependencies.value.length > 0 && !includeDependencies.value)
const progress = ref<ProgressEvent>(), cancelling = ref(false)
const progressPercent = computed(() => progress.value ? modProgressPercent(progress.value) : undefined)
let operationId = ''
const offProgress = onProgress(event => {
  const matching = matchingModProgress(event, operationId, busy.value)
  if (matching) progress.value = matching
})
let disposed = false
let generation = 0
async function prepare() {
  if (busy.value && plan.value) return
  const current = ++generation
  if (plan.value) { void discardModInstall(plan.value.id); plan.value = undefined }
  busy.value = true; error.value = ''; includeDependencies.value = true
  operationId = crypto.randomUUID(); progress.value = undefined; cancelling.value = false
  try {
    const result = await prepareModInstall({ id: props.target.id, folder: props.target.folder! }, props.input, operationId)
    if (disposed || current !== generation) { void discardModInstall(result.id); return }
    plan.value = result
  } catch (e) { if (!disposed && current === generation) error.value = errText(e) }
  finally { if (!disposed && current === generation) busy.value = false }
}
onMounted(() => void prepare())
onUnmounted(() => { disposed = true; generation++; operationId = ''; offProgress(); if (plan.value) void discardModInstall(plan.value.id) })
function dependencyDetails(file: ModInstallPlan['files'][number]) {
  if (file.source && file.projectId) detail.value = { source: file.source, projectId: file.projectId, title: file.fileName }
}
async function install() {
  if (!plan.value || busy.value || dependencyOptOut.value || plan.value.warnings.length) return
  busy.value = true; error.value = ''
  operationId = crypto.randomUUID(); progress.value = undefined; cancelling.value = false
  try {
    const message = await commitModInstall(plan.value.id, includeDependencies.value, operationId)
    toast(message, 'success'); store.fsRefreshTick++; emit('installed')
  } catch (e) { error.value = errText(e); plan.value = undefined }
  finally { busy.value = false }
}
async function cancelDownload() {
  if (!progress.value?.taskId || cancelling.value || !busy.value) return
  cancelling.value = true
  try { await cancelTask(progress.value.taskId) }
  catch (e) { if (!disposed) error.value = errText(e) }
  finally { if (!disposed) cancelling.value = false }
}
</script>
<template>
  <Teleport to="body"><div class="modal-mask" style="z-index: 10020" @pointerdown.self="!busy && emit('close')">
    <section class="modal modinstall-modal" role="dialog" aria-modal="true" aria-label="安装 MOD 与前置">
      <h3 class="modal-title">安装 MOD 与前置</h3>
      <p class="muted modinstall-sub">{{ target.id }} · MC {{ target.mcVersion }} · {{ target.loader }} {{ target.loaderVersion }}<br>{{ target.folder }}</p>
      <div v-if="busy" class="modal-loading"><span class="spin"></span><span class="muted">{{ plan ? '正在下载、校验并安装…' : '正在读取 MOD 元数据与递归前置关系…' }}</span></div>
      <div v-if="busy && progress" class="mod-progress" data-ui="mod-install:progress">
        <div class="mod-progress-caption"><span>{{ progress.text }}</span><strong>{{ progressPercent == null ? '处理中…' : progressPercent + '%' }}</strong></div>
        <div class="mod-progress-track" role="progressbar" aria-label="MOD 下载与安装进度" :aria-valuenow="progressPercent" aria-valuemin="0" aria-valuemax="100" :class="{ indeterminate: progressPercent == null }"><div :style="progressPercent == null ? undefined : { width: progressPercent + '%' }"></div></div>
        <div class="mod-progress-detail"><span v-if="progress.bytesDone != null">{{ modProgressBytes(progress.bytesDone) }}<template v-if="progress.bytesTotal != null"> / {{ modProgressBytes(progress.bytesTotal) }}</template><template v-else> · 总大小未知</template></span><span v-if="progress.speed">{{ formatSpeed(progress.speed) }}</span><span v-if="!plan">预下载与检测，尚未安装</span><span>顶部“下载”同步记录本次任务</span></div>
      </div>
      <template v-if="plan">
        <div v-for="f in plan.files" :key="f.fileName" class="dependency-row"><span class="tag">{{ f.dependency ? '待安装前置' : '所选 MOD' }}</span><div class="dependency-name"><MarqueeText :text="f.fileName"/><MarqueeText :text="f.version"/></div><button v-if="f.dependency && f.source && f.projectId" class="btn btn-ghost btn-sm" :disabled="busy" @click="dependencyDetails(f)">查看项目</button></div>
        <p v-if="plan.missing.length" class="muted modal-note">元数据要求：{{ plan.missing.join('、') }}</p>
        <p v-for="warning in plan.warnings" :key="warning" class="modal-error">{{ warning }}</p>
        <label v-if="dependencies.length" class="dependency-choice"><input v-model="includeDependencies" type="checkbox" :disabled="busy" /><span>同时下载 {{ dependencies.length }} 个必要前置<small>与 MC {{ target.mcVersion }} / {{ target.loader }} 匹配，递归检测并校验后一起安装。</small></span></label>
        <p v-if="dependencyOptOut" class="modal-error" role="status">已取消自动下载。必要前置仍未准备好，暂不写入所选 MOD。请先自行安装前置，再点击重新检测；也可勾选后一起下载。</p>
        <p class="modal-note">已有兼容前置将复用；无法查询、没有兼容版本或出现冲突时会停止，不会当作“无需前置”继续安装。</p>
      </template>
      <p v-if="error" class="modal-error">{{ error }}</p>
      <div class="modal-actions"><button v-if="busy && progress?.taskId" class="btn btn-ghost" :disabled="cancelling" @click="cancelDownload">{{ cancelling ? '正在取消…' : '取消下载' }}</button><button class="btn btn-ghost" :disabled="busy" @click="emit('close')">取消</button><button v-if="error || dependencyOptOut || plan?.warnings.length" class="btn btn-ghost" :disabled="busy" @click="prepare">{{ error ? '重试检测' : '重新检测' }}</button><button v-if="plan" class="btn btn-gold" :disabled="busy || !!plan.warnings.length || dependencyOptOut" @click="install">{{ dependencies.length ? '下载前置并安装' : '确认安装' }}</button></div>
    </section>
  </div></Teleport>
  <CommunityModDetails v-if="detail" :reference="detail" :allow-download="false" @close="detail = null" />
</template>
<style scoped>
.modinstall-modal {
  width: min(640px, calc(100vw - 40px));
  max-height: 85vh;
  overflow-y: auto;
}
.modal-title {
  font-size: var(--text-lg);
  font-weight: 700;
  margin: 0 0 var(--space-2);
}
.modinstall-sub {
  font-size: var(--text-xs);
  margin: 0;
  line-height: 1.6;
  word-break: break-all;
}
.modal-loading {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) 0;
}
.mod-progress { padding: var(--space-3); margin-bottom: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card-2); }
.mod-progress-caption { display: flex; align-items: flex-start; gap: var(--space-3); font-size: var(--text-sm); line-height: 1.5; }
.mod-progress-caption span { min-width: 0; flex: 1; overflow-wrap: anywhere; }
.mod-progress-caption strong { flex: none; font-variant-numeric: tabular-nums; }
.mod-progress-track { height: 6px; margin: var(--space-3) 0; overflow: hidden; border-radius: 999px; background: var(--border); }
.mod-progress-track > div { height: 100%; border-radius: inherit; background: var(--accent); }
.mod-progress-track.indeterminate > div { width: 35%; animation: mod-download 1.4s ease-in-out infinite; }
.mod-progress-detail { display: flex; flex-wrap: wrap; gap: 4px var(--space-3); color: var(--text-dim); font-size: var(--text-xs); line-height: 1.5; }
@keyframes mod-download { from { transform: translateX(-100%); } to { transform: translateX(290%); } }
@media (prefers-reduced-motion: reduce) { .mod-progress-track.indeterminate > div { animation: none; width: 100%; opacity: .55; } }
.dependency-row { display: flex; align-items: center; gap: var(--space-3); min-height: var(--row-h); padding: var(--space-2) 0; border-bottom: 1px solid var(--border); }
.dependency-name { min-width: 0; flex: 1; }
.dependency-choice{display:flex;gap:12px;align-items:flex-start;margin:16px 0;padding:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--card-2);font-size:var(--text-sm)}.dependency-choice input{margin-top:2px;flex:none}.dependency-choice span{min-width:0}.dependency-choice small{display:block;color:var(--text-dim);font-size:var(--text-xs);line-height:1.6;margin-top:6px}
.modal-note { font-size: var(--text-sm); line-height: 1.6; color: var(--text-dim); }
.modal-error { color: var(--danger); white-space: pre-wrap; font-size: var(--text-sm); }
.modal-actions { display: flex; align-items: center; gap: var(--space-3); justify-content: flex-end; margin-top: var(--space-5); }
</style>
