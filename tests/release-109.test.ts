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

// Replaced implementation: behavior is exercised by skin3d-parity, download-policy,
// download-stall, import-download-1049 and modpack-speed-1050 runtime tests.


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
  const ipc = read('src/main/ipc.ts')
  assert.match(ipc, /boot:renderer-ready/)
  assert.match(ipc, /restoreRunningGame/)
  const app = read('src/renderer/src/App.vue')
  // 关闭提示：游戏在跑时点关闭先 toast 再关
  assert.match(app, /closeHintShown/)
  assert.match(app, /关闭启动器不影响游戏/)
})

test('switch keeps checked and keyboard focus feedback', () => {
  const css = read('src/renderer/src/styles.css')
  assert.match(css, /\.switch input:checked \+ \.switch-ui/)
  assert.match(css, /\.switch input:focus-visible \+ \.switch-ui/)
})

test('buttons keep focus rings on every tier', () => {
  const css = read('src/renderer/src/styles.css')
  // 焦点环可访问性
  assert.match(css, /\.btn:focus-visible/)
  assert.match(css, /\.btn-gold:focus-visible/)
  assert.match(css, /\.btn-ghost:focus-visible/)
  assert.match(css, /\.btn-danger:focus-visible/)
  assert.match(css, /\.icon-btn:focus-visible/)
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
