import assert from 'node:assert/strict'
import test from 'node:test'
import { fallbackSkinPixels } from '../src/renderer/src/fallbackSkin'

test('离线默认皮肤覆盖头、躯干、左右四肢的全部基础 UV，外层保持透明', () => {
  const data = fallbackSkinPixels()
  const alpha = (x: number, y: number) => data[(y * 64 + x) * 4 + 3]
  const faces = [
    [8, 0, 16, 8], [0, 8, 32, 8], [20, 16, 16, 4], [16, 20, 24, 12],
    ...[[0, 16], [40, 16], [16, 48], [32, 48]].flatMap(([x, y]) => [[x + 4, y, 8, 4], [x, y + 4, 16, 12]])
  ]
  const covered = new Set<number>()
  for (const [x, y, w, h] of faces) for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
    assert.equal(alpha(col, row), 255, `基础 UV 不透明：${col},${row}`)
    covered.add(row * 64 + col)
  }
  for (let i = 0; i < 4096; i++) if (!covered.has(i)) assert.equal(data[i * 4 + 3], 0, `外层/空白 UV：${i}`)
})

test('默认皮肤正面有独立眼睛、头发和衣物细节，不再是无脸纯色模型', () => {
  const data = fallbackSkinPixels()
  const pixel = (x: number, y: number) => Array.from(data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 3))
  assert.notDeepEqual(pixel(10, 12), pixel(10, 14))
  assert.notDeepEqual(pixel(9, 12), pixel(10, 12))
  assert.notDeepEqual(pixel(12, 8), pixel(12, 14))
  assert.notDeepEqual(pixel(23, 24), pixel(25, 24))
  assert.notDeepEqual(pixel(5, 30), pixel(5, 24))
})
