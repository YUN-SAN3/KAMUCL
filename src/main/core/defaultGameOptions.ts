import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { mcVersionFamily } from '../../shared/keybindings'
import { encodeGameOption, supportedGameOption, uniqueGameOptions, validateGameOption, type DefaultGameOptions, type GameOptionValue } from '../../shared/gameOptions'

const file = () => path.join(app.getPath('userData'), 'default-game-options.json')
export function getDefaultGameOptions(): DefaultGameOptions {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'))
    const values: Record<string, GameOptionValue> = {}
    for (const [id, value] of Object.entries(raw.values ?? {})) {
      try { validateGameOption(id, value); values[id] = value } catch {}
    }
    return { enabled: raw.enabled === true, values }
  } catch { return { enabled: false, values: {} } }
}
export function setDefaultGameOptions(change: { enabled?: boolean; id?: string; value?: GameOptionValue | null }): DefaultGameOptions {
  const state = getDefaultGameOptions()
  if (change.enabled !== undefined) {
    if (typeof change.enabled !== 'boolean') throw new Error('同步开关无效')
    state.enabled = change.enabled
  }
  if (change.id) {
    if (change.value === null) delete state.values[change.id]
    else { validateGameOption(change.id, change.value); state.values[change.id] = change.value }
  }
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  const tmp = file() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2)); fs.renameSync(tmp, file())
  return state
}
export function mergeGameOptions(text: string, values: Record<string, GameOptionValue>, version: string): { text: string; applied: string[]; unsupported: string[] } {
  if (Object.keys(values).length && (!version || mcVersionFamily(version)[0] === 999)) throw new Error('无法确认 Minecraft 实际版本，未写入默认游戏选项')
  const writes = new Map<string, string>(), unsupported: string[] = []
  for (const [id, value] of Object.entries(values)) {
    validateGameOption(id, value)
    const def = uniqueGameOptions.find(d => d.id === id)!
    if (!supportedGameOption(def, version)) { unsupported.push(def.label); continue }
    writes.set(id, encodeGameOption(def, value, version))
  }
  // The in-game high contrast switch also selects its built-in resource pack.
  // Merely writing highContrast:true leaves the visual pack disabled on next boot.
  if (writes.has('highContrast')) {
    const source = text.split(/\r?\n/).find(line => line.startsWith('resourcePacks:'))?.slice('resourcePacks:'.length)
    let packs: string[] = []
    if (source) {
      const parsed = JSON.parse(source)
      if (!Array.isArray(parsed) || parsed.some(p => typeof p !== 'string')) throw new Error('现有资源包配置无效，未覆盖 options.txt')
      packs = parsed
    }
    packs = packs.filter(p => p !== 'high_contrast')
    if (values.highContrast) packs.push('high_contrast')
    writes.set('resourcePacks', JSON.stringify(packs))
  }
  const seen = new Set<string>(), newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/).filter((line, index, all) => index !== all.length - 1 || line !== '')
  const out = lines.flatMap(line => {
    const id = line.slice(0, line.indexOf(':'))
    if (!writes.has(id)) return [line]
    if (seen.has(id)) return []
    seen.add(id); return [id + ':' + writes.get(id)]
  })
  for (const [id, value] of writes) if (!seen.has(id)) out.push(id + ':' + value)
  return { text: out.join(newline) + (out.length ? newline : ''), applied: [...writes.keys()], unsupported }
}
export function syncDefaultGameOptions(gameDir: string, version: string, state = getDefaultGameOptions()) {
  if (!state.enabled) return { applied: [], unsupported: [] }
  const target = path.join(gameDir, 'options.txt')
  const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
  const result = mergeGameOptions(before, state.values, version)
  if (before !== result.text) {
    fs.mkdirSync(gameDir, { recursive: true })
    const tmp = target + `.kamucl-${process.pid}.tmp`
    fs.writeFileSync(tmp, result.text, 'utf8')
    fs.renameSync(tmp, target)
    if (fs.readFileSync(target, 'utf8') !== result.text) throw new Error('默认游戏选项写入校验失败')
  }
  return result
}
