import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('skin aura (blue ring under character) removed from home preview (指令1)', () => {
  const home = read('src/renderer/src/views/HomeView.vue')
  assert.ok(!home.includes('skin-aura'), 'skin-aura 引用与样式都必须移除')
})

test('java rescan restores previously hidden runtimes found on disk (指令2)', () => {
  const java = read('src/main/core/java.ts')
  assert.match(java, /if \(refresh\) \{[\s\S]*?javaHidden[\s\S]*?saveSettings/)
  assert.match(java, /重扫恢复.*个曾被隐藏的 Java/)
})

test('keys page: explicit clear button during capture assigns unknown', () => {
  const keys = read('src/renderer/src/views/KeysView.vue')
  assert.match(keys, /clearCapturedKey/)
  assert.match(keys, /data-key-clear[\s\S]*?@click.stop="clearCapturedKey"/)
  assert.match(keys, /key\.keyboard\.unknown/)
})

test('memory slider: fill has no transition while dragging (指令4 无级调节不抽搐)', () => {
  const sv = read('src/renderer/src/views/SettingsView.vue')
  assert.match(sv, /\.mem-slider:has\(\.mem-slider-thumb\.dragging\) \.mem-slider-fill \{\s*transition: none/)
})

test('community/friend/bridge/servers pages: entrance stagger + hover polish (指令5 美学重构)', () => {
  const cv = read('src/renderer/src/views/CommunityView.vue')
  assert.match(cv, /@keyframes community-card-in/)
  assert.match(cv, /capsule-blob/)
  assert.match(cv, /result-card:hover \{[\s\S]*?translateY\(-3px\)/)
  const fc = read('src/renderer/src/views/FriendConnectView.vue')
  assert.match(fc, /@keyframes pick-card-in/)
  assert.match(fc, /pick-card:nth-child\(2\)/)
  assert.match(fc, /pick-card:hover \.pick-go/)
  const bv = read('src/renderer/src/views/BridgeView.vue')
  assert.match(bv, /@keyframes bridge-pulse/)
  assert.match(bv, /bridge-card:hover/)
  const sv2 = read('src/renderer/src/views/ServersView.vue')
  assert.match(sv2, /@keyframes server-row-in/)
  assert.match(sv2, /server-list-item:hover .server-monogram/)
})

test('1.0.20 changed SFCs compile', () => {
  for (const file of [
    'src/renderer/src/views/HomeView.vue',
    'src/renderer/src/views/KeysView.vue',
    'src/renderer/src/views/SettingsView.vue',
    'src/renderer/src/views/CommunityView.vue',
    'src/renderer/src/views/FriendConnectView.vue',
    'src/renderer/src/views/BridgeView.vue',
    'src/renderer/src/views/ServersView.vue',
  ]) {
    const source = read(file)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    const result = compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [], file)
  }
})
