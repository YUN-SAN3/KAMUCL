<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import SelectMenu from './SelectMenu.vue'
import ConfirmModal from './ConfirmModal.vue'
import { favorites, favoriteBusy, favoriteErrors, clearFavoriteErrors, linkFavorite, loadFavorites, removeFavorites } from '../modFavorites'
import { favoriteIconUrl, filterFavorites, type FavoriteFilter, type ModFavorite } from '@shared/modFavorites'
import type { CommunityProjectReference, CommunitySource } from '@shared/types'
import { communityProject, errText } from '../api'

const props = defineProps<{ keyword?: string }>()
const emit = defineEmits<{ (event: 'download', project: CommunityProjectReference): void; (event: 'details', project: CommunityProjectReference): void; (event: 'browse'): void }>()
const keyword = ref(props.keyword ?? ''), source = ref<FavoriteFilter['source']>('all'), sort = ref<FavoriteFilter['sort']>('newest')
watch(() => props.keyword, value => { keyword.value = value ?? '' })
const visible = computed(() => filterFavorites(favorites.value, {keyword: keyword.value, source: source.value, sort: sort.value}))
const selected = ref(new Set<string>()), pendingRemoval = ref<string[]>([]), removing = ref(false)
const loading = ref(false), loadError = ref('')
const projectIcons = ref(new Map<string, string>()), failedIcons = ref(new Set<string>()), iconRevision = ref(0)
function icon(record: ModFavorite) { return favoriteIconUrl(record.iconUrl) || projectIcons.value.get(record.key) }
// Old favorites have no artwork field. Fetch their verified MOD metadata in a
// bounded queue without delaying the list or writing over favorite mutations.
watch(() => `${iconRevision.value}|` + favorites.value.map(record => `${record.key}:${record.iconUrl || ''}`).join('|'), async (_value, _previous, cleanup) => {
  let stale = false; cleanup(() => { stale = true })
  const pending = favorites.value.filter(record => record.source && record.projectId && !icon(record))
  await Promise.all(Array.from({length: Math.min(3, pending.length)}, async () => {
    while (!stale && pending.length) {
      const record = pending.shift()!
      try {
        const project = await communityProject(record.source!, record.projectId!)
        const url = favoriteIconUrl(project.iconUrl)
        if (!stale && url) projectIcons.value = new Map(projectIcons.value).set(record.key, url)
      } catch { /* Artwork is optional; installation and favorite state stay usable offline. */ }
    }
  }))
}, { immediate: true })
const allSelected = computed(() => visible.value.length > 0 && visible.value.every(f => selected.value.has(f.key)))
const someSelected = computed(() => visible.value.some(f => selected.value.has(f.key)))
const selectionBusy = computed(() => [...selected.value].some(key => favoriteBusy.value.has(key)))
const removalError = computed(() => [...new Set(pendingRemoval.value.map(key => favoriteErrors.value.get(key)).filter(Boolean))].join('\n'))
function requestCancellation() { const keys = [...selected.value]; clearFavoriteErrors(keys); pendingRemoval.value = keys }
watch(favorites, list => { const keys = new Set(list.map(f => f.key)); selected.value = new Set([...selected.value].filter(key => keys.has(key))) })
function select(key: string, enabled: boolean) { const next = new Set(selected.value); enabled ? next.add(key) : next.delete(key); selected.value = next }
function selectVisible(enabled: boolean) { const next = new Set(selected.value); for (const f of visible.value) enabled ? next.add(f.key) : next.delete(f.key); selected.value = next }
async function refresh() {
  loading.value = true; loadError.value = ''
  failedIcons.value = new Set()
  try { await loadFavorites(true) } catch (error) { loadError.value = errText(error) }
  finally { loading.value = false; iconRevision.value++ }
}
onMounted(() => void refresh())
async function cancelSelected() {
  if (removing.value) return
  removing.value = true
  try { if (await removeFavorites(pendingRemoval.value)) pendingRemoval.value = [] }
  finally { removing.value = false }
}
const linkRecord = ref<ModFavorite | null>(null), linkSource = ref<CommunitySource>('modrinth'), projectId = ref(''), linking = ref(false), linkError = ref('')
function openLink(record: ModFavorite) { linkRecord.value = record; linkSource.value = 'modrinth'; projectId.value = ''; linkError.value = '' }
async function confirmLink() {
  if (!linkRecord.value || !projectId.value.trim() || linking.value) return
  linking.value = true; linkError.value = ''
  try { if (await linkFavorite(linkRecord.value.key, linkSource.value, projectId.value.trim())) linkRecord.value = null
    else linkError.value = favoriteErrors.value.get(linkRecord.value.key) || '该收藏正在保存，请稍后重试。' }
  finally { linking.value = false }
}
function project(record: ModFavorite): CommunityProjectReference {
  return { source: record.source!, projectId: record.projectId!, title: record.name }
}
const sourceOptions = [{value:'all',label:'全部来源'},{value:'modrinth',label:'Modrinth'},{value:'curseforge',label:'CurseForge'},{value:'unlinked',label:'来源未关联'}]
const sortOptions = [{value:'newest',label:'最近收藏'},{value:'oldest',label:'最早收藏'},{value:'name',label:'名称排序'}]
</script>

<template>
  <section class="favorites-manager" data-ui="favorites:manager" aria-label="收藏模组管理" :aria-busy="loading">
    <div class="card favorites-toolbar">
      <div class="favorites-heading"><div><h2>已收藏 MOD <small>{{ favorites.length }}</small></h2><p class="muted">跨实例共享。新建游戏实例时可一并安装；也可为单个模组选择兼容实例。</p></div><button class="btn btn-ghost btn-sm" :disabled="loading" @click="refresh">{{ loading ? '读取中…' : '刷新' }}</button></div>
      <div class="favorites-filters"><input class="input" v-model="keyword" aria-label="搜索收藏模组" placeholder="搜索名称、项目 ID 或文件哈希…" /><SelectMenu v-model="source" aria-label="收藏来源" :options="sourceOptions" /><SelectMenu v-model="sort" aria-label="收藏排序" :options="sortOptions" /></div>
      <div class="favorites-selection"><label class="favorite-select"><input type="checkbox" aria-label="选择全部筛选结果" :checked="allSelected" :indeterminate="someSelected && !allSelected" :disabled="!visible.length" @change="selectVisible(($event.target as HTMLInputElement).checked)" />选择当前 {{ visible.length }} 项</label><span class="muted">已选 {{ selected.size }} 项</span><button v-if="selected.size" class="btn btn-ghost btn-sm" @click="selected = new Set()">清空选择</button><button class="btn btn-danger btn-sm batch-unfavorite" :disabled="!selected.size || selectionBusy" @click="requestCancellation">取消所选收藏</button></div>
    </div>
    <div v-if="loadError" class="favorites-status" role="alert">读取失败：{{ loadError }}<span v-if="favorites.length"> · 保留上次已确认的收藏</span><button class="btn btn-ghost btn-sm" @click="refresh">重试</button></div>
    <div v-if="loading && !favorites.length" class="card favorite-empty" role="status">正在读取收藏…</div>
    <div v-else-if="!favorites.length && !loadError" class="card favorite-empty"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z" /></svg><strong>还没有收藏模组</strong><span class="muted">在浏览列表中点亮星标，即可在这里统一管理。</span><button class="btn btn-gold" @click="emit('browse')">去浏览模组</button></div>
    <div v-else-if="!visible.length && !loadError" class="card favorite-empty"><strong>没有匹配的收藏</strong><span class="muted">尝试其他名称或来源。</span><button class="btn btn-ghost" @click="keyword = ''; source = 'all'">清除筛选</button></div>
    <div v-else class="favorite-list">
      <article v-for="record in visible" :key="record.key" class="card favorite-card" :data-favorite-key="record.key" :aria-busy="favoriteBusy.has(record.key)">
        <div class="favorite-card-top"><label class="favorite-select"><input type="checkbox" :aria-label="`选择收藏 ${record.name}`" :checked="selected.has(record.key)" :disabled="favoriteBusy.has(record.key)" @change="select(record.key, ($event.target as HTMLInputElement).checked)" /><span class="sr-only">选择 {{ record.name }}</span></label><span class="favorite-icon" aria-hidden="true"><img v-if="icon(record) && !failedIcons.has(record.key)" :src="icon(record)" alt="" loading="lazy" referrerpolicy="no-referrer" @error="failedIcons = new Set([...failedIcons, record.key])" /><svg v-else viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m12 3 9 5v8l-9 5-9-5V8Z M3 8l9 5 9-5 M12 13v8" /></svg></span><div class="favorite-title"><h3 :title="record.name">{{ record.name }}</h3><span class="tag" :class="record.source === 'modrinth' ? 'tag-success' : record.source === 'curseforge' ? 'tag-cf' : 'tag-danger'">{{ record.source === 'modrinth' ? 'Modrinth' : record.source === 'curseforge' ? 'CurseForge' : '来源未关联' }}</span></div></div>
        <p class="favorite-identity muted" :title="record.projectId || record.sha1 || record.key">{{ record.projectId ? `项目 ID · ${record.projectId}` : `文件 SHA1 · ${record.sha1 || record.key.slice(5)}` }}</p>
        <p v-if="!record.source || !record.projectId" class="favorite-link-hint">关联来源项目后，可查询兼容版本并下载。</p><p v-else class="favorite-link-hint muted">下载时按 Minecraft 版本和加载器查询兼容文件。</p>
        <p v-if="favoriteErrors.get(record.key)" class="favorites-status" role="alert">{{ favoriteErrors.get(record.key) }}</p><div class="favorite-card-foot"><small class="muted">收藏于 {{ new Date(record.added).toLocaleDateString('zh-CN') }}</small><div class="favorite-card-actions"><button class="icon-btn favorite-remove" :disabled="favoriteBusy.has(record.key)" :aria-label="`取消收藏 ${record.name}`" title="取消收藏" @click="removeFavorites([record.key])"><svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z" /></svg></button><button v-if="record.source && record.projectId" class="btn btn-ghost btn-sm favorite-details" :disabled="favoriteBusy.has(record.key)" @click="emit('details', project(record))">查看详情</button><button v-if="record.source && record.projectId" class="btn btn-gold btn-sm favorite-download" :disabled="favoriteBusy.has(record.key)" @click="emit('download', project(record))">选择版本并安装</button><button v-else class="btn btn-ghost btn-sm favorite-link" :disabled="favoriteBusy.has(record.key)" @click="openLink(record)">关联项目</button></div></div>
      </article>
    </div>
    <ConfirmModal :open="!!pendingRemoval.length" title="取消所选收藏" :message="`将取消 ${pendingRemoval.length} 个模组的收藏，已安装的模组文件会保留。`" confirm-text="取消收藏" :busy="removing" :error="removalError" @confirm="cancelSelected" @cancel="pendingRemoval = []" />
    <Teleport to="body"><div v-if="linkRecord" class="modal-mask" @pointerdown.self="!linking && (linkRecord = null)" @keydown.esc="!linking && (linkRecord = null)"><section class="modal favorite-link-modal" role="dialog" aria-modal="true" aria-labelledby="favorite-link-title"><div class="favorite-link-heading"><h3 class="modal-title" id="favorite-link-title">关联模组项目</h3><button class="icon-btn" aria-label="关闭关联项目" :disabled="linking" @click="linkRecord = null">×</button></div><p class="muted">{{ linkRecord.name }} · 将验证来源项目是 Minecraft 模组；重复项目会合并，保留已有收藏时间和文件哈希。</p><label>来源平台<SelectMenu v-model="linkSource" :options="sourceOptions.filter(option => option.value === 'modrinth' || option.value === 'curseforge')" aria-label="关联来源平台" /></label><label>项目 ID<input v-model="projectId" class="input" :disabled="linking" aria-label="来源项目 ID" placeholder="Modrinth 项目 ID / slug，或 CurseForge 数字 ID" @keydown.enter.prevent="confirmLink" /></label><p v-if="linkError" class="favorites-status" role="alert">{{ linkError }}</p><div class="modal-actions"><button class="btn btn-ghost" :disabled="linking" @click="linkRecord = null">取消</button><button class="btn btn-gold confirm-favorite-link" :disabled="!projectId.trim() || linking" @click="confirmLink">{{ linking ? '验证并关联…' : '验证并关联' }}</button></div></section></div></Teleport>
  </section>
</template>

<style scoped>
.favorites-manager { display:flex;flex-direction:column;gap:16px; }
.favorites-toolbar { padding:18px 20px; }
.favorites-heading { display:flex;align-items:flex-start;justify-content:space-between;gap:12px; }
.favorites-heading h2 { margin:0;font-size:17px; }.favorites-heading h2 small { font-size:12px;color:var(--text-dim);font-weight:400;margin-left:6px; }
.favorites-heading p { margin:6px 0 16px;font-size:12px;line-height:1.7; }
.favorites-filters { display:flex;align-items:center;gap:10px;flex-wrap:wrap; }.favorites-filters>.input { flex:1;min-width:200px; }.favorites-filters :deep(.select-menu-btn) { width:145px;flex:none; }
.favorites-selection { display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid var(--border);font-size:12px; }.batch-unfavorite { margin-left:auto; }
.favorite-select { display:inline-flex;align-items:center;gap:8px;cursor:pointer; }.favorite-select input { width:17px;height:17px;accent-color:var(--accent);margin:0; }
.favorites-status { display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--danger);font-size:13px; }
.favorite-list { display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,310px),1fr));gap:14px; }
.favorite-card { min-width:0;padding:18px;display:flex;flex-direction:column;gap:12px;transition:border-color 160ms; }.favorite-card:focus-within { border-color:var(--accent); }
.favorite-card-top { display:flex;align-items:center;gap:12px; }.favorite-icon { display:grid;place-items:center;flex:none;width:42px;height:42px;border:1px solid var(--border);border-radius:11px;background:var(--accent-soft);color:var(--accent-2);font-size:19px;font-weight:700; }
.favorite-icon img { width:100%;height:100%;object-fit:contain;border-radius:inherit; }.favorite-title { min-width:0; }.favorite-title h3 { font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0 0 6px; }.tag { font-size:10px;padding:3px 7px; }.tag-cf { color:#f7a063;background:rgba(247,160,99,.12); }
.favorite-identity { font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0; }.favorite-link-hint { font-size:12px;line-height:1.65;margin:0;min-height:40px; }
.favorite-card-foot { display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:auto;padding-top:12px;border-top:1px solid var(--border); }.favorite-card-foot small { font-size:10px; }.favorite-card-actions { display:flex;align-items:center;gap:5px;margin-left:auto;flex-wrap:wrap; }.favorite-remove { color:var(--accent-2); }
.favorite-empty { display:flex;flex-direction:column;align-items:center;gap:12px;padding:44px 24px;text-align:center; }.favorite-empty svg { color:var(--text-dim); }.favorite-empty .muted { font-size:13px; }
.favorite-link-modal { padding:24px;width:min(520px,calc(100vw - 32px)); }.favorite-link-heading { display:flex;align-items:center;justify-content:space-between;gap:12px; }.favorite-link-modal p { font-size:13px;line-height:1.7; }.favorite-link-modal label { display:flex;flex-direction:column;gap:8px;margin:16px 0;font-size:13px; }.favorite-link-modal .input { width:100%; }
.sr-only { position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap; }
@media(max-width:700px) { .favorites-toolbar{padding:16px}.favorites-heading{flex-wrap:wrap}.favorites-filters>*{flex:1}.favorites-selection{gap:10px}.favorite-card{padding:16px} }
</style>
