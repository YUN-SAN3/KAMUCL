import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(path.resolve('package.json'))
const compiledModule = build({
  stdin: {
    contents: fs.readFileSync('src/main/core/terracotta.ts', 'utf8') + '\nexport { startProcess as testStart, killTree as testStop, readMacPort as testReadPort };',
    resolveDir: path.resolve('src/main/core'), loader: 'ts'
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external'
}).then(result => result.outputFiles[0].text)

type HttpObservation = {
  url: string; timeout: number; response: PassThrough & { statusCode?: number }
  begin: (status: number) => void; reply: (status: number, body: string) => void
}
type FixtureOptions = { port?: Buffer; controlledHttp?: boolean; automaticExit?: boolean; log?: string }

async function fixture(profile: string, ambient: string, pid: number, options: FixtureOptions = {}) {
  const child: any = new EventEmitter()
  Object.assign(child, { pid, exitCode: null, stdout: new PassThrough(), stderr: new PassThrough() })
  const calls: { exe: string; args: string[]; options: any }[] = []
  const signals: [number, string | number][] = []
  const httpCalls: HttpObservation[] = []
  const execCalls: unknown[][] = []
  let groupAlive = false, closed = false, exiting = false, probeError: string | undefined
  const exit = () => {
    if (child.exitCode !== null) return
    child.exitCode = 0
    child.emit('exit', 0, null)
  }
  const close = () => {
    if (closed) return
    closed = true
    child.emit('close', child.exitCode, null)
  }
  const inheritedEnv = { ...process.env, HOME: ambient, TMPDIR: ambient }
  const fakeProcess = Object.create(process)
  Object.defineProperties(fakeProcess, {
    platform: { value: 'darwin' }, env: { value: inheritedEnv },
    kill: { value: (target: number, signal: string | number) => {
      assert.equal(target, -pid, 'Only the exact fixture-owned daemon process group may be queried or signaled')
      signals.push([target, signal])
      if (signal === 0) {
        if (probeError) throw Object.assign(new Error('owned group observation failed'), { code: probeError })
        if (!groupAlive) throw Object.assign(new Error('owned group is absent'), { code: 'ESRCH' })
        return true
      }
      assert.equal(signal, 'SIGTERM', 'No global daemon, launchctl or unrelated process may be controlled')
      if (options.automaticExit !== false && groupAlive && !exiting) {
        exiting = true
        groupAlive = false
        queueMicrotask(() => { exit(); close() })
      }
      return true
    } }
  })
  const module: any = { exports: {} }
  new Function('require', 'module', 'exports', 'process', await compiledModule)((name: string) => {
    if (name === 'electron') return { app: { getPath: (key: string) => { assert.equal(key, 'userData'); return profile } }, BrowserWindow: { getAllWindows: () => [] } }
    if (name === 'node:os') return { ...os, arch: () => 'arm64' }
    if (name === 'node:child_process') return {
      spawn: (exe: string, args: string[], spawnOptions: any) => {
        calls.push({ exe, args, options: spawnOptions })
        assert.deepEqual(args, ['--daemon'], 'Mac must own its daemon directly, never use --hmcl or launchctl')
        groupAlive = true
        const service = path.join(spawnOptions.env.HOME, 'terracotta')
        fs.writeFileSync(path.join(service, 'terracotta.lock'), options.port ?? portBytes(39201))
        fs.writeFileSync(path.join(service, 'application.log'), options.log ?? `private daemon ${pid}`)
        return child
      },
      execFile: (...args: unknown[]) => { execCalls.push(args); assert.fail('Mac session must never invoke the global daemon client or launchctl') }
    }
    if (name === 'node:http') return {
      get: (url: string, httpOptions: { timeout: number }, callback: (response: any) => void) => {
        const parsed = new URL(url)
        assert.equal(parsed.hostname, '127.0.0.1')
        assert.equal(parsed.pathname, '/state')
        const request: any = new EventEmitter()
        request.destroy = (error: Error) => { request.emit('error', error); return request }
        const response = new PassThrough() as HttpObservation['response']
        let begun = false
        const observation: HttpObservation = {
          url, timeout: httpOptions.timeout, response,
          begin: status => { assert.equal(begun, false); begun = true; response.statusCode = status; callback(response) },
          reply: (status, body) => { observation.begin(status); response.end(body) }
        }
        httpCalls.push(observation)
        if (!options.controlledHttp) queueMicrotask(() => observation.reply(200, '{"state":"waiting"}'))
        return request
      }
    }
    return require(name)
  }, module, module.exports, fakeProcess)
  return {
    ...module.exports, child, calls, signals, httpCalls, execCalls, inheritedEnv, exit, close,
    setGroupAlive: (alive: boolean) => { groupAlive = alive },
    setProbeError: (code?: string) => { probeError = code },
    async dispose() {
      probeError = undefined
      groupAlive = false
      exit(); close()
      await module.exports.testStop().catch(() => {})
    }
  }
}

function portBytes(port: number): Buffer {
  const bytes = Buffer.alloc(2)
  bytes.writeUInt16BE(port)
  return bytes
}

function workspace(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mac tc 中文 O'Neil "))
  const profile = path.join(root, 'shared-profile'), ambient = path.join(root, 'ambient-home')
  fs.mkdirSync(profile); fs.mkdirSync(path.join(ambient, 'terracotta'), { recursive: true })
  const services: Awaited<ReturnType<typeof fixture>>[] = []
  t.after(async () => {
    for (const service of services) await service.dispose()
    fs.rmSync(root, { recursive: true, force: true })
  })
  return {
    root, profile, ambient,
    async service(pid: number, options?: FixtureOptions, ownProfile = profile) {
      const service = await fixture(ownProfile, ambient, pid, options)
      services.push(service)
      return service
    }
  }
}

async function waitFor(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 2000
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  assert(predicate(), message)
}

function archived(profile: string, directory: string) {
  return path.join(profile, 'terracotta', 'session-history', path.basename(directory))
}

test('Mac Terracotta owns independent HOME sessions for two launchers sharing one profile, without controlling shared services', { timeout: 10000 }, async t => {
  const hostHome = process.env.HOME, hostTmp = process.env.TMPDIR
  const w = workspace(t)
  const shared = path.join(w.profile, 'terracotta', 'terracotta')
  fs.mkdirSync(shared, { recursive: true })
  const sentinelFiles = [path.join(shared, 'terracotta.lock'), path.join(shared, 'application.log'), path.join(w.ambient, 'terracotta', 'terracotta.lock')]
  for (const file of sentinelFiles) fs.writeFileSync(file, 'unrelated service must remain unchanged')
  const first = await w.service(20101, { port: portBytes(39211), log: 'first owned session log' })
  const second = await w.service(20102, { port: portBytes(39212), log: 'second owned session log' })
  assert.deepEqual(await Promise.all([first.testStart(), second.testStart()]), [39211, 39212])
  const a = first.calls[0], b = second.calls[0]
  assert.notEqual(a.options.env.HOME, b.options.env.HOME)
  for (const call of [a, b]) {
    assert.deepEqual(call.args, ['--daemon'])
    assert.equal(call.exe, path.join(w.profile, 'terracotta', 'terracotta-0.4.2-macos-arm64'))
    assert.equal(call.options.detached, true)
    assert.equal(path.dirname(call.options.env.HOME), path.join(w.profile, 'terracotta'))
    assert.equal(call.options.env.TMPDIR, w.ambient)
    assert.notEqual(call.options.env.HOME, w.ambient)
    assert(fs.lstatSync(call.options.env.HOME).isDirectory())
  }
  assert.equal(first.httpCalls[0].url, 'http://127.0.0.1:39211/state')
  assert.equal(second.httpCalls[0].url, 'http://127.0.0.1:39212/state')
  await first.testStop()
  assert(!fs.existsSync(a.options.env.HOME)); assert(fs.existsSync(b.options.env.HOME))
  assert.equal(second.child.exitCode, null)
  assert.deepEqual(second.signals, [], 'Stopping the first launcher must not query or signal the second group')
  assert.equal(fs.readFileSync(path.join(archived(w.profile, a.options.env.HOME), 'terracotta', 'application.log'), 'utf8'), 'first owned session log')
  await second.testStop()
  for (const file of sentinelFiles) assert.equal(fs.readFileSync(file, 'utf8'), 'unrelated service must remain unchanged')
  assert.deepEqual(first.execCalls, []); assert.deepEqual(second.execCalls, [])
  assert.equal(first.inheritedEnv.HOME, w.ambient); assert.equal(second.inheritedEnv.HOME, w.ambient)
  assert.equal(process.env.HOME, hostHome); assert.equal(process.env.TMPDIR, hostTmp)
})

test('Mac port reader accepts exactly two big-endian bytes and rejects invalid or non-file locks', { timeout: 10000 }, async t => {
  const w = workspace(t), service = await w.service(20201)
  const lock = path.join(w.root, 'owned.lock')
  assert.equal(service.testReadPort(lock), null)
  for (const bytes of [Buffer.alloc(0), Buffer.from([0x98])]) {
    fs.writeFileSync(lock, bytes)
    assert.equal(service.testReadPort(lock), null)
  }
  fs.writeFileSync(lock, Buffer.from([0x12, 0x34]))
  assert.equal(service.testReadPort(lock), 0x1234)
  fs.writeFileSync(lock, portBytes(65535)); assert.equal(service.testReadPort(lock), 65535)
  fs.writeFileSync(lock, portBytes(0)); assert.throws(() => service.testReadPort(lock), /端口无效/)
  fs.writeFileSync(lock, Buffer.from([0x12, 0x34, 0x56])); assert.throws(() => service.testReadPort(lock), /格式错误/)
  assert.throws(() => service.testReadPort(w.ambient), /不是普通文件/)
})

test('Mac startup waits for a partial private port and never reads another service lock', { timeout: 10000 }, async t => {
  const w = workspace(t)
  fs.mkdirSync(path.join(w.profile, 'terracotta', 'terracotta'), { recursive: true })
  fs.writeFileSync(path.join(w.profile, 'terracotta', 'terracotta', 'terracotta.lock'), portBytes(39999))
  const service = await w.service(20301, { port: Buffer.from([0x99]) })
  let resolved = false
  const starting = service.testStart().then((port: number) => { resolved = true; return port })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(resolved, false); assert.equal(service.httpCalls.length, 0)
  const ownLock = path.join(service.calls[0].options.env.HOME, 'terracotta', 'terracotta.lock')
  fs.writeFileSync(ownLock, portBytes(39221))
  assert.equal(await starting, 39221)
  assert.equal(service.httpCalls[0].url, 'http://127.0.0.1:39221/state')
  await service.testStop()
})

test('Mac startup returns only after complete successful HTTP state readiness, not a port or an invalid response', { timeout: 10000 }, async t => {
  const w = workspace(t)
  for (const [index, status, body] of [[0, 503, '{"state":"waiting"}'], [1, 200, '{'], [2, 200, '{"state":12}']] as const) {
    const service = await w.service(20401 + index, { controlledHttp: true, port: portBytes(39231 + index) })
    let resolved = false
    const starting = service.testStart().then((port: number) => { resolved = true; return port })
    await waitFor(() => service.httpCalls.length === 1, 'The private HTTP request must actually occur')
    assert.equal(resolved, false, 'A valid port alone is not readiness')
    assert.equal(service.httpCalls[0].timeout, 8000)
    service.httpCalls[0].reply(status, body)
    await waitFor(() => service.httpCalls.length === 2, 'Invalid HTTP readiness must be retried')
    assert.equal(resolved, false)
    service.httpCalls[1].begin(200)
    service.httpCalls[1].response.write('{"state":"wait')
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(resolved, false, 'Partial HTTP JSON cannot complete startup')
    service.httpCalls[1].response.end('ing"}')
    assert.equal(await starting, 39231 + index)
    await service.testStop()
  }
})

test('Mac initial machine identity persists as 16 bytes and is copied unchanged into each new private daemon HOME', { timeout: 10000 }, async t => {
  const w = workspace(t)
  const identity = path.join(w.profile, 'terracotta', 'terracotta', 'machine-id')
  const first = await w.service(20501)
  await first.testStart()
  const original = fs.readFileSync(identity)
  assert.equal(original.length, 16)
  assert.deepEqual(fs.readFileSync(path.join(first.calls[0].options.env.HOME, 'terracotta', 'machine-id')), original)
  await first.testStop()
  const second = await w.service(20502)
  await second.testStart()
  assert.deepEqual(fs.readFileSync(identity), original)
  assert.deepEqual(fs.readFileSync(path.join(second.calls[0].options.env.HOME, 'terracotta', 'machine-id')), original)
  await second.testStop()
})

test('Mac preserves an existing valid machine identity and does not modify the shared service or logs', { timeout: 10000 }, async t => {
  const w = workspace(t)
  const shared = path.join(w.profile, 'terracotta', 'terracotta')
  fs.mkdirSync(shared, { recursive: true })
  const identity = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
  fs.writeFileSync(path.join(shared, 'machine-id'), identity)
  fs.writeFileSync(path.join(shared, 'terracotta.lock'), portBytes(39998))
  fs.writeFileSync(path.join(shared, 'application.log'), 'player service log')
  const service = await w.service(20601)
  await service.testStart(); await service.testStop()
  assert.deepEqual(fs.readFileSync(path.join(shared, 'machine-id')), identity)
  assert.deepEqual(fs.readFileSync(path.join(shared, 'terracotta.lock')), portBytes(39998))
  assert.equal(fs.readFileSync(path.join(shared, 'application.log'), 'utf8'), 'player service log')
})

test('Mac corrupt machine identities fail before spawning and preserve the original bytes', { timeout: 10000 }, async t => {
  const w = workspace(t)
  for (const length of [0, 15, 17]) {
    const profile = path.join(w.root, `corrupt-profile-${length}`)
    const shared = path.join(profile, 'terracotta', 'terracotta')
    fs.mkdirSync(shared, { recursive: true })
    const corrupt = Buffer.alloc(length, 0xa5)
    fs.writeFileSync(path.join(shared, 'machine-id'), corrupt)
    fs.writeFileSync(path.join(shared, 'application.log'), 'original player log')
    const service = await w.service(20700 + length, {}, profile)
    await assert.rejects(service.testStart(), /身份文件损坏.*已保留原文件/)
    assert.equal(service.calls.length, 0); assert.deepEqual(service.signals, [])
    assert.deepEqual(fs.readFileSync(path.join(shared, 'machine-id')), corrupt)
    assert.equal(fs.readFileSync(path.join(shared, 'application.log'), 'utf8'), 'original player log')
  }
})

test('Mac refuses a non-file machine identity instead of replacing it or launching a daemon', { timeout: 10000 }, async t => {
  const w = workspace(t)
  const identity = path.join(w.profile, 'terracotta', 'terracotta', 'machine-id')
  fs.mkdirSync(identity, { recursive: true })
  fs.writeFileSync(path.join(identity, 'player-data'), 'preserve')
  const service = await w.service(20801)
  await assert.rejects(service.testStart(), /身份文件损坏.*已保留原文件/)
  assert.equal(service.calls.length, 0)
  assert.equal(fs.readFileSync(path.join(identity, 'player-data'), 'utf8'), 'preserve')
})

test('Mac invalid published ports fail rather than requesting a shared or guessed endpoint', { timeout: 10000 }, async t => {
  const w = workspace(t)
  for (const [index, bytes, message] of [[0, portBytes(0), /端口无效/], [1, Buffer.from([1, 2, 3]), /格式错误/]] as const) {
    const service = await w.service(20901 + index, { port: bytes })
    await assert.rejects(service.testStart(), message)
    assert.equal(service.httpCalls.length, 0)
    await service.testStop()
    assert.deepEqual(service.execCalls, [])
  }
})

test('Mac stop retains the active files until the owned close and the whole private group are both gone, then archives logs', { timeout: 10000 }, async t => {
  const w = workspace(t), service = await w.service(21001, { automaticExit: false, log: 'retain shutdown diagnostics' })
  await service.testStart()
  const directory = service.calls[0].options.env.HOME, history = archived(w.profile, directory)
  let done = false
  const stopping = service.testStop().then(() => { done = true })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(done, false); assert(fs.existsSync(directory)); assert(!fs.existsSync(history))
  service.exit(); service.close()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(done, false, 'Child close alone does not prove its EasyTier process group is gone')
  assert(fs.existsSync(directory)); assert(!fs.existsSync(history))
  service.setGroupAlive(false)
  await stopping
  assert(!fs.existsSync(directory)); assert(fs.existsSync(history))
  assert.equal(fs.readFileSync(path.join(history, 'terracotta', 'application.log'), 'utf8'), 'retain shutdown diagnostics')
  assert.deepEqual(fs.readFileSync(path.join(history, 'terracotta', 'machine-id')), fs.readFileSync(path.join(w.profile, 'terracotta', 'terracotta', 'machine-id')))
  assert(service.signals.some(([target, signal]) => target === -21001 && signal === 'SIGTERM'))
  assert(service.signals.some(([target, signal]) => target === -21001 && signal === 0))
})

test('Mac exit-before-stop still waits for the original close and preserves its session history', { timeout: 10000 }, async t => {
  const w = workspace(t), service = await w.service(21101, { automaticExit: false })
  await service.testStart()
  const directory = service.calls[0].options.env.HOME
  service.exit(); service.setGroupAlive(false)
  let done = false
  const stopping = service.testStop().then(() => { done = true })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(done, false, 'proc=null after exit must not be mistaken for original close')
  assert(fs.existsSync(directory)); assert(!fs.existsSync(archived(w.profile, directory)))
  service.close(); await stopping
  assert(!fs.existsSync(directory))
  assert.equal(fs.readFileSync(path.join(archived(w.profile, directory), 'terracotta', 'application.log'), 'utf8'), 'private daemon 21101')
})

test('Mac uncertain private group observation is a hard cleanup failure and leaves the original active logs intact', { timeout: 10000 }, async t => {
  const w = workspace(t), service = await w.service(21201, { automaticExit: false })
  await service.testStart()
  const directory = service.calls[0].options.env.HOME
  service.setProbeError('EPERM')
  const stopping = service.testStop()
  service.exit(); service.close()
  await assert.rejects(stopping, /owned group observation failed/)
  assert(fs.existsSync(directory)); assert(!fs.existsSync(archived(w.profile, directory)))
  assert.equal(fs.readFileSync(path.join(directory, 'terracotta', 'application.log'), 'utf8'), 'private daemon 21201')
})
