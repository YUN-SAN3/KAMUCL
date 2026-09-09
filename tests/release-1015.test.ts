import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { decideUpdateAction } from '../src/main/core/selfUpdate'
import { getPendingUpdate, clearPendingUpdate } from '../src/main/core/applyUpdate'

const read = (file: string) => fs.readFileSync(file, 'utf8')
const rel = (version: string) => ({ version, publishedAt: '', body: '', assetUrl: 'u', assetSize: 1, assetName: `KAMUCL-${version}.exe` })

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

test('pending update roundtrip: readable only while file exists, clear removes', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-pend-'))
  process.env.KAMUCL_USERDATA_DIR = userData
  process.env.KAMUCL_UPDATE_API_BASE = 'http://127.0.0.1:8310'
  try {
    assert.equal(getPendingUpdate(), null, 'no pending initially')
    const fakeExe = path.join(userData, 'KAMUCL-9.9.9.exe')
    fs.writeFileSync(fakeExe, 'fake')
    fs.writeFileSync(path.join(userData, 'pending-update.json'), JSON.stringify({ release: rel('9.9.9'), file: fakeExe }))
    const p = getPendingUpdate()
    assert.equal(p?.release.version, '9.9.9')
    // 文件被删 → 视为无待装
    fs.rmSync(fakeExe)
    assert.equal(getPendingUpdate(), null)
    // clear 移除记录
    fs.writeFileSync(fakeExe, 'fake')
    clearPendingUpdate()
    assert.equal(getPendingUpdate(), null)
  } finally {
    delete process.env.KAMUCL_USERDATA_DIR
    delete process.env.KAMUCL_UPDATE_API_BASE
  }
})

test('quit-time auto install wiring: before-quit intercepts synchronously, 6h recheck, startup decision', () => {
  const index = read('src/main/index.ts')
  // before-quit 同步检查 pending 后 preventDefault（异步拦截无效）
  assert.match(index, /app\.on\('before-quit'/)
  assert.match(index, /getPendingUpdate\(\)[\s\S]*?e\.preventDefault\(\)/)
  assert.match(index, /applyPendingIfAny\(\)/)
  // 启动决策走 decideUpdateAction，auto 静默下载 / prompt 弹窗
  assert.match(index, /decideUpdateAction/)
  assert.match(index, /startAutoUpdate/)
  assert.match(index, /autoUpdate !== false/)
  // 运行中 6h 复查
  assert.match(index, /setInterval\(\(\) => void runUpdateCheck\(\), 6 \* 3600_000\)/)
  // 就绪事件与失败回滚标记
  assert.match(index, /updateReady/)
  assert.match(index, /consumeUpdateFailedFlag/)
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
  assert.match(kb, /writePendingUpdate\(release, dest\)/)
  assert.match(kb, /clearPendingUpdate\(\)[\s\S]*?updateDirOf/)
  const settings = read('src/renderer/src/views/SettingsView.vue')
  assert.match(settings, /自动安装更新/)
  assert.match(settings, /立即重启安装/)
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
