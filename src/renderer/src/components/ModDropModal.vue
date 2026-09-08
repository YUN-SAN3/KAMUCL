<script setup lang="ts">
/**
 * MOD 拖入即装：解析结果确认 + 版本匹配 + 四分支处理
 * 流程：静默解析 → 匹配本地版本 → 有匹配（选版本装入）/ 无匹配（自动或自定义下载后装入）
 */
import { computed, reactive, ref, watch } from 'vue'
import ModInstallDialog from './ModInstallDialog.vue'
import MarqueeText from './MarqueeText.vue'
import { errText, installVersion, onInstallDone, parseMods, getModTargets } from '../api'
import { displayVersionName, refreshInstalled, store, toast } from '../store'
import { matchesVersionRange as matchRange, modMatchesInstance as modMatchesVersion, instanceKey, modMismatchReasons } from '@shared/modCompatibility'
import type { InstalledVersion, LoaderName, ModInfo } from '@shared/types'

const props = defineProps<{
  open: boolean
  files: string[]
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

// ---------------- 状态 ----------------
const parsing = ref(false)
const allTargets = ref<InstalledVersion[]>([])
const scanErrors = ref<string[]>([])
let scanGeneration = 0
const mods = ref<ModInfo[]>([])
const selectedVersion = ref('')
const installing = ref(false)
const modRequest = ref<{ target: InstalledVersion; input: { paths: string[] } } | null>(null)

/** 解析成功的有效 MOD */
const validMods = computed(() => mods.value.filter((m) => !m.error))
/** 解析失败（非 MOD/损坏） */
const failedMods = computed(() => mods.value.filter((m) => !!m.error))
const mismatchDetails = computed(() => allTargets.value.map(v => ({ v, reasons: validMods.value.flatMap(m => modMismatchReasons(m, v).map(reason => `${m.name || m.id}：${reason}`)) })))

/** 每个 MOD 匹配到的版本 id 集合 */
const matchMap = computed(() => {
  const map: Record<string, string[]> = {}
  for (const m of validMods.value) {
    map[m.filePath] = allTargets.value.filter((v) => modMatchesVersion(m, v)).map(instanceKey)
  }
  return map
})

/** 所有有效 MOD 的版本交集（可同时装入全部 MOD 的版本） */
const commonVersions = computed(() => {
  if (!validMods.value.length) return []
  return allTargets.value.filter((v) => validMods.value.every((m) => modMatchesVersion(m, v)))
})

/** 无交集时退而求其次：能装最多 MOD 的版本（含兼容状态标记） */
const bestEffortVersions = computed(() => {
  if (commonVersions.value.length) return []
  const scored = allTargets.value
    .map((v) => ({
      v,
      ok: validMods.value.filter((m) => modMatchesVersion(m, v)),
      bad: validMods.value.filter((m) => !modMatchesVersion(m, v))
    }))
    .filter((x) => x.ok.length > 0)
    .sort((a, b) => b.ok.length - a.ok.length)
  return scored
})

type Branch = 'parse' | 'matched' | 'partial' | 'none'
const branch = computed<Branch>(() => {
  if (parsing.value) return 'parse'
  if (!validMods.value.length) return 'none'
  if (commonVersions.value.length) return 'matched'
  if (bestEffortVersions.value.length) return 'partial'
  return 'none'
})

const LOADER_TAG: Record<LoaderName, string> = {
  forge: 'Forge',
  neoforge: 'NeoForge',
  fabric: 'Fabric',
  quilt: 'Quilt'
}

// ---------------- 打开时解析 ----------------
watch(
  () => props.open,
  async (open) => {
    const generation = ++scanGeneration
    if (!open) return
    mods.value = []
    parsing.value = true
    try {
      const [parsed, scanned] = await Promise.all([parseMods(props.files), getModTargets()])
      if (generation !== scanGeneration) return
      mods.value = parsed
      allTargets.value = scanned.versions
      scanErrors.value = scanned.errors
      // 默认选中交集第一个
      const first = commonVersions.value[0] ?? bestEffortVersions.value[0]?.v
      selectedVersion.value = first ? instanceKey(first) : ''
    } catch (e) {
      toast('MOD 识别失败：' + errText(e), 'error')
      emit('close')
    } finally {
      if (generation === scanGeneration) parsing.value = false
    }
  }
)

// ---------------- 分支动作 ----------------
async function onInstallSelected() {
  const selected = allTargets.value.find(v => instanceKey(v) === selectedVersion.value)
  if (!selected || installing.value) return
  const vid = selected.id
  // 部分匹配分支下只装入兼容的 MOD
  const targets = validMods.value.filter((m) =>
    branch.value === 'matched'
      ? true
      : bestEffortVersions.value.find((x) => instanceKey(x.v) === selectedVersion.value)?.ok.includes(m)
  )
  if (!targets.length) {
    toast('所选版本与全部 MOD 均不兼容', 'error')
    return
  }
  modRequest.value = { target: selected, input: { paths: targets.map(m => m.filePath) } }
}

/** 「下载新版本」：跳游戏版本页，提示装完后再装入 */
function onDownloadNew() {
  emit('close')
  store.currentView = 'game'
  toast('请在游戏版本页选择兼容的版本安装，完成后重新拖入 MOD 即可装入', 'info')
}

/** 「自动下载最新兼容版本」：取 MOD 支持的最高 release + 多数派加载器，走现有下载链路；
 *  下载完成后自动把本次 MOD 装入新版本，用户只剩按下启动 */
const autoState = reactive({ busy: false })
async function onAutoDownload() {
  if (autoState.busy) return
  autoState.busy = true
  try {
    // 多数派加载器
    const loaderCount = new Map<LoaderName, number>()
    for (const m of validMods.value) {
      if (m.loader) loaderCount.set(m.loader, (loaderCount.get(m.loader) ?? 0) + 1)
    }
    const loader = [...loaderCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (validMods.value.some(m => m.loader !== loader)) throw new Error('不同加载器的 MOD 不能装入同一实例，请分批导入')
    if (!loader) throw new Error('没有可识别的加载器类型')
    // 取发布清单中满足所有该 loader MOD 范围的最高 release
    const { getManifest } = await import('../api')
    const manifest = await getManifest()
    const releases = manifest.filter((v) => v.type === 'release')
    const target = releases.find((v) =>
      validMods.value.every((m) => !m.loader || matchRange(m.mcRange, v.id))
    )
    if (!target) throw new Error('没有找到兼容的正式版 MC')
    // 加载器版本维度：取该加载器适配该 MC 的最新版本，且满足 MOD 声明的 loader 版本范围
    const { listLoaders } = await import('../api')
    const loaderVersions = await listLoaders(loader, target.id)
    if (!loaderVersions.length) throw new Error(`${LOADER_TAG[loader]} 没有适配 ${target.id} 的版本`)
    const loaderVersion =
      loaderVersions.find((lv) =>
        validMods.value.every((m) => !m.loaderRange || matchRange(m.loaderRange, lv))
      )
    if (!loaderVersion) throw new Error('没有同时满足全部 MOD 区间要求的加载器版本')
    // Fabric 模组自动携带最新 Fabric API（绝大多数 Fabric MOD 需要）
    let fabricApi: string | undefined
    if (loader === 'fabric') {
      try {
        const { listFabricApi } = await import('../api')
        const apiList = await listFabricApi(target.id)
        fabricApi = apiList[0]?.version
      } catch {
        /* API 获取失败不阻断，安装时仍可手动补装 */
      }
    }
    const filePaths = validMods.value.map((m) => m.filePath)
    const destinationFolder = store.settings?.activeFolder || store.settings?.gameDir || ''
    emit('close')
    toast(
      `开始自动下载 ${target.id} + ${LOADER_TAG[loader]} ${loaderVersion}${fabricApi ? ' + Fabric API' : ''}，完成后将自动装入 ${filePaths.length} 个 MOD`,
      'info'
    )
    store.installing.add(target.id)
    // 一次性监听：该版本装好后自动装入 MOD（按请求的 versionId 匹配，避免响应其他安装任务）
    const off = onInstallDone((r) => {
      if (r.versionId !== target.id) return
      off()
      if (!r.ok) {
        toast('版本安装失败，MOD 未能自动装入，可重新拖入', 'error')
        return
      }
      void autoInstallMods(filePaths, r.installedId, destinationFolder)
    })
    try {
      await installVersion(target.id, { loader, loaderVersion, fabricApi })
    } catch (e) {
      off()
      throw e
    }
  } catch (e) {
    toast('自动下载失败：' + errText(e), 'error')
  } finally {
    autoState.busy = false
  }
}

/** 版本下载完成后自动装入 MOD：installedId 优先，缺失时按 MC 版本 + 加载器兜底定位实例 */
async function autoInstallMods(
  filePaths: string[],
  installedId: string | undefined,
  folder: string
) {
  try {
    await refreshInstalled()
    const scanned = await getModTargets()
    const v = scanned.versions.find(v => v.id === installedId && v.folder === folder)
    if (!v) throw new Error('未找到本次安装的确切实例，请重新拖入 MOD')
    modRequest.value = { target: v, input: { paths: filePaths } }
  } catch (e) {
    toast('MOD 自动装入失败，请重新拖入：' + errText(e), 'error')
  }
}

function onCustomDownload() {
  onDownloadNew()
}

const modCompatOf = (m: ModInfo): string[] => matchMap.value[m.filePath] ?? []
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-mask" @pointerdown.self="emit('close')">
      <div class="modal moddrop-modal">
        <h3 class="modal-title">MOD 识别与安装</h3>

        <!-- 解析中 -->
        <div v-if="parsing" class="parse-loading">
          <span class="spin"></span>
          <span class="muted">正在识别 MOD 信息…</span>
        </div>

        <template v-else>
          <div v-if="scanErrors.length" class="none-hint">部分目录或实例未能完整扫描；修复后请重新拖入。<div v-for="error in scanErrors" :key="error">{{ error }}</div></div>
          <!-- 识别结果列表 -->
          <div class="mod-list">
            <div v-for="m in mods" :key="m.filePath + m.fileName" class="mod-row" :class="{ failed: !!m.error }">
              <img v-if="m.iconDataUrl" class="mod-icon" :src="m.iconDataUrl" alt="" />
              <span v-else class="mod-icon mod-icon-empty">{{ (m.name || m.fileName).charAt(0) }}</span>
              <div class="mod-meta">
                <div class="mod-title-row">
                  <MarqueeText class="mod-name" :text="m.name || m.fileName"/>
                  <MarqueeText v-if="m.version" class="muted" :text="'v' + m.version"/>
                  <span v-if="m.loader" class="tag">{{ LOADER_TAG[m.loader] }}</span>
                </div>
                <div class="mod-sub muted">
                  <template v-if="m.error">⚠ {{ m.error }}</template>
                  <template v-else>
                    <span v-if="m.mcRange">MC {{ m.mcRange }}</span>
                    <span v-if="m.loaderRange"> · Loader {{ m.loaderRange }}</span>
                    <span v-if="m.dependencies.length"> · 前置：{{ m.dependencies.join(', ') }}</span>
                    <span v-if="!m.error && branch !== 'none'" :class="modCompatOf(m).length ? 'compat-ok' : 'compat-bad'">
                      {{ modCompatOf(m).length ? ` · 匹配 ${modCompatOf(m).length} 个本地版本` : ' · 无匹配版本' }}
                    </span>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <!-- 分支：全部匹配 -->
          <template v-if="branch === 'matched'">
            <p class="modal-label">选择装入版本（{{ commonVersions.length }} 个版本可装入全部 {{ validMods.length }} 个 MOD）</p>
            <div class="ver-list">
              <label v-for="v in commonVersions" :key="instanceKey(v)" class="ver-option" :class="{ active: selectedVersion === instanceKey(v) }">
                <input v-model="selectedVersion" type="radio" :value="instanceKey(v)" />
                <span class="ver-name">{{ displayVersionName(v) }}<small>{{ v.mcVersion }} · {{ v.loader }} {{ v.loaderVersion || '版本未知' }}<br />{{ v.folder }}</small></span>
                <span v-if="v.isolated" class="tag">已隔离</span>
              </label>
            </div>
            <div class="modal-actions">
              <button class="btn btn-ghost" @click="emit('close')">取消</button>
              <button class="btn btn-ghost" @click="onDownloadNew">下载新版本</button>
              <button class="btn btn-gold" :disabled="installing" @click="onInstallSelected">
                {{ installing ? '装入中…' : '装入所选版本' }}
              </button>
            </div>
          </template>

          <!-- 分支：部分匹配 -->
          <template v-else-if="branch === 'partial'">
            <p class="modal-label">
              没有能装入全部 MOD 的版本，以下为可装入部分 MOD 的版本（不兼容项将被跳过）：
            </p>
            <div class="ver-list">
              <label v-for="x in bestEffortVersions" :key="instanceKey(x.v)" class="ver-option" :class="{ active: selectedVersion === instanceKey(x.v) }">
                <input v-model="selectedVersion" type="radio" :value="instanceKey(x.v)" />
                <span class="ver-name">{{ displayVersionName(x.v) }}<small>{{ x.v.mcVersion }} · {{ x.v.loader }} {{ x.v.loaderVersion || '版本未知' }}<br />{{ x.v.folder }}</small></span>
                <span class="muted">可装 {{ x.ok.length }}/{{ validMods.length }}</span>
              </label>
            </div>
            <div class="modal-actions">
              <button class="btn btn-ghost" @click="emit('close')">取消</button>
              <button class="btn btn-ghost" @click="onDownloadNew">下载新版本</button>
              <button class="btn btn-gold" :disabled="installing" @click="onInstallSelected">
                {{ installing ? '装入中…' : '装入兼容的 MOD' }}
              </button>
            </div>
          </template>

          <!-- 分支：全无匹配 -->
          <template v-else-if="branch === 'none'">
            <div class="none-hint">
              <p>{{ scanErrors.length ? '尚不能确认所有本地实例的兼容性，请先处理扫描错误。' : `已扫描全部注册目录中的 ${allTargets.length} 个实例，未找到满足 MOD 元数据要求的版本。` }}</p>
              <details v-if="allTargets.length">
                <summary>查看逐个实例的匹配原因</summary>
                <div v-for="item in mismatchDetails" :key="instanceKey(item.v)" class="mismatch-item">
                  <strong>{{ displayVersionName(item.v) }}</strong><small>{{ item.v.folder }}</small>
                  <p v-for="reason in item.reasons" :key="reason">{{ reason }}</p>
                </div>
              </details>
            </div>
            <div class="modal-actions">
              <button class="btn btn-ghost" @click="emit('close')">取消</button>
              <button class="btn btn-ghost" @click="onCustomDownload">自定义下载</button>
              <button v-if="validMods.length && !scanErrors.length" class="btn btn-gold" :disabled="autoState.busy" @click="onAutoDownload">
                {{ autoState.busy ? '分析中…' : '自动下载最新兼容版本' }}
              </button>
            </div>
          </template>

          <!-- 失败文件原因汇总 -->
          <div v-if="failedMods.length" class="failed-summary muted">
            {{ failedMods.length }} 个文件无法识别（详见上方列表），已跳过，不影响其他 MOD 安装。
          </div>
        </template>
      </div>
    </div>
  </Teleport>
  <ModInstallDialog v-if="modRequest" :target="modRequest.target" :input="modRequest.input" @close="modRequest = null" @installed="modRequest = null; emit('close')"/>
</template>

<style scoped>
.mismatch-item { padding: var(--space-2) 0; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
.mismatch-item small { display: block; opacity: .75; font-size: var(--text-xs); }
.mismatch-item p { margin: var(--space-1) 0; font-size: var(--text-xs); }
.mismatch-item strong { font-size: var(--text-sm); }
summary { cursor: pointer; padding: var(--space-2) 0; font-size: var(--text-sm); }
.moddrop-modal {
  width: 520px;
  max-height: 82vh;
  overflow-y: auto;
}
.modal-title {
  font-size: var(--text-lg);
  font-weight: 700;
  margin: 0 0 var(--space-4);
}
.parse-loading {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-5) 0;
  justify-content: center;
}
.mod-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0 0 var(--space-2);
  max-height: 300px;
  overflow-y: auto;
}
.mod-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--row-h);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-2);
}
.mod-row.failed {
  border-color: var(--danger-border);
  background: var(--danger-soft);
}
.mod-icon {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
  object-fit: contain;
  image-rendering: pixelated;
}
.mod-icon-empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 700;
  font-size: var(--text-md);
}
.mod-meta {
  min-width: 0;
  flex: 1;
}
.mod-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.mod-name {
  font-size: var(--text-sm);
  font-weight: 700;
  word-break: break-all;
}
.mod-sub {
  margin-top: var(--space-1);
  font-size: var(--text-xs);
  line-height: 1.5;
  word-break: break-all;
}
.compat-ok {
  color: var(--ok);
}
.compat-bad {
  color: var(--danger);
}
.ver-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 200px;
  overflow-y: auto;
}
.ver-option {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--row-h);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-2);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.ver-option.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.ver-option input {
  accent-color: var(--accent);
}
.ver-name small { display: block; font-weight: 400; font-size: var(--text-xs); color: var(--text-dim); margin-top: var(--space-1); }
.ver-name {
  flex: 1;
  font-size: var(--text-sm);
  font-weight: 600;
  word-break: break-all;
}
.none-hint {
  padding: var(--space-3) var(--space-4);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  color: var(--text-dim);
  font-size: var(--text-sm);
  line-height: 1.7;
  margin-bottom: var(--space-1);
}
.failed-summary {
  margin-top: var(--space-3);
  font-size: var(--text-xs);
  line-height: 1.6;
}
.modal-label {
  font-size: var(--text-sm);
  color: var(--text-dim);
  margin: var(--space-3) 0 var(--space-2);
}
</style>
