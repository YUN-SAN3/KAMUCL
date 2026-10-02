import fs from 'node:fs/promises'
import path from 'node:path'
import type { ImportProbeResult } from '../../shared/types'
import { probeModpack, probeRecognizedModpack } from './modpacks'
import { probeWorld } from './worlds'

/** A bundled save is subordinate to a recognized pack at every general import entry point. */
export async function probeImport(inputPath: string): Promise<ImportProbeResult> {
  if (!inputPath) throw new Error('请选择要导入的文件或文件夹')
  const stat = await fs.lstat(inputPath)
  if (stat.isSymbolicLink()) throw new Error('不允许从符号链接导入')
  if (!stat.isDirectory() && !stat.isFile()) throw new Error('不支持该文件类型')
  const ext = path.extname(inputPath).toLowerCase()
  if (stat.isFile() && ext === '.jar') return { kind: 'mod' }
  if (stat.isFile() && (ext === '.zip' || ext === '.mrpack')) {
    const info = ext === '.mrpack' ? await probeModpack(inputPath) : await probeRecognizedModpack(inputPath)
    if (info) return { kind: 'modpack', info }
  }
  const world = await probeWorld(inputPath)
  if (world) return { kind: 'world', info: world }
  if (stat.isDirectory()) return { kind: 'mod' }
  return { kind: 'unsupported', message: '无法识别导入内容：支持整合包、存档 ZIP／文件夹和模组 JAR' }
}
