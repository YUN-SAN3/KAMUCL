import type { InstanceTarget } from '../../shared/instanceCenter'
import { centerTarget, assertInstanceIdle } from './instanceCenter'
import { activeLaunchStates } from './launchUiState'
import { withFileJob } from './fileJobs'
import { withGameFolder } from './paths'
import { samePath } from './folderPaths'
import { resolveInstanceMetadata, isMinecraftVersionId } from './instanceMetadata'
import { readClientVersionEvidence } from './instanceVersionEvidence'
import { readVersionJson, resolveVersionChain, clientJarPath } from './versions'
import { applyDefaultResourcePacks } from './defaultResourcePacks'

function assertNoActiveLaunch(directory: string): void {
  for (const state of activeLaunchStates()) {
    if (!state.folder || !state.versionId) continue
    let dir: string
    try { dir = centerTarget({ folder: state.folder, id: state.versionId }).dir } catch { continue }
    if (samePath(dir, directory)) throw new Error('使用该目录的游戏正在启动或运行，请退出游戏后重试')
  }
}
/** Resolve the chosen instance's actual directory; shared instances use the same guard and selection. */
export async function applyDefaultResourcePacksToInstance(target: InstanceTarget): Promise<{ count: number; shared: boolean }> {
  if (!target || typeof target.id !== 'string' || typeof target.folder !== 'string') throw new Error('请选择有效的目标实例')
  const initial = centerTarget(target)
  return withFileJob(initial.dir, undefined, async () => {
    assertNoActiveLaunch(initial.dir)
    await assertInstanceIdle(initial.dir)
    assertNoActiveLaunch(initial.dir)
    const current = centerTarget(target)
    if (!samePath(initial.dir, current.dir)) throw new Error('实例游戏目录已改变，请重新选择后重试')
    const count = withGameFolder(current.folder, () => {
      const { baseId } = resolveVersionChain(target.id), client = clientJarPath(baseId)
      const metadata = resolveInstanceMetadata(current.json, id => {
        try { return readVersionJson(id) } catch { return undefined }
      }, () => readClientVersionEvidence(client))
      if (metadata.broken || !isMinecraftVersionId(metadata.mcVersion)) throw new Error('无法确认所选实例的 Minecraft 版本，请先修复版本描述')
      return applyDefaultResourcePacks(current.dir, metadata.mcVersion, client)
    })
    return { count, shared: !current.state.isolated }
  })
}
