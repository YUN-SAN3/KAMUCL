import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hsvToRgb, parseSkinChannels, parseSkinHex, rememberSkinColor, rgbToHsv, rgbToSkinHex, skinBrushRgba } from '../src/shared/skinColors'
import { normalizeSkinPalettePreferences } from '../src/shared/skinPalettePreferences'
import { makeBaseOpaque, paintSkinPixel } from '../src/shared/skinPixels'

test('skin colour fields accept only complete colour values and reject partial or out-of-range drafts', () => {
  assert.deepEqual(parseSkinHex(' #12AbF0 '), { r: 18, g: 171, b: 240 })
  for (const input of ['#12', '#12345', '#1234567', '#GG4455', 'transparent', '']) assert.equal(parseSkinHex(input), undefined)
  assert.deepEqual(parseSkinChannels(['0', '255', '17'], [255, 255, 255], true), [0, 255, 17])
  for (const values of [['', '10', '10'], ['256', '0', '0'], ['-1', '0', '0'], ['2e2', '0', '0'], ['17.5', '0', '0']]) assert.equal(parseSkinChannels(values, [255, 255, 255], true), undefined)
  assert.deepEqual(parseSkinChannels(['359.5', '63.2', '0'], [360, 100, 100]), [359.5, 63.2, 0])
  assert.equal(parseSkinChannels(['360', '100.01', '1'], [360, 100, 100]), undefined)
})

test('skin HSV conversion covers the colour wheel and preserves RGB without changing exported pixels', () => {
  assert.deepEqual(hsvToRgb({ h: 0, s: 100, v: 100 }), { r: 255, g: 0, b: 0 })
  assert.deepEqual(hsvToRgb({ h: 120, s: 100, v: 100 }), { r: 0, g: 255, b: 0 })
  assert.deepEqual(hsvToRgb({ h: 240, s: 100, v: 100 }), { r: 0, g: 0, b: 255 })
  assert.deepEqual(hsvToRgb({ h: 360, s: 100, v: 100 }), { r: 255, g: 0, b: 0 })
  assert.deepEqual(rgbToHsv({ r: 0, g: 0, b: 0 }), { h: 0, s: 0, v: 0 })
  for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
    const rgb = { r, g, b }
    assert.deepEqual(hsvToRgb(rgbToHsv(rgb)), rgb)
    assert.deepEqual(parseSkinHex(rgbToSkinHex(rgb)), rgb)
  }
})

test('outer opacity reaches painted pixels while the same selected opacity cannot create a base-layer hole', () => {
  const data = new Uint8ClampedArray(64 * 64 * 4); makeBaseOpaque(data)
  const selected = '#1177ee', transparent = skinBrushRgba(selected, 0, true)!
  const half = skinBrushRgba(selected, .5, true)!, base = skinBrushRgba(selected, .5, false)!
  assert.deepEqual(transparent, [17, 119, 238, 0]); assert.deepEqual(half, [17, 119, 238, 128]); assert.deepEqual(base, [17, 119, 238, 255])
  paintSkinPixel(data, 40, 8, half, { x: 40, y: 8, width: 8, height: 8 }, true)
  assert.deepEqual(Array.from(data.slice((8 * 64 + 40) * 4, (8 * 64 + 40) * 4 + 4)), half)
  assert.equal(data[(8 * 64 + 39) * 4 + 3], 0, 'fill does not cross outer face')
  paintSkinPixel(data, 8, 8, half, { x: 8, y: 8, width: 8, height: 8 })
  assert.deepEqual(Array.from(data.slice((8 * 64 + 8) * 4, (8 * 64 + 8) * 4 + 4)), base)
  assert.equal(skinBrushRgba('#notyet', 1, true), undefined)
  assert.equal(skinBrushRgba(selected, Number.NaN, true), undefined)
})

test('palette preferences survive JSON roundtrip, bound recent history and deduplicate custom colours', () => {
  const recent = Array.from({ length: 25 }, (_, i) => rgbToSkinHex({ r: i, g: 100, b: 200 }))
  const next = rememberSkinColor(recent, '#0164C8')
  assert.equal(next.length, 24); assert.equal(next[0], '#0164c8'); assert.equal(next.filter(c => c === '#0164c8').length, 1)
  const saved = normalizeSkinPalettePreferences(JSON.parse(JSON.stringify({ custom: ['#ABCDEF', '#abcdef', '#112233', '#123'], recent: next, color: '#1177EE', alpha: .37 })))
  assert.deepEqual(saved.custom, ['#abcdef', '#112233']); assert.equal(saved.color, '#1177ee'); assert.equal(saved.alpha, .37); assert.deepEqual(saved.recent, next)
  assert.deepEqual(normalizeSkinPalettePreferences(undefined), { custom: [], recent: [], color: '#d88c58', alpha: 1 })
})
