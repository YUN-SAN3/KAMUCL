/**
 * 启动器自更新执行层：下载（接入下载中心）→ SHA256 校验 → 备份 → 旁路替换 → 重启。
 *
 * 可靠性方案：
 * - 旁路更新：不覆盖运行中文件；detached PowerShell 脚本等主进程退出后执行替换
 * - 备份：替换前 rename 当前 exe 到 <启动器目录>\KAMUCL-backup\（仅留 1 份）
 * - 回滚：替换/首启失败 → 脚本自动还原备份并写 update-failed.flag；
 *         手动：设置页「还原到更新前的版本」反向执行同一脚本
 * - 校验：下载后强制 SHA256 比对（随 Release 发布的 SHA256SUMS.txt），不一致即失败
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { app } from 'electron'
import type { LocalUpdateCheck, ProgressEvent, ReleaseInfo, Settings, UpdateStateInfo } from '../../shared/types'
import { IPC_EVENT } from '../../shared/types'
import { compareSemver } from '../../shared/semver'
import { downloadFile } from './download'
import { finishTask, registerTask } from './tasks'
import { currentVersion, fetchSha256Sums, sha256File } from './selfUpdate'
import { logScope } from './launcherLog'

const updateLog = logScope('self-update')

/** 低速阈值：连续 30 秒低于 100KB/s 提示一次内测群备用下载 */
const SLOW_SPEED_BPS = 100 * 1024
const SLOW_HINT_AFTER_MS = 30_000

// ---------------- 事件桥（ipc.ts 注册时注入，避免反向依赖） ----------------
type Emitter = (channel: string, payload: unknown) => void
let emit: Emitter = () => {}
export function setUpdateEmitter(fn: Emitter): void { emit = fn }

// ---------------- 路径 ----------------

/**
 * 当前运行的便携 exe（外层启动器）路径。
 * 便携包运行时进程在 KAMUCL-runtime 内，外层 exe 由 electron-builder 注入 PORTABLE_EXECUTABLE_FILE；
 * 测试可用 KAMUCL_UPDATE_TARGET_EXE 指向沙盒副本走全链路。
 */
export function currentPortableExe(): string | null {
  return process.env.KAMUCL_UPDATE_TARGET_EXE || process.env.PORTABLE_EXECUTABLE_FILE || null
}

/** 是否支持自更新（仅便携包运行或测试注入目标时） */
export function updateSupported(): boolean {
  return !!currentPortableExe()
}

function updateDirOf(exe: string): string {
  return path.join(path.dirname(exe), 'KAMUCL-update')
}
function backupDirOf(exe: string): string {
  return path.join(path.dirname(exe), 'KAMUCL-backup')
}

function userDataDir(): string {
  return process.env.KAMUCL_USERDATA_DIR || app.getPath('userData')
}
function stateFile(): string {
  return path.join(userDataDir(), 'update-state.json')
}
function failedFlagFile(): string {
  return path.join(userDataDir(), 'update-failed.flag')
}

export function getUpdateState(): UpdateStateInfo | null {
  try {
    const j = JSON.parse(fs.readFileSync(stateFile(), 'utf-8'))
    if (j && typeof j === 'object' && j.backupPath && fs.existsSync(j.backupPath)) return j as UpdateStateInfo
  } catch { /* 无记录 */ }
  return null
}

/** 启动时检查「更新失败已回滚」标记（脚本回滚时写入）；读取后即删除 */
export function consumeUpdateFailedFlag(): boolean {
  try {
    if (fs.existsSync(failedFlagFile())) {
      fs.rmSync(failedFlagFile(), { force: true })
      return true
    }
  } catch { /* 忽略 */ }
  return false
}

// ---------------- 待安装更新（下载校验完成即就绪；关闭启动器时自动安装，小白零操作） ----------------

export interface PendingUpdate {
  release: ReleaseInfo
  file: string
}

function pendingFile(): string {
  return path.join(userDataDir(), 'pending-update.json')
}

/** 读取已就绪待安装的更新（结构有效且文件仍存在才返回） */
export function getPendingUpdate(): PendingUpdate | null {
  try {
    const j = JSON.parse(fs.readFileSync(pendingFile(), 'utf-8'))
    if (j?.release?.version && typeof j.file === 'string' && fs.existsSync(j.file)) {
      return j as PendingUpdate
    }
  } catch { /* 无待装 */ }
  return null
}

export function clearPendingUpdate(): void {
  try { fs.rmSync(pendingFile(), { force: true }) } catch { /* 忽略 */ }
}

function writePendingUpdate(release: ReleaseInfo, file: string): void {
  try {
    fs.writeFileSync(pendingFile(), JSON.stringify({ release, file } satisfies PendingUpdate), 'utf-8')
  } catch (e) {
    updateLog.debug('待安装状态写入失败（不影响功能）', e)
  }
}

/** 当前是否有更新包在下载中（防重复触发自动下载） */
let autoDownloadingVersion: string | null = null
export function isUpdateDownloading(): boolean {
  return !!autoDownloadingVersion
}

/**
 * 自动安装模式入口：静默后台下载；完成后写待安装状态并发 updateReady，
 * 启动器关闭时由 before-quit 钩子自动安装。无任何弹窗。
 */
export function startAutoUpdate(release: ReleaseInfo, settings: Pick<Settings, 'updateSource' | 'updateMirrorUrl'>): void {
  if (!currentPortableExe()) return
  if (autoDownloadingVersion) return
  autoDownloadingVersion = release.version
  try {
    const handle = startUpdateDownload(release, settings, 'upgrade')
    handle.done
      .then(() => {
        updateLog.info(`更新 v${release.version} 已就绪（静默下载完成），将在启动器关闭时自动安装`)
        emit(IPC_EVENT.updateReady, { version: release.version })
      })
      .catch(() => { /* 失败/取消：静默，下次启动再试 */ })
      .finally(() => { autoDownloadingVersion = null })
  } catch {
    autoDownloadingVersion = null
  }
}

/** 存在已就绪更新则立即安装（before-quit 钩子与设置页「立即安装」共用）。返回是否将退出安装。 */
export async function applyPendingIfAny(): Promise<boolean> {
  const p = getPendingUpdate()
  if (!p) return false
  await applyDownloadedUpdate(p.release)
  return true
}

// ---------------- 下载源 ----------------

/** 按设置构造下载候选 URL 列表（auto=直连优先镜像兜底；direct=仅直连；mirror=仅镜像） */
export function updateDownloadCandidates(assetUrl: string, settings: Pick<Settings, 'updateSource' | 'updateMirrorUrl'>): string[] {
  const mirrorPrefix = (settings.updateMirrorUrl || 'https://ghproxy.net/').trim()
  const mirrored = mirrorPrefix ? mirrorPrefix + assetUrl : ''
  const source = settings.updateSource ?? 'auto'
  if (source === 'direct') return [assetUrl]
  if (source === 'mirror') return mirrored ? [mirrored] : [assetUrl]
  return mirrored ? [assetUrl, mirrored] : [assetUrl]
}

// ---------------- 下载（接入下载中心） ----------------

export interface UpdateDownloadHandle {
  taskId: string
  file: string
  done: Promise<void>
}

/**
 * 后台下载更新包：注册下载中心任务（分阶段进度/可取消/断点续传/多源换源），
 * 完成后强制 SHA256 校验。低速 30s 通过 emit 发一次内测群提示。
 */
export function startUpdateDownload(release: ReleaseInfo, settings: Pick<Settings, 'updateSource' | 'updateMirrorUrl'>, mode: 'upgrade' | 'rollback'): UpdateDownloadHandle {
  const exe = currentPortableExe()
  if (!exe) throw new Error('当前运行形态不支持自更新（仅便携版）')
  if (!release.assetUrl) throw new Error('该版本没有可用的安装包资产')
  // 新下载开始时清掉旧的待安装记录（避免装到旧包）
  clearPendingUpdate()
  const updateDir = updateDirOf(exe)
  fs.mkdirSync(updateDir, { recursive: true })
  const dest = path.join(updateDir, release.assetName || `KAMUCL-${release.version}.exe`)

  const task = registerTask(`${mode === 'rollback' ? '回退' : '下载'}启动器 v${release.version}`, 'download')
  const [url, ...alternates] = updateDownloadCandidates(release.assetUrl, settings)
  let slowSince: number | null = null
  let slowHintSent = false

  const done = (async () => {
    // 先取校验值（安全优先：取不到不开始下载）
    const sums = await fetchSha256Sums(release.assetUrl)
    const expected = sums?.get(release.assetName) ?? sums?.get(path.basename(dest)) ?? null
    if (!expected) throw new Error('无法获取更新包校验值（SHA256SUMS），已中止（安全考虑）')
    try {
      await downloadFile(
        url,
        dest,
        (received, total) => {
          const now = Date.now()
          // 低速探测：进度回调字节差估算（每 2s 一个采样窗）
          const bps = sampleSpeed(received, now)
          emit(IPC_EVENT.progress, {
            stage: 'launcher-update',
            progress: total > 0 ? received / total : 0,
            text: `${mode === 'rollback' ? '回退' : '更新'}启动器 v${release.version}`,
            speed: bps > 0 ? bps : undefined,
            bytesDone: received,
            bytesTotal: total > 0 ? total : undefined,
            indeterminate: total <= 0,
            taskId: task.id
          } satisfies ProgressEvent)
          if (bps > 0 && bps < SLOW_SPEED_BPS) {
            if (slowSince == null) slowSince = now
            if (!slowHintSent && now - slowSince >= SLOW_HINT_AFTER_MS) {
              slowHintSent = true
              emit(IPC_EVENT.updateSlowHint, { taskId: task.id })
            }
          } else if (bps >= SLOW_SPEED_BPS) {
            slowSince = null
          }
        },
        undefined,
        'official',
        task.controller.signal,
        alternates,
        { size: release.assetSize || undefined }
      )
      // 完整性校验：SHA256 不一致即失败（删除文件防误用）
      const actual = await sha256File(dest)
      if (actual !== expected) {
        fs.rmSync(dest, { force: true })
        throw new Error(`更新包校验失败（SHA256 不一致），已删除文件。期望 ${expected.slice(0, 12)}… 实际 ${actual.slice(0, 12)}…`)
      }
      updateLog.info(`更新包下载完成并校验通过：${dest}`)
      // 就绪即写待安装状态：关闭启动器时自动安装（手动「立即安装」亦可随时触发）
      writePendingUpdate(release, dest)
      emit(IPC_EVENT.taskDone, { taskId: task.id, ok: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      emit(IPC_EVENT.taskDone, { taskId: task.id, ok: false, error: msg, cancelled: msg === '已取消' })
      throw e
    } finally {
      finishTask(task.id)
    }
  })()
  return { taskId: task.id, file: dest, done }
}

// 速度估算采样（progress 回调字节差分，2 秒窗口）
let lastSample: { received: number; at: number } | null = null
function sampleSpeed(received: number, now: number): number {
  if (!lastSample || now - lastSample.at >= 2000) {
    const bps = lastSample ? (received - lastSample.received) / ((now - lastSample.at) / 1000) : -1
    lastSample = { received, at: now }
    return bps
  }
  return -1
}
/** 测试用：重置速度采样 */
export function resetSpeedSamplerForTest(): void { lastSample = null }

// ---------------- 替换脚本（纯函数，可测试） ----------------

export interface UpdaterScriptSpec {
  /** 被替换的当前 exe（便携外层） */
  oldExe: string
  /** 已下载校验通过的新 exe */
  newExe: string
  /** 备份目录（旧 exe rename 目标） */
  backupDir: string
  /** 主进程 pid（脚本等待其退出） */
  mainPid: number
  /** 便携包外层引导进程 pid（主进程的父进程，持有自身 exe 文件锁且退出有延迟） */
  wrapperPid?: number
  /** 回滚标记文件目录（userData） */
  stateDir: string
  /** 是否为还原备份操作（还原时不再生成新备份） */
  restore?: boolean
}

/**
 * 生成旁路更新 PowerShell 脚本：
 * 等待主进程退出 → （可选）备份旧 exe → 新 exe 放入原目录 → 启动并观察 20s
 * → 未存活/任何失败：还原备份、启动旧版、写 update-failed.flag → 自删除。
 * 全程 -LiteralPath（路径含空格/中文/方括号安全）。
 */
export function buildUpdaterScript(spec: UpdaterScriptSpec): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`
  const newTarget = path.join(path.dirname(spec.oldExe), path.basename(spec.newExe))
  const oldName = path.basename(spec.oldExe)
  return `$ErrorActionPreference = 'Stop'
$oldExe = ${q(spec.oldExe)}
$newExe = ${q(spec.newExe)}
$newTarget = ${q(newTarget)}
$backupDir = ${q(spec.backupDir)}
$stateDir = ${q(spec.stateDir)}
$doBackup = ${spec.restore ? '$false' : '$true'}
$mainPid = ${spec.mainPid}
$wrapperPid = ${spec.wrapperPid ?? 0}
$logFile = Join-Path $stateDir 'updater-last.log'

function Log($m) {
  $line = '[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $m
  try { Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8 } catch {}
}
function Move-WithRetry($from, $to, $what) {
  # 文件锁（便携包外层/退出清理延迟）可能持续数十秒：重试直到可移动（最多 120 秒）
  for ($i = 0; $i -lt 120; $i++) {
    try { Move-Item -LiteralPath $from -Destination $to -Force -ErrorAction Stop; Log \"$what 完成\"; return }
    catch { if ($i % 15 -eq 0) { Log \"$what 等待解锁（第 $($i+1) 次）：$($_.Exception.Message)\" }; Start-Sleep -Seconds 1 }
  }
  throw \"$what 重试 120 次仍失败\"
}
function Restore-Backup($reason) {
  Log \"触发回滚：$reason\"
  $bak = Join-Path $backupDir ${q(oldName)}
  if (Test-Path -LiteralPath $bak) {
    Move-WithRetry $bak $oldExe '回滚移动'
    try { Start-Process -FilePath $oldExe } catch {}
  }
  try { Set-Content -LiteralPath (Join-Path $stateDir 'update-failed.flag') -Value $reason -Encoding UTF8 } catch {}
}

Log \"更新脚本启动：$($newExe) → $($newTarget)\"
# 等主进程与便携包外层引导进程都退出（外层持有 exe 文件锁；各最多 45 秒，超时由 Move-WithRetry 兜底）
$t = 0
while (((Get-Process -Id $mainPid -ErrorAction SilentlyContinue) -or ($wrapperPid -and (Get-Process -Id $wrapperPid -ErrorAction SilentlyContinue))) -and $t -lt 45) { Start-Sleep -Seconds 1; $t++ }
  Log \"进程等待结束（用时 \${t}s；若仍锁由移动重试兜底）\"

try {
  if ($doBackup -eq $true) {
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    Get-ChildItem -LiteralPath $backupDir -Filter 'KAMUCL-*.exe' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Move-WithRetry $oldExe (Join-Path $backupDir ${q(oldName)}) '备份旧版'
  } else {
    for ($i = 0; $i -lt 120 -and (Test-Path -LiteralPath $oldExe); $i++) {
      try { Remove-Item -LiteralPath $oldExe -Force -ErrorAction Stop; break } catch { Start-Sleep -Seconds 1 }
    }
  }
  Move-WithRetry $newExe $newTarget '放入新版'
  $p = Start-Process -FilePath $newTarget -PassThru
  Log \"新版已启动 pid=$($p.Id)，观察 20 秒\"
  Start-Sleep -Seconds 20
  if (-not (Get-Process -Id $p.Id -ErrorAction SilentlyContinue)) { throw 'new version exited within 20s' }
  Log '新版存活确认，更新成功'
} catch {
  Restore-Backup $_.Exception.Message
}
Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue
`
}

// ---------------- 应用更新（备份→替换→重启） ----------------

function spawnUpdater(spec: UpdaterScriptSpec): void {
  const scriptFile = path.join(os.tmpdir(), `kamucl-updater-${Date.now()}.ps1`)
  // PowerShell 5.1 按 BOM 识别 UTF-8（路径可能含中文）
  fs.writeFileSync(scriptFile, '﻿' + buildUpdaterScript(spec), 'utf-8')
  // 关键：必须脱离启动器进程树的 Job Object（便携包退出会整树终止子进程），
  // 且不能带管道回传（管道句柄会让启动器进程对象悬挂、文件锁延迟释放）——spawnDetachedProcess 完全零耦合。
  void import('./gracefulClose').then(({ spawnDetachedProcess }) =>
    spawnDetachedProcess('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile], { cwd: os.tmpdir() }).then((pid) => {
      if (pid == null) updateLog.error('更新脚本脱离式创建失败')
    }).catch((e) => {
      updateLog.error('更新脚本启动失败', e)
    })
  )
}

/** 校验已下载的更新包并执行 备份→替换→重启。调用后进程退出。 */
export async function applyDownloadedUpdate(release: ReleaseInfo): Promise<void> {
  const exe = currentPortableExe()
  if (!exe) throw new Error('当前运行形态不支持自更新（仅便携版）')
  const file = path.join(updateDirOf(exe), release.assetName || `KAMUCL-${release.version}.exe`)
  if (!fs.existsSync(file)) throw new Error('更新包不存在，请先下载')
  // 不再联网复核 SHA256：下载完成时已强制校验通过并写入待安装状态；
  // 退出前复核会拖慢退出，导致更新脚本等到超时、在主进程仍存活时抢文件（文件锁冲突根因）。
  // 记录更新状态（设置页「还原到更新前的版本」数据源）
  const backupDir = backupDirOf(exe)
  const state: UpdateStateInfo = {
    from: currentVersion(),
    to: release.version,
    time: new Date().toISOString(),
    backupPath: path.join(backupDir, path.basename(exe)),
    backupVersion: currentVersion(),
    result: 'applied'
  }
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2), 'utf-8')
  // 安装动作接管后清掉待安装记录（防止重复触发）
  clearPendingUpdate()
  spawnUpdater({
    oldExe: exe,
    newExe: file,
    backupDir,
    mainPid: process.pid,
    // 便携包外层引导进程（主进程的父进程）持有自身 exe 的文件锁且退出有延迟——一并等待
    wrapperPid: process.ppid ?? 0,
    stateDir: userDataDir()
  })
  updateLog.info(`更新脚本已启动，退出启动器进行替换：v${state.from} → v${state.to}`)
  setTimeout(() => app.exit(0), 300)
}

/** 还原到更新前的版本（反向执行同一脚本）并重启 */
export async function restoreBackupAndRestart(): Promise<void> {
  const exe = currentPortableExe()
  if (!exe) throw new Error('当前运行形态不支持自更新（仅便携版）')
  const state = getUpdateState()
  if (!state) throw new Error('没有可用的备份')
  spawnUpdater({
    oldExe: exe,
    newExe: state.backupPath,
    backupDir: backupDirOf(exe),
    mainPid: process.pid,
    stateDir: userDataDir(),
    restore: true
  })
  try { fs.rmSync(stateFile(), { force: true }) } catch { /* 忽略 */ }
  updateLog.info(`还原脚本已启动：回退到 v${state.backupVersion}`)
  setTimeout(() => app.exit(0), 300)
}

// ---------------- 本地文件安装更新 ----------------

const EXE_VERSION_RE = /^KAMUCL-(\d+\.\d+\.\d+(?:\.\d+)?)/i

/** 校验本地安装包：版本号（文件名解析）与 SHA256（联网比对 Release，离线则 unknown 由用户自担确认） */
export async function checkLocalUpdateFile(filePath: string): Promise<LocalUpdateCheck> {
  const fileName = path.basename(filePath)
  const st = fs.statSync(filePath)
  const m = EXE_VERSION_RE.exec(fileName)
  const version = m?.[1] ?? ''
  const current = currentVersion()
  const versionOk = !!version && compareSemver(version, current) >= 0
  let sha: LocalUpdateCheck['sha256'] = 'unknown'
  let detail = ''
  try {
    const sums = await fetchSha256Sums()
    const expected = sums?.get(fileName) ?? null
    if (expected) {
      const actual = await sha256File(filePath)
      sha = actual === expected ? 'match' : 'mismatch'
      if (sha === 'mismatch') detail = `期望 ${expected.slice(0, 12)}… 实际 ${actual.slice(0, 12)}…`
    }
  } catch { /* 离线 → unknown */ }
  return { filePath, fileName, fileSize: st.size, version, versionOk, sha256: sha, detail }
}

/** 本地包走相同的 备份→替换→重启 流程（先复制进更新目录，不动用户原文件） */
export async function applyLocalUpdateFile(check: LocalUpdateCheck): Promise<void> {
  const exe = currentPortableExe()
  if (!exe) throw new Error('当前运行形态不支持自更新（仅便携版）')
  const updateDir = updateDirOf(exe)
  fs.mkdirSync(updateDir, { recursive: true })
  const dest = path.join(updateDir, check.fileName)
  fs.copyFileSync(check.filePath, dest)
  await applyDownloadedUpdate({
    version: check.version || 'local',
    publishedAt: '',
    body: '',
    assetUrl: '',
    assetSize: check.fileSize,
    assetName: check.fileName
  })
}
