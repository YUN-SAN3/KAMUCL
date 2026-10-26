import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(path.resolve('package.json'))
async function fixture(profile: string, ambient: string, pid: number, delay = 0) {
  const source = fs.readFileSync('src/main/core/terracotta.ts', 'utf8') + '\nexport { startProcess as testStart, killTree as testStop };'
  const compiled = await build({ stdin: { contents: source, resolveDir: path.resolve('src/main/core'), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' })
  const child: any = new EventEmitter()
  Object.assign(child, { pid, exitCode: null, stdout: new PassThrough(), stderr: new PassThrough() })
  const calls: any[] = [], signals: any[] = []
  let alive = true
  const fakeProcess = Object.create(process)
  Object.defineProperties(fakeProcess, { platform: { value: 'linux' }, env: { value: { ...process.env, TMPDIR: ambient } }, kill: { value: (target: number, signal: string | number) => {
    assert.equal(target, -pid, 'The product may address only this fixture-owned group')
    signals.push([target, signal])
    if (signal === 0 && !alive) throw Object.assign(new Error('private group stopped'), { code: 'ESRCH' })
    if (signal === 'SIGTERM' && alive) {
      alive = false
      setTimeout(() => { child.exitCode = 0; child.emit('exit', 0); child.emit('close', 0) }, delay)
    }
    return true
  } } })
  const module: any = { exports: {} }
  new Function('require', 'module', 'exports', 'process', compiled.outputFiles[0].text)((name: string) => {
    if (name === 'electron') return { app: { getPath: () => profile }, BrowserWindow: { getAllWindows: () => [] } }
    if (name === 'node:os') return { ...os, arch: () => 'x64' }
    if (name === 'node:child_process') return { spawn: (exe: string, args: string[], options: any) => {
      calls.push({ exe, args, options }); fs.writeFileSync(args[1], JSON.stringify({ port: 12345 })); return child
    }, execFile: () => assert.fail('Linux must not launch the Mac daemon client') }
    return require(name)
  }, module, module.exports, fakeProcess)
  return { ...module.exports, calls, signals, child }
}

test('Linux Terracotta uses unique private services even when two launchers share a profile and ambient TMPDIR', { timeout: 10000 }, async t => {
  const originalTmpDir = process.env.TMPDIR
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tc-isolation 中文 O'Neil "))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const ambient = path.join(root, 'ambient'), profile = path.join(root, 'profile')
  fs.mkdirSync(path.join(ambient, 'terracotta'), { recursive: true }); fs.mkdirSync(profile)
  const sentinel = path.join(ambient, 'terracotta', 'terracotta.lock')
  fs.writeFileSync(sentinel, 'unrelated fixture service')
  const first = await fixture(profile, ambient, 10101), second = await fixture(profile, ambient, 10102)
  assert.deepEqual(await Promise.all([first.testStart(), second.testStart()]), [12345, 12345])
  const [a, b] = [first.calls[0], second.calls[0]]
  assert.equal(a.args[0], '--hmcl'); assert.equal(b.args[0], '--hmcl')
  assert.notEqual(a.options.env.TMPDIR, b.options.env.TMPDIR)
  for (const call of [a, b]) {
    assert.equal(call.options.detached, true)
    assert.equal(path.dirname(call.args[1]), call.options.env.TMPDIR)
    assert.equal(path.dirname(call.options.env.TMPDIR), path.join(profile, 'terracotta'))
    assert(fs.lstatSync(call.options.env.TMPDIR).isDirectory())
    if (process.platform === 'linux') assert.equal(fs.statSync(call.options.env.TMPDIR).mode & 0o777, 0o700)
    assert.notEqual(call.options.env.TMPDIR, ambient)
  }
  await first.testStop()
  assert(!fs.existsSync(a.options.env.TMPDIR)); assert(fs.existsSync(b.options.env.TMPDIR))
  assert.equal(second.child.exitCode, null, 'Stopping one profile session must not stop the other')
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unrelated fixture service')
  await second.testStop()
  assert(!fs.existsSync(b.options.env.TMPDIR))
  assert(first.signals.some((s: any[]) => s[1] === 'SIGTERM')); assert(second.signals.some((s: any[]) => s[1] === 'SIGTERM'))
  assert.equal(process.env.TMPDIR, originalTmpDir, 'Host environment is never mutated')
})

test('Linux Terracotta waits for the owned close event before cleaning private files', { timeout: 10000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-close-order-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const service = await fixture(root, os.tmpdir(), 10201, 150)
  await service.testStart()
  const directory = service.calls[0].options.env.TMPDIR
  const stopped = service.testStop()
  await new Promise(resolve => setTimeout(resolve, 40))
  assert(fs.existsSync(directory), 'Do not delete active service files after requesting a signal')
  assert.equal(service.child.exitCode, null)
  await stopped
  assert.equal(service.child.exitCode, 0); assert(!fs.existsSync(directory))
})

test('Linux Terracotta refuses a non-directory tool path before launching anything', { timeout: 10000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-path-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(root, 'terracotta'), 'keep this user file')
  const service = await fixture(root, os.tmpdir(), 10301)
  await assert.rejects(service.testStart(), /EEXIST|不是独立目录/)
  assert.equal(service.calls.length, 0); assert.equal(fs.readFileSync(path.join(root, 'terracotta'), 'utf8'), 'keep this user file')
})

test('Linux Terracotta stop also awaits close when the service already emitted exit', { timeout: 10000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-exit-before-stop-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const service = await fixture(root, os.tmpdir(), 10401, 150)
  await service.testStart(); const directory = service.calls[0].options.env.TMPDIR
  service.child.exitCode = 0; service.child.emit('exit', 0)
  let done = false; const stopped = service.testStop().then(() => { done = true })
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(done, false, 'Stop must await the original close, not just proc=null')
  assert(fs.existsSync(directory)); await stopped
  assert(!fs.existsSync(directory))
})
