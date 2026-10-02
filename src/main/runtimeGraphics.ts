import fs from 'node:fs'
import path from 'node:path'

interface GraphicsCommandLine {
  getSwitchValue(name: string): string
  appendSwitch(name: string, value?: string): void
}

/** Compact Windows builds omit the optional Dawn/D3D12 compiler, not ANGLE/WebGL. */
export function configureRuntimeGraphics(commandLine: GraphicsCommandLine, platform: NodeJS.Platform, runtimeDir: string): boolean {
  if (platform !== 'win32' || fs.existsSync(path.join(runtimeDir, 'dxcompiler.dll'))) return false
  const disabled = new Set(commandLine.getSwitchValue('disable-features').split(',').filter(Boolean))
  disabled.add('WebGPUService')
  commandLine.appendSwitch('disable-features', [...disabled].join(','))
  // This switch takes precedence over an experimental --enable-skia-graphite.
  commandLine.appendSwitch('disable-skia-graphite')
  return true
}
