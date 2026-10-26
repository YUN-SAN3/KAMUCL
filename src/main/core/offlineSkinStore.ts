import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import type { SkinHistoryEntry, SkinHistoryItem, SkinVariant } from '../../shared/types'

const MAX_PNG_BYTES = 200_000
const HISTORY_LIMIT = 30
const SHA256 = /^[a-f0-9]{64}$/
interface Manifest { schema: 1; accountId: string; selected: { hash: string; variant: SkinVariant } | null; history: SkinHistoryItem[] }
export interface OfflineSkinSnapshot { filePath: string; sha256: string; variant: SkinVariant }
type Storage = Pick<typeof fs, 'mkdir' | 'readFile' | 'writeFile' | 'rename' | 'rm' | 'stat'>

/** PNG dimensions are bounded before decoding; the decoder must validate the actual pixels. */
export function validateOfflineSkinBytes(bytes: Buffer): void {
  if (bytes.length > MAX_PNG_BYTES) throw new Error('皮肤 PNG 文件过大，请使用标准 64×64 PNG')
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      bytes.readUInt32BE(16) !== 64 || bytes.readUInt32BE(20) !== 64) throw new Error('皮肤必须是 64×64 的 PNG 图片')
  let offset = 8, image = false, ended = false
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8)
    if (length > MAX_PNG_BYTES || offset + length + 12 > bytes.length || kind === 'acTL') throw new Error('皮肤 PNG 损坏或不是静态图片')
    if (kind === 'IDAT') image = true
    offset += length + 12
    if (kind === 'IEND') { ended = length === 0 && offset === bytes.length; break }
  }
  if (!image || !ended) throw new Error('皮肤 PNG 图片不完整')
}

/** Private appearance manifests are account scoped. Immutable PNGs survive resets and running launches. */
export class OfflineSkinStore {
  private writes = new Map<string, Promise<unknown>>()
  constructor(private directory: () => string, private decode: (bytes: Buffer) => void | Promise<void>, private storage: Storage = fs) {}
  private manifestFile(accountId: string) { return path.join(this.directory(), 'accounts', crypto.createHash('sha256').update(accountId).digest('hex') + '.json') }
  private textureFile(hash: string) { if (!SHA256.test(hash)) throw new Error('无效的本地皮肤记录'); return path.join(this.directory(), 'textures', hash + '.png') }
  private async read(accountId: string): Promise<Manifest> {
    const file = this.manifestFile(accountId)
    try {
      if ((await this.storage.stat(file)).size > 100_000) throw new Error('本地皮肤记录过大')
      const raw = JSON.parse(await this.storage.readFile(file, 'utf8')) as Manifest
      if (raw.schema !== 1 || raw.accountId !== accountId || !Array.isArray(raw.history) ||
          raw.selected && (!SHA256.test(raw.selected.hash) || !['classic', 'slim'].includes(raw.selected.variant))) throw new Error('本地皮肤记录损坏')
      const history = raw.history.filter(item => item && SHA256.test(item.id) && item.hash === item.id &&
        ['classic', 'slim'].includes(item.variant) && typeof item.time === 'number').slice(0, HISTORY_LIMIT)
      return { schema: 1, accountId, selected: raw.selected || null, history }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schema: 1, accountId, selected: null, history: [] }
      throw error
    }
  }
  private async atomic(file: string, bytes: string | Buffer): Promise<void> {
    await this.storage.mkdir(path.dirname(file), { recursive: true })
    const temporary = file + '.' + crypto.randomUUID() + '.tmp'
    try { await this.storage.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await this.storage.rename(temporary, file) }
    finally { await this.storage.rm(temporary, { force: true }).catch(() => undefined) }
  }
  private mutate<T>(accountId: string, work: (manifest: Manifest) => Promise<T>): Promise<T> {
    const previous = this.writes.get(accountId) || Promise.resolve()
    const pending = previous.catch(() => undefined).then(async () => work(await this.read(accountId)))
    this.writes.set(accountId, pending)
    void pending.finally(() => { if (this.writes.get(accountId) === pending) this.writes.delete(accountId) }).catch(() => undefined)
    return pending
  }
  private async pixels(hash: string): Promise<Buffer> {
    const file = this.textureFile(hash), stat = await this.storage.stat(file)
    if (!stat.isFile() || stat.size > MAX_PNG_BYTES) throw new Error('本地皮肤文件无效')
    const bytes = await this.storage.readFile(file)
    validateOfflineSkinBytes(bytes); await this.decode(bytes)
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('本地皮肤文件校验失败')
    return bytes
  }
  async readFile(file: string): Promise<Buffer> {
    const stat = await this.storage.stat(file).catch(() => { throw new Error('皮肤文件不存在') })
    if (!stat.isFile() || stat.size > MAX_PNG_BYTES) throw new Error('皮肤文件无效或过大')
    const bytes = await this.storage.readFile(file)
    validateOfflineSkinBytes(bytes); await this.decode(bytes)
    return bytes
  }
  async apply(accountId: string, bytes: Buffer, variant: SkinVariant, name?: string): Promise<void> {
    if (!['classic', 'slim'].includes(variant)) throw new Error('无效的皮肤模型')
    // Own the bytes before an asynchronous decode so later callers cannot mutate a pending write.
    bytes = Buffer.from(bytes); validateOfflineSkinBytes(bytes); await this.decode(bytes)
    const hash = crypto.createHash('sha256').update(bytes).digest('hex')
    await this.mutate(accountId, async manifest => {
      const file = this.textureFile(hash)
      await this.storage.mkdir(path.dirname(file), { recursive: true })
      try { await this.storage.stat(file); await this.pixels(hash) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await this.atomic(file, bytes) }
      const old = manifest.history.find(item => item.hash === hash)
      manifest.selected = { hash, variant }
      manifest.history = [{ id: hash, hash, variant, time: Date.now(), name: old?.name || name?.slice(0, 80) },
        ...manifest.history.filter(item => item.hash !== hash)].slice(0, HISTORY_LIMIT)
      await this.atomic(this.manifestFile(accountId), JSON.stringify(manifest, null, 2))
    })
  }
  async snapshot(accountId: string): Promise<OfflineSkinSnapshot | null> {
    const selected = (await this.read(accountId)).selected
    if (!selected) return null
    await this.pixels(selected.hash)
    return { filePath: this.textureFile(selected.hash), sha256: selected.hash, variant: selected.variant }
  }
  async profileSkin(accountId: string) {
    const selected = (await this.read(accountId)).selected
    if (!selected) return null
    const bytes = await this.pixels(selected.hash)
    return { variant: selected.variant, url: '', state: 'ACTIVE', dataUrl: 'data:image/png;base64,' + bytes.toString('base64') }
  }
  async history(accountId: string): Promise<SkinHistoryEntry[]> {
    const out: SkinHistoryEntry[] = []
    for (const item of (await this.read(accountId)).history) {
      try { const bytes = await this.pixels(item.id); out.push({ ...item, dataUrl: 'data:image/png;base64,' + bytes.toString('base64') }) }
      catch { /* Missing or corrupt textures must never enter the preview or a new launch. */ }
    }
    return out
  }
  async restore(accountId: string, id: string): Promise<void> {
    const item = (await this.read(accountId)).history.find(item => item.id === id)
    if (!item) throw new Error('历史皮肤不存在')
    await this.apply(accountId, await this.pixels(item.id), item.variant, item.name)
  }
  async reset(accountId: string): Promise<void> {
    await this.mutate(accountId, async manifest => { manifest.selected = null; await this.atomic(this.manifestFile(accountId), JSON.stringify(manifest, null, 2)) })
  }
  async delete(accountId: string, id: string): Promise<void> {
    await this.mutate(accountId, async manifest => {
      if (!manifest.history.some(item => item.id === id)) throw new Error('历史皮肤不存在')
      manifest.history = manifest.history.filter(item => item.id !== id)
      await this.atomic(this.manifestFile(accountId), JSON.stringify(manifest, null, 2))
    })
  }
  async rename(accountId: string, id: string, name: string): Promise<void> {
    await this.mutate(accountId, async manifest => {
      const item = manifest.history.find(item => item.id === id)
      if (!item) throw new Error('历史皮肤不存在')
      item.name = String(name).trim().slice(0, 80) || undefined
      await this.atomic(this.manifestFile(accountId), JSON.stringify(manifest, null, 2))
    })
  }
}
