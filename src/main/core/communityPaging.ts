import type { CommunitySource } from '../../shared/types'

/** 两源交错组成一条结果序列；一源耗尽后继续另一源，保证页码无跳项和重复。 */
export function communityPageSlots(totals: Record<CommunitySource, number>, offset: number, limit: number) {
  const paired = Math.min(totals.modrinth, totals.curseforge)
  const remainder: CommunitySource = totals.modrinth > paired ? 'modrinth' : 'curseforge'
  const slots: Array<{ source: CommunitySource; index: number }> = []
  for (let i = offset; i < Math.min(offset + limit, totals.modrinth + totals.curseforge); i++) {
    slots.push(i < paired * 2
      ? { source: i % 2 ? 'curseforge' : 'modrinth', index: Math.floor(i / 2) }
      : { source: remainder, index: paired + i - paired * 2 })
  }
  return slots
}
