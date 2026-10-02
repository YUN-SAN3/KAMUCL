import type { ParallelStage, ProgressEvent } from '../../shared/types'

interface Lane { id: string; label: string; weight: number }
const fraction = (n: number): number => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0

/** Independent lanes contribute to one weighted total; unfinished installation has no reliable ETA. */
export class ParallelProgress {
  private events = new Map<string, ProgressEvent>()
  private completed = new Set<string>()
  private publishedAt = 0
  constructor(
    private lanes: readonly Lane[], private emit: (event: ProgressEvent) => void,
    private text: string, private range: readonly [number, number]
  ) {}

  update(id: string, event: ProgressEvent): void {
    const previous = this.events.get(id)
    this.events.set(id, event)
    // Installer stdout can produce thousands of lines per second; retain the latest lane
    // state without flooding IPC, the renderer and the on-disk task log for every line.
    if (!previous || previous.stage !== event.stage || performance.now() - this.publishedAt >= 100) this.publish()
  }

  done(id: string): void { this.completed.add(id); this.publish() }

  private publish(): void {
    this.publishedAt = performance.now()
    const stages: ParallelStage[] = []
    let weighted = 0
    let speed = 0
    for (const lane of this.lanes) {
      const event = this.events.get(lane.id)
      const done = this.completed.has(lane.id)
      const progress = done ? 1 : Math.min(0.999, fraction(event?.overall ?? event?.progress ?? 0))
      weighted += lane.weight * progress
      if (!done && event?.speed && Number.isFinite(event.speed)) speed += Math.max(0, event.speed)
      if (!done && event?.parallelStages?.length) {
        stages.push(...event.parallelStages.map(child => ({ ...child, id: `${lane.id}/${child.id}` })))
      } else {
        stages.push({ id: lane.id, label: lane.label, text: event?.text ?? '等待准备', progress,
          state: done ? 'done' : event ? 'running' : 'waiting', speed: done ? undefined : event?.speed,
          indeterminate: !done && event?.indeterminate })
      }
    }
    const progress = this.range[0] + (this.range[1] - this.range[0]) * weighted / this.lanes.reduce((n, lane) => n + lane.weight, 0)
    this.emit({ stage: 'parallel', progress, overall: progress, text: this.text, speed: speed || undefined, parallelStages: stages })
  }
}
