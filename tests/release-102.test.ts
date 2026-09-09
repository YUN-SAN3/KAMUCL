import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { mergeKeysIntoOptions } from '../src/main/core/keybindings'
import { VANILLA_KEYBINDS, codeToMcKey, mcKeyLabel, mouseButtonToMcKey } from '../src/shared/keybindings'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('options.txt merge covers existing key lines, appends missing ones, keeps all other lines', () => {
  const before = 'lang:zh_cn\nkey_key.forward:key.keyboard.w\nrenderDistance:16\nkey_key.jump:key.keyboard.space\n'
  const keys = { 'key_key.forward': 'key.keyboard.up', 'key_key.jump': 'key.keyboard.space', 'key_key.sneak': 'key.keyboard.left.shift' }
  const after = mergeKeysIntoOptions(before, keys)
  assert(after.includes('lang:zh_cn'), 'lang kept')
  assert(after.includes('renderDistance:16'), 'renderDistance kept')
  assert(after.includes('key_key.forward:key.keyboard.up'), 'forward overridden')
  assert(!after.includes('key_key.forward:key.keyboard.w'), 'old forward gone')
  assert(after.includes('key_key.jump:key.keyboard.space'), 'jump kept')
  assert(after.includes('key_key.sneak:key.keyboard.left.shift'), 'sneak appended')
  // 顺序：原有行位置不变，新增追加到末尾
  assert(after.indexOf('renderDistance') < after.indexOf('key_key.sneak'))
  // 空 options.txt 也能生成
  const fresh = mergeKeysIntoOptions('', keys)
  assert(fresh.includes('key_key.forward:key.keyboard.up'))
  assert(!fresh.includes('undefined'))
})

test('keybind table covers vanilla options.txt keys; DOM code/mouse mapping works', () => {
  assert(VANILLA_KEYBINDS.length >= 30)
  const ids = new Set(VANILLA_KEYBINDS.map((d) => d.id))
  for (const required of ['key_key.forward', 'key_key.attack', 'key_key.inventory', 'key_key.chat', 'key_key.hotbar.9']) {
    assert(ids.has(required), required)
  }
  assert.equal(codeToMcKey('KeyW'), 'key.keyboard.w')
  assert.equal(codeToMcKey('ShiftLeft'), 'key.keyboard.left.shift')
  assert.equal(codeToMcKey('F5'), 'key.keyboard.f5')
  assert.equal(codeToMcKey('Space'), 'key.keyboard.space')
  assert.equal(codeToMcKey('Unidentified'), null)
  assert.equal(mouseButtonToMcKey(0), 'key.mouse.left')
  assert.equal(mouseButtonToMcKey(2), 'key.mouse.right')
  assert.equal(mcKeyLabel('key.keyboard.left.shift'), '左Shift')
  assert.equal(mcKeyLabel('key.mouse.left'), '鼠标左键')
  assert.equal(mcKeyLabel('key.keyboard.unknown'), '未指定')
})

test('bridge protocol: loopback only, token required for writes, server-scope params rejected locally', () => {
  const server = read('bridge/src/cn/kamucl/bridge/BridgeServer.java')
  assert.match(server, /InetSocketAddress\("127\.0\.0\.1", 0\)/)
  assert.match(server, /X-Kamucl-Token/)
  assert.match(server, /def\.scope == Param\.Scope\.SERVER/)
  assert.match(server, /PROTOCOL = 1/)
  // 发现文件与配置持久化
  assert.match(server, /\.kamucl-bridge\.json/)
  const registry = read('bridge/src/cn/kamucl/bridge/ParamRegistry.java')
  assert.match(registry, /kamucl-bridge-config\.json/)
  // 启动器侧：仅本机 + 协议校验 + 进程存活校验
  const bridge = read('src/main/core/modBridge.ts')
  assert.match(bridge, /http:\/\/127\.0\.0\.1:/)
  assert.match(bridge, /raw\?\.protocol !== 1/)
  assert.match(bridge, /process\.kill\(discovery\.pid, 0\)/)
  assert.match(bridge, /manifest\?\.protocol !== 1/)
  // 内置 jar 分发与 asar 解包
  const pkg = JSON.parse(read('package.json'))
  assert.ok(pkg.build.asarUnpack.includes('out/main/kamucl-bridge.jar'))
  assert.match(read('electron.vite.config.ts'), /kamucl-bridge\.jar/)
})

test('portable stub unpacks next to the exe instead of random TEMP dir', () => {
  const hook = read('scripts/portable-build-hook.cjs')
  assert.match(hook, /\$EXEDIR\\\\KAMUCL-runtime/)
  assert.match(hook, /\$TEMP\\\\\$\{UNPACK_DIR_NAME\}/)
  const verify = read('scripts/verify-portable-path.cjs')
  assert.match(verify, /KAMUCL-runtime/)
})

test('keys sync integrates into launch only when the toggle is on', () => {
  const launch = read('src/main/core/launch.ts')
  assert.match(launch, /if \(settings\.keySync\)/)
  assert.match(launch, /syncKeysToGameDir\(effectiveGameDir\)/)
  const settings = read('src/shared/types.ts')
  assert.match(settings, /keySync\?: boolean/)
})

test('modpack import offers key override option without forcing it', () => {
  const modpacks = read('src/main/core/modpacks.ts')
  assert.match(modpacks, /hasPresetKeys/)
  assert.match(modpacks, /keySyncOverride/)
  assert.match(modpacks, /mergeKeysIntoOptions/)
  const app = read('src/renderer/src/App.vue')
  assert.match(app, /mpModal\.info\?\.hasPresetKeys && store\.settings\?\.keySync/)
  assert.match(app, /mpModal\.keySyncOverride/)
})

test('new views (keys, bridge) and components compile with real scripts and templates', () => {
  for (const file of [
    'src/renderer/src/views/KeysView.vue',
    'src/renderer/src/views/BridgeView.vue',
    'src/renderer/src/components/SelectMenu.vue',
    'src/renderer/src/views/SkinsView.vue',
    'src/renderer/src/views/GameView.vue',
    'src/renderer/src/App.vue'
  ]) {
    const source = read(file)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    const result = compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [], file)
  }
})

test('skin history dedup by content hash, rename channel, search UI present', () => {
  const skins = read('src/main/core/skins.ts')
  assert.match(skins, /crypto\.createHash\('sha1'\)/)
  assert.match(skins, /list\.find\(\(i\) => i\.hash === hash\)/)
  assert.match(skins, /export async function historyRename/)
  const view = read('src/renderer/src/views/SkinsView.vue')
  assert.match(view, /historySearch/)
  assert.match(view, /startHistoryRename/)
  assert.match(view, /filteredHistory/)
})
