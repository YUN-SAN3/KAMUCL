import type { ProgressEvent } from '@shared/types'
import { taskProgressPercent } from '@shared/taskProgress'

/** Ignore all unrelated/late task events; filenames are not operation identity. */
export function matchingModProgress(event: ProgressEvent, operationId: string, busy: boolean): ProgressEvent | undefined {
  return busy && !!operationId && event.operationId === operationId ? { ...event } : undefined
}
export function modProgressPercent(event: ProgressEvent): number | undefined {
  return event.indeterminate ? undefined : taskProgressPercent({ status: event.stage === 'done' ? 'done' : 'running', progress: event.overall ?? event.progress })
}
export function modProgressBytes(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${Math.floor(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
