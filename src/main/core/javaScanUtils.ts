import path from 'node:path'
import type { JavaInfo } from '../../shared/types'

/** Version/module probes do not run game code or need a machine-sized heap. */
export const JAVA_PROBE_VM_ARGS = ['-Xms8m', '-Xmx32m'] as const

/** 将注册表中的 %VAR% 展开；未知变量保持原样，避免误改合法路径。 */
export function expandWindowsEnvironment(
  value: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => {
    const key = Object.keys(env).find((item) => item.toLowerCase() === name.toLowerCase())
    return key && env[key] ? env[key]! : whole
  })
}

/** 解析 reg query 输出中可能指向 Java Home/可执行文件的值。 */
export function parseRegistryJavaHomes(
  output: string,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const result: string[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(JavaHome|JAVA_HOME|Path|Home|InstallationPath)\s+REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/i.exec(
      line
    )
    if (!match) continue
    const value = expandWindowsEnvironment(match[2].trim().replace(/^"|"$/g, ''), env)
    if (/^[a-z]:\\/i.test(value)) result.push(path.win32.normalize(value))
  }
  return [...new Set(result.map((item) => item.toLowerCase()))].map(
    (lower) => result.find((item) => item.toLowerCase() === lower)!
  )
}

export function normalizeJavaArchitecture(value: string): string {
  const arch = value.trim().toLowerCase().replace(/[ _-]/g, '')
  if (/^(amd64|x8664|x64)$/.test(arch)) return 'x64'
  if (/^(x86|i[3-6]86|i86pc)$/.test(arch)) return 'x86'
  if (/^(aarch64|arm64)$/.test(arch)) return 'arm64'
  if (/^(arm|arm32)$/.test(arch)) return 'arm32'
  return value.trim() || 'unknown'
}

function property(output: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^\\s*${escaped}\\s*=\\s*(.+?)\\s*$`, 'im').exec(output)?.[1]
}

/** Oracle javapath and similar launchers can be forwarding executables, not the JVM process. */
export function javaHomeExecutable(output: string, platform: NodeJS.Platform = process.platform): string | null {
  const home = property(output, 'java.home')?.replace(/^"|"$/g, '')
  const paths = platform === 'win32' ? path.win32 : path.posix
  if (!home || !paths.isAbsolute(home)) return null
  return paths.join(home, 'bin', platform === 'win32' ? 'java.exe' : 'java')
}

/** 解析 `java -XshowSettings:properties -version` 的 stdout/stderr。 */
export function parseJavaProbeOutput(
  output: string,
  platform: NodeJS.Platform = process.platform
): Omit<JavaInfo, 'path' | 'source' | 'sourceDetail'> | null {
  const version =
    property(output, 'java.version') ??
    /(?:openjdk|java) version\s+"([^"]+)"/i.exec(output)?.[1]
  if (!version) return null

  const versionMatch = /^(?:1\.)?(\d+)/.exec(version)
  if (!versionMatch) return null
  const parsed = Number.parseInt(versionMatch[1], 10)
  const major = version.startsWith('1.')
    ? Number.parseInt(version.split('.')[1] ?? '0', 10)
    : parsed
  if (!Number.isFinite(major) || major <= 0) return null

  const rawArch = property(output, 'os.arch')
  const architecture = rawArch
    ? normalizeJavaArchitecture(rawArch)
    : /64-Bit/i.test(output)
      ? 'x64'
      : platform === 'win32'
        ? 'x86'
        : 'unknown'
  const is64Bit = architecture === 'x64' || architecture === 'arm64'
  const vendor =
    property(output, 'java.vendor') ??
    property(output, 'java.vm.vendor') ??
    (/temurin|adoptium/i.test(output)
      ? 'Eclipse Adoptium'
      : /corretto/i.test(output)
        ? 'Amazon Corretto'
        : /zulu|azul/i.test(output)
          ? 'Azul Systems'
          : /liberica|bellsoft/i.test(output)
            ? 'BellSoft'
            : /microsoft/i.test(output)
              ? 'Microsoft'
              : /oracle/i.test(output)
                ? 'Oracle'
                : undefined)

  return { major, version, is64Bit, architecture, vendor }
}

/** 大目录扫描时永远不进入这些与 Java Runtime 无关或代价极高的目录。 */
export function shouldPruneJavaDirectory(name: string): boolean {
  const value = name.toLowerCase()
  return (
    value === '$recycle.bin' ||
    value === 'system volume information' ||
    value === 'windows' ||
    value === 'winsxs' ||
    value === 'system32' ||
    value === 'syswow64' ||
    value === 'node_modules' ||
    value === '.git' ||
    value === 'libraries' ||
    value === 'assets' ||
    value === 'versions' ||
    value === 'mods' ||
    value === 'saves' ||
    value === 'screenshots' ||
    value === 'logs' ||
    value === 'crash-reports' ||
    value === 'jmods' ||
    value === 'lib' ||
    value === 'legal' ||
    value === 'include' ||
    value === 'src' ||
    value === 'cache' ||
    value === 'caches' ||
    value === 'temp' ||
    value === 'tmp'
  )
}
