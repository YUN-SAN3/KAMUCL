import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = (file: string) => fs.readFileSync(file, 'utf8')

// Replaced implementation: behavior is exercised by skin3d-parity, download-policy,
// download-stall, import-download-1049 and modpack-speed-1050 runtime tests.


test('launch command assembly: no duplicate -cp/library-path/jna.tmpdir, trimmed values, correct order', () => {
  const launch = read('src/main/core/launch.ts')
  // json 自带参数不再被手动重复添加
  assert.match(launch, /jsonHas\('-Djava\.library\.path='\)/)
  assert.match(launch, /jsonHas\('-Djna\.tmpdir='\)/)
  assert.match(launch, /jsonHasCp/)
  assert.match(launch, /\.\.\.\(jsonHasCp \? \[\] : \['-cp', classpath\]\)/)
  // jvm 参数 trim（FabricMcEmu= 等值的前导空格去除）
  assert.match(launch, /\.map\(\(a\) => a\.trim\(\)\)/)
  // 顺序：jvmArgs → -cp classpath → mainClass → gameArgs
  assert.match(launch, /\[\.\.\.jvmArgs, .*\.\.\.\(jsonHasCp[\s\S]*?merged\.mainClass, \.\.\.gameArgs\]/)
})

// Replaced implementation: behavior is exercised by skin3d-parity, download-policy,
// download-stall, import-download-1049 and modpack-speed-1050 runtime tests.


test('edit panel: topbar clickable in edit mode, details with empty groups show hint', () => {
  const app = read('src/renderer/src/App.vue')
  assert.match(app, /\.shell\.edit-mode \.topbar/)
  assert.match(app, /-webkit-app-region: no-drag/)
  const panel = read('src/renderer/src/components/EditPanel.vue')
  assert.match(panel, /点击预览中的卡片或按钮/)
  assert.match(panel, /页面与图层/)
})

test('SkinViewer3D and EditPanel compile', () => {
  for (const file of ['src/renderer/src/components/SkinViewer3D.vue', 'src/renderer/src/components/EditPanel.vue']) {
    const source = read(file)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    const result = compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [], file)
  }
})
