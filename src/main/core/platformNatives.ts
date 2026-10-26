import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { httpFetch } from './httpClient'
import type { Library, LibraryArtifact } from './versions'

const CENTRAL = 'https://repo.maven.apache.org/maven2/'
const digests = new Map<string, string>()
let cacheLoaded = false
const cacheFile = () => path.join(app.getPath('userData'), 'native-checksums.json')
function trustedChecksumUrl(url: string): boolean {
  return /^https:\/\/repo\.maven\.apache\.org\/maven2\/org\/lwjgl\/(lwjgl[\w-]*)\/(3\.\d+\.\d+)\/\1-\2-natives-linux-arm64\.jar\.sha1$/.test(url)
}
function loadDigests() {
  if (cacheLoaded) return
  cacheLoaded = true
  try {
    const entries = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'))
    for (const [url, hash] of Object.entries(entries)) if (trustedChecksumUrl(url) && typeof hash === 'string' && /^[a-f0-9]{40}$/.test(hash)) digests.set(url, hash)
  } catch { /* missing/corrupt cache is fetched again */ }
}
export function nativeChecksum(url: string): string | undefined { loadDigests(); return digests.get(url) }

/** Only published, same-version LWJGL 3 classifiers may replace x64 metadata. */
export function nativeLibraryForHost(library: Library, platform = process.platform as string, arch = process.arch as string): Library & { nativeChecksumUrl?: string } {
  if (platform !== 'linux' || arch !== 'arm64') return library
  const parts = library.name?.split(':') ?? []
  const modernX64 = parts[3] === 'natives-linux'
  const legacyKey = library.natives?.linux
  if (!modernX64 && (!legacyKey || /(?:arm64|aarch64)/.test(legacyKey))) return library
  const classifier = 'natives-linux-arm64'
  const supplied = library.downloads?.classifiers?.[classifier]
  if (!modernX64 && supplied) return { ...library, natives: { ...library.natives, linux: classifier } }
  if (parts[0] !== 'org.lwjgl' || !/^lwjgl[\w-]*$/.test(parts[1] ?? '') || !/^3\.\d+\.\d+$/.test(parts[2] ?? '') || Number(parts[2].split('.')[1]) < 3) {
    throw new Error(`此游戏运行库未提供已验证的 Linux ARM64 文件：${library.name ?? legacyKey}。请使用兼容版本；不能加载 x64 原生库。`)
  }
  const [, module, version] = parts
  const relative = `org/lwjgl/${module}/${version}/${module}-${version}-${classifier}.jar`
  const url = CENTRAL + relative, checksumUrl = url + '.sha1'
  const artifact: LibraryArtifact = { path: relative, url, sha1: nativeChecksum(checksumUrl) }
  return modernX64
    ? { ...library, name: `${parts[0]}:${module}:${version}:${classifier}`, downloads: { ...library.downloads, artifact }, nativeChecksumUrl: checksumUrl }
    : { ...library, natives: { ...library.natives, linux: classifier }, downloads: { ...library.downloads, classifiers: { ...library.downloads?.classifiers, [classifier]: artifact } }, nativeChecksumUrl: checksumUrl }
}

/** Retrieve bounded official digest before accepting any generated artifact URL. */
export async function resolveNativeIntegrity<T extends { url?: string; sha1?: string; nativeChecksumUrl?: string }>(task: T, signal?: AbortSignal): Promise<T> {
  const url = task.nativeChecksumUrl
  if (!url) return task
  if (!trustedChecksumUrl(url) || task.url !== url.slice(0, -5)) throw new Error('原生库校验来源无效')
  const cached = nativeChecksum(url)
  if (cached) { task.sha1 = cached; return task }
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
  const response = await httpFetch(url, { signal: combined, systemProxy: true })
  if (!response.ok) { await response.body?.cancel(); throw new Error(`无法取得 ${path.basename(task.url)} 的官方 ARM64 校验值（HTTP ${response.status}），未使用 x64 替代`) }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('原生库校验响应为空')
  let text = '', bytes = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 256) throw new Error('原生库校验响应过大')
      text += Buffer.from(chunk.value).toString('ascii')
    }
  } finally { await reader.cancel().catch(() => {}) }
  const hash = text.trim().toLowerCase()
  if (!/^[a-f0-9]{40}$/.test(hash)) throw new Error('原生库官方 SHA1 无效')
  task.sha1 = hash; digests.set(url, hash)
  try {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true })
    fs.writeFileSync(cacheFile(), JSON.stringify(Object.fromEntries(digests)), { mode: 0o600 })
  } catch { /* validated in-memory digest remains valid for this launch */ }
  return task
}

/** Check the actual ELF machine, not its file name, before Java may load it. */
export function assertNativeElf(data: Buffer, arch: string, label: string): void {
  if (data.length < 20 || data[0] !== 0x7f || data.toString('ascii', 1, 4) !== 'ELF') throw new Error(`原生库不是有效 ELF：${label}`)
  if (data[4] !== 2 || data[5] !== 1) throw new Error(`原生库不是支持的 64 位小端 ELF：${label}`)
  const expected = arch === 'arm64' ? 183 : arch === 'x64' ? 62 : 0
  if (!expected || data.readUInt16LE(18) !== expected) throw new Error(`原生库架构不匹配（需要 ${arch}）：${label}`)
}
