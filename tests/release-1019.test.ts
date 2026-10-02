import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('nav sub-list: animated expansion excludes hidden controls from focus', () => {
  const app = read('src/renderer/src/App.vue')
  // 不再用 v-show 直出
  assert.ok(!app.includes('v-show="resourceExpanded'), '子列表不得再 v-show 直出')
  // grid 高度过渡 + 错落渐入
  assert.match(app, /grid-template-rows: 0fr/)
  assert.match(app, /\.nav-sub\.open \{[\s\S]*?grid-template-rows: 1fr/)
  assert.match(app, /:inert="!\(resourceExpanded \|\| inResourceGroup\)"/)
})

test('game tabs: indicator follows the selected tab', () => {
  const gv = read('src/renderer/src/views/GameView.vue')
  assert.match(gv, /class="game-tabs-blob" :style="tabBlobStyle"/)
  assert.match(gv, /data-tab="download"/)
  assert.match(gv, /updateTabBlob/)
  // 激活 Tab 不再直接换背景（背景由滑动块承担）
  const tabCss = gv.match(/\.game-tab\.active \{[\s\S]*?\}/)![0]
  assert.ok(!tabCss.includes('background'), 'active tab 不得直接换背景')
})

// Replaced implementation: behavior is exercised by skin3d-parity, download-policy,
// download-stall, import-download-1049 and modpack-speed-1050 runtime tests.


test('seg controls get sliding blob too (指令5 相邻按钮切换过渡)', () => {
  const skins = read('src/renderer/src/views/SkinsView.vue')
  assert.match(skins, /class="seg-blob" :style="animSegBlobStyle"/)
  assert.match(skins, /\.seg-blob \{[\s\S]*?transition: left 0\.3s cubic-bezier/)
})

test('home redesign: presence + rhythm (指令2)', () => {
  const home = read('src/renderer/src/views/HomeView.vue')
  // 启动组合按钮更醒目（76px + 悬浮微浮起 + 更深投影）
  assert.match(home, /\.launch-combo \{[\s\S]*?height: 76px/)
  assert.match(home, /\.launch-combo:hover \{ transform: translateY\(-2px\)/)
  // 卡片入场错落渐入
  assert.match(home, /@keyframes card-in/)
  // 区块标题主题色锚点
  assert.match(home, /\.instances-head h2::before/)
  // 皮肤卡加高（角色更具存在感）
  assert.match(home, /\.skin-panel \{ min-height: 400px/)
  // 创作者卡主题色描边
  assert.match(home, /\.home-creator \{ margin-top: 0; border-color: color-mix/)
})

test('1.0.19 changed SFCs compile', () => {
  for (const file of [
    'src/renderer/src/App.vue',
    'src/renderer/src/views/HomeView.vue',
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
