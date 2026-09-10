import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('skin preview: pause button removed, walk/idle tabs and reset kept (指令1)', () => {
  const skins = read('src/renderer/src/views/SkinsView.vue')
  assert.ok(!skins.includes('previewPaused'), 'previewPaused 引用必须移除')
  assert.ok(!skins.includes('暂停动画'), '暂停按钮必须移除')
  assert.match(skins, /previewAnim/)
  assert.match(skins, /resetView/)
})

test('home: launch combo back in banner, LaunchFab gone (指令2+3)', () => {
  const home = read('src/renderer/src/views/HomeView.vue')
  // 启动组合按钮在横幅内
  const hero = home.slice(home.indexOf('hero-card'), home.indexOf('runtime-strip'))
  assert.match(hero, /class="launch-combo" data-edit="accent"/)
  assert.match(hero, /class="launch-main"/)
  assert.match(hero, /class="launch-arrow"/)
  assert.ok(!home.includes('LaunchFab'), 'LaunchFab 引用必须移除')
  assert.ok(!fs.existsSync('src/renderer/src/components/LaunchFab.vue'), 'LaunchFab.vue 必须删除')
  // 右列分栏：账户卡与皮肤预览卡都在 home-side
  assert.match(home, /class="home-side"/)
  const side = home.slice(home.indexOf('home-side'))
  assert.match(side, /class="account-panel"/)
  assert.match(side, /class="skin-panel"/)
})

test('connection: method cards are the three platforms (direct removed as redundant in 1.0.25)', () => {
  const view = read('src/renderer/src/views/FriendConnectView.vue')
  assert.ok(!view.includes("key: 'direct'"))
  assert.ok(!view.includes('DirectPanel'))
  assert.ok(!fs.existsSync('src/renderer/src/components/connection/DirectPanel.vue'))
  assert.ok(!fs.existsSync('src/renderer/src/components/connection/NetworkOverview.vue'))
})

test('keys page: sync switch integrated into card header, no standalone empty card (指令5)', () => {
  const keys = read('src/renderer/src/views/KeysView.vue')
  assert.ok(!keys.includes('cfg-switch"'), '独立同步卡必须移除')
  assert.match(keys, /cfg-head-actions/)
  assert.match(keys, /cfg-sync/)
  const head = keys.slice(keys.indexOf('cfg-col-head'), keys.indexOf('cfg-search'))
  assert.match(head, /按键设置同步/)
  assert.match(head, /全部恢复默认/)
})

test('view switch transition has explicit duration fallback (遮挡时 transitionend 不触发导致卡死的修复)', () => {
  const app = read('src/renderer/src/App.vue')
  assert.match(app, /name="fade" mode="out-in" :duration="250"/)
})

test('1.0.18 changed SFCs compile', () => {
  for (const file of [
    'src/renderer/src/views/SkinsView.vue',
    'src/renderer/src/views/HomeView.vue',
    'src/renderer/src/views/FriendConnectView.vue',
    'src/renderer/src/views/KeysView.vue',
    'src/renderer/src/App.vue',
  ]) {
    const source = read(file)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    const result = compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [], file)
  }
})
