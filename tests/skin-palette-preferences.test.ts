import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSkinPalettePreferences } from '../src/shared/skinPalettePreferences'

test('palette preferences reject malformed IPC colors and bound stored lists', () => {
  const normalized = normalizeSkinPalettePreferences({ color: '#bad', alpha: NaN, custom: ['#FF0088', '#ff0088', 'javascript:alert(1)', null], recent: Array.from({ length: 40 }, (_, n) => '#'+n.toString(16).padStart(6,'0')) })
  assert.equal(normalized.color, '#d88c58')
  assert.equal(normalized.alpha, 1)
  assert.deepEqual(normalized.custom, ['#ff0088'])
  assert.equal(normalized.recent.length, 24)
})

test('palette preferences retain arbitrary RGB values and fractional outer opacity', () => {
  assert.deepEqual(normalizeSkinPalettePreferences({ color: '#123ABC', alpha: .37, custom: ['#010203'], recent: ['#abcdef'] }), { color: '#123abc', alpha: .37, custom: ['#010203'], recent: ['#abcdef'] })
  assert.equal(normalizeSkinPalettePreferences({ alpha: -1 }).alpha, 0)
  assert.equal(normalizeSkinPalettePreferences({ alpha: 2 }).alpha, 1)
})
