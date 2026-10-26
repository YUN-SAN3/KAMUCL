import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { build } from 'esbuild'

const read = (file: string) => fs.readFileSync(file, 'utf8')

// Replaced implementation: behavior is exercised by skin3d-parity, download-policy,
// download-stall, import-download-1049 and modpack-speed-1050 runtime tests.


test('curseforge: official API with x-api-key when configured, mirror fallback otherwise (指令：官方 API)', () => {
  const c = read('src/main/core/community.ts')
  const channel = read('src/main/core/curseforgeChannel.ts')
  assert.match(c, /import \{[^}\n]*\bcfChannel\b[^}\n]*\} from '\.\/curseforgeChannel'/)
  assert.match(c, /export \{ cfChannel \} from '\.\/curseforgeChannel'/)
  assert.match(channel, /const CF_OFFICIAL = 'https:\/\/api\.curseforge\.com\/v1'/)
  assert.match(channel, /const CF_MIRROR = 'https:\/\/mod\.mcimirror\.top\/curseforge\/v1'/)
  assert.match(channel, /getCurseforgeApiKey/)
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

test('isolated CurseForge channel preserves environment, settings, builtin precedence and keyless mirror behavior', async () => {
  // Stub only dependency boundaries. Never read, emit or replace a real key or user profile.
  const result = await build({ entryPoints: ['src/main/core/curseforgeChannel.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'channel-dependencies', setup(plugin) {
    plugin.onResolve({ filter: /^\.\/(settings|curseforgeKey)$/ }, args => /[\\/]curseforgeChannel\.ts$/.test(args.importer) ? { path: args.path, namespace: 'channel-fixture' } : undefined)
    plugin.onLoad({ filter: /.*/, namespace: 'channel-fixture' }, args => ({ loader: 'js', contents: args.path === './settings' ? 'export function getCurseforgeApiKey(){fixture.settingsReads++;return fixture.settings.curseforgeApiKey}' : 'export const CF_BUILTIN_KEY=fixture.builtin' }))
  } }] })
  const run = (env: Record<string, string>, setting: string, builtin: string) => {
    const fixture = { settings: { curseforgeApiKey: setting }, builtin, settingsReads: 0 }, mod = { exports: {} as any }
    new Function('module', 'exports', 'process', 'fixture', result.outputFiles[0].text)(mod, mod.exports, { env }, fixture)
    return { channel: mod.exports.cfChannel(), reads: fixture.settingsReads }
  }
  const official = (key: string) => ({ base: 'https://api.curseforge.com/v1', official: true, key })
  assert.deepEqual(run({ KAMUCL_CF_API_KEY: ' env-fixture ' }, 'user-fixture', 'builtin-fixture'), { channel: official('env-fixture'), reads: 0 })
  assert.deepEqual(run({}, ' user-fixture ', 'builtin-fixture'), { channel: official('user-fixture'), reads: 1 })
  assert.deepEqual(run({ KAMUCL_CF_API_KEY: '' }, '   ', ' builtin-fixture '), { channel: official('builtin-fixture'), reads: 1 })
  assert.deepEqual(run({}, '', ''), { channel: { base: 'https://mod.mcimirror.top/curseforge/v1', official: false, key: '' }, reads: 1 })
  // A truthy whitespace environment override was already an explicit keyless channel.
  assert.deepEqual(run({ KAMUCL_CF_API_KEY: '   ' }, 'user-fixture', 'builtin-fixture'), { channel: { base: 'https://mod.mcimirror.top/curseforge/v1', official: false, key: '' }, reads: 0 })
})

test('updater script: atomic replacement waits for portable wrapper and logs each outcome', () => {
  const au = read('src/main/core/updateTransaction.ts')
  assert.match(au, /\[IO.File\]::Replace/)
  assert.match(au, /updater-last\.log/)
  assert.match(au, /\$n -lt 60/)
  // 外层引导进程（文件锁持有者）一并等待
  assert.match(au, /wrapperPid/)
})
