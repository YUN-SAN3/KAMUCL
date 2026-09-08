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
import { spawn } from 'node:child_process'
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

# 1. 等待主进程退出（最多 60 秒）
$t = 0
while ((Get-Process -Id $mainPid -ErrorAction SilentlyContinue) -and $t -lt 60) { Start-Sleep -Seconds 1; $t++ }

function Restore-Backup($reason) {
  $bak = Join-Path $backupDir ${q(oldName)}
  if (Test-Path -LiteralPath $bak) {
    try { Move-Item -LiteralPath $bak -Destination $oldExe -Force } catch {}
    try { Start-Process -FilePath $oldExe } catch {}
  }
  try { Set-Content -LiteralPath (Join-Path $stateDir 'update-failed.flag') -Value $reason -Encoding UTF8 } catch {}
}

try {
  if ($doBackup -eq $true) {
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    Get-ChildItem -LiteralPath $backupDir -Filter 'KAMUCL-*.exe' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $oldExe -Destination (Join-Path $backupDir ${q(oldName)}) -Force
  } else {
    Remove-Item -LiteralPath $oldExe -Force -ErrorAction SilentlyContinue
  }
  Move-Item -LiteralPath $newExe -Destination $newTarget -Force
  $p = Start-Process -FilePath $newTarget -PassThru
  Start-Sleep -Seconds 20
  if (-not (Get-Process -Id $p.Id -ErrorAction SilentlyContinue)) { throw 'new version exited within 20s' }
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
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref()
}

/** 校验已下载的更新包并执行 备份→替换→重启。调用后进程退出。 */
export async function applyDownloadedUpdate(release: ReleaseInfo): Promise<void> {
  const exe = currentPortableExe()
  if (!exe) throw new Error('当前运行形态不支持自更新（仅便携版）')
  const file = path.join(updateDirOf(exe), release.assetName || `KAMUCL-${release.version}.exe`)
  if (!fs.existsSync(file)) throw new Error('更新包不存在，请先下载')
  // 应用前再校验一次（防御性：下载后到安装间隔内文件可能被改）
  const sums = await fetchSha256Sums(release.assetUrl)
  const expected = sums?.get(release.assetName) ?? null
  if (expected) {
    const actual = await sha256File(file)
    if (actual !== expected) throw new Error('更新包校验失败（SHA256 不一致），请重新下载')
  }
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
  spawnUpdater({
    oldExe: exe,
    newExe: file,
    backupDir,
    mainPid: process.pid,
    stateDir: userDataDir()
  })
  updateLog.info(`更新脚本已启动，退出启动器进行替换：v${state.from} → v${state.to}`)
  setTimeout(() => app.quit(), 300)
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
  setTimeout(() => app.quit(), 300)
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
