/**
 * 默认按键 + 其他游戏配置：启动器级默认值 + 启动时同步进实例 options.txt。
 * options.txt 行格式 key:value；只覆盖登记的项，其余行原样保留。
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { VANILLA_KEYBINDS, VANILLA_OPTIONS } from '../../shared/keybindings'
import { compareVersions } from '../../shared/modCompatibility'

const KEY_ID_RE = /^key_key\.[a-z0-9.]+$/i
const BIND_RE = /^key\.(keyboard|mouse)\.[a-z0-9.]+$/

function storeFile(): string {
  return path.join(app.getPath('userData'), 'default-keys.json')
}

/** 读取默认键位（无存储时用 MC 原版默认值生成全表） */
export function getDefaultKeys(): Record<string, string> {
  let stored: Record<string, unknown> = {}
  try {
    const j = JSON.parse(fs.readFileSync(storeFile(), 'utf-8'))
    if (j && typeof j === 'object' && !Array.isArray(j)) stored = j
  } catch { /* 无存储或损坏：全部回退默认 */ }
  const out: Record<string, string> = {}
  for (const def of VANILLA_KEYBINDS) {
    const value = stored[def.id]
    out[def.id] = typeof value === 'string' && BIND_RE.test(value) ? value : def.defaultBind
  }
  return out
}

function persist(keys: Record<string, string>): void {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true })
  fs.writeFileSync(storeFile(), JSON.stringify(keys, null, 2), 'utf-8')
}

/** 设置单个默认键位（id 必须是原版键位项，value 必须是合法 MC 绑定值） */
export function setDefaultKey(id: string, bind: string): Record<string, string> {
  const key = String(id ?? '')
  if (!VANILLA_KEYBINDS.some((d) => d.id === key)) throw new Error('未知的键位项')
  const value = String(bind ?? '')
  if (!BIND_RE.test(value)) throw new Error('无效的按键值')
  const keys = getDefaultKeys()
  keys[key] = value
  persist(keys)
  return keys
}

/** 全部恢复 MC 原版默认 */
export function resetDefaultKeys(): Record<string, string> {
  const keys = Object.fromEntries(VANILLA_KEYBINDS.map((d) => [d.id, d.defaultBind]))
  persist(keys)
  return keys
}

/** 把默认键位合并进 options.txt 文本（纯函数，可测试）：覆盖已有 key_* 行，追加缺失项。 */
export function mergeKeysIntoOptions(text: string, keys: Record<string, string>): string {
  const lines = text.split(/\r?\n/)
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    const i = line.indexOf(':')
    if (i <= 0) {
      if (line.trim()) out.push(line)
      continue
    }
    const key = line.slice(0, i)
    if (key in keys) {
      out.push(`${key}:${keys[key]}`)
      seen.add(key)
    } else out.push(line)
  }
  for (const [key, value] of Object.entries(keys)) {
    if (!seen.has(key)) out.push(`${key}:${value}`)
  }
  return out.join('\n').replace(/\n*$/, '\n')
}

/** 启动时同步：把默认键位写进实例 options.txt。返回是否有改动。 */
export function syncKeysToGameDir(gameDir: string, keys: Record<string, string> = getDefaultKeys()): boolean {
  const file = path.join(gameDir, 'options.txt')
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : ''
  const after = mergeKeysIntoOptions(before, keys)
  if (after === before) return false
  fs.writeFileSync(file, after, 'utf-8')
  return true
}

// ---------------- 其他游戏配置（FOV / 灵敏度 / 亮度 / 视频 / 潜行疾跑方式 / 资源包） ----------------

function optionsStoreFile(): string {
  return path.join(app.getPath('userData'), 'default-options.json')
}

/** 读取其他配置的默认值（无存储时用 MC 原版默认生成） */
export function getDefaultOptions(): Record<string, string> {
  let stored: Record<string, unknown> = {}
  try {
    const j = JSON.parse(fs.readFileSync(optionsStoreFile(), 'utf-8'))
    if (j && typeof j === 'object' && !Array.isArray(j)) stored = j
  } catch { /* 无存储或损坏：全部回退默认 */ }
  const out: Record<string, string> = {}
  for (const def of VANILLA_OPTIONS) {
    const value = stored[def.id]
    out[def.id] = typeof value === 'string' ? value : serializeOptionValue(def.defaultValue)
  }
  return out
}

function persistOptions(options: Record<string, string>): void {
  fs.mkdirSync(path.dirname(optionsStoreFile()), { recursive: true })
  fs.writeFileSync(optionsStoreFile(), JSON.stringify(options, null, 2), 'utf-8')
}

/** 配置值序列化为 options.txt 文本值 */
export function serializeOptionValue(value: number | string | boolean): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

export function setDefaultOption(id: string, value: string): Record<string, string> {
  const key = String(id ?? '')
  const def = VANILLA_OPTIONS.find((d) => d.id === key)
  if (!def) throw new Error('未知的配置项')
  const v = String(value ?? '')
  // 按类型校验
  if (def.type === 'slider' || def.type === 'select') {
    const n = Number(v)
    if (def.type === 'slider') {
      if (!Number.isFinite(n)) throw new Error('需要数值')
      if (def.min != null && n < def.min) throw new Error(`不能小于 ${def.min}`)
      if (def.max != null && n > def.max) throw new Error(`不能大于 ${def.max}`)
    } else if (def.options && !def.options.some((o) => o.value === v)) {
      throw new Error('无效的可选值')
    }
  } else if (def.type === 'boolean' && v !== 'true' && v !== 'false') {
    throw new Error('需要 true/false')
  }
  const options = getDefaultOptions()
  options[key] = v
  persistOptions(options)
  return options
}

export function resetDefaultOptions(): Record<string, string> {
  const options = Object.fromEntries(VANILLA_OPTIONS.map((d) => [d.id, serializeOptionValue(d.defaultValue)]))
  persistOptions(options)
  return options
}

/** 启动时同步其他配置：写进实例 options.txt（resourcePacks 为空字符串时不同步该项）。返回是否有改动。 */
export function syncOptionsToGameDir(gameDir: string, options: Record<string, string> = getDefaultOptions(), mcVersion = ''): boolean {
  const effective: Record<string, string> = {}
  const adapted = adaptOptionsForVersion(options, mcVersion)
  for (const [key, value] of Object.entries(adapted)) {
    // 资源包列表：逗号分隔文本 → options.txt 的 JSON 数组；为空 = 未配置，不同步
    if (key === 'resourcePacks') {
      const list = value.split(',').map((s) => s.trim()).filter(Boolean)
      if (!list.length) continue
      // 拖入的包文件随同步复制到实例 resourcepacks 目录（不存在才复制，不覆盖）
      const packsDir = defaultResourcePacksDir()
      const targetDir = path.join(gameDir, 'resourcepacks')
      fs.mkdirSync(targetDir, { recursive: true })
      for (const packName of list) {
        const src = path.join(packsDir, path.basename(packName))
        const dest = path.join(targetDir, path.basename(packName))
        if (fs.existsSync(src) && !fs.existsSync(dest)) fs.copyFileSync(src, dest)
      }
      // .zip 文件加 file/ 前缀；vanilla/fabric 等内置标识原样保留
      effective[key] = JSON.stringify(list.map((n) => /\.zip$/i.test(n) ? `file/${path.basename(n)}` : n))
      continue
    }
    effective[key] = value
  }
  if (!Object.keys(effective).length) return false
  const file = path.join(gameDir, 'options.txt')
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : ''
  const after = mergeKeysIntoOptions(before, effective)
  if (after === before) return false
  fs.writeFileSync(file, after, 'utf-8')
  return true
}

// ---------------- MC 版本适配（不同版本 options.txt 的字段名/格式差异） ----------------

/** MC 版本是否 ≥ 目标版本（1.x.y 格式；26.x 新版号天然大于所有 1.x） */
export function mcVersionAtLeast(mcVersion: string, target: string): boolean {
  if (!mcVersion) return true // 未知版本按最新处理
  return compareVersions(mcVersion, target) >= 0
}

/**
 * 按 MC 版本适配配置写入：
 * - FOV：options.txt 所有版本均为 0-1 浮点（度数映射 (d-30)/80），统一转换；
 *   写整数度数会被误读（用户报告 1.12.2 视角颠倒、显示"角视场 3470"）。
 * - 图像品质：1.21.11 前为 graphics:0/1/2（数字）；1.21.11 起为 graphicsPreset:"fast"/"fancy"/"fabulous"（带引号 JSON 串）。
 * - 潜行/疾跑切换：1.15 引入 toggleCrouch/toggleSprint，更早版本无此字段，跳过。
 * - 渲染距离 renderDistance、亮度 gamma、鼠标灵敏度 mouseSensitivity、垂直同步 enableVsync、
 *   帧率上限 maxFps、自动跳跃 autoJump 各版本字段一致（均经真实 options.txt 实证）。
 */
export function adaptOptionsForVersion(options: Record<string, string>, mcVersion: string): Record<string, string> {
  const out = { ...options }
  // FOV：度数 → 0-1 浮点（所有版本一致）
  if (out.fov != null && out.fov !== '') {
    const degrees = Number(out.fov)
    if (Number.isFinite(degrees)) {
      out.fov = String(Math.max(0, Math.min(1, (degrees - 30) / 80)))
    }
  }
  // 图像品质：按版本选字段与值格式
  if (out.graphicsPreset != null && out.graphicsPreset !== '') {
    const preset = out.graphicsPreset
    if (mcVersionAtLeast(mcVersion, '1.21.11')) {
      // 新版：graphicsPreset 带引号 JSON 字符串
      out.graphicsPreset = `"${preset}"`
    } else {
      // 旧版：graphics 数字（0 流畅 / 1 高品质 / 2 极佳）
      out.graphics = preset === 'fast' ? '0' : preset === 'fabulous' ? '2' : '1'
      delete out.graphicsPreset
    }
  }
  // 潜行/疾跑切换：1.15 辅助功能引入，更早版本无此字段，跳过
  if (!mcVersionAtLeast(mcVersion, '1.15')) {
    delete out.toggleCrouch
    delete out.toggleSprint
  }
  return out
}

/**
 * 键位版本适配：≤1.12.2 的 options.txt 键位是 LWJGL2 数字 keycode（key_key.forward:19），
 * 与 1.13+ 的 key.keyboard.* 格式不兼容。旧版跳过键位同步（写 key.keyboard.* 会让 1.12.2 键位失效）。
 */
export function keySyncSupportedForVersion(mcVersion: string): boolean {
  return mcVersionAtLeast(mcVersion, '1.13')
}

// ---------------- 默认材质包（拖入装载，随同步复制到实例） ----------------

/** 拖入的默认材质包存放目录 */
function defaultResourcePacksDir(): string {
  try {
    return path.join(app.getPath('userData'), 'default-resourcepacks')
  } catch {
    // 测试环境无 Electron app：回退临时目录（同步逻辑仍可验证）
    return path.join(require('node:os').tmpdir(), 'kamucl-default-resourcepacks')
  }
}

/** 拖入材质包文件（.zip）：复制到启动器资源库并加入默认资源包列表。 */
export function importDefaultResourcePacks(paths: string[]): Record<string, string> {
  const options = getDefaultOptions()
  const current = (options.resourcePacks ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const dir = defaultResourcePacksDir()
  fs.mkdirSync(dir, { recursive: true })
  for (const source of paths) {
    const name = path.basename(String(source))
    if (!/\.zip$/i.test(name)) throw new Error(`不支持的材质包文件：${name}（仅支持 .zip）`)
    const dest = path.join(dir, name)
    fs.copyFileSync(String(source), dest)
    if (!current.includes(name)) current.push(name)
  }
  options.resourcePacks = current.join(',')
  persistOptions(options)
  return options
}

/** 移除默认材质包（列表移除 + 删除库文件） */
export function removeDefaultResourcePack(name: string): Record<string, string> {
  const options = getDefaultOptions()
  const safe = path.basename(String(name))
  const current = (options.resourcePacks ?? '').split(',').map((s) => s.trim()).filter(Boolean).filter((n) => n !== safe)
  options.resourcePacks = current.join(',')
  persistOptions(options)
  try {
    fs.rmSync(path.join(defaultResourcePacksDir(), safe), { force: true })
  } catch { /* 删除失败不影响列表 */ }
  return options
}
