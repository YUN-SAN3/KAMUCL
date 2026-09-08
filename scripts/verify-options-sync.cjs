// 默认配置同步回归验证：自动设置已知值 → 触发同步 → 读目标实例 options.txt 断言。
// 每次动同步逻辑（keybindings.ts / launch.ts 同步点）后必须跑过。
// 用法：node scripts/verify-options-sync.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-options-sync-'))
const gameDir = path.join(root, 'games', 'demo')
fs.mkdirSync(gameDir, { recursive: true })
fs.writeFileSync(path.join(gameDir, 'options.txt'), 'version:4903\nlang:zh_cn\ncustomLine:keep\n', 'utf8')

async function main() {
  const { mergeKeysIntoOptions, adaptOptionsForVersion, syncKeysToGameDir, syncOptionsToGameDir } = await import('../src/main/core/keybindings.ts')
  const { getDefaultKeys, getDefaultOptions } = await import('../src/main/core/keybindings.ts')

  // 1. 已知值：FOV 82°、灵敏度 0.6、亮度 0.8、渲染距离 18、垂直同步关、潜行切换、自动跳跃关、图像品质极佳
  const options = {
    ...getDefaultOptions(),
    fov: '82', mouseSensitivity: '0.6', gamma: '0.8', renderDistance: '18',
    enableVsync: 'false', toggleCrouch: 'true', autoJump: 'false', graphicsPreset: 'fabulous', resourcePacks: ''
  }

  // 2. 触发同步（26.2 现代版）
  const changed = syncOptionsToGameDir(gameDir, options, '26.2')
  assert.equal(changed, true, 'sync must report changed')
  const text = fs.readFileSync(path.join(gameDir, 'options.txt'), 'utf8')
  const read = (key) => text.split('\n').find((l) => l.startsWith(key + ':'))?.slice(key.length + 1)

  // 3. 逐字段断言（与游戏内显示口径比对）
  assert.equal(read('fov'), String((82 - 30) / 80), 'FOV 82° → 0.65 浮点（游戏显示 82°）')
  assert.equal(read('mouseSensitivity'), '0.6', '灵敏度原值')
  assert.equal(read('gamma'), '0.8', '亮度原值')
  assert.equal(read('renderDistance'), '18', '渲染距离（26.2 仍用 renderDistance，实证）')
  assert.equal(read('enableVsync'), 'false', '垂直同步')
  assert.equal(read('toggleCrouch'), 'true', '潜行切换')
  assert.equal(read('autoJump'), 'false', '自动跳跃')
  assert.equal(read('graphicsPreset'), '"fabulous"', '图像品质（26.2 带引号 JSON 串）')
  assert.equal(read('version'), '4903', 'version 行保留（MC 不重置文件的前提）')
  assert.equal(read('lang'), 'zh_cn', '既有行保留')
  assert.equal(read('customLine'), 'keep', '自定义行保留')

  // 4. 旧版 1.12.2 口径：FOV 同样浮点；toggleCrouch/toggleSprint 不存在跳过；graphicsPreset→graphics 数字
  const legacyDir = path.join(root, 'games', 'legacy')
  fs.mkdirSync(legacyDir, { recursive: true })
  syncOptionsToGameDir(legacyDir, options, '1.12.2')
  const legacyText = fs.readFileSync(path.join(legacyDir, 'options.txt'), 'utf8')
  const readLegacy = (key) => legacyText.split('\n').find((l) => l.startsWith(key + ':'))?.slice(key.length + 1)
  assert.equal(readLegacy('fov'), String((82 - 30) / 80), '1.12.2 FOV 也写浮点')
  assert.equal(readLegacy('toggleCrouch'), undefined, '1.12.2 无 toggleCrouch 字段跳过')
  assert.equal(readLegacy('graphics'), '2', '1.12.2 图像品质写 graphics:2（极佳）')
  assert.equal(readLegacy('graphicsPreset'), undefined, '1.12.2 不写 graphicsPreset')

  // 5. 键位同步：现代版覆盖 key_* 项；1.12.2 跳过（数字 keycode 格式不兼容）
  const keysDir = path.join(root, 'games', 'keys')
  fs.mkdirSync(keysDir, { recursive: true })
  syncKeysToGameDir(keysDir, { ...getDefaultKeys(), 'key_key.forward': 'key.keyboard.up' })
  const keysText = fs.readFileSync(path.join(keysDir, 'options.txt'), 'utf8')
  assert(keysText.includes('key_key.forward:key.keyboard.up'), '键位覆盖')
  const { keySyncSupportedForVersion } = await import('../src/main/core/keybindings.ts')
  assert.equal(keySyncSupportedForVersion('1.12.2'), false, '1.12.2 数字 keycode 不支持键位同步')
  assert.equal(keySyncSupportedForVersion('26.2'), true)

  // 6. 键位+配置合并原语共用
  const merged = mergeKeysIntoOptions('lang:zh_cn\n', { 'key_key.jump': 'key.keyboard.space' })
  assert(merged.includes('key_key.jump:key.keyboard.space'))

  console.log('PASS options sync regression: ' + root)
  fs.rmSync(root, { recursive: true, force: true })
}

main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
