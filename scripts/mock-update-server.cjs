#!/usr/bin/env node
/**
 * 自更新链路 mock 服务器（验证「有新版本」检测与回退两条链路）：
 *
 *   node scripts/mock-update-server.cjs [port=8310]
 *
 * 提供：
 *   GET /repos/kamubaba-i/KAMUCL/releases/latest  → 伪造最新版 v99.0.0（资产指向本服务器）
 *   GET /repos/kamubaba-i/KAMUCL/releases         → 3 个历史版本（v99.0.0 / v1.0.0 / v0.9.9）
 *   GET /download/<file>                          → 资产下载（KAMUCL-*.exe 为随机内容的测试文件）
 *   GET /SHA256SUMS.txt                           → 与测试文件一致的真实校验值
 *
 * 用法：
 *   $env:KAMUCL_USERDATA_DIR="C:\\Temp\\kamucl-update-test\\userData"  # 必须独立数据目录
 *   $env:KAMUCL_UPDATE_API_BASE="http://127.0.0.1:8310"
 *   $env:KAMUCL_UPDATE_DOWNLOAD_BASE="http://127.0.0.1:8310/download"
 *   $env:KAMUCL_UPDATE_TARGET_EXE="C:\\Temp\\kamucl-update-test\\KAMUCL-1.0.0.exe"  # 沙盒副本
 *   electron .   # 仅开发模式；正式包忽略所有 mock 覆盖
 */
const http = require('node:http')
const fs = require('node:fs')
const crypto = require('node:crypto')

const port = Number(process.argv[2] || 8310)

// 测试资产：1MB 伪随机内容（每次启动固定，便于校验复现）；MOCK_ASSET_FILE 环境变量可指定真实文件做全链路实证
const assets = new Map()
const realAssetFile = process.env.MOCK_ASSET_FILE
for (const ver of ['99.0.0', '1.0.0', '0.9.9']) {
  const name = `KAMUCL-${ver}.exe`
  const buf = crypto.createHash('sha256').update('kamucl-mock-' + ver).digest()
  const file = Buffer.alloc(1024 * 1024)
  for (let i = 0; i < file.length; i += buf.length) buf.copy(file, i)
  assets.set(name, file)
}
if (realAssetFile && fs.existsSync(realAssetFile)) {
  assets.set('KAMUCL-99.0.0.exe', fs.readFileSync(realAssetFile))
}
const sumsText = [...assets.entries()]
  .map(([name, buf]) => `${crypto.createHash('sha256').update(buf).digest('hex')}  ${name}`)
  .join('\n') + '\n'

const releases = ['99.0.0', '1.0.0', '0.9.9'].map((ver, i) => ({
  tag_name: `v${ver}`,
  name: `KAMUCL v${ver}`,
  body: `## 测试版本 v${ver}\n\n- 这是 mock 服务器生成的第 ${i + 1} 条更新日志\n- 用于验证更新弹窗 **Markdown 渲染** 与下载链路`,
  published_at: new Date(Date.now() - i * 86400000).toISOString(),
  draft: false,
  prerelease: false,
  assets: [
    {
      name: `KAMUCL-${ver}.exe`,
      browser_download_url: `http://127.0.0.1:${port}/download/KAMUCL-${ver}.exe`,
      size: assets.get(`KAMUCL-${ver}.exe`).length
    },
    {
      name: 'SHA256SUMS.txt',
      browser_download_url: `http://127.0.0.1:${port}/SHA256SUMS.txt`,
      size: sumsText.length
    }
  ]
}))

const server = http.createServer((req, res) => {
  const url = req.url || ''
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
server.listen(port, '127.0.0.1', () => {
  console.log(`mock update server: http://127.0.0.1:${port}`)
  console.log('latest = v99.0.0；历史 = v99.0.0 / v1.0.0 / v0.9.9')
  console.log('SHA256SUMS.txt 与测试资产一致')
})
