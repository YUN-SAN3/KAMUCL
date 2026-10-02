/** 启动失败诊断 ZIP：所有文本先脱敏，缺失项写入 manifest，不因单个日志缺失而失败。 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { app, dialog, type BrowserWindow } from 'electron'
import { getSettings } from './settings'
import { gameDir } from './paths'
import { readVersionJson, listAllInstalled } from './versions'
import { getLastLaunch } from './launch'
import { samePath } from './folderPaths'
import { exitHistory } from './exitHistory'
import { instanceDirectoryState } from './instances'
import { selectedAccount } from './accounts'
import { launcherLogPath } from './launcherLog'
import {
  redactDiagnosticPath,
  redactDiagnosticText,
  safeDiagnosticFilePart
} from './diagnostics'
import {
  writeDiagnosticArchive,
  type DiagnosticManifestEntry,
  type DiagnosticSource
} from './diagnosticArchive'

const execFileAsync = promisify(execFile)

export interface DiagnosticManifest {
  schemaVersion: 1
  exportedAt: string
  launcher: { name: 'KAMUCL'; version: string }
  instance: {
    id: string
    name: string
    minecraftVersion: string
    loader: string | null
    loaderVersion: string | null
    directory: string
    isolated: boolean
  }
  process: {
    pid: number | null
    startedAt: string | null
    endedAt: string | null
    exitCode: number | null
    spawnError: string | null
    command: string | null
  }
  java: { path: string; version: string; architecture: string }
  operatingSystem: { platform: string; release: string; architecture: string }
  files: DiagnosticManifestEntry[]
}

function fmtStamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

async function newestCrashReport(dir: string): Promise<string | null> {
  try {
    const root = path.join(dir, 'crash-reports')
    const entries = await fs.promises.readdir(root, { withFileTypes: true })
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && /\.(?:txt|log)$/i.test(entry.name))
        .map(async (entry) => {
          const file = path.join(root, entry.name)
          return { file, mtime: (await fs.promises.stat(file)).mtimeMs }
        })
    )
    return files.sort((a, b) => b.mtime - a.mtime)[0]?.file ?? null
  } catch {
    return null
  }
}

async function javaSummary(
  javaPath: string
): Promise<{ path: string; version: string; architecture: string }> {
  const unknown = {
    path: redactDiagnosticPath(javaPath),
    version: '（未知）',
    architecture: '（未知）'
  }
  if (!javaPath) return unknown
  try {
    const result = await execFileAsync(javaPath, ['-version'], {
      encoding: 'utf-8',
      timeout: 8_000,
      windowsHide: true,
      maxBuffer: 256 * 1024
    })
    const output = `${result.stderr ?? ''}\n${result.stdout ?? ''}`
    const version =
      /version\s+"([^"]+)"/i.exec(output)?.[1] ?? output.split(/\r?\n/)[0]?.trim() ?? '（未知）'
    const architecture = /64-Bit|x86_64|aarch64/i.test(output)
      ? '64-bit'
      : /32-Bit|i[3-6]86|x86/i.test(output)
        ? '32-bit'
        : '（未知）'
    return { path: redactDiagnosticPath(javaPath), version, architecture }
  } catch (error) {
    return {
      ...unknown,
      version: `验证失败：${redactDiagnosticText(error instanceof Error ? error.message : String(error))}`
    }
  }
}

function summaryText(manifest: DiagnosticManifest): string {
  const m = manifest
  return [
    '================ KAMUCL 启动失败诊断摘要 ================',
    `导出时间: ${m.exportedAt}`,
    `KAMUCL: ${m.launcher.version}`,
    `操作系统: ${m.operatingSystem.platform} ${m.operatingSystem.release} (${m.operatingSystem.architecture})`,
    '',
    `实例: ${m.instance.name} [${m.instance.id}]`,
    `Minecraft: ${m.instance.minecraftVersion}`,
    `Loader: ${m.instance.loader ?? 'vanilla'}${m.instance.loaderVersion ? ` ${m.instance.loaderVersion}` : ''}`,
    `实例目录: ${m.instance.directory}`,
    `版本隔离: ${m.instance.isolated ? '开启' : '关闭'}`,
    '',
    `Java: ${m.java.version} (${m.java.architecture})`,
    `Java 路径: ${m.java.path}`,
    `进程 PID: ${m.process.pid ?? '（未知）'}`,
    `启动时间: ${m.process.startedAt ?? '（未知）'}`,
    `退出时间: ${m.process.endedAt ?? '（未知）'}`,
    `退出码: ${m.process.exitCode ?? '（未知）'}`,
    `进程错误: ${m.process.spawnError ?? '（无记录）'}`,
    `启动参数摘要: ${m.process.command ?? '（尚未生成）'}`,
    '',
    '每个日志的来源、缺失与截断情况见 manifest.json。'
  ].join('\n')
}

/** 弹原生保存对话框并异步生成 ZIP；取消保存返回 null。 */
export async function exportLaunchLogs(
  win: BrowserWindow | null,
  versionId: string
): Promise<string | null> {
  // 扫描会同时建立“版本 -> 游戏文件夹”映射，避免活动目录切换后收错实例日志。
  let installed: ReturnType<typeof listAllInstalled> = []
  try {
    installed = listAllInstalled()
  } catch {
    // 单个来源缺失不阻断导出。
  }
  const last = getLastLaunch()
  const vid = versionId || last?.versionId || 'unknown'
  const item = installed.find((value) => value.id === vid && samePath(value.folder, gameDir()))
  const folder = item?.folder || gameDir()
  let directoryState = item
    ? {
        path: item.gameDirectory || folder,
        isolated: item.isolated === true
      }
    : { path: folder, isolated: false }
  try {
    directoryState = instanceDirectoryState(vid, readVersionJson(vid))
  } catch {
    // 版本 JSON 缺失时使用已扫描出的目录信息。
  }
  const effectiveGameDir =
    last?.versionId === vid && last.effectiveGameDir
      ? last.effectiveGameDir
      : directoryState.path
  const isolated = directoryState.isolated
  const now = new Date()
  const defName = `KAMUCL-Diagnostic-${safeDiagnosticFilePart(item?.mcVersion || vid)}-${fmtStamp(now)}.zip`
  const opts = {
    title: '导出错误日志',
    defaultPath: defName,
    filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
  }
  const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (result.canceled || !result.filePath) return null

  const account = selectedAccount()
  const secrets = [
    account?.accessToken ?? '',
    account?.refreshToken ?? '',
    account?.clientToken ?? '',
    account?.loginIdentifier ?? ''
  ].filter(Boolean)
  const currentLaunch = last?.versionId === vid && last.effectiveGameDir && samePath(last.effectiveGameDir,effectiveGameDir) ? last : exitHistory().list().find(e=>e.kind==='game'&&e.context?.versionId===vid&&e.context?.effectiveGameDir&&samePath(String(e.context.effectiveGameDir),effectiveGameDir))?.context as unknown as typeof last
  const manifest: DiagnosticManifest = {
    schemaVersion: 1,
    exportedAt: now.toISOString(),
    launcher: { name: 'KAMUCL', version: app.getVersion() },
    instance: {
      id: vid,
      name: item?.modpackName || vid,
      minecraftVersion: item?.mcVersion || '（未知）',
      loader: item?.loader ?? null,
      loaderVersion: item?.loaderVersion ?? null,
      directory: redactDiagnosticPath(effectiveGameDir),
      isolated
    },
    process: {
      pid: currentLaunch?.pid ?? null,
      startedAt: currentLaunch?.startedAt ?? null,
      endedAt: currentLaunch?.endedAt ?? null,
      exitCode: currentLaunch?.exitCode ?? null,
      spawnError: currentLaunch?.spawnError
        ? redactDiagnosticText(currentLaunch.spawnError, secrets)
        : null,
      command: currentLaunch?.commandSummary
        ? redactDiagnosticText(currentLaunch.commandSummary, secrets)
        : null
    },
    java: await javaSummary(currentLaunch?.javaPath ?? item?.javaPath ?? getSettings().javaPath),
    operatingSystem: {
      platform: `${os.type()} ${os.version()}`,
      release: os.release(),
      architecture: os.arch()
    },
    files: []
  }

  const crash = await newestCrashReport(effectiveGameDir)
  const launchLogDir = currentLaunch?.logDir || path.join(folder, 'kamucl-logs')
  const sources: DiagnosticSource[] = [
    {
      archivePath: crash ? `crash-reports/${path.basename(crash)}` : 'crash-reports/latest.txt',
      source: crash || path.join(effectiveGameDir, 'crash-reports'),
      missingPlaceholder: !crash
    },
    {
      archivePath: 'minecraft/latest.log',
      source: path.join(effectiveGameDir, 'logs', 'latest.log'),
      missingPlaceholder: true
    },
    {
      archivePath: 'minecraft/debug.log',
      source: path.join(effectiveGameDir, 'logs', 'debug.log'),
      missingPlaceholder: true
    },
    {
      archivePath: 'launcher/launcher-current.log',
      source: launcherLogPath(),
      missingPlaceholder: true
    },
    {
      archivePath: 'launcher/launch-combined.log',
      source: path.join(launchLogDir, 'latest.log'),
      missingPlaceholder: true
    },
    {
      archivePath: 'process/stdout.log',
      source: path.join(launchLogDir, 'stdout.log'),
      missingPlaceholder: true
    },
    {
      archivePath: 'process/stderr.log',
      source: path.join(launchLogDir, 'stderr.log'),
      missingPlaceholder: true
    }
  ]
  // 历史会话归档一并带上（最多 3 份）；缺失时 manifest 只记 missing，不影响导出
  const logsDir = path.dirname(launcherLogPath())
  let archives: string[] = []
  try {
    archives = fs
      .readdirSync(logsDir)
      .filter((name) => /^launcher-\d{8}-\d{6}.*\.log$/.test(name))
      .sort()
      .reverse()
      .slice(0, 3)
  } catch {
    /* 日志目录不可读时跳过归档 */
  }
  for (const name of archives) {
    sources.push({ archivePath: `launcher/${name}`, source: path.join(logsDir, name) })
  }
  try {
    await writeDiagnosticArchive(
      result.filePath,
      manifest,
      sources,
      summaryText(manifest),
      secrets
    )
    return result.filePath
  } catch (error) {
    throw new Error(`写入诊断包失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
