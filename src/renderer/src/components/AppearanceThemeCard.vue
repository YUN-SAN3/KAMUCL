<script setup lang="ts">
import { computed } from 'vue'
import { enterEditMode, store, toast } from '../store'
import { DEFAULT_CUSTOM_THEME, THEME_PRESETS, type Settings, type ThemeName } from '@shared/types'
import { updateSettings } from '../settingsUpdates'
import { errText } from '../api'
async function save(patch: Partial<Settings>) { try { await updateSettings(patch) } catch (error) { toast('保存设置失败：' + errText(error), 'error') } }
const themeOptions = computed(() => {
  const customColors = store.settings?.custom.colors ?? DEFAULT_CUSTOM_THEME.colors
  const named = (key: Exclude<ThemeName, 'custom'>) => ({ key, ...THEME_PRESETS[key] })
  return [
    named('transparent'),
    named('blue-white'),
    named('black-orange'),
    named('black-pink'),
    named('white-pink'),
    {
      key: 'custom' as const,
      label: '个性化',
      description: '自定义配色与图片，沿用统一的图一布局',
      colors: customColors
    }
  ]
})

function chooseTheme(theme: ThemeName) {
  void save({ theme })
}

</script>
<template>
      <details data-ui="SettingsView:24e434dcfefc" data-section="theme" class="card group collapse" open>
        <summary data-ui="SettingsView:f10bc27bda82" class="collapse-head">
          <h3 data-ui="SettingsView:12a109aabb6e" class="group-title">主题</h3>
          <span data-ui="SettingsView:08891c0d2242" class="collapse-arrow" aria-hidden="true"></span>
        </summary>
        <div data-ui="SettingsView:23fb0346fede" class="collapse-body">
          <div data-ui="SettingsView:98eed5eaae97" class="theme-options">
            <button data-ui="SettingsView:ae1494b5d771"
              v-for="theme in themeOptions"
              :key="theme.key"
              class="theme-option"
              :class="{ active: store.settings.theme === theme.key }"
              :title="theme.description"
              @click="chooseTheme(theme.key)"
            >
              <span data-ui="SettingsView:ff8e35becbf3"
                class="theme-preview"
                :class="{ 'preview-custom': theme.key === 'custom', 'preview-transparent': theme.key === 'transparent' }"
                :style="{ background: theme.colors.bg }"
              >
                <span data-ui="SettingsView:202a66a2a038"
                  class="tp-side"
                  :style="{
                    background: theme.colors.sidebarBg,
                    borderRight: '1px solid ' + theme.colors.border
                  }"
                >
                  <span data-ui="SettingsView:f9ad546443d3" class="tp-dot" :style="{ background: theme.colors.accent }"></span>
                </span>
                <span data-ui="SettingsView:a397f44260a9" class="tp-main">
                  <span data-ui="SettingsView:e0b92057c385"
                    class="tp-top"
                    :style="{
                      background: theme.colors.card,
                      borderBottom: '1px solid ' + theme.colors.border
                    }"
                  ></span>
                  <span data-ui="SettingsView:b2cf2e01e30e" class="tp-body">
                    <span data-ui="SettingsView:d9c43308480c"
                      class="tp-block"
                      :style="{
                        background: theme.colors.card,
                        border: '1px solid ' + theme.colors.border
                      }"
                    ></span>
                    <span data-ui="SettingsView:fb0c4f0c22dd" class="tp-btn" :style="{ background: theme.colors.accent }"></span>
                  </span>
                </span>
                <span data-ui="SettingsView:bb37f5272e76" v-if="theme.key === 'custom'" class="tp-custom-grad"></span>
                <svg v-if="theme.key === 'custom'" class="tp-palette" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67A2.5 2.5 0 0 1 12 22Z" />
                  <circle cx="7.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
                  <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
                  <circle cx="16.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
                </svg>
                <svg v-if="store.settings.theme === theme.key" class="tp-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </span>
              <span data-ui="SettingsView:6e56a2fb3976" class="theme-label">{{ theme.label }}</span>
            </button>
          </div>

          <div data-ui="SettingsView:0a739dcbf8f2" class="theme-tools"><p data-ui="SettingsView:3e12a78eac9c" class="muted group-hint">选择配色立即生效。进入工作台后先预览布局、文字与透明度，再应用外观。</p>
          <button data-ui="SettingsView:16e9da51c37b"
            class="btn personalize-btn"
            @click="enterEditMode"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
              <path d="M1 14h6M9 8h6M17 16h6" />
            </svg>
            编辑个性化…
          </button></div>
        </div>
      </details>
</template>
<style scoped>
.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--card-pad);
}
.group-title {
  font-size: var(--text-sm);
  font-weight: 700;
  margin: 0;
  line-height: 1.5;
}
.group-hint {
  font-size: var(--text-xs);
  margin: 0;
  line-height: 1.6;
}
.group-error {
  font-size: var(--text-xs);
  margin: 0;
  color: var(--danger);
}
.group-inline {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

/* PCL 式折叠卡片：折叠态 = 标题行（行高）+ 右侧箭头；展开态内容统一内边距 */
.collapse {
  padding: 0;
}
.collapse-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: var(--row-h);
  padding: var(--space-2) var(--card-pad);
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.collapse-head::-webkit-details-marker {
  display: none;
}
.collapse-head:hover .group-title {
  color: var(--accent-2);
}
.collapse-arrow {
  width: 7px;
  height: 7px;
  border-right: 2px solid var(--text-dim);
  border-bottom: 2px solid var(--text-dim);
  /* 折叠态：箭头朝上（PCL 折叠卡片右上箭头） */
  transform: rotate(-45deg);
  transition: transform 0.18s ease;
  flex-shrink: 0;
}
.collapse[open] > .collapse-head .collapse-arrow {
  /* 展开态：箭头朝下 */
  transform: rotate(45deg);
}
.collapse-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3) var(--card-pad) var(--card-pad);
  border-top: 1px solid var(--border);
}

/* 主题选择 */
.theme-options {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-3);
}
.theme-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: 0;
  border: none;
  background: transparent;
  font-family: inherit;
  cursor: pointer;
}
.theme-preview {
  position: relative;
  display: flex;
  width: 150px;
  height: 84px;
  border-radius: var(--radius-md);
  border: 1.5px solid var(--border);
  overflow: hidden;
  transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.12s ease;
}
.theme-option:hover .theme-preview {
  transform: translateY(-1px);
  border-color: var(--border-strong);
}
.theme-option.active .theme-preview {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.theme-option:active .theme-preview {
  transform: scale(0.98);
}
.theme-label {
  font-size: var(--text-sm);
  color: var(--text-dim);
  transition: color 0.16s ease;
}
.theme-option.active .theme-label {
  color: var(--accent);
  font-weight: 600;
}
/* 迷你界面：侧栏 + 顶栏 + 内容块（各主题预览固定用自身配色，不跟随当前主题） */
.tp-side {
  width: 26px;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding-top: var(--space-2);
}
.tp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.tp-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.tp-top {
  height: 14px;
  flex-shrink: 0;
}
.tp-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px;
}
.tp-block {
  flex: 1;
  border-radius: 4px;
}
.tp-btn {
  height: 12px;
  flex-shrink: 0;
  border-radius: 4px;
}
.tp-check {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent);
  padding: 3.5px;
}
/* 自定义预览：彩虹渐变色块 + 调色盘图标 */
.preview-custom {
  align-items: center;
  justify-content: center;
  background: #16161d;
}
.tp-custom-grad {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, #f43f5e 0%, #f97316 25%, #eab308 45%, #22c55e 65%, #3b82f6 85%, #a855f7 100%);
  opacity: 0.85;
}
.tp-palette {
  position: relative;
  width: 30px;
  height: 30px;
  color: #ffffff;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.45));
}
/* 「个性化」入口（选中自定义主题后出现） */
.personalize-btn {
  align-self: flex-start;
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
  font-weight: 600;
}
.personalize-btn:hover:not(:disabled) {
  filter: brightness(1.06);
  border-color: var(--accent);
  color: var(--accent);
}


.collapse-body{padding:10px 18px 14px;gap:8px}.collapse-head{min-height:42px;padding:10px 18px}.collapse-head .group-title{margin:0}.theme-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px}.theme-option{flex-direction:row;justify-content:flex-start;gap:10px;min-height:48px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius-sm)}.theme-option.active{border-color:var(--accent);background:var(--accent-soft)}.theme-preview{width:46px;height:32px;flex:none;border-radius:5px}.theme-option:hover .theme-preview,.theme-option:active .theme-preview{transform:none}.theme-option.active .theme-preview{box-shadow:none}.theme-label{font-size:13px;white-space:nowrap}.tp-side{width:11px;padding-top:5px}.tp-dot{width:4px;height:4px}.tp-top{height:6px}.tp-body{padding:3px;gap:2px}.tp-btn{height:4px}.tp-check{width:13px;height:13px;top:2px;right:2px;padding:2px}.tp-palette{width:19px;height:19px}.theme-tools{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.personalize-btn{min-height:32px;padding:5px 12px;margin-top:6px}@media(max-width:700px){.theme-options{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
