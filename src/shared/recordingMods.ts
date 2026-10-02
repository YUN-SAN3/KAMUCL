import type { CommunityFile } from './types'
import type { RecordingKind } from './recordings'
export const RECORDING_PROJECTS: Record<RecordingKind, string> = { replaymod: 'Nv2fQJo5', flashback: '4das1Fjq' }
export function compatibleRecordingMod(file: CommunityFile, mc: string, loader: string) {
  return file.gameVersions.includes(mc) && file.loaders.includes(loader) && !!file.sha1 && /^[a-f0-9]{40}$/i.test(file.sha1) && file.url.startsWith('https://') && /^[^\\/:]+\.jar$/i.test(file.fileName)
}
export async function resolveRecordingDependencies(roots: CommunityFile[], mc: string, loader: string, lookup: (project?: string, file?: string) => Promise<CommunityFile>): Promise<CommunityFile[]> {
  const chosen = new Map<string, CommunityFile>(), queue = [...roots]
  for (let index = 0; index < queue.length; index++) {
    if (queue.length > 100) throw new Error('录像模组必要前置过多')
    const file = queue[index]
    if (!file.projectId || !compatibleRecordingMod(file, mc, loader)) throw new Error('模组或必要前置没有当前游戏与加载器的兼容文件')
    const existing = chosen.get(file.projectId)
    if (existing) { if (existing.fileId !== file.fileId) throw new Error('必要前置版本冲突，请调整模组版本：' + file.projectId); continue }
    chosen.set(file.projectId, file)
    for (const dependency of file.dependencies || []) {
      if (!dependency.required) continue
      const current = dependency.projectId ? chosen.get(dependency.projectId) || roots.find(r => r.projectId === dependency.projectId) : undefined
      if (current && (!dependency.fileId || dependency.fileId === current.fileId)) continue
      queue.push(await lookup(dependency.projectId, dependency.fileId))
    }
  }
  return [...chosen.values()]
}
