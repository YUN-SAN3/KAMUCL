import { app } from 'electron'
import { GITHUB_REPO } from '../../shared/branding'
import type { ReleaseInfo } from '../../shared/types'

/** 测试覆盖只能用于开发进程，且必须同时指定独立数据目录和模拟 API。 */
export function isolatedUpdateTest(): boolean {
  return app?.isPackaged !== true && !!process.env.KAMUCL_USERDATA_DIR && !!process.env.KAMUCL_UPDATE_API_BASE
}

export function trustedUpdateRelease(release: ReleaseInfo | undefined): boolean {
  if (!release || !/^\d+\.\d+\.\d+$/.test(release.version)) return false
  if (isolatedUpdateTest()) return true
  const name = `KAMUCL-${release.version}.exe`
  return release.assetName === name && release.assetSize > 0 &&
    release.assetUrl === `https://github.com/${GITHUB_REPO}/releases/download/v${release.version}/${name}`
}
