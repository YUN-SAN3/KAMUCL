/**
 * voxlink/punch.ts — UDP 打洞控制包（移植自 voxlink/app-desktop/punch.go）
 *
 *   明文 5 字节格式：56 4C <type> <nonce_hi> <nonce_lo>    type: 1=PUNCH, 2=PUNCH_ACK
 * 判赢单向：收到 PUNCH 或 ACK 任一即成功。
 * 节奏：每 200ms 一轮、每轮 3 个 PUNCH；总超时 12s。
 * Windows：向未映射端口发 UDP 会触发 WSAECONNRESET，写错误必须忽略并重试。
 */
import dgram from 'node:dgram'
import crypto from 'node:crypto'

const PUNCH_MAGIC0 = 0x56
const PUNCH_MAGIC1 = 0x4c
const PUNCH_TYPE_PUNCH = 1
const PUNCH_TYPE_PUNCH_ACK = 2

export const PUNCH_INTERVAL_MS = 200
export const PUNCH_PER_ROUND = 3
export const PUNCH_TOTAL_TIMEOUT_MS = 12_000
export const PUNCH_RECV_POLL_MS = 500

export function punchBuildControl(type: number, nonce: number): Buffer {
  const out = Buffer.alloc(5)
  out[0] = PUNCH_MAGIC0
  out[1] = PUNCH_MAGIC1
  out[2] = type
  out[3] = (nonce >> 8) & 0xff
  out[4] = nonce & 0xff
  return out
}

/** 校验魔数与类型，返回 type。 */
export function punchParseControl(buf: Buffer): { type: number; nonce: number } | null {
  if (buf.length < 5 || buf[0] !== PUNCH_MAGIC0 || buf[1] !== PUNCH_MAGIC1) return null
  const t = buf[2]!
  if (t !== PUNCH_TYPE_PUNCH && t !== PUNCH_TYPE_PUNCH_ACK) return null
  const nonce = (buf[3]! << 8) | buf[4]!
  return { type: t, nonce }
}

/** 对收到的控制包构造 ACK 回包（回显 nonce）。 */
export function punchAckFor(received: Buffer): Buffer {
  let nonce = 0
  if (received.length >= 5) nonce = (received[3]! << 8) | received[4]!
  return punchBuildControl(PUNCH_TYPE_PUNCH_ACK, nonce)
}

/** 每个 socket 一个随机 nonce。 */
export function punchRandomNonce(): number {
  const b = crypto.randomBytes(2)
  return (b[0]! << 8) | b[1]!
}

/** 尽力发送：失败立即重试 3 次，错误全部吞掉。 */
export async function udpSendTo(conn: dgram.Socket | null, buf: Buffer, addr: { address: string; port: number } | null): Promise<void> {
  if (!conn || !addr) return
  for (let i = 0; i < 3; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        conn.send(buf, 0, buf.length, addr.port, addr.address, (err) => (err ? reject(err) : resolve()))
      })
      return
    } catch {
      // WSAECONNRESET 等：重试
    }
  }
}

/** 是否接受该来源（同 IP / IPv4 前 16 位一致）。 */
export function punchAcceptSource(expected: { address: string } | null, from: { address: string } | null): boolean {
  if (!expected || !from || !from.address) return false
  if (expected.address === from.address) return true
  const e4 = ipv4Prefix(expected.address)
  const f4 = ipv4Prefix(from.address)
  if (e4 && f4) return e4[0] === f4[0] && e4[1] === f4[1]
  return false
}

function ipv4Prefix(addr: string): number[] | null {
  const parts = addr.split('.')
  if (parts.length !== 4) return null
  const a = parseInt(parts[0]!, 10)
  const b = parseInt(parts[1]!, 10)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return [a, b]
}

/** 以 base 为中心、按 delta 步长生成 ±64 范围内的预测端口表。 */
export function predictedPortsAround(base: number, delta: number): number[] {
  if (base <= 0 || delta === 0) return []
  let step = delta
  if (step < 0) step = -step
  if (step > 64) step = 64
  if (step < 1) return []
  const seen = new Set<number>([base])
  const out: number[] = []
  for (let off = step; off <= 64; off += step) {
    for (const cand of [base + off, base - off]) {
      if (cand >= 1 && cand <= 65535 && !seen.has(cand)) {
        seen.add(cand)
        out.push(cand)
      }
    }
  }
  return out
}

export interface PuncherOptions {
  conn: dgram.Socket
  timeoutMs?: number
}

/** 单 socket 打洞器。 */
export class Puncher {
  readonly conn: dgram.Socket
  readonly nonce: number
  timeoutMs: number

  private target: { address: string; port: number } | null = null
  private predicted: { address: string; port: number }[] = []
  private won = false
  private actual: { address: string; port: number } | null = null
  private onPeer: ((addr: { address: string; port: number }) => void) | null = null
  private peerFired = false
  private wonCh: NodeJS.Timeout | null = null
  private wonResolvers: Array<() => void> = []
  private stopFlag = false
  private recvTimer: NodeJS.Timeout | null = null
  private onMsg: ((buf: Buffer, rinfo: dgram.RemoteInfo) => void) | null = null

  constructor(opts: PuncherOptions) {
    this.conn = opts.conn
    this.nonce = punchRandomNonce()
    this.timeoutMs = opts.timeoutMs ?? PUNCH_TOTAL_TIMEOUT_MS
  }

  setOnPeer(fn: (addr: { address: string; port: number }) => void): void {
    this.onPeer = fn
  }

  setTarget(addr: { address: string; port: number } | null): void {
    this.target = addr
  }

  setPredictedPorts(ports: number[]): void {
    if (!ports.length || !this.target) {
      this.predicted = []
      return
    }
    const seen = new Set<string>([`${this.target.address}:${this.target.port}`])
    const out: { address: string; port: number }[] = []
    for (const p of ports) {
      if (p < 1 || p > 65535) continue
      const a = { address: this.target.address, port: p }
      const k = `${a.address}:${a.port}`
      if (!seen.has(k)) {
        seen.add(k)
        out.push(a)
      }
    }
    this.predicted = out
  }

  /** 启动接收循环。 */
  start(): void {
    const onMsg = (buf: Buffer, rinfo: dgram.RemoteInfo): void => {
      if (this.stopFlag) return
      const ctrl = punchParseControl(buf)
      if (!ctrl) return
      const from = { address: rinfo.address, port: rinfo.port }
      if (!this.target || !punchAcceptSource(this.target, from)) return
      // 回 ACK
      void udpSendTo(this.conn, punchAckFor(buf), from)
      if (!this.peerFired && this.onPeer) {
        this.peerFired = true
        try { this.onPeer(from) } catch { /* ignore */ }
      }
      if (this.won) return
      this.won = true
      this.actual = from
      this.target = from
      this.signalWon()
    }
    this.onMsg = onMsg
    this.conn.on('message', onMsg)

    const poll = (): void => {
      if (this.stopFlag) return
      this.recvTimer = setTimeout(poll, PUNCH_RECV_POLL_MS)
    }
    poll()

    // 主动发送循环
    const pkt = punchBuildControl(PUNCH_TYPE_PUNCH, this.nonce)
    const blast = (): void => {
      if (this.stopFlag || this.won) return
      const t = this.target
      if (t) {
        for (let r = 0; r < PUNCH_PER_ROUND; r++) void udpSendTo(this.conn, pkt, t)
      }
      for (const a of this.predicted) {
        for (let r = 0; r < PUNCH_PER_ROUND; r++) void udpSendTo(this.conn, pkt, a)
      }
      setTimeout(blast, PUNCH_INTERVAL_MS)
    }
    setTimeout(blast, PUNCH_INTERVAL_MS)

    // 总超时
    setTimeout(() => this.stop(), this.timeoutMs)
  }

  /** 阻塞直到打洞成功 / 超时 / 外部取消。成功返回对端实际源地址。 */
  wait(): Promise<{ address: string; port: number }> {
    if (this.won && this.actual) return Promise.resolve(this.actual)
    return new Promise((resolve, reject) => {
      const finish = (): void => {
        if (this.actual) resolve(this.actual)
        else reject(new Error('punch: 已取消'))
      }
      this.wonResolvers.push(finish)
    })
  }

  private signalWon(): void {
    const list = this.wonResolvers
    this.wonResolvers = []
    for (const fn of list) fn()
  }

  /**
   * 停止打洞（幂等）。不关闭 socket —— socket 归调用方所有：
   * 多轮重试要在同一 socket 上继续打洞，成功后 socket 交给 RudpConn 接管，
   * 由调用方/RudpConn 负责最终 close（Go 版 stop 同样不 close fd）。
   */
  stop(): void {
    if (this.stopFlag) return
    this.stopFlag = true
    if (this.recvTimer) clearTimeout(this.recvTimer)
    if (this.onMsg) {
      try { this.conn.removeListener('message', this.onMsg) } catch { /* ignore */ }
      this.onMsg = null
    }
    try { this.conn.setRecvBufferSize?.(0) } catch { /* ignore */ }
    this.signalWon()
  }
}

/** 创建打洞 socket；preferredPort>0 时优先绑定（失败退随机）。 */
export async function punchListen(preferredPort: number): Promise<dgram.Socket> {
  if (preferredPort > 0 && preferredPort <= 65535) {
    try {
      const uc = dgram.createSocket('udp4')
      await new Promise<void>((resolve, reject) => {
        uc.once('error', reject)
        uc.bind(preferredPort, '0.0.0.0', () => {
          uc.removeListener('error', reject)
          resolve()
        })
      })
      return uc
    } catch {
      // 绑定失败，退随机
    }
  }
  const uc = dgram.createSocket('udp4')
  await new Promise<void>((resolve, reject) => {
    uc.once('error', reject)
    uc.bind(0, '0.0.0.0', () => {
      uc.removeListener('error', reject)
      resolve()
    })
  })
  return uc
}