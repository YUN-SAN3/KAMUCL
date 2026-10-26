<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ modelValue: number; disabled?: boolean }>(), { disabled: false })
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
const percentage = computed(() => Math.max(0, Math.min(100, Number.isFinite(props.modelValue) ? props.modelValue : 0)))
function update(event: Event) { if (!props.disabled) emit('update:modelValue', Number((event.target as HTMLInputElement).value)) }
</script>

<template>
  <input class="percent-slider" type="range" min="0" max="100" step="1" :value="percentage" :disabled="disabled" :style="{ '--range-fill': percentage + '%' }" :aria-valuetext="percentage + '%'" @input="update">
</template>

<style scoped>
/* The track spans the input's complete width, including the two endpoint positions. */
.percent-slider.percent-slider[type=range]{appearance:none;box-sizing:border-box;display:block;flex:1;width:100%;min-width:30px;height:6px;margin:9px 0;padding:0;border:0;border-radius:999px;background:linear-gradient(to right,var(--accent) 0 var(--range-fill),var(--border) var(--range-fill) 100%);cursor:pointer}
.percent-slider::-webkit-slider-runnable-track{height:6px;border-radius:999px;background:transparent}
.percent-slider::-webkit-slider-thumb{appearance:none;width:16px;height:16px;margin-top:-5px;border:2px solid var(--on-accent,#fff);border-radius:50%;background:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.percent-slider:focus-visible{outline:2px solid var(--accent);outline-offset:5px}
.percent-slider:disabled{opacity:.5;cursor:default}
</style>
