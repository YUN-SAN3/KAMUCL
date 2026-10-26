import test from 'node:test'
import assert from 'node:assert/strict'
import { restoreLostControlFocus } from '../src/renderer/src/controlFocus'

function fixture() {
  const body = {}, documentElement = {}, doc = { body, documentElement, activeElement: body as object }
  let disabled = false, connected = true, visible = true, inScope = true, calls = 0
  const control = { ownerDocument: doc, get isConnected() { return connected }, closest: () => inScope ? {} : null,
    matches: () => disabled, getClientRects: () => visible ? [1] : [],
    focus: (options: object) => { assert.deepEqual(options, { preventScroll: true }); calls++; doc.activeElement = control } }
  return { control: control as unknown as HTMLElement, doc, calls: () => calls, disabled: () => { disabled = true }, detached: () => { connected = false }, hidden: () => { visible = false }, outOfScope: () => { inScope = false } }
}

test('failed async saves restore only body/document focus to a now-enabled connected control without scrolling', () => {
  const f = fixture(); restoreLostControlFocus(f.control, '.design-workspace'); assert.equal(f.calls(), 1)
  f.doc.activeElement = f.doc.documentElement; restoreLostControlFocus(f.control, '.update-sources'); assert.equal(f.calls(), 2)
})

test('failure recovery respects a user-selected control and cannot revive disabled, hidden or removed controls', () => {
  const focused = fixture(); focused.doc.activeElement = {}; restoreLostControlFocus(focused.control, '.design-workspace'); assert.equal(focused.calls(), 0)
  for (const mutate of ['disabled', 'detached', 'hidden', 'outOfScope'] as const) { const f = fixture(); f[mutate](); restoreLostControlFocus(f.control, '.design-workspace'); assert.equal(f.calls(), 0) }
  restoreLostControlFocus(null, '.design-workspace')
})
