import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as vue from 'vue'
import { DEFAULT_VOXLINK_ROOM_NAME, normalizeVoxlinkRoomName, isVoxlinkContentBlocked } from '../src/shared/voxlinkRoom'

test('VoxLink room names have a shared neutral default and reject invalid input', () => {
  assert.equal(normalizeVoxlinkRoomName(DEFAULT_VOXLINK_ROOM_NAME), '我的世界联机')
  assert.equal(normalizeVoxlinkRoomName('  好友的生存世界  '), '好友的生存世界')
  assert.throws(() => normalizeVoxlinkRoomName('  '), /请输入/)
  assert.throws(() => normalizeVoxlinkRoomName('名'.repeat(33)), /32/)
  assert(isVoxlinkContentBlocked({ code: 'CONTENT_BLOCKED' }))
  assert(isVoxlinkContentBlocked(new Error("Error invoking remote method 'voxlink:start': APIError: CONTENT_BLOCKED: 内容不合规")))
  assert(!isVoxlinkContentBlocked(new Error('NETWORK: offline')))
})

test('VoxLink create flow preserves rejected names, focuses the field, and submits only on user retry', async () => {
  const bundle = await build({
    entryPoints: ['src/renderer/src/components/connection/VoxLinkPanel.vue'], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', alias: { '@shared': path.resolve('src/shared') },
    plugins: [{ name: 'voxlink-setup', setup(b) {
      b.onResolve({ filter: /^\.\.\/\.\.\/(api|store)$/ }, args => ({ path: args.path.split('/').at(-1)!, external: true }))
      b.onLoad({ filter: /\.vue$/ }, args => {
        if (!args.path.endsWith('VoxLinkPanel.vue')) return { contents: 'export default {}', loader: 'js' }
        const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'))
        return { contents: compileScript(descriptor, { id: args.path }).content, loader: 'ts', resolveDir: path.dirname(args.path) }
      })
    } }]
  })
  const calls: any[] = []
  let blocked = true, focusCount = 0
  const require = createRequire(path.resolve('package.json'))
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', 'window', bundle.outputFiles[0].text)(
    (name: string) => name === 'vue' ? { ...vue, onMounted: () => {}, onUnmounted: () => {} }
      : name === 'store' ? { toast: () => {} } : name === 'api' ? {} : require(name),
    module, module.exports, { kamucl: { invoke: async (channel: string, payload: any) => {
      calls.push({ channel, payload })
      if (channel === 'voxlink:start' && blocked) throw new Error('APIError: CONTENT_BLOCKED: 内容不合规')
      return channel === 'voxlink:start' ? { ok: true } : { state: 'hosting', room: { name: '好友生存' } }
    } } }
  )
  const scope = vue.effectScope()
  const state = scope.run(() => module.exports.default.setup({}, { expose: () => {} }))
  state.roomNameInput.value = { focus: () => { focusCount++ } }
  try {
    state.roomName.value = '  '
    await state.startHost()
    assert.equal(calls.length, 0)
    assert.equal(state.busy.value, false)
    state.roomName.value = '自定义名称'
    await vue.nextTick()
    await state.startHost()
    assert.equal(calls.length, 1, 'no automatic retries to evade server rejection')
    assert.equal(state.roomName.value, '自定义名称')
    assert.match(state.roomNameError.value, /服务端审核/)
    assert.equal(state.busy.value, false)
    assert(focusCount >= 2)
    state.roomName.value = '  好友生存  '
    await vue.nextTick()
    assert.equal(state.roomNameError.value, '')
    assert.equal(state.error.value, '')
    blocked = false
    await state.startHost()
    assert.equal(calls.filter(c => c.channel === 'voxlink:start').length, 2)
    assert.equal(calls[1].payload.roomName, '好友生存')
    assert.equal(state.busy.value, false)
  } finally { scope.stop() }
})
