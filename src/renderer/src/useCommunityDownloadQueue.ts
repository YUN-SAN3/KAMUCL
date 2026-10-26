import { communityDownload, prepareModInstall, commitModInstall, discardModInstall, cancelTask, onProgress, onTaskDone } from './api'
import { store, toast } from './store'
import { createCommunityDownloadQueue } from './communityDownloadQueue'

let queue: ReturnType<typeof createCommunityDownloadQueue> | undefined
/** One session queue survives community route changes. Existing download center receives
 * the same main-process progress events and keeps its cancellation controls. */
export function useCommunityDownloadQueue() {
  if (!queue) {
    queue = createCommunityDownloadQueue({
      prepare: prepareModInstall,
      commit: (id, operationId) => commitModInstall(id, true, operationId),
      discard: discardModInstall,
      download: communityDownload,
      cancel: cancelTask,
      uuid: () => crypto.randomUUID(),
      changed(item) {
        if (item.state === 'completed') { store.fsRefreshTick++; toast(`${item.file.fileName}：${item.kind === 'modpack' ? '整合包安装完成' : item.result || '安装完成'}`, 'success') }
        else if (item.state === 'failed') toast(`${item.file.fileName}：${item.error}，可在社区队列重试`, 'error')
      }
    })
    onProgress(event => queue!.progress(event))
    onTaskDone(event => queue!.done(event))
  }
  return queue
}
