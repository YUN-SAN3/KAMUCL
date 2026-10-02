export type ModSyncScope = 'required' | 'all'
export type ModSyncGate = 'MANIFEST' | 'UNSUPPORTED' | 'EMPTY' | 'NOT_READY' | 'BYPASSED'
export interface ModSyncGateResult { gate:Exclude<ModSyncGate,'MANIFEST'>; message:string }
export interface ModSyncEntry {
  projectId: string; slug: string; title: string; versionNumber: string
  fileName: string; url: string; sha1: string; sha512: string; size: number
  loaders: string[]; gameVersions: string[]
}
export interface ModSyncManifest {
  protocolVersion: 'modSync.v1'; loader: string; mcVersion: string
  mods: ModSyncEntry[]; unknownMods: string[]
}
export type ModSyncStatus = 'installed' | 'disabled' | 'conflict' | 'missing' | 'unresolved'
export interface ModSyncRow { entry: ModSyncEntry; status: ModSyncStatus; reason: string }
export interface ModSyncPlan {
  gate?:'MANIFEST'
  id: string; code: string; scope: ModSyncScope; target: { id: string; folder: string }
  loader: string; mcVersion: string; rows: ModSyncRow[]; unknownMods: string[]
}
