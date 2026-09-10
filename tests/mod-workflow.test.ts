import test from 'node:test'
import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import { resolveInstanceMetadata } from '../src/main/core/instanceMetadata'
import { parseModArchive } from '../src/main/core/modMetadata'
import { dependencyRange, matchesVersionRange, modMatchesInstance } from '../src/shared/modCompatibility'
import { matchesCommunityFilter } from '../src/shared/communityPolicy'
import { dependencyGraph, missingRequirements } from '../src/main/core/modInstallPlan'
import type { CommunityFile, InstalledVersion } from '../src/shared/types'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { prepareModInstall, executeModPlan, discardModPlan } from '../src/main/core/modInstallPlan'
import { reuseExternalRuntimeLibraries } from '../src/main/core/externalRuntime'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

test('reported ImmortalersDelight: BootstrapLauncher + fmlloader + FML arguments, renamed instance', () => {
  const metadata = resolveInstanceMetadata({ id: '任意重命名', mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher', libraries: [{ name: 'net.minecraftforge:fmlloader:1.20.1-47.4.10' }], arguments: { game: ['--fml.forgeVersion', '47.4.10', '--fml.mcVersion', '1.20.1', '--launchTarget', 'forgeclient'] } }, () => undefined)
  const zip = new AdmZip()
  zip.addFile('META-INF/mods.toml', Buffer.from(`modLoader="javafml"
loaderVersion="[47,)"
[[mods]]
modId='immortalersdelight' # literal strings and comments are valid TOML
displayName="ImmortalersDelight"
version="1.20.1-forge-1.2.1"
description='''multiline
[[not_a_table]]
'''
[[dependencies.immortalersdelight]]
modId="minecraft"
mandatory=true
versionRange="[1.20.1,1.21)" # must not leak into the range
[[dependencies.immortalersdelight]]
modId="forge"
mandatory=true
versionRange="[47,)"
[[dependencies.immortalersdelight]]
modId="farmersdelight"
mandatory=true
versionRange="[1.2,)"`))
  const mod = parseModArchive(zip, 'fixture.jar', 'fixture.jar')
  assert.equal(mod.error, undefined)
  assert.deepEqual(mod.requirements, [{ id: 'farmersdelight', range: '[1.2,)' }])
  assert(modMatchesInstance(mod, { id: '任意重命名', ...metadata }))
  assert(!modMatchesInstance(mod, { id: 'looks-compatible', ...metadata, mcVersion: '1.21' }))
  assert(!modMatchesInstance(mod, { id: 'looks-compatible', ...metadata, loaderVersion: '46.9' }))
})

test('FML argument-only and library-only profiles cover older NeoForge, modern Forge, Fabric and Quilt', () => {
  for (const [loader, lib, args, mc, lv] of [
    ['forge', 'net.minecraftforge:fmlloader:1.20.1-47.4.10', [], '1.20.1', '47.4.10'],
    ['forge', 'net.minecraftforge:forge:1.12.2-14.23.5.2860:universal', [], '1.12.2', '14.23.5.2860'],
    ['neoforge', 'net.neoforged.fancymodloader:loader:6.0.18', ['--fml.mcVersion=1.21.4', '--fml.neoForgeVersion=21.4.157'], '1.21.4', '21.4.157'],
    ['neoforge', 'net.neoforged.fancymodloader:loader:11.0.16', ['--fml.mcVersion', '26.2', '--fml.neoForgeVersion', '26.2.0.66'], '26.2', '26.2.0.66'],
    ['fabric', 'net.fabricmc:fabric-loader:0.19.3', [], '1.20.1', '0.19.3'],
    ['quilt', 'org.quiltmc:quilt-loader:0.28.0', [], '1.20.1', '0.28.0']
  ] as const) {
    const found = resolveInstanceMetadata({ id: 'misleading display name 99.99', clientVersion: mc, mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher', libraries: [{ name: lib }], arguments: { game: [...args] } }, () => undefined)
    assert.deepEqual([found.loader, found.mcVersion, found.loaderVersion], [loader, mc, lv])
    assert(matchesVersionRange(`[${lv},)`, found.loaderVersion!))
  }
})

test('multiloader descriptors, required vs optional/server dependencies, bundled providers', () => {
  const zip = new AdmZip(), child = new AdmZip()
  child.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'bundled', version: '2.1' })))
  zip.addFile('inner.jar', child.toBuffer())
  zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'multi', version: '1.0', jars: [{ file: 'inner.jar' }], depends: { minecraft: '>=1.20 <1.21', fabricloader: '>=0.15', bundled: '>=2', fabric: '*' } })))
  zip.addFile('META-INF/neoforge.mods.toml', Buffer.from(`[[mods]]
modId="multi"
version="1.0"
[[dependencies.multi]]
modId="minecraft"
versionRange="[26.2]"
type="required"
[[dependencies.multi]]
modId="optional"
type="optional"
[[dependencies.multi]]
modId="serveronly"
type="required"
side="SERVER"`))
  const mod = parseModArchive(zip, 'fixture.jar', 'fixture.jar')
  assert(modMatchesInstance(mod, { id: 'x', mcVersion: '26.2', loader: 'neoforge' }))
  assert(modMatchesInstance(mod, { id: 'x', mcVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.16' }))
  assert(mod.provides?.some(p => p.id === 'bundled' && p.version === '2.1'))
  assert.deepEqual(missingRequirements([mod], { id: 'x', mcVersion: '1.20.1', loader: 'fabric' }, [mod]), [{ id: 'fabric', range: '*' }])
  assert.deepEqual(missingRequirements([mod], { id: 'x', mcVersion: '26.2', loader: 'neoforge' }, [mod]), [])
})

test('community filters apply to actual MC and normalized Loader, never filenames', () => {
  const f = { fileName: 'Forge-26.2', gameVersions: ['1.20.1'], loaders: ['NeoForge'] } as CommunityFile
  assert(matchesCommunityFilter(f, { mcVersion: '1.20.1', loader: 'neoforge' }))
  assert(!matchesCommunityFilter(f, { mcVersion: '26.2' }))
  assert(!matchesCommunityFilter(f, { loader: 'forge' }))
})

test('dependency graph respects required edges, pinned versions, cycles and incompatible loaders', async () => {
  const target: InstalledVersion = { id: 'x', mcVersion: '1.20.1', loader: 'forge' }
  const make = (id: string): CommunityFile => ({ fileId: id, source: 'modrinth', projectId: id, fileName: id + '.jar', version: '1', gameVersions: ['1.20.1'], loaders: ['Forge'], url: 'https://example.invalid/' + id, size: 1, date: '', releaseType: 'release' })
  const a = make('a'), b = make('b')
  a.dependencies = [{ fileId: 'b', required: true }, { projectId: 'optional', required: false }]
  b.dependencies = [{ fileId: 'a', required: true }]
  const repo = { files: async () => { throw new Error('optional must not fetch') }, exact: async (_s: unknown, _p: unknown, id: string) => id === 'a' ? a : b, find: async () => undefined }
  assert.deepEqual((await dependencyGraph([a], target, repo)).map(f => f.fileId), ['b', 'a'])
  await assert.rejects(dependencyGraph([a], { ...target, loader: 'fabric' }, repo), /不支持/)
})

test('modified Vue components compile with real scripts and templates', () => {
  for (const name of ['views/CommunityView.vue', 'components/ModDropModal.vue', 'components/ModInstallDialog.vue', 'components/MarqueeText.vue']) {
    const source = fs.readFileSync('src/renderer/src/' + name, 'utf8')
    const { descriptor, errors } = parse(source); assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: name })
    const template = compileTemplate({ source: descriptor.template!.content, filename: name, id: name, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [], name)
  }
})

test('real dependency download waits for consent, verifies JAR and commits into isolated folder without duplicates', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-dependencies-test-'))
  let requests = 0
  const jar = (id: string, depends = {}) => {
    const zip = new AdmZip(); zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id, version: '1.2.3', depends: { minecraft: '>=1.20 <1.21', fabricloader: '>=0.15', ...depends } }))); return zip.toBuffer()
  }
  const dependency = jar('front'), source = path.join(root, 'my-mod.jar')
  fs.writeFileSync(source, jar('test_mod', { front: '>=1.2' }))
  const server = http.createServer((_req, res) => { requests++; res.writeHead(200, { 'content-length': dependency.length }); res.end(dependency) })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const target: InstalledVersion = { id: '自定义名称', folder: root, gameDirectory: path.join(root, 'isolated'), isolated: true, mcVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.16.0' }
  const file: CommunityFile = { source: 'modrinth', projectId: 'front', fileId: 'front-1', fileName: 'front.jar', version: '1.2.3', url: `http://127.0.0.1:${(server.address() as any).port}/front.jar`, sha1: crypto.createHash('sha1').update(dependency).digest('hex'), size: dependency.length, gameVersions: ['1.20.1'], loaders: ['fabric'], date: '', releaseType: 'release' }
  const repo = { files: async () => [file], exact: async () => file, find: async () => file }
  try {
    const cancelled = await prepareModInstall(target, { paths: [source] }, () => {}, undefined, repo)
    assert.equal(requests, 0, 'must not download a dependency before confirmation')
    assert.equal(cancelled.files.filter(f => f.dependency).length, 1)
    discardModPlan(cancelled.id)
    assert(!fs.existsSync(target.gameDirectory!))
    const changed = await prepareModInstall(target, { paths: [source] }, () => {}, undefined, repo)
    let validationCount = 0
    await assert.rejects(executeModPlan(changed.id, true, () => {
      if (++validationCount === 2) throw new Error('游戏已开始运行')
      return target
    }, () => {}), /游戏已开始运行/)
    assert(!fs.existsSync(target.gameDirectory!), 'a session starting during download must prevent all writes')
    assert.equal(requests, 1)
    const plan = await prepareModInstall(target, { paths: [source] }, () => {}, undefined, repo)
    await executeModPlan(plan.id, true, () => target, () => {})
    assert.equal(requests, 2)
    assert.deepEqual(fs.readdirSync(path.join(target.gameDirectory!, 'mods')).sort(), ['front.jar', 'my-mod.jar'])
    assert(!fs.existsSync(path.join(root, 'mods')))
    const repeat = await prepareModInstall(target, { paths: [source] }, () => {}, undefined, repo)
    assert.equal(repeat.missing.length, 0)
    assert.equal(repeat.files.filter(f => f.dependency).length, 0)
    await executeModPlan(repeat.id, true, () => target, () => {})
    assert.equal(requests, 2)
    assert.equal(fs.readdirSync(path.join(target.gameDirectory!, 'mods')).length, 2)
    await assert.rejects(executeModPlan(plan.id, true, () => target, () => {}), /过期/)
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); fs.rmSync(root, { recursive: true, force: true }) }
})

test('multi-mod JAR must satisfy every same-loader descriptor, including a Forge FML-only bound', () => {
  const zip = new AdmZip()
  zip.addFile('META-INF/mods.toml', Buffer.from(`modLoader='javafml'
loaderVersion='[47,)'
[[mods]]
modId='first'
[[mods]]
modId='second'
[[dependencies.first]]
modId='minecraft'
versionRange='[1.20,1.22)'
[[dependencies.second]]
modId='minecraft'
versionRange='[1.20.1,1.21)'`))
  const mod = parseModArchive(zip, 'multi.jar', 'multi.jar')
  assert(modMatchesInstance(mod, { id: 'ignored', mcVersion: '1.20.1', loader: 'forge', loaderVersion: '47.4.10' }))
  assert(!modMatchesInstance(mod, { id: 'ignored', mcVersion: '1.21', loader: 'forge', loaderVersion: '47.4.10' }))
  assert(!modMatchesInstance(mod, { id: 'ignored', mcVersion: '1.20.1', loader: 'forge', loaderVersion: '46' }))
})

test('external runtime reuse follows exact coordinates, preserves existing bytes and does not copy unrelated versions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-runtime-test-'))
  try {
    const source = path.join(root, 'external'), shared = path.join(root, 'shared')
    for (const ver of ['26.2.0.66', '26.2.0.99']) {
      const file = path.join(source, 'libraries/net/neoforged/minecraft-client-patched', ver, `minecraft-client-patched-${ver}.jar`)
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ver)
    }
    const profile = { id: 'misleading-name', arguments: { game: ['--fml.neoForgeVersion', '26.2.0.66'] } }
    assert.equal(reuseExternalRuntimeLibraries(profile, [source], shared, []), 1)
    const target = path.join(shared, 'net/neoforged/minecraft-client-patched/26.2.0.66/minecraft-client-patched-26.2.0.66.jar')
    fs.writeFileSync(target, 'existing')
    assert.equal(reuseExternalRuntimeLibraries(profile, [source], shared, []), 0)
    assert.equal(fs.readFileSync(target, 'utf8'), 'existing')
    assert.deepEqual(fs.readdirSync(path.dirname(path.dirname(target))), ['26.2.0.66'])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('community component actually renders empty-instance filter fallback (not compile-only)', async () => {
  const bundle = await build({ entryPoints: ['src/renderer/src/views/CommunityView.vue'], bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', alias: { '@shared': path.resolve('src/shared') }, plugins: [{ name: 'vue-unit', setup(b) {
    b.onLoad({ filter: /\.vue$/ }, args => {
      const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'))
      return { contents: compileScript(descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(args.path) }
    })
  } }] })
  const exported = { exports: {} as any }
  const previousStorage = globalThis.localStorage
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null }, configurable: true })
  try {
    new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(path.resolve('package.json')), exported, exported.exports)
    const html = await renderToString(createSSRApp(exported.exports.default))
    assert(html.includes('兼容筛选') && html.includes('全部 Minecraft') && html.includes('全部加载器'))
    // Every route transition has a DOM wrapper even when a view also owns Teleports.
    assert.match(fs.readFileSync('src/renderer/src/App.vue', 'utf8'), /<Transition name="fade" mode="out-in" :duration="250">\s*<div[^>]*class="route-view"/)
  } finally { Object.defineProperty(globalThis, 'localStorage', { value: previousStorage, configurable: true }) }
})

test('nested version any/all preserve boolean precedence and Quilt has its own bare-version semantics', () => {
  const range = dependencyRange({ all: [{ any: ['=1.20.1', { all: ['>=26.2', '<26.3'] }] }, '<26.2.1'] })
  for (const [version, expected] of [['1.20.1', true], ['1.20.2', false], ['26.2', true], ['26.2.1', false], ['26.3', false]] as const) {
    assert.equal(matchesVersionRange(range, version), expected, version)
  }
  assert(!matchesVersionRange(dependencyRange('1.20.1'), '1.20.2'))
  assert(matchesVersionRange(dependencyRange('1.20.1', 'quilt'), '1.20.2'))
  assert(!matchesVersionRange(dependencyRange('1.20.1', 'quilt'), '2.0.0'))
  assert(!matchesVersionRange(dependencyRange({ any: [] }), '1.20.1'))
  const zip = new AdmZip()
  zip.addFile('quilt.mod.json', Buffer.from(JSON.stringify({ quilt_loader: { id: 'quilt_test', version: '1.0.0', depends: ['org.quiltmc:qsl', { id: 'minecraft', versions: { all: ['>=1.20.1', '<1.21'] } }, { id: 'quilt_loader', versions: '>=0.20' }, { id: 'server_only', environment: 'server' }] } })))
  const mod = parseModArchive(zip, 'quilt.jar', 'quilt.jar')
  assert.equal(mod.error, undefined)
  assert(modMatchesInstance(mod, { id: 'renamed', mcVersion: '1.20.4', loader: 'quilt', loaderVersion: '0.28.0' }))
  assert.deepEqual(mod.requirements, [{ id: 'qsl', range: '*' }])
})
