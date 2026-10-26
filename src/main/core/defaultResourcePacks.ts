import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { app } from 'electron'
import type { DefaultResourcePack } from '../../shared/types'
import { mcVersionAtLeast } from '../../shared/keybindings'
import { prepareResourcePackArchive } from './resourcePackArchive'

const root = () => path.join(app.getPath('userData'), 'default-resourcepacks')
const manifest = () => path.join(root(), 'packs.json')
const managedName = (p: DefaultResourcePack) => `KAMUCL-default-${p.id}-${p.name}`
const hash = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex')
const optionKeys = ['resourcePacks', 'incompatibleResourcePacks'] as const
type PackOptionKey = typeof optionKeys[number]
type PackFormat = [number, number]

function snapshot(file: string): Buffer | null {
  try {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`配置或材质包路径不是普通文件：${path.basename(file)}`)
    return fs.readFileSync(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
function unchanged(file: string, expected: Buffer | null): void {
  const actual = snapshot(file)
  if (expected === null ? actual !== null : actual === null || !actual.equals(expected)) throw new Error(`${path.basename(file)} 在操作期间发生变化，未覆盖新配置，请重试`)
}
function tempFile(file: string, role = 'write'): string {
  return `${file}.kamucl-${role}-${crypto.randomUUID()}.tmp`
}
function cleanTemp(file: string): void {
  try { fs.unlinkSync(file) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}
function stage(file: string, data: Buffer): string {
  const temp = tempFile(file)
  try {
    fs.writeFileSync(temp, data, { flag: 'wx' })
    if (!fs.readFileSync(temp).equals(data)) throw new Error(`${path.basename(file)} 暂存校验失败`)
    return temp
  } catch (error) { cleanTemp(temp); throw error }
}
/** Stage every write before publishing. If either config fails, restore both original snapshots. */
function commitFiles(writes: Array<{ file: string; before: Buffer | null; after: Buffer }>): void {
  const pending = writes.filter(w => w.before === null || !w.before.equals(w.after))
    .map(w => ({ ...w, temp: '', rollback: '', published: false, recovery: false }))
  try {
    for (const w of pending) {
      w.temp = stage(w.file, w.after)
      if (w.before !== null) w.rollback = stage(w.file, w.before)
    }
    for (const w of pending) unchanged(w.file, w.before)
    for (const w of pending) {
      unchanged(w.file, w.before)
      fs.renameSync(w.temp, w.file)
      w.temp = ''; w.published = true
      if (!snapshot(w.file)?.equals(w.after)) throw new Error(`${path.basename(w.file)} 写入校验失败`)
    }
  } catch (error) {
    const failed: string[] = []
    for (const w of [...pending].reverse()) if (w.published) {
      try {
        unchanged(w.file, w.after)
        if (w.before === null) fs.unlinkSync(w.file)
        else { fs.renameSync(w.rollback, w.file); w.rollback = '' }
      } catch { w.recovery = true; failed.push(path.basename(w.file)) }
    }
    if (failed.length) throw new Error(`默认材质包写入失败，以下配置无法回滚：${failed.join('、')}；保留了 .tmp 恢复副本。${error instanceof Error ? error.message : String(error)}`)
    throw error
  } finally {
    for (const w of pending) {
      if (w.temp) cleanTemp(w.temp)
      // A failed rollback keeps the original bytes available for recovery.
      if (w.rollback && !w.recovery) cleanTemp(w.rollback)
    }
  }
}
function save(packs: DefaultResourcePack[]): DefaultResourcePack[] {
  fs.mkdirSync(root(), { recursive: true })
  commitFiles([{ file: manifest(), before: snapshot(manifest()), after: Buffer.from(JSON.stringify(packs, null, 2) + '\n') }])
  return packs
}
function safePackName(name: unknown): name is string {
  return typeof name === 'string' && path.basename(name) === name && /\.zip$/i.test(name) && !/[<>:"/\\|?*\x00-\x1f]/.test(name)
}
export function getDefaultResourcePacks(): DefaultResourcePack[] {
  try {
    const packs = JSON.parse(fs.readFileSync(manifest(), 'utf8').replace(/^\uFEFF/, ''))
    return Array.isArray(packs) ? packs.filter(p => /^[a-f0-9]{64}$/.test(p?.id) && safePackName(p.name) && fs.existsSync(path.join(root(), p.id + '.zip'))).map(p => ({ ...p, enabled: p.enabled !== false })) : []
  } catch { return [] }
}
export function importDefaultResourcePacks(files: string[]): DefaultResourcePack[] {
  if (!Array.isArray(files) || !files.length) return getDefaultResourcePacks()
  // Validate the complete batch before changing the global defaults.
  const incoming = files.map(file => {
    if (typeof file !== 'string' || path.extname(file).toLowerCase() !== '.zip' || !fs.statSync(file).isFile()) throw new Error('请选择 ZIP 格式材质包')
    const data = fs.readFileSync(file)
    prepareResourcePackArchive(data, path.basename(file))
    const original = path.basename(file).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    // Leave room for the content-addressed prefix within Windows' filename limit.
    let shortName = ''
    for (const char of original.slice(0, -4)) { if (shortName.length + char.length > 150) break; shortName += char }
    const name = original.length > 160 ? shortName + '.zip' : original
    return { data, pack: { id: hash(data), name, size: data.length, enabled: true } }
  })
  const packs = getDefaultResourcePacks()
  fs.mkdirSync(root(), { recursive: true })
  for (const { data, pack } of incoming) {
    if (packs.some(p => p.id === pack.id)) continue
    const dest = path.join(root(), pack.id + '.zip'), existing = snapshot(dest)
    if (existing !== null && hash(existing) !== pack.id) throw new Error(`默认材质包缓存被修改，未覆盖：${pack.name}`)
    if (existing === null) fs.writeFileSync(dest, data, { flag: 'wx' })
    packs.push(pack)
  }
  return save(packs)
}
export function removeDefaultResourcePack(id: string): DefaultResourcePack[] {
  // Removal changes future defaults only; instance files and choices remain intact.
  return save(getDefaultResourcePacks().filter(p => p.id !== id))
}
export function setDefaultResourcePackEnabled(id: string, enabled: boolean): DefaultResourcePack[] {
  if (typeof enabled !== 'boolean') throw new Error('材质包启用状态无效')
  const packs = getDefaultResourcePacks(), pack = packs.find(p => p.id === id)
  if (!pack) throw new Error('材质包不存在，请刷新后重试')
  pack.enabled = enabled
  return save(packs)
}
export function moveDefaultResourcePack(id: string, direction: number): DefaultResourcePack[] {
  const packs = getDefaultResourcePacks(), i = packs.findIndex(p => p.id === id), j = i + (direction < 0 ? -1 : 1)
  if (i >= 0 && j >= 0 && j < packs.length) [packs[i], packs[j]] = [packs[j], packs[i]]
  return save(packs)
}

function readPackOptions(text: string): Partial<Record<PackOptionKey, string[]>> {
  const values: Partial<Record<PackOptionKey, string[]>> = {}
  for (const line of text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)) {
    const i = line.indexOf(':'), key = line.slice(0, i) as PackOptionKey
    if (!optionKeys.includes(key)) continue
    if (values[key] !== undefined) throw new Error(`options.txt 中的 ${key} 重复，未覆盖原配置`)
    let parsed: unknown
    try { parsed = JSON.parse(line.slice(i + 1)) } catch { throw new Error(`options.txt 中的 ${key} 格式无效，未覆盖原配置`) }
    if (!Array.isArray(parsed) || parsed.some(x => typeof x !== 'string')) throw new Error(`options.txt 中的 ${key} 格式无效，未覆盖原配置`)
    values[key] = parsed
  }
  return values
}
export function mergeResourcePackOptions(text: string, names: string[], previous: string[], incompatible: string[] = []): string {
  const existing = readPackOptions(text), seen = new Set<PackOptionKey>(), newline = text.includes('\r\n') ? '\r\n' : '\n'
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).filter((line, i, all) => i !== all.length - 1 || line !== '')
  const output = lines.map(line => {
    const key = line.slice(0, line.indexOf(':')) as PackOptionKey
    if (!optionKeys.includes(key)) return line
    seen.add(key)
    const selected = key === 'resourcePacks' ? names : incompatible
    const retained = existing[key]!.filter(x => !previous.includes(x) && !names.includes(x))
    return key + ':' + JSON.stringify([...retained, ...new Set(selected)])
  })
  for (const key of optionKeys) if (!seen.has(key)) output.push(key + ':' + JSON.stringify(key === 'resourcePacks' ? ['vanilla', ...new Set(names)] : [...new Set(incompatible)]))
  return bom + output.join(newline) + newline
}

function format(value: unknown, upper = false): PackFormat | null {
  const parts = Array.isArray(value) ? value : [value]
  return parts.length >= 1 && parts.length <= 2 && parts.every(n => Number.isSafeInteger(n) && n >= 0)
    ? [parts[0], parts[1] ?? (upper ? 0x7fffffff : 0)] : null
}
const compareFormat = (a: PackFormat, b: PackFormat) => a[0] - b[0] || a[1] - b[1]
/** Read the client's exact resource format, including minor versions. */
export function readClientResourceFormat(clientJar?: string): PackFormat | null {
  if (!clientJar) return null
  try {
    const version = JSON.parse(new AdmZip(clientJar).readAsText('version.json')).pack_version
    return format(version.resource_major === undefined ? version.resource : [version.resource_major, version.resource_minor ?? 0])
  } catch { return null }
}
export function resourcePackIncompatible(pack: any, target: PackFormat | null): boolean {
  if (!target) return false // Never invent an incompatibility override without client evidence.
  let min: PackFormat | null, max: PackFormat | null
  if (target[0] >= 65 && pack.min_format !== undefined && pack.max_format !== undefined) {
    min = format(pack.min_format); max = format(pack.max_format, true)
  } else {
    const supported = target[0] >= 18 ? pack.supported_formats : undefined
    const low = Array.isArray(supported) ? supported[0] : typeof supported === 'object' && supported ? supported.min_inclusive : supported
    const high = Array.isArray(supported) ? supported[1] : typeof supported === 'object' && supported ? supported.max_inclusive : supported
    min = format(low ?? pack.pack_format); max = format(high ?? pack.pack_format, true)
  }
  return !!min && !!max && (compareFormat(target, min) < 0 || compareFormat(target, max) > 0)
}

interface InstancePackState { version: 2; managed: string[] }
export interface ResourcePackSyncOptions {
  /** Capture before launch-time defaults can add the built-in high_contrast pack. */
  resourcePacksConfigured?: boolean
}
const isManagedName = (name: unknown): name is string => typeof name === 'string' && /^(?:file\/)?KAMUCL-default-[a-f0-9]{64}-[^/\\\x00-\x1f]+\.zip$/i.test(name)
function aliases(name: string): string[] {
  const bare = name.startsWith('file/') ? name.slice(5) : name
  return [bare, 'file/' + bare]
}
function readInstanceState(data: Buffer | null): { initialized: boolean; managed: string[] } {
  if (data === null) return { initialized: false, managed: [] }
  let raw: any
  try { raw = JSON.parse(data.toString('utf8').replace(/^\uFEFF/, '')) } catch { throw new Error('默认材质包实例记录损坏，未覆盖实例配置') }
  const managed = Array.isArray(raw) ? raw : raw?.version === 2 ? raw.managed : undefined
  if (!Array.isArray(managed) || managed.some(x => !isManagedName(x))) throw new Error('默认材质包实例记录格式无效，未覆盖实例配置')
  return { initialized: true, managed: [...new Set(managed.flatMap(aliases))] }
}
function plainDirectoryExists(dir: string): boolean {
  try {
    const stat = fs.lstatSync(dir)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('默认材质包目录不能是文件或符号链接')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
}
function ensurePlainDirectory(dir: string): void {
  if (!plainDirectoryExists(dir)) fs.mkdirSync(dir, { recursive: true })
}
function updateInstancePacks(gameDir: string, mcVersion: string, clientJar: string | undefined, manual: boolean, options: ResourcePackSyncOptions): number {
  if (!mcVersionAtLeast(mcVersion, '1.6')) {
    if (manual) throw new Error('此 Minecraft 版本不支持资源包')
    return 0
  }
  plainDirectoryExists(gameDir); plainDirectoryExists(path.join(gameDir, 'resourcepacks'))
  const stateFile = path.join(gameDir, '.kamucl-default-resourcepacks.json'), optionsFile = path.join(gameDir, 'options.txt')
  const stateBefore = snapshot(stateFile), optionsBefore = snapshot(optionsFile), state = readInstanceState(stateBefore)
  const before = optionsBefore?.toString('utf8') ?? '', selections = readPackOptions(before)
  const all = getDefaultResourcePacks(), packs = all.filter(p => p.enabled)
  const managed = [...new Set([...state.managed, ...all.flatMap(p => aliases(managedName(p)))])]
  const names = packs.map(p => (mcVersionAtLeast(mcVersion, '1.13') ? 'file/' : '') + managedName(p))
  // Explicit vanilla-only / empty selections are existing choices too. Legacy state
  // is migrated without reapplying anything, including previously disabled defaults.
  const initialize = !state.initialized && !(options.resourcePacksConfigured ?? selections.resourcePacks !== undefined)
  const apply = manual || initialize
  const data = packs.map(p => {
    const source = snapshot(path.join(root(), p.id + '.zip'))
    if (source === null || hash(source) !== p.id) throw new Error(`默认材质包缓存缺失或被修改，未覆盖：${p.name}`)
    const prepared = prepareResourcePackArchive(source, p.name)
    return { pack: p, source: prepared.data, payloadHash: hash(prepared.data), meta: prepared.metadata, dest: path.join(gameDir, 'resourcepacks', managedName(p)) }
  })
  // Check every destination before copying or updating either configuration file.
  for (const item of data) {
    const current = snapshot(item.dest)
    if (current !== null && hash(current) !== item.payloadHash) throw new Error(`默认材质包副本被修改，未覆盖：${item.pack.name}`)
  }
  const targetFormat = readClientResourceFormat(clientJar)
  const incompatible = names.filter((name, i) => targetFormat !== null ? resourcePackIncompatible(data[i].meta, targetFormat)
    : selections.incompatibleResourcePacks?.some(existing => aliases(name).includes(existing)))
  const after = apply && (names.length || managed.length) ? mergeResourcePackOptions(before, names, managed, incompatible) : before
  ensurePlainDirectory(gameDir)
  if (data.length) ensurePlainDirectory(path.join(gameDir, 'resourcepacks'))
  for (const item of data) {
    const current = snapshot(item.dest)
    if (current !== null) {
      if (hash(current) !== item.payloadHash) throw new Error(`默认材质包副本被修改，未覆盖：${item.pack.name}`)
      continue
    }
    // Publish the verified snapshot without replacing a file created after preflight.
    const staged = path.join(path.dirname(item.dest), `.kamucl-pack-${crypto.randomUUID()}.tmp`)
    try {
      fs.writeFileSync(staged, item.source, { flag: 'wx' })
      if (hash(fs.readFileSync(staged)) !== item.payloadHash) throw new Error(`默认材质包复制校验失败：${item.pack.name}`)
      try { fs.linkSync(staged, item.dest) }
      catch (error) {
        if (!['EPERM', 'ENOSYS', 'EOPNOTSUPP', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        fs.copyFileSync(staged, item.dest, fs.constants.COPYFILE_EXCL)
      }
    } finally { cleanTemp(staged) }
    if (hash(fs.readFileSync(item.dest)) !== item.payloadHash) throw new Error(`默认材质包复制校验失败：${item.pack.name}`)
  }
  unchanged(optionsFile, optionsBefore); unchanged(stateFile, stateBefore)
  const nextState: InstancePackState = { version: 2, managed }
  if (after !== before && optionsBefore !== null) {
    const backup = optionsFile + '.before-default-packs'
    commitFiles([{ file: backup, before: snapshot(backup), after: optionsBefore }])
  }
  const writes = [{ file: stateFile, before: stateBefore, after: Buffer.from(JSON.stringify(nextState, null, 2) + '\n') }]
  if (after !== before) writes.unshift({ file: optionsFile, before: optionsBefore, after: Buffer.from(after) })
  commitFiles(writes)
  return packs.length
}
/** Automatic launches copy available defaults, preserving the instance's subsequent selections and order. */
export function syncDefaultResourcePacks(gameDir: string, mcVersion: string, clientJar?: string, options: ResourcePackSyncOptions = {}): number {
  return updateInstancePacks(gameDir, mcVersion, clientJar, false, options)
}
/** Explicitly replace this directory's managed selections with the current global defaults. */
export function applyDefaultResourcePacks(gameDir: string, mcVersion: string, clientJar?: string): number {
  return updateInstancePacks(gameDir, mcVersion, clientJar, true, {})
}
