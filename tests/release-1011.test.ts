import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('instance controls preserve folder identity and separate list scope from installation target', () => {
  const gv = read('src/renderer/src/views/GameView.vue')
  const rows = gv.slice(gv.indexOf('v-for="v in sortedInstalled"'), gv.indexOf('<!-- 管理快捷菜单'))
  assert.match(rows, /openManageMenu\(\$event, v.id, v.folder\)/)
  assert.match(rows, /launchVersion\(v\)/)
  assert.match(rows, /openInstanceCenter\(v\)/)
  assert.doesNotMatch(rows, /removeModal.open|iso-switch|btn-danger/)
  assert.match(gv, /v-model="installedFolder" :options="installedFolderOptions"/)
  assert.match(gv, /:model-value="activeFolder"/)
  assert.match(gv, /menuVersion.id ===|v.id === manageMenu.id && v.folder === manageMenu.folder/)
  assert.match(gv, /removeModal.target = menuVersion; removeModal.open = true/)
  assert.match(gv, /onToggleIsolation\(menuVersion, \$event\)/)
})

test('GameView compiles after row redesign', () => {
  const source = read('src/renderer/src/views/GameView.vue')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'GameView.vue' })
  const result = compileTemplate({ source: descriptor.template!.content, filename: 'GameView.vue', id: 'GameView.vue', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(result.errors, [])
})
