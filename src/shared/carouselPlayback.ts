export interface CarouselBookmark { path: string; remainingMs: number; random?: boolean; remainingPaths?: string[] }
/** Time belongs to the visible slide. A view unmount pauses, not resets, playback. */
export class CarouselPlayback {
  index = 0
  private due = 0
  private bag: number[] = []
  constructor(readonly slides: Array<{ path: string; durationMs: number }>, now: number, bookmark?: CarouselBookmark,
    readonly random = false, private readonly rng: () => number = Math.random) {
    const index = bookmark ? slides.findIndex(s => s.path === bookmark.path) : -1
    this.index = index >= 0 ? index : random && slides.length ? this.draw(slides.length) : 0
    const duration = slides[this.index]?.durationMs ?? 6500
    this.due = now + (index >= 0 && Number.isFinite(bookmark?.remainingMs) ? Math.max(1, Math.min(duration, bookmark!.remainingMs)) : duration)
    if (random) {
      const paths = bookmark?.random && bookmark.remainingPaths
      if (index >= 0 && Array.isArray(paths) && new Set(paths).size === paths.length && paths.every(p => slides.some(s => s.path === p))) {
        this.bag = paths.map(p => slides.findIndex(s => s.path === p))
        if (this.bag[0] === this.index) this.bag = []
      } else this.bag = this.shuffle(slides.map((_, i) => i).filter(i => i !== this.index))
    }
  }
  private draw(length: number) { return Math.min(length - 1, Math.max(0, Math.floor(this.rng() * length))) }
  private shuffle(values: number[]) {
    for (let i = values.length - 1; i > 0; i--) { const j = this.draw(i + 1); [values[i], values[j]] = [values[j], values[i]] }
    return values
  }
  private next() {
    if (!this.random) return (this.index + 1) % this.slides.length
    if (!this.bag.length) {
      this.bag = this.shuffle(this.slides.map((_, i) => i))
      if (this.bag[0] === this.index && this.bag.length > 1) [this.bag[0], this.bag[1]] = [this.bag[1], this.bag[0]]
    }
    return this.bag[0]
  }
  tick(now: number): number {
    if (this.slides.length > 1 && now >= this.due) {
      this.index = this.next()
      if (this.random) this.bag.shift()
      this.due = now + this.slides[this.index].durationMs
    }
    return this.index
  }
  /** 下一张的索引（不推进状态；用于切换前确认资源已就绪，防止闪现旧图） */
  peekNext(now: number): number {
    return this.slides.length > 1 && now >= this.due ? this.next() : this.index
  }
  /** Prepare the chosen next slide before its deadline without consuming it. */
  upcomingIndex(): number { return this.slides.length > 1 ? this.next() : this.index }
  bookmark(now: number): CarouselBookmark {
    // Hiding must not advance to an unseen/unloaded image.
    return { path: this.slides[this.index]?.path ?? '', remainingMs: Math.max(1, this.due - now),
      ...(this.random ? {random:true, remainingPaths:this.bag.map(i => this.slides[i].path)} : {}) }
  }
}
