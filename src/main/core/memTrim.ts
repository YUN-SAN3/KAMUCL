/**
 * 内存极限压榨（任务A）：Windows 工作集整理 + Electron 进程内存观测
 * - trim 范围精确到「Electron 自身进程」：进程清单来自 app.getAppMetrics()（按 PID，
 *   天然只含本启动器的 electron 进程，绝不含游戏 java 进程），自身进程直接整理。
 * - 实现优先 koffi 直调 K32EmptyWorkingSet（预编译无 node-gyp）；失败退化为
 *   单次 PowerShell P/Invoke EmptyWorkingSet 兜底（仅整理自身），不阻塞任何流程。
 * - 触发时机：窗口 minimize/hide 立即整理一轮 + 广播渲染层瘦身；静默 10 分钟后进入
 *   低频周期整理（间隔常量见下，恢复窗口不做处理——工作集自然回涨）。
 * - 可观测：每 5 分钟汇总各进程 workingSetSize 写日志，trim 前后各记一条。
 */
import type { BrowserWindow } from 'electron'

// ---------------- 常量（可观测节奏与瘦身开关） ----------------
/** 内存指标日志频率：5 分钟一次，低频不刷屏 */
export const METRICS_LOG_INTERVAL_MS = 5 * 60_000
/** 窗口静默多少分钟后开始低频工作集整理 */
export const IDLE_TRIM_FIRST_MS = 10 * 60_000
/** 静默期间低频整理的间隔（比指标日志更低频，整理本身只是换出冷页，代价极小） */
export const IDLE_TRIM_INTERVAL_MS = 15 * 60_000
/** trim 后等待内核回收/统计稳定再读一次指标的间隔 */
export const TRIM_SETTLE_MS = 800
/** 主进程 → 渲染层瘦身广播通道（shared/types.ts 归他人维护，此处用局部常量） */
export const MEM_TRIM_CHANNEL = 'kamucl:mem-trim'

// ---------------- 纯函数（可测） ----------------

export interface MemoryMetricsLike {
  type: string
  pid: number
  memory: { workingSetSize: number }
}

/**
 * 需要整理的「其他 Electron 自身进程」PID：来自 getAppMetrics()，排除自身（自身直接整理）。
 * 游戏进程不可能出现在该清单里——它不是 Electron 的子进程成员。
 */
export function selectElectronProcessPids(metrics: MemoryMetricsLike[], selfPid: number): number[] {
  return metrics.map((m) => m.pid).filter((pid) => Number.isFinite(pid) && pid !== selfPid)
}

/** 按进程类型汇总工作集（KB）：renderer/browser/gpu/utility 分列 + 总量 */
export function sumWorkingSetByType(metrics: MemoryMetricsLike[]): { byType: Record<string, number>; total: number } {
  const byType: Record<string, number> = {}
  let total = 0
  for (const m of metrics) {
    const kb = m.memory?.workingSetSize ?? 0
    byType[m.type] = (byType[m.type] ?? 0) + kb
    total += kb
  }
  return { byType, total }
}

/** 指标日志行：`内存指标: browser=120MB, renderer=210MB (共 420MB)` */
export function formatMemoryLine(byType: Record<string, number>, total: number): string {
  const parts = Object.entries(byType).map(([type, kb]) => `${type}=${mb(kb)}`)
  return `内存指标: ${parts.join(', ') || '无进程'} (共 ${mb(total)})`
}

function mb(kb: number): string {
  return `${Math.round(kb / 1024)}MB`
}

// ---------------- koffi 直调层（惰性加载，失败回落 PowerShell 兜底） ----------------

interface Kernel32TrimApi {
  emptyWorkingSet(handle: number): boolean
  openProcess(pid: number): number
  currentProcess(): number
  close(handle: number): void
}

let kernel32Promise: Promise<Kernel32TrimApi | null> | null = null

function asKoffi(mod: unknown): { load(name: string): { func(name: string, ret: string, args: unknown[]): (...args: unknown[]) => unknown } } & Record<string, unknown> {
  const withDefault = mod as { default?: unknown }
  return (withDefault.default ?? mod) as never
}

function loadKernel32Trim(): Promise<Kernel32TrimApi | null> {
  kernel32Promise ??= (async () => {
    try {
      const koffi = asKoffi(await import('koffi')) as never as {
        load(name: string): {
          func(name: string, ret: string, args: unknown[]): (...args: unknown[]) => unknown
        }
        struct(name: string, members: Record<string, string>): unknown
        sizeof(type: unknown): number
      }
      const k32 = koffi.load('kernel32.dll')
      const currentProcess = k32.func('GetCurrentProcess', 'uintptr', [])
      const openProcess = k32.func('OpenProcess', 'uintptr', ['uint32', 'bool', 'uint32'])
      const emptyWorkingSet = k32.func('K32EmptyWorkingSet', 'bool', ['uintptr'])
      const closeHandle = k32.func('CloseHandle', 'bool', ['uintptr'])
      const PROCESS_SET_QUOTA = 0x0100
      const PROCESS_QUERY_INFORMATION = 0x0400
      return {
        emptyWorkingSet: (handle) => emptyWorkingSet(handle) === true,
        openProcess: (pid) => Number(openProcess(PROCESS_SET_QUOTA | PROCESS_QUERY_INFORMATION, false, pid)),
        currentProcess: () => Number(currentProcess()),
        close: (handle) => { if (handle) closeHandle(handle) }
      }
    } catch {
      return null // koffi 不可用：trimOnce 会走 PowerShell 兜底
    }
  })()
  return kernel32Promise
}

/** PowerShell 兜底：单次 P/Invoke EmptyWorkingSet 整理自身（约几百 ms，只在 koffi 缺失时触发） */
async function trimSelfViaPowerShell(selfPid: number): Promise<boolean> {
  const { execFile } = await import('node:child_process')
  const script =
    "$s='[DllImport(\"psapi.dll\")] public static extern bool EmptyWorkingSet(IntPtr h);[DllImport(\"kernel32.dll\")] public static extern IntPtr GetCurrentProcess();';" +
    "Add-Type -MemberDefinition $s -Name KamuclTrim -Namespace Win32 | Out-Null;" +
    '[Win32.KamuclTrim]::EmptyWorkingSet([Win32.KamuclTrim]::GetCurrentProcess()) | Out-Null'
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10_000 }, (error) => resolve(!error))
  })
}

// ---------------- 控制器 ----------------

export interface MemoryTrimController {
  /** 窗口最小化/隐藏：立即整理 + 广播渲染层瘦身 + 启动静默低频周期 */
  noteHidden(): void
  /** 窗口恢复/显示：停止静默周期（不主动做任何事，工作集自然回涨） */
  noteVisible(): void
  /** 立即整理一轮（诊断/手动触发用） */
  trimNow(reason: string): Promise<void>
  stop(): void
}

export async function startMemoryTrim(
  getWindow: () => BrowserWindow | null,
  log: (message: string) => void
): Promise<MemoryTrimController> {
  const { app } = await import('electron')
  let hidden = false
  let idleTimer: NodeJS.Timeout | undefined
  let idleInterval: NodeJS.Timeout | undefined
  const metricsTimer = setInterval(() => {
    const { byType, total } = sumWorkingSetByType(app.getAppMetrics() as unknown as MemoryMetricsLike[])
    log(formatMemoryLine(byType, total))
  }, METRICS_LOG_INTERVAL_MS)
  metricsTimer.unref?.()

  async function trimOnce(reason: string): Promise<void> {
    const metrics = app.getAppMetrics() as unknown as MemoryMetricsLike[]
    const before = sumWorkingSetByType(metrics)
    const selfPid = process.pid
    const kernel32 = process.platform === 'win32' ? await loadKernel32Trim() : null
    let handled = 0
    if (kernel32) {
      if (kernel32.emptyWorkingSet(kernel32.currentProcess())) handled++
      for (const pid of selectElectronProcessPids(metrics, selfPid)) {
        const handle = kernel32.openProcess(pid)
        if (!handle) continue
        if (kernel32.emptyWorkingSet(handle)) handled++
        kernel32.close(handle)
      }
    } else if (process.platform === 'win32') {
      if (await trimSelfViaPowerShell(selfPid)) handled++
    }
    // 等内核统计稳定后再读一次，给出 trim 前后对比
    await new Promise((resolve) => setTimeout(resolve, TRIM_SETTLE_MS))
    const after = sumWorkingSetByType(app.getAppMetrics() as unknown as MemoryMetricsLike[])
    const delta = before.total - after.total
    log(
      `工作集整理(${reason})：${mb(before.total)} → ${mb(after.total)}（释放约 ${mb(Math.max(0, delta))}，` +
        `整理进程 ${handled} 个${kernel32 ? '' : '，PowerShell 兜底'}）`
    )
  }

  function broadcastToRenderer(): void {
    try {
      getWindow()?.webContents.send(MEM_TRIM_CHANNEL, { phase: 'hidden' })
    } catch {
      /* 渲染层不可达时忽略 */
    }
  }

  const controller: MemoryTrimController = {
    noteHidden() {
      if (hidden) return
      hidden = true
      broadcastToRenderer()
      void trimOnce('窗口静默')
      idleTimer = setTimeout(() => {
        void trimOnce('静默低频整理')
        idleInterval = setInterval(() => void trimOnce('静默低频整理'), IDLE_TRIM_INTERVAL_MS)
        idleInterval.unref?.()
      }, IDLE_TRIM_FIRST_MS)
      idleTimer.unref?.()
    },
    noteVisible() {
      if (!hidden) return
      hidden = false
      if (idleTimer) clearTimeout(idleTimer)
      if (idleInterval) clearInterval(idleInterval)
      idleTimer = undefined
      idleInterval = undefined
    },
    trimNow: (reason) => trimOnce(reason),
    stop() {
      clearInterval(metricsTimer)
      controller.noteVisible()
    }
  }
  return controller
}
