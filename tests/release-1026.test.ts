import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('fix-skins: SkinsView imports every composition API it uses (onUnmounted regression) (皮肤页)', () => {
  const sv = read('src/renderer/src/views/SkinsView.vue')
  // 页面用到的每个 vue 组合式 API 都必须出现在 import 语句中（1.0.25 漏导 onUnmounted 致整页空白）
  const importLine = sv.match(/import \{([^}]+)\} from 'vue'/)![1]
  for (const api of ['onMounted', 'onUnmounted', 'watch', 'computed', 'reactive', 'ref', 'nextTick']) {
    if (sv.includes(`${api}(`)) assert.ok(importLine.includes(api), `SkinsView 使用 ${api} 但未导入`)
  }
  assert.match(sv, /animSegObserver = new ResizeObserver/)
})

test('feat-mod-disable: fs:toggleDisable renames .jar <-> .jar.disabled with running guard (模组禁用)', () => {
  const types = read('src/shared/types.ts')
  assert.match(types, /fsToggleDisable: 'fs:toggleDisable'/)
  const ipc = read('src/main/ipc.ts')
  assert.match(ipc, /IPC\.fsToggleDisable/)
  assert.match(ipc, /getRunningVersionIds\(\)/)
  assert.match(ipc, /该实例正在运行中，请先退出游戏再禁用\/启用模组/)
  assert.match(ipc, /\.jar\.disabled/)
  assert.match(ipc, /仅支持禁用 \.jar 模组文件/)
  const fm = read('src/renderer/src/components/FileManager.vue')
  assert.match(fm, /toggleDisableFs/)
  assert.match(fm, /isDisabledMod/)
  assert.match(fm, /已禁用/)
  const api = read('src/renderer/src/api.ts')
  assert.match(api, /toggleDisableFs/)
})

test('feat-mod-disable: rename semantics roundtrip on real fs (模组禁用)', () => {
  // 与 ipc.ts 处理函数同语义的改名行为：.jar → .jar.disabled → 还原
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-mod-'))
  try {
    const jar = path.join(dir, 'test-mod.jar')
    fs.writeFileSync(jar, 'fake')
    const disabled = `${jar}.disabled`
    fs.renameSync(jar, disabled)
    assert.ok(fs.existsSync(disabled) && !fs.existsSync(jar))
    const restored = disabled.slice(0, -'.disabled'.length)
    fs.renameSync(disabled, restored)
    assert.ok(fs.existsSync(jar) && !fs.existsSync(disabled))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('feat-fabric-api: install shows Fabric API section; install targets the instance mods dir (Fabric API)', () => {
  const gv = read('src/renderer/src/views/GameView.vue')
  assert.match(gv, /v-if="modal\.loader === 'fabric'"/)
  assert.match(gv, /modal\.apiOn/)
  assert.match(gv, /listFabricApi/)
  assert.match(gv, /fabricApi:/)
  const loaders = read('src/main/core/loaders.ts')
  assert.match(loaders, /installFabricApi[\s\S]*modsDir/)
  // 不再无条件写共享目录：目标目录可传入
  assert.match(loaders, /modsDir \?\? path\.join\(gameDir\(\), 'mods'\)/)
  const versions = read('src/main/core/versions.ts')
  assert.match(versions, /instanceDirectoryState\(installedId, j\)\.path, 'mods'/)
})

test('1.0.26 changed SFCs compile', () => {
  for (const file of [
    'src/renderer/src/views/SkinsView.vue',
    'src/renderer/src/components/FileManager.vue',
    'src/renderer/src/views/GameView.vue',
  ]) {
    const source = read(file)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    const result = compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [], file)
  }
})
