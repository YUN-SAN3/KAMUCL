import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

test('friend connection is independently routed after servers and keeps the existing functional component', () => {
  const app = fs.readFileSync('src/renderer/src/App.vue', 'utf8')
  const servers = fs.readFileSync('src/renderer/src/views/ServersView.vue', 'utf8')
  const friends = fs.readFileSync('src/renderer/src/views/FriendConnectView.vue', 'utf8')
  assert.match(app, /friends: FriendConnectView/)
  assert(app.indexOf("key: 'friends'") > app.indexOf("key: 'servers'"))
  assert(!servers.includes('FriendConnect'))
  // 联机改为多页结构：视图内含方式选择 landing 与独立页返回入口，不再挂 FriendConnect 面板
  assert.match(friends, /选择联机方式/)
  assert.match(friends, /← 更换方式/)
  assert.ok(!friends.includes('FriendConnect'), 'FriendConnectView 不得再引用 FriendConnect 组件')
  assert.match(fs.readFileSync('src/renderer/src/views/SettingsView.vue', 'utf8'), /key: 'friends'/)
  for (const source of [app, servers, friends]) {
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: 'test' })
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename: 'test.vue', id: 'test', compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  }
})

test('home metadata uses a 200ms out-in transition while controls retain live selection and names have full tooltips', () => {
  const home = fs.readFileSync('src/renderer/src/views/HomeView.vue', 'utf8')
  assert.match(home, /<Transition name="instance-switch" mode="out-in">/)
  assert.match(home, /transition: opacity 100ms ease, transform 100ms ease/)
  assert.match(home, /prefers-reduced-motion: reduce/)
  assert.match(home, /:title="versionLabel\(version\)"/)
  assert.match(home, /:title="displayVersionSub\(version\)"/)
  assert.match(home, /grid-template-columns: 36px minmax\(0, 1fr\)/)
  const { descriptor } = parse(home)
  const script = compileScript(descriptor, { id: 'home' })
  assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename: 'HomeView.vue', id: 'home', compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
})
