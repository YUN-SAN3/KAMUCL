import { ref } from 'vue'
import type { ModFavorite } from '@shared/modFavorites'
import { errText } from './api'
import { toast } from './store'
export const favorites = ref<ModFavorite[]>([])
export const favoriteBusy = ref(new Set<string>())
/** Keep exact rejection text beside the affected controls, including inside dialogs. */
export const favoriteErrors = ref(new Map<string, string>())
export function clearFavoriteErrors(keys: string[]): void {
  const next = new Map(favoriteErrors.value)
  for (const key of keys) next.delete(key)
  favoriteErrors.value = next
}
let writeQueue: Promise<unknown> = Promise.resolve()
let readGeneration = 0
let writeGeneration = 0
let activeRead: Promise<{ list: ModFavorite[]; writes: number }> | undefined

/** A delayed list response cannot replace a newer favorite mutation. */
export async function loadFavorites(propagateError = false): Promise<void> {
  const generation = ++readGeneration
  const read = (async () => {
    await writeQueue
    const writes = writeGeneration
    const list = await window.kamucl.invoke('mods:favorites') as ModFavorite[]
    if (generation === readGeneration && writes === writeGeneration) favorites.value = list
    return { list, writes }
  })()
  activeRead = read
  try { await read } catch (e) { if (propagateError) throw e; toast(errText(e), 'error') }
  finally { if (activeRead === read) activeRead = undefined }
}

/** Every page writes through one queue; different projects cannot overwrite each other's snapshots. */
async function mutateFavorite(key: string | string[], request: () => Promise<ModFavorite[]>): Promise<boolean> {
  const keys = [...new Set(Array.isArray(key) ? key : [key])]
  if (!keys.length || keys.some(value => favoriteBusy.value.has(value))) return false
  clearFavoriteErrors(keys)
  favoriteBusy.value = new Set([...favoriteBusy.value, ...keys])
  const initialRead = activeRead
  const job = writeQueue.then(async () => {
    const loaded = await initialRead?.catch(() => undefined)
    if (loaded && loaded.writes === writeGeneration) favorites.value = loaded.list
    writeGeneration++
    readGeneration++
    favorites.value = await request()
    return true
  })
  writeQueue = job.catch(() => {})
  try { return await job } catch (e) {
    const message = errText(e), errors = new Map(favoriteErrors.value)
    for (const key of keys) errors.set(key, message)
    favoriteErrors.value = errors
    toast(message, 'error'); return false
  }
  finally { const next = new Set(favoriteBusy.value); for (const value of keys) next.delete(value); favoriteBusy.value = next }
}

export function toggleProject(source: string, projectId: string, name: string, iconUrl?: string): Promise<boolean> {
  const key = source + ':' + projectId
  return mutateFavorite(key, () => window.kamucl.invoke('mods:favorite', { source, projectId, name, iconUrl }, !favorites.value.some(f => f.key === key)) as Promise<ModFavorite[]>)
}

export function setLocalFavorite(key: string, version: string, folder: string, name: string, enabled: boolean, link?: {source: string; projectId: string}): Promise<boolean> {
  const safeLink = link ? { source: link.source, projectId: link.projectId } : undefined
  return mutateFavorite(key, () => window.kamucl.invoke('mods:favoriteLocal', version, folder, name, enabled, safeLink) as Promise<ModFavorite[]>)
}

export function removeFavorites(keys: string[]): Promise<boolean> {
  // A ref/reactive array is a Proxy, which Electron cannot structured-clone.
  // Snapshot plain primitive keys before enqueueing; later selection edits must
  // not alter either the busy guards or the request eventually sent to main.
  const safeKeys = [...new Set(keys)]
  return mutateFavorite(safeKeys, () => window.kamucl.invoke('mods:favoriteRemove', safeKeys) as Promise<ModFavorite[]>)
}

export function linkFavorite(key: string, source: string, projectId: string): Promise<boolean> {
  return mutateFavorite([key, source + ':' + projectId], () => window.kamucl.invoke('mods:favoriteLink', key, source, projectId) as Promise<ModFavorite[]>)
}
