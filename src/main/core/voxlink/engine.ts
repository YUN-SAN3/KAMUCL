/**
 * voxlink/engine.ts — 连接引擎编排：信令分发、UDP 打洞 → rudp 隧道 → 本地端口映射桥、
 * 直连探测与 MC 端口探测。玩家中继见 relay.ts。
 *
 * 移植自 voxlink/app-desktop/conn_engine.go + relay.go。所有时间常量与 Go 原值对齐。
 *
 * 角色分工：
 *   - guest：JoinRoom 成功自动开始 p2p（等 host 的 holepunch_offer → 发 punch_info →
 *     等 holepunch_mapped/齐射时刻 → 打洞 → rudp → 本地桥）。
 *   - host：收到 join_request 起 host 侧引擎（打洞 socket 绑 hostPort → STUN →
 *     签发 holepunch_offer → 收 punch_info 回 holepunch_mapped 并开始打洞 → lazy 桥）。
 */
import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'
import { ApiClient, APIError, CLIENT_TAG, DEFAULT_SERVER_URL, validateRoomCode } from './api'
import { quickNatType, STUN_SERVERS, StunMappedAddr, stunSampleSeries, stunDeltaFromSamples } from './stun'
import { Puncher, predictedPortsAround, punchListen } from './punch'
import { RudpConn, RudpTarget } from './rudp'
import { TcpBridge, pumpRelay, startHostLazyBridge, BridgeDownCb } from './bridge'
import { detectMcPorts, probeHostPort } from './mc_ports'
import { VoxlinkSession, SessionOptions } from './session'
import { defaultSettingsPath, loadSettings, saveSettings } from './settings'
import type { VoxlinkSettings } from './settings'

// ---- 常量对齐 Go 端 conn_engine.go ----
export const PHASE_P2P = 'p2p'
export const PHASE_DIRECT = 'direct'
export const PHASE_PRELAY = 'prelay'
export const STATUS_TRYING = 'trying'
export const STATUS_FAILED = 'failed'
export const STATUS_SUCCESS = 'success'

const OFFER_WAIT_MAPPED_MAX_MS = 5_000
const PUNCH_SYNC_MAX_WAIT_MS = 5_000
const PUNCH_CYCLE_INTERVAL_MS = 1_000
const PUNCH_CYCLE_ROT_EVERY = 5
const PUNCH_MAX_WAIT_BEFORE_TX_MS = 24_000
const HOST_PUNCH_LIFETIME_MS = 10 * 60 * 1000
const DIRECT_ATTEMPTS = 3
const DIRECT_DIAL_TIMEOUT_MS = 3_000
const DIRECT_RETRY_INTERVAL_MS = 2_000
const RELAY_REQUEST_TIMEOUT_MS = 20_000
const RELAY_PUNCH_TIMEOUT_MS = 15_000
const RELAY_SETUP_TIMEOUT_MS = 15_000

const ENGINE_SIGNALS = new Set([
  'join_request',
  'holepunch_offer',
  'holepunch_mapped',
  'punch_info',
  'peer_port',
  'disconnect',
  'relay_request',
  'relay_notify',
  'relay_accept',
  'relay_declined',
  'relay_setup',
  'relay_ready'
])

// ---- 信令消息类型 ----
export interface ConnState {
  phase: string
  status: string
  address: string
  detail: string
}

export interface RoomInfo {
  code: string
  name: string
  hostIp: string
  hostPort: number
  maxPlayers: number
  currentPlayers: number
  hasPassword: boolean
  category: string
  gameVersion: string
  loader: string
  clientType: string
  clientTag?: string
  expiresIn: number
  isHost: boolean
}

export interface LobbyRoom {
  code: string
  name: string
  hostIp?: string
  hostPort?: number
  currentPlayers?: number
  maxPlayers?: number
  hasPassword?: boolean
  category?: string
  gameVersion?: string
  loader?: string
  clientType?: string
  clientTag?: string
  natType?: string
}

// ---- App-level 状态 ----
export interface AppState {
  state: 'idle' | 'hosting' | 'in_room' | 'closed'
  code: string
  token: string
  isHost: boolean
  room: RoomInfo | null
}

export interface CreateRoomParams {
  name: string
  password?: string
  category?: string
  visible: boolean
  hostPort: number
  loader?: string
  gameVersion?: string
}

export interface JoinRoomParams {
  code: string
  password?: string
}

export interface CreateRoomResult {
  code: string
  hostToken: string
  name: string
  hostIp: string
  hostPort: number
  expiresIn: number
}

export interface JoinRoomResult {
  clientToken: string
  clientId: string
  room: RoomInfo
}

// ---- 引擎 ----

interface HostPeer {
  id: string
  puncher: Puncher | null
  rudp: RudpConn | null
  mapped: StunMappedAddr | null
  hostMapped: StunMappedAddr | null
  hostDelta: number
}

export type LogLevel = 'info' | 'warn' | 'error'

export type EmitFn = (event: string, data: unknown) => void
export type NetLogFn = (level: LogLevel, msg: string) => void

/** 创建 connEngine 的对外回调接口（解耦 settings/io 路径）。 */
export interface EngineDeps {
  api: ApiClient
  baseURL: () => string
  emit: EmitFn
  netLog: NetLogFn
}

export class ConnEngine extends EventEmitter {
  readonly deps: EngineDeps
  state: 'idle' | 'hosting' | 'in_room' | 'closed' = 'idle'
  code = ''
  token = ''
  isHost = false
  clientID = ''
  room: RoomInfo | null = null
  hostPort = 0
  hostIp = ''

  // guest 侧
  gCycle = 0
  gActive = false
  gOffer: Record<string, unknown> | null = null
  gMapped: StunMappedAddr | null = null
  gMappedCh: StunMappedAddr[] = []
  gMappedDelta = 0
  gPunchSock: dgram.Socket | null = null
  gPuncher: Puncher | null = null
  gRudp: RudpConn | null = null
  gBridge: TcpBridge | null = null
  gP2PDone = false

  // guest 中继
  rInFlight = false
  rDone = false
  rResult: Array<string> = []
  rSock: dgram.Socket | null = null
  rPuncher: Puncher | null = null
  rRudp: RudpConn | null = null
  rBridge: TcpBridge | null = null
  rConnectedHint = false
  rAsNodeStop: (() => void) | null = null

  // host 侧
  hPeers = new Map<string, HostPeer>()

  // 会话
  session: VoxlinkSession | null = null

  // 中继锁
  directMu = false

  constructor(deps: EngineDeps) {
    super()
    this.deps = deps
  }

  // ---- 状态 ----

  baseURL(): string {
    return this.deps.baseURL()
  }

  snapshotRoom(): RoomInfo | null {
    return this.room ? { ...this.room } : null
  }

  setState(state: AppState['state'], code: string, token: string, isHost: boolean, room: RoomInfo | null, s: VoxlinkSession | null): void {
    this.state = state
    this.code = code
    this.token = token
    this.isHost = isHost
    this.room = room
    this.session = s
  }

  currentHostPort(): number { return this.hostPort }

  // ---- 信令发送 ----

  async sendSignal(type: string, data: Record<string, unknown>, to: string): Promise<void> {
    if (!this.code || !this.token) throw new Error('会话未绑定')
    await this.deps.api.post(this.baseURL(), '/signal/send', {
      code: this.code,
      token: this.token,
      isHost: this.isHost,
      type,
      data,
      to
    }, null)
  }

  // ---- 信令分发 ----

  onSignal(type: string, from: string, data: Record<string, unknown>): void {
    if (!ENGINE_SIGNALS.has(type)) return
    if (!this.session || this.session.isDone()) return
    switch (type) {
      case 'join_request':
        if (this.isHost) void this.hostOnJoinRequest(from, data)
        break
      case 'holepunch_offer':
        if (!this.isHost) void this.guestOnOffer(from, data)
        break
      case 'holepunch_mapped':
        if (!this.isHost) void this.guestOnMapped(data)
        break
      case 'punch_info':
        if (this.isHost) void this.hostOnPunchInfo(from, data)
        break
      case 'peer_port':
        this.onPeerPort(data)
        break
      case 'disconnect':
        this.onPeerDisconnect(from)
        break
      case 'relay_request':
        if (this.isHost) void this.hostOnRelayRequest(from, data)
        break
      case 'relay_notify':
        if (!this.isHost) this.guestOnRelayNotify(from, data)
        break
      case 'relay_declined':
        if (!this.isHost) this.guestRelayFail('房主或中继者拒绝了中继请求')
        break
      case 'relay_setup':
        if (!this.isHost) void this.guestOnRelaySetup(from, data)
        break
      case 'relay_accept':
        this.deps.netLog('info', '中继节点已接受')
        break
      case 'relay_ready':
        this.deps.netLog('info', '房客中继就绪')
        break
    }
  }

  // ---- guest：p2p 打洞 ----

  private beginGuestCycle(): { gen: number; ok: boolean } {
    if (this.gActive || this.gP2PDone) return { gen: this.gCycle, ok: false }
    this.gActive = true
    this.gCycle += 1
    return { gen: this.gCycle, ok: true }
  }

  private endGuestCycle(): void {
    this.gActive = false
  }

  private genValid(gen: number): boolean {
    return this.session !== null && gen === this.gCycle
  }

  private async guestOnOffer(_from: string, data: Record<string, unknown>): Promise<void> {
    const { gen, ok } = this.beginGuestCycle()
    if (!ok) {
      this.deps.netLog('warn', '忽略重复/迟到的 holepunch_offer（周期进行中或已连通）')
      return
    }
    this.gOffer = { ...data }
    if (typeof data.hostIp === 'string' && data.hostIp) this.hostIp = data.hostIp
    if (typeof data.hostPort === 'number' && data.hostPort > 0) this.hostPort = data.hostPort
    if (typeof data.hostMappedIp === 'string' && data.hostMappedIp && typeof data.hostMappedPort === 'number' && data.hostMappedPort > 0) {
      this.gMapped = { ip: data.hostMappedIp, port: data.hostMappedPort }
    }
    if (typeof data.hostMappedPortDelta === 'number') this.gMappedDelta = data.hostMappedPortDelta
    const offer = { ...data }
    await this.guestPunchFlow(gen, offer)
  }

  private async guestPunchFlow(gen: number, offer: Record<string, unknown>): Promise<void> {
    try { await this._guestPunchFlow(gen, offer) } finally { this.endGuestCycle() }
  }

  private async _guestPunchFlow(gen: number, offer: Record<string, unknown>): Promise<void> {
    const sock = dgram.createSocket('udp4')
    await new Promise<void>((resolve, reject) => {
      sock.once('error', reject)
      sock.bind(0, '0.0.0.0', () => {
        sock.removeListener('error', reject)
        resolve()
      })
    })

    let mine: StunMappedAddr | null = null
    this.emitStage('stun', 'active', '正在通过 STUN 探测本机 NAT 映射…')
    try {
      const samples = await stunSampleSeries(sock, STUN_SERVERS, 3, 2, 1500)
      if (samples.length > 0) mine = samples[0]!
    } catch {
      this.deps.netLog('warn', 'STUN 探测全部失败，punch_info 不带映射地址')
    }
    if (mine) this.emitStage('stun', 'ok', 'NAT 映射探测完成')
    else this.emitStage('stun', 'degraded', 'STUN 探测失败，将按房主公告地址直接打洞')

    const punchData: Record<string, unknown> = {}
    if (mine) {
      punchData.joinerMappedIp = mine.ip
      punchData.joinerMappedPort = mine.port
    }
    const lip = getLocalIP()
    if (lip) punchData.joinerLocalIp = lip
    try { await this.sendSignal('punch_info', punchData, 'host') } catch (e) {
      this.deps.netLog('warn', `发送 punch_info 失败: ${(e as Error).message}`)
    }

    // 齐射时刻：host 墙钟+3000（容忍时钟差，最多等 5s）
    let startAt = Date.now()
    if (typeof offer.punchSyncTimeMs === 'number' && offer.punchSyncTimeMs > 0) {
      const d = offer.punchSyncTimeMs - Date.now()
      if (d > 0 && d <= PUNCH_SYNC_MAX_WAIT_MS) startAt = offer.punchSyncTimeMs
      else if (d > PUNCH_SYNC_MAX_WAIT_MS) this.deps.netLog('warn', `punchSyncTimeMs 时钟偏差过大（${d}ms），忽略齐射同步`)
    }

    // 等 holepunch_mapped（齐射时刻前；offer 已带 mapped 则到点即走）
    let waitDur = startAt - Date.now()
    if (waitDur < 0) waitDur = 0
    if (waitDur > OFFER_WAIT_MAPPED_MAX_MS) waitDur = OFFER_WAIT_MAPPED_MAX_MS
    let hostMapped: StunMappedAddr | null = null
    if (this.gMappedCh.length > 0) hostMapped = this.gMappedCh.shift()!
    if (!hostMapped && waitDur > 0) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, waitDur)
        const onMapped = (): void => { clearTimeout(t); resolve() }
        this.once('mapped', onMapped)
        if (this.gMappedCh.length > 0) { clearTimeout(t); onMapped() }
      })
      if (this.gMappedCh.length > 0) hostMapped = this.gMappedCh.shift()!
    }
    if (!hostMapped) hostMapped = this.gMapped

    // 目标选择
    let target: RudpTarget | null = null
    let predBase = 0, predDelta = 0
    const hostIp = this.hostIp, hostPort = this.hostPort
    const delta = this.gMappedDelta
    if (hostMapped) {
      target = { address: hostMapped.ip, port: hostMapped.port }
      predBase = hostMapped.port
      predDelta = delta
    } else if (hostIp && hostPort > 0) {
      target = { address: hostIp, port: hostPort }
    } else {
      try { sock.close() } catch { /* ignore */ }
      this.deps.netLog('error', 'holepunch_offer 缺少可用目标地址')
      this.emitConnState(PHASE_P2P, STATUS_FAILED, '', '缺少打洞目标地址')
      return
    }

    const punchOnPeer = (addr: { address: string; port: number }): void => {
      void this.sendSignal('peer_port', { peer_ip: addr.address, peer_port: addr.port }, 'host')
    }

    this.gPunchSock = sock
    this.emitStage('punch', 'active', 'UDP 打洞进行中（通常几秒，持续约 20 秒未成功会出现手动后备）')

    let predictStep = predDelta
    if (predictStep === 0) predictStep = 1
    if (predictStep < 0) predictStep = -predictStep

    let cycle = 0
    while (true) {
      if (!this.genValid(gen)) { try { sock.close() } catch { /* ignore */ }; return }
      if (this.gP2PDone) { try { sock.close() } catch { /* ignore */ }; return }

      let curTarget: RudpTarget = target
      let curMapped = this.gMapped
      let curDelta = this.gMappedDelta
      if (curMapped) {
        curTarget = { address: curMapped.ip, port: curMapped.port }
        predBase = curMapped.port
        predDelta = curDelta
      }

      if (cycle > 0 && cycle % PUNCH_CYCLE_ROT_EVERY === 0) {
        if ((cycle / PUNCH_CYCLE_ROT_EVERY) % 2 === 1) {
          if (predictStep > 1) predictStep -= 1
        } else {
          if (predictStep < 64) predictStep += 1
        }
      }

      const p = new Puncher({ conn: sock, timeoutMs: PUNCH_MAX_WAIT_BEFORE_TX_MS })
      p.setTarget(curTarget)
      if (predDelta !== 0) p.setPredictedPorts(predictedPortsAround(predBase, predictStep))
      p.setOnPeer(punchOnPeer)
      this.gPuncher = p

      // 等齐射
      if (cycle === 0) {
        const d = startAt - Date.now()
        if (d > 0) await new Promise<void>((resolve) => setTimeout(resolve, d))
      }
      if (!this.genValid(gen)) { p.stop(); try { sock.close() } catch { /* ignore */ }; return }
      p.start()
      let actual: { address: string; port: number }
      try {
        actual = await p.wait()
      } catch {
        this.gPuncher = null
        p.stop()
        cycle += 1
        this.emitStage('punch', 'retry', `第 ${cycle} 轮打洞未命中，调整端口预测继续尝试`)
        await new Promise<void>((resolve) => setTimeout(resolve, PUNCH_CYCLE_INTERVAL_MS))
        continue
      }

      if (!this.genValid(gen)) { try { sock.close() } catch { /* ignore */ }; return }
      if (this.gP2PDone) { try { sock.close() } catch { /* ignore */ }; return }

      const rc = new RudpConn(sock!, actual)
      rc.start()
      let guestBridge: TcpBridge | null = null
      let localAddr = ''
      try {
        const started = await TcpBridge.startGuest(rc, () => this.guestBridgeDown())
        guestBridge = started.bridge
        localAddr = started.addr
      } catch (e) {
        rc.close()
        this.emitConnState(PHASE_P2P, STATUS_FAILED, '', `本地桥建立失败：${(e as Error).message}`)
        return
      }
      if (this.gP2PDone) {
        rc.close()
        guestBridge.stop()
        return
      }
      // 修复：成功后释放打洞器的接收循环（原先从不 stop，500ms 轮询定时器泄漏）；
      // socket 交由 rudp 接管，stop() 不再关闭 socket。
      p.stop()
      this.gPuncher = null
      this.gPunchSock = null
      this.gRudp = rc
      this.gBridge = guestBridge
      this.gP2PDone = true
      this.deps.netLog('info', 'P2P 打洞成功，rudp 隧道已建立')
      this.emitStage('punch', 'ok', 'UDP 打洞成功，数据隧道已建立')
      const directAddr = `${hostIp}:${hostPort}`
      this.emitConnState(PHASE_P2P, STATUS_SUCCESS, directAddr, `本地代理 ${localAddr}`)
      return
    }
  }

  private async guestOnMapped(data: Record<string, unknown>): Promise<void> {
    const ip = typeof data.hostMappedIp === 'string' ? data.hostMappedIp : ''
    const port = typeof data.hostMappedPort === 'number' ? data.hostMappedPort : 0
    if (!ip || port <= 0) return
    const m: StunMappedAddr = { ip, port }
    this.gMapped = m
    if (typeof data.hostMappedPortDelta === 'number') this.gMappedDelta = data.hostMappedPortDelta
    const puncher = this.gPuncher
    const d = this.gMappedDelta
    this.gMappedCh.push(m)
    this.emit('mapped', m)
    if (puncher && d) {
        puncher.setTarget({ address: ip, port })
        puncher.setPredictedPorts(predictedPortsAround(port, d))
    }
  }

  private onPeerPort(data: Record<string, unknown>): void {
    const ip = typeof data.peer_ip === 'string' ? data.peer_ip : ''
    const port = typeof data.peer_port === 'number' ? data.peer_port : 0
    if (!ip || port <= 0) return
    const addr = { address: ip, port }
    if (this.gPuncher) this.gPuncher.setTarget(addr)
  }

  private guestBridgeDown(): void {
    const rc = this.gRudp
    const bridge = this.gBridge
    this.gRudp = null
    this.gBridge = null
    this.gP2PDone = false
    this.gActive = false
    if (bridge) bridge.stop()
    if (rc) try { rc.close() } catch { /* ignore */ }
    this.deps.netLog('warn', 'MC 隧道已断开，将重新尝试打洞')
  }

  private onPeerDisconnect(from: string): void {
    if (this.isHost) {
      const p = this.hPeers.get(from)
      this.hPeers.delete(from)
      if (p) {
        p.puncher?.stop()
        if (p.rudp) try { p.rudp.close() } catch { /* ignore */ }
        this.deps.netLog('info', '对端已断开')
      }
      return
    }
    const rc = this.gRudp, bridge = this.gBridge, puncher = this.gPuncher
    const sock = this.gPunchSock
    this.gRudp = null
    this.gBridge = null
    this.gPunchSock = null
    this.gP2PDone = false
    this.gActive = false
    if (puncher) puncher.stop()
    // 修复：stop() 不再隐式关闭 socket，房主断开时要显式关闭打洞 socket
    if (sock) try { sock.close() } catch { /* ignore */ }
    if (bridge) bridge.stop()
    if (rc) try { rc.close() } catch { /* ignore */ }
    this.deps.netLog('warn', '房主已断开，将重新尝试打洞')
  }

  // ---- host：打洞应答与桥接 ----

  private async hostOnJoinRequest(from: string, _data: Record<string, unknown>): Promise<void> {
    const existing = this.hPeers.get(from)
    if (existing && (existing.rudp || existing.puncher)) {
      this.deps.netLog('warn', '忽略重复 join_request')
      return
    }
    const peer: HostPeer = { id: from, puncher: null, rudp: null, mapped: null, hostMapped: null, hostDelta: 0 }
    this.hPeers.set(from, peer)
    const hostPort = this.hostPort
    if (hostPort <= 0) {
      this.deps.netLog('error', '收到 join_request 但缺少房间 hostPort')
      this.dropHostPeer(peer)
      return
    }
    await this.hostServeJoin(peer, hostPort)
  }

  private dropHostPeer(peer: HostPeer): void {
    const cur = this.hPeers.get(peer.id)
    if (cur === peer && !cur.rudp) this.hPeers.delete(peer.id)
  }

  private async hostServeJoin(peer: HostPeer, hostPort: number): Promise<void> {
    const sock = await punchListen(hostPort)

    this.emitStage('host_stun', 'active', '房主：正在通过 STUN 探测 NAT 映射…')
    let hostMapped: StunMappedAddr | null = null
    let hostDelta = 0
    try {
      const samples = await stunSampleSeries(sock, STUN_SERVERS, 2, 2, 1500)
      if (samples.length > 0) hostMapped = samples[0]!
      hostDelta = stunDeltaFromSamples(samples)
    } catch { /* ignore */ }
    this.emitStage('host_stun', hostMapped ? 'ok' : 'degraded', hostMapped ? '房主 NAT 映射探测完成' : '房主 STUN 探测失败，将在邀请中省略映射地址')

    const offer: Record<string, unknown> = { hostPort }
    if (this.hostIp) offer.hostIp = this.hostIp
    const lip = getLocalIP()
    if (lip) offer.hostLocalIp = lip
    if (hostMapped) {
      offer.hostMappedIp = hostMapped.ip
      offer.hostMappedPort = hostMapped.port
      if (hostDelta !== 0) offer.hostMappedPortDelta = hostDelta
    }
    peer.hostMapped = hostMapped
    peer.hostDelta = hostDelta
    offer.punchSyncTimeMs = Date.now() + 3_000

    try {
      await this.sendSignal('holepunch_offer', offer, peer.id)
    } catch (e) {
      this.deps.netLog('warn', `发送 holepunch_offer 失败: ${(e as Error).message}`)
      try { sock.close() } catch { /* ignore */ }
      this.dropHostPeer(peer)
      return
    }

    const puncher = new Puncher({ conn: sock, timeoutMs: HOST_PUNCH_LIFETIME_MS })
    puncher.setOnPeer((addr) => {
      void this.sendSignal('peer_port', { peer_ip: addr.address, peer_port: addr.port }, peer.id)
    })
    peer.puncher = puncher
    puncher.start()
    this.deps.netLog('info', '已签发 holepunch_offer，等待房客穿透')
    this.emitStage('host_punch', 'active', '已签发打洞邀请，等待与房客打通…')

    let actual: { address: string; port: number }
    try {
      actual = await puncher.wait()
    } catch {
      try { sock.close() } catch { /* ignore */ }
      const cur = this.hPeers.get(peer.id)
      if (cur === peer && !cur.rudp) this.hPeers.delete(peer.id)
      this.deps.netLog('warn', 'host 打洞未成功')
      this.emitStage('host_punch', 'fail', '与房客打洞未成功，等待房客重试或改用后备方式')
      return
    }
    // 成功后停止打洞接收循环；socket 交由 rudp 接管（stop 不再关闭 socket）
    puncher.stop()
    const rc = new RudpConn(sock!, actual)
    rc.start()
    const cur = this.hPeers.get(peer.id)
    if (cur !== peer) { rc.close(); return }
    peer.rudp = rc
    this.deps.netLog('info', 'host 端 rudp 隧道已建立，等待 MC 握手')
    this.emitStage('host_punch', 'ok', '房客数据隧道已建立')
    void startHostLazyBridge(rc, this.hostPort, this.deps.netLog)
  }

  private async hostOnPunchInfo(from: string, data: Record<string, unknown>): Promise<void> {
    const ip = typeof data.joinerMappedIp === 'string' ? data.joinerMappedIp : ''
    const port = typeof data.joinerMappedPort === 'number' ? data.joinerMappedPort : 0
    const peer = this.hPeers.get(from)
    if (!peer) return
    if (ip && port > 0) peer.mapped = { ip, port }

    const mappedData: Record<string, unknown> = {}
    if (peer.hostMapped) {
      mappedData.hostMappedIp = peer.hostMapped.ip
      mappedData.hostMappedPort = peer.hostMapped.port
      mappedData.hostMappedPorts = [peer.hostMapped.port]
      if (peer.hostDelta !== 0) mappedData.hostMappedPortDelta = peer.hostDelta
    }
    const lip = getLocalIP()
    if (lip) mappedData.hostLocalIp = lip
    try { await this.sendSignal('holepunch_mapped', mappedData, from) } catch (e) {
      this.deps.netLog('warn', `发送 holepunch_mapped 失败: ${(e as Error).message}`)
    }
    if (peer.puncher && peer.mapped) peer.puncher.setTarget({ address: peer.mapped.ip, port: peer.mapped.port })
  }

  // ---- TryDirect 直连探测 ----

  tryDirect(): { ok: boolean; err?: string } {
    if (!this.session) return { ok: false, err: '当前没有房间会话' }
    if (this.directMu) return { ok: false, err: '直连探测已在进行中' }
    this.directMu = true
    void (async (): Promise<void> => {
      try {
        this.emitConnState(PHASE_DIRECT, STATUS_TRYING, '', '')
        const hostIp = this.hostIp, hostPort = this.hostPort
        if (!hostIp || hostPort <= 0) {
          this.deps.netLog('warn', '直连探测缺少目标')
          this.emitConnState(PHASE_DIRECT, STATUS_FAILED, '', '缺少房主地址（尚未收到 holepunch_offer）')
          return
        }
        const target = `${hostIp}:${hostPort}`
        for (let i = 0; i < DIRECT_ATTEMPTS; i++) {
          const ok2 = await this.tcpProbe(target, DIRECT_DIAL_TIMEOUT_MS)
          if (ok2) {
            this.deps.netLog('info', '直连探测成功')
            this.emitConnState(PHASE_DIRECT, STATUS_SUCCESS, target, '')
            return
          }
          this.deps.netLog('warn', '直连探测未通')
          if (i < DIRECT_ATTEMPTS - 1) {
            await new Promise<void>((r) => setTimeout(r, DIRECT_RETRY_INTERVAL_MS))
            if (!this.session || this.session.isDone()) return
          }
        }
        this.emitConnState(PHASE_DIRECT, STATUS_FAILED, '', '直连探测未通')
      } finally {
        this.directMu = false
      }
    })()
    return { ok: true }
  }

  private tcpProbe(target: string, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const [host, portStr] = target.split(':')
      const port = parseInt(portStr ?? '0', 10)
      try {
        const sock = new (require('node:net').Socket)()
        let done = false
        const finish = (v: boolean): void => {
          if (done) return
          done = true
          try { sock.destroy() } catch { /* ignore */ }
          resolve(v)
        }
        sock.setTimeout(timeoutMs)
        sock.once('connect', () => finish(true))
        sock.once('error', () => finish(false))
        sock.once('timeout', () => finish(false))
        sock.connect(port, host)
      } catch {
        resolve(false)
      }
    })
  }

  // ---- UsePlayerRelay ----

  usePlayerRelay(): { ok: boolean; err?: string } {
    if (!this.session) return { ok: false, err: '当前没有房间会话' }
    if (this.isHost) return { ok: false, err: '房主无需玩家中继' }
    if (this.rInFlight || this.rDone) return { ok: false, err: '玩家中继已在进行中' }

    // 修复：失效当前 p2p 打洞周期（gen+1），否则打洞循环会与下面的中继打洞
    // 共用同一个 socket 互相干扰（Go 版通过取消 context 实现，这里对齐为代次失效）。
    this.gCycle += 1
    this.gActive = false
    if (this.gPuncher && !this.gP2PDone) {
      this.gPuncher.stop()
      this.gPuncher = null
    }
    // 打洞循环退出时会 close 自己持有的 sock；这里清引用，中继打洞改用全新 socket。
    this.gPunchSock = null
    this.rInFlight = true
    this.rResult = []
    this.rDone = false

    this.emitConnState(PHASE_PRELAY, STATUS_TRYING, '', '')
    this.emitStage('relay', 'active', '已请求玩家中继，等待房主派发中继节点（约 20 秒超时）')
    void this.sendSignal('relay_request', { clientId: this.clientID }, 'host').then(() => {
      this.deps.netLog('info', '已发送 relay_request，等待房主派发中继…')
    }).catch((e) => {
      this.guestRelayFail(`发送中继请求失败: ${(e as Error).message}`)
    })

    void (async (): Promise<void> => {
      // 修复：原实现超时后 interval 永远不清除（另有一处裸 `clearInterval` 死语句），定时器泄漏
      const winner = await new Promise<string | null>((resolve) => {
        let done = false
        const finish = (v: string | null): void => {
          if (done) return
          done = true
          clearTimeout(timer)
          clearInterval(check)
          resolve(v)
        }
        const check = setInterval(() => {
          if (this.rResult.length > 0) finish(this.rResult.shift() || null)
        }, 100)
        const timer = setTimeout(() => finish('TIMEOUT'), RELAY_REQUEST_TIMEOUT_MS)
      })
      if (winner === 'TIMEOUT') this.guestRelayFail('中继请求超时（20s 无响应）')
    })()

    return { ok: true }
  }

  private relayResultChanSend(addr: string): void {
    if (addr) this.rResult.push(addr)
  }

  private guestRelayFail(reason: string): void {
    if (this.rDone) return
    this.rDone = true
    this.rInFlight = false
    const sock = this.rSock, puncher = this.rPuncher, rudp = this.rRudp, bridge = this.rBridge
    this.rSock = null
    this.rPuncher = null
    this.rRudp = null
    this.rBridge = null
    puncher?.stop()
    bridge?.stop()
    if (rudp) try { rudp.close() } catch { /* ignore */ }
    if (sock) try { sock.close() } catch { /* ignore */ }
    this.deps.netLog('warn', `玩家中继失败: ${reason}`)
    this.emitStage('relay', 'fail', `玩家中继失败：${reason}`)
    this.emitConnState(PHASE_PRELAY, STATUS_FAILED, '', reason)
  }

  private guestOnRelayNotify(from: string, data: Record<string, unknown>): void {
    if (from !== 'host' && from !== '') return
    const ip = typeof data.relayIp === 'string' ? data.relayIp : ''
    const port = typeof data.relayPort === 'number' ? data.relayPort : 0
    if (ip && port > 0) {
      this.deps.netLog('info', '收到 relay_notify，开始打洞')
      void this.relayPunchFlow(ip, port)
      return
    }
    if (data.connected === true) {
      this.rConnectedHint = true
      const already = this.rRudp !== null
      this.deps.netLog('info', '收到 relay_notify(connected)：中继链路就绪')
      if (already) {
        const b = this.relayBridgeAddr()
        if (b) this.relaySuccess(b)
      }
    }
  }

  private relaySuccess(addr: string): void {
    if (this.rDone) return
    this.rDone = true
    this.rInFlight = false
    this.deps.netLog('info', '中继链路就绪')
    this.emitStage('relay', 'ok', '玩家中继链路已建立')
    this.emitConnState(PHASE_PRELAY, STATUS_SUCCESS, addr, '')
    void this.sendSignal('relay_ready', { clientId: this.clientID }, 'host')
    this.relayResultChanSend(addr)
  }

  private relayBridgeAddr(): string {
    if (this.rBridge && this.rBridge.ln) {
      const a = this.rBridge.ln.address() as { address: string; port: number }
      return `${a.address}:${a.port}`
    }
    return ''
  }

  private async relayPunchFlow(relayIP: string, relayPort: number): Promise<void> {
    if (this.rDone || !this.session) return
    let sock = this.gPunchSock
    const reused = !!sock && !this.gRudp && !this.gPuncher
    if (!reused) {
      sock = dgram.createSocket('udp4')
      await new Promise<void>((resolve, reject) => {
        sock!.once('error', reject)
        sock!.bind(0, '0.0.0.0', () => {
          sock!.removeListener('error', reject)
          resolve()
        })
      })
    }
    const target = { address: relayIP, port: relayPort }
    const p = new Puncher({ conn: sock!, timeoutMs: RELAY_PUNCH_TIMEOUT_MS })
    p.setTarget(target)
    p.start()
    this.emitStage('relay', 'active', '已获得中继节点，正在与中继节点打洞…')
    let actual: { address: string; port: number }
    try { actual = await p.wait() } catch (e) {
      if (!reused) try { sock!.close() } catch { /* ignore */ }
      this.guestRelayFail(`中继打洞失败（${(e as Error).message}）`)
      return
    }
    // 成功后停止打洞接收循环；socket 交由 rudp 接管（stop 不再关闭 socket）
    p.stop()
    const rc = new RudpConn(sock!, actual)
    rc.start()
    let guestBridge: TcpBridge | null = null
    let local = ''
    try {
      const started = await TcpBridge.startGuest(rc, () => this.relayBridgeDown())
      guestBridge = started.bridge
      local = started.addr
    } catch (e) {
      rc.close()
      this.guestRelayFail(`中继本地桥建立失败: ${(e as Error).message}`)
      return
    }
    this.rSock = sock
    this.rPuncher = null
    this.rRudp = rc
    this.rBridge = guestBridge
    this.deps.netLog('info', '中继隧道建立')
    this.relaySuccess(local)
  }

  private relayBridgeDown(): void {
    const rc = this.rRudp, bridge = this.rBridge
    this.rRudp = null
    this.rBridge = null
    bridge?.stop()
    if (rc) try { rc.close() } catch { /* ignore */ }
    this.emitStage('relay', 'fail', '中继隧道已断开')
    this.emitConnState(PHASE_PRELAY, STATUS_FAILED, '', '中继隧道已断开')
  }

  private async hostOnRelayRequest(from: string, _data: Record<string, unknown>): Promise<void> {
    this.deps.netLog('info', '收到 relay_request')
    const requester = this.hPeers.get(from)
    const selfID = this.clientID
    const roomCode = this.code
    if (!requester || !requester.mapped) {
      this.deps.netLog('warn', 'relay_request 但缺少 requester 映射地址，拒绝')
      try { await this.sendSignal('relay_declined', {}, from) } catch { /* ignore */ }
      return
    }
    let cands: RelayCandidate[] = []
    try { cands = await this.fetchRelayCandidates(roomCode) } catch (e) {
      this.deps.netLog('warn', `查询中继候选失败: ${(e as Error).message}`)
    }
    const cand = this.pickRelayCandidate(cands, from, selfID)
    if (!cand) {
      this.deps.netLog('warn', '无可用中继候选，拒绝 relay_request')
      try { await this.sendSignal('relay_declined', {}, from) } catch { /* ignore */ }
      return
    }
    const setup: Record<string, unknown> = {
      targetClientId: from,
      targetIp: requester.mapped.ip,
      targetPort: requester.mapped.port
    }
    try { await this.sendSignal('relay_setup', setup, cand.clientId) } catch (e) {
      this.deps.netLog('warn', `发送 relay_setup 失败: ${(e as Error).message}`)
    }
    const notify: Record<string, unknown> = { relayIp: cand.mappedIp, relayPort: cand.mappedPort }
    try { await this.sendSignal('relay_notify', notify, from) } catch (e) {
      this.deps.netLog('warn', `发送 relay_notify 失败: ${(e as Error).message}`)
    }
    this.deps.netLog('info', '中继派发完成')
  }

  private async fetchRelayCandidates(_roomCode: string): Promise<RelayCandidate[]> {
    const raw = await this.deps.api.get(this.baseURL(), '/relay/candidates', {}, {}) as { candidates?: RelayCandidate[] }
    return raw?.candidates ?? []
  }

  private pickRelayCandidate(cands: RelayCandidate[], requesterID: string, selfID: string): RelayCandidate | null {
    for (const c of cands) {
      if (!c.clientId || c.clientId === requesterID || c.clientId === selfID) continue
      if (!c.mappedIp || !c.mappedPort) continue
      const nt = (c.natType || '').toLowerCase()
      if (!nt || nt.includes('sym') || nt.includes('strict') || nt.includes('unknown')) continue
      return c
    }
    return null
  }

  private async guestOnRelaySetup(from: string, data: Record<string, unknown>): Promise<void> {
    const targetClientID = typeof data.targetClientId === 'string' ? data.targetClientId : ''
    const targetIP = typeof data.targetIp === 'string' ? data.targetIp : ''
    const targetPort = typeof data.targetPort === 'number' ? data.targetPort : 0
    const hostRudp = this.gRudp
    if (!hostRudp || !targetIP || targetPort <= 0) {
      this.deps.netLog('warn', '收到 relay_setup 但无到 host 的隧道，declined')
      try { await this.sendSignal('relay_declined', {}, 'host') } catch { /* ignore */ }
      return
    }
    this.deps.netLog('info', '受托为中继节点')
    await (async (): Promise<void> => {
      const sock = dgram.createSocket('udp4')
      await new Promise<void>((resolve, reject) => {
        sock.once('error', reject)
        sock.bind(0, '0.0.0.0', () => {
          sock.removeListener('error', reject)
          resolve()
        })
      })
      const target = { address: targetIP, port: targetPort }
      const p = new Puncher({ conn: sock, timeoutMs: RELAY_SETUP_TIMEOUT_MS })
      p.setTarget(target)
      p.start()
      let actual: { address: string; port: number }
      try { actual = await p.wait() } catch {
        try { sock.close() } catch { /* ignore */ }
        this.deps.netLog('warn', '中继节点对 target 打洞失败')
        try { await this.sendSignal('relay_declined', {}, 'host') } catch { /* ignore */ }
        return
      }
      // 成功后停止打洞接收循环；socket 交由 rudp 接管（stop 不再关闭 socket）
      p.stop()
      const targetRc = new RudpConn(sock, actual)
      targetRc.start()
      const stop = pumpRelay(hostRudp, targetRc)
      this.rAsNodeStop = stop
      try { await this.sendSignal('relay_accept', { forClientId: targetClientID }, 'host') } catch (e) {
        this.deps.netLog('warn', `发送 relay_accept 失败: ${(e as Error).message}`)
      }
      this.deps.netLog('info', '中继桥已建立')
    })()
  }

  /** 中继资源释放钩子（保留便于未来 TURN 接入）。 */
  relayRelease(): void { /* no-op for player relay */ }

  // ---- 状态推送 ----

  private emitConnState(phase: string, status: string, address: string, detail: string): void {
    if (!this.session) return
    this.deps.emit('conn:state', { phase, status, address, detail } satisfies ConnState)
  }

  /**
   * 关键阶段事件（'stage'）：驱动面板「连接过程」阶段条逐步点亮。
   * 仅补充本地事件发射，不改变任何信令/协议行为；detail 不含远程地址（消敏）。
   */
  private emitStage(
    key: 'stun' | 'punch' | 'relay' | 'host_stun' | 'host_punch',
    status: 'active' | 'retry' | 'ok' | 'degraded' | 'fail',
    detail: string
  ): void {
    if (!this.session) return
    this.deps.emit('stage', { key, status, detail, ts: Date.now() })
  }

  // ---- 解绑 ----

  teardown(): void {
    const gPuncher = this.gPuncher, gSock = this.gPunchSock, gRudp = this.gRudp, gBridge = this.gBridge
    const rPuncher = this.rPuncher, rSock = this.rSock, rRudp = this.rRudp, rBridge = this.rBridge
    const asNodeStop = this.rAsNodeStop
    const peers = Array.from(this.hPeers.values())

    const sendBye = this.session !== null && this.code !== '' && this.token !== ''
    const byeCode = this.code, byeToken = this.token, byeBase = this.baseURL()
    const byeIsHost = this.isHost
    const byeTo = byeIsHost ? '' : 'host'

    this.code = ''
    this.token = ''
    this.clientID = ''
    this.isHost = false
    this.hostPort = 0
    this.hostIp = ''
    this.gOffer = null
    this.gMapped = null
    this.gPunchSock = null
    this.gPuncher = null
    this.gRudp = null
    this.gBridge = null
    this.gP2PDone = false
    this.gActive = false
    this.gMappedCh = []
    this.rInFlight = false
    this.rDone = false
    this.rSock = null
    this.rPuncher = null
    this.rRudp = null
    this.rBridge = null
    this.rConnectedHint = false
    this.rAsNodeStop = null
    this.hPeers.clear()

    if (sendBye) {
      void this.deps.api.post(byeBase, '/signal/send', {
        code: byeCode, token: byeToken, isHost: byeIsHost, type: 'disconnect', data: {}, to: byeTo
      }, null).catch(() => { /* ignore */ })
    }
    gPuncher?.stop()
    if (gSock) try { gSock.close() } catch { /* ignore */ }
    gBridge?.stop()
    if (gRudp) try { gRudp.close() } catch { /* ignore */ }
    rPuncher?.stop()
    if (rSock) try { rSock.close() } catch { /* ignore */ }
    rBridge?.stop()
    if (rRudp) try { rRudp.close() } catch { /* ignore */ }
    if (asNodeStop) try { asNodeStop() } catch { /* ignore */ }
    for (const p of peers) {
      p.puncher?.stop()
      if (p.rudp) try { p.rudp.close() } catch { /* ignore */ }
    }
  }
}

export interface RelayCandidate {
  clientId: string
  roomCode: string
  natType: string
  mappedIp: string
  mappedPort: number
}

function getLocalIP(): string {
  const dgram = require('node:dgram') as typeof import('node:dgram')
  const sock = dgram.createSocket('udp4')
  try {
    sock.connect(80, '8.8.8.8')
    const a = sock.address()
    if (typeof a === 'object' && 'address' in a) return a.address
    return ''
  } catch { return '' } finally { try { sock.close() } catch { /* ignore */ } }
}

/** ---- 顶层 VoxlinkApp（对外 18 个能力 + 引擎编排） ---- */

export interface AppOptions {
  settings?: VoxlinkSettings
}

export class VoxlinkApp {
  readonly api: ApiClient
  readonly engine: ConnEngine
  settings: VoxlinkSettings
  state: 'idle' | 'hosting' | 'in_room' | 'closed' = 'idle'
  room: RoomInfo | null = null
  settingsPath: string

  constructor(opts: AppOptions = {}) {
    this.settings = opts.settings ?? loadSettings()
    this.settingsPath = defaultSettingsPath()
    this.api = new ApiClient({ userAgent: `KAMUCL-App/${'1.1.4-beta'}` })
    this.engine = new ConnEngine({
      api: this.api,
      baseURL: () => DEFAULT_SERVER_URL,
      emit: (ev, data) => this.emit(ev, data),
      netLog: (level, msg) => this.netLog(level, msg)
    })
    // 把 session 的信令桥接给引擎
    this.engine.on('roomInfo', (info) => this.updateRoomInfo(info as { currentPlayers: number; name: string }))
  }

  /** emit / netLog 暴露给主进程包装；这里只暴露接口。 */
  emit(_event: string, _data: unknown): void { /* hook */ }
  netLog(_level: LogLevel, _msg: string): void { /* hook */ }

  baseURL(): string { return DEFAULT_SERVER_URL }

  // ---- 1. GetSettings ----
  getSettingsJSON(): { serverUrl: string; theme: string; version: string } {
    return { serverUrl: DEFAULT_SERVER_URL, theme: this.settings.theme, version: '1.1.4-beta' }
  }

  // ---- 2. SaveSettings ----
  saveSettingsJSON(payload: { theme?: string }): { serverUrl: string; theme: string; version: string } {
    if (payload.theme) this.settings.theme = payload.theme
    saveSettings(this.settings, this.settingsPath)
    return this.getSettingsJSON()
  }

  /** 仅修改允许被中继开关。 */
  setAllowRelay(allow: boolean): VoxlinkSettings {
    this.settings.allowRelay = !!allow
    saveSettings(this.settings, this.settingsPath)
    return this.settings
  }

  // ---- 3. GetCategories ----
  async getCategories(): Promise<Record<string, string>> {
    return (await this.api.get(this.baseURL(), '/categories', {}, {}) ?? {}) as Record<string, string>
  }

  // ---- 4. ListRooms ----
  async listRooms(query: { page?: number; size?: number; category?: string; loader?: string; search?: string }): Promise<{ rooms: LobbyRoom[]; total: number; page: number; size: number }> {
    const page = query.page && query.page > 0 ? query.page : 1
    const size = query.size && query.size > 0 ? query.size : 20
    const q: Record<string, number | string> = { page, size, clientType: 'mod' }
    if (query.category) q.category = query.category
    if (query.loader) q.loader = query.loader
    const raw = await this.api.get(this.baseURL(), '/room/list', q, {}) as { rooms: LobbyRoom[]; total: number; page: number; size: number }
    let rooms = raw.rooms || []
    if (query.search) {
      const needle = query.search.toLowerCase()
      rooms = rooms.filter((r) => (r.name || '').toLowerCase().includes(needle))
    }
    return { rooms, total: rooms.length, page, size }
  }

  // ---- 5. RoomInfo ----
  async roomInfo(code: string): Promise<Record<string, unknown>> {
    if (!code) throw new APIError('INVALID_PARAMS', '房间码不能为空', 0)
    return (await this.api.get(this.baseURL(), '/room/info', { code }, {}) ?? {}) as Record<string, unknown>
  }

  // ---- 6. CreateRoom ----
  async createRoom(req: CreateRoomParams): Promise<CreateRoomResult> {
    if (!req.name.trim()) throw new APIError('INVALID_PARAMS', '房间名不能为空', 0)
    if (req.hostPort < 1024 || req.hostPort > 65535) throw new APIError('INVALID_PARAMS', 'hostPort 必须在 1024-65535 之间', 0)
    const loader = (req.loader || '').trim() || 'unknown'
    const gameVersion = (req.gameVersion || '').trim() || 'unknown'
    if (this.state !== 'idle') throw new APIError('SESSION_ACTIVE', '请先退出当前房间再操作', 0)

    // 端口探测
    try { await probeHostPort(req.hostPort) } catch {
      throw new APIError('PORT_NOT_LISTENING', `端口 ${req.hostPort} 没有服务在监听，请先在 MC 开好局域网或启动服务端`, 0)
    }

    const natType = await quickNatType()
    const body: Record<string, unknown> = {
      name: req.name,
      maxPlayers: 20,
      hostPort: req.hostPort,
      natType,
      visible: req.visible,
      category: req.category || '',
      gameVersion,
      loader,
      clientType: 'app',
      clientProtocolVersion: 7,
      clientCapabilities: ['relay', 'continuous_retry'],
      clientTag: CLIENT_TAG,
      client_tag: CLIENT_TAG
    }
    if (req.password) body.password = req.password

    const data = await this.api.post(this.baseURL(), '/room/create', body, {}) as { code: string; hostToken: string; name: string; hostIp: string; hostPort: number; expiresIn: number }

    const room: RoomInfo = {
      code: data.code,
      name: data.name,
      hostIp: data.hostIp,
      hostPort: data.hostPort,
      maxPlayers: 20,
      currentPlayers: 1,
      hasPassword: !!req.password,
      category: req.category || '',
      gameVersion,
      loader,
      clientType: 'app',
      clientTag: CLIENT_TAG,
      expiresIn: data.expiresIn,
      isHost: true
    }
    this.startSession(data.code, data.hostToken, true, room)
    return { code: data.code, hostToken: data.hostToken, name: data.name, hostIp: data.hostIp, hostPort: data.hostPort, expiresIn: data.expiresIn }
  }

  // ---- 7. JoinRoom ----
  async joinRoom(req: JoinRoomParams): Promise<JoinRoomResult> {
    const code = req.code.toUpperCase().trim()
    if (!validateRoomCode(code)) throw new APIError('INVALID_PARAMS', '房间码必须为 6 位（字符集 A-Z 去掉 I/O、2-9 去掉 0/1）', 0)
    if (this.state !== 'idle') throw new APIError('SESSION_ACTIVE', '请先退出当前房间再操作', 0)
    const body: Record<string, unknown> = {
      code,
      clientType: 'app',
      clientProtocolVersion: 7,
      clientCapabilities: ['relay', 'continuous_retry']
    }
    if (req.password) body.password = req.password

    const data = await this.api.post(this.baseURL(), '/room/join', body, {}) as { clientToken: string; clientId: string; room: RoomInfo }
    const room: RoomInfo = { ...data.room, code, isHost: false }
    if (!room.clientType) room.clientType = 'app'
    this.startSession(code, data.clientToken, false, room, data.clientId)
    return { clientToken: data.clientToken, clientId: data.clientId, room }
  }

  private startSession(code: string, token: string, isHost: boolean, room: RoomInfo, clientID = ''): void {
    const state: AppState['state'] = isHost ? 'hosting' : 'in_room'
    this.state = state
    this.room = room
    this.engine.code = code
    this.engine.token = token
    this.engine.isHost = isHost
    this.engine.hostPort = room.hostPort
    this.engine.hostIp = room.hostIp
    this.engine.clientID = clientID
    const sess = new VoxlinkSession(
      { api: this.api, baseURL: () => this.baseURL(), emit: (e, d) => this.emit(e, d), netLog: (l, m) => this.netLog(l, m) },
      { code, token, isHost }
    )
    sess.on('engineSignal', (sig) => {
      const s = sig as { type: string; from: string; data: Record<string, unknown> }
      this.engine.onSignal(s.type, s.from, s.data)
    })
    this.engine.session = sess
    this.engine.setState(state, code, token, isHost, room, sess)
    this.emit('session:state', { state, room: { ...room } })
    void sess.run()
  }

  private updateRoomInfo(info: { currentPlayers: number; name: string }): void {
    if (!this.room) return
    if (info.currentPlayers > 0 && info.currentPlayers !== this.room.currentPlayers) {
      this.room.currentPlayers = info.currentPlayers
      this.emit('session:state', { state: this.state, room: { ...this.room } })
    }
    if (info.name && info.name !== this.room.name) {
      this.room.name = info.name
      this.emit('session:state', { state: this.state, room: { ...this.room } })
    }
  }

  // ---- 8. LeaveRoom ----
  async leaveRoom(): Promise<{ left: boolean }> {
    const had = this.engine.session !== null
    if (!had) return { left: false }
    await this.leaveInternal()
    this.emit('session:state', { state: 'idle' })
    return { left: true }
  }

  private async leaveInternal(): Promise<void> {
    const s = this.engine.session
    const code = this.engine.code, token = this.engine.token, isHost = this.engine.isHost
    if (s) {
      this.engine.relayRelease()
      this.engine.teardown()
      try { s.stop() } catch { /* ignore */ }
      await Promise.race([s.getDone(), new Promise<void>((r) => setTimeout(r, 3000))])
      try { await this.api.post(this.baseURL(), '/room/leave', { code, token, isHost }, null) } catch { /* ignore */ }
    }
    this.engine.session = null
    this.state = 'idle'
    this.room = null
    this.engine.setState('idle', '', '', false, null, null)
  }

  // ---- 9. GetSessionState ----
  getSessionStateJSON(): AppState {
    return { state: this.state, code: this.engine.code, token: this.engine.token, isHost: this.engine.isHost, room: this.room }
  }

  // ---- 10. SendRoomUpdate ----
  async sendRoomUpdate(req: { name?: string; category?: string; visible?: boolean; password?: string }): Promise<void> {
    const code = this.engine.code, token = this.engine.token
    const hosting = this.state === 'hosting' && this.engine.isHost
    if (!code || !token) throw new APIError('NO_SESSION', '当前没有房间会话', 0)
    const body: Record<string, unknown> = { code, token, isHost: hosting }
    for (const k of ['name', 'category', 'visible', 'password'] as const) {
      if (req[k] !== undefined) body[k] = req[k]
    }
    await this.api.post(this.baseURL(), '/room/update', body, null)
  }

  // ---- 11. GetRoomMods ----
  async getRoomMods(code: string): Promise<Record<string, unknown>> {
    if (!code) throw new APIError('INVALID_PARAMS', '房间码不能为空', 0)
    return (await this.api.post(this.baseURL(), '/room/mods', { code }, {}) ?? {}) as Record<string, unknown>
  }

  // ---- 12. RelayStatus ----
  async relayStatus(): Promise<Record<string, unknown>> {
    return (await this.api.get(this.baseURL(), '/relay/status', {}, {}) ?? {}) as Record<string, unknown>
  }

  // ---- 13. RelayList ----
  async relayList(): Promise<Record<string, unknown>> {
    return (await this.api.get(this.baseURL(), '/relay/list', {}, {}) ?? {}) as Record<string, unknown>
  }

  // ---- 14. GetStun ----
  async getStun(): Promise<Record<string, unknown>> {
    return (await this.api.get(this.baseURL(), '/stun', {}, {}) ?? {}) as Record<string, unknown>
  }

  // ---- 15. OpenInBrowser ----
  async openInBrowser(rawURL: string): Promise<void> {
    const u = rawURL.trim()
    if (!/^https?:\/\//i.test(u)) {
      this.netLog('warn', `拒绝打开非 http/https 链接: ${rawURL}`)
      return
    }
    try {
      const { shell } = require('electron') as typeof import('electron')
      await shell.openExternal(u)
    } catch (e) {
      this.netLog('error', `打开浏览器失败: ${(e as Error).message}`)
    }
  }

  // ---- 16. DetectMcPorts ----
  async detectMcPortsJSON(): Promise<{ ports: McPortEntry[] }> {
    const ports = await detectMcPorts()
    return { ports }
  }

  // ---- 17. TryDirect ----
  tryDirect(): { ok: boolean; err?: string } { return this.engine.tryDirect() }

  // ---- 18. UsePlayerRelay ----
  usePlayerRelay(): { ok: boolean; err?: string } { return this.engine.usePlayerRelay() }
}

import type { McPortEntry } from './mc_ports'