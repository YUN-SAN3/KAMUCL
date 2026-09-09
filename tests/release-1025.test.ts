import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { buildServersDat } from '../src/main/core/nbt'
import { parseNbt } from '../src/main/core/nbt'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('fix-1: update check failure never misreports as latest; failed state has GitHub hint + retry (修复1)', () => {
  const sv = read('src/renderer/src/views/SettingsView.vue')
  assert.match(sv, /upd-failed-row/)
  assert.match(sv, /你的网络可能无法连接 GitHub，检查更新失败/)
  assert.match(sv, /@click="onCheckUpdate"/)
  // 已是最新仅在 r.ok 且无更新时
  const fn = sv.slice(sv.indexOf('async function onCheckUpdate'), sv.indexOf('const updateSource'))
  assert.match(fn, /r\.ok && r\.hasUpdate/)
  assert.match(fn, /else if \(r\.ok\)/)
  assert.match(fn, /发现新版本 v\$\{r\.release\.version\}，是否更新？/)
  assert.match(fn, /当前版本已是最新！/)
})

test('fix-2: choosing a missing folder auto-removes its binding instead of error-loop (修复2)', () => {
  const gv = read('src/renderer/src/views/GameView.vue')
  assert.match(gv, /errText\(error\)\.includes\('文件夹已不存在'\)/)
  assert.match(gv, /removeFolder\(selected\)/)
  assert.match(gv, /已从启动器移除其绑定记录/)
})

test('fix-3: capsule blob follows selection under theme/layout changes via ResizeObserver + theme watch (修复3)', () => {
  const cv = read('src/renderer/src/views/CommunityView.vue')
  assert.match(cv, /kindBlobObserver = new ResizeObserver/)
  assert.match(cv, /watch\(\(\) => store\.settings\?\.theme/)
  const gv = read('src/renderer/src/views/GameView.vue')
  assert.match(gv, /tabBlobObserver = new ResizeObserver/)
  assert.match(gv, /watch\(\(\) => store\.installed\.length/)
})

test('fix-5: chunked engine stays removed; single connection only (修复5)', () => {
  const dl = read('src/main/core/download.ts')
  assert.ok(!dl.includes('doDownloadChunked') && !dl.includes('CHUNK_MIN_BYTES'))
})

test('fix-6: version single source of truth — corner and about page both use __APP_VERSION__ (修复6)', () => {
  const app = read('src/renderer/src/App.vue')
  assert.match(app, /const appVersion = __APP_VERSION__/)
  assert.match(app, /v\{\{ appVersion \}\}/)
  const cfg = read('electron.vite.config.ts')
  assert.match(cfg, /__APP_VERSION__/)
  const sv = read('src/renderer/src/views/SettingsView.vue')
  assert.match(sv, /const appVersion = __APP_VERSION__/)
})

test('new-1: binding a server writes it into the instance servers.dat (merge, no overwrite) (新增1)', () => {
  const servers = read('src/main/core/servers.ts')
  assert.match(servers, /writeServerToGameDat/)
  assert.match(servers, /if \(versionId\) writeServerToGameDat\(id\)/)
  assert.match(servers, /buildServersDat\(next\)/)
  // NBT roundtrip: 写入结构可被游戏读取
  const buf = buildServersDat([{ name: '测试服', ip: '127.0.0.1:25565' }])
  const root = parseNbt(buf) as { servers?: Array<{ name?: string; ip?: string }> }
  assert.ok(Array.isArray(root.servers))
  assert.equal(root.servers[0].name, '测试服')
  assert.equal(root.servers[0].ip, '127.0.0.1:25565')
})

test('remove-1: direct connect entry fully removed, shared capability kept (移除1)', () => {
  const view = read('src/renderer/src/views/FriendConnectView.vue')
  assert.ok(!view.includes("'direct'"))
  assert.ok(!view.includes('DirectPanel'))
  assert.ok(!fs.existsSync('src/renderer/src/components/connection/DirectPanel.vue'))
  // 主进程直连能力保留（VoxLink 内部依赖）
  assert.ok(fs.existsSync('src/main/core/directConnect.ts'))
})

test('1.0.25 changed SFCs compile', () => {
  for (const file of [
    'src/renderer/src/views/SettingsView.vue',
    'src/renderer/src/views/GameView.vue',
    'src/renderer/src/views/CommunityView.vue',
    'src/renderer/src/views/FriendConnectView.vue',
  ]) {
    const source = read(file)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    const result = compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [], file)
  }
})
