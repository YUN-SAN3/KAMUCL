/**
 * 默认按键 + 其他游戏配置：启动器级默认值 + 启动时同步进实例 options.txt。
 * options.txt 行格式 key:value；只覆盖登记的项，其余行原样保留。
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { VANILLA_KEYBINDS, VANILLA_OPTIONS, adaptOptionsForVersion, mcVersionAtLeast, serializeResourcePacks } from '../../shared/keybindings'

// 版本判定与 options.txt 行适配的纯函数实现已收敛到 shared/keybindings（可测试、渲染层同源）；
// 此处 re-export 维持既有导入路径（launch.ts / 测试）。
export { adaptOptionsForVersion, mcVersionAtLeast }

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

/**
 * 启动时同步其他配置：写进实例 options.txt（resourcePacks 为空字符串时不同步该项）。返回是否有改动。
 *
 * 写入时机（防「被游戏回写吞掉」）：本函数是 options.txt 的唯一写入点，只在启动管线内、
 * 游戏进程 spawn 之前调用（launch.ts）。玩家在启动器内改动的任何时刻（含游戏运行中）都只
 * 持久化进 default-options.json（即 pending 缓冲），运行中改动不会碰 options.txt，因此不会被
 * MC 退出时的全量回写覆盖；每次启动前从这里现读 default-options.json 统一落盘，即
 * 「运行中改动进缓冲、启动前最后一步统一落盘」的真实实现。
 */
export function syncOptionsToGameDir(gameDir: string, options: Record<string, string> = getDefaultOptions(), mcVersion = ''): boolean {
  const effective: Record<string, string> = {}
  const adapted = adaptOptionsForVersion(options, mcVersion)
  for (const [key, value] of Object.entries(adapted)) {
    // 资源包列表：逗号分隔文本 → options.txt 的 JSON 数组（serializeResourcePacks）；空 = 未配置，不同步
    if (key === 'resourcePacks') {
      const line = serializeResourcePacks(value)
      if (line == null) continue
      // 拖入的包文件随同步复制到实例 resourcepacks 目录（不存在才复制，不覆盖）
      const packsDir = defaultResourcePacksDir()
      const targetDir = path.join(gameDir, 'resourcepacks')
      fs.mkdirSync(targetDir, { recursive: true })
      for (const packName of String(value).split(',').map((s) => s.trim()).filter(Boolean)) {
        const src = path.join(packsDir, path.basename(packName))
        const dest = path.join(targetDir, path.basename(packName))
        if (fs.existsSync(src) && !fs.existsSync(dest)) fs.copyFileSync(src, dest)
      }
      // .zip 已由 serializeResourcePacks 加 file/ 前缀；vanilla/fabric 等内置标识原样保留
      effective[key] = line
      continue
    }
    effective[key] = value
  }
  if (!Object.keys(effective).length) return false
  const file = path.join(gameDir, 'options.txt')
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : ''
  const after = mergeKeysIntoOptions(before, effective)
  if (after === before) return false
  // 编码与换行与 MC 一致：UTF-8 文本、LF 行尾（MC 自身即按 UTF-8 读写并以 \n 保存）
  fs.writeFileSync(file, after, 'utf-8')
  return true
}

// ---------------- 键位同步的版本门槛 ----------------

/**
 * 键位版本适配：≤1.12.2 的 options.txt 键位是 LWJGL2 数字 keycode（key_key.forward:19），
 * 与 1.13+ 的 key.keyboard.* 格式不兼容。旧版跳过键位同步（写 key.keyboard.* 会让 1.12.2 键位失效）。
 * 快照按开发周期判定（17w43a 起为 1.13 新键位），见 shared 的 mcVersionFamily 映射。
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
