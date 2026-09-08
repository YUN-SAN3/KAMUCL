import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { autoMemoryMB } from '../src/shared/memory'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('3D viewer: smooth bob (no abs jitter), chin -y face skinview3d convention, pitch orbits camera', () => {
  const v = read('src/renderer/src/components/SkinViewer3D.vue')
  // 颤抖修复：不再用 abs(sin) 急弯弹跳，改 sin² 平滑
  assert.doesNotMatch(v, /Math\.abs\(Math\.sin\(animT \* 9\.42\)\)/)
  assert.match(v, /stepBob \* stepBob \* 0\.3 \* b/)
  // 下巴：-y 底面按 skinview3d 约定（ny 面顶点序=前左/前右/后左/后右，前缘贴区域下边、
  // 后缘贴上边、u 不镜像），身体与披风两处 UV 写入都修。
  // （skin3d-parity 专项修正：旧断言的 o+3←u0,vTop 是后缘 u 镜像，会造成底面蝶形扭曲）
  const uvBlocks = v.match(/if \(f === 3\) \{[\s\S]*?uv\.setXY\(o \+ 3, u1, vTop\)[\s\S]*?\}/g) ?? []
  assert.equal(uvBlocks.length, 2, 'mapBoxUVs 与 attachCapeMesh 都应有 -y 特例')
  // 拖拽俯仰：相机环绕而非模型绕脚翻倒
  assert.doesNotMatch(v, /root\.rotation\.x = pitch/)
  assert.match(v, /MODEL_CENTER_Y \+ Math\.sin\(pitch\) \* dist/)
  assert.match(v, /Math\.cos\(pitch\) \* dist/)
})

test('folder scan: existence checked before statSync with friendly error (问题3)', () => {
  const fp = read('src/main/core/folderPaths.ts')
  const guardIdx = fp.indexOf("throw new Error('文件夹不存在，请检查路径是否正确')")
  const statIdx = fp.indexOf('fs.statSync(selected)')
  assert.ok(guardIdx > 0 && statIdx > guardIdx, 'existsSync guard must precede statSync')
  assert.match(fp, /fs\.existsSync\(selected\)/)
})

test('memory: auto allocation complete + 0.5GB slider step + typed input + no track-jump (问题4/NEW-4)', () => {
  // 自动分配公式：25% 物理内存取 0.5G 整，夹 2-8G
  assert.equal(autoMemoryMB(16384), 4096)
  assert.equal(autoMemoryMB(32768), 8192)
  assert.equal(autoMemoryMB(8192), 2048)
  assert.equal(autoMemoryMB(4096), 2048)
  const launch = read('src/main/core/launch.ts')
  assert.match(launch, /settings\.memoryAuto\s*\?\s*autoMemoryMB\(totalMemMB\)/)
  const types = read('src/shared/types.ts')
  assert.match(types, /memoryAuto\?: boolean/)
  const settings = read('src/main/core/settings.ts')
  assert.match(settings, /memoryAuto: true/)
  const view = read('src/renderer/src/views/SettingsView.vue')
  // 滑条 0.5GB 步进
  assert.match(view, /const MEM_STEP = 512/)
  // 自定义滑块：原生 range 移除（不再抢鼠标/轨道跳值），拇指 pointer capture
  const memSection = view.slice(view.indexOf('memory-auto-row'), view.indexOf('<!-- Java -->'))
  assert.doesNotMatch(memSection, /type="range"/)
  assert.match(memSection, /onMemThumbDown/)
  assert.match(view, /setPointerCapture/)
  // 打字精细调节（0.25GB）
  assert.match(memSection, /step="0\.25"/)
  assert.match(memSection, /commitMemoryEdit/)
})

test('community: infinite scroll sentinel auto-loads more (问题5)', () => {
  const cv = read('src/renderer/src/views/CommunityView.vue')
  assert.match(cv, /IntersectionObserver/)
  assert.match(cv, /moreSentinel/)
  assert.match(cv, /onLoadMore\(\)/)
  assert.match(cv, /onUnmounted\(\(\) => moreObserver/)
})

test('spacing: keys page and MOD panel use design tokens with breathing room (问题6)', () => {
  const keys = read('src/renderer/src/views/KeysView.vue')
  assert.doesNotMatch(keys, /gap: 10px|padding: 7px 4px|margin-top: 12px/)
  assert.match(keys, /gap: var\(--space-3\)/)
  const bridge = read('src/renderer/src/views/BridgeView.vue')
  assert.doesNotMatch(bridge, /gap: 2px/)
  assert.match(bridge, /gap: var\(--space-1\)/)
  assert.match(bridge, /padding: var\(--space-4\) var\(--card-pad\)/)
})

test('changed SFCs compile', () => {
  for (const file of [
    'src/renderer/src/components/SkinViewer3D.vue',
    'src/renderer/src/views/SettingsView.vue',
    'src/renderer/src/views/CommunityView.vue',
    'src/renderer/src/views/KeysView.vue',
    'src/renderer/src/views/BridgeView.vue',
  ]) {
    const source = read(file)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    const result = compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [], file)
  }
})
