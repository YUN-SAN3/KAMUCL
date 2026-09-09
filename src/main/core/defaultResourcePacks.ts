import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { app } from 'electron'
import type { DefaultResourcePack } from '../../shared/types'
import { mcVersionAtLeast } from '../../shared/keybindings'

const root = () => path.join(app.getPath('userData'), 'default-resourcepacks')
const manifest = () => path.join(root(), 'packs.json')
const managedName = (p: DefaultResourcePack) => `KAMUCL-default-${p.id}-${p.name}`
function save(packs: DefaultResourcePack[]): DefaultResourcePack[] {
  fs.mkdirSync(root(), { recursive: true })
  fs.writeFileSync(manifest() + '.tmp', JSON.stringify(packs, null, 2))
  fs.renameSync(manifest() + '.tmp', manifest())
  return packs
}
export function getDefaultResourcePacks(): DefaultResourcePack[] {
  try {
    const packs = JSON.parse(fs.readFileSync(manifest(), 'utf8'))
    return Array.isArray(packs) ? packs.filter(p => /^[a-f0-9]{64}$/.test(p?.id) && typeof p.name === 'string' && path.basename(p.name) === p.name && fs.existsSync(path.join(root(), p.id + '.zip'))) : []
  } catch { return [] }
}
export function importDefaultResourcePacks(files: string[]): DefaultResourcePack[] {
  if (!Array.isArray(files) || !files.length) return getDefaultResourcePacks()
  // 先验证整个批次，任一错误都不改变当前配置。
  const incoming = files.map(file => {
    if (typeof file !== 'string' || path.extname(file).toLowerCase() !== '.zip' || !fs.statSync(file).isFile()) throw new Error('请选择 ZIP 格式材质包')
    const data = fs.readFileSync(file), zip = new AdmZip(data), entry = zip.getEntry('pack.mcmeta')
    if (!entry || entry.header.size > 1024 * 1024) throw new Error(`${path.basename(file)} 缺少有效的 pack.mcmeta`)
    let meta: any
    try { meta = JSON.parse(entry.getData().toString('utf8').replace(/^\uFEFF/, '')) } catch { throw new Error(`${path.basename(file)} 的 pack.mcmeta 无法读取`) }
    if (!meta?.pack || typeof meta.pack !== 'object') throw new Error(`${path.basename(file)} 不是有效材质包`)
    return { data, pack: { id: crypto.createHash('sha256').update(data).digest('hex'), name: path.basename(file).replace(/[<>:"/\\|?*]/g, '_'), size: data.length } }
  })
  const packs = getDefaultResourcePacks()
  fs.mkdirSync(root(), { recursive: true })
  for (const { data, pack } of incoming) {
    if (packs.some(p => p.id === pack.id)) continue
    fs.writeFileSync(path.join(root(), pack.id + '.zip'), data)
    packs.push(pack)
  }
  return save(packs)
}
export function removeDefaultResourcePack(id: string): DefaultResourcePack[] {
  // 仅从默认配置移除；已复制到实例和原始文件均保留。
  return save(getDefaultResourcePacks().filter(p => p.id !== id))
}
export function moveDefaultResourcePack(id: string, direction: number): DefaultResourcePack[] {
  const packs = getDefaultResourcePacks(), i = packs.findIndex(p => p.id === id), j = i + (direction < 0 ? -1 : 1)
  if (i >= 0 && j >= 0 && j < packs.length) [packs[i], packs[j]] = [packs[j], packs[i]]
  return save(packs)
}

export function mergeResourcePackOptions(text: string, names: string[], previous: string[]): string {
  const keys = ['resourcePacks', 'incompatibleResourcePacks'], seen = new Set<string>()
  const lines = text.split(/\r?\n/).filter(Boolean).map(line => {
    const i = line.indexOf(':'), key = line.slice(0, i)
    if (!keys.includes(key)) return line
    seen.add(key)
    let existing: unknown
    try { existing = JSON.parse(line.slice(i + 1)) } catch { throw new Error(`options.txt 中的 ${key} 格式无效，未覆盖原配置`) }
    if (!Array.isArray(existing) || existing.some(x => typeof x !== 'string')) throw new Error(`options.txt 中的 ${key} 格式无效`)
    return key + ':' + JSON.stringify([...new Set([...existing.filter(x => !previous.includes(x) && !names.includes(x)), ...names])])
  })
  for (const key of keys) if (!seen.has(key)) lines.push(key + ':' + JSON.stringify(key === 'resourcePacks' ? ['vanilla', ...names] : names))
  return lines.join('\n') + '\n'
}

export function syncDefaultResourcePacks(gameDir: string, mcVersion: string): number {
  if (!mcVersionAtLeast(mcVersion, '1.6')) return 0
  const packs = getDefaultResourcePacks(), stateFile = path.join(gameDir, '.kamucl-default-resourcepacks.json')
  let previous: string[] = []
  try { const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8')); if (Array.isArray(raw)) previous = raw.filter(x => typeof x === 'string') } catch { /* 首次同步 */ }
  if (!packs.length && !previous.length) return 0
  const names = packs.map(p => (mcVersionAtLeast(mcVersion, '1.13') ? 'file/' : '') + managedName(p))
  const options = path.join(gameDir, 'options.txt'), before = fs.existsSync(options) ? fs.readFileSync(options, 'utf8') : ''
  const after = mergeResourcePackOptions(before, names, previous)
  const target = path.join(gameDir, 'resourcepacks'); fs.mkdirSync(target, { recursive: true })
  for (const p of packs) {
    const dest = path.join(target, managedName(p)), source = path.join(root(), p.id + '.zip')
    if (fs.existsSync(dest)) {
      if (crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex') !== p.id) throw new Error(`默认材质包副本被修改，未覆盖：${p.name}`)
    } else fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL)
  }
  if (after !== before) { if (before) fs.writeFileSync(options + '.before-default-packs', before); fs.writeFileSync(options, after) }
  fs.writeFileSync(stateFile, JSON.stringify(names))
  return packs.length
}
