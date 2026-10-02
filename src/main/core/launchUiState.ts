import type { LaunchState } from '../../shared/types'

// A Mac window may close while its JVM keeps running. Reopening replays UI state,
// never recreates process handles or changes which session owns a game.
const active = new Map<string, LaunchState>()
export function rememberLaunchState(state: LaunchState): void {
  const key = state.launchId ?? `${state.folder ?? ''}:${state.versionId ?? ''}`
  if (state.status === 'running' || state.status === 'launching') active.set(key, { ...state })
  else active.delete(key)
}
export function activeLaunchStates(): LaunchState[] { return [...active.values()].map(state => ({ ...state })) }
