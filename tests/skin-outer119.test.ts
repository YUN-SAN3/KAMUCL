import test from 'node:test'
import assert from 'node:assert/strict'
import { sampleSkinBrush, skinBrushIsInvisible, skinBrushRgba } from '../src/shared/skinColors'
import { makeBaseOpaque, paintSkinPixel } from '../src/shared/skinPixels'

test('empty outer-shell sampling preserves an existing visible brush, including hidden RGB values', () => {
  for (const pixel of [[0, 0, 0, 0], [255, 70, 0, 0]]) {
    const brush = { color: '#ff5722', alpha: 1 }
    Object.assign(brush, sampleSkinBrush(pixel, true))
    assert.deepEqual(brush, { color: '#ff5722', alpha: 1 })
    const data = new Uint8ClampedArray(64 * 64 * 4); makeBaseOpaque(data)
    paintSkinPixel(data, 43, 12, skinBrushRgba(brush.color, brush.alpha, true)!, { x: 40, y: 8, width: 8, height: 8 })
    assert.deepEqual([...data.slice((12 * 64 + 43) * 4, (12 * 64 + 43) * 4 + 4)], [255, 87, 34, 255])
  }
})

test('existing translucent and opaque outer colours retain exact sampled PNG alpha', () => {
  for (const alpha of [1, 128, 254, 255]) {
    const sample = sampleSkinBrush(new Uint8ClampedArray([41, 182, 246, alpha]), true)!
    assert.equal(sample.color, '#29b6f6')
    assert.deepEqual(skinBrushRgba(sample.color, sample.alpha, true), [41, 182, 246, alpha])
  }
  assert.deepEqual(sampleSkinBrush([41, 182, 246, 0], false), { color: '#29b6f6', alpha: 1 })
})

test('invisible brush affordance follows byte quantization, never changes explicit preferences or the base layer', () => {
  for (const alpha of [0, .001, 1 / 512]) assert(skinBrushIsInvisible(alpha, true))
  for (const alpha of [1 / 510, .01, .5, 1]) assert.equal(skinBrushIsInvisible(alpha, true), false)
  for (const alpha of [0, .5, 1, NaN, Infinity]) assert.equal(skinBrushIsInvisible(alpha, false), false)
  assert.equal(skinBrushIsInvisible(NaN, true), false)
  assert.equal(skinBrushIsInvisible(Infinity, true), false)
  assert.deepEqual(skinBrushRgba('#ff5722', 0, false), [255, 87, 34, 255])
  assert.deepEqual(skinBrushRgba('#ff5722', 0, true), [255, 87, 34, 0])
})

test('invalid sample data cannot change the current brush', () => {
  for (const pixel of [[1, 2, 3], [1, 2, 3, NaN], [1, 2, 3, 256], [-1, 2, 3, 255], [1, 2, 3, .5]]) assert.equal(sampleSkinBrush(pixel, true), undefined)
})
