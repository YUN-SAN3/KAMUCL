import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { decideUpdateAction } from '../src/main/core/selfUpdate'

const read = (file: string) => fs.readFileSync(file, 'utf8')
const rel = (version: string) => ({ version, publishedAt: '', body: '', assetUrl: 'u', assetSize: 1, assetName: `KAMUCL-${version}.exe` })

let pendingFixtureCode: Promise<string>
async function pendingFixture(root: string, platform: string, arch = 'x64', packaged = false, execPath = process.execPath) {
  pendingFixtureCode ??= build({ entryPoints: ['src/main/core/applyUpdate.ts'], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external' }).then(r => r.outputFiles[0].text)
  const require = createRequire(path.resolve('package.json')), mod = { exports: {} as any }
  const env = { ...process.env, KAMUCL_USERDATA_DIR: root, KAMUCL_UPDATE_API_BASE: 'http://127.0.0.1:8310' }
  delete env.PORTABLE_EXECUTABLE_FILE; delete env.KAMUCL_UPDATE_TARGET_EXE; delete env.APPIMAGE
  const controlledProcess = Object.create(process)
  Object.defineProperties(controlledProcess, { platform: { value: platform }, arch: { value: arch }, env: { value: env }, execPath: { value: execPath } })
  new Function('require', 'module', 'exports', 'process', await pendingFixtureCode)(
    (name: string) => name === 'electron' ? { app: { isPackaged: packaged, getPath: () => root, getVersion: () => '1.0.14' } } : require(name),
    mod, mod.exports, controlledProcess)
  return mod.exports
}

test('auto update decision: silent download by default, prompt when disabled, none when redundant', () => {
  const base = { release: rel('1.0.15'), skipVersion: undefined, current: '1.0.14', autoUpdate: true as boolean, supported: true, downloading: false, pendingVersion: undefined as string | undefined }
  // 默认（autoUpdate）→ 静默自动下载
  assert.equal(decideUpdateAction({ ...base, autoUpdate: true }), 'auto-download')
  // 关闭自动 → 弹窗询问
  assert.equal(decideUpdateAction({ ...base, autoUpdate: false }), 'prompt')
  // 开发模式（不支持自更新）→ 弹窗询问（看得到更新但需手动）
  assert.equal(decideUpdateAction({ ...base, autoUpdate: true, supported: false }), 'prompt')
  // 已在下载 → 不重复
  assert.equal(decideUpdateAction({ ...base, downloading: true }), 'none')
  // 已有同版或更新版就绪 → 不再下载
  assert.equal(decideUpdateAction({ ...base, pendingVersion: '1.0.15' }), 'none')
  assert.equal(decideUpdateAction({ ...base, pendingVersion: '1.0.16' }), 'none')
  // 更旧的就绪 → 重新下载新版
  assert.equal(decideUpdateAction({ ...base, pendingVersion: '1.0.14' }), 'auto-download')
  // 跳过版本不动作
  assert.equal(decideUpdateAction({ ...base, skipVersion: '1.0.15' }), 'none')
  // 无更新
  assert.equal(decideUpdateAction({ ...base, release: undefined }), 'none')
})

test('Windows legacy pending update roundtrip: readable only while file exists, clear removes', { timeout: 10000 }, async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-pend-'))
  try {
    const { getPendingUpdate, clearPendingUpdate } = await pendingFixture(userData, 'win32')
    assert.equal(getPendingUpdate(), null, 'no pending initially')
    const fakeExe = path.join(userData, 'KAMUCL-9.9.9.exe')
    const marker = path.join(userData, 'pending-update.json')
    fs.writeFileSync(fakeExe, 'fake')
    fs.writeFileSync(marker, JSON.stringify({ release: rel('9.9.9'), file: fakeExe }))
    const p = getPendingUpdate()
    assert.equal(p?.release.version, '9.9.9')
    // 文件被删 → 视为无待装
    fs.rmSync(fakeExe)
    assert.equal(getPendingUpdate(), null)
    // clear 移除记录
    fs.writeFileSync(fakeExe, 'fake')
    fs.writeFileSync(marker, JSON.stringify({ release: rel('9.9.9'), file: fakeExe }))
    assert.equal(getPendingUpdate()?.release.version, '9.9.9')
    clearPendingUpdate()
    assert.equal(getPendingUpdate(), null)
    assert.equal(fs.existsSync(marker), false)
    assert.equal(fs.existsSync(fakeExe), true, 'clearing a record preserves its payload')
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})

test('Mac and Linux pending marker routing preserves Windows legacy records (filesystem fixtures)', { timeout: 10000 }, async t => {
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'arm64'], ['linux', 'x64']] as const) {
    await t.test(`${platform}/${arch}`, { timeout: 5000 }, async t => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-native-pend-'))
      t.after(() => fs.rmSync(root, { recursive: true, force: true }))
      const target = path.join(root, platform === 'darwin' ? 'KAMUCL.app' : 'KAMUCL-portable')
      const exe = platform === 'darwin' ? path.join(target, 'Contents/MacOS/KAMUCL') : path.join(target, 'kamucl')
      fs.mkdirSync(path.dirname(exe), { recursive: true }); fs.writeFileSync(exe, 'fixture')
      if (platform === 'darwin') fs.writeFileSync(path.join(target, 'Contents/Info.plist'), 'fixture')
      const api = await pendingFixture(root, platform, arch, true, exe)
      const legacyFile = path.join(root, 'KAMUCL-9.9.9.exe'), legacyMarker = path.join(root, 'pending-update.json')
      fs.writeFileSync(legacyFile, 'fixture')
      const legacyRecord = JSON.stringify({ release: rel('9.9.9'), file: legacyFile })
      fs.writeFileSync(legacyMarker, legacyRecord)
      assert.equal(api.getPendingUpdate(), null, 'native routing must not accept a Windows EXE record')
      const nativeName = platform === 'darwin' ? 'mac' : 'linux'
      const file = path.join(root, `${nativeName}-updates`, `KAMUCL-9.9.9-${nativeName}-${arch}.${platform === 'darwin' ? 'zip' : 'tar.gz'}`)
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture')
      const marker = path.join(root, `${nativeName}-update.json`)
      const transaction = { schema: 1, id: randomUUID(), target, file,
        sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), size: fs.statSync(file).size,
        from: '1.0.14', mode: 'upgrade', release: { ...rel('9.9.9'), assetName: path.basename(file) } }
      fs.writeFileSync(marker, JSON.stringify(transaction))
      assert.deepEqual(api.getPendingUpdate(), transaction, 'the platform-specific reader returns its own transaction')
      fs.writeFileSync(marker, JSON.stringify({ ...transaction, target: path.join(root, 'Other') }))
      assert.equal(api.getPendingUpdate(), null, 'a transaction for another target remains rejected')
      fs.writeFileSync(marker, JSON.stringify(transaction))
      api.clearPendingUpdate()
      assert.equal(api.getPendingUpdate(), null)
      assert.equal(fs.existsSync(marker), false)
      assert.equal(fs.existsSync(file), true)
      assert.equal(fs.readFileSync(legacyMarker, 'utf8'), legacyRecord, 'native clear must preserve the unrelated Windows marker')
    })
  }
})

test('next-startup updates never intercept launcher closing', () => {
  const index = read('src/main/index.ts')
  assert.match(index, /applyUpdateOnStartup\(\)/)
  assert(!index.includes('applyingPendingUpdate'))
  assert(!index.includes('applyPendingIfAny'))
  assert.match(index, /blockedUpdateVersion/)
  assert.match(index, /acknowledgeUpdateStartup/)
  assert.match(index, /decideUpdateAction/)
  assert.match(index, /setInterval\(\(\) => void runUpdateCheck\(\), 6 \* 3600_000\)/)
})

test('auto update surfaces: settings toggle, pending state IPC, ready event', () => {
  const types = read('src/shared/types.ts')
  assert.match(types, /autoUpdate\?: boolean/)
  assert.match(types, /updateGetPending/)
  assert.match(types, /updateApplyPending/)
  assert.match(types, /updateReady: 'event:updateReady'/)
  const ipc = read('src/main/ipc.ts')
  assert.match(ipc, /IPC\.updateGetPending/)
  assert.match(ipc, /IPC\.updateApplyPending/)
  const kb = read('src/main/core/applyUpdate.ts')
  // 下载校验通过即写待安装；新下载开始先清旧待装；手动安装前也清
  assert.match(kb, /await writePendingUpdate\(release, dest, expected, mode\)/)
  assert.match(kb, /updateMarker/)
  const settings = read('src/renderer/src/views/SettingsView.vue')
  assert.match(settings, /自动安装更新/)
  assert.match(settings, /\{\{\s*installAction\s*\}\}/)
  assert.match(read('src/renderer/src/composables/usePlatformUpdate.ts'), /下次启动应用/)
  assert.match(settings, /pendingUpdate/)
})

test('update-related SFCs compile', () => {
  for (const file of ['src/renderer/src/views/SettingsView.vue', 'src/renderer/src/App.vue', 'src/renderer/src/components/UpdateModal.vue']) {
    const source = read(file)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    const result = compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [], file)
  }
})
