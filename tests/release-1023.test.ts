import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('chunked multi-thread engine fully removed; single-connection is the only path (指令：视情况移除多线程)', () => {
  const dl = read('src/main/core/download.ts')
  for (const gone of ['doDownloadChunked', 'buildChunkPlan', 'chunkStallWatchdog', 'CHUNK_MIN_BYTES', 'CHUNK_SIZE_BYTES', 'CHUNK_MAX_CONNECTIONS', 'cleanupChunkArtifacts', 'RangeUnsupportedError']) {
    assert.ok(!dl.includes(gone), `${gone} 必须移除`)
  }
  // 单连接唯一直达
  assert.match(dl, /async function startTransfer\([\s\S]*?return doDownload\(/)
  // .part 断点续传与磁盘预检保留
  assert.match(dl, /\.part/)
  assert.match(dl, /assertDiskSpace/)
})

test('curseforge: official API with x-api-key when configured, mirror fallback otherwise (指令：官方 API)', () => {
  const c = read('src/main/core/community.ts')
  assert.match(c, /const CF_OFFICIAL = 'https:\/\/api\.curseforge\.com\/v1'/)
  assert.match(c, /const CF_MIRROR = 'https:\/\/mod\.mcimirror\.top\/curseforge\/v1'/)
  assert.match(c, /curseforgeApiKey/)
  assert.match(c, /'x-api-key': key/)
  // 受限文件现场解析 download-url
  assert.match(c, /download-url/)
  // 设置类型与 UI
  const types = read('src/shared/types.ts')
  assert.match(types, /curseforgeApiKey\?: string/)
  const sv = read('src/renderer/src/views/SettingsView.vue')
  assert.match(sv, /CurseForge API Key/)
  assert.match(sv, /console\.curseforge\.com/)
})

test('updater script: move-with-retry handles portable wrapper file lock + step logging (只下载不安装根因修复)', () => {
  const au = read('src/main/core/applyUpdate.ts')
  assert.match(au, /Move-WithRetry/)
  assert.match(au, /updater-last\.log/)
  assert.match(au, /重试 120 次仍失败/)
  // 外层引导进程（文件锁持有者）一并等待
  assert.match(au, /wrapperPid/)
})
