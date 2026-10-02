<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { RecordingCatalog, RecordingEntry, RecordingRequest, RecordingResult } from '@shared/recordings'
import { errText } from '../api'
import { store, toast } from '../store'
import ContentSkeleton from '../components/ContentSkeleton.vue'
import SelectMenu from '../components/SelectMenu.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
const data = ref<RecordingCatalog>({ entries: [], warnings: [], library: '', instances: [] })
const loading = ref(false), busy = ref(false), error = ref(''), query = ref(''), kind = ref('all'), source = ref('all'), page = ref(1), selected = ref<string[]>([]), target = ref(''), confirm = ref<'trash' | 'dispatch' | ''>('')
const results = ref<RecordingResult[]>([])
let generation = 0, disposed = false
let refreshTimer: ReturnType<typeof setInterval> | undefined
const activeFolder = computed(() => store.settings?.activeFolder || store.settings?.gameDir || '')
const folderFilter = ref('')
const folderOptions = computed(() => [{ value: '', label: '全部已绑定文件夹' }, ...(store.settings?.folders ?? []).map(f => ({ value: f.path, label: f.name + ' · ' + f.path }))])
watch(() => JSON.stringify([activeFolder.value, store.settings?.folders]), () => { void refresh(true) })
watch(folderOptions, options => { if (!options.some(o => o.value === folderFilter.value)) folderFilter.value = '' })
watch(() => store.fsRefreshTick, () => { if (!busy.value) void refresh() })
const invoke = <T,>(channel: string, ...args: unknown[]) => window.kamucl.invoke(channel, ...args) as Promise<T>
const filtered = computed(() => data.value.entries.filter(e => (!folderFilter.value || e.folder === folderFilter.value) && (kind.value === 'all' || e.kind === kind.value) && (source.value === 'all' || (source.value === 'library' ? e.library : !e.library)) && `${e.name} ${e.source} ${e.directory}`.toLowerCase().includes(query.value.trim().toLowerCase())))
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 40)))
const rows = computed(() => filtered.value.slice((page.value - 1) * 40, page.value * 40))
const targets = computed(() => data.value.instances.map(i => ({ value: JSON.stringify([i.folder, i.id]), label: i.name })))
const size = (n: number) => n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
watch([query, kind, source, folderFilter], () => { page.value = 1; selected.value = [] })
async function refresh(silent = false) {
  const id = ++generation; if (!silent) loading.value = true; error.value = ''
  try { const next = await invoke<RecordingCatalog>('recordings:list'); if (disposed || id !== generation) return; data.value = next; if (!targets.value.some(t => t.value === target.value)) target.value = ''; selected.value = selected.value.filter(id => next.entries.some(e => e.id === id)); page.value = Math.min(page.value, pages.value); if (!silent) target.value = '' }
  catch (e) { if (!disposed && id === generation) error.value = errText(e) }
  finally { if (!disposed && id === generation) loading.value = false }
}
function drag(event: DragEvent, entry: RecordingEntry) {
  event.preventDefault(); event.stopPropagation()
  if (busy.value || loading.value || store.editMode) return
  window.kamucl.send('recordings:drag', selected.value.includes(entry.id) ? [...selected.value] : [entry.id])
}
function autoRefresh() { if (!busy.value && !loading.value && !selected.value.length && !target.value && document.visibilityState === 'visible') void refresh(true) }
function selectPage() { const ids = rows.value.map(e => e.id); selected.value = ids.every(id => selected.value.includes(id)) ? selected.value.filter(id => !ids.includes(id)) : [...new Set([...selected.value, ...ids])] }
async function open(entry?: RecordingEntry) { try { await invoke('recordings:open', entry?.id) } catch (e) { toast(errText(e), 'error') } }
async function execute(action: RecordingRequest['action'] | 'import') {
  if (busy.value) return
  const ids = [...selected.value], destination = target.value === '' ? undefined : data.value.instances.find(i => JSON.stringify([i.folder, i.id]) === target.value)
  confirm.value = ''; busy.value = true
  try {
    const result = action === 'import' ? await invoke<RecordingResult[] | null>('recordings:import') : await invoke<RecordingResult[] | null>('recordings:operate', { action, ids, target: destination })
    if (result) { results.value = result; const failed = result.filter(r => !r.ok); selected.value = failed.map(r => r.id); toast(`已完成 ${result.length - failed.length} 项${failed.length ? `，${failed.length} 项未完成` : ''}`, failed.length ? 'error' : 'success'); await refresh() }
  } catch (e) { toast(errText(e), 'error') } finally { busy.value = false }
}
function escape(e: KeyboardEvent) { if (e.key === 'Escape') confirm.value = '' }
onMounted(() => { void refresh(); window.addEventListener('keydown', escape); window.addEventListener('focus', autoRefresh); refreshTimer = setInterval(autoRefresh, 15000) })
onUnmounted(() => { disposed = true; generation++; clearInterval(refreshTimer); window.removeEventListener('keydown', escape); window.removeEventListener('focus', autoRefresh) })
</script>

<template>
  <section class="recordings-page" data-ui="recordings:page">
    <header class="page-head recording-heading" data-ui="recordings:heading"><div data-ui="RecordingsView:3e7b827962e6"><h1 data-ui="RecordingsView:2ac7467a0648">录像 <small>{{ data.entries.length }} 个</small></h1><p class="muted">汇总全部绑定目录的 ReplayMod 与 Flashback 录像。</p></div><div class="actions"><button data-ui="RecordingsView:78a31a977742" class="btn btn-ghost" @click="open()">打开收藏文件夹</button><button data-ui="RecordingsView:1594a41b4b07" class="btn btn-gold" :disabled="busy" @click="execute('import')">导入录像…</button><button data-ui="RecordingsView:54ee9bdbb21c" class="btn btn-ghost" :disabled="busy || loading" @click="refresh()">{{ loading ? '读取中…' : '↻ 刷新' }}</button></div></header>
    <div class="recording-library" data-ui="recordings:library"><span data-ui="RecordingsView:2931d23fc4f5" class="muted">导入与收藏保存位置：</span><span class="path" :title="data.library">{{ data.library || '正在读取…' }}</span><details class="recording-help"><summary>使用说明</summary><p>自动汇总全部已绑定目录中的实例、共享目录与收藏，原录像保持原位。按住录像名称可拖出，勾选后可一起拖出。复制时校验完整性，同名文件自动添加序号。播放、渲染请在对应模组内完成；跨版本复制前请确认兼容性。</p></details></div>
    <section class="recording-workspace card">
    <div class="recording-filters" data-ui="recordings:filters">
      <SelectMenu v-model="folderFilter" :disabled="busy" :options="folderOptions" />
      <input data-ui="RecordingsView:a4bc662c17f4" v-model="query" class="input" aria-label="搜索录像" placeholder="搜索录像名称、实例或路径…" :disabled="busy" />
      <SelectMenu v-model="kind" :disabled="busy" :options="[{ value: 'all', label: '全部格式' }, { value: 'replaymod', label: 'ReplayMod' }, { value: 'flashback', label: 'Flashback' }]" />
      <SelectMenu v-model="source" :disabled="busy" :options="[{ value: 'all', label: '全部位置' }, { value: 'library', label: '集中收藏' }, { value: 'instances', label: '游戏目录' }]" />
    </div>
    <div data-ui="RecordingsView:03ebe3d01f67" v-if="error" class="card" role="alert">{{ error }} <button data-ui="RecordingsView:d86b658466b7" class="btn btn-ghost" @click="refresh()">重试</button></div>
    <details data-ui="RecordingsView:4886ef0bbbad" v-if="data.warnings.length" class="card"><summary>部分目录未读取（{{ data.warnings.length }}）</summary><p data-ui="RecordingsView:a95d7ac71e30" v-for="warning in data.warnings" :key="warning">{{ warning }}</p></details>
    <div v-if="filtered.length" class="recording-controls" data-ui="recordings:controls">
      <div class="actions"><button data-ui="RecordingsView:f5fef6266bd6" class="btn btn-ghost" :disabled="busy || !rows.length" @click="selectPage">选择当前页</button><button data-ui="RecordingsView:8436cfb2245d" class="btn btn-ghost" :disabled="busy || !filtered.length" @click="selected = filtered.map(e => e.id)">全选筛选结果（{{ filtered.length }}）</button><span>已选 {{ selected.length }} 项</span><button data-ui="RecordingsView:ed589ee8e06c" v-if="selected.length" class="btn btn-ghost" :disabled="busy" @click="selected = []">清空</button></div>
      <div data-ui="RecordingsView:c59dbb632ead" v-if="selected.length" class="actions operation-row"><button data-ui="RecordingsView:85f3f8414f9d" class="btn btn-gold" :disabled="busy" @click="execute('collect')">收集到当前文件夹收藏</button><button data-ui="RecordingsView:000f81fa6db3" class="btn btn-ghost" :disabled="busy" @click="execute('export')">提取到文件夹…</button><SelectMenu v-model="target" :disabled="busy" :options="targets" placeholder="选择目标实例" /><button data-ui="RecordingsView:fa2131a8e18d" class="btn btn-ghost" :disabled="busy || target === ''" @click="confirm = 'dispatch'">复制到实例</button><button data-ui="RecordingsView:1699f50ec9f0" class="btn btn-danger" :disabled="busy" @click="confirm = 'trash'">移入回收站</button></div>

    </div>
    <div data-ui="RecordingsView:69fb5a4a1573" v-if="loading && data.entries.length" class="status-strip" role="status">正在更新录像列表…</div>
    <ContentSkeleton v-if="loading && !data.entries.length" class="card" label="正在读取录像目录…"/>
    <div data-ui="RecordingsView:9196e415ffb9" v-else-if="!rows.length && !error" class="card empty"><span>{{ data.entries.length ? '没有匹配的录像，请调整搜索或筛选。' : '暂无录像。可导入 .mcpr 或 Flashback .zip，或在游戏中完成录制并保存。' }}</span><button data-ui="RecordingsView:c0ed13df1c01" v-if="data.entries.length" class="btn btn-ghost" @click="query='';kind='all';source='all';folderFilter=''">清除筛选</button></div>
    <div v-else-if="rows.length" :inert="loading || !!error" class="recording-list" data-ui="recordings:list">
      <article data-ui="RecordingsView:2bb2004aef70" v-for="entry in rows" :key="entry.id" class="recording-row">
        <input data-ui="RecordingsView:d29a579f673a" v-model="selected" type="checkbox" :value="entry.id" :aria-label="`选择 ${entry.name}`" :disabled="busy" />
        <div data-ui="RecordingsView:3867dfbdf0e7" class="recording-info" :draggable="!busy && !loading && !store.editMode" title="按住拖出录像文件" @dragstart="drag($event, entry)"><strong data-ui="RecordingsView:6f5f6ab090cd" tabindex="0" :title="entry.name">{{ entry.name }}</strong><div data-ui="RecordingsView:80aad3d6d4fa" class="muted">{{ entry.kind === 'replaymod' ? 'ReplayMod' : 'Flashback' }} · {{ entry.source }} · {{ size(entry.size) }} · {{ new Date(entry.modified).toLocaleString() }}</div><div data-ui="RecordingsView:2185a2a82be6" class="muted path" :title="entry.directory">{{ entry.directory }}</div></div>
        <button data-ui="RecordingsView:e41d05dae554" class="btn btn-ghost btn-sm" @click="open(entry)">定位文件</button>
      </article>
    </div>
    <div data-ui="RecordingsView:419803271708" v-if="pages > 1" class="actions pagination"><button data-ui="RecordingsView:0fa04d3df515" class="btn btn-ghost" :disabled="page <= 1" @click="page--">上一页</button><span>{{ page }} / {{ pages }} · {{ filtered.length }} 个录像</span><button data-ui="RecordingsView:6380222140de" class="btn btn-ghost" :disabled="page >= pages" @click="page++">下一页</button></div>
    </section>
    <details data-ui="RecordingsView:d26a22685a69" v-if="results.length" open class="card recording-results"><summary>上次操作结果</summary><p data-ui="RecordingsView:3b547d60eb96" v-for="result in results" :key="result.id" :class="{ failed: !result.ok }">{{ result.name }}：{{ result.ok ? '已完成' : result.error }}<span data-ui="RecordingsView:3a6703ddc9e2" v-if="result.path" class="muted path"> → {{ result.path }}</span></p></details>
    <ConfirmModal :open="!!confirm" :title="confirm === 'trash' ? '移入系统回收站' : '复制录像到实例'" :message="confirm === 'trash' ? `将所选 ${selected.length} 个原位置的录像移入系统回收站，可从系统回收站恢复。` : `将 ${selected.length} 个录像复制到所选实例的对应模组目录，保留源文件。请确认目标游戏版本、加载器与录像模组兼容；操作期间目标游戏需关闭。`" :confirm-text="confirm === 'trash' ? '移入回收站' : '确认复制'" @cancel="confirm = ''" @confirm="execute(confirm as 'trash' | 'dispatch')" />
  </section>
</template>

<style scoped>
.recordings-page{max-width:1440px;margin:0 auto;display:grid;gap:20px;min-width:0}.page-head h1{margin:0 0 8px}.card{padding:22px}.recording-library{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}.recording-library h3{margin:0}.actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.recording-filters{display:grid;grid-template-columns:minmax(200px,1fr) minmax(180px,1fr) 150px 150px;gap:12px}.recording-controls{display:grid;gap:16px}.recording-controls p{margin:0}.operation-row :deep(.select-menu-btn){max-width:360px}.recording-list{overflow:visible}.recording-row{display:flex;align-items:center;gap:16px;padding:16px 0;border-bottom:1px solid var(--border)}.recording-row:last-child{border:0}.recording-info{flex:1;min-width:0;display:grid;gap:6px}.recording-info[draggable="true"]{cursor:grab}.recording-info strong{overflow-wrap:anywhere}.path{overflow-wrap:anywhere;font-size:12px}.recording-info .path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pagination{justify-content:center}.empty{text-align:center;padding:40px}.failed{color:var(--danger,#e76b75)}.recording-results{max-height:300px;overflow:auto}.recording-results p{overflow-wrap:anywhere}@media(max-width:800px){.recording-filters{grid-template-columns:1fr 1fr}.recording-filters input{grid-column:1/-1}.recording-row{gap:10px}.card{padding:16px}}
.recordings-page{gap:12px}.recording-heading{display:flex;flex-direction:row;text-align:left;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.recording-heading h1{font-size:24px}.recording-heading small{font-size:13px;font-weight:400;color:var(--text-dim)}.recording-heading p{margin:4px 0}.recording-library{display:flex;gap:8px;align-items:center;font-size:12px}.recording-library .path{min-width:0;overflow-wrap:anywhere}.recording-help{margin-left:auto;max-width:100%;line-height:1.7}.recording-help summary{cursor:pointer;white-space:nowrap}.recording-workspace{padding:16px;display:grid;gap:12px;min-height:240px;align-content:start}.recording-filters{grid-template-columns:minmax(190px,1.5fr) minmax(160px,1fr) 130px 130px}.recording-filters>input{grid-column:1;grid-row:1}.recording-filters>:first-child{grid-column:2}.recording-controls{padding:8px 0;gap:8px;border-bottom:1px solid var(--border)}.recording-controls .actions{gap:8px}.recording-row{padding:12px 0;min-height:72px}.recording-info strong{word-break:normal;overflow-wrap:break-word}.recording-workspace>.empty{background:transparent;border:0;min-height:220px;box-shadow:none}.recording-results{padding:12px 16px}.recording-results summary{cursor:pointer}@media(max-width:1150px){.recording-filters{grid-template-columns:1fr 1fr}.recording-filters>input{grid-column:1/-1}.recording-filters>:first-child{grid-row:2;grid-column:1}}@media(max-width:650px){.recording-filters{display:flex;flex-direction:column}.recording-workspace{padding:12px}}
</style>
