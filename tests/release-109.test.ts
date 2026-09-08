import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('key sync: launch wiring + version gate intact (修复1 后续：1.0.12 移除其他配置，仅留键位)', () => {
  const kb = read('src/main/core/keybindings.ts')
  assert.match(kb, /export function syncKeysToGameDir/)
  assert.match(kb, /export function keySyncSupportedForVersion/)
  const launch = read('src/main/core/launch.ts')
  assert.match(launch, /if \(settings\.keySync\)/)
  assert.match(launch, /keySyncSupportedForVersion\(instanceMcVersion\)/)
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

test('skin viewer: cape preview via HMCL-style flip, narrowed torso width, cape prop watch (新增3；1.0.16 物晖重写版+收窄防穿模)', () => {
  const viewer = read('src/renderer/src/components/SkinViewer3D.vue')
  assert.match(viewer, /function attachCapeMesh/)
  // 披风收窄至躯干同宽 8（根治正面/侧前方穿模），180° 翻转朝后挂背部
  assert.match(viewer, /BoxGeometry\(8, 16, 1\)/)
  assert.match(viewer, /rotation\.y = Math\.PI/)
  assert.match(viewer, /joint\.position\.set\(0, 24, -2\.7\)/)
  // cape prop 监听重载
  assert.match(viewer, /watch\(\s*\(\) => props\.cape/)
  const skins = read('src/renderer/src/views/SkinsView.vue')
  assert.match(skins, /const activeCape = computed/)
  assert.match(skins, /:cape="activeCape"/)
})

test('launch: game process survives launcher exit via CreateProcessW detach + running state restore (修复5；1.0.16 起用物晖 gracefulClose 实现)', () => {
  const launch = read('src/main/core/launch.ts')
  assert.match(launch, /spawnGameProcess\(javaPath, args/)
  const gc = read('src/main/core/gracefulClose.ts')
  assert.match(gc, /export async function spawnGameProcess/)
  // 运行状态持久化与恢复保留
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
