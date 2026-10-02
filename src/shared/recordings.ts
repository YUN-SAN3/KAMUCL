import type { InstanceTarget } from './instanceCenter'
export type RecordingKind = 'replaymod' | 'flashback'
export interface RecordingEntry {
  folder?: string
  id: string; name: string; kind: RecordingKind; size: number; modified: number
  source: string; directory: string; library: boolean; error?: string
}
export interface RecordingCatalog {
  entries: RecordingEntry[]; warnings: string[]; library: string
  instances: Array<InstanceTarget & { name: string }>
}
export interface RecordingRequest { action: 'collect' | 'export' | 'dispatch' | 'trash'; ids: string[]; target?: InstanceTarget }
export interface RecordingResult { id: string; name: string; ok: boolean; path?: string; error?: string }
export const RECORDING_DIRS: Record<RecordingKind, string> = { replaymod: 'replay_recordings', flashback: 'flashback/replays' }
