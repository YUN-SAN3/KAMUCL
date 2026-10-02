export interface RgbColor { r: number; g: number; b: number }
export interface HsvColor { h: number; s: number; v: number }

export const SKIN_COLOR_PRESETS = [
  '#ffffff', '#d8dce3', '#969cab', '#555c6b', '#292b32', '#101116',
  '#fff1dc', '#f0cfb5', '#deb99a', '#d88c58', '#ad7452', '#7c4c35',
  '#ffdd74', '#eeaa46', '#dc7536', '#cb452f', '#ff8199', '#e94657',
  '#bf2347', '#762540', '#e5c8fa', '#bd89dc', '#8869ba', '#574475',
  '#b7e9f3', '#56a6db', '#2978b6', '#244675', '#a9e2d1', '#71bdb9',
  '#398f91', '#275b65', '#d0e8a0', '#7aad65', '#478553', '#2b4d3c'
]

/** Only a complete six-digit colour can become the active brush colour. */
export function parseSkinHex(value: string): RgbColor | undefined {
  const hex = value.trim().replace(/^#/, '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return undefined
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) }
}

const clamp = (value: number, maximum: number) => Math.max(0, Math.min(maximum, value))
export function rgbToSkinHex(rgb: RgbColor): string {
  return '#' + [rgb.r, rgb.g, rgb.b].map(c => Math.round(clamp(c, 255)).toString(16).padStart(2, '0')).join('')
}

export function rgbToHsv({ r, g, b }: RgbColor): HsvColor {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  let h = 0
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h = (h * 60 + 360) % 360
  }
  return { h, s: max ? delta / max * 100 : 0, v: max * 100 }
}

export function hsvToRgb({ h, s, v }: HsvColor): RgbColor {
  h = ((h % 360) + 360) % 360
  s = clamp(s, 100) / 100; v = clamp(v, 100) / 100
  const chroma = v * s, x = chroma * (1 - Math.abs((h / 60) % 2 - 1)), m = v - chroma
  const [r, g, b] = h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0] : h < 180 ? [0, chroma, x] : h < 240 ? [0, x, chroma] : h < 300 ? [x, 0, chroma] : [chroma, 0, x]
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) }
}

/** Empty drafts, exponent notation and out-of-range fields are not committed. */
export function parseSkinChannels(values: string[], maxima: number[], integers = false): number[] | undefined {
  if (values.length !== maxima.length) return undefined
  const result = values.map(value => value.trim())
  if (result.some(value => !(integers ? /^\d+$/ : /^\d+(?:\.\d+)?$/).test(value))) return undefined
  const numbers = result.map(Number)
  return numbers.every((value, index) => Number.isFinite(value) && value >= 0 && value <= maxima[index]) ? numbers : undefined
}

export function skinBrushRgba(color: string, alpha: number, outer: boolean): number[] | undefined {
  const rgb = parseSkinHex(color)
  if (!rgb || !Number.isFinite(alpha)) return undefined
  return [rgb.r, rgb.g, rgb.b, outer ? Math.round(clamp(alpha, 1) * 255) : 255]
}

export function rememberSkinColor(recent: string[], color: string, limit = 24): string[] {
  const rgb = parseSkinHex(color)
  if (!rgb) return [...recent]
  const normalized = rgbToSkinHex(rgb)
  return [normalized, ...recent.filter(c => c.toLowerCase() !== normalized)].slice(0, limit)
}
