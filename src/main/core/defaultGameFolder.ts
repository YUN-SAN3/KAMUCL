import fs from 'node:fs'
import path from 'node:path'

/** Only the launcher-owned default may be created implicitly; missing external roots stay missing. */
export function ensureDefaultGameFolder(appData: string, folders: readonly { path: string }[]): void {
  const root = path.join(appData, '.kamucl')
  if (folders.some(folder => path.resolve(folder.path) === path.resolve(root))) {
    fs.mkdirSync(root, { recursive: true })
  }
}
