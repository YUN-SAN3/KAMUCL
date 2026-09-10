import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('nav sub-list: animated expand (grid 0fr→1fr + staggered fade), not instant v-show (指令1)', () => {
  const app = read('src/renderer/src/App.vue')
  // 不再用 v-show 直出
  assert.ok(!app.includes('v-show="resourceExpanded'), '子列表不得再 v-show 直出')
  // grid 高度过渡 + 错落渐入
  assert.match(app, /grid-template-rows: 0fr/)
  assert.match(app, /\.nav-sub\.open \{[\s\S]*?grid-template-rows: 1fr/)
  assert.match(app, /transition-delay: calc\(var\(--sub-i\) \* 28ms/)
  // 水滴在展开动画后二次校准
  assert.match(app, /blobRecalcTimer = setTimeout\(updateNavBlob, 420\)/)
})

test('game tabs: sliding blob indicator with spring motion (指令3)', () => {
  const gv = read('src/renderer/src/views/GameView.vue')
  assert.match(gv, /class="game-tabs-blob" :style="tabBlobStyle"/)
  assert.match(gv, /\.game-tabs-blob \{[\s\S]*?transition: left 0\.32s cubic-bezier/)
  assert.match(gv, /data-tab="download"/)
  assert.match(gv, /updateTabBlob/)
  // 激活 Tab 不再直接换背景（背景由滑动块承担）
  const tabCss = gv.match(/\.game-tab\.active \{[\s\S]*?\}/)![0]
  assert.ok(!tabCss.includes('background'), 'active tab 不得直接换背景')
})

test('skin walk amplitude matches MC vanilla formula: cos × amp, ±45°, contra-lateral (指令4)', () => {
  const v = read('src/renderer/src/components/SkinViewer3D.vue')
  assert.match(v, /Math\.cos\(animT \* WALK_RATE\) \* j\.mainAmp/)
  assert.match(v, /mainAmp: 45/)
  assert.match(v, /const WALK_RATE = 4\.71/)
  // 四肢同幅（MC：手臂与腿幅度一致）
  const amps = [...v.matchAll(/(armL|armR|legL|legR): .*?dir: (-?1).*?mainAmp: (\d+)/g)]
  assert.equal(amps.length, 4)
  for (const a of amps) assert.equal(a[3], '45')
  // 对角反相：legL/armR 同向（dir=1/-1 组合 = MC 的 leftLeg 与 rightArm 同相）
  assert.equal(amps.find((x) => x[1] === 'legL')[2], '1')
  assert.equal(amps.find((x) => x[1] === 'armR')[2], '1')
  assert.equal(amps.find((x) => x[1] === 'legR')[2], '-1')
  assert.equal(amps.find((x) => x[1] === 'armL')[2], '-1')
})

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
  assert.match(home, /instance-card:nth-child\(2\) \{ animation-delay: 45ms/)
  // 区块标题主题色锚点
  assert.match(home, /\.instances-head h2::before/)
  // 皮肤卡加高（角色更具存在感）
  assert.match(home, /\.skin-panel \{ min-height: 400px/)
  // 创作者卡主题色描边
  assert.match(home, /\.home-creator \{ margin-top: auto; border-color: color-mix/)
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
