import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import AdmZip from 'adm-zip'

let coreCode: Promise<string>
let applyCode: Promise<string>
type Faults = { rename?: (source: string, dest: string) => void; write?: (file: string, data: unknown) => void }
async function runtime(t: any) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-resourcepacks-118-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  coreCode ??= build({ entryPoints: ['src/main/core/defaultResourcePacks.ts'], platform: 'node', format: 'cjs', bundle: true, write: false, packages: 'external' }).then(result => result.outputFiles[0].text)
  const require = createRequire(path.resolve('package.json')), mod = { exports: {} as any }, faults: Faults = {}
  const mockFs = { ...fs,
    renameSync(source: string, dest: string) { faults.rename?.(String(source), String(dest)); fs.renameSync(source, dest) },
    writeFileSync(file: string, data: unknown, options?: any) { faults.write?.(String(file), data); fs.writeFileSync(file, data as any, options) }
  }
  new Function('require', 'module', 'exports', await coreCode)(
    (name: string) => name === 'electron' ? { app: { getPath: () => root } } : name === 'node:fs' ? mockFs : require(name), mod, mod.exports)
  return { root, api: mod.exports, faults }
}
function pack(file: string, format: any = { pack_format: 75, min_format: 1, max_format: 1000 }, marker = path.basename(file)) {
  const zip = new AdmZip()
  zip.addFile('pack.mcmeta', Buffer.from('\uFEFF' + JSON.stringify({ pack: { ...format, description: marker } })))
  zip.addFile('assets/minecraft/fixture.txt', Buffer.from(marker))
  zip.writeZip(file)
}
function client(root: string, pack_version: any) {
  const file = path.join(root, 'fixture-client.jar'), zip = new AdmZip()
  zip.addFile('version.json', Buffer.from(JSON.stringify({ id: '26.2', pack_version }))); zip.writeZip(file)
  return file
}
const filename = (p: any) => `KAMUCL-default-${p.id}-${p.name}`
const name = (p: any, legacy = false) => (legacy ? '' : 'file/') + filename(p)
const stateFile = (game: string) => path.join(game, '.kamucl-default-resourcepacks.json')
const optionsFile = (game: string) => path.join(game, 'options.txt')
const options = (game: string) => fs.readFileSync(optionsFile(game), 'utf8')
const selected = (game: string, key = 'resourcePacks') => JSON.parse(options(game).replace(/^\uFEFF/, '').split(/\r?\n/).find(line => line.startsWith(key + ':'))!.slice(key.length + 1))
function writeChoice(game: string, packs: string[], incompatible: string[] = []) {
  fs.mkdirSync(game, { recursive: true })
  const text = `lang:zh_cn\nresourcePacks:${JSON.stringify(packs)}\nincompatibleResourcePacks:${JSON.stringify(incompatible)}\ncustom:keep\n`
  fs.writeFileSync(optionsFile(game), text)
  return text
}
function importPair(root: string, api: any) {
  const a = path.join(root, '§6中文 A 包.zip'), b = path.join(root, 'B with spaces.zip')
  pack(a); pack(b)
  return api.importDefaultResourcePacks([a, b])
}

test('new instances apply defaults once, then preserve in-game enablement, order and overrides across global changes', async t => {
  const { root, api } = await runtime(t), [a, b] = importPair(root, api)
  for (const mc of ['1.12.2', '26.2']) {
    const game = path.join(root, '实例 § 世界 ' + mc), legacy = mc === '1.12.2'
    fs.mkdirSync(game); fs.writeFileSync(optionsFile(game), 'lang:zh_cn\n')
    assert.equal(api.syncDefaultResourcePacks(game, mc), 2)
    assert.deepEqual(selected(game), ['vanilla', name(a, legacy), name(b, legacy)])
    assert(fs.existsSync(path.join(game, 'resourcepacks', filename(a))))
    const choice = writeChoice(game, ['vanilla', name(b, legacy), 'file/个人 § 资源包.zip'], [name(b, legacy)])
    api.moveDefaultResourcePack(b.id, -1); api.setDefaultResourcePackEnabled(b.id, false)
    const cfile = path.join(root, '新增 C ' + mc + '.zip'); pack(cfile)
    const c = api.importDefaultResourcePacks([cfile]).at(-1)
    api.syncDefaultResourcePacks(game, mc)
    assert.equal(options(game), choice)
    assert(fs.existsSync(path.join(game, 'resourcepacks', filename(c))), 'new default is available without being selected')
    assert(!selected(game).includes(name(c, legacy)))
    api.setDefaultResourcePackEnabled(b.id, true)
    const state = fs.readFileSync(stateFile(game), 'utf8')
    api.syncDefaultResourcePacks(game, mc)
    assert.equal(options(game), choice); assert.equal(fs.readFileSync(stateFile(game), 'utf8'), state)
    // Remove the extra default so each MC fixture starts with the same pair.
    api.removeDefaultResourcePack(c.id); api.moveDefaultResourcePack(a.id, -1)
  }
})

test('upgrade migrates legacy state without re-enabling disabled packs or removing selected global-disabled packs', async t => {
  const { root, api } = await runtime(t), [a, b] = importPair(root, api), game = path.join(root, '升级实例')
  const before = writeChoice(game, ['vanilla', name(b), 'file/Personal.zip'], [name(b), 'file/Personal.zip'])
  fs.writeFileSync(stateFile(game), JSON.stringify([name(a), name(b)]))
  api.setDefaultResourcePackEnabled(b.id, false)
  api.syncDefaultResourcePacks(game, '26.2')
  assert.equal(options(game), before)
  assert.equal(JSON.parse(fs.readFileSync(stateFile(game), 'utf8')).version, 2)
  api.removeDefaultResourcePack(b.id)
  api.syncDefaultResourcePacks(game, '26.2')
  assert.equal(options(game), before)
  api.applyDefaultResourcePacks(game, '26.2')
  assert.deepEqual(selected(game), ['vanilla', 'file/Personal.zip', name(a)])
  assert.deepEqual(selected(game, 'incompatibleResourcePacks'), ['file/Personal.zip'])
  assert(fs.existsSync(path.join(root, b.name)), 'original ZIP survives global removal')
})

test('explicit existing empty, vanilla-only and custom selections survive upgrade even without a launcher state file', async t => {
  const { root, api } = await runtime(t), [a] = importPair(root, api)
  for (const [index, selection] of [[], ['vanilla'], ['vanilla', name(a), 'file/Custom.zip']].entries()) {
    const game = path.join(root, String(index)), before = writeChoice(game, selection, ['file/Custom.zip'])
    api.syncDefaultResourcePacks(game, '26.2')
    assert.equal(options(game), before)
    assert.equal(JSON.parse(fs.readFileSync(stateFile(game), 'utf8')).version, 2)
  }
})

test('launch snapshot distinguishes fresh high-contrast defaults from an existing explicit choice and is ignored after initialization', async t => {
  const { root, api } = await runtime(t), [a, b] = importPair(root, api)
  const fresh = path.join(root, 'fresh'), existing = path.join(root, 'existing')
  writeChoice(fresh, ['high_contrast']); const before = writeChoice(existing, ['vanilla', 'high_contrast'])
  api.syncDefaultResourcePacks(fresh, '26.2', undefined, { resourcePacksConfigured: false })
  assert.deepEqual(selected(fresh), ['high_contrast', name(a), name(b)])
  const inGame = writeChoice(fresh, ['vanilla'])
  api.syncDefaultResourcePacks(fresh, '26.2', undefined, { resourcePacksConfigured: false })
  assert.equal(options(fresh), inGame, 'state overrides subsequent launch initialization flags')
  api.syncDefaultResourcePacks(existing, '26.2', undefined, { resourcePacksConfigured: true })
  assert.equal(options(existing), before)
})

test('manual reapply preserves unrelated values, blank lines, BOM and CRLF while replacing both old and modern managed aliases in current priority order', async t => {
  const { root, api } = await runtime(t), [a, b] = importPair(root, api), game = path.join(root, 'manual')
  fs.mkdirSync(game)
  const before = '\uFEFFlang:zh_cn\r\n\r\nresourcePacks:' + JSON.stringify(['vanilla', name(a, true), 'file/个人 § 资源包.zip', name(b), 'high_contrast']) + '\r\nincompatibleResourcePacks:' + JSON.stringify([name(a, true), name(b), 'file/个人 § 资源包.zip']) + '\r\ncustom:keep\r\n'
  fs.writeFileSync(optionsFile(game), before)
  fs.writeFileSync(stateFile(game), JSON.stringify([name(a, true), name(b)]))
  api.moveDefaultResourcePack(a.id, 1)
  const jar = client(root, { resource_major: 88, resource_minor: 1 })
  api.applyDefaultResourcePacks(game, '26.2', jar)
  assert.deepEqual(selected(game), ['vanilla', 'file/个人 § 资源包.zip', 'high_contrast', name(b), name(a)])
  assert.deepEqual(selected(game, 'incompatibleResourcePacks'), ['file/个人 § 资源包.zip'])
  assert(options(game).startsWith('\uFEFFlang:zh_cn\r\n\r\n')); assert(options(game).endsWith('custom:keep\r\n'))
  assert.equal(fs.readFileSync(optionsFile(game) + '.before-default-packs', 'utf8'), before)
  const reapplied = options(game)
  api.syncDefaultResourcePacks(game, '26.2', jar)
  assert.equal(options(game), reapplied)
})

test('manual disabling/removing defaults only removes managed selection; instance and source files are retained', async t => {
  const { root, api } = await runtime(t), [a, b] = importPair(root, api), game = path.join(root, 'retained')
  api.syncDefaultResourcePacks(game, '26.2')
  api.setDefaultResourcePackEnabled(a.id, false); api.removeDefaultResourcePack(b.id)
  const before = options(game)
  api.syncDefaultResourcePacks(game, '26.2'); assert.equal(options(game), before)
  assert.equal(api.applyDefaultResourcePacks(game, '26.2'), 0)
  assert.deepEqual(selected(game), ['vanilla'])
  assert.deepEqual(selected(game, 'incompatibleResourcePacks'), [])
  assert.deepEqual(fs.readdirSync(path.join(game, 'resourcepacks')).sort(), [filename(a), filename(b)].sort())
  assert(fs.existsSync(path.join(root, a.name)) && fs.existsSync(path.join(root, b.name)))
})

test('resource compatibility uses classic pack format, supported range and new major/minor bounds, and unknown clients invent no override', async t => {
  const { root, api } = await runtime(t)
  const compatible: Array<[any, [number, number]]> = [
    [{ pack_format: 3, supported_formats: [1, 1000] }, [3, 0]],
    [{ pack_format: 15, supported_formats: 34 }, [34, 0]],
    [{ pack_format: 15, supported_formats: [15, 34] }, [34, 0]],
    [{ pack_format: 15, supported_formats: { min_inclusive: 15, max_inclusive: 34 } }, [18, 0]],
    [{ min_format: [88, 0], max_format: 88 }, [88, 1]],
    [{ min_format: [88], max_format: [88] }, [88, 1]],
    [{ min_format: 88, max_format: [88, 1] }, [88, 1]]
  ]
  for (const [meta, target] of compatible) assert.equal(api.resourcePackIncompatible(meta, target), false, JSON.stringify(meta))
  assert(api.resourcePackIncompatible({ pack_format: 4 }, [3, 0]))
  assert(api.resourcePackIncompatible({ pack_format: 15, supported_formats: [15, 34] }, [35, 0]))
  assert(api.resourcePackIncompatible({ min_format: [88, 1], max_format: 88 }, [88, 0]))
  assert(api.resourcePackIncompatible({ min_format: [88, 0], max_format: [88, 0] }, [88, 1]))
  assert.equal(api.resourcePackIncompatible({ pack_format: 1 }, null), false)
  assert.deepEqual(api.readClientResourceFormat(client(root, { resource: 15 })), [15, 0])
  assert.deepEqual(api.readClientResourceFormat(client(root, { resource_major: 88, resource_minor: 1 })), [88, 1])
  assert.equal(api.readClientResourceFormat(path.join(root, 'missing.jar')), null)
  const file = path.join(root, 'new format only.zip'); pack(file, { min_format: [88, 0], max_format: [88, 0] })
  const [p] = api.importDefaultResourcePacks([file]), game = path.join(root, 'incompatible')
  api.syncDefaultResourcePacks(game, '26.2', client(root, { resource_major: 88, resource_minor: 1 }))
  assert.deepEqual(selected(game, 'incompatibleResourcePacks'), [name(p)])
  const choice = writeChoice(game, ['vanilla', name(p)], [])
  api.syncDefaultResourcePacks(game, '26.2', client(root, { resource_major: 88, resource_minor: 1 }))
  assert.equal(options(game), choice, 'game-selected override consent is preserved on subsequent launches')
})

test('malformed options and malformed state fail before copies or writes and preserve the original bytes', async t => {
  const { root, api } = await runtime(t); importPair(root, api)
  const cases = [
    ['resourcePacks:damaged\n', undefined],
    ['resourcePacks:[1]\n', undefined],
    ['resourcePacks:[]\nincompatibleResourcePacks:{}\n', undefined],
    ['resourcePacks:[]\nresourcePacks:["vanilla"]\n', undefined],
    ['resourcePacks:[]\n', '{damaged'],
    ['resourcePacks:[]\n', '{"version":9,"managed":[]}'],
    ['resourcePacks:[]\n', '["file/Personal.zip"]']
  ]
  for (const [index, [text, state]] of cases.entries()) {
    const game = path.join(root, 'invalid-' + index); fs.mkdirSync(game); fs.writeFileSync(optionsFile(game), text!)
    if (state !== undefined) fs.writeFileSync(stateFile(game), state)
    assert.throws(() => api.syncDefaultResourcePacks(game, '26.2'), /格式无效|损坏|重复/)
    assert.equal(options(game), text); assert(!fs.existsSync(path.join(game, 'resourcepacks')))
    assert.equal(fs.existsSync(stateFile(game)), state !== undefined)
    if (state !== undefined) assert.equal(fs.readFileSync(stateFile(game), 'utf8'), state)
  }
})

test('modified pack sources or instance copies are never overwritten and preflight prevents partial batch changes', async t => {
  const { root, api } = await runtime(t), [a, b] = importPair(root, api), game = path.join(root, 'hash')
  const before = writeChoice(game, ['vanilla'])
  fs.mkdirSync(path.join(game, 'resourcepacks'))
  const modified = path.join(game, 'resourcepacks', filename(b)); fs.writeFileSync(modified, 'user modified')
  assert.throws(() => api.applyDefaultResourcePacks(game, '26.2'), /副本被修改/)
  assert.equal(options(game), before); assert.equal(fs.readFileSync(modified, 'utf8'), 'user modified')
  assert(!fs.existsSync(path.join(game, 'resourcepacks', filename(a)))); assert(!fs.existsSync(stateFile(game)))
  fs.writeFileSync(path.join(root, 'default-resourcepacks', a.id + '.zip'), 'changed cache')
  assert.throws(() => api.syncDefaultResourcePacks(path.join(root, 'source'), '26.2'), /缓存.*被修改/)
  assert(!fs.existsSync(path.join(root, 'source')))
})

test('atomic transaction restores options and state after publishing either file fails; copied ZIPs remain recoverable', async t => {
  for (const failFile of ['options.txt', '.kamucl-default-resourcepacks.json']) {
    const { root, api, faults } = await runtime(t); importPair(root, api)
    const game = path.join(root, 'rollback'), before = writeChoice(game, ['vanilla', 'file/Personal.zip'])
    fs.writeFileSync(stateFile(game), '[]')
    let failed = false
    faults.rename = (_source, dest) => { if (!failed && path.basename(dest) === failFile) { failed = true; throw new Error('fixture rename failure') } }
    assert.throws(() => api.applyDefaultResourcePacks(game, '26.2'), /fixture rename failure/)
    assert(failed); assert.equal(options(game), before); assert.equal(fs.readFileSync(stateFile(game), 'utf8'), '[]')
    assert.equal(fs.readdirSync(path.join(game, 'resourcepacks')).length, 2)
    assert(!fs.readdirSync(game).some(file => file.endsWith('.tmp')), 'successful rollback removes staging files')
    faults.rename = undefined
    api.applyDefaultResourcePacks(game, '26.2')
    assert.equal(selected(game).length, 4)
  }
})

test('staging failure publishes neither configuration and a concurrent options edit is detected without overwriting it', async t => {
  const { root, api, faults } = await runtime(t); importPair(root, api)
  const game = path.join(root, 'stage'), before = writeChoice(game, ['vanilla'])
  faults.write = (file) => { if (file.startsWith(stateFile(game) + '.kamucl-write-')) throw new Error('fixture state stage failure') }
  assert.throws(() => api.applyDefaultResourcePacks(game, '26.2'), /fixture state stage failure/)
  assert.equal(options(game), before); assert(!fs.existsSync(stateFile(game)))
  const concurrent = 'resourcePacks:["vanilla","file/NewChoice.zip"]\ncustom:new\n'
  let edited = false
  faults.write = file => { if (!edited && file.startsWith(stateFile(game) + '.kamucl-write-')) { edited = true; fs.writeFileSync(optionsFile(game), concurrent) } }
  assert.throws(() => api.applyDefaultResourcePacks(game, '26.2'), /操作期间发生变化/)
  assert(edited); assert.equal(options(game), concurrent); assert(!fs.existsSync(stateFile(game)))
})

test('a failed rollback never clobbers a concurrently edited options file and retains the original recovery snapshot', async t => {
  const { root, api, faults } = await runtime(t); importPair(root, api)
  const game = path.join(root, 'recovery'), before = writeChoice(game, ['vanilla'])
  let edited = false
  const concurrent = 'resourcePacks:["vanilla","file/LateChoice.zip"]\n'
  faults.rename = (_source, dest) => { if (!edited && dest === stateFile(game)) { edited = true; fs.writeFileSync(optionsFile(game), concurrent); throw new Error('fixture state publish failure') } }
  assert.throws(() => api.applyDefaultResourcePacks(game, '26.2'), /无法回滚/)
  assert.equal(options(game), concurrent)
  const recovery = fs.readdirSync(game).filter(file => file.startsWith('options.txt.kamucl-write-') && file.endsWith('.tmp'))
  assert.equal(recovery.length, 1); assert.equal(fs.readFileSync(path.join(game, recovery[0]), 'utf8'), before)
})

async function applyRuntime(t: any) {
  const fixture = await runtime(t)
  applyCode ??= build({ entryPoints: ['src/main/core/defaultResourcePackApply.ts'], platform: 'node', format: 'cjs', bundle: true, write: false, packages: 'external', plugins: [{ name: 'instance-boundary', setup(builder) {
    builder.onResolve({ filter: /^\.\/(?:instanceCenter|launchUiState|paths|versions)$/ }, args => args.importer.endsWith('defaultResourcePackApply.ts') ? { path: 'qa:' + args.path.slice(2), external: true } : undefined)
  } }] }).then(result => result.outputFiles[0].text)
  const game = path.join(fixture.root, 'chosen actual 游戏目录'), folder = path.join(fixture.root, 'registered folder')
  fs.mkdirSync(game); fs.mkdirSync(folder)
  const before = writeChoice(game, ['vanilla', 'file/Personal.zip']); importPair(fixture.root, fixture.api)
  const require = createRequire(path.resolve('package.json')), mod = { exports: {} as any }
  const status = { active: [] as any[], idleError: '', calls: [] as string[], scopedFolder: '', isolated: true, metadata: { id: 'named fixture', _mcVersion: '26.2' } }
  const modules: Record<string, any> = {
    'qa:instanceCenter': {
      centerTarget: (target: any) => {
        assert.equal(target.folder, folder); assert.equal(target.id, 'named fixture')
        return { folder, dir: game, json: status.metadata, state: { isolated: status.isolated } }
      },
      assertInstanceIdle: async (dir: string) => { status.calls.push(dir); if (status.idleError) throw new Error(status.idleError) }
    },
    'qa:launchUiState': { activeLaunchStates: () => status.active },
    'qa:paths': { withGameFolder: (chosen: string, fn: () => any) => { status.scopedFolder = chosen; try { return fn() } finally { status.scopedFolder = '' } } },
    'qa:versions': { readVersionJson: () => status.metadata, resolveVersionChain: () => ({ baseId: 'base' }), clientJarPath: (id: string) => { assert.equal(status.scopedFolder, folder); assert.equal(id, 'base'); return client(fixture.root, { resource_major: 88, resource_minor: 0 }) } }
  }
  new Function('require', 'module', 'exports', await applyCode)(
    (name: string) => modules[name] ?? (name === 'electron' ? { app: { getPath: () => fixture.root } } : require(name)), mod, mod.exports)
  return { ...fixture, apply: mod.exports.applyDefaultResourcePacksToInstance, game, folder, before, status }
}

test('manual instance entry rejects launching/running or externally used directories before writes and re-enables retry after failure', async t => {
  const { apply, game, folder, before, status } = await applyRuntime(t), target = { folder, id: 'named fixture' }
  status.active = [{ folder, versionId: target.id, status: 'launching' }]
  await assert.rejects(apply(target), /正在启动或运行/); assert.equal(options(game), before); assert.equal(status.calls.length, 0)
  status.active = []; status.idleError = '另一个启动器的游戏正在使用此目录'
  await assert.rejects(apply(target), /另一个启动器/); assert.equal(options(game), before); assert(!fs.existsSync(stateFile(game)))
  status.idleError = ''; status.isolated = false
  assert.deepEqual(await apply(target), { count: 2, shared: true })
  assert.equal(selected(game).length, 4); assert.equal(status.scopedFolder, '')
})

test('manual entry refuses unknown instance version and malformed target without using a fallback directory', async t => {
  const { apply, game, folder, before, status } = await applyRuntime(t)
  // Evidence also reads the fixture JAR; block it with a broken inheritance chain.
  status.metadata = { id: 'named fixture', _mcVersion: '26.2', inheritsFrom: 'named fixture' } as any
  await assert.rejects(apply({ folder, id: 'named fixture' }), /修复版本描述/)
  await assert.rejects(apply(null), /请选择有效/)
  assert.equal(options(game), before); assert(!fs.existsSync(stateFile(game)))
})

test('manual reapply retains existing incompatibility consent when an old client JAR provides no format evidence', async t => {
  const { root, api } = await runtime(t), [a, b] = importPair(root, api), game = path.join(root, 'no-client-evidence')
  writeChoice(game, ['vanilla', name(a, true), 'file/Personal.zip'], [name(a, true), 'file/Personal.zip'])
  fs.writeFileSync(stateFile(game), JSON.stringify([name(a, true), name(b, true)]))
  api.applyDefaultResourcePacks(game, '1.12.2', path.join(root, 'missing-old-client.jar'))
  assert.deepEqual(selected(game, 'incompatibleResourcePacks'), ['file/Personal.zip', name(a, true)])
})

test('long Unicode source filenames import without splitting characters or exceeding a Windows destination filename component', async t => {
  const { root, api } = await runtime(t), file = path.join(root, '😀'.repeat(118) + '.zip')
  pack(file)
  const [p] = api.importDefaultResourcePacks([file]), game = path.join(root, 'long name')
  assert(p.name.length <= 154); assert(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(p.name))
  api.syncDefaultResourcePacks(game, '26.2')
  assert(fs.existsSync(path.join(game, 'resourcepacks', filename(p))))
  assert.deepEqual(selected(game), ['vanilla', name(p)])
})
