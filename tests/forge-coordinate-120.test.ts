import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { build } from 'esbuild'
import AdmZip from 'adm-zip'

const official = 'https://maven.minecraftforge.net/net/minecraftforge/forge/'
const mirror = 'https://bmclapi2.bangbang93.com/maven/net/minecraftforge/forge/'
const artifact = (coordinate: string) => `${official}${coordinate}/forge-${coordinate}-installer.jar`
const xml = (...versions: string[]) => `<metadata><versioning><versions>${versions.map(version => `<version>${version}</version>`).join('')}</versions></versioning></metadata>`
let bundle: Promise<string> | undefined

/** Execute the bundled production resolver; only Electron and transport are
 * private fixtures. Java is replaced only in the installation transaction test. */
async function harness(root: string, metadataFetch: typeof fetch, javaFixture = false, routeDownload = (url: string) => url, installerSHA1?: string) {
  const options = {
    stdin: { contents: "export {resolveForgeInstallerUrl,installLoader} from './src/main/core/loaders';export {getSettings} from './src/main/core/settings';export {closeHttpClient} from './src/main/core/httpClient';export {registerTask,pauseTask,resumeTask,finishTask} from './src/main/core/tasks';", resolveDir: process.cwd(), loader: 'ts' as const },
    bundle: true, write: false, platform: 'node' as const, format: 'cjs' as const, packages: 'external' as const, logLevel: 'silent' as const
  }
  const code = javaFixture ? (await build({ ...options, plugins: [{ name: 'synthetic-java-only', setup(builder) {
    builder.onLoad({ filter: /[\\/]core[\\/]java\.ts$/ }, entry => ({ loader: 'ts', contents:
      fs.readFileSync(entry.path, 'utf8').replace('export function ensureJava(', 'function originalEnsureJava(') + "\nexport async function ensureJava(){return 'synthetic-forge120-java';}" }))
  } }] })).outputFiles[0].text : await (bundle ??= build(options).then(result => result.outputFiles[0].text))
  const require = createRequire(path.resolve('package.json')), module = { exports: {} as any }
  fs.mkdirSync(path.join(root, 'userData'), { recursive: true })
  const childEvents = { spawned: 0, closed: 0 }
  const fakeSpawn = (exe: string, args: string[], options: any) => {
    assert.equal(exe, 'synthetic-forge120-java', 'never execute a real JVM or archive-contained program')
    const installer = fs.readFileSync(args[1])
    assert.equal(crypto.createHash('sha1').update(installer).digest('hex'), installerSHA1)
    childEvents.spawned++
    const child: any = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
    child.kill = () => { setImmediate(() => { childEvents.closed++; child.emit('close', null) }); return true }
    setImmediate(() => {
      const dir = path.join(options.cwd, 'versions', 'synthetic-forge120')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'synthetic-forge120.json'), JSON.stringify({ id: 'synthetic-forge120', inheritsFrom: '1.7.10', _mcVersion: '1.7.10', _loader: 'forge', _loaderVersion: '10.13.4.1614', libraries: [], mainClass: 'synthetic.Main' }))
      child.stdout.end(); child.stderr.end(); childEvents.closed++; child.emit('close', 0)
    })
    return child
  }
  new Function('require', 'module', 'exports', 'fetch', code)(
    (name: string) => name === 'electron' ? { app: { getPath: (key: string) => path.join(root, key), getName: () => 'KAMUCL-test', getVersion: () => 'test', isPackaged: false } }
      : name === 'node:child_process' && javaFixture ? { ...require(name), spawn: fakeSpawn }
        : name === 'undici' ? { ...require(name), fetch: (url: string, init: unknown) => require(name).fetch(routeDownload(String(url)), init) }
          : require(name), module, module.exports, metadataFetch)
  return { ...module.exports, childEvents } as {
    resolveForgeInstallerUrl: typeof import('../src/main/core/loaders').resolveForgeInstallerUrl
    installLoader: typeof import('../src/main/core/loaders').installLoader
    getSettings: typeof import('../src/main/core/settings').getSettings
    closeHttpClient: () => Promise<void>
    registerTask: typeof import('../src/main/core/tasks').registerTask
    pauseTask: typeof import('../src/main/core/tasks').pauseTask
    resumeTask: typeof import('../src/main/core/tasks').resumeTask
    finishTask: typeof import('../src/main/core/tasks').finishTask
    childEvents: typeof childEvents
  }
}

async function fixture(run: (root: string) => Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-forge120-'))
  try { await run(root) }
  finally {
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'kamucl-forge120-'))
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('old Forge coordinates resolve the actual 1.7.10/1.8.9 branch releases', async () => {
  await fixture(async root => {
    const requests: string[] = []
    const runtime = await harness(root, async (url, init) => { requests.push(String(url)); assert(init?.signal); return new Response(xml('1.7.10-10.13.4.1614-1.7.10', '1.8.9-11.15.1.2318-1.8.9')) })
    try {
      assert.equal(await runtime.resolveForgeInstallerUrl('1.7.10', '10.13.4.1614', 'official'), artifact('1.7.10-10.13.4.1614-1.7.10'))
      assert.equal(await runtime.resolveForgeInstallerUrl('1.8.9', '11.15.1.2318', 'official'), artifact('1.8.9-11.15.1.2318-1.8.9'))
      assert.deepEqual(requests, [official + 'maven-metadata.xml', official + 'maven-metadata.xml'])
    } finally { await runtime.closeHttpClient() }
  })
})

test('a paused legacy metadata lookup does not dispatch its fallback until resumed', async () => {
  await fixture(async root => {
    const release = Promise.withResolvers<Response>(), entered = Promise.withResolvers<void>(), requests: string[] = []
    const runtime = await harness(root, async url => {
      requests.push(String(url))
      if (String(url).startsWith(mirror)) { entered.resolve(); return release.promise }
      return new Response(xml('1.7.10-10.13.4.1614-1.7.10'))
    })
    const task = runtime.registerTask('metadata pause120', 'download')
    const work = runtime.resolveForgeInstallerUrl('1.7.10', '10.13.4.1614', 'bmclapi', task.controller.signal)
    try {
      await entered.promise; assert(runtime.pauseTask(task.id)); release.resolve(new Response('', { status: 404 }))
      await new Promise(resolve => setTimeout(resolve, 200)); assert.equal(requests.length, 1)
      runtime.resumeTask(task.id); assert.equal(await work, artifact('1.7.10-10.13.4.1614-1.7.10')); assert.equal(requests.length, 2)
    } finally {
      runtime.resumeTask(task.id); release.resolve(new Response('', { status: 404 })); await work.catch(() => {}); runtime.finishTask(task.id); await runtime.closeHttpClient()
    }
  })
})

test('ordinary legacy coordinates take precedence and metadata never selects a neighboring build or unsafe branch', async () => {
  await fixture(async root => {
    let versions = ['1.7.10-10.13.4.1614', '1.7.10-10.13.4.1614-1.7.10']
    const runtime = await harness(root, async () => new Response(xml(...versions)))
    try {
      assert.equal(await runtime.resolveForgeInstallerUrl('1.7.10', '10.13.4.1614', 'official'), artifact('1.7.10-10.13.4.1614'))
      versions = ['1.7.10-10.13.4.16140-1.7.10', '1.7.10-10.13.4.1614-../../other', '1.7.10-10.13.4.1614-alpha', '1.7.10-10.13.4.1614-beta']
      assert.equal(await runtime.resolveForgeInstallerUrl('1.7.10', '10.13.4.1614', 'official'), artifact('1.7.10-10.13.4.1614'))
      versions = ['1.7.10-10.13.4.1614-other-branch']
      assert.equal(await runtime.resolveForgeInstallerUrl('1.7.10', '10.13.4.1614', 'official'), artifact(versions[0]))
      versions = ['1.7.10-10.13.4.1614-other-branch', ' 1.7.10-10.13.4.1614-1.7.10 ']
      assert.equal(await runtime.resolveForgeInstallerUrl('1.7.10', '10.13.4.1614', 'official'), artifact('1.7.10-10.13.4.1614-1.7.10'))
    } finally { await runtime.closeHttpClient() }
  })
})

test('modern Forge and explicitly supplied legacy branches preserve URLs without metadata traffic', async () => {
  await fixture(async root => {
    let requests = 0
    const runtime = await harness(root, async () => { requests++; throw new Error('unexpected metadata request') })
    try {
      for (const [mc, version] of [['1.13.2', '25.0.223'], ['1.20.1', '47.4.20'], ['26.2', '64.0.0'], ['1.7.10', '10.13.4.1614-1.7.10']]) {
        assert.equal(await runtime.resolveForgeInstallerUrl(mc, version, 'bmclapi'), artifact(`${mc}-${version}`))
      }
      assert.equal(requests, 0)
    } finally { await runtime.closeHttpClient() }
  })
})

test('legacy metadata mirror failures drain their body and fall back to the official index', async () => {
  await fixture(async root => {
    const requests: string[] = []; let cancelled = false
    const runtime = await harness(root, async url => {
      requests.push(String(url))
      if (String(url).startsWith(mirror)) return { ok: false, body: { cancel: async () => { cancelled = true } } } as any
      return new Response(xml('1.7.10-10.13.4.1614-1.7.10'))
    })
    try {
      assert.equal(await runtime.resolveForgeInstallerUrl('1.7.10', '10.13.4.1614', 'bmclapi'), artifact('1.7.10-10.13.4.1614-1.7.10'))
      assert.deepEqual(requests, [mirror + 'maven-metadata.xml', official + 'maven-metadata.xml']); assert(cancelled)
    } finally { await runtime.closeHttpClient() }
  })
})

test('legacy cancellation before fetch or while consuming metadata never falls back to an installer URL', async () => {
  await fixture(async root => {
    let requests = 0; const started = Promise.withResolvers<void>()
    const runtime = await harness(root, async (_url, init) => {
      requests++; const signal = init!.signal!
      return { ok: true, text: () => new Promise<string>((_resolve, reject) => { started.resolve(); signal.addEventListener('abort', () => reject(signal.reason), { once: true }) }) } as any
    })
    try {
      const before = new AbortController(); before.abort(new Error('cancel before metadata'))
      await assert.rejects(runtime.resolveForgeInstallerUrl('1.7.10', '10.13.4.1614', 'bmclapi', before.signal), /cancel before metadata/); assert.equal(requests, 0)
      const during = new AbortController(), work = runtime.resolveForgeInstallerUrl('1.7.10', '10.13.4.1614', 'bmclapi', during.signal)
      await started.promise; during.abort(new Error('cancel metadata body'))
      await assert.rejects(work, /cancel metadata body/); assert.equal(requests, 1)
    } finally { await runtime.closeHttpClient() }
  })
})

test('a headers-only stalled legacy index is bounded and preserves the ordinary-coordinate fallback', { timeout: 8000 }, async () => {
  await fixture(async root => {
    let requests = 0
    const bodyClosed = Promise.withResolvers<void>()
    const server = http.createServer((_req, response) => { requests++; response.writeHead(200, { 'content-type': 'application/xml' }); response.flushHeaders(); response.on('close', () => bodyClosed.resolve()) })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/metadata`
    const runtime = await harness(root, (_source, init) => fetch(url, init))
    try {
      const start = performance.now()
      assert.equal(await runtime.resolveForgeInstallerUrl('1.7.10', '10.13.2.1230', 'official'), artifact('1.7.10-10.13.2.1230'))
      assert(performance.now() - start < 6000); assert.equal(requests, 1)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed-out metadata response remained open')), 750)
        bodyClosed.promise.then(() => { clearTimeout(timer); resolve() })
      })
    } finally { await runtime.closeHttpClient(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })
})

test('production old-Minecraft coordinate resolution uses verified sidecar and the modern-format installer CLI pipeline', { timeout: 15000 }, async () => {
  await fixture(async root => {
    const game = path.join(root, 'game'), base = path.join(game, 'versions', '1.7.10')
    fs.mkdirSync(base, { recursive: true }); fs.writeFileSync(path.join(base, '1.7.10.json'), JSON.stringify({ id: '1.7.10', libraries: [], mainClass: 'synthetic.Client' })); fs.writeFileSync(path.join(base, '1.7.10.jar'), 'synthetic client; never executed')
    // This fixture covers coordinates/sidecar/CLI orchestration only. The real
    // pre-CLI install/versionInfo schema is exercised by legacy-forge120.test.
    const jar = new AdmZip(); jar.addFile('install_profile.json', Buffer.from('{"libraries":[]}'))
    const bytes = jar.toBuffer(), checksum = crypto.createHash('sha1').update(bytes).digest('hex'), requested: string[] = []
    const coordinate = '1.7.10-10.13.4.1614-1.7.10', installerPath = `/net/minecraftforge/forge/${coordinate}/forge-${coordinate}-installer.jar`
    const server = http.createServer((request, response) => {
      requested.push(request.url!)
      if (request.url === installerPath + '.sha1') return response.end(checksum)
      if (request.url !== installerPath) { response.writeHead(404); return response.end('unexpected artifact') }
      response.writeHead(200, { 'content-length': bytes.length }); response.end(bytes)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const local = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
    const metadataRequests: string[] = []
    const runtime = await harness(root, async url => { metadataRequests.push(String(url)); assert.equal(String(url), official + 'maven-metadata.xml'); return new Response(xml(coordinate)) }, true, url => url.replace('https://maven.minecraftforge.net', local), checksum)
    try {
      Object.assign(runtime.getSettings(), { gameDir: game, activeFolder: game, folders: [{ path: game, name: 'Synthetic', isDefault: true }], mirror: 'official' })
      const id = await runtime.installLoader('forge', '1.7.10', '10.13.4.1614', () => {}, 'Synthetic old Forge')
      assert.equal(id, 'Synthetic old Forge'); assert.equal(runtime.childEvents.spawned, 1); assert.equal(runtime.childEvents.closed, 1)
      assert.deepEqual(metadataRequests, [official + 'maven-metadata.xml']); assert(requested.includes(installerPath + '.sha1')); assert(requested.includes(installerPath))
      assert(requested.every(url => url === installerPath || url === installerPath + '.sha1'))
      const installed = JSON.parse(fs.readFileSync(path.join(game, 'versions', id, id + '.json'), 'utf8'))
      assert.equal(installed._loader, 'forge'); assert.equal(installed._loaderVersion, '10.13.4.1614')
      assert.equal(fs.readFileSync(path.join(base, '1.7.10.jar'), 'utf8'), 'synthetic client; never executed')
    } finally { await runtime.closeHttpClient(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })
})
