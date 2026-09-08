import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
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

test('launch orb owns the launch chain while the banner keeps instance selection only', () => {
  const fab = fs.readFileSync('src/renderer/src/components/LaunchFab.vue', 'utf8')
  // HomeView：FAB 等价接管原「开始游戏 ▼」的启动职责，复用同一条启动链路与进度反馈
  assert.match(home, /<LaunchFab\b/)
  assert.match(home, /@launch="onLaunchClick"/)
  assert.match(home, /:label="launchText"/)
  assert.match(home, /:percent="percent"/)
  assert.match(home, /:disabled="launching \|\| !currentVersion"/)
  assert.ok(!home.includes('launch-main'), 'banner must no longer carry the big launch button')
  // 横幅保留实例选择能力：当前版本名 + ▼ 下拉（versionMenuButton / toggleVersionMenu）+ 主色调编辑点
  assert.match(home, /ref="versionMenuButton" class="hero-instance-picker" data-edit="accent" title="选择游戏实例" @click="toggleVersionMenu"/)
  // FAB 状态机：长按 300ms / 位移 6px 双阈值，点击判定同阈值
  assert.match(fab, /const PRESS_MS = 300/)
  assert.match(fab, /const DRAG_THRESHOLD = 6/)
  assert.match(fab, /longPressTimer = setTimeout\(enterDrag, PRESS_MS\)/)
  assert.match(fab, /Date\.now\(\) - downAt <= PRESS_MS && Math\.hypot\(event\.clientX - downX, event\.clientY - downY\) < DRAG_THRESHOLD/)
  // 收起判定：展开态唯一收起依据是「指针真的离开按钮区域」——mouseleave 经 relatedTarget 复核 +
  // elementFromPoint/最终胶囊几何矩形兜底（宽度过渡期 bounds 变化不误收）；点击/启动不强制收起，
  // 指针仍悬停就保持展开显示进度；拖动结束也只在指针不在按钮上时才保持收起
  assert.match(fab, /event\.relatedTarget instanceof Node && rootEl\.value\?\.contains\(event\.relatedTarget\)/)
  assert.match(fab, /document\.elementFromPoint\(x, y\)/)
  assert.match(fab, /left: r\.right - EXPANDED_W/)
  assert.match(fab, /expanded\.value = isPointerInside\(event\.clientX, event\.clientY\)/)
  const activateBody = fab.slice(fab.indexOf('function onActivate'), fab.indexOf('onMounted('))
  assert.doesNotMatch(activateBody, /expanded\.value = false/)
  // pointermove 监听仅拖动期间挂载（enterDrag 内挂载，endPress 内卸载），无常驻监听
  const enterDragBody = fab.slice(fab.indexOf('function enterDrag'), fab.indexOf('function endPress'))
  const endPressBody = fab.slice(fab.indexOf('function endPress'), fab.indexOf('function onPointerDown'))
  assert.match(enterDragBody, /addEventListener\('pointermove', onPointerMove\)/)
  assert.match(endPressBody, /removeEventListener\('pointermove', onPointerMove\)/)
  assert.equal(fab.split('addEventListener(\'pointermove\'').length - 1, 1)
  // 位置持久化：localStorage 持久化 + 还原；resize 重新夹紧（监听随生命周期挂卸）
  assert.match(fab, /kamucl\.launchFab/)
  assert.match(fab, /localStorage\.setItem\(STORAGE_KEY/)
  assert.match(fab, /addEventListener\('resize', onViewportResize\)/)
  assert.match(fab, /removeEventListener\('resize', onViewportResize\)/)
  // 展开过渡：宽度 200ms（180~220ms 区间）+ reduced motion 降级；z-index 低于浮层遮罩(90/95/100)
  assert.match(fab, /transition: width 200ms/)
  assert.match(fab, /prefers-reduced-motion: reduce/)
  assert.match(fab, /z-index: 80/)
  assert.match(fab, /请先选择游戏实例/)
  // 位置夹紧数学：安全边距 16px，视口各方向都夹回界内（连同常量块一起求值）
  const fabConsts = fab.slice(fab.indexOf('const FAB_SIZE'), fab.indexOf('const rootEl'))
  const clampSrc = fab.slice(fab.indexOf('function clampPos'), fab.indexOf('function defaultPos'))
  const clampJs = ts.transpileModule(fabConsts + clampSrc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const clamp = new Function('window', clampJs + '; return clampPos')({ innerWidth: 800, innerHeight: 600 })
  assert.deepEqual(clamp(-50, -50), { x: 16, y: 16 })
  assert.deepEqual(clamp(9999, 9999), { x: 800 - 56 - 16, y: 600 - 56 - 16 })
  assert.deepEqual(clamp(120, 300), { x: 120, y: 300 })
  // LaunchFab 模板与脚本可编译
  const { descriptor, errors } = parse(fab)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'LaunchFab.vue' })
  assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename: 'LaunchFab.vue', id: 'fab', compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
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
  assert.match(home, /\.home-creator \{ margin-top: auto; \}/)
})

test('home and creator templates compile without Vue errors', () => {
  for (const [file, source] of [['HomeView.vue', home], ['CreatorCard.vue', creator]]) {
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [])
    const script = descriptor.scriptSetup ? compileScript(descriptor, { id: file }) : undefined
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script?.bindings } }).errors, [])
  }
})
