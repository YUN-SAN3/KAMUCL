import { getSettings, saveSettings } from './api'
import { store } from './store'
import type { Settings } from '@shared/types'

let pending: Promise<unknown> = Promise.resolve()
let revision = 0
/** Reflect switches/sliders immediately; serialize disk writes and ignore stale full snapshots. */
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const current = ++revision
  const snapshot = JSON.parse(JSON.stringify(patch)) as Partial<Settings>
  const publicPatch = { ...snapshot }
  // Write-only secrets belong to their input and the main-process request, never the global UI store.
  delete publicPatch.curseforgeApiKey
  if (store.settings) store.settings = { ...store.settings, ...publicPatch }
  const result = pending.then(() => saveSettings(snapshot))
  pending = result.catch(() => undefined)
  try {
    const saved = await result
    if (current === revision) store.settings = saved
  } catch (error) {
    if (current === revision) {
      const persisted = await getSettings()
      if (current === revision) store.settings = persisted
    }
    throw error
  }
}
