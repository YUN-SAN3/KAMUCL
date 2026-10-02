// SPDX-License-Identifier: LGPL-3.0-only
// Adapted from AUGUHDAR/VoxLink modsync, revision 721c7fae (LGPL-3.0).
// KAMUCL: instance-scoped I/O, actual installed-file hashes and non-overwriting commits.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { APP_VERSION } from './api'
import type { ModSyncEntry, ModSyncManifest, ModSyncRow } from '../../../shared/voxlinkMods'

export interface LocalMod { fileName: string; sha1: string; disabled: boolean }
interface MRVersion { project_id: string; version_number: string; loaders: string[]; game_versions: string[]; dependencies?: { project_id?: string; dependency_type: string }[]; files: { filename: string; url: string; size: number; hashes: { sha1: string; sha512: string } }[] }
interface MRProject { id: string; slug: string; title: string; client_side?: string; environment?: string }
export type MRRequest = (route: string, body?: unknown) => Promise<any>

export async function scanModHashes(dir: string, signal: AbortSignal, includeDisabled = false): Promise<LocalMod[]> {
  let entries: fs.Dirent[]
  try {
    const stat = await fs.promises.lstat(dir)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('模组目录不能是链接')
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  const result: LocalMod[] = []
  for (const file of entries) {
    signal.throwIfAborted()
    if (!file.isFile() || !(/\.jar$/i.test(file.name) || includeDisabled && /\.jar\.disabled$/i.test(file.name))) continue
    if (result.length >= 1024) throw new Error('模组数量超过同步上限（1024），请先整理实例')
    const hash = createHash('sha1'), full = path.join(dir, file.name)
    const before = await fs.promises.stat(full, { bigint: true })
    for await (const chunk of fs.createReadStream(full, { signal })) hash.update(chunk)
    const after = await fs.promises.lstat(full, { bigint: true })
    if (after.isSymbolicLink() || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error(`模组正在变化，请稍后重试：${file.name}`)
    result.push({ fileName: file.name, sha1: hash.digest('hex'), disabled: /\.disabled$/i.test(file.name) })
  }
  return result
}

export async function modrinthRequest(route: string, signal: AbortSignal, body?: unknown): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    let retry = attempt === 0 ? 1000 : 3000
    try {
      const response = await fetch(`https://api.modrinth.com/v2${route}`, {
        method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        headers: { 'User-Agent': `KAMUCL-App/${APP_VERSION}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
      if (response.ok) return await response.json()
      await response.body?.cancel()
      if (response.status === 429) {
        const value = response.headers.get('retry-after')
        retry = Math.max(1000, value && Number.isFinite(Number(value)) ? Number(value) * 1000 : Date.parse(value || '') - Date.now() || retry)
      } else if (response.status < 500) throw Object.assign(new Error(`Modrinth HTTP ${response.status}`), { permanent: true })
      if (attempt >= 2) throw Object.assign(new Error(`Modrinth HTTP ${response.status}`), { permanent: true })
    } catch (error) { signal.throwIfAborted(); if (attempt >= 2 || (error as any).permanent) throw error }
    await delay(retry, undefined, { signal })
  }
}

const serverOnly = (p?: MRProject) => p?.client_side === 'unsupported' || p?.environment === 'server_only'
export function safeModEntry(entry: ModSyncEntry): boolean {
  try {
    const url = new URL(entry.url)
    return !!entry.projectId && entry.fileName.length <= 180 && /\.jar$/i.test(entry.fileName) &&
      !/[\\/:*?"<>|\x00-\x1f]/.test(entry.fileName) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(entry.fileName) &&
      url.protocol === 'https:' && url.hostname === 'cdn.modrinth.com' && !url.username && !url.password && (!url.port || url.port === '443') &&
      /^[a-f0-9]{40}$/i.test(entry.sha1) && /^[a-f0-9]{128}$/i.test(entry.sha512) && Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= 512 * 1024 * 1024 &&
      Array.isArray(entry.loaders) && Array.isArray(entry.gameVersions)
  } catch { return false }
}
export async function buildModManifests(local: LocalMod[], loader: string, mcVersion: string, request: MRRequest, signal: AbortSignal): Promise<Record<'required' | 'all', ModSyncManifest>> {
  const versions = new Map<string, MRVersion>(), projects = new Map<string, MRProject>(), unknown = new Set<string>()
  for (let i = 0; i < local.length; i += 64) {
    signal.throwIfAborted()
    const block = local.slice(i, i + 64)
    try {
      const data = await request('/version_files', { hashes: block.map(f => f.sha1), algorithm: 'sha1' })
      for (const mod of block) { const v = data?.[mod.sha1]; if (v?.project_id && Array.isArray(v.files)) versions.set(mod.sha1, v); else unknown.add(mod.fileName) }
    } catch { signal.throwIfAborted(); block.forEach(f => unknown.add(f.fileName)) }
  }
  const ids = [...new Set([...versions.values()].flatMap(v => [v.project_id, ...(v.dependencies || []).filter(d => d.dependency_type === 'required').map(d => d.project_id).filter((id): id is string => !!id)]))]
  for (let i = 0; i < ids.length; i += 64) {
    signal.throwIfAborted()
    try { const data = await request(`/projects?ids=${encodeURIComponent(JSON.stringify(ids.slice(i, i + 64)))}`); if (Array.isArray(data)) for (const p of data) projects.set(p.id, p) } catch { signal.throwIfAborted() }
  }
  const entries = new Map<string, ModSyncEntry>(), byProject = new Map<string, MRVersion>()
  for (const mod of local) {
    const v = versions.get(mod.sha1); if (!v) continue
    const p = projects.get(v.project_id)
    if (serverOnly(p)) continue
    const file = v.files.find(f => f.hashes?.sha1?.toLowerCase() === mod.sha1)
    if (!p || !file) { unknown.add(mod.fileName); continue }
    const entry: ModSyncEntry = { projectId: v.project_id, slug: p.slug, title: p.title, versionNumber: v.version_number, fileName: file.filename, url: file.url, sha1: mod.sha1, sha512: file.hashes.sha512, size: file.size, loaders: v.loaders, gameVersions: v.game_versions }
    if (!safeModEntry(entry)) { unknown.add(mod.fileName); continue }
    entries.set(v.project_id, entry); byProject.set(v.project_id, v)
  }
  const required = new Set<string>(), queue = [...entries.keys()].filter(id => !['optional', 'unsupported'].includes(projects.get(id)?.client_side || ''))
  while (queue.length) {
    const id = queue.shift()!
    if (required.has(id) || serverOnly(projects.get(id))) continue
    required.add(id)
    for (const dep of byProject.get(id)?.dependencies || []) if (dep.dependency_type === 'required' && dep.project_id && !required.has(dep.project_id)) queue.push(dep.project_id)
  }
  const manifest = (all: boolean): ModSyncManifest => {
    const result: ModSyncManifest = { protocolVersion: 'modSync.v1', loader, mcVersion, mods: [], unknownMods: [...unknown].slice(0, 64) }
    for (const [id, entry] of entries) {
      if (!all && !required.has(id)) continue
      result.mods.push(entry)
      if (result.mods.length > 256 || Buffer.byteLength(JSON.stringify(result)) > 128 * 1024) { result.mods.pop(); if (result.unknownMods.length < 64) result.unknownMods.push(entry.fileName) }
    }
    return result
  }
  return { required: manifest(false), all: manifest(true) }
}
export function normalizeModName(name: string): string {
  return name.toLowerCase().replace(/\.disabled$/, '').replace(/\.jar$/, '').split(/[^a-z]+/).filter(w => w && !['fabric', 'forge', 'neoforge', 'quilt', 'fml', 'mc', 'all', 'for', 'the', 'with'].includes(w)).join('-')
}
export function diffMods(manifest: ModSyncManifest, local: LocalMod[], loader: string, mcVersion: string): ModSyncRow[] {
  return manifest.mods.map(entry => {
    const matches = local.filter(f => f.sha1.toLowerCase() === entry.sha1.toLowerCase())
    if (matches.some(f => !f.disabled)) return { entry, status: 'installed', reason: '已安装' }
    if (matches.length) return { entry, status: 'disabled', reason: '已安装但被禁用，请手动启用' }
    if (local.some(f => f.fileName.replace(/\.disabled$/i, '').toLowerCase() === entry.fileName.toLowerCase() || normalizeModName(f.fileName) === normalizeModName(entry.fileName))) return { entry, status: 'conflict', reason: '已存在其他版本，请手动处理；不会覆盖或移动原文件' }
    if (!safeModEntry(entry) || !entry.loaders.includes(loader) || !entry.gameVersions.includes(mcVersion) || manifest.loader !== loader || manifest.mcVersion !== mcVersion) return { entry, status: 'unresolved', reason: '与所选实例不兼容，或缺少可靠下载校验信息' }
    return { entry, status: 'missing', reason: '可下载' }
  })
}
