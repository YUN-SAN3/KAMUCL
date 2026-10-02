// SPDX-License-Identifier: MIT
// KAMUCL stream adapter: backpressure and lifecycle are owned by Node sockets.
import net from 'node:net'
import { RudpConn } from './rudp'
export const BRIDGE_BUF_SIZE = 32768, BRIDGE_IDLE_TIMEOUT_MS = 30000, BRIDGE_DIAL_WINDOW_MS = 10000, BRIDGE_DIAL_RETRY_MS = 1000, BRIDGE_DIAL_TIMEOUT_MS = 2000
export type BridgeDownCb = (() => void) | null
export type LogFn = ((level: 'info' | 'warn' | 'error', message: string) => void) | null
async function send(socket: net.Socket, data: Buffer): Promise<void> { await new Promise<void>((resolve,reject) => socket.write(data, error => error ? reject(error) : resolve())) }
export class TcpBridge {
  ln?: net.Server
  private socket?: net.Socket
  private stopped = false
  private activity = Date.now()
  constructor(private rc: RudpConn, private down: BridgeDownCb) { rc.setOnClosed(() => this.stop()) }
  touch(): void { this.activity = Date.now() }
  idleMs(): number { return Date.now() - this.activity }
  isStopped(): boolean { return this.stopped }
  stop(): void { if (this.stopped) return; this.stopped = true; this.ln?.close(); this.socket?.destroy(); this.rc.close(); this.down?.() }
  setConn(socket: net.Socket, _old?: unknown): void { this.socket?.destroy(); this.socket = socket; this.touch() }
  static async startGuest(rc: RudpConn, down: BridgeDownCb): Promise<{ addr: string; bridge: TcpBridge }> {
    const bridge = new TcpBridge(rc,down)
    const server = bridge.ln = net.createServer(socket => { if (bridge.socket || bridge.stopped) { socket.destroy(); return } bridge.setConn(socket); void bridge.pump(socket) })
    await new Promise<void>((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',() => { server.off('error',reject); server.on('error',() => bridge.stop()); resolve() }) })
    return { addr: `127.0.0.1:${(server.address() as net.AddressInfo).port}`, bridge }
  }
  async pump(socket: net.Socket): Promise<void> {
    socket.setNoDelay(true); socket.on('error', () => this.stop()); socket.once('close', () => this.stop())
    const upload = async () => { for await (const chunk of socket) { if (this.stopped) break; this.touch(); await this.rc.write(Buffer.from(chunk)) } }
    const download = async () => { const buffer = Buffer.alloc(BRIDGE_BUF_SIZE); while (!this.stopped) { const length = await this.rc.read(buffer); if (!length) break; this.touch(); await send(socket, Buffer.from(buffer.subarray(0,length))) } }
    try { await Promise.race([upload(),download()]) } catch {} finally { this.stop() }
  }
  async watchdogOnce(): Promise<boolean> { return this.stopped || this.idleMs() > BRIDGE_IDLE_TIMEOUT_MS }
}
export async function startHostLazyBridge(rc: RudpConn, port: number, log: LogFn): Promise<void> {
  const first = Buffer.alloc(BRIDGE_BUF_SIZE); const length = await rc.read(first); if (!length) return
  const deadline = Date.now() + BRIDGE_DIAL_WINDOW_MS
  while (rc.isConnected() && Date.now() < deadline) {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    try {
      await new Promise<void>((resolve,reject) => { const timeout = setTimeout(() => { socket.destroy(); reject(new Error('本地游戏连接超时')) }, BRIDGE_DIAL_TIMEOUT_MS); socket.once('error', error => { clearTimeout(timeout); reject(error) }); socket.once('connect',() => { clearTimeout(timeout); resolve() }) })
      const bridge = new TcpBridge(rc,null); bridge.setConn(socket); await send(socket,first.subarray(0,length)); await bridge.pump(socket); return
    } catch (error) { socket.destroy(); log?.('warn',(error as Error).message); await new Promise(resolve => setTimeout(resolve,BRIDGE_DIAL_RETRY_MS)) }
  }
  rc.close()
}
export function pumpRelay(a: RudpConn, b: RudpConn): () => void {
  let stopped = false
  const stop = () => { if (!stopped) { stopped = true; a.close(); b.close() } }
  const copy = async (source: RudpConn, target: RudpConn) => { try { const data = Buffer.alloc(BRIDGE_BUF_SIZE); while (!stopped) { const size = await source.read(data); if (!size) break; await target.write(Buffer.from(data.subarray(0,size))) } } catch {} finally { stop() } }
  void copy(a,b); void copy(b,a); return stop
}
