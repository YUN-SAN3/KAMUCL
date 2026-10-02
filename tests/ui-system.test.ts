import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { motionReduced, searchSettings, settingsCatalog, settingsCategories, settingsScopes, scopeOfCategory } from '../src/shared/settingsCatalog'

test('settings search resolves actual destinations and understands mixed keywords', () => {
  assert.deepEqual(searchSettings('  '), [])
  assert.equal(searchSettings('java 自动')[0].id, 'java')
  assert.equal(searchSettings('动画')[0].id, 'motion')
  assert.equal(searchSettings('限速')[0].category, 'downloads')
  assert.equal(searchSettings('G1GC')[0].id, 'jvm')
  assert.equal(searchSettings('does-not-exist').length, 0)
  const source = fs.readFileSync('src/renderer/src/views/SettingsView.vue', 'utf8') + fs.readFileSync('src/renderer/src/components/HomeLayoutEditor.vue', 'utf8')
  for (const item of settingsCatalog) {
    assert(settingsCategories.some(c => c.id === item.category))
    assert(source.includes(`data-section="${item.id}"`), `Missing actual setting: ${item.id}`)
    assert(searchSettings(item.name).some(result => result.id === item.id))
  }
})

test('reduced motion preserves legacy config semantics and always respects the OS', () => {
  assert.equal(motionReduced(undefined, false), false)
  assert.equal(motionReduced(undefined, true), true)
  assert.equal(motionReduced(false, true), true)
  assert.equal(motionReduced(true, false), true)
  assert.equal(motionReduced('false', false), false)
})

test('settings scopes separate launcher behavior and game runtime while preserving legacy category ids', () => {
 assert.deepEqual(settingsScopes.map(s => s.id), ['launcher', 'game'])
 for (const id of ['appearance','general','downloads','features','about']) assert.equal(scopeOfCategory(id), 'launcher')
 for (const id of ['game','display','directories']) assert.equal(scopeOfCategory(id), 'game')
 for (const keyword of ['Java','内存','全屏','隔离','安装目录']) assert.equal(scopeOfCategory(searchSettings(keyword)[0].category), 'game')
 for (const keyword of ['主题','正版登录','启动后关闭','线程','插件','自动更新']) assert.equal(scopeOfCategory(searchSettings(keyword)[0].category), 'launcher')
 assert.equal(scopeOfCategory('unknown'), 'launcher')
})
