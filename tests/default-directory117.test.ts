import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { renderMarkdownLite } from '../src/renderer/src/markdownLite'

const requireFixture = createRequire(path.resolve('package.json'))
const compiled = build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `export { getSettings, saveSettings } from './src/main/core/settings'; export { removeGameFolder } from './src/main/core/gameFolders'` }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' }).then(result => result.outputFiles[0].text)
async function runtime(root: string) {
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', await compiled)((name: string) => name === 'electron' ? { app: { getPath: (key: string) => path.join(root, key) }, BrowserWindow: { getAllWindows: () => [] } } : requireFixture(name), module, module.exports)
  return module.exports
}
function temporary(t: import('node:test').TestContext, raw?: unknown) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-default117-'))
  t.after(() => fs.rmSync(root, { force: true, recursive: true }))
  if (raw) { fs.mkdirSync(path.join(root, 'userData'), { recursive: true }); fs.writeFileSync(path.join(root, 'userData/settings.json'), JSON.stringify(raw)) }
  return root
}

test('new profiles use .minecraft and retain any pre-existing Minecraft contents', async t => {
  const root = temporary(t), target = path.join(root, 'appData/.minecraft')
  fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, 'keep.txt'), 'existing game')
  const api = await runtime(root), settings = api.getSettings()
  assert.equal(settings.gameDir, target); assert.equal(settings.folders[0].path, target)
  assert.equal(settings.rememberGameWindowSize, false)
  assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'existing game'); assert.equal(fs.existsSync(path.join(root, 'appData/.kamucl')), false)
})

test('legacy profile without folders preserves its configured game directory and data', async t => {
  const root = temporary(t), legacy = path.join(root, 'appData/.kamucl')
  fs.mkdirSync(legacy, { recursive: true }); fs.writeFileSync(path.join(legacy, 'keep.txt'), 'legacy saved game')
  fs.mkdirSync(path.join(root, 'userData')); fs.writeFileSync(path.join(root, 'userData/settings.json'), JSON.stringify({ gameDir: legacy }))
  const api = await runtime(root), settings = api.getSettings()
  assert.equal(settings.activeFolder, legacy); assert.equal(settings.gameDir, legacy); assert.equal(settings.folders[0].path, legacy)
  assert.equal(fs.existsSync(path.join(root, 'appData/.minecraft')), false); assert.equal(fs.readFileSync(path.join(legacy, 'keep.txt'), 'utf8'), 'legacy saved game')
})

test('existing custom folders remain unchanged; removing the last registration preserves files', async t => {
  const root = temporary(t), custom = path.join(root, 'D 中文 § 游戏')
  fs.mkdirSync(custom); fs.writeFileSync(path.join(custom, 'keep.txt'), 'custom saved game')
  fs.mkdirSync(path.join(root, 'userData')); fs.writeFileSync(path.join(root, 'userData/settings.json'), JSON.stringify({ gameDir: custom, activeFolder: custom, folders: [{ path: custom, name: 'custom', isDefault: true }] }))
  const api = await runtime(root); assert.equal(api.getSettings().gameDir, custom)
  const folders = api.removeGameFolder(custom); assert.equal(folders[0].path, path.join(root, 'appData/.minecraft'))
  assert.equal(fs.readFileSync(path.join(custom, 'keep.txt'), 'utf8'), 'custom saved game')
})

test('window-size setting rejects invalid values and failed commits retain prior preference', async t => {
  const root = temporary(t), api = await runtime(root)
  api.saveSettings({ rememberGameWindowSize: true }); assert.equal(api.getSettings().rememberGameWindowSize, true)
  assert.throws(() => api.saveSettings({ rememberGameWindowSize: 'yes' }), /保存游戏窗口大小/)
  fs.mkdirSync(path.join(root, 'userData/settings.json.tmp'))
  assert.throws(() => api.saveSettings({ rememberGameWindowSize: false }), /设置写入失败/)
  assert.equal(api.getSettings().rememberGameWindowSize, true)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'userData/settings.json'), 'utf8')).rememberGameWindowSize, true)
})

test('bundled notices render Markdown headings and emphasis while escaping script/unsafe links', () => {
  const html = renderMarkdownLite('# Notices\n## Terms\n**copyright**\n<script>alert(1)</script>\n[unsafe](javascript:alert(1))')
  assert(html.includes('<h4>Notices</h4>')); assert(html.includes('<strong>copyright</strong>'))
  assert(!html.includes('<script>')); assert(!html.includes('href="javascript:'))
})
