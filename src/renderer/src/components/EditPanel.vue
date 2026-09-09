<script setup lang="ts">
/**
 * 个性化点选编辑面板（编辑模式时固定在右侧滑出）。
 * 内容随 store.editTarget 变化；未选中板块时显示指引 + 全部分组折叠列表。
 */
import { computed, ref } from 'vue'
import { copyText, errText, saveSettings } from '../api'
import { exitEditMode, store, toast } from '../store'
import { DEFAULT_CUSTOM_THEME } from '@shared/types'
import type { CustomTheme, Settings } from '@shared/types'

type ColorKey = keyof CustomTheme['colors']

const HEX_RE = /^#[0-9a-fA-F]{6}$/

const colors = computed(() => store.settings?.custom.colors ?? DEFAULT_CUSTOM_THEME.colors)

// ---------------- 板块分组定义（key 对应界面元素的 data-edit） ----------------
interface GroupDef {
  key: string
  title: string
  hint?: string
  colors: Array<{ key: ColorKey; label: string }>
}

const GROUPS: GroupDef[] = [
  {
    key: 'sidebar',
    title: '侧栏',
    colors: [
      { key: 'sidebarBg', label: '侧栏背景' },
      { key: 'sidebarText', label: '侧栏文字' }
    ]
  },
  {
    key: 'topbar',
    title: '顶栏与界面背景',
    colors: [
      { key: 'bg', label: '界面背景' },
      { key: 'border', label: '边框' }
    ]
  },
  { key: 'banner', title: '启动展示卡', colors: [] },
  {
    key: 'bannerText',
    title: 'Banner 文字',
    colors: [{ key: 'bannerText', label: 'Banner 文字颜色' }]
  },
  {
    key: 'accent',
    title: '主色调',
    hint: '按钮、选中态与链接的强调色，派生渐变色自动计算',
    colors: [{ key: 'accent', label: '主色调' }]
  },
  {
    key: 'card',
    title: '卡片',
    colors: [
      { key: 'card', label: '卡片背景' },
      { key: 'border', label: '边框' }
    ]
  },
  {
    key: 'text',
    title: '文字',
    colors: [
      { key: 'text', label: '主要文字' },
      { key: 'textDim', label: '次要文字' }
    ]
  }
]

const activeGroup = computed(() => GROUPS.find((g) => g.key === store.editTarget) ?? null)

// ---------------- 保存（局部合并 patch，主进程深合并；拖动时防抖） ----------------
let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingCustom: CustomTheme | null = null

async function save(patch: Partial<Settings>) {
  try {
    store.settings = await saveSettings(patch)
  } catch (e) {
    toast('保存设置失败：' + errText(e), 'error')
  }
}

/** 乐观更新 store.settings.custom（App.vue watch 实时应用），并防抖落盘 */
function applyCustom(next: CustomTheme) {
  if (store.settings) store.settings.custom = next
  pendingCustom = next
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (pendingCustom) void save({ custom: pendingCustom })
    pendingCustom = null
  }, 200)
}

// ---------------- 颜色 ----------------
function setColor(key: ColorKey, value: string) {
  const c = store.settings?.custom
  if (!c || !HEX_RE.test(value)) return
  applyCustom({ ...c, colors: { ...c.colors, [key]: value.toLowerCase() } })
}

function onPick(key: ColorKey, e: Event) {
  setColor(key, (e.target as HTMLInputElement).value)
}

function onHex(key: ColorKey, e: Event) {
  setColor(key, (e.target as HTMLInputElement).value.trim())
}

/** hex 文本非法时失焦还原为当前生效值 */
function onHexBlur(key: ColorKey, e: Event) {
  const el = e.target as HTMLInputElement
  if (!HEX_RE.test(el.value.trim())) el.value = colors.value[key]
}

// ---------------- 恢复默认 ----------------
function resetAll() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    pendingCustom = null
  }
  void save({ theme: 'custom', custom: structuredClone(DEFAULT_CUSTOM_THEME) })
  toast('已恢复默认自定义主题', 'success')
}

// ---------------- 主题码（实时生成 / 粘贴套用） ----------------
const CODE_PREFIX = 'KAMUCL.'

/** base64url 编解码（内容为纯 ASCII 的 JSON） */
function encodeCode(payload: unknown): string {
  return CODE_PREFIX + btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function decodeCode(code: string): unknown {
  let s = code.trim()
  if (s.startsWith(CODE_PREFIX)) s = s.slice(CODE_PREFIX.length)
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return JSON.parse(atob(s))
}

/** 当前自定义主题的实时主题码（图一结构固定，只分享颜色）。 */
const themeCode = computed(() => {
  const c = store.settings?.custom ?? DEFAULT_CUSTOM_THEME
  return encodeCode({ colors: c.colors })
})

async function copyCode() {
  await copyText(themeCode.value)
  toast('主题码已复制，发给别人即可分享你的配色', 'success')
}

const codeInput = ref('')

/** 校验并套用别人分享的主题码 */
function applyCode() {
  const raw = codeInput.value.trim()
  if (!raw) {
    toast('请先粘贴主题码', 'error')
    return
  }
  try {
    const parsed = decodeCode(raw) as Partial<{ colors: unknown }>
    const def = DEFAULT_CUSTOM_THEME
    // 白名单校验：主题码只能改变颜色，不能改变图一固定结构。
    const src = (parsed.colors ?? {}) as Record<string, unknown>
    const colors = { ...def.colors }
    for (const key of Object.keys(colors) as Array<keyof typeof colors>) {
      const v = src[key]
      if (typeof v === 'string' && HEX_RE.test(v)) colors[key] = v.toLowerCase()
    }
    void save({ theme: 'custom', custom: { colors, layout: def.layout } })
    codeInput.value = ''
    toast('主题码已套用', 'success')
  } catch {
    toast('主题码无效，请检查是否复制完整', 'error')
  }
}
</script>

<template>
  <aside class="edit-panel">
    <!-- 头部 -->
    <div class="ep-head">
      <div class="ep-head-text">
        <h2 class="ep-title">个性化</h2>
        <p class="ep-sub">
          {{ activeGroup ? `正在编辑：${activeGroup.title}` : '点击左侧界面中的板块开始自定义' }}
        </p>
      </div>
      <button class="ep-close" title="完成并退出（Esc）" @click="exitEditMode">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>

    <div class="ep-body">
      <!-- 选中板块：仅显示对应分组 -->
      <template v-if="activeGroup">
        <section class="ep-group">
          <h3 class="ep-group-title">{{ activeGroup.title }}</h3>
          <p v-if="activeGroup.hint" class="ep-hint">{{ activeGroup.hint }}</p>
          <div v-for="f in activeGroup.colors" :key="f.key" class="color-row">
            <span class="color-name">{{ f.label }}</span>
            <input
              type="color"
              class="color-swatch"
              :value="colors[f.key]"
              @input="onPick(f.key, $event)"
            />
            <input
              class="input mono hex-input"
              :value="colors[f.key]"
              placeholder="#rrggbb"
              spellcheck="false"
              @input="onHex(f.key, $event)"
              @blur="onHexBlur(f.key, $event)"
            />
          </div>
        </section>
      </template>

      <!-- 未选中：指引 + 全部分组折叠列表（后备） -->
      <template v-else>
        <div class="ep-guide">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="m4 4 7 17 2.5-7.5L21 11Z" />
            <path d="M13.5 13.5 19 19" />
          </svg>
          <p>用鼠标左键点击界面中的板块（侧栏 / 顶栏 / 启动卡 / 按钮 / 卡片 / 文字），选中后即可调整颜色；全部主题始终沿用图一布局。</p>
        </div>
        <details v-for="g in GROUPS" :key="g.key" class="ep-details">
          <summary class="ep-summary">{{ g.title }}</summary>
          <div class="ep-details-body">
            <div v-for="f in g.colors" :key="f.key" class="color-row">
              <span class="color-name">{{ f.label }}</span>
              <input
                type="color"
                class="color-swatch"
                :value="colors[f.key]"
                @input="onPick(f.key, $event)"
              />
              <input
                class="input mono hex-input"
                :value="colors[f.key]"
                placeholder="#rrggbb"
                spellcheck="false"
                @input="onHex(f.key, $event)"
                @blur="onHexBlur(f.key, $event)"
              />
            </div>
            <!-- 空分组（如启动展示卡由图片/背景派生）：展开时给提示而不是空白布局异常 -->
            <p v-if="!g.colors.length" class="ep-hint ep-empty-hint">该板块颜色由界面背景与主色调自动派生，无可单独调整项。</p>
          </div>
        </details>
      </template>

      <!-- 底部常驻：主题码 + 恢复默认（钉在面板底部，滚动区内容再多也不会把它们推走） -->
    </div>
    <div class="ep-foot">
      <section class="ep-group">
        <h3 class="ep-group-title">主题码</h3>
        <div class="code-row">
          <input class="input mono code-view" :value="themeCode" readonly spellcheck="false" />
          <button class="btn btn-gold btn-sm code-btn" @click="copyCode">复制</button>
        </div>
        <div class="code-row">
          <input
            v-model="codeInput"
            class="input mono"
            placeholder="粘贴别人的主题码…"
            spellcheck="false"
            @keyup.enter="applyCode"
          />
          <button class="btn btn-ghost btn-sm code-btn" @click="applyCode">套用</button>
        </div>
      </section>
      <button class="btn btn-ghost reset-btn" @click="resetAll">恢复默认</button>
    </div>
  </aside>
</template>

<style scoped>
.edit-panel {
  position: fixed;
  /* 避开顶部「个性化编辑中」提示栏（top:14px + 高约40px + ≥12px 间距），不穿提示栏 */
  top: 72px;
  right: 0;
  bottom: 0;
  width: 320px;
  z-index: 120;
  display: flex;
  flex-direction: column;
  /* 接近不透明：透明主题的 --card 半透明会透出背景内容；--bg 在六套主题下均不透明 */
  background: var(--bg);
  /* 明确视觉边界：左侧描边 + 更强投影，与下方内容分层 */
  border-left: 1px solid var(--border-strong);
  box-shadow: -16px 0 40px rgba(0, 0, 0, 0.32);
}

/* 头部 */
.ep-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-4) var(--space-3);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.ep-head-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.ep-title {
  font-size: var(--text-lg);
  font-weight: 700;
}
.ep-sub {
  font-size: var(--text-xs);
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ep-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}
.ep-close:hover {
  background: var(--card-2);
  color: var(--text);
}
.ep-close svg {
  width: 15px;
  height: 15px;
}

/* 滚动主体 */
.ep-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-3) var(--space-4) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.ep-group-title {
  font-size: var(--text-sm);
  font-weight: 700;
  margin-bottom: var(--space-1);
}
.ep-hint {
  font-size: var(--text-xs);
  color: var(--text-dim);
  margin-bottom: var(--space-1);
  line-height: 1.6;
}

/* 指引 */
.ep-guide {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-3);
  border: 1.5px dashed var(--border);
  border-radius: var(--radius-md);
  color: var(--text-dim);
  font-size: var(--text-xs);
  line-height: 1.8;
  text-align: center;
}
.ep-guide svg {
  width: 26px;
  height: 26px;
  color: var(--accent-2);
}

/* 折叠分组（后备列表）：PCL 式标题行 + 箭头，折叠态行高统一 */
.ep-details {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-2);
  overflow: hidden;
}
.ep-summary {
  padding: var(--space-2) var(--space-3);
  min-height: var(--row-h);
  font-size: var(--text-sm);
  font-weight: 600;
  line-height: 1.5;
  white-space: normal;
  word-break: break-all;
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  transition: background 0.15s ease, color 0.15s ease;
}
.ep-summary::-webkit-details-marker {
  display: none;
}
.ep-summary::after {
  content: '';
  width: 7px;
  height: 7px;
  border-right: 1.8px solid var(--text-dim);
  border-bottom: 1.8px solid var(--text-dim);
  transform: rotate(45deg);
  transition: transform 0.18s ease;
  flex-shrink: 0;
}
.ep-details[open] .ep-summary::after {
  transform: rotate(225deg);
}
.ep-summary:hover {
  color: var(--accent-2);
}
.ep-details-body {
  padding: var(--space-1) var(--space-3) var(--space-3);
  border-top: 1px solid var(--border);
}
/* 空分组（无颜色项）展开时的提示，避免展开后空白导致的布局异常观感 */
.ep-empty-hint {
  padding: var(--space-1) 0;
  margin: 0;
}

/* 颜色行 */
.color-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--ctl-h);
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--border);
}
.color-row:last-of-type {
  border-bottom: none;
}
.color-name {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  line-height: 1.5;
  white-space: normal;
  word-break: break-all;
}

/* 主题码 */
.code-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
}
.code-row .input {
  flex: 1;
  min-width: 0;
}
.code-view {
  color: var(--text-dim);
  user-select: all;
}
.code-btn {
  flex-shrink: 0;
}
.color-swatch {
  -webkit-appearance: none;
  appearance: none;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.12s ease;
}
.color-swatch:hover {
  border-color: var(--accent);
  transform: scale(1.05);
}
.color-swatch::-webkit-color-swatch-wrapper {
  padding: 3px;
}
.color-swatch::-webkit-color-swatch {
  border: none;
  border-radius: 4px;
}
.hex-input {
  width: 88px;
  flex-shrink: 0;
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
  text-transform: lowercase;
}

/* 底部钉住区：主题码 + 恢复默认（始终在面板底部可见可交互，不受滚动区内容多少影响） */
.ep-foot {
  flex-shrink: 0;
  padding: var(--space-3) var(--space-4) var(--space-3);
  border-top: 1px solid var(--border);
  background: var(--bg);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.ep-foot .ep-group-title {
  margin-bottom: 0;
}
.reset-btn {
  align-self: flex-start;
}

.mono {
  font-size: var(--text-xs);
}
</style>
