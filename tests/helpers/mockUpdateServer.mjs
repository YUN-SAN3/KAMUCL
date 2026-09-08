/**
 * 测试用自更新 mock 服务器（进程内）：与 scripts/mock-update-server.cjs 同行为，
 * 供 release-1014 测试在 node:test 中直接启动/关闭。
 */
import http from 'node:http'
import crypto from 'node:crypto'

export async function startMockServer(port = 0) {
  const assets = new Map()
  for (const ver of ['99.0.0', '1.0.0', '0.9.9']) {
    const name = `KAMUCL-${ver}.exe`
    const seed = crypto.createHash('sha256').update('kamucl-mock-' + ver).digest()
    const file = Buffer.alloc(128 * 1024)
    for (let i = 0; i < file.length; i += seed.length) seed.copy(file, i)
    assets.set(name, file)
  }
  const sumsText = [...assets.entries()]
    .map(([name, buf]) => `${crypto.createHash('sha256').update(buf).digest('hex')}  ${name}`)
    .join('\n') + '\n'

  const server = http.createServer((req, res) => {
    const url = req.url || ''
    const mk = (ver, i) => ({
      tag_name: `v${ver}`,
      name: `KAMUCL v${ver}`,
      body: `## 测试 v${ver}\n\n- mock 第 ${i + 1} 条`,
      published_at: new Date(Date.now() - i * 86400000).toISOString(),
      draft: false,
      prerelease: false,
      assets: [
        { name: `KAMUCL-${ver}.exe`, browser_download_url: `http://127.0.0.1:${server.address().port}/download/KAMUCL-${ver}.exe`, size: assets.get(`KAMUCL-${ver}.exe`).length },
        { name: 'SHA256SUMS.txt', browser_download_url: `http://127.0.0.1:${server.address().port}/SHA256SUMS.txt`, size: sumsText.length }
      ]
    })
    const releases = ['99.0.0', '1.0.0', '0.9.9'].map(mk)
    if (url.endsWith('/releases/latest')) {
      res.writeHead(200, { 'content-type': 'application/json', etag: '"mock-etag-1"' })
      res.end(JSON.stringify(releases[0]))
      return
    }
    if (url.endsWith('/releases') || url.includes('/releases?')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(releases))
      return
    }
    if (url === '/SHA256SUMS.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(sumsText)
      return
    }
    const dl = /^\/download\/(.+)$/.exec(url)
    if (dl && assets.has(dl[1])) {
      const buf = assets.get(dl[1])
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': buf.length })
      res.end(buf)
      return
    }
    res.writeHead(404)
    res.end('not found')
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  return {
    port: server.address().port,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  }
}
