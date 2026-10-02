export interface InstanceTarget { folder: string; id: string }
export interface BackupEntry { path: string; size: number; sha256: string }
export interface BackupManifest {
  format: 1; id: string; createdAt: string; title: string; automatic: boolean
  source: string; roots: string[]; files: BackupEntry[]; metadata?: Record<string, unknown>
}
export interface InstanceWorld { id: string; name: string; version?: string; mode?: string; lastPlayed?: number; icon?: string; error?: string }
export interface InstanceScreenshot { id: string; date: number; image: string }
export interface DiagnosticFinding {
  rule: string; title: string; confidence: 'certain' | 'possible' | 'unknown'
  evidence: string; advice: string; action?: 'files' | 'java' | 'mods'; fileName?: string
  mods?: Array<{fileName:string;name:string;icon?:string}>
}
export interface InstanceOverview {
  target: InstanceTarget; directory: string; shared: boolean; name: string
  mcVersion: string; loader?: string; running: boolean; roots: string[]
}
export interface InstanceOperation {
  kind: 'backup' | 'clone' | 'restore' | 'worldExport' | 'repair'
  target: InstanceTarget; name?: string; destinationFolder?: string
  saves?: boolean; screenshots?: boolean; world?: string; backupId?: string; overwrite?: boolean
}
