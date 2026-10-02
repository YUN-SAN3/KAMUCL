/** Pixel operations shared by the editor and export validation. Coordinates use PNG origin. */
export type SkinFace = { x: number; y: number; width: number; height: number }
const baseRects: SkinFace[] = [
  { x: 0, y: 0, width: 32, height: 16 }, { x: 0, y: 16, width: 56, height: 16 },
  { x: 16, y: 48, width: 32, height: 16 }
]
export function isBasePixel(x: number, y: number): boolean {
  return baseRects.some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)
}
export function makeBaseOpaque(data: Uint8ClampedArray): void {
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (isBasePixel(x, y)) data[(y * 64 + x) * 4 + 3] = 255
}
export function paintSkinPixel(data: Uint8ClampedArray, x: number, y: number, color: number[], face: SkinFace, fill = false): void {
  if (x < face.x || y < face.y || x >= face.x + face.width || y >= face.y + face.height) return
  const offset = (y * 64 + x) * 4, old = Array.from(data.slice(offset, offset + 4))
  if (old.every((v, i) => v === color[i])) return
  const queue = [y * 64 + x], seen = new Set<number>()
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i], px = p % 64, py = Math.floor(p / 64)
    if (seen.has(p) || px < face.x || py < face.y || px >= face.x + face.width || py >= face.y + face.height) continue
    seen.add(p)
    if (!old.every((v, c) => data[p * 4 + c] === v)) continue
    for (let c = 0; c < 4; c++) data[p * 4 + c] = c === 3 && isBasePixel(px, py) ? 255 : color[c]
    if (fill) queue.push(p - 1, p + 1, p - 64, p + 64)
  }
}
