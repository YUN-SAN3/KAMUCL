import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import type {
  LoaderName,
  ProgressEvent,
  WorldCandidateInfo,
  WorldImportInfo,
  WorldImportOptions,
  WorldImportResult,
  WorldResourcePackInfo
} from '../../shared/types'
import { parseNbt, type NbtCompound } from './nbt'
import { canonicalPath, samePath } from './folderPaths'
import { listGameFolders } from './gameFolders'
import { instanceDirectoryState, setNewInstanceIsolation } from './instances'
import { installVersion, scanInstalledFolder, type VersionJson } from './versions'
import { throwIfCancelled } from './tasks'
import { withGameFolder } from './paths'

const MAX_LEVEL_DAT = 32 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 250_000
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024 * 1024
const MAX_COMPRESSION_RATIO = 500
const MAX_FOLDER_DEPTH = 10
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

interface SafeZipEntry {
  rawName: string
  name: string
  directory: boolean
  compressedSize: number
  uncompressedSize: number
  symlink: boolean
}

interface FolderCandidate {
  id: string
  root: string
}

type ProgressEmit = (event: ProgressEvent) => void

const textError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function asCompound(value: unknown): NbtCompound | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value)
    ? (value as NbtCompound)
    : undefined
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function approximateVersion(dataVersion: number): string | undefined {
  const ranges: Array<[number, string]> = [
    [4189, '约 1.21.4 或更新'],
    [3953, '约 1.21–1.21.3'],
    [3837, '约 1.20.5–1.20.6'],
    [3700, '约 1.20.3–1.20.4'],
    [3578, '约 1.20.2'],
    [3463, '约 1.20–1.20.1'],
    [3337, '约 1.19.4'],
    [3218, '约 1.19.3'],
    [3105, '约 1.19–1.19.2'],
    [2975, '约 1.18.2'],
    [2860, '约 1.18–1.18.1'],
    [2724, '约 1.17–1.17.1'],
    [2566, '约 1.16–1.16.5'],
    [2225, '约 1.15–1.15.2'],
    [1901, '约 1.14–1.14.4'],
    [1519, '约 1.13–1.13.2'],
    [1343, '约 1.12–1.12.2'],
    [819, '约 1.11–1.11.2'],
    [510, '约 1.10–1.10.2'],
    [169, '约 1.9–1.9.4']
  ]
  return ranges.find(([minimum]) => dataVersion >= minimum)?.[1]
}

function metadataFromLevelDat(buffer: Buffer, fallbackName: string): Omit<
  WorldCandidateInfo,
  'id' | 'fileCount' | 'totalBytes' | 'resourcePacks' | 'hasWorldResourcePack' | 'datapackCount'
> & { declaredDatapacks: number } {
  const root = parseNbt(buffer)
  const data = asCompound(root.Data) ?? root
  const version = asCompound(data.Version)
  const dataVersion =
    typeof data.DataVersion === 'number'
      ? data.DataVersion
      : typeof version?.Id === 'number'
        ? version.Id
        : undefined
  const exactVersion = typeof version?.Name === 'string' && version.Name.trim()
    ? version.Name.trim()
    : undefined
  const dataPacks = asCompound(data.DataPacks)
  const enabledPacks = asStringArray(dataPacks?.Enabled).filter(
    (name) => name !== 'vanilla' && name !== 'minecraft'
  )
  const gameModes: Record<number, WorldCandidateInfo['gameMode']> = {
    0: '生存',
    1: '创造',
    2: '冒险',
    3: '旁观'
  }
  const keys = Object.keys(data).map((key) => key.toLowerCase())
  const modEvidence: string[] = []
  let loader: LoaderName | undefined
  if (keys.some((key) => key === 'fml' || key.includes('forge'))) {
    modEvidence.push('level.dat 含 Forge/FML 元数据')
    loader = 'forge'
  }
  if (keys.some((key) => key.includes('fabric'))) {
    modEvidence.push('level.dat 含 Fabric 元数据')
    loader = 'fabric'
  }
  if (keys.some((key) => key.includes('bukkit'))) modEvidence.push('level.dat 含 Bukkit 元数据')

  return {
    worldName:
      typeof data.LevelName === 'string' && data.LevelName.trim()
        ? data.LevelName.trim()
        : fallbackName,
    dataVersion,
    minecraftVersion: exactVersion ?? (dataVersion == null ? undefined : approximateVersion(dataVersion)),
    versionConfidence: exactVersion ? 'exact' : dataVersion == null ? 'unknown' : 'approximate',
    gameMode: typeof data.GameType === 'number' ? gameModes[data.GameType] : undefined,
    hardcore: data.hardcore === 1,
    modEvidence,
    loader,
    loaderConfidence: loader ? 'inferred' : undefined,
    declaredDatapacks: enabledPacks.length
  }
}

export function normalizeWorldArchivePath(input: string): string {
  if (!input || input.includes('\0')) throw new Error('压缩包包含空文件名或 NUL 字符')
  const slash = input.replace(/\\/g, '/')
  if (/^(?:\/|[A-Za-z]:|\/\/)/.test(slash)) throw new Error(`压缩包包含绝对路径：${input}`)
  const parts = slash.split('/').filter((part) => part && part !== '.')
  if (!parts.length) return ''
  if (parts.some((part) => part === '..')) throw new Error(`压缩包包含路径穿越：${input}`)
  if (process.platform === 'win32' && parts.some((part) => WINDOWS_DEVICE.test(part) || /[:*?"<>|]/.test(part))) {
    throw new Error(`压缩包包含 Windows 非法路径：${input}`)
  }
  return parts.join('/')
}

function zipEntryIsSymlink(entry: Entry): boolean {
  const mode = (entry.externalFileAttributes >>> 16) & 0o170000
  return mode === 0o120000
}

function openZip(filePath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      filePath,
      { lazyEntries: true, autoClose: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => (error || !zip ? reject(error ?? new Error('ZIP 无法打开')) : resolve(zip))
    )
  })
}

async function inspectZip(filePath: string): Promise<{ entries: SafeZipEntry[]; warnings: string[] }> {
  const zip = await openZip(filePath)
  return await new Promise((resolve, reject) => {
    const entries: SafeZipEntry[] = []
    const warnings: string[] = []
    let count = 0
    let totalUncompressed = 0
    let totalCompressed = 0
    let settled = false
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      zip.close()
      reject(error)
    }
    zip.on('error', fail)
    zip.on('entry', (entry: Entry) => {
      try {
        if (++count > MAX_ARCHIVE_ENTRIES) throw new Error('压缩包文件数量超过安全上限')
        const name = normalizeWorldArchivePath(entry.fileName)
        const symlink = zipEntryIsSymlink(entry)
        if (symlink) warnings.push(`已忽略符号链接：${name}`)
        totalUncompressed += entry.uncompressedSize
        totalCompressed += entry.compressedSize
        if (totalUncompressed > MAX_ARCHIVE_BYTES) throw new Error('压缩包解压后超过 32 GB 安全上限')
        if (
          entry.uncompressedSize > 64 * 1024 * 1024 &&
          entry.uncompressedSize / Math.max(1, entry.compressedSize) > MAX_COMPRESSION_RATIO
        ) {
          throw new Error(`压缩比异常，疑似解压炸弹：${name}`)
        }
        entries.push({
          rawName: entry.fileName,
          name,
          directory: /\/$/.test(entry.fileName),
          compressedSize: entry.compressedSize,
          uncompressedSize: entry.uncompressedSize,
          symlink
        })
        zip.readEntry()
      } catch (error) {
        fail(error)
      }
    })
    zip.on('end', () => {
      if (settled) return
      settled = true
      if (
        totalUncompressed > 64 * 1024 * 1024 &&
        totalUncompressed / Math.max(1, totalCompressed) > MAX_COMPRESSION_RATIO
      ) {
        reject(new Error('压缩包整体压缩比异常，疑似解压炸弹'))
      } else {
        resolve({ entries, warnings })
      }
    })
    zip.readEntry()
  })
}

async function readZipEntry(filePath: string, wanted: string, limit: number): Promise<Buffer> {
  const zip = await openZip(filePath)
  return await new Promise((resolve, reject) => {
    let settled = false
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      zip.close()
      reject(error)
    }
    zip.on('error', fail)
    zip.on('entry', (entry: Entry) => {
      let name: string
      try {
        name = normalizeWorldArchivePath(entry.fileName)
      } catch (error) {
        fail(error)
        return
      }
      if (name !== wanted) {
        zip.readEntry()
        return
      }
      if (entry.uncompressedSize > limit) {
        fail(new Error(`${path.posix.basename(wanted)} 超过安全大小限制`))
        return
      }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          fail(error ?? new Error('ZIP 条目无法读取'))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > limit) stream.destroy(new Error('ZIP 条目解压后过大'))
          else chunks.push(Buffer.from(chunk))
        })
        stream.once('error', fail)
        stream.once('end', () => {
          if (settled) return
          settled = true
          zip.close()
          resolve(Buffer.concat(chunks))
        })
      })
    })
    zip.on('end', () => fail(new Error(`ZIP 中找不到 ${wanted}`)))
    zip.readEntry()
  })
}

function relativeInRoot(name: string, root: string): string | null {
  if (!root) return name
  if (name === root) return ''
  return name.startsWith(root + '/') ? name.slice(root.length + 1) : null
}

function archiveResourcePacks(entries: SafeZipEntry[], worldRoot: string): WorldResourcePackInfo[] {
  if (!worldRoot) return []
  const files = new Set(entries.filter((entry) => !entry.directory && !entry.symlink).map((entry) => entry.name))
  const rootsWithAssets = new Set<string>()
  for (const file of files) {
    const marker = file.toLowerCase().indexOf('/assets/')
    if (marker > 0) rootsWithAssets.add(file.slice(0, marker))
  }
  const result: WorldResourcePackInfo[] = []
  for (const file of files) {
    if (path.posix.basename(file).toLowerCase() !== 'pack.mcmeta') continue
    const root = path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file)
    if (!root || relativeInRoot(root, worldRoot) != null && /(?:^|\/)datapacks(?:\/|$)/i.test(root)) continue
    if (!rootsWithAssets.has(root)) continue
    result.push({ id: root || '.', name: path.posix.basename(root) || '资源包' })
    if (result.length >= 128) break
  }
  return result
}

async function zipWorldInfo(filePath: string): Promise<WorldImportInfo | null> {
  const inspected = await inspectZip(filePath)
  const levelEntries = inspected.entries
    .filter((entry) => !entry.directory && !entry.symlink && path.posix.basename(entry.name).toLowerCase() === 'level.dat')
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length)
  if (!levelEntries.length) return null
  const candidates: WorldCandidateInfo[] = []
  const parseErrors: string[] = []
  for (const level of levelEntries.slice(0, 32)) {
    const root = path.posix.dirname(level.name) === '.' ? '' : path.posix.dirname(level.name)
    try {
      const { declaredDatapacks, ...metadata } = metadataFromLevelDat(
        await readZipEntry(filePath, level.name, MAX_LEVEL_DAT),
        path.posix.basename(root) || path.basename(filePath, path.extname(filePath))
      )
      const members = inspected.entries.filter((entry) => !entry.directory && relativeInRoot(entry.name, root) != null)
      const datapacks = new Set<string>()
      let hasWorldResourcePack = false
      let hasServerConfig = false
      for (const member of members) {
        const rel = relativeInRoot(member.name, root) ?? ''
        if (/^resources\.zip$/i.test(rel)) hasWorldResourcePack = true
        const dp = /^datapacks\/([^/]+)/i.exec(rel)?.[1]
        if (dp) datapacks.add(dp)
        if (/^(?:serverconfig|config)\//i.test(rel)) hasServerConfig = true
      }
      if (hasServerConfig && !metadata.modEvidence.includes('目录中存在模组配置痕迹')) {
        metadata.modEvidence.push('目录中存在模组配置痕迹')
      }
      candidates.push({
        ...metadata,
        id: root || '.',
        datapackCount: Math.max(declaredDatapacks, datapacks.size),
        resourcePacks: archiveResourcePacks(inspected.entries, root),
        hasWorldResourcePack,
        fileCount: members.length,
        totalBytes: members.reduce((sum, entry) => sum + entry.uncompressedSize, 0)
      })
    } catch (error) {
      parseErrors.push(`${level.name}：${textError(error)}`)
    }
  }
  if (!candidates.length) throw new Error(`检测到 level.dat，但均无法解析：${parseErrors.join('；')}`)
  return {
    sourcePath: canonicalPath(filePath),
    sourceType: 'zip',
    candidates,
    warnings: [...new Set([...inspected.warnings, ...parseErrors])]
  }
}

async function findFolderCandidates(root: string): Promise<FolderCandidate[]> {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  const candidates: FolderCandidate[] = []
  let visited = 0
  while (queue.length) {
    const current = queue.shift()!
    const entries = await fs.promises.readdir(current.dir, { withFileTypes: true })
    visited += entries.length
    if (visited > MAX_ARCHIVE_ENTRIES) throw new Error('目录文件数量超过安全扫描上限')
    if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === 'level.dat')) {
      const relative = path.relative(root, current.dir)
      candidates.push({ id: relative ? relative.replace(/\\/g, '/') : '.', root: current.dir })
      continue
    }
    if (current.depth >= MAX_FOLDER_DEPTH) continue
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 })
    }
  }
  return candidates
}

async function inspectFolderWorld(root: string): Promise<{
  fileCount: number
  totalBytes: number
  datapackCount: number
  hasWorldResourcePack: boolean
  modEvidence: string[]
}> {
  const queue = [root]
  let fileCount = 0
  let totalBytes = 0
  const datapacks = new Set<string>()
  let hasWorldResourcePack = false
  let hasServerConfig = false
  while (queue.length) {
    const dir = queue.pop()!
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const stat = await fs.promises.lstat(full)
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) {
        queue.push(full)
        continue
      }
      fileCount++
      totalBytes += stat.size
      if (fileCount > MAX_ARCHIVE_ENTRIES || totalBytes > MAX_ARCHIVE_BYTES) {
        throw new Error('存档目录超过安全导入上限')
      }
      const rel = path.relative(root, full).replace(/\\/g, '/')
      if (/^resources\.zip$/i.test(rel)) hasWorldResourcePack = true
      const dp = /^datapacks\/([^/]+)/i.exec(rel)?.[1]
      if (dp) datapacks.add(dp)
      if (/^(?:serverconfig|config)\//i.test(rel)) hasServerConfig = true
    }
  }
  return {
    fileCount,
    totalBytes,
    datapackCount: datapacks.size,
    hasWorldResourcePack,
    modEvidence: hasServerConfig ? ['目录中存在模组配置痕迹'] : []
  }
}

async function folderWorldInfo(folder: string): Promise<WorldImportInfo | null> {
  const source = canonicalPath(folder)
  const found = await findFolderCandidates(source)
  if (!found.length) return null
  const candidates: WorldCandidateInfo[] = []
  const warnings: string[] = []
  for (const candidate of found.slice(0, 32)) {
    try {
      const levelPath = path.join(candidate.root, 'level.dat')
      const stat = await fs.promises.stat(levelPath)
      if (stat.size > MAX_LEVEL_DAT) throw new Error('level.dat 超过安全大小限制')
      const { declaredDatapacks, ...metadata } = metadataFromLevelDat(
        await fs.promises.readFile(levelPath),
        path.basename(candidate.root)
      )
      const detail = await inspectFolderWorld(candidate.root)
      for (const evidence of detail.modEvidence) {
        if (!metadata.modEvidence.includes(evidence)) metadata.modEvidence.push(evidence)
      }
      candidates.push({
        ...metadata,
        id: candidate.id,
        datapackCount: Math.max(declaredDatapacks, detail.datapackCount),
        resourcePacks: [],
        hasWorldResourcePack: detail.hasWorldResourcePack,
        fileCount: detail.fileCount,
        totalBytes: detail.totalBytes
      })
    } catch (error) {
      warnings.push(`${candidate.id}：${textError(error)}`)
    }
  }
  if (!candidates.length) throw new Error(`检测到 level.dat，但均无法解析：${warnings.join('；')}`)
  return { sourcePath: source, sourceType: 'folder', candidates, warnings }
}

/** 返回 null 表示该路径不是存档；检测到损坏存档时抛出明确错误。 */
export async function probeWorld(input: string): Promise<WorldImportInfo | null> {
  if (!input || !fs.existsSync(input)) return null
  const stat = await fs.promises.lstat(input)
  if (stat.isSymbolicLink()) throw new Error('不允许从符号链接导入存档')
  if (stat.isDirectory()) return await folderWorldInfo(input)
  if (stat.isFile() && path.extname(input).toLowerCase() === '.zip') return await zipWorldInfo(input)
  return null
}

function cleanLeafName(input: string, label: string): string {
  const value = input.trim()
  if (!value) throw new Error(`${label}不能为空`)
  if (value.length > 120) throw new Error(`${label}最多 120 个字符`)
  if (value === '.' || value === '..' || /[\\/:*?"<>|]/.test(value) || WINDOWS_DEVICE.test(value)) {
    throw new Error(`${label}包含非法字符或设备名`)
  }
  return value.replace(/[. ]+$/g, '')
}

function safeFolderCandidate(source: string, id: string): string {
  const relative = id === '.' ? '' : id.replace(/\//g, path.sep)
  const target = path.resolve(source, relative)
  const base = path.resolve(source)
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error('存档根目录越界')
  return target
}

async function copyFolderWorld(
  source: string,
  destination: string,
  signal: AbortSignal | undefined,
  onFile: () => void
): Promise<void> {
  const queue: Array<{ source: string; destination: string }> = [{ source, destination }]
  while (queue.length) {
    throwIfCancelled(signal)
    const current = queue.pop()!
    await fs.promises.mkdir(current.destination, { recursive: true })
    for (const entry of await fs.promises.readdir(current.source, { withFileTypes: true })) {
      throwIfCancelled(signal)
      const from = path.join(current.source, entry.name)
      const to = path.join(current.destination, entry.name)
      const stat = await fs.promises.lstat(from)
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) queue.push({ source: from, destination: to })
      else {
        await fs.promises.mkdir(path.dirname(to), { recursive: true })
        await pipeline(fs.createReadStream(from), fs.createWriteStream(to, { flags: 'wx' }), {
          signal
        })
        onFile()
      }
    }
  }
}

function safeDestination(base: string, relative: string): string {
  const normalized = normalizeWorldArchivePath(relative)
  const target = path.resolve(base, ...normalized.split('/').filter(Boolean))
  const root = path.resolve(base)
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('解压目标越界')
  return target
}

async function extractZipWorld(
  filePath: string,
  worldRoot: string,
  destination: string,
  signal: AbortSignal | undefined,
  onFile: () => void
): Promise<void> {
  const inspected = await inspectZip(filePath)
  const expected = new Map(inspected.entries.map((entry) => [entry.name, entry]))
  const zip = await openZip(filePath)
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const abort = (): void => {
      zip.close()
      finish(new DOMException('已取消', 'AbortError'))
    }
    const finish = (error?: unknown): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    signal?.addEventListener('abort', abort, { once: true })
    zip.on('error', finish)
    zip.on('entry', (entry: Entry) => {
      void (async () => {
        throwIfCancelled(signal)
        const name = normalizeWorldArchivePath(entry.fileName)
        const safe = expected.get(name)
        const root = worldRoot === '.' ? '' : worldRoot
        const relative = relativeInRoot(name, root)
        if (!safe || relative == null || !relative || safe.directory || safe.symlink) {
          zip.readEntry()
          return
        }
        const output = safeDestination(destination, relative)
        await fs.promises.mkdir(path.dirname(output), { recursive: true })
        await new Promise<void>((streamResolve, streamReject) => {
          zip.openReadStream(entry, (error, stream) => {
            if (error || !stream) {
              streamReject(error ?? new Error('ZIP 条目无法读取'))
              return
            }
            pipeline(stream, fs.createWriteStream(output, { flags: 'wx' }), { signal })
              .then(streamResolve, streamReject)
          })
        })
        onFile()
        zip.readEntry()
      })().catch(finish)
    })
    zip.on('end', () => finish())
    if (signal?.aborted) abort()
    else zip.readEntry()
  })
}

function uniqueName(parent: string, requested: string): string {
  const parsed = path.parse(requested)
  let candidate = requested
  let suffix = 2
  while (fs.existsSync(path.join(parent, candidate))) {
    candidate = `${parsed.name}-${suffix++}${parsed.ext}`
  }
  return candidate
}

function readVersionJsonIn(folder: string, id: string): VersionJson {
  const file = path.join(folder, 'versions', id, `${id}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^﻿/, '')) as VersionJson
}

function registeredFolder(input: string): string {
  const target = canonicalPath(input)
  const found = listGameFolders().folders.find((folder) => samePath(folder.path, target))
  if (!found) throw new Error('目标游戏文件夹未在 KAMUCL 中登记')
  return found.path
}

export async function importWorld(
  input: string,
  options: WorldImportOptions,
  emit: ProgressEmit,
  signal?: AbortSignal
): Promise<WorldImportResult> {
  const targetFolder = registeredFolder(options.targetFolder)
  const accepted = { ...options, targetFolder, newInstance: options.newInstance ? { ...options.newInstance } : undefined }
  return withGameFolder(targetFolder, () => importWorldInFolder(input, accepted, emit, signal))
}

async function importWorldInFolder(
  input: string,
  options: WorldImportOptions,
  emit: ProgressEmit,
  signal?: AbortSignal
): Promise<WorldImportResult> {
  const info = await probeWorld(input)
  if (!info) throw new Error('该路径不是有效的 Minecraft 存档')
  const candidate = info.candidates.find((item) => item.id === options.candidateId)
  if (!candidate) throw new Error('所选存档已变化，请重新拖入并确认')
  const worldName = cleanLeafName(options.worldName, '存档名称')
  const targetFolder = registeredFolder(options.targetFolder)
  let versionId = options.targetVersionId?.trim() ?? ''
  let createdInstance = false
  let createdInstanceDir = ''

  emit({ stage: 'world', progress: 0, overall: 0, text: '验证存档与目标实例…' })
  throwIfCancelled(signal)
  try {
    if (options.newInstance) {
      const minecraftVersion = options.newInstance.minecraftVersion.trim()
      const instanceName = cleanLeafName(options.newInstance.instanceName, '实例名称')
      if (!minecraftVersion) throw new Error('新实例必须指定 Minecraft 版本')
      createdInstanceDir = path.join(targetFolder, 'versions', instanceName)
      if (fs.existsSync(createdInstanceDir)) throw new Error(`实例名称已存在：${instanceName}`)
      versionId = await installVersion(
        minecraftVersion,
        {
          instanceName,
          loader: options.newInstance.loader,
          loaderVersion: options.newInstance.loaderVersion
        },
        (event) =>
          emit({
            ...event,
            overall: (event.overall ?? event.progress) * 0.65,
            text: `创建目标实例 · ${event.text}`
          }),
        signal
      )
      createdInstance = true
      createdInstanceDir = path.join(targetFolder, 'versions', versionId)
      setNewInstanceIsolation(versionId, true)
    }

    if (!versionId) throw new Error('请选择已有实例或创建新实例')
    const installed = scanInstalledFolder(targetFolder).versions.find((item) => item.id === versionId)
    if (!installed || installed.incomplete || installed.failed) throw new Error('目标实例不存在或文件不完整')
    if (
      candidate.versionConfidence === 'exact' &&
      candidate.minecraftVersion &&
      installed.mcVersion !== candidate.minecraftVersion &&
      !options.allowVersionMismatch
    ) {
      throw new Error(`存档版本为 ${candidate.minecraftVersion}，目标实例为 ${installed.mcVersion}，需要明确确认跨版本导入`)
    }

    const json = readVersionJsonIn(targetFolder, versionId)
    const gameDirectory = instanceDirectoryState(versionId, json, targetFolder).path
    const saves = path.join(gameDirectory, 'saves')
    const destination = path.join(saves, worldName)
    if (fs.existsSync(destination)) throw new Error(`目标实例已存在同名存档：${worldName}`)

    const transaction = path.join(gameDirectory, `.world-import-${crypto.randomUUID()}`)
    const stagedWorld = path.join(transaction, 'world')
    let copied = 0
    const update = (): void => {
      copied++
      if (copied % 16 === 0 || copied === candidate.fileCount) {
        const ratio = candidate.fileCount ? copied / candidate.fileCount : 1
        emit({
          stage: 'world',
          progress: ratio,
          overall: (createdInstance ? 0.65 : 0.05) + ratio * (createdInstance ? 0.32 : 0.9),
          text: `导入存档文件 ${copied}/${candidate.fileCount}`
        })
      }
    }
    const committed: string[] = []
    try {
      await fs.promises.mkdir(stagedWorld, { recursive: true })
      if (info.sourceType === 'folder') {
        const sourceRoot = safeFolderCandidate(info.sourcePath, candidate.id)
        await copyFolderWorld(sourceRoot, stagedWorld, signal, update)
      } else {
        await extractZipWorld(info.sourcePath, candidate.id, stagedWorld, signal, update)
      }
      throwIfCancelled(signal)
      await fs.promises.mkdir(saves, { recursive: true })
      if (fs.existsSync(destination)) throw new Error(`目标实例已存在同名存档：${worldName}`)
      await fs.promises.rename(stagedWorld, destination)
      committed.push(destination)

      // resources.zip 位于世界根时 Minecraft 会随世界自动使用；外置资源包只安装
      // 已验证同时含 pack.mcmeta 与 assets/ 的目录，并用新名称避免覆盖。
      const installedResourcePacks: string[] = []
      if (info.sourceType === 'zip' && candidate.resourcePacks.length) {
        const packsDir = path.join(gameDirectory, 'resourcepacks')
        await fs.promises.mkdir(packsDir, { recursive: true })
        for (const pack of candidate.resourcePacks) {
          throwIfCancelled(signal)
          const staged = path.join(transaction, 'packs', cleanLeafName(pack.name, '资源包名称'))
          await fs.promises.mkdir(staged, { recursive: true })
          await extractZipWorld(info.sourcePath, pack.id, staged, signal, () => undefined)
          const finalName = uniqueName(packsDir, cleanLeafName(pack.name, '资源包名称'))
          const finalPath = path.join(packsDir, finalName)
          await fs.promises.rename(staged, finalPath)
          committed.push(finalPath)
          installedResourcePacks.push(finalName)
        }
      }
      emit({ stage: 'done', progress: 1, overall: 1, text: `存档「${worldName}」导入完成` })
      return {
        versionId,
        worldName,
        worldDirectory: destination,
        installedResourcePacks,
        createdInstance
      }
    } catch (error) {
      for (const item of committed.reverse()) {
        await fs.promises.rm(item, { recursive: true, force: true }).catch(() => undefined)
      }
      throw error
    } finally {
      await fs.promises.rm(transaction, { recursive: true, force: true }).catch(() => undefined)
    }
  } catch (error) {
    if (createdInstanceDir) {
      await fs.promises.rm(createdInstanceDir, { recursive: true, force: true }).catch(() => undefined)
    }
    throw new Error(`存档导入失败，已回滚：${textError(error)}`)
  }
}
