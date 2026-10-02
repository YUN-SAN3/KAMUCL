import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (file: string) => fs.readFileSync(file, 'utf8')

// Replaced implementation: behavior is exercised by skin3d-parity, download-policy,
// download-stall, import-download-1049 and modpack-speed-1050 runtime tests.


test('curseforge: official API with x-api-key when configured, mirror fallback otherwise (指令：官方 API)', () => {
  const c = read('src/main/core/community.ts')
  assert.match(c, /const CF_OFFICIAL = 'https:\/\/api\.curseforge\.com\/v1'/)
  assert.match(c, /const CF_MIRROR = 'https:\/\/mod\.mcimirror\.top\/curseforge\/v1'/)
  assert.match(c, /curseforgeApiKey/)
  assert.match(c, /'x-api-key': ch\.key/)
  // 受限文件现场解析 download-url
  assert.match(c, /download-url/)
  // 设置类型与 UI
  const types = read('src/shared/types.ts')
  assert.match(types, /curseforgeApiKey\?: string/)
  const sv = read('src/renderer/src/views/SettingsView.vue')
  assert.match(sv, /CurseForge API Key/)
  assert.match(sv, /console\.curseforge\.com/)
})

test('updater script: atomic replacement waits for portable wrapper and logs each outcome', () => {
  const au = read('src/main/core/updateTransaction.ts')
  assert.match(au, /\[IO.File\]::Replace/)
  assert.match(au, /updater-last\.log/)
  assert.match(au, /\$n -lt 60/)
  // 外层引导进程（文件锁持有者）一并等待
  assert.match(au, /wrapperPid/)
})
