import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('memory slider: preview/effective separation — drag never writes settings, commit once on release (重修指令)', () => {
  const sv = read('src/renderer/src/views/SettingsView.vue')
  // 预览值与生效值两个独立状态
  assert.match(sv, /const memPreview = ref<number \| null>\(null\)/)
  // 拖动中只更新预览值，不写 store.settings.memoryMB
  const move = sv.slice(sv.indexOf('function onMemPointerMove'), sv.indexOf('function onMemPointerUp'))
  assert.doesNotMatch(move, /store\.settings\.memoryMB\s*=/, '拖动中禁止写生效值')
  assert.match(move, /memPreview\.value = memRawFromClientX/)
  // 松手一次性提交：取整+钳制+保存+清预览
  const up = sv.slice(sv.indexOf('function onMemPointerUp'), sv.indexOf('/** 数值输入'))
  assert.match(up, /memPreview\.value = null/)
  assert.match(up, /Math\.round\(raw \/ MEM_STEP\) \* MEM_STEP/)
  assert.match(up, /save\(\{ memoryMB: v \}\)/)
  // 填充跟随预览值（无级）
  assert.match(sv, /memPreview\.value \?\? store\.settings\?\.memoryMB/)
  // 既有路径不受影响：打字输入/自动开关/刷新仍在
  assert.match(sv, /commitMemoryEdit/)
  assert.match(sv, /onMemoryAutoChange/)
  assert.match(sv, /refreshSystemInfo/)
})

test('community download modal: file list redesigned as breathing card rows (指令1)', () => {
  const cv = read('src/renderer/src/views/CommunityView.vue')
  // 主行文件名 + 副行兼容信息 + 右侧标签/日期体积
  assert.match(cv, /class="file-main"/)
  assert.match(cv, /class="file-sub"/)
  assert.match(cv, /class="file-side"/)
  // 卡片化：圆角+边框+悬浮+宽松 padding
  const row = cv.match(/\.file-row \{[\s\S]*?\}/)![0]
  assert.match(row, /padding: var\(--space-3\) var\(--space-4\)/)
  assert.match(row, /border-radius: var\(--radius-md\)/)
  assert.match(cv, /\.file-row:hover \{[\s\S]*?translateY\(-1px\)/)
})

test('friend connect: sub-page transition on method switch (指令2)', () => {
  const fc = read('src/renderer/src/views/FriendConnectView.vue')
  assert.match(fc, /<Transition name="method-slide" mode="out-in" :duration="280">/)
  assert.match(fc, /\.method-slide-enter-from \{ opacity: 0; transform: translateX\(22px\)/)
  assert.match(fc, /prefers-reduced-motion/)
})

test('home runtime strip: hover blob follows pointer between cells + cell lifts (指令3)', () => {
  const home = read('src/renderer/src/views/HomeView.vue')
  assert.match(home, /class="runtime-blob"/)
  assert.match(home, /@mouseenter="runtimeHover = 0"/)
  assert.match(home, /@mouseleave="runtimeHover = -1"/)
  assert.match(home, /\.runtime-blob\.on \{/)
  assert.match(home, /\.runtime-item:hover \{ transform: translateY\(-2px\)/)
})

test('1.0.21 changed SFCs compile', () => {
  for (const file of [
    'src/renderer/src/views/SettingsView.vue',
    'src/renderer/src/views/CommunityView.vue',
    'src/renderer/src/views/FriendConnectView.vue',
    'src/renderer/src/views/HomeView.vue',
  ]) {
    const source = read(file)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    const result = compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [], file)
  }
})
