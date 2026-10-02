import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { keySyncSupportedForVersion, mcVersionAtLeast } from '../src/main/core/keybindings'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('version comparison: 26.x new scheme is newer than all 1.x; unknown treated as latest', () => {
  assert(mcVersionAtLeast('26.2', '1.18'))
  assert(!mcVersionAtLeast('1.12.2', '1.13'))
  assert(mcVersionAtLeast('', '1.18'))
  // 键位同步仅支持 1.13+（旧版数字 keycode 格式不兼容）
  assert(keySyncSupportedForVersion('1.13'))
  assert(!keySyncSupportedForVersion('1.12.2'))
  assert(keySyncSupportedForVersion('26.2'))
})

// Replaced implementation: behavior is exercised by skin3d-parity, download-policy,
// download-stall, import-download-1049 and modpack-speed-1050 runtime tests.


test('home recent games: selection no longer pins to top; launch recency drives order; renamed', () => {
  const home = read('src/renderer/src/views/HomeView.vue')
  assert.match(home, /最近游戏/)
  // recent 不再把 selected 提前
  const recent = home.slice(home.indexOf('const recent = computed'), home.indexOf('const sortedInstalled'))
  assert(!recent.includes('selected'), 'recent must not reference selected for pinning')
  assert.match(recent, /sortWithFavorite\(activeInstalled\.value\)\.slice\(0, wideRecent\.value \? 8 : 4\)/)
})

test('personalization edit panel: opaque background, clear boundary, avoids top tip bar', () => {
  const panel = read('src/renderer/src/components/EditPanel.vue')
  // 接近不透明（--bg 在所有主题下不透明）
  assert.match(panel, /background:var\(--card-solid\)/)
  // 明确边界
  assert.match(panel, /border-left:1px solid var\(--border\)/)
  // 避开顶部提示栏（提示栏 top:14px + 高约40px + ≥12px 间距）
  assert.match(panel, /grid-template-rows:66px minmax\(0,1fr\)/)
})

test('new/changed Vue components compile', () => {
  for (const file of ['src/renderer/src/views/KeysView.vue', 'src/renderer/src/components/EditPanel.vue', 'src/renderer/src/views/HomeView.vue', 'src/renderer/src/App.vue']) {
    const source = read(file)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    const result = compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [], file)
  }
})
