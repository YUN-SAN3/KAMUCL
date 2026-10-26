import path from 'node:path'
import { app } from 'electron'
import { platformInfo, productPlatform, type InstallationKind } from '../shared/platform'

export function installationKind(): InstallationKind {
  if (!app?.isPackaged) return 'development'
  const os = productPlatform(process.platform)
  if (os === 'windows') return 'portable-exe'
  if (os === 'macos') return 'mac-app'
  if (os === 'harmonyos') return 'hap'
  if (os === 'linux') {
    if (process.env.APPIMAGE && path.isAbsolute(process.env.APPIMAGE)) return 'appimage'
    // electron-builder DEB installs to /opt/KAMUCL; never self-replace system-owned directories.
    if (/^\/(?:usr|opt)\//.test(process.execPath)) return 'deb'
    return 'portable-directory'
  }
  return 'development'
}
export function currentPlatformInfo() {
  return platformInfo(process.platform, process.arch, installationKind())
}
