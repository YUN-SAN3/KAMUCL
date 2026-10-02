/**
 * 樱花穿透（natfrp.com / SakuraFrp）FRP 客户端封装。
 *
 * 用法：spawn frpc -f <accessKey>:<tunnelId>，解析 stdout/stderr 识别启动状态、远程地址。
 * 访问密钥、隧道 ID 持久化到 userData/frp-config.json，日志对密钥做打码处理。
 *
 * 文档：https://doc.natfrp.com/frpc/usage.html
 * 启动成功后会输出形如 "[xxxxx.natfrp.cloud:yyyyy] start proxy success" 的日志行，
 * 失败会输出 "invalid token" / "tunnel not exists" / "login to server failed" 等。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { downloadAll } from './download'
import { parseFrpLine, frpLineReader } from './frpLog'

/** 默认本地转发目标（MC 局域网开放端口） */
export const DEFAULT_LOCAL_HOST = '127.0.0.1'

/** 官方 frpc 直链（amd64 Windows；用户可在管理面板自行替换为对应架构）。 */
export const FRPC_OFFICIAL_URL_WIN_AMD64 =
  'https://nya.globalslb.net/natfrp/client/frpc/0.51.0-sakura-14/frpc_windows_amd64.exe'

export function frpcAsset(platform = process.platform, arch = process.arch): { url: string; sha256?: string } {
  if (platform === 'win32') return { url: FRPC_OFFICIAL_URL_WIN_AMD64 }
  const sha256 = arch === 'arm64' ? '465db9daea0e14e3adaa89926640afa8b44737dadc1cf0b75f9b091850d2e331'
    : arch === 'x64' ? '74ee362350314dd5ac8936fbe2299fc76671051e10beb46c8dd37c36a4503935' : undefined
  if (platform !== 'darwin' || !sha256) throw new Error(`樱花穿透暂不支持 ${platform}/${arch}`)
  return { url: `https://nya.globalslb.net/natfrp/client/frpc/0.51.0-sakura-14/frpc_darwin_${arch === 'x64' ? 'amd64' : 'arm64'}`, sha256 }
}

export interface FrpConfig {
  accessKey: string
  tunnelId: string
  /** 本地转发端口；0 表示交给 MC 局域网自动检测 */
  localPort: number
}

export type FrpStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'auth_failed'
  | 'tunnel_offline'
  | 'error'
  | 'stopped'

export interface FrpState {
  status: FrpStatus
  config: FrpConfig | null
  remoteAddress: string | null
  pid: number | null
  startedAt: string | null
  message: string
  /** 最近的运行日志（带打码），最多保留 200 条 */
  logs: FrpLogEntry[]
}

export interface FrpLogEntry {
  ts: string
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}

/** 给渲染端订阅的事件（frp:event push）。 */
export interface FrpEvent {
  type: 'status' | 'log' | 'ready' | 'error' | 'stopped'
  status?: FrpStatus
  remoteAddress?: string | null
  data?: FrpLogEntry | string
  message?: string
}

export type FrpEventSink = (event: FrpEvent) => void

function configFile(): string {
  return path.join(app.getPath('userData'), 'frp-config.json')
}

function frpcDir(): string {
  return path.join(app.getPath('userData'), 'frp')
}

export function frpcPath(): string {
  return path.join(frpcDir(), process.platform === 'win32' ? 'frpc.exe' : 'frpc')
}

/** 密钥打码：仅保留前 2 + 后 2，中间替换成 ***，避免完整出现在日志。 */
export function maskKey(value: string): string {
  if (!value) return ''
  if (value.length <= 4) return '*'.repeat(value.length)
  return `${value.slice(0, 2)}***${value.slice(-2)}`
}

/** 清理任何可能出现在日志中的密钥形式（含命令行回显）。 */
function sanitize(raw: string, key: string): string {
  if (!raw) return raw
  let out = raw
  if (key) {
    const mask = maskKey(key)
    // 替换裸 key（即便经过 URL 编码或带前缀）
    out = out.split(key).join(mask)
    try {
      const enc = encodeURIComponent(key)
      if (enc !== key) out = out.split(enc).join(mask)
    } catch {
      /* ignore */
    }
  }
  return out
}

function readConfig(): FrpConfig | null {
  try {
    const raw = fs.readFileSync(configFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<FrpConfig>
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.accessKey !== 'string' || typeof parsed.tunnelId !== 'string') return null
    return {
      accessKey: parsed.accessKey,
      tunnelId: parsed.tunnelId,
      localPort: typeof parsed.localPort === 'number' ? parsed.localPort : 0
    }
  } catch {
    return null
  }
}

function writeConfig(cfg: FrpConfig): void {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true })
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2), 'utf8')
}

export function loadFrpConfig(): FrpConfig | null {
  return readConfig()
}

export function saveFrpConfig(cfg: FrpConfig): FrpConfig {
  const next: FrpConfig = {
    accessKey: String(cfg.accessKey ?? '').trim(),
    tunnelId: String(cfg.tunnelId ?? '').trim(),
    localPort: Number(cfg.localPort ?? 0) || 0
  }
  writeConfig(next)
  return next
}

let installingFrpc: Promise<string> | null = null
export function ensureFrpcInstalled(onLog?: (line: string) => void): Promise<string> {
  if (installingFrpc) return installingFrpc
  const target = frpcPath()
  if (fs.existsSync(target) && process.platform === 'win32') return Promise.resolve(target)
  const asset = frpcAsset()
  fs.mkdirSync(frpcDir(), { recursive: true })
  onLog?.('正在准备樱花穿透官方客户端…')
  installingFrpc = downloadAll([{ ...asset, dest: target }], undefined, 1, 'official')
    .then(() => {
      if (process.platform !== 'win32') fs.chmodSync(target, 0o755)
      onLog?.('frpc 下载完成')
      return target
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `frpc 下载失败：${msg}。请检查网络后重试，官方下载地址：${asset.url}`
      )
    }).finally(() => { installingFrpc = null })
  return installingFrpc
}

function killProcessTree(pid: number): void {
  if (!pid || process.platform !== 'win32') return
  try {
    // taskkill /T /F /PID <pid> 兜底：frpc 子进程不会因 parent.kill 全部退出
    const { spawn: spawnSync } = require('node:child_process') as typeof import('node:child_process')
    spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true }).on(
      'error',
      () => undefined
    )
  } catch {
    /* ignore */
  }
}

interface RunningSession {
  proc: ChildProcess
  pid: number
  config: FrpConfig
  remoteAddress: string | null
  startedAt: string
  logs: FrpLogEntry[]
  status: FrpStatus
}


const MAX_LOGS = 200

export interface StartOptions {
  /** 渲染端传入的本地转发端口；留 0 表示从 MC 局域网日志读取 */
  localPort: number
  /** 是否由本组件自动读取 MC 日志拿端口 */
  autoDetectPort?: boolean
}

export interface StartResult {
  pid: number
  remoteAddress: string | null
}

function appendLog(state: RunningSession, entry: FrpLogEntry): void {
  state.logs.push(entry)
  if (state.logs.length > MAX_LOGS) state.logs.splice(0, state.logs.length - MAX_LOGS)
}

export class FrpController {
  private session: RunningSession | null = null
  private epoch = 0
  private sink: FrpEventSink | null = null
  private detach: (() => void) | null = null

  setSink(sink: FrpEventSink): void {
    this.sink = sink
  }

  status(): FrpState {
    if (!this.session) {
      return {
        status: 'idle',
        config: null,
        remoteAddress: null,
        pid: null,
        startedAt: null,
        message: '尚未启动',
        logs: []
      }
    }
    return {
      status: this.session.status,
      config: this.session.config,
      remoteAddress: this.session.remoteAddress,
      pid: this.session.pid,
      startedAt: this.session.startedAt,
      message: this.statusMessage(this.session),
      logs: this.session.logs.slice()
    }
  }

  private statusMessage(s: RunningSession): string {
    switch (s.status) {
      case 'starting':
        return '正在连接 SakuraFrp…'
      case 'running':
        return s.remoteAddress ? `已连接，远程地址 ${s.remoteAddress}` : '已连接，等待远程地址'
      case 'auth_failed':
        return '访问密钥无效或已失效'
      case 'tunnel_offline':
        return '隧道不存在或已被禁用'
      case 'error':
        return 'frpc 进程异常退出'
      case 'stopped':
        return '已停止'
      default:
        return '空闲'
    }
  }

  async start(req: FrpConfig & { localPort: number }): Promise<StartResult> {
    if (this.session) throw new Error('frpc 已在运行中，请先停止')
    const epoch = ++this.epoch
    this.detachedByUser = false

    const accessKey = String(req.accessKey ?? '').trim()
    const tunnelId = String(req.tunnelId ?? '').trim()
    const localPort = Number(req.localPort ?? 0) || 0
    if (!accessKey) throw new Error('请填写访问密钥')
    if (!tunnelId) throw new Error('请填写隧道 ID')

    const target = await ensureFrpcInstalled()
    if (epoch !== this.epoch) throw new Error("启动已取消")
    const saved = { accessKey, tunnelId, localPort }

    const args: string[] = ['-f', `${accessKey}:${tunnelId}`, '--disable_log_color']
    const startedAt = new Date().toISOString()
    const proc = spawn(target, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const pid = proc.pid ?? 0

    const newSession: RunningSession = {
      proc,
      pid,
      config: saved,
      remoteAddress: null,
      startedAt,
      logs: [],
      status: 'starting'
    }
    this.session = newSession

    const emit = (event: FrpEvent): void => this.sink?.(event)

    emit({ type: 'status', status: 'starting', message: '正在连接 SakuraFrp…' })
    emit({
      type: 'log',
      data: {
        ts: startedAt,
        stream: 'system',
        text: `启动命令: ${target} -f ${maskKey(accessKey)}:${saved.tunnelId}`
      }
    })

    let addressPriority = 0
    const handleLine = (stream: 'stdout' | 'stderr', text: string): void => {
      const cleaned = sanitize(text, accessKey)
      const entry: FrpLogEntry = { ts: new Date().toISOString(), stream, text: cleaned }
      appendLog(newSession, entry)
      emit({ type: 'log', data: entry })

      const parsed = parseFrpLine(cleaned)
      if (parsed.address && parsed.priority >= addressPriority && parsed.address !== newSession.remoteAddress) {
        newSession.remoteAddress = parsed.address
        addressPriority = parsed.priority
        emit({ type: 'ready', remoteAddress: parsed.address })
      }
      if (parsed.status && parsed.status !== newSession.status) {
        newSession.status = parsed.status
        emit({ type: 'status', status: parsed.status, remoteAddress: newSession.remoteAddress ?? undefined, message: this.statusMessage(newSession) })
      }
    }

    for (const stream of ['stdout', 'stderr'] as const) {
      const reader = frpLineReader(line => handleLine(stream, line))
      proc[stream]?.on('data', reader.write)
      proc[stream]?.on('end', reader.end)
    }

    proc.on('error', (err) => {
      const message = sanitize(err.message, accessKey)
      const entry: FrpLogEntry = { ts: new Date().toISOString(), stream: 'system', text: `进程错误：${message}` }
      appendLog(newSession, entry)
      emit({ type: 'log', data: entry })
      if (this.session === newSession) {
        newSession.status = 'error'
        emit({ type: 'error', status: 'error', message: message })
        // spawn 失败（pid=0）时不会再触发 exit，必须释放会话，否则后续 start 永远报"已在运行中"
        if (!newSession.pid) {
          emit({ type: 'stopped', status: 'error', message: message })
          this.session = null
        }
      }
    })

    proc.on('exit', (code, signal) => {
      const wasStoppedByUser = this.detachedByUser
      const text = `frpc 已退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`
      const entry: FrpLogEntry = { ts: new Date().toISOString(), stream: 'system', text }
      appendLog(newSession, entry)
      emit({ type: 'log', data: entry })
      if (this.session === newSession) {
        if (wasStoppedByUser || code === 0) {
          newSession.status = 'stopped'
        } else if (newSession.status !== 'auth_failed' && newSession.status !== 'tunnel_offline') {
          newSession.status = 'error'
        }
        emit({ type: 'stopped', status: newSession.status, message: text })
        this.session = null
      }
    })

    return { pid, remoteAddress: null }
  }

  private detachedByUser = false

  async stop(): Promise<void> {
    ++this.epoch
    const s = this.session
    if (!s) return
    this.detachedByUser = true
    try {
      s.proc.kill()
    } catch {
      /* ignore */
    }
    killProcessTree(s.pid)
    // 兜底：等进程退出 3s 超时则不再阻塞（exit 事件仍会触发）
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000)
      s.proc.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    // 保持 detachedByUser=true：迟到 3s 以上的退出也要被归类为"用户停止"而不是 error；下次 start() 时复位
  }

  /** 提供给渲染端订阅日志流（已通过 sink 集成，这里保留以备扩展）。 */
  onEvent(cb: FrpEventSink): () => void {
    this.sink = cb
    return () => {
      this.sink = null
    }
  }

  /** 同步内部状态以让事件监听器被销毁。 */
  dispose(): void {
    if (this.session) void this.stop()
    this.sink = null
  }
}

