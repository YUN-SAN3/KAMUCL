import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import WebSocket from 'ws'
import { createServer, type InlineConfig } from 'vite'
import { loopbackDevServerOptions, loopbackDevServerPolicy } from '../scripts/dev-server-policy122'

function request(port: number, url: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: url, headers }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(chunk)); response.on('error', reject)
      response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks).toString() }))
    }); req.on('error', reject); req.setTimeout(8000, () => req.destroy(new Error('Owned dev server request timeout')))
  })
}
function config(root: string, server: InlineConfig['server'] = {}): InlineConfig {
  return { configFile: false, root, logLevel: 'silent', clearScreen: false, plugins: [loopbackDevServerPolicy()],
    server: { ...loopbackDevServerOptions(), port: 0, ...server }, optimizeDeps: { noDiscovery: true } }
}
test('actual Vite loopback listener retains module serving/HMR and denies foreign Host/origin and ordinary secret paths', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-dev-policy122-'))
  fs.writeFileSync(path.join(root, 'index.html'), '<script type="module" src="/entry.ts"></script>')
  fs.writeFileSync(path.join(root, 'entry.ts'), 'export const marker: string = "own-fixture-module";')
  fs.writeFileSync(path.join(root, '.env'), 'OWN_FAKE_MARKER=local-fixture-only')
  const server = await createServer(config(root))
  t.after(async () => { await server.close(); const resolved = fs.realpathSync(root); assert(resolved.startsWith(fs.realpathSync(os.tmpdir()) + path.sep + 'kamucl-dev-policy122-')); fs.rmSync(root, { recursive: true, force: true }) })
  await server.listen()
  const address = server.httpServer!.address()
  assert(address && typeof address === 'object'); assert.equal(address.address, '127.0.0.1')
  const port = address.port, origin = `http://127.0.0.1:${port}`
  const module = await request(port, '/entry.ts', { Origin: origin })
  assert.equal(module.status, 200); assert.match(module.body, /own-fixture-module/); assert.equal(module.headers['access-control-allow-origin'], origin)
  assert.equal((await request(port, '/', { Host: 'untrusted.example.test' })).status, 403)
  for (const foreign of ['https://untrusted.example.test', 'http://127.0.0.1.untrusted.example.test', 'null']) {
    assert.equal((await request(port, '/entry.ts', { Origin: foreign })).headers['access-control-allow-origin'], undefined)
  }
  const secret = await request(port, '/.env?raw', { Origin: origin })
  assert.equal(secret.status, 403); assert(!secret.body.includes('local-fixture-only'))
  const token = (server.config as unknown as { webSocketToken: string }).webSocketToken
  assert.equal(typeof token, 'string')
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`, 'vite-hmr', { headers: { Origin: origin } })
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('Owned HMR handshake timeout')) }, 8000)
    socket.once('error', error => { clearTimeout(timer); reject(error) })
    socket.once('message', data => { try { assert.equal(JSON.parse(data.toString()).type, 'connected'); clearTimeout(timer); socket.close(); resolve() } catch (error) { socket.terminate(); reject(error) } })
  })
})
for (const host of ['0.0.0.0', '::', true, '192.0.2.10', 'example.test']) {
  test(`merged CLI/inline public bind is rejected before listener: ${String(host)}`, async () => {
    await assert.rejects(createServer(config(process.cwd(), { host })), /loopback/)
  })
}
test('merged CORS/Host/fs overrides cannot silently remove the development containment policy', async () => {
  for (const override of [{ cors: true }, { cors: { origin: /./ } }, { allowedHosts: true }, { allowedHosts: ['.example.test'] }, { fs: { strict: false } }, { fs: { strict: true, deny: [] } }] as InlineConfig['server'][]) {
    await assert.rejects(createServer(config(process.cwd(), override)), /KAMUCL 开发服务器/)
  }
})
test('production renderer configuration actually installs the policy, independent of test fixtures', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'electron.vite.config.ts'), 'utf8')
  assert.match(source, /server: loopbackDevServerOptions\(\)/); assert.match(source, /plugins: \[visualIds\(\), vue\(\), loopbackDevServerPolicy\(\)\]/)
})
