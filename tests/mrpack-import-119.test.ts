import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import zlib from 'node:zlib'
import AdmZip from 'adm-zip'
import { parse } from '@vue/compiler-sfc'
import { transformSync } from 'esbuild'
import ts from 'typescript'
import { probeImport } from '../src/main/core/importProbe'
import { probeModpack } from '../src/main/core/modpacks'
import { writeNbt } from '../src/main/core/nbt'
import { acceptsImportDrag } from '../src/shared/dropIntent'
import { versionInstallHarness } from './helpers/version-install-harness'

const index = () => ({
  formatVersion: 1, game: 'minecraft', name: 'MRPACK 中文 § compatibility', versionId: 'fixture-119',
  dependencies: { minecraft: '1.20.1' }, files: [] as Record<string, unknown>[]
})
const hash = (algorithm: string, bytes: Buffer) => crypto.createHash(algorithm).update(bytes).digest('hex')
const manifest = (value: unknown, bom = false) => Buffer.from((bom ? '\uFEFF' : '') + JSON.stringify(value))
const world = () => zlib.gzipSync(writeNbt({ Data: { LevelName: 'MRPACK synthetic fixture', DataVersion: 3465, Version: { Name: '1.20.1', Id: 3465 } } }))
function archive(value: unknown, bom = false) {
  const zip = new AdmZip()
  zip.addFile('modrinth.index.json', manifest(value, bom))
  zip.addFile('overrides/config/中文 § setting.txt', Buffer.from('common'))
  return zip
}
async function fixture(run: (root: string) => Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-mrpack119-'))
  try { await run(root) }
  finally {
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'kamucl-mrpack119-'))
    fs.rmSync(root, { recursive: true, force: true })
  }
}

/** Execute App's real private callbacks with native Event cancellation. Other
 * UI actions are observers; classification still uses the production probe.
 * This is a callback regression, not a Vue mount or native GUI claim. */
function dropHarness(view: string) {
  const file = 'src/renderer/src/App.vue', descriptor = parse(fs.readFileSync(file, 'utf8'), { filename: file }).descriptor
  const source = ts.createSourceFile(file, descriptor.scriptSetup!.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const functions = new Set(['onDrop', 'routeSingleImport', 'endDrag'])
  const variables = new Set(['resourceDropPage', 'dragHasFiles', 'dragHasSupportedData', 'looksLikeYggdrasilProvider'])
  const statements = source.statements.filter(statement =>
    ts.isFunctionDeclaration(statement) && functions.has(statement.name?.text ?? '') ||
    ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && variables.has(declaration.name.text)))
  assert.equal(statements.length, functions.size + variables.size, 'test must execute every selected production declaration')
  const code = transformSync(statements.map(statement => statement.getText(source)).join('\n'), { loader: 'ts', target: 'es2022' }).code
  const paths = new WeakMap<object, string>()
  const state = { resourceCalls: 0, stopped: false, modalCalls: 0, worldOpened: false, modOpened: false }
  let complete: (result: { kind: string; file?: string; info?: unknown; message?: string }) => void = () => { throw new Error('unexpected drop completion') }
  const window = { kamucl: { getFilePath: (file: object) => paths.get(file)! } }
  const store = { currentView: view, editMode: false, resourceDropHandler: () => { state.resourceCalls++; complete({ kind: 'resource' }) } }
  const worldModal = new Proxy({ open: false }, { set(target, key, value) { Reflect.set(target, key, value); if (key === 'open' && value) { state.worldOpened = true; complete({ kind: 'world' }) } return true } })
  const modDrop = new Proxy({ open: false, files: [] }, { set(target, key, value) { Reflect.set(target, key, value); if (key === 'open' && value) { state.modOpened = true; complete({ kind: 'mod' }) } return true } })
  const callbacks = new Function('environment', `
    const { store, window, probeImport, acceptsImportDrag, openModpackImport, toast, errText, routeYggdrasilImport, modDrop, worldModal } = environment;
    let importProbeRevision = 0, internalDrag = false, dragDepth = 0;
    const dragActive = { value: false }, dlOpen = { value: true }, noticeOpen = { value: true };
    ${code}
    return { onDrop };
  `)({ store, window, probeImport, acceptsImportDrag, modDrop, worldModal,
    openModpackImport: async (file: string, info: unknown) => { state.modalCalls++; complete({ kind: 'modpack', file, info }) },
    toast: (message: string) => complete({ kind: 'toast', message }),
    errText: (error: unknown) => error instanceof Error ? error.message : String(error),
    routeYggdrasilImport: () => complete({ kind: 'provider' })
  })
  return { state, close: () => {}, drop: async (files: string[]) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = new Promise<{ kind: string; file?: string; info?: unknown; message?: string }>((resolve, reject) => {
        complete = resolve; timer = setTimeout(() => reject(new Error('actual App drop callback did not route the import')), 1500)
      })
      const event = new Event('drop', { bubbles: true, cancelable: true })
      const dropped = files.map(file => { const item = new File([], path.basename(file)); paths.set(item, file); return item })
      Object.defineProperty(event, 'dataTransfer', { value: { files: dropped, types: ['Files'] } })
      callbacks.onDrop(event)
      state.stopped = event.cancelBubble
      return await result
    } finally { clearTimeout(timer) }
  } }
}

test('actual single MRPACK drop callback uses the unified production probe on home and every local resource page', async () => {
  await fixture(async root => {
    const file = path.join(root, 'synthetic.MRPACK'); archive(index()).writeZip(file)
    for (const page of ['home', 'keys', 'mods', 'packs', 'shaders']) {
      const drop = dropHarness(page)
      try {
        const result = await drop.drop([file])
        assert.equal(result.kind, 'modpack', page)
        assert.equal(result.file, file)
        assert.equal(drop.state.resourceCalls, 0)
        assert.equal(drop.state.modalCalls, 1)
        if (page !== 'home') assert.equal(drop.state.stopped, true, 'stop propagation before a resource target can process the MRPACK again')
      } finally { drop.close() }
    }
  })
})

test('actual resource-page MRPACK drop never downgrades a malformed manifest to its bundled world or a local resource', async () => {
  await fixture(async root => {
    const file = path.join(root, 'broken.mrpack'), zip = new AdmZip()
    zip.addFile('modrinth.index.json', Buffer.from('\uFEFF{broken'))
    zip.addFile('overrides/saves/world/level.dat', world()); zip.writeZip(file)
    const drop = dropHarness('packs')
    try {
      const result = await drop.drop([file])
      assert.equal(result.kind, 'toast')
      assert.match(result.message!, /导入识别失败.*modrinth.index.json 已损坏/)
      assert.equal(drop.state.resourceCalls + drop.state.modalCalls, 0)
      assert.equal(drop.state.stopped, true)
      assert.equal(drop.state.worldOpened || drop.state.modOpened, false)
    } finally { drop.close() }
  })
})

test('actual drop callback retains ordinary local multi-file drops and rejects mixed MRPACK batches without partial import', async () => {
  for (const [page, names] of [['mods', ['a.jar', 'b.jar']], ['packs', ['a.zip', 'b.zip']], ['keys', ['a.zip', 'b.zip']], ['shaders', ['a.zip', 'b.zip']]] as const) {
    const drop = dropHarness(page)
    try {
      assert.equal((await drop.drop(names.map(name => path.resolve(name)))).kind, 'resource')
      assert.equal(drop.state.resourceCalls, 1)
      assert.equal(drop.state.modalCalls, 0)
      assert.equal(drop.state.stopped, true)
    } finally { drop.close() }
  }
  const mixed = dropHarness('packs')
  try {
    const result = await mixed.drop([path.resolve('fixture.MRPACK'), path.resolve('ordinary.zip')])
    assert.equal(result.kind, 'toast')
    assert.match(result.message!, /一次导入一个文件/)
    assert.equal(mixed.state.resourceCalls + mixed.state.modalCalls, 0)
    assert.equal(mixed.state.stopped, true)
  } finally { mixed.close() }
})

test('standard MRPACK already imports through the production classifier, including uppercase extension and all supported loaders', async () => {
  await fixture(async root => {
    for (const [dependency, loader, version] of [['fabric-loader', 'fabric', '0.15.11'], ['quilt-loader', 'quilt', '0.24.0'], ['forge', 'forge', '47.4.23'], ['neoforge', 'neoforge', '20.1.115']] as const) {
      const file = path.join(root, dependency + '.MRPACK'), value = index()
      Object.assign(value.dependencies, { [dependency]: version, 'future-component': 'future-version' })
      archive(value).writeZip(file)
      const before = fs.readFileSync(file), result = await probeImport(file)
      assert.equal(result.kind, 'modpack')
      if (result.kind !== 'modpack') throw new Error('MRPACK must select the whole pack')
      assert.equal(result.info.format, 'mrpack')
      assert.equal(result.info.innerName, value.name)
      assert.equal(result.info.loader, loader)
      assert.equal(result.info.loaderVersion, version)
      assert.equal(result.info.hasOverrides, true)
      assert.deepEqual(fs.readFileSync(file), before)
    }
  })
})

test('UTF-8 BOM MRPACK manifests work through direct, renamed ZIP and nested pack import without altering originals', async () => {
  await fixture(async root => {
    for (const extension of ['.mrpack', '.MRPACK', '.zip']) {
      const file = path.join(root, 'UTF-8 中文' + extension)
      const zip = archive(index(), true)
      zip.addFile('overrides/saves/world/level.dat', world())
      zip.writeZip(file)
      const before = fs.readFileSync(file), result = await probeImport(file)
      assert.equal(result.kind, 'modpack')
      if (result.kind !== 'modpack') throw new Error('BOM manifest must remain a pack')
      assert.equal(result.info.innerName, index().name)
      assert.deepEqual(fs.readFileSync(file), before)
    }
    const outer = new AdmZip(), file = path.join(root, 'distribution.zip')
    outer.addFile('packs/inner.mrpack', archive(index(), true).toBuffer())
    outer.addFile('launcher.exe', Buffer.from('synthetic excluded launcher'))
    outer.writeZip(file)
    const before = fs.readFileSync(file)
    assert.equal((await probeImport(file)).kind, 'modpack')
    assert.deepEqual(fs.readFileSync(file), before)
  })
})

test('BOM tolerance never accepts malformed JSON, unsafe paths or missing integrity hashes', async () => {
  await fixture(async root => {
    const broken = new AdmZip(), file = path.join(root, 'bad.mrpack')
    broken.addFile('modrinth.index.json', Buffer.from('\uFEFF{broken'))
    broken.addFile('overrides/saves/world/level.dat', world())
    for (const extension of ['.mrpack', '.zip']) {
      const input = path.join(root, 'broken' + extension); broken.writeZip(input)
      const before = fs.readFileSync(input)
      await assert.rejects(probeModpack(input), /modrinth.index.json 已损坏/)
      await assert.rejects(probeImport(input), /modrinth.index.json 已损坏/)
      assert.deepEqual(fs.readFileSync(input), before)
    }
    const valid = { path: 'mods/fixture.jar', hashes: { sha1: 'a'.repeat(40) }, downloads: ['https://example.invalid/fixture.jar'], fileSize: 1 }
    for (const [patch, error] of [[{ path: '../escape.jar' }, /路径不安全/], [{ hashes: {} }, /缺少 SHA1\/SHA512/]] as const) {
      const value = index(); value.files = [{ ...valid, ...patch }]
      archive(value, true).writeZip(file)
      const before = fs.readFileSync(file)
      await assert.rejects(probeImport(file), error)
      assert.deepEqual(fs.readFileSync(file), before)
    }
  })
})

test('MRPACK destination aliases reject before any runtime/download preparation or instance writes', async () => {
  await fixture(async root => {
    const game = path.join(root, 'games'); fs.mkdirSync(game)
    let metadataCalls = 0, downloadCalls = 0
    const runtime = await versionInstallHarness(root,
      async () => { metadataCalls++; throw new Error('unexpected runtime preparation') },
      () => { downloadCalls++; throw new Error('unexpected payload download') })
    Object.assign(runtime.getSettings(), { gameDir: game, activeFolder: game, folders: [{ path: game, name: 'fixture', isDefault: true }], defaultIsolation: true })
    const aliases = [
      ['mods/a.jar', 'mods//a.jar'],
      ['mods/sub/a.jar', 'mods//sub///a.jar'],
      ['mods/a.jar', 'mods\\/a.jar'],
      ['mods/a.jar', './mods/a.jar'],
      ['mods/a.jar', 'mods/a.jar//'],
      ['mods/中文 § 包.jar', 'mods//中文 § 包.jar']
    ]
    if (process.platform === 'win32') aliases.push(['mods/a.jar', 'MODS///A.JAR'])
    try {
      for (const [first, second] of aliases) {
        const value = index()
        value.files = [first, second].map((file, i) => {
          const bytes = Buffer.from(`different verified payload ${i}`)
          return { path: file, hashes: { sha1: hash('sha1', bytes), sha512: hash('sha512', bytes) }, downloads: [`https://mrpack-fixture.invalid/payload-${i}`], fileSize: bytes.length }
        })
        const input = path.join(root, 'aliases.mrpack'); archive(value).writeZip(input)
        const before = fs.readFileSync(input)
        await assert.rejects(probeImport(input), /重复目标路径/)
        await assert.rejects(runtime.installModpack(input, () => {}, { targetFolder: game, instanceName: 'must-not-create' }), /重复目标路径/)
        assert.deepEqual(fs.readFileSync(input), before)
        assert.deepEqual(fs.readdirSync(game), [], 'reject aliases before cache, runtime or instance creation')
      }
      assert.equal(metadataCalls, 0); assert.equal(downloadCalls, 0)
    } finally { await runtime.closeHttpClient() }
  })
})

test('MRPACK canonical deduplication retains distinct destinations and client-unsupported exclusion', async () => {
  await fixture(async root => {
    const value = index(), file = path.join(root, 'distinct.mrpack')
    const bytes = Buffer.from('synthetic shared content')
    value.files = ['mods/a.jar', 'resourcepacks/a.jar', 'MODS///A.JAR'].map((rel, i) => ({
      path: rel, hashes: { sha1: hash('sha1', bytes), sha512: hash('sha512', bytes) },
      downloads: ['https://mrpack-fixture.invalid/payload'], fileSize: bytes.length,
      ...(i === 2 ? { env: { client: 'unsupported', server: 'required' } } : {})
    }))
    archive(value).writeZip(file)
    assert.equal((await probeModpack(file)).fileCount, 2)
  })
})

test('actual MRPACK install downloads verified client files and layers client overrides while retaining the input archive', { timeout: 20000 }, async () => {
  await fixture(async root => {
    const game = path.join(root, 'games'), id = 'MRPACK-119-中文 §', payload = Buffer.from('synthetic client mod bytes'), client = Buffer.from('synthetic vanilla client')
    fs.mkdirSync(game)
    const requests: string[] = []
    let base = '', runtime: Awaited<ReturnType<typeof versionInstallHarness>> | undefined
    const server = http.createServer((req, res) => {
      const url = req.url!; requests.push(url)
      if (url === '/version') return void res.end(JSON.stringify({ id: '1.20.1', mainClass: 'fixture.Main', libraries: [], downloads: { client: { url: base + '/client', sha1: hash('sha1', client), size: client.length } } }))
      const bytes = url === '/client' ? client : url === '/payload' ? payload : undefined
      if (!bytes) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'content-length': bytes.length }); res.end(bytes)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    try {
      runtime = await versionInstallHarness(root,
        async () => Response.json({ versions: [{ id: '1.20.1', type: 'release', url: base + '/version', releaseTime: '2023-01-01' }] }),
        url => url.replace('https://mrpack-fixture.invalid', base))
      Object.assign(runtime.getSettings(), { gameDir: game, activeFolder: game, folders: [{ path: game, name: 'fixture', isDefault: true }], defaultIsolation: true, mirror: 'official' })
      const value = index()
      value.files = [
        { path: 'mods/中文 § client.jar', hashes: { sha1: hash('sha1', payload).toUpperCase(), sha512: hash('sha512', payload).toUpperCase() }, downloads: ['https://mrpack-fixture.invalid/missing', 'https://mrpack-fixture.invalid/payload'], fileSize: payload.length, env: { client: 'optional', server: 'unsupported' } },
        { path: 'mods/server-only.jar', hashes: { sha1: hash('sha1', payload), sha512: hash('sha512', payload) }, downloads: ['https://mrpack-fixture.invalid/server-only'], fileSize: payload.length, env: { client: 'unsupported', server: 'required' } }
      ]
      const zip = archive(value, true), input = path.join(root, 'synthetic MRPACK.MRPACK')
      zip.addFile('client-overrides/config/中文 § setting.txt', Buffer.from('client wins'))
      zip.addFile('server-overrides/config/中文 § setting.txt', Buffer.from('must not install server override'))
      zip.addFile('overrides/options.txt', Buffer.from('lang:zh_cn\n'))
      zip.writeZip(input)
      const original = fs.readFileSync(input), events: { stage: string; progress: number }[] = []
      assert.equal(await runtime.installModpack(input, event => events.push(event), { targetFolder: game, instanceName: id }), id)
      const target = path.join(game, 'versions', id)
      assert.deepEqual(fs.readFileSync(path.join(target, 'mods', '中文 § client.jar')), payload)
      assert.equal(fs.readFileSync(path.join(target, 'config', '中文 § setting.txt'), 'utf8'), 'client wins')
      assert.equal(fs.existsSync(path.join(target, 'mods', 'server-only.jar')), false)
      assert.equal(fs.readFileSync(path.join(target, 'options.txt'), 'utf8'), 'lang:zh_cn\n')
      assert.deepEqual(fs.readFileSync(input), original)
      assert(requests.includes('/missing')); assert(requests.includes('/payload'))
      assert.equal(requests.includes('/server-only'), false)
      assert.equal(runtime.readVersionJson(id)._gameDir, true)
      assert(events.some(event => event.stage === 'done' && event.progress === 1))
    } finally {
      await runtime?.closeHttpClient()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
