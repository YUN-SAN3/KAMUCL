import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { mapLaunchFiles, waitForPreparation, SharedPreparation } from '../src/main/core/launchPreparation'
import { invalidLaunchArtifact } from '../src/main/core/launchIntegrity'

test('Java preparation shares one destination in flight, isolates folders and allows failure retry', async () => {
  const shared = new SharedPreparation<string>()
  let calls = 0, release!: () => void
  const gate = new Promise<void>(r => { release = r })
  const work = async () => { calls++; await gate; throw Error('download interrupted') }
  const a = shared.run('folderA:21', work), b = shared.run('folderA:21', work)
  assert.equal(a, b)
  assert.equal(await shared.run('folderB:21', async () => 'other runtime'), 'other runtime')
  const rejected = assert.rejects(a, /interrupted/)
  release(); await rejected
  assert.equal(calls, 1)
  assert.equal(await shared.run('folderA:21', async () => 'retry works'), 'retry works')
})

test('launch preparation overlaps independent work and drains failures before allowing retry', async () => {
  const events: string[] = []
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  let settled = false
  const result = waitForPreparation([
    async () => { events.push('files'); await gate; events.push('files done'); return 1 },
    async () => { events.push('account'); throw Error('account expired') },
    async () => { events.push('java'); return 'java' }
  ]).catch(error => { settled = true; return error })
  await new Promise<void>(r => setImmediate(r))
  assert.deepEqual(events, ['files', 'account', 'java'])
  assert.equal(settled, false)
  release()
  assert.match((await result).message, /account expired/)
  assert.equal(events.at(-1), 'files done')
})

test('bounded launch verification preserves order, caps workers and drains I/O on failure', async () => {
  let active = 0, peak = 0
  const result = await mapLaunchFiles([0, 1, 2, 3, 4, 5], async item => {
    peak = Math.max(peak, ++active)
    await new Promise<void>(r => setImmediate(r)); active--; return item * 2
  }, 3)
  assert.deepEqual(result, [0, 2, 4, 6, 8, 10]); assert.equal(peak, 3)
  await assert.rejects(mapLaunchFiles([0, 1, 2, 3, 4, 5], async item => {
    active++
    try { if (item === 0) throw Error('read failed'); await new Promise<void>(r => setImmediate(r)) }
    finally { active-- }
  }), /read failed/)
  assert.equal(active, 0)
  assert.deepEqual(await mapLaunchFiles([], async () => 1), [])
})

test('concurrent checks still detect missing, truncated and same-size corrupt libraries on every launch', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launch integrity 中文-'))
  try {
    const bytes = crypto.randomBytes(65536), sha1 = crypto.createHash('sha1').update(bytes).digest('hex')
    const files = Array.from({ length: 12 }, (_, i) => ({ dest: path.join(dir, `${i}.jar`), sha1, size: bytes.length }))
    files.forEach(file => fs.writeFileSync(file.dest, bytes))
    assert((await mapLaunchFiles(files, invalidLaunchArtifact)).every(result => result === null))
    fs.writeFileSync(files[3].dest, Buffer.alloc(bytes.length))
    fs.writeFileSync(files[6].dest, bytes.subarray(0, 4))
    fs.unlinkSync(files[9].dest)
    const result = await mapLaunchFiles(files, invalidLaunchArtifact)
    assert.deepEqual(result.flatMap((r, i) => r ? [i] : []), [3, 6, 9])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
