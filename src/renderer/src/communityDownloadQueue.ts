import { reactive } from 'vue'
import type { CommunityFile, CommunityKind, InstalledVersion, ModInstallPlan, ProgressEvent } from '@shared/types'

export type CommunityDownloadState = 'queued' | 'preparing' | 'confirmation' | 'installing' | 'downloading' | 'installing-pack' | 'completed' | 'failed' | 'cancelled'
export interface CommunityDownloadRequest {
  file: CommunityFile
  kind: CommunityKind
  target?: InstalledVersion
  /** The accepted default is captured even for packs, which create a new instance. */
  folder: string
}
export interface CommunityDownloadItem extends CommunityDownloadRequest {
  id: string
  state: CommunityDownloadState
  action: 'prepare' | 'install' | 'resource'
  operationId: string
  progress?: ProgressEvent
  plan?: ModInstallPlan
  error: string
  result: string
  cancelRequested: boolean
}
export interface CommunityDownloadPort {
  prepare(target: { id: string; folder: string }, input: { file: CommunityFile }, operationId: string): Promise<ModInstallPlan>
  commit(planId: string, operationId: string): Promise<string>
  discard(planId: string): Promise<unknown>
  download(file: CommunityFile, target: { versionId: string; kind: CommunityKind; folder: string }, operationId: string): Promise<string>
  cancel(taskId: string): Promise<unknown>
  changed(item: CommunityDownloadItem): void
  uuid(): string
}
const terminal = (state: CommunityDownloadState) => ['completed', 'failed', 'cancelled'].includes(state)
const folderKey = (folder: string) => /^[a-z]:[\\/]/i.test(folder) ? folder.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : folder.replace(/\/+$/, '')
const identity = (request: CommunityDownloadRequest) => JSON.stringify([request.kind, request.file.source, request.file.projectId, request.file.fileId, folderKey(request.folder), request.target?.id ?? ''])
// IPC inputs must be plain immutable values; Vue proxies and later filter edits must not leak into a task.
function snapshot<T>(value: T): T {
  const freeze = (v: any): any => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v) }; return v }
  return freeze(JSON.parse(JSON.stringify(value)))
}

/** Queue policy is independent from dialogs, routes and IPC. Only one transfer/commit starts
 * at a time; plans awaiting confirmation do not block unrelated resource preparations. */
export function createCommunityDownloadQueue(port: CommunityDownloadPort) {
  const items = reactive<CommunityDownloadItem[]>([])
  let running = false
  const packOutcomes = new Map<string, { ok: boolean; error?: string; cancelled?: boolean }>()
  const notify = (item: CommunityDownloadItem) => port.changed(item)
  const finish = (item: CommunityDownloadItem, state: CommunityDownloadState, error = '') => {
    item.state = state; item.error = error; item.plan = undefined; notify(item)
  }
  async function pump() {
    if (running) return
    // Bound prepared plans below the main process limit, leaving room for local MOD drops.
    const pendingPlans = items.filter(item => item.state === 'confirmation').length
    const item = items.find(item => item.state === 'queued' && (item.action !== 'prepare' || pendingPlans < 4))
    if (!item) return
    running = true; item.operationId = port.uuid(); item.progress = undefined; item.error = ''
    try {
      if (item.action === 'prepare') {
        item.state = 'preparing'
        const plan = await port.prepare({ id: item.target!.id, folder: item.folder }, { file: item.file }, item.operationId)
        if (item.cancelRequested) { await port.discard(plan.id); finish(item, 'cancelled', '已取消') }
        else { item.plan = plan; item.state = 'confirmation'; notify(item) }
      } else if (item.action === 'install') {
        item.state = 'installing'
        const planId = item.plan!.id
        item.plan = undefined // Main process consumes each plan exactly once.
        item.result = await port.commit(planId, item.operationId)
        finish(item, 'completed')
      } else {
        item.state = 'downloading'
        item.result = await port.download(item.file, { versionId: item.target?.id ?? '', kind: item.kind, folder: item.folder }, item.operationId)
        if (item.kind === 'modpack') {
          const outcome = packOutcomes.get(item.id)
          if (outcome) finish(item, outcome.ok ? 'completed' : outcome.cancelled ? 'cancelled' : 'failed', outcome.error)
          else item.state = 'installing-pack'
        } else finish(item, 'completed')
      }
    } catch (error) {
      finish(item, item.cancelRequested || String(error).includes('已取消') ? 'cancelled' : 'failed', error instanceof Error ? error.message : String(error))
    } finally { running = false; void pump() }
  }
  function enqueue(request: CommunityDownloadRequest): { item: CommunityDownloadItem; added: boolean } {
    const existing = items.find(item => !terminal(item.state) && identity(item) === identity(request))
    if (existing) return { item: existing, added: false }
    if (!request.folder || request.kind !== 'modpack' && !request.target) throw new Error('请选择已登记的目标实例')
    const frozen = snapshot(request)
    const item = reactive<CommunityDownloadItem>({ ...frozen, id: port.uuid(), state: 'queued', action: request.kind === 'mod' ? 'prepare' : 'resource', operationId: '', error: '', result: '', cancelRequested: false })
    items.push(item); void pump()
    return { item, added: true }
  }
  function confirm(id: string): boolean {
    const item = items.find(item => item.id === id)
    if (!item || item.state !== 'confirmation' || !item.plan || item.plan.warnings.length) return false
    item.action = 'install'; item.state = 'queued'; void pump(); return true
  }
  async function cancel(id: string) {
    const item = items.find(item => item.id === id)
    if (!item || terminal(item.state)) return
    if (item.state === 'queued' || item.state === 'confirmation') {
      const planId = item.plan?.id
      finish(item, 'cancelled', '已取消')
      if (planId) await port.discard(planId)
      void pump(); return
    }
    item.cancelRequested = true
    if (item.progress?.taskId) await port.cancel(item.progress.taskId)
  }
  function retry(id: string): boolean {
    const item = items.find(item => item.id === id)
    if (!item || !['failed', 'cancelled'].includes(item.state)) return false
    if (items.some(other => other.id !== id && !terminal(other.state) && identity(other) === identity(item))) return false
    packOutcomes.delete(id); item.plan = undefined; item.cancelRequested = false; item.error = ''; item.result = ''
    item.action = item.kind === 'mod' ? 'prepare' : 'resource'; item.state = 'queued'; void pump(); return true
  }
  async function recheck(id: string) {
    const item = items.find(item => item.id === id)
    if (!item || item.state !== 'confirmation') return
    const planId = item.plan?.id
    item.plan = undefined; item.action = 'prepare'; item.state = 'queued'
    if (planId) await port.discard(planId)
    void pump()
  }
  function progress(event: ProgressEvent) {
    if (!event.operationId) return
    const item = items.find(item => item.operationId === event.operationId && !terminal(item.state))
    if (!item) return
    item.progress = event
    if (item.cancelRequested && event.taskId) void port.cancel(event.taskId).catch(() => {})
  }
  function done(event: { taskId: string; ok: boolean; error?: string; cancelled?: boolean }) {
    const item = items.find(item => item.kind === 'modpack' && item.progress?.taskId === event.taskId && !terminal(item.state))
    if (!item) return
    packOutcomes.set(item.id, event)
    if (item.state === 'installing-pack') finish(item, event.ok ? 'completed' : event.cancelled ? 'cancelled' : 'failed', event.error)
  }
  function dismiss(id: string) {
    const index = items.findIndex(item => item.id === id && terminal(item.state))
    if (index >= 0) { items.splice(index, 1); packOutcomes.delete(id) }
  }
  return { items, enqueue, confirm, cancel, retry, recheck, progress, done, dismiss }
}
