<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  errText,
  getSettings,
  importWorld,
  listFolders,
  listLoaders,
  scanFolder
} from '../api'
import { refreshInstalled, store, toast } from '../store'
import type {
  GameFolder,
  InstalledVersion,
  LoaderName,
  WorldCandidateInfo,
  WorldImportInfo,
  WorldImportOptions
} from '@shared/types'

const props = defineProps<{
  open: boolean
  filePath: string
  info: WorldImportInfo | null
}>()
const emit = defineEmits<{ (event: 'close'): void }>()

const selectedCandidateId = ref('')
const worldName = ref('')
const folders = ref<GameFolder[]>([])
const targetFolder = ref('')
const versions = ref<InstalledVersion[]>([])
const loadingTargets = ref(false)
const mode = ref<'existing' | 'new'>('existing')
const targetVersionId = ref('')
const newMinecraftVersion = ref('')
const newLoader = ref<LoaderName | ''>('')
const newLoaderVersion = ref('')
const newInstanceName = ref('')
const loaderVersions = ref<string[]>([])
const loaderError = ref('')
const allowMismatch = ref(false)
const acknowledgeUnknownMods = ref(false)
const busy = ref(false)
const error = ref('')
let folderLoadSequence = 0
let loaderLoadSequence = 0

const candidate = computed<WorldCandidateInfo | null>(() =>
  props.info?.candidates.find((item) => item.id === selectedCandidateId.value) ?? null
)

const orderedVersions = computed(() => {
  const current = candidate.value
  return [...versions.value].sort((a, b) => {
    const aMatch = current?.versionConfidence === 'exact' && a.mcVersion === current.minecraftVersion
    const bMatch = current?.versionConfidence === 'exact' && b.mcVersion === current.minecraftVersion
    return Number(bMatch) - Number(aMatch) || a.id.localeCompare(b.id)
  })
})

const targetVersion = computed(() =>
  versions.value.find((version) => version.id === targetVersionId.value)
)

const exactMismatch = computed(
  () =>
    mode.value === 'existing' &&
    candidate.value?.versionConfidence === 'exact' &&
    !!candidate.value.minecraftVersion &&
    !!targetVersion.value &&
    targetVersion.value.mcVersion !== candidate.value.minecraftVersion
)

const needsModAcknowledgement = computed(() => (candidate.value?.modEvidence.length ?? 0) > 0)

const canSubmit = computed(() => {
  if (!candidate.value || !worldName.value.trim() || !targetFolder.value || busy.value) return false
  if (exactMismatch.value && !allowMismatch.value) return false
  if (needsModAcknowledgement.value && !acknowledgeUnknownMods.value) return false
  if (mode.value === 'existing') return !!targetVersion.value
  return !!newMinecraftVersion.value.trim() && !!newInstanceName.value.trim() && (!newLoader.value || !!newLoaderVersion.value)
})

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function suggestedInstanceName(item: WorldCandidateInfo): string {
  const suffix = item.versionConfidence === 'exact' && item.minecraftVersion ? `-${item.minecraftVersion}` : ''
  return `${item.worldName}${suffix}`.replace(/[\\/:*?"<>|]/g, '').slice(0, 100)
}

function resetForCandidate(item: WorldCandidateInfo) {
  selectedCandidateId.value = item.id
  worldName.value = item.worldName
  newMinecraftVersion.value = item.versionConfidence === 'exact' ? item.minecraftVersion ?? '' : ''
  newLoader.value = item.loader ?? ''
  newLoaderVersion.value = ''
  newInstanceName.value = suggestedInstanceName(item)
  allowMismatch.value = false
  acknowledgeUnknownMods.value = false
  chooseDefaultTarget()
}

function chooseDefaultTarget() {
  const current = candidate.value
  const match = versions.value.find(
    (version) =>
      !version.incomplete &&
      !version.failed &&
      current?.versionConfidence === 'exact' &&
      version.mcVersion === current.minecraftVersion &&
      (!current.loader || version.loader === current.loader)
  ) ?? versions.value.find((version) => !version.incomplete && !version.failed)
  targetVersionId.value = match?.id ?? ''
  mode.value = match ? 'existing' : 'new'
}

async function loadTargetFolder() {
  if (!targetFolder.value) return
  const sequence = ++folderLoadSequence
  loadingTargets.value = true
  error.value = ''
  try {
    const result = await scanFolder(targetFolder.value)
    if (sequence !== folderLoadSequence) return
    versions.value = result.versions
    chooseDefaultTarget()
  } catch (reason) {
    if (sequence === folderLoadSequence) error.value = `读取目标文件夹失败：${errText(reason)}`
  } finally {
    if (sequence === folderLoadSequence) loadingTargets.value = false
  }
}

async function initialize() {
  if (!props.open || !props.info?.candidates.length) return
  error.value = ''
  busy.value = false
  try {
    const state = await listFolders()
    folders.value = state.folders
    targetFolder.value = state.active || state.folders[0]?.path || ''
    const first = props.info.candidates[0]
    selectedCandidateId.value = first.id
    await loadTargetFolder()
    resetForCandidate(first)
  } catch (reason) {
    error.value = errText(reason)
  }
}

watch(() => [props.open, props.info] as const, initialize, { immediate: true })

watch(selectedCandidateId, (id, oldId) => {
  if (!id || id === oldId) return
  const item = props.info?.candidates.find((value) => value.id === id)
  if (item) resetForCandidate(item)
})

watch([newLoader, newMinecraftVersion], async ([loader, minecraftVersion]) => {
  const sequence = ++loaderLoadSequence
  loaderVersions.value = []
  loaderError.value = ''
  newLoaderVersion.value = ''
  if (!loader || !minecraftVersion.trim()) return
  try {
    const list = await listLoaders(loader, minecraftVersion.trim())
    if (sequence !== loaderLoadSequence) return
    loaderVersions.value = list
    newLoaderVersion.value = list[0] ?? ''
    if (!list.length) loaderError.value = `${loader} 暂无适配 ${minecraftVersion} 的可用版本`
  } catch (reason) {
    if (sequence === loaderLoadSequence) loaderError.value = errText(reason)
  }
})

async function submit() {
  const item = candidate.value
  if (!item || !canSubmit.value) return
  busy.value = true
  error.value = ''
  const options: WorldImportOptions = {
    candidateId: item.id,
    worldName: worldName.value.trim(),
    targetFolder: targetFolder.value,
    allowVersionMismatch: allowMismatch.value
  }
  if (mode.value === 'existing') {
    options.targetVersionId = targetVersionId.value
  } else {
    options.newInstance = {
      minecraftVersion: newMinecraftVersion.value.trim(),
      instanceName: newInstanceName.value.trim(),
      loader: newLoader.value || undefined,
      loaderVersion: newLoaderVersion.value || undefined
    }
  }
  try {
    const result = await importWorld(props.filePath, options)
    store.settings = await getSettings()
    await refreshInstalled()
    const packs = result.installedResourcePacks.length
      ? `，并安装 ${result.installedResourcePacks.length} 个资源包`
      : ''
    toast(`存档「${result.worldName}」已导入到 ${result.versionId}${packs}`, 'success')
    emit('close')
  } catch (reason) {
    error.value = errText(reason)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-mask" @pointerdown.self="!busy && emit('close')">
      <div class="modal world-modal">
        <h3 class="world-title">导入 Minecraft 存档</h3>

        <template v-if="info && candidate">
          <label v-if="info.candidates.length > 1" class="field">
            <span>检测到多个世界</span>
            <select v-model="selectedCandidateId" class="select">
              <option v-for="item in info.candidates" :key="item.id" :value="item.id">
                {{ item.worldName }} · {{ item.id }}
              </option>
            </select>
          </label>

          <div class="world-summary">
            <div><strong>{{ candidate.worldName }}</strong><span>{{ candidate.fileCount }} 个文件 · {{ fmtSize(candidate.totalBytes) }}</span></div>
            <div class="world-tags">
              <span class="tag">{{ candidate.minecraftVersion || '版本未知' }}</span>
              <span class="tag" :class="candidate.versionConfidence === 'exact' ? 'tag-success' : 'tag-gold'">
                {{ candidate.versionConfidence === 'exact' ? '元数据确认' : candidate.versionConfidence === 'approximate' ? 'DataVersion 推测' : '无法确定版本' }}
              </span>
              <span v-if="candidate.gameMode" class="tag">{{ candidate.gameMode }}</span>
              <span v-if="candidate.hardcore" class="tag tag-danger">极限</span>
              <span v-if="candidate.loader" class="tag tag-gold">推测 {{ candidate.loader }}</span>
            </div>
            <p v-if="candidate.datapackCount">检测到 {{ candidate.datapackCount }} 个数据包记录。</p>
            <p v-if="candidate.hasWorldResourcePack">检测到世界内置 resources.zip，将随存档保留。</p>
            <p v-if="candidate.resourcePacks.length">检测到 {{ candidate.resourcePacks.length }} 个结构有效的资源包，将以不覆盖方式安装。</p>
          </div>

          <div v-if="candidate.modEvidence.length" class="world-warning">
            <strong>检测到模组痕迹</strong>
            <span>{{ candidate.modEvidence.join('；') }}。普通存档不包含可靠的完整 MOD 清单，KAMUCL 不会猜测或自动下载未知依赖。</span>
          </div>

          <label class="field">
            <span>目标游戏文件夹</span>
            <select v-model="targetFolder" class="select" :disabled="busy" @change="loadTargetFolder">
              <option v-for="folder in folders" :key="folder.path" :value="folder.path">
                {{ folder.name }}{{ folder.isDefault ? '（默认）' : '' }} · {{ folder.path }}
              </option>
            </select>
          </label>

          <div class="mode-tabs">
            <button :class="{ active: mode === 'existing' }" :disabled="!versions.length" @click="mode = 'existing'">使用已有实例</button>
            <button :class="{ active: mode === 'new' }" @click="mode = 'new'">新建自定义实例</button>
          </div>

          <template v-if="mode === 'existing'">
            <label class="field">
              <span>目标实例</span>
              <select v-model="targetVersionId" class="select" :disabled="loadingTargets || busy">
                <option v-for="version in orderedVersions" :key="version.id" :value="version.id" :disabled="version.incomplete || version.failed">
                  {{ version.id }} · MC {{ version.mcVersion }}{{ version.loader ? ` · ${version.loader}` : '' }}{{ candidate.versionConfidence === 'exact' && version.mcVersion === candidate.minecraftVersion ? '（推荐：版本一致）' : '' }}
                </option>
              </select>
            </label>
            <label v-if="exactMismatch" class="ack-row danger">
              <input v-model="allowMismatch" type="checkbox" />
              <span>目标实例为 {{ targetVersion?.mcVersion }}，与存档 {{ candidate.minecraftVersion }} 不同；我确认承担跨版本转换风险。</span>
            </label>
          </template>

          <template v-else>
            <div class="new-grid">
              <label class="field"><span>Minecraft 版本</span><input v-model="newMinecraftVersion" class="input" placeholder="例如 1.20.1" /></label>
              <label class="field"><span>Loader</span><select v-model="newLoader" class="select"><option value="">纯净版</option><option value="fabric">Fabric</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option><option value="quilt">Quilt</option></select></label>
            </div>
            <label v-if="newLoader" class="field"><span>Loader 版本</span><select v-model="newLoaderVersion" class="select" :disabled="!loaderVersions.length"><option v-for="value in loaderVersions" :key="value" :value="value">{{ value }}</option></select><small v-if="loaderError" class="error-text">{{ loaderError }}</small></label>
            <label class="field"><span>新实例名称</span><input v-model="newInstanceName" class="input" /></label>
          </template>

          <label class="field"><span>最终存档名称</span><input v-model="worldName" class="input" maxlength="120" /></label>

          <label v-if="needsModAcknowledgement" class="ack-row">
            <input v-model="acknowledgeUnknownMods" type="checkbox" />
            <span>我已了解：只能确认上述证据，无法从普通存档确定全部所需 MOD。</span>
          </label>

          <div v-if="info.warnings.length" class="world-notes">
            <span v-for="warning in info.warnings" :key="warning">{{ warning }}</span>
          </div>
          <p v-if="error" class="error-text">{{ error }}</p>
          <div class="modal-actions">
            <button class="btn btn-ghost" :disabled="busy" @click="emit('close')">取消</button>
            <button class="btn btn-gold" :disabled="!canSubmit" @click="submit">
              {{ busy ? '正在导入…' : '确认导入' }}
            </button>
          </div>
        </template>
        <p v-else class="error-text">没有可导入的世界信息。</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.world-modal { width: min(680px, calc(100vw - 36px)); max-height: 88vh; overflow-y: auto; }
.world-title { margin: 0 0 var(--space-4); font-size: var(--text-lg); font-weight: 700; }
.world-summary { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card-2); }
.world-summary > div:first-child { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); flex-wrap: wrap; }
.world-summary > div:first-child span, .world-summary p { color: var(--text-dim); font-size: var(--text-xs); margin: 0; }
.world-summary strong { font-size: var(--text-md); }
.world-tags { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.world-warning { display: grid; gap: var(--space-1); margin-top: var(--space-3); padding: var(--space-3); border: 1px solid color-mix(in srgb, #e5a323 45%, var(--border)); border-radius: var(--radius-sm); background: color-mix(in srgb, #e5a323 9%, var(--card)); font-size: var(--text-xs); line-height: 1.5; }
.field { display: grid; gap: var(--space-2); margin-top: var(--space-3); color: var(--text-dim); font-size: var(--text-xs); }
.mode-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); margin-top: var(--space-3); }
.mode-tabs button { display: inline-flex; align-items: center; justify-content: center; min-height: var(--ctl-h); padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--card-2); color: var(--text-dim); font-size: var(--text-sm); font-family: inherit; cursor: pointer; }
.mode-tabs button.active { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.mode-tabs button:disabled { opacity: .45; cursor: not-allowed; }
.new-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
.ack-row { display: flex; align-items: flex-start; gap: var(--space-2); margin-top: var(--space-3); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: var(--card-2); color: var(--text-dim); font-size: var(--text-xs); line-height: 1.45; }
.ack-row.danger { color: var(--danger); }
.ack-row input { margin-top: 2px; accent-color: var(--accent); }
.world-notes { display: grid; gap: var(--space-1); margin-top: var(--space-3); color: var(--text-dim); font-size: var(--text-xs); line-height: 1.5; }
.error-text { color: var(--danger); font-size: var(--text-xs); line-height: 1.45; }
.modal-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-5); }
@media (max-width: 620px) { .new-grid { grid-template-columns: 1fr; } }
</style>
