import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import AdmZip from 'adm-zip'

const coordinate = '1.7.10-10.13.4.1614-1.7.10'
const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${coordinate}/forge-${coordinate}-installer.jar`
const universalUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${coordinate}/forge-${coordinate}-universal.jar`
const universalPath = `net/minecraftforge/forge/${coordinate}/forge-${coordinate}.jar`
const remotePath = 'example/legacy/client/1.0/client-1.0.jar'
const sha1 = (bytes: Buffer | string) => crypto.createHash('sha1').update(bytes).digest('hex')
const remote = Buffer.from('Small synthetic dependency; never executable'), variant = Buffer.from('Another legitimate synthetic legacy variant')
const universal = new AdmZip(); universal.addFile('META-INF/MANIFEST.MF', Buffer.from('Manifest-Version: 1.0\n')); universal.addFile('fixture.txt', Buffer.from('Small synthetic universal; never executable'))
const embedded = universal.toBuffer()
function profile() {
  return {
    install: { minecraft: '1.7.10', path: `net.minecraftforge:forge:${coordinate}`, target: 'Legacy Forge fixture', filePath: `forge-${coordinate}-universal.jar` },
    versionInfo: { id: 'Legacy Forge fixture', inheritsFrom: '1.7.10', jar: '1.7.10', type: 'release', assets: '1.7.10',
      mainClass: 'net.minecraft.launchwrapper.Launch', minecraftArguments: '--username ${auth_player_name} --tweakClass cpw.mods.fml.common.launcher.FMLTweaker', libraries: [
        { name: `net.minecraftforge:forge:${coordinate}`, url: 'https://maven.minecraftforge.net/' },
        { name: 'example.legacy:client:1.0', checksums: [sha1(remote)] }
      ] }
  }
}
function installer(file: string, metadata: any = profile(), bytes = embedded, extra?: (zip: AdmZip) => void) {
  const zip = new AdmZip(); zip.addFile('install_profile.json', Buffer.from(JSON.stringify(metadata)))
  zip.addFile(`forge-${coordinate}-universal.jar`, bytes); extra?.(zip); zip.writeZip(file)
}
let code: Promise<string> | undefined
async function harness(root: string, local?: string, forbidJava = false) {
  const bundle = await (code ??= build({ stdin: { contents: "export {readLegacyForgeInstaller,prepareLegacyForgeInstaller} from './src/main/core/legacyForgeInstaller';export {installLoader} from './src/main/core/loaders';export {launchLibraryFiles} from './src/main/core/versions';export {ensureLaunchArtifact} from './src/main/core/launchIntegrity';export {getSettings} from './src/main/core/settings';export {closeHttpClient} from './src/main/core/httpClient';export {registerTask,pauseTask,resumeTask,finishTask} from './src/main/core/tasks';export {withFileJob} from './src/main/core/fileJobs';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'no-legacy-java', setup(builder) {
    builder.onLoad({ filter: /[\\/]core[\\/]java\.ts$/ }, input => ({ loader: 'ts', contents: fs.readFileSync(input.path, 'utf8').replace('export function ensureJava(', 'function unusedEnsureJava(') + "\nexport async function ensureJava(){throw new Error('Legacy installation must not invoke Java');}" }))
  } }] }).then(result => result.outputFiles[0].text))
  const require = createRequire(path.resolve('package.json')), mod = { exports: {} as any }, requests: string[] = []
  const route = (url: string) => local ? url.replace(/^https:\/\/(?:maven\.minecraftforge\.net|libraries\.minecraft\.net|bmclapi2\.bangbang93\.com)(?:\/maven)?/, local) : url
  fs.mkdirSync(path.join(root, 'userData'), { recursive: true })
  new Function('require', 'module', 'exports', 'fetch', bundle)(name => name === 'electron'
    ? { app: { getPath: (key: string) => path.join(root, key), getVersion: () => 'test', getName: () => 'KAMUCL-test', isPackaged: false } }
    : name === 'node:child_process' && forbidJava ? { ...require(name), spawn: () => { throw new Error('Legacy installation must not spawn Java or a contained program') } }
      : name === 'undici' ? { ...require(name), fetch: (url: string, init: any) => { requests.push(String(url)); return require(name).fetch(route(String(url)), init) } } : require(name), mod, mod.exports,
    async (url: string) => { requests.push(String(url)); return new Response(`<metadata><version>${coordinate}</version></metadata>`) })
  return { ...mod.exports, requests } as {
    readLegacyForgeInstaller: typeof import('../src/main/core/legacyForgeInstaller').readLegacyForgeInstaller
    prepareLegacyForgeInstaller: typeof import('../src/main/core/legacyForgeInstaller').prepareLegacyForgeInstaller
    installLoader: typeof import('../src/main/core/loaders').installLoader
    launchLibraryFiles: typeof import('../src/main/core/versions').launchLibraryFiles
    ensureLaunchArtifact: typeof import('../src/main/core/launchIntegrity').ensureLaunchArtifact
    getSettings: typeof import('../src/main/core/settings').getSettings
    closeHttpClient: () => Promise<void>
    registerTask: typeof import('../src/main/core/tasks').registerTask
    pauseTask: typeof import('../src/main/core/tasks').pauseTask
    resumeTask: typeof import('../src/main/core/tasks').resumeTask
    finishTask: typeof import('../src/main/core/tasks').finishTask
    withFileJob: typeof import('../src/main/core/fileJobs').withFileJob
    requests: string[]
  }
}
async function fixture(run: (root: string) => Promise<void>) {
  const temporaryBase = fs.realpathSync.native(os.tmpdir()), prefix = 'kamucl-legacy-forge120 中文 '
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(temporaryBase, prefix)))
  assert.equal(fs.realpathSync.native(root), root)
  try { await run(root) } finally {
    const relative = path.relative(temporaryBase, root)
    assert(relative.startsWith(prefix) && relative === path.basename(root) && !path.isAbsolute(relative))
    assert.equal(path.dirname(root), temporaryBase)
    assert.equal(fs.realpathSync.native(root), root)
    fs.rmSync(root, { recursive: true, force: true })
  }
}
async function server(run: (local: string, requests: string[]) => Promise<void>, response: (url: string) => { bytes?: Buffer | string; status?: number } = url => url.endsWith('.sha1') ? { bytes: sha1(remote) } : { bytes: remote }) {
  const requests: string[] = []
  const service = http.createServer((req, res) => { requests.push(req.url!); const result = response(req.url!); const bytes = Buffer.from(result.bytes ?? 'not found'); res.writeHead(result.status ?? 200, { 'content-length': bytes.length }); res.end(bytes) })
  await new Promise<void>(resolve => service.listen(0, '127.0.0.1', resolve))
  try { await run(`http://127.0.0.1:${(service.address() as import('node:net').AddressInfo).port}`, requests) }
  finally { service.closeAllConnections(); await new Promise<void>(resolve => service.close(() => resolve())) }
}
const noWorkDirectories = (root: string) => !fs.existsSync(root) || !fs.readdirSync(root).some(name => name.startsWith('.kamucl-legacy-forge-'))

test('legacy Forge classifies the exact official coordinate, embedded universal and client-only libraries without executing Java', async () => fixture(async root => {
  const runtime = await harness(root), file = path.join(root, 'installer.jar'), data = profile()
  data.versionInfo.libraries.push({ name: 'example:server-only:2.0', clientreq: false } as any)
  installer(file, data)
  try {
    const plan = runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl)!
    assert.equal(plan.profile.id, data.versionInfo.id); assert.equal(plan.profile.minecraftArguments, data.versionInfo.minecraftArguments)
    assert.equal(plan.profile._loaderVersion, '10.13.4.1614'); assert.equal(plan.libraries.length, 2)
    assert.equal(plan.libraries[0].relative, universalPath); assert.equal(plan.libraries[0].url, universalUrl); assert.deepEqual(plan.libraries[0].embedded, embedded)
    assert.equal(plan.libraries[1].url, 'https://libraries.minecraft.net/' + remotePath)
    assert.deepEqual(runtime.requests, [])
  } finally { await runtime.closeHttpClient() }
}))

test('modern Forge/NeoForge profiles keep CLI classification and malformed recognized legacy profiles fail closed', async () => fixture(async root => {
  const runtime = await harness(root), file = path.join(root, 'installer.jar')
  try {
    for (const data of [{ libraries: [] }, { spec: 1, processors: [], data: {}, libraries: [] }, {}]) {
      installer(file, data); assert.equal(runtime.readLegacyForgeInstaller(file, '1.20.1', '47.4.20', installerUrl), null)
    }
    for (const data of [{ versionInfo: {} }, { install: {} }, { ...profile(), processors: [] }, { ...profile(), spec: 1 }]) {
      installer(file, data); assert.throws(() => runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl), /旧版|混合/)
    }
  } finally { await runtime.closeHttpClient() }
}))

test('legacy Forge rejects unsafe paths, wrong versions, mixed metadata, invalid checksums and duplicate identities before writing', async () => fixture(async root => {
  const runtime = await harness(root), file = path.join(root, 'installer.jar')
  const cases: Array<(data: any) => void> = [
    data => { data.install.minecraft = '1.8.9' }, data => { data.install.path = 'net.minecraftforge:forge:1.7.10-10.13.4.16140-1.7.10' },
    data => { data.install.path = 'example:other:1.0' }, data => { data.install.target = 'other' }, data => { data.versionInfo.inheritsFrom = '1.8.9' },
    data => { data.versionInfo.jar = '../../outside' }, data => { data.versionInfo.id = data.install.target = '../outside' },
    data => { data.install.filePath = '../universal.jar' }, data => { data.install.filePath = 'other.jar' },
    data => { data.install.transform = [] }, data => { data.install.stripMeta = true }, data => { data.optionals = [] },
    data => { data.versionInfo.libraries[1].name = 'bad/group:client:1.0' }, data => { data.versionInfo.libraries[1].name = 'group:../client:1.0' },
    data => { data.versionInfo.libraries[1].name = 'group:client:..' }, data => { data.versionInfo.libraries[1].name = 'group:NUL:1.0' },
    data => { data.versionInfo.libraries[1].checksums = ['not-a-checksum'] }, data => { data.versionInfo.libraries[1].checksums = [] },
    data => { data.versionInfo.libraries[1].url = 'http://127.0.0.1/private' }, data => { data.versionInfo.libraries[1].url = 'https://user:secret@maven.minecraftforge.net/' },
    data => { data.versionInfo.libraries[1].downloads = {} }, data => { data.versionInfo.libraries[1].clientreq = 'false' },
    data => { data.versionInfo.libraries.push(data.versionInfo.libraries[1]) }, data => { data.versionInfo.libraries.shift() },
    data => { data.versionInfo.libraries[0].checksums = [sha1('wrong embedded')] }, data => { data.versionInfo.minecraftArguments += '\n--other' },
    data => { data.versionInfo.mainClass = '../../Main' }, data => { data.versionInfo.assets = '../assets' }
  ]
  try {
    for (const mutate of cases) { const data = profile(); mutate(data); installer(file, data); assert.throws(() => runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl)) }
    installer(file)
    assert.throws(() => runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl.replace('maven.minecraftforge.net', 'elsewhere.example')), /请求版本/)
    assert.throws(() => runtime.readLegacyForgeInstaller(file, '1.20.1', '47.4.20', installerUrl), /非旧版/)
    assert(!fs.existsSync(path.join(root, 'libraries'))); assert(!fs.existsSync(path.join(root, 'versions')))
  } finally { await runtime.closeHttpClient() }
}))

test('legacy Forge refuses duplicate metadata, embedded aliases, archive links and corrupt embedded bytes', async () => fixture(async root => {
  const runtime = await harness(root), file = path.join(root, 'installer.jar')
  try {
    installer(file, profile(), embedded, zip => zip.addFile('INSTALL_PROFILE.JSON', Buffer.from('{}')))
    assert.throws(() => runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl), /冲突/)
    installer(file, profile(), embedded, zip => zip.addFile(`FORGE-${coordinate}-UNIVERSAL.JAR`, embedded))
    assert.throws(() => runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl), /重复/)
    installer(file, profile(), embedded, zip => { zip.getEntry(`forge-${coordinate}-universal.jar`)!.attr = (0o120777 << 16) >>> 0 })
    assert.throws(() => runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl), /不安全/)
    installer(file, profile(), Buffer.from('not a jar'))
    assert.throws(() => runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl), /JAR/)
  } finally { await runtime.closeHttpClient() }
}))

test('production legacy Forge pipeline downloads the verified sidecar and creates the requested Chinese instance without Java CLI', { timeout: 15000 }, async () => fixture(async root => {
  const file = path.join(root, 'installer.jar'); installer(file)
  const installerBytes = fs.readFileSync(file), game = path.join(root, '游戏 空格'), base = path.join(game, 'versions', '1.7.10')
  fs.mkdirSync(base, { recursive: true }); fs.writeFileSync(path.join(base, '1.7.10.json'), JSON.stringify({ id: '1.7.10', libraries: [], mainClass: 'fixture.Client' })); fs.writeFileSync(path.join(base, '1.7.10.jar'), 'Synthetic client, never executed')
  await server(async (local, requests) => {
    const runtime = await harness(root, local, true), events: any[] = []
    try {
      Object.assign(runtime.getSettings(), { gameDir: game, activeFolder: game, folders: [{ path: game, name: 'Fixture', isDefault: true }], mirror: 'official' })
      const id = await runtime.installLoader('forge', '1.7.10', '10.13.4.1614', event => events.push(event), '中文 § 测试实例')
      assert.equal(id, '中文 § 测试实例'); assert(requests.some(url => url.endsWith('-installer.jar.sha1'))); assert(requests.some(url => url.endsWith('-installer.jar')))
      const profile = JSON.parse(fs.readFileSync(path.join(game, 'versions', id, id + '.json'), 'utf8'))
      assert.equal(profile._loader, 'forge'); assert.equal(profile._loaderVersion, '10.13.4.1614'); assert.equal(profile._mcVersion, '1.7.10'); assert(!profile.inheritsFrom)
      assert.equal(profile.mainClass, 'net.minecraft.launchwrapper.Launch'); assert.match(profile.minecraftArguments, /FMLTweaker/)
      assert.equal(profile.libraries.length, 2); assert.equal(profile.libraries[0].downloads.artifact.sha1, sha1(embedded)); assert.equal(profile.libraries[1].downloads.artifact.sha1, sha1(remote))
      assert.deepEqual(fs.readFileSync(path.join(game, 'libraries', universalPath)), embedded)
      assert.equal(fs.readFileSync(path.join(base, '1.7.10.jar'), 'utf8'), 'Synthetic client, never executed')
      assert(!fs.existsSync(path.join(game, 'launcher_profiles.json'))); assert(!fs.existsSync(path.join(game, 'versions', id, '.installing'))); assert(noWorkDirectories(path.join(game, 'libraries')))
      assert.equal(events.filter(event => event.stage === 'done').length, 1)
    } finally { await runtime.closeHttpClient() }
  }, url => url.endsWith('-installer.jar.sha1') ? { bytes: sha1(installerBytes) } : url.endsWith('-installer.jar') ? { bytes: installerBytes } : { bytes: remote })
}))

test('legacy checksum variants accept the actual declared variant and persist its exact hash and size', async () => fixture(async root => {
  await server(async local => {
    const runtime = await harness(root, local), file = path.join(root, 'installer.jar'), data = profile(), libraries = path.join(root, 'libraries')
    data.versionInfo.libraries[1].checksums = [sha1(remote), sha1(variant)]; installer(file, data)
    const prepared = await runtime.prepareLegacyForgeInstaller(runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl)!, libraries, 'official', () => {})
    try {
      const id = await prepared.install(root, undefined, () => {}), stored = JSON.parse(fs.readFileSync(path.join(root, 'versions', id, id + '.json'), 'utf8'))
      assert.equal(stored.libraries[1].downloads.artifact.sha1, sha1(variant)); assert.equal(stored.libraries[1].downloads.artifact.size, variant.length)
      prepared.complete(); assert(!fs.existsSync(path.join(root, 'versions', id, '.installing')))
    } finally { prepared.dispose(); await runtime.closeHttpClient() }
    assert(noWorkDirectories(libraries))
  }, () => ({ bytes: variant }))
}))

test('a bad legacy checksum variant publishes no embedded JAR or profile and removes task staging', async () => fixture(async root => {
  await server(async local => {
    const runtime = await harness(root, local), file = path.join(root, 'installer.jar'), data = profile(), libraries = path.join(root, 'libraries')
    data.versionInfo.libraries[1].checksums = [sha1(remote), sha1(variant)]; installer(file, data)
    try {
      await assert.rejects(runtime.prepareLegacyForgeInstaller(runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl)!, libraries, 'official', () => {}), /SHA-1/)
      assert(!fs.existsSync(path.join(libraries, universalPath))); assert(!fs.existsSync(path.join(root, 'versions'))); assert(noWorkDirectories(libraries))
    } finally { await runtime.closeHttpClient() }
  }, () => ({ bytes: 'Bad synthetic bytes' }))
}))

test('unhashed legacy dependencies require a sidecar and never download an unchecked file', async () => fixture(async root => {
  await server(async (local, requests) => {
    const runtime = await harness(root, local), file = path.join(root, 'installer.jar'), data = profile(), libraries = path.join(root, 'libraries')
    delete (data.versionInfo.libraries[1] as any).checksums; installer(file, data)
    try {
      await assert.rejects(runtime.prepareLegacyForgeInstaller(runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl)!, libraries, 'official', () => {}), /可靠的 SHA-1/)
      assert(requests.every(url => url.endsWith('.sha1'))); assert(noWorkDirectories(libraries)); assert(!fs.existsSync(path.join(root, 'versions')))
    } finally { await runtime.closeHttpClient() }
  }, () => ({ status: 404 }))
}))

test('legacy dependency sidecars are used to verify files with no profile hash', async () => fixture(async root => {
  await server(async (local, requests) => {
    const runtime = await harness(root, local), file = path.join(root, 'installer.jar'), data = profile(), libraries = path.join(root, 'libraries')
    delete (data.versionInfo.libraries[1] as any).checksums; installer(file, data)
    let prepared: Awaited<ReturnType<typeof runtime.prepareLegacyForgeInstaller>> | undefined
    try {
      prepared = await runtime.prepareLegacyForgeInstaller(runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl)!, libraries, 'official', () => {})
      const id = await prepared.install(root, undefined, () => {}); prepared.complete()
      assert(requests.includes('/' + remotePath + '.sha1')); assert(requests.includes('/' + remotePath))
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'versions', id, id + '.json'), 'utf8')).libraries[1].downloads.artifact.sha1, sha1(remote))
    } finally { prepared?.dispose(); await runtime.closeHttpClient() }
  })
}))

test('legacy setup blocks while paused, cancels without requests and leaves existing player files untouched', async () => fixture(async root => {
  const runtime = await harness(root), file = path.join(root, 'installer.jar'); installer(file)
  const task = runtime.registerTask('Legacy paused fixture', 'version'), libraries = path.join(root, 'libraries')
  const existing = path.join(root, 'versions', 'Other user instance', 'saves', 'world.txt'); fs.mkdirSync(path.dirname(existing), { recursive: true }); fs.writeFileSync(existing, 'User-owned sentinel')
  runtime.pauseTask(task.id)
  const work = runtime.prepareLegacyForgeInstaller(runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl)!, libraries, 'official', () => {}, task.controller.signal)
  try {
    await new Promise(resolve => setTimeout(resolve, 100)); assert(!fs.existsSync(libraries)); assert.deepEqual(runtime.requests, [])
    task.controller.abort(new Error('cancelled paused legacy'))
    await assert.rejects(work, /已取消|cancelled paused legacy/); assert(!fs.existsSync(libraries)); assert.equal(fs.readFileSync(existing, 'utf8'), 'User-owned sentinel')
  } finally { runtime.finishTask(task.id); await runtime.closeHttpClient() }
}))

test('paused legacy publication waits for resume without committing its files or target profile', async () => fixture(async root => {
  await server(async local => {
    const runtime = await harness(root, local), file = path.join(root, 'installer.jar'); installer(file)
    const task = runtime.registerTask('Legacy publication pause', 'version'), paused = Promise.withResolvers<void>(), libraries = path.join(root, 'libraries')
    let requestedPause = false, prepared: Awaited<ReturnType<typeof runtime.prepareLegacyForgeInstaller>> | undefined
    const work = runtime.prepareLegacyForgeInstaller(runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl)!, libraries, 'official', event => {
      if (event.progress === 1 && !requestedPause) { requestedPause = true; runtime.pauseTask(task.id); paused.resolve() }
    }, task.controller.signal)
    try {
      await paused.promise; await new Promise(resolve => setTimeout(resolve, 100))
      assert(!fs.existsSync(path.join(libraries, universalPath))); assert(!fs.existsSync(path.join(root, 'versions')))
      runtime.resumeTask(task.id); prepared = await work
      const id = await prepared.install(root, 'Resumed fixture', () => {}, task.controller.signal); prepared.complete(); assert(fs.existsSync(path.join(root, 'versions', id, id + '.json')))
    } finally { runtime.resumeTask(task.id); prepared ??= await work.catch(() => undefined); prepared?.dispose(); runtime.finishTask(task.id); await runtime.closeHttpClient() }
  })
}))

test('legacy file writes reject root and ancestor directory junctions before touching their targets', async () => fixture(async root => {
  const runtime = await harness(root), file = path.join(root, 'installer.jar'); installer(file)
  const plan = runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl)!, external = path.join(root, 'outside'), linked = path.join(root, 'linked'), libraries = path.join(root, 'libraries')
  fs.mkdirSync(external); fs.writeFileSync(path.join(external, 'sentinel'), 'Preserve external'); fs.symlinkSync(external, linked, process.platform === 'win32' ? 'junction' : 'dir')
  try {
    await assert.rejects(runtime.prepareLegacyForgeInstaller(plan, linked, 'official', () => {}), /链接/)
    fs.mkdirSync(libraries); fs.symlinkSync(external, path.join(libraries, 'net'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(runtime.prepareLegacyForgeInstaller(plan, libraries, 'official', () => {}), /链接/)
    assert.equal(fs.readFileSync(path.join(external, 'sentinel'), 'utf8'), 'Preserve external'); assert.equal(fs.readdirSync(external).length, 1); assert(noWorkDirectories(libraries))
  } finally { await runtime.closeHttpClient() }
}))

test('legacy profile creation refuses an existing user instance and rollback only removes its newly created transaction', async () => fixture(async root => {
  await server(async local => {
    const runtime = await harness(root, local), file = path.join(root, 'installer.jar'), libraries = path.join(root, 'libraries'); installer(file)
    const prepared = await runtime.prepareLegacyForgeInstaller(runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl)!, libraries, 'official', () => {})
    const existing = path.join(root, 'versions', 'User instance', 'saves', 'world.txt'); fs.mkdirSync(path.dirname(existing), { recursive: true }); fs.writeFileSync(existing, 'Keep user data')
    try {
      await assert.rejects(prepared.install(root, 'User instance', () => {}), /已存在，未覆盖/)
      const id = await prepared.install(root, 'New transaction', () => {}); assert(fs.existsSync(path.join(root, 'versions', id, '.installing')))
      prepared.dispose(); assert(!fs.existsSync(path.join(root, 'versions', id))); assert.equal(fs.readFileSync(existing, 'utf8'), 'Keep user data')
      assert.deepEqual(fs.readFileSync(path.join(libraries, universalPath)), embedded)
    } finally { prepared.dispose(); await runtime.closeHttpClient() }
  })
}))

test('legacy generation detects dependency mutation and obeys the same target installer lock and cancellation', async () => fixture(async root => {
  await server(async local => {
    const runtime = await harness(root, local), file = path.join(root, 'installer.jar'), libraries = path.join(root, 'libraries'); installer(file)
    const prepared = await runtime.prepareLegacyForgeInstaller(runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl)!, libraries, 'official', () => {})
    try {
      fs.writeFileSync(path.join(libraries, remotePath), 'Changed after verification')
      await assert.rejects(prepared.install(root, 'Mutated fixture', () => {}), /发生变化/); assert(!fs.existsSync(path.join(root, 'versions', 'Mutated fixture')))
      fs.writeFileSync(path.join(libraries, remotePath), remote)
      const lockEntered = Promise.withResolvers<void>(), releaseLock = Promise.withResolvers<void>(), task = runtime.registerTask('Queued legacy installer', 'version')
      const held = runtime.withFileJob(path.join(root, '.kamucl-installer'), undefined, async () => { lockEntered.resolve(); await releaseLock.promise })
      await lockEntered.promise
      const work = prepared.install(root, 'Cancelled waiter', () => {}, task.controller.signal)
      try { await new Promise(resolve => setTimeout(resolve, 100)); assert(!fs.existsSync(path.join(root, 'versions', 'Cancelled waiter'))); task.controller.abort(new Error('cancel installer waiter')); await assert.rejects(work, /cancel installer waiter/) }
      finally { releaseLock.resolve(); await held; runtime.finishTask(task.id) }
    } finally { prepared.dispose(); await runtime.closeHttpClient() }
  })
}))

test('legacy completion requires its exact transaction marker and never deletes a changed marker or profile', async () => fixture(async root => {
  await server(async local => {
    const runtime = await harness(root, local), file = path.join(root, 'installer.jar'); installer(file)
    const prepared = await runtime.prepareLegacyForgeInstaller(runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl)!, path.join(root, 'libraries'), 'official', () => {})
    try {
      const id = await prepared.install(root, undefined, () => {}), mark = path.join(root, 'versions', id, '.installing')
      fs.writeFileSync(mark, 'Changed by another owner')
      assert.throws(prepared.complete, /事务标记已改变/); prepared.dispose(); assert(fs.existsSync(mark)); assert(fs.existsSync(path.join(root, 'versions', id, id + '.json')))
    } finally { prepared.dispose(); await runtime.closeHttpClient() }
  })
}))

test('a sidecar paused longer than its active network timeout completes after resume without falsely failing', { timeout: 10000 }, async () => fixture(async root => {
  const entered = Promise.withResolvers<void>(), sendBody = Promise.withResolvers<void>(), requests: string[] = []
  const service = http.createServer(async (req, res) => {
    requests.push(req.url!)
    if (req.url!.endsWith('.sha1')) {
      res.writeHead(200, { 'content-length': 40 }); res.flushHeaders(); entered.resolve(); await sendBody.promise; res.end(sha1(remote))
    } else { res.writeHead(200, { 'content-length': remote.length }); res.end(remote) }
  })
  await new Promise<void>(resolve => service.listen(0, '127.0.0.1', resolve))
  const local = `http://127.0.0.1:${(service.address() as import('node:net').AddressInfo).port}`
  const runtime = await harness(root, local), file = path.join(root, 'installer.jar'), data = profile(), libraries = path.join(root, 'libraries')
  delete (data.versionInfo.libraries[1] as any).checksums; installer(file, data)
  const task = runtime.registerTask('Legacy sidecar pause', 'version')
  let settled = false, prepared: Awaited<ReturnType<typeof runtime.prepareLegacyForgeInstaller>> | undefined
  const work = runtime.prepareLegacyForgeInstaller(runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl)!, libraries, 'official', () => {}, task.controller.signal)
  void work.then(() => { settled = true }, () => { settled = true })
  try {
    await entered.promise; runtime.pauseTask(task.id); sendBody.resolve()
    await new Promise(resolve => setTimeout(resolve, 4300)); assert.equal(settled, false); assert.equal(requests.length, 1); assert(!fs.existsSync(path.join(libraries, universalPath)))
    runtime.resumeTask(task.id); prepared = await work
    const id = await prepared.install(root, 'Long pause fixture', () => {}, task.controller.signal); prepared.complete()
    assert(fs.existsSync(path.join(root, 'versions', id, id + '.json'))); assert.equal(requests.length, 2)
  } finally {
    sendBody.resolve(); runtime.resumeTask(task.id); prepared ??= await work.catch(() => undefined); prepared?.dispose(); runtime.finishTask(task.id); await runtime.closeHttpClient()
    service.closeAllConnections(); await new Promise<void>(resolve => service.close(() => resolve()))
  }
}))

test('verified legacy caches avoid downloads and corrupted cache entries are replaced only with checked bytes', async () => fixture(async root => {
  await server(async local => {
    const runtime = await harness(root, local), file = path.join(root, 'installer.jar'), libraries = path.join(root, 'libraries'); installer(file)
    fs.mkdirSync(path.dirname(path.join(libraries, universalPath)), { recursive: true }); fs.writeFileSync(path.join(libraries, universalPath), embedded)
    fs.mkdirSync(path.dirname(path.join(libraries, remotePath)), { recursive: true }); fs.writeFileSync(path.join(libraries, remotePath), 'Corrupted managed Maven cache')
    const plan = runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl)!
    let prepared: Awaited<ReturnType<typeof runtime.prepareLegacyForgeInstaller>> | undefined
    try {
      prepared = await runtime.prepareLegacyForgeInstaller(plan, libraries, 'official', () => {})
      assert.deepEqual(fs.readFileSync(path.join(libraries, remotePath)), remote); assert.deepEqual(fs.readFileSync(path.join(libraries, universalPath)), embedded)
      prepared.dispose(); const before = runtime.requests.length
      prepared = await runtime.prepareLegacyForgeInstaller(plan, libraries, 'official', () => {})
      assert.equal(runtime.requests.length, before); const id = await prepared.install(root, 'Cached fixture', () => {}); prepared.complete(); assert(fs.existsSync(path.join(root, 'versions', id, id + '.json')))
    } finally { prepared?.dispose(); await runtime.closeHttpClient() }
  })
}))

test('cancellation drains an in-flight legacy checksum response and deletes staging without touching a player instance', { timeout: 5000 }, async () => fixture(async root => {
  const entered = Promise.withResolvers<void>(), closed = Promise.withResolvers<void>()
  let requests = 0
  const service = http.createServer((_req, res) => {
    requests++; res.on('close', () => closed.resolve()); res.writeHead(200, { 'content-type': 'text/plain' }); res.flushHeaders(); entered.resolve()
  })
  await new Promise<void>(resolve => service.listen(0, '127.0.0.1', resolve))
  const local = `http://127.0.0.1:${(service.address() as import('node:net').AddressInfo).port}`
  const runtime = await harness(root, local), file = path.join(root, 'installer.jar'), data = profile(), libraries = path.join(root, 'libraries')
  delete (data.versionInfo.libraries[1] as any).checksums; installer(file, data)
  const playerFile = path.join(root, 'versions', 'Existing player instance', 'options.txt'); fs.mkdirSync(path.dirname(playerFile), { recursive: true }); fs.writeFileSync(playerFile, 'Untouched player options')
  const control = new AbortController()
  const work = runtime.prepareLegacyForgeInstaller(runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl)!, libraries, 'official', () => {}, control.signal)
  try {
    await entered.promise; control.abort(new Error('cancel in-flight checksum'))
    await assert.rejects(work, /cancel in-flight checksum/)
    await Promise.race([closed.promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Cancelled sidecar response remained open')), 750))])
    assert.equal(requests, 1); assert(noWorkDirectories(libraries)); assert(!fs.existsSync(path.join(libraries, universalPath))); assert.equal(fs.readFileSync(playerFile, 'utf8'), 'Untouched player options')
  } finally { await work.catch(() => {}); await runtime.closeHttpClient(); service.closeAllConnections(); await new Promise<void>(resolve => service.close(() => resolve())) }
}))

test('legacy launchLibraryFiles repairs deleted and corrupt universal caches from the bound classifier URL with exact embedded identity', async () => fixture(async root => {
  await server(async (local, requests) => {
    const runtime = await harness(root, local), file = path.join(root, 'installer.jar'), libraries = path.join(root, 'libraries'); installer(file)
    Object.assign(runtime.getSettings(), { gameDir: root, activeFolder: root, folders: [{ path: root, name: 'Fixture', isDefault: true }], mirror: 'official' })
    const prepared = await runtime.prepareLegacyForgeInstaller(runtime.readLegacyForgeInstaller(file, '1.7.10', '10.13.4.1614', installerUrl)!, libraries, 'official', () => {})
    try {
      const id = await prepared.install(root, 'Repairable legacy fixture', () => {}); prepared.complete()
      const profile = JSON.parse(fs.readFileSync(path.join(root, 'versions', id, id + '.json'), 'utf8'))
      const artifact = runtime.launchLibraryFiles(profile).find(item => item.dest === path.join(libraries, universalPath))!
      assert(artifact); assert.equal(artifact.url, universalUrl); assert.equal(artifact.sha1, sha1(embedded)); assert.equal(artifact.size, embedded.length)
      assert(!requests.some(url => url.endsWith('-universal.jar')), 'Initial installation must use the verified embedded payload without an extra network dependency')
      fs.unlinkSync(artifact.dest)
      assert.equal(await runtime.ensureLaunchArtifact(artifact, 'official'), true); assert.deepEqual(fs.readFileSync(artifact.dest), embedded)
      fs.writeFileSync(artifact.dest, Buffer.from('A corrupt universal with a different size'))
      assert.equal(await runtime.ensureLaunchArtifact(artifact, 'official'), true); assert.deepEqual(fs.readFileSync(artifact.dest), embedded)
      assert.equal(await runtime.ensureLaunchArtifact(artifact, 'official'), false)
      assert.equal(requests.filter(url => url.endsWith('-universal.jar')).length, 2)
      assert(!fs.readdirSync(path.dirname(artifact.dest)).some(name => name.startsWith('.kamucl-repair-')))
    } finally { prepared.dispose(); await runtime.closeHttpClient() }
  }, url => ({ bytes: url.endsWith('-universal.jar') ? embedded : remote }))
}))
