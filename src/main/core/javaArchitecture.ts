import type { VersionJson } from './versions'

/** Older Minecraft natives only ship Intel binaries on macOS. Prefer the native
 * JVM when the version supplies Apple Silicon natives, otherwise use Intel Java. */
export function macJavaArchitecture(version: VersionJson, platform = process.platform, arch = process.arch): 'arm64' | 'x64' | undefined {
  if (platform !== 'darwin') return undefined
  if (arch !== 'arm64') return 'x64'
  const libraries = version.libraries ?? []
  const macNatives = libraries.flatMap(lib => [lib.name, lib.natives?.osx, ...Object.keys(lib.downloads?.classifiers ?? {})])
    .filter((name): name is string => !!name && /natives-(?:osx|macos)/i.test(name))
  return macNatives.length && !macNatives.some(name => /(?:arm64|aarch64)/i.test(name)) ? 'x64' : 'arm64'
}

/** Linux and Windows cannot silently select another architecture's installed JVM. */
export function gameJavaArchitecture(version: VersionJson, platform: string = process.platform, arch: string = process.arch): 'arm64' | 'x64' | undefined {
  if (platform === 'darwin') return macJavaArchitecture(version, 'darwin', arch as NodeJS.Architecture)
  if (platform === 'linux' || platform === 'win32') return arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'x64' : undefined
  return undefined
}
