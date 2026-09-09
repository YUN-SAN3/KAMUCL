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

test('chunked download engine removed: single-connection + .part resume is the only path (多线程分块全网络异常频发，移除)', () => {
  const dl = read('src/main/core/download.ts')
  assert.ok(!dl.includes('doDownloadChunked'), '分块引擎必须移除')
  assert.ok(!dl.includes('buildChunkPlan'), '分块计划必须移除')
  assert.ok(!dl.includes('chunkStallWatchdog'), '分块看门狗必须移除')
  // startTransfer 永远单连接
  assert.match(dl, /async function startTransfer\([\s\S]*?return doDownload\(url, dest, onProgress, extSignal, expectedSize, expectedSize == null\)/)
  // 断点续传保留（.part）
  assert.match(dl, /\.part/)
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
