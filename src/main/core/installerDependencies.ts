import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { downloadAll, type DownloadTask, type MirrorPref } from './download'
import { downloadLimiter } from './downloadLimits'
import type { ProgressEvent } from '../../shared/types'

/** Read declared remote artifacts only. Empty URLs belong to embedded/generated files. */
export function installerDependencyTasks(jar: string, target: string): DownloadTask[] {
  const zip = new AdmZip(jar), tasks = new Map<string, DownloadTask>()
  const root = path.resolve(target, 'libraries')
  for (const name of ['install_profile.json', 'version.json']) {
    const entry = zip.getEntry(name)
    if (!entry) continue // Old installers continue through their native installer path.
    if (entry.header.size > 8 * 1024 * 1024) throw new Error('安装器元数据过大')
    const profile = JSON.parse(entry.getData().toString('utf8'))
    for (const lib of profile.libraries ?? []) {
      const artifact = lib.downloads?.artifact
      if (!artifact?.url || !artifact.path) continue
      const dest = path.resolve(root, artifact.path), relative = path.relative(root, dest)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || artifact.path.includes('\\') || artifact.path.includes(':')) throw new Error('安装器依赖路径越界')
      const url = new URL(artifact.url)
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('安装器依赖地址无效')
      // Every existing ancestor is checked: never write through a user-created junction.
      for (let dir = path.dirname(dest); dir.length >= root.length; dir = path.dirname(dir)) {
        if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('安装器依赖目录不能是链接')
        if (dir === root) break
      }
      const task = { url: artifact.url, dest, sha1: artifact.sha1, size: artifact.size }
      const previous = tasks.get(dest)
      if (previous && (previous.sha1 !== task.sha1 || previous.size !== task.size)) throw new Error('安装器包含冲突的依赖声明')
      tasks.set(dest, task)
    }
  }
  return [...tasks.values()]
}

export async function prepareInstallerDependencies(jar: string, target: string, mirror: MirrorPref, emit: (event: ProgressEvent) => void, signal?: AbortSignal): Promise<void> {
  const tasks = installerDependencyTasks(jar, target)
  if (!tasks.length) return
  await downloadAll(tasks, (done, total, speed, detail) => emit({ stage: 'loader-dependencies', progress: detail.fraction ?? 0,
    text: `下载加载器依赖 ${done}/${total}`, speed, bytesDone: detail.bytesDone, bytesTotal: detail.bytesTotal ?? undefined,
    etaSeconds: detail.etaSeconds ?? undefined, indeterminate: detail.indeterminate }), downloadLimiter.maxConcurrent, mirror, signal)
}
