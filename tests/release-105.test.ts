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

test('chunked download stall watchdog only aborts when transfers are active (排队块不再被误杀)', () => {
  const dl = read('src/main/core/download.ts')
  // 1.0.9 修正：看门狗只在「有块处于传输中」且全组无字节进展时中止分块；
  // 旧实现把排队等待全局并发名额的块也计入停滞，导致健康分块组被整组取消、回退单连接。
  assert.match(dl, /chunkStallWatchdog = \{ stallMs: 45_000/)
  assert.match(dl, /onTransferBegin\?: \(\) => void/)
  assert.match(dl, /onTransferEnd\?: \(\) => void/)
  assert.match(dl, /activeTransfers\+\+/)
  assert.match(dl, /if \(activeTransfers > 0 && Date\.now\(\) - lastBytesAt >= chunkStallWatchdog\.stallMs\)/)
  assert.match(dl, /无进展，回退单连接/)
})

test('home recent games: selection no longer pins to top; launch recency drives order; renamed', () => {
  const home = read('src/renderer/src/views/HomeView.vue')
  assert.match(home, /最近游戏/)
  // recent 不再把 selected 提前
  const recent = home.slice(home.indexOf('const recent = computed'), home.indexOf('const sortedInstalled'))
  assert(!recent.includes('selected'), 'recent must not reference selected for pinning')
  assert.match(recent, /sortWithFavorite\(store\.installed\)\.slice\(0, 4\)/)
})

test('personalization edit panel: opaque background, clear boundary, avoids top tip bar', () => {
  const panel = read('src/renderer/src/components/EditPanel.vue')
  // 接近不透明（--bg 在所有主题下不透明）
  assert.match(panel, /background: var\(--bg\)/)
  // 明确边界
  assert.match(panel, /border-left: 1px solid var\(--border-strong\)/)
  // 避开顶部提示栏（提示栏 top:14px + 高约40px + ≥12px 间距）
  assert.match(panel, /top: 72px/)
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
