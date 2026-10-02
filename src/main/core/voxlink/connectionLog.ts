// SPDX-License-Identifier: LGPL-3.0-only
// Adapted from VoxLink LogUploadManager, revision 721c7fae; network-only redacted diagnostics.
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { ApiClient, APP_VERSION } from './api'
import { redactDiagnosticText } from '../diagnostics'
export class ConnectionLog {
  private lines: string[] = []
  private code = ''; private role = ''; private started = 0; private connected = 0
  private failed = false; private uploaded = false; private generation = 0
  private timer?: NodeJS.Timeout; private pending?: Promise<void>
  constructor(private base: () => string, private enabled: () => boolean, private secrets: () => string[]) {}
  record(level: string, text: string) {
    this.lines.push(`${new Date().toISOString()} [${level}] ${redactDiagnosticText(text, this.secrets())}`.slice(0, 2000))
    if (this.lines.length > 1000) this.lines.shift()
  }
  start(code: string, host: boolean) {
    clearTimeout(this.timer); this.generation++; this.lines = []; this.code = code; this.role = host ? 'host' : 'joiner'; this.started = Date.now(); this.connected = 0; this.failed = this.uploaded = false
    this.record('info', '联机会话开始')
    if (this.enabled()) void new ApiClient().post(this.base(), '/log/status', { code, role: this.role, enabled: true }).catch(() => {})
    if (!host) this.schedule(90000)
  }
  state(status: string, detail: string) {
    this.record(status, detail)
    if (status === 'success') { this.connected = Date.now(); this.failed = false }
    if (status === 'failed') {
      const early = this.connected > 0 && Date.now() - this.connected < 120000
      this.connected = 0; this.failed = true; this.schedule(early ? 1000 : 5000)
    }
  }
  private schedule(ms: number) { clearTimeout(this.timer); this.timer = setTimeout(() => { void this.upload() }, ms); this.timer.unref() }
  private upload(timeout = 10000): Promise<void> {
    if (this.pending) return this.pending
    if (!this.code || this.uploaded || !this.enabled()) return Promise.resolve()
    if (this.connected) { if (Date.now() - this.connected < 120000) this.schedule(15000); return Promise.resolve() }
    const epoch = this.generation, code = this.code, role = this.role, elapsed = Date.now() - this.started
    const payload = gzipSync(Buffer.from(this.lines.join('\n'))), url = new URL(this.base()); url.searchParams.set('route', '/log/upload')
    this.pending = (async () => {
      try {
        const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(timeout), headers: {
          'Content-Type': 'application/octet-stream', 'Accept': 'application/json', 'User-Agent': `KAMUCL-App/${APP_VERSION}`,
          'X-VoxLink-Version': APP_VERSION, 'X-Log-Sha256': createHash('sha256').update(payload).digest('hex'),
          'X-Log-Role': role, 'X-Log-Code': code, 'X-Log-Name': 'KAMUCL', 'X-Log-Version': APP_VERSION, 'X-Log-Duration-Ms': String(elapsed)
        }, body: payload })
        const data = await response.json() as { success?: boolean }
        if (epoch === this.generation && response.ok && data.success) this.uploaded = true
      } catch { /* Diagnostic delivery must never hold up joining or shutdown. */ }
      finally { this.pending = undefined }
    })()
    return this.pending
  }
  async stop(quit = false) {
    const epoch = this.generation
    clearTimeout(this.timer)
    if (this.failed || quit && !this.connected && Date.now() - this.started >= 30000) await this.upload(quit ? 6000 : 3000)
    if (epoch === this.generation) { this.generation++; this.code = ''; clearTimeout(this.timer) }
  }
}
