import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import AdmZip from 'adm-zip'
import { app } from 'electron'
import type { ReleaseInfo } from '../../shared/types'
import { atomicUpdateJson, validateUpdatePayload, type UpdateTransaction } from './updateTransaction'
import { updateAssetName } from './updateTrust'
import { sha256File, currentVersion } from './selfUpdate'
import { compareSemver } from '../../shared/semver'

const run = promisify(execFile)
const data = () => app.getPath('userData')
const marker = () => path.join(data(), 'mac-update.json')
const claim = () => marker() + '.applying'
function recordFailure(error: unknown): void {
  try { fs.appendFileSync(path.join(data(), 'mac-updater.log'), `${new Date().toISOString()} ${String(error)}\n`) } catch { /* preserve startup on read-only storage */ }
}
export const macUpdateDir = () => path.join(data(), 'mac-updates')
export function macAppTarget(): string | null {
  if (process.platform !== 'darwin' || !app.isPackaged) return null
  const target = path.resolve(process.execPath, '../../..')
  return target.endsWith('.app') && fs.existsSync(path.join(target, 'Contents/Info.plist')) ? target : null
}
export function macUpdateSupported(): boolean {
  const target = macAppTarget()
  if (!target || target.startsWith('/Volumes/') || target.includes('/AppTranslocation/')) return false
  try { fs.accessSync(path.dirname(target), fs.constants.W_OK); return true } catch { return false }
}
function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file)
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}
export function readMacUpdate(file = marker()): UpdateTransaction | null {
  try {
    const t = JSON.parse(fs.readFileSync(file, 'utf8')) as UpdateTransaction
    if (t.schema !== 1 || !/^[a-f\d-]{36}$/i.test(t.id) || t.target !== macAppTarget() ||
      !inside(macUpdateDir(), t.file) || !/^[a-f\d]{64}$/.test(t.sha256) || !Number.isSafeInteger(t.size) || t.size <= 0 ||
      !/^\d+\.\d+\.\d+$/.test(t.release?.version) || path.basename(t.file) !== updateAssetName(t.release.version) ||
      !['upgrade', 'rollback', 'local'].includes(t.mode)) return null
    return t
  } catch { return null }
}
export function clearMacUpdate(): void { fs.rmSync(marker(), { force: true }) }
export function blockedMacVersion(): string | undefined {
  return (readMacUpdate(claim()) ?? readMacUpdate(claim() + '.failed'))?.release.version
}
export async function stageMacUpdate(release: ReleaseInfo, file: string, sha256: string, mode: UpdateTransaction['mode']): Promise<void> {
  if (!macUpdateSupported()) throw new Error('请将 KAMUCL.app 拖入可写的应用程序目录后再更新')
  if (path.basename(file) !== updateAssetName(release.version) || !inside(macUpdateDir(), file)) throw new Error('请选择与当前 Mac 架构一致的官方 ZIP 包')
  const t: UpdateTransaction = { schema: 1, id: randomUUID(), target: macAppTarget()!, file, sha256, size: fs.statSync(file).size, from: currentVersion(), release, mode }
  await validateUpdatePayload(t)
  validateMacArchive(file)
  atomicUpdateJson(marker(), t)
}

/** Reject traversal and escaping symlinks before handing the archive to ditto. */
export function validateMacArchive(file: string): void {
  const entries = new AdmZip(file).getEntries()
  let total = 0, hasApp = false
  for (const e of entries) {
    const name = e.entryName
    if (name.includes('\\') || name.startsWith('/') || name.split('/').includes('..') ||
      !(name.startsWith('KAMUCL.app/') || name === 'KAMUCL.app' || name.startsWith('__MACOSX/'))) throw new Error('Mac 更新包包含越界路径')
    total += e.header.size
    if (total > 3 * 1024 ** 3) throw new Error('Mac 更新包解压大小异常')
    if (name === 'KAMUCL.app/Contents/Resources/app.asar') hasApp = true
    if (((e.attr >>> 16) & 0xf000) === 0xa000) {
      const link = e.getData().toString('utf8')
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), link))
      if (path.posix.isAbsolute(link) || !resolved.startsWith('KAMUCL.app/')) throw new Error('Mac 更新包符号链接越界')
    }
  }
  if (!hasApp) throw new Error('更新包缺少 KAMUCL.app')
}
async function verifyBundle(bundle: string, version: string): Promise<void> {
  const plist = path.join(bundle, 'Contents/Info.plist')
  const value = async (key: string) => (await run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist])).stdout.trim()
  if (await value('CFBundleIdentifier') !== 'com.kamucl.launcher' || await value('CFBundleShortVersionString') !== version || await value('CFBundleExecutable') !== 'KAMUCL') throw new Error('Mac 更新包身份或版本不匹配')
  await run('/usr/bin/lipo', [path.join(bundle, 'Contents/MacOS/KAMUCL'), '-verify_arch', process.arch === 'arm64' ? 'arm64' : 'x86_64'])
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle])
}
const asar = (bundle: string) => path.join(bundle, 'Contents/Resources/app.asar')
// Hash the archive bytes outside Electron's virtual ASAR filesystem.
async function asarHash(bundle: string): Promise<string> {
  const hash = (await run('/usr/bin/shasum', ['-a', '256', asar(bundle)])).stdout.slice(0, 64)
  if (!/^[a-f\d]{64}$/.test(hash)) throw new Error('无法校验 Mac 应用归档')
  return hash
}
const q = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'"
export function macUpdaterScript(t: UpdateTransaction, stage: string, oldHash: string, newHash: string, pid: number, stateDir: string): string {
  const backup = path.join(path.dirname(t.target), `.KAMUCL-backup-${t.id}.app`)
  const applying = path.join(stateDir, 'mac-update.json.applying')
  const state = JSON.stringify({ from: t.from, to: t.release.version, time: new Date().toISOString(), backupPath: backup, backupVersion: t.from, result: 'applied' })
  return `#!/bin/sh
set -eu
exec >>${q(path.join(stateDir, 'mac-updater.log'))} 2>&1
fail() { printf '%s' 'Mac 更新未完成，当前程序及备份已保留。' >${q(path.join(stateDir, 'update-failed.flag'))}; mv -f ${q(applying)} ${q(applying + '.failed')} 2>/dev/null || true; }
trap fail EXIT
n=0
while kill -0 ${pid} 2>/dev/null; do n=$((n+1)); [ "$n" -lt 120 ] || exit 1; sleep 0.5; done
[ "$(/usr/bin/shasum -a 256 ${q(asar(t.target))} | /usr/bin/awk '{print $1}')" = ${q(oldHash)} ]
[ "$(/usr/bin/shasum -a 256 ${q(asar(stage))} | /usr/bin/awk '{print $1}')" = ${q(newHash)} ]
/usr/bin/codesign --verify --deep --strict ${q(stage)}
/bin/mv ${q(t.target)} ${q(backup)}
if ! /bin/mv ${q(stage)} ${q(t.target)}; then /bin/mv ${q(backup)} ${q(t.target)}; exit 1; fi
printf '%s' ${q(state)} >${q(path.join(stateDir, 'update-state.json.tmp'))}
/bin/mv -f ${q(path.join(stateDir, 'update-state.json.tmp'))} ${q(path.join(stateDir, 'update-state.json'))}
/usr/bin/open -n ${q(t.target)}
n=0
while [ "$n" -lt 240 ]; do
  if [ "$(cat ${q(applying + '.receipt')} 2>/dev/null || true)" = ${q(t.id)} ]; then
    mv -f ${q(applying)} ${q(applying + '.completed')}
    trap - EXIT
    exit 0
  fi
  n=$((n+1)); sleep 0.5
done
# Never kill the relaunched app or a game to roll back; retain the backup for explicit recovery.
exit 1
`
}
let acknowledged: UpdateTransaction | null = null
export async function applyMacUpdateOnStartup(): Promise<boolean> {
  if (!macUpdateSupported()) return false
  try {
  const previous = readMacUpdate(claim()) as (UpdateTransaction & { installedHash?: string }) | null
  if (previous) {
    if (previous.release.version === currentVersion() && previous.installedHash === await asarHash(previous.target)) {
      await verifyBundle(previous.target, currentVersion()); acknowledged = previous; return false
    }
    try { if (previous.helperPid) { process.kill(previous.helperPid, 0); return false } } catch { /* interrupted */ }
    fs.renameSync(claim(), claim() + '.failed')
  }
  } catch (error) {
    recordFailure(error)
    // A damaged/interrupted transaction must never prevent the launcher from opening.
    try { fs.renameSync(claim(), claim() + '.failed'); fs.writeFileSync(path.join(data(), 'update-failed.flag'), String(error)) } catch { /* read-only state */ }
    return false
  }
  const t = readMacUpdate()
  if (!t) return false
  try {
    if (t.mode === 'upgrade' && compareSemver(t.release.version, currentVersion()) <= 0) { clearMacUpdate(); return false }
    await validateUpdatePayload(t); validateMacArchive(t.file)
    const stagingDir = fs.mkdtempSync(path.join(path.dirname(t.target), '.KAMUCL-update-'))
    await run('/usr/bin/ditto', ['-x', '-k', t.file, stagingDir])
    const stagedApp = path.join(stagingDir, 'KAMUCL.app')
    await verifyBundle(stagedApp, t.release.version)
    const oldHash = await asarHash(t.target), installedHash = await asarHash(stagedApp)
    const script = path.join(macUpdateDir(), `apply-${t.id}.sh`)
    fs.writeFileSync(script, macUpdaterScript(t, stagedApp, oldHash, installedHash, process.pid, data()), { mode: 0o700 })
    fs.renameSync(marker(), claim())
    atomicUpdateJson(claim(), { ...t, installedHash })
    const helper = spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' })
    await new Promise<void>((resolve, reject) => { helper.once('spawn', resolve); helper.once('error', reject) })
    atomicUpdateJson(claim(), { ...t, installedHash, helperPid: helper.pid })
    helper.unref(); app.exit(0); return true
  } catch (error) {
    recordFailure(error)
    try {
    atomicUpdateJson(claim() + '.failed', t); clearMacUpdate()
    fs.rmSync(claim(), { force: true }); fs.writeFileSync(path.join(data(), 'update-failed.flag'), String(error))
    } catch { /* Reporting failure must not block opening the existing application. */ }
    return false
  }
}
export async function acknowledgeMacUpdate(): Promise<void> {
  if (!acknowledged) return
  const stateFile = path.join(data(), 'update-state.json')
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  atomicUpdateJson(stateFile, { ...state, result: 'ok' })
  fs.writeFileSync(claim() + '.receipt', acknowledged.id)
}
export async function stageMacBackup(backup: string, version: string): Promise<void> {
  await verifyBundle(backup, version)
  const dir = path.join(macUpdateDir(), randomUUID()); fs.mkdirSync(dir, { recursive: true })
  // Backup's unique basename must become the canonical app name inside the ZIP.
  const copy = path.join(dir, 'KAMUCL.app')
  await run('/usr/bin/ditto', [backup, copy])
  const assetName = updateAssetName(version), file = path.join(dir, assetName)
  await run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', copy, file])
  await stageMacUpdate({ version, publishedAt: '', body: '', assetUrl: '', assetName, assetSize: fs.statSync(file).size }, file, await sha256File(file), 'rollback')
}
