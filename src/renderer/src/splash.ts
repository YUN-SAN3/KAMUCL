import faceUrl from './assets/splash-face.png'
import { makeBootGlass, advanceBootGlass, glassPosition, canAssembleBoot, GLASS_FLOAT_MIN_MS, CONVERGE_DURATION, ASSEMBLED_HOLD_MS, BOOT_FRAME_MS, type BootState, type GlassPoint } from '@shared/startup'
import './splash.css'

const bridge = window.kamuclSplash
const canvas = document.querySelector<HTMLCanvasElement>('#glass')!
const ctx = canvas.getContext('2d', { alpha: true })!
const caption = document.querySelector<HTMLSpanElement>('#stage')!
const face = new Image()
let state: BootState = { completed: [], ready: false }, pointer: GlassPoint | null = null
let geometry = makeBootGlass(innerWidth, innerHeight)
let start = 0, convergence: number | null = null, raf = 0, assembled = false, lastFrame = 0
let nextFrame = 0
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const labels = ['读取配置', '加载账户', '扫描游戏实例', '加载首页图片、Java 与皮肤', '准备首帧']
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2)
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false
  geometry = makeBootGlass(innerWidth, innerHeight)
  convergence = null
}
const offPointer = bridge.onPointer(next => { pointer = next })
const offState = bridge.onState(next => { state = next; caption.textContent = state.ready ? '准备就绪' : `${labels[Math.min(4, state.completed.length)]}…` })
const offReveal = bridge.onReveal(() => {
  document.body.classList.add('leaving')
  document.body.addEventListener('transitionend', () => bridge.finished(), { once: true })
})
function frame(now: number) {
  if (now + .5 < nextFrame) { raf = requestAnimationFrame(frame); return }
  if (!nextFrame) nextFrame = now
  nextFrame += BOOT_FRAME_MS
  if (nextFrame <= now) nextFrame = now + BOOT_FRAME_MS
  if (!start) start = now
  const elapsed = now - start, delta = lastFrame ? now - lastFrame : BOOT_FRAME_MS
  lastFrame = now
  if (canAssembleBoot(state) && convergence === null && (reduced || elapsed >= GLASS_FLOAT_MIN_MS)) convergence = elapsed
  if (convergence === null && !reduced) advanceBootGlass(geometry.shards, elapsed, delta, pointer)
  ctx.clearRect(0, 0, innerWidth, innerHeight)
  const complete = reduced || (convergence !== null && elapsed - convergence >= CONVERGE_DURATION)
  if (complete) ctx.drawImage(face, geometry.left, geometry.top, geometry.board, geometry.board)
  else for (const shard of geometry.shards) {
    const p = glassPosition(shard, elapsed, convergence), glass = 1 - p.progress
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rotation); ctx.scale(p.scale, p.scale)
    const polygon = new Path2D()
    shard.vertices.forEach((v, i) => i ? polygon.lineTo(v.x, v.y) : polygon.moveTo(v.x, v.y)); polygon.closePath()
    ctx.save(); ctx.clip(polygon); ctx.globalAlpha = .12 + .88 * p.progress
    ctx.drawImage(face, -shard.sourceX, -shard.sourceY, geometry.board, geometry.board); ctx.restore()
    ctx.globalAlpha = glass
    const tint = ctx.createLinearGradient(-28, -30, 32, 35)
    tint.addColorStop(0, '#effaff80'); tint.addColorStop(.40, '#badfff20'); tint.addColorStop(.52, '#ffffff58'); tint.addColorStop(1, '#bcb0fa28')
    ctx.fillStyle = tint; ctx.fill(polygon)
    ctx.strokeStyle = '#25334945'; ctx.lineWidth = 2.4; ctx.stroke(polygon)
    ctx.strokeStyle = '#eaf7ffb8'; ctx.lineWidth = .85; ctx.stroke(polygon)
    // One bright bevel catches light as the shard slowly turns.
    const [a, b] = shard.vertices
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
    ctx.strokeStyle = `rgba(255,255,255,${.55 + Math.sin(elapsed / 1100 + shard.phase) * .25})`; ctx.lineWidth = 1.4; ctx.stroke()
    ctx.restore()
  }
  if (!assembled && state.ready && convergence !== null && (reduced || elapsed - convergence >= CONVERGE_DURATION + ASSEMBLED_HOLD_MS)) {
    assembled = true
    raf = requestAnimationFrame(() => bridge.assembled())
  } else if (!assembled) raf = requestAnimationFrame(frame)
}
face.onload = () => { resize(); raf = requestAnimationFrame(frame); bridge.ready() }
face.onerror = () => bridge.failed('启动头像资源无法加载')
face.src = faceUrl
window.addEventListener('resize', resize)
window.addEventListener('error', () => bridge.failed('启动动画渲染失败'))
window.addEventListener('unload', () => { cancelAnimationFrame(raf); offPointer(); offState(); offReveal(); window.removeEventListener('resize', resize) })
