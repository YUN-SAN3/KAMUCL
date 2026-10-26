import type { SkinHistoryEntry, SkinVariant } from '@shared/types'

/** A read-only local preview selection; account uploads remain a separate action. */
export function resolveSkinPreview(
  current: { dataUrl?: string; variant?: string } | null | undefined,
  history: readonly SkinHistoryEntry[], selectedId: string, activeCape: string
): { source: string; variant: SkinVariant; cape: string; history?: SkinHistoryEntry } {
  const selected = history.find(item => item.id === selectedId)
  return {
    source: selected?.dataUrl || current?.dataUrl || '',
    variant: (selected?.variant || current?.variant) === 'slim' ? 'slim' : 'classic',
    cape: selected ? '' : activeCape,
    history: selected
  }
}
