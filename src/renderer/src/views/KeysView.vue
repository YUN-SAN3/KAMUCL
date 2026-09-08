<script setup lang="ts">
/**
 * 默认配置：启动器级默认按键。
 * 开启「按键设置同步」后，启动任何版本时自动把默认按键写入该实例 options.txt 的 key_* 项。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { errText, getDefaultKeys, resetDefaultKeys, setDefaultKey } from '../api'
import { store, toast } from '../store'
import { updateSettings } from '../settingsUpdates'
import { KEYBIND_CATEGORIES, VANILLA_KEYBINDS, codeToMcKey, mcKeyLabel, mouseButtonToMcKey } from '@shared/keybindings'

const keys = ref<Record<string, string>>({})
const loading = ref(true)
const keySearch = ref('')
const capturing = ref('')

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
  } catch (e) {
    toast('读取默认按键失败：' + errText(e), 'error')
  } finally {
    loading.value = false
  }
})
onUnmounted(stopCapture)
</script>

<template>
  <div class="page cfg-page">
    <div class="page-head">
      <h1 class="page-title">默认配置</h1>
      <p class="page-sub">启动器级默认按键；开启同步后，启动任何版本时自动写入该实例的 options.txt</p>
    </div>

    <!-- 按键同步开关 -->
    <div class="card group-inline cfg-switch">
      <div>
        <h3 class="group-title">按键设置同步</h3>
        <p class="muted group-hint">启动任意版本时，用下方默认按键覆盖该实例 options.txt 的 key_* 项</p>
      </div>
      <label class="switch">
        <input type="checkbox" :checked="keySync" @change="toggleKeySync(($event.target as HTMLInputElement).checked)" />
        <span class="switch-ui"></span>
      </label>
    </div>

    <div v-if="loading" class="card empty"><span class="spin"></span></div>
    <!-- 按键配置 -->
    <div v-else class="card cfg-col">
      <div class="cfg-col-head">
        <div>
          <h3 class="group-title">按键配置</h3>
          <p class="muted group-hint" style="margin: 2px 0 0">对应游戏内「选项 → 控制 → 按键控制」</p>
        </div>
        <button class="btn btn-ghost btn-sm" :disabled="!keyModifiedCount" @click="resetAllKeys">全部恢复默认</button>
      </div>
      <input v-model="keySearch" class="input cfg-search" placeholder="搜索按键名称…" />
      <div class="cfg-scroll">
        <div v-for="group in keyGrouped" :key="group.category" class="cfg-group">
          <h4 class="cfg-cat">{{ group.category }}</h4>
          <div v-for="item in group.items" :key="item.id" class="cfg-row">
            <span class="cfg-label" :title="item.id">{{ item.label }}</span>
            <button
              class="cfg-bind"
              :class="{ capturing: capturing === item.id, modified: (keys[item.id] ?? item.defaultBind) !== item.defaultBind }"
              :title="capturing === item.id ? '按任意键设置，Esc 取消' : '点击后按任意键修改'"
              @click="startCapture(item.id)"
            >
              {{ capturing === item.id ? '按任意键…' : mcKeyLabel(keys[item.id] ?? item.defaultBind) }}
            </button>
            <button
              class="cfg-reset"
              :class="{ invisible: (keys[item.id] ?? item.defaultBind) === item.defaultBind }"
              title="恢复此项默认"
              @click="resetOneKey(item.id)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 4v5h5"/></svg>
            </button>
          </div>
        </div>
        <div v-if="!keyGrouped.length" class="empty"><span>没有匹配「{{ keySearch }}」的按键</span></div>
      </div>
    </div>

    <div v-if="capturing" class="menu-overlay cfg-capture-mask" @click="stopCapture"></div>
  </div>
</template>

<style scoped>
/* 间距全部走全局设计令牌：元素与板块边缘保持呼吸感（card-pad 由 .card 提供） */
.cfg-page { max-width: 760px; }
.cfg-switch { align-items: flex-start; }
.cfg-col { display: flex; flex-direction: column; min-height: 0; }
.cfg-col-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-3); }
.cfg-search { width: 100%; margin-bottom: var(--space-3); }
.cfg-scroll { overflow-y: auto; max-height: calc(100vh - 330px); min-height: 220px; padding-right: var(--space-2); }
.cfg-group { margin-top: var(--space-4); }
.cfg-group:first-child { margin-top: 0; }
.cfg-cat { font-size: var(--text-sm); color: var(--text-dim); margin: 0 0 var(--space-2); font-weight: 650; }
.cfg-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-2); border-radius: var(--radius-sm); }
.cfg-row:hover { background: var(--card-2); }
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
</style>
