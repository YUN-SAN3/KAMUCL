import fs from 'node:fs'
import path from 'node:path'

export const defaultGameFolder = (appData: string): string => path.join(appData, '.minecraft')

/** Only the launcher-owned default may be created implicitly; missing external roots stay missing. */
export function ensureDefaultGameFolder(appData: string, folders: readonly { path: string }[]): void {
  // A registered legacy default remains supported without moving existing games.
  for (const root of [defaultGameFolder(appData), path.join(appData, '.kamucl')]) {
    if (folders.some(folder => path.resolve(folder.path) === path.resolve(root))) {
      fs.mkdirSync(root, { recursive: true })
    }
  }
}
