import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('options-sync: formal log scope + correct option field names (修复1)', () => {
  const kb = read('src/main/core/keybindings.ts')
  // 正式日志通道（取证埋点转正式）
  assert.match(kb, /logScope\('options-sync'\)/)
  // MC 真实字段名（1.0.7 实证）：enableVsync/maxFps/toggleCrouch/toggleSprint
  assert.match(kb, /enableVsync/)
  assert.match(kb, /maxFps/)
  assert.match(kb, /toggleCrouch/)
  assert.match(kb, /toggleSprint/)
  // fov 全版本 0-1 浮点写入 + 版本号保留
  assert.match(kb, /adaptOptionsForVersion/)
  // 回归脚本入库且可独立运行
  const script = read('scripts/verify-options-sync.cjs')
  assert.match(script, /options\.txt/)
  assert.match(script, /fov/)
})

test('game view: per-version launch button before delete (新增2)', () => {
  const gv = read('src/renderer/src/views/GameView.vue')
  assert.match(gv, /async function launchVersion\(v: InstalledVersion\)/)
  // 启动按钮（btn-gold）在同列表项的删除按钮（btn-danger）之前出现
  const launchBtnIdx = gv.indexOf('installed-launch')
  const removeBtnIdx = gv.indexOf('installed-remove', launchBtnIdx)
  assert.ok(launchBtnIdx > 0 && removeBtnIdx > launchBtnIdx)
  assert.match(gv, /@click="launchVersion\(v\)"/)
})

test('skin viewer: cape preview with 64x32 layout regions + swing animation (新增3)', () => {
  const viewer = read('src/renderer/src/components/SkinViewer3D.vue')
  assert.match(viewer, /function capeRegions\(\)/)
  assert.match(viewer, /function buildCape\(\)/)
  assert.match(viewer, /function rebuildCape\(\)/)
  assert.match(viewer, /function reloadCape\(\)/)
  // 披风随走路摆动
  assert.match(viewer, /capeGroup\.rotation\.x/)
  // cape prop 监听
  assert.match(viewer, /watch\(\(\) => props\.cape/)
  // 内外面映射（实证）：材质顺序 [+x,-x,+y,-y,+z,-z]，主图案 [1,1] 必须在 -z（外面，背后可见），内面 [12,1] 在 +z
  const regions = viewer.match(/function capeRegions\(\) \{[\s\S]*?\] as const/)![0]
  const zFaces = regions.match(/\[1?2?, 1, 10, 16\]/g)!
  assert.deepEqual(zFaces, ['[12, 1, 10, 16]', '[1, 1, 10, 16]'])
  const skins = read('src/renderer/src/views/SkinsView.vue')
  assert.match(skins, /const activeCapeDataUrl = computed/)
  assert.match(skins, /:cape="activeCapeDataUrl"/)
})

test('friend connect: mode overlay closable via mask click, X button and ESC (修复4)', () => {
  const fc = read('src/renderer/src/components/FriendConnect.vue')
  assert.match(fc, /class="mode-overlay"[^>]*@click\.self="pick\('direct'\)"/)
  assert.match(fc, /class="mode-close"/)
  assert.match(fc, /function onModeKeydown\(e: KeyboardEvent\)/)
  assert.match(fc, /addEventListener\('keydown', onModeKeydown\)/)
  assert.match(fc, /removeEventListener\('keydown', onModeKeydown\)/)
})

test('launch: game process detached from launcher + running state restore (修复5)', () => {
  const launch = read('src/main/core/launch.ts')
  assert.match(launch, /detached: true/)
  assert.match(launch, /proc\.unref\(\)/)
  assert.match(launch, /function persistRunningGame/)
  assert.match(launch, /export function restoreRunningGame/)
  assert.match(launch, /running-game\.json/)
  // 存活探测
  assert.match(launch, /process\.kill\(record\.pid, 0\)/)
  const index = read('src/main/index.ts')
  assert.match(index, /restoreRunningGame/)
  assert.match(index, /did-finish-load/)
  const app = read('src/renderer/src/App.vue')
  // 关闭提示：游戏在跑时点关闭先 toast 再关
  assert.match(app, /closeHintShown/)
  assert.match(app, /关闭启动器不影响游戏/)
})

test('switch animation slowed to 0.4s ease-in-out globally (修复6)', () => {
  const css = read('src/renderer/src/styles.css')
  const block = css.match(/\.switch-ui \{[\s\S]*?\}/)![0]
  assert.match(block, /transition: background 0\.4s ease-in-out, border-color 0\.4s ease-in-out/)
  const knob = css.match(/\.switch-ui::before \{[\s\S]*?\}/)![0]
  assert.match(knob, /transition: left 0\.4s ease-in-out, background 0\.4s ease-in-out/)
})

test('buttons modernized: hover lift + press feedback + focus ring on all tiers (设计7)', () => {
  const css = read('src/renderer/src/styles.css')
  // 基础悬浮微浮起 + 按压 0.97
  assert.match(css, /\.btn:hover:not\(:disabled\) \{\s*transform: translateY\(-1px\)/)
  assert.match(css, /\.btn:active:not\(:disabled\) \{\s*transform: scale\(0\.97\)/)
  // 焦点环可访问性
  assert.match(css, /\.btn:focus-visible/)
  assert.match(css, /\.btn-gold:focus-visible/)
  assert.match(css, /\.btn-ghost:focus-visible/)
  assert.match(css, /\.btn-danger:focus-visible/)
  assert.match(css, /\.icon-btn:focus-visible/)
  // 主按钮悬浮阴影加深；次按钮悬浮阴影；图标按钮微浮起
  assert.match(css, /\.btn-gold:hover:not\(:disabled\) \{[^}]*box-shadow: 0 6px 22px/)
  assert.match(css, /\.btn-ghost:hover:not\(:disabled\) \{[^}]*box-shadow/)
  assert.match(css, /\.icon-btn:hover:not\(:disabled\) \{[^}]*translateY\(-1px\)/)
})

test('modified SFCs compile', () => {
  for (const file of [
    'src/renderer/src/App.vue',
    'src/renderer/src/views/GameView.vue',
    'src/renderer/src/views/SkinsView.vue',
    'src/renderer/src/components/FriendConnect.vue',
    'src/renderer/src/components/SkinViewer3D.vue',
  ]) {
    const source = read(file)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    const result = compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [], file)
  }
})
