import path from 'node:path'
import { samePath } from './folderPaths'
export interface DiagnosticSession { versionId?:unknown;effectiveGameDir?:unknown;startedAt?:unknown;logDir?:unknown }
/** Legacy shared stdout files cannot safely identify an individual launch. */
export function selectDiagnosticSession(id:string,directory:string,contexts:DiagnosticSession[]):DiagnosticSession|undefined {
  return contexts.filter(c=>c.versionId===id&&typeof c.effectiveGameDir==='string'&&samePath(c.effectiveGameDir,directory)&&typeof c.logDir==='string'&&/^[a-f0-9-]{36}$/.test(path.basename(c.logDir))&&Number.isFinite(Date.parse(String(c.startedAt))))
    .sort((a,b)=>Date.parse(String(b.startedAt))-Date.parse(String(a.startedAt)))[0]
}
