import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('skin viewer auto-detects Alex(slim) from texture pixels, not relying on variant prop chain', () => {
  const viewer = read('src/renderer/src/components/SkinViewer3D.vue')
  // 自动检测函数存在且用 x=54 列透明度判定
  assert.match(viewer, /function detectSlimFromTexture/)
  assert.match(viewer, /getImageData\(54, 20, 1, 12\)/)
  // 检测结果并入 slim 判定（优先于传递链）
  assert.match(viewer, /autoSlim = detectSlimFromTexture\(tex\)/)
  assert.match(viewer, /const slim = props\.variant === 'slim' \|\| autoSlim/)
  // slim/classic 手臂宽度与肩部轴心差异保留
  assert.match(viewer, /slim \? 3 : 4/)
  assert.match(viewer, /slim \? 5 : 5\.5/)
})

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

test('download: http2 shared client + whole-round retry on transient failure', () => {
  const client = read('src/main/core/httpClient.ts')
  assert.match(client, /allowH2: true/)
  assert.match(client, /keepAliveTimeout/)
  const dl = read('src/main/core/download.ts')
  assert.match(dl, /httpFetch/)
  assert.match(dl, /hadTransient/)
  assert.match(dl, /noteHostsRecovered/)
  assert.match(dl, /for \(let round = 0; round < 2; round\+\+\)/)
  // 确定性失败（内容校验/404）不参与整体重试轮
  assert.match(dl, /if \(!hadTransient\) break/)
})

test('edit panel: topbar clickable in edit mode, details with empty groups show hint', () => {
  const app = read('src/renderer/src/App.vue')
  assert.match(app, /\.shell\.edit-mode \.topbar/)
  assert.match(app, /-webkit-app-region: no-drag/)
  const panel = read('src/renderer/src/components/EditPanel.vue')
  assert.match(panel, /ep-empty-hint/)
  assert.match(panel, /!g\.colors\.length/)
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
