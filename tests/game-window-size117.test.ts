import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import type { GameProcessHandle } from '../src/main/core/gracefulClose'
import { rememberedWindowResolution, validWindowSize, watchGameWindowSize, type GameWindowSample } from '../src/main/core/gameWindowSize'
import { GameSession } from '../src/main/core/gameSession'

function child() { return Object.assign(new EventEmitter(), { pid: 47117, exitCode: null, signalCode: null, killed: false }) as GameProcessHandle }
const size: GameWindowSample = { pid: 47117, width: 1280, height: 720, windowed: true }
const tick = () => new Promise(resolve => setTimeout(resolve, 15))

test('owned game close saves before the actual GameSession restart continues, with identical exit ordering when disabled', async () => {
  for (const enabled of [false, true]) {
    const sessions = new GameSession(), token = sessions.reserve('restart fixture'), process = child()
    sessions.attach(token, process)
    const events: string[] = []
    const capture = watchGameWindowSize(process, { enabled: () => enabled, read: async () => size, commit: () => { events.push('saved') }, onError: assert.fail })
    await tick()
    // This is the product close order, using the real session's graceful-close waiter.
    process.on('close', code => {
      if (!sessions.release(token)) return
      const finished = capture.finish(code === 0)
      assert.equal(typeof finished, 'boolean', 'saving must finish synchronously before another close listener restarts')
      events.push('exited')
    })
    await sessions.stopGracefully(async () => {
      queueMicrotask(() => {
        process.exitCode = 0
        process.emit('exit', 0)
        process.emit('close', 0)
      })
    }, 1000, token)
    sessions.reserve('restart fixture')
    events.push('restart-launching')
    assert.deepEqual(events, enabled ? ['saved', 'exited', 'restart-launching'] : ['exited', 'restart-launching'])
    assert.equal(capture.finish(true), false, 'old close cannot save into the new session')
  }
})
test('gameplay preference edits and changed instance override scope take priority over automatic saving', () => {
  const initial = { width: 1000, height: 600, mode: 'windowed' as const, fullscreen: false }
  const override = { ...initial, width: 1200 }
  assert.deepEqual(rememberedWindowResolution(initial, undefined, initial, undefined, size), { ...initial, width: 1280, height: 720 })
  assert.equal(rememberedWindowResolution(initial, undefined, initial, override, size), undefined, 'new instance override does not mutate global settings')
  assert.equal(rememberedWindowResolution(override, override, initial, undefined, size), undefined, 'removed instance override is not recreated')
  assert.equal(rememberedWindowResolution(initial, undefined, { ...initial, width: 1600 }, undefined, size), undefined)
  assert.deepEqual(rememberedWindowResolution(override, override, { ...initial, width: 1600 }, override, size), { ...override, width: 1280, height: 720 }, 'instance save does not overwrite independently edited global settings')
})

test('remembered dimensions require the owned PID, normal window mode and valid client size', () => {
  assert(validWindowSize(size, 47117))
  for (const sample of [undefined, { ...size, pid: 99 }, { ...size, windowed: false }, { ...size, width: 1 }, { ...size, height: Number.NaN }, { ...size, width: 1280.5 }]) assert(!validWindowSize(sample, 47117))
})

test('disabled preference makes no native observations or settings writes', async () => {
  let calls = 0
  const observer = watchGameWindowSize(child(), { enabled: () => false, read: async () => { calls++; return size }, commit: () => { calls++ }, onError: assert.fail })
  assert.equal(await observer.finish(true), false); assert.equal(calls, 0)
})

test('last normal client size survives fullscreen/hidden readings and commits once on clean exit', async () => {
  const values: Array<GameWindowSample | undefined> = [size, { ...size, width: 1600, height: 900 }, { ...size, windowed: false }, undefined]
  const writes: unknown[] = []
  const observer = watchGameWindowSize(child(), { enabled: () => true, intervalMs: 1, read: async () => values.shift(), commit: value => { writes.push(value) }, onError: assert.fail })
  await tick(); assert.equal(await observer.finish(true), true)
  assert.deepEqual(writes, [{ width: 1600, height: 900 }]); assert.equal(await observer.finish(true), false)
})

test('crash, preference disabled during play and malformed foreign samples never replace settings', async () => {
  for (const scenario of ['crash', 'disabled', 'foreign']) {
    let enabled = true, writes = 0
    const observer = watchGameWindowSize(child(), { enabled: () => enabled, intervalMs: 1, read: async () => scenario === 'foreign' ? { ...size, pid: 99 } : size, commit: () => { writes++ }, onError: assert.fail })
    await tick(); if (scenario === 'disabled') enabled = false
    assert.equal(await observer.finish(scenario !== 'crash'), false); assert.equal(writes, 0)
  }
})

test('late native initialization is discarded after exit and cannot write another session', async () => {
  let resolve!: (value: GameWindowSample) => void, writes = 0
  const observer = watchGameWindowSize(child(), { enabled: () => true, read: () => new Promise(done => resolve = done), commit: () => { writes++ }, onError: assert.fail })
  const finish = observer.finish(true); resolve(size)
  assert.equal(await finish, false); assert.equal(writes, 0)
})

test('native and settings failures are reported without affecting the game or retrying settings commits', async () => {
  const errors: unknown[] = [], running = child()
  const observer = watchGameWindowSize(running, { enabled: () => true, intervalMs: 1, read: async () => size, commit: () => { throw Error('disk full fixture') }, onError: error => errors.push(error) })
  await tick(); assert.equal(await observer.finish(true), false); assert.equal(errors.length, 1); assert.match(String(errors[0]), /disk full/); assert.equal(running.killed, false)
  let calls = 0
  const broken = watchGameWindowSize(child(), { enabled: () => true, intervalMs: 1, read: async () => { calls++; throw Error('native unavailable fixture') }, commit: assert.fail, onError: error => errors.push(error) })
  await tick(); await broken.finish(true); const before = calls; await tick(); assert.equal(calls, before); assert.equal(errors.length, 2)
})
