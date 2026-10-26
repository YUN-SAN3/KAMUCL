import type { FrpConfig, FrpEvent, FrpState, StartResult } from './frp'
import { FrpSecureStore, frpCredentialIdentity, validateFrpRegistry } from './frpSecureStore'
import { redactDiagnosticText } from './diagnostics'

export interface TunnelRecord {
  id: string; config: FrpConfig; name: string; nodeName: string; localIp: string; desired: boolean; credentialLocked?: boolean; credentialConfigured?: boolean
}
export interface ManagedTunnel extends Omit<FrpState, 'config'> {
  config: Omit<FrpConfig, 'accessKey' | 'secureIdentity' | 'credentialLocked'> | null
  id: string; name: string; nodeName: string; localIp: string; desired: boolean; busy: boolean; deleting?: boolean; credentialLocked?: boolean
}
export interface FrpRegistry { version: 2; accessKey: string; tunnels: TunnelRecord[]; deletedIds?: string[]; accessKeyConfigured?: boolean; credentialLocked?: boolean }
export interface TunnelWorker {
  start(config: FrpConfig): Promise<StartResult>; stop(): Promise<void>; status(): FrpState
  setSink(sink: (event: FrpEvent) => void): void
}
export interface TunnelMetadata { id: number; name: string; nodeName: string | null; localIp: string; localPort: number }
export const tunnelIdentity = frpCredentialIdentity

export function readFrpRegistry(file: string, legacy: FrpConfig | null | undefined, store: FrpSecureStore): FrpRegistry {
  return store.readRegistry(file, legacy)
}
export function writeFrpRegistry(file: string, data: FrpRegistry, store: FrpSecureStore, clear = false): void {
  store.writeRegistry(file, data, clear)
}

/** Persist intent independently from process lifetime. Every tunnel owns one worker. */
export class FrpManager {
  private data: FrpRegistry | null = null
  private workers = new Map<string, TunnelWorker>()
  private pending = new Map<string, Promise<unknown>>()
  private deletions = new Map<string, Promise<{ remoteDisconnectPending: boolean }>>()
  private generations = new Map<string, number>()
  private failures = new Map<string, string>()
  private lastStates = new Map<string, FrpState>()
  private closing = false
  private shutdownTask: Promise<void> = Promise.resolve()
  private sink: (tunnel: ManagedTunnel) => void = () => {}
  constructor(private deps: { read(): FrpRegistry; save(data: FrpRegistry, clear?: boolean): void; worker(): TunnelWorker; credentialAvailable?(): boolean; notice?(): string; validate(key: string, id: string): Promise<TunnelMetadata>; deleteRemote?(key: string, id: string): Promise<{ remoteDisconnectPending: boolean }> }) {}
  private registry() { return this.data ??= this.deps.read() }
  private commit(next: FrpRegistry) { this.deps.save(next); this.data = next }
  private record(id: string) { const r = this.registry().tunnels.find(r => r.id === id); if (!r) throw new Error('未找到该隧道，请重新读取'); return r }
  private bump(id: string) { const n = (this.generations.get(id) || 0) + 1; this.generations.set(id, n); return n }
  setSink(sink: (tunnel: ManagedTunnel) => void) { this.sink = sink }
  private safe(value: string) {
    const secrets = [...new Set([this.registry().accessKey, ...this.registry().tunnels.map(r => r.config.accessKey)].filter(Boolean))]
    let text = value
    for (const key of secrets) { text = text.split(key).join('***'); text = text.split(encodeURIComponent(key)).join('***') }
    return redactDiagnosticText(text)
  }
  private snapshot(r: TunnelRecord): ManagedTunnel {
    const live = this.workers.get(r.id)?.status()
    const s = live?.config ? live : this.lastStates.get(r.id)
    const error = this.failures.get(r.id)
    return { status: error || r.credentialLocked ? 'error' : s?.status || 'idle', config: { tunnelId: r.config.tunnelId, localPort: r.config.localPort }, remoteAddress: s?.remoteAddress ? this.safe(s.remoteAddress) : null,
      pid: s?.pid || null, startedAt: s?.startedAt || null, message: this.safe(error || (r.credentialLocked ? '密钥尚未解锁或已清除；请解锁系统安全存储或重新填写密钥。' : s?.message) || '尚未启动'), logs: (s?.logs || []).map(log => ({ ...log, text: this.safe(log.text) })),
      id: r.id, name: this.safe(r.name), nodeName: this.safe(r.nodeName), localIp: this.safe(r.localIp), desired: r.desired, busy: this.pending.has(r.id), deleting: this.deletions.has(r.id), credentialLocked: r.credentialLocked === true }
  }
  private emit(id: string) { this.sink(this.snapshot(this.record(id))) }
  list() {
    const data = this.registry()
    if (data.credentialLocked || data.tunnels.some(r => r.credentialLocked)) this.data = this.deps.read()
    const registry = this.registry()
    const configured = !!registry.accessKey || registry.accessKeyConfigured === true
    const locked = registry.credentialLocked === true || this.deps.credentialAvailable?.() === false
    const emptyNotice = registry.tunnels.length ? '本机密钥已清除；系统安全存储仍不可用，解锁后可保存新密钥；隧道记录已保留。' : '本机尚未保存访问密钥；系统安全存储不可用，请解锁后再保存新密钥。'
    const storageNotice = locked ? (configured ? '系统安全存储不可用或凭据无法解密；已保存的密钥和隧道记录已保留，请解锁后重试。' : emptyNotice) : ''
    return { configured, locked, notice: [this.deps.notice?.() || '', storageNotice].filter(Boolean).join('\n'), tunnels: registry.tunnels.map(r => this.snapshot(r)) }
  }
  accessKey(input?: string): string {
    this.list()
    if (this.registry().credentialLocked || this.deps.credentialAvailable?.() === false) throw new Error('系统安全存储已锁定或凭据无法解密；原记录已保留，请解锁后重试。')
    const key = String(input ?? '').trim() || this.registry().accessKey
    if (!key) throw new Error('请填写访问密钥')
    return key
  }
  register(key: string, tunnels: TunnelMetadata[]) {
    key = this.accessKey(key)
    const next = structuredClone(this.registry()); next.accessKey = key.trim(); next.accessKeyConfigured = true; next.credentialLocked = false
    for (const t of tunnels) {
      const id = tunnelIdentity(key, String(t.id)), old = next.tunnels.find(r => r.id === id)
      if (next.deletedIds?.includes(id) || this.deletions.has(id)) continue
      const metadata = { name: t.name || `隧道 ${t.id}`, nodeName: t.nodeName || '', localIp: t.localIp }
      if (old) Object.assign(old, metadata, { config: { accessKey: key.trim(), tunnelId: String(t.id), localPort: t.localPort }, credentialLocked: false, credentialConfigured: true })
      else next.tunnels.push({ id, config: { accessKey: key.trim(), tunnelId: String(t.id), localPort: t.localPort }, ...metadata, desired: false })
    }
    this.commit(next); return this.list()
  }
  async start(id: string): Promise<void> {
    if (this.deletions.has(id)) throw new Error('该隧道正在删除，请等待完成')
    if (this.closing) throw new Error('启动器正在关闭，请稍后重试')
    if (this.pending.has(id)) return void await this.pending.get(id)
    this.list()
    const record = this.record(id), active = this.workers.get(id)?.status().status
    if (record.credentialLocked || !record.config.accessKey || this.deps.credentialAvailable?.() === false) throw new Error('隧道密钥尚未解锁或已清除，请先解锁或重新填写密钥。')
    if (active === 'running' || active === 'starting') return
    const generation = this.bump(id)
    const next = structuredClone(this.registry()); next.tunnels.find(r => r.id === id)!.desired = true; this.commit(next)
    this.failures.delete(id)
    const worker = this.workers.get(id) || this.deps.worker(); this.workers.set(id, worker)
    worker.setSink(event => {
      if (this.workers.get(id) !== worker) return
      this.lastStates.set(id, worker.status())
      if (event.type === 'error' || (event.type === 'stopped' && event.status !== 'stopped')) this.failures.set(id, event.message || '隧道异常退出')
      this.emit(id)
    })
    const task = Promise.resolve().then(async () => {
      try {
        const tunnel = await this.deps.validate(record.config.accessKey, record.config.tunnelId)
        if (this.closing || this.generations.get(id) !== generation) return
        const updated = structuredClone(this.registry()), current = updated.tunnels.find(r => r.id === id)!
        current.config.localPort = tunnel.localPort
        current.name = tunnel.name || current.name
        current.nodeName = tunnel.nodeName || current.nodeName
        current.localIp = tunnel.localIp || current.localIp
        this.commit(updated)
        await worker.stop()
        if (this.closing || this.generations.get(id) !== generation) return
        await worker.start({ ...record.config, localPort: tunnel.localPort })
      } catch (error) {
        if (this.generations.get(id) !== generation || this.closing) return
        const message = (error instanceof Error ? error.message : String(error)).split(record.config.accessKey).join('***')
        this.failures.set(id, message); throw new Error(message)
      } finally { this.pending.delete(id); this.emit(id) }
    })
    this.pending.set(id, task); this.emit(id); await task
  }
  async stop(id: string): Promise<void> {
    this.record(id)
    const next = structuredClone(this.registry()); next.tunnels.find(r => r.id === id)!.desired = false; this.commit(next)
    this.bump(id); this.failures.delete(id); this.emit(id)
    await this.workers.get(id)?.stop(); this.emit(id)
  }
  async remove(id: string): Promise<{ remoteDisconnectPending: boolean }> {
    const inFlight = this.deletions.get(id)
    if (inFlight) return inFlight
    if (this.closing) throw new Error('启动器正在关闭，请稍后重试')
    const record = this.record(id)
    if (!this.deps.deleteRemote) throw new Error('当前版本不支持远端删除')
    const task = Promise.resolve().then(async () => {
      let remoteDeleted = false
      try {
        // Save disabled restoration before any remote mutation, including ambiguous timeouts.
        await this.stop(id)
        await this.pending.get(id)?.catch(() => {})
        const worker = this.workers.get(id)
        if (worker?.status().pid) throw new Error('本地隧道尚未停止，未执行远端删除，请稍后重试')
        const result = await this.deps.deleteRemote!(record.config.accessKey, record.config.tunnelId)
        remoteDeleted = true
        const next = structuredClone(this.registry())
        next.tunnels = next.tunnels.filter(t => t.id !== id)
        next.deletedIds = [...new Set([...(next.deletedIds || []), id])]
        this.commit(next)
        worker?.setSink(() => {})
        this.workers.delete(id); this.lastStates.delete(id); this.failures.delete(id)
        return result
      } catch (error) {
        const detail = (error instanceof Error ? error.message : String(error)).split(record.config.accessKey).join('***')
        const message = remoteDeleted ? `远端隧道已删除，但本地记录保存失败；请重试清理：${detail}` : `未能完成删除；隧道卡片已保留：${detail}`
        this.failures.set(id, message)
        throw new Error(message)
      } finally {
        this.deletions.delete(id)
        if (this.registry().tunnels.some(t => t.id === id)) this.emit(id)
      }
    })
    this.deletions.set(id, task); this.emit(id)
    return task
  }
  async restore(): Promise<void> {
    await this.shutdownTask; this.closing = false
    const ids = this.registry().tunnels.filter(r => r.desired).map(r => r.id)
    // Three concurrent starts avoid delaying the renderer or flooding the service.
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(3, ids.length) }, async () => {
      while (cursor < ids.length && !this.closing) { const id = ids[cursor++]; if (!this.record(id).desired) continue; await this.start(id).catch(() => {}) }
    }))
  }
  async clearCredentials(): Promise<void> {
    for (const record of this.registry().tunnels) { if (this.workers.has(record.id) || this.pending.has(record.id)) await this.stop(record.id); await this.pending.get(record.id)?.catch(() => {}) }
    if ([...this.workers.values()].some(worker => worker.status().pid)) throw new Error('仍有隧道进程未停止；访问密钥尚未清除，请稍后重试。')
    const next = structuredClone(this.registry()); next.accessKey = ''; next.accessKeyConfigured = false; next.credentialLocked = false
    for (const record of next.tunnels) { record.config.accessKey = ''; record.credentialLocked = true; record.credentialConfigured = false; record.desired = false }
    validateFrpRegistry(next)
    try { this.deps.save(next, true); this.data = next }
    catch (error) { this.data = null; throw error }
  }
  async shutdown(): Promise<void> {
    this.closing = true
    for (const r of this.registry().tunnels) this.bump(r.id)
    this.shutdownTask = Promise.allSettled([...this.workers.values()].map(worker => worker.stop()).concat([...this.pending.values()].map(task => task.then(() => {})))).then(() => {})
    return this.shutdownTask
  }
}
