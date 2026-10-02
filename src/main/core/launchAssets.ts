import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

interface AssetObject { hash: string; size?: number }
interface AssetIndex { objects: Record<string, AssetObject>; virtual?: boolean; map_to_resources?: boolean }
export interface AssetTransfer { url: string; dest: string; sha1?: string; size?: number }
interface AssetVersion { assets?: string; assetIndex?: { id: string; url?: string; sha1?: string; size?: number } }

function validFile(file: string, object: AssetObject, verifyHash = false): boolean {
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile() || (object.size !== undefined && stat.size !== object.size)) return false
    return !verifyHash || crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex') === object.hash
  } catch { return false }
}

function readIndex(file: string, sha1?: string): AssetIndex | null {
  try {
    const bytes = fs.readFileSync(file)
    if (sha1 && crypto.createHash('sha1').update(bytes).digest('hex') !== sha1) return null
    const index = JSON.parse(bytes.toString('utf8')) as AssetIndex
    if (!index.objects || typeof index.objects !== 'object' || Array.isArray(index.objects)) return null
    for (const [name, object] of Object.entries(index.objects)) {
      // Names are later materialized for old clients; do not allow an index to escape its root.
      if (!name || /[\\:]/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..')) return null
      if (!object || !/^[a-f0-9]{40}$/i.test(object.hash) ||
        (object.size !== undefined && (!Number.isSafeInteger(object.size) || object.size < 0))) return null
    }
    return index
  } catch { return null }
}

const objectFile = (root: string, hash: string) => path.join(root, 'objects', hash.slice(0, 2), hash)

/** Reuse the instance's repository assets before consulting the launcher's shared cache.
 * Transfers are supplied by the launch pipeline so tests can exercise real files without network.
 */
export async function prepareLaunchAssets(
  version: AssetVersion,
  roots: string[],
  fallbackRoot: string,
  gameDirectory: string,
  transfer: (tasks: AssetTransfer[]) => Promise<void>
): Promise<{ root: string; indexId: string; gameAssets: string }> {
  const indexId = version.assetIndex?.id ?? version.assets ?? 'legacy'
  if (!/^[a-zA-Z0-9_.-]+$/.test(indexId) || indexId === '.' || indexId === '..') throw new Error('游戏资源索引名称无效')
  const candidates = [...new Set([...roots, fallbackRoot].map(p => path.resolve(p)))]
  let root = path.resolve(fallbackRoot)
  let index: AssetIndex | null = null
  for (const candidate of candidates) {
    const found = readIndex(path.join(candidate, 'indexes', `${indexId}.json`), version.assetIndex?.sha1)
    if (found) { root = candidate; index = found; break }
  }
  if (!index) {
    const ref = version.assetIndex
    if (!ref?.url) throw new Error(`缺少游戏资源索引 ${indexId}，无法加载语言与声音；请修复该游戏版本的资源文件`)
    const dest = path.join(root, 'indexes', `${indexId}.json`)
    await transfer([{ url: ref.url, dest, sha1: ref.sha1, size: ref.size }])
    index = readIndex(dest, ref.sha1)
    if (!index) throw new Error(`游戏资源索引 ${indexId} 损坏，无法继续启动`)
  }

  const tasks = new Map<string, AssetTransfer>()
  let checked = 0
  for (const [name, object] of Object.entries(index.objects)) {
    const dest = objectFile(root, object.hash)
    const language = /(?:^|\/)lang\//.test(name) || name.endsWith('pack.mcmeta')
    if (!validFile(dest, object, language)) {
      // Hash-addressed assets can be safely reused across registered game folders.
      const existing = candidates.filter(p => p !== root).map(p => objectFile(p, object.hash))
        .find(file => validFile(file, object, true))
      if (existing) {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(existing, dest)
      } else {
        tasks.set(object.hash, { url: `https://resources.download.minecraft.net/${object.hash.slice(0, 2)}/${object.hash}`, dest, sha1: object.hash, size: object.size })
      }
    }
    if (++checked % 128 === 0) await new Promise<void>(resolve => setImmediate(resolve))
  }
  if (tasks.size) {
    await transfer([...tasks.values()])
    for (const task of tasks.values()) {
      if (!validFile(task.dest, { hash: task.sha1!, size: task.size }, true)) throw new Error('游戏资源补全失败，请检查网络后重试')
    }
  }

  const gameAssets = index.map_to_resources ? path.join(gameDirectory, 'resources')
    : index.virtual ? path.join(root, 'virtual', indexId) : root
  if (index.virtual || index.map_to_resources) {
    for (const [name, object] of Object.entries(index.objects)) {
      const dest = path.join(gameAssets, ...name.split('/'))
      if (!validFile(dest, object)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(objectFile(root, object.hash), dest)
      }
      if (++checked % 128 === 0) await new Promise<void>(resolve => setImmediate(resolve))
    }
  }
  return { root, indexId, gameAssets }
}
