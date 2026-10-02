import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import type { ManualModpackFile, ManualModpackRequest } from '../../shared/types'
import { modpackCachedFile } from './modpackDownloads'
import { waitIfTaskPaused } from './tasks'

interface Session { files: ManualModpackFile[]; cacheRoot: string; notify: (request: ManualModpackRequest | null) => void; signal?: AbortSignal; resolve: () => void; busy: boolean }
const sessions = new Map<string, Session>()

async function matches(filePath: string, expected: ManualModpackFile, signal?: AbortSignal): Promise<boolean> {
  const stat = await fs.promises.lstat(filePath).catch(() => null)
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size !== expected.size) return false
  const hash = crypto.createHash('sha1')
  for await (const chunk of fs.createReadStream(filePath, { signal })) hash.update(chunk)
  return hash.digest('hex') === expected.sha1.toLowerCase()
}

export async function waitForModpackFiles(files: ManualModpackFile[], notify: Session['notify'], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const pending: ManualModpackFile[] = []
  for (const file of files) if (!await matches(modpackCachedFile(file), file, signal)) pending.push(file)
  if (!pending.length) return
  signal?.throwIfAborted()
  // File-picker IPC runs outside the install's folder context. Freeze the cache
  // destination so changing the default folder cannot redirect this job's files.
  const cacheRoot = path.dirname(modpackCachedFile(pending[0]))
  const token = crypto.randomUUID()
  let cleanup = () => {}
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal?.reason ?? new DOMException('已取消', 'AbortError'))
      cleanup = () => signal?.removeEventListener('abort', abort)
      sessions.set(token, { files: pending, cacheRoot, notify, signal, busy: false, resolve: () => { signal?.removeEventListener('abort', abort); resolve() } })
      signal?.addEventListener('abort', abort, { once: true })
      notify({ token, files: pending.slice() })
    })
  } finally { cleanup(); sessions.delete(token); notify(null) }
}

export function pendingModpackFiles(token: string): ManualModpackFile[] {
  const session = sessions.get(token)
  if (!session) throw new Error('该补充文件任务已结束，请查看下载中心')
  return session.files.slice()
}

/** Called only with paths selected in the main-process file dialog. Copy and verify before publishing cache bytes. */
export async function supplyModpackFiles(token: string, selected: string[]): Promise<{ accepted: number; remaining: number; rejected: string[] }> {
  const session = sessions.get(token)
  if (!session) throw new Error('该补充文件任务已结束')
  if (session.busy) throw new Error('正在校验上一批文件')
  session.busy = true
  const rejected: string[] = []; let accepted = 0
  try {
    for (const source of selected) {
      await waitIfTaskPaused(session.signal); session.signal?.throwIfAborted()
      const stat = await fs.promises.lstat(source).catch(() => null)
      const candidates = stat?.isFile() && !stat.isSymbolicLink() ? session.files.filter(f => f.size === stat.size) : []
      if (!candidates.length) { rejected.push(path.basename(source)); continue }
      const dest = modpackCachedFile(candidates[0], session.cacheRoot), temp = dest + '.' + crypto.randomUUID() + '.manual'
      await fs.promises.mkdir(path.dirname(dest), { recursive: true })
      try {
        await pipeline(fs.createReadStream(source), fs.createWriteStream(temp, { flags: 'wx' }), { signal: session.signal })
        let file: ManualModpackFile | undefined
        for (const candidate of candidates) if (await matches(temp, candidate, session.signal)) { file = candidate; break }
        if (!file) { rejected.push(path.basename(source)); continue }
        session.signal?.throwIfAborted()
        const final = modpackCachedFile(file, session.cacheRoot)
        if (!await matches(final, file, session.signal)) await fs.promises.rename(temp, final)
        session.files = session.files.filter(f => f.fileID !== file!.fileID || f.projectID !== file!.projectID)
        accepted++
      } finally { await fs.promises.rm(temp, { force: true }) }
    }
    if (!session.files.length) session.resolve()
    else session.notify({ token, files: session.files.slice() })
    return { accepted, remaining: session.files.length, rejected }
  } finally { session.busy = false }
}
