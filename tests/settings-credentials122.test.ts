import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { gzipSync, gunzipSync } from 'node:zlib'
import { DEFAULT_MS_CLIENT_ID } from '../src/shared/types'

const requireFixture = createRequire(path.resolve('package.json'))
const oldKey = 'synthetic-custom-cf-key-old', newKey = 'synthetic-custom-cf-key-new'
const cipher = (value: string) => Buffer.from('fake-keyring:' + value).toString('base64')
const compiled = build({ stdin: { contents: "export {getSettings,saveSettings,getCurseforgeApiKey,resetSettingsToDefaults,migrateLegacyAppearanceAssets} from './src/main/core/settings'; export {importVisualTheme,exportVisualTheme,resetVisualTheme} from './src/main/core/visualTheme'; export {applyAppearanceDraft,saveAppearanceDraft} from './src/main/core/appearanceDraft'; export {createAppearanceAssetActions} from './src/main/core/appearanceAssetActions';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'owned-appearance-boundary', setup(builder) {
    builder.onResolve({ filter: /^\.\/appearanceAssets$/ }, args => /[\\/]settings\.ts$/.test(args.importer) ? { path: 'fixture:appearanceAssets', external: true } : undefined)
  } }] }).then(result => result.outputFiles[0].text)

async function runtime(t: import('node:test').TestContext, raw?: Record<string, unknown>, platform = 'win32') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-settings-vault122-'))
  const directory = path.join(root, 'userData'), file = path.join(directory, 'settings.json')
  fs.mkdirSync(directory)
  if (raw) fs.writeFileSync(file, JSON.stringify({ msClientId: DEFAULT_MS_CLIENT_ID, theme: 'black-orange', ...raw }))
  const state = { unlocked: true, encryptFails: false, decryptFails: false, fileFailure: '', writes: 0, encryptions: 0, imports: 0, removed: [] as string[] }
  const storage = { isEncryptionAvailable: () => state.unlocked,
    getSelectedStorageBackend: () => state.unlocked ? 'gnome_libsecret' : 'basic_text',
    encryptString: (value: string) => { state.encryptions++; if (state.encryptFails) throw Error('synthetic-sensitive-encryption-text'); return Buffer.from('fake-keyring:' + value) },
    decryptString: (value: Buffer) => { if (state.decryptFails) throw Error('synthetic-sensitive-decryption-text'); return value.toString().replace(/^fake-keyring:/, '') } }
  const ownedFs = { ...fs,
    writeFileSync: (target: any, content: any, options: any) => {
      state.writes++
      if (state.fileFailure === 'partial' && typeof target === 'number') { fs.writeFileSync(target, '{part', options); throw Error('synthetic-sensitive-file-error') }
      return fs.writeFileSync(target, content, options)
    }, renameSync: (from: fs.PathLike, to: fs.PathLike) => {
      if (state.fileFailure === 'rename' || (state.fileFailure === 'primary-rename' && String(to) === file)) throw Error('synthetic-sensitive-rename-error')
      fs.renameSync(from, to)
    } }
  const fakeProcess = Object.create(process); Object.defineProperty(fakeProcess, 'platform', { value: platform })
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', 'process', await compiled)((name: string) => {
    if (name === 'electron') return { app: { getPath: (key: string) => path.join(root, key) }, safeStorage: storage }
    if (name === 'node:fs') return ownedFs
    if (name === 'fixture:appearanceAssets') return {
      ensureGlobalImage: (value: string, _purpose: string, allowLegacy = false) => !value ? '' : allowLegacy || value.includes('/managed/') ? value : '',
      importGlobalImage: async (_source: string, purpose: string) => { state.imports++; const target = path.join(root, 'managed', purpose + state.imports); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, 'owned synthetic image bytes'); return { path: target } },
      removeGlobalImage: (value: string) => { state.removed.push(value) }
    }
    return requireFixture(name)
  }, module, module.exports, fakeProcess)
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { api: module.exports, root, directory, file, state }
}
function publicOnly(settings: any): void {
  assert(!Object.hasOwn(settings, 'curseforgeApiKey')); assert(!Object.hasOwn(settings, 'secureCredentials'))
  const json = JSON.stringify(settings); assert(!json.includes(oldKey)); assert(!json.includes(newKey)); assert(!json.includes(cipher(oldKey)))
}

test('custom key is write-only: real save/get responses never expose key or ciphertext and reload uses the vault', async t => {
  const rt = await runtime(t); const saved = rt.api.saveSettings({ curseforgeApiKey: oldKey, memoryMB: 6144 })
  publicOnly(saved); publicOnly(rt.api.getSettings()); assert.equal(saved.curseforgeApiKeyConfigured, true)
  const stored = JSON.parse(fs.readFileSync(rt.file, 'utf8')); assert(!Object.hasOwn(stored, 'curseforgeApiKey'))
  assert.equal(stored.secureCredentials.curseforgeApiKey, cipher(oldKey)); assert.equal(rt.api.getCurseforgeApiKey(), oldKey)
  const reopened = await runtime(t, stored); publicOnly(reopened.api.getSettings()); assert.equal(reopened.api.getCurseforgeApiKey(), oldKey)
  assert.equal(reopened.api.getSettings().memoryMB, 6144)
})
test('legacy plaintext key is atomically migrated without exposing it in any public settings object', async t => {
  const rt = await runtime(t, { curseforgeApiKey: oldKey, memoryMB: 6144, favoriteVersions: ['keep'] })
  publicOnly(rt.api.getSettings()); assert.equal(rt.api.getCurseforgeApiKey(), oldKey)
  const stored = JSON.parse(fs.readFileSync(rt.file, 'utf8')); assert(!Object.hasOwn(stored, 'curseforgeApiKey'))
  assert.equal(stored.secureCredentials.curseforgeApiKey, cipher(oldKey)); assert.deepEqual(stored.favoriteVersions, ['keep'])
  assert.equal(stored.memoryMB, 6144); assert(!fs.existsSync(rt.file + '.tmp'))
})
for (const platform of ['win32', 'darwin', 'linux']) test(platform + ' locked existing ciphertext survives unrelated appearance write and new secrets are rejected', async t => {
  const encrypted = cipher(oldKey), rt = await runtime(t, { secureCredentials: { curseforgeApiKey: encrypted }, memoryMB: 6144 }, platform)
  rt.state.unlocked = false; publicOnly(rt.api.getSettings())
  const saved = rt.api.saveSettings({ theme: 'blue-white', memoryMB: 8192 }); publicOnly(saved)
  assert.equal(saved.curseforgeApiKeyConfigured, true); assert.equal(JSON.parse(fs.readFileSync(rt.file, 'utf8')).secureCredentials.curseforgeApiKey, encrypted)
  const before = fs.readFileSync(rt.file, 'utf8'); assert.throws(() => rt.api.saveSettings({ curseforgeApiKey: newKey, memoryMB: 1 }), /安全存储/)
  assert.equal(fs.readFileSync(rt.file, 'utf8'), before); assert.equal(rt.api.getSettings().memoryMB, 8192)
  assert.throws(() => rt.api.getCurseforgeApiKey(), /安全存储暂不可用/)
  rt.state.unlocked = true; assert.equal(rt.api.getCurseforgeApiKey(), oldKey)
})
test('locked legacy plaintext is not recopied by automatic theme/identity migration or unrelated settings writes', async t => {
  const rt = await runtime(t, { curseforgeApiKey: oldKey, msClientId: 'old-not-authoritative', theme: 'legacy-invalid-theme', memoryMB: 6144 })
  const before = fs.readFileSync(rt.file, 'utf8'); rt.state.unlocked = false
  publicOnly(rt.api.getSettings()); assert.equal(rt.api.getSettings().curseforgeApiKeyConfigured, true)
  assert.equal(rt.api.getSettings().msClientId, DEFAULT_MS_CLIENT_ID); assert.equal(fs.readFileSync(rt.file, 'utf8'), before)
  assert.throws(() => rt.api.saveSettings({ memoryMB: 8192 }), /安全存储/); assert.equal(rt.api.getSettings().memoryMB, 6144)
  assert.equal(fs.readFileSync(rt.file, 'utf8'), before)
  rt.state.unlocked = true; const result = rt.api.saveSettings({ memoryMB: 8192 }); publicOnly(result)
  assert(!Object.hasOwn(JSON.parse(fs.readFileSync(rt.file, 'utf8')), 'curseforgeApiKey')); assert.equal(rt.api.getCurseforgeApiKey(), oldKey)
})
test('explicit clearing safely removes a legacy key even while the keyring is unavailable', async t => {
  const rt = await runtime(t, { curseforgeApiKey: oldKey }); rt.state.unlocked = false
  publicOnly(rt.api.getSettings()); const cleared = rt.api.saveSettings({ curseforgeApiKey: '' }); publicOnly(cleared)
  assert.equal(cleared.curseforgeApiKeyConfigured, false); assert.equal(rt.api.getCurseforgeApiKey(), '')
  const file = fs.readFileSync(rt.file, 'utf8'); assert(!file.includes(oldKey)); assert(!file.includes('secureCredentials'))
})
for (const fileFailure of ['partial', 'rename']) test('actual ' + fileFailure + ' failure retains cache, original custom credential and file bytes; no temp survives', async t => {
  const rt = await runtime(t, { secureCredentials: { curseforgeApiKey: cipher(oldKey) }, memoryMB: 6144 })
  publicOnly(rt.api.getSettings()); assert.equal(rt.api.getCurseforgeApiKey(), oldKey)
  const before = fs.readFileSync(rt.file, 'utf8'), cache = JSON.stringify(rt.api.getSettings()); rt.state.fileFailure = fileFailure
  assert.throws(() => rt.api.saveSettings({ curseforgeApiKey: newKey, memoryMB: 1 }), error => error instanceof Error && /设置写入失败/.test(error.message) && !error.message.includes('synthetic-sensitive'))
  assert.equal(fs.readFileSync(rt.file, 'utf8'), before); assert.equal(JSON.stringify(rt.api.getSettings()), cache)
  assert.equal(rt.api.getCurseforgeApiKey(), oldKey); assert(!fs.existsSync(rt.file + '.tmp'))
})
test('failed automatic plaintext migration preserves original file and credential then retries safely on the next write', async t => {
  const rt = await runtime(t, { curseforgeApiKey: oldKey, theme: 'legacy-invalid-theme' }), before = fs.readFileSync(rt.file, 'utf8')
  rt.state.fileFailure = 'rename'; publicOnly(rt.api.getSettings()); assert.equal(fs.readFileSync(rt.file, 'utf8'), before)
  assert.equal(rt.api.getCurseforgeApiKey(), oldKey); rt.state.fileFailure = ''
  publicOnly(rt.api.saveSettings({ theme: 'black-purple' })); assert(!Object.hasOwn(JSON.parse(fs.readFileSync(rt.file, 'utf8')), 'curseforgeApiKey'))
  assert.equal(rt.api.getCurseforgeApiKey(), oldKey)
})
test('key encryption and decryption failures retain existing ciphertext and do not reveal backend error text', async t => {
  const rt = await runtime(t, { secureCredentials: { curseforgeApiKey: cipher(oldKey) }, memoryMB: 6144 }), before = fs.readFileSync(rt.file, 'utf8')
  rt.state.decryptFails = true; publicOnly(rt.api.getSettings()); assert.equal(rt.api.getSettings().curseforgeApiKeyConfigured, true)
  assert.throws(() => rt.api.getCurseforgeApiKey(), error => error instanceof Error && /无法解密/.test(error.message) && !error.message.includes('synthetic-sensitive'))
  rt.state.encryptFails = true
  assert.throws(() => rt.api.saveSettings({ curseforgeApiKey: newKey }), error => error instanceof Error && /无法加密/.test(error.message) && !error.message.includes('synthetic-sensitive'))
  assert.equal(fs.readFileSync(rt.file, 'utf8'), before)
  rt.state.decryptFails = false; rt.state.encryptFails = false; assert.equal(rt.api.getCurseforgeApiKey(), oldKey)
})
test('private vault injection is rejected; configured state is read-only and malformed secret patches never write', async t => {
  const rt = await runtime(t, { secureCredentials: { curseforgeApiKey: cipher(oldKey) } }); publicOnly(rt.api.getSettings())
  const before = fs.readFileSync(rt.file, 'utf8')
  assert.throws(() => rt.api.saveSettings({ secureCredentials: { curseforgeApiKey: 'injected' } }), /不能.*注入/)
  for (const key of [undefined, null, 1, 'has\r\nheader', 'a'.repeat(4097)]) assert.throws(() => rt.api.saveSettings({ curseforgeApiKey: key }))
  assert.equal(fs.readFileSync(rt.file, 'utf8'), before)
  const result = rt.api.saveSettings({ curseforgeApiKeyConfigured: false }); publicOnly(result); assert.equal(result.curseforgeApiKeyConfigured, true)
})
test('related legacy image migration preserves encrypted credentials and rolls back newly imported assets on failure', async t => {
  const rt = await runtime(t, { secureCredentials: { curseforgeApiKey: cipher(oldKey) }, background: { mode: 'image', image: '/legacy/source-image.png' } })
  publicOnly(rt.api.getSettings()); const before = fs.readFileSync(rt.file, 'utf8'); rt.state.fileFailure = 'rename'
  await assert.rejects(rt.api.migrateLegacyAppearanceAssets(), /设置写入失败/); assert.equal(rt.state.imports, 1); assert.equal(rt.state.removed.length, 1)
  assert.equal(fs.readFileSync(rt.file, 'utf8'), before)
  rt.state.fileFailure = ''; await rt.api.migrateLegacyAppearanceAssets()
  publicOnly(rt.api.getSettings()); assert.equal(JSON.parse(fs.readFileSync(rt.file, 'utf8')).secureCredentials.curseforgeApiKey, cipher(oldKey))
})
test('reset backup is encrypted, reset clears the key, and a failed reset retains active cache/key/file', async t => {
  for (const fail of [false, true]) {
    const rt = await runtime(t, { curseforgeApiKey: oldKey, memoryMB: 6144 }); publicOnly(rt.api.getSettings())
    const before = fs.readFileSync(rt.file, 'utf8'); if (fail) rt.state.fileFailure = 'primary-rename'
    if (fail) {
      assert.throws(() => rt.api.resetSettingsToDefaults(), /设置写入失败/); assert.equal(fs.readFileSync(rt.file, 'utf8'), before)
      assert.equal(rt.api.getCurseforgeApiKey(), oldKey); assert.equal(rt.api.getSettings().memoryMB, 6144)
    } else { rt.api.resetSettingsToDefaults(); assert.equal(rt.api.getCurseforgeApiKey(), ''); assert(!rt.api.getSettings().curseforgeApiKeyConfigured) }
    for (const filename of fs.readdirSync(rt.directory)) {
      const content = fs.readFileSync(path.join(rt.directory, filename), 'utf8'); assert(!content.includes(oldKey)); assert(!content.includes(newKey))
      if (filename.startsWith('settings.backup-')) assert.equal(JSON.parse(content).secureCredentials.curseforgeApiKey, cipher(oldKey))
    }
  }
})
test('a damaged existing settings file cannot be replaced by defaults or a new custom key', async t => {
  const rt = await runtime(t); fs.writeFileSync(rt.file, '{damaged-original-settings'); const before = fs.readFileSync(rt.file, 'utf8')
  publicOnly(rt.api.getSettings()); assert.throws(() => rt.api.saveSettings({ curseforgeApiKey: newKey }), /原设置文件无法安全读取/)
  assert.throws(() => rt.api.resetSettingsToDefaults(), /无法安全读取/); assert.equal(fs.readFileSync(rt.file, 'utf8'), before)
})
test('a malformed legacy key cannot become an HTTP header but remains explicitly clearable without resetting unrelated preferences', async t => {
  const rt = await runtime(t, { curseforgeApiKey: 'bad\r\nheader', memoryMB: 6144 })
  const before = fs.readFileSync(rt.file, 'utf8'); publicOnly(rt.api.getSettings())
  assert.equal(rt.api.getSettings().memoryMB, 6144); assert.throws(() => rt.api.getCurseforgeApiKey(), /格式无效/)
  assert.equal(fs.readFileSync(rt.file, 'utf8'), before)
  publicOnly(rt.api.saveSettings({ curseforgeApiKey: '' })); assert.equal(rt.api.getCurseforgeApiKey(), '')
  assert.equal(rt.api.getSettings().memoryMB, 6144)
})
test('actual theme, appearance-draft and asset-settings response routes cannot echo raw or encrypted credentials', async t => {
  const rt = await runtime(t, { curseforgeApiKey: oldKey }); publicOnly(rt.api.getSettings())
  const code = 'KAMUCL2.' + gzipSync(JSON.stringify({ format: 2, theme: 'blue-white', custom: {}, assets: {}, curseforgeApiKey: newKey, secureCredentials: { curseforgeApiKey: cipher(newKey) } })).toString('base64')
  publicOnly(await rt.api.importVisualTheme(code, true)); publicOnly(await rt.api.importVisualTheme(code, false))
  rt.api.saveAppearanceDraft({ theme: 'black-purple', curseforgeApiKey: newKey })
  const draftFile = fs.readFileSync(path.join(rt.directory, 'appearance-draft.json'), 'utf8')
  assert(!draftFile.includes(oldKey)); assert(!draftFile.includes(newKey)); assert(!draftFile.includes('secureCredentials'))
  publicOnly(rt.api.applyAppearanceDraft({ theme: 'black-purple', curseforgeApiKey: newKey }))
  assert(!fs.existsSync(path.join(rt.directory, 'appearance-draft.json')))
  publicOnly(rt.api.resetVisualTheme())
  const actions = rt.api.createAppearanceAssetActions({ getSettings: rt.api.getSettings, saveSettings: rt.api.saveSettings,
    importImage: async () => ({ path: '' }), removeImage: () => {} })
  publicOnly(actions.resetBackground()); publicOnly(actions.resetLaunchThumbnail())
  const exported = gunzipSync(Buffer.from(rt.api.exportVisualTheme().slice(8), 'base64')).toString('utf8')
  assert(!exported.includes(oldKey)); assert(!exported.includes('secureCredentials')); assert.equal(rt.api.getCurseforgeApiKey(), oldKey)
})
