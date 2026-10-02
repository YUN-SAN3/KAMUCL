import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import yauzl from 'yauzl'
import { hashFile, safePath } from './backupStore'
import { waitIfTaskPaused } from './tasks'
import type { RecordingKind } from '../../shared/recordings'

/** Read ZIP directory and small metadata only; never unpack world data into memory. */
export function validateRecording(file: string, kind: RecordingKind): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(new Error('录像压缩包损坏或尚未保存完成'))
      let settled = false, count = 0, metadata: Record<string, unknown> | undefined
      const names = new Set<string>()
      const end = (e?: Error) => { if (settled) return; settled = true; zip.close(); e ? reject(e) : resolve() }
      zip.on('error', e => end(e))
      zip.on('entry', entry => {
        if (++count > 100000) return end(new Error('录像条目过多'))
        names.add(entry.fileName)
        const metaName = kind === 'replaymod' ? 'metaData.json' : 'metadata.json'
        if (entry.fileName !== metaName) return zip.readEntry()
        if (metadata || entry.uncompressedSize > 1024 * 1024) return end(new Error('录像元数据无效或过大'))
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return end(e || new Error('无法读取录像元数据'))
          const chunks: Buffer[] = []; let size = 0
          stream.on('error', e => end(e))
          stream.on('data', (b: Buffer) => { size += b.length; if (size > 1024 * 1024) { stream.destroy(); end(new Error('录像元数据过大')) } else chunks.push(b) })
          stream.on('end', () => { try { metadata = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') throw new Error(); zip.readEntry() } catch { end(new Error('录像元数据损坏')) } })
        })
      })
      zip.on('end', () => {
        const chunks = metadata?.chunks
        const valid = kind === 'replaymod' ? !!metadata && names.has('recording.tmcpr')
          : !!metadata && typeof metadata.uuid === 'string' && !!chunks && typeof chunks === 'object' && !Array.isArray(chunks) && Object.keys(chunks).length > 0 && Object.keys(chunks).every(n => names.has(n))
        end(valid ? undefined : new Error('不是完整的 ' + (kind === 'replaymod' ? 'ReplayMod' : 'Flashback') + ' 录像'))
      })
      zip.readEntry()
    })
  })
}

/** Verify unchanged source and checksum before publishing; collision creates a distinct copy. */
export async function copyRecording(source: string, destination: string, signal?: AbortSignal, progress?: (bytes: number) => void): Promise<string> {
  const before = await fs.promises.lstat(source)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('录像不是普通文件')
  const root = await fs.promises.realpath(destination)
  if ((await fs.promises.lstat(destination)).isSymbolicLink()) throw new Error('目标目录不能是链接')
  const stage = path.join(root, '.kamucl-recording-' + crypto.randomUUID() + '.part')
  const digest = crypto.createHash('sha256'); let done = 0
  const gate = new Transform({ transform(chunk, _encoding, cb) { waitIfTaskPaused(signal).then(() => { digest.update(chunk); done += chunk.length; progress?.(done); cb(null, chunk) }, cb) } })
  try {
    await pipeline(fs.createReadStream(source), gate, fs.createWriteStream(stage, { flags: 'wx' }), { signal })
    const after = await fs.promises.lstat(source)
    const sha = digest.digest('hex')
    if (after.isSymbolicLink() || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs || sha !== await hashFile(source, signal) || sha !== await hashFile(stage, signal)) throw new Error('录像在复制期间发生变化，请停止录制后重试')
    signal?.throwIfAborted()
    const parsed = path.parse(source)
    for (let i = 0; i < 10000; i++) {
      const name = parsed.name + (i ? ` (${i})` : '') + parsed.ext
      const dest = await safePath(root, name, true)
      if (path.resolve(dest) === path.resolve(source)) return source
      try { await fs.promises.copyFile(stage, dest, fs.constants.COPYFILE_EXCL); return dest }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
    }
    throw new Error('同名录像过多，请整理目标目录')
  } finally { await fs.promises.unlink(stage).catch(() => {}) }
}
