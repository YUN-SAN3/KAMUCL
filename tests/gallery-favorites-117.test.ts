import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { build } from 'esbuild'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { BUILTIN_LAUNCH_IMAGES } from '../src/shared/launchImages'
import { activeCarouselKeys, carouselImages, carouselKeys, carouselSelection, carouselTiming, MAX_CAROUSEL_IMAGES } from '../src/shared/appearancePolicy'

const builtins = BUILTIN_LAUNCH_IMAGES.map(image => image.key)
test('all seven bundled illustrations exactly preserve the pixels supplied by the user', async () => {
  const pixels = [
    'e8c74509e9f57c18c99df123e87bdc41752b069f2876671893b691a124b40456',
    '30a8f343d3549ca13b6c5b69146b5e0b86e32d0d9f21b997ba5915fc2249808d',
    'be20c272883fbeee485d09f8b033d1fbd030ba3a9df0a1cb1e2e756b5fbf1c76',
    '0945dacc3d2c8d292c4418c19afe0e317771c1c2ebf7d926697de5112a349503',
    '5b8bac38860c285b2abcf5361682e0671e08a62d55229afff1c647736e2c8a33',
    '042a68cbf1faded3d6e8b3b29e12a3ee4bf4df5b74d1537e6cdfb42a84d95e4a',
    '0fd4efc56307d9b90b4c721361f5d193c1ce464390fff5ce630177ef4af9535f'
  ]
  for (const [index, image] of BUILTIN_LAUNCH_IMAGES.entries()) {
    const decoded = await sharp(path.join('src/renderer/src/assets/launch', image.file)).raw().toBuffer()
    assert.equal(createHash('sha256').update(decoded).digest('hex'), pixels[index], image.title)
  }
})
test('new gallery mixes all seven builtins and retained legacy custom pictures in stable order', () => {
  const old = { image: 'first.png', images: ['first.png', 'second.png', 'first.png'], fit: 'crop' as const }
  assert.deepEqual(activeCarouselKeys(old), [...builtins, 'first.png', 'second.png'])
  assert.deepEqual(carouselImages(old), ['first.png', 'second.png'])
  assert.equal(carouselKeys({ images: Array.from({ length: 60 }, (_, i) => 'custom-' + i) }).length, 7 + MAX_CAROUSEL_IMAGES)
})
test('deselection retains files and timings, empty selection never resurrects defaults', () => {
  const custom = 'managed-custom.webp'
  const settings = { images: [custom], disabled: [...builtins, custom], durations: { [custom]: 13, [builtins[1]]: 9, unknown: 10 } }
  assert.deepEqual(activeCarouselKeys(settings), [])
  assert.deepEqual(carouselImages(settings), [custom])
  assert.deepEqual(carouselTiming(settings).durations, { [custom]: 13, [builtins[1]]: 9 })
  assert.deepEqual(activeCarouselKeys({ ...settings, disabled: [...builtins] }), [custom])
})
test('mixed order rejects unknown IDs, duplicates and stale custom references, then appends new imports', () => {
  const selection = carouselSelection({ images: ['a', 'b'], order: ['b', builtins[3], 'removed', 'b'], disabled: ['b', 'removed', builtins[0]] })
  assert.deepEqual(selection.order, ['b', builtins[3], ...builtins.filter(key => key !== builtins[3]), 'a'])
  assert.deepEqual(selection.disabled, ['b', builtins[0]])
  const newer = { ...selection, images: ['a', 'b', 'new'] }
  assert.equal(carouselKeys(newer).at(-1), 'new')
  assert.deepEqual(carouselSelection(JSON.parse(JSON.stringify(newer))), { ...selection, order: [...selection.order, 'new'] })
})
test('gallery controls and external favorite buttons compile across their actual Vue templates', () => {
  for (const file of ['views/HomeView.vue', 'components/HomeLayoutEditor.vue', 'views/CommunityView.vue', 'components/FavoriteModsPicker.vue', 'components/FileManager.vue']) {
    const { descriptor, errors } = parse(fs.readFileSync('src/renderer/src/' + file, 'utf8'))
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: file })
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  }
})

let favoriteBundle: Promise<string> | undefined
async function favoriteRuntime(invoke: (channel: string, ...args: any[]) => Promise<any>) {
  favoriteBundle ??= build({ entryPoints: ['src/renderer/src/modFavorites.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'isolated-renderer-services', setup(plugin) {
    plugin.onResolve({ filter: /^\.\/(api|store)$/ }, args => args.importer.endsWith('modFavorites.ts') ? { path: args.path, namespace: 'service' } : undefined)
    plugin.onLoad({ filter: /.*/, namespace: 'service' }, args => ({ contents: args.path === './api' ? 'export function errText(e){return e.message}' : 'export function toast(message){window.failures.push(message)}', loader: 'js' }))
  } }] }).then(result => result.outputFiles[0].text)
  const runtime = { exports: {} as any }, window = { kamucl: { invoke }, failures: [] as string[] }
  new Function('require', 'module', 'exports', 'window', await favoriteBundle)(createRequire(path.resolve('package.json')), runtime, runtime.exports, window)
  return { ...runtime.exports, failures: window.failures }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { resolve, promise } }
test('shared favorite queue preserves distinct projects and blocks repeated clicks while a write is pending', async () => {
  let records: any[] = [], calls = 0
  const blocked = deferred<void>()
  const runtime = await favoriteRuntime(async (channel, value, enabled) => {
    if (channel === 'mods:favorites') return records
    calls++; if (calls === 1) await blocked.promise
    records = records.filter(record => record.key !== value.source + ':' + value.projectId)
    if (enabled) records.push({ ...value, key: value.source + ':' + value.projectId })
    return [...records]
  })
  const first = runtime.toggleProject('modrinth', 'a', 'A')
  const repeated = runtime.toggleProject('modrinth', 'a', 'A')
  const second = runtime.toggleProject('curseforge', 'b', 'B')
  await tick(); assert.equal(calls, 1); assert.equal(await repeated, false)
  assert(runtime.favoriteBusy.value.has('modrinth:a')); blocked.resolve()
  assert.equal(await first, true); assert.equal(await second, true)
  assert.deepEqual(runtime.favorites.value.map((record: any) => record.key), ['modrinth:a', 'curseforge:b'])
  assert.equal(runtime.favoriteBusy.value.size, 0)
})
test('newest favorite reads win and initial reads precede startup toggles of existing favorites', async () => {
  const older = deferred<any[]>(), newer = deferred<any[]>(); let reads = 0
  const runtime = await favoriteRuntime(async () => ++reads === 1 ? older.promise : newer.promise)
  const first = runtime.loadFavorites(), second = runtime.loadFavorites()
  await tick(); newer.resolve([{ key: 'modrinth:latest' }]); await second
  older.resolve([]); await first
  assert.equal(runtime.favorites.value[0].key, 'modrinth:latest')
  const initial = deferred<any[]>(); let enabled: unknown
  const startup = await favoriteRuntime(async (channel, _value, on) => { if (channel === 'mods:favorites') return initial.promise; enabled = on; return [] })
  const load = startup.loadFavorites(), toggle = startup.toggleProject('modrinth', 'existing', 'Existing')
  initial.resolve([{ key: 'modrinth:existing' }]); await Promise.all([load, toggle])
  assert.equal(enabled, false)
})
test('favorite write failure retains the confirmed snapshot and allows retry', async () => {
  let fail = true
  const runtime = await favoriteRuntime(async () => { if (fail) throw new Error('写盘失败'); return [{ key: 'modrinth:a' }] })
  assert.equal(await runtime.toggleProject('modrinth', 'a', 'A'), false)
  assert.deepEqual(runtime.favorites.value, []); assert.equal(runtime.favoriteBusy.value.size, 0)
  assert.deepEqual(runtime.failures, ['写盘失败'])
  fail = false; assert.equal(await runtime.toggleProject('modrinth', 'a', 'A'), true)
  assert.equal(runtime.favorites.value[0].key, 'modrinth:a')
})
test('reading during a queued startup write does not reverse the requested toggle', async () => {
  const read = deferred<any[]>(); let on: unknown, records = [{ key: 'modrinth:existing' }], calls = 0
  const runtime = await favoriteRuntime(async (channel, _value, enabled) => {
    if (channel === 'mods:favorites') return ++calls === 1 ? read.promise : records
    on = enabled; records = []; return records
  })
  const initial = runtime.loadFavorites(), toggle = runtime.toggleProject('modrinth', 'existing', 'Existing'), later = runtime.loadFavorites()
  read.resolve(records); await Promise.all([initial, toggle, later])
  assert.equal(on, false); assert.deepEqual(runtime.favorites.value, [])
})
