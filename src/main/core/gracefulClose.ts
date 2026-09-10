import { join, basename } from 'node:path'
import { execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { logScope } from './launcherLog'

const closeLog = logScope('graceful-close')

/**
 * 游戏进程句柄：launch.ts / GameSession 依赖的 ChildProcess 最小结构面。
 * 结构上兼容 Node ChildProcess（测试中的 EventEmitter 桩可直接替换）。
 */
export interface GameProcessHandle extends EventEmitter {
  pid?: number
  exitCode: number | null
  signalCode: string | null
  killed: boolean
  stdout: { on(event: 'data', cb: (chunk: Buffer) => void): unknown } | null
  stderr: { on(event: 'data', cb: (chunk: Buffer) => void): unknown } | null
  kill(): boolean
}

/** Product backend action, scoped to the JVM owned by GameSession. No taskkill / Kill /
 * SIGTERM is used for graceful Windows closure: GLFW receives a normal WM_CLOSE. */
export function requestGameWindowClose(child: GameProcessHandle): Promise<void> {
  const pid = child.pid
  if (!Number.isSafeInteger(pid) || !pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  if (process.platform !== 'win32') return Promise.reject(new Error('请先在 Minecraft 内保存并退出，然后重试；当前平台不支持自动正常关窗'))
  closeLog.info(`向游戏进程 pid=${pid} 发送正常关闭消息（WM_CLOSE）`)
  const script = `$ErrorActionPreference='Stop'; $gameProcess=[System.Diagnostics.Process]::GetProcessById(${pid}); if (-not $gameProcess.CloseMainWindow()) { throw 'Minecraft has no responsive main window; exit from inside the game.' }`
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 6000 }, error => {
      if (error) {
        closeLog.warn(`pid=${pid} 正常退出请求失败，请在游戏内保存退出`, error)
        reject(new Error('无法发送正常退出请求，请在游戏内保存退出；不会自动强杀'))
      } else {
        closeLog.info(`pid=${pid} 已确认正常关闭请求送达`)
        resolve()
      }
    })
  })
}

/** QuickPlay 直达场景：仅激活本次启动的 JVM，确认前台结果，退出时取消等待。 */
export function focusGameWindow(child: GameProcessHandle, timeoutMs = 90000): Promise<void> {
  const pid = child.pid
  if (!Number.isSafeInteger(pid) || !pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  if (process.platform !== 'win32') return Promise.resolve()
  closeLog.debug(`拉起游戏窗口聚焦助手：pid=${pid}，超时 ${timeoutMs}ms`)
  const helper = join(__dirname, 'GameWindowFocus.exe').replace('app.asar', 'app.asar.unpacked')
  return new Promise((resolve, reject) => {
    const worker = execFile(helper, [String(pid), String(timeoutMs)], { windowsHide: true, timeout: timeoutMs + 2000 }, (error, _stdout, stderr) => {
      child.off('exit', cancel)
      if (child.exitCode !== null || child.signalCode !== null) return resolve()
      if (error) {
        closeLog.warn(`游戏窗口聚焦未完成：pid=${pid}`, error)
        reject(new Error(stderr.trim() || '游戏窗口前台激活失败或超时'))
      } else resolve()
    })
    const cancel = () => { worker.kill() } // Only our helper, never the game.
    child.once('exit', cancel)
  })
}

// ---------------- 脱离式游戏进程创建（关闭启动器不杀游戏） ----------------
// 根因（本机 Electron 33 / Win11 实测复现）：Electron 退出时，node child_process.spawn（libuv）
// 创建的子进程会被连带终止（job object 树杀）；detached:true、cmd start 包装均不能在保留
// stdout 管道的前提下逃逸。实测 koffi 直调 CreateProcessW 创建的进程（stdio 接匿名管道、
// bInheritHandles=TRUE）在启动器 app.exit 后继续运行且管道数据完整——因此游戏进程改由
// CreateProcessW 创建，父子生命周期完全解耦；stdout/stderr 经 koffi 异步 ReadFile 泵回。
// koffi 缺失/非 Windows 时回退 node spawn（macOS/Linux 子进程本就不随父进程退出而死）。

const CREATE_NO_WINDOW = 0x08000000
const CREATE_SUSPENDED = 0x00000004
const STARTF_USESTDHANDLES = 0x00000100
const HANDLE_FLAG_INHERIT = 0x00000001
const STILL_ACTIVE = 259

/** koffi 运行所需的最小 API 面（脱离 koffi 自带类型，按实际调用形态约束） */
interface KoffiLibrary {
  func(name: string, ret: string, args: unknown[]): KoffiFunc
}
interface KoffiFunc {
  (...args: unknown[]): unknown
  /** koffi 异步调用：末位为回调 (err, retval, ...outParams)，在线程池执行不阻塞主线程 */
  async(...args: unknown[]): void
}
interface KoffiModule {
  load(name: string): KoffiLibrary
  struct(name: string, members: Record<string, string>): unknown
  pointer(type: unknown): unknown
  out(type: unknown): unknown
  sizeof(type: unknown): number
}

interface Kernel32Api {
  createPipe(): { read: number; write: number } | null
  uninherit(handle: number): void
  createProcess(cmdline: string, stdOut: number, stdErr: number, cwd?: string): { pid: number; hProcess: number; hThread: number } | null
  resumeThread(handle: number): void
  close(handle: number): void
  terminate(handle: number, exitCode: number): boolean
  waitForExit(handle: number): Promise<void>
  getExitCode(handle: number): number
  pumpStream(handle: number, push: (chunk: Buffer) => void, end: () => void): void
}

let kernel32Promise: Promise<Kernel32Api | null> | null = null

function asKoffi(mod: unknown): KoffiModule {
  const withDefault = mod as { default?: unknown }
  return (withDefault.default ?? mod) as KoffiModule
}

/** 惰性加载 koffi + kernel32：失败返回 null（回退 node spawn），绝不影响启动流程 */
function loadKernel32(): Promise<Kernel32Api | null> {
  const promise = (kernel32Promise ??= (async () => {
    try {
      const koffi = asKoffi(await import('koffi'))
      const k32 = koffi.load('kernel32.dll')
      const SA = koffi.struct('KamuclSecurityAttributes', {
        nLength: 'uint32', lpSecurityDescriptor: 'void *', bInheritHandle: 'bool'
      })
      const SI = koffi.struct('KamuclStartupInfoW', {
        cb: 'uint32', lpReserved: 'void *', lpDesktop: 'void *', lpTitle: 'void *',
        dwX: 'uint32', dwY: 'uint32', dwXSize: 'uint32', dwYSize: 'uint32',
        dwXCountChars: 'uint32', dwYCountChars: 'uint32', dwFillAttribute: 'uint32', dwFlags: 'uint32',
        wShowWindow: 'uint16', wCbReserved2: 'uint16', lpReserved2: 'void *',
        hStdInput: 'uintptr', hStdOutput: 'uintptr', hStdError: 'uintptr'
      })
      const PI = koffi.struct('KamuclProcessInformation', {
        hProcess: 'uintptr', hThread: 'uintptr', dwProcessId: 'uint32', dwThreadId: 'uint32'
      })
      const createPipe = k32.func('CreatePipe', 'bool', [
        koffi.out(koffi.pointer('uintptr')), koffi.out(koffi.pointer('uintptr')), koffi.pointer(SA), 'uint32'
      ])
      const setHandleInformation = k32.func('SetHandleInformation', 'bool', ['uintptr', 'uint32', 'uint32'])
      const createProcessW = k32.func('CreateProcessW', 'bool', [
        'void *', 'void *', 'void *', 'void *', 'bool', 'uint32', 'void *', 'void *',
        koffi.pointer(SI), koffi.out(koffi.pointer(PI))
      ])
      const resumeThread = k32.func('ResumeThread', 'uint32', ['uintptr'])
      const closeHandle = k32.func('CloseHandle', 'bool', ['uintptr'])
      const terminateProcess = k32.func('TerminateProcess', 'bool', ['uintptr', 'uint32'])
      const getExitCodeProcess = k32.func('GetExitCodeProcess', 'bool', ['uintptr', koffi.out(koffi.pointer('uint32'))])
      const readFile = k32.func('ReadFile', 'bool', ['uintptr', 'void *', 'uint32', koffi.out(koffi.pointer('uint32')), 'void *'])
      const waitForSingleObject = k32.func('WaitForSingleObject', 'uint32', ['uintptr', 'uint32'])

      const makePipe = (): { read: number; write: number } | null => {
        const readBuf = Buffer.alloc(8)
        const writeBuf = Buffer.alloc(8)
        const sa = { nLength: koffi.sizeof(SA), lpSecurityDescriptor: null, bInheritHandle: true }
        if (!createPipe(readBuf, writeBuf, sa, 0)) return null
        return { read: Number(readBuf.readBigUInt64LE()), write: Number(writeBuf.readBigUInt64LE()) }
      }
      const buildSi = (stdOut: number, stdErr: number): Record<string, unknown> => ({
        cb: koffi.sizeof(SI), lpReserved: null, lpDesktop: null, lpTitle: null,
        dwX: 0, dwY: 0, dwXSize: 0, dwYSize: 0, dwXCountChars: 0, dwYCountChars: 0,
        dwFillAttribute: 0, dwFlags: STARTF_USESTDHANDLES, wShowWindow: 0, wCbReserved2: 0,
        lpReserved2: null, hStdInput: 0, hStdOutput: stdOut, hStdError: stdErr
      })
      return {
        createPipe: makePipe,
        uninherit: (handle) => { setHandleInformation(handle, HANDLE_FLAG_INHERIT, 0) },
        createProcess: (cmdline, stdOut, stdErr, cwd) => {
          const cmdBuf = Buffer.from(cmdline + '\0', 'utf16le')
          const pi = { hProcess: 0, hThread: 0, dwProcessId: 0, dwThreadId: 0 }
          // bInheritHandles=true：管道写端随创建传入子进程（与 libuv 一致；实测该创建路径不连带死亡）
          // lpCurrentDirectory 显式传游戏目录：缺省会继承启动器 runtime 目录（游戏相对路径读取全错）
          const cwdBuf = cwd ? Buffer.from(cwd + '\0', 'utf16le') : null
          if (!createProcessW(null, cmdBuf, null, null, true, CREATE_NO_WINDOW | CREATE_SUSPENDED, null, cwdBuf, buildSi(stdOut, stdErr), pi)) return null
          return { pid: pi.dwProcessId, hProcess: pi.hProcess, hThread: pi.hThread }
        },
        resumeThread: (handle) => { resumeThread(handle) },
        close: (handle) => { if (handle) closeHandle(handle) },
        terminate: (handle, exitCode) => terminateProcess(handle, exitCode) === true,
        waitForExit: (handle) => new Promise((resolve) => {
          // 线程池阻塞等待，不占用主线程；INFINITE 只等这一个游戏进程
          waitForSingleObject.async(handle, 0xffffffff, () => resolve())
        }),
        getExitCode: (handle) => {
          const out = Buffer.alloc(4)
          return getExitCodeProcess(handle, out) ? out.readUInt32LE(0) : STILL_ACTIVE
        },
        pumpStream: (handle, push, end) => {
          const buf = Buffer.alloc(64 * 1024)
          const got = Buffer.alloc(4)
          const step = (): void => {
            readFile.async(handle, buf, buf.length, got, null, (err: unknown, retval: unknown) => {
              if (err) { end(); return }
              const n = got.readUInt32LE(0)
              if (retval === false || n === 0) { end(); return } // broken pipe = 对端关闭，EOF
              push(Buffer.from(buf.subarray(0, n)))
              step()
            })
          }
          step()
        }
      }
    } catch (error) {
      closeLog.warn('koffi 加载失败，游戏进程回退 node spawn（退出启动器可能连带关闭游戏）', error)
      return null
    }
  })())
  return promise
}

/** Windows 命令行引号规则（与 node child_process 一致）：反斜杠成对转义、引号前补反斜杠 */
export function windowsQuote(arg: string): string {
  if (arg !== '' && !/[\s"]/.test(arg)) return arg
  let out = '"'
  let backslashes = 0
  for (const ch of arg) {
    if (ch === '\\') { backslashes++; continue }
    if (ch === '"') out += '\\'.repeat(backslashes * 2 + 1) + '"'
    else out += '\\'.repeat(backslashes) + ch
    backslashes = 0
  }
  return out + '\\'.repeat(backslashes * 2) + '"'
}

class DetachedGameProcess extends EventEmitter implements GameProcessHandle {
  pid: number | undefined
  exitCode: number | null = null
  signalCode: string | null = null
  killed = false
  stdout: Readable | null
  stderr: Readable | null

  constructor(
    pid: number,
    private readonly hProcess: number,
    private readonly api: Kernel32Api,
    outRead: number,
    errRead: number
  ) {
    super()
    this.pid = pid
    this.stdout = this.pump(api, outRead)
    this.stderr = this.pump(api, errRead)
    void api.waitForExit(hProcess).then(() => {
      const code = api.getExitCode(hProcess)
      this.exitCode = code === STILL_ACTIVE ? null : code
      api.close(hProcess)
      this.emit('exit', this.exitCode, this.signalCode)
      this.emit('close', this.exitCode, this.signalCode)
    })
  }

  /** koffi 异步 ReadFile 泵：数据到达 push 进流；broken pipe（对端关闭）→ 关读端并结束流 */
  private pump(api: Kernel32Api, readHandle: number): Readable {
    const stream = new Readable({ read() { /* 推模式：数据到达即 push */ } })
    api.pumpStream(
      readHandle,
      (chunk) => { stream.push(chunk) },
      () => {
        api.close(readHandle)
        stream.push(null)
      }
    )
    return stream
  }

  kill(): boolean {
    if (this.exitCode !== null || this.signalCode !== null) return false
    this.killed = true
    this.signalCode = 'SIGTERM'
    const ok = this.api.terminate(this.hProcess, 1)
    if (!ok) {
      this.signalCode = null
      this.killed = false
    }
    return ok
  }
}

/**
 * 脱离式创建游戏进程：Windows 用 CreateProcessW（与启动器生命周期解耦、stdout/stderr 管道回传），
 * 其他平台与 koffi 缺失时回退 node spawn（POSIX 下 detached + 管道，游戏本就不随父进程退出）。
 * 返回结构上兼容 ChildProcess，供 GameSession/launch 管线直接使用。
 */
export async function spawnGameProcess(
  javaPath: string,
  args: string[],
  options: { cwd: string }
): Promise<GameProcessHandle> {
  const api = process.platform === 'win32' ? await loadKernel32() : null
  if (api) {
    const outPipe = api.createPipe()
    const errPipe = api.createPipe()
    if (!outPipe || !errPipe) {
      api.close(outPipe?.read ?? 0); api.close(outPipe?.write ?? 0)
      api.close(errPipe?.read ?? 0); api.close(errPipe?.write ?? 0)
      throw new Error('进程启动失败：无法创建输出管道')
    }
    // 只有写端需要被子进程继承；读端显式清除继承位
    api.uninherit(outPipe.read)
    api.uninherit(errPipe.read)
    const cmdline = [javaPath, ...args].map(windowsQuote).join(' ')
      const created = api.createProcess(cmdline, outPipe.write, errPipe.write, options.cwd)
    api.close(outPipe.write)
    api.close(errPipe.write)
    if (!created) {
      api.close(outPipe.read); api.close(errPipe.read)
      closeLog.error(`CreateProcessW 创建游戏进程失败：${javaPath}`)
      throw new Error('进程启动失败：系统拒绝创建游戏进程（CreateProcessW）')
    }
    const proc = new DetachedGameProcess(created.pid, created.hProcess, api, outPipe.read, errPipe.read)
    // 先恢复主线程再关线程句柄：CREATE_SUSPENDED 创建后必须 ResumeThread，游戏才会真正开跑
    api.resumeThread(created.hThread)
    api.close(created.hThread)
    closeLog.info(`游戏进程已以脱离方式创建：pid=${created.pid}（与启动器生命周期解耦，关闭启动器不影响游戏）`)
    // 与 node 语义对齐：'spawn' 在调用方有机会注册监听后异步发出
    setImmediate(() => proc.emit('spawn'))
    return proc
  }
  // 回退：node spawn。POSIX 平台 detached 让进程组独立；Windows 仅在 koffi 缺失时走到这里（已记日志）
  const { spawn } = await import('node:child_process')
  return spawn(javaPath, args, {
    cwd: options.cwd,
    ...(process.platform !== 'win32' ? { detached: true } : {})
  }) as unknown as GameProcessHandle
}

/**
 * 完全脱离式创建（无管道回传，零句柄耦合）：供更新脚本这类「点火即走」的进程使用。
 * spawnGameProcess 的管道回传会让启动器退出时进程对象被句柄悬挂（文件锁/退出延迟根因之一）。
 */
export async function spawnDetachedProcess(exePath: string, args: string[], options: { cwd?: string } = {}): Promise<number | null> {
  const api = process.platform === 'win32' ? await loadKernel32() : null
  if (api) {
    const cmdline = [exePath, ...args].map(windowsQuote).join(' ')
    const created = api.createProcess(cmdline, 0, 0, options.cwd ?? '')
    if (!created) {
      closeLog.error(`CreateProcessW 脱离式创建失败：${exePath}`)
      return null
    }
    api.resumeThread(created.hThread)
    api.close(created.hThread)
    api.close(created.hProcess)
    closeLog.info(`脱离式进程已创建：pid=${created.pid} ${basename(exePath)}`)
    return created.pid
  }
  const { spawn } = await import('node:child_process')
  const child = spawn(exePath, args, { cwd: options.cwd, detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  return child.pid ?? null
}
