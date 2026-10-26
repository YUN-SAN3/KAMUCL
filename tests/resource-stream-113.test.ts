import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { StreamPackZip, writePackEntry } from '../src/main/core/streamPackZip'
import { fileHash } from '../src/main/core/fileHash'
import { trimSelfPowerShellScript } from '../src/main/core/memTrim'
import { CarouselPlayback } from '../src/shared/carouselPlayback'
import { fileJobKey, withFileJob } from '../src/main/core/fileJobs'

test('streamed ZIP preserves Chinese, spaces, §, entry bytes, SHA and output CRC', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-stream113-'))
  const file = path.join(root, '中文 § 包.zip'), output = path.join(root, 'out.jar')
  const bytes = crypto.randomBytes(3 * 1024 * 1024), zip = new AdmZip()
  zip.addFile('overrides/mods/中文 § 测试.jar', bytes); zip.addFile('empty', Buffer.alloc(0)); zip.writeZip(file)
  const archive = await StreamPackZip.open(file, 10)
  try {
    const entry = archive.getEntry('overrides/mods/中文 § 测试.jar')!
    assert.equal(entry.header.size, bytes.length)
    assert.deepEqual(await entry.getData(), bytes)
    await writePackEntry(entry, output)
    let created = false
    await assert.rejects(writePackEntry(entry, output, undefined, { exclusive: true, onCreated: () => { created = true } }), /EEXIST/)
    assert.equal(created, false)
    assert.deepEqual(fs.readFileSync(output), bytes)
    for (const algorithm of ['sha1', 'sha256', 'sha512']) {
      const expected = crypto.createHash(algorithm).update(bytes).digest('hex')
      assert.equal(await fileHash(output, algorithm), expected)
      assert.equal(await entry.digest!(algorithm), expected)
    }
    assert.deepEqual(await archive.getEntry('empty')!.getData(), Buffer.alloc(0))
  } finally { await archive.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('streamed ZIP rejects corrupt CRC, bounded entries, cancellation and use after close', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-stream113-failure-')), file = path.join(root, 'pack.zip')
  const zip = new AdmZip(); zip.addFile('data', Buffer.from('original payload')); zip.writeZip(file)
  let archive: StreamPackZip | undefined
  try {
    await assert.rejects(StreamPackZip.open(file, 0), /安全上限/)
    const cancelled = new AbortController(); cancelled.abort()
    await assert.rejects(StreamPackZip.open(file, 10, cancelled.signal), /abort/i)
    archive = await StreamPackZip.open(file, 10)
    await assert.rejects(writePackEntry(archive.getEntry('data')!, path.join(root, 'cancelled'), cancelled.signal), /abort/i)
    assert(!fs.existsSync(path.join(root, 'cancelled')))
    const entry = archive.getEntry('data')!; await archive.close()
    await assert.rejects(entry.getData(), /已关闭/)
    const bytes = fs.readFileSync(file), central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    assert(central >= 0); bytes.writeUInt32LE(0, central + 16); fs.writeFileSync(file, bytes)
    archive = await StreamPackZip.open(file, 10)
    await assert.rejects(archive.getEntry('data')!.getData(), /校验失败/)
    await assert.rejects(archive.getEntry('data')!.digest!('sha1'), /校验失败/)
    await assert.rejects(writePackEntry(archive.getEntry('data')!, path.join(root, 'corrupt')), /校验失败/)
    await archive.close()
    // Reject an understated length during inflation, before a forged entry can
    // write arbitrarily beyond the declared extraction budget.
    const understated = new AdmZip(); understated.addFile('too-large', Buffer.alloc(2 * 1024 * 1024, 1)); understated.writeZip(file)
    const forged = fs.readFileSync(file), directory = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    forged.writeUInt32LE(1, directory + 24); fs.writeFileSync(file, forged)
    archive = await StreamPackZip.open(file, 10)
    await assert.rejects(writePackEntry(archive.getEntry('too-large')!, path.join(root, 'understated')), /大小超过声明值/)
    assert(fs.statSync(path.join(root, 'understated')).size <= 1)
  } finally { await archive?.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('streamed metadata and payload remain bound to the same open source when its pathname is replaced', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-stream113-replaced-')), file = path.join(root, 'pack.zip')
  const original = crypto.randomBytes(2 * 1024 * 1024), replacement = crypto.randomBytes(original.length)
  const zip = new AdmZip(); zip.addFile('data', original); zip.writeZip(file)
  const archive = await StreamPackZip.open(file, 10)
  try {
    fs.renameSync(file, path.join(root, 'original.zip'))
    const other = new AdmZip(); other.addFile('data', replacement); other.writeZip(file)
    assert.deepEqual(await archive.getEntry('data')!.getData(), original)
    await writePackEntry(archive.getEntry('data')!, path.join(root, 'result'))
    assert.deepEqual(fs.readFileSync(path.join(root, 'result')), original)
  } finally { await archive.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('archive metadata preserves native JSON and UTF8 semantics without a new document limit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-stream113-json-')), file = path.join(root, 'pack.zip')
  const value = { name: '中文 § 🐷', description: crypto.randomBytes(1024 * 1024).toString('hex'), files: [] }
  const zip = new AdmZip(); zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(value))); zip.writeZip(file)
  const archive = await StreamPackZip.open(file, 10)
  try {
    const entry = archive.getEntry('modrinth.index.json')!
    assert.deepEqual(JSON.parse((await entry.getData()).toString('utf8')), value)
  } finally { await archive.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('disposal drains accepted readers and outstanding positioned IO before closing their source FD', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-stream113-drain-')), file = path.join(root, 'pack.zip')
  const original = crypto.randomBytes(4 * 1024 * 1024), zip = new AdmZip()
  zip.addFile('data', original); zip.writeZip(file)
  const archive = await StreamPackZip.open(file, 10), started = Promise.withResolvers<void>()
  const createReadStream = fs.createReadStream
  let reader: fs.ReadStream | undefined
  fs.createReadStream = ((...args: Parameters<typeof fs.createReadStream>) => {
    const stream = createReadStream(...args)
    if (args[0] === file && typeof args[1] === 'object' && args[1]?.autoClose === false) {
      reader = stream
      const read = stream._read.bind(stream)
      stream._read = size => { setTimeout(() => read(size), 15) }
      started.resolve()
    }
    return stream
  }) as typeof fs.createReadStream
  try {
    const output = path.join(root, 'out'), accepted = writePackEntry(archive.getEntry('data')!, output)
    await started.promise
    let closed = false
    const disposed = archive.close().then(() => { closed = true })
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(closed, false, 'accepted stream still owns the original source')
    await assert.rejects(archive.getEntry('data')!.getData(), /已关闭/)
    await Promise.all([accepted, disposed])
    assert.equal(reader?.closed, true, 'real reader close precedes archive disposal')
    assert.deepEqual(fs.readFileSync(output), original)
  } finally {
    fs.createReadStream = createReadStream
    await archive.close(); fs.rmSync(root, { recursive: true, force: true })
  }
})

test('file streaming hash supports cancellation and missing files', async () => {
  const c = new AbortController(); c.abort()
  await assert.rejects(fileHash('missing', 'sha1', c.signal), /abort/i)
  await assert.rejects(fileHash('missing-file113'), /ENOENT/)
})

test('platform file locks canonicalize aliases without rewriting filenames or releasing an active writer on cancellation', { timeout: 15000 }, async () => {
  const firstPath = path.join(os.tmpdir(), 'kamucl-lock113', 'Caf\u00e9'), otherPath = process.platform === 'darwin'
    ? path.join(os.tmpdir(), 'kamucl-lock113', 'cafe\u0301') : process.platform === 'win32'
      ? firstPath.toLowerCase() : firstPath
  assert.equal(fileJobKey(firstPath), fileJobKey(otherPath))
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), actions: string[] = []
  const first = withFileJob(firstPath, undefined, async () => { actions.push('first'); started.resolve(); await release.promise })
  await started.promise
  const second = withFileJob(otherPath, undefined, async () => { actions.push('second') })
  const cancellation = new AbortController(), reason = new Error('cancel owned lock waiter')
  const waiting = withFileJob(otherPath, cancellation.signal, async () => { assert.fail('cancelled waiter must not execute') })
  cancellation.abort(reason); await assert.rejects(waiting, error => error === reason)
  const fourth = withFileJob(firstPath, undefined, async () => { actions.push('fourth') })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.deepEqual(actions, ['first'], 'cancelled waiter does not expose the live writer')
  } finally { release.resolve(); await Promise.all([first, second, fourth]) }
  assert.deepEqual(actions, ['first', 'second', 'fourth'])
})

test('PowerShell fallback opens only supplied launcher PID and reports native failure', () => {
  const script = trimSelfPowerShellScript(4711)
  assert(script.includes('OpenProcess(1280,$false,4711)'))
  assert(!script.includes('GetCurrentProcess'))
  assert(script.includes('finally{[Win32.KamuclTrim]::CloseHandle'))
  assert(script.includes('exit 1'))
  for (const pid of [0, -1, NaN, 1.5]) assert.throws(() => trimSelfPowerShellScript(pid))
})

test('early next-slide preparation preserves seeded random cycles, deadlines and bookmarks', () => {
  const slides = Array.from({ length: 27 }, (_, index) => ({ path: String(index), durationMs: 1000 + index }))
  const rng = () => { let seed = 17; return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) }
  const prepared = new CarouselPlayback(slides, 0, undefined, true, rng()), old = new CarouselPlayback(slides, 0, undefined, true, rng())
  let now = 0
  for (let n = 0; n < 270; n++) {
    const next = prepared.upcomingIndex()
    assert.equal(prepared.upcomingIndex(), next)
    assert.equal(prepared.tick(now + 1), old.index)
    now += slides[old.index].durationMs
    assert.equal(prepared.tick(now), old.tick(now))
    assert.deepEqual(prepared.bookmark(now), old.bookmark(now))
  }
})
