/** Official OpenJDK distributors. Each fallback is a new package with its own
 * trusted metadata/hash; never resume a Temurin archive into a Zulu archive. */
export interface JavaPackage { provider: string; url: string; sha256: string; size?: number }
export interface JavaTarget { major: number; os: 'windows' | 'mac' | 'linux'; arch: 'x64' | 'aarch64' }
type ReadJson = (url: string) => Promise<any>

function verifiedPackage(provider: string, url: unknown, hash: unknown, size: unknown, hosts: string[]): JavaPackage {
  const parsed = new URL(String(url))
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !hosts.includes(parsed.hostname) ||
      typeof hash !== 'string' || !/^[a-f\d]{64}$/i.test(hash) || !Number.isSafeInteger(size) || Number(size) <= 0) {
    throw new Error(`${provider} 返回的 Java 下载元数据不完整或无效`)
  }
  return { provider, url: parsed.href, sha256: hash, size: Number(size) }
}

export async function temurinPackage(target: JavaTarget, read: ReadJson): Promise<JavaPackage> {
  const { major, os, arch } = target
  const assets = await read(`https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jre&os=${os}&vendor=eclipse`)
  const asset = Array.isArray(assets) && assets.find(a => a.version?.major === major && a.binary?.os === os && a.binary?.architecture === arch && a.binary?.image_type === 'jre')
  const pkg = asset?.binary?.package
  if (!pkg) throw new Error(`Adoptium 没有匹配 Java ${major} ${os}/${arch} 的 JRE`)
  return verifiedPackage('Eclipse Temurin', pkg.link, pkg.checksum, pkg.size, ['github.com'])
}

export async function zuluPackage(target: JavaTarget, read: ReadJson): Promise<JavaPackage> {
  const { major, os, arch } = target
  const system = os === 'mac' ? 'macos' : os, cpu = arch === 'aarch64' ? 'arm' : 'x86', archive = os === 'windows' ? 'zip' : 'tar.gz'
  const query = new URLSearchParams({ java_version: String(major), os: system, arch: cpu, hw_bitness: '64', archive_type: archive, java_package_type: 'jre', javafx_bundled: 'false', release_status: 'ga', availability_types: 'CA', latest: 'true' })
  const list = await read(`https://api.azul.com/metadata/v1/zulu/packages/?${query}`)
  const item = Array.isArray(list) && list.find(a => a.java_version?.[0] === major && a.availability_type === 'CA' && /^[\da-f-]{36}$/i.test(a.package_uuid))
  if (!item) throw new Error(`Azul 没有匹配 Java ${major} ${system}/${cpu} 的 JRE`)
  const detail = await read(`https://api.azul.com/metadata/v1/zulu/packages/${item.package_uuid}`)
  if (detail.java_version?.[0] !== major || detail.os !== system || detail.arch !== cpu || detail.hw_bitness !== 64 || detail.java_package_type !== 'jre' || detail.archive_type !== archive || detail.availability_type !== 'CA') throw new Error('Azul 返回的 Java 版本或平台不匹配')
  const pkg = verifiedPackage('Azul Zulu', detail.download_url, detail.sha256_hash, detail.size, ['cdn.azul.com'])
  // Azul's API size can be rounded (25/mac-arm64 reports 56,496,600 for a
  // 56,496,636-byte archive with the correct SHA256). Get exact size from the
  // binary response instead; never treat this hint as an integrity constraint.
  return { ...pkg, size: undefined }
}

export async function javaPackageSize(pkg: JavaPackage, head: (url: string) => Promise<Response>): Promise<number | undefined> {
  if (pkg.size !== undefined) return pkg.size
  try {
    const response = await head(pkg.url)
    const size = Number(response.headers.get('content-length'))
    await response.body?.cancel()
    return response.ok && Number.isSafeInteger(size) && size > 0 && !response.headers.get('content-encoding') ? size : undefined
  } catch { return undefined } // Streaming transfer still enforces the full SHA256.
}

export function javaNetworkError(error: unknown): string {
  const parts: string[] = []
  let current = error
  for (let i = 0; current && i < 3; i++) {
    if (current instanceof Error) {
      const code = (current as NodeJS.ErrnoException).code
      parts.push(`${current.message}${code ? ` (${code})` : ''}`); current = current.cause
    } else { parts.push(String(current)); break }
  }
  return parts.join('；')
}

export async function provisionJava<T>(target: JavaTarget, read: ReadJson, install: (pkg: JavaPackage) => Promise<T>, report: (text: string) => void, signal?: AbortSignal): Promise<T> {
  const errors: string[] = []
  for (const [label, provider] of [['Adoptium', temurinPackage], ['Azul', zuluPackage]] as const) {
    signal?.throwIfAborted()
    report(`${errors.length ? '切换备用源：' : ''}正在准备 Java ${target.major}（${label} · ${target.arch}）`)
    try { const pkg = await provider(target, read); signal?.throwIfAborted(); return await install(pkg) }
    catch (error) { signal?.throwIfAborted(); errors.push(`${label}：${javaNetworkError(error)}`) }
  }
  throw new Error(`Java ${target.major}（${target.os}/${target.arch}）自动准备失败，游戏尚未启动。请检查网络或系统代理后重试，也可在设置中选择已安装的对应 Java。\n${errors.join('\n')}`)
}
