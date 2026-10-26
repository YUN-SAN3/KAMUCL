import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { resynchronizeWindowsRestore } from '../src/main/windowRestoreVisibility'

class Contents extends EventEmitter {
  destroyed = false
  throttling = true
  calls: boolean[] = []
  failRead = false
  failDisable = false
  failRestore = false
  duringDisable?: () => void
  isDestroyed() { return this.destroyed }
  getBackgroundThrottling() {
    if (this.failRead) throw new Error('read failed')
    return this.throttling
  }
  setBackgroundThrottling(value: boolean) {
    this.calls.push(value)
    if (value && this.failRestore) throw new Error('restore failed')
    this.throttling = value
    if (!value) {
      this.duringDisable?.()
      if (this.failDisable) throw new Error('disable failed after setting')
    }
  }
}
class Window extends EventEmitter {
  webContents = new Contents()
  destroyed = false
  visible = true
  minimized = false
  focused = true
  isDestroyed() { return this.destroyed }
  isVisible() { return this.visible }
  isMinimized() { return this.minimized }
  isFocused() { return this.focused }
}
function fixture(platform = 'win32') {
  const window = new Window(), errors: string[] = []
  const controller = resynchronizeWindowsRestore(window, platform, phase => { errors.push(phase) })
  return { window, contents: window.webContents, errors, controller }
}

test('Windows restore performs one synchronous resync only for the visible focused owned window', () => {
  const f = fixture()
  f.window.emit('show'); f.window.emit('focus')
  assert.deepEqual(f.contents.calls, [], 'ordinary focus/show do not create a restore intent')
  f.window.emit('restore')
  assert.deepEqual(f.contents.calls, [false, true])
  assert.equal(f.contents.throttling, true)
  f.window.emit('focus'); f.window.emit('focus')
  assert.deepEqual(f.contents.calls, [false, true], 'accepted restore is consumed exactly once')
  assert.deepEqual(f.errors, [])
})

test('restore before native focus waits for actual visible, not minimized and focused state', () => {
  const f = fixture()
  f.window.focused = false
  f.window.emit('restore')
  assert.deepEqual(f.contents.calls, [])
  f.window.visible = false; f.window.focused = true; f.window.emit('focus')
  assert.deepEqual(f.contents.calls, [], 'a focus event cannot override native hidden state')
  f.window.visible = true; f.window.minimized = true; f.window.emit('focus')
  assert.deepEqual(f.contents.calls, [], 'minimized windows must stay throttled')
  f.window.minimized = false; f.window.emit('focus')
  assert.deepEqual(f.contents.calls, [false, true])
  f.window.emit('focus')
  assert.equal(f.contents.calls.length, 2)
})

test('rapid hide or minimize cancels pending restore until another actual restore', () => {
  for (const event of ['hide', 'minimize']) {
    const f = fixture()
    f.window.focused = false; f.window.emit('restore')
    f.window.emit(event)
    f.window.focused = true; f.window.emit('focus')
    assert.deepEqual(f.contents.calls, [], event)
    f.window.emit('restore')
    assert.deepEqual(f.contents.calls, [false, true], event)
    f.controller.dispose()
  }
})

test('startup false is never changed and a later startup policy restoration is not a new intent', () => {
  const f = fixture()
  f.contents.throttling = false
  f.window.emit('restore'); f.window.emit('focus')
  assert.deepEqual(f.contents.calls, [])
  assert.equal(f.contents.throttling, false)
  f.contents.throttling = true; f.window.emit('focus')
  assert.deepEqual(f.contents.calls, [], 'startup changing its policy cannot revive an old restore')
  f.window.emit('restore')
  assert.deepEqual(f.contents.calls, [false, true])
})

test('disable error always attempts original true restoration and consumes the failed intent', () => {
  const f = fixture()
  f.contents.failDisable = true
  assert.doesNotThrow(() => f.window.emit('restore'))
  assert.deepEqual(f.contents.calls, [false, true])
  assert.equal(f.contents.throttling, true)
  assert.deepEqual(f.errors, ['pulse'])
  f.window.emit('focus')
  assert.equal(f.contents.calls.length, 2)
})

test('restore error and throwing logger never escape lifecycle events', () => {
  const window = new Window(), phases: string[] = []
  window.webContents.failDisable = true
  window.webContents.failRestore = true
  resynchronizeWindowsRestore(window, 'win32', phase => { phases.push(phase); throw new Error('log failed') })
  assert.doesNotThrow(() => window.emit('restore'))
  assert.deepEqual(window.webContents.calls, [false, true])
  assert.deepEqual(phases, ['pulse', 'restore-throttling'])
  window.emit('focus')
  assert.equal(window.webContents.calls.length, 2, 'no uncontrolled retry after restoration failure')
})

test('unreadable policy and native state failures never toggle settings or throw', () => {
  const f = fixture()
  f.contents.failRead = true
  assert.doesNotThrow(() => f.window.emit('restore'))
  assert.deepEqual(f.contents.calls, [])
  assert.deepEqual(f.errors, ['read-throttling'])
  f.contents.failRead = false; f.window.emit('focus')
  assert.deepEqual(f.contents.calls, [])
  f.window.isVisible = () => { throw new Error('window unavailable') }
  assert.doesNotThrow(() => f.window.emit('restore'))
  assert.deepEqual(f.errors, ['read-throttling', 'native-state'])
})

test('closed, destroyed contents and explicit disposal detach listeners and cancel pending work', () => {
  for (const end of ['closed', 'destroyed', 'dispose', 'native-destroyed']) {
    const f = fixture()
    f.window.focused = false; f.window.emit('restore')
    if (end === 'closed') { f.window.destroyed = true; f.window.emit('closed') }
    if (end === 'destroyed') { f.contents.destroyed = true; f.contents.emit('destroyed') }
    if (end === 'dispose') { f.controller.dispose(); f.controller.dispose() }
    if (end === 'native-destroyed') f.window.destroyed = true
    f.window.focused = true; f.window.emit('focus'); f.window.emit('restore')
    assert.deepEqual(f.contents.calls, [], end)
    for (const event of ['restore', 'focus', 'hide', 'minimize', 'closed']) {
      assert.equal(f.window.listenerCount(event), 0, `${end}: ${event} detached`)
    }
    assert.equal(f.contents.listenerCount('destroyed'), 0, end)
  }
})

test('a close during the pulse still attempts restoration and leaves no event listeners', () => {
  const f = fixture()
  f.contents.duringDisable = () => { f.window.destroyed = true; f.window.emit('closed') }
  assert.doesNotThrow(() => f.window.emit('restore'))
  assert.deepEqual(f.contents.calls, [false, true])
  assert.equal(f.contents.throttling, true)
  assert.equal(f.window.eventNames().length, 0)
  assert.equal(f.contents.eventNames().length, 0)
})

test('Mac and Linux are unchanged, including listener ownership and startup policy', () => {
  for (const platform of ['darwin', 'linux']) {
    const f = fixture(platform)
    f.contents.throttling = false
    for (const event of ['restore', 'focus', 'hide', 'show', 'minimize', 'closed']) f.window.emit(event)
    f.controller.dispose()
    assert.deepEqual(f.contents.calls, [], platform)
    assert.equal(f.contents.throttling, false, platform)
    assert.deepEqual(f.window.eventNames(), [], platform)
    assert.deepEqual(f.contents.eventNames(), [], platform)
  }
})

test('20 native restore cycles each resync once, keep background policy true and leave no pending state', () => {
  const f = fixture()
  for (let cycle = 0; cycle < 20; cycle++) {
    f.window.minimized = true; f.window.focused = false; f.window.emit('minimize')
    f.window.minimized = false; f.window.emit('restore')
    assert.equal(f.contents.calls.length, cycle * 2)
    f.window.focused = true; f.window.emit('focus'); f.window.emit('focus')
    assert.equal(f.contents.calls.length, (cycle + 1) * 2)
    assert.equal(f.contents.throttling, true)
    assert.equal(f.window.listenerCount('restore'), 1)
    assert.equal(f.window.listenerCount('focus'), 1)
  }
  f.controller.dispose(); f.window.emit('restore'); f.window.emit('focus')
  assert.equal(f.contents.calls.length, 40)
  assert.deepEqual(f.window.eventNames(), [])
  assert.deepEqual(f.contents.eventNames(), [])
  assert.deepEqual(f.errors, [])
})
