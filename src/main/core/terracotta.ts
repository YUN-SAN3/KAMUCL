/**
 * terracotta.ts — 陶瓦联机（Terracotta）官方工具集成（KAMUCL）
 *
 * 移植自 VoxLink MOD 的集成方式（fabric/26.2/.../terracotta/*）：
 *  - 官方渠道下载 terracotta-<ver>-windows-<arch>-pkg.tar.gz（多镜像回退）→ SHA-256 校验 → 解出 exe
 *  - `terracotta.exe --hmcl <portFile>` 启动 → 轮询 portFile 得 {"port": N} → HTTP 127.0.0.1:N
 *  - 房主：GET /state/scanning?player=NAME        → 轮询 /state 直到 state=host_ok，room=U/XXXX-XXXX-XXXX-XXXX
 *  - 加入：GET /state/guesting?room=CODE&player=NAME → 轮询 /state 直到给出 url
 *  - 复位：GET /state/ide（官方拼写即 ide）；停止：GET /panic?peaceful=true + 杀进程树
 *
 * IPC：invoke 'tc:start'|'tc:stop'|'tc:status'；push 'tc:event' {type:'log'|'ready'|'error'|'stopped', data}
 */
import { spawn, ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { app, BrowserWindow, type IpcMain } from 'electron'

const TC_VERSION = '0.4.2'
// 与 VoxLink MOD TerracottaBinary.java 一致的平台资产与 SHA-256
const ASSETS: Record<string, { pkg: string; sha256: string; exe: string }> = {
  'win32-x64': {
    pkg: `terracotta-${TC_VERSION}-windows-x86_64-pkg.tar.gz`,
    sha256: '74c10568a7fea9c1d38cf8d2d4ca90baf1517f8e5a26c63d3349db70bc449796',
    exe: `terracotta-${TC_VERSION}-windows-x86_64.exe`
  },
  'win32-arm64': {
    pkg: `terracotta-${TC_VERSION}-windows-arm64-pkg.tar.gz`,
    sha256: '782c2fa911488d487447694acca6b17fa68304c87023fb6814b83a167fc2845f',
    exe: `terracotta-${TC_VERSION}-windows-arm64.exe`
  }
}
const DOWNLOAD_BASES = [
  `https://github.com/burningtnt/Terracotta/releases/download/v${TC_VERSION}`,
  `https://gitee.com/burningtnt/Terracotta/releases/download/v${TC_VERSION}`,
  `https://cnb.cool/HMCL-Terracotta/Terracotta/-/releases/download/v${TC_VERSION}`,
  `https://mirror.ghproxy.com/https://github.com/burningtnt/Terracotta/releases/download/v${TC_VERSION}`
]
const START_TOTAL_TIMEOUT_MS = 120_000
const PORT_POLL_MS = 500
const STATE_POLL_MS = 500
const HTTP_TIMEOUT_MS = 8_000

export interface TerracottaState {
  phase: 'idle' | 'downloading' | 'starting' | 'hosting' | 'joining' | 'ready'
  room?: string
  url?: string
  stateRaw?: string
  error?: string
}

let proc: ChildProcess | null = null
let httpPort = 0
let portFile = ''
let state: TerracottaState = { phase: 'idle' }
let stateTimer: ReturnType<typeof setInterval> | undefined
let disposedByUser = false
/** tc:start 进行中标记：防止并发 start 覆盖 proc 引用导致第一个进程泄漏。 */
let starting = false

function emit(type: 'log' | 'ready' | 'error' | 'stopped', data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('tc:event', { type, data })
  }
}

function setState(patch: Partial<TerracottaState>): void {
  state = { ...state, ...patch }
}

function tcDir(): string {
  return path.join(app.getPath('userData'), 'terracotta')
}

function assetKey(): string {
  return `${process.platform}-${os.arch()}`
}

function binaryPath(): string {
  const asset = ASSETS[assetKey()]
  if (!asset) throw new Error(`陶瓦联机暂不支持此平台：${assetKey()}`)
  return path.join(tcDir(), asset.exe)
}

/** 下载（带镜像回退与重试）→ SHA-256 校验 → 解 tar.gz 提取 exe。返回进度日志。 */
async function ensureBinary(): Promise<string> {
  const asset = ASSETS[assetKey()]
  if (!asset) throw new Error(`陶瓦联机暂不支持此平台：${assetKey()}`)
  const exe = binaryPath()
  fs.mkdirSync(tcDir(), { recursive: true })
  if (fs.existsSync(exe)) {
    if (await verifySha256(exe, asset.sha256)) return exe
    emit('log', { level: 'warn', msg: '本地陶瓦二进制校验失败，重新下载' })
    fs.rmSync(exe, { force: true })
  }
  const pkgPath = path.join(tcDir(), asset.pkg)
  let lastErr: unknown = null
  for (const base of DOWNLOAD_BASES) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        setState({ phase: 'downloading' })
        emit('log', { level: 'info', msg: `下载陶瓦官方二进制：${new URL(base + '/' + asset.pkg).host}` })
        await download(base + '/' + asset.pkg, pkgPath)
        if (!(await verifySha256(pkgPath, asset.sha256))) throw new Error('SHA-256 校验失败（包已损坏或被篡改）')
        extractTarGz(pkgPath, tcDir())
        if (!fs.existsSync(exe)) throw new Error(`压缩包内未找到 ${asset.exe}`)
        fs.rmSync(pkgPath, { force: true })
        emit('log', { level: 'info', msg: '陶瓦官方二进制就绪（已通过 SHA-256 校验）' })
        return exe
      } catch (e) {
        lastErr = e
        emit('log', { level: 'warn', msg: `下载源失败：${(e as Error).message}，尝试下一个` })
      }
    }
  }
  throw new Error(`陶瓦二进制下载失败：${(lastErr as Error)?.message ?? '全部镜像不可用'}。可到 https://github.com/burningtnt/Terracotta/releases 手动下载后放到 ${tcDir()}`)
}

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const get = (u: string, redirects: number): void => {
      if (redirects > 5) return reject(new Error('重定向过多'))
      const mod = u.startsWith('https:') ? https : http
      const req = mod.get(u, { timeout: 90_000 }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return get(new URL(res.headers.location, u).toString(), redirects + 1)
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode}`))
        }
        const out = fs.createWriteStream(dest)
        res.pipe(out)
        out.on('finish', () => out.close(() => resolve()))
        out.on('error', reject)
      })
      req.on('timeout', () => req.destroy(new Error('下载超时')))
      req.on('error', reject)
    }
    get(url, 0)
  })
}

async function verifySha256(file: string, expected: string): Promise<boolean> {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256')
    fs.createReadStream(file).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex') === expected)).on('error', () => resolve(false))
  })
}

/** 最小 tar 解包（ustar，只提取 regular file 到 destDir，保留文件名最后一层）。 */
function extractTarGz(tarGz: string, destDir: string): void {
  const raw = zlib.gunzipSync(fs.readFileSync(tarGz))
  let off = 0
  while (off + 512 <= raw.length) {
    const header = raw.subarray(off, off + 512)
    if (header.every((b) => b === 0)) break
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8)
    const typeFlag = String.fromCharCode(header[156] ?? 48)
    off += 512
    if (!name) break
    const data = raw.subarray(off, off + size)
    off += Math.ceil(size / 512) * 512
    if (typeFlag === '0' || typeFlag === '\0') {
      const base = path.basename(name.replace(/\\/g, '/'))
      if (base && base !== '..' && base !== '.') fs.writeFileSync(path.join(destDir, base), data)
    }
  }
}

/** 启动 terracotta --hmcl <portFile> 并轮询端口文件。 */
async function startProcess(): Promise<number> {
  const exe = binaryPath()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-tc-'))
  portFile = path.join(dir, 'http')
  fs.rmSync(portFile, { force: true })
  disposedByUser = false
  proc = spawn(exe, ['--hmcl', portFile], { windowsHide: true })
  proc.stdout?.on('data', (d: Buffer) => emit('log', { level: 'info', msg: d.toString().trim() }))
  proc.stderr?.on('data', (d: Buffer) => emit('log', { level: 'warn', msg: d.toString().trim() }))
  proc.on('exit', (code) => {
    emit('log', { level: 'info', msg: `陶瓦进程退出（${code ?? '信号'}）` })
    proc = null
    if (!disposedByUser) {
      stopPolling()
      setState({ phase: 'idle', room: undefined, url: undefined })
      emit('stopped', null)
    }
  })
  const t0 = Date.now()
  while (Date.now() - t0 < START_TOTAL_TIMEOUT_MS) {
    if (!proc || proc.exitCode !== null) throw new Error('陶瓦进程在启动期间退出，请查看日志')
    try {
      const content = fs.readFileSync(portFile, 'utf8').trim()
      const m = /"port"\s*:\s*(\d+)/.exec(content)
      if (m) {
        httpPort = Number(m[1])
        emit('log', { level: 'info', msg: `陶瓦 HTTP 端口 ${httpPort}` })
        return httpPort
      }
    } catch { /* 文件尚未生成 */ }
    await sleep(PORT_POLL_MS)
  }
  throw new Error('陶瓦启动超时（120s）未写出端口文件')
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function tcGet(pathName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${httpPort}${pathName}`, { timeout: HTTP_TIMEOUT_MS }, (res) => {
      let body = ''
      res.on('data', (d) => { body += d })
      res.on('end', () => {
        if (res.statusCode === 200) resolve(body)
        else reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`))
      })
    })
    req.on('timeout', () => req.destroy(new Error('请求超时')))
    req.on('error', reject)
  })
}

interface TcStateJson { state?: string; room?: string; url?: string; difficulty?: string }

async function pollUntilReady(kind: 'host' | 'join', timeoutSec: number): Promise<TcStateJson> {
  const deadline = Date.now() + timeoutSec * 1000
  while (Date.now() < deadline) {
    if (!proc) throw new Error('陶瓦进程已退出')
    try {
      const json = JSON.parse(await tcGet('/state')) as TcStateJson
      const st = json.state ?? 'unknown'
      if (st !== state.stateRaw) {
        setState({ stateRaw: st })
        emit('log', { level: 'info', msg: `陶瓦状态：${st}` })
      }
      // 失败/异常态直接报错（与 MOD 的可恢复异常→重试一次对齐）
      if (st === 'exception' || st === 'fatal' || st === 'failed') {
        await tcGet('/state/ide').catch(() => {})
        throw new Error(`陶瓦进入异常状态（${st}），已复位，可重试`)
      }
      if (kind === 'host' && (st === 'host_ok' || json.room)) return json
      if (kind === 'join' && (st === 'guest_ok' || json.url)) return json
    } catch (e) {
      if ((e as Error).message.includes('异常状态')) throw e
    }
    await sleep(STATE_POLL_MS)
  }
  throw new Error(kind === 'host' ? '等待房间号超时（30s）' : '等待连接就绪超时')
}

function stopPolling(): void {
  if (stateTimer) { clearInterval(stateTimer); stateTimer = undefined }
}

async function killTree(): Promise<void> {
  const p = proc
  proc = null
  httpPort = 0
  stopPolling()
  if (!p || p.exitCode !== null) return
  if (process.platform === 'win32' && p.pid) {
    await new Promise<void>((resolve) => {
      execFileAsync('taskkill', ['/T', '/F', '/PID', String(p.pid)]).catch(() => {})
      setTimeout(resolve, 800)
    })
  } else {
    p.kill('SIGKILL')
  }
  disposedByUser = true
}

function execFileAsync(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { execFile } = require('node:child_process') as typeof import('node:child_process')
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) => (err ? reject(err) : resolve({ stdout, stderr })))
  })
}

async function tcStart(payload: { mode: 'host' | 'join'; code?: string; port?: number; playerName?: string }): Promise<TerracottaState> {
  if (starting) throw new Error('陶瓦联机正在启动中，请稍候再试')
  try {
    starting = true
    if (state.phase !== 'idle' && state.phase !== 'downloading') await tcStop(true)
    state = { phase: 'downloading' }
    await ensureBinary()
    setState({ phase: 'starting' })
    await startProcess()
    const me = payload.playerName || 'KAMUCL'
    if (payload.mode === 'host') {
      setState({ phase: 'hosting', room: undefined, url: undefined, error: undefined })
      await tcGet(`/state/scanning?player=${encodeURIComponent(me)}`)
      emit('log', { level: 'info', msg: '已请求创建陶瓦房间，等待房间号…' })
      const final = await pollUntilReady('host', 30)
      setState({ phase: 'ready', room: final.room, url: undefined })
      emit('ready', { mode: 'host', room: final.room, state: final.state })
    } else {
      const code = String(payload.code ?? '').trim().toUpperCase()
      // 陶瓦房间码：U/ 前缀 + 四段各 4 位（GitHub burningtnt/Terracotta 官方格式）
      if (!/^U\/[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(code)) throw new Error('陶瓦房间码格式应为 U/XXXX-XXXX-XXXX-XXXX（U/ 开头共四段）')
      setState({ phase: 'joining', room: code, url: undefined, error: undefined })
      await tcGet(`/state/guesting?room=${encodeURIComponent(code)}&player=${encodeURIComponent(me)}`)
      emit('log', { level: 'info', msg: '已请求加入陶瓦房间，等待连接就绪…' })
      const final = await pollUntilReady('join', 60)
      setState({ phase: 'ready', room: code, url: final.url })
      emit('ready', { mode: 'join', url: final.url, state: final.state })
    }
  } catch (e) {
    setState({ phase: 'idle', error: (e as Error).message })
    emit('error', (e as Error).message)
  } finally {
    starting = false
  }
  return { ...state }
}

async function tcStop(silent = false): Promise<TerracottaState> {
  try { if (httpPort > 0) await tcGet('/panic?peaceful=true') } catch { /* 进程可能已退出 */ }
  await killTree()
  state = { phase: 'idle' }
  if (!silent) emit('stopped', null)
  return { ...state }
}

export function registerTerracottaIpc(ipcMain: IpcMain): void {
  ipcMain.handle('tc:start', (_e, payload: { mode: 'host' | 'join'; code?: string; port?: number; playerName?: string }) => tcStart(payload))
  ipcMain.handle('tc:stop', () => tcStop())
  ipcMain.handle('tc:status', () => ({
    ...state,
    binaryReady: !!ASSETS[assetKey()] && fs.existsSync(binaryPath()),
    running: !!proc
  }))
}

/** 应用退出时清理（gracefulClose 里调用）。 */
export async function stopTerracottaOnQuit(): Promise<void> {
  await killTree()
}
