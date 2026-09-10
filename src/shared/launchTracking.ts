import type { LaunchState } from './types'
import { instanceKey } from './modCompatibility'

export interface LaunchTracking {
  launchState: LaunchState | null
  launchStates: Record<string, LaunchState>
  launchingVersionId: string
  launchingFolder: string
}
export function trackLaunchState(state: LaunchTracking, incoming: LaunchState): boolean {
  const focused = !incoming.versionId || (incoming.versionId === state.launchingVersionId && (incoming.folder ?? '') === state.launchingFolder && (!incoming.launchId || !state.launchState?.launchId || incoming.launchId === state.launchState.launchId))
  if (incoming.versionId) {
    const key = instanceKey({ id: incoming.versionId, folder: incoming.folder ?? '' })
    if (incoming.launchId) delete state.launchStates[key] // replace optimistic renderer preparation
    state.launchStates[incoming.launchId ? `${key}#${incoming.launchId}` : key] = incoming
  }
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
  return Object.values(states).some(s => s.versionId === id && (s.folder ?? '') === (folder ?? '') && s.status === 'launching')
}
