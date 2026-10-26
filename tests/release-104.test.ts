import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { mergeKeysIntoOptions } from '../src/main/core/keybindings'
import { createAppearanceAssetActions } from '../src/main/core/appearanceAssetActions'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('microsoft login: every pipeline step is labeled and written to launcher log', () => {
  const accounts = read('src/main/core/accounts.ts')
  // 步骤标签覆盖完整链路
  for (const name of ['Xbox Live 认证', 'XSTS 授权', 'Minecraft 登录', 'Minecraft 拥有权检查', '获取 Minecraft 档案']) {
    assert(accounts.includes(`step('${name}'`), name)
  }
  // 失败写 launcherLog（不再只进 console）且错误原因透传给前端
  assert.match(accounts, /logScope\('ms-auth'\)/)
  assert.match(accounts, /authLog\.error\('微软登录失败', e\)/)
  assert.match(accounts, /onDone\(null, signal\.aborted \? undefined : message, operation\.publicId\)/)
  const ipc = read('src/main/ipc.ts')
  assert.match(ipc, /msLoginDone[\s\S]*?error: error \?\? null/)
  // 前端显示具体原因，取消与失败区分
  const view = read('src/renderer/src/views/AccountsView.vue')
  assert.match(view, /微软登录失败：\$\{result\.error\}/)
  assert.match(view, /微软登录已取消/)
})

test('microsoft fetch proxy: CONNECT tunnel keeps end-to-end TLS verification, opt-in via settings', () => {
  const tls = read('src/main/core/microsoftTls.ts')
  assert.match(tls, /method: 'CONNECT'/)
  assert.match(tls, /checkServerIdentity/)
  assert.match(tls, /rejectUnauthorized: true/)
  assert.match(tls, /systemProxyAddress/)
  const types = read('src/shared/types.ts')
  assert.match(types, /msUseProxy\?: boolean/)
  const accounts = read('src/main/core/accounts.ts')
  assert.match(accounts, /useProxy: useProxy\(\)/)
  const settings = read('src/renderer/src/views/SettingsView.vue')
  assert.match(settings, /正版登录使用系统代理/)
})

test('background auto-switch: multi-image, strategy (off/order/random), startup rotation and interval', () => {
  const types = read('src/shared/types.ts')
  assert.match(types, /images\?: string\[\]/)
  assert.match(types, /switchMode\?: 'off' \| 'order' \| 'random'/)
  assert.match(types, /switchIntervalSec\?: number/)
  const app = read('src/renderer/src/App.vue')
  assert.match(app, /function switchBackground\(/)
  assert.match(app, /armBgSwitchTimer/)
  assert.match(app, /localStorage\.setItem\(BG_INDEX_KEY/)
  assert.match(app, /clearInterval\(bgSwitchTimer\)/)
  // 多图导入 IPC 与受管清理
  const ipc = read('src/main/ipc.ts')
  assert.match(ipc, /import \{ registerAppearanceAssetHandlers \} from '\.\/assetsSettings'/)
  assert.match(ipc, /registerAppearanceAssetHandlers\(getWin\)/)
  const assets = read('src/main/assetsSettings.ts')
  assert.match(assets, /multiSelections/)
  assert.match(assets, /ipcMain\.handle\(IPC\.appearanceImportBackgroundMulti,[\s\S]*?pick\('添加背景图片（可多选）', true\)[\s\S]*?actions\.multipleImages\(sources, 'background'\)/)
  assert.match(assets, /ipcMain\.handle\(IPC\.appearanceResetBackground, \(\) => actions\.resetBackground\(\)\)/)
  const editor = read('src/renderer/src/components/HomeLayoutEditor.vue')
  assert.match(editor, /pickImageMulti/)
  assert.match(editor, /switchMode/)
})

test('extracted appearance actions commit before cleaning every old managed background and preserve multi-selection behavior', async () => {
  let current: any = { background: { mode: 'image', image: 'old-primary', images: ['old-secondary', 'old-primary'], switchMode: 'order' }, launchThumbnail: { image: '', images: [] } }
  const calls: string[] = []
  const actions = createAppearanceAssetActions({
    getSettings: () => current,
    saveSettings: patch => { calls.push('save'); current = { ...current, ...patch }; return current },
    importImage: async (source, purpose) => { calls.push(`import:${purpose}:${source}`); return { path: `managed-${source}` } },
    removeImage: (image, purpose) => calls.push(`remove:${purpose}:${image}`)
  })
  await actions.singleBackground('single')
  assert.deepEqual(current.background.images, ['managed-single'])
  assert.equal(current.background.switchMode, 'off')
  assert.deepEqual(calls, ['import:background:single', 'save', 'remove:background:old-primary', 'remove:background:old-secondary'])
  calls.length = 0
  await actions.multipleImages(['first', 'second'], 'background')
  assert.deepEqual(current.background.images, ['managed-single', 'managed-first', 'managed-second'])
  assert.deepEqual(calls, ['import:background:first', 'import:background:second', 'save'])
  calls.length = 0
  actions.resetBackground()
  assert.deepEqual(calls, ['save', 'remove:background:managed-single', 'remove:background:managed-first', 'remove:background:managed-second'])
})

test('default config page: renamed, key sync switch, vanilla-aligned categories (1.0.12 起仅保留键位)', () => {
  const view = read('src/renderer/src/views/KeysView.vue')
  assert.match(view, /默认配置/)
  assert.match(view, /按键设置同步/)
  assert.match(view, /toggleKeySync/)
  assert.match(view, /按键配置/)
  // 导航与功能开关改名
  const app = read('src/renderer/src/App.vue')
  assert.match(app, /label: '默认配置'/)
  const settings = read('src/renderer/src/views/SettingsView.vue')
  assert.match(settings, /label: '默认配置'/)
})

test('options.txt merge covers key_* lines and preserves everything else', () => {
  const merged = mergeKeysIntoOptions('lang:zh_cn\nkey_key.forward:key.keyboard.w\ncustomLine:keep\n', {
    'key_key.forward': 'key.keyboard.s',
    'key_key.back': 'key.keyboard.w'
  })
  assert(merged.includes('key_key.forward:key.keyboard.s'), 'registered key overwritten')
  assert(merged.includes('key_key.back:key.keyboard.w'), 'missing key appended')
  assert(merged.includes('customLine:keep'), 'custom line kept')
  assert(merged.includes('lang:zh_cn'), 'lang kept')
  const kb = read('src/main/core/keybindings.ts')
  assert.match(kb, /export function mergeKeysIntoOptions/)
  assert.match(kb, /export function syncKeysToGameDir/)
})

test('new/changed Vue components compile', () => {
  for (const file of ['src/renderer/src/views/KeysView.vue', 'src/renderer/src/components/HomeLayoutEditor.vue', 'src/renderer/src/views/SettingsView.vue', 'src/renderer/src/App.vue', 'src/renderer/src/views/AccountsView.vue']) {
    const source = read(file)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    const result = compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [], file)
  }
})
