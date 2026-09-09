import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { editedServers } from '../src/main/core/serverEditing'
import type { ServerEntry } from '../src/shared/types'

const read = (file: string): string => fs.readFileSync(file, 'utf8')

test('server edits preserve identity, binding and history; reject invalid and duplicate endpoints', () => {
  const server: ServerEntry = { id: 'one', name: '旧名称', address: 'old.example.com', versionId: '背刺', folder: 'C:/games', minecraftVersion: '1.21.4', loader: 'fabric', loaderVersion: '0.16.10', lastUsedAt: '2026-09-01', source: 'minecraft' }
  const updated = editedServers([server], 'one', '  好友生存服  ', '[2001:db8::1]:25566')[0]
  assert.equal(updated.id, server.id)
  assert.equal(updated.name, '好友生存服')
  assert.equal(updated.address, '[2001:db8::1]:25566')
  assert.equal(updated.port, 25566)
  for (const key of ['versionId', 'folder', 'minecraftVersion', 'loader', 'loaderVersion', 'lastUsedAt'] as const) assert.equal(updated[key], server[key])
  assert.equal(updated.source, 'launcher', 'sync must not overwrite a user edited display name')
  assert.equal(server.name, '旧名称', 'transaction does not mutate input')
  assert.throws(() => editedServers([server], 'missing', 'new', 'example.com'), /不存在/)
  assert.throws(() => editedServers([server], 'one', ' ', 'example.com'), /不能为空/)
  assert.throws(() => editedServers([server], 'one', 'new', 'example.com:65536'), /端口/)
  const other = { ...server, id: 'two', address: 'new.example.com', folder: 'c:\\games\\' }
  assert.throws(() => editedServers([server, other], 'one', 'new', 'NEW.EXAMPLE.COM:25565'), /已存在/)
  assert.equal(editedServers([server, {...other, folder: 'D:/games'}], 'one', 'new', 'new.example.com').length, 2)
})

test('all restructured connection components compile and use theme colors', () => {
  const components = ['ConnectionPanel', 'ConnectionStatus', 'FrpPanel', 'VoxLinkPanel', 'TerracottaPanel', 'ServerListItem', 'ServerDetails'].map(s => `connection/${s}.vue`)
  for (const file of [...components.map(s => `src/renderer/src/components/${s}`), 'src/renderer/src/views/FriendConnectView.vue', 'src/renderer/src/views/ServersView.vue']) {
    const source = read(file)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } }).errors, [], file)
    for (const style of descriptor.styles) assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(style.content), file)
  }
  const css = read('src/renderer/src/components/connection/connection.css')
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css))
  assert.match(css, /prefers-reduced-motion/)
  assert.match(css, /focus-visible/)
  assert.match(css, /grid-template-columns: 1fr/)
})

test('玩家直连入口已移除（冗余功能），共享基础设施原样保留', () => {
  // 面板组件已删除
  assert.equal(fs.existsSync('src/renderer/src/components/connection/DirectPanel.vue'), false, 'DirectPanel.vue 应已删除')
  assert.equal(fs.existsSync('src/renderer/src/components/connection/NetworkOverview.vue'), false, 'NetworkOverview.vue 应已删除')
  // 渲染层不得残留引用
  const view = read('src/renderer/src/views/FriendConnectView.vue')
  assert.ok(!view.includes('DirectPanel'), 'FriendConnectView 不得再引用 DirectPanel')
  assert.ok(!view.includes("'direct'"), '不得残留玩家直连页面态')
  // 共享层保留：主进程直连协议能力与 IPC 常量（VoxLink 直连后备仍依赖）
  assert.ok(fs.existsSync('src/shared/directConnect.ts'), 'shared/directConnect.ts 必须保留')
  assert.ok(fs.existsSync('src/main/core/directProtocol.ts'), 'main 直连协议能力必须保留')
  const api = read('src/renderer/src/api.ts')
  for (const fn of ['getDirectOverview', 'getDirectState', 'startDirectHost', 'stopDirectHost', 'prepareDirectJoin', 'resolveDirectInvitation']) {
    assert.ok(api.includes(fn), `共享 api 层必须保留 ${fn}`)
  }
  // 服务器列表复用的面板组件原样保留
  for (const file of ['ConnectionPanel.vue', 'ConnectionStatus.vue', 'ServerListItem.vue', 'ServerDetails.vue']) {
    assert.ok(fs.existsSync(`src/renderer/src/components/connection/${file}`), `${file} 是 ServersView 共享组件，必须保留`)
  }
})

test('server page connects edit IPC and preserves sync, selection, delete confirmation and launch preparation', () => {
  const source = read('src/renderer/src/views/ServersView.vue')
  for (const name of ['editServer', 'addServer', 'removeServer', 'syncServersFromDat', 'prepareServerLaunch', 'launchGame', 'bindServer']) assert.ok(source.includes(`await ${name}(`), name)
  for (const text of ['filteredServers', 'toggleAll', 'openBatchDelete', 'requestDelete', 'delModal.batch', 'versionMissing', 'targetToken', 'onCardDblClick', '没有找到匹配的服务器']) assert.ok(source.includes(text), text)
  assert.match(source, /target: s, batch: false/)
  assert.match(read('src/main/ipc.ts', 'utf8'), /ipcMain.handle\(IPC.serversEdit/)
  assert.match(read('src/renderer/src/api.ts', 'utf8'), /invoke<ServerEntry\[\]>\(IPC.serversEdit, id, name, address\)/)
})
