import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { mapUpdateEntries } from '../src/main/core/modUpdates'
import { sanitizePluginId } from '../src/main/core/plugins'
import type { ModUpdateEntry } from '../src/shared/types'

const read = (file: string) => fs.readFileSync(file, 'utf8')

const entry = (sha1: string): ModUpdateEntry => ({
  fileName: `${sha1}.jar`, name: 'TestMod', modId: 'testmod', currentVersion: '1.0',
  sha1, source: null, alreadyLatest: false, update: null
})

test('mod update mapping: same sha1 = latest, different file = update available, no hit = unknown source', () => {
  const a = entry('aaa'), b = entry('bbb'), c = entry('ccc')
  const byHash = {
    // 本地已是最新：返回版本的文件 hash 与本地一致
    aaa: { id: 'v1', project_id: 'p1', version_number: '1.0', files: [{ primary: true, filename: 'mod-1.0.jar', url: 'https://cdn.example/a.jar', hashes: { sha1: 'aaa' } }] },
    // 有更新：文件 hash 不同
    bbb: { id: 'v2', project_id: 'p2', version_number: '2.0', files: [{ primary: true, filename: 'mod-2.0.jar', url: 'https://cdn.example/b.jar', hashes: { sha1: 'ddd' }, size: 1234 }] }
    // ccc 无响应：未匹配来源
  }
  const mapped = mapUpdateEntries([a, b, c], byHash)
  assert.equal(mapped[0].alreadyLatest, true)
  assert.equal(mapped[0].update, null)
  assert.equal(mapped[0].source, 'modrinth')
  assert.equal(mapped[1].update?.versionNumber, '2.0')
  assert.equal(mapped[1].update?.url, 'https://cdn.example/b.jar')
  assert.equal(mapped[1].update?.sha1, 'ddd')
  assert.equal(mapped[2].source, null)
  assert.equal(mapped[2].update, null)
  // 无文件或非法 url 的版本不产生更新项
  const d = entry('eee')
  mapUpdateEntries([d], { eee: { id: 'v3', project_id: 'p3', version_number: '3.0', files: [] } })
  assert.equal(d.update, null)
  assert.equal(d.source, 'modrinth')
})

test('plugin id sanitization is filesystem safe and rejects path traversal input', () => {
  assert.equal(sanitizePluginId('My Cool Plugin'), 'my-cool-plugin')
  assert.equal(sanitizePluginId(' neon_UI.pack '), 'neon_ui-pack')
  assert.equal(sanitizePluginId('..\\..\\evil'), 'evil')
  assert.equal(sanitizePluginId('插件A'), 'a')
  assert.equal(sanitizePluginId('---'), '')
  assert.equal(sanitizePluginId('a'.repeat(100)), 'a'.repeat(100))
})

test('plugin main module enforces id whitelist, enabled-only reads and size cap', () => {
  const source = read('src/main/core/plugins.ts')
  assert.match(source, /\^\[a-z0-9\]\[a-z0-9_-\]\{0,63\}\$/)
  assert.match(source, /if \(!readEnabled\(\)\.includes\(id\)\) throw new Error\('插件未启用'\)/)
  assert.match(source, /stat\.size > 1024 \* 1024/)
  assert.match(source, /path\.dirname\(path\.resolve\(dir\)\) !== path\.resolve\(pluginsRoot\(\)\)/)
  // IPC：安装走原生选择框，读代码按 id 白名单
  const ipc = read('src/main/ipc.ts')
  assert.match(ipc, /pluginsInstall[\s\S]*?showOpenDialog/)
  assert.match(ipc, /pluginsReadCode[\s\S]*?plugins\.readPluginCode/)
})

test('renderer plugin loader executes only enabled plugins via the CSP-scoped plugin protocol', () => {
  const loader = read('src/renderer/src/plugins.ts')
  assert.match(loader, /p\.enabled && p\.hasCode/)
  assert.match(loader, /kamucl-plugin:\/\/\$\{encodeURIComponent\(plugin\.id\)\}\/main\.js/)
  for (const api of ['toast', 'addStyles', 'onViewChange', 'getView', 'store']) assert(loader.includes(api), api)
  const app = read('src/renderer/src/App.vue')
  assert.match(app, /loadEnabledPlugins\(\)/)
  // CSP：仅放行插件协议的 script-src，不放行 unsafe-eval / unsafe-inline
  const html = read('src/renderer/index.html')
  assert.match(html, /script-src 'self' kamucl-plugin:/)
  assert(!html.includes('unsafe-eval'), 'CSP must not allow unsafe-eval')
  // 主进程：协议注册 + 仅已启用插件可读
  const main = read('src/main/index.ts')
  assert.match(main, /scheme: 'kamucl-plugin'/)
  assert.match(main, /registerPluginProtocol\(\)/)
  const plugins = read('src/main/core/plugins.ts')
  assert.match(plugins, /if \(!readEnabled\(\)\.includes\(id\)\) return new Response\('plugin disabled', \{ status: 403 \}\)/)
})

test('navigation identifies the active page independently of hover', () => {
  const app = read('src/renderer/src/App.vue')
  assert.match(app, /data-nav="resources"/)
  assert.match(app, /:aria-current="store.currentView === item.key \? 'page' : undefined"/)
  assert.match(app, /:aria-current="store.currentView === sub.key \? 'page' : undefined"/)
  assert.doesNotMatch(app, /navHoverKey/)
})

test('splash holds the assembled avatar for two seconds before revealing', () => {
  const startup = read('src/shared/startup.ts')
  assert.match(startup, /ASSEMBLED_HOLD_MS = 2000/)
  const splash = read('src/renderer/src/splash.ts')
  assert.match(splash, /reduced \|\| elapsed - convergence >= CONVERGE_DURATION \+ ASSEMBLED_HOLD_MS/)
})

test('java picker save button uses the gold accent style and actions row is laid out', () => {
  const home = read('src/renderer/src/views/HomeView.vue')
  assert.match(home, /class="btn btn-gold" :disabled="javaSaving" @click="saveJavaChoice"/)
  assert.match(home, /\.java-picker \.modal-actions \{[^}]*justify-content: flex-end/)
})

test('mod update panel is inline in the mods file manager with select-all and per-item apply', () => {
  const fm = read('src/renderer/src/components/FileManager.vue')
  assert.match(fm, /checkModUpdates\(v\.id, v\.folder\)/)
  assert.match(fm, /applyModUpdates\(v\.id, targets, v\.folder\)/)
  assert.match(fm, /一键更新选中/)
  assert.match(fm, /toggleUpdateSelect/)
  assert.match(fm, /upd-panel/)
  // 不跳转页面：面板为内联 card，不使用路由
  assert(!fm.includes("store.currentView ="))
})

test('modified Vue components compile with real scripts and templates', () => {
  for (const file of ['src/renderer/src/App.vue', 'src/renderer/src/components/FileManager.vue', 'src/renderer/src/views/SettingsView.vue', 'src/renderer/src/views/HomeView.vue']) {
    const source = read(file)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    const result = compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [], file)
  }
})
