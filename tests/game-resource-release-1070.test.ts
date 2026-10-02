import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import AdmZip from 'adm-zip'
import { GameSession } from '../src/main/core/gameSession'
import type { GameProcessHandle } from '../src/main/core/gracefulClose'

test('OS exit releases resource guards before log close; save/kill requests do not', () => {
  const session = new GameSession(), a = session.reserve('same'), b = session.reserve('same')
  const child = () => Object.assign(new EventEmitter(), { pid: 42, exitCode: null, signalCode: null, killed: false, stdout: null, stderr: null, kill: () => true }) as GameProcessHandle
  const first = child(), second = child()
  session.attach(a, first); session.attach(b, second)
  first.killed = true; first.signalCode = 'SIGTERM'
  assert(session.isRunning('same'))
  first.emit('exit', 0); assert(session.runningIds().has('same'))
  second.emit('exit', 0)
  assert.equal(session.runningIds().size, 0); assert.equal(session.isRunning('same'), false); assert.deepEqual(session.runningPids(), [])
  assert.equal(session.count, 2, 'retain sessions for final log classification')
  assert(session.release(a)); assert(session.release(b)); assert.equal(first.listenerCount('exit'), 0)
  const reserved = session.reserve('preparing'); assert(session.isRunning('preparing')); session.release(reserved)
})

async function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL bridge upgrade 中文 ')), dir = path.join(root, 'mods')
  fs.mkdirSync(dir)
  const old = fs.readFileSync('tests/fixtures/kamucl-bridge-1.0.0.jar'), file = path.join(dir, '自定义名称.jar'), bundled = path.join(root, 'bundled.jar')
  fs.writeFileSync(file, old)
  const zip = new AdmZip(); zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'kamucl-bridge', version: '1.0.1' }))); zip.writeZip(bundled)
  const state: any = { running: false, locked: false, backups: [], protect: async (_dir: string, names: string[]) => { state.backups.push(names.map(name => fs.readFileSync(path.join(dir, name)))) } }
  const mocks: Record<string, string> = {
    changeProtection: 'export const protectModChange=(...a)=>h.protect(...a)',
    modState: 'export const isModLocked=()=>h.locked',
    gameDirectoryUse: 'export const externalGameUsesDirectory=async()=>h.running'
  }
  const result = await build({ entryPoints: ['src/main/core/bridgeUpgrade.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['adm-zip'], plugins: [{ name: 'bridge-fixture', setup(b) {
    b.onResolve({ filter: /^\.\// }, a => { const key = a.path.slice(2); if (mocks[key]) return { path: key, namespace: 'fixture' } })
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: mocks[a.path] }))
  } }] })
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', 'h', result.outputFiles[0].text)(createRequire(path.resolve('package.json')), module, module.exports, state)
  return { ...module.exports, state, root, dir, old, file, bundled, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

test('stock bridge update is protected, atomic, filename preserving and idempotent', async () => {
  const h = await harness()
  try {
    assert.equal((await h.upgradeInstalledBridge(h.root, h.bundled)).length, 1)
    assert(h.state.backups[0][0].equals(h.old)); assert(fs.readFileSync(h.file).equals(fs.readFileSync(h.bundled)))
    assert.deepEqual(await h.upgradeInstalledBridge(h.root, h.bundled), []); assert.equal(h.state.backups.length, 1)
  } finally { h.cleanup() }
})
test('bridge upgrade respects running games, version locks, disabled and modified files', async () => {
  const h = await harness()
  try {
    h.state.running = true; assert.match((await h.upgradeInstalledBridge(h.root, h.bundled))[0], /仍在运行/)
    h.state.running = false; h.state.locked = true; assert.match((await h.upgradeInstalledBridge(h.root, h.bundled))[0], /已锁定/)
    h.state.locked = false; fs.renameSync(h.file, h.file + '.disabled'); assert.deepEqual(await h.upgradeInstalledBridge(h.root, h.bundled), [])
    const changed = new AdmZip(h.old); changed.addFile('custom.txt', Buffer.from('user modification')); changed.writeZip(h.file)
    const snapshot = fs.readFileSync(h.file); assert.deepEqual(await h.upgradeInstalledBridge(h.root, h.bundled), [])
    assert(fs.readFileSync(h.file).equals(snapshot)); assert.equal(h.state.backups.length, 0)
  } finally { h.cleanup() }
})
test('failed protection or changed source prevents bridge replacement', async () => {
  const h = await harness()
  try {
    h.state.protect = async () => { throw Error('disk full') }
    await assert.rejects(h.upgradeInstalledBridge(h.root, h.bundled), /disk full/); assert(fs.readFileSync(h.file).equals(h.old))
    h.state.protect = async () => { fs.writeFileSync(h.file, 'external change') }
    await assert.rejects(h.upgradeInstalledBridge(h.root, h.bundled), /已变化/); assert.equal(fs.readFileSync(h.file, 'utf8'), 'external change')
    assert.deepEqual(fs.readdirSync(h.dir), ['自定义名称.jar'])
  } finally { h.cleanup() }
})
