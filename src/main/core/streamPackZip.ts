import fs from 'node:fs'
import crypto from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { crc32, createInflateRaw } from 'node:zlib'
import yauzl, { type Entry, type ZipFile } from 'yauzl'

/** AdmZip fixtures and disk-backed production archives share metadata only. */
export interface PackEntry {
  entryName: string
  isDirectory: boolean
  attr: number
  header: { size: number; compressedSize: number }
  getData(): Buffer | Promise<Buffer>
  writeTo?(destination: string, signal?: AbortSignal, options?: { exclusive?: boolean; onCreated?: () => void }): Promise<void>
  digest?(algorithm: string, signal?: AbortSignal): Promise<string>
}
export interface PackZip {
  getEntries(): PackEntry[]
  getEntry(name: string): PackEntry | null
}

/** Keeps archive metadata in memory and streams production payloads. JSON
 * needs native text/object storage; getData remains a compatibility reader. */
export class StreamPackZip implements PackZip {
  private readonly entries: PackEntry[] = []
  private readonly names = new Map<string, PackEntry>()
  private closed = false
  private failure?: Error
  private opening = 0
  private streams = new Set<Transform>()
  private finish!: () => void
  private failFinish!: (error: Error) => void
  private finished = new Promise<void>((resolve, reject) => { this.finish = resolve; this.failFinish = reject })
  private constructor(private readonly zip: ZipFile, private readonly file: string, private readonly descriptor: number) {
    zip.on('error', error => {
      this.failure = error
      if (this.closed) this.failFinish(error)
    })
    zip.once('close', () => this.finish())
  }
  static async open(file: string, maximumEntries: number, signal?: AbortSignal): Promise<StreamPackZip> {
    signal?.throwIfAborted()
    const descriptor = await new Promise<number>((resolve, reject) => fs.open(file, 'r', (error, fd) => error ? reject(error) : resolve(fd)))
    let zip: ZipFile
    try {
      zip = await new Promise<ZipFile>((resolve, reject) => yauzl.fromFd(descriptor,
        { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true },
        (error, zip) => error ? reject(error) : resolve(zip!)))
    } catch (error) { fs.closeSync(descriptor); throw error }
    // Yauzl owns this descriptor until close; positioned payload streams borrow
    // the same source, so a replaced pathname cannot supply different bytes.
    const archive = new StreamPackZip(zip, file, descriptor)
    try {
      if (zip.entryCount > maximumEntries) throw new Error('整合包文件数量超过安全上限')
      await new Promise<void>((resolve, reject) => {
        const abort = () => finish(signal!.reason ?? new Error('已取消'))
        const finish = (error?: Error) => {
          zip.off('entry', entry); zip.off('end', end); zip.off('error', fail)
          signal?.removeEventListener('abort', abort)
          error ? reject(error) : resolve()
        }
        const fail = (error: Error) => finish(error)
        const end = () => finish()
        const entry = (raw: Entry) => {
          if (archive.entries.length >= maximumEntries) return finish(new Error('整合包文件数量超过安全上限'))
          const item: PackEntry = {
            entryName: raw.fileName, isDirectory: raw.fileName.endsWith('/'), attr: raw.externalFileAttributes,
            header: { size: raw.uncompressedSize, compressedSize: raw.compressedSize },
            getData: async () => {
              signal?.throwIfAborted()
              const chunks: Buffer[] = []
              const stream = await archive.read(raw)
              const abort = () => stream.destroy(signal!.reason ?? new Error('已取消'))
              signal?.addEventListener('abort', abort, { once: true })
              if (signal?.aborted) abort()
              try { for await (const chunk of stream) { signal?.throwIfAborted(); chunks.push(chunk as Buffer) } }
              finally { signal?.removeEventListener('abort', abort) }
              signal?.throwIfAborted()
              return Buffer.concat(chunks)
            },
            writeTo: async (destination, signal, options) => {
              signal?.throwIfAborted()
              const source = await archive.read(raw), output = fs.createWriteStream(destination, { highWaterMark: 1024 * 1024, flags: options?.exclusive ? 'wx' : 'w' })
              output.once('open', () => options?.onCreated?.())
              await pipeline(source, output, { signal })
            },
            digest: async (algorithm, signal) => {
              signal?.throwIfAborted()
              const hash = crypto.createHash(algorithm), stream = await archive.read(raw)
              const abort = () => stream.destroy(signal!.reason ?? new Error('已取消'))
              signal?.addEventListener('abort', abort, { once: true })
              if (signal?.aborted) abort()
              try { for await (const chunk of stream) { signal?.throwIfAborted(); hash.update(chunk) } }
              finally { signal?.removeEventListener('abort', abort) }
              return hash.digest('hex')
            }
          }
          archive.entries.push(item)
          // Preserve first-entry lookup. Duplicate extraction validation remains
          // with the destination planner, where aliases/case rules are known.
          if (!archive.names.has(item.entryName)) archive.names.set(item.entryName, item)
          zip.readEntry()
        }
        zip.on('entry', entry); zip.once('end', end); zip.once('error', fail)
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort(); else zip.readEntry()
      })
      return archive
    } catch (error) { await archive.close(); throw error }
  }
  private async read(entry: Entry): Promise<Transform> {
    if (this.closed) throw new Error('整合包已关闭')
    if (this.failure) throw this.failure
    if (entry.isEncrypted()) throw new Error('整合包条目已加密，无法读取：' + entry.fileName)
    if (![0, 8].includes(entry.compressionMethod)) throw new Error('整合包条目压缩格式不支持：' + entry.fileName)
    // Use the public header bounds validation, then bounded independent readers.
    // yauzl's shared default reader serializes 64 KiB IO across all entries;
    // 1 MiB streams retain a fixed budget and avoid thousands of tiny writes.
    this.opening++
    try {
    const { fileDataStart } = await this.zip.readLocalFileHeaderPromise(entry, { minimal: true })
    if (this.closed) throw new Error('整合包已关闭')
    const compressed = entry.compressedSize ? fs.createReadStream(this.file, {
      fd: this.descriptor, autoClose: false,
      // Explicit destroy closes a ReadStream's FD even with autoClose:false.
      // Its close hook only releases the borrowed reader; yauzl owns the FD.
      fs: { read: fs.read, close: (_descriptor, callback) => callback(null) },
      start: fileDataStart, end: fileDataStart + entry.compressedSize - 1, highWaterMark: 1024 * 1024
    }) : Readable.from([])
    const inflater = entry.compressionMethod === 8 ? createInflateRaw({ chunkSize: 1024 * 1024 }) : null
    const source = inflater ? compressed.pipe(inflater) : compressed
    compressed.once('error', (error: Error) => source.destroy(error))
    let bytes = 0, checksum = 0
    const checked = new Transform({ highWaterMark: 1024 * 1024,
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        if (bytes > entry.uncompressedSize) return callback(new Error('整合包条目大小超过声明值：' + entry.fileName))
        checksum = crc32(chunk, checksum); callback(null, chunk)
      },
      flush(callback) { callback(bytes !== entry.uncompressedSize || checksum !== entry.crc32 ? new Error('整合包条目校验失败：' + entry.fileName) : undefined) }
    })
    source.once('error', (error: Error) => checked.destroy(error))
    this.streams.add(checked)
    compressed.once('close', () => {
      // fs.ReadStream waits for outstanding positioned IO before closing.
      // A downstream Transform's close alone cannot release the borrowed FD.
      this.streams.delete(checked); this.finishIfIdle()
    })
    checked.once('close', () => {
      source.destroy(); compressed.destroy()
    })
    source.pipe(checked)
    return checked
    } finally { this.opening--; this.finishIfIdle() }
  }
  private finishIfIdle() { if (this.closed && !this.opening && !this.streams.size) this.zip.close() }
  getEntries() { return this.entries }
  getEntry(name: string) { return this.names.get(name) ?? null }
  close(): Promise<void> {
    this.closed = true
    // Already accepted readers finish on their original source. No new reader
    // can open; cancellation destroys its own pipeline. Disposal waits for the
    // real FD close before deleting any owned nested temporary archive.
    this.finishIfIdle()
    return this.finished
  }
}

export async function writePackEntry(entry: PackEntry, destination: string, signal?: AbortSignal, options?: { exclusive?: boolean; onCreated?: () => void }) {
  signal?.throwIfAborted()
  if (entry.writeTo) await entry.writeTo(destination, signal, options)
  else if (!options) await fs.promises.writeFile(destination, await entry.getData(), { signal })
  else {
    const data = await entry.getData()
    const file = await fs.promises.open(destination, options?.exclusive ? 'wx' : 'w')
    try { options?.onCreated?.(); await file.writeFile(data, { signal }) } finally { await file.close() }
  }
}
