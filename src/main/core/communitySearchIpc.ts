import type { IpcMain, WebContents } from 'electron'
import { IPC, IPC_EVENT } from '../../shared/types'
import type { CommunityQuery, CommunitySearchContinuation, CommunitySearchSnapshot } from '../../shared/types'

interface SearchService {
  startCommunitySearch(owner: number, requestId: string, query: CommunityQuery,
    onUpdate: (snapshot: CommunitySearchSnapshot) => void): CommunitySearchSnapshot
  continueCommunitySearch(owner: number, requestId: string, continuation: CommunitySearchContinuation): CommunitySearchSnapshot
  cancelCommunitySearch(owner: number, requestId?: string): boolean
}

/** Search updates belong to the requesting renderer, including when the main
 * application window has changed. A closed owner cannot keep subscriptions. */
export function registerCommunitySearchIpc(ipcMain: Pick<IpcMain, 'handle'>, service: SearchService): void {
  const owners = new WeakSet<WebContents>()
  const registerOwner = (sender: WebContents): void => {
    if (owners.has(sender)) return
    owners.add(sender)
    const owner = sender.id
    sender.once('destroyed', () => service.cancelCommunitySearch(owner))
  }
  ipcMain.handle(IPC.communitySearchStart, (event, requestId: string, query: CommunityQuery) => {
    registerOwner(event.sender)
    return service.startCommunitySearch(event.sender.id, requestId, query, snapshot => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENT.communitySearchUpdate, snapshot)
    })
  })
  ipcMain.handle(IPC.communitySearchContinue, (event, requestId: string, continuation: CommunitySearchContinuation) =>
    service.continueCommunitySearch(event.sender.id, requestId, continuation))
  ipcMain.handle(IPC.communitySearchCancel, (event, requestId: string) => {
    if (typeof requestId !== 'string' || !requestId) throw new Error('社区搜索请求标识无效')
    return service.cancelCommunitySearch(event.sender.id, requestId)
  })
}
