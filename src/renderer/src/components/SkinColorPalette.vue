<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { hsvToRgb, parseSkinChannels, parseSkinHex, rgbToHsv, rgbToSkinHex, SKIN_COLOR_PRESETS, type HsvColor } from '@shared/skinColors'

const props = defineProps<{ color: string; alpha: number; alphaEnabled: boolean; custom: string[]; recent: string[] }>()
const emit = defineEmits<{ 'update:color': [string]; 'update:alpha': [number]; 'update:custom': [string[]] }>()
const hsv = ref<HsvColor>(rgbToHsv(parseSkinHex(props.color)!))
const focusedGroup = ref('')
const drafts = reactive({ hex: props.color, rgb: ['', '', ''], hsv: ['', '', ''], alpha: '100' })
const hueColor = computed(() => rgbToSkinHex(hsvToRgb({ h: hsv.value.h, s: 100, v: 100 })))
const shownAlpha = computed(() => props.alphaEnabled ? props.alpha : 1)
const selectedCustom = computed(() => props.custom.includes(props.color))
const rounded = (value: number) => String(Math.round(value * 10) / 10)

function syncDrafts() {
  const rgb = parseSkinHex(props.color)!
  if (focusedGroup.value !== 'hex') drafts.hex = props.color
  if (focusedGroup.value !== 'rgb') drafts.rgb = [rgb.r, rgb.g, rgb.b].map(String)
  if (focusedGroup.value !== 'hsv') drafts.hsv = [hsv.value.h, hsv.value.s, hsv.value.v].map(rounded)
  if (focusedGroup.value !== 'alpha') drafts.alpha = rounded(shownAlpha.value * 100)
}
watch(() => props.color, color => {
  const rgb = parseSkinHex(color)
  if (!rgb) return
  // Preserve the selected hue at black/grey, and avoid snapping the SV marker to rounded RGB values.
  if (rgbToSkinHex(hsvToRgb(hsv.value)) !== color) {
    const next = rgbToHsv(rgb)
    hsv.value = { ...next, h: next.s === 0 ? hsv.value.h : next.h }
  }
  syncDrafts()
}, { immediate: true })
watch([() => props.alpha, () => props.alphaEnabled], syncDrafts)
const hexValid = computed(() => !!parseSkinHex(drafts.hex))
const rgbValid = computed(() => !!parseSkinChannels(drafts.rgb, [255, 255, 255], true))
const hsvValid = computed(() => !!parseSkinChannels(drafts.hsv, [360, 100, 100]))
const alphaValid = computed(() => !!parseSkinChannels([drafts.alpha], [100]))

function finishEditing() { focusedGroup.value = ''; syncDrafts() }
function choose(color: string) { focusedGroup.value = ''; emit('update:color', color) }
function editHex(event: Event) {
  drafts.hex = (event.target as HTMLInputElement).value
  const rgb = parseSkinHex(drafts.hex)
  if (rgb) emit('update:color', rgbToSkinHex(rgb))
}
function editChannels(group: 'rgb' | 'hsv', index: number, event: Event) {
  drafts[group][index] = (event.target as HTMLInputElement).value
  const values = parseSkinChannels(drafts[group], group === 'rgb' ? [255, 255, 255] : [360, 100, 100], group === 'rgb')
  if (!values) return
  if (group === 'rgb') emit('update:color', rgbToSkinHex({ r: values[0], g: values[1], b: values[2] }))
  else applyHsv({ h: values[0], s: values[1], v: values[2] })
}
function applyHsv(next: HsvColor) { hsv.value = next; emit('update:color', rgbToSkinHex(hsvToRgb(next))); syncDrafts() }
function hue(event: Event) { focusedGroup.value = ''; applyHsv({ ...hsv.value, h: Number((event.target as HTMLInputElement).value) }) }
function alpha(event: Event) {
  drafts.alpha = (event.target as HTMLInputElement).value
  const values = parseSkinChannels([drafts.alpha], [100])
  if (props.alphaEnabled && values) emit('update:alpha', values[0] / 100)
}
function alphaSlider(event: Event) { focusedGroup.value = ''; if (props.alphaEnabled) emit('update:alpha', Number((event.target as HTMLInputElement).value) / 100) }
function svAt(event: PointerEvent) {
  const area = event.currentTarget as HTMLElement, bounds = area.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return
  focusedGroup.value = ''
  applyHsv({ h: hsv.value.h, s: Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100)), v: Math.max(0, Math.min(100, 100 - (event.clientY - bounds.top) / bounds.height * 100)) })
}
function svStart(event: PointerEvent) { if (event.button !== 0) return; event.preventDefault(); (event.currentTarget as HTMLElement).focus(); (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); svAt(event) }
function svMove(event: PointerEvent) { if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) svAt(event) }
function svEnd(event: PointerEvent) { const area = event.currentTarget as HTMLElement; if (area.hasPointerCapture(event.pointerId)) area.releasePointerCapture(event.pointerId) }
function svKeys(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault(); const amount = event.shiftKey ? 10 : 1
  applyHsv({ ...hsv.value, s: Math.max(0, Math.min(100, hsv.value.s + (event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0))), v: Math.max(0, Math.min(100, hsv.value.v + (event.key === 'ArrowUp' ? amount : event.key === 'ArrowDown' ? -amount : 0))) })
}
function addCustom() { if (!selectedCustom.value && props.custom.length < 256) emit('update:custom', [...props.custom, props.color]) }
</script>

<template>
  <section class="skin-color-palette" aria-label="自由调色板">
    <div class="palette-title"><strong>颜色</strong></div>
    <div class="palette-picker-plane">
    <div class="palette-sv" :style="{ backgroundColor: hueColor }" tabindex="0" role="group" aria-label="饱和度与明度，方向键调整，Shift 加速" :aria-description="`饱和度 ${Math.round(hsv.s)}%，明度 ${Math.round(hsv.v)}%`" @pointerdown="svStart" @pointermove="svMove" @pointerup="svEnd" @pointercancel="svEnd" @keydown="svKeys">
      <span class="palette-sv-pointer" :style="{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }"></span>
    </div>
    <label class="palette-hue-label"><span class="sr-only">色相</span><input class="palette-hue" type="range" min="0" max="360" step="0.1" :value="hsv.h" aria-label="色相" @input="hue"></label>
    <div class="palette-current"><span>当前颜色</span><span class="palette-preview checker"><span :style="{ backgroundColor: color, opacity: shownAlpha }"></span></span><span class="palette-color-label">{{ color.toUpperCase() }}</span></div>
    </div>
    <div class="palette-group palette-recent"><div class="palette-custom-title"><span>最近使用</span><button type="button" class="palette-add" :disabled="selectedCustom || custom.length>=256" aria-label="加入当前颜色到自定义色板" @click="addCustom">＋</button></div><div class="palette-swatches"><button v-for="c in recent" :key="c" type="button" class="palette-swatch" :class="{selected: color===c}" :style="{backgroundColor:c}" :aria-label="`使用最近颜色 ${c}`" :title="c.toUpperCase()" @click="choose(c)"></button><span v-if="!recent.length" class="palette-help">绘制后记录最近使用的颜色。</span></div></div>
    <div class="palette-color-fields">
      <label class="palette-hex-field">HEX<input class="palette-hex" type="text" :value="drafts.hex" maxlength="7" spellcheck="false" :aria-invalid="!hexValid" aria-label="HEX 颜色" @focus="focusedGroup='hex'" @input="editHex" @blur="finishEditing" @keydown.enter="finishEditing"></label>
      <div class="palette-channel-row"><span>RGB</span><label v-for="(name, index) in ['R', 'G', 'B']" :key="name">{{ name }}<input type="text" inputmode="numeric" :value="drafts.rgb[index]" :aria-label="`RGB ${name}`" :aria-invalid="!rgbValid" @focus="focusedGroup='rgb'" @input="editChannels('rgb', index, $event)" @blur="finishEditing" @keydown.enter="finishEditing"></label></div>
      <div class="palette-channel-row"><span>HSV</span><label v-for="(name, index) in ['H', 'S', 'V']" :key="name">{{ name }}<input type="text" inputmode="decimal" :value="drafts.hsv[index]" :aria-label="`HSV ${name}`" :aria-invalid="!hsvValid" @focus="focusedGroup='hsv'" @input="editChannels('hsv', index, $event)" @blur="finishEditing" @keydown.enter="finishEditing"></label></div>
    </div>
    <div class="palette-alpha-row"><label>透明度 <input class="palette-alpha" type="range" min="0" max="100" step="1" :value="shownAlpha * 100" :disabled="!alphaEnabled" aria-label="画笔透明度" @input="alphaSlider"></label><label class="palette-alpha-number"><input type="text" inputmode="decimal" :value="drafts.alpha" :disabled="!alphaEnabled" :aria-invalid="!alphaValid" aria-label="画笔透明度百分比" @focus="focusedGroup='alpha'" @input="alpha" @blur="finishEditing" @keydown.enter="finishEditing">%</label></div>
    <p v-if="!alphaEnabled" class="palette-help">基础层保持 100% 不透明；切换外层可调整。</p>
    <p v-if="!hexValid || !rgbValid || !hsvValid || !alphaValid" class="palette-help palette-error" role="status">请输入完整且有效的颜色；画笔仍使用上一个有效值。</p>
    <div class="palette-group"><span>常用颜色</span><div class="palette-swatches"><button v-for="c in SKIN_COLOR_PRESETS" :key="c" type="button" class="palette-swatch" :class="{selected: color===c}" :style="{backgroundColor:c}" :aria-label="`选择颜色 ${c}`" :title="c.toUpperCase()" :aria-pressed="color===c" @click="choose(c)"></button></div></div>
    <div class="palette-group"><div class="palette-custom-title"><span>自定义色板</span><button type="button" class="palette-add" :disabled="selectedCustom || custom.length>=256" @click="addCustom">{{selectedCustom?'已加入色板':'+ 加入当前颜色'}}</button></div><div class="palette-swatches palette-custom-swatches"><span v-for="c in custom" :key="c" class="palette-custom-item"><button type="button" class="palette-swatch" :class="{selected: color===c}" :style="{backgroundColor:c}" :aria-label="`使用自定义颜色 ${c}`" :title="c.toUpperCase()" @click="choose(c)"></button><button type="button" class="palette-remove" :aria-label="`删除自定义颜色 ${c}`" :title="`删除 ${c.toUpperCase()}`" @click="emit('update:custom', custom.filter(v=>v!==c))">×</button></span><span v-if="!custom.length" class="palette-help">可保存你常用的颜色。</span></div></div>
  </section>
</template>

<style scoped>
.skin-color-palette{min-width:0;border:1px solid var(--border);border-radius:12px;padding:12px;background:var(--card-2);font-size:12px}.palette-title{display:flex;align-items:center;gap:8px;margin-bottom:10px}.palette-title strong{font-size:13px}.palette-color-label{margin-left:auto;color:var(--text-dim);font-family:monospace}.palette-preview{display:inline-flex;width:28px;height:22px;border-radius:5px;overflow:hidden;border:1px solid var(--border)}.palette-preview span{width:100%;height:100%}.checker{background-color:#fff;background-image:conic-gradient(#b8b8b8 25%,transparent 0 50%,#b8b8b8 0 75%,transparent 0);background-size:10px 10px}.palette-sv{height:110px;position:relative;cursor:crosshair;touch-action:none;border-radius:7px;background-image:linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,transparent);outline-offset:3px}.palette-sv-pointer{position:absolute;width:12px;height:12px;transform:translate(-50%,-50%);border:2px solid white;border-radius:50%;box-shadow:0 0 0 1px #333;pointer-events:none}.palette-hue-label{display:flex;align-items:center;gap:10px;margin:10px 0}.palette-hue{flex:1;min-width:0;height:10px;border-radius:8px;background:linear-gradient(to right,red,#ff0,#0f0,#0ff,#00f,#f0f,red);appearance:none;cursor:pointer}.palette-hue::-webkit-slider-thumb{appearance:none;width:13px;height:18px;background:white;border:1px solid #444;border-radius:4px}.palette-color-fields{display:grid;gap:7px}.palette-color-fields input,.palette-alpha-number input{width:100%;min-width:0;padding:5px 6px;border:1px solid var(--border);border-radius:5px;background:var(--card);color:var(--text);font:inherit;box-sizing:border-box}.palette-color-fields input[aria-invalid=true],.palette-alpha-number input[aria-invalid=true]{border-color:var(--error,#dd6370)}.palette-hex-field{display:flex;align-items:center;gap:10px}.palette-hex-field input{flex:1;font-family:monospace}.palette-channel-row{display:flex;align-items:center;gap:7px}.palette-channel-row>span{min-width:29px;color:var(--text-dim)}.palette-channel-row label{display:flex;flex:1;min-width:0;gap:4px;align-items:center}.palette-alpha-row{display:flex;align-items:center;gap:8px;margin-top:9px}.palette-alpha-row>label:first-child{display:flex;flex:1;gap:8px;align-items:center;white-space:nowrap}.palette-alpha-row input[type=range]{flex:1;min-width:30px;width:40px;accent-color:var(--accent);cursor:pointer}.palette-alpha-number{display:flex;align-items:center;gap:3px;width:58px}.palette-alpha-row input:disabled{opacity:.5;cursor:default}.palette-help{margin:6px 0 0;color:var(--text-dim);font-size:11px;line-height:1.5}.palette-error{color:var(--error,#dd6370)}.palette-group{margin-top:12px}.palette-group>span,.palette-custom-title>span{color:var(--text-dim)}.palette-swatches{display:flex;flex-wrap:wrap;gap:7px;margin-top:7px}.palette-swatch{width:22px;height:22px;border-radius:5px;border:1px solid #7c7c7c;cursor:pointer;position:relative;padding:0;box-sizing:border-box;flex-shrink:0}.palette-swatch.selected{outline:2px solid var(--accent);outline-offset:2px}.palette-custom-title{display:flex;align-items:center;justify-content:space-between;gap:8px}.palette-add{font:inherit;border:0;background:none;color:var(--accent);cursor:pointer;padding:1px 0}.palette-add:disabled{opacity:.55;cursor:default}.palette-custom-swatches{max-height:124px;overflow:auto;padding:4px 2px}.palette-custom-item{display:inline-flex;position:relative}.palette-remove{position:absolute;right:-5px;top:-6px;width:13px;height:13px;border-radius:50%;padding:0;border:1px solid var(--border);color:var(--text);background:var(--card);font-size:11px;line-height:10px;cursor:pointer;opacity:0}.palette-custom-item:hover .palette-remove,.palette-custom-item:focus-within .palette-remove{opacity:1}
</style>
<style scoped>.palette-hue{max-width:none}</style>
<style scoped>
.skin-color-palette{padding:16px;border-radius:16px}.palette-title{margin-bottom:12px}.palette-title strong{font-size:14px}.palette-picker-plane{display:grid;grid-template-columns:minmax(0,1fr) 22px 76px;gap:12px;align-items:center}.palette-sv{height:144px;border-radius:10px}.palette-hue-label{position:relative;height:144px;margin:0;display:block}.palette-hue{position:absolute;left:50%;top:50%;width:144px;height:16px;margin:0;transform:translate(-50%,-50%) rotate(90deg);background:linear-gradient(to right,red,#ff0,#0f0,#0ff,#00f,#f0f,red);border:0}.palette-hue::-webkit-slider-thumb{width:12px;height:22px;border-radius:6px;box-shadow:0 0 0 1px #222}.palette-current{display:flex;flex-direction:column;align-items:center;gap:10px;min-width:0;font-size:11px;color:var(--text-dim)}.palette-current .palette-preview{width:48px;height:48px;border-radius:9px}.palette-color-label{margin-left:0;font-size:11px}.palette-recent{margin:14px 0}.palette-recent .palette-add{border:1px solid var(--border);border-radius:6px;min-width:22px;height:22px;font-size:19px;line-height:18px}.palette-swatch{width:24px;height:24px;border-radius:6px}.palette-color-fields{gap:10px}.palette-color-fields input,.palette-alpha-number input{padding:8px 10px;border-radius:9px}.palette-channel-row{gap:10px}.palette-alpha-row{margin-top:14px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
@media(max-width:520px){.skin-color-palette{padding:12px}.palette-picker-plane{grid-template-columns:minmax(0,1fr) 18px 66px;gap:8px}.palette-channel-row{gap:6px}.palette-color-fields input{padding:7px}.palette-swatch{width:22px;height:22px}}
</style>
