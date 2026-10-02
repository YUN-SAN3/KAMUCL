import assert from 'node:assert/strict'
import test from 'node:test'
import { StartupGate, makeBootGlass, glassPosition, advanceBootGlass, canAssembleBoot, CONVERGE_DURATION } from '../src/shared/startup'
import { beginBootTask, waitForBootTasks } from '../src/renderer/src/bootTasks'

test('startup reveal requires actual renderer initialization, a painted frame and assembled avatar in any arrival order', () => {
  const gate = new StartupGate()
  gate.assembled = true
  assert(!gate.canReveal)
  gate.painted = true
  assert(!gate.canReveal)
  gate.rendererReady = true
  assert(gate.canReveal)
  const slow = new StartupGate()
  slow.rendererReady = true
  assert(!slow.state.ready)
  slow.painted = true
  assert(slow.state.ready)
  assert(!slow.canReveal)
  slow.assembled = true
  assert(slow.canReveal)
})

test('glass triangles tile the full avatar and settle exactly on every display size', () => {
  for (const [width, height] of [[1280, 720], [1707, 960], [2560, 1440], [3840, 2160]]) {
    const geometry = makeBootGlass(width, height)
    assert.equal(geometry.shards.length, 72)
    let area = 0
    for (const shard of geometry.shards) {
      const [a, b, c] = shard.vertices
      const triangle = ((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))/2
      assert(triangle > 0); area += triangle
      for (const point of shard.vertices) {
        assert(point.x+shard.sourceX >= -1e-8 && point.x+shard.sourceX <= geometry.board+1e-8)
        assert(point.y+shard.sourceY >= -1e-8 && point.y+shard.sourceY <= geometry.board+1e-8)
      }
      const floating = glassPosition(shard, 60000, null)
      assert(Object.values(floating).every(Number.isFinite))
      const final = glassPosition(shard, 2000+CONVERGE_DURATION, 2000)
      assert.equal(final.x, shard.targetX); assert.equal(final.y, shard.targetY)
      assert.equal(final.rotation, 0); assert.equal(final.scale, 1); assert.equal(final.progress, 1)
    }
    assert(Math.abs(area-geometry.board**2)<1e-7, 'portrait must have neither missing nor overlapping area')
  }
})

test('cursor repels only nearby glass, motion stays bounded, and removed cursor releases the spring', () => {
  const geometry = makeBootGlass(1280,720), near = geometry.shards[0]
  const point = glassPosition(near, 1500, null)
  const far = geometry.shards.find(s => Math.hypot(glassPosition(s,1500,null).x-point.x,glassPosition(s,1500,null).y-point.y)>300)!
  assert(far)
  for(let i=0;i<120;i++) advanceBootGlass(geometry.shards,1500,1000/60,point)
  assert(Math.hypot(near.offsetX,near.offsetY)>25)
  assert.equal(far.offsetX,0); assert.equal(far.offsetY,0)
  for(let i=0;i<10000;i++) advanceBootGlass(geometry.shards,1500,1000,point)
  assert(geometry.shards.every(s=>Math.abs(s.offsetX)<=180&&Math.abs(s.offsetY)<=180))
  for(let i=0;i<600;i++) advanceBootGlass(geometry.shards,1500,1000/60,null)
  assert(Math.hypot(near.offsetX,near.offsetY)<.01)
})

test('glass assembles from its repelled position without a jump and only after real late-stage progress', () => {
  const geometry = makeBootGlass(1280,720), shard = geometry.shards[0]
  const pointer = glassPosition(shard,2000,null)
  for(let i=0;i<60;i++) advanceBootGlass(geometry.shards,2000,1000/60,pointer)
  const before = glassPosition(shard,2000,null), start = glassPosition(shard,2000,2000)
  assert.deepEqual(start,before)
  const final = glassPosition(shard,2000+CONVERGE_DURATION,2000)
  assert.equal(final.x,shard.targetX); assert.equal(final.y,shard.targetY)
  assert(!canAssembleBoot({completed:['settings','accounts','instances'],ready:false}))
  assert(canAssembleBoot({completed:['settings','accounts','instances','assets'],ready:false}))
  assert(canAssembleBoot({completed:[],ready:true}))
})

test('startup resource barrier also drains resources registered during an earlier async load', async () => {
  const first = beginBootTask()
  let settled = false
  const wait = waitForBootTasks().then(() => { settled = true })
  const second = beginBootTask()
  first()
  await Promise.resolve()
  assert(!settled)
  second()
  await wait
  assert(settled)
  second() // completion is idempotent
})
