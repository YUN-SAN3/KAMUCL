import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { build } from 'esbuild'
import AdmZip from 'adm-zip'
import { prepareResourcePackArchive } from '../src/main/core/resourcePackArchive'

const sha = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex')
const meta = Buffer.from('\uFEFF' + JSON.stringify({ pack: { min_format: [88, 0], max_format: [88, 1], description: [{ text: 'Synthetic fixture', color: 'gold' }, { translate: 'fixture.description' }] }, overlays: { entries: [{ min_format: [88, 0], max_format: 88, directory: 'overlay' }] } }))
function archive(prefix = '', directories = false): Buffer {
  const zip = new AdmZip()
  if (directories && prefix) for (const [index] of prefix.split('/').slice(0, -1).entries()) zip.addFile(prefix.split('/').slice(0, index + 1).join('/') + '/', Buffer.alloc(0))
  zip.addFile(prefix + 'pack.mcmeta', meta)
  zip.addFile(prefix + 'assets/minecraft/textures/fixture.bin', Buffer.from('texture data'))
  zip.addFile(prefix + 'overlay/assets/minecraft/fixture.txt', Buffer.from('overlay data'))
  zip.addFile(prefix + 'LICENSE.txt', Buffer.from('retain license'))
  zip.addZipComment('retain archive comment')
  return zip.toBuffer()
}
let code: Promise<string>
async function runtime(t: any) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-resourcepack121-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  code ??= build({ entryPoints: ['src/main/core/defaultResourcePacks.ts'], platform: 'node', format: 'cjs', bundle: true, write: false, packages: 'external' }).then(result => result.outputFiles[0].text)
  const require = createRequire(path.resolve('package.json')), mod = { exports: {} as any }, faults = { write: undefined as undefined | ((file: string) => void), rename: undefined as undefined | ((dest: string) => void) }
  const mockFs = { ...fs,
    writeFileSync(file: string, data: any, options?: any) { faults.write?.(String(file)); fs.writeFileSync(file, data, options) },
    renameSync(source: string, dest: string) { faults.rename?.(String(dest)); fs.renameSync(source, dest) }
  }
  new Function('require', 'module', 'exports', await code)((name: string) => name === 'electron' ? { app: { getPath: () => root } } : name === 'node:fs' ? mockFs : require(name), mod, mod.exports)
  return { root, api: mod.exports, faults }
}
const managed = (pack: any) => `KAMUCL-default-${pack.id}-${pack.name}`

test('ordinary root ZIP retains exact bytes and valid BOM/component/new-format metadata', () => {
  const source = archive(), prepared = prepareResourcePackArchive(source, 'plain synthetic.zip')
  assert.equal(prepared.data, source)
  assert.equal(prepared.wrapped, false)
  assert.deepEqual(prepared.metadata.min_format, [88, 0])
  assert(Array.isArray(prepared.metadata.description))
})

test('root pack metadata takes precedence over nested payload metadata without changing old ZIP bytes', () => {
  const zip = new AdmZip(archive())
  zip.addFile('assets/example/pack.mcmeta', Buffer.from('ordinary payload, not outer metadata'))
  zip.addFile('overlay/pack.mcmeta', meta)
  const source = zip.toBuffer(), prepared = prepareResourcePackArchive(source, 'nested metadata.zip')
  assert.equal(prepared.data, source)
  assert.equal(prepared.wrapped, false)
  assert.deepEqual(new AdmZip(prepared.data).getEntry('assets/example/pack.mcmeta')!.getData(), Buffer.from('ordinary payload, not outer metadata'))
})

test('unique wrapped ancestor retains every nested pack.mcmeta as payload when unwrapping', () => {
  const prefix = 'Outer/Pack/', zip = new AdmZip(archive(prefix, true))
  zip.addFile(prefix + 'overlay/pack.mcmeta', meta)
  zip.addFile(prefix + 'assets/example/pack.mcmeta', Buffer.from('opaque payload'))
  const source = zip.toBuffer(), original = new AdmZip(source), prepared = prepareResourcePackArchive(source, 'wrapped nested metadata.zip'), result = new AdmZip(prepared.data)
  assert.equal(prepared.wrapped, true)
  for (const entry of original.getEntries().filter(entry => !entry.isDirectory)) {
    const output = result.getEntry(entry.entryName.slice(prefix.length))!
    assert(output)
    assert.deepEqual(output.getData(), entry.getData())
    assert.deepEqual(output.getCompressedData(), entry.getCompressedData())
  }
  assert.equal(result.getEntries().filter(entry => !entry.isDirectory).length, original.getEntries().filter(entry => !entry.isDirectory).length)
})

test('unique multi-directory wrapper keeps every payload and compressed asset byte while putting metadata at root', () => {
  const prefix = '外层分发目录/中文资源包/', source = archive(prefix, true), original = new AdmZip(source)
  const prepared = prepareResourcePackArchive(source, 'wrapped synthetic.zip'), normalized = new AdmZip(prepared.data)
  assert.equal(prepared.wrapped, true)
  assert.notEqual(sha(prepared.data), sha(source))
  assert(normalized.getEntry('pack.mcmeta'))
  assert.equal(normalized.getZipComment(), original.getZipComment())
  const payloads = original.getEntries().filter(entry => !entry.isDirectory)
  assert.equal(normalized.getEntries().filter(entry => !entry.isDirectory).length, payloads.length)
  for (const entry of payloads) {
    const target = normalized.getEntry(entry.entryName.slice(prefix.length))!
    assert(target)
    assert.deepEqual(target.getData(), entry.getData())
    assert.deepEqual(target.getCompressedData(), entry.getCompressedData(), 'normalization must not recompress or rewrite asset content')
  }
  assert.deepEqual(prepareResourcePackArchive(source, 'repeat synthetic.zip').data, prepared.data, 'derived payload must be deterministic across launches')
  assert.deepEqual(prepareResourcePackArchive(prepared.data, 'already normalized.zip').data, prepared.data)
})

test('dot-root and backslash wrappers normalize safely without rewriting metadata contents', () => {
  const input = new AdmZip(archive('pack/'))
  for (const entry of input.getEntries()) entry.entryName = './' + entry.entryName.replace(/\//g, '\\')
  const prepared = prepareResourcePackArchive(input.toBuffer(), 'Windows exporter synthetic.zip'), output = new AdmZip(prepared.data)
  assert.deepEqual(output.getEntry('pack.mcmeta')!.getData(), meta)
  assert.deepEqual(output.getEntry('assets/minecraft/textures/fixture.bin')!.getData(), Buffer.from('texture data'))
})

test('multi-pack bundles and wrapper-external files are rejected without choosing or dropping data', () => {
  const multiple = new AdmZip(archive('A/')); multiple.addFile('B/pack.mcmeta', meta); multiple.addFile('B/assets/minecraft/b.txt', Buffer.from('second'))
  assert.throws(() => prepareResourcePackArchive(multiple.toBuffer(), 'multiple.zip'), /多个材质包/)
  const bundled = new AdmZip(archive('A/')); bundled.addFile('README outside.txt', Buffer.from('instructions'))
  assert.throws(() => prepareResourcePackArchive(bundled.toBuffer(), 'distribution.zip'), /目录以外|未丢弃/)
})

test('unsafe paths, duplicate paths, encrypted entries, links and broken metadata never become a derived pack', () => {
  for (const unsafe of ['../escape.bin', '/absolute.bin', 'C:/escape.bin', 'pack/../escape.bin', 'pack//ambiguous.bin']) {
    const input = new AdmZip(archive('pack/')); input.getEntry('pack/LICENSE.txt')!.entryName = unsafe
    assert.throws(() => prepareResourcePackArchive(input.toBuffer(), 'unsafe.zip'), /路径/)
  }
  const duplicate = new AdmZip(archive('pack/')); duplicate.getEntry('pack/LICENSE.txt')!.entryName = 'pack/pack.mcmeta'
  // Current adm-zip rejects this malformed central directory before the product can enumerate it.
  assert.throws(() => prepareResourcePackArchive(duplicate.toBuffer(), 'duplicate.zip'), /重复|冲突|^(?:Error: )?ADM-ZIP: Duplicate entry name "pack\/pack\.mcmeta"$/)
  const encrypted = new AdmZip(archive('pack/')); encrypted.getEntry('pack/LICENSE.txt')!.header.flags |= 1
  assert.throws(() => prepareResourcePackArchive(encrypted.toBuffer(), 'encrypted.zip'), /加密/)
  const link = new AdmZip(archive('pack/')); link.getEntry('pack/LICENSE.txt')!.attr = (0o120777 << 16) >>> 0
  assert.throws(() => prepareResourcePackArchive(link.toBuffer(), 'link.zip'), /符号链接/)
  for (const value of ['{broken', JSON.stringify({ pack: [] }), JSON.stringify({ description: 'not a pack' })]) {
    const input = new AdmZip(archive('pack/')); input.updateFile('pack/pack.mcmeta', Buffer.from(value))
    assert.throws(() => prepareResourcePackArchive(input.toBuffer(), 'bad metadata.zip'), /pack.mcmeta/)
  }
  const corrupt = new AdmZip(archive('pack/')); corrupt.getEntry('pack/pack.mcmeta')!.header.crc ^= 1
  assert.throws(() => prepareResourcePackArchive(corrupt.toBuffer(), 'corrupt metadata.zip'), /pack.mcmeta/)
})

test('default import stores original hash/ZIP and syncs deterministic Minecraft-readable copies while preserving later selections', async t => {
  const { root, api } = await runtime(t), source = archive('Outer/Pack/', true), file = path.join(root, 'wrapped synthetic.zip'), game = path.join(root, 'instance')
  fs.writeFileSync(file, source)
  const [pack] = api.importDefaultResourcePacks([file])
  assert.equal(pack.id, sha(source))
  assert.deepEqual(fs.readFileSync(file), source)
  assert.deepEqual(fs.readFileSync(path.join(root, 'default-resourcepacks', pack.id + '.zip')), source)
  assert.equal(api.syncDefaultResourcePacks(game, '26.2'), 1)
  const copy = path.join(game, 'resourcepacks', managed(pack)), copied = fs.readFileSync(copy)
  assert(new AdmZip(copied).getEntry('pack.mcmeta'))
  assert.deepEqual(new AdmZip(copied).getEntry('pack.mcmeta')!.getData(), meta)
  const choice = 'resourcePacks:["vanilla","file/Personal.zip"]\nincompatibleResourcePacks:["file/Personal.zip"]\ncustom:keep\n'
  fs.writeFileSync(path.join(game, 'options.txt'), choice)
  api.syncDefaultResourcePacks(game, '26.2')
  assert.equal(fs.readFileSync(path.join(game, 'options.txt'), 'utf8'), choice)
  assert.deepEqual(fs.readFileSync(copy), copied)
  assert.deepEqual(api.importDefaultResourcePacks([file]), [pack], 'reimport uses the original content identity')
})

test('a mixed invalid import batch changes neither defaults nor original ZIPs', async t => {
  const { root, api } = await runtime(t), original = path.join(root, 'existing.zip'), good = path.join(root, 'wrapped.zip'), bad = path.join(root, 'multiple.zip')
  fs.writeFileSync(original, archive()); api.importDefaultResourcePacks([original])
  fs.writeFileSync(good, archive('Wrapper/')); const multiple = new AdmZip(archive('A/')); multiple.addFile('B/pack.mcmeta', meta); multiple.writeZip(bad)
  const before = fs.readFileSync(path.join(root, 'default-resourcepacks', 'packs.json')), goodBefore = fs.readFileSync(good), badBefore = fs.readFileSync(bad)
  assert.throws(() => api.importDefaultResourcePacks([good, bad]), /多个/)
  assert.deepEqual(fs.readFileSync(path.join(root, 'default-resourcepacks', 'packs.json')), before)
  assert.deepEqual(fs.readFileSync(good), goodBefore); assert.deepEqual(fs.readFileSync(bad), badBefore)
  assert.equal(fs.existsSync(path.join(root, 'default-resourcepacks', sha(goodBefore) + '.zip')), false)
})

test('wrapped copies and source hashes are protected; transaction failures and concurrent options edits retain recovery behavior', async t => {
  const { root, api, faults } = await runtime(t), file = path.join(root, 'wrapped.zip'), game = path.join(root, 'transaction'), source = archive('Wrapper/')
  fs.writeFileSync(file, source); const [pack] = api.importDefaultResourcePacks([file])
  fs.mkdirSync(game); const options = path.join(game, 'options.txt'), state = path.join(game, '.kamucl-default-resourcepacks.json')
  const before = 'resourcePacks:["vanilla","file/Personal.zip"]\ncustom:keep\n'; fs.writeFileSync(options, before)
  let failed = false
  faults.rename = dest => { if (dest === state && !failed) { failed = true; throw new Error('synthetic publish failure') } }
  assert.throws(() => api.applyDefaultResourcePacks(game, '26.2'), /synthetic publish failure/)
  assert.equal(fs.readFileSync(options, 'utf8'), before)
  assert.equal(fs.existsSync(state), false)
  faults.rename = undefined
  const concurrent = 'resourcePacks:["vanilla","file/NewChoice.zip"]\n'
  let edited = false
  faults.write = dest => { if (!edited && dest.startsWith(state + '.kamucl-write-')) { edited = true; fs.writeFileSync(options, concurrent) } }
  assert.throws(() => api.applyDefaultResourcePacks(game, '26.2'), /操作期间发生变化/)
  assert.equal(fs.readFileSync(options, 'utf8'), concurrent)
  faults.write = undefined
  const copy = path.join(game, 'resourcepacks', managed(pack)); fs.writeFileSync(copy, 'user modification')
  assert.throws(() => api.applyDefaultResourcePacks(game, '26.2'), /副本被修改/)
  assert.equal(fs.readFileSync(copy, 'utf8'), 'user modification')
  fs.writeFileSync(path.join(root, 'default-resourcepacks', pack.id + '.zip'), 'changed source')
  assert.throws(() => api.syncDefaultResourcePacks(path.join(root, 'new-instance'), '26.2'), /缓存.*被修改/)
  assert.equal(fs.existsSync(path.join(root, 'new-instance')), false)
  assert.deepEqual(fs.readFileSync(file), source)
})
