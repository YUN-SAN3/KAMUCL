import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import net from 'node:net'
import dgram from 'node:dgram'
import { once, EventEmitter } from 'node:events'
import { buildModManifests, diffMods, scanModHashes, safeModEntry } from '../src/main/core/voxlink/modsync'
import { predict, generateTargetPorts } from '../src/main/core/voxlink/punchPolicy'
import { TurnSession } from '../src/main/core/voxlink/turn'
import { invalidLaunchArtifact } from '../src/main/core/launchIntegrity'
import { VOXLINK_LINKS } from '../src/shared/voxlinkLinks'
import type { ModSyncEntry, ModSyncManifest } from '../src/shared/voxlinkMods'
import { VoxlinkSession } from '../src/main/core/voxlink/session'
import { ApiClient } from '../src/main/core/voxlink/api'
import { build } from 'esbuild'
import { createRequire } from 'node:module'

const signal = () => new AbortController().signal
const entry = (id: string, name = `${id}-fabric-1.0.jar`): ModSyncEntry => ({ projectId: id, slug: id, title: id, versionNumber: '1.0', fileName: name, url: `https://cdn.modrinth.com/data/${id}/${name}`, sha1: crypto.createHash('sha1').update(id).digest('hex'), sha512: 'b'.repeat(128), size: 100, loaders: ['fabric'], gameVersions: ['1.20.1'] })
test('ModSync builds both scopes from actual installed hashes, own metadata plus transitive dependencies; failed hash blocks stay unknown', async () => {
  const entries = Array.from({ length: 66 }, (_, i) => entry(`mod${i}`))
  const locals = entries.map(e => ({ fileName: e.fileName, sha1: e.sha1, disabled: false }))
  const requested: string[] = []
  let blocks = 0
  const result = await buildModManifests(locals, 'fabric', '1.20.1', async (route, body) => {
    if (route === '/version_files') {
      if (++blocks === 2) throw new Error('temporary network failure')
      assert.equal(body.hashes.length, 64)
      return Object.fromEntries(entries.slice(0, 64).map((e, i) => [e.sha1, { project_id: e.projectId, version_number: e.versionNumber, loaders: e.loaders, game_versions: e.gameVersions,
        dependencies: i < 2 ? [{ project_id: entries[i + 1].projectId, dependency_type: 'required' }] : [],
        files: [{ filename: 'wrong-primary.jar', hashes: { sha1: 'f'.repeat(40), sha512: 'a'.repeat(128) } }, { filename: e.fileName, url: e.url, hashes: { sha1: e.sha1, sha512: e.sha512 }, size: e.size }] }]))
    }
    const ids = JSON.parse(decodeURIComponent(route.split('ids=')[1])); requested.push(...ids)
    return ids.map((id: string) => ({ id, title: id, slug: id, client_side: id === 'mod0' ? 'required' : id === 'mod3' ? 'unsupported' : 'optional' }))
  }, signal())
  assert.equal(blocks, 2); assert(requested.includes('mod0')); assert(requested.includes('mod2'))
  assert.deepEqual(result.required.mods.map(e => e.projectId), ['mod0', 'mod1', 'mod2'])
  assert.equal(result.all.mods.length, 63)
  assert.deepEqual(result.all.unknownMods, [entries[64].fileName, entries[65].fileName])
  assert.equal(result.required.mods[0].sha1, entries[0].sha1)
  assert.notEqual(result.required.mods[0].fileName, 'wrong-primary.jar')
})
test('ModSync recognizes disabled files and version conflicts without modifying user files; enforces loader, MC, URL, digest and filename', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voxlink 模组-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'alpha-1.0.jar.disabled'), 'alpha'); fs.writeFileSync(path.join(dir, 'beta-0.9.jar'), 'old beta')
  const local = await scanModHashes(dir, signal(), true)
  assert.equal((await scanModHashes(dir, signal())).length, 1)
  const a = entry('alpha', 'alpha-1.0.jar'), b = entry('beta', 'beta-1.0.jar'), c = entry('gamma')
  const manifest: ModSyncManifest = { protocolVersion: 'modSync.v1', loader: 'fabric', mcVersion: '1.20.1', mods: [a, b, c], unknownMods: [] }
  assert.deepEqual(diffMods(manifest, local, 'fabric', '1.20.1').map(r => r.status), ['disabled', 'conflict', 'missing'])
  assert.equal(diffMods(manifest, [], 'forge', '1.20.1')[2].status, 'unresolved')
  assert.equal(diffMods(manifest, [], 'fabric', '1.21')[2].status, 'unresolved')
  for (const bad of [{ fileName: '../bad.jar' }, { fileName: 'CON.jar' }, { url: 'https://evil.example/x.jar' }, { sha512: '' }, { size: -1 }]) assert.equal(safeModEntry({ ...c, ...bad }), false)
  assert.equal(fs.readFileSync(path.join(dir, 'beta-0.9.jar'), 'utf8'), 'old beta')
})
test('launch verification warm cache still rejects same-size corruption with restored mtime, changed expected hash, and missing file', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-warm-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const dest = path.join(dir, 'library.jar'), bytes = crypto.randomBytes(4096), sha1 = crypto.createHash('sha1').update(bytes).digest('hex')
  fs.writeFileSync(dest, bytes); const file = { dest, sha1, size: bytes.length }
  assert.equal(await invalidLaunchArtifact(file), null); assert.equal(await invalidLaunchArtifact(file), null)
  assert(await invalidLaunchArtifact({ ...file, sha1: 'a'.repeat(40) }))
  assert.equal(await invalidLaunchArtifact(file), null)
  const before = fs.statSync(dest); await new Promise(r => setTimeout(r, 10)); fs.writeFileSync(dest, Buffer.alloc(bytes.length)); fs.utimesSync(dest, before.atime, before.mtime)
  assert(await invalidLaunchArtifact(file)); fs.unlinkSync(dest); assert(await invalidLaunchArtifact(file))
})
test('TURN tolerates lost-bind ROLE_CONFLICT and UDP blackhole switches to framed TCP with fragmented responses', { timeout: 18000 }, async t => {
  const tcp = net.createServer(), sockets = new Set<net.Socket>()
  let udp = dgram.createSocket('udp4'), port = 0
  const rejectedUdp: dgram.Socket[] = [], rejectedPorts: Array<{port:number;code:string}> = []
  t.after(() => { for (const socket of sockets) socket.destroy(); if (tcp.listening) tcp.close(); for(const old of rejectedUdp)try{old.close()}catch{}; try { udp.close() } catch {} })
  // TCP and UDP have separate Windows exclusions. Let UDP choose its own
  // allowed port first: TCP's allocator may repeatedly choose adjacent ports
  // inside a UDP-only exclusion range. Then reserve the TCP counterpart. Keep
  // rejected UDP leases until both protocols bind: immediately freeing one can
  // let Windows offer the same TCP-excluded candidate repeatedly.
  for (let attempt = 0; ; attempt++) {
    let udpBound = false
    try {
      udp.bind(0, '127.0.0.1'); await once(udp, 'listening'); port = udp.address().port; udpBound = true
      tcp.listen(port, '127.0.0.1'); await once(tcp, 'listening'); break
    }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code || ''
      rejectedPorts.push({port:udpBound?port:0,code})
      if (attempt >= 255 || !['EADDRINUSE', 'EACCES'].includes(code)) throw error
      if (tcp.listening) await new Promise<void>(resolve => tcp.close(() => resolve()))
      if(udpBound)rejectedUdp.push(udp);else try { udp.close() } catch {}
      udp = dgram.createSocket('udp4')
    }
  }
  for(const old of rejectedUdp)try{old.close()}catch{};rejectedUdp.length=0
  if(rejectedPorts.length)console.log(JSON.stringify({fixture:'TURN dual-protocol port reservation',rejectedPorts,port}))
  let udpBinds = 0, tcpBinds = 0
  udp.on('message', (p, from) => { if (p[3] !== 3) return; udpBinds++; const reply = Buffer.concat([p.subarray(0, 21), Buffer.from([5])]); reply[3] = 4; udp.send(reply, from.port, from.address) })
  tcp.on('connection', socket => {
    sockets.add(socket); socket.on('error', () => {}); let pending = Buffer.alloc(0)
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk])
      while (pending.length >= 2 && pending.length >= pending.readUInt16BE(0) + 2) {
        const size = pending.readUInt16BE(0), p = pending.subarray(2, size + 2); pending = pending.subarray(size + 2)
        if (p[3] !== 3) continue
        tcpBinds++; const reply = Buffer.concat([p.subarray(0, 21), Buffer.from([tcpBinds === 1 ? 4 : 0])]); reply[3] = 4
        const frame = Buffer.alloc(reply.length + 2); frame.writeUInt16BE(reply.length); reply.copy(frame, 2)
        socket.write(frame.subarray(0, 1)); setTimeout(() => socket.write(frame.subarray(1)), 5)
      }
    })
  })
  const controller = new AbortController()
  const session = await TurnSession.bind({ sessionId: 'a'.repeat(32), host: '127.0.0.1', port, ticket: 'fixture' }, 2, controller.signal)
  assert.equal(udpBinds, 3); assert.equal(tcpBinds, 1); assert.equal(session.target.address, '127.0.0.1'); assert.notEqual(session.target.port, port)
  session.close(); controller.abort()
})
test('VoxLink links match contract; upstream regression and confidence range produce valid targets', () => {
  assert.equal(VOXLINK_LINKS.length, 8)
  const result = predict([30000, 30010, 30020, 30030, 30040])
  assert.equal(result.predictedPort, 30050)
  assert.equal(result.range, 64)
  assert(generateTargetPorts(result.predictedPort, result.range).every(p => p >= 1024 && p <= 65535))
})

test('WS is preferred for sends, reconnect re-polls identity, duplicate push is ignored and stop releases pending work', async t => {
  const created: FakeWs[] = [], frames: any[] = []
  class FakeWs extends EventEmitter {
    static OPEN = 1; readyState = 0
    constructor(_url: URL) { super(); created.push(this); queueMicrotask(() => { this.readyState = 1; this.emit('open') }) }
    send(raw: string) { const frame = JSON.parse(raw); frames.push(frame); queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ id: frame.id, success: true, data: frame.route === '/signal/poll' ? { s: [], ts: Date.now() } : {} })))) }
    ping() {this.emit('pong')}
    terminate(){this.close()}
    close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close') }
  }
  const session = new VoxlinkSession({ api: { do: async () => { throw new Error('HTTP should not be needed') } } as unknown as ApiClient, baseURL: () => 'https://fixture.example', emit: () => {}, netLog: () => {} }, { code: 'ABCDEF', token: 'test', isHost: true },url=>new FakeWs(url) as any)
  t.after(() => session.stop())
  let received = 0; session.on('engineSignal', () => received++)
  await session.request('/signal/send', { type: 'fixture', to: 'guest', data: {} })
  assert(frames.some(f => f.route === '/signal/send' && f.body.isHost === true))
  const packet = JSON.stringify({ id: 0, push: 'signals', data: { s: [{ id: 9, type: 'mods_request', from: 'guest', data: { scope: 'all' }, timestamp: Date.now() }] } })
  for (let i = 0; i < 2; i++) created[0].emit('message',Buffer.from(packet))
  assert.equal(received, 1)
  created[0].close(); await new Promise(r => setTimeout(r, 20))
  assert.equal(created.length, 2); assert(frames.filter(f => f.route === '/signal/poll').length >= 2)
  session.stop(); await assert.rejects(session.request('/signal/send', {}), /取消/)
  assert(created.every(socket => socket.readyState === 3))
})

test('ModSync IPC pins folder+instance, ignores forged downloads, preserves conflicting files and cancels late checks', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voxlink-plan-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const folder = path.join(root, '甲'), other = path.join(root, '乙'); fs.mkdirSync(folder); fs.mkdirSync(other)
  const built = await build({ entryPoints: ['src/main/core/voxlink/modsyncService.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'fixture-context', setup(b) {
    b.onLoad({ filter: /(instanceCenter|instanceMetadata|versions|paths|download)\.ts$/ }, args => {
      const name = path.basename(args.path, '.ts')
      const content: Record<string, string> = {
        instanceCenter: `export const centerTarget = target => { if(!target?.id || !target?.folder) throw Error('target'); return {target, folder:target.folder,dir:target.folder,json:{id:target.id}} }`,
        instanceMetadata: `export const resolveInstanceMetadata = () => ({loader:'fabric',mcVersion:'1.20.1',broken:false})`,
        versions: `export const readVersionJson = () => ({})`, paths: `export const withGameFolder = (_folder, fn) => fn()`,
        download: `import fs from 'node:fs';export const downloadFile = async (_url,dest,_progress,_sha1,_mirror,signal) => {signal.throwIfAborted();fs.writeFileSync(dest,'new-mod')}`
      }
      return { contents: content[name], loader: 'ts' }
    })
  } }] })
  const require = createRequire(path.resolve('package.json')), module = { exports: {} as any }
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(require, module, module.exports)
  const e = entry('fixture'), manifest = { protocolVersion: 'modSync.v1', loader: 'fabric', mcVersion: '1.20.1', mods: [e], unknownMods: [], supported: true, ready: true }
  const channels = new Map<string, Function>(), service = new module.exports.ModSyncService(() => ({ baseURL: () => 'http://unused', api: {} }))
  const original = globalThis.fetch; let release: (() => void) | undefined
  globalThis.fetch = async (_url, options) => {
    if (release !== undefined) await new Promise<void>(resolve => { release = resolve })
    options?.signal?.throwIfAborted(); return new Response(JSON.stringify({ success: true, data: manifest }))
  }
  t.after(() => { service.stop(); globalThis.fetch = original })
  service.register({ handle: (name: string, fn: Function) => channels.set(name, fn) })
  const check = (operation: string) => channels.get('voxlink:mods:check')!(null, { operation, target: { folder, id: 'same-id' }, code: 'ABCDEF', scope: 'all' })
  const plan = await check('one'); assert.equal(plan.target.folder, folder)
  await assert.rejects(channels.get('voxlink:mods:download')!(null, { operation: 'bad', plan: plan.id, selected: ['forged'] }), /没有可下载/)
  const result = await channels.get('voxlink:mods:download')!(null, { operation: 'download', plan: plan.id, selected: [e.sha1], target: { folder: other, id: 'same-id' } })
  assert.equal(result.installed, 1); assert(fs.existsSync(path.join(folder, 'mods', e.fileName))); assert(!fs.existsSync(path.join(other, 'mods')))
  fs.writeFileSync(path.join(folder, 'mods', e.fileName), 'user-changed')
  await assert.rejects(channels.get('voxlink:mods:download')!(null, { operation: 'repeat', plan: plan.id, selected: [e.sha1] }), /其他版本/)
  assert.equal(fs.readFileSync(path.join(folder, 'mods', e.fileName), 'utf8'), 'user-changed')
  release = () => {}; const pending = check('cancelled'); await new Promise(r => setTimeout(r, 10))
  channels.get('voxlink:mods:cancel')!(null, 'cancelled'); release(); await assert.rejects(pending, /abort/i)
})

test('server favorites persist through editing; launch checks only the explicitly bound folder and version', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'server-favorite-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const folder = path.join(root, 'bound'); fs.mkdirSync(folder)
  const built = await build({ entryPoints: ['src/main/core/servers.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'server-fixtures', setup(b) {
    b.onLoad({ filter: /(versions|gameFolders|settings|launcherLog)\.ts$/ }, args => {
      const contents: Record<string, string> = {
        versions: `export const listAllInstalled=()=>{throw Error('unexpected all-folder scan')}; export const scanInstalledFolder=(folder,id)=>({versions:[{id,folder,mcVersion:'1.20.1',loader:'fabric'}],errors:[]})`,
        gameFolders: `export const setActiveGameFolder=()=>{}`,
        settings: `export const getSettings=()=>({folders:[{path:${JSON.stringify(folder)}}]})`,
        launcherLog: `export const logScope=()=>({info(){},warn(){},error(){}})`
      }
      return { contents: contents[path.basename(args.path, '.ts')], loader: 'ts' }
    })
  } }] })
  const require = createRequire(path.resolve('package.json')), module = { exports: {} as any }
  new Function('require', 'module', 'exports', built.outputFiles[0].text)((id: string) => id === 'electron' ? { app: { getPath: () => root } } : require(id), module, module.exports)
  const api = module.exports, first = api.addServer('第一台', 'one.example')[0]
  api.addServer('第二台', 'two.example'); api.favoriteServer(first.id, true); api.editServer(first.id, '改名', 'one.example')
  assert.equal(api.listServers().find((s: any) => s.id === first.id).favorite, true)
  assert.equal(api.prepareServerLaunch(first.id, 'fixture', folder).versionId, 'fixture')
  assert.throws(() => api.prepareServerLaunch(first.id, 'fixture', path.join(root, 'unbound')), /解除绑定/)
  api.favoriteServer(first.id, false); assert(!api.listServers()[0].favorite)
})
