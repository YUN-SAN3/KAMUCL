import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

test('FRP 实际控制器会话独立：日志分别归属、密钥打码、单条停止、安装期间取消', { timeout: 10000 }, async t => {
  const result = await build({
    entryPoints: ['src/main/core/frp.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'download', setup(b) {
      b.onResolve({ filter: /^\.\/download$/ }, () => ({ path: 'download', namespace: 'mock' }))
      b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const downloadAll=(...args)=>globalThis.__frpWorkerDownload(...args)' }))
    } }]
  })
  const require = createRequire(path.resolve('package.json'))
  // Exercise supported platforms without mutating the host process or launching real clients.
  for (const [platform, arch] of [['win32', 'x64'], ['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'arm64'], ['linux', 'x64']] as const) {
    await t.test(`${platform}/${arch}`, { timeout: 5000 }, async t => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frp-workers-'))
      const processes: any[] = [], groupSignals: Array<[number, string]> = [], downloads: string[] = []
      let phase: 'start' | 'cancel' = 'start'
      let release: (() => void) | undefined, downloadStarted!: () => void
      const cancellationDownloadStarted = new Promise<void>(resolve => { downloadStarted = resolve })
      t.after(() => {
        delete (globalThis as any).__frpWorkerDownload
        fs.rmSync(root, { recursive: true, force: true })
      })
      ;(globalThis as any).__frpWorkerDownload = async (jobs: Array<{ dest: string }>) => {
        downloads.push(phase)
        // Initial installation must finish before start(); only cancellation is deferred.
        if (phase === 'cancel') {
          const pending = new Promise<void>(resolve => { release = resolve })
          downloadStarted()
          await pending
        }
        for (const job of jobs) fs.writeFileSync(job.dest, 'test stub')
      }
      const controlledProcess = Object.create(process)
      Object.defineProperties(controlledProcess, {
        platform: { value: platform }, arch: { value: arch },
        kill: { value: (pid: number, signal: string) => { groupSignals.push([pid, signal]); return true } }
      })
      const mod = { exports: {} as any }
      new Function('require', 'module', 'exports', 'process', result.outputFiles[0].text)((name: string) => {
        if (name === 'electron') return { app: { getPath: () => root } }
        if (name === 'node:child_process') return { spawn: (target: string, _args: string[], options: { detached?: boolean }) => {
          if (target === 'taskkill') return new EventEmitter()
          const p: any = new EventEmitter()
          p.pid = 100 + processes.length
          p.stdout = new EventEmitter(); p.stderr = new EventEmitter()
          p.detached = options.detached
          p.kill = () => { p.killed = true; setImmediate(() => p.emit('exit', 0, null)); return true }
          processes.push(p)
          return p
        } }
        return require(name)
      }, mod, mod.exports, controlledProcess)
      const { FrpController, frpcPath } = mod.exports
      fs.mkdirSync(path.dirname(frpcPath()), { recursive: true })
      fs.writeFileSync(frpcPath(), 'test stub')
      const a = new FrpController(), b = new FrpController(), events: any[] = []
      a.setSink((e: any) => events.push(e))
      await Promise.all([
        a.start({ accessKey: 'secret-alpha', tunnelId: '11', localPort: 25565 }),
        b.start({ accessKey: 'secret-beta', tunnelId: '22', localPort: 25566 })
      ])
      assert.deepEqual(downloads, platform === 'win32' ? [] : ['start'], 'POSIX validates the existing client through one shared download')
      assert.equal(processes.length, 2)
      assert(processes.every(p => p.detached === (platform !== 'win32')))
      for (const byte of Buffer.from('secret-alpha 需要输 IP:端口 的地方，写 frp-hub.com:36238\n隧道启动成功\n')) processes[0].stdout.emit('data', Buffer.from([byte]))
      processes[1].stdout.emit('data', 'start proxy success\n')
      assert.equal(a.status().remoteAddress, 'frp-hub.com:36238')
      assert.equal(a.status().status, 'running'); assert.equal(b.status().status, 'running')
      assert(!JSON.stringify(events).includes('secret-alpha'))
      await a.stop()
      assert.equal(processes[1].killed, undefined); assert.equal(b.status().status, 'running')
      assert.deepEqual(groupSignals, platform === 'win32' ? [] : [[-100, 'SIGTERM']])
      await b.stop()
      assert.deepEqual(groupSignals, platform === 'win32' ? [] : [[-100, 'SIGTERM'], [-101, 'SIGTERM']])

      phase = 'cancel'
      fs.unlinkSync(frpcPath())
      const c = new FrpController(), d = new FrpController()
      const pending = c.start({ accessKey: 'secret-c', tunnelId: '33', localPort: 1 })
      const other = d.start({ accessKey: 'secret-d', tunnelId: '44', localPort: 1 })
      const rejected = Promise.all([assert.rejects(pending, /取消/), assert.rejects(other, /取消/)])
      await cancellationDownloadStarted
      assert.equal(downloads.filter(p => p === 'cancel').length, 1, 'cancelled starts share one pending installation')
      assert.equal(processes.length, 2, 'installation has not spawned either cancelled session')
      await c.stop(); await d.stop()
      assert.equal(typeof release, 'function')
      release!()
      await rejected
      assert.equal(downloads.filter(p => p === 'cancel').length, 1)
      assert.equal(processes.length, 2)

      phase = 'start'
      await c.start({ accessKey: 'secret-c-retry', tunnelId: '33', localPort: 1 })
      assert.equal(processes.length, 3, 'cancelled installation releases the shared gate for a new start')
      assert.equal(downloads.filter(p => p === 'start').length, platform === 'win32' ? 0 : 2)
      await c.stop()
      assert.deepEqual(groupSignals, platform === 'win32' ? [] : [[-100, 'SIGTERM'], [-101, 'SIGTERM'], [-102, 'SIGTERM']])
    })
  }
})
