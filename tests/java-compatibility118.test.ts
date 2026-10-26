import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { buildJavaRequirement, javaCompatibilityError, javaMajorAllowed, javaRangeMatches, prepareCompatibleJava, releaseJavaMajor } from '../src/main/core/javaCompatibility'
import { createOfficialJavaReader } from '../src/main/core/javaMetadata'
import { JavaPreparation } from '../src/main/core/javaPreparation'
import { parseModArchive } from '../src/main/core/modMetadata'

const java = (major: number, version = `${major}.0.10`, architecture = 'x64') => ({ major, version, architecture, is64Bit: true, path: `fixture/java${major}` })
const forge = (mc: string) => ({ id: 'opaque-pack', _mcVersion: mc, libraries: [{ name: `net.minecraftforge:forge:${mc}-47.4.0` }] })

test('118 old Forge requests Java 8 and downloads it when only incompatible Java 21/25 are installed', async () => {
  const req = buildJavaRequirement(forge('1.12.2'))
  assert.equal(req.recommendedMajor, 8)
  let downloads = 0, probes = 0
  const selected = await prepareCompatibleJava(req, [java(21), java(25)], async j => { probes++; return j }, async major => { downloads++; assert.equal(major, 8); return java(8, '1.8.0_504') }, 'x64')
  assert.equal(selected.major, 8); assert.equal(downloads, 1); assert.equal(probes, 0)
  assert.match(javaCompatibilityError(java(21), req, 'x64')!, /旧版 Forge/)
})

test('118 Forge 1.20.1 automatically downloads Java 17 instead of reusing installed 21, while manual 21 remains allowed', async () => {
  const req = buildJavaRequirement(forge('1.20.1'))
  const selected = await prepareCompatibleJava(req, [java(21)], async j => j, async major => java(major), 'x64')
  assert.equal(selected.major, 17)
  assert.equal(javaCompatibilityError(java(21), req, 'x64'), undefined)
  assert.match(javaCompatibilityError(java(21), req, 'x64', true)!, /推荐的 Java 17/)
  assert.match(javaCompatibilityError(java(16), req)!, /至少需要 Java 17/)
})

test('118 release boundaries use Java 8/16/17/21/25 and do not guess future releases', () => {
  for (const [mc, need] of [['1.16.5', 8], ['1.17.1', 16], ['1.18', 17], ['1.20.4', 17], ['1.20.5', 21], ['1.21.11', 21], ['26.1', 25]] as const) assert.equal(releaseJavaMajor(mc), need)
  assert.equal(releaseJavaMajor('26.3'), undefined)
  assert.equal(releaseJavaMajor('21w18a'), undefined)
  assert.equal(releaseJavaMajor('1.20.5-pre1'), undefined)
})

test('118 inherited snapshots and opaque custom instances use official javaVersion instead of a copied Java 21 field', () => {
  const profile = { id: '用户整合包', inheritsFrom: '21w18a', javaVersion: { majorVersion: 21 }, _loader: 'fabric' as const }
  assert.equal(buildJavaRequirement(profile, undefined, { id: '21w18a', javaVersion: { majorVersion: 8 } }).recommendedMajor, 8)
  assert.equal(buildJavaRequirement({ ...profile, inheritsFrom: '26.3-snapshot-1' }, undefined, { id: '26.3-snapshot-1', javaVersion: { majorVersion: 25 } }).recommendedMajor, 25)
  assert.throws(() => buildJavaRequirement(profile), /无法确认/)
  assert.throws(() => buildJavaRequirement({ id: 'renamed-pack' }), /无法确认/)
  assert.equal(buildJavaRequirement({ id: 'renamed-pack', javaVersion: { majorVersion: 17 } }).recommendedMajor, 17)
})

test('118 verified official old snapshot dates supply Java 8 when the historical profile has no javaVersion', () => {
  const old = { id: '21w18a', releaseTime: '2021-05-05T12:00:00Z' }
  assert.equal(buildJavaRequirement({ id: old.id }, undefined, old).recommendedMajor, 8)
  assert.throws(() => buildJavaRequirement({ id: '26.3-snapshot-1' }, undefined, { id: '26.3-snapshot-1', releaseTime: '2026-08-01T12:00:00Z' } as any), /无法确认/)
})

test('118 patched legacy bootstraps and modern Forge are not given a blanket manual Java 8 ceiling', () => {
  const patched = { ...forge('1.12.2'), libraries: [...forge('1.12.2').libraries, { name: 'com.cleanroommc:cleanroom:0.3.0' }] }
  assert.equal(javaCompatibilityError(java(21), buildJavaRequirement(patched)), undefined)
  assert.equal(javaCompatibilityError(java(17), buildJavaRequirement(forge('1.16.5'))), undefined)
})

test('118 actual Forge ASM metadata enforces known Java incompatibility and preserves updated loader support', () => {
  const profile = forge('1.20.1')
  const older = buildJavaRequirement({ ...profile, libraries: [...profile.libraries, { name: 'org.ow2.asm:asm:9.5' }] })
  assert.equal(javaCompatibilityError(java(21), older), undefined)
  assert.match(javaCompatibilityError(java(25), older)!, /ASM 9.5/)
  const updated = buildJavaRequirement({ ...profile, libraries: [...profile.libraries, { name: 'org.ow2.asm:asm:9.8' }] })
  assert.equal(updated.recommendedMajor, 17)
  assert.equal(javaCompatibilityError(java(25), updated), undefined)
})

test('118 unhealthy recommended candidates are skipped; compatible exact-major runtimes are reused without a download', async () => {
  const req = buildJavaRequirement(forge('1.20.1')), first = java(17, '17.0.1'), healthy = java(17, '17.0.12')
  let downloads = 0
  const selected = await prepareCompatibleJava(req, [first, java(25), healthy], async j => { if (j === first) throw new Error('missing desktop modules'); return j }, async major => { downloads++; return java(major) }, 'x64')
  assert.equal(selected, healthy); assert.equal(downloads, 0)
})

test('118 cached forwarding paths cannot return another major or architecture', async () => {
  const req = buildJavaRequirement({ id: '1.21.11' })
  let downloads = 0
  const selected = await prepareCompatibleJava(req, [java(21)], async () => java(25), async major => { downloads++; return java(major) }, 'x64')
  assert.equal(selected.major, 21); assert.equal(downloads, 1)
  await assert.rejects(prepareCompatibleJava(req, [], async j => j, async major => java(major, `${major}.0.10`, 'arm64'), 'x64'), /校验失败/)
})

test('118 wrong-architecture and 32-bit Java are excluded before health checks', async () => {
  const req = buildJavaRequirement({ id: '26.1' }); let probes = 0
  const result = await prepareCompatibleJava(req, [java(25, '25.0.2', 'arm64'), { ...java(25), is64Bit: false }], async j => { probes++; return j }, async major => java(major), 'x64')
  assert.equal(result.major, 25); assert.equal(probes, 0)
})

test('118 automatic preparation reports install failures and stops on cancellation without a fallback JVM', async () => {
  const req = buildJavaRequirement({ id: '1.20.1' })
  await assert.rejects(prepareCompatibleJava(req, [java(21)], async j => j, async () => { throw new Error('download failed') }), /download failed/)
  const controller = new AbortController(); let downloads = 0
  await assert.rejects(prepareCompatibleJava(req, [java(17)], async j => { controller.abort(); return j }, async major => { downloads++; return java(major) }, undefined, controller.signal), { name: 'AbortError' })
  assert.equal(downloads, 0)
})

test('118 explicit mod Java ranges change the recommended major only when necessary and enforce upper limits', () => {
  const req = buildJavaRequirement({ id: 'opaque-pack', _mcVersion: '1.20.1', _loader: 'fabric' }, undefined, undefined, [{ source: 'actual.jar', range: '>=21 <25' }])
  assert.equal(req.minimumMajor, 17); assert.equal(req.recommendedMajor, 21)
  assert.equal(javaCompatibilityError(java(21), req), undefined)
  assert.match(javaCompatibilityError(java(25), req)!, /actual.jar/)
  assert.throws(() => buildJavaRequirement(forge('1.12.2'), undefined, undefined, [{ source: 'incompatible.jar', range: '>=17' }]), /需求冲突/)
})

test('118 mod patch requirements stay in their Java generation and use strict Maven bounds', () => {
  const req = buildJavaRequirement({ id: '1.20.1' }, undefined, undefined, [{ source: 'patch.jar', range: '[17.0.8,18)' }])
  assert.equal(req.recommendedMajor, 17)
  assert.match(javaCompatibilityError(java(17, '17.0.7'), req)!, /patch.jar/)
  assert.equal(javaCompatibilityError(java(17, '17.0.12'), req), undefined)
  assert.equal(javaRangeMatches('[17,17.0.8)', '17.0.8'), false)
  assert.equal(javaMajorAllowed(17, req), true)
  const old = buildJavaRequirement({ id: '1.12.2' }, undefined, undefined, [{ source: 'old.jar', range: '>=8.0.400' }])
  assert.equal(old.recommendedMajor, 8)
  assert.equal(javaCompatibilityError(java(8, '1.8.0_504'), old), undefined)
  assert.throws(() => buildJavaRequirement({ id: '1.20.1' }, undefined, undefined, [{ source: 'lower.jar', range: '>=17.0.8' }, { source: 'upper.jar', range: '<17.0.8' }]), /需求冲突/)
  const intersection = buildJavaRequirement({ id: '1.20.1' }, undefined, undefined, [{ source: 'lower.jar', range: '>=17.0.8' }, { source: 'upper.jar', range: '<17.0.9' }])
  assert.equal(intersection.recommendedMajor, 17)
})

test('118 real Fabric, Quilt and Forge metadata expose Java ranges, exclude server/optional dependencies and propagate bundled requirements', () => {
  const zip = new AdmZip()
  zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'fabric-test', version: '1', depends: { minecraft: '1.20.1', java: ['>=17 <21', '>=25'] }, breaks: { java: '26' }, jars: [{ file: 'nested.jar' }] })))
  zip.addFile('quilt.mod.json', Buffer.from(JSON.stringify({ quilt_loader: { id: 'quilt-test', version: '1', depends: [{ id: 'java', versions: '>=17' }, { id: 'java', versions: '>=99', optional: true }] } })))
  zip.addFile('META-INF/mods.toml', Buffer.from('modLoader="javafml"\nloaderVersion="[47,)"\n[[mods]]\nmodId="forge-test"\nversion="1"\n[features.forge-test]\njava_version="[17,22)"\n'))
  const nested = new AdmZip(); nested.addFile('fabric.mod.json', Buffer.from('{"id":"bundled-test","version":"1","depends":{"java":">=21"}}')); zip.addFile('nested.jar', nested.toBuffer())
  const info = parseModArchive(zip, '/mods/actual.jar', 'actual.jar', 0, false)
  assert.equal(info.error, undefined)
  assert(info.javaRequirements?.some(r => r.loader === 'fabric' && r.range.includes('||')))
  assert(info.javaRequirements?.some(r => r.loader === 'fabric' && r.exclude && r.range === '26'))
  assert(info.javaRequirements?.some(r => r.loader === 'forge' && r.range === '[17,22)'))
  assert(info.javaRequirements?.some(r => r.source.includes('bundled-test') && r.range === '>=21'))
  assert(!info.javaRequirements?.some(r => r.range.includes('99')))
})

test('118 official snapshot reader verifies Mojang SHA1, id and source, and reuses cached JSON offline', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'java-official118-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const text = '{"id":"26.3-snapshot-1","javaVersion":{"majorVersion":25}}', entry = { id: '26.3-snapshot-1', url: 'https://piston-meta.mojang.com/v1/packages/fixture.json', sha1: crypto.createHash('sha1').update(text).digest('hex') }
  let requests = 0
  const read = createOfficialJavaReader(() => root, async url => { requests++; return url.includes('version_manifest') ? JSON.stringify({ versions: [entry] }) : text })
  assert.equal((await read(entry.id)).javaVersion?.majorVersion, 25); assert.equal(requests, 2)
  const offline = createOfficialJavaReader(() => root, async () => { throw new Error('network offline') })
  assert.equal((await offline(entry.id)).javaVersion?.majorVersion, 25)
  const bad = createOfficialJavaReader(() => path.join(root, 'bad'), async url => url.includes('version_manifest') ? JSON.stringify({ versions: [entry] }) : text + ' ')
  await assert.rejects(bad(entry.id), /SHA1/)
  const unknown = createOfficialJavaReader(() => root, async () => '{"versions":[]}')
  await assert.rejects(unknown('future-version'), /找不到/)
  const untrusted = createOfficialJavaReader(() => path.join(root, 'untrusted'), async () => JSON.stringify({ versions: [{ ...entry, url: 'https://example.invalid/fake.json' }] }))
  await assert.rejects(untrusted(entry.id), /找不到/)
})

test('118 official metadata download cancellation does not create a cache entry', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'java-cancel118-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const controller = new AbortController(); controller.abort()
  const reader = createOfficialJavaReader(() => root, async () => { assert.fail('must not request'); return '' })
  await assert.rejects(reader('26.3-snapshot-1', controller.signal), { name: 'AbortError' })
  assert.deepEqual(await fs.readdir(root), [])
})

test('118 unavailable optional Java metadata cache cannot block verified official metadata', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'java-cache-failure118-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const blocked = path.join(root, 'not-a-directory'); await fs.writeFile(blocked, 'fixture')
  const text = '{"id":"24w14a","javaVersion":{"majorVersion":21}}'
  const entry = { id: '24w14a', url: 'https://piston-meta.mojang.com/v1/packages/fixture.json', sha1: crypto.createHash('sha1').update(text).digest('hex') }
  const reader = createOfficialJavaReader(() => blocked, async url => url.includes('version_manifest') ? JSON.stringify({ versions: [entry] }) : text)
  assert.equal((await reader(entry.id)).javaVersion?.majorVersion, 21)
  assert.equal(await fs.readFile(blocked, 'utf8'), 'fixture')
})

test('118 actual mod scan cancels each observer promptly and drains the worker only when no consumer remains', async t => {
  const workers: Array<EventEmitter & { terminated: number; terminate(): Promise<number> }> = []
  class FixtureWorker extends EventEmitter {
    terminated = 0
    constructor(..._args: unknown[]) { super(); workers.push(this) }
    async terminate() { this.terminated++; this.emit('exit', 1); return 1 }
  }
  ;(globalThis as any).__javaScanWorker118 = FixtureWorker
  t.after(() => { delete (globalThis as any).__javaScanWorker118 })
  const output = await build({ stdin: { contents: "export {scanModDirectory} from './src/main/core/modScan'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'scan-worker118', setup(b) {
    b.onResolve({ filter: /^(node:worker_threads|\.\/launcherLog)$/ }, args => ({ path: args.path, namespace: 'scan-worker118' }))
    b.onLoad({ filter: /.*/, namespace: 'scan-worker118' }, args => ({ contents: args.path === 'node:worker_threads' ? 'export const Worker=globalThis.__javaScanWorker118;' : 'export const logScope=()=>({info:()=>{}});' }))
  } }] })
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', '__dirname', output.outputFiles[0].text)(createRequire(path.resolve('package.json')), module, module.exports, process.cwd())
  const scan = module.exports.scanModDirectory, controller = new AbortController()
  const first = scan('/fixture/mods', false, undefined, 'catalog', controller.signal)
  const second = scan('/fixture/mods', false, undefined, 'catalog')
  assert.equal(workers.length, 1); controller.abort()
  await assert.rejects(first, { name: 'AbortError' }); assert.equal(workers[0].terminated, 0)
  workers[0].emit('message', { result: [] }); assert.deepEqual(await second, []); assert.equal(workers[0].terminated, 1)
  const lastController = new AbortController(), last = scan('/fixture/mods', false, undefined, 'catalog', lastController.signal)
  assert.equal(workers.length, 2); lastController.abort()
  await assert.rejects(last, { name: 'AbortError' }); assert.equal(workers[1].terminated, 1)
  const retried = scan('/fixture/mods', false, undefined, 'catalog')
  assert.equal(workers.length, 3); workers[2].emit('message', { result: [] }); assert.deepEqual(await retried, [])
})

test('118 actual instance diagnostics use verified client JAR evidence for renamed/copied profiles', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'java-diagnostics118-'))
  const profile = { id: 'opaque-renamed-pack', javaVersion: { majorVersion: 25 }, _loader: 'fabric' }
  const file = path.join(root, 'client.jar'), zip = new AdmZip()
  zip.addFile('version.json', Buffer.from('{"id":"1.20.1"}'))
  const bytes = zip.toBuffer(); await fs.writeFile(file, bytes)
  const sha1 = crypto.createHash('sha1').update(bytes).digest('hex')
  Object.assign(profile, { downloads: { client: { sha1 } } })
  const target = { folder: root, id: profile.id }
  const architecture = process.arch === 'arm64' ? 'arm64' : 'x64'
  const nativeJava = [java(17), java(25)].map(candidate => ({ ...candidate, architecture }))
  const foreignJava = { ...java(17), path: java(17).path + '-foreign', architecture: architecture === 'arm64' ? 'x64' : 'arm64' }
  const fixture = { root, file, profile, target, java: [foreignJava, ...nativeJava] }
  ;(globalThis as any).__javaDiagnostics118 = fixture
  t.after(async () => { delete (globalThis as any).__javaDiagnostics118; await fs.rm(root, { recursive: true, force: true }) })
  const javaFile = JSON.stringify(path.resolve('src/main/core/java.ts').replace(/\\/g, '/'))
  const compatibilityFile = JSON.stringify(path.resolve('src/main/core/javaCompatibility.ts').replace(/\\/g, '/'))
  const mocks: Record<string, string> = {
    electron: 'export const app={getPath:()=>h.root};export const net={};',
    instanceCenter: 'export const centerTarget=()=>({folder:h.root,dir:h.root,json:h.profile,target:h.target});export const assertInstanceIdle=async()=>{}',
    paths: 'export const withGameFolder=(_folder,run)=>run();export const assetsDir=()=>h.root;export const defaultFolderPath=()=>h.root;export const runtimesDir=()=>h.root;',
    versions: 'export const resolveVersionChain=()=>({merged:h.profile,baseId:h.profile.id});export const clientJarPath=()=>h.file;export const launchLibraryFiles=()=>[];',
    launchIntegrity: `export const invalidLaunchArtifact=async file=>{const bytes=await fs.readFile(file.dest);return file.sha1&&crypto.createHash('sha1').update(bytes).digest('hex')!==file.sha1?'bad sha1':null};export const ensureLaunchArtifact=async()=>{};`,
    java: `export {resolveJavaRequirement} from ${javaFile};export {javaCompatibilityError} from ${compatibilityFile};export const listJavaSummary=async()=>h.java;export const validateCandidateJava=async j=>j;export const resolveJavaExecutable=async p=>p;export const probeJavaAsync=async p=>h.java.find(j=>j.path===p);`,
    settings: 'export const getSettings=()=>({javaAuto:true,javaCustom:[],javaHidden:[]});export const saveSettings=()=>{};',
    exitHistory: 'export const exitHistory=()=>({list:()=>[]});',
    launch: 'export const getLastLaunch=()=>undefined;',
    modScan: 'export const scanModDirectory=async()=>[];',
    backupStore: 'export const safePath=async(root,name)=>path.join(root,name);',
    diagnostics: 'export const redactDiagnosticText=text=>text;',
    launcherLog: 'export const logScope=()=>({info:()=>{},debug:()=>{},warn:()=>{},error:()=>{}});',
    tasks: 'export const waitIfTaskPaused=async()=>{};export const isCancelError=()=>false;',
    download: 'export const downloadFile=async()=>{throw new Error("Unexpected Java download")};',
    httpClient: 'export const httpFetch=async()=>{throw new Error("Unexpected metadata network request")};'
  }
  const output = await build({ stdin: { contents: "export {diagnoseInstance} from './src/main/core/instanceDiagnostics'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'java-diagnostics118', setup(b) {
    b.onResolve({ filter: /^(\.\/|electron$)/ }, args => { const key = args.path.replace('./', ''); return mocks[key] ? { path: key, namespace: 'java-diagnostics118' } : undefined })
    b.onLoad({ filter: /.*/, namespace: 'java-diagnostics118' }, args => ({ loader: 'ts', resolveDir: process.cwd(), contents: `import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';const h=globalThis.__javaDiagnostics118;${mocks[args.path]}` }))
  } }] })
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(createRequire(path.resolve('package.json')), module, module.exports)
  const result = await module.exports.diagnoseInstance(target)
  assert.equal(result.requiredJava, 17)
  assert.deepEqual(result.java.map((j: any) => j.major), [17])
  assert.equal(result.java[0].architecture, architecture, 'diagnostics must reject a runtime for a different CPU architecture')
  assert(!result.findings.some((f: any) => f.rule === 'java-requirement' || f.rule === 'java-unavailable'))
  assert.equal(profile.javaVersion.majorVersion, 25, 'diagnostics must not rewrite a copied profile')
})

test('118 shared Java preparations deduplicate work and keep a live caller after another cancels', async () => {
  const group = new JavaPreparation<string, string>(), controller = new AbortController(), events: string[] = []
  let calls = 0, finish!: (result: string) => void, workSignal!: AbortSignal
  const work = async (emit: (event: string) => void, signal: AbortSignal) => { calls++; workSignal = signal; emit('downloading'); return new Promise<string>(resolve => { finish = resolve }) }
  const one = group.run('java17/x64', event => events.push('one:' + event), work, controller.signal)
  const two = group.run('java17/x64', event => events.push('two:' + event), work)
  await Promise.resolve(); assert.equal(calls, 1); controller.abort()
  await assert.rejects(one, { name: 'AbortError' }); assert.equal(workSignal.aborted, false)
  finish('ready'); assert.equal(await two, 'ready')
  assert.deepEqual(events, ['one:downloading', 'two:downloading'])
})

test('118 failed or abandoned Java preparations can be retried and every caller owns its cancellation', async () => {
  const group = new JavaPreparation<string, string>()
  await assert.rejects(group.run('same', () => {}, async () => { throw new Error('provider failure') }), /provider failure/)
  assert.equal(await group.run('same', () => {}, async () => 'retry ready'), 'retry ready')
  const controller = new AbortController(); let oldSignal!: AbortSignal, finish!: () => void
  const old = group.run('abandoned', () => {}, async (_emit, signal) => { oldSignal = signal; await new Promise<void>(resolve => { finish = resolve }); signal.throwIfAborted(); return 'unreachable' }, controller.signal)
  await Promise.resolve(); controller.abort(); await assert.rejects(old, { name: 'AbortError' }); assert.equal(oldSignal.aborted, true)
  assert.equal(await group.run('abandoned', () => {}, async () => 'fresh preparation'), 'fresh preparation')
  finish(); await Promise.resolve()
})
