// Original KAMUCL pixel artwork. No remote skin or third-party texture required.
// Standard 64×64 classic skin UVs, with transparent unused/outer-layer regions.
export function fallbackSkinPixels(): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(64 * 64 * 4)
  function rect(x: number, y: number, w: number, h: number, hex: number): void {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
      const i = (row * 64 + col) * 4
      pixels.set([hex >> 16 & 255, hex >> 8 & 255, hex & 255, 255], i)
    }
  }
  const skin = 0xd3a582, shade = 0xbf8b6c, hair = 0x49382f
  const jacket = 0x398d8a, seam = 0x286b70, light = 0x69b5ad
  const pants = 0x38485e, shoe = 0x27303d
  // Head: cap, underside and four faces. Front faces the default preview camera.
  rect(8, 0, 8, 8, hair); rect(16, 0, 8, 8, shade)
  rect(0, 8, 32, 8, skin); rect(0, 8, 32, 2, hair)
  rect(24, 8, 8, 7, hair); rect(0, 8, 6, 5, hair); rect(18, 8, 6, 5, hair)
  rect(8, 10, 2, 1, hair); rect(14, 10, 2, 2, hair)
  rect(9, 11, 2, 1, 0x675043); rect(13, 11, 2, 1, 0x675043)
  rect(9, 12, 2, 1, 0xf2ede2); rect(13, 12, 2, 1, 0xf2ede2)
  rect(10, 12, 1, 1, 0x315f62); rect(13, 12, 1, 1, 0x315f62)
  rect(11, 13, 2, 1, shade); rect(11, 15, 2, 1, 0x915d50)
  // Torso: teal zip jacket over a light shirt, including sides and back.
  rect(20, 16, 16, 4, jacket); rect(16, 20, 24, 12, jacket)
  rect(16, 20, 4, 12, seam); rect(28, 20, 4, 12, seam)
  rect(23, 16, 2, 3, skin); rect(22, 20, 4, 2, 0xe3e5df)
  rect(23, 22, 2, 10, 0xe3e5df); rect(20, 22, 1, 8, light)
  rect(26, 26, 2, 2, seam); rect(20, 30, 3, 2, seam); rect(25, 30, 3, 2, seam)
  rect(32, 22, 8, 1, light); rect(32, 30, 8, 2, seam)
  function arm(x: number, y: number): void {
    rect(x + 4, y, 4, 4, jacket); rect(x + 8, y, 4, 4, skin)
    rect(x, y + 4, 16, 12, jacket)
    rect(x, y + 10, 16, 1, light); rect(x, y + 11, 16, 1, seam)
    rect(x, y + 12, 16, 4, skin); rect(x, y + 15, 16, 1, shade)
    rect(x, y + 4, 4, 6, seam)
  }
  function leg(x: number, y: number): void {
    rect(x + 4, y, 4, 4, pants); rect(x + 8, y, 4, 4, shoe)
    rect(x, y + 4, 16, 12, pants); rect(x, y + 13, 16, 3, shoe)
    rect(x + 4, y + 4, 1, 9, 0x506078); rect(x + 4, y + 14, 4, 1, 0xb4bfc4)
    rect(x + 12, y + 5, 3, 3, 0x304054)
  }
  arm(40, 16); arm(32, 48); leg(0, 16); leg(16, 48)
  return pixels
}

export function createFallbackSkin(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const data = ctx.createImageData(64, 64)
  data.data.set(fallbackSkinPixels()); ctx.putImageData(data, 0, 0)
  return canvas
}
