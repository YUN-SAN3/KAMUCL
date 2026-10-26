import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { effectScope, nextTick, reactive, ref } from 'vue'
import { normalizeVersionCategoryState, renameCategoryAssignment, versionCategoryKey, versionCategoryOf, versionMatchesCategory, VERSION_CATEGORY_ALL, VERSION_CATEGORY_FAVORITES, VERSION_CATEGORY_UNCLASSIFIED } from '../src/shared/versionCategories'

const req = createRequire(import.meta.url)
let compiled: Promise<string> | undefined
async function runtime(root: string) {
  compiled ??= build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `export {updateVersionCategories,registerVersionCategoriesIpc} from './src/main/core/versionCategories';export {getSettings,saveSettings} from './src/main/core/settings';` }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' }).then(result => result.outputFiles[0].text)
  const module = { exports: {} as any }, handlers = new Map<string, Function>()
  const electron = { app: { getPath: (name: string) => path.join(root, name), getVersion: () => 'fixture', getName: () => 'KAMUCL fixture', isPackaged: false }, ipcMain: { handle: (name: string, handler: Function) => { assert(!handlers.has(name)); handlers.set(name, handler) } } }
  new Function('require', 'module', 'exports', await compiled)((name: string) => name === 'electron' ? electron : req(name), module, module.exports)
  module.exports.registerVersionCategoriesIpc()
  return { api: module.exports, handlers }
}
async function fixture(t: TestContext) {
  const base = fs.realpathSync.native(os.tmpdir()), root = fs.mkdtempSync(path.join(base, 'KAMUCL categories115 '))
  t.after(() => { assert(root.startsWith(base + path.sep)); fs.rmSync(root, { recursive: true, force: true }) })
  const first = path.join(root, '游戏目录 § A'), second = path.join(root, '游戏目录 B'), id = '相同实例名称'
  for (const folder of [first, second]) {
    const dir = path.join(folder, 'versions', id)
    fs.mkdirSync(path.join(dir, 'saves', 'keep'), { recursive: true })
    fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify({ id, _mcVersion: '1.20.1', _gameDir: true, mainClass: 'fixture.Main', libraries: [] }))
    fs.writeFileSync(path.join(dir, id + '.jar'), 'existing private client')
    fs.writeFileSync(path.join(dir, 'saves', 'keep', 'level.dat'), 'existing private world')
  }
  const { api, handlers } = await runtime(root)
  const favoriteOverrides = { [JSON.stringify([first.replace(/\\/g, '/').toLowerCase(), id])]: false }
  api.saveSettings({ gameDir: first, activeFolder: first, folders: [{ path: first, name: 'A', isDefault: true }, { path: second, name: 'B', isDefault: false }], favoriteVersions: [id], favoriteInstanceOverrides: favoriteOverrides })
  const update = (action: unknown) => handlers.get('versions:categoriesUpdate')!({}, action)
  return { root, first, second, id, api, update, favoriteOverrides }
}
test('legacy settings start unclassified and existing favorites survive category IPC creation and restart', async t => {
  const f = await fixture(t), file = path.join(f.root, 'userData', 'settings.json'), old = JSON.parse(fs.readFileSync(file, 'utf8'))
  delete old.versionCategories; delete old.versionCategoryAssignments
  fs.writeFileSync(file, JSON.stringify(old))
  const loaded = await runtime(f.root), legacy = loaded.api.getSettings()
  assert.deepEqual(legacy.versionCategories, []); assert.deepEqual(legacy.versionCategoryAssignments, {})
  const result = loaded.handlers.get('versions:categoriesUpdate')!({}, { type: 'create', name: '  生存 · §  ' }), category = result.versionCategories[0]
  assert.equal(category.name, '生存 · §'); assert(category.id)
  assert.deepEqual(result.favoriteVersions, [f.id]); assert.deepEqual(result.favoriteInstanceOverrides, f.favoriteOverrides)
  const restarted = await runtime(f.root)
  assert.deepEqual(restarted.api.getSettings().versionCategories, [category]); assert.deepEqual(restarted.api.getSettings().favoriteInstanceOverrides, f.favoriteOverrides)
})
test('legacy registered symlink spelling stays visible and persisted instead of creating a mismatched canonical-only key', async t => {
  const f = await fixture(t), alias = path.join(f.root, 'legacy alias')
  fs.symlinkSync(f.first, alias, process.platform === 'win32' ? 'junction' : 'dir')
  f.api.saveSettings({ folders: [{ path: alias, name: 'legacy alias', isDefault: true }, { path: f.second, name: 'B', isDefault: false }], activeFolder: alias, gameDir: alias })
  const category = f.update({ type: 'create', name: '旧路径' }).versionCategories[0], result = f.update({ type: 'assign', target: { id: f.id, folder: alias }, categoryId: category.id })
  assert.equal(versionCategoryOf(result, alias, f.id, process.platform), category.id)
  const restarted = await runtime(f.root); assert.equal(versionCategoryOf(restarted.api.getSettings(), alias, f.id, process.platform), category.id)
  assert.equal(fs.readFileSync(path.join(alias, 'versions', f.id, 'saves', 'keep', 'level.dat'), 'utf8'), 'existing private world')
})
test('assignments distinguish same IDs in different folders, persist, unassign, and reject unregistered or missing targets', async t => {
  const f = await fixture(t), category = f.update({ type: 'create', name: '测试' }).versionCategories[0]
  f.update({ type: 'assign', target: { folder: f.first, id: f.id }, categoryId: category.id })
  const current = f.api.getSettings()
  assert.equal(versionCategoryOf(current, f.first, f.id, process.platform), category.id); assert.equal(versionCategoryOf(current, f.second, f.id, process.platform), '')
  const restarted = await runtime(f.root)
  assert.equal(versionCategoryOf(restarted.api.getSettings(), f.first, f.id, process.platform), category.id)
  const before = fs.readFileSync(path.join(f.root, 'userData', 'settings.json'))
  for (const action of [{ type: 'assign', target: { folder: f.second, id: 'missing' }, categoryId: category.id }, { type: 'assign', target: { folder: path.join(f.root, 'unregistered'), id: f.id }, categoryId: category.id }, { type: 'assign', target: { folder: f.first, id: f.id }, categoryId: 'removed' }]) assert.throws(() => f.update(action))
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'userData', 'settings.json')), before)
  f.update({ type: 'assign', target: { folder: f.first, id: f.id }, categoryId: '' }); assert.equal(versionCategoryOf(f.api.getSettings(), f.first, f.id, process.platform), '')
})
test('rename keeps category identity and deletion only removes labels, retaining both actual instances, saves, and favorite state', async t => {
  const f = await fixture(t), one = f.update({ type: 'create', name: '生存' }).versionCategories[0], two = f.update({ type: 'create', name: '创作' }).versionCategories[1]
  for (const [folder, categoryId] of [[f.first, one.id], [f.second, two.id]]) f.update({ type: 'assign', target: { id: f.id, folder }, categoryId })
  const files = [f.first, f.second].flatMap(folder => [path.join(folder, 'versions', f.id, f.id + '.json'), path.join(folder, 'versions', f.id, f.id + '.jar'), path.join(folder, 'versions', f.id, 'saves', 'keep', 'level.dat')]), contents = files.map(file => fs.readFileSync(file))
  const renamed = f.update({ type: 'rename', id: one.id, name: '联机生存' }); assert.equal(renamed.versionCategories[0].id, one.id); assert.equal(versionCategoryOf(renamed, f.first, f.id, process.platform), one.id)
  const result = f.update({ type: 'remove', id: one.id }); assert.deepEqual(result.versionCategories, [two]); assert.equal(versionCategoryOf(result, f.first, f.id, process.platform), ''); assert.equal(versionCategoryOf(result, f.second, f.id, process.platform), two.id)
  assert.deepEqual(result.favoriteVersions, [f.id]); assert.deepEqual(result.favoriteInstanceOverrides, f.favoriteOverrides)
  for (let i = 0; i < files.length; i++) assert.deepEqual(fs.readFileSync(files[i]), contents[i])
})
test('invalid/duplicate/reserved category operations cannot mutate persisted settings or a previous successful action', async t => {
  const f = await fixture(t), category = f.update({ type: 'create', name: 'Creative' }).versionCategories[0], file = path.join(f.root, 'userData', 'settings.json'), before = fs.readFileSync(file)
  for (const action of [{ type: 'create', name: 'Ｃｒｅａｔｉｖｅ' }, { type: 'create', name: '收藏' }, { type: 'create', name: 'a\nprivate' }, { type: 'create', name: '🙂'.repeat(41) }, { type: 'rename', id: category.id, name: '' }, { type: 'rename', id: 'unknown', name: 'valid' }, { type: 'remove', id: 'unknown' }, { type: 'other' }, null]) assert.throws(() => f.update(action))
  assert.deepEqual(fs.readFileSync(file), before); assert.equal(f.api.getSettings().versionCategories[0].name, 'Creative')
})
test('actual write failure leaves cached categories and previous on-disk favorites unchanged, and retry succeeds', async t => {
  const f = await fixture(t), file = path.join(f.root, 'userData', 'settings.json'), before = fs.readFileSync(file), state = structuredClone(f.api.getSettings())
  fs.mkdirSync(file + '.tmp')
  assert.throws(() => f.update({ type: 'create', name: 'write failure' }), /设置写入失败/)
  assert.deepEqual(f.api.getSettings(), state); assert.deepEqual(fs.readFileSync(file), before)
  fs.rmdirSync(file + '.tmp'); f.update({ type: 'create', name: 'retry' }); assert.equal(f.api.getSettings().versionCategories[0].name, 'retry')
})
test('category filters use existing favorite result independently of labels and keep uncategorized legacy versions visible', () => {
  assert(versionMatchesCategory(VERSION_CATEGORY_ALL, '', false)); assert(versionMatchesCategory(VERSION_CATEGORY_UNCLASSIFIED, '', true)); assert(!versionMatchesCategory(VERSION_CATEGORY_UNCLASSIFIED, 'one', false))
  assert(versionMatchesCategory(VERSION_CATEGORY_FAVORITES, 'one', true)); assert(!versionMatchesCategory(VERSION_CATEGORY_FAVORITES, 'one', false)); assert(versionMatchesCategory('one', 'one', false)); assert(!versionMatchesCategory('two', 'one', true))
  assert.equal(versionCategoryKey('D:\\Game\\', 'same', 'win32'), versionCategoryKey('d:/game', 'same', 'win32')); assert.notEqual(versionCategoryKey('/Games/A', 'same', 'linux'), versionCategoryKey('/Games/a', 'same', 'linux'))
})
test('damaged classification data is normalized without prototype links and instance rename migrates only the folder-specific assignment', () => {
  const a = versionCategoryKey('/a', 'same', 'darwin'), b = versionCategoryKey('/b', 'same', 'darwin'), state = normalizeVersionCategoryState({ versionCategories: [{ id: 'one', name: '有效' }, { id: 'bad', name: '收藏' }, { id: 'one', name: '重复' }], versionCategoryAssignments: { [a]: 'one', [b]: 'one', notJSON: 'one', '__proto__': 'one', '["/a","wrong"]': 'bad' } })
  assert.deepEqual(state.versionCategories, [{ id: 'one', name: '有效' }]); assert.deepEqual(state.versionCategoryAssignments, { [a]: 'one', [b]: 'one' })
  const renamed = renameCategoryAssignment(state, '/a', 'same', 'changed', 'darwin'); assert.equal(renamed[a], undefined); assert.equal(renamed[b], 'one'); assert.equal(renamed[versionCategoryKey('/a', 'changed', 'darwin')], 'one'); assert.equal(state.versionCategoryAssignments[a], 'one')
})
test('new category manager and actual GameView templates compile with accessible controls', () => {
  for (const file of ['src/renderer/src/components/VersionCategoriesPanel.vue', 'src/renderer/src/views/GameView.vue']) {
    const descriptor = parse(fs.readFileSync(file, 'utf8')).descriptor, script = compileScript(descriptor, { id: file }), template = compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [])
  }
})
test('actual category manager SFC emits explicit metadata actions, gates busy operations, and only closes deletion after committed props', async t => {
  const descriptor = parse(fs.readFileSync('src/renderer/src/components/VersionCategoriesPanel.vue', 'utf8')).descriptor, script = compileScript(descriptor, { id: 'categories115' }).content
  const compiled = await build({ stdin: { contents: script, loader: 'ts', resolveDir: path.resolve('src/renderer/src/components') }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'presentational-confirm-only', setup(b) { b.onResolve({ filter: /ConfirmModal\.vue$/ }, () => ({ path: 'confirm', namespace: 'category-fixture' })); b.onLoad({ filter: /.*/, namespace: 'category-fixture' }, () => ({ contents: 'export default {}', loader: 'js' })) } }] })
  const module = { exports: {} as any }; new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(req, module, module.exports)
  const props = reactive({ open: false, categories: [{ id: 'one', name: '生存' }], counts: { one: 1 }, busy: false, error: '' }), events: any[] = [], scope = effectScope(), state = scope.run(() => module.exports.default.setup(props, { emit: (...args: any[]) => events.push(args), expose: () => {} }))
  t.after(() => scope.stop())
  state.name.value = '测试'; state.create(); assert.deepEqual(events.pop(), ['action', { type: 'create', name: '测试' }])
  state.renaming.id = 'one'; state.renaming.name = '改名'; state.rename(); assert.deepEqual(events.pop(), ['action', { type: 'rename', id: 'one', name: '改名' }])
  props.busy = true; state.create(); state.rename(); state.close(); assert.equal(events.length, 0)
  props.busy = false; state.deleting.value = props.categories[0]; props.error = 'write failure'; await nextTick(); assert.equal(state.deleting.value.id, 'one'); assert.equal(state.renaming.id, 'one')
  let stopped = false; state.trapFocus({ key: 'Escape', stopPropagation: () => { stopped = true } }); assert.equal(stopped, true); assert.equal(state.deleting.value, null); assert.equal(events.length, 0, 'Escape cancels confirmation without deleting or closing the manager')
  state.deleting.value = props.categories[0]; await nextTick()
  props.categories = []; await nextTick(); assert.equal(state.deleting.value, null)
})

test('actual GameView category action keeps confirmed state on rejection, retries, and uses existing favorite overrides in its filters', async t => {
  const descriptor = parse(fs.readFileSync('src/renderer/src/views/GameView.vue', 'utf8')).descriptor, script = compileScript(descriptor, { id: 'game-categories115' }).content
  const names = (source: string) => script.match(new RegExp(`import\\s*\\{([^}]+)\\}\\s*from\\s*['"]${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`))![1].split(',').map(name => name.trim()).filter(Boolean)
  const apiNames = names('../api'), storeNames = names('../store')
  const compiled = await build({ stdin: { contents: script, loader: 'ts', resolveDir: path.resolve('src/renderer/src/views') }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', alias: { '@shared': path.resolve('src/shared') }, logLevel: 'silent', plugins: [{ name: 'game-view-owned-fixtures', setup(b) {
    b.onResolve({ filter: /\.vue$/ }, () => ({ path: 'presentation', namespace: 'game-category-fixture' }))
    b.onResolve({ filter: /^\.\.\/(api|store|catalogCache|instanceCenter)$/ }, args => ({ path: args.path, namespace: 'game-category-fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'game-category-fixture' }, args => ({ loader: 'js', contents: args.path === '../api' ? apiNames.map(name => `export const ${name}=(...args)=>globalThis.fixture.api.${name}(...args)`).join(';') : args.path === '../store' ? storeNames.map(name => `export const ${name}=${name === 'store' ? 'globalThis.fixture.store' : name === 'selectedInstance' ? 'globalThis.fixture.selectedInstance' : `(...args)=>globalThis.fixture.storeApi.${name}(...args)`}`).join(';') : args.path === '../catalogCache' ? 'export const catalogSession={peek:()=>null}' : args.path === '../instanceCenter' ? 'export const openInstanceCenter=()=>{}' : 'export default {}' }))
  } }] })
  const first = '/owned/a', second = '/owned/b', id = 'same', category = { id: 'one', name: '生存' }, favoriteKey = (folder: string) => JSON.stringify([folder, id]), store = reactive({ settings: { activeFolder: first, gameDir: first, folders: [{ path: first, name: 'A', isDefault: true }, { path: second, name: 'B', isDefault: false }], favoriteVersions: [id], favoriteInstanceOverrides: { [favoriteKey(first)]: false }, versionCategories: [category], versionCategoryAssignments: { [versionCategoryKey(first, id, process.platform)]: category.id } }, installed: [], lastPlayed: {}, installing: new Set(), failedInstalls: new Set() })
  let reject = true, complete: ((value: any) => void) | undefined
  const fixture = { store, selectedInstance: ref(null), api: { errText: (error: Error) => error.message, updateVersionCategories: async () => { if (reject) throw Error('actual IPC write failed'); return await new Promise(resolve => { complete = resolve }) } }, storeApi: { isFavorite: (vid: string, folder: string) => store.settings.favoriteInstanceOverrides[JSON.stringify([folder, vid]) as keyof typeof store.settings.favoriteInstanceOverrides] ?? store.settings.favoriteVersions.includes(vid), sortWithFavorite: (rows: any[]) => rows, displayVersionName: (row: any) => row.id } }
  const module = { exports: {} as any }; new Function('require', 'module', 'exports', 'globalThis', 'window', compiled.outputFiles[0].text)(req, module, module.exports, { fixture }, { kamucl: { platform: process.platform } })
  const scope = effectScope(), state = scope.run(() => module.exports.default.setup({}, { expose: () => {} })); t.after(() => scope.stop())
  state.allInstalled.value = [{ id, folder: first, mcVersion: '1.20.1' }, { id, folder: second, mcVersion: '1.20.1' }]
  state.installedCategory.value = VERSION_CATEGORY_FAVORITES
  assert.deepEqual(state.sortedInstalled.value.map((row: any) => row.folder), [second], 'the explicit false override must stay out of favorites')
  state.installedCategory.value = 'one'; assert.deepEqual(state.sortedInstalled.value.map((row: any) => row.folder), [first])
  const before = structuredClone(JSON.parse(JSON.stringify(store.settings))), field = { value: '' }
  await state.assignCategory(state.allInstalled.value[0], { target: field }); assert.equal(field.value, 'one'); assert.deepEqual(JSON.parse(JSON.stringify(store.settings)), before); assert.match(state.categoryError.value, /actual IPC write failed/); assert.equal(state.categoryBusy.value, false)
  reject = false; const pending = state.onCategoryAction({ type: 'remove', id: 'one' }); assert.equal(state.categoryBusy.value, true); assert.equal(await state.onCategoryAction({ type: 'create', name: 'duplicate operation' }), false)
  complete!({ ...before, versionCategories: [], versionCategoryAssignments: {} }); assert.equal(await pending, true); await nextTick(); assert.equal(state.categoryBusy.value, false); assert.equal(state.categoryError.value, ''); assert.equal(state.installedCategory.value, VERSION_CATEGORY_UNCLASSIFIED); assert.equal(state.sortedInstalled.value.length, 2)
})
