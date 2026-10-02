import { recycleFile } from './recycleFile'
/**
 * 插件系统：userData/plugins/<id>/ 下的 JS 插件（启动器版 Mod）。
 * 主进程只负责安装/枚举/启停/读取代码；插件代码在渲染进程页面上下文中执行，
 * 可获得界面完全控制权（等同用户自己在 DevTools 执行脚本），仅安装可信来源。
 */
import fs from 'node:fs'
import path from 'node:path'
import { app, protocol } from 'electron'

export interface PluginMeta {
  id: string
  name: string
  version: string
  author: string
  description: string
}

export interface PluginInfo extends PluginMeta {
  enabled: boolean
  hasCode: boolean
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i

/** 插件名清洗为目录安全 id（纯函数）：小写、非法字符转 -、去首尾 -。 */
export function sanitizePluginId(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function pluginsRoot(): string {
  return path.join(app.getPath('userData'), 'plugins')
}

function statePath(): string {
  return path.join(app.getPath('userData'), 'plugins-state.json')
}

function readEnabled(): string[] {
  try {
    const j = JSON.parse(fs.readFileSync(statePath(), 'utf-8'))
    return Array.isArray(j.enabled) ? j.enabled.filter((x: unknown) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeEnabled(enabled: string[]): void {
  fs.writeFileSync(statePath(), JSON.stringify({ enabled }, null, 2), 'utf-8')
}

function readMeta(dir: string, id: string): PluginMeta {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf-8'))
    return {
      id,
      name: String(j.name || id),
      version: String(j.version || ''),
      author: String(j.author || ''),
      description: String(j.description || '')
    }
  } catch {
    return { id, name: id, version: '', author: '', description: '' }
  }
}

export function listPlugins(): PluginInfo[] {
  const root = pluginsRoot()
  const enabled = new Set(readEnabled())
  let dirs: string[] = []
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && ID_RE.test(d.name)).map((d) => d.name)
  } catch {
    return []
  }
  return dirs
    .map((id) => {
      const dir = path.join(root, id)
      return {
        ...readMeta(dir, id),
        enabled: enabled.has(id),
        hasCode: fs.existsSync(path.join(dir, 'main.js'))
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** 安装插件：支持单个 .js 文件或含 plugin.json + main.js 的文件夹。返回插件 id。 */
export function installPlugin(sourcePath: string): string {
  const src = path.resolve(String(sourcePath ?? ''))
  const st = fs.statSync(src)
  let id: string
  let files: Array<{ from: string; to: string }>
  if (st.isDirectory()) {
    const manifest = path.join(src, 'plugin.json')
    const main = path.join(src, 'main.js')
    if (!fs.existsSync(main)) throw new Error('插件文件夹缺少 main.js')
    let name = path.basename(src)
    if (fs.existsSync(manifest)) {
      try {
        const j = JSON.parse(fs.readFileSync(manifest, 'utf-8'))
        name = String(j.id || j.name || name)
      } catch { /* 保持目录名 */ }
    }
    id = sanitizePluginId(name)
    if (!ID_RE.test(id)) throw new Error('插件 id 无效（仅限字母数字、-、_）')
    files = [{ from: main, to: 'main.js' }]
    if (fs.existsSync(manifest)) files.push({ from: manifest, to: 'plugin.json' })
  } else {
    if (!/\.js$/i.test(src)) throw new Error('请选择 .js 插件文件或插件文件夹')
    id = sanitizePluginId(path.basename(src, path.extname(src)))
    if (!ID_RE.test(id)) throw new Error('插件 id 无效（仅限字母数字、-、_）')
    files = [{ from: src, to: 'main.js' }]
  }
  const dest = path.join(pluginsRoot(), id)
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  for (const f of files) fs.copyFileSync(f.from, path.join(dest, f.to))
  return id
}

export function setPluginEnabled(id: string, enabled: boolean): PluginInfo[] {
  if (!ID_RE.test(id)) throw new Error('插件 id 无效')
  const current = new Set(readEnabled())
  if (enabled) current.add(id)
  else current.delete(id)
  writeEnabled([...current])
  return listPlugins()
}

export async function removePlugin(id: string): Promise<PluginInfo[]> {
  if (!ID_RE.test(id)) throw new Error('插件 id 无效')
  const dir = path.join(pluginsRoot(), id)
  // 边界：只能删除插件根目录内的对应 id 目录
  if (path.dirname(path.resolve(dir)) !== path.resolve(pluginsRoot())) throw new Error('非法插件路径')
  await recycleFile(pluginsRoot(), id)
  writeEnabled(readEnabled().filter((x) => x !== id))
  return listPlugins()
}

/** 读取插件代码（渲染进程加载用）；仅在插件存在且启用时返回。 */
export function readPluginCode(id: string): string {
  if (!ID_RE.test(id)) throw new Error('插件 id 无效')
  if (!readEnabled().includes(id)) throw new Error('插件未启用')
  const file = path.join(pluginsRoot(), id, 'main.js')
  const stat = fs.statSync(file)
  if (stat.size > 1024 * 1024) throw new Error('插件文件过大（上限 1 MB）')
  return fs.readFileSync(file, 'utf-8')
}

/**
 * 插件脚本协议：kamucl-plugin://<id>/main.js。
 * 只服务已启用插件目录内的 main.js；CSP 通过 script-src kamucl-plugin: 精确放行，
 * 页面其余部分的 unsafe-eval / inline script 仍然禁止。
 * 必须在 app ready 后调用。
 */
export function registerPluginProtocol(): void {
  protocol.handle('kamucl-plugin', (request) => {
    try {
      const url = new URL(request.url)
      const id = decodeURIComponent(url.hostname)
      if (!ID_RE.test(id) || url.pathname !== '/main.js') return new Response('not found', { status: 404 })
      if (!readEnabled().includes(id)) return new Response('plugin disabled', { status: 403 })
      const file = path.join(pluginsRoot(), id, 'main.js')
      const stat = fs.statSync(file)
      if (stat.size > 1024 * 1024) return new Response('plugin too large', { status: 413 })
      // 直接读文件返回：net.fetch(file://) 会命中缓存，插件热更新将拿到旧代码
      return new Response(fs.readFileSync(file), {
        headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }
        // Response body accepts Buffer via BodyInit in Electron 33 (undici).
      } as ResponseInit)
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
