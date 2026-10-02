import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnGameProcess, type GameProcessHandle } from '../src/main/core/gracefulClose'

test('idle game plus concurrent mod-discovery output cannot exhaust Windows I/O workers', { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL 日志并发 '))
  const owned: GameProcessHandle[] = []
  const closes: Promise<unknown>[] = []
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const start = async (script: string) => {
    const p = await spawnGameProcess(process.execPath, ['-e', script], { cwd: root })
    owned.push(p)
    const closed = new Promise<number | null>(resolve => p.once('close', resolve))
    closes.push(closed)
    return { p, closed }
  }
  try {
    // An existing quiet game must not monopolize a thread for each empty pipe
    // and a third thread waiting for its eventual exit.
    const quiet = await start('setTimeout(() => {}, 60000)')
    quiet.p.stdout?.on('data', () => {})
    quiet.p.stderr?.on('data', () => {})
    const fixture = '[main/INFO] [loading.moddiscovery.ModDiscoverer/SCAN]: Found mod file "蜜蜂方块.jar"\n'
    const block = Buffer.from(fixture.repeat(128))
    const copies = 160
    const expected = createHash('sha256').update(Buffer.concat(Array(copies).fill(block))).digest('hex')
    const work = async () => {
      const writers = await Promise.all([0, 1].map(async () => {
        const { p, closed } = await start(`const fs=require('node:fs'); const b=Buffer.from(${JSON.stringify(block.toString('base64'))},'base64'); for(let i=0;i<${copies};i++){fs.writeSync(1,b);fs.writeSync(2,b)};`)
        const out = createHash('sha256'), err = createHash('sha256')
        p.stdout?.on('data', b => out.update(b))
        p.stderr?.on('data', b => err.update(b))
        return { closed, out, err }
      }))
      // File operations share the same worker pool as the old blocking FFI calls.
      await fs.promises.writeFile(path.join(root, 'responsive.txt'), 'responsive')
      assert.equal(await fs.promises.readFile(path.join(root, 'responsive.txt'), 'utf8'), 'responsive')
      for (const writer of writers) {
        assert.equal(await writer.closed, 0)
        assert.equal(writer.out.digest('hex'), expected)
        assert.equal(writer.err.digest('hex'), expected)
      }
      assert.equal(quiet.p.exitCode, null, 'quiet game must remain alive')
    }
    await Promise.race([work(), new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => reject(new Error('Game log pipes or file I/O stalled')), 15000)
    })])
  } finally {
    clearTimeout(watchdog)
    // Only children created by this test, never a user's game.
    for (const p of owned) if (p.exitCode === null) p.kill()
    await Promise.all(closes)
    fs.rmSync(root, { recursive: true, force: true })
  }
})
