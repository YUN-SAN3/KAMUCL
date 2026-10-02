import test from 'node:test'
import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import http from 'node:http'
import { once } from 'node:events'
import { Puncher, punchBuildControl } from '../src/main/core/voxlink/punch'
import { stunSampleSeries } from '../src/main/core/voxlink/stun'
import { ApiClient } from '../src/main/core/voxlink/api'

test('VoxLink ACK 不形成响应热循环，取消后 wait 立即结束且不遗留监听器', async () => {
  const socket = dgram.createSocket('udp4'), peer = dgram.createSocket('udp4')
  socket.bind(0, '127.0.0.1'); peer.bind(0, '127.0.0.1')
  await Promise.all([once(socket, 'listening'), once(peer, 'listening')])
  const punch = new Puncher({ conn: socket, timeoutMs: 1000 })
  let responses = 0
  peer.on('message', p => { if(p[2] === 2) responses++ })
  try {
    punch.setTarget({ address: '127.0.0.1', port: peer.address().port })
    punch.start(); punch.start()
    assert.equal(socket.listenerCount('message'), 1)
    peer.send(punchBuildControl(2, 17), socket.address().port, '127.0.0.1')
    assert.equal((await punch.wait()).port, peer.address().port)
    await new Promise(r => setTimeout(r, 60))
    assert.equal(responses, 1, 'upstream sends one final ACK, then hands off the socket without a response loop')
  } finally { punch.stop(); socket.close(); peer.close() }
  assert.equal(socket.listenerCount('message'), 0)
  const cancelled = new Puncher({ conn: dgram.createSocket('udp4') })
  cancelled.stop()
  await assert.rejects(cancelled.wait(), /取消/)
})

test('VoxLink STUN 跳过不可达首节点，之后优先已验证节点', async () => {
  const client = dgram.createSocket('udp4'), dead = dgram.createSocket('udp4'), live = dgram.createSocket('udp4')
  for (const s of [client, dead, live]) s.bind(0, '127.0.0.1')
  await Promise.all([client, dead, live].map(s => once(s, 'listening')))
  let deadRequests = 0
  dead.on('message', () => deadRequests++)
  live.on('message', (request, sender) => {
    const response = Buffer.alloc(32)
    request.copy(response, 0, 0, 20); response.writeUInt16BE(0x0101, 0); response.writeUInt16BE(12, 2)
    response.writeUInt16BE(0x0001, 20); response.writeUInt16BE(8, 22)
    response[25] = 1; response.writeUInt16BE(34567, 26)
    response.set([203, 0, 113, 7], 28)
    live.send(response, sender.port, sender.address)
  })
  try {
    const servers = [dead, live].map(s => '127.0.0.1:' + s.address().port)
    assert.equal((await stunSampleSeries(client, servers, 1, 1, 60))[0]?.port, 34567)
    assert.equal(deadRequests, 1)
    assert.equal((await stunSampleSeries(client, servers, 1, 1, 60))[0]?.port, 34567)
    assert.equal(deadRequests, 1, 'reachable server goes first on subsequent sampling')
  } finally { for (const s of [client, dead, live]) s.close() }
})

test('VoxLink 房间更新遵守 429 冷却，其他 API 不受阻塞', async () => {
  let requests = 0
  const server = http.createServer((req, res) => {
    requests++
    if (req.url?.includes('%2Froom%2Fupdate')) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '2' })
      res.end(JSON.stringify({ success: false, error: 'RATE_LIMITED' }))
    } else res.end(JSON.stringify({ success: true, data: { ok: true } }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  try {
    const api = new ApiClient(), url = `http://127.0.0.1:${(server.address() as any).port}`
    await assert.rejects(api.post(url, '/room/update', { code: 'ABCDEF' }), /RATE_LIMITED/)
    await assert.rejects(api.post(url, '/room/update', { code: 'ABCDEF' }), /RATE_LIMITED/)
    assert.equal(requests, 1)
    await api.get(url, '/room/list', {}); assert.equal(requests, 2)
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())) }
})
