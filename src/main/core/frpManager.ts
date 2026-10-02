import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { FrpConfig, FrpEvent, FrpState, StartResult } from './frp'

export interface TunnelRecord {
  id: string; config: FrpConfig; name: string; nodeName: string; localIp: string; desired: boolean
}
export interface ManagedTunnel extends FrpState {
  id: string; name: string; nodeName: string; localIp: string; desired: boolean; busy: boolean; deleting?: boolean
}
export interface FrpRegistry { version: 2; accessKey: string; tunnels: TunnelRecord[]; deletedIds?: string[] }
export interface TunnelWorker {
  start(config: FrpConfig): Promise<StartResult>; stop(): Promise<void>; status(): FrpState
  setSink(sink: (event: FrpEvent) => void): void
}
export interface TunnelMetadata { id: number; name: string; nodeName: string | null; localIp: string; localPort: number }
export const tunnelIdentity = (key: string, id: string) => createHash('sha256').update(key.trim() + '\0' + id).digest('hex')

export function readFrpRegistry(file: string, legacy?: FrpConfig | null): FrpRegistry {
  if (!fs.existsSync(file)) return { version: 2, accessKey: legacy?.accessKey || '', tunnels: legacy ? [{ id: tunnelIdentity(legacy.accessKey, legacy.tunnelId), config: legacy, name: `隧道 ${legacy.tunnelId}`, nodeName: '', localIp: '127.0.0.1', desired: false }] : [] }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as FrpRegistry
  if (raw.version !== 2 || !Array.isArray(raw.tunnels) || typeof raw.accessKey !== 'string') throw new Error('隧道配置损坏，已保留原文件')
  if (raw.deletedIds !== undefined && (!Array.isArray(raw.deletedIds) || raw.deletedIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)))) throw new Error('隧道删除记录损坏，已保留原文件')
  for (const r of raw.tunnels) {
    if (!r.config?.accessKey || !/^\d+$/.test(r.config.tunnelId) || r.id !== tunnelIdentity(r.config.accessKey, r.config.tunnelId) || typeof r.desired !== 'boolean') throw new Error('隧道配置无效，已保留原文件')
  }
  return raw
}
export function writeFrpRegistry(file: string, data: FrpRegistry): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = file + '.tmp'
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 })
  fs.renameSync(temp, file)
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
  constructor(private deps: { read(): FrpRegistry; save(data: FrpRegistry): void; worker(): TunnelWorker; validate(key: string, id: string): Promise<TunnelMetadata>; deleteRemote?(key: string, id: string): Promise<{ remoteDisconnectPending: boolean }> }) {}
  private registry() { return this.data ??= this.deps.read() }
  private commit(next: FrpRegistry) { this.deps.save(next); this.data = next }
  private record(id: string) { const r = this.registry().tunnels.find(r => r.id === id); if (!r) throw new Error('未找到该隧道，请重新读取'); return r }
  private bump(id: string) { const n = (this.generations.get(id) || 0) + 1; this.generations.set(id, n); return n }
  setSink(sink: (tunnel: ManagedTunnel) => void) { this.sink = sink }
  private snapshot(r: TunnelRecord): ManagedTunnel {
    const live = this.workers.get(r.id)?.status()
    const s = live?.config ? live : this.lastStates.get(r.id)
    const error = this.failures.get(r.id)
    return { status: error ? 'error' : s?.status || 'idle', config: r.config, remoteAddress: s?.remoteAddress || null,
      pid: s?.pid || null, startedAt: s?.startedAt || null, message: error || s?.message || '尚未启动', logs: s?.logs || [],
      id: r.id, name: r.name, nodeName: r.nodeName, localIp: r.localIp, desired: r.desired, busy: this.pending.has(r.id), deleting: this.deletions.has(r.id) }
  }
  private emit(id: string) { this.sink(this.snapshot(this.record(id))) }
  list() { return { accessKey: this.registry().accessKey, tunnels: this.registry().tunnels.map(r => this.snapshot(r)) } }
  register(key: string, tunnels: TunnelMetadata[]) {
    const next = structuredClone(this.registry()); next.accessKey = key.trim()
    for (const t of tunnels) {
      const id = tunnelIdentity(key, String(t.id)), old = next.tunnels.find(r => r.id === id)
      if (next.deletedIds?.includes(id) || this.deletions.has(id)) continue
      const metadata = { name: t.name || `隧道 ${t.id}`, nodeName: t.nodeName || '', localIp: t.localIp }
      if (old) Object.assign(old, metadata, { config: { ...old.config, localPort: t.localPort } })
      else next.tunnels.push({ id, config: { accessKey: key.trim(), tunnelId: String(t.id), localPort: t.localPort }, ...metadata, desired: false })
    }
    this.commit(next); return this.list()
  }
  async start(id: string): Promise<void> {
    if (this.deletions.has(id)) throw new Error('该隧道正在删除，请等待完成')
    if (this.closing) throw new Error('启动器正在关闭，请稍后重试')
    if (this.pending.has(id)) return void await this.pending.get(id)
    const record = this.record(id), active = this.workers.get(id)?.status().status
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
  async shutdown(): Promise<void> {
    this.closing = true
    for (const r of this.registry().tunnels) this.bump(r.id)
    this.shutdownTask = Promise.allSettled([...this.workers.values()].map(worker => worker.stop()).concat([...this.pending.values()].map(task => task.then(() => {})))).then(() => {})
    return this.shutdownTask
  }
}
