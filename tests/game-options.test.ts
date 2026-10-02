import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { encodeGameOption, uniqueGameOptions } from '../src/shared/gameOptions'

test('默认游戏选项按实例写入，版本转换后的游戏读值与界面一致', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-game-options-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const built = await build({ entryPoints: ['src/main/core/defaultGameOptions.ts'], platform: 'node', format: 'cjs', bundle: true, write: false, packages: 'external' })
  const require = createRequire(path.resolve('package.json')), mod = { exports: {} as any }
  new Function('require', 'module', 'exports', built.outputFiles[0].text)((name: string) => name === 'electron' ? { app: { getPath: () => root } } : require(name), mod, mod.exports)
  const api = mod.exports
  for (const [id, value] of Object.entries({ fov: 90, gamma: 73, autoJump: false, toggleCrouch: true, toggleSprint: true, mouseSensitivity: 125, chatOpacity: 55 })) api.setDefaultGameOptions({ id, value })
  assert.equal(api.getDefaultGameOptions().enabled, false)
  api.setDefaultGameOptions({ enabled: true })
  for (const version of ['1.8.9', '1.12.2', '1.16.5', '1.20.1', '1.21.11', '26.2']) {
    const dir = path.join(root, 'folder-' + version, 'versions', 'my-instance')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'options.txt')
    fs.writeFileSync(file, 'fov:0\r\nfov:1\r\ngamma:0\r\nlang:en_us\r\nkey_key.forward:key.keyboard.q\r\nmod:untouched\r\n')
    const result = api.syncDefaultGameOptions(dir, version)
    const text = fs.readFileSync(file, 'utf8')
    const values = Object.fromEntries(text.trim().split(/\r?\n/).map(line => { const n = line.indexOf(':'); return [line.slice(0, n), line.slice(n + 1)] }))
    // Minecraft Options FOV codec: normalized * 40 + 70; gamma/sensitivity captions use these scales.
    assert.equal(Number(values.fov) * 40 + 70, 90)
    assert.equal(Math.round(Number(values.gamma) * 100), 73)
    assert.equal(Number(values.mouseSensitivity) * 200, 125)
    assert.equal(Number(values.chatOpacity) * 90 + 10, 55)
    assert.equal(values.lang, 'en_us'); assert.equal(values.mod, 'untouched')
    assert.equal(text.match(/^fov:/gm)?.length, 1)
    if (version === '1.8.9' || version === '1.12.2') { assert.equal(values.toggleSprint, undefined); assert(result.unsupported.includes('疾跑')) }
    else { assert.equal(values.toggleSprint, 'true'); assert.equal(values.toggleCrouch, 'true'); assert.equal(values.autoJump, 'false') }
    api.syncDefaultGameOptions(dir, version); assert.equal(fs.readFileSync(file, 'utf8'), text)
  }
  assert.throws(() => api.setDefaultGameOptions({ id: 'fov', value: 120 }), /范围/)
  assert.throws(() => api.setDefaultGameOptions({ id: 'gamma', value: NaN }), /范围/)
  assert.throws(() => api.setDefaultGameOptions({ id: 'not-an-option', value: true }), /未知/)
  assert.throws(() => api.mergeGameOptions('', { fov: 90 }, 'my-renamed-instance'), /实际版本/)
  const highContrast = api.mergeGameOptions('resourcePacks:["vanilla","file/custom.zip"]\n', { highContrast: true }, '26.2')
  assert.match(highContrast.text, /resourcePacks:\["vanilla","file\/custom.zip","high_contrast"\]/)
  assert(!api.mergeGameOptions(highContrast.text, { highContrast: false }, '26.2').text.includes('"high_contrast"'))
  assert(!api.mergeGameOptions('', { touchscreen: true }, '26.2').applied.includes('touchscreen'))
  api.setDefaultGameOptions({ id: 'fov', value: null }); assert.equal(api.getDefaultGameOptions().values.fov, undefined)
  api.setDefaultGameOptions({ enabled: false })
  const absent = path.join(root, 'must-stay-absent'); api.syncDefaultGameOptions(absent, '26.2'); assert.equal(fs.existsSync(absent), false)
})

test('视场角每一度均能经存储值回读，旧语言格式正确', () => {
  const fov = uniqueGameOptions.find(d => d.id === 'fov')!
  for (let value = 30; value <= 110; value++) assert.equal(Math.round(Number(encodeGameOption(fov, value, '26.2')) * 40 + 70), value)
  const lang = uniqueGameOptions.find(d => d.id === 'lang')!
  assert.equal(encodeGameOption(lang, 'zh_cn', '1.8.9'), 'zh_CN')
  assert.equal(encodeGameOption(lang, 'zh_cn', '1.21.11'), 'zh_cn')
})
