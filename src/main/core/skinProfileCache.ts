import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { ProfileSkins } from '../../shared/types'

/** Cache only public appearance data. Account credentials never enter this store. */
export function cacheableProfile(profile: ProfileSkins): ProfileSkins | null {
  const png = (value?: string) => typeof value === 'string' && value.length < 2_000_000 && value.startsWith('data:image/png;base64,iVBOR') ? value : undefined
  const skins = (profile.skins ?? []).slice(0, 8).map(s => ({
    variant: s.variant === 'slim' ? 'slim' as const : 'classic' as const,
    url: String(s.url ?? ''), state: s.state, dataUrl: png(s.dataUrl),
    textureError: typeof s.textureError === 'string' ? s.textureError.slice(0, 160) : undefined
  }))
  if (!skins.some(s => s.dataUrl)) return null
  return { username: String(profile.username ?? ''), skins,
    capes: (profile.capes ?? []).slice(0, 16).map(c => ({ id: c.id, alias: c.alias, active: c.active, url: c.url, dataUrl: png(c.dataUrl),
      textureError: typeof c.textureError === 'string' ? c.textureError.slice(0, 160) : undefined })) }
}

export function incompleteProfile(profile: ProfileSkins): boolean {
  return [...profile.skins, ...profile.capes].some(texture => texture.url && (!texture.dataUrl || texture.textureError))
}

/** A failed refresh may retain public pixels only when their source identity is unchanged. */
function retainDownloadedTextures(fresh: ProfileSkins, cached: ProfileSkins | null): ProfileSkins {
  if (!cached) return fresh
  return { ...fresh,
    skins: fresh.skins.map(skin => {
      const old = cached.skins.find(item => item.url === skin.url)
      return !skin.dataUrl && old?.dataUrl ? { ...skin, dataUrl: old.dataUrl } : skin
    }),
    capes: fresh.capes.map(cape => {
      const old = cached.capes.find(item => item.id === cape.id && item.url === cape.url)
      return !cape.dataUrl && old?.dataUrl ? { ...cape, dataUrl: old.dataUrl } : cape
    }) }
}
export class SkinProfileCache {
  private memory = new Map<string, ProfileSkins>()
  private pending = new Map<string, Promise<ProfileSkins>>()
  constructor(private directory: () => string) {}
  private file(key: string) { return path.join(this.directory(), crypto.createHash('sha256').update(key).digest('hex') + '.json') }
  private read(key: string): ProfileSkins | null {
    if (this.memory.has(key)) return this.memory.get(key)!
    try {
      const file = this.file(key)
      if (fs.statSync(file).size > 8_000_000) return null
      const profile = cacheableProfile(JSON.parse(fs.readFileSync(file, 'utf8')))
      if (profile) this.memory.set(key, profile)
      return profile
    } catch { return null }
  }
  async get(key: string, load: () => Promise<ProfileSkins>, refresh = false): Promise<ProfileSkins> {
    const cached = this.read(key)
    // Failed cape downloads must not become a permanent successful cache hit.
    if (cached && !refresh && !incompleteProfile(cached)) { console.info('[KAMUCL] Skin profile: cache hit, no network'); return structuredClone(cached) }
    if (this.pending.has(key)) return this.pending.get(key)!
    const work = (async () => {
      const started = Date.now()
      try {
        const fresh = retainDownloadedTextures(await load(), cached)
        const publicProfile = cacheableProfile(fresh)
        if (publicProfile) {
          this.memory.set(key, publicProfile)
          const file = this.file(key), temp = file + '.' + crypto.randomUUID() + '.tmp'
          try {
            await fs.promises.mkdir(this.directory(), { recursive: true })
            await fs.promises.writeFile(temp, JSON.stringify(publicProfile), { flag: 'wx' })
            await fs.promises.rename(temp, file)
          } catch { /* Disk-full/read-only must not discard a successfully downloaded texture. */ }
          finally { await fs.promises.rm(temp, { force: true }).catch(() => undefined) }
        }
        return publicProfile ?? cached ?? fresh
      } catch (error) { if (cached) return cached; throw error }
      finally { this.pending.delete(key); console.info(`[KAMUCL] Skin profile: ${refresh ? 'refresh' : 'cache miss'}, ${Date.now() - started} ms`) }
    })()
    this.pending.set(key, work)
    return work
  }
}
