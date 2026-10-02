export const BOOT_STAGES = ['settings', 'accounts', 'instances', 'assets', 'paint'] as const
export type BootStage = typeof BOOT_STAGES[number]
export interface BootState { completed: BootStage[]; ready: boolean }

/** Animation never substitutes for actual renderer/compositor readiness. */
export class StartupGate {
  readonly completed = new Set<BootStage>()
  painted = false
  rendererReady = false
  assembled = false
  get state(): BootState { return { completed: [...this.completed], ready: this.painted && this.rendererReady } }
  get canReveal(): boolean { return this.state.ready && this.assembled }
}

export const GLASS_FLOAT_MIN_MS = 900
export const CONVERGE_DURATION = 1400
export const ASSEMBLED_HOLD_MS = 2000
export const BOOT_FRAME_MS = 1000 / 60
export const GLASS_POINTER_RADIUS = 140
export interface GlassPoint { x: number; y: number }
export interface GlassPose extends GlassPoint { rotation: number; scale: number; progress: number }
export interface GlassShard {
  vertices: GlassPoint[]; sourceX: number; sourceY: number; targetX: number; targetY: number
  x: number; y: number; phase: number; spin: number; delay: number
  offsetX: number; offsetY: number; velocityX: number; velocityY: number; from?: GlassPose
}
export interface GlassGeometry { board: number; left: number; top: number; shards: GlassShard[] }
const clamp = (n: number) => Math.max(0, Math.min(1, n))
const smooth = (n: number) => { const t = clamp(n); return t * t * t * (t * (t * 6 - 15) + 10) }

export function canAssembleBoot(state: BootState): boolean {
  return state.ready || ['settings', 'accounts', 'instances', 'assets'].every(stage => state.completed.includes(stage as BootStage))
}

/** Jittered triangulation tiles the exact portrait; no rectangular pixel tiles. */
export function makeBootGlass(width: number, height: number): GlassGeometry {
  let seed = 1041
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  const board = Math.max(80, Math.floor(Math.min(224, width * .26, height * .32)))
  const left = Math.round((width - board) / 2), top = Math.round((height - board) / 2), cell = board / 6
  const points: GlassPoint[] = []
  for (let row = 0; row <= 6; row++) for (let col = 0; col <= 6; col++) points.push({
    x: (col + (col > 0 && col < 6 ? (random() - .5) * .65 : 0)) * cell,
    y: (row + (row > 0 && row < 6 ? (random() - .5) * .65 : 0)) * cell
  })
  const shards: GlassShard[] = []
  const add = (vertices: GlassPoint[]) => {
    const sourceX = vertices.reduce((n, p) => n + p.x, 0) / 3, sourceY = vertices.reduce((n, p) => n + p.y, 0) / 3
    shards.push({ vertices: vertices.map(p => ({ x: p.x - sourceX, y: p.y - sourceY })), sourceX, sourceY,
      targetX: left + sourceX, targetY: top + sourceY,
      x: width * (.10 + random() * .80), y: height * (.14 + random() * .62),
      phase: random() * Math.PI * 2, spin: (random() - .5) * 2.4, delay: random() * 180,
      offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0 })
  }
  for (let row = 0; row < 6; row++) for (let col = 0; col < 6; col++) {
    const a = points[row * 7 + col], b = points[row * 7 + col + 1], c = points[(row + 1) * 7 + col], d = points[(row + 1) * 7 + col + 1]
    if ((row + col) % 2) { add([a, b, c]); add([b, d, c]) } else { add([a, b, d]); add([a, d, c]) }
  }
  return { board, left, top, shards }
}

function floating(shard: GlassShard, elapsed: number): GlassPose {
  return { x: shard.x + Math.sin(elapsed / 1500 + shard.phase) * 14 + shard.offsetX,
    y: shard.y + Math.cos(elapsed / 1800 + shard.phase) * 11 + shard.offsetY,
    rotation: shard.spin + Math.sin(elapsed / 2100 + shard.phase) * .22,
    scale: 1.06 + Math.sin(elapsed / 1900 + shard.phase) * .12, progress: 0 }
}

/** Bounded spring motion. Cursor sampling is independent of click-through windows. */
export function advanceBootGlass(shards: GlassShard[], elapsed: number, deltaMs: number, pointer: GlassPoint | null): void {
  const dt = Math.min(32, Math.max(0, deltaMs)) / 1000
  for (const shard of shards) {
    const p = floating(shard, elapsed)
    let fx = 0, fy = 0
    if (pointer) {
      let dx = p.x - pointer.x, dy = p.y - pointer.y
      const distance = Math.hypot(dx, dy)
      if (distance < GLASS_POINTER_RADIUS) {
        if (distance < 1) { dx = Math.cos(shard.phase); dy = Math.sin(shard.phase) }
        const force = 2400 * (1 - distance / GLASS_POINTER_RADIUS) ** 2 / Math.max(1, distance)
        fx = dx * force; fy = dy * force
      }
    }
    const drag = Math.exp(-5 * dt)
    shard.velocityX = (shard.velocityX + (fx - shard.offsetX * 8) * dt) * drag
    shard.velocityY = (shard.velocityY + (fy - shard.offsetY * 8) * dt) * drag
    shard.offsetX = Math.max(-180, Math.min(180, shard.offsetX + shard.velocityX * dt))
    shard.offsetY = Math.max(-180, Math.min(180, shard.offsetY + shard.velocityY * dt))
  }
}

/** Snapshot the displaced pose so assembly cannot jump when the pointer is nearby. */
export function glassPosition(shard: GlassShard, elapsed: number, convergeAt: number | null): GlassPose {
  if (convergeAt === null) return floating(shard, elapsed)
  shard.from ??= floating(shard, convergeAt)
  const progress = smooth((elapsed - convergeAt - shard.delay) / (CONVERGE_DURATION - 180)), from = shard.from
  if (progress === 1) return { x: shard.targetX, y: shard.targetY, rotation: 0, scale: 1, progress: 1 }
  return { x: from.x + (shard.targetX - from.x) * progress, y: from.y + (shard.targetY - from.y) * progress,
    rotation: from.rotation * (1 - progress), scale: from.scale + (1 - from.scale) * progress, progress }
}
