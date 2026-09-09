import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { getDefaultKeys, mergeKeysIntoOptions, syncKeysToGameDir } from '../src/main/core/keybindings'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('legacy generic game options remain removed; default packs use their own feature', () => {
  // 共享定义表不再含其他配置项
  const shared = read('src/shared/keybindings.ts')
  assert.doesNotMatch(shared, /VANILLA_OPTIONS/)
  assert.doesNotMatch(shared, /OPTION_CATEGORIES/)
  assert.doesNotMatch(shared, /GameOptionDef/)
  assert.match(shared, /VANILLA_KEYBINDS/)
  // 设置类型与 IPC 注册表不再有 optionsSync / options:* 频道
  const types = read('src/shared/types.ts')
  assert.doesNotMatch(types, /optionsSync/)
  assert.doesNotMatch(types, /optionsGetDefault|optionsSetDefault|optionsReset|optionsImportPacks|optionsRemovePack/)
  // 启动流程只保留键位同步
  const launch = read('src/main/core/launch.ts')
  assert.doesNotMatch(launch, /optionsSync/)
  assert.doesNotMatch(launch, /syncOptionsToGameDir/)
  assert.match(launch, /syncKeysToGameDir/)
  // IPC 不再注册 options 处理器
  const ipc = read('src/main/ipc.ts')
  assert.doesNotMatch(ipc, /optionsGetDefault|optionsSetDefault|optionsImportPacks/)
  // 渲染 API 不再暴露 options 方法
  const api = read('src/renderer/src/api.ts')
  assert.doesNotMatch(api, /getDefaultOptions|setDefaultOption/)
  // 页面不再含其他配置 UI
  const view = read('src/renderer/src/views/KeysView.vue')
  assert.doesNotMatch(view, /其他设置同步|其他游戏配置|toggleOptionsSync|sliderPreview|cfg-pack-zone/)
  assert.match(view, /按键设置同步/)
  assert.match(view, /按键配置/)
})

test('keybinding functions survive removal: defaults table, merge, write to options.txt', () => {
  const keys = getDefaultKeys()
  assert(keys['key_key.forward'], 'vanilla forward key exists')
  assert.match(keys['key_key.forward'], /^key\.(keyboard|mouse)\./)
  const dir = fs.mkdtempSync(require('node:os').tmpdir() + '/kamucl-keys-')
  const file = require('node:path').join(dir, 'options.txt')
  fs.writeFileSync(file, 'lang:zh_cn\nkey_key.forward:key.keyboard.w\n', 'utf8')
  const changed = syncKeysToGameDir(dir, { ...keys, 'key_key.forward': 'key.keyboard.up' })
  assert.equal(changed, true)
  const after = fs.readFileSync(file, 'utf8')
  assert(after.includes('key_key.forward:key.keyboard.up'), 'key overwritten')
  assert(after.includes('lang:zh_cn'), 'other lines preserved')
  // 未登记键位不受影响
  const merged = mergeKeysIntoOptions('fov:0.5\n', keys)
  assert(merged.includes('fov:0.5'), 'non-key option untouched')
})

test('KeysView compiles after options removal', () => {
  const source = read('src/renderer/src/views/KeysView.vue')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'KeysView.vue' })
  const result = compileTemplate({ source: descriptor.template!.content, filename: 'KeysView.vue', id: 'KeysView.vue', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(result.errors, [])
})
