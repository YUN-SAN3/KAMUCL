import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import test from 'node:test'
import AdmZip from 'adm-zip'
import { writeNbt } from '../src/main/core/nbt'
import { probeImport } from '../src/main/core/importProbe'

const world = () => zlib.gzipSync(writeNbt({ Data: { LevelName: 'fixture', DataVersion: 3465, Version: { Name: '1.20.1', Id: 3465 } } }))
const index = () => ({ game: 'minecraft', formatVersion: 1, name: 'export', versionId: '1', dependencies: { minecraft: '1.20.1', forge: '47.4.23' }, files: [
  { path: 'resourcepacks/LowOnFire v26.2§8.zip', hashes: { sha1: 'a'.repeat(40) }, downloads: ['https://example.invalid/file.zip'], fileSize: 1 }
] })
async function fixture(entries: Record<string, Buffer | string>, run: (file: string) => Promise<void>, extension = '.zip') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-classify-'))
  try {
    const zip = new AdmZip(), file = path.join(root, '导出' + extension)
    for (const [name, data] of Object.entries(entries)) zip.addFile(name, Buffer.isBuffer(data) ? data : Buffer.from(data))
    zip.writeZip(file); await run(file)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

test('PCL Modrinth ZIP with bundled world selects entire pack and retains declared runtime/resources', async () => {
  await fixture({ 'modrinth.index.json': JSON.stringify(index()), 'overrides/saves/world/level.dat': world(), 'overrides/resourcepacks/中文.zip': 'resource' }, async file => {
    const before = fs.readFileSync(file), result = await probeImport(file)
    assert.equal(result.kind, 'modpack')
    if (result.kind !== 'modpack') return
    assert.equal(result.info.format, 'mrpack'); assert.equal(result.info.fileCount, 1)
    assert.equal(result.info.mcVersion, '1.20.1'); assert.equal(result.info.loaderVersion, '47.4.23')
    assert.equal(result.info.hasOverrides, true); assert(fs.readFileSync(file).equals(before))
  })
})

test('ordinary world ZIP remains a world; unrelated nested manifest is not a pack marker', async () => {
  await fixture({ 'world/level.dat': world(), 'world/datapacks/demo/manifest.json': '{}' }, async file => {
    const result = await probeImport(file); assert.equal(result.kind, 'world')
    if (result.kind === 'world') assert.equal(result.info.candidates[0].worldName, 'fixture')
  })
})

test('corrupt and unsupported pack markers do not silently fall back to bundled worlds', async () => {
  for (const value of ['{broken', JSON.stringify({ ...index(), formatVersion: 2 })]) {
    await fixture({ 'modrinth.index.json': value, 'overrides/saves/world/level.dat': world() }, async file => {
      await assert.rejects(probeImport(file), /损坏|格式版本/)
    })
  }
})

test('CurseForge pack with world and full-client pack both precede world classification', async () => {
  for (const entries of [
    { 'manifest.json': JSON.stringify({ minecraft: { version: '1.20.1' }, name: 'fixture', overrides: 'overrides', files: [] }), 'overrides/saves/world/level.dat': world() },
    { '.minecraft/versions/1.20.1/1.20.1.json': JSON.stringify({ id: '1.20.1', mainClass: 'net.minecraft.client.main.Main', libraries: [] }), '.minecraft/saves/world/level.dat': world() }
  ]) await fixture(entries, async file => assert.equal((await probeImport(file)).kind, 'modpack'))
})

test('nested mrpack precedes outer bundled worlds; ambiguous inner packs are rejected', async () => {
  const inner = new AdmZip(); inner.addFile('modrinth.index.json', Buffer.from(JSON.stringify(index())))
  await fixture({ 'packs/export.mrpack': inner.toBuffer(), 'world/level.dat': world() }, async file => assert.equal((await probeImport(file)).kind, 'modpack'))
  await fixture({ 'a.mrpack': inner.toBuffer(), 'b.mrpack': inner.toBuffer(), 'world/level.dat': world() }, async file => {
    await assert.rejects(probeImport(file), /多个 mrpack/)
  })
})

test('ordinary folder/JAR flows and unsupported archives remain explicit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-import-folder-'))
  try {
    assert.equal((await probeImport(root)).kind, 'mod')
    fs.writeFileSync(path.join(root, 'level.dat'), world()); assert.equal((await probeImport(root)).kind, 'world')
    const jar = path.join(root, 'test.jar'); fs.writeFileSync(jar, 'jar'); assert.equal((await probeImport(jar)).kind, 'mod')
    await fixture({ 'readme.txt': 'not a pack' }, async file => assert.equal((await probeImport(file)).kind, 'unsupported'))
    await fixture({ 'readme.txt': 'not a pack' }, async file => { await assert.rejects(probeImport(file), /无法识别/); }, '.mrpack')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('recognized pack still rejects unsafe download paths and duplicate targets', async () => {
  for (const files of [[{ ...index().files[0], path: '../escape.jar' }], [index().files[0], index().files[0]]]) {
    await fixture({ 'modrinth.index.json': JSON.stringify({ ...index(), files }), 'overrides/saves/world/level.dat': world() }, async file => {
      await assert.rejects(probeImport(file), /路径不安全|重复目标/)
    })
  }
})
