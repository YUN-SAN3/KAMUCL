// SPDX-License-Identifier: LGPL-3.0-only
// Adapted from AUGUHDAR/VoxLink TurnTcpChannel.java, revision 721c7fae.
import net from 'node:net'
import dgram from 'node:dgram'
export async function openTurnTcp(host: string, port: number, signal: AbortSignal) {
  signal.throwIfAborted()
  const tcp = net.createConnection({ host, port }), client = dgram.createSocket('udp4'), shim = dgram.createSocket('udp4')
  let closed = false
  const close = () => {
    if (closed) return; closed = true; signal.removeEventListener('abort', close); tcp.destroy()
    try { client.close() } catch {} try { shim.close() } catch {}
  }
  signal.addEventListener('abort', close, { once: true })
  tcp.on('error', close); tcp.on('close', close); client.on('error', close); shim.on('error', close); client.on('close', close)
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('TURN TCP 连接超时')); close() }, 3000)
      tcp.once('connect', () => { clearTimeout(timer); resolve() })
      tcp.once('close', () => { clearTimeout(timer); reject(new Error('TURN TCP 已关闭')) })
    })
    tcp.setNoDelay(true)
    const bind = (socket: dgram.Socket) => new Promise<void>((resolve, reject) => {
      const fail = () => reject(new Error('TURN TCP 已取消'))
      socket.once('close', fail); socket.bind(0, '127.0.0.1', () => { socket.off('close', fail); resolve() })
    })
    await bind(client); await bind(shim); signal.throwIfAborted()
    const clientPort = (client.address() as net.AddressInfo).port
    shim.on('message', (packet, from) => {
      if (from.address !== '127.0.0.1' || from.port !== clientPort || !packet.length || packet.length > 2048) return
      if (tcp.writableLength > 1024 * 1024) { close(); return }
      const frame = Buffer.alloc(2 + packet.length); frame.writeUInt16BE(packet.length); packet.copy(frame, 2); tcp.write(frame)
    })
    let pending = Buffer.alloc(0)
    tcp.on('data', chunk => {
      pending = Buffer.concat([pending, chunk])
      while (pending.length >= 2) {
        const size = pending.readUInt16BE(0)
        if (!size || size > 2048) { close(); return }
        if (pending.length < size + 2) break
        shim.send(pending.subarray(2, size + 2), clientPort, '127.0.0.1', () => {})
        pending = pending.subarray(size + 2)
      }
    })
    return { socket: client, target: { address: '127.0.0.1', port: (shim.address() as net.AddressInfo).port }, close }
  } catch (error) { close(); throw error }
}
