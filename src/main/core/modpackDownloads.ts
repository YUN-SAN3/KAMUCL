import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { downloadAll, type AllProgressFn, type DownloadTask, type MirrorPref } from './download'
import { downloadLimiter } from './downloadLimits'
import { defaultFolderPath } from './paths'
import { throwIfCancelled, waitIfTaskPaused } from './tasks'

/** Keep verified immutable downloads outside the instance transaction, so rollback/reimport can reuse them. */
export async function prepareModpackFiles(
  tasks: DownloadTask[], progress: AllProgressFn, mirror: MirrorPref, signal?: AbortSignal,
  cacheRoot = path.join(defaultFolderPath(), '.kamucl', 'modpack-cache')
): Promise<{ install: (signal?: AbortSignal) => Promise<void>; dispose: () => Promise<void> }> {
  let temporary = ''
  await fs.promises.mkdir(cacheRoot, { recursive: true })
  // Unidentified files belong to this job only; never publish them into the instance before runtime preparation.
  if (tasks.some(task => !validHash(task))) temporary = await fs.promises.mkdtemp(path.join(cacheRoot, 'pending-'))
  const dispose = async (): Promise<void> => { if (temporary) await fs.promises.rm(temporary, { recursive: true, force: true }) }
  const cached = tasks.map((task, index) => {
    const hash = validHash(task)
    const suffix = ['.jar', '.zip', '.mrpack'].includes(path.extname(task.dest).toLowerCase()) ? path.extname(task.dest).toLowerCase() : '.bin'
    const dest = hash ? path.join(cacheRoot, crypto.createHash('sha256').update(hash).digest('hex') + suffix) : path.join(temporary, `${index}${suffix}`)
    return { ...task, label: task.label || path.basename(task.dest), dest, installDest: task.dest }
  }).sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
  try {
    await downloadAll(cached, progress, downloadLimiter.maxConcurrent, mirror, signal)
    return { dispose, install: async (installSignal = signal) => {
      for (const task of cached) {
        await waitIfTaskPaused(installSignal); throwIfCancelled(installSignal)
        await fs.promises.mkdir(path.dirname(task.installDest), { recursive: true })
        // Copy, never hard-link: edits made by mods must not mutate the shared cache.
        await fs.promises.copyFile(task.dest, task.installDest)
      }
    } }
  } catch (error) {
    await dispose()
    throw error
  }
}

function validHash(task: DownloadTask): string {
  return task.sha512 && /^[a-f\d]{128}$/i.test(task.sha512) ? 'sha512:' + task.sha512.toLowerCase()
    : task.sha1 && /^[a-f\d]{40}$/i.test(task.sha1) ? 'sha1:' + task.sha1.toLowerCase() : ''
}

export function modpackCachedFile(file: { sha1: string; fileName: string }, cacheRoot = path.join(defaultFolderPath(), '.kamucl', 'modpack-cache')): string {
  const hash = validHash({ sha1: file.sha1, url: '', dest: '' })
  if (!hash) throw new Error('整合包文件 SHA1 无效')
  const ext = path.extname(file.fileName).toLowerCase()
  const suffix = ['.jar', '.zip', '.mrpack'].includes(ext) ? ext : '.bin'
  return path.join(cacheRoot, crypto.createHash('sha256').update(hash).digest('hex') + suffix)
}

export async function downloadModpackFiles(
  ...args: Parameters<typeof prepareModpackFiles>
): Promise<void> {
  const prepared = await prepareModpackFiles(...args)
  try { await prepared.install(args[3]) } finally { await prepared.dispose() }
}
