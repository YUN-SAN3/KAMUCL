import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export interface ExitRecord { id: string; kind: 'launcher' | 'game'; time: number; text: string; seen: boolean; uncertain?: boolean; context?: Record<string, unknown> }
interface Pending { kind: 'launcher' | 'game'; pid: number; startedAt: number; label: string; context?: Record<string, unknown> }
interface State { pending: Record<string, Pending>; history: ExitRecord[] }
/** Durable session markers. Missing clean shutdown is reported as unconfirmed, not invented crash data. */
export class ExitJournal {
  constructor(private file: string, private alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }) {}
  private read(): State {
    try { const s = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (s.pending && Array.isArray(s.history)) return s } catch {}
    return { pending: {}, history: [] }
  }
  private save(s: State) {
    s.history = s.history.slice(0, 30)
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = this.file + `.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2))
    fs.renameSync(tmp, this.file)
  }
  private add(s: State, kind: ExitRecord['kind'], text: string, context?: Record<string, unknown>, uncertain = false) {
    s.history.unshift({ id: crypto.randomUUID(), kind, text, context, uncertain, time: Date.now(), seen: false })
  }
  reconcile() {
    const s = this.read()
    for (const [id, pending] of Object.entries(s.pending)) {
      if (this.alive(pending.pid)) continue
      this.add(s, pending.kind, pending.kind === 'launcher' ? '上次启动器未正常关闭，已保留异常退出记录。' : `上次游戏「${pending.label}」已结束，但未收到退出状态（可能发生在启动器关闭期间）。`, pending.context, pending.kind === 'game')
      delete s.pending[id]
    }
    this.save(s)
  }
  begin(kind: Pending['kind'], pid: number, label: string, context?: Record<string, unknown>) {
    const s = this.read(), id = crypto.randomUUID()
    s.pending[id] = { kind, pid, label, context, startedAt: Date.now() }; this.save(s); return id
  }
  end(id: string, code: number | null, intentional = false, shutdownTimeout = false) {
    const s = this.read(), pending = s.pending[id]
    if (!pending) return
    if (shutdownTimeout && pending.kind === 'game') {
      this.add(s, 'game', `游戏「${pending.label}」已关闭，退出清理超时；日志已保留。`, { ...pending.context, exitCode: code, exitKind: 'shutdown-timeout', endedAt: new Date().toISOString() })
      s.history[0].seen = true // Informational history, not a new crash prompt on next launch.
    } else if (code !== 0 && !intentional) this.add(s, pending.kind, `${pending.kind === 'game' ? `游戏「${pending.label}」` : '启动器'}异常退出（代码 ${code ?? '未知'}）。`, { ...pending.context, exitCode: code, endedAt: new Date().toISOString() })
    delete s.pending[id]; this.save(s)
  }
  fault(kind: ExitRecord['kind'], text: string, context?: Record<string, unknown>) { const s = this.read(); this.add(s, kind, text, context); this.save(s) }
  list() { return this.read().history }
  acknowledge() { const s = this.read(); s.history.forEach(e => { e.seen = true }); this.save(s) }
  clearHistory() { const s = this.read(); s.history = []; this.save(s) }
}
