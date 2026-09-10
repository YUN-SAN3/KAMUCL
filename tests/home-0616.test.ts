import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { computed, ref } from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const home = fs.readFileSync('src/renderer/src/views/HomeView.vue', 'utf8')
const creator = fs.readFileSync('src/renderer/src/components/CreatorCard.vue', 'utf8')

test('hero naming follows selected instance while subtitle reads only real Minecraft metadata', () => {
  // Execute the production computed expressions with a reactive selected instance.
  const selected = ref<any>({ id: '背刺', mcVersion: '1.21.4', loader: 'fabric', loaderVersion: '0.16.10' })
  const evaluate = (name: string) => {
    const expression = home.match(new RegExp(`^const ${name} = (computed\\(.*\\))$`, 'm'))![1]
    return new Function('computed', 'currentVersion', 'versionLabel', `return ${expression}`)(computed, selected, (v: { id: string }) => v.id)
  }
  const name = evaluate('heroName')
  const version = evaluate('heroVersion')
  assert.equal(name.value, '背刺')
  assert.equal(version.value, '1.21.4')
  for (const loader of ['forge', 'neoforge', 'fabric', 'quilt', undefined]) {
    selected.value = { id: '自定义整合包-' + '长名称'.repeat(20), mcVersion: '26.2', loader }
    assert.equal(name.value, selected.value.id)
    assert.equal(version.value, '26.2')
  }
  selected.value = { id: '名称含1.20.1但不是技术版本' }
  assert.equal(version.value, '版本未知')
  selected.value = undefined
  assert.equal(name.value, '选择游戏实例')
  assert.match(home, /:title="heroName"/)
  assert.match(home, /<Transition name="instance-switch" mode="out-in">/)
  assert.match(home, /\{\{ loaderText\(currentVersion\) \}\}/)
  assert.ok(!home.includes('<span>Java 版</span>'))
})

test('launch combo lives in the banner and owns the launch chain (1.0.18 还原旧版设计，悬浮启动球移除)', () => {
  // 启动按钮回到横幅内：launch-combo（开始游戏大按钮 + ▼ 实例选择）复用同一条启动链路与进度反馈
  assert.match(home, /class="launch-combo" data-edit="accent"/)
  assert.match(home, /class="launch-main"/)
  assert.match(home, /@click="onLaunchClick"/)
  assert.match(home, /:disabled="launching \|\| !currentVersion"/)
  assert.match(home, /class="launch-progress" :style="\{ width: percent \+ '%' \}"/)
  // 实例选择下拉挂在 combo 箭头
  assert.match(home, /ref="versionMenuButton" class="launch-arrow" title="选择游戏实例" @click="toggleVersionMenu"/)
  // 悬浮启动球已移除
  assert.ok(!home.includes('LaunchFab'), 'LaunchFab must be gone from HomeView')
  assert.ok(!fs.existsSync('src/renderer/src/components/LaunchFab.vue'), 'LaunchFab.vue must be deleted')
})

test('creator card uses theme tokens, keyboard focus and correct external Bilibili link', () => {
  assert.match(creator, /href="https:\/\/space\.bilibili\.com\/9596327"/)
  assert.match(creator, /target="_blank"/)
  assert.match(creator, /rel="noopener noreferrer"/)
  assert.match(creator, /aria-label="访问卡慕SaMa/)
  assert.match(creator, /focus-visible/)
  assert.match(creator, /prefers-reduced-motion/)
  assert.match(creator, /var\(--accent-soft\)/)
  assert.match(creator, /var\(--text\)/)
  assert.ok(!/#[\da-f]{3,8}\b/i.test(creator), 'no hard-coded palette that conflicts with themes')
  assert.match(home, /<CreatorCard class="home-creator" \/>/)
  assert.match(home, /\.home-creator \{ margin-top: auto;/)
})

test('home and creator templates compile without Vue errors', () => {
  for (const [file, source] of [['HomeView.vue', home], ['CreatorCard.vue', creator]]) {
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [])
    const script = descriptor.scriptSetup ? compileScript(descriptor, { id: file }) : undefined
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script?.bindings } }).errors, [])
  }
})
