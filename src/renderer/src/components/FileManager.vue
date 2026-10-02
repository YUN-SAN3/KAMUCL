<script setup lang="ts">
/**
 * 通用文件管理视图：模组 / 资源包 / 光影包共用。
 * 通过 IPC fs:list / fs:remove / app:openDir 管理游戏目录下的子目录。
 */
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { getModIcons, importResources, applyModUpdates, checkModUpdates, copyText, errText, listFs, openDir, removeFs, toggleDisableFs } from '../api'
import { displayVersionName as versionLabel, activeInstalled, selectedInstance, refreshInstalled, store, toast } from '../store'
import { resourceDisplayName, pageSelection } from '@shared/uiPresentation'
import ContentSkeleton from './ContentSkeleton.vue'
import ModMigrationModal from './ModMigrationModal.vue'
import ModVersionModal from './ModVersionModal.vue'
import type { ManagedMod, ModOperationResult } from '@shared/modManagement'
import ConfirmModal from './ConfirmModal.vue'
import DupCleanModal from './DupCleanModal.vue'
import SelectMenu from './SelectMenu.vue'
import type { FsEntry, ModUpdateReport } from '@shared/types'

function dragResource(event: DragEvent, entry: FsEntry) {
  event.preventDefault(); event.stopPropagation()
  if (store.editMode || batchBusy.value || loading.value || !currentVersion.value) return
  const names = selection.value.has(entry.name) ? [...selection.value] : [entry.name]
  window.kamucl.send('fs:drag', effectiveRel.value, names, currentVersion.value.folder || activeFolder.value)
}
const props = defineProps<{
  /** 页面标题，如「模组」 */
  title: string
  /** 相对游戏目录的子目录：mods / resourcepacks / shaderpacks */
  rel: string
  /** 打开目录按钮文字 */
  openLabel: string
  /** 空状态文案 */
  emptyText: string
  /** 标题旁与空状态的内联 SVG 图标 */
  icon: string
}>()

const page = ref(1)
const PAGE_SIZE = 100
const entries = ref<FsEntry[]>([])
const loading = ref(true)
const loadError = ref('')
const opening = ref(false)

// ---------------- 版本上下文（模组/资源包/光影包按游戏版本管理） ----------------
/** 当前选中版本（默认第一个已装版本；store.resourceVersionId 三页共享） */
const activeFolder = computed(() => store.settings?.activeFolder || store.settings?.gameDir || '')
const availableVersions = activeInstalled
const currentVersion = computed(() => {
  const list = availableVersions.value
  if (!list.length) return null
  return list.find((v) => v.id === store.resourceVersionId) ?? list[0]
})

/** 实际管理的相对目录：隔离版本 → versions/<id>/<rel>；共享版本 → <rel> */
const effectiveRel = computed(() => {
  const v = currentVersion.value
  return v ? `versions/${v.id}/${props.rel}` : ''
})

/** 目录不存在时视为空列表（隔离版本刚开启、尚未产生该子目录） */
let loadedContext = ''
let loadGeneration = 0
let updateOperation = 0
async function load() {
  const generation = ++loadGeneration
  const v = currentVersion.value
  const context = JSON.stringify([effectiveRel.value, v?.folder || activeFolder.value])
  if (context !== loadedContext) { entries.value = []; selection.value = new Set(); page.value = 1 }
  loadedContext = context; loadError.value = ''
  if (!v) { loading.value = false; return }
  loading.value = true
  try {
    const result = await listFs(effectiveRel.value, v.folder || activeFolder.value)
    if (generation === loadGeneration) { entries.value = result; page.value = Math.min(page.value, pageCount.value); selection.value = new Set([...selection.value].filter(name => result.some(e => e.name === name))); void loadCatalog(generation) }
  } catch (e) { if (generation === loadGeneration) loadError.value = errText(e) }
  finally { if (generation === loadGeneration) loading.value = false }
}

const importing = ref(false)
async function dropResources(event: DragEvent) {
  const v = currentVersion.value
  if (!v) { toast('请先选择当前文件夹中的游戏版本', 'error'); return }
  if (importing.value) return
  const folder = v.folder || activeFolder.value, kind = props.rel
  const files = Array.from(event.dataTransfer?.files ?? []).map(f => window.kamucl.getFilePath(f)).filter(Boolean)
  importing.value = true
  try {
    const count = await importResources(files, v.id, folder, kind)
    toast('已导入 ' + count + ' 项到 ' + v.id + ' / ' + kind, 'success')
    await load()
  } catch (e) { toast('导入失败：' + errText(e), 'error') }
  finally { importing.value = false }
}
onUnmounted(() => { if (store.resourceDropHandler === dropResources) store.resourceDropHandler = null })
onMounted(async () => {
  store.resourceDropHandler = dropResources
  if (!store.installed.length) await refreshInstalled()
  if (!store.resourceVersionId && store.installed.length) {
    store.resourceVersionId = store.installed[0].id
  }
  void load()
})

watch([effectiveRel, activeFolder], () => { updateOperation++; dupOpen.value = false; delModal.open = false; updatePanel.open = false; updatePanel.checking=false; updatePanel.applying=false; updatePanel.report=null; migrationOpen.value=false; void load() })
onUnmounted(() => { loadGeneration++; updateOperation++ })
watch(() => store.fsRefreshTick, () => void load())

// ---------------- 路径显示（超长中间省略 + 点击复制） ----------------
/** 清理重复 MOD 弹窗 */
const dupOpen = ref(false)
const migrationOpen=ref(false)
const updateIcons=ref<Record<string,string>>({})

/** 中间省略的路径：versions/neo…2.0.75/mods */
const fullPath = computed(() => currentVersion.value?.gameDirectory ? currentVersion.value.gameDirectory + '/' + props.rel : effectiveRel.value)
const displayPath = computed(() => fullPath.value.length > 80 ? fullPath.value.slice(0,38) + '…' + fullPath.value.slice(-36) : fullPath.value)
const pageMods = computed(() => visibleEntries.value.filter(isModEntry).map(e => e.name))
const pageChecked = computed(() => pageSelection(pageMods.value, selection.value))
function togglePageSelection() { const next = new Set(selection.value); for (const name of pageMods.value) pageChecked.value.all ? next.delete(name) : next.add(name); selection.value = next }
const resourceCount = computed(() => props.rel === 'mods' ? entries.value.filter(isModEntry).length : entries.value.filter(e => e.isDir || /\.zip$/i.test(e.name)).length)
const readableName = (e: FsEntry) => props.rel === 'resourcepacks' ? resourceDisplayName(e.name) : e.name

async function copyPath() {
  const ok = await copyText(currentVersion.value?.gameDirectory ? currentVersion.value.gameDirectory + '/' + props.rel : effectiveRel.value)
  toast(ok ? '已复制完整路径' : '复制失败', ok ? 'success' : 'error')
}

// ---------------- 顶栏搜索联动（过滤文件名） ----------------
const batchResults=ref<ModOperationResult[]>([]),catalogError=ref('')
const localSearch=ref(''),modFilter=ref('all'),sortBy=ref('name'),catalog=ref<Record<string,ManagedMod>>({}),selection=ref(new Set<string>()),batchBusy=ref(false),switchFile=ref('')
const keyword = computed(() => (localSearch.value||store.searchKeyword).trim().toLowerCase())
const filtered = computed(() => {
 const rows=entries.value.filter(e=>(!keyword.value||(e.name+' '+(catalog.value[e.name]?.name||'')).toLowerCase().includes(keyword.value))&&(props.rel!=='mods'||modFilter.value==='all'||modFilter.value==='enabled'&&/\.jar$/i.test(e.name)||modFilter.value==='disabled'&&/\.jar\.disabled$/i.test(e.name)||modFilter.value==='locked'&&catalog.value[e.name]?.locked))
 return rows.sort((a,b)=>sortBy.value==='date'?b.mtime-a.mtime:sortBy.value==='size'?b.size-a.size:a.name.localeCompare(b.name,'zh-CN',{numeric:true}))
})
async function loadCatalog(generation:number){if(props.rel!=='mods')return;const v=currentVersion.value;if(!v)return;try{const list=await window.kamucl.invoke('mods:catalog',v.id,v.folder||activeFolder.value) as ManagedMod[];if(generation===loadGeneration){catalog.value=Object.fromEntries(list.map(m=>[m.fileName,m]));catalogError.value=''}}catch(e){if(generation===loadGeneration){catalog.value={};catalogError.value=errText(e)}}}
function selectMod(name:string,checked:boolean){const s=new Set(selection.value);checked?s.add(name):s.delete(name);selection.value=s}
function selectAll(all=false){const s=new Set(selection.value);for(const e of (all?filtered.value:visibleEntries.value).filter(isModEntry))s.add(e.name);selection.value=s}
async function batch(action:'enable'|'disable'|'lock'|'unlock',names=[...selection.value]){const v=currentVersion.value;if(!v||batchBusy.value||loading.value||loadError.value)return;const generation=loadGeneration;batchBusy.value=true;try{const results=await window.kamucl.invoke(action==='lock'||action==='unlock'?'mods:setLocked':'mods:setEnabled',v.id,v.folder||activeFolder.value,names,action==='lock'||action==='enable') as ModOperationResult[];const failed=results.filter(r=>!r.ok);toast('已处理 '+(results.length-failed.length)+' 项'+(failed.length?'；'+failed.length+' 项失败：'+failed[0].error:''),failed.length?'error':'success');if(generation===loadGeneration){batchResults.value=results;const remaining=new Set(selection.value);for(const r of results)r.ok?remaining.delete(r.fileName):remaining.add(r.fileName);selection.value=remaining;await load()}}catch(e){toast(errText(e),'error')}finally{batchBusy.value=false}}
watch([effectiveRel,activeFolder],()=>{selection.value=new Set();batchResults.value=[];catalog.value={};catalogError.value='';localSearch.value='';modFilter.value='all';switchFile.value=''})
watch([localSearch,modFilter,sortBy],()=>page.value=1)

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
const visibleEntries = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))
const modIcons = ref<Record<string, string>>({})
let iconGeneration = 0
let iconTimer: ReturnType<typeof setTimeout> | undefined
watch([visibleEntries, effectiveRel, activeFolder], () => {
  const generation = ++iconGeneration
  clearTimeout(iconTimer); modIcons.value = {}
  const version = currentVersion.value
  if (!version) return
  const names = visibleEntries.value.filter(e => !e.isDir && /\.(?:jar(?:\.disabled)?|zip)$/i.test(e.name)).map(e => e.name)
  if (!names.length) return
  const folder = version.folder || activeFolder.value
  iconTimer = setTimeout(() => {
    void getModIcons(version.id, names, folder, props.rel).then(icons => {
      if (generation === iconGeneration) modIcons.value = icons
    }).catch(() => {})
  }, 120)
})
onUnmounted(() => { iconGeneration++; clearTimeout(iconTimer) })
watch([keyword, pageCount], () => { page.value = Math.min(page.value, pageCount.value) })

async function onOpenDir() {
  if (!currentVersion.value) return
  opening.value = true
  try {
    await openDir(effectiveRel.value, currentVersion.value?.folder || activeFolder.value)
  } catch (e) {
    toast('打开文件夹失败：' + errText(e), 'error')
  } finally {
    opening.value = false
  }
}

const delModal = reactive({ open: false, target: null as FsEntry | null, busy: false })

function onRemove(entry: FsEntry) {
  delModal.open = true
  delModal.target = entry
}

// ---------------- 模组禁用/启用（仅模组页；.jar ↔ .jar.disabled，运行中由主进程阻止） ----------------
const isModEntry = (e: FsEntry) =>
  props.rel === 'mods' && !e.isDir && /\.jar(\.disabled)?$/i.test(e.name)
const isDisabledMod = (e: FsEntry) => /\.jar\.disabled$/i.test(e.name)
const toggling = ref('')

async function onToggleDisable(entry: FsEntry, event?: Event) {
  if(event?.target)(event.target as HTMLInputElement).checked = !isDisabledMod(entry)
  if (!currentVersion.value) return
  if (toggling.value) return
  toggling.value = entry.name
  const generation=loadGeneration
  try {
    const result = await toggleDisableFs(effectiveRel.value, entry.name, currentVersion.value?.folder || activeFolder.value)
    if(generation!==loadGeneration)return
    entries.value=result
    toast(isDisabledMod(entry) ? `已启用 ${entry.name.replace(/\.disabled$/i, '')}` : `已禁用 ${entry.name}`, 'success')
  } catch (e) {
    toast(errText(e), 'error')
  } finally {
    toggling.value = ''
  }
}

async function onConfirmRemove() {
  if (!currentVersion.value) return
  const entry = delModal.target
  if (!entry || delModal.busy) return
  delModal.busy = true
  const generation=loadGeneration
  try {
    const result = await removeFs(effectiveRel.value, entry.name, currentVersion.value?.folder || activeFolder.value)
    if(generation!==loadGeneration)return
    entries.value=result
    delModal.open = false
    toast(`已移入回收站：${entry.name}`, 'success')
  } catch (e) {
    toast('删除失败：' + errText(e), 'error')
  } finally {
    delModal.busy = false
  }
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const fmtDate = (ts: number) => {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN')
}

// ---------------- MOD 更新检测（仅模组页；按 sha1 反查 Modrinth，内联面板不跳页） ----------------
const updatePanel = reactive({
  open: false,
  checking: false,
  error: '',
  report: null as ModUpdateReport | null,
  selected: new Set<string>(),
  applying: false,
  itemState: {} as Record<string, 'start' | 'ok' | 'error' | undefined>,
  itemError: {} as Record<string, string>
})

watch(catalog,()=>{updatePanel.selected=new Set([...updatePanel.selected].filter(name=>!catalog.value[name]?.locked))})
const updatableEntries = computed(() => updatePanel.report?.entries.filter((e) => e.update) ?? [])
const unmatchedCount = computed(() => updatePanel.report?.entries.filter((e) => !e.source).length ?? 0)
const latestCount = computed(() => updatePanel.report?.entries.filter((e) => e.alreadyLatest || (e.source && !e.update)).length ?? 0)

async function onCheckUpdates() {
  const v = currentVersion.value
  if (!v || updatePanel.checking || updatePanel.applying) return
  updatePanel.checking = true
  updatePanel.error = ''
  updatePanel.report = null
  updatePanel.open = true
  updatePanel.itemState = {}
  updatePanel.itemError = {}
  const generation=loadGeneration
  try {
    const report = await checkModUpdates(v.id, v.folder)
    if(generation!==loadGeneration)return
    updatePanel.report = report
    updateIcons.value={}
    const names=report.entries.filter(e=>e.update).map(e=>e.fileName)
    for(let i=0;i<names.length;i+=100)void getModIcons(v.id,names.slice(i,i+100),v.folder||activeFolder.value).then(icons=>{if(generation===loadGeneration)updateIcons.value={...updateIcons.value,...icons}}).catch(()=>{})
    updatePanel.selected = new Set(report.entries.filter((e) => e.update && !catalog.value[e.fileName]?.locked).map((e) => e.fileName))
    if (!report.entries.length) toast('该实例 mods 目录为空', 'info')
  } catch (e) {
    if(generation===loadGeneration)updatePanel.error = errText(e)
  } finally {
    if(generation===loadGeneration)updatePanel.checking = false
  }
}

async function applyUpdates(fileNames: string[]) {
  const v = currentVersion.value
  const report = updatePanel.report
  if (!v || !report || updatePanel.applying) return
  const targets = report.entries
    .filter((e) => e.update && fileNames.includes(e.fileName) && !catalog.value[e.fileName]?.locked)
    .map((e) => ({ fileName: e.fileName, oldSha1:e.sha1, url: e.update!.url, targetName: e.update!.fileName, sha1: e.update!.sha1, size: e.update!.size }))
  if (!targets.length) return
  updatePanel.applying = true
  const operation=++updateOperation
  for(const target of targets){updatePanel.itemState[target.fileName]='start';delete updatePanel.itemError[target.fileName]}
  try {
    const results = await applyModUpdates(v.id, targets, v.folder)
    if(operation!==updateOperation){toast('原实例的模组更新已结束','info');return}
    let okCount = 0
    for (const r of results) {
      updatePanel.itemState[r.fileName] = r.ok ? 'ok' : 'error'
      if (r.ok) okCount++
      else updatePanel.itemError[r.fileName] = r.error ?? '未知错误'
    }
    if (okCount) {
      toast(`已更新 ${okCount} 个 MOD`, 'success')
      updatePanel.report = {
        ...report,
        entries: report.entries.filter((e) => updatePanel.itemState[e.fileName] !== 'ok')
      }
      updatePanel.selected = new Set([...updatePanel.selected].filter((f) => updatePanel.itemState[f] !== 'ok'))
      void load()
    }
    const failed = results.filter((r) => !r.ok)
    if (failed.length) toast(`${failed.length} 个更新失败：${failed[0].error ?? ''}`, 'error')
    if (updatePanel.report.entries.length === 0) updatePanel.open = false
  } catch (e) {
    if(operation===updateOperation)for(const target of targets){updatePanel.itemState[target.fileName]='error';updatePanel.itemError[target.fileName]=errText(e)}
    toast('更新失败：' + errText(e), 'error')
  } finally {
    if(operation===updateOperation)updatePanel.applying = false
  }
}

function toggleUpdateSelect(fileName: string, checked: boolean) {
  const next = new Set(updatePanel.selected)
  if (checked) next.add(fileName)
  else next.delete(fileName)
  updatePanel.selected = next
}
</script>

<template>
  <div class="page file-manager" :data-resource="props.rel" :class="{ 'resource-page': props.rel !== 'mods' }">
    <header class="fm-head">
      <div data-ui="FileManager:9ace27a3aaa9" class="page-head fm-head-left"><h1 data-ui="FileManager:72e6bc71f100" class="page-title">{{ props.title }} <small v-if="currentVersion && !loading">{{ resourceCount }}</small></h1></div>
      <div data-ui="FileManager:7a94152a1114" class="fm-actions">
        <button v-if="props.rel === 'mods'" class="btn btn-gold" :disabled="updatePanel.checking || !currentVersion" @click="onCheckUpdates">{{ updatePanel.checking ? '检测中…' : '检测更新' }}</button>
        <button class="btn" :class="props.rel === 'shaderpacks' ? 'btn-gold' : 'btn-ghost'" :disabled="opening || !currentVersion" @click="onOpenDir">{{ props.openLabel }}</button>
        <details data-ui="FileManager:4aeae736e670" v-if="props.rel === 'mods'" class="file-more" @keydown.esc="($event.currentTarget as HTMLDetailsElement).open=false"><summary class="btn btn-ghost" aria-label="模组管理更多操作">更多</summary><div data-ui="FileManager:bd84b9640929" class="file-more-actions" @click="($event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open')"><button class="btn btn-ghost" :disabled="!currentVersion" @click="migrationOpen=true">版本迁移</button><button class="btn btn-ghost" :disabled="!currentVersion" @click="dupOpen=true">清理重复</button></div></details>
      </div>
    </header>
    <div v-if="availableVersions.length" class="fm-context">
      <label>游戏实例<SelectMenu v-model="store.resourceVersionId" class="fm-ver-select" :options="availableVersions.map(v => ({value:v.id,label:versionLabel(v),description:[v.mcVersion,v.loader,v.loaderVersion,v.isolated?'已隔离':'共享'].filter(Boolean).join(' · ')}))" /></label>
      <button v-if="props.rel!=='mods'" class="btn btn-ghost" :disabled="loading || !currentVersion" aria-label="刷新文件列表" @click="load">{{ loading ? '读取中…' : '↻ 刷新' }}</button>
      <button class="fm-path" :title="fullPath + '（点击复制完整路径）'" @click="copyPath">{{ displayPath }}</button>
    </div>
    <!-- 未安装任何版本时提示 -->
    <div data-ui="FileManager:de9f15303347" v-if="!currentVersion" class="card empty">
      <span>当前游戏文件夹没有可选版本，请先到「游戏版本」页安装或选择版本</span>
    </div>

    <!-- MOD 更新检测面板（内联，不跳页） -->
    <div data-ui="FileManager:1c4db7ee7d0f" v-if="props.rel === 'mods' && updatePanel.open" class="card upd-panel">
      <div data-ui="FileManager:9d0c31f6fdf0" class="upd-head">
        <strong>MOD 更新检测</strong>
        <span data-ui="FileManager:2c10d1e0ff26" v-if="updatePanel.report" class="muted">
          共 {{ updatePanel.report.entries.length }} 个 · 可更新 {{ updatableEntries.length }} · 已最新 {{ latestCount }}<template v-if="unmatchedCount"> · {{ unmatchedCount }} 个未匹配来源</template>
        </span>
        <span data-ui="FileManager:2887ce491013" class="upd-head-spacer"></span>
        <button data-ui="FileManager:835ed3bb6d0b" class="btn btn-ghost btn-sm" :disabled="updatePanel.applying" @click="updatePanel.open = false">收起</button>
      </div>
      <div data-ui="FileManager:29ea6314dfcd" v-if="updatePanel.checking" class="empty upd-empty">
        <span data-ui="FileManager:f3a3151fbbf3" class="spin"></span>
        <span>正在计算文件哈希并查询 Modrinth…</span>
      </div>
      <div data-ui="FileManager:e3e16f3446cd" v-else-if="updatePanel.error" class="empty upd-empty">
        <span>检测失败：{{ updatePanel.error }}</span>
        <button data-ui="FileManager:c52333bc5a18" class="btn btn-ghost btn-sm" @click="onCheckUpdates">重试</button>
      </div>
      <template v-else-if="updatePanel.report">
        <div data-ui="FileManager:e4442186c4ad" v-if="updatableEntries.length" class="upd-list">
          <div data-ui="FileManager:d8ea43df71b3" v-for="e in updatableEntries" :key="e.fileName" class="upd-entry">
          <div data-ui="FileManager:ce4ce0b68078" class="upd-row" :class="{ 'is-ok': updatePanel.itemState[e.fileName] === 'ok' }">
            <input data-ui="FileManager:23d633bae07f"
              type="checkbox"
              class="upd-check"
              :checked="updatePanel.selected.has(e.fileName)&&!catalog[e.fileName]?.locked"
              :disabled="updatePanel.applying||catalog[e.fileName]?.locked"
              @change="toggleUpdateSelect(e.fileName, ($event.target as HTMLInputElement).checked)"
            />

          <span data-ui="FileManager:8139bad75d7a" class="fm-file-icon"><img data-ui="FileManager:9efaa68e80b3" v-if="updateIcons[e.fileName] || modIcons[e.fileName]" :src="updateIcons[e.fileName] || modIcons[e.fileName]" alt=""/><span data-ui="FileManager:3cab95fb3ec2" v-else>◇</span></span><span data-ui="FileManager:3f70b14a0ffa" class="upd-name" :title="e.fileName"><strong>{{ e.fileName }}</strong><small data-ui="FileManager:a248bf5f85c5" class="muted">{{ e.name }}</small></span>
            <span data-ui="FileManager:a8fbbedbb2c1" class="muted upd-ver">{{ e.currentVersion || '未知' }} → <b data-ui="FileManager:540c87044085">{{ e.update!.versionNumber }}</b></span>
            <span data-ui="FileManager:9cedea4e08aa" v-if="updatePanel.itemState[e.fileName] === 'start'" class="spin upd-spin"></span>
            <span data-ui="FileManager:fe5bd266a021" v-else-if="updatePanel.itemState[e.fileName] === 'error'" class="upd-err" :title="updatePanel.itemError[e.fileName]">失败</span>
            <button data-ui="FileManager:d3761b27321a" class="btn btn-ghost btn-sm" :disabled="updatePanel.applying" @click="catalog[e.fileName]?.locked ? switchFile=e.fileName : applyUpdates([e.fileName])">{{catalog[e.fileName]?.locked?'已锁定 · 选版本':updatePanel.itemState[e.fileName]==='error'?'重试':'更新'}}</button>
          </div>
          <p data-ui="FileManager:78f152086a1d" v-if="updatePanel.itemState[e.fileName]==='error'" class="upd-error-detail" role="alert">{{updatePanel.itemError[e.fileName] || '更新失败，请重试'}}</p>
          </div>
        </div>
        <div data-ui="FileManager:27ab16a8261b" v-else class="empty upd-empty"><span>所有已匹配来源的 MOD 均为最新</span></div>
        <div data-ui="FileManager:b6d97d6a46a3" v-if="updatableEntries.length" class="upd-foot">
          <button data-ui="FileManager:d1841e395c61" class="btn btn-gold btn-sm" :disabled="updatePanel.applying || !updatePanel.selected.size" @click="applyUpdates([...updatePanel.selected])">
            {{ updatePanel.applying ? '正在更新…' : `一键更新选中（${updatePanel.selected.size}）` }}
          </button>
          <span class="muted">更新会先校验新文件哈希，失败时保留旧文件</span>
        </div>
      </template>
    </div>

    <div data-ui="FileManager:4c9771e53b3b" v-if="currentVersion && props.rel==='mods'" class="fm-controls">
      <input data-ui="FileManager:ec68a12c2ae9" v-model="localSearch" class="input fm-search" aria-label="搜索本地模组" placeholder="搜索文件名或模组名称…"/>
      <SelectMenu v-model="modFilter" :options="[{value:'all',label:'全部状态'},{value:'enabled',label:'已启用'},{value:'disabled',label:'已禁用'},{value:'locked',label:'已锁定'}]"/>
      <SelectMenu v-model="sortBy" :options="[{value:'name',label:'名称排序'},{value:'date',label:'最近修改'},{value:'size',label:'文件大小'}]"/>

    <button class="btn btn-ghost fm-refresh" :disabled="loading" title="刷新文件列表" aria-label="刷新文件列表" @click="load"><span v-if="loading" class="spin"></span><span v-else aria-hidden="true">↻</span></button>
    </div>
    <div data-ui="FileManager:50137bbe5c59" v-if="selection.size && props.rel==='mods'" class="fm-batch card"><strong>已选 {{selection.size}} 项</strong><button data-ui="FileManager:8a3d5842bdcc" class="btn btn-ghost btn-sm" :disabled="batchBusy" @click="selectAll(true)">全选筛选结果（{{filtered.filter(isModEntry).length}}）</button><button data-ui="FileManager:3f98d111f11c" class="btn btn-ghost btn-sm" :disabled="batchBusy" @click="batch('enable')">批量启用</button><button data-ui="FileManager:f9e4a6481640" class="btn btn-ghost btn-sm" :disabled="batchBusy" @click="batch('disable')">批量禁用</button><button data-ui="FileManager:91b8dde939da" class="btn btn-ghost btn-sm" :disabled="batchBusy" @click="batch('lock')">锁定版本</button><button data-ui="FileManager:d3ca28eade0c" class="btn btn-ghost btn-sm" :disabled="batchBusy" @click="batch('unlock')">解除锁定</button><button data-ui="FileManager:c17b974e4578" class="btn btn-ghost btn-sm" :disabled="batchBusy" @click="selection=new Set()">清空选择</button></div>
    <p data-ui="FileManager:080a7432d0c7" v-if="catalogError" class="muted" role="alert">模组识别或锁定记录读取失败：{{catalogError}}。可刷新重试，写入操作仍会由后端校验。</p>
    <details data-ui="FileManager:3bdbccefe0d1" v-if="batchResults.length" class="fm-results card" :open="batchResults.some(r=>!r.ok)"><summary data-ui="FileManager:fb44f4241998">上次批量操作：{{batchResults.filter(r=>r.ok).length}} 项成功 · {{batchResults.filter(r=>!r.ok).length}} 项失败</summary><div data-ui="FileManager:9d10b3e8ea6e" class="fm-result-list"><p data-ui="FileManager:b6f08c17dc51" v-for="r in batchResults" :key="r.fileName" :class="{failed:!r.ok}"><strong>{{r.fileName}}</strong><span>{{r.ok?'已完成':r.error}}</span></p></div></details>
    <!-- 文件列表 -->
    <div data-ui="FileManager:cdc99c60dc51" v-if="currentVersion" class="card fm-card" :class="{'shader-empty': props.rel === 'shaderpacks' && !entries.length && !loading && !loadError}" :aria-busy="loading">
      <div data-ui="FileManager:aaf1f853f556" v-if="entries.length && (loading || loadError)" class="status-strip" role="status">{{ loading ? '正在刷新，暂时保留上次的文件列表…' : '刷新失败：' + loadError }}<button data-ui="FileManager:1168663564f5" v-if="loadError" class="btn btn-ghost btn-sm" @click="load">重试</button></div>
      <ContentSkeleton v-if="loading && !entries.length" label="正在读取文件列表…" retry @retry="load"/>
      <div data-ui="FileManager:12ff8f1f3706" v-else-if="loadError && !entries.length" class="empty">
        <span>读取失败：{{ loadError }}</span>
        <button data-ui="FileManager:9605a11dc3ac" class="btn btn-ghost btn-sm" @click="load">重试</button>
      </div>
      <div data-ui="FileManager:c33c3939fd8c" v-else-if="!entries.length" class="empty">
        <span data-ui="FileManager:a3b8daa1f95d" class="empty-icon" v-html="props.icon"></span>
        <span>{{ props.emptyText }}</span>
        <small v-if="props.rel === 'shaderpacks'" class="muted">将光影包 ZIP 放入上方文件夹，然后刷新列表。</small>
      </div>
      <div data-ui="FileManager:40d26ad64938" v-else-if="!filtered.length" class="empty">
        <span>当前搜索或筛选条件没有匹配的文件</span>
      </div>
      <div data-ui="FileManager:893880828b4a" v-else class="fm-list" :inert="loading || !!loadError">
        <div class="fm-table-head"><input v-if="props.rel==='mods'" type="checkbox" aria-label="选择当前页模组" :checked="pageChecked.all" :indeterminate="pageChecked.partial" :disabled="batchBusy || !pageMods.length" @change="togglePageSelection"/><span v-else></span><span>名称</span><span>大小</span><span class="fm-date">修改时间</span><span v-if="props.rel==='mods'">启用</span><span>操作</span></div>
        <div data-ui="FileManager:9628c4638932" v-for="e in visibleEntries" :key="e.name" class="fm-row" :class="{ 'fm-row-disabled': isDisabledMod(e) }">
          <input data-ui="FileManager:8d3101b3257d" v-if="isModEntry(e)" type="checkbox" :aria-label="'选择 '+e.name" :checked="selection.has(e.name)" :disabled="batchBusy" @change="selectMod(e.name,($event.target as HTMLInputElement).checked)"/>
          <span v-if="props.rel==='mods' && !isModEntry(e)" aria-hidden="true"></span>
          <span data-ui="FileManager:0cf0b1354f9a" class="fm-file-icon" :draggable="!store.editMode && !batchBusy && !loading" @dragstart="dragResource($event, e)">
            <img data-ui="FileManager:e82feec99cd2" v-if="modIcons[e.name]" :src="modIcons[e.name]" draggable="false" alt="" @error="delete modIcons[e.name]" />
            <svg v-else-if="e.isDir" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
              <path d="M14 2v6h6" />
            </svg>
          </span>
          <span data-ui="FileManager:8c8c91106eaa" class="fm-name" tabindex="0" :title="e.name + ' · 按住拖到桌面或文件夹'" :draggable="!store.editMode && !batchBusy && !loading" @dragstart="dragResource($event, e)">{{ readableName(e) }}<small data-ui="FileManager:a0d9b4c442aa" v-if="readableName(e)!==e.name" class="fm-internal">{{e.name}}</small><small v-else-if="catalog[e.name]?.name && catalog[e.name].name!==e.name" class="fm-internal">{{catalog[e.name].name}}</small><small v-if="isDisabledMod(e)||catalog[e.name]?.locked" class="fm-internal">{{ [isDisabledMod(e)?'已禁用':'',catalog[e.name]?.locked?'已锁定':''].filter(Boolean).join(' · ') }}</small></span>

          <span data-ui="FileManager:558cc8ea9415" class="muted fm-meta">{{ e.isDir ? '文件夹' : fmtSize(e.size) }}</span>
          <span data-ui="FileManager:bf6ae194335f" class="muted fm-meta fm-date">{{ fmtDate(e.mtime) }}</span>

          <label data-ui="FileManager:7fe2dcd1bb05" v-if="isModEntry(e)" class="switch fm-toggle" :title="isDisabledMod(e)?'启用模组':'禁用模组'"><input data-ui="FileManager:eeccaf57cd1c" type="checkbox" role="switch" :aria-label="(isDisabledMod(e)?'启用 ':'禁用 ')+e.name" :checked="!isDisabledMod(e)" :disabled="!!toggling||batchBusy" @change="onToggleDisable(e, $event)"/><span data-ui="FileManager:902dfce79a14" class="switch-ui"></span></label>
          <span v-if="props.rel==='mods' && !isModEntry(e)" aria-hidden="true"></span>
          <details class="file-more" @keydown.esc="($event.currentTarget as HTMLDetailsElement).open=false"><summary data-ui="FileManager:859ab7a92cdd" class="btn btn-ghost btn-sm" :aria-label="'更多操作 '+e.name">⋯</summary><div class="file-more-actions" @click="($event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open')">          <button data-ui="FileManager:40ebd7f85d68" v-if="isModEntry(e)" class="btn btn-ghost btn-sm" :disabled="batchBusy" :aria-label="(catalog[e.name]?.locked?'解除锁定 ':'锁定版本 ')+e.name" :title="catalog[e.name]?.locked?'已锁定：不参与自动更新':'锁定此模组版本'" @click="batch(catalog[e.name]?.locked?'unlock':'lock',[e.name])">{{catalog[e.name]?.locked?'已锁定':'锁定'}}</button><button data-ui="FileManager:fd277c185a8b" v-if="isModEntry(e)" class="btn btn-ghost btn-sm" :disabled="batchBusy" :aria-label="'切换版本 '+e.name" @click="switchFile=e.name">版本</button>          <button data-ui="FileManager:537aea904555" class="btn btn-danger btn-sm fm-remove" :disabled="batchBusy" @click="onRemove(e)">删除</button></div></details>
        </div>
      </div>
    </div>

    <nav data-ui="FileManager:c2e38e035918" v-if="currentVersion && pageCount > 1" class="fm-pagination" aria-label="资源列表分页">
      <span class="muted">共 {{ filtered.length }} 项 · 每页 {{ PAGE_SIZE }} 项</span>
      <button data-ui="FileManager:50c8efdbe2b5" class="btn btn-ghost btn-sm" :disabled="page <= 1" @click="page--">上一页</button>
      <span>{{ page }} / {{ pageCount }}</span>
      <button data-ui="FileManager:eba7aed9ee2d" class="btn btn-ghost btn-sm" :disabled="page >= pageCount" @click="page++">下一页</button>
    </nav>
    <ModVersionModal v-if="switchFile && currentVersion" :source="currentVersion" :file-name="switchFile" @close="switchFile=''" @done="load();toast('模组版本已切换','success')"/>
    <ModMigrationModal v-if="migrationOpen && currentVersion" :source="currentVersion" @close="migrationOpen=false"/>
    <!-- 删除文件二次确认 -->
    <ConfirmModal
      :open="delModal.open"
      title="删除文件"
      :message="`确定要删除「${delModal.target?.name}」吗？文件将移入系统回收站，可从回收站恢复。`"
      :busy="delModal.busy"
      @cancel="delModal.open = false"
      @confirm="onConfirmRemove"
    />

    <!-- 清理重复 MOD（仅模组页） -->
    <DupCleanModal
      v-if="props.rel === 'mods' && dupOpen && currentVersion"
      :open="dupOpen"
      :version-id="currentVersion?.id ?? ''"
      :rel="effectiveRel"
      :folder="currentVersion?.folder || activeFolder"
      @close="dupOpen = false"
      @deleted="load"
    />
  </div>
</template>

<style scoped>
.file-more { position:relative; }
.file-more summary { list-style:none; font-size:18px; min-width:36px; }
.file-more[open] { z-index:5; }
.file-more-actions { position:absolute; right:0; top:100%; display:grid; gap:8px; padding:10px; min-width:150px; border:1px solid var(--border); border-radius:var(--radius-md); background:var(--surface-solid); box-shadow:var(--shadow); }
.file-more-actions .fm-remove { border-top:1px solid var(--border); margin-top:4px; }
.fm-list { overflow:visible; }
.fm-batch { position:sticky; top:0; z-index:6; }
.fm-name { overflow-wrap:break-word; word-break:normal; }

.fm-results{padding:12px 16px!important;margin-bottom:16px}.fm-results summary{cursor:pointer;font-size:12px}.fm-result-list{max-height:180px;overflow:auto;overscroll-behavior:contain}.fm-result-list p{display:flex;gap:12px;justify-content:space-between;font-size:12px;min-height:28px;align-items:center}.fm-result-list p.failed{color:var(--danger)}.fm-result-list strong{overflow-wrap:anywhere}.fm-controls{display:grid;grid-template-columns:minmax(180px,1fr) 160px 140px auto;gap:10px;margin-bottom:16px}.fm-batch{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:12px 16px!important;margin-bottom:16px}.fm-internal{display:block;color:var(--text-dim);font-size:11px;margin-top:4px}.fm-row input[type=checkbox]{accent-color:var(--accent);flex-shrink:0}@media(max-width:1000px){.fm-controls{grid-template-columns:1fr 1fr}.fm-row{flex-wrap:wrap}.fm-name{min-width:180px!important}}

.upd-name {display:flex;flex-direction:column;min-width:0;gap:3px}.upd-name strong{font-weight:600;overflow:hidden;text-overflow:ellipsis}.upd-name small{font-size:12px}.fm-toggle{flex-shrink:0}

.fm-pagination { display:flex; align-items:center; justify-content:flex-end; gap:12px; flex-wrap:wrap; padding:8px 0; font-size:13px }
.fm-pagination .muted { margin-right:auto }
.page {
  display: flex;
  flex-direction: column;
  gap: var(--sec-gap);
  max-width: 940px;
  margin: 0 auto;
}

.resource-page .fm-head { flex-direction: column; align-items: stretch; }
.resource-page .fm-head-left { flex: none; width: 100%; }
.resource-page .fm-actions { width: 100%; }
.fm-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.fm-head-left {
  flex: 1;
  min-width: 140px;
}
.fm-path {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s ease;
}
.fm-path:hover {
  color: var(--accent-2);
}
.fm-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  max-width: 100%;
}
:deep(.fm-ver-select) {
  max-width: 240px;
  min-width: 180px;
}

.fm-card {
  padding: var(--space-2);
}
.fm-list {
  display: flex;
  flex-direction: column;
}
.fm-name[draggable="true"],.fm-file-icon[draggable="true"]{cursor:grab}
.fm-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--row-h);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  transition: background 0.15s ease;
}
.fm-row:hover {
  background: var(--card-2);
}
.fm-file-icon {
  display: flex;
  width: 32px;
  height: 32px;
  color: var(--accent);
  flex-shrink: 0;
}
.fm-file-icon svg {
  width: 100%;
  height: 100%;
}
.fm-file-icon img { width: 100%; height: 100%; object-fit: contain; border-radius: 6px; }
.fm-name {
  white-space:normal;
  flex: 1;
  min-width: 0;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
  user-select: text;
}
.fm-meta {
  font-size: var(--text-xs);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.fm-date {
  width: 86px;
  text-align: right;
}
.fm-remove {
  flex-shrink: 0;
  background: transparent;
  border-color: transparent;
}
.fm-remove:hover { border-color: var(--danger-border); }
.fm-toggle {
  flex-shrink: 0;
}
.fm-row-disabled {
  opacity: 0.55;
}
.fm-row-disabled .fm-name {
  text-decoration: line-through;
  text-decoration-color: var(--text-3);
}
.fm-disabled-tag {
  flex-shrink: 0;
  font-size: var(--text-xs);
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--card-2);
  color: var(--text-3);
  border: 1px solid var(--line);
}
.empty-icon {
  display: flex;
  width: 44px;
  height: 44px;
  color: var(--accent);
  opacity: 0.8;
}
.empty-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

/* MOD 更新检测面板 */
.upd-panel {
  padding: var(--card-pad);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.upd-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-sm);
}
.upd-head-spacer {
  flex: 1;
}
.upd-empty {
  padding: var(--space-4) 0;
}
.upd-list {
  display: flex;
  flex-direction: column;
  max-height: 300px;
  overflow-y: auto;
}
.upd-error-detail { margin: 0 12px 12px 40px; color: var(--danger); font-size: 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.upd-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--row-h);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
}
.upd-row:hover {
  background: var(--card-2);
}
.upd-row.is-ok {
  opacity: 0.55;
}
.upd-check {
  accent-color: var(--accent);
  flex-shrink: 0;
}
.upd-name {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upd-ver {
  font-size: var(--text-xs);
  flex-shrink: 0;
  white-space: nowrap;
}
.upd-ver b {
  color: var(--accent-2);
}
.upd-spin {
  width: 14px;
  height: 14px;
}
.upd-err {
  color: var(--danger);
  font-size: var(--text-xs);
  flex-shrink: 0;
}
.upd-foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.upd-foot .muted {
  font-size: var(--text-xs);
}

@media (max-width: 1180px) {
  .fm-head { flex-wrap: wrap; align-items: flex-start; }
  .fm-head-left { flex-basis: 100%; }
  .fm-actions { width: 100%; flex-wrap: wrap; flex-shrink: 1; gap: 8px; }
  .fm-ver-select { flex: 1; max-width: none; min-width: 180px; }
}

.file-manager .fm-head{margin-bottom:0;gap:16px}.fm-head .page-title small{font-size:13px;font-weight:400;color:var(--text-dim);margin-left:8px}.fm-context{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px}.fm-context>label{display:grid;gap:6px;flex:0 1 440px;min-width:0;font-size:12px;color:var(--text-dim)}.fm-context .fm-ver-select{width:100%;max-width:none}.fm-context .fm-path{flex-basis:100%;text-align:left;border:0;padding:0;background:none;color:var(--text-dim);font:inherit;font-size:12px;overflow-wrap:anywhere;cursor:copy}.fm-controls{grid-template-columns:minmax(180px,1fr) 160px 140px 38px}.fm-card{padding:0 16px!important;overflow:visible}.fm-table-head,.fm-row{display:grid;grid-template-columns:36px minmax(0,1fr) 88px 132px 40px;gap:12px;align-items:center}.fm-table-head{min-height:36px;font-size:12px;color:var(--text-dim);border-bottom:1px solid var(--border)}.fm-row{min-height:68px;padding:12px 0;flex-wrap:nowrap}.fm-row .fm-name{min-width:0!important;white-space:normal;overflow-wrap:break-word}.fm-internal{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.fm-file-icon{width:36px;height:36px}.fm-file-icon img{object-fit:contain}.fm-meta{width:auto;min-width:0;text-align:right;font-size:12px;white-space:nowrap}.fm-table-head>span:nth-child(3){text-align:right}.fm-date{text-align:left}.file-manager[data-resource=mods] .fm-table-head{grid-template-columns:18px minmax(0,1fr) 88px 132px 42px 40px}.file-manager[data-resource=mods] .fm-row{grid-template-columns:18px 32px minmax(0,1fr) 88px 132px 42px 40px}.file-manager[data-resource=mods] .fm-table-head>span:nth-child(2){grid-column:2/4}.file-manager[data-resource=mods] .fm-table-head{grid-template-columns:18px 32px minmax(0,1fr) 88px 132px 42px 40px}.file-manager[data-resource=mods] .fm-file-icon{width:32px;height:32px}.fm-row:has(>input:checked){background:color-mix(in srgb,var(--accent) 5%,transparent)}.shader-empty{background:transparent!important;border:0;box-shadow:none;backdrop-filter:none!important}.shader-empty .empty{min-height:min(380px,45vh);justify-content:center}.fm-context .fm-path:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
@media(max-width:1150px){.fm-table-head,.fm-row{grid-template-columns:32px minmax(0,1fr) 70px 36px}.fm-date{display:none!important}.file-manager[data-resource=mods] .fm-row,.file-manager[data-resource=mods] .fm-table-head{grid-template-columns:18px 28px minmax(0,1fr) 70px 38px 36px}.fm-context>label{flex:1 1 260px}}@media(max-width:700px){.fm-controls{grid-template-columns:1fr 1fr}.fm-search{grid-column:1/-1}.fm-head{align-items:flex-start;flex-wrap:wrap}.fm-actions{gap:8px}.fm-table-head,.fm-row{gap:8px}.fm-file-icon{width:28px;height:28px}.file-manager[data-resource=mods] .fm-row,.file-manager[data-resource=mods] .fm-table-head{grid-template-columns:18px 24px minmax(0,1fr) 38px 36px}.file-manager[data-resource=mods] .fm-meta,.file-manager[data-resource=mods] .fm-table-head>span:nth-child(3){display:none}}

.file-manager{display:flex;flex-direction:column;gap:12px!important}.file-manager .fm-head,.file-manager .fm-context,.file-manager .fm-controls{margin:0}.fm-context :deep(.fm-ver-select){max-width:none;width:100%}.fm-row{border-radius:0;box-shadow:none;background:transparent}.fm-row:hover{background:var(--hover)}.fm-actions .file-more>summary{font-size:14px}.resource-page .fm-actions{width:auto}.fm-head{flex-wrap:wrap}.fm-row-disabled{opacity:1}

@media(max-width:1000px){.file-manager .fm-controls{grid-template-columns:minmax(0,1fr) minmax(0,1fr) 38px}.fm-controls .fm-search{grid-column:1/-1}}
</style>
