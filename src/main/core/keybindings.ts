/**
 * 默认按键：启动器级默认键位 + 启动时同步进实例 options.txt。
 * options.txt 行格式 key:value；只覆盖登记的 key_* 项，其余行原样保留。
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { VANILLA_KEYBINDS } from '../../shared/keybindings'

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

// ---------------- MC 版本适配 ----------------

// 版本族比较统一走 shared/keybindings（快照感知版），此处转发保持既有调用点不变
export { mcVersionAtLeast } from '../../shared/keybindings'
import { mcVersionAtLeast } from '../../shared/keybindings'

/**
 * 键位版本适配：≤1.12.2 的 options.txt 键位是 LWJGL2 数字 keycode（key_key.forward:19），
 * 与 1.13+ 的 key.keyboard.* 格式不兼容。旧版跳过键位同步（写 key.keyboard.* 会让 1.12.2 键位失效）。
 */
export function keySyncSupportedForVersion(mcVersion: string): boolean {
  return mcVersionAtLeast(mcVersion, '1.13')
}
