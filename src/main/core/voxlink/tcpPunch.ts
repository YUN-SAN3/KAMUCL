// SPDX-License-Identifier: LGPL-3.0-only
// Adapted from AUGUHDAR/VoxLink TcpHolePuncher / P2PBridge, revision 721c7fae.
import net from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
export async function chooseTcpPunchPort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '0.0.0.0', resolve) })
  const port = (server.address() as net.AddressInfo).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}
export async function tcpSimOpen(ip: string, port: number, host: boolean, signal: AbortSignal): Promise<net.Socket> {
  if (!net.isIP(ip) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('TCP 打洞地址无效')
  const deadline = Date.now() + 10000
  for (let attempt = 0; attempt < (host ? 5 : 1) && Date.now() < deadline; attempt++) {
    signal.throwIfAborted()
    const socket = new net.Socket()
    const abort = () => socket.destroy()
    signal.addEventListener('abort', abort, { once: true })
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { socket.destroy(); reject(new Error('TCP 同时打开超时')) }, Math.min(3000, deadline - Date.now()))
        socket.once('error', reject); socket.once('close', () => { clearTimeout(timer); reject(new Error('TCP 同时打开已关闭')) })
        socket.connect({ host: ip, port, localPort: port }, () => { clearTimeout(timer); resolve() })
      })
      signal.throwIfAborted(); socket.setNoDelay(true); return socket
    } catch { socket.destroy(); signal.throwIfAborted() }
    finally { signal.removeEventListener('abort', abort) }
    await delay(50 + Math.floor(Math.random() * 200), undefined, { signal })
  }
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const server = net.createServer(socket => {
      if ((socket.remoteAddress || '').replace(/^::ffff:/, '') !== ip.replace(/^::ffff:/, '')) { socket.destroy(); return }
      finish(); socket.setNoDelay(true); resolve(socket)
    })
    const finish = (error?: Error) => { clearTimeout(timer); signal.removeEventListener('abort', abort); server.close(); if (error) reject(error) }
    const abort = () => finish(new Error('TCP 打洞已取消'))
    const timer = setTimeout(() => finish(new Error('TCP 打洞未命中')), 10000)
    signal.addEventListener('abort', abort, { once: true }); server.once('error', finish)
    server.listen(port, net.isIP(ip) === 6 ? '::' : '0.0.0.0')
  })
}
export async function bridgePunchedSocket(peer: net.Socket, hostPort: number | null, onDown: () => void): Promise<{ address: string; stop: () => void }> {
  let server: net.Server | undefined, local: net.Socket | undefined, stopped = false
  const stop = () => { if (stopped) return; stopped = true; server?.close(); peer.destroy(); local?.destroy(); onDown() }
  peer.on('error', stop); peer.once('close', stop); peer.setKeepAlive(true, 10000); peer.pause()
  const pair = (socket: net.Socket) => {
    if (stopped || local) { socket.destroy(); return }
    local = socket; socket.setNoDelay(true); socket.on('error', stop); socket.once('close', stop)
    peer.pipe(socket); socket.pipe(peer)
  }
  if (hostPort) {
    const socket = net.createConnection({ host: '127.0.0.1', port: hostPort })
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { socket.destroy(); reject(new Error('本地游戏连接超时')) }, 10000)
        socket.once('error', e => { clearTimeout(timer); reject(e) }); socket.once('connect', () => { clearTimeout(timer); resolve() })
      })
      pair(socket); return { address: '', stop }
    } catch (error) { socket.destroy(); stop(); throw error }
  }
  server = net.createServer(pair)
  try {
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve) })
    server.on('error', stop)
    return { address: `127.0.0.1:${(server.address() as net.AddressInfo).port}`, stop }
  } catch (error) { stop(); throw error }
}
