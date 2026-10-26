/** Client installation for the official pre-CLI Forge install/versionInfo format.
 * These installers cannot accept --installClient. Read their declarative profile
 * and embedded universal JAR; never execute an archive-contained program.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { downloadAll, downloadCandidates, type DownloadTask, type MirrorPref } from './download'
import { httpFetch } from './httpClient'
import { downloadLimiter } from './downloadLimits'
import { withFileJob, fileJobKey } from './fileJobs'
import { inheritTaskControl, isTaskPaused, waitIfTaskPaused } from './tasks'
import type { ProgressEvent } from '../../shared/types'
import type { Library, VersionJson } from './versions'

interface LegacyLibrary {
  name: string
  relative: string
  url: string
  checksums: string[]
  embedded?: Buffer
}
export interface LegacyForgeInstaller {
  profile: VersionJson
  libraries: LegacyLibrary[]
}
export interface PreparedLegacyForgeInstaller {
  install(target: string, instanceName: string | undefined, emit: (event: ProgressEvent) => void, signal?: AbortSignal): Promise<string>
  complete(): void
  dispose(): void
}

function record(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`旧版 Forge ${label} 格式无效`)
  return value as Record<string, any>
}
function safeName(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 180 || value === '.' || value === '..' ||
    /[\\/<>:"|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) {
    throw new Error(`旧版 Forge ${label} 不安全`)
  }
  return value
}
function mavenPath(name: unknown): { name: string; relative: string; version: string } {
  if (typeof name !== 'string') throw new Error('旧版 Forge 依赖坐标无效')
  const parts = name.split(':')
  if (parts.length !== 3 && parts.length !== 4) throw new Error('旧版 Forge 依赖坐标无效')
  const [group, artifact, version, classifier] = parts
  if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(group) ||
    parts.slice(1).some(part => !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(part))) throw new Error('旧版 Forge 依赖坐标不安全')
  for (const part of [...group.split('.'), ...parts.slice(1)]) safeName(part, '依赖路径')
  return { name, version, relative: `${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? '-' + classifier : ''}.jar` }
}
function repository(input: unknown): string {
  if (input === undefined) return 'https://libraries.minecraft.net/'
  if (typeof input !== 'string') throw new Error('旧版 Forge 依赖仓库无效')
  const url = new URL(input)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash) throw new Error('旧版 Forge 依赖仓库不安全')
  if (url.hostname === 'files.minecraftforge.net' && url.pathname === '/maven/') return 'https://maven.minecraftforge.net/'
  if (['maven.minecraftforge.net', 'libraries.minecraft.net'].includes(url.hostname) && url.pathname === '/') return `https://${url.hostname}/`
  throw new Error('旧版 Forge 依赖仓库不受支持')
}
function hashes(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.length || value.length > 16 || value.some(hash => typeof hash !== 'string' || !/^[a-f\d]{40}$/i.test(hash))) throw new Error('旧版 Forge 依赖校验值无效')
  return [...new Set(value.map(hash => hash.toLowerCase()))]
}

/** Return null only for an installer without legacy keys. Recognized but damaged
 * legacy metadata is an installation error, never a silent fallback to Java CLI. */
export function readLegacyForgeInstaller(jar: string, mcVersion: string, loaderVersion: string, installerUrl: string): LegacyForgeInstaller | null {
  const stat = fs.lstatSync(jar)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024 * 1024) throw new Error('Forge 安装器不是有效的普通文件')
  const archive = new AdmZip(jar), profiles = archive.getEntries().filter(entry => entry.entryName.toLowerCase() === 'install_profile.json')
  if (!profiles.length) return null
  if (profiles.length !== 1 || profiles[0].entryName !== 'install_profile.json' || profiles[0].isDirectory ||
    (profiles[0].header.flags & 1) || ((profiles[0].attr >>> 16) & 0xf000) === 0xa000 || profiles[0].header.size > 8 * 1024 * 1024) throw new Error('Forge 安装器包含冲突、不安全或过大的元数据')
  const metadata = record(JSON.parse(profiles[0].getData().toString('utf8')), '安装元数据')
  if (!Object.hasOwn(metadata, 'install') && !Object.hasOwn(metadata, 'versionInfo')) return null
  if (!/^1\.(?:[1-9]|1[0-2])(?:\.\d+)?$/.test(mcVersion) || ['processors', 'data', 'spec', 'libraries', 'json', 'optionals'].some(key => Object.hasOwn(metadata, key))) throw new Error('不支持混合或非旧版 Forge 安装器格式')
  const install = record(metadata.install, '安装配置'), version = record(metadata.versionInfo, '版本配置')
  if (['transform', 'stripMeta', 'modList', 'hideClient'].some(key => Object.hasOwn(install, key))) throw new Error('旧版 Forge 安装器需要额外转换，不能按普通继承配置安装')
  const coordinate = mavenPath(install.path)
  const expectedUrl = new URL(installerUrl)
  const expectedCoordinate = expectedUrl.pathname.match(/^\/net\/minecraftforge\/forge\/([^/]+)\/forge-\1-installer\.jar$/)?.[1]
  const expected = `${mcVersion}-${loaderVersion}`
  if (expectedUrl.origin !== 'https://maven.minecraftforge.net' || !expectedCoordinate || coordinate.name !== `net.minecraftforge:forge:${expectedCoordinate}` ||
    (coordinate.version !== expected && !coordinate.version.startsWith(expected + '-')) || install.minecraft !== mcVersion) throw new Error('旧版 Forge 安装器与请求版本不一致')
  const id = safeName(version.id, '版本名称')
  if (install.target !== id || version.inheritsFrom !== mcVersion || (version.jar !== undefined && version.jar !== mcVersion)) throw new Error('旧版 Forge 版本继承或目标不一致')
  if (typeof version.mainClass !== 'string' || !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(version.mainClass) ||
    typeof version.minecraftArguments !== 'string' || !version.minecraftArguments || version.minecraftArguments.length > 65536 || /[\x00\r\n]/.test(version.minecraftArguments)) throw new Error('旧版 Forge 启动配置无效')
  if (!Array.isArray(version.libraries) || !version.libraries.length || version.libraries.length > 256) throw new Error('旧版 Forge 依赖列表无效')
  const filePath = safeName(install.filePath, '内嵌文件名称')
  if (filePath !== `forge-${expectedCoordinate}-universal.jar`) throw new Error('旧版 Forge 内嵌文件与坐标不一致')
  const embeddedEntries = archive.getEntries().filter(entry => entry.entryName.toLowerCase() === filePath.toLowerCase())
  if (embeddedEntries.length !== 1 || embeddedEntries[0].entryName !== filePath) throw new Error('旧版 Forge 内嵌文件缺失或重复')
  const entry = embeddedEntries[0]
  if (entry.isDirectory || (entry.header.flags & 1) || ((entry.attr >>> 16) & 0xf000) === 0xa000 || entry.header.size <= 0 || entry.header.size > 64 * 1024 * 1024) throw new Error('旧版 Forge 内嵌文件不安全或过大')
  const embedded = entry.getData()
  if (embedded.length !== entry.header.size || embedded.length < 4 || embedded.readUInt32LE(0) !== 0x04034b50) throw new Error('旧版 Forge 内嵌 JAR 无效')
  // Parsing its central directory detects truncation without executing its bytecode.
  if (!new AdmZip(embedded).getEntries().length) throw new Error('旧版 Forge 内嵌 JAR 为空')
  const embeddedHash = crypto.createHash('sha1').update(embedded).digest('hex')
  const libraries: LegacyLibrary[] = [], destinations = new Set<string>()
  let universalCount = 0
  for (const input of version.libraries) {
    const lib = record(input, '依赖'), artifact = mavenPath(lib.name)
    if (['clientreq', 'serverreq'].some(key => lib[key] !== undefined && typeof lib[key] !== 'boolean')) throw new Error('旧版 Forge 依赖适用范围无效')
    const checksums = hashes(lib.checksums)
    if (lib.downloads !== undefined || lib.natives !== undefined || lib.rules !== undefined) throw new Error('不支持混合的旧版 Forge 依赖格式')
    if (lib.clientreq === false) continue
    const key = fileJobKey(path.resolve(artifact.relative))
    if (destinations.has(key)) throw new Error('旧版 Forge 包含重复的依赖目标')
    destinations.add(key)
    if (artifact.name === coordinate.name) {
      universalCount++
      if (checksums.length && !checksums.includes(embeddedHash)) throw new Error('旧版 Forge 内嵌文件校验失败')
      // The exact classifier filename comes from the bound official profile.
      // Keep the launcher's classifier-free library path but retain its Maven
      // universal URL so a missing/corrupt cache can be repaired with the same
      // embedded SHA-1 and size. Installation itself uses the verified payload.
      libraries.push({ ...artifact, url: new URL(filePath, expectedUrl).href, checksums: [embeddedHash], embedded })
    } else {
      libraries.push({ ...artifact, url: repository(lib.url) + artifact.relative, checksums })
    }
  }
  if (universalCount !== 1) throw new Error('旧版 Forge 缺少唯一的本体依赖')
  // Copy only the old launcher fields; installer-controlled private KAMUCL paths,
  // modern processor instructions and unrelated properties are never imported.
  const profile: VersionJson = { id, inheritsFrom: mcVersion, mainClass: version.mainClass, minecraftArguments: version.minecraftArguments, _mcVersion: mcVersion, _loader: 'forge', _loaderVersion: loaderVersion }
  if (version.type !== undefined) {
    if (!['release', 'snapshot', 'old_alpha', 'old_beta'].includes(version.type)) throw new Error('旧版 Forge 版本类型无效')
    profile.type = version.type
  }
  if (version.assets !== undefined) profile.assets = safeName(version.assets, '资源索引名称')
  return { profile, libraries }
}

/** Check every existing ancestor including dangling links and Windows junctions. */
function safeDestination(root: string, relative: string, file = true): string {
  const dest = path.resolve(root, relative), rel = path.relative(path.resolve(root), dest)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('旧版 Forge 写入路径越界')
  for (let current = dest; ; current = path.dirname(current)) {
    try {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink() || (current === dest && file ? !stat.isFile() : !stat.isDirectory())) throw new Error('旧版 Forge 写入目标或目录不能是链接或异常文件')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (current === path.parse(current).root) break
  }
  return dest
}
async function fileIdentity(file: string, signal?: AbortSignal): Promise<{ sha1: string; size: number }> {
  const hash = crypto.createHash('sha1'), stream = fs.createReadStream(file), abort = () => stream.destroy(new Error('已取消'))
  signal?.addEventListener('abort', abort, { once: true })
  let size = 0
  try {
    for await (const chunk of stream) { await waitIfTaskPaused(signal); signal?.throwIfAborted(); size += chunk.length; hash.update(chunk) }
    signal?.throwIfAborted()
    return { sha1: hash.digest('hex'), size }
  } finally { signal?.removeEventListener('abort', abort); stream.destroy() }
}
async function sidecarHashes(url: string, mirror: MirrorPref, signal?: AbortSignal): Promise<string[]> {
  for (const source of downloadCandidates([url], mirror)) {
    await waitIfTaskPaused(signal)
    signal?.throwIfAborted()
    // The queue and a user's pause are not network failures. Start the bounded
    // active-time budget only after a slot is available, and stop its clock while
    // paused, including a body received before the user resumes consumption.
    const release = await downloadLimiter.acquire(signal)
    const timeout = new AbortController(), requestSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal
    inheritTaskControl(signal, requestSignal)
    let elapsed = 0, last = performance.now()
    const timer = setInterval(() => {
      const now = performance.now()
      if (!isTaskPaused(signal)) elapsed += now - last
      last = now
      if (elapsed >= 4000) timeout.abort(new Error('旧版 Forge 依赖校验请求超时'))
    }, 50)
    try {
      await waitIfTaskPaused(signal)
      requestSignal.throwIfAborted()
      const response = await httpFetch(source + '.sha1', { signal: requestSignal, systemProxy: true })
      if (!response.ok) { await response.body?.cancel(); continue }
      if (Number(response.headers.get('content-length')) > 4096) { await response.body?.cancel(); continue }
      let text = ''
      if (!response.body) continue
      const reader = response.body.getReader()
      try {
        for (;;) {
          await waitIfTaskPaused(signal); requestSignal.throwIfAborted()
          const piece = await reader.read()
          if (piece.done) break
          text += Buffer.from(piece.value).toString('ascii')
          if (text.length > 4096) { await reader.cancel(); throw new Error('依赖校验文件过大') }
        }
      } finally { reader.releaseLock() }
      const checksum = text.trim().match(/^([a-f\d]{40})(?:\s|$)/i)?.[1]
      if (checksum) return [checksum.toLowerCase()]
    } catch (error) { signal?.throwIfAborted(); /* A failed mirror sidecar can use the official checksum. */ }
    finally { clearInterval(timer); release() }
  }
  throw new Error(`旧版 Forge 依赖缺少可靠的 SHA-1 校验值：${new URL(url).pathname}`)
}

/** All remote files are staged and checked before publication. Legacy profiles
 * can list several legitimate SHA-1 variants; accept any declared variant and
 * persist the exact downloaded identity. Undeclared hashes require a Maven
 * sidecar; an unavailable checksum is an explicit error, never an unchecked JAR.
 * Valid shared-cache entries may remain after cancellation, as in downloadAll;
 * no partial profile or player-owned version directory is replaced.
 */
export async function prepareLegacyForgeInstaller(plan: LegacyForgeInstaller, libraryRoot: string, mirror: MirrorPref, emit: (event: ProgressEvent) => void, signal?: AbortSignal): Promise<PreparedLegacyForgeInstaller> {
  await waitIfTaskPaused(signal)
  safeDestination(path.dirname(path.resolve(libraryRoot)), path.basename(libraryRoot), false)
  fs.mkdirSync(libraryRoot, { recursive: true })
  const work = fs.mkdtempSync(path.join(libraryRoot, '.kamucl-legacy-forge-'))
  const resolved: Array<{ library: LegacyLibrary; checksums: string[]; staged: string; dest: string; identity?: { sha1: string; size: number } }> = []
  let disposed = false
  let owned: { target: string; relative: string; directory: string; token: string } | undefined
  const complete = () => {
    if (!owned) return
    safeDestination(owned.target, owned.relative, false)
    const mark = safeDestination(owned.target, path.join(owned.relative, '.installing'))
    if (fs.readFileSync(mark, 'utf8') !== owned.token) throw new Error('旧版 Forge 事务标记已改变，未删除')
    fs.unlinkSync(mark)
    owned = undefined
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    try {
      if (owned) {
        safeDestination(owned.target, owned.relative, false)
        const mark = safeDestination(owned.target, path.join(owned.relative, '.installing'))
        if (fs.existsSync(mark) && fs.readFileSync(mark, 'utf8') === owned.token) fs.rmSync(owned.directory, { recursive: true, force: true })
      }
    } finally { fs.rmSync(work, { recursive: true, force: true }) }
  }
  try {
    for (const [index, library] of plan.libraries.entries()) {
      await waitIfTaskPaused(signal)
      const checksums = library.checksums.length ? library.checksums : await sidecarHashes(library.url, mirror, signal)
      const staged = path.join(work, `${index}.jar`), dest = safeDestination(libraryRoot, library.relative)
      const item = { library, checksums, staged, dest } as (typeof resolved)[number]
      if (fs.existsSync(dest)) {
        const identity = await fileIdentity(dest, signal)
        if (checksums.includes(identity.sha1)) item.identity = identity
      }
      if (library.embedded && !item.identity) fs.writeFileSync(staged, library.embedded, { flag: 'wx' })
      resolved.push(item)
    }
    const tasks: DownloadTask[] = resolved.filter(item => !item.identity && !item.library.embedded).map(item => ({ url: item.library.url, dest: item.staged, sha1: item.checksums.length === 1 ? item.checksums[0] : undefined, label: item.library.relative }))
    await downloadAll(tasks, (done, total, speed, detail) => emit({ stage: 'loader-dependencies', progress: detail.fraction ?? 0,
      text: `下载并校验旧版 Forge 依赖 ${done}/${total}`, speed, bytesDone: detail.bytesDone, bytesTotal: detail.bytesTotal ?? undefined,
      etaSeconds: detail.etaSeconds ?? undefined, indeterminate: detail.indeterminate }), downloadLimiter.maxConcurrent, mirror, signal)
    // No target writes if any staged dependency has an unaccepted legacy variant.
    for (const item of resolved) {
      item.identity ??= await fileIdentity(item.staged, signal)
      if (!item.checksums.includes(item.identity.sha1) || !item.identity.size) throw new Error(`旧版 Forge 依赖 SHA-1 校验失败：${item.library.name}`)
    }
    for (const item of resolved) {
      await withFileJob(item.dest, signal, async () => {
        await waitIfTaskPaused(signal)
        safeDestination(libraryRoot, item.library.relative)
        if (fs.existsSync(item.dest)) {
          const identity = await fileIdentity(item.dest, signal)
          if (identity.sha1 === item.identity!.sha1 && identity.size === item.identity!.size) return
        }
        if (!fs.existsSync(item.staged)) throw new Error(`旧版 Forge 缓存校验期间发生变化，请重试：${item.library.name}`)
        fs.mkdirSync(path.dirname(item.dest), { recursive: true })
        const temporary = item.dest + `.legacy-forge-${crypto.randomUUID()}.tmp`
        try {
          fs.copyFileSync(item.staged, temporary, fs.constants.COPYFILE_EXCL)
          await waitIfTaskPaused(signal)
          safeDestination(libraryRoot, item.library.relative)
          fs.renameSync(temporary, item.dest)
        } finally { fs.rmSync(temporary, { force: true }) }
      })
    }
    const libraries: Library[] = resolved.map(item => ({ name: item.library.name, downloads: { artifact: { path: item.library.relative, url: item.library.url, ...item.identity! } } }))
    return {
      dispose,
      complete,
      install: async (target, instanceName, report, installSignal) => withFileJob(path.join(target, '.kamucl-installer'), installSignal, async () => {
        if (disposed) throw new Error('旧版 Forge 安装计划已释放')
        await waitIfTaskPaused(installSignal)
        const id = safeName(instanceName?.trim() || plan.profile.id, '实例名称'), relative = path.join('versions', id)
        const directory = safeDestination(target, relative, false)
        if (fs.existsSync(directory)) throw new Error('旧版 Forge 目标实例目录已存在，未覆盖；请更换实例名')
        for (const item of resolved) {
          safeDestination(libraryRoot, item.library.relative)
          const identity = await fileIdentity(item.dest, installSignal)
          if (identity.sha1 !== item.identity!.sha1 || identity.size !== item.identity!.size) throw new Error(`旧版 Forge 依赖在生成配置前发生变化：${item.library.name}`)
        }
        await waitIfTaskPaused(installSignal)
        safeDestination(target, relative, false)
        fs.mkdirSync(path.dirname(directory), { recursive: true })
        // The directory is newly created with exclusive mkdir, so failure cleanup
        // cannot remove a pre-existing instance or its mods, options and saves.
        fs.mkdirSync(directory)
        try {
          installSignal?.throwIfAborted()
          const token = crypto.randomUUID()
          fs.writeFileSync(path.join(directory, '.installing'), token, { flag: 'wx' })
          owned = { target, relative, directory, token }
          const profile = { ...plan.profile, id, libraries }
          fs.writeFileSync(path.join(directory, `${id}.json`), JSON.stringify(profile, null, 2), { encoding: 'utf8', flag: 'wx' })
        } catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error }
        report({ stage: 'loader-process', progress: 1, text: '旧版 Forge 运行配置与本体已校验并生成' })
        return id
      })
    }
  } catch (error) { dispose(); throw error }
}
