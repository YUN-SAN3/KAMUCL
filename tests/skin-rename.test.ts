import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as vue from 'vue'

test('皮肤重命名：Enter + blur 只保存一次，Esc 不保存，空名可主动恢复默认', async () => {
  const bundle = await build({
    entryPoints: ['src/renderer/src/views/SkinsView.vue'], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'skin-setup', setup(b) {
      b.onResolve({ filter: /^\.\.\/(api|store|skin-render)$/ }, args => ({ path: args.path.split('/').at(-1)!, external: true }))
      b.onLoad({ filter: /\.vue$/ }, args => {
        if (!args.path.endsWith('SkinsView.vue')) return { contents: 'export default {}', loader: 'js' }
        const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'))
        return { contents: compileScript(descriptor, { id: args.path }).content, loader: 'ts', resolveDir: path.dirname(args.path) }
      })
    } }]
  })
  const calls: string[] = [], notices: string[] = []
  const item = { id: 'skin-1', name: '原名.png' }
  const require = createRequire(path.resolve('package.json')), mod = { exports: {} as any }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
    (name: string) => name === 'vue' ? { ...vue, onMounted: () => {}, onUnmounted: () => {} }
      : name === 'store' ? { store: {}, toast: (s: string) => notices.push(s) }
      : name === 'api' ? { renameSkinHistory: async (_: string, value: string) => { calls.push(value); await Promise.resolve(); return [{ ...item, name: value }] }, errText: String }
      : name === 'skin-render' ? {} : require(name), mod, mod.exports)
  const scope = vue.effectScope(), state = scope.run(() => mod.exports.default.setup({}, { expose: () => {} }))
  try {
    state.startHistoryRename(item); state.historyRenameText.value = '  乐正绫111.png  '
    const enter = state.commitHistoryRename(item)
    await state.commitHistoryRename(item) // input teardown triggers blur before first IPC response
    await enter
    assert.deepEqual(calls, ['乐正绫111.png'])
    assert.equal(state.historyList.value[0].name, '乐正绫111.png')
    assert.equal(notices.length, 1)
    state.startHistoryRename(item); state.historyRenameText.value = '取消'
    state.cancelHistoryRename(); await state.commitHistoryRename(item)
    assert.equal(calls.length, 1)
    state.startHistoryRename(item); state.historyRenameText.value = ''
    await state.commitHistoryRename(item); await state.commitHistoryRename(item)
    assert.deepEqual(calls, ['乐正绫111.png', ''])
  } finally { scope.stop() }
})
