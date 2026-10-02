import assert from 'node:assert/strict'
import test from 'node:test'
import { THEME_PRESETS, normalizeThemeName } from '../src/shared/types'
import { readableCustomColors, colorContrast } from '../src/shared/themeContrast'

function channel(value: number): number {
  const normalized = value / 255
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4)
}

function luminance(hex: string): number {
  assert.match(hex, /^#[0-9a-f]{6}$/i)
  const value = Number.parseInt(hex.slice(1), 16)
  return (
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255)
  )
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

test('旧主题 key 无损迁移到六主题体系，未知值回退图一默认主题', () => {
  assert.equal(normalizeThemeName('light'), 'blue-white')
  assert.equal(normalizeThemeName('dark'), 'black-orange')
  assert.equal(normalizeThemeName('pink-white'), 'white-pink')
  assert.equal(normalizeThemeName('pink-black'), 'black-pink')
  assert.equal(normalizeThemeName('custom'), 'custom')
  assert.equal(normalizeThemeName('transparent'), 'transparent')
  assert.equal(normalizeThemeName('not-a-theme'), 'transparent')
})

test('五套固定色板齐全且正文、次要文字具有可读对比度', () => {
  assert.deepEqual(Object.keys(THEME_PRESETS), [
    'blue-white',
    'black-orange',
    'white-pink',
    'black-pink',
    'transparent'
  ])
  for (const [key, theme] of Object.entries(THEME_PRESETS)) {
    assert.ok(contrast(theme.colors.text, theme.colors.card) >= 7, `${key} 正文对比度不足`)
    assert.ok(contrast(theme.colors.textDim, theme.colors.card) >= 4, `${key} 次要文字对比度不足`)
    assert.notEqual(theme.colors.accent.toLowerCase(), theme.colors.card.toLowerCase())
  }
  assert.equal(THEME_PRESETS['blue-white'].label, '白蓝')
  assert.equal(THEME_PRESETS['black-orange'].label, '橙黑')
  assert.equal(THEME_PRESETS['black-pink'].label, '粉黑')
  assert.equal(THEME_PRESETS['white-pink'].label, '粉白')
  assert.equal(THEME_PRESETS.transparent.label, '默认·黑紫')
})

test('个性化旧色板低对比与明暗混用仅在渲染时修正，不覆盖原始配置', () => {
  const original = { ...THEME_PRESETS['black-pink'].colors, card:'#ffffff', sidebarText:'#30192c', textDim:'#302030' }
  const before = { ...original }
  const result = readableCustomColors(original)
  assert.deepEqual(original, before)
  assert.equal(result.accent, original.accent)
  assert.ok(colorContrast(result.text, result.card) >= 4.5)
  assert.ok(colorContrast(result.textDim, result.card) >= 4.5)
  assert.ok(colorContrast(result.sidebarText, result.sidebarBg) >= 4.5)
})
