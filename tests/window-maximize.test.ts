import test from 'node:test'
import assert from 'node:assert/strict'
import { applyMaximized, isEffectivelyMaximized, toggleMaximize, restoreWindowBounds } from '../src/main/windowState'
import type { BrowserWindow } from 'electron'

function fixture() {
  let maximized = false, destroyed = false
  const calls: string[] = []
  const window = {
    isDestroyed: () => destroyed,
    isMaximized: () => maximized,
    maximize: () => { calls.push('maximize'); maximized = true },
    unmaximize: () => { calls.push('unmaximize'); maximized = false }
  } as unknown as BrowserWindow
  return { window, calls, systemMaximize: (value: boolean) => { maximized = value }, destroy: () => { destroyed = true } }
}

test('caption/snap changes and button changes share the OS maximize state', () => {
  const f = fixture()
  f.systemMaximize(true) // titlebar double-click / Win+Up
  assert.equal(isEffectivelyMaximized(f.window), true)
  toggleMaximize(f.window)
  assert.deepEqual(f.calls, ['unmaximize'])
  f.systemMaximize(false) // dragging out of maximized state
  toggleMaximize(f.window)
  assert.deepEqual(f.calls, ['unmaximize', 'maximize'])
})

test('reopening a window restores native maximization without leaking state across windows', () => {
  const first = fixture(), second = fixture()
  applyMaximized(first.window); applyMaximized(first.window)
  assert.deepEqual(first.calls, ['maximize'])
  assert.equal(isEffectivelyMaximized(second.window), false)
  toggleMaximize(second.window)
  assert.deepEqual(second.calls, ['maximize'])
  first.destroy(); toggleMaximize(first.window); applyMaximized(first.window)
  assert.equal(isEffectivelyMaximized(first.window), false)
  assert.deepEqual(first.calls, ['maximize'])
})

test('restoring saved bounds corrects fractional DPI rounding without a resize loop', () => {
  const target = { x: -3000, y: 20, width: 1100, height: 700 }
  let bounds = { ...target }, calls = 0
  const win = { isDestroyed: () => false, isMaximized: () => false,
    getBounds: () => bounds, getMinimumSize: () => [960, 620],
    setBounds: (b: typeof bounds) => { calls++; bounds = { ...b, width: b.width + 2, height: b.height + 1 } }
  } as unknown as BrowserWindow
  restoreWindowBounds(win, target)
  assert.deepEqual(bounds, target); assert.equal(calls, 2)
  restoreWindowBounds(win, bounds)
  assert.deepEqual(bounds, target); assert.equal(calls, 4)
})

test('saved bounds restoration respects OS relocation and minimum size', () => {
  let calls = 0, bounds = { x: 0, y: 0, width: 1000, height: 700 }
  const win = { isDestroyed: () => false, isMaximized: () => false,
    getBounds: () => bounds, getMinimumSize: () => [960, 620],
    setBounds: (b: typeof bounds) => { calls++; assert(b.width >= 960 && b.height >= 620); bounds = { ...b, x: 100 } }
  } as unknown as BrowserWindow
  restoreWindowBounds(win, { x: 0, y: 0, width: 800, height: 500 })
  assert.equal(calls, 1, 'do not fight system relocation')
  win.isMaximized = () => true
  restoreWindowBounds(win, bounds); assert.equal(calls, 1)
})
