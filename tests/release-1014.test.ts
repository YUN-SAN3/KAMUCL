import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { compareSemver, isNewerVersion, parseSemver } from '../src/shared/semver'
import { parseSha256Sums, shouldPrompt, checkLatest, sha256File } from '../src/main/core/selfUpdate'
import { buildUpdaterScript, updateDownloadCandidates } from '../src/main/core/applyUpdate'
import { renderMarkdownLite } from '../src/renderer/src/markdownLite'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('semver: numeric comparison, never string comparison (v1.10.0 > v1.9.9)', () => {
  assert.equal(compareSemver('v1.10.0', 'v1.9.9'), 1)
  assert.equal(compareSemver('1.9.9', '1.10.0'), -1)
  assert.equal(compareSemver('1.0.0', 'v1.0.0'), 0)
  assert.equal(compareSemver('2.0.0', '10.0.0'), -1)
  assert.equal(isNewerVersion('1.0.14', '1.0.13'), true)
  assert.equal(isNewerVersion('1.0.13', '1.0.13'), false)
  assert.deepEqual(parseSemver('v1.2.3'), [1, 2, 3])
  assert.equal(parseSemver('not-a-version'), null)
})

test('skip logic: skipped version not prompted, newer-than-skipped prompts again', () => {
  const rel = (version: string) => ({ version, publishedAt: '', body: '', assetUrl: 'u', assetSize: 1, assetName: 'n' })
  // 有更新且未跳过 → 提示
  assert.equal(shouldPrompt(rel('1.0.14'), undefined, '1.0.13'), true)
  // 跳过的版本不再提示
  assert.equal(shouldPrompt(rel('1.0.14'), '1.0.14', '1.0.13'), false)
  // 比跳过版本更新 → 再提示（"直到下下个版本"）
  assert.equal(shouldPrompt(rel('1.0.15'), '1.0.14', '1.0.13'), true)
  // 不新于当前 → 不提示
  assert.equal(shouldPrompt(rel('1.0.13'), undefined, '1.0.13'), false)
  assert.equal(shouldPrompt(undefined, undefined, '1.0.13'), false)
})

test('sha256 sums parser: standard sha256sum format', () => {
  const sums = parseSha256Sums(
    'a'.repeat(64) + '  KAMUCL-1.0.14.exe\n' + 'b'.repeat(64) + ' *KAMUCL-1.0.14-windows-x64.zip\n'
  )
  assert.equal(sums.get('KAMUCL-1.0.14.exe'), 'a'.repeat(64))
  assert.equal(sums.get('KAMUCL-1.0.14-windows-x64.zip'), 'b'.repeat(64))
})

test('download candidates honor source setting: auto=direct+mirror, direct only, mirror only', () => {
  const url = 'https://github.com/x/KAMUCL-1.0.14.exe'
  const auto = updateDownloadCandidates(url, { updateSource: 'auto', updateMirrorUrl: 'https://ghproxy.net/' })
  assert.deepEqual(auto, [url, 'https://ghproxy.net/' + url])
  assert.deepEqual(updateDownloadCandidates(url, { updateSource: 'direct', updateMirrorUrl: '' }), [url])
  assert.deepEqual(updateDownloadCandidates(url, { updateSource: 'mirror', updateMirrorUrl: 'https://m.example/' }), ['https://m.example/' + url])
})

test('updater script: waits for main pid, backups old exe, moves new, watches 20s, rollback writes flag', () => {
  const s = buildUpdaterScript({
    oldExe: 'D:\\启动器\\KAMUCL-1.0.13.exe',
    newExe: 'D:\\启动器\\KAMUCL-update\\KAMUCL-1.0.14.exe',
    backupDir: 'D:\\启动器\\KAMUCL-backup',
    mainPid: 12345,
    stateDir: 'C:\\Users\\x\\AppData\\Roaming\\kamucl'
  })
  assert.match(s, /Get-Process -Id \$mainPid/)
  // 移动改为带重试的 Move-WithRetry（便携包外层进程文件锁延迟释放）
  assert.match(s, /function Move-WithRetry\(/)
  assert.match(s, /Move-WithRetry \$oldExe \(Join-Path \$backupDir/)
  assert.match(s, /Move-WithRetry \$newExe \$newTarget/)
  // 每步写 updater-last.log（可诊断）
  assert.match(s, /updater-last\.log/)
  assert.match(s, /Start-Sleep -Seconds 20/)
  assert.match(s, /update-failed\.flag/)
  assert.match(s, /Restore-Backup/)
  // 仅留一份备份
  assert.match(s, /Remove-Item.*-Filter 'KAMUCL-\*\.exe'|-Filter 'KAMUCL-\*\.exe'[\s\S]*?Remove-Item/)
  // 还原模式不生成新备份
  const r = buildUpdaterScript({ oldExe: 'a', newExe: 'b', backupDir: 'c', mainPid: 1, stateDir: 'd', restore: true })
  assert.match(r, /\$doBackup = \$false/)
})

test('markdown lite: escapes HTML, renders headings/bold/code/lists/links only', () => {
  const html = renderMarkdownLite('## 标题\n- **加粗** 和 `代码`\n<script>alert(1)</script>\n[链接](https://example.com)')
  assert(!html.includes('<script>'), 'raw HTML must be escaped')
  assert(html.includes('&lt;script&gt;'))
  assert(html.includes('<h4>标题</h4>'))
  assert(html.includes('<strong>加粗</strong>'))
  assert(html.includes('<code>代码</code>'))
  assert(html.includes('<li>'))
  assert(html.includes('<a href="https://example.com"'))
})

test('checkLatest against mock server: hasUpdate, cache, 304 etag, silent degrade', async () => {
  const { startMockServer } = await import('./helpers/mockUpdateServer.mjs')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-upd-'))
  process.env.KAMUCL_USERDATA_DIR = userData
  process.env.KAMUCL_VERSION_OVERRIDE = '1.0.0'
  const server = await startMockServer(0)
  try {
    process.env.KAMUCL_UPDATE_API_BASE = `http://127.0.0.1:${server.port}`
    // 第一次：mock latest v99.0.0 → 有更新
    const r1 = await checkLatest(true)
    assert.equal(r1.ok, true)
    assert.equal(r1.hasUpdate, true)
    assert.equal(r1.release?.version, '99.0.0')
    // 缓存文件已写
    assert(fs.existsSync(path.join(userData, 'update-check-cache.json')))
    // 第二次（不 force，走 6h 缓存）→ fromCache
    const r2 = await checkLatest(false)
    assert.equal(r2.fromCache, true)
    assert.equal(r2.hasUpdate, true)
    // 服务器挂掉 → 静默降级用缓存，不抛错
    await server.close()
    const r3 = await checkLatest(true)
    assert.equal(r3.hasUpdate, true)
    assert.equal(r3.fromCache, true)
    assert.equal(r3.reason, 'network')
    // 版本比较正确：本地 99.0.1 时 latest 99.0.0 不算更新
    process.env.KAMUCL_VERSION_OVERRIDE = '99.0.1'
    const r4 = await checkLatest(false)
    assert.equal(r4.hasUpdate, false)
  } finally {
    await server.close().catch(() => {})
    delete process.env.KAMUCL_UPDATE_API_BASE
    delete process.env.KAMUCL_USERDATA_DIR
    delete process.env.KAMUCL_VERSION_OVERRIDE
  }
})

test('update wiring: IPC channels registered, startup auto-check, skip persisted, QQ group configurable', () => {
  const ipc = read('src/main/ipc.ts')
  for (const ch of ['updateCheck', 'updateSkip', 'updateStart', 'updateApply', 'updateListReleases', 'updateGetState', 'updateRestoreBackup', 'updatePickLocalFile', 'updateApplyLocal', 'updateGetConfigStatus', 'updateResetSettings']) {
    assert.match(ipc, new RegExp(`IPC\\.${ch}`), ch)
  }
  const index = read('src/main/index.ts')
  assert.match(index, /checkLatest\(false\)/)
  assert.match(index, /decideUpdateAction/)
  assert.match(index, /consumeUpdateFailedFlag/)
  const types = read('src/shared/types.ts')
  assert.match(types, /skipUpdateVersion\?: string/)
  assert.match(types, /updateSource\?: 'auto' \| 'direct' \| 'mirror'/)
  assert.match(types, /qqGroupNumber\?: string/)
  assert.match(types, /configVersion\?: number/)
  const branding = read('src/shared/branding.ts')
  assert.match(branding, /QQ_GROUP_NUMBER/)
  assert.match(branding, /QQ_GROUP_HINT/)
  const modal = read('src/renderer/src/components/UpdateModal.vue')
  assert.match(modal, /复制群号/)
  assert.match(modal, /QQ_GROUP_HINT/)
  assert.match(modal, /slowHint/)
  assert.match(modal, /renderMarkdownLite/)
})

test('update SFCs compile', () => {
  for (const file of ['src/renderer/src/components/UpdateModal.vue', 'src/renderer/src/views/SettingsView.vue', 'src/renderer/src/App.vue']) {
    const source = read(file)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    const result = compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [], file)
  }
})

test('sha256File hashes real file content', async () => {
  const f = path.join(os.tmpdir(), `kamucl-sha-${Date.now()}.bin`)
  fs.writeFileSync(f, 'kamucl')
  const crypto = await import('node:crypto')
  const expected = crypto.createHash('sha256').update('kamucl').digest('hex')
  assert.equal(await sha256File(f), expected)
  fs.rmSync(f, { force: true })
})
