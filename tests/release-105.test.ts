import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { adaptOptionsForVersion, keySyncSupportedForVersion, mcVersionAtLeast } from '../src/main/core/keybindings'
import { VANILLA_OPTIONS } from '../src/shared/keybindings'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('options version adaptation: FOV float for <1.16.2, integer degrees for newer, viewDistance rename for >=1.18', () => {
  // 1.12.2：FOV 70° 必须写为浮点 0.5（(70-30)/80），否则投影异常视角颠倒
  const legacy = adaptOptionsForVersion({ fov: '70', renderDistance: '12', sneakToggled: 'false', sprintToggled: 'true', gamma: '0.5' }, '1.12.2')
  assert.equal(legacy.fov, '0.5', 'FOV 70° must become 0.5 float for 1.12.2')
  assert.equal(legacy.renderDistance, '12', 'renderDistance kept for 1.12.2')
  assert.equal(legacy.sneakToggled, undefined, 'sneakToggled skipped for 1.12.2 (no such field)')
  assert.equal(legacy.sprintToggled, undefined, 'sprintToggled skipped for 1.12.2')
  assert.equal(legacy.gamma, '0.5', 'gamma unchanged')
  // 1.16.1 仍浮点；1.16.2 起整数度数
  assert.equal(adaptOptionsForVersion({ fov: '90' }, '1.16.1').fov, '0.75')
  assert.equal(adaptOptionsForVersion({ fov: '90' }, '1.16.2').fov, '90')
  // 1.18+：renderDistance → viewDistance（26.2 未生效的根因修复）
  const modern = adaptOptionsForVersion({ renderDistance: '16', fov: '80' }, '26.2')
  assert.equal(modern.viewDistance, '16')
  assert.equal(modern.renderDistance, undefined)
  assert.equal(modern.fov, '80')
  // 1.17.1 仍 renderDistance
  assert.equal(adaptOptionsForVersion({ renderDistance: '16' }, '1.17.1').renderDistance, '16')
})

test('version comparison: 26.x new scheme is newer than all 1.x; unknown treated as latest', () => {
  assert(mcVersionAtLeast('26.2', '1.18'))
  assert(!mcVersionAtLeast('1.12.2', '1.13'))
  assert(mcVersionAtLeast('', '1.18'))
  // 键位同步仅支持 1.13+（旧版数字 keycode 格式不兼容）
  assert(keySyncSupportedForVersion('1.13'))
  assert(!keySyncSupportedForVersion('1.12.2'))
  assert(keySyncSupportedForVersion('26.2'))
})

test('chunked download stall watchdog falls back to single connection instead of hanging', () => {
  const dl = read('src/main/core/download.ts')
  assert.match(dl, /CHUNK_STALL_MS = 45_000/)
  assert.match(dl, /stallWatchdog = setInterval/)
  assert.match(dl, /lastBytesAt = Date\.now\(\)/)
  assert.match(dl, /stalledByWatchdog/)
  assert.match(dl, /分块无进展回退单连接/)
  assert.match(dl, /clearInterval\(stallWatchdog\)/)
})

test('home recent games: selection no longer pins to top; launch recency drives order; renamed', () => {
  const home = read('src/renderer/src/views/HomeView.vue')
  assert.match(home, /最近游戏/)
  // recent 不再把 selected 提前
  const recent = home.slice(home.indexOf('const recent = computed'), home.indexOf('const sortedInstalled'))
  assert(!recent.includes('selected'), 'recent must not reference selected for pinning')
  assert.match(recent, /sortWithFavorite\(store\.installed\)\.slice\(0, 4\)/)
})

test('resource packs: drag-drop import replaces text input; multi-pack load; sync copies files', () => {
  const kb = read('src/main/core/keybindings.ts')
  assert.match(kb, /importDefaultResourcePacks/)
  assert.match(kb, /removeDefaultResourcePack/)
  assert.match(kb, /default-resourcepacks/)
  assert.match(kb, /resourcepacks/)
  const view = read('src/renderer/src/views/KeysView.vue')
  assert.match(view, /cfg-pack-zone/)
  assert.match(view, /onPackDrop/)
  assert.match(view, /dataTransfer/)
})

test('default config right column: MC-identical value display, slider live preview, click-to-edit, sneak/sprint toggle, autoJump', () => {
  const ids = new Set(VANILLA_OPTIONS.map((d) => d.id))
  assert(ids.has('autoJump'), 'autoJump added')
  const view = read('src/renderer/src/views/KeysView.vue')
  // 亮度/灵敏度按 MC 百分比显示
  assert.match(view, /Math\.round\(Number\(raw\) \* 100\)/)
  assert.match(view, /Math\.round\(Number\(raw\) \* 200\)/)
  // 拖动实时显示 + 点击精确输入
  assert.match(view, /sliderPreview/)
  assert.match(view, /onSliderInput/)
  assert.match(view, /startOptionEdit/)
  assert.match(view, /commitOptionEdit/)
  // 潜行/疾跑与 MC 原版一致的按住/切换按钮
  assert.match(view, /toggleSneakSprint/)
  assert.match(view, /sneakSprintLabel/)
  assert(view.includes("'潜行'") && view.includes("'疾跑'"), 'sneak/sprint labels')
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
