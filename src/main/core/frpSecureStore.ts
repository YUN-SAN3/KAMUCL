import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { protectedCredentialStorage, type CredentialStorage } from './credentialProtection'
import type { FrpConfig } from './frp'
import type { FrpRegistry, TunnelRecord } from './frpManager'

export interface FrpCipherStorage extends CredentialStorage {
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
export const frpCredentialIdentity = (key: string, id: string) => createHash('sha256').update(key.trim() + '\0' + id).digest('hex')
const LOCKED = '系统安全存储已锁定或凭据无法解密；密文和隧道记录已保留，请解锁系统密钥服务后重试。'
const parse = (bytes: string) => { try { return JSON.parse(bytes) } catch { throw new Error('隧道配置损坏，原文件已保留。') } }
const sameBag = (a: KeyBag, b: KeyBag) => a.accessKey === b.accessKey && Object.keys(a.keys).length === Object.keys(b.keys).length && Object.keys(a.keys).every(id => a.keys[id] === b.keys[id])
const metadata = (r: TunnelRecord) => ({ id: r.id, config: { tunnelId: r.config.tunnelId, localPort: r.config.localPort },
  name: r.name, nodeName: r.nodeName, localIp: r.localIp, desired: r.desired, keyConfigured: !!r.config.accessKey || r.credentialConfigured === true })
interface KeyBag { accessKey: string; keys: Record<string, string> }
interface StoredRegistry { version: 3; secureKeys: string | null; accessKeyConfigured: boolean; tunnels: ReturnType<typeof metadata>[]; deletedIds?: string[] }
interface Snapshot { raw: string; stored: StoredRegistry; bag: KeyBag | null }
const empty = (): FrpRegistry => ({ version: 2, accessKey: '', tunnels: [] })
export function validateFrpRegistry(data: FrpRegistry): void {
  if (!data || data.version !== 2 || !Array.isArray(data.tunnels) || typeof data.accessKey !== 'string') throw new Error('隧道配置损坏，已保留原文件')
  if (data.deletedIds !== undefined && (!Array.isArray(data.deletedIds) || data.deletedIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)))) throw new Error('隧道删除记录损坏，已保留原文件')
  const ids = new Set<string>()
  for (const r of data.tunnels) {
    if (!r || !r.config || !/^[a-f0-9]{64}$/.test(r.id) || ids.has(r.id) || typeof r.config.accessKey !== 'string' ||
        !/^\d+$/.test(r.config.tunnelId) || !Number.isInteger(r.config.localPort) || r.config.localPort < 0 || r.config.localPort > 65535 ||
        typeof r.name !== 'string' || typeof r.nodeName !== 'string' || typeof r.localIp !== 'string' || typeof r.desired !== 'boolean' ||
        (r.config.accessKey ? r.id !== frpCredentialIdentity(r.config.accessKey, r.config.tunnelId) : r.credentialLocked !== true)) throw new Error('隧道配置无效，已保留原文件')
    ids.add(r.id)
  }
}
function storedMetadata(raw: unknown): StoredRegistry {
  const value = raw as StoredRegistry
  if (!value || value.version !== 3 || !(value.secureKeys === null || typeof value.secureKeys === 'string') || typeof value.accessKeyConfigured !== 'boolean' || !Array.isArray(value.tunnels)) throw new Error('加密隧道配置损坏，已保留原文件')
  const simulated = { version: 2, accessKey: '', deletedIds: value.deletedIds, tunnels: value.tunnels.map(r => ({ ...r, config: { ...r.config, accessKey: '' }, credentialLocked: true })) } as FrpRegistry
  validateFrpRegistry(simulated)
  if (value.tunnels.some(r => typeof r.keyConfigured !== 'boolean' || Object.hasOwn(r.config, 'accessKey')) || Object.hasOwn(value, 'accessKey')) throw new Error('加密隧道配置包含无效凭据字段，已保留原文件')
  return value
}

/** Only key material is encrypted; locked keyrings still permit displaying/stopping saved tunnels. */
export class FrpSecureStore {
  private snapshots = new Map<string, Snapshot>()
  constructor(private storage: FrpCipherStorage, private platform: string = process.platform,
    private io: { rename(from: string, to: string): void } = { rename: fs.renameSync }) {}
  available() { return protectedCredentialStorage(this.storage, this.platform) }
  private seal(bag: KeyBag) {
    if (!this.available()) throw new Error('系统安全存储不可用，访问密钥未保存；请先解锁系统密钥服务。')
    return this.storage.encryptString(JSON.stringify(bag)).toString('base64')
  }
  private open(stored: StoredRegistry): KeyBag | null {
    if (stored.secureKeys === null) return { accessKey: '', keys: {} }
    if (!this.available()) return null
    try {
      const bag = JSON.parse(this.storage.decryptString(Buffer.from(stored.secureKeys, 'base64'))) as KeyBag
      if (!bag || typeof bag.accessKey !== 'string' || !bag.keys || typeof bag.keys !== 'object' || Array.isArray(bag.keys) || Object.values(bag.keys).some(key => typeof key !== 'string')) return null
      return bag
    } catch { return null }
  }
  private materialize(stored: StoredRegistry, bag: KeyBag | null): FrpRegistry {
    const result: FrpRegistry = { version: 2, accessKey: bag?.accessKey || '', accessKeyConfigured: stored.accessKeyConfigured,
      credentialLocked: stored.accessKeyConfigured && !bag, deletedIds: stored.deletedIds,
      tunnels: stored.tunnels.map(r => ({ id: r.id, name: r.name, nodeName: r.nodeName, localIp: r.localIp, desired: r.desired,
        config: { accessKey: bag?.keys[r.id] || '', tunnelId: r.config.tunnelId, localPort: r.config.localPort }, credentialLocked: !bag?.keys[r.id], credentialConfigured: r.keyConfigured })) }
    validateFrpRegistry(result)
    return result
  }
  private assertExpected(file: string, expected?: string | null): void {
    if (expected === null ? fs.existsSync(file) : expected !== undefined && (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== expected)) throw new Error('隧道配置已由其他操作修改；当前文件未覆盖，请重新打开后重试。')
  }
  private atomic(file: string, bytes: string, expected?: string | null): void {
    this.assertExpected(file, expected)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temp = `${file}.${randomUUID()}.tmp`; let fd: number | undefined
    try {
      fd = fs.openSync(temp, 'wx', 0o600); fs.writeFileSync(fd, bytes, 'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined
      this.assertExpected(file, expected)
      this.io.rename(temp, file)
    } catch { throw new Error('隧道凭据安全保存失败，原文件保持不变。') }
    finally { if (fd !== undefined) { try { fs.closeSync(fd) } catch { /* owned descriptor */ } }; try { fs.unlinkSync(temp) } catch { /* own temp absent after commit */ } }
  }
  readRegistry(file: string, legacy?: FrpConfig | null): FrpRegistry {
    if (!fs.existsSync(file)) {
      if (!legacy) return empty()
      const id = legacy.secureIdentity || frpCredentialIdentity(legacy.accessKey, legacy.tunnelId)
      const registry: FrpRegistry = { version: 2, accessKey: legacy.accessKey, accessKeyConfigured: !!legacy.accessKey || (legacy.credentialLocked === true && legacy.credentialConfigured !== false),
        credentialLocked: legacy.credentialLocked, tunnels: [{ id, config: legacy, name: `隧道 ${legacy.tunnelId}`, nodeName: '', localIp: '127.0.0.1', desired: false, credentialLocked: legacy.credentialLocked }] }
      for (const r of registry.tunnels) r.credentialConfigured = !!r.config.accessKey || (r.credentialLocked === true && legacy.credentialConfigured !== false)
      validateFrpRegistry(registry)
      if (legacy.credentialLocked) return registry
      this.writeRegistry(file, registry)
      return registry
    }
    const bytes = fs.readFileSync(file, 'utf8'), parsed = parse(bytes)
    if (parsed.version === 2) {
      validateFrpRegistry(parsed)
      if (!this.available()) {
        // Do not silently overwrite an old plaintext file when a keyring is unavailable.
        return { ...parsed, accessKey: '', accessKeyConfigured: !!parsed.accessKey, credentialLocked: true,
          tunnels: parsed.tunnels.map((r: TunnelRecord) => ({ ...r, config: { ...r.config, accessKey: '' }, credentialLocked: true, credentialConfigured: true })) }
      }
      this.writeRegistry(file, parsed, false, bytes)
      return parsed
    }
    const stored = storedMetadata(parsed), bag = this.open(stored)
    const result = this.materialize(stored, bag)
    this.snapshots.set(file, { raw: bytes, stored, bag })
    return result
  }
  writeRegistry(file: string, data: FrpRegistry, clear = false, legacyExpected?: string): void {
    validateFrpRegistry(data)
    let snapshot = this.snapshots.get(file)
    let original: string | undefined
    if (!snapshot && fs.existsSync(file) && legacyExpected === undefined) { this.readRegistry(file); snapshot = this.snapshots.get(file); original = fs.readFileSync(file, 'utf8') }
    const bag: KeyBag = { accessKey: clear ? '' : data.accessKey, keys: {} }
    for (const r of data.tunnels) if (!clear && r.config.accessKey) bag.keys[r.id] = r.config.accessKey
    const stored: StoredRegistry = { version: 3, secureKeys: null, accessKeyConfigured: !clear && (!!data.accessKey || data.accessKeyConfigured === true),
      tunnels: data.tunnels.map(r => ({ ...metadata(r), keyConfigured: !clear && (!!r.config.accessKey || r.credentialConfigured === true) })), deletedIds: data.deletedIds }
    if (!clear && (bag.accessKey || Object.keys(bag.keys).length)) {
      if (snapshot?.stored.secureKeys && !snapshot.bag) throw new Error(LOCKED)
      if (this.available()) stored.secureKeys = this.seal(bag)
      else if (snapshot?.bag && sameBag(snapshot.bag, bag)) stored.secureKeys = snapshot.stored.secureKeys
      else throw new Error('系统安全存储不可用，新密钥未保存，原密文保持不变。')
    } else if (!clear && snapshot?.stored.secureKeys) {
      stored.secureKeys = snapshot.stored.secureKeys; stored.accessKeyConfigured = snapshot.stored.accessKeyConfigured
    } else if (!clear && (stored.accessKeyConfigured || stored.tunnels.some(r => r.keyConfigured))) {
      throw new Error(LOCKED)
    }
    const next = JSON.stringify(stored, null, 2) + '\n'
    this.atomic(file, next, legacyExpected ?? snapshot?.raw ?? original)
    this.snapshots.set(file, { raw: next, stored, bag: clear || this.available() || snapshot?.bag ? bag : null })
  }
  readLegacy(file: string): FrpConfig | null {
    if (!fs.existsSync(file)) return null
    const bytes = fs.readFileSync(file, 'utf8'), raw = parse(bytes)
    if (!raw || typeof raw.tunnelId !== 'string' || !/^\d+$/.test(raw.tunnelId) || !Number.isInteger(raw.localPort ?? 0) || (raw.localPort ?? 0) < 0 || (raw.localPort ?? 0) > 65535) throw new Error('旧隧道配置损坏，已保留原文件。')
    if (raw.version === 2 && raw.keyCleared === true && raw.secureKey === null && /^[a-f0-9]{64}$/.test(raw.identity)) {
      return { accessKey: '', tunnelId: raw.tunnelId, localPort: raw.localPort ?? 0, secureIdentity: raw.identity, credentialLocked: true, credentialConfigured: false }
    }
    if (raw.version === 2 && typeof raw.secureKey === 'string' && /^[a-f0-9]{64}$/.test(raw.identity)) {
      let key = ''
      if (this.available()) { try { key = this.storage.decryptString(Buffer.from(raw.secureKey, 'base64')) } catch { /* preserve locked ciphertext */ } }
      if (key && frpCredentialIdentity(key, raw.tunnelId) !== raw.identity) throw new Error('旧隧道凭据身份校验失败，已保留原文件。')
      return { accessKey: key, tunnelId: raw.tunnelId, localPort: raw.localPort ?? 0, secureIdentity: raw.identity, credentialLocked: !key }
    }
    if (typeof raw.accessKey !== 'string' || !raw.accessKey.trim()) throw new Error('旧隧道凭据损坏，已保留原文件。')
    const identity = frpCredentialIdentity(raw.accessKey, raw.tunnelId)
    if (!this.available()) return { accessKey: '', tunnelId: raw.tunnelId, localPort: raw.localPort ?? 0, secureIdentity: identity, credentialLocked: true }
    const config = { accessKey: raw.accessKey, tunnelId: raw.tunnelId, localPort: raw.localPort ?? 0 }
    this.writeLegacy(file, config, bytes)
    return config
  }
  writeLegacy(file: string, config: FrpConfig, expected?: string) {
    if (!config.accessKey || !/^\d+$/.test(config.tunnelId)) throw new Error('旧隧道配置无效。')
    if (expected === undefined && fs.existsSync(file)) { this.readLegacy(file); expected = fs.readFileSync(file, 'utf8') }
    if (!this.available()) throw new Error('系统安全存储不可用，旧隧道密钥未覆盖。')
    const data = { version: 2, secureKey: this.storage.encryptString(config.accessKey).toString('base64'), identity: frpCredentialIdentity(config.accessKey, config.tunnelId), tunnelId: config.tunnelId, localPort: config.localPort }
    this.atomic(file, JSON.stringify(data, null, 2) + '\n', expected)
  }
  clearLegacy(file: string) {
    if (!fs.existsSync(file)) return
    const config = this.readLegacy(file)
    if (!config) return
    const expected = fs.readFileSync(file, 'utf8')
    this.atomic(file, JSON.stringify({ version: 2, keyCleared: true, secureKey: null, identity: config.secureIdentity || frpCredentialIdentity(config.accessKey, config.tunnelId), tunnelId: config.tunnelId, localPort: config.localPort }, null, 2) + '\n', expected)
  }
  /** Two-file clear with bounded rollback. Cross-file crash atomicity is not promised. */
  clearCredentials(file: string, data: FrpRegistry, legacyFile: string): void {
    validateFrpRegistry(data)
    if (path.resolve(file) === path.resolve(legacyFile)) throw new Error('隧道清除目标重复，未修改文件。')
    const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
    const originalLegacy = fs.existsSync(legacyFile) ? fs.readFileSync(legacyFile, 'utf8') : null
    const snapshot = this.snapshots.get(file)
    if (snapshot && snapshot.raw !== original) throw new Error('隧道配置已由其他操作修改；当前文件未覆盖，请重新打开后重试。')
    // Preflight both documents without migrating/writing either one during the transaction.
    if (original !== null) { const parsed = parse(original); if (parsed.version === 2) validateFrpRegistry(parsed); else storedMetadata(parsed) }
    const stored: StoredRegistry = { version: 3, secureKeys: null, accessKeyConfigured: false,
      tunnels: data.tunnels.map(r => ({ ...metadata(r), desired: false, keyConfigured: false })), deletedIds: data.deletedIds }
    storedMetadata(stored)
    const registryBytes = JSON.stringify(stored, null, 2) + '\n'
    let legacyBytes: string | null = null
    if (originalLegacy !== null) {
      const old = parse(originalLegacy)
      if (!old || typeof old.tunnelId !== 'string' || !/^\d+$/.test(old.tunnelId) || !Number.isInteger(old.localPort ?? 0) || (old.localPort ?? 0) < 0 || (old.localPort ?? 0) > 65535) throw new Error('旧隧道配置损坏，未修改任何清除目标。')
      let identity: string
      if (old.version === 2 && /^[a-f0-9]{64}$/.test(old.identity) && (typeof old.secureKey === 'string' || (old.keyCleared === true && old.secureKey === null))) identity = old.identity
      else if (typeof old.accessKey === 'string' && old.accessKey.trim()) identity = frpCredentialIdentity(old.accessKey, old.tunnelId)
      else throw new Error('旧隧道凭据损坏，未修改任何清除目标。')
      legacyBytes = JSON.stringify({ version: 2, keyCleared: true, secureKey: null, identity, tunnelId: old.tunnelId, localPort: old.localPort ?? 0 }, null, 2) + '\n'
    }
    const changes = [...(legacyBytes !== null ? [{ file: legacyFile, before: originalLegacy, after: legacyBytes }] : []), { file, before: original, after: registryBytes }]
    for (const change of changes) this.assertExpected(change.file, change.before)
    this.assertExpected(legacyFile, originalLegacy)
    const committed: typeof changes = []
    try {
      for (const change of changes) { this.atomic(change.file, change.after, change.before); committed.push(change) }
      for (const change of changes) this.assertExpected(change.file, change.after)
      if (originalLegacy === null) this.assertExpected(legacyFile, null)
    } catch {
      // Account for an injected/ambiguous rename that committed bytes before reporting failure.
      for (const change of changes) if (!committed.includes(change) && change.before !== change.after && fs.existsSync(change.file) && fs.readFileSync(change.file, 'utf8') === change.after) committed.push(change)
      let restored = true
      for (const change of committed.reverse()) {
        try {
          this.assertExpected(change.file, change.after)
          if (change.before === null) fs.unlinkSync(change.file)
          else this.atomic(change.file, change.before, change.after)
        } catch { restored = false }
      }
      this.snapshots.delete(file)
      throw new Error(restored ? '清除访问密钥失败；本次已写入的文件已恢复，其他当前文件未覆盖，请重试。' : '清除访问密钥未完成；文件被其他操作修改或恢复失败，部分写入无法自动恢复，请重新打开检查后重试。')
    }
    this.snapshots.set(file, { raw: registryBytes, stored, bag: { accessKey: '', keys: {} } })
  }
}
