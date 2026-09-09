import type { LaunchState } from './types'
import { instanceKey } from './modCompatibility'

export interface LaunchTracking {
  launchState: LaunchState | null
  launchStates: Record<string, LaunchState>
  launchingVersionId: string
  launchingFolder: string
}
export function trackLaunchState(state: LaunchTracking, incoming: LaunchState): boolean {
  const focused = !incoming.versionId || (incoming.versionId === state.launchingVersionId && (incoming.folder ?? '') === state.launchingFolder)
  if (incoming.versionId) state.launchStates[instanceKey({ id: incoming.versionId, folder: incoming.folder ?? '' })] = incoming
  if (incoming.status === 'launching' || focused || !state.launchState) {
    let next = incoming
    if (incoming.status === 'exited' || incoming.status === 'error') {
      const active = Object.values(state.launchStates).filter(s => s.status === 'running' || s.status === 'launching')
      next = [...active].reverse().find(s => s.status === 'launching') ?? active.at(-1) ?? incoming
    }
    state.launchState = next
    if (next.versionId) { state.launchingVersionId = next.versionId; state.launchingFolder = next.folder ?? '' }
  }
  return focused
}
export function instanceLaunchBusy(states: Record<string, LaunchState>, id: string, folder?: string): boolean {
  const status = states[instanceKey({ id, folder: folder ?? '' })]?.status
  return status === 'launching' || status === 'running'
}
