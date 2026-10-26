import { getCurseforgeApiKey } from './settings'
import { CF_BUILTIN_KEY } from './curseforgeKey'

export const CF_OFFICIAL = 'https://api.curseforge.com/v1'
export const CF_MIRROR = 'https://mod.mcimirror.top/curseforge/v1'

/** Channel policy is independent of catalog/search/install services. A download
 * needs credentials, not a runtime dependency on the whole community module. */
export function cfChannel(): { base: string; official: boolean; key: string } {
  const key = (process.env.KAMUCL_CF_API_KEY || getCurseforgeApiKey().trim() || CF_BUILTIN_KEY).trim()
  return key ? { base: CF_OFFICIAL, official: true, key }
    : { base: CF_MIRROR, official: false, key: '' }
}
