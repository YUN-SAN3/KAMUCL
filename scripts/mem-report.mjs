#!/usr/bin/env node
// 内存基线测量：对现有 out/ 产物（不重新构建）跑「启动→静默60秒→最小化60秒」两个时点，
// 用 PowerShell Get-Process 汇总 electron 各进程 WorkingSet。
// 用法：node scripts/mem-report.mjs [--silent 60] [--min 60]
import { spawn, execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argOf = (flag, def) => {
  const i = args.indexOf(flag)
  return i >= 0 ? Number(args[i + 1]) : def
}
const SILENT_SECS = argOf('--silent', 60)
const MIN_SECS = argOf('--min', 60)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const ps = (script) =>
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30_000
  })

/** 枚举 electron.exe 进程树（从根 PID 沿 ParentProcessId 下行），返回 { pid, ws } 列表 */
function sampleTree(rootPid) {
  const csv = ps(
    "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | " +
      'Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Csv -NoTypeInformation'
  )
  const rows = csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(',').map((c) => c.replace(/^"|"$/g, '')))
    .map(([pid, ppid, ws]) => ({ pid: Number(pid), ppid: Number(ppid), ws: Number(ws) }))
  const byParent = new Map()
  for (const r of rows) {
    if (!byParent.has(r.ppid)) byParent.set(r.ppid, [])
    byParent.get(r.ppid).push(r)
  }
  const tree = []
  const walk = (pid) => {
    for (const child of byParent.get(pid) ?? []) {
      tree.push(child)
      walk(child.pid)
    }
  }
  walk(rootPid)
  return tree
}

function report(label, tree) {
  const total = tree.reduce((sum, p) => sum + p.ws, 0)
  console.log(`\n[${label}] electron 进程 ${tree.length} 个，工作集合计 ${(total / 1024 / 1024).toFixed(1)} MB`)
  for (const p of tree) console.log(`  pid=${p.pid} ws=${(p.ws / 1024 / 1024).toFixed(1)} MB`)
  return total
}

/** 最小化 electron 所有主窗口（实测：按树 PID 过滤或按标题 FindWindow 都可能错过真正的窗口属主进程；
    全量 Get-Process electron 取 MainWindowHandle 实证可靠，探针 IsIconic=True 验证） */
function minimizeAllElectronWindows() {
  const script =
    "$sig = '[DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr h, int n);';" +
    'Add-Type -MemberDefinition $sig -Name W -Namespace N | Out-Null; ' +
    'Get-Process electron -ErrorAction SilentlyContinue | ' +
    'Where-Object { $_.MainWindowHandle -ne 0 } | ' +
    'ForEach-Object { [N.W]::ShowWindowAsync($_.MainWindowHandle, 6) } | Out-Null'
  ps(script)
}

const electronExe = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
console.log(`启动 ${electronExe} .（时点：静默 ${SILENT_SECS}s → 最小化 ${MIN_SECS}s）`)
const child = spawn(electronExe, ['.'], { cwd: root, stdio: 'ignore', detached: false })
let exited = null
child.on('exit', (code) => { exited = code })

await sleep(15_000)
if (exited !== null) {
  console.error(`\n[失败] 产物在 15 秒内退出（exit=${exited}），无法测量。`)
  console.error('可能原因：out/ 产物与其他 Agent 的未构建源码不一致（main=out/main/index.js）。')
  console.error('手动步骤：先 npm run build 生成新产物，再重跑 node scripts/mem-report.mjs。')
  process.exit(1)
}

const t1 = report(`静默 ${SILENT_SECS}s`, sampleTree(child.pid))
minimizeAllElectronWindows()
await sleep(MIN_SECS * 1000)
const t2 = report(`最小化 ${MIN_SECS}s`, sampleTree(child.pid))
console.log(`\n结论：静默 ${(t1 / 1024 / 1024).toFixed(1)} MB → 最小化 ${(t2 / 1024 / 1024).toFixed(1)} MB（基线 = 未含本次改动的 out/ 产物）`)

try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* 已退出 */ }
