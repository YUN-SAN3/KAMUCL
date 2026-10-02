import type { ProgressEvent } from '../../shared/types'

export type StageRange = readonly [start: number, end: number]

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

/** 将明确阶段权重映射为任务总进度；映射发生在主进程业务层。 */
export function createWeightedProgressEmit(
  emit: (event: ProgressEvent) => void,
  ranges: Readonly<Record<string, StageRange>>
): (event: ProgressEvent) => void {
  let last = 0
  return (event) => {
    const range = ranges[event.stage]
    const stageProgress = clamp01(Number.isFinite(event.progress) ? event.progress : 0)
    const candidate = event.overall ?? (range ? range[0] + (range[1] - range[0]) * stageProgress : last)
    last = Math.max(last, clamp01(candidate))
    emit({ ...event, overall: last })
  }
}

/**
 * IPC 出口最后防线：业务层整体进度只能增长，并清除 NaN/Infinity/负 ETA。
 * 底层字节聚合和阶段权重仍是主修复，本守卫不负责“伪造”未知百分比。
 */
export class ProgressEventGuard {
  private last = 0

  normalize(event: ProgressEvent): ProgressEvent {
    const raw = event.overall ?? event.progress
    const candidate = Number.isFinite(raw) ? clamp01(raw) : this.last
    this.last = Math.max(this.last, candidate)
    const etaSeconds =
      event.etaSeconds != null && Number.isFinite(event.etaSeconds) && event.etaSeconds >= 0
        ? Math.round(event.etaSeconds)
        : undefined
    return { ...event, overall: this.last, etaSeconds }
  }
}

export const VERSION_INSTALL_STAGE_RANGES: Readonly<Record<string, StageRange>> = {
  'version-json': [0, 0.04],
  libraries: [0.04, 0.38],
  client: [0.38, 0.55],
  assets: [0.55, 0.82],
  loader: [0.82, 0.96],
  'loader-dependencies': [0.905, 0.94],
  'loader-process': [0.94, 0.95],
  'fabric-api': [0.96, 0.995],
  done: [1, 1]
}
