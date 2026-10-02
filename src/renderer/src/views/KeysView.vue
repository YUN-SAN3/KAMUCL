<script setup lang="ts">
/**
 * 默认配置：启动器级默认按键。
 * 开启「按键设置同步」后，启动任何版本时自动把默认按键写入该实例 options.txt 的 key_* 项。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import DefaultGameOptions from '../components/DefaultGameOptions.vue'
import { errText, getDefaultKeys, resetDefaultKeys, setDefaultKey, getDefaultResourcePacks, importDefaultResourcePacks, pickDefaultResourcePacks, removeDefaultResourcePack, moveDefaultResourcePack, setDefaultResourcePackEnabled } from '../api'
import type { DefaultResourcePack } from '@shared/types'
import { store, toast } from '../store'
import { updateSettings } from '../settingsUpdates'
import { KEYBIND_CATEGORIES, VANILLA_KEYBINDS, codeToMcKey, mcKeyLabel, mouseButtonToMcKey } from '@shared/keybindings'

const keys = ref<Record<string, string>>({})
const section = ref<'game' | 'keys' | 'packs'>('game')
function selectSection(value: 'game' | 'keys' | 'packs') { stopCapture(); section.value = value }
const loading = ref(true)
const keySearch = ref('')
const capturing = ref('')
const resourcePacks = ref<DefaultResourcePack[]>([])
const packsBusy = ref(false)
const dragActive = ref(false)
async function togglePackSync(on: boolean) {
  try { await updateSettings({ resourcePackSync: on }) } catch (e) { toast('保存失败：' + errText(e), 'error') }
}
async function editPacks(action: () => Promise<DefaultResourcePack[]>, enable = false) {
  if (packsBusy.value) return
  packsBusy.value = true
  try {
    resourcePacks.value = await action()
    if (enable && resourcePacks.value.length) await togglePackSync(true)
  } catch (e) { toast('材质包配置失败：' + errText(e), 'error') }
  finally { packsBusy.value = false }
}
async function dropPacks(event: DragEvent) {
  selectSection('packs')
  dragActive.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  await editPacks(() => importDefaultResourcePacks(files.map(file => window.kamucl.getFilePath(file)).filter(Boolean)), true)
}

onMounted(() => { store.resourceDropHandler = dropPacks })
onUnmounted(() => { if (store.resourceDropHandler === dropPacks) store.resourceDropHandler = null })

const keySync = computed(() => store.settings?.keySync === true)

async function toggleKeySync(on: boolean) {
  try {
    await updateSettings({ keySync: on })
    store.settings = { ...store.settings!, keySync: on }
    toast(on ? '已开启按键设置同步' : '已关闭按键设置同步', 'success')
  } catch (e) {
    toast('保存失败：' + errText(e), 'error')
  }
}

const keyGrouped = computed(() => {
  const kw = keySearch.value.trim().toLowerCase()
  const match = (id: string, label: string, bind: string) =>
    !kw || label.toLowerCase().includes(kw) || id.toLowerCase().includes(kw) || mcKeyLabel(bind).toLowerCase().includes(kw)
  return KEYBIND_CATEGORIES.map((cat) => ({
    category: cat,
    items: VANILLA_KEYBINDS.filter((d) => d.category === cat && match(d.id, d.label, keys.value[d.id] ?? d.defaultBind))
  })).filter((g) => g.items.length)
})
const keyModifiedCount = computed(() =>
  VANILLA_KEYBINDS.filter((d) => (keys.value[d.id] ?? d.defaultBind) !== d.defaultBind).length
)

function startCapture(id: string) {
  capturing.value = id
  addEventListener('keydown', onCaptureKey, true)
  addEventListener('mousedown', onCaptureMouse, true)
}
function stopCapture() {
  capturing.value = ''
  removeEventListener('keydown', onCaptureKey, true)
  removeEventListener('mousedown', onCaptureMouse, true)
}
async function onCaptureKey(e: KeyboardEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') { stopCapture(); return }
  const bind = codeToMcKey(e.code)
  if (!bind) return
  const id = capturing.value
  stopCapture()
  await applyKey(id, bind)
}
async function onCaptureMouse(e: MouseEvent) {
  if ((e.target as Element)?.closest('[data-key-clear]')) return
  e.preventDefault()
  e.stopPropagation()
  const bind = mouseButtonToMcKey(e.button)
  if (!bind) return
  const id = capturing.value
  stopCapture()
  await applyKey(id, bind)
}
async function applyKey(id: string, bind: string) {
  try {
    keys.value = await setDefaultKey(id, bind)
    toast('已更新默认按键', 'success')
  } catch (e) {
    toast('设置失败：' + errText(e), 'error')
  }
}
async function resetOneKey(id: string) {
  const def = VANILLA_KEYBINDS.find((d) => d.id === id)
  if (!def) return
  await applyKey(id, def.defaultBind)
}
/** 捕获时通过独立 X 按钮清空，不把这次点击录为鼠标左键。 */
async function clearCapturedKey() {
  const id = capturing.value
  stopCapture()
  if (!id) return
  await applyKey(id, 'key.keyboard.unknown')
  toast('已将该按键设置为空', 'success')
}
async function resetAllKeys() {
  try {
    keys.value = await resetDefaultKeys()
    toast('按键已全部恢复为 MC 原版默认', 'success')
  } catch (e) {
    toast('重置失败：' + errText(e), 'error')
  }
}

onMounted(async () => {
  try {
    keys.value = await getDefaultKeys()
    resourcePacks.value = await getDefaultResourcePacks()
  } catch (e) {
    toast('读取默认按键失败：' + errText(e), 'error')
  } finally {
    loading.value = false
  }
})
onUnmounted(stopCapture)
</script>

<template>
  <div data-ui="KeysView:68edd6496058" class="page cfg-page" :data-design-page="section">
    <div data-ui="KeysView:3f669650903f" class="page-head">
      <h1 data-ui="KeysView:f824d576be0f" class="page-title">默认配置</h1>
      <p data-ui="KeysView:f1949eee5dfe" class="page-sub">让每个世界，都保留你熟悉的操作习惯。</p>
    </div>

    <nav data-ui="KeysView:c0a728e450f2" class="cfg-sections" aria-label="默认配置分类">
      <button data-ui="KeysView:384d69817c73" :class="{active:section === 'game'}" @click="selectSection('game')"><strong>游戏选项</strong><small>画面、控制与辅助功能</small></button>
      <button data-ui="KeysView:732b450bc0f6" :class="{active:section === 'keys'}" @click="selectSection('keys')"><strong>按键配置</strong><small>{{ keyModifiedCount }} 项自定义绑定</small></button>
      <button data-ui="KeysView:d7d636f03de6" :class="{active:section === 'packs'}" @click="selectSection('packs')"><strong>默认材质包</strong><small>{{ resourcePacks.length }} 个材质包</small></button>
    </nav>
    <DefaultGameOptions v-show="section === 'game'" @section="selectSection" />
    <div data-ui="KeysView:69a14d0edda5" v-show="section === 'packs'" class="card cfg-col default-packs" :class="{ 'drag-active': dragActive }" @dragover.prevent="dragActive = true" @dragleave.self="dragActive = false" @drop.prevent="dropPacks">
      <div class="cfg-col-head">
        <div><h3 class="group-title">默认材质包</h3><p class="muted group-hint">拖入多个 ZIP 材质包，列表靠后的包优先级更高</p></div>
        <button data-ui="KeysView:876c0145d0d4" class="btn btn-ghost" :disabled="packsBusy" @click="editPacks(pickDefaultResourcePacks, true)">{{ packsBusy ? '正在导入…' : '添加材质包…' }}</button>
        <label data-ui="KeysView:f73970a957ff" class="cfg-sync"><span>材质包同步</span><span class="switch"><input data-ui="KeysView:78b789615abb" type="checkbox" :checked="store.settings?.resourcePackSync === true" @change="togglePackSync(($event.target as HTMLInputElement).checked)"/><span class="switch-ui"></span></span></label>
      </div>
      <div data-ui="KeysView:22e226a30b38" v-for="(pack, index) in resourcePacks" :key="pack.id" class="cfg-row">
        <span data-ui="KeysView:deb0c6a821a6" class="cfg-label" :title="pack.name">{{ pack.name }}</span>
        <label class="cfg-sync pack-enable" :data-ui="`default-pack:${pack.id}:enabled`"><span>{{ pack.enabled ? '已启用' : '未启用' }}</span><span class="switch"><input data-ui="KeysView:068b826fa09a" type="checkbox" :aria-label="`启用材质包 ${pack.name}`" :checked="pack.enabled" :disabled="packsBusy" @change="editPacks(() => setDefaultResourcePackEnabled(pack.id, ($event.target as HTMLInputElement).checked))"/><span class="switch-ui"></span></span></label>
        <button data-ui="KeysView:1cbe8606de10" class="btn btn-ghost btn-sm" :disabled="packsBusy || index === 0" title="降低优先级" @click="editPacks(() => moveDefaultResourcePack(pack.id, -1))">↑</button>
        <button data-ui="KeysView:2a307d6181f9" class="btn btn-ghost btn-sm" :disabled="packsBusy || index === resourcePacks.length - 1" title="提高优先级" @click="editPacks(() => moveDefaultResourcePack(pack.id, 1))">↓</button>
        <button data-ui="KeysView:6e625dac35a7" class="btn btn-ghost btn-sm" :disabled="packsBusy" @click="editPacks(() => removeDefaultResourcePack(pack.id))">移除</button>
      </div>
      <p data-ui="KeysView:27229a3b7fa7" v-if="!resourcePacks.length" class="muted">将材质包拖到这里，或点击上方按钮添加。</p>

      <p class="muted group-hint">添加后自动开启同步。每个材质包可独立启停，下次启动游戏时生效；未启用的包不会复制，并取消其默认启用。关闭总同步不改动实例。原文件和已复制文件保留。</p>
    </div>
    <div data-ui="KeysView:22b5e108771c" v-if="loading" class="card empty"><span data-ui="KeysView:9c54c2c06f78" class="spin"></span></div>
    <!-- 按键配置（同步开关整合进卡片头部，不再单独占一张卡） -->
    <div data-ui="KeysView:58a64397f47a" v-else v-show="section === 'keys'" class="card cfg-col">
      <div class="cfg-col-head">
        <div>
          <h3 class="group-title">按键配置</h3>
          <p data-ui="KeysView:0fec7e4d603b" class="muted group-hint" style="margin: 2px 0 0">对应游戏内「选项 → 控制 → 按键控制」</p>
        </div>
        <div data-ui="KeysView:076aac6059fa" class="cfg-head-actions">
          <label data-ui="KeysView:d24483e908e0" class="cfg-sync" title="启动任意版本时，用下方默认按键覆盖该实例 options.txt 的 key_* 项">
            <span data-ui="KeysView:3c5373f12848" class="cfg-sync-text">按键设置同步</span>
            <span class="switch">
              <input data-ui="KeysView:8da5b395e36b" type="checkbox" :checked="keySync" @change="toggleKeySync(($event.target as HTMLInputElement).checked)" />
              <span class="switch-ui"></span>
            </span>
          </label>
          <button data-ui="KeysView:051ad2a1db23" class="btn btn-ghost btn-sm" :disabled="!keyModifiedCount" @click="resetAllKeys">全部恢复默认</button>
        </div>
      </div>
      <input data-ui="KeysView:7bb183320b84" v-model="keySearch" class="input cfg-search" placeholder="搜索按键名称…" />
      <div data-ui="KeysView:a8f22f80d5d3" class="cfg-scroll">
        <div data-ui="KeysView:5e83994d56a1" v-for="group in keyGrouped" :key="group.category" class="cfg-group">
          <h4 data-ui="KeysView:21f659d3f704" class="cfg-cat">{{ group.category }}</h4>
          <div data-ui="KeysView:577547417d1b" v-for="item in group.items" :key="item.id" class="cfg-row">
            <span data-ui="KeysView:be428b06c1c7" class="cfg-label" :title="item.id">{{ item.label }}</span>
            <button data-ui="KeysView:5f341e9d9083"
              class="cfg-bind"
              :class="{ capturing: capturing === item.id, modified: (keys[item.id] ?? item.defaultBind) !== item.defaultBind }"
              :title="capturing === item.id ? '按任意键设置，Esc 取消' : '点击后按任意键修改'"
              @click="startCapture(item.id)"
            >
              {{ capturing === item.id ? '按任意键…' : mcKeyLabel(keys[item.id] ?? item.defaultBind) }}
            </button>
            <button data-ui="KeysView:05190022165a" v-if="capturing === item.id" class="cfg-clear" data-key-clear title="设为未指定" aria-label="设为未指定" @click.stop="clearCapturedKey">×</button>
            <button data-ui="KeysView:d943e4477ca3"
              class="cfg-reset"
              :class="{ invisible: (keys[item.id] ?? item.defaultBind) === item.defaultBind }"
              title="恢复此项默认"
              @click="resetOneKey(item.id)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 4v5h5"/></svg>
            </button>
          </div>
        </div>
        <div data-ui="KeysView:1347fda480a9" v-if="!keyGrouped.length" class="empty"><span>没有匹配「{{ keySearch }}」的按键</span></div>
      </div>
    </div>

    <div data-ui="KeysView:2a45989f0d3a" v-if="capturing" class="menu-overlay cfg-capture-mask" @click="stopCapture"></div>
  </div>
</template>

<style scoped>
/* 间距全部走全局设计令牌：元素与板块边缘保持呼吸感（card-pad 由 .card 提供） */
.cfg-page { width: 100%; max-width: 1040px; margin: 0 auto; }
.cfg-page > .page-head { margin-bottom: 24px; }
.cfg-sections{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:24px}.cfg-sections button{display:flex;flex-direction:column;align-items:flex-start;gap:7px;text-align:left;padding:18px 20px;border:1px solid var(--border);border-radius:14px;background:var(--card);color:var(--text);cursor:pointer;transition:background 180ms,border-color 180ms}.cfg-sections small{font-size:12px;color:var(--text-dim)}.cfg-sections button.active{border-color:var(--accent);background:var(--accent-soft)}.cfg-sections button:hover{border-color:var(--accent)}
@media(max-width:700px){.cfg-sections{gap:8px}.cfg-sections button{padding:12px}.cfg-sections small{display:none}}
.default-packs { margin-bottom: var(--sec-gap); }
.default-packs.drag-active { outline: 2px solid var(--accent); background: var(--accent-soft); }
.cfg-col { display: flex; flex-direction: column; min-height: 0; }
.cfg-col-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-3); flex-wrap: wrap; }
/* 头部操作区：同步开关 + 恢复默认 同行右置 */
.cfg-head-actions { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
.cfg-sync {
  display: inline-flex; align-items: center; gap: var(--space-2); cursor: pointer;
  padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm);
}
.cfg-sync:hover { background: var(--hover); }
.cfg-sync-text { font-size: var(--text-sm); color: var(--text-dim); font-weight: 600; }
.cfg-search { width: 100%; margin-bottom: var(--space-3); }
.cfg-scroll { min-height: 220px; display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;padding-top:12px }
@media(max-width:850px){.cfg-scroll{grid-template-columns:1fr}}
.cfg-group { margin-top: var(--space-4); }
.cfg-group:first-child { margin-top: 0; }
.cfg-cat { font-size: var(--text-sm); color: var(--text-dim); margin: 0 0 var(--space-2); font-weight: 650; }
.cfg-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-2); border-radius: var(--radius-sm); }
.cfg-row:hover { background: var(--card-2); }
.pack-enable { flex-shrink: 0; white-space: nowrap; }
.default-packs .cfg-label { overflow-wrap: anywhere; }
.cfg-label { flex: 1; min-width: 0; font-size: var(--text-sm); }
.cfg-bind {
  min-width: 120px; padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--card-2); color: var(--text); font-size: var(--text-xs); font-family: inherit; cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.cfg-bind:hover { border-color: var(--accent); }
.cfg-bind.modified { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); background: var(--accent-soft); }
.cfg-bind.capturing { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); color: var(--accent-2); }
.cfg-reset {
  display: flex; align-items: center; justify-content: center; width: 26px; height: 26px;
  border: none; border-radius: var(--radius-sm); background: transparent; color: var(--text-dim); cursor: pointer; flex-shrink: 0;
}
.cfg-reset:hover { color: var(--accent-2); background: var(--hover); }
.cfg-reset svg { width: 13px; height: 13px; }
.cfg-reset.invisible { visibility: hidden; }
.cfg-capture-mask { z-index: 9000; }
.cfg-clear { position: relative; z-index: 9001; width: 30px; height: 30px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--card); color: var(--text); cursor: pointer; font-size: 22px; }
.cfg-bind.capturing { position: relative; z-index: 9001; }

.cfg-page .cfg-sections{display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:8px}.cfg-page .cfg-sections button{display:flex;flex-direction:row;align-items:center;gap:8px;min-height:40px;padding:8px 14px;border:0;border-radius:var(--radius-sm);background:transparent}.cfg-page .cfg-sections button.active{background:var(--accent-soft);color:var(--text)}.cfg-sections strong{font-size:14px}.cfg-sections small{font-size:12px}.default-packs{padding:20px}.default-packs .cfg-col-head{gap:12px;flex-wrap:wrap}.default-packs .cfg-col-head>div{flex:1;min-width:160px}.default-packs .cfg-row{min-height:60px;gap:12px}.default-packs .cfg-label{min-width:0;overflow-wrap:break-word;flex:1}.default-packs .group-hint{line-height:1.6}.default-packs .cfg-row .btn{flex:none}@media(max-width:760px){.default-packs .cfg-row{flex-wrap:wrap}.default-packs .cfg-label{flex-basis:100%}.cfg-sections small{display:none}}

</style>
