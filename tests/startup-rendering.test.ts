import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { transformSync } from 'esbuild'

function fixture() {
  const ipc = new EventEmitter(), contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    setBackgroundThrottling: (value: boolean) => { throttling = value },
    capturePage: () => { count++; return new Promise<void>((resolve, reject) => { settle = resolve; fail = reject }) }
  })
  let destroyed = false, throttling = false, count = 0
  let settle = () => {}, fail = (_e: Error) => {}
  const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => destroyed })
  Object.defineProperty(window, 'webContents', { get() { if (destroyed) throw new Error('Object has been destroyed'); return contents } })
  const timers: Array<{fn: () => void; ms: number; canceled: boolean; unref: () => void}> = []
  const warnings: unknown[] = []
  const module = { exports: {} as any }
  const code = transformSync(fs.readFileSync('src/main/startupRendering.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', code)(
    (id: string) => id === 'electron' ? { ipcMain: ipc } : { launcherLogWarn: (...args: unknown[]) => warnings.push(args) }, module, module.exports,
    (fn: () => void, ms: number) => { const timer = {fn, ms, canceled: false, unref() {}}; timers.push(timer); return timer },
    (timer: any) => { if (timer) timer.canceled = true }
  )
  module.exports.prepareStartupFrames(window)
  return { ipc, contents, window, timers, warnings, count: () => count, throttling: () => throttling,
    start: () => contents.emit('dom-ready'), settle: () => settle(), fail: () => fail(new Error('GPU unavailable')),
    close: () => { destroyed = true; window.emit('closed') },
    tick: (ms: number) => { const timer = timers.find(t => !t.canceled && t.ms === ms); assert(timer); timer.canceled = true; timer.fn() }
  }
}
const drained = () => new Promise<void>(resolve => setImmediate(resolve))

test('启动预绘制只处理自己的就绪事件，不重叠请求，完成后恢复后台节流并释放监听', async () => {
  const f = fixture(); assert.equal(f.count(), 0); f.start(); assert.equal(f.count(), 1)
  f.ipc.emit('boot:renderer-ready', { sender: {} }); assert.equal(f.throttling(), false)
  assert.equal(f.timers.filter(t => !t.canceled && t.ms === 16).length, 0)
  f.settle(); await drained(); f.tick(16); assert.equal(f.count(), 2)
  f.ipc.emit('boot:renderer-ready', { sender: f.contents }); assert.equal(f.throttling(), true)
  f.settle(); await drained(); assert.equal(f.timers.filter(t => !t.canceled).length, 0)
  assert.equal(f.ipc.listenerCount('boot:renderer-ready'), 0); assert.equal(f.window.listenerCount('closed'), 0)
})
test('首帧请求失败后降级且不重试，不产生伪就绪消息', async () => {
  const f = fixture(); let ready = 0; f.ipc.on('boot:renderer-ready', () => ready++)
  f.start(); f.fail(); await drained()
  assert.equal(ready, 0); assert.equal(f.throttling(), true); assert.equal(f.warnings.length, 1)
  assert.equal(f.timers.filter(t => !t.canceled).length, 0)
})
test('启动中关闭窗口，晚完成的首帧请求不能重新安排任务', async () => {
  const f = fixture(); f.start(); f.close(); f.settle(); await drained()
  assert.equal(f.count(), 1); assert.equal(f.ipc.listenerCount('boot:renderer-ready'), 0)
  assert.equal(f.timers.filter(t => !t.canceled).length, 0)
})
test('慢资源达到预绘制预算后停止，不提前完成启动门禁', async () => {
  const f = fixture(); let ready = 0; f.ipc.on('boot:renderer-ready', () => ready++)
  f.start(); f.tick(10000); f.settle(); await drained()
  assert.equal(ready, 0); assert.equal(f.throttling(), true); assert.equal(f.timers.filter(t => !t.canceled).length, 0)
})
