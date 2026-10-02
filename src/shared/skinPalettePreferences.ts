import type { SkinEditorPaletteSettings } from './types'

/** Normalize untrusted persisted preferences and settings IPC input. */
export function normalizeSkinPalettePreferences(raw: unknown): SkinEditorPaletteSettings {
  const input = raw && typeof raw === 'object' ? raw as Partial<SkinEditorPaletteSettings> : {}
  const hex = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined
  const colors = (value: unknown, limit: number) => Array.isArray(value)
    ? [...new Set(value.map(hex).filter((c): c is string => !!c))].slice(0, limit) : []
  return {
    custom: colors(input.custom, 256),
    recent: colors(input.recent, 24),
    color: hex(input.color) ?? '#d88c58',
    alpha: typeof input.alpha === 'number' && Number.isFinite(input.alpha) ? Math.max(0, Math.min(1, input.alpha)) : 1
  }
}
