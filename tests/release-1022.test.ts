import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('memory slider: scale baseline frozen during drag + fixed-width value (1.0.22 比例尺锁定)', () => {
  const sv = read('src/renderer/src/views/SettingsView.vue')
  // 拖动开始快照刻度基准
  assert.match(sv, /const memBaseline = ref<\{ max: number; span: number \} \| null>\(null\)/)
  const down = sv.slice(sv.indexOf('function onMemThumbDown'), sv.indexOf('function onMemPointerMove'))
  assert.match(down, /memBaseline\.value = \{ max, span:/)
  // 拖动中比例映射用冻结快照（不用实时 memMax）
  assert.match(sv, /const memScaleMax = computed\(\(\) => memBaseline\.value\?\.max \?\? memMax\.value\)/)
  assert.match(sv, /const memScaleSpan = computed\(\(\) => memBaseline\.value\?\.span/)
  const move = sv.slice(sv.indexOf('function onMemPointerMove'), sv.indexOf('function onMemPointerUp'))
  assert.doesNotMatch(move, /memMax\.value/, '拖动中不得引用实时上限')
  const rawFn = sv.slice(sv.indexOf('function memRawFromClientX'), sv.indexOf('function onMemThumbDown'))
  assert.match(rawFn, /memScaleSpan\.value/, '指针→MB 映射必须用冻结跨度')
  // 松手：清快照与预览 + 一次性生效 + 重算校准
  const up = sv.slice(sv.indexOf('function onMemPointerUp'), sv.indexOf('/** 数值输入'))
  assert.match(up, /memBaseline\.value = null/)
  assert.match(up, /memPreview\.value = null/)
  assert.match(up, /refreshSystemInfo\(\)/)
  // 右侧数值固定宽度（位数变化不挤压轨道）
  const valCss = sv.match(/\.memory-value \{[\s\S]*?\}/)![0]
  assert.match(valCss, /width: 172px/)
  assert.match(valCss, /flex: none/)
  assert.match(valCss, /tabular-nums/)
  // 既有路径不受影响
  assert.match(sv, /onMemoryAutoChange/)
  assert.match(sv, /commitMemoryEdit/)
})

test('SettingsView compiles after slider baseline freeze', () => {
  const source = read('src/renderer/src/views/SettingsView.vue')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'SettingsView.vue' })
  const result = compileTemplate({ source: descriptor.template!.content, filename: 'SettingsView.vue', id: 'SettingsView.vue', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(result.errors, [])
})
