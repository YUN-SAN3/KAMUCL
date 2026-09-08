import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { once } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import {
  selectElectronProcessPids,
  sumWorkingSetByType,
  formatMemoryLine,
  MEM_TRIM_CHANNEL
} from '../src/main/core/memTrim'
import { GameSession, formatExitGamesLine } from '../src/main/core/gameSession'
import { windowsQuote, spawnGameProcess } from '../src/main/core/gracefulClose'

// ---------------- 任务A：trim 进程筛选只含 Electron 自身 ----------------

test('trim pid 筛选只来自 Electron 自身指标，排除自身且天然不含游戏 java 进程', () => {
  const metrics = [
    { type: 'Browser', pid: 100, memory: { workingSetSize: 120 * 1024 } },
    { type: 'Renderer', pid: 101, memory: { workingSetSize: 210 * 1024 } },
    { type: 'GPU', pid: 102, memory: { workingSetSize: 90 * 1024 } }
  ]
  // 游戏进程 PID 不可能出现在 app.getAppMetrics() 清单里——筛选只输出指标内、非自身的 PID
  assert.deepEqual(selectElectronProcessPids(metrics, 101), [100, 102])
  assert.deepEqual(selectElectronProcessPids(metrics, 100), [101, 102])
  assert.deepEqual(selectElectronProcessPids([], 1), [])
})

test('内存指标按类型汇总并生成可读日志行', () => {
  const { byType, total } = sumWorkingSetByType([
    { type: 'Browser', pid: 1, memory: { workingSetSize: 120 * 1024 } },
    { type: 'Renderer', pid: 2, memory: { workingSetSize: 210 * 1024 } },
    { type: 'Renderer', pid: 3, memory: { workingSetSize: 10 * 1024 } }
  ])
  assert.equal(total, 340 * 1024)
  assert.equal(byType.Browser, 120 * 1024)
  assert.equal(byType.Renderer, 220 * 1024)
  const line = formatMemoryLine(byType, total)
  assert.match(line, /Browser=120MB/)
  assert.match(line, /Renderer=220MB/)
  assert.match(line, /共 340MB/)
  assert.equal(typeof MEM_TRIM_CHANNEL, 'string')
})

// ---------------- 任务B：退出清理名单不再含游戏进程 ----------------

test('退出提示语：有运行中的游戏时记录「继续运行」，没有则不记录', () => {
  assert.equal(formatExitGamesLine([]), null)
  const line = formatExitGamesLine([1234, 5678])
  assert.ok(line)
  assert.match(line!, /启动器已退出，游戏\(进程 PID 1234、5678\)继续运行/)
})

test('GameSession.runningPids 只汇报真实运行中的 PID，供退出日志使用（无任何终止语义）', () => {
  const session = new GameSession()
  assert.deepEqual(session.runningPids(), [])
  const token = session.reserve('exit-line')
  session.attach(token, Object.assign(new EventEmitter(), {
    pid: 4242, exitCode: null, signalCode: null, kill: () => false
  }) as unknown as ChildProcess)
  assert.deepEqual(session.runningPids(), [4242])
  session.release(token)
  assert.deepEqual(session.runningPids(), [])
})

// ---------------- 任务B：脱离式 spawn 组装 ----------------

test('windowsQuote 生成自包含命令行参数（不依赖父进程解析方式）', () => {
  assert.equal(windowsQuote('java.exe'), 'java.exe')
  assert.equal(windowsQuote('C:\\Program Files\\Java\\bin\\java.exe'), '"C:\\Program Files\\Java\\bin\\java.exe"')
  assert.equal(windowsQuote('a b'), '"a b"')
  assert.equal(windowsQuote('he said "hi"'), '"he said \\"hi\\""')
  // 反斜杠单独出现不触发加引号（与 node child_process 行为一致）
  assert.equal(windowsQuote('trailing\\'), 'trailing\\')
  // 引号内尾部反斜杠需成对，避免转义收尾引号
  assert.equal(windowsQuote('a b\\'), '"a b\\\\"')
})

test('spawnGameProcess 创建的进程独立运行、stdout 管道回传、可被 kill', async () => {
  const proc = await spawnGameProcess(
    process.execPath,
    ['-e', 'console.log("detached-spawn-ok"); setTimeout(() => {}, 30000)'],
    { cwd: process.cwd() }
  )
  assert.equal(typeof proc.pid, 'number')
  const chunks: Buffer[] = []
  proc.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk))
  await once(proc, 'spawn')
  // 轮询等首行输出（管道数据到达是异步的）
  for (let i = 0; i < 50 && !Buffer.concat(chunks).includes('detached-spawn-ok'); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(Buffer.concat(chunks).includes('detached-spawn-ok'), 'stdout 数据应经管道回流')
  // 强制结束路径：kill() → close 事件（与 GameSession.stop 的等待方式一致）
  const closed = once(proc, 'close')
  assert.equal(proc.kill(), true)
  await closed
  assert.equal(proc.signalCode, 'SIGTERM')
  assert.equal(proc.killed, true)
}, { timeout: 15000 })

test('spawnGameProcess 自然退出：exit/close 带真实退出码', async () => {
  const proc = await spawnGameProcess(process.execPath, ['-e', 'process.exit(7)'], { cwd: process.cwd() })
  const [code] = await once(proc, 'close')
  assert.equal(code, 7)
  assert.equal(proc.exitCode, 7)
}, { timeout: 15000 })
