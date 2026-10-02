import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SkinGestureOwner, mergeSkinCloseIntent } from '../src/renderer/src/skinEditorInteraction'

const pointer = (button = 0, altKey = false, pointerId = 1, pointerType = 'mouse') => ({ button, altKey, pointerId, pointerType })
test('skin gestures draw with left button and rotate with middle or Alt-left without changing the active stroke', () => {
  for (const [button, alt, operation, mask] of [[0, false, 'draw', 1], [1, false, 'rotate', 4], [0, true, 'rotate', 1]] as const) {
    const owner = new SkinGestureOwner(), original = owner.begin(pointer(button, alt), true, 'draw')
    assert.equal(original?.operation, operation); assert.equal(original?.buttonMask, mask)
    assert.equal(owner.begin(pointer(1, !alt), true, 'rotate'), undefined)
    assert.equal(owner.active, original, 'a mode/button change cannot replace the initiating gesture')
    assert.equal(owner.finish(1), original); assert.equal(owner.finish(1), undefined)
  }
})
test('skin capture belongs to one pointer and foreign cancellation cannot end or overwrite its undo boundary', () => {
  const owner = new SkinGestureOwner(), original = owner.begin(pointer(0, false, 7), true)
  assert.equal(owner.begin(pointer(0, false, 8, 'touch'), true), undefined)
  assert.equal(owner.owns(8), false); assert.equal(owner.finish(8), undefined); assert.equal(owner.active, original)
  assert.equal(owner.finish(), original); assert.equal(owner.active, undefined)
  assert.equal(owner.begin(pointer(0, false, 8, 'touch'), true)?.operation, 'draw')
})
test('right button and pen auxiliary buttons cannot start drawing, while ordinary preview drag still rotates', () => {
  const owner = new SkinGestureOwner()
  assert.equal(owner.begin(pointer(2), true), undefined)
  assert.equal(owner.begin(pointer(1, false, 3, 'pen'), true), undefined)
  assert.equal(owner.begin(pointer(), false)?.operation, 'rotate')
})
test('queued close requests keep native quit priority and allow a fresh local close after cancellation', () => {
  const navigate = { kind: 'navigate', destination: 'home' } as const
  const windowClose = { kind: 'window' } as const, quit = { kind: 'quit' } as const
  assert.deepEqual(mergeSkinCloseIntent(undefined, navigate), navigate)
  assert.deepEqual(mergeSkinCloseIntent(navigate, windowClose), windowClose)
  assert.deepEqual(mergeSkinCloseIntent(windowClose, { kind: 'editor' }), windowClose)
  assert.deepEqual(mergeSkinCloseIntent(windowClose, quit), quit)
  assert.deepEqual(mergeSkinCloseIntent(quit, navigate), quit)
  assert.deepEqual(mergeSkinCloseIntent(undefined, { kind: 'editor' }), { kind: 'editor' })
  assert.deepEqual(mergeSkinCloseIntent(navigate, { kind: 'navigate', destination: 'settings' }), { kind: 'navigate', destination: 'settings' })
})
