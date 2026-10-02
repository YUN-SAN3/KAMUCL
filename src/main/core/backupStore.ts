import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { waitIfTaskPaused } from './tasks'
import yazl from 'yazl'
import type { BackupManifest, BackupEntry } from '../../shared/instanceCenter'

export type BackupProgress = (done: number, total: number, text: string) => void
export function safeRelative(value: string): string {
  if (!value || value.includes('\\') || value.includes('\0') || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..' || /[:*?"<>|]/.test(p))) throw new Error('无效的相对路径：' + value)
  return value
}
export async function safePath(root: string, rel: string, missing = false): Promise<string> {
  safeRelative(rel)
  const base = path.resolve(root)
  const rootStat = await fs.promises.lstat(base)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('目录不是普通目录')
  let current = base
  for (const part of rel.split('/')) {
    current = path.join(current, part)
    try { if ((await fs.promises.lstat(current)).isSymbolicLink()) throw new Error('不跟随符号链接：' + rel) }
    catch (e) { if (missing && (e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e }
  }
  return current
}
export async function hashFile(file: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  const hash = crypto.createHash('sha256')
  const stream = fs.createReadStream(file, { signal })
  for await (const data of stream) { await waitIfTaskPaused(signal); hash.update(data) }
  return hash.digest('hex')
}
export async function scanFiles(root: string, roots: string[], signal?: AbortSignal): Promise<Array<{ path: string; size: number; mtime: number }>> {
  const result: Array<{ path: string; size: number; mtime: number }> = []
  const seen = new Set<string>()
  async function visit(rel: string) {
    await waitIfTaskPaused(signal)
    signal?.throwIfAborted()
    if (seen.has(rel)) return
    seen.add(rel)
    const file = await safePath(root, rel, true)
    let stat: fs.Stats
    try { stat = await fs.promises.lstat(file) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e }
    if (stat.isDirectory()) { for (const name of await fs.promises.readdir(file)) await visit(rel + '/' + name) }
    else if (stat.isFile()) result.push({ path: rel, size: stat.size, mtime: stat.mtimeMs })
    else throw new Error('不支持的特殊文件：' + rel)
  }
  for (const rel of roots) await visit(safeRelative(rel))
  return result.sort((a,b) => a.path.localeCompare(b.path))
}
export async function copyVerified(source: string, destination: string, signal?: AbortSignal): Promise<BackupEntry> {
  const before = await fs.promises.lstat(source)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('源文件不是普通文件')
  await fs.promises.mkdir(path.dirname(destination), { recursive: true })
  const gate=new Transform({transform(chunk,_encoding,callback){waitIfTaskPaused(signal).then(()=>callback(null,chunk),callback)}})
  await pipeline(fs.createReadStream(source), gate, fs.createWriteStream(destination, { flags: 'wx' }), { signal })
  const sha256 = await hashFile(destination, signal)
  const after = await fs.promises.lstat(source)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || sha256 !== await hashFile(source, signal)) throw new Error('复制期间源文件发生变化：' + path.basename(source))
  return { path: '', size: after.size, sha256 }
}
export class BackupStore {
  constructor(readonly directory: string) {}
  async list(): Promise<BackupManifest[]> {
    const result: BackupManifest[] = []
    for (const id of await fs.promises.readdir(this.directory).catch(() => [] as string[])) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue
      try { result.push(await this.read(id)) } catch { /* Incomplete records never appear as usable backups. */ }
    }
    return result.sort((a,b) => b.createdAt.localeCompare(a.createdAt))
  }
  async read(id: string): Promise<BackupManifest> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效的备份编号')
    const file = await safePath(this.directory, id + '/manifest.json')
    const m = JSON.parse(await fs.promises.readFile(file,'utf8')) as BackupManifest
    if (m.format !== 1 || m.id !== id || !Array.isArray(m.files) || !Array.isArray(m.roots)) throw new Error('不支持的备份格式')
    m.roots.forEach(safeRelative)
    const names = new Set<string>()
    for (const f of m.files) {
      safeRelative(f.path)
      const key = process.platform === 'win32' ? f.path.toLowerCase() : f.path
      if (names.has(key) || !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0 || !m.roots.some(r => f.path === r || f.path.startsWith(r+'/'))) throw new Error('备份清单损坏')
      names.add(key)
    }
    return m
  }
  async create(source: string, roots: string[], title: string, automatic = false, metadata?: Record<string,unknown>, signal?: AbortSignal, progress?: BackupProgress): Promise<BackupManifest> {
    await fs.promises.mkdir(this.directory,{recursive:true})
    const id = crypto.randomUUID(), stage = path.join(this.directory,'.pending-'+id), destination = path.join(this.directory,id)
    await fs.promises.mkdir(path.join(stage,'files'),{recursive:true})
    try {
      const inputs = await scanFiles(source,roots,signal), files: BackupEntry[] = []
      const total = inputs.reduce((sum,f)=>sum+f.size,0); let done = 0
      const space = await fs.promises.statfs(this.directory)
      if (space.bavail * space.bsize < total + 1024*1024*16) throw new Error('备份位置磁盘空间不足')
      for (const f of inputs) {
        signal?.throwIfAborted()
        const entry = await copyVerified(await safePath(source,f.path),path.join(stage,'files',f.path),signal)
        files.push({...entry,path:f.path}); done += entry.size
        progress?.(done,total,`备份文件 ${files.length}/${inputs.length}`)
      }
      if (JSON.stringify(inputs) !== JSON.stringify(await scanFiles(source,roots,signal))) throw new Error('备份期间目录内容发生变化，请退出游戏后重试')
      const manifest: BackupManifest = {format:1,id,createdAt:new Date().toISOString(),title,automatic,source:path.resolve(source),roots,files,metadata}
      await fs.promises.writeFile(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2))
      signal?.throwIfAborted()
      await fs.promises.rename(stage,destination)
      if (automatic) {
        const old = (await this.list()).filter(m=>m.automatic).slice(5)
        for (const m of old) await fs.promises.rm(await safePath(this.directory,m.id),{recursive:true,force:true})
      }
      return manifest
    } finally { await fs.promises.rm(stage,{recursive:true,force:true}) }
  }
  async verify(id: string, signal?: AbortSignal): Promise<BackupManifest> {
    const m = await this.read(id)
    for (const f of m.files) {
      const file = await safePath(this.directory, id+'/files/'+f.path)
      if ((await fs.promises.stat(file)).size !== f.size || await hashFile(file,signal) !== f.sha256) throw new Error('备份文件校验失败：'+f.path)
    }
    return m
  }
  /** Writes only into a caller-owned, empty staging tree. Commit is the caller's transaction. */
  async materialize(id: string, stage: string, signal?: AbortSignal, progress?: BackupProgress) {
    const m = await this.verify(id,signal); let done=0
    for (const f of m.files) {
      const output = await safePath(stage,f.path,true)
      const copy = await copyVerified(await safePath(this.directory,id+'/files/'+f.path),output,signal)
      if (copy.sha256 !== f.sha256) throw new Error('恢复校验失败：'+f.path)
      progress?.(++done,m.files.length,`恢复文件 ${done}/${m.files.length}`)
    }
    return m
  }
}
export async function exportTreeZip(root: string, destination: string, signal?: AbortSignal): Promise<void> {
  const files=await scanFiles(root,await fs.promises.readdir(root),signal)
  const zip=new yazl.ZipFile(), temporary=destination+'.'+crypto.randomUUID()+'.tmp'
  try {
    const gate=new Transform({transform(chunk,_encoding,callback){waitIfTaskPaused(signal).then(()=>callback(null,chunk),callback)}})
    const output=pipeline(zip.outputStream,gate,fs.createWriteStream(temporary,{flags:'wx'}),{signal})
    void output.catch(()=>{})
    for(const f of files) zip.addFile(await safePath(root,f.path),f.path)
    zip.end()
    await output
    signal?.throwIfAborted()
    if(JSON.stringify(files)!==JSON.stringify(await scanFiles(root,await fs.promises.readdir(root),signal)))throw new Error('导出期间存档发生变化，请退出游戏后重试')
    // Exclusive publication: an existing export is never silently replaced.
    await fs.promises.copyFile(temporary,destination,fs.constants.COPYFILE_EXCL)
  } finally { await fs.promises.rm(temporary,{force:true}) }
}
