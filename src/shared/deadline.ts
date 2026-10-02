/** The operation must check signal before committing late side effects. */
export async function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, message: string): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { const error = new Error(message); controller.abort(error); reject(error) }, ms)
  })
  try { return await Promise.race([work(controller.signal), timeout]) }
  finally { clearTimeout(timer) }
}

/** An idle watchdog, not a cap on a healthy download's total duration. */
export class ProgressDeadline {
  private controller = new AbortController()
  private timer: ReturnType<typeof setTimeout> | undefined
  private previous: string | undefined
  readonly signal = this.controller.signal
  constructor(private ms: number, private onTimeout: () => void) { this.arm() }
  progress(value: string): void {
    if (this.signal.aborted || value === this.previous) return
    this.previous = value
    this.arm()
  }
  private arm(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.controller.abort(new Error('启动准备超时，已取消'))
      this.onTimeout()
    }, this.ms)
  }
  dispose(): void { clearTimeout(this.timer) }
}
